import base64
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from desktop_app import DesktopApi
from desktop_app import configure_app_logging
from local_store import LocalStore


class FolderDialog:
    def __init__(self, selected):
        self.selected = selected

    def create_file_dialog(self, dialog_type, directory="", **kwargs):
        return self.selected


class DesktopApiTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.settings = self.root / "settings"
        self.database = self.root / "database"
        self.database.mkdir()
        self.store = LocalStore(self.settings)
        self.api = DesktopApi(self.store, FolderDialog([str(self.database)]))

    def tearDown(self):
        self.temp.cleanup()

    def test_database_folder_picker_reports_empty_folder_without_changing_current_database(self):
        result = self.api.choose_database_folder()

        self.assertEqual(result["status"], "empty")
        self.assertEqual(Path(result["path"]), self.database.resolve())
        self.assertIsNone(self.store.load()["database_path"])

    def test_database_folder_picker_reports_valid_existing_archive(self):
        (self.database / "preventivi.json").write_text(
            '{"clients": [], "quotes": [], "prices": {}, "company": {"name": "A"}}',
            encoding="utf-8",
        )

        result = self.api.choose_database_folder()

        self.assertEqual(result["status"], "existing")

    def test_copy_current_database_uses_state_sent_by_desktop_frontend(self):
        state = self.store.empty_state()
        state["clients"].append({"id": "trial", "name": "Cliente prova"})

        result = self.api.set_database_folder(str(self.database), "copy-current", state)

        self.assertEqual(result["state"]["clients"][0]["name"], "Cliente prova")
        self.assertEqual(self.store.load()["state"]["clients"][0]["name"], "Cliente prova")

    def test_cancelled_database_picker_does_not_change_path(self):
        self.api._bind_window(FolderDialog(None))

        result = self.api.choose_database_folder()

        self.assertTrue(result["cancelled"])
        self.assertIsNone(self.store.load()["database_path"])

    def test_save_pdf_copy_uses_native_save_dialog_and_writes_to_selected_disk_path(self):
        destination = self.root / "pdf scelti" / "copia preventivo.pdf"
        destination.parent.mkdir()
        self.api._bind_window(FolderDialog([str(destination)]))
        payload = base64.b64encode(b"%PDF-1.7 sample").decode("ascii")

        result = self.api.save_pdf_copy("customer", "preventivo_25_cliente.pdf", payload)

        self.assertEqual(Path(result["path"]), destination.resolve())
        self.assertEqual(destination.read_bytes(), b"%PDF-1.7 sample")

    def test_save_pdf_copy_cancel_does_not_create_a_file(self):
        self.api._bind_window(FolderDialog(None))
        payload = base64.b64encode(b"%PDF-1.7 sample").decode("ascii")

        result = self.api.save_pdf_copy("supplier", "preventivo_25_fornitore", payload)

        self.assertTrue(result["cancelled"])

    def test_save_pdf_copy_never_overwrites_existing_file(self):
        destination = self.root / "preventivo.pdf"
        destination.write_bytes(b"existing")
        self.api._bind_window(FolderDialog([str(destination)]))
        payload = base64.b64encode(b"%PDF-1.7 sample").decode("ascii")

        result = self.api.save_pdf_copy("customer", "preventivo.pdf", payload)

        self.assertEqual(Path(result["path"]).name, "preventivo_2.pdf")
        self.assertEqual(destination.read_bytes(), b"existing")

    def test_startup_reports_corrupt_database_without_replacing_it(self):
        database_file = self.database / "preventivi.json"
        database_file.write_text("{damaged", encoding="utf-8")
        self.store.settings["database_dir"] = str(self.database)
        self.store._save_settings()

        result = self.api.load_initial_data()

        self.assertIn("database_error", result)
        self.assertEqual(database_file.read_text(encoding="utf-8"), "{damaged")

    def test_import_backup_rejects_files_over_50_mb(self):
        backup = self.root / "oversized.json"
        with backup.open("wb") as stream:
            stream.truncate(50 * 1024 * 1024 + 1)
        self.api._bind_window(FolderDialog([str(backup)]))

        with self.assertRaisesRegex(ValueError, "50 MB"):
            self.api.import_backup()

    def test_internal_store_and_window_are_not_exposed_to_javascript(self):
        self.assertFalse(hasattr(self.api, "store"))
        self.assertFalse(hasattr(self.api, "window"))
        self.assertEqual(set(dir(self.api)), DesktopApi.EXPOSED_METHODS)

    def test_open_whatsapp_builds_fixed_click_to_chat_link_with_encoded_message(self):
        with patch("desktop_app.webbrowser.open", return_value=True) as open_browser:
            result = self.api.open_whatsapp("Preventivo 42 · Cliente Demo")

        self.assertEqual(result, {"ok": True})
        open_browser.assert_called_once_with(
            "https://wa.me/?text=Preventivo+42+%C2%B7+Cliente+Demo", new=2
        )

    def test_open_whatsapp_rejects_empty_message_and_reports_browser_failure(self):
        with self.assertRaisesRegex(ValueError, "messaggio"):
            self.api.open_whatsapp("  ")
        with patch("desktop_app.webbrowser.open", return_value=False):
            with self.assertRaisesRegex(RuntimeError, "WhatsApp"):
                self.api.open_whatsapp("Preventivo 42")

    def test_frontend_log_accepts_only_event_codes_and_omits_client_text(self):
        logger, log_path = configure_app_logging(self.root / "logs")
        try:
            self.assertEqual(self.api.log_event("pdf_customer_assembly"), {"ok": True})
            with self.assertRaisesRegex(ValueError, "evento"):
                self.api.log_event("Cliente Demo riservato")
            for handler in logger.handlers:
                handler.flush()
            contents = log_path.read_text(encoding="utf-8")
            self.assertIn("pdf_customer_assembly", contents)
            self.assertNotIn("Cliente Demo riservato", contents)
        finally:
            for handler in list(logger.handlers):
                logger.removeHandler(handler)
                handler.close()


if __name__ == "__main__":
    unittest.main()
