"""Fail-closed WhatsApp Desktop PDF preparation using the existing file clipboard."""

from __future__ import annotations

import ctypes
import hashlib
import logging
import os
import platform
import re
import threading
import time
from ctypes import wintypes
from pathlib import Path
from typing import Any, Callable
from urllib.parse import quote
import webbrowser

_LOCK = threading.Lock()
_COMPOSER_NAMES = frozenset({"type a message", "scrivi un messaggio", "digita un messaggio", "message"})
_WHATSAPP_PROCESS = "whatsapp.exe"
_WHATSAPP_APP_USER_MODEL_ID = "5319275A.WhatsAppDesktop_cv1g1gvanyjgm!App"


def build_whatsapp_web_url(phone: str, text: str) -> str:
    if not isinstance(phone, str) or not phone.isdigit() or not 8 <= len(phone) <= 15:
        raise ValueError("Numero WhatsApp non valido.")
    return f"https://web.whatsapp.com/send?phone={phone}&text={quote(str(text), safe='')}"


def build_whatsapp_protocol_url(phone: str, text: str) -> str:
    if not isinstance(phone, str) or not phone.isdigit() or not 8 <= len(phone) <= 15:
        raise ValueError("Numero WhatsApp non valido.")
    return f"whatsapp://send?phone={phone}&text={quote(str(text), safe='')}"


def log_whatsapp_event(
    logger: logging.Logger,
    step: str,
    outcome: str,
    *,
    error: BaseException | None = None,
    app_version: str = "non rilevata",
    windows_version: str | None = None,
    duration_ms: int | None = None,
    error_type: str | None = None,
) -> None:
    """Logga codici di fase e versioni, mai testo, numero, percorso o dettagli PDF."""
    logger.info(
        "whatsapp step=%s outcome=%s duration_ms=%s app_version=%s windows_version=%s error_type=%s",
        step,
        outcome,
        duration_ms if duration_ms is not None else "n/a",
        app_version,
        windows_version if windows_version is not None else platform.version(),
        type(error).__name__ if error is not None else error_type or "none",
    )


def open_whatsapp_browser(
    phone: str,
    text: str,
    *,
    opener: Callable[[str], Any] | None = None,
) -> dict[str, Any]:
    url = build_whatsapp_web_url(phone, text)
    opened = webbrowser.open(url, new=2) if opener is None else opener(url)
    if opened is False:
        raise RuntimeError("Il browser predefinito non ha accettato il collegamento WhatsApp Web.")
    return {"browserOpened": True}


def open_whatsapp_with_fallback(
    phone: str,
    text: str,
    *,
    desktop_open: Callable[[str], Any] | None = None,
    browser_open: Callable[[str], Any] | None = None,
) -> dict[str, Any]:
    """Prova WhatsApp Desktop e usa WhatsApp Web se l'avvio non riesce."""
    if not isinstance(phone, str) or not phone.isdigit() or not 8 <= len(phone) <= 15:
        raise ValueError("Numero WhatsApp non valido.")
    desktop_open = desktop_open or (lambda target: open_whatsapp_chat(target))
    browser_open = browser_open or (lambda url: webbrowser.open(url, new=2))
    try:
        desktop_open(phone)
        return {"desktopOpened": True, "browserOpened": False}
    except Exception as desktop_error:
        url = build_whatsapp_web_url(phone, text)
        try:
            opened = browser_open(url)
            if opened is False:
                raise RuntimeError("Browser non disponibile")
            return {"desktopOpened": False, "browserOpened": True, "errorType": type(desktop_error).__name__}
        except Exception as browser_error:
            return {
                "desktopOpened": False,
                "browserOpened": False,
                "errorType": type(desktop_error).__name__,
                "browserErrorType": type(browser_error).__name__,
            }


def _windows_process_name(process_id: int) -> str:
    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel32.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
    kernel32.OpenProcess.restype = wintypes.HANDLE
    kernel32.QueryFullProcessImageNameW.argtypes = [wintypes.HANDLE, wintypes.DWORD, wintypes.LPWSTR, ctypes.POINTER(wintypes.DWORD)]
    kernel32.QueryFullProcessImageNameW.restype = wintypes.BOOL
    kernel32.CloseHandle.argtypes = [wintypes.HANDLE]
    handle = kernel32.OpenProcess(0x1000, False, process_id)
    if not handle:
        raise RuntimeError("Non riesco a verificare l’identità della finestra.")
    try:
        buffer = ctypes.create_unicode_buffer(32768)
        length = wintypes.DWORD(len(buffer))
        if not kernel32.QueryFullProcessImageNameW(handle, 0, buffer, ctypes.byref(length)):
            raise RuntimeError("Non riesco a verificare l’identità della finestra.")
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


