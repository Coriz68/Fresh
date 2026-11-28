import io
import logging
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import whatsapp_windows as whatsapp

try:
    import pypdf
except ImportError:
    pypdf = None


REVISION = "a" * 64
QUOTE_ID = "quote-42"


class WhatsAppWindowsTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.pdf = self.root / f"preventivo_{QUOTE_ID}_{REVISION[:12]}_cliente.pdf"
        self.addCleanup(self.temp.cleanup)

    def write_pdf(self, path=None, *, kind="customer", recipient="393331234567", module_ids=None, text=None):
        if pypdf is None:
            self.skipTest("pypdf deve essere installato per verificare PDF reali")
        target = path or self.pdf
        writer = pypdf.PdfWriter()
        page = writer.add_blank_page(width=595, height=842)
        if text:
            from pypdf.generic import DecodedStreamObject, DictionaryObject, NameObject

            font = DictionaryObject({NameObject("/Type"): NameObject("/Font"), NameObject("/Subtype"): NameObject("/Type1"), NameObject("/BaseFont"): NameObject("/Helvetica")})
            page[NameObject("/Resources")] = DictionaryObject({NameObject("/Font"): DictionaryObject({NameObject("/F1"): font})})
            content = DecodedStreamObject()
            content.set_data(f"BT /F1 12 Tf 72 720 Td ({text}) Tj ET".encode())
            page[NameObject("/Contents")] = content
        keywords = [f"quote_id={QUOTE_ID}", f"revision={REVISION}", f"kind={kind}", f"recipient={recipient}"]
        if kind == "supplier":
            keywords.append(f"module_ids={'|'.join(module_ids or ['item-1'])}")
        writer.add_metadata({"/Title": "Preventivo", "/Keywords": ", ".join(keywords)})
        with target.open("wb") as stream:
            writer.write(stream)
        return target

    def receipt(self, kind="customer", recipient="393331234567", module_ids=None):
        identity = {"quote_id": QUOTE_ID, "revision": REVISION, "kind": kind, "recipient": recipient}
        if kind == "supplier":
            identity["module_ids"] = module_ids or ["item-1"]
        return whatsapp.create_pdf_receipt(self.pdf, identity)

    def test_builds_whatsapp_protocol_and_web_urls_with_encoded_message(self):
        text = "Preventivo PREV/42: pronto"
        self.assertEqual(whatsapp.build_whatsapp_protocol_url("393331234567", text), "whatsapp://send?phone=393331234567&text=Preventivo%20PREV%2F42%3A%20pronto")
        self.assertEqual(whatsapp.build_whatsapp_web_url("393331234567", text), "https://web.whatsapp.com/send?phone=393331234567&text=Preventivo%20PREV%2F42%3A%20pronto")
        for builder in (whatsapp.build_whatsapp_protocol_url, whatsapp.build_whatsapp_web_url):
            with self.subTest(builder=builder.__name__), self.assertRaisesRegex(ValueError, "Numero WhatsApp"):
                builder("bad-number", "Ciao")

    def test_open_chat_uses_protocol_first_and_does_not_touch_clipboard_or_store_api(self):
        launched = []
        with patch.object(whatsapp, "_set_clipboard_path") as clipboard, patch.object(whatsapp, "_activate_store_whatsapp", create=True) as store:
            result = whatsapp.open_whatsapp_chat("393331234567", "Preventivo PREV-42", platform_name="nt", protocol_launcher=lambda url: launched.append(url))
        self.assertEqual(launched, ["whatsapp://send?phone=393331234567&text=Preventivo%20PREV-42"])
        self.assertEqual(result["method"], "protocol")
        clipboard.assert_not_called()
        store.assert_not_called()

    def test_protocol_failure_uses_web_browser_fallback(self):
        opened = []
        result = whatsapp.open_whatsapp_chat(
            "393331234567", "PDF pronto", platform_name="nt",
            protocol_launcher=lambda _url: (_ for _ in ()).throw(OSError("non avviato")),
            browser_opener=lambda url: opened.append(url) or True,
        )
        self.assertEqual(result["method"], "browser")
        self.assertEqual(opened, ["https://web.whatsapp.com/send?phone=393331234567&text=PDF%20pronto"])

    def test_open_chat_rejects_invalid_phone_before_dispatch(self):
        with patch.object(whatsapp.os, "startfile", create=True) as launcher:
            with self.assertRaisesRegex(ValueError, "Numero WhatsApp"):
                whatsapp.open_whatsapp_chat("39 abc", platform_name="nt")
        launcher.assert_not_called()

    def test_copy_pdf_uses_real_current_file_and_verifies_exact_clipboard_file_list(self):
        self.write_pdf()
        receipt = self.receipt()
        clipboard = ["C:/precedente.pdf"]
        writes = []

        def write(path):
            writes.append(path)
            clipboard[:] = [str(path)]

        result = whatsapp.copy_pdf_to_clipboard(
            str(self.pdf), "customer", QUOTE_ID, REVISION, [], receipt, platform_name="nt",
            clipboard_reader=lambda: list(clipboard), clipboard_writer=write,
        )
        self.assertEqual(writes, [self.pdf.resolve()])
        self.assertEqual(clipboard, [str(self.pdf.resolve())])
        self.assertTrue(result["clipboardReady"])
        self.assertEqual(result["filename"], self.pdf.name)

    def test_copy_fails_if_file_drop_verification_does_not_match_exact_pdf(self):
        self.write_pdf()
        receipt = self.receipt()
        with self.assertRaisesRegex(RuntimeError, "appunti non contengono esattamente"):
            whatsapp.copy_pdf_to_clipboard(
                str(self.pdf), "customer", QUOTE_ID, REVISION, [], receipt, platform_name="nt",
                clipboard_reader=lambda: ["C:/precedente.pdf"], clipboard_writer=lambda _path: None,
            )

    def test_powershell_clipboard_commands_are_hidden_and_escape_unicode_paths(self):
        path = self.root / "preventivo_città d'Oro.pdf"
        path.write_bytes(b"%PDF-1.7 clipboard test")
        completed = SimpleNamespace(returncode=0, stdout=str(path) + "\n", stderr="")
        with patch.object(whatsapp, "_is_windows", return_value=True), patch.object(whatsapp.subprocess, "run", return_value=completed) as run:
            whatsapp._set_clipboard_path(path)
        args, kwargs = run.call_args
        self.assertEqual(args[0][0], "powershell.exe")
        self.assertIn("Set-Clipboard -Path", args[0][-1])
        self.assertIn("Get-Clipboard -Format FileDropList", args[0][-1])
        self.assertIn("UTF8Encoding", args[0][-1])
        self.assertIn("d''Oro", args[0][-1])
        self.assertTrue(kwargs["creationflags"])
        self.assertTrue(kwargs["capture_output"])

    def test_supplier_pdf_real_reader_rejects_prices_total_and_iva(self):
        path = self.root / f"preventivo_{QUOTE_ID}_{REVISION[:12]}_fornitore.pdf"
        for forbidden in ("Prezzo 150 EUR", "Totale 150 EUR", "IVA 22%"):
            with self.subTest(forbidden=forbidden):
                self.write_pdf(path, kind="supplier", text=forbidden)
                with self.assertRaisesRegex(RuntimeError, "dati commerciali"):
                    whatsapp.create_pdf_receipt(path, {"quote_id": QUOTE_ID, "revision": REVISION, "kind": "supplier", "recipient": "393331234567", "module_ids": ["item-1"]})

    def test_safe_diagnostics_include_outcome_and_filename_but_not_sensitive_content(self):
        stream = io.StringIO()
        logger = logging.getLogger("test.whatsapp.safe.new")
        logger.handlers.clear()
        logger.propagate = False
        logger.setLevel(logging.INFO)
        handler = logging.StreamHandler(stream)
        logger.addHandler(handler)
        try:
            whatsapp.log_whatsapp_event(logger, "copy", "verified", duration_ms=23, filename="preventivo_quote-42_cliente.pdf", error=RuntimeError("Mario Rossi 1500 euro /Users/mario/file.pdf"))
        finally:
            logger.removeHandler(handler)
        output = stream.getvalue()
        self.assertIn("copy", output)
        self.assertIn("verified", output)
        self.assertIn("preventivo_quote-42_cliente.pdf", output)
        self.assertIn("RuntimeError", output)
        for private in ("Mario Rossi", "1500 euro", "/Users/mario", "file.pdf"):
            self.assertNotIn(private, output)

    def test_legacy_ui_automation_and_store_activation_are_not_present(self):
        self.assertFalse(hasattr(whatsapp, "prepare_whatsapp_pdf"))
        self.assertFalse(hasattr(whatsapp, "_activate_store_whatsapp"))
        self.assertNotIn("pywinauto", sys.modules)


if __name__ == "__main__":
    unittest.main()
