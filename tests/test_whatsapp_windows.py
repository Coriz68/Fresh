import tempfile
import unittest
from pathlib import Path

from whatsapp_windows import attach_pdf_to_open_chat


class FakeControl:
    def __init__(self, name, control_type, on_click=None, on_set=None, visible=True):
        self.name = name
        self.control_type = control_type
        self.on_click = on_click
        self.on_set = on_set
        self.visible = visible
        self.clicked = 0
        self.value = None

    def window_text(self):
        return self.name

    def is_visible(self):
        return self.visible

    def click_input(self):
        if not self.visible:
            raise RuntimeError("control is not visible")
        self.clicked += 1
        if self.on_click:
            self.on_click()

    def set_edit_text(self, value):
        if not self.visible:
            raise RuntimeError("dialog was closed")
        self.value = value
        if self.on_set:
            self.on_set(value)


class FakeWindow:
    def __init__(self, title, process_name, controls=None, visible=True):
        self.title = title
        self.process_name = process_name
        self.controls = controls or []
        self.visible = visible
        self.focus_count = 0

    def window_text(self):
        return self.title

    def is_visible(self):
        return self.visible

    def descendants(self, control_type=None):
        return [
            control
            for control in self.controls
            if control.visible and (control_type is None or control.control_type == control_type)
        ]

    def set_focus(self):
        self.focus_count += 1


class FakeDesktop:
    def __init__(self, windows):
        self._windows = windows
        self.backend = None

    def windows(self):
        return [window for window in self._windows if window.visible]


class WhatsAppWindowsTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.pdf_path = Path(self.temp.name) / "preventivo_cliente.pdf"
        self.pdf_path.write_bytes(b"%PDF-1.7 sample")
        self.desktop = None
        self.dialog = None
        self.attach_button = None
        self.document_item = None
        self.send_button = FakeControl("Send", "Button")

    def tearDown(self):
        self.temp.cleanup()

    def make_desktop(self, *, duplicate_attach=False, duplicate_document=False, no_dialog=False, cancelled=False, no_preview=False):
        app_controls = []

        def show_dialog():
            if self.dialog:
                self.dialog.visible = True

        document_items = []
        self.document_item = FakeControl("Document", "MenuItem", on_click=show_dialog, visible=False)
        document_items.append(self.document_item)
        if duplicate_document:
            document_items.append(FakeControl("Documento", "MenuItem", on_click=show_dialog, visible=False))

        def show_document_items():
            for item in document_items:
                item.visible = True

        self.attach_button = FakeControl("Attach", "Button", on_click=show_document_items)
        attach_buttons = [self.attach_button]
        if duplicate_attach:
            attach_buttons.append(FakeControl("Allega", "Button", on_click=show_document_items))
        app_controls.extend(attach_buttons + document_items + [self.send_button])
        app_window = FakeWindow("WhatsApp", "WhatsApp.exe", app_controls)

        if no_dialog:
            self.document_item.on_click = lambda: None

        def cancel_picker(_value):
            self.dialog.visible = False
            raise RuntimeError("file dialog was cancelled")

        filename = FakeControl(
            "File name:",
            "Edit",
            on_set=cancel_picker if cancelled else None,
        )
        def accept_pdf():
            self.dialog.visible = False
            if not no_preview:
                app_controls.append(FakeControl(self.pdf_path.name, "Text"))

        open_button = FakeControl("Open", "Button", on_click=accept_pdf)
        self.dialog = FakeWindow("Open", "WhatsApp.exe", [filename, open_button], visible=False)
        self.desktop = FakeDesktop([app_window, self.dialog])
        return self.desktop

    def run_attach(self, *, timeout_seconds=0.02, desktop=None, window_owner_checker=None):
        return attach_pdf_to_open_chat(
            self.pdf_path,
            timeout_seconds=timeout_seconds,
            desktop_factory=lambda **kwargs: desktop or self.desktop,
            process_name_resolver=lambda window: window.process_name,
            window_owner_checker=window_owner_checker,
            platform_name="nt",
        )

    def test_attaches_only_selected_pdf_through_document_dialog_and_never_clicks_send(self):
        desktop = self.make_desktop()

        result = self.run_attach(desktop=desktop)

        self.assertIsNone(result)
        self.assertEqual(self.attach_button.clicked, 1)
        self.assertEqual(self.document_item.clicked, 1)
        self.assertEqual(self.dialog.controls[0].value, str(self.pdf_path.resolve()))
        self.assertEqual(self.dialog.controls[1].clicked, 1)
        self.assertTrue(any(control.name == self.pdf_path.name for control in self.desktop._windows[0].controls))
        self.assertEqual(self.desktop._windows[0].focus_count, 2, "WhatsApp deve tornare in primo piano dopo la preparazione.")
        self.assertEqual(self.send_button.clicked, 0)

    def test_accepts_system_hosted_file_picker_only_when_owned_by_whatsapp(self):
        desktop = self.make_desktop()
        self.dialog.process_name = "ApplicationFrameHost.exe"

        self.run_attach(
            desktop=desktop,
            window_owner_checker=lambda dialog, app: dialog is self.dialog and app is desktop._windows[0],
        )

        self.assertTrue(any(control.name == self.pdf_path.name for control in desktop._windows[0].controls))
        self.assertEqual(self.send_button.clicked, 0)

    def test_rejects_system_hosted_file_picker_not_owned_by_whatsapp(self):
        desktop = self.make_desktop()
        self.dialog.process_name = "ApplicationFrameHost.exe"

        with self.assertRaisesRegex(RuntimeError, "selettore file"):
            self.run_attach(
                desktop=desktop,
                window_owner_checker=lambda _dialog, _app: False,
                timeout_seconds=0,
            )

        self.assertEqual(self.dialog.controls[0].value, None)
        self.assertEqual(self.send_button.clicked, 0)

    def test_does_not_report_success_until_pdf_name_is_visible_in_whatsapp(self):
        desktop = self.make_desktop(no_preview=True)

        with self.assertRaisesRegex(RuntimeError, "anteprima"):
            self.run_attach(desktop=desktop, timeout_seconds=0)
        self.assertEqual(self.send_button.clicked, 0)

    def test_aborts_when_whatsapp_window_is_missing(self):
        desktop = FakeDesktop([])
        with self.assertRaisesRegex(RuntimeError, "WhatsApp"):
            self.run_attach(desktop=desktop)

    def test_aborts_when_whatsapp_window_is_ambiguous(self):
        desktop = self.make_desktop()
        desktop._windows.append(FakeWindow("WhatsApp second window", "WhatsApp.exe"))

        with self.assertRaisesRegex(RuntimeError, "univoc"):
            self.run_attach(desktop=desktop)
        self.assertEqual(self.attach_button.clicked, 0)

    def test_aborts_when_attach_control_is_ambiguous(self):
        desktop = self.make_desktop(duplicate_attach=True)

        with self.assertRaisesRegex(RuntimeError, "Allega"):
            self.run_attach(desktop=desktop)
        self.assertEqual(self.document_item.clicked, 0)

    def test_aborts_when_document_control_is_ambiguous(self):
        desktop = self.make_desktop(duplicate_document=True)

        with self.assertRaisesRegex(RuntimeError, "Documento"):
            self.run_attach(desktop=desktop)
        self.assertEqual(self.dialog.visible, False)

    def test_aborts_if_document_picker_does_not_open_before_timeout(self):
        desktop = self.make_desktop(no_dialog=True)

        with self.assertRaisesRegex(RuntimeError, "selettore"):
            self.run_attach(desktop=desktop, timeout_seconds=0)
        self.assertEqual(self.send_button.clicked, 0)

    def test_aborts_if_file_picker_is_cancelled_before_path_selection(self):
        desktop = self.make_desktop(cancelled=True)

        with self.assertRaisesRegex(RuntimeError, "selettore"):
            self.run_attach(desktop=desktop)
        self.assertEqual(self.send_button.clicked, 0)


if __name__ == "__main__":
    unittest.main()
