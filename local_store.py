"""Local JSON state and PDF storage for the desktop quote manager."""

from __future__ import annotations

import base64
import binascii
import json
import os
import re
import shutil
import tempfile
from pathlib import Path
from typing import Any


DATABASE_FILENAME = "preventivi.json"
PATH_KEYS = ("database_dir", "customer_pdf_dir", "supplier_pdf_dir")


class LocalStore:
    def __init__(self, settings_dir: str | Path | None = None):
        self.settings_dir = Path(settings_dir) if settings_dir else self.default_settings_dir()
        self.settings_path = self.settings_dir / "settings.json"
        self.settings = self._read_settings()

    @staticmethod
    def empty_state() -> dict[str, Any]:
        return {
            "clients": [],
            "quotes": [],
            "prices": {},
            "company": {
                "name": "",
                "address": "",
                "postalCode": "",
                "city": "",
                "province": "",
                "vatNumber": "",
                "taxCode": "",
                "phone": "",
                "email": "",
                "website": "",
                "footerNotes": "",
                "logo": "",
            },
        }

    @staticmethod
    def default_settings_dir() -> Path:
        if os.name == "nt":
            root = os.environ.get("LOCALAPPDATA") or Path.home() / "AppData" / "Local"
        elif os.name == "posix" and __import__("sys").platform == "darwin":
            root = Path.home() / "Library" / "Application Support"
        else:
            root = os.environ.get("XDG_CONFIG_HOME") or Path.home() / ".config"
        return Path(root) / "AreaTendaPreventivi"

    @property
    def paths(self) -> dict[str, str]:
        return {key: self.settings.get(key, "") for key in PATH_KEYS}

    @property
    def database_path(self) -> Path | None:
        folder = self.settings.get("database_dir")
        return Path(folder) / DATABASE_FILENAME if folder else None

    def load(self) -> dict[str, Any]:
        self.settings = self._read_settings()
        database_path = self.database_path
        if database_path is None:
            state = self.empty_state()
        elif not database_path.is_file():
            raise FileNotFoundError(f"Database non trovato: {database_path}")
        else:
            state = self._read_database(database_path)
            state, migrated = self._migrate_quote_send_fields(state)
            if migrated:
                self._create_pre_migration_backup(database_path)
                self._atomic_write_json(database_path, state)
        return {
            "state": state,
            "paths": self.paths,
            "database_path": str(database_path) if database_path else None,
        }

    def save(self, state: dict[str, Any]) -> None:
        self._validate_state(state)
        database_path = self.database_path
        if database_path is None:
            raise ValueError("Scegli prima la cartella del database.")
        if not database_path.parent.is_dir():
            raise FileNotFoundError(f"La cartella database non esiste: {database_path.parent}")
        self._atomic_write_json(database_path, state)

    def set_database_folder(
        self,
        folder: str | Path,
        mode: str,
        current_state: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        destination = self._existing_directory(folder, "database")
        database_path = destination / DATABASE_FILENAME
        if database_path.exists():
            if mode != "open":
                raise ValueError("Il database esiste già: aprilo per conservarne i dati.")
            state = self._read_database(database_path)
        else:
            if mode == "copy-current":
                if current_state is None:
                    raise ValueError("Non ci sono dati correnti da copiare.")
                self._validate_state(current_state)
                state = current_state
            elif mode == "empty":
                state = self.empty_state()
            else:
                raise ValueError("La cartella database è vuota: scegli se copiare i dati o iniziare da zero.")
            self._atomic_write_json(database_path, state)

        previous_settings = dict(self.settings)
        self.settings["database_dir"] = str(destination)
        try:
            self._save_settings()
        except Exception:
            self.settings = previous_settings
            raise
        return {"state": state, "paths": self.paths, "database_path": str(database_path)}

    @classmethod
    def inspect_database_folder(cls, folder: str | Path) -> dict[str, Any]:
        destination = cls._existing_directory(folder, "database")
        database_path = destination / DATABASE_FILENAME
        if not database_path.exists():
            return {"path": str(destination), "status": "empty"}
        try:
            cls._read_database(database_path)
        except (OSError, ValueError) as error:
            return {"path": str(destination), "status": "invalid", "error": str(error)}
        return {"path": str(destination), "status": "existing"}

    def set_output_folder(self, kind: str, folder: str | Path) -> dict[str, str]:
        key = {"customer": "customer_pdf_dir", "supplier": "supplier_pdf_dir"}.get(kind)
        if key is None:
            raise ValueError("Tipo di cartella PDF non riconosciuto.")
        destination = self._existing_directory(folder, kind)
        other_key = "supplier_pdf_dir" if key == "customer_pdf_dir" else "customer_pdf_dir"
        other_folder = self.settings.get(other_key)
        if other_folder and Path(other_folder).resolve() == destination:
            raise ValueError("Le cartelle PDF cliente e fornitore devono essere diverse.")
        previous_settings = dict(self.settings)
        self.settings[key] = str(destination)
        try:
            self._save_settings()
        except Exception:
            self.settings = previous_settings
            raise
        return self.paths

    def write_pdf(self, kind: str, filename: str, base64_data: str) -> dict[str, str]:
        key = {"customer": "customer_pdf_dir", "supplier": "supplier_pdf_dir"}.get(kind)
        if key is None:
            raise ValueError("Tipo di PDF non riconosciuto.")
        folder_value = self.settings.get(key)
        if not folder_value:
            raise ValueError("Scegli prima la cartella di destinazione PDF.")
        folder = Path(folder_value).resolve()
        if not folder.is_dir():
            raise FileNotFoundError(f"La cartella PDF non esiste: {folder}")
        safe_name = self._safe_pdf_name(filename)
        return self._write_pdf_file(folder, safe_name, self._decode_pdf(base64_data))

    def write_pdf_copy(self, destination: str | Path, base64_data: str) -> dict[str, str]:
        """Save a user-requested PDF copy to an explicit path without overwriting files."""
        destination = Path(destination).expanduser().resolve()
        folder = destination.parent
        if not folder.is_dir():
            raise FileNotFoundError(f"La cartella di destinazione non esiste: {folder}")
        if not os.access(folder, os.W_OK):
            raise PermissionError(f"La cartella di destinazione non è scrivibile: {folder}")
        safe_name = self._safe_pdf_name(destination.name)
        return self._write_pdf_file(folder, safe_name, self._decode_pdf(base64_data))

    @staticmethod
    def _decode_pdf(base64_data: str) -> bytes:
        try:
            payload = base64.b64decode(base64_data, validate=True)
        except (binascii.Error, ValueError, TypeError) as error:
            raise ValueError("I dati del PDF non sono validi.") from error
        if not payload.startswith(b"%PDF-"):
            raise ValueError("Il contenuto generato non è un PDF valido.")
        return payload

    @staticmethod
    def _write_pdf_file(folder: Path, safe_name: str, payload: bytes) -> dict[str, str]:
        stem = Path(safe_name).stem
        suffix = Path(safe_name).suffix
        number = 1
        while True:
            candidate_name = safe_name if number == 1 else f"{stem}_{number}{suffix}"
            candidate = folder / candidate_name
            try:
                with candidate.open("xb") as output:
                    output.write(payload)
                    output.flush()
                    os.fsync(output.fileno())
                return {"path": str(candidate)}
            except FileExistsError:
                number += 1

    def _read_settings(self) -> dict[str, str]:
        if not self.settings_path.exists():
            return {}
        try:
            settings = json.loads(self.settings_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as error:
            raise ValueError(f"Impossibile leggere la configurazione locale: {error}") from error
        if not isinstance(settings, dict):
            raise ValueError("La configurazione locale non è valida.")
        return {key: str(settings.get(key, "")) for key in PATH_KEYS if settings.get(key)}

    def _save_settings(self) -> None:
        self.settings_dir.mkdir(parents=True, exist_ok=True)
        self._atomic_write_json(self.settings_path, self.settings)

    @classmethod
    def _read_database(cls, database_path: Path) -> dict[str, Any]:
        try:
            state = json.loads(database_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as error:
            raise ValueError(f"Impossibile leggere il database: {error}") from error
        cls._validate_state(state)
        return state

    @staticmethod
    def _validate_state(state: Any) -> None:
        if (
            not isinstance(state, dict)
            or not isinstance(state.get("clients"), list)
            or not isinstance(state.get("quotes"), list)
            or not isinstance(state.get("prices"), dict)
            or not isinstance(state.get("company"), dict)
        ):
            raise ValueError("La struttura del database non è valida.")

    @staticmethod
    def _migrate_quote_send_fields(state: dict[str, Any]) -> tuple[dict[str, Any], bool]:
        migrated = False
        for quote in state["quotes"]:
            if not isinstance(quote, dict):
                continue
            for key in ("sentCustomerAt", "sentSupplierAt"):
                if key not in quote:
                    quote[key] = None
                    migrated = True
        return state, migrated

    @staticmethod
    def _create_pre_migration_backup(database_path: Path) -> Path:
        base = database_path.with_name(f"{database_path.stem}.pre-1.0.6.backup{database_path.suffix}")
        number = 1
        while True:
            candidate = base if number == 1 else base.with_name(
                f"{base.stem}-{number}{base.suffix}"
            )
            try:
                with database_path.open("rb") as source, candidate.open("xb") as backup:
                    shutil.copyfileobj(source, backup)
                    backup.flush()
                    os.fsync(backup.fileno())
                return candidate
            except FileExistsError:
                number += 1
            except OSError:
                if candidate.exists():
                    candidate.unlink()
                raise

    @staticmethod
    def _existing_directory(folder: str | Path, kind: str) -> Path:
        destination = Path(folder).expanduser().resolve()
        if not destination.is_dir():
            raise NotADirectoryError(f"La cartella {kind} selezionata non esiste.")
        if not os.access(destination, os.W_OK):
            raise PermissionError(f"La cartella {kind} non è scrivibile.")
        return destination

    @staticmethod
    def _safe_pdf_name(filename: str) -> str:
        portable_name = str(filename).replace("\\", "/").split("/")[-1]
        safe_name = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", portable_name).strip(" .")
        if not safe_name:
            safe_name = "preventivo.pdf"
        if not safe_name.lower().endswith(".pdf"):
            safe_name += ".pdf"
        return safe_name

    @staticmethod
    def _atomic_write_json(path: Path, payload: dict[str, Any]) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        temp_path: Path | None = None
        try:
            with tempfile.NamedTemporaryFile(
                mode="w", encoding="utf-8", dir=path.parent, prefix=f".{path.name}.", suffix=".tmp", delete=False
            ) as temp_file:
                temp_path = Path(temp_file.name)
                json.dump(payload, temp_file, ensure_ascii=False, indent=2)
                temp_file.flush()
                os.fsync(temp_file.fileno())
            os.replace(temp_path, path)
        finally:
            if temp_path is not None and temp_path.exists():
                temp_path.unlink()
