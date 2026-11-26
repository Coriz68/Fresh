import base64
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from local_store import LocalStore


def sample_state(name="Cliente di prova"):
    return {
        "clients": [{"id": "c1", "name": name}],
        "quotes": [],
        "prices": {},
        "company": {"name": "Azienda di prova"},
    }


class LocalStoreTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.settings = self.root / "settings"
        self.database = self.root / "database"
        self.customer = self.root / "customer"
        self.supplier = self.root / "supplier"
        for folder in (self.database, self.customer, self.supplier):
            folder.mkdir()
        self.store = LocalStore(self.settings)

    def tearDown(self):
        self.temp.cleanup()

    def test_load_without_database_returns_empty_state(self):
        result = self.store.load()
        self.assertEqual(result["state"], LocalStore.empty_state())
        self.assertIsNone(result["database_path"])

    def test_legacy_quotes_gain_empty_send_fields_and_original_archive_is_backed_up(self):
        database_file = self.database / "preventivi.json"
        legacy = sample_state()
        legacy["quotes"] = [{"id": "q1", "number": "PREV-2025-0001", "items": []}]
        original_bytes = json.dumps(legacy, ensure_ascii=False, indent=2).encode("utf-8")
        database_file.write_bytes(original_bytes)
        self.store.settings["database_dir"] = str(self.database)
        self.store._save_settings()

        result = self.store.load()

        quote = result["state"]["quotes"][0]
        self.assertIsNone(quote["sentCustomerAt"])
        self.assertIsNone(quote["sentSupplierAt"])
        backups = list(self.database.glob("preventivi*.backup*.json"))
        self.assertEqual(len(backups), 1)
        self.assertEqual(backups[0].read_bytes(), original_bytes)
        self.assertEqual(json.loads(database_file.read_text(encoding="utf-8"))["quotes"][0], quote)

    def test_backup_failure_keeps_original_database_unchanged(self):
        database_file = self.database / "preventivi.json"
        legacy = sample_state()
        legacy["quotes"] = [{"id": "q1", "number": "PREV-2025-0001", "items": []}]
        database_file.write_text(json.dumps(legacy), encoding="utf-8")
        original_bytes = database_file.read_bytes()
        self.store.settings["database_dir"] = str(self.database)
        self.store._save_settings()

        with patch.object(self.store, "_create_pre_migration_backup", side_effect=OSError("disk full")):
            with self.assertRaisesRegex(OSError, "disk full"):
                self.store.load()

        self.assertEqual(database_file.read_bytes(), original_bytes)

    def test_selecting_empty_database_folder_can_copy_current_state(self):
        current = sample_state()
        result = self.store.set_database_folder(self.database, "copy-current", current)
        self.assertEqual(result["state"], current)
        self.assertEqual(json.loads((self.database / "preventivi.json").read_text()), current)

    def test_invalid_existing_database_is_not_overwritten(self):
        database_file = self.database / "preventivi.json"
        database_file.write_text("{not valid json", encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "database"):
            self.store.set_database_folder(self.database, "open")
        self.assertEqual(database_file.read_text(encoding="utf-8"), "{not valid json")
        self.assertIsNone(self.store.load()["database_path"])

    def test_pdf_is_saved_to_selected_folder_and_collision_gets_suffix(self):
        self.store.set_output_folder("customer", self.customer)
        payload = base64.b64encode(b"%PDF-1.7 sample").decode("ascii")
        first = Path(self.store.write_pdf("customer", "quote.pdf", payload)["path"])
        second = Path(self.store.write_pdf("customer", "quote.pdf", payload)["path"])
        self.assertEqual(first.parent, self.customer.resolve())
        self.assertEqual(first.read_bytes(), b"%PDF-1.7 sample")
        self.assertEqual(second.name, "quote_2.pdf")
        self.assertEqual(second.read_bytes(), b"%PDF-1.7 sample")

    def test_pdf_filename_cannot_escape_selected_folder(self):
        self.store.set_output_folder("supplier", self.supplier)
        payload = base64.b64encode(b"%PDF-1.7 sample").decode("ascii")
        saved = Path(self.store.write_pdf("supplier", "../../outside.pdf", payload)["path"])
        self.assertEqual(saved.parent, self.supplier.resolve())
        self.assertEqual(saved.name, "outside.pdf")
        self.assertFalse((self.root / "outside.pdf").exists())

    def test_customer_and_supplier_folders_must_be_distinct(self):
        self.store.set_output_folder("customer", self.customer)
        with self.assertRaises(ValueError):
            self.store.set_output_folder("supplier", self.customer)


if __name__ == "__main__":
    unittest.main()
