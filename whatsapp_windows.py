"""Fail-closed Windows UI Automation for preparing a WhatsApp PDF attachment."""

from __future__ import annotations

import ctypes
import os
import time
from ctypes import wintypes
from pathlib import Path
from typing import Any, Callable


WHATSAPP_PROCESS = "whatsapp.exe"
WHATSAPP_APP_USER_MODEL_ID = "5319275A.WhatsAppDesktop_cv1g1gvanyjgm!App"
ATTACH_NAMES = frozenset({"attach", "allega"})
DOCUMENT_NAMES = frozenset({"document", "documento"})
OPEN_DIALOG_NAMES = frozenset({"open", "apri"})
FILE_NAME_NAMES = frozenset({"file name:", "nome file:"})
OPEN_BUTTON_NAMES = frozenset({"open", "apri"})
SEND_NAMES = frozenset({"send", "invia", "send file", "invia file"})


def _windows_process_name(process_id: int) -> str:
    if os.name != "nt":
        raise RuntimeError("L’allegato automatico richiede Windows.")
    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel32.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
    kernel32.OpenProcess.restype = wintypes.HANDLE
    kernel32.QueryFullProcessImageNameW.argtypes = [
        wintypes.HANDLE,
        wintypes.DWORD,
        wintypes.LPWSTR,
        ctypes.POINTER(wintypes.DWORD),
    ]
    kernel32.QueryFullProcessImageNameW.restype = wintypes.BOOL
    kernel32.CloseHandle.argtypes = [wintypes.HANDLE]
    handle = kernel32.OpenProcess(0x1000, False, process_id)
    if not handle:
        raise RuntimeError("Non riesco a verificare il processo della finestra WhatsApp.")
    try:
        buffer = ctypes.create_unicode_buffer(32768)
        length = wintypes.DWORD(len(buffer))
        if not kernel32.QueryFullProcessImageNameW(handle, 0, buffer, ctypes.byref(length)):
            raise RuntimeError("Non riesco a verificare il processo della finestra WhatsApp.")
        return Path(buffer.value).name.casefold()
    finally:
        kernel32.CloseHandle(handle)


class _Guid(ctypes.Structure):
    _fields_ = [
        ("data1", wintypes.DWORD),
        ("data2", wintypes.WORD),
        ("data3", wintypes.WORD),
        ("data4", wintypes.BYTE * 8),
    ]


class _PropertyKey(ctypes.Structure):
    _fields_ = [("fmtid", _Guid), ("pid", wintypes.DWORD)]


class _PropVariantValue(ctypes.Union):
    _fields_ = [("pointer", ctypes.c_void_p), ("number", ctypes.c_longlong)]


class _PropVariant(ctypes.Structure):
    _anonymous_ = ("value",)
    _fields_ = [
        ("vt", wintypes.WORD),
        ("reserved1", wintypes.WORD),
        ("reserved2", wintypes.WORD),
        ("reserved3", wintypes.WORD),
        ("value", _PropVariantValue),
    ]


def _guid(value: str) -> _Guid:
    import uuid

    parsed = uuid.UUID(value)
    tail = (wintypes.BYTE * 8).from_buffer_copy(parsed.bytes[8:])
    return _Guid(parsed.time_low, parsed.time_mid, parsed.time_hi_version, tail)


