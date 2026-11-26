# Allegato automatico WhatsApp Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Dopo conferma esplicita del destinatario, preparare in WhatsApp Desktop l’allegato PDF cliente o fornitore, senza modificare gli appunti e senza inviarlo.

**Architecture:** Il front-end continua a generare e salvare il PDF corretto, apre la chat col protocollo WhatsApp e chiede conferma che la chat visibile sia quella scelta. Il bridge valida tipo e percorso del PDF; un helper Windows con UI Automation individua la finestra WhatsApp e usa il selettore standard dei documenti, interrompendosi se finestra o controlli sono ambigui. L’automazione si ferma all’anteprima dell’allegato.

**Tech Stack:** Python 3, pywebview 6.2.1, pywinauto 0.6.9 (stable, Windows-only, BSD-3-Clause, gratuito), JavaScript, Node `node:test`, Python `unittest`, PyInstaller.

**Spec:** `docs/superpowers/specs/2026-11-26-allegato-automatico-whatsapp-design.md`

## Global Constraints

- Allegare soltanto il PDF appena generato e salvato nella cartella configurata per il relativo tipo.
- Confermare il destinatario prima di avviare UI Automation; verificare che la finestra sia WhatsApp Desktop.
- Non usare né modificare gli appunti di sistema.
- Non digitare messaggi e non attivare mai il comando Invia.
- Non aggiornare gli indicatori di invio quando il PDF viene solo allegato.
- Nessun costo economico, servizio a pagamento, abbonamento o API a pagamento.
- Se il controllo accessibile o il selettore file non sono riconosciuti con certezza, abortire e lasciare il PDF disponibile per l’allegato manuale.
- Il collaudo finale richiede Windows isolato e dati fittizi; non pubblicare una release senza quel collaudo e approvazione.

## Review Focus

- Percorso arbitrario o PDF del tipo sbagliato: il bridge deve rifiutarlo prima di invocare l’automazione.
- Chat non confermata o finestra non WhatsApp: nessun controllo UI deve essere azionato.
- Controllo UI non univoco, lingua diversa o versione WhatsApp incompatibile: abort sicuro con messaggio comprensibile.
- Selettore file annullato o timeout: nessun invio, PDF salvato preservato e nessun indicatore registrato.
- Il PDF è allegato ma non inviato: l’operatore deve poter ispezionare l’anteprima e usare il pulsante Invia di WhatsApp manualmente.

---

### Task 1: Validazione del file e bridge limitato

**Files:**
- Modify: `desktop_app.py`
- Test: `tests/test_desktop_api.py`

**Interfaces:**
- Consumes: percorso ritornato da `generateQuotePdf(kind)` e cartelle in `LocalStore.settings`.
- Produces: metodo bridge `attach_whatsapp_pdf(kind: str, path: str, recipient_confirmed: bool) -> dict[str, bool]`.

- [x] Scrivere test fallibili per conferma mancante, percorso fuori dalla cartella del tipo, estensione/contenuto non PDF e chiamata consentita al driver.
- [x] Eseguire i test mirati e confermare che la nuova interfaccia sia assente o non valida.
- [x] Implementare validazione del tipo, conferma, path risolto dentro la directory PDF corretta, file esistente e firma `%PDF-`; non registrare telefono, percorso o dati cliente nei log.
- [x] Esporre il nuovo metodo nella allowlist `DesktopApi.EXPOSED_METHODS` e delegare l’automazione a una dipendenza iniettata, senza importare moduli Windows al caricamento su macOS.
- [x] Eseguire i test mirati e verificare che ogni rifiuto avvenga prima del driver.

### Task 2: Helper Windows UI Automation a fallimento sicuro

**Files:**
- Create: `whatsapp_windows.py`
- Modify: `requirements.txt`
- Test: `tests/test_whatsapp_windows.py`

**Interfaces:**
- Consumes: percorso PDF già validato dal bridge.
- Produces: `attach_pdf_to_open_chat(path: Path, *, timeout_seconds: float = 15) -> None`; solleva un errore operativo se non può identificare in modo univoco la finestra o i controlli.

- [x] Scrivere test con driver finto per finestra assente/multipla, controlli non univoci, selettore annullato, timeout e sequenza valida; asserire che il driver non esponga azioni d’invio.
- [x] Eseguire i test mirati e verificare che rilevino l’assenza dell’helper.
- [x] Aggiungere pywinauto stabile fissato a `0.6.9`; importarlo solo su Windows.
- [x] Individuare la finestra del processo WhatsApp Desktop con backend UIA, richiedere un solo controllo accessibile per “Allega”, uno per “Documento” e il dialogo file standard; selezionare il solo percorso ricevuto e fermarsi alla preview.
- [x] Abortire senza coordinate, scorciatoie globali o clipboard se controlli/finestra non corrispondono; restituire un messaggio che lasci l’operatore al flusso manuale.
- [x] Eseguire i test mirati e la suite Python completa.

### Task 3: Conferma nella UI e gestione degli esiti

**Files:**
- Modify: `gestionale.js`
- Modify: `Gestione_preventivi.html` (solo se serve un dialogo dedicato)
- Test: `tests/test_whatsapp_share.js`

**Interfaces:**
- Consumes: `generateQuotePdf(kind)`, `desktopBridge.open_whatsapp(phone)` e `desktopBridge.attach_whatsapp_pdf(kind, path, recipient_confirmed)`.
- Produces: flusso di condivisione che mostra tipo/nome file/destinatario, apre la chat, chiede conferma della chat visibile e poi allega il PDF senza inviarlo.

- [x] Scrivere test fallibili sull’ordine genera/salva, apertura chat, richiesta conferma, attach; annullamento, errore e assenza del bridge non devono chiamare attach né alterare i timestamp d’invio.
- [x] Eseguire il test mirato e confermare il comportamento attuale senza allegato.
- [x] Implementare il nuovo flusso mantenendo la scelta cliente/fornitore; dopo attach riuscito mostrare “PDF allegato, controlla l’anteprima e invia manualmente su WhatsApp”. Su errore mostrare il fallback manuale con il percorso già salvato.
- [x] Verificare che non esistano chiamate UIA al controllo “Invia” e che gli indicatori restino aggiornati solo dall’azione di conferma invio esistente.
- [x] Eseguire i test JavaScript mirati e la suite Node completa.

### Task 4: Build e collaudo Windows

**Files:**
- Modify: `.github/workflows/windows-installer.yml` solo se la build PyInstaller non include la dipendenza UIA necessaria.
- Modify: `README_WINDOWS_MAC.md`
- Modify: `docs/INSTALLAZIONE_WINDOWS.md`

**Interfaces:**
- Consumes: Tasks 1–3.
- Produces: workflow CI verde, istruzioni aggiornate e rapporto del test manuale su Windows isolato.

- [x] Eseguire test Python, JavaScript, controlli sintassi e `git diff --check`. Il workflow Windows resta da eseguire sul branch dedicato; la procedura può consumare minuti GitHub e non è stata avviata per rispettare il vincolo di costo.
- [ ] Su Windows 10/11 isolato, con dati fittizi, provare separatamente PDF cliente e fornitore; controllare destinatario, PDF allegato visibile, appunti invariati, assenza d’invio e fallback quando la UI WhatsApp non corrisponde.
- [ ] Annotare in GitHub Issue #1 i risultati reali e i limiti; lasciare la release pubblicata 1.0.6 invariata e non pubblicare una nuova release senza approvazione.
