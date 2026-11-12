import tempfile
import unittest
from pathlib import Path

from desktop_app import DesktopApi
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
        self.api = DesktopApi(LocalStore(self.settings), FolderDialog([str(self.database)]))

    def tearDown(self):
        self.temp.cleanup()

    def test_database_folder_picker_reports_empty_folder_without_changing_current_database(self):
        result = self.api.choose_database_folder()

        self.assertEqual(result["status"], "empty")
        self.assertEqual(Path(result["path"]), self.database.resolve())
        self.assertIsNone(self.api.store.load()["database_path"])

    def test_database_folder_picker_reports_valid_existing_archive(self):
        (self.database / "preventivi.json").write_text(
            '{"clients": [], "quotes": [], "prices": {}, "company": {"name": "A"}}',
            encoding="utf-8",
        )

        result = self.api.choose_database_folder()

        self.assertEqual(result["status"], "existing")

    def test_cancelled_database_picker_does_not_change_path(self):
        self.api.window = FolderDialog(None)

        result = self.api.choose_database_folder()

        self.assertTrue(result["cancelled"])
        self.assertIsNone(self.api.store.load()["database_path"])


if __name__ == "__main__":
    unittest.main()