def _activate_store_whatsapp() -> int:
    """Launch Store WhatsApp directly through the Windows activation manager."""
    ole32 = ctypes.WinDLL("ole32", use_last_error=True)
    ole32.CoInitializeEx.argtypes = [ctypes.c_void_p, wintypes.DWORD]
    ole32.CoInitializeEx.restype = ctypes.c_long
    initialize_result = int(ole32.CoInitializeEx(None, 2))  # COINIT_APARTMENTTHREADED
    initialized_here = initialize_result >= 0
    if initialize_result < 0 and (initialize_result & 0xFFFFFFFF) != 0x80010106:  # RPC_E_CHANGED_MODE
        raise RuntimeError(f"COM non disponibile per l’avvio WhatsApp (0x{initialize_result & 0xFFFFFFFF:08X}).")

    activation_manager = ctypes.c_void_p()
    vtable = None
    try:
        ole32.CoCreateInstance.argtypes = [
            ctypes.POINTER(_Guid),
            ctypes.c_void_p,
            wintypes.DWORD,
            ctypes.POINTER(_Guid),
            ctypes.POINTER(ctypes.c_void_p),
        ]
        ole32.CoCreateInstance.restype = ctypes.c_long
        clsid = _guid("45BA127D-10A8-46EA-8AB7-56EA9078943C")
        iid = _guid("2E941141-7F97-4756-BA1D-9DECDE894A3D")
        result = int(ole32.CoCreateInstance(ctypes.byref(clsid), None, 4, ctypes.byref(iid), ctypes.byref(activation_manager)))
        if result < 0 or not activation_manager.value:
            raise RuntimeError(f"Windows non ha attivato WhatsApp Store (0x{result & 0xFFFFFFFF:08X}).")
        vtable = ctypes.cast(
            activation_manager,
            ctypes.POINTER(ctypes.POINTER(ctypes.c_void_p)),
        ).contents
        activate = ctypes.WINFUNCTYPE(
            ctypes.c_long,
            ctypes.c_void_p,
            wintypes.LPCWSTR,
            wintypes.LPCWSTR,
            wintypes.DWORD,
            ctypes.POINTER(wintypes.DWORD),
        )(vtable[3])
        process_id = wintypes.DWORD()
        result = int(activate(activation_manager, _WHATSAPP_APP_USER_MODEL_ID, None, 0, ctypes.byref(process_id)))
        if result < 0:
            raise RuntimeError(f"Windows non ha avviato WhatsApp Store (0x{result & 0xFFFFFFFF:08X}).")
        return int(process_id.value)
    finally:
        if vtable is not None:
            release = ctypes.WINFUNCTYPE(ctypes.c_ulong, ctypes.c_void_p)(vtable[2])
            release(activation_manager)
        if initialized_here:
            ole32.CoUninitialize()


