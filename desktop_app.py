"""Cross-platform pywebview host and narrow local filesystem API."""

from __future__ import annotations

import json
import logging
import os
import sys
import threading
import time
from datetime import date
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from logging.handlers import RotatingFileHandler
from pathlib import Path
from typing import Any

from local_store import LocalStore


ROOT = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parent))
APP_TITLE = "Gestionale preventivi"
APP_LOGGER = logging.getLogger("area_tenda_preventivi")


def _show_pdf_in_explorer(pdf_path: Path) -> None:
    """Use the Windows Shell PIDL API so paths with spaces need no command parsing."""
    import ctypes
    from ctypes import wintypes

    shell32 = ctypes.WinDLL("shell32", use_last_error=True)
    ole32 = ctypes.WinDLL("ole32", use_last_error=True)
    co_initialize = ole32.CoInitialize
    co_initialize.argtypes = [ctypes.c_void_p]
    co_initialize.restype = ctypes.c_long
    co_uninitialize = ole32.CoUninitialize
    co_uninitialize.argtypes = []
    co_uninitialize.restype = None
    parse_display_name = shell32.SHParseDisplayName
    parse_display_name.argtypes = [
        wintypes.LPCWSTR,
        ctypes.c_void_p,
        ctypes.POINTER(ctypes.c_void_p),
        wintypes.DWORD,
        ctypes.POINTER(wintypes.DWORD),
    ]
    parse_display_name.restype = ctypes.c_long
    open_folder_and_select = shell32.SHOpenFolderAndSelectItems
    open_folder_and_select.argtypes = [ctypes.c_void_p, wintypes.UINT, ctypes.c_void_p, wintypes.DWORD]
    open_folder_and_select.restype = ctypes.c_long
    free_pidl = ole32.CoTaskMemFree
    free_pidl.argtypes = [ctypes.c_void_p]
    free_pidl.restype = None

    com_result = co_initialize(None)
    if com_result < 0 and com_result != -2147417850:  # RPC_E_CHANGED_MODE means COM is already initialized.
        raise OSError(com_result, "Unable to initialize Windows Shell COM support")
    initialized_here = com_result >= 0
    pidl = ctypes.c_void_p()
    try:
        result = parse_display_name(str(pdf_path), None, ctypes.byref(pidl), 0, None)
        if result < 0:
            raise OSError(result, "Unable to resolve the PDF in Windows Shell")
        result = open_folder_and_select(pidl, 0, None, 0)
        if result < 0:
            raise OSError(result, "Unable to open Explorer with the PDF selected")
    finally:
        if pidl:
            free_pidl(pidl)
        if initialized_here:
            co_uninitialize()


def configure_app_logging(log_dir: Path | None = None) -> tuple[logging.Logger, Path]:
    global APP_LOGGER
    directory = log_dir or (LocalStore.default_settings_dir() / "logs")
    directory.mkdir(parents=True, exist_ok=True)
    log_path = directory / "app.log"
    logger = logging.getLogger("area_tenda_preventivi")
    logger.setLevel(logging.INFO)
    logger.propagate = False
    if not any(
        isinstance(handler, RotatingFileHandler) and Path(handler.baseFilename) == log_path.resolve()
        for handler in logger.handlers
    ):
        handler = RotatingFileHandler(log_path, maxBytes=2 * 1024 * 1024, backupCount=3, encoding="utf-8")
        handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(threadName)s %(message)s"))
        logger.addHandler(handler)
    APP_LOGGER = logger
    return logger, log_path


def install_exception_logging(logger: logging.Logger) -> None:
    def log_uncaught(exc_type: type[BaseException], error: BaseException, traceback: Any) -> None:
        logger.critical("unhandled exception", exc_info=(exc_type, error, traceback))

    sys.excepthook = log_uncaught

    def log_thread_exception(args: threading.ExceptHookArgs) -> None:
        logger.critical(
            "unhandled thread exception in %s",
            args.thread.name if args.thread else "unknown",
            exc_info=(args.exc_type, args.exc_value, args.exc_traceback),
        )

    threading.excepthook = log_thread_exception


class DesktopRequestHandler(SimpleHTTPRequestHandler):
    def log_message(self, format: str, *args: Any) -> None:
        APP_LOGGER.info("local http: %s", format % args)


