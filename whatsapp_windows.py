"""Copia verificata dei PDF e apertura indipendente delle chat WhatsApp su Windows."""

from __future__ import annotations

import hashlib
import logging
import os
import platform
import re
import subprocess
import threading
import time
from pathlib import Path
from typing import Any, Callable
from urllib.parse import quote
import webbrowser

_LOCK = threading.Lock()


def _is_windows() -> bool:
    return os.name == "nt"


def build_whatsapp_web_url(phone: str, text: str) -> str:
    if not isinstance(phone, str) or not phone.isdigit() or not 8 <= len(phone) <= 15:
        raise ValueError("Numero WhatsApp non valido.")
    return f"https://web.whatsapp.com/send?phone={phone}&text={quote(str(text), safe='')}"


def build_whatsapp_protocol_url(phone: str, text: str) -> str:
    if not isinstance(phone, str) or not phone.isdigit() or not 8 <= len(phone) <= 15:
        raise ValueError("Numero WhatsApp non valido.")
    return f"whatsapp://send?phone={phone}&text={quote(str(text), safe='')}"


def log_whatsapp_event(
    logger: logging.Logger,
    step: str,
    outcome: str,
    *,
    error: BaseException | None = None,
    app_version: str = "non rilevata",
    windows_version: str | None = None,
    duration_ms: int | None = None,
    error_type: str | None = None,
    filename: str = "",
) -> None:
    """Logga codici di fase e versioni, mai testo, numero, percorso o dettagli PDF."""
    logger.info(
        "whatsapp step=%s outcome=%s duration_ms=%s app_version=%s windows_version=%s error_type=%s filename=%s",
        step,
        outcome,
        duration_ms if duration_ms is not None else "n/a",
        app_version,
        windows_version if windows_version is not None else platform.version(),
        type(error).__name__ if error is not None else error_type or "none",
        Path(filename).name if filename else "n/a",
    )


def open_whatsapp_browser(
    phone: str,
    text: str,
    *,
    opener: Callable[[str], Any] | None = None,
) -> dict[str, Any]:
    url = build_whatsapp_web_url(phone, text)
    opened = webbrowser.open(url, new=2) if opener is None else opener(url)
    if opened is False:
        raise RuntimeError("Il browser predefinito non ha accettato il collegamento WhatsApp Web.")
    return {"browserOpened": True}


def _run_powershell(script: str) -> str:
    """Esegue PowerShell senza mostrare una finestra console."""
    if not _is_windows():
        raise RuntimeError("La copia file negli appunti è disponibile solo su Windows.")
    completed = subprocess.run(
        ["powershell.exe", "-NoLogo", "-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", script],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=10,
        check=False,
        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0x08000000),
    )
    if completed.returncode != 0:
        raise RuntimeError("Windows non è riuscito a verificare il file negli appunti.")
    return completed.stdout


