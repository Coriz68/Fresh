import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import patch

import whatsapp_windows as whatsapp

try:
    import pypdf
except ImportError:
    pypdf = None


REVISION = "a" * 64
QUOTE_ID = "quote-42"


class FakeControl:
    def __init__(self, name, control_type="Edit"):
        self.name = name
        self.element_info = types.SimpleNamespace(control_type=control_type)
        self.keys = []
        self.focused = False
        self.visible = True

    def is_visible(self):
        return self.visible

    def window_text(self):
        return self.name

    def set_focus(self):
        self.focused = True

    def has_keyboard_focus(self):
        return self.focused

    def type_keys(self, value, **kwargs):
        self.keys.append(value)
        self.window.children.append(FakeControl(self.window.filename, "Text"))


class FakeWindow(FakeControl):
    def __init__(self, composer=True):
        super().__init__("WhatsApp", "Window")
        self.element_info.process = 42
        self.filename = "preventivo_quote-42_aaaaaaaaaaaa_cliente.pdf"
        self.children = []
        self.active = False
        if composer:
            field = FakeControl("Type a message")
            field.window = self
            self.children.append(field)

    def set_focus(self):
        self.active = True

    def is_active(self):
        return self.active

    def descendants(self):
        return self.children


class FakeDesktop:
    def __init__(self, windows):
        self._windows = windows

    def windows(self):
        return self._windows


class WhatsAppClipboardTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.pdf = Path(self.temp.name) / "preventivo_quote-42_aaaaaaaaaaaa_cliente.pdf"
        self.pdf.write_bytes(b"%PDF-1.7 test")
        self.clipboard = ["C:/precedente.pdf"]
        self.writes = []
        self.window = FakeWindow()
        self.desktop = FakeDesktop([self.window])
        self.addCleanup(self.temp.cleanup)

    def run_attach(self, *, windows=None, composer=True, timeout=0.03, validation_error=None):
        if windows is None:
            self.window = FakeWindow(composer=composer)
            self.desktop = FakeDesktop([self.window])
            windows = [self.window]
        receipt = {"path": str(self.pdf.resolve()), "quote_id": QUOTE_ID, "revision": REVISION, "kind": "customer", "recipient": "393331234567", "module_ids": [], "sha256": "b" * 64, "size": self.pdf.stat().st_size, "pages": 1, "filename": self.pdf.name}
        with patch.object(whatsapp, "_validate_document", side_effect=validation_error) as validator:
            if validation_error is None:
                validator.return_value = {"sha256": "b" * 64, "size": self.pdf.stat().st_size, "pages": 1}
            return whatsapp.prepare_whatsapp_pdf(
                str(self.pdf), "customer", "393331234567", QUOTE_ID, REVISION, [], receipt,
                timeout=timeout, platform_name="nt",
                desktop_factory=lambda **kwargs: FakeDesktop(windows),
                clipboard_reader=lambda: list(self.clipboard),
                clipboard_writer=lambda path: (self.writes.append(str(path)), self.clipboard.__setitem__(slice(None), [str(path)])),
                sequence_reader=lambda: 1,
            )

    def test_open_whatsapp_dispatches_protocol_through_windows_shell(self):
        with patch.object(whatsapp, "_shell_execute_protocol", return_value=42) as launch:
            result = whatsapp.open_whatsapp_chat("393331234567", platform_name="nt")
        self.assertEqual(result, {"ok": True})
        launch.assert_called_once_with("whatsapp://send?phone=393331234567")

    def test_open_whatsapp_reports_missing_protocol_handler(self):
        with patch.object(whatsapp, "_shell_execute_protocol", return_value=31):
            with self.assertRaisesRegex(RuntimeError, "protocollo WhatsApp"):
                whatsapp.open_whatsapp_chat("393331234567", platform_name="nt")

    def test_open_whatsapp_rejects_invalid_phone_before_dispatch(self):
        with patch.object(whatsapp, "_shell_execute_protocol") as launch:
            with self.assertRaisesRegex(ValueError, "Numero WhatsApp"):
                whatsapp.open_whatsapp_chat("bad-number", platform_name="nt")
        launch.assert_not_called()

    def test_existing_exact_clipboard_path_is_preserved_and_only_ctrl_v_is_used(self):
        self.clipboard = [str(self.pdf)]
        with patch.object(whatsapp, "_windows_process_name", return_value="whatsapp.exe"):
            result = self.run_attach()
        self.assertTrue(result["attached"])
        self.assertEqual(self.writes, [])
        composer = self.window.children[0]
        self.assertEqual(composer.keys, ["^v"])
        self.assertEqual(result["filename"], self.window.filename)

    def test_previous_clipboard_document_is_replaced_by_exact_target(self):
        with patch.object(whatsapp, "_windows_process_name", return_value="whatsapp.exe"):
            result = self.run_attach()
        self.assertTrue(result["attached"])
        self.assertEqual([Path(path).resolve() for path in self.clipboard], [self.pdf.resolve()])
        self.assertEqual([Path(path).resolve() for path in self.writes], [self.pdf.resolve()])

    def test_clipboard_fallback_preserves_the_exact_existing_path_without_rewriting(self):
        self.clipboard = [str(self.pdf.resolve())]
        receipt = {"path": str(self.pdf.resolve()), "quote_id": QUOTE_ID, "revision": REVISION, "kind": "customer", "recipient": "393331234567", "module_ids": [], "sha256": "b" * 64, "size": self.pdf.stat().st_size, "pages": 1, "filename": self.pdf.name}
        with patch.object(whatsapp, "_validate_document", return_value={"sha256": "b" * 64, "size": self.pdf.stat().st_size, "pages": 1}):
            result = whatsapp.copy_pdf_to_clipboard(str(self.pdf), "customer", "393331234567", QUOTE_ID, REVISION, [], receipt, platform_name="nt", clipboard_reader=lambda: list(self.clipboard), clipboard_writer=lambda path: self.writes.append(str(path)), sequence_reader=lambda: 7)
        self.assertTrue(result["clipboardReady"])
        self.assertEqual(self.writes, [])

    def test_clipboard_fallback_replaces_previous_path_and_verifies_sequence(self):
        receipt = {"path": str(self.pdf.resolve()), "quote_id": QUOTE_ID, "revision": REVISION, "kind": "customer", "recipient": "393331234567", "module_ids": [], "sha256": "b" * 64, "size": self.pdf.stat().st_size, "pages": 1, "filename": self.pdf.name}
        with patch.object(whatsapp, "_validate_document", return_value={"sha256": "b" * 64, "size": self.pdf.stat().st_size, "pages": 1}):
            result = whatsapp.copy_pdf_to_clipboard(str(self.pdf), "customer", "393331234567", QUOTE_ID, REVISION, [], receipt, platform_name="nt", clipboard_reader=lambda: list(self.clipboard), clipboard_writer=lambda path: (self.writes.append(str(path)), self.clipboard.__setitem__(slice(None), [str(path)])), sequence_reader=lambda: 7)
        self.assertTrue(result["clipboardReady"])
        self.assertEqual([Path(path).resolve() for path in self.clipboard], [self.pdf.resolve()])
        self.assertEqual([Path(path).resolve() for path in self.writes], [self.pdf.resolve()])

    def test_closed_whatsapp_leaves_only_the_expected_pdf_in_clipboard_for_manual_paste(self):
        with patch.object(whatsapp, "_windows_process_name", return_value="whatsapp.exe"):
            result = self.run_attach(windows=[])
        self.assertFalse(result["attached"])
        self.assertTrue(result["clipboardReady"])
        self.assertEqual([Path(path).resolve() for path in self.clipboard], [self.pdf.resolve()])

    def test_missing_composer_fails_to_manual_fallback_without_claiming_attachment(self):
        with patch.object(whatsapp, "_windows_process_name", return_value="whatsapp.exe"):
            result = self.run_attach(composer=False)
        self.assertFalse(result["attached"])
        self.assertTrue(result["clipboardReady"])

    def test_missing_composer_focus_fails_to_manual_fallback(self):
        self.window = FakeWindow()
        composer = self.window.children[0]
        composer.has_keyboard_focus = lambda: False
        with patch.object(whatsapp, "_windows_process_name", return_value="whatsapp.exe"):
            result = self.run_attach(windows=[self.window])
        self.assertFalse(result["attached"])
        self.assertTrue(result["clipboardReady"])

    def test_multiple_whatsapp_windows_fail_closed(self):
        self.window = FakeWindow()
        with patch.object(whatsapp, "_windows_process_name", return_value="whatsapp.exe"):
            result = self.run_attach(windows=[self.window, FakeWindow()])
        self.assertFalse(result["attached"])
        self.assertTrue(result["clipboardReady"])

    def test_wrong_filename_in_preview_is_not_reported_as_attached(self):
        self.window = FakeWindow()
        self.window.filename = "different.pdf"
        with patch.object(whatsapp, "_windows_process_name", return_value="whatsapp.exe"):
            result = self.run_attach(windows=[self.window], timeout=0.01)
        self.assertFalse(result["attached"])
        self.assertTrue(result["clipboardReady"])

    def test_existing_same_filename_does_not_count_as_a_new_attachment(self):
        self.window = FakeWindow()
        existing = FakeControl(self.pdf.name, "Text")
        self.window.children.append(existing)
        composer = self.window.children[0]
        composer.type_keys = lambda value, **kwargs: composer.keys.append(value)
        with patch.object(whatsapp, "_windows_process_name", return_value="whatsapp.exe"):
            result = self.run_attach(windows=[self.window], timeout=0.01)
        self.assertFalse(result["attached"])
        self.assertTrue(result["clipboardReady"])
        self.assertEqual(composer.keys, ["^v"])

    def test_missing_or_invalid_identity_aborts_before_clipboard_mutation(self):
        self.pdf.unlink()
        with self.assertRaises(FileNotFoundError):
            self.run_attach()
        self.assertEqual(self.writes, [])

    def test_stale_or_wrong_kind_document_is_rejected_before_clipboard_mutation(self):
        with self.assertRaisesRegex(RuntimeError, "revisione obsoleta"):
            self.run_attach(validation_error=RuntimeError("revisione obsoleta"))
        self.assertEqual(self.writes, [])

    def test_damaged_pdf_is_rejected_before_clipboard_mutation(self):
        self.pdf.write_bytes(b"not a PDF")
        broken_reader = lambda _path, **kwargs: (_ for _ in ()).throw(ValueError("PDF danneggiato"))
        with patch.dict(sys.modules, {"pypdf": types.SimpleNamespace(PdfReader=broken_reader)}):
            with self.assertRaisesRegex(RuntimeError, "non verificabile"):
                whatsapp._validate_document(self.pdf, {"quote_id": QUOTE_ID, "revision": REVISION, "kind": "customer", "recipient": "393331234567"})
        self.assertEqual(self.writes, [])

    def test_invalid_supplier_identity_and_reserved_form_fields_are_blocked(self):
        metadata = {"/Keywords": f"quote_id={QUOTE_ID}, revision={REVISION}, kind=supplier, recipient=393331234567, module_ids=item-1"}
        fake_reader = lambda _path, **kwargs: types.SimpleNamespace(
            pages=[types.SimpleNamespace(extract_text=lambda: "Larghezza: 300 cm")],
            metadata=metadata,
            get_fields=lambda: {"cliente": {"/V": "Cliente Riservato"}},
        )
        with patch.dict(sys.modules, {"pypdf": types.SimpleNamespace(PdfReader=fake_reader)}):
            with self.assertRaisesRegex(RuntimeError, "campo riservato"):
                whatsapp._validate_document(self.pdf, {"quote_id": QUOTE_ID, "revision": REVISION, "kind": "supplier", "recipient": "393331234567", "module_ids": "item-1"})

    def test_supplier_commercial_summary_is_blocked_even_when_metadata_matches(self):
        metadata = {"/Keywords": f"quote_id={QUOTE_ID}, revision={REVISION}, kind=supplier, recipient=393331234567, module_ids=item-1"}
        fake_reader = lambda _path, **kwargs: types.SimpleNamespace(
            pages=[types.SimpleNamespace(extract_text=lambda: "Totale listino: 1.200 euro")],
            metadata=metadata,
            get_fields=lambda: {},
        )
        with patch.dict(sys.modules, {"pypdf": types.SimpleNamespace(PdfReader=fake_reader)}):
            with self.assertRaisesRegex(RuntimeError, "dati commerciali"):
                whatsapp._validate_document(self.pdf, {"quote_id": QUOTE_ID, "revision": REVISION, "kind": "supplier", "recipient": "393331234567", "module_ids": "item-1"})

    def test_metadata_values_are_compared_as_complete_tokens(self):
        metadata = {"/Keywords": f"quote_id={QUOTE_ID}-stale, revision={REVISION}, kind=customer, recipient=393331234567"}
        fake_reader = lambda _path, **kwargs: types.SimpleNamespace(
            pages=[types.SimpleNamespace(extract_text=lambda: "")], metadata=metadata, get_fields=lambda: {}
        )
        with patch.dict(sys.modules, {"pypdf": types.SimpleNamespace(PdfReader=fake_reader)}):
            with self.assertRaisesRegex(RuntimeError, "metadato quote_id"):
                whatsapp._validate_document(self.pdf, {"quote_id": QUOTE_ID, "revision": REVISION, "kind": "customer", "recipient": "393331234567"})

    @unittest.skipIf(pypdf is None, "pypdf installato nel workflow Windows; assente in questo ambiente locale")
    def test_real_pdf_reader_emits_receipt_and_detects_post_generation_changes(self):
        writer = pypdf.PdfWriter()
        writer.add_blank_page(width=595, height=842)
        writer.add_metadata({"/Title": "Preventivo cliente", "/Keywords": f"quote_id={QUOTE_ID}, revision={REVISION}, kind=customer, recipient=393331234567"})
        with self.pdf.open("wb") as stream:
            writer.write(stream)
        identity = {"quote_id": QUOTE_ID, "revision": REVISION, "kind": "customer", "recipient": "393331234567"}
        receipt = whatsapp.create_pdf_receipt(self.pdf, identity)
        self.assertEqual(receipt["pages"], 1)
        self.assertEqual(len(receipt["sha256"]), 64)
        with self.pdf.open("ab") as stream:
            stream.write(b" ")
        with self.assertRaisesRegex(RuntimeError, "cambiato dopo"):
            whatsapp._verified_receipt(self.pdf, identity, receipt)


if __name__ == "__main__":
    unittest.main()