class CloseCoordinator:
    SCRIPT = "window.flushDesktopBeforeClose ? window.flushDesktopBeforeClose() : true"

    def __init__(self, window: Any, logger: logging.Logger | None = None, timeout_seconds: float = 15):
        self._window = window
        self._logger = logger or APP_LOGGER
        self._timeout_seconds = timeout_seconds
        self._lock = threading.Lock()
        self._attempt = 0
        self._pending = False
        self._allowed = False
        self._timer: threading.Timer | None = None

    @property
    def pending(self) -> bool:
        with self._lock:
            return self._pending

    @property
    def allowed(self) -> bool:
        with self._lock:
            return self._allowed

    def on_closing(self) -> bool:
        with self._lock:
            if self._allowed:
                return True
        self._start_attempt()
        return False

    def request_close(self) -> dict[str, bool]:
        self._start_attempt()
        return {"started": True}

    def _start_attempt(self) -> None:
        with self._lock:
            if self._allowed or self._pending:
                return
            self._pending = True
            self._attempt += 1
            attempt = self._attempt
            timer = threading.Timer(self._timeout_seconds, self._expire, args=(attempt,))
            timer.daemon = True
            self._timer = timer

        self._logger.info("close flush started")
        timer.start()
        worker = threading.Thread(
            target=self._evaluate_flush,
            args=(attempt,),
            name="close-flush",
            daemon=True,
        )
        worker.start()

    def _evaluate_flush(self, attempt: int) -> None:
        try:
            self._window.evaluate_js(self.SCRIPT, callback=lambda saved: self._finish(attempt, bool(saved)))
        except Exception:
            self._logger.exception("close flush evaluation failed")
            self._finish(attempt, False)

    def _finish(self, attempt: int, saved: bool) -> None:
        with self._lock:
            if attempt != self._attempt or not self._pending:
                return
            self._pending = False
            timer = self._timer
            self._timer = None
            if saved:
                self._allowed = True
        if timer:
            timer.cancel()
        if saved:
            self._logger.info("close flush succeeded")
            try:
                self._window.destroy()
            except Exception:
                self._logger.exception("window destroy after save failed")
        else:
            self._logger.warning("close flush failed; window remains open")

    def _expire(self, attempt: int) -> None:
        with self._lock:
            if attempt != self._attempt or not self._pending:
                return
            self._pending = False
            self._timer = None
        self._logger.error("close flush timed out; window remains open")


def initialize_desktop_api(settings_dir: Path | None = None) -> "DesktopApi":
    try:
        store = LocalStore(settings_dir)
        return DesktopApi(store=store)
    except Exception as error:
        APP_LOGGER.exception("local settings initialization failed")
        raise RuntimeError(f"Configurazione locale non leggibile: {error}") from error


