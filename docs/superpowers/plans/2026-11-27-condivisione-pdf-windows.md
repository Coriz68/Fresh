# Condivisione PDF Windows Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dopo la generazione del PDF, aprire Esplora file con il file selezionato e lasciare all’utente Condividi → WhatsApp, scelta destinatario e invio.

**Architecture:** Il frontend usa un nuovo metodo bridge `reveal_pdf_in_explorer(kind: str, path: str) -> dict[str, bool]`. Il bridge valida il PDF nella cartella configurata per il tipo e avvia Explorer con `/select,<path>`; non apre WhatsApp, non modifica gli appunti e non automatizza l’invio.

**Tech Stack:** JavaScript, Python 3, pywebview, Windows Explorer, Python `unittest`, Node `node:test`.

**Spec:** `docs/superpowers/specs/2026-11-27-condivisione-pdf-windows-design.md`

## Global Constraints

- Generare e salvare il PDF corretto prima di aprire Esplora file; evidenziare quel file, senza avviare WhatsApp né chiedere al gestionale di selezionare un destinatario.
- Il bridge accetta solo un PDF esistente nella cartella configurata per il suo tipo (cliente/fornitore); non apre percorsi arbitrari.
- Non usare o modificare gli appunti. Non automatizzare la scelta del contatto, l’allegato nel pannello, né il pulsante Invia.
- Se Esplora file non può essere aperto, lasciare il PDF salvato e mostrarne il percorso per l’allegato manuale.
- Nessun servizio o dipendenza a pagamento. Nessun tag o release finché il flusso non è verificato su Windows.

## Review Focus

- Tipo PDF non riconosciuto o cartella di output non configurata: rifiutare la richiesta.
- Percorso fuori dalla cartella corretta, file mancante, estensione o firma PDF errata: rifiutare senza aprire Explorer.
- Chiamata su sistema non Windows o avvio di Explorer non riuscito: restituire errore e conservare il PDF.
- Generazione annullata o fallita: non aprire Explorer né avviare WhatsApp.
- Cliente e fornitore: mantenere la cartella specifica e indicare il file appena generato.

---

### Task 1: Sostituire l’apertura WhatsApp con la selezione del PDF in Explorer

**Files:**
- Modify: `desktop_app.py`
- Modify: `gestionale.js`
- Test: `tests/test_desktop_api.py`
- Test: `tests/test_whatsapp_share.js`

**Interfaces:**
- Consumes: `generateQuotePdf(kind) -> { path } | null`; impostazioni `customer_pdf_dir` e `supplier_pdf_dir`.
- Produces: metodo bridge `reveal_pdf_in_explorer(kind: str, path: str) -> dict[str, bool]`, limitato al PDF valido nella cartella configurata; comando Explorer `explorer.exe /select,<resolved path>`.

- [x] **Step 1: Aggiornare i test bridge** per accettare solo PDF autentici nelle rispettive cartelle e verificare l’avvio di Explorer con il percorso risolto; verificare anche errori per tipo/cartella/percorso/contenuto non validi e piattaforma non Windows.
- [x] **Step 2: Aggiornare il test del flusso UI** per verificare che generi il PDF, chiami `reveal_pdf_in_explorer` e mostri le istruzioni Condividi → WhatsApp; verificare che nessuna chiamata apra WhatsApp o automatizzi un allegato.
- [x] **Step 3: Implementare il bridge** con validazione di tipo, cartella, esistenza, estensione e firma `%PDF-`; avviare `explorer.exe` selezionando il file e propagare un errore operativo se il sistema o Explorer non sono disponibili.
- [x] **Step 4: Modificare il flusso frontend** rimuovendo prompt del numero, apertura URI WhatsApp e automazione dell’allegato; se la generazione riesce, chiamare il nuovo bridge e spiegare che l’utente deve scegliere Condividi → WhatsApp, controllare il destinatario e inviare manualmente. Se la generazione fallisce, non aprire Explorer.
- [x] **Step 5: Eseguire le verifiche automatiche mirate** (`python -m unittest tests.test_desktop_api` e `node --test tests/test_whatsapp_share.js`) e controllare che il diff sia pulito.

### Task 2: Rimuovere la vecchia automazione e aggiornare le istruzioni

**Files:**
- Delete: `whatsapp_windows.py`
- Delete: `tests/test_whatsapp_windows.py`
- Modify: `requirements.txt`
- Modify: `docs/INSTALLAZIONE_WINDOWS.md`
- Modify: `README_WINDOWS_MAC.md`
- Modify: `Istruzioni_gestionale.txt`
- Modify: `tests/test_desktop_api.py`
- Modify: `tests/test_whatsapp_share.js`
- Modify: `tests/test_preventivi_v1_0_6.js`

**Interfaces:**
- Consumes: il nuovo flusso Explorer prodotto dal Task 1.
- Produces: nessuna dipendenza da `pywinauto`, nessun metodo bridge esposto per l’avvio WhatsApp o automazione UI dell’allegato; documentazione Windows coerente con Condividi → WhatsApp.

- [x] **Step 1: Rimuovere il codice UIA e la dipendenza** `pywinauto==0.6.9`, insieme ai test esclusivi del helper eliminato.
- [x] **Step 2: Aggiornare documentazione e test bridge** eliminando istruzioni obsolete sull’allegato automatizzato e mantenendo l’elenco `EXPOSED_METHODS` coerente con il solo metodo Explorer.
- [x] **Step 3: Eseguire le verifiche automatiche mirate** delle suite Python e JavaScript, più `git diff --check`.

## Verifica manuale Windows

Con PDF fittizi cliente e fornitore, verificare che Explorer evidenzi il file corretto, che **Condividi → WhatsApp** prepari il documento, che l’utente possa scegliere e verificare il destinatario, che gli appunti restino invariati e che nessun invio parta automaticamente. Verificare anche il fallback quando WhatsApp non è tra le destinazioni.
