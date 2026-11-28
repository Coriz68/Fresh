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

    def run_attach(self, *, windows=None, composer=True, timeout=0.03, validation_error=None, process_name_resolver=None, app_user_model_id_resolver=None):
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
                process_name_resolver=process_name_resolver,
                app_user_model_id_resolver=app_user_model_id_resolver,
                clipboard_reader=lambda: list(self.clipboard),
                clipboard_writer=lambda path: (self.writes.append(str(path)), self.clipboard.__setitem__(slice(None), [str(path)])),
                sequence_reader=lambda: 1,
            )

    def test_open_whatsapp_uses_registered_protocol_directly_without_store_or_window_wait(self):
        detector = lambda **_kwargs: {"protocol_registered": True, "store_installed": True, "app_version": "2.3"}
        with patch.object(whatsapp.os, "startfile", create=True) as startfile, patch.object(whatsapp, "_activate_store_whatsapp") as activate:
            result = whatsapp.open_whatsapp_chat("393331234567", "Preventivo PREV-42", platform_name="nt", installation_detector=detector)
        self.assertTrue(result["desktopOpened"])
        startfile.assert_called_once_with("whatsapp://send?phone=393331234567&text=Preventivo%20PREV-42")
        activate.assert_not_called()

    def test_store_activation_is_used_only_after_direct_protocol_launch_fails(self):
        detector = lambda **_kwargs: {"protocol_registered": True, "store_installed": True, "app_version": "2.3"}
        with patch.object(whatsapp.os, "startfile", create=True, side_effect=OSError("protocol failed")) as startfile, patch.object(whatsapp, "_activate_store_whatsapp", return_value=1234) as activate, patch.object(whatsapp, "_shell_execute_protocol", return_value=42) as shell:
            result = whatsapp.open_whatsapp_chat("393331234567", "Ciao", platform_name="nt", installation_detector=detector)
        self.assertTrue(result["desktopOpened"])
        startfile.assert_called_once()
        activate.assert_called_once_with()
        shell.assert_called_once_with("whatsapp://send?phone=393331234567&text=Ciao")

    def test_open_whatsapp_reports_missing_protocol_handler(self):
        detector = lambda **_kwargs: {"protocol_registered": False, "store_installed": False, "app_version": "non rilevabile"}
        with patch.object(whatsapp.os, "startfile", create=True, side_effect=OSError("startfile")), patch.object(whatsapp, "_activate_store_whatsapp", side_effect=OSError("Store")), patch.object(whatsapp, "_shell_execute_protocol", return_value=31):
            with self.assertRaisesRegex(RuntimeError, "protocollo WhatsApp"):
                whatsapp.open_whatsapp_chat("393331234567", platform_name="nt", installation_detector=detector)

    def test_open_whatsapp_rejects_invalid_phone_before_dispatch(self):
        with patch.object(whatsapp.os, "startfile", create=True) as launch:
            with self.assertRaisesRegex(ValueError, "Numero WhatsApp"):
                whatsapp.open_whatsapp_chat("bad-number", platform_name="nt")
        launch.assert_not_called()

    def test_build_whatsapp_web_url_encodes_prefilled_message_and_validates_phone(self):
        url = whatsapp.build_whatsapp_web_url("393331234567", "Preventivo PREV/42: pronto")
        self.assertEqual(url, "https://web.whatsapp.com/send?phone=393331234567&text=Preventivo%20PREV%2F42%3A%20pronto")
        with self.assertRaisesRegex(ValueError, "Numero WhatsApp"):
            whatsapp.build_whatsapp_web_url("bad-number", "Ciao")

    def test_protocol_url_encodes_prefilled_text(self):
        self.assertEqual(whatsapp.build_whatsapp_protocol_url("393331234567", "PREV/42: pronto"), "whatsapp://send?phone=393331234567&text=PREV%2F42%3A%20pronto")

    def test_desktop_launch_failure_opens_browser_fallback(self):
        opened = []
        result = whatsapp.open_whatsapp_with_fallback(
            "393331234567",
            "PDF pronto",
            desktop_open=lambda *_args: (_ for _ in ()).throw(RuntimeError("desktop non disponibile")),
            browser_open=lambda url: opened.append(url) or True,
        )
        self.assertFalse(result["desktopOpened"])
        self.assertTrue(result["browserOpened"])
        self.assertEqual(opened, ["https://web.whatsapp.com/send?phone=393331234567&text=PDF%20pronto"])

    def test_whatsapp_diagnostic_log_omits_sensitive_arguments_and_exception_text(self):
        import io
        import logging

        stream = io.StringIO()
        logger = logging.getLogger("test.whatsapp.safe")
        logger.handlers.clear()
        logger.propagate = False
        logger.setLevel(logging.INFO)
        handler = logging.StreamHandler(stream)
        logger.addHandler(handler)
        try:
            whatsapp.log_whatsapp_event(
                logger,
                "clipboard",
                "verified",
                error=RuntimeError("Cliente Mario Rossi prezzo 1234 /Users/mario/preventivo.pdf"),
                app_version="2.3000.1",
                windows_version="11.0.1",
            )
        finally:
            logger.removeHandler(handler)
        output = stream.getvalue()
        self.assertIn("clipboard", output)
        self.assertIn("RuntimeError", output)
        self.assertIn("2.3000.1", output)
        self.assertIn("11.0.1", output)
        for sensitive in ("Mario Rossi", "1234", "/Users/mario", "preventivo.pdf"):
            self.assertNotIn(sensitive, output)

    def test_existing_exact_clipboard_path_is_preserved_and_only_ctrl_v_is_used(self):
        self.clipboard = [str(self.pdf)]
        with patch.object(whatsapp, "_windows_process_name", return_value="whatsapp.exe"):
            result = self.run_attach()
        self.assertTrue(result["attached"])
        self.assertEqual(self.writes, [])
        composer = self.window.children[0]
        self.assertEqual(composer.keys, ["^v"])
        self.assertEqual(result["filename"], self.window.filename)

    def test_prepare_pdf_recognizes_the_microsoft_store_app_window_identity(self):
        app_id = "5319275A.WhatsAppDesktop_cv1g1gvanyjgm!App"
        with patch.object(whatsapp, "_validate_document", return_value={"sha256": "b" * 64, "size": self.pdf.stat().st_size, "pages": 1}):
            result = self.run_attach(
                process_name_resolver=lambda window: "ApplicationFrameHost.exe",
                app_user_model_id_resolver=lambda window: app_id,
            )
        self.assertTrue(result["attached"])
        self.assertEqual(self.window.children[0].keys, ["^v"])

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

    def test_supplier_pdf_rejects_any_currency_amount_or_commercial_tax_label(self):
        metadata = {"/Keywords": f"quote_id={QUOTE_ID}, revision={REVISION}, kind=supplier, recipient=393331234567, module_ids=item-1"}
        for text in ("Prezzo: 150,00 €", "IVA 22%", "Importo 125 euro"):
            fake_reader = lambda _path, **kwargs: types.SimpleNamespace(
                pages=[types.SimpleNamespace(extract_text=lambda: text)], metadata=metadata, get_fields=lambda: {}
            )
            with self.subTest(text=text), patch.dict(sys.modules, {"pypdf": types.SimpleNamespace(PdfReader=fake_reader)}):
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

    @unittest.skipIf(pypdf is None, "pypdf deve essere installato per verificare il contenuto PDF reale")
    def test_real_supplier_pdf_reader_rejects_prices_and_vat_text(self):
        from pypdf.generic import DecodedStreamObject, DictionaryObject, NameObject

        writer = pypdf.PdfWriter()
        page = writer.add_blank_page(width=595, height=842)
        font = DictionaryObject({NameObject("/Type"): NameObject("/Font"), NameObject("/Subtype"): NameObject("/Type1"), NameObject("/BaseFont"): NameObject("/Helvetica")})
        page[NameObject("/Resources")] = DictionaryObject({NameObject("/Font"): DictionaryObject({NameObject("/F1"): font})})
        content = DecodedStreamObject()
        content.set_data(b"BT /F1 12 Tf 72 720 Td (Larghezza 300 cm - IVA 22% - prezzo 150,00 EUR - totale 150,00 EUR) Tj ET")
        page[NameObject("/Contents")] = content
        writer.add_metadata({"/Title": "Moduli fornitore", "/Keywords": f"quote_id={QUOTE_ID}, revision={REVISION}, kind=supplier, recipient=393331234567, module_ids=item-1"})
        with self.pdf.open("wb") as stream:
            writer.write(stream)
        identity = {"quote_id": QUOTE_ID, "revision": REVISION, "kind": "supplier", "recipient": "393331234567", "module_ids": "item-1"}
        with self.assertRaisesRegex(RuntimeError, "dati commerciali"):
            whatsapp._validate_document(self.pdf, identity)


if __name__ == "__main__":
    unittest.main()