def _windows_app_user_model_id(window: Any) -> str:
    """Read the shell AppUserModelID assigned to a top-level window."""
    if os.name != "nt":
        return ""
    handle = _window_handle(window)
    if not handle:
        return ""

    shell32 = ctypes.WinDLL("shell32", use_last_error=True)
    shell32.SHGetPropertyStoreForWindow.argtypes = [
        wintypes.HWND,
        ctypes.POINTER(_Guid),
        ctypes.POINTER(ctypes.c_void_p),
    ]
    shell32.SHGetPropertyStoreForWindow.restype = ctypes.c_long
    iid_property_store = _guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99")
    property_store = ctypes.c_void_p()
    result = shell32.SHGetPropertyStoreForWindow(
        handle, ctypes.byref(iid_property_store), ctypes.byref(property_store)
    )
    if result < 0 or not property_store.value:
        return ""

    # PKEY_AppUserModel_ID = {9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3}, PID 5.
    key = _PropertyKey(
        _guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3"), 5
    )
    variant = _PropVariant()
    vtable = None
    try:
        vtable = ctypes.cast(
            property_store,
            ctypes.POINTER(ctypes.POINTER(ctypes.c_void_p)),
        ).contents
        get_value = ctypes.WINFUNCTYPE(
            ctypes.c_long,
            ctypes.c_void_p,
            ctypes.POINTER(_PropertyKey),
            ctypes.POINTER(_PropVariant),
        )(vtable[5])
        if get_value(property_store, ctypes.byref(key), ctypes.byref(variant)) < 0:
            return ""
        # VT_LPWSTR is the normal representation of PKEY_AppUserModel_ID.
        return ctypes.wstring_at(variant.pointer) if variant.vt == 31 and variant.pointer else ""
    except (AttributeError, OSError, TypeError, ValueError):
        return ""
    finally:
        if variant.vt:
            ole32 = ctypes.WinDLL("ole32", use_last_error=True)
            ole32.PropVariantClear.argtypes = [ctypes.POINTER(_PropVariant)]
            ole32.PropVariantClear.restype = ctypes.c_long
            ole32.PropVariantClear(ctypes.byref(variant))
        if vtable is not None:
            release = ctypes.WINFUNCTYPE(ctypes.c_ulong, ctypes.c_void_p)(vtable[2])
            release(property_store)


def _is_whatsapp_window(
    window: Any,
    process_name_resolver: Callable[[Any], str],
    app_user_model_id_resolver: Callable[[Any], str],
) -> bool:
    try:
        if process_name_resolver(window).casefold() == WHATSAPP_PROCESS:
            return True
    except Exception:
        pass
    try:
        return app_user_model_id_resolver(window).casefold() == WHATSAPP_APP_USER_MODEL_ID.casefold()
    except Exception:
        return False


def _control_name(control: Any) -> str:
    return str(control.window_text() or "").strip().casefold()


def _control_type(control: Any) -> str:
    element_info = getattr(control, "element_info", None)
    value = getattr(element_info, "control_type", None) or getattr(control, "control_type", "")
    return str(value).casefold()


def _visible(control: Any) -> bool:
    try:
        return bool(control.is_visible())
    except Exception:
        return False


def _window_handle(window: Any) -> int:
    element_info = getattr(window, "element_info", None)
    handle = getattr(element_info, "handle", None) or getattr(window, "handle", None)
    return int(handle or 0)


def _owned_by_window(window: Any, owner_window: Any) -> bool:
    """Match a system-hosted file picker to the exact WhatsApp window that opened it."""
    if os.name != "nt":
        return False
    target = _window_handle(owner_window)
    current = _window_handle(window)
    if not target or not current:
        return False

    user32 = ctypes.WinDLL("user32", use_last_error=True)
    user32.GetWindow.argtypes = [wintypes.HWND, wintypes.UINT]
    user32.GetWindow.restype = wintypes.HWND
    user32.GetParent.argtypes = [wintypes.HWND]
    user32.GetParent.restype = wintypes.HWND
    seen: set[int] = set()
    for _ in range(12):
        if not current or current in seen:
            break
        if current == target:
            return True
        seen.add(current)
        owner = int(user32.GetWindow(current, 4) or 0)  # GW_OWNER
        parent = int(user32.GetParent(current) or 0)
        current = owner or parent
    return False


