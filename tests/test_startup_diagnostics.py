import logging
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from desktop_app import DesktopRequestHandler, configure_app_logging, initialize_desktop_api


class StartupDiagnosticsTests(unittest.TestCase):
    def test_http_access_log_works_when_stderr_is_unavailable(self):
        handler = DesktopRequestHandler.__new__(DesktopRequestHandler)

        with patch.object(sys, "stderr", None):
            handler.log_message("GET /Gestione_preventivi.html 200")

    def test_configure_app_logging_writes_to_local_log_file(self):
        with tempfile.TemporaryDirectory() as temp:
            logger, path = configure_app_logging(Path(temp))
            try:
                logger.info("startup test event")
                for handler in logger.handlers:
                    handler.flush()
                self.assertEqual(path.parent, Path(temp))
                self.assertIn("startup test event", path.read_text(encoding="utf-8"))
            finally:
                for handler in list(logger.handlers):
                    logger.removeHandler(handler)
                    handler.close()

    def test_corrupt_local_settings_are_logged_and_reported_as_configuration_error(self):
        with tempfile.TemporaryDirectory() as temp:
            settings_dir = Path(temp) / "settings"
            settings_dir.mkdir()
            (settings_dir / "settings.json").write_text("{corrupt", encoding="utf-8")
            logger, path = configure_app_logging(Path(temp) / "logs")
            try:
                with self.assertRaisesRegex(RuntimeError, "Configurazione locale non leggibile"):
                    initialize_desktop_api(settings_dir)
                for handler in logger.handlers:
                    handler.flush()
                self.assertIn("local settings initialization failed", path.read_text(encoding="utf-8"))
            finally:
                for handler in list(logger.handlers):
                    logger.removeHandler(handler)
                    handler.close()


if __name__ == "__main__":
    unittest.main()