class DesktopApi:
    EXPOSED_METHODS = frozenset({
        "load_initial_data",
        "save_state",
        "choose_database_folder",
        "set_database_folder",
        "choose_output_folder",
        "write_pdf",
        "save_pdf_copy",
        "export_backup",
        "import_backup",
        "request_close",
        "reveal_pdf_in_explorer",
        "open_whatsapp_chat",
        "copy_whatsapp_pdf_clipboard",
        "prepare_whatsapp_pdf",
        "log_event",
    })
    _ALLOWED_FRONTEND_EVENTS = frozenset({
        "bridge_ready", "state_save_started", "state_save_succeeded", "state_save_failed",
        "pdf_generation_started", "pdf_module_started", "pdf_customer_assembly",
        "pdf_supplier_merge", "pdf_disk_save_started", "pdf_generation_failed",
    })

    def __init__(
        self,
        store: LocalStore | None = None,
        window: Any = None,
    ):
        self._store = store if store is not None else LocalStore()
        self._window = window
        self._close_coordinator: CloseCoordinator | None = None

    def __dir__(self) -> list[str]:
        return sorted(self.EXPOSED_METHODS)

    def _bind_window(self, window: Any) -> None:
        self._window = window

    def _bind_close_coordinator(self, coordinator: CloseCoordinator) -> None:
        self._close_coordinator = coordinator

    def request_close(self) -> dict[str, bool]:
        if self._close_coordinator is None:
            raise RuntimeError("La chiusura sicura non è disponibile.")
        return self._close_coordinator.request_close()

    def log_event(self, event: str) -> dict[str, bool]:
        if not isinstance(event, str) or event not in self._ALLOWED_FRONTEND_EVENTS:
            raise ValueError("Codice evento non riconosciuto.")
        APP_LOGGER.info("frontend event: %s", event)
        return {"ok": True}

    def reveal_pdf_in_explorer(
        self,
        kind: str,
        path: str,
        *,
        platform_name: str | None = None,
    ) -> dict[str, bool]:
        if (platform_name or os.name) != "nt":
            raise RuntimeError("La condivisione tramite Esplora file è disponibile solo su Windows.")
        path_key = {"customer": "customer_pdf_dir", "supplier": "supplier_pdf_dir"}.get(kind)
        if path_key is None:
            raise ValueError("Tipo di PDF non riconosciuto.")
        configured_folder = self._store.settings.get(path_key)
        if not configured_folder:
            raise ValueError("Scegli prima la cartella di destinazione PDF.")
        folder = Path(configured_folder).expanduser().resolve()
        try:
            pdf_path = Path(path).expanduser().resolve(strict=True)
        except (OSError, TypeError, ValueError) as error:
            raise FileNotFoundError("Il PDF da condividere non esiste o non è accessibile.") from error
        if not pdf_path.is_file() or pdf_path.suffix.lower() != ".pdf":
            raise ValueError("Il file da condividere non è un PDF valido.")
        if pdf_path.parent != folder:
            raise ValueError("Il PDF deve trovarsi nella cartella configurata per questo tipo di documento.")
        try:
            with pdf_path.open("rb") as stream:
                is_pdf = stream.read(5) == b"%PDF-"
        except OSError as error:
            raise FileNotFoundError("Il PDF da condividere non è accessibile.") from error
        if not is_pdf:
            raise ValueError("Il file da condividere non è un PDF valido.")
        try:
            _show_pdf_in_explorer(pdf_path)
        except OSError as error:
            raise RuntimeError("Non riesco ad aprire Esplora file. Il PDF resta salvato nella cartella configurata.") from error
        APP_LOGGER.info("Explorer opened on prepared PDF (%s)", kind)
        return {"ok": True}

    def open_whatsapp_chat(self, phone: str, *, platform_name: str | None = None) -> dict[str, bool]:
        from whatsapp_windows import open_whatsapp_chat
        return open_whatsapp_chat(phone, platform_name=platform_name)

    def copy_whatsapp_pdf_clipboard(self, kind: str, path: str, phone: str, quote_id: str, revision: str, module_ids: list[str] | None = None, receipt: dict[str, Any] | None = None, *, platform_name: str | None = None) -> dict[str, Any]:
        from whatsapp_windows import copy_pdf_to_clipboard
        return self._prepare_whatsapp_clipboard(copy_pdf_to_clipboard, kind, path, phone, quote_id, revision, module_ids, receipt, platform_name)

    def prepare_whatsapp_pdf(self, kind: str, path: str, phone: str, quote_id: str, revision: str, module_ids: list[str] | None = None, receipt: dict[str, Any] | None = None, *, platform_name: str | None = None) -> dict[str, Any]:
        from whatsapp_windows import prepare_whatsapp_pdf
        return self._prepare_whatsapp_clipboard(prepare_whatsapp_pdf, kind, path, phone, quote_id, revision, module_ids, receipt, platform_name)

    def _prepare_whatsapp_clipboard(self, operation: Any, kind: str, path: str, phone: str, quote_id: str, revision: str, module_ids: list[str] | None, receipt: dict[str, Any] | None, platform_name: str | None) -> dict[str, Any]:
        path_key = {"customer": "customer_pdf_dir", "supplier": "supplier_pdf_dir"}.get(kind)
        if path_key is None:
            raise ValueError("Tipo PDF non riconosciuto.")
        configured_folder = self._store.settings.get(path_key)
        if not configured_folder:
            raise ValueError("Cartella PDF non configurata.")
        pdf_path = Path(path).expanduser().resolve(strict=True)
        if pdf_path.parent != Path(configured_folder).expanduser().resolve():
            raise ValueError("Il PDF non appartiene alla cartella configurata per questa tipologia.")
        if pdf_path.suffix.casefold() != ".pdf":
            raise ValueError("Il documento selezionato non è un PDF.")
        prefix = "cliente" if kind == "customer" else "fornitore"
        expected_stem = f"preventivo_{quote_id}_{revision[:12]}_{prefix}"
        if pdf_path.stem != expected_stem and not (pdf_path.stem.startswith(expected_stem + "_") and pdf_path.stem[len(expected_stem) + 1:].isdigit()):
            raise ValueError("Il nome del documento non corrisponde a preventivo, revisione e tipologia correnti.")
        if not receipt or receipt.get("path") != str(pdf_path):
            raise ValueError("Ricevuta PDF mancante o associata a un percorso diverso.")
        return operation(str(pdf_path), kind, phone, quote_id, revision, module_ids, receipt, platform_name=platform_name)

    def load_initial_data(self) -> dict[str, Any]:
        started = time.perf_counter()
        try:
            result = self._store.load()
            result["database_error"] = ""
            APP_LOGGER.info("database load succeeded in %.3fs", time.perf_counter() - started)
            return result
        except (FileNotFoundError, ValueError) as error:
            APP_LOGGER.exception("database load failed")
            database_path = self._store.database_path
            return {
                "state": self._store.empty_state(),
                "paths": self._store.paths,
                "database_path": str(database_path) if database_path else None,
                "database_error": str(error),
            }

    def save_state(self, state: dict[str, Any]) -> dict[str, bool]:
        started = time.perf_counter()
        APP_LOGGER.info("database save started")
        try:
            self._store.save(state)
        except Exception:
            APP_LOGGER.exception("database save failed")
            raise
        APP_LOGGER.info("database save succeeded in %.3fs", time.perf_counter() - started)
        return {"ok": True}

    def choose_database_folder(self) -> dict[str, Any]:
        selected = self._choose_folder(self._store.settings.get("database_dir", ""))
        if not selected:
            return {"cancelled": True}
        return self._store.inspect_database_folder(selected)

    def set_database_folder(
        self, path: str, mode: str, current_state: dict[str, Any] | None = None
    ) -> dict[str, Any]:
        if mode == "copy-current" and current_state is None:
            current_state = self._store.load()["state"]
        return self._store.set_database_folder(path, mode, current_state)

    def choose_output_folder(self, kind: str) -> dict[str, Any]:
        if kind not in ("customer", "supplier"):
            raise ValueError("Tipo di cartella PDF non riconosciuto.")
        path_key = "customer_pdf_dir" if kind == "customer" else "supplier_pdf_dir"
        selected = self._choose_folder(self._store.settings.get(path_key, ""))
        if not selected:
            return {"cancelled": True}
        paths = self._store.set_output_folder(kind, selected)
        return {"paths": paths, "path": paths[path_key]}

    def write_pdf(self, kind: str, filename: str, base64_data: str, identity: dict[str, Any] | None = None) -> dict[str, Any]:
        started = time.perf_counter()
        safe_kind = kind if kind in ("customer", "supplier") else "unknown"
        APP_LOGGER.info("PDF disk save started (%s)", safe_kind)
        if identity is not None and identity.get("kind") != kind:
            raise ValueError("Tipologia documento non corrispondente.")
        try:
            result = self._store.write_pdf(kind, filename, base64_data)
            if identity is not None:
                from whatsapp_windows import create_pdf_receipt
                try:
                    result["receipt"] = create_pdf_receipt(result["path"], identity)
                except Exception:
                    Path(result["path"]).unlink(missing_ok=True)
                    raise
        except Exception:
            APP_LOGGER.exception("PDF disk save failed (%s)", safe_kind)
            raise
        APP_LOGGER.info("PDF disk save succeeded (%s) in %.3fs", safe_kind, time.perf_counter() - started)
        return result

    def save_pdf_copy(self, kind: str, filename: str, base64_data: str) -> dict[str, Any]:
        if kind not in ("customer", "supplier"):
            raise ValueError("Tipo di PDF non riconosciuto.")
        selected = self._choose_save_file(filename, "PDF (*.pdf)")
        if not selected:
            return {"cancelled": True}
        destination = Path(selected).expanduser()
        if destination.suffix.lower() != ".pdf":
            destination = destination.with_suffix(".pdf")
        return self._store.write_pdf_copy(destination, base64_data)

    def export_backup(self, payload_json: str) -> dict[str, Any]:
        payload = json.loads(payload_json)
        self._validate_backup(payload)
        default_name = f"backup_preventivi_{date.today().isoformat()}.json"
        selected = self._choose_save_file(default_name, "JSON (*.json)")
        if not selected:
            return {"cancelled": True}
        path = Path(selected).expanduser().resolve()
        if path.suffix.lower() != ".json":
            path = path.with_suffix(".json")
        path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        return {"path": str(path)}

    def import_backup(self) -> dict[str, Any]:
        selected = self._choose_open_file("JSON (*.json)")
        if not selected:
            return {"cancelled": True}
        backup_path = Path(selected)
        try:
            if backup_path.stat().st_size > 50 * 1024 * 1024:
                raise ValueError("Il file di backup supera il limite di 50 MB.")
        except OSError as error:
            raise ValueError(f"Impossibile leggere il backup selezionato: {error}") from error
        try:
            payload = json.loads(backup_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as error:
            raise ValueError(f"Impossibile leggere il backup selezionato: {error}") from error
        self._validate_backup(payload)
        return {"payload": payload}

    @staticmethod
    def _validate_backup(payload: Any) -> None:
        data = payload.get("dati") if isinstance(payload, dict) else None
        if (
            not isinstance(payload, dict)
            or payload.get("formato") != "AREA_TENDA_GESTIONALE_BACKUP"
            or payload.get("versione") != 1
            or not isinstance(data, dict)
            or not isinstance(data.get("clients"), list)
            or not isinstance(data.get("quotes"), list)
            or not isinstance(data.get("prices"), dict)
            or not isinstance(data.get("company"), dict)
        ):
            raise ValueError("Il file selezionato non è un backup valido del gestionale.")

    def _choose_folder(self, current: str = "") -> str | None:
        result = self._dialog("FOLDER", directory=current or str(Path.home()))
        return self._first_selection(result)

    def _choose_save_file(self, filename: str, file_type: str) -> str | None:
        result = self._dialog("SAVE", save_filename=filename, file_types=(file_type,))
        return self._first_selection(result)

    def _choose_open_file(self, file_type: str) -> str | None:
        result = self._dialog("OPEN", file_types=(file_type,))
        return self._first_selection(result)

    @staticmethod
    def _first_selection(selection: Any) -> str | None:
        if not selection:
            return None
        if isinstance(selection, (str, Path)):
            return str(selection)
        return str(selection[0]) if selection[0] else None

    def _dialog(self, kind: str, **kwargs: Any) -> Any:
        if self._window is None:
            raise RuntimeError("La finestra desktop non è ancora pronta.")
        try:
            import webview
        except ImportError:
            webview = None
        dialog_type = self._dialog_type(kind, webview)
        return self._window.create_file_dialog(dialog_type, **kwargs)

    @staticmethod
    def _dialog_type(kind: str, webview: Any) -> Any:
        if webview is not None:
            enum = getattr(webview, "FileDialog", None)
            if enum is not None and hasattr(enum, kind):
                return getattr(enum, kind)
            legacy = {"FOLDER": "FOLDER_DIALOG", "OPEN": "OPEN_DIALOG", "SAVE": "SAVE_DIALOG"}
            if hasattr(webview, legacy[kind]):
                return getattr(webview, legacy[kind])
        return kind.lower()


def main() -> None:
    logger, log_path = configure_app_logging()
    install_exception_logging(logger)
    logger.info("application startup")
    try:
        import webview
    except ImportError as error:
        logger.exception("pywebview import failed")
        raise SystemExit(
            "Manca pywebview. Segui README_WINDOWS_MAC.md per installare le dipendenze e avviare il gestionale."
        ) from error

    try:
        api = initialize_desktop_api()
    except Exception as error:
        logger.exception("application settings failed; log file: %s", log_path)
        raise SystemExit(str(error)) from error

    # Serve the bundled source files from loopback. The original module catalog
    # and its images use fetch(), which browsers block when opened from file://.
    handler = partial(DesktopRequestHandler, directory=str(ROOT))
    server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    server_thread = threading.Thread(target=server.serve_forever, daemon=True)
    server_thread.start()
    url = f"http://127.0.0.1:{server.server_address[1]}/Gestione_preventivi.html?desktop=1"
    logger.info("local server ready")
    try:
        window = webview.create_window(
            APP_TITLE,
            url=url,
            js_api=api,
            width=1440,
            height=920,
            min_size=(900, 640),
        )
        api._bind_window(window)
        logger.info("desktop window created")
        close_coordinator = CloseCoordinator(window, logger)
        api._bind_close_coordinator(close_coordinator)
        window.events.closing += close_coordinator.on_closing
        gui = "edgechromium" if os.name == "nt" else None
        webview.start(gui=gui, debug=False)
    except Exception as error:
        logger.exception("desktop window startup failed")
        raise SystemExit(
            "Non riesco ad avviare la finestra desktop. Verifica che WebView2 sia installato su Windows "
            "o che il backend WebKit sia disponibile su macOS. "
            f"Dettaglio: {error}"
        ) from error
    finally:
        logger.info("desktop window closed; stopping local server")
        server.shutdown()
        server.server_close()
        server_thread.join(timeout=2)


if __name__ == "__main__":
    main()