def _unique_window(
    windows: list[Any],
    process_name_resolver: Callable[[Any], str],
    expected_process: str,
    expected_titles: frozenset[str] | None = None,
    *,
    owner_window: Any | None = None,
    window_owner_checker: Callable[[Any, Any], bool] | None = None,
    app_user_model_id_resolver: Callable[[Any], str] | None = None,
) -> Any | None:
    matches = []
    for window in windows:
        if not _visible(window):
            continue
        same_process = _is_whatsapp_window(
            window,
            process_name_resolver,
            app_user_model_id_resolver or (lambda _window: ""),
        ) if expected_process == WHATSAPP_PROCESS else False
        if not same_process:
            try:
                same_process = process_name_resolver(window).casefold() == expected_process
            except Exception:
                same_process = False
        if not same_process and not (
            owner_window is not None
            and window_owner_checker is not None
            and window_owner_checker(window, owner_window)
        ):
            continue
        if expected_titles is not None and _control_name(window) not in expected_titles:
            continue
        matches.append(window)
    if len(matches) > 1:
        raise RuntimeError("La finestra WhatsApp/il selettore file non è univoco; allegato annullato.")
    return matches[0] if matches else None


def _unique_control(
    window: Any,
    names: frozenset[str],
    control_types: frozenset[str],
    label: str,
    *,
    allow_missing: bool = False,
) -> Any:
    matches = [
        control
        for control in window.descendants()
        if _visible(control)
        and _control_name(control) in names
        and _control_type(control) in control_types
    ]
    if len(matches) > 1:
        raise RuntimeError(f"Controllo accessibile {label} assente o non univoco; allegato annullato.")
    if not matches:
        if allow_missing:
            return None
        raise RuntimeError(f"Controllo accessibile {label} assente o non univoco; allegato annullato.")
    return matches[0]


def _pdf_preview_window(
    windows: list[Any],
    whatsapp_window: Any,
    filename: str,
    process_name_resolver: Callable[[Any], str],
    window_owner_checker: Callable[[Any, Any], bool],
    app_user_model_id_resolver: Callable[[Any], str],
) -> Any | None:
    candidates = []
    for window in windows:
        if not _visible(window):
            continue
        belongs_to_whatsapp = _is_whatsapp_window(
            window, process_name_resolver, app_user_model_id_resolver
        )
        if not belongs_to_whatsapp and not window_owner_checker(window, whatsapp_window):
            continue
        if not any(
            _visible(control) and filename in _control_name(control)
            for control in window.descendants()
        ):
            continue
        candidates.append(window)

    if len(candidates) <= 1:
        return candidates[0] if candidates else None
    send_windows = [
        window
        for window in candidates
        if window is not whatsapp_window
        if any(
            _visible(control)
            and _control_name(control) in SEND_NAMES
            and _control_type(control) == "button"
            for control in window.descendants()
        )
    ]
    if len(send_windows) == 1:
        return send_windows[0]
    raise RuntimeError("L’anteprima PDF di WhatsApp non è univoca; allegato annullato.")


def _wait_for(predicate: Callable[[], Any], timeout_seconds: float, description: str) -> Any:
    deadline = time.monotonic() + max(0, timeout_seconds)
    while True:
        result = predicate()
        if result:
            return result
        if time.monotonic() >= deadline:
            raise RuntimeError(f"Timeout durante {description}; allegato annullato.")
        time.sleep(min(0.1, max(0, deadline - time.monotonic())))


