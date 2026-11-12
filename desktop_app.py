"""Cross-platform pywebview host and narrow local filesystem API."""

from __future__ import annotations

import json
import os
from datetime import date
from pathlib import Path
from typing import Any

from local_store import LocalStore


ROOT = Path(__file__).resolve().parent
APP_TITLE = "Gestionale preventivi"


class DesktopApi:
    def __init__(self, store: LocalStore | None = None, window: Any = None):
        self.store = store or LocalStore()
        self.window = window

    def bind_window(self, window: Any) -> None:
        self.window = window

    def load_initial_data(self) -> dict[str, Any]:
        try:
            result = self.store.load()
            result["database_error"] = ""
            return result
        except (FileNotFoundError, ValueError) as error:
            database_path = self.store.database_path
            return {
                "state": self.store.empty_state(),
                "paths": self.store.paths,
                "database_path": str(database_path) if database_path else None,
                "database_error": str(error),
            }

    def save_state(self, state: dict[str, Any]) -> dict[str, bool]:
        self.store.save(state)
        return {"ok": True}

    def choose_database_folder(self) -> dict[str, Any]:
        selected = self._choose_folder(self.store.settings.get("database_dir", ""))
        if not selected:
            return {"cancelled": True}
        return self.store.inspect_database_folder(selected)

    def set_database_folder(
        self, path: str, mode: str, current_state: dict[str, Any] | None = None
    ) -> dict[str, Any]:
        if mode == "copy-current" and current_state is None:
            current_state = self.store.load()["state"]
        return self.store.set_database_folder(path, mode, current_state)

    def choose_output_folder(self, kind: str) -> dict[str, Any]:
        if kind not in ("customer", "supplier"):
            raise ValueError("Tipo di cartella PDF non riconosciuto.")
        path_key = "customer_pdf_dir" if kind == "customer" else "supplier_pdf_dir"
        selected = self._choose_folder(self.store.settings.get(path_key, ""))
        if not selected:
            return {"cancelled": True}
        paths = self.store.set_output_folder(kind, selected)
        return {"paths": paths, "path": paths[path_key]}

    def write_pdf(self, kind: str, filename: str, base64_data: str) -> dict[str, str]:
        return self.store.write_pdf(kind, filename, base64_data)

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
        if self.window is None:
            raise RuntimeError("La finestra desktop non è ancora pronta.")
        try:
            import webview
        except ImportError:
            webview = None
        dialog_type = self._dialog_type(kind, webview)
        return self.window.create_file_dialog(dialog_type, **kwargs)

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
    try:
        import webview
    except ImportError as error:
        raise SystemExit(
            "Manca pywebview. Segui README_WINDOWS_MAC.md per installare le dipendenze e avviare il gestionale."
        ) from error

    api = DesktopApi()
    window = webview.create_window(
        APP_TITLE,
        url="Gestione_preventivi.html",
        js_api=api,
        width=1440,
        height=920,
        min_size=(900, 640),
    )
    api.bind_window(window)
    gui = "edgechromium" if os.name == "nt" else None
    try:
        webview.start(gui=gui, debug=False)
    except Exception as error:
        raise SystemExit(
            "Non riesco ad avviare la finestra desktop. Verifica che WebView2 sia installato su Windows "
            "o che il backend WebKit sia disponibile su macOS. "
            f"Dettaglio: {error}"
        ) from error


if __name__ == "__main__":
    main()
