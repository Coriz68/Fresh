"""Cross-platform pywebview host and narrow local filesystem API."""

from __future__ import annotations

import json
import logging
import os
import re
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


def normalize_whatsapp_phone(phone: str) -> str:
    value = str(phone or "").strip()
    italian_prefix_with_trunk = bool(re.match(r"^(?:\+|00)39\s*\(0\)", value))
    value = re.sub(r"\(\s*0\s*\)", "0" if italian_prefix_with_trunk else "", value)
    value = re.sub(r"[\s().-]", "", value)
    if value.startswith("00"):
        value = f"+{value[2:]}"
    elif not value.startswith("+"):
        value = f"+39{value}"
    if not re.fullmatch(r"\+[1-9]\d{7,14}", value):
        raise ValueError("Inserisci un numero WhatsApp formalmente valido (8–15 cifre).")
    return value[1:]


def launch_whatsapp_uri(uri: str, *, platform_name: str | None = None) -> None:
    if (platform_name or os.name) != "nt":
        raise RuntimeError("L’apertura di WhatsApp Desktop è disponibile solo su Windows.")
    startfile = getattr(os, "startfile", None)
    if not callable(startfile):
        raise RuntimeError("Windows non ha un gestore registrato per WhatsApp Desktop.")
    try:
        startfile(uri)
    except OSError as error:
        raise RuntimeError("Non riesco ad aprire WhatsApp Desktop. Verifica che sia installato.") from error


def _attach_pdf_in_whatsapp(path: Path) -> None:
    # Keep Windows-only UI Automation out of startup and non-Windows imports.
    from whatsapp_windows import attach_pdf_to_open_chat

    attach_pdf_to_open_chat(path)


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
        "open_whatsapp",
        "attach_whatsapp_pdf",
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
        whatsapp_attacher: Any = None,
    ):
        self._store = store if store is not None else LocalStore()
        self._window = window
        self._close_coordinator: CloseCoordinator | None = None
        self._whatsapp_attacher = whatsapp_attacher or _attach_pdf_in_whatsapp

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

    def open_whatsapp(self, phone: str) -> dict[str, bool]:
        digits = normalize_whatsapp_phone(phone)
        launch_whatsapp_uri(f"whatsapp://send?phone={digits}")
        APP_LOGGER.info("WhatsApp Desktop protocol opened")
        return {"ok": True}

    def attach_whatsapp_pdf(
        self,
        kind: str,
        path: str,
        recipient_confirmed: bool,
    ) -> dict[str, bool]:
        if not recipient_confirmed:
            raise ValueError("Conferma prima che la chat WhatsApp mostri il destinatario corretto.")
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
            raise FileNotFoundError("Il PDF da allegare non esiste o non è accessibile.") from error
        if not pdf_path.is_file() or pdf_path.suffix.lower() != ".pdf":
            raise ValueError("Il file da allegare non è un PDF valido.")
        try:
            pdf_path.relative_to(folder)
        except ValueError as error:
            raise ValueError("Il PDF deve trovarsi nella cartella configurata per questo tipo di documento.") from error
        try:
            with pdf_path.open("rb") as stream:
                is_pdf = stream.read(5) == b"%PDF-"
        except OSError as error:
            raise FileNotFoundError("Il PDF da allegare non è accessibile.") from error
        if not is_pdf:
            raise ValueError("Il file da allegare non è un PDF valido.")
        self._whatsapp_attacher(pdf_path)
        APP_LOGGER.info("WhatsApp PDF attachment prepared (%s)", kind)
        return {"ok": True}

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

    def write_pdf(self, kind: str, filename: str, base64_data: str) -> dict[str, str]:
        started = time.perf_counter()
        safe_kind = kind if kind in ("customer", "supplier") else "unknown"
        APP_LOGGER.info("PDF disk save started (%s)", safe_kind)
        try:
            result = self._store.write_pdf(kind, filename, base64_data)
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