def attach_pdf_to_open_chat(
    path: Path,
    *,
    timeout_seconds: float = 15,
    desktop_factory: Callable[..., Any] | None = None,
    process_name_resolver: Callable[[Any], str] | None = None,
    window_owner_checker: Callable[[Any, Any], bool] | None = None,
    app_user_model_id_resolver: Callable[[Any], str] | None = None,
    platform_name: str | None = None,
) -> None:
    """Attach one PDF to the already-open, user-confirmed WhatsApp chat.

    This routine never uses the system clipboard or activates a send control.
    Test seams are optional; production imports pywinauto only on Windows.
    """
    if (platform_name or os.name) != "nt":
        raise RuntimeError("L’allegato automatico WhatsApp è disponibile solo su Windows.")
    pdf_path = Path(path).expanduser().resolve(strict=True)
    if not pdf_path.is_file() or pdf_path.suffix.lower() != ".pdf":
        raise ValueError("Il file da allegare non è un PDF valido.")
    with pdf_path.open("rb") as stream:
        if stream.read(5) != b"%PDF-":
            raise ValueError("Il file da allegare non è un PDF valido.")

    if desktop_factory is None:
        try:
            from pywinauto import Desktop
        except ImportError as error:
            raise RuntimeError("L’automazione UI di WhatsApp non è disponibile in questa installazione.") from error
        desktop_factory = Desktop
    desktop = desktop_factory(backend="uia")
    process_name_resolver = process_name_resolver or (
        lambda window: _windows_process_name(window.element_info.process)
    )
    app_user_model_id_resolver = app_user_model_id_resolver or _windows_app_user_model_id
    window_owner_checker = window_owner_checker or _owned_by_window

    whatsapp_window = _unique_window(
        desktop.windows(),
        process_name_resolver,
        WHATSAPP_PROCESS,
        app_user_model_id_resolver=app_user_model_id_resolver,
    )
    if whatsapp_window is None:
        raise RuntimeError("WhatsApp Desktop non è aperto; apri e verifica la chat prima di allegare il PDF.")
    if not callable(getattr(whatsapp_window, "set_focus", None)):
        raise RuntimeError("Non riesco a selezionare la finestra WhatsApp; allegato annullato.")
    try:
        whatsapp_window.set_focus()
        attach_button = _unique_control(
            whatsapp_window, ATTACH_NAMES, frozenset({"button"}), "Allega"
        )
        filename_label = pdf_path.name.casefold()
        initial_filename_count = sum(
            1
            for control in whatsapp_window.descendants()
            if _visible(control) and filename_label in _control_name(control)
        )
        attach_button.click_input()
        document_item = _wait_for(
            lambda: _unique_control(
                whatsapp_window,
                DOCUMENT_NAMES,
                frozenset({"menuitem", "button"}),
                "Documento",
                allow_missing=True,
            ),
            timeout_seconds,
            "ricerca del comando Documento",
        )
        document_item.click_input()

        file_dialog = _wait_for(
            lambda: _unique_window(
                desktop.windows(),
                process_name_resolver,
                WHATSAPP_PROCESS,
                OPEN_DIALOG_NAMES,
                owner_window=whatsapp_window,
                window_owner_checker=window_owner_checker,
            ),
            timeout_seconds,
            "apertura del selettore file",
        )
        filename_field = _unique_control(
            file_dialog,
            FILE_NAME_NAMES,
            frozenset({"edit", "combobox"}),
            "Nome file",
        )
        open_button = _unique_control(
            file_dialog, OPEN_BUTTON_NAMES, frozenset({"button"}), "Apri"
        )
        filename_field.set_edit_text(str(pdf_path))
        open_button.click_input()
        _wait_for(
            lambda: not _visible(file_dialog),
            timeout_seconds,
            "chiusura del selettore file",
        )
        preview_window = _wait_for(
            lambda: _pdf_preview_window(
                desktop.windows(),
                whatsapp_window,
                filename_label,
                process_name_resolver,
                window_owner_checker,
                app_user_model_id_resolver,
            ),
            timeout_seconds,
            "verifica dell’anteprima del PDF in WhatsApp",
        )
        if preview_window is whatsapp_window and initial_filename_count:
            raise RuntimeError("L’anteprima PDF di WhatsApp non è univoca; allegato annullato.")
        if not callable(getattr(preview_window, "set_focus", None)):
            raise RuntimeError("Non riesco a mantenere in primo piano l’anteprima WhatsApp; allegato annullato.")
        # Focus the window that actually contains the PDF preview, which may be a
        # separate top-level modal instead of the chat window.
        preview_window.set_focus()
    except RuntimeError as error:
        if "allegato annullato" in str(error).casefold() or "timeout" in str(error).casefold():
            raise
        raise RuntimeError(
            "Il selettore file è stato annullato o non ha completato l’allegato; usa l’allegato manuale."
        ) from error
    except Exception as error:
        raise RuntimeError("WhatsApp non ha preparato l’allegato; il PDF resta disponibile per l’allegato manuale.") from error