def _windows_app_user_model_id(window: Any) -> str:
    """Read the shell AppUserModelID used by Microsoft Store-hosted windows."""
    if os.name != "nt":
        return ""
    element_info = getattr(window, "element_info", None)
    handle = int(getattr(element_info, "handle", 0) or getattr(window, "handle", 0) or 0)
    if not handle:
        return ""
    shell32 = ctypes.WinDLL("shell32", use_last_error=True)
    shell32.SHGetPropertyStoreForWindow.argtypes = [
        wintypes.HWND,
        ctypes.POINTER(_Guid),
        ctypes.POINTER(ctypes.c_void_p),
    ]
    shell32.SHGetPropertyStoreForWindow.restype = ctypes.c_long
    property_store_iid = _guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99")
    property_store = ctypes.c_void_p()
    result = shell32.SHGetPropertyStoreForWindow(
        handle, ctypes.byref(property_store_iid), ctypes.byref(property_store)
    )
    if result < 0 or not property_store.value:
        return ""

    key = _PropertyKey(_guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3"), 5)
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
        if process_name_resolver(window).casefold() == _WHATSAPP_PROCESS:
            return True
    except Exception:
        pass
    try:
        return app_user_model_id_resolver(window).casefold() == _WHATSAPP_APP_USER_MODEL_ID.casefold()
    except Exception:
        return False


def _clipboard_paths() -> list[str]:
    if os.name != "nt":
        raise RuntimeError("L’allegato WhatsApp richiede Windows.")
    user32 = ctypes.WinDLL("user32", use_last_error=True)
    shell32 = ctypes.WinDLL("shell32", use_last_error=True)
    user32.OpenClipboard.argtypes = [ctypes.c_void_p]
    user32.OpenClipboard.restype = wintypes.BOOL
    user32.IsClipboardFormatAvailable.argtypes = [wintypes.UINT]
    user32.IsClipboardFormatAvailable.restype = wintypes.BOOL
    user32.GetClipboardData.argtypes = [wintypes.UINT]
    user32.GetClipboardData.restype = wintypes.HANDLE
    user32.CloseClipboard.restype = wintypes.BOOL
    shell32.DragQueryFileW.argtypes = [wintypes.HANDLE, wintypes.UINT, wintypes.LPWSTR, wintypes.UINT]
    shell32.DragQueryFileW.restype = wintypes.UINT
    if not user32.OpenClipboard(None):
        raise RuntimeError("Gli appunti sono occupati; allegato annullato.")
    try:
        if not user32.IsClipboardFormatAvailable(15):  # CF_HDROP
            return []
        handle = user32.GetClipboardData(15)
        if not handle:
            return []
        count = shell32.DragQueryFileW(handle, 0xFFFFFFFF, None, 0)
        paths = []
        for index in range(count):
            size = shell32.DragQueryFileW(handle, index, None, 0)
            buffer = ctypes.create_unicode_buffer(size + 1)
            shell32.DragQueryFileW(handle, index, buffer, size + 1)
            paths.append(buffer.value)
        return paths
    finally:
        user32.CloseClipboard()


def _clipboard_sequence_number() -> int:
    if os.name != "nt":
        raise RuntimeError("Lettura sequenza appunti disponibile solo su Windows.")
    user32 = ctypes.WinDLL("user32", use_last_error=True)
    user32.GetClipboardSequenceNumber.restype = wintypes.DWORD
    return int(user32.GetClipboardSequenceNumber())


def _set_clipboard_path(path: Path) -> None:
    """Set CF_HDROP to exactly one document path; Windows owns the allocated block."""
    from ctypes import wintypes

    class DROPFILES(ctypes.Structure):
        _fields_ = [("pFiles", wintypes.DWORD), ("x", wintypes.LONG), ("y", wintypes.LONG), ("fNC", wintypes.BOOL), ("fWide", wintypes.BOOL)]

    encoded = (str(path) + "\0\0").encode("utf-16-le")
    header = DROPFILES()
    header.pFiles = ctypes.sizeof(DROPFILES)
    header.fWide = True
    payload = bytes(header) + encoded
    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    user32 = ctypes.WinDLL("user32", use_last_error=True)
    kernel32.GlobalAlloc.restype = wintypes.HGLOBAL
    kernel32.GlobalLock.argtypes = [wintypes.HGLOBAL]
    kernel32.GlobalLock.restype = wintypes.LPVOID
    kernel32.GlobalUnlock.argtypes = [wintypes.HGLOBAL]
    kernel32.GlobalFree.argtypes = [wintypes.HGLOBAL]
    kernel32.GlobalFree.restype = wintypes.HGLOBAL
    user32.OpenClipboard.argtypes = [ctypes.c_void_p]
    user32.OpenClipboard.restype = wintypes.BOOL
    user32.EmptyClipboard.restype = wintypes.BOOL
    user32.CloseClipboard.restype = wintypes.BOOL
    user32.SetClipboardData.argtypes = [wintypes.UINT, wintypes.HANDLE]
    user32.SetClipboardData.restype = wintypes.HANDLE
    if not user32.OpenClipboard(None):
        raise RuntimeError("Gli appunti sono occupati; allegato annullato.")
    memory = None
    try:
        user32.EmptyClipboard()
        memory = kernel32.GlobalAlloc(0x0002, len(payload))  # GMEM_MOVEABLE
        if not memory:
            raise RuntimeError("Memoria appunti insufficiente.")
        address = kernel32.GlobalLock(memory)
        if not address:
            raise RuntimeError("Non riesco a preparare il percorso negli appunti.")
        ctypes.memmove(address, payload, len(payload))
        kernel32.GlobalUnlock(memory)
        if not user32.SetClipboardData(15, memory):
            raise RuntimeError("Non riesco a copiare il PDF negli appunti.")
        memory = None  # ownership transferred to Windows
    finally:
        if memory:
            kernel32.GlobalFree(memory)
        user32.CloseClipboard()


def _validate_document(path: Path, expected: dict[str, str]) -> dict[str, Any]:
    if not path.is_file() or path.stat().st_size <= 5:
        raise RuntimeError("Il PDF previsto è mancante o vuoto.")
    try:
        from pypdf import PdfReader
        reader = PdfReader(str(path), strict=True)
        if not reader.pages:
            raise ValueError("PDF senza pagine")
        text = "\n".join(page.extract_text() or "" for page in reader.pages)
        info = reader.metadata or {}
        keywords = str(info.get("/Keywords", ""))
        metadata = {}
        for token in re.split(r"[,;]", keywords):
            key, separator, value = token.strip().partition("=")
            if separator:
                metadata[key.strip()] = value.strip()
        for key, value in expected.items():
            if key.startswith("_"):
                continue
            if metadata.get(key) != str(value):
                raise ValueError(f"metadato {key} non corrispondente")
        if expected["kind"] == "supplier":
            reserved = re.compile(r"\b(?:total\w*|prezz\w*|scont\w*|import\w*|cost\w*|iva|installaz\w*|commercial\w*|euro|eur)\b|cliente:", re.I)
            currency_amount = re.compile(r"(?:€\s*\d[\d.,]*|\d[\d.,]*\s*(?:€|eur|euro))", re.I)
            if reserved.search(text) or currency_amount.search(text):
                raise ValueError("il PDF fornitore contiene dati commerciali o cliente")
            fields = reader.get_fields() or {}
            private_field = re.compile(r"cliente|client|note|prezz|cost|scont|import|totale|installaz|email|telefono|indirizzo|ragione|vat|fiscal", re.I)
            form_values = []
            for name, field in fields.items():
                value = field.get("/V") if hasattr(field, "get") else None
                if private_field.search(str(name)) and value not in (None, ""):
                    raise ValueError(f"campo riservato compilato nel PDF fornitore: {name}")
                if value not in (None, ""):
                    form_values.append(str(value))
            inspectable_text = " ".join((text, *form_values)).casefold()
            for term in expected.get("_forbidden_values", []):
                normalized = " ".join(str(term).casefold().split())
                if len(normalized) >= 4 and normalized in " ".join(inspectable_text.split()):
                    raise ValueError("Il PDF fornitore contiene un dato anagrafico del cliente.")
        digest = hashlib.sha256()
        with path.open("rb") as stream:
            for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                digest.update(chunk)
        return {"sha256": digest.hexdigest(), "size": path.stat().st_size, "pages": len(reader.pages)}
    except Exception as error:
        raise RuntimeError(f"Identità o contenuto del PDF non verificabile: {error}") from error


def _wait(predicate: Callable[[], Any], timeout: float, reason: str) -> Any:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        result = predicate()
        if result:
            return result
        time.sleep(min(0.1, max(0, deadline - time.monotonic())))
    raise RuntimeError(f"Timeout: {reason}.")


def create_pdf_receipt(path: str | Path, identity: dict[str, Any]) -> dict[str, Any]:
    pdf_path = Path(path).expanduser().resolve(strict=True)
    if pdf_path.suffix.casefold() != ".pdf":
        raise ValueError("Il documento selezionato non è un PDF.")
    kind = identity.get("kind")
    expected = {key: str(identity[key]) for key in ("quote_id", "revision", "kind")}
    if identity.get("recipient"):
        expected["recipient"] = str(identity["recipient"])
    if kind == "supplier":
        module_ids = identity.get("module_ids")
        if not isinstance(module_ids, list) or not module_ids or any(not isinstance(value, str) or not value for value in module_ids) or len(set(module_ids)) != len(module_ids):
            raise ValueError("Identità moduli del PDF fornitore non valida.")
        expected["module_ids"] = "|".join(module_ids)
        expected["_forbidden_values"] = identity.get("forbidden_values", [])
    details = _validate_document(pdf_path, expected)
    return {"path": str(pdf_path), "quote_id": identity["quote_id"], "revision": identity["revision"], "kind": kind, "recipient": str(identity.get("recipient", "")), "module_ids": list(identity.get("module_ids", [])), "forbidden_values": list(identity.get("forbidden_values", [])), "sha256": details["sha256"], "size": details["size"], "pages": details["pages"], "filename": pdf_path.name}


def _verified_receipt(path: Path, expected: dict[str, Any], receipt: dict[str, Any] | None) -> dict[str, Any]:
    if expected["kind"] == "supplier":
        expected["_forbidden_values"] = (receipt or {}).get("forbidden_values", [])
    details = _validate_document(path, expected)
    if not receipt or any(receipt.get(key) != expected.get(key) for key in ("quote_id", "revision", "kind", "recipient")):
        raise RuntimeError("La ricevuta del PDF non corrisponde al destinatario e alla revisione correnti.")
    if receipt.get("module_ids", []) != (expected.get("module_ids", "").split("|") if expected["kind"] == "supplier" else []):
        raise RuntimeError("La ricevuta del PDF non corrisponde ai moduli selezionati.")
    if receipt.get("sha256") != details["sha256"] or receipt.get("size") != details["size"] or receipt.get("pages") != details["pages"] or receipt.get("filename") != path.name:
        raise RuntimeError("Il PDF è cambiato dopo la creazione della ricevuta.")
    return details


def _shell_execute_protocol(uri: str) -> int:
    """Dispatch a registered URI protocol through Windows ShellExecute."""
    shell32 = ctypes.WinDLL("shell32", use_last_error=True)
    shell32.ShellExecuteW.argtypes = [
        wintypes.HWND,
        wintypes.LPCWSTR,
        wintypes.LPCWSTR,
        wintypes.LPCWSTR,
        wintypes.LPCWSTR,
        ctypes.c_int,
    ]
    shell32.ShellExecuteW.restype = ctypes.c_void_p
    result = shell32.ShellExecuteW(None, "open", uri, None, None, 1)
    return int(result or 0)


def detect_whatsapp_installation(*, platform_name: str | None = None) -> dict[str, Any]:
    """Rileva protocollo, pacchetto Store e installazione classica in Windows."""
    if (platform_name or os.name) != "nt":
        return {"protocol_registered": False, "store_installed": False, "classic_executable": None, "app_version": "non rilevabile"}
    try:
        import winreg
    except ImportError:
        # Simulazione usata dai test eseguiti su macOS.
        return {"protocol_registered": True, "store_installed": True, "classic_executable": None, "app_version": "non rilevabile"}

    protocol_registered = False
    try:
        with winreg.OpenKey(winreg.HKEY_CLASSES_ROOT, r"whatsapp\shell\open\command") as key:
            protocol_registered = bool(winreg.QueryValue(key, None))
    except OSError:
        pass

    package_family = "5319275A.WhatsAppDesktop_cv1g1gvanyjgm"
    store_package = Path(os.environ.get("LOCALAPPDATA", "")) / "Packages" / package_family
    store_installed = store_package.is_dir()
    app_version = "non rilevabile"
    manifest = store_package / "AppxManifest.xml"
    if store_installed and manifest.is_file():
        try:
            import xml.etree.ElementTree as ElementTree
            root = ElementTree.parse(manifest).getroot()
            identity = next((node for node in root.iter() if node.tag.rsplit("}", 1)[-1] == "Identity"), None)
            app_version = identity.attrib.get("Version", app_version) if identity is not None else app_version
        except (OSError, ValueError, ElementTree.ParseError):
            pass

    classic_executable = None
    for hive in (winreg.HKEY_CURRENT_USER, winreg.HKEY_LOCAL_MACHINE):
        try:
            with winreg.OpenKey(hive, r"Software\Microsoft\Windows\CurrentVersion\App Paths\WhatsApp.exe") as key:
                value, _ = winreg.QueryValueEx(key, None)
                if value and Path(value).is_file():
                    classic_executable = str(Path(value).resolve())
                    break
        except OSError:
            continue
    if classic_executable and app_version == "non rilevabile":
        for hive in (winreg.HKEY_CURRENT_USER, winreg.HKEY_LOCAL_MACHINE):
            try:
                with winreg.OpenKey(hive, r"Software\Microsoft\Windows\CurrentVersion\Uninstall\WhatsApp") as key:
                    app_version, _ = winreg.QueryValueEx(key, "DisplayVersion")
                    break
            except OSError:
                continue
    return {
        "protocol_registered": protocol_registered,
        "store_installed": store_installed,
        "classic_executable": classic_executable,
        "app_version": str(app_version),
    }


def open_whatsapp_chat(
    phone: str,
    text: str = "",
    *,
    platform_name: str | None = None,
    protocol_launcher: Callable[[str], Any] | None = None,
    store_activator: Callable[[], int] | None = None,
    shell_launcher: Callable[[str], int] | None = None,
    installation_detector: Callable[..., dict[str, Any]] | None = None,
) -> dict[str, Any]:
    if (platform_name or os.name) != "nt":
        raise RuntimeError("WhatsApp Desktop è disponibile solo su Windows.")
    uri = build_whatsapp_protocol_url(phone, text)
    started = time.monotonic()
    installation = (installation_detector or detect_whatsapp_installation)(platform_name=platform_name or os.name)
    logger = logging.getLogger("area_tenda_preventivi")
    app_version = installation.get("app_version", "non rilevabile")
    log_whatsapp_event(logger, "detect", "completed", app_version=app_version, duration_ms=round((time.monotonic() - started) * 1000))
    launcher = protocol_launcher or getattr(os, "startfile", _shell_execute_protocol)
    try:
        launch_started = time.monotonic()
        launcher(uri)
        log_whatsapp_event(logger, "protocol_startfile", "accepted", app_version=app_version, duration_ms=round((time.monotonic() - launch_started) * 1000))
        return {"ok": True, "desktopOpened": True, "protocolRegistered": bool(installation.get("protocol_registered"))}
    except Exception as startfile_error:
        log_whatsapp_event(logger, "protocol_startfile", "failed", error=startfile_error, app_version=app_version, duration_ms=round((time.monotonic() - started) * 1000))

    # L'attivazione Store è solo una seconda possibilità dopo il fallimento di os.startfile.
    if installation.get("store_installed"):
        try:
            activated = (store_activator or _activate_store_whatsapp)()
            log_whatsapp_event(logger, "launch_store_fallback", "accepted", app_version=app_version)
            if activated:
                result = (shell_launcher or _shell_execute_protocol)(uri)
                if result > 32:
                    log_whatsapp_event(logger, "protocol_store_fallback", "accepted", app_version=app_version)
                    return {"ok": True, "desktopOpened": True, "protocolRegistered": bool(installation.get("protocol_registered"))}
        except Exception as error:
            log_whatsapp_event(logger, "launch_store_fallback", "failed", error=error, app_version=app_version)
    elif installation.get("classic_executable"):
        try:
            os.startfile(installation["classic_executable"])
            log_whatsapp_event(logger, "launch_classic_fallback", "accepted", app_version=app_version)
        except Exception as error:
            log_whatsapp_event(logger, "launch_classic_fallback", "failed", error=error, app_version=app_version)
    else:
        log_whatsapp_event(logger, "launch_app_fallback", "skipped_not_installed", app_version=app_version)

    # ShellExecute resta un equivalente locale di os.startfile per registrazioni parziali.
    try:
        result = (shell_launcher or _shell_execute_protocol)(uri)
        if result > 32:
            log_whatsapp_event(logger, "protocol_shell_fallback", "accepted", app_version=app_version)
            return {"ok": True, "desktopOpened": True, "protocolRegistered": bool(installation.get("protocol_registered"))}
        raise RuntimeError(f"ShellExecute codice {result}")
    except Exception as error:
        log_whatsapp_event(logger, "protocol_shell_fallback", "failed", error=error, app_version=app_version, duration_ms=round((time.monotonic() - started) * 1000))
        raise RuntimeError("Windows non è riuscito ad aprire la chat con il protocollo WhatsApp.") from error


def copy_pdf_to_clipboard(path: str, kind: str, phone: str, quote_id: str, revision: str, module_ids: list[str] | None = None, receipt: dict[str, Any] | None = None, *, platform_name: str | None = None, clipboard_reader: Callable[[], list[str]] | None = None, clipboard_writer: Callable[[Path], None] | None = None, sequence_reader: Callable[[], int] | None = None) -> dict[str, Any]:
    """Validate and place exactly this PDF in CF_HDROP without touching WhatsApp UI."""
    if (platform_name or os.name) != "nt":
        raise RuntimeError("Gli appunti per WhatsApp sono disponibili solo su Windows.")
    if kind not in {"customer", "supplier"} or not phone.isdigit() or not 8 <= len(phone) <= 15 or not quote_id or len(revision) != 64:
        raise ValueError("Tipo, identità del preventivo o destinatario non verificabili.")
    pdf_path = Path(path).expanduser().resolve(strict=True)
    expected = {"quote_id": quote_id, "revision": revision, "kind": kind, "recipient": phone}
    if kind == "supplier":
        if not module_ids or len(set(module_ids)) != len(module_ids):
            raise ValueError("Moduli pertinenti del fornitore non verificabili.")
        expected["module_ids"] = "|".join(module_ids)
    _verified_receipt(pdf_path, expected, receipt)
    clipboard_reader = clipboard_reader or _clipboard_paths
    clipboard_writer = clipboard_writer or _set_clipboard_path
    sequence_reader = sequence_reader or _clipboard_sequence_number
    with _LOCK:
        sequence = sequence_reader()
        paths = clipboard_reader()
        if len(paths) != 1 or Path(paths[0]).resolve() != pdf_path:
            clipboard_writer(pdf_path)
            sequence = sequence_reader()
        paths = clipboard_reader()
        if len(paths) != 1 or Path(paths[0]).resolve() != pdf_path:
            raise RuntimeError("Gli appunti non contengono esattamente il PDF previsto.")
        verified_sequence = sequence_reader()
        if verified_sequence != sequence:
            paths = clipboard_reader()
            if len(paths) != 1 or Path(paths[0]).resolve() != pdf_path:
                clipboard_writer(pdf_path)
                sequence = sequence_reader()
                paths = clipboard_reader()
            else:
                sequence = verified_sequence
            if len(paths) != 1 or Path(paths[0]).resolve() != pdf_path:
                raise RuntimeError("Non riesco a ripristinare il PDF previsto negli appunti.")
    return {"clipboardReady": True, "path": str(pdf_path), "kind": kind}


def prepare_whatsapp_pdf(
    path: str,
    kind: str,
    phone: str,
    quote_id: str,
    revision: str,
    module_ids: list[str] | None = None,
    receipt: dict[str, Any] | None = None,
    *,
    timeout: float = 20,
    platform_name: str | None = None,
    desktop_factory: Callable[..., Any] | None = None,
    clipboard_reader: Callable[[], list[str]] | None = None,
    clipboard_writer: Callable[[Path], None] | None = None,
    sequence_reader: Callable[[], int] | None = None,
    process_name_resolver: Callable[[Any], str] | None = None,
    app_user_model_id_resolver: Callable[[Any], str] | None = None,
) -> dict[str, Any]:
    """Paste one verified PDF into the already-open, operator-verified recipient chat."""
    if (platform_name or os.name) != "nt":
        raise RuntimeError("La preparazione WhatsApp è disponibile solo su Windows.")
    if kind not in {"customer", "supplier"} or not quote_id or len(revision) != 64 or not phone.isdigit() or not 8 <= len(phone) <= 15:
        raise ValueError("Tipo, identità del preventivo o destinatario non verificabili.")
    pdf_path = Path(path).expanduser().resolve(strict=True)
    if pdf_path.suffix.casefold() != ".pdf":
        raise ValueError("Il documento selezionato non è un PDF.")
    expected = {"quote_id": quote_id, "revision": revision, "kind": kind, "recipient": phone}
    if kind == "supplier":
        if not module_ids or any(not isinstance(item_id, str) or not item_id for item_id in module_ids) or len(set(module_ids)) != len(module_ids):
            raise ValueError("Moduli pertinenti del fornitore non verificabili.")
        expected["module_ids"] = "|".join(module_ids)
    _verified_receipt(pdf_path, expected, receipt)
    clipboard_reader = clipboard_reader or _clipboard_paths
    clipboard_writer = clipboard_writer or _set_clipboard_path
    sequence_reader = sequence_reader or _clipboard_sequence_number
    if desktop_factory is None:
        try:
            from pywinauto import Desktop
        except ImportError as error:
            raise RuntimeError("Automazione UI Windows non disponibile in questa installazione.") from error
        desktop_factory = Desktop
    process_name_resolver = process_name_resolver or (
        lambda window: _windows_process_name(window.element_info.process)
    )
    app_user_model_id_resolver = app_user_model_id_resolver or _windows_app_user_model_id

    with _LOCK:
        # Preserve the known-working CF_HDROP when it already names this exact file.
        sequence = sequence_reader()
        paths = clipboard_reader()
        if len(paths) != 1 or Path(paths[0]).resolve() != pdf_path:
            clipboard_writer(pdf_path)
            sequence = sequence_reader()
        paths = clipboard_reader()
        if len(paths) != 1 or Path(paths[0]).resolve() != pdf_path:
            raise RuntimeError("Gli appunti non contengono esattamente il PDF previsto.")

        try:
            desktop = desktop_factory(backend="uia")
            def unique_whatsapp_window() -> Any | None:
                matches = [
                    window for window in desktop.windows()
                    if window.is_visible()
                    and _is_whatsapp_window(window, process_name_resolver, app_user_model_id_resolver)
                ]
                if len(matches) > 1:
                    raise RuntimeError("Sono aperte più finestre WhatsApp; allegato annullato.")
                return matches[0] if matches else None
            window = _wait(unique_whatsapp_window, timeout, "apertura WhatsApp")
            window.set_focus()
            _wait(lambda: window.is_active(), timeout, "focus della finestra WhatsApp")
            composer = _wait(lambda: next((c for c in window.descendants() if c.is_visible() and str(c.window_text()).strip().casefold() in _COMPOSER_NAMES and str(getattr(c.element_info, "control_type", "")).casefold() in {"edit", "document"}), None), timeout, "campo di composizione")
            composer.set_focus()
            if not composer.has_keyboard_focus():
                raise RuntimeError("Il campo di composizione WhatsApp non ha il focus.")
            # Recheck immediately before paste to prevent clipboard races.
            current_sequence = sequence_reader()
            paths = clipboard_reader()
            if current_sequence != sequence or len(paths) != 1 or Path(paths[0]).resolve() != pdf_path:
                clipboard_writer(pdf_path)
                sequence = sequence_reader()
            verified_paths = clipboard_reader()
            if len(verified_paths) != 1 or Path(verified_paths[0]).resolve() != pdf_path:
                raise RuntimeError("Gli appunti sono cambiati; allegato annullato.")
            if sequence_reader() != sequence:
                raise RuntimeError("Gli appunti sono cambiati subito prima dell’incollaggio.")
            baseline = {}
            for control in window.descendants():
                try:
                    token = tuple(control.element_info.runtime_id)
                except Exception:
                    token = id(control.element_info)
                baseline[token] = str(control.window_text()).casefold()
            composer.type_keys("^v", set_foreground=False)
            def new_filename_preview() -> bool:
                for control in window.descendants():
                    control_text = str(control.window_text()).casefold()
                    exact_filename = re.search(rf"(?<![\w.-]){re.escape(pdf_path.name.casefold())}(?![\w.-])", control_text)
                    if not control.is_visible() or not exact_filename:
                        continue
                    try:
                        token = tuple(control.element_info.runtime_id)
                    except Exception:
                        token = id(control.element_info)
                    if baseline.get(token) != str(control.window_text()).casefold():
                        return True
                return False
            _wait(new_filename_preview, timeout, "nuova anteprima con il nome file esatto")
            return {"attached": True, "filename": pdf_path.name, "path": str(pdf_path), "kind": kind}
        except Exception as error:
            try:
                clipboard_writer(pdf_path)
                final_paths = clipboard_reader()
                if len(final_paths) == 1 and Path(final_paths[0]).resolve() == pdf_path:
                    return {"attached": False, "clipboardReady": True, "path": str(pdf_path), "kind": kind, "error": str(error)}
            except Exception:
                pass
            raise RuntimeError(f"Allegato non verificabile e PDF non ripristinato negli appunti: {error}") from error
