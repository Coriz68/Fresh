"""Fail-closed Windows UI Automation for preparing a WhatsApp PDF attachment."""

from __future__ import annotations

import ctypes
import os
import time
from ctypes import wintypes
from pathlib import Path
from typing import Any, Callable


WHATSAPP_PROCESS = "whatsapp.exe"
ATTACH_NAMES = frozenset({"attach", "allega"})
DOCUMENT_NAMES = frozenset({"document", "documento"})
OPEN_DIALOG_NAMES = frozenset({"open", "apri"})
FILE_NAME_NAMES = frozenset({"file name:", "nome file:"})
OPEN_BUTTON_NAMES = frozenset({"open", "apri"})


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


def _unique_window(
    windows: list[Any],
    process_name_resolver: Callable[[Any], str],
    expected_process: str,
    expected_titles: frozenset[str] | None = None,
) -> Any | None:
    matches = []
    for window in windows:
        if not _visible(window):
            continue
        try:
            if process_name_resolver(window).casefold() != expected_process:
                continue
        except Exception:
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

    whatsapp_window = _unique_window(
        desktop.windows(), process_name_resolver, WHATSAPP_PROCESS
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
        _wait_for(
            lambda: sum(
                1
                for control in whatsapp_window.descendants()
                if _visible(control) and filename_label in _control_name(control)
            ) > initial_filename_count,
            timeout_seconds,
            "verifica dell’anteprima del PDF in WhatsApp",
        )
    except RuntimeError as error:
        if "allegato annullato" in str(error).casefold() or "timeout" in str(error).casefold():
            raise
        raise RuntimeError(
            "Il selettore file è stato annullato o non ha completato l’allegato; usa l’allegato manuale."
        ) from error
    except Exception as error:
        raise RuntimeError("WhatsApp non ha preparato l’allegato; il PDF resta disponibile per l’allegato manuale.") from error