def _powershell_quote(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def _clipboard_paths() -> list[str]:
    output = _run_powershell(
        "[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); "
        "$ErrorActionPreference='Stop'; Get-Clipboard -Format FileDropList | ForEach-Object { [Console]::Out.WriteLine([string]$_) }"
    )
    return [line.strip() for line in output.splitlines() if line.strip()]


def _set_clipboard_path(path: Path) -> None:
    """Copia un solo percorso PDF e lo verifica con FileDropList."""
    quoted = _powershell_quote(str(path.resolve(strict=True)))
    script = (
        "[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); "
        "$ErrorActionPreference='Stop'; "
        f"Set-Clipboard -Path {quoted}; "
        "$files=@(Get-Clipboard -Format FileDropList | ForEach-Object { [string]$_ }); "
        f"if ($files.Count -ne 1 -or [IO.Path]::GetFullPath($files[0]) -ine [IO.Path]::GetFullPath({quoted})) {{ exit 23 }}; "
        "[Console]::Out.WriteLine($files[0])"
    )
    output = _run_powershell(script).strip()
    if not output or Path(output).resolve() != path.resolve():
        raise RuntimeError("Gli appunti non contengono esattamente il PDF previsto.")

def _validate_document(path: Path, expected: dict[str, str]) -> dict[str, Any]:
    if not path.is_file() or path.stat().st_size <= 5:
        raise RuntimeError("Il PDF previsto è mancante o vuoto.")
    try:
        from pypdf import PdfReader
        reader = PdfReader(str(path), strict=True)
        if not reader.pages:
            raise ValueError("PDF senza pagine")
        text = "\n".join(page.extract_text() or "" for page in reader.pages)
        info = reader.metadata or {}
        keywords = str(info.get("/Keywords", ""))
        metadata = {}
        for token in re.split(r"\s*[,;]\s*|\s+(?=[A-Za-z_][A-Za-z0-9_]*=)", keywords):
            key, separator, value = token.strip().partition("=")
            if separator:
                metadata[key.strip()] = value.strip()
        for key, value in expected.items():
            if key.startswith("_"):
                continue
            # Un valore atteso vuoto (es. PDF senza destinatario) richiede che il metadato
            # sia assente o vuoto: pdf-lib non scrive affatto le chiavi vuote.
            if metadata.get(key, "") != str(value):
                raise ValueError(f"metadato {key} non corrispondente")
        if expected["kind"] == "supplier":
            reserved = re.compile(r"\b(?:total\w*|prezz\w*|scont\w*|import\w*|cost\w*|iva|installaz\w*|commercial\w*|euro|eur)\b|cliente:", re.I)
            currency_amount = re.compile(r"(?:€\s*\d[\d.,]*|\d[\d.,]*\s*(?:€|eur|euro))", re.I)
            if reserved.search(text) or currency_amount.search(text):
                raise ValueError("il PDF fornitore contiene dati commerciali o cliente")
            fields = reader.get_fields() or {}
            private_field = re.compile(r"cliente|client|note|prezz|cost|scont|import|totale|installaz|email|telefono|indirizzo|ragione|vat|fiscal", re.I)
            form_values = []
            for name, field in fields.items():
                value = field.get("/V") if hasattr(field, "get") else None
                if private_field.search(str(name)) and value not in (None, ""):
                    raise ValueError(f"campo riservato compilato nel PDF fornitore: {name}")
                if value not in (None, ""):
                    form_values.append(str(value))
            inspectable_text = " ".join((text, *form_values)).casefold()
            for term in expected.get("_forbidden_values", []):
                normalized = " ".join(str(term).casefold().split())
                if len(normalized) >= 4 and normalized in " ".join(inspectable_text.split()):
                    raise ValueError("Il PDF fornitore contiene un dato anagrafico del cliente.")
        digest = hashlib.sha256()
        with path.open("rb") as stream:
            for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                digest.update(chunk)
        return {"sha256": digest.hexdigest(), "size": path.stat().st_size, "pages": len(reader.pages)}
    except Exception as error:
        raise RuntimeError(f"Identità o contenuto del PDF non verificabile: {error}") from error


def create_pdf_receipt(path: str | Path, identity: dict[str, Any]) -> dict[str, Any]:
    pdf_path = Path(path).expanduser().resolve(strict=True)
    if pdf_path.suffix.casefold() != ".pdf":
        raise ValueError("Il documento selezionato non è un PDF.")
    kind = identity.get("kind")
    expected = {key: str(identity[key]) for key in ("quote_id", "revision", "kind")}
    if identity.get("recipient"):
        expected["recipient"] = str(identity["recipient"])
    if kind == "supplier":
        module_ids = identity.get("module_ids")
        if not isinstance(module_ids, list) or not module_ids or any(not isinstance(value, str) or not value for value in module_ids) or len(set(module_ids)) != len(module_ids):
            raise ValueError("Identità moduli del PDF fornitore non valida.")
        expected["module_ids"] = "|".join(module_ids)
        expected["_forbidden_values"] = identity.get("forbidden_values", [])
    details = _validate_document(pdf_path, expected)
    return {"path": str(pdf_path), "quote_id": identity["quote_id"], "revision": identity["revision"], "kind": kind, "recipient": str(identity.get("recipient", "")), "module_ids": list(identity.get("module_ids", [])), "forbidden_values": list(identity.get("forbidden_values", [])), "sha256": details["sha256"], "size": details["size"], "pages": details["pages"], "filename": pdf_path.name}


def _verified_receipt(path: Path, expected: dict[str, Any], receipt: dict[str, Any] | None) -> dict[str, Any]:
    if expected["kind"] == "supplier":
        expected["_forbidden_values"] = (receipt or {}).get("forbidden_values", [])
    details = _validate_document(path, expected)
    if not receipt or any(receipt.get(key) != expected.get(key) for key in ("quote_id", "revision", "kind", "recipient")):
        raise RuntimeError("La ricevuta del PDF non corrisponde al destinatario e alla revisione correnti.")
    if receipt.get("module_ids", []) != (expected.get("module_ids", "").split("|") if expected["kind"] == "supplier" else []):
        raise RuntimeError("La ricevuta del PDF non corrisponde ai moduli selezionati.")
    if receipt.get("sha256") != details["sha256"] or receipt.get("size") != details["size"] or receipt.get("pages") != details["pages"] or receipt.get("filename") != path.name:
        raise RuntimeError("Il PDF è cambiato dopo la creazione della ricevuta.")
    return details


def open_whatsapp_chat(
    phone: str,
    text: str = "",
    *,
    platform_name: str | None = None,
    protocol_launcher: Callable[[str], Any] | None = None,
    browser_opener: Callable[[str], Any] | None = None,
) -> dict[str, Any]:
    """Apre direttamente il protocollo; usa WhatsApp Web se Windows lo rifiuta."""
    if (platform_name or os.name) != "nt":
        raise RuntimeError("WhatsApp Desktop è disponibile solo su Windows.")
    uri = build_whatsapp_protocol_url(phone, text)
    logger = logging.getLogger("area_tenda_preventivi")
    started = time.monotonic()
    launcher = protocol_launcher or getattr(os, "startfile", None)
    try:
        if launcher is None:
            raise OSError("Avvio protocollo Windows non disponibile.")
        launcher(uri)
        log_whatsapp_event(logger, "open_chat_protocol", "opened", duration_ms=round((time.monotonic() - started) * 1000))
        return {"ok": True, "method": "protocol", "desktopOpened": True}
    except Exception as error:
        log_whatsapp_event(logger, "open_chat_protocol", "failed", error=error, duration_ms=round((time.monotonic() - started) * 1000))
    try:
        browser_started = time.monotonic()
        url = build_whatsapp_web_url(phone, text)
        opened = webbrowser.open(url, new=2) if browser_opener is None else browser_opener(url)
        if opened is False:
            raise RuntimeError("Browser non disponibile.")
        log_whatsapp_event(logger, "open_chat_browser_fallback", "opened", duration_ms=round((time.monotonic() - browser_started) * 1000))
        return {"ok": True, "method": "browser", "desktopOpened": False, "browserOpened": True}
    except Exception as error:
        log_whatsapp_event(logger, "open_chat_browser_fallback", "failed", error=error, duration_ms=round((time.monotonic() - started) * 1000))
        raise RuntimeError("Non riesco ad aprire la chat WhatsApp né nel programma né nel browser.") from error


def copy_pdf_to_clipboard(
    path: str,
    kind: str,
    quote_id: str,
    revision: str,
    module_ids: list[str] | None = None,
    receipt: dict[str, Any] | None = None,
    *,
    platform_name: str | None = None,
    clipboard_reader: Callable[[], list[str]] | None = None,
    clipboard_writer: Callable[[Path], None] | None = None,
) -> dict[str, Any]:
    """Valida e copia il PDF esatto come file, senza controllare l’interfaccia WhatsApp."""
    started = time.monotonic()
    pdf_path: Path | None = None
    try:
        if (platform_name or os.name) != "nt":
            raise RuntimeError("La copia del PDF negli appunti è disponibile solo su Windows.")
        if kind not in {"customer", "supplier"} or not quote_id or len(revision) != 64:
            raise ValueError("Tipo e identità del preventivo non verificabili.")
        pdf_path = Path(path).expanduser().resolve(strict=True)
        if pdf_path.suffix.casefold() != ".pdf":
            raise ValueError("Il documento selezionato non è un PDF.")
        expected_stem = f"preventivo_{quote_id}_{revision[:12]}_{'cliente' if kind == 'customer' else 'fornitore'}"
        if pdf_path.stem != expected_stem and not (pdf_path.stem.startswith(expected_stem + "_") and pdf_path.stem[len(expected_stem) + 1:].isdigit()):
            raise ValueError("Il nome del PDF non corrisponde a preventivo, revisione e tipologia correnti.")
        if not receipt:
            raise ValueError("Ricevuta PDF mancante. Rigenera il documento.")
        recipient = str(receipt.get("recipient", ""))
        expected: dict[str, Any] = {"quote_id": quote_id, "revision": revision, "kind": kind, "recipient": recipient}
        if kind == "supplier":
            if not module_ids or any(not isinstance(item_id, str) or not item_id for item_id in module_ids) or len(set(module_ids)) != len(module_ids):
                raise ValueError("Moduli del PDF fornitore non verificabili.")
            expected["module_ids"] = "|".join(module_ids)
        _verified_receipt(pdf_path, expected, receipt)
        clipboard_reader = clipboard_reader or _clipboard_paths
        clipboard_writer = clipboard_writer or _set_clipboard_path
        with _LOCK:
            clipboard_writer(pdf_path)
            paths = clipboard_reader()
            if len(paths) != 1 or Path(paths[0]).resolve() != pdf_path:
                raise RuntimeError("Gli appunti non contengono esattamente il PDF previsto. Usa Apri cartella.")
        log_whatsapp_event(logging.getLogger("area_tenda_preventivi"), "copy_pdf", "verified", duration_ms=round((time.monotonic() - started) * 1000), filename=pdf_path.name)
        return {"clipboardReady": True, "path": str(pdf_path), "filename": pdf_path.name, "kind": kind}
    except Exception as error:
        log_whatsapp_event(logging.getLogger("area_tenda_preventivi"), "copy_pdf", "failed", error=error, duration_ms=round((time.monotonic() - started) * 1000), filename=pdf_path.name if pdf_path else "")
        raise
