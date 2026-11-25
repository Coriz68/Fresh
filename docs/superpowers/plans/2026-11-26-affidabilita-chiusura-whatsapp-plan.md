# Stabilità e condivisione WhatsApp Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Correggere i blocchi e rendere osservabili gli errori, aggiungendo uscita sicura e condivisione assistita dei due PDF tramite WhatsApp.

**Architecture:** Il processo Python conserva tutte le operazioni locali e limita la superficie API esposta alla pagina. JavaScript resta responsabile della preparazione del PDF e del salvataggio locale; dopo il successo apre WhatsApp con un messaggio precompilato, senza inviare file o messaggi automaticamente. Le chiamate di chiusura non devono bloccare il thread della finestra.

**Tech Stack:** Python 3, pywebview 6.2.1, JavaScript, PDFLib, PyInstaller, Inno Setup, unittest e node:test.

**Spec:** `docs/superpowers/specs/2026-11-26-affidabilita-chiusura-whatsapp-design.md`

## Global Constraints

- Versione destinazione: 1.0.5; metadati eseguibile, installer e workflow devono coincidere.
- Database e PDF restano salvati localmente nelle cartelle configurate.
- La condivisione WhatsApp è assistita: allegato e invio restano azioni manuali dell’utente.
- Nessuna credenziale WhatsApp o chiamata Business API viene aggiunta.
- Gli errori di salvataggio non devono chiudere l’app né far apparire conferme di salvataggio false.
- Il log locale non deve includere dati personali dei clienti, testo delle note, contenuto dei PDF o token.

## Review Focus

- Bridge mai pronto o callback di chiusura assente: il tentativo deve andare in timeout e lasciare la finestra utilizzabile.
- Chiusura con modulo aperto e modifiche recenti: i dati del modulo devono essere letti prima del salvataggio definitivo.
- Scrittura database fallita: app e preventivo restano aperti e l’errore viene registrato e mostrato.
- Avvio packaged con `sys.stderr is None`: il server locale deve servire comunque le pagine.
- Note con ritorni a capo o caratteri di controllo: il PDF deve essere generato con testo leggibile.
- WhatsApp non disponibile o link rifiutato: il PDF già salvato resta integro e l’utente riceve un errore chiaro.

---

### Task 1: Diagnostica di avvio e server locale

**Files:**
- Modify: `desktop_app.py`
- Test: `tests/test_desktop_api.py` o nuovo `tests/test_startup_diagnostics.py`

**Interfaces:**
- Produce: logger rotante nella cartella dati applicativa locale; gestore HTTP che non scrive su `sys.stderr` senza controllo; eccezioni di startup registrate con causa precisa.

- [x] **Step 1: Aggiungere test fallibili** per il gestore HTTP con `sys.stderr = None`, per l’inizializzazione con `settings.json` corrotto e per la registrazione degli errori senza includere dati del preventivo.
- [x] **Step 2: Eseguire i test** e verificare che falliscano sui percorsi attuali.
- [x] **Step 3: Implementare logging locale rotante**, `sys.excepthook` e `threading.excepthook`; usare un `SimpleHTTPRequestHandler` che registra tramite logger e non richiede stderr.
- [x] **Step 4: Eseguire i test mirati** e verificare gestione pulita di settings corrotti e server senza stderr.

### Task 2: API pywebview limitata

**Files:**
- Modify: `desktop_app.py`
- Test: `tests/test_desktop_api.py`

**Interfaces:**
- Consumes: API host del Task 1.
- Produces: stato e finestra conservati in attributi privati; solo metodi operativi necessari esposti al bridge.

- [x] **Step 1: Aggiungere test fallibili** che verificano che `store` e `window` e i relativi metodi non siano pubblici né esposti; fissare la lista consentita di metodi bridge.
- [x] **Step 2: Eseguire i test** e confermare che individuino gli attributi attuali.
- [x] **Step 3: Rendere privati gli oggetti interni** e mantenere un elenco esplicito delle funzioni necessarie alla UI.
- [x] **Step 4: Eseguire i test mirati** usando la versione pywebview fissata nelle dipendenze.

### Task 3: Chiusura sicura e pulsante in finestra

**Files:**
- Modify: `desktop_app.py`, `Gestione_preventivi.html`, `gestionale.js`, `gestionale-desktop.css`
- Test: `tests/test_desktop_api.py` e test UI/JS dedicato

**Interfaces:**
- Consumes: API limitata del Task 2.
- Produces: pulsante **Chiudi programma** disponibile solo in modalità desktop; close coordinator con callback, timeout e protezione dai tentativi duplicati.

- [x] **Step 1: Aggiungere test fallibili** per modulo aperto, salvataggio riuscito/fallito, callback assente, timeout, secondo click e chiusura nativa X.
- [x] **Step 2: Eseguire i test** e confermare le condizioni che lasciano `pending` bloccato o invocano JS dal gestore sincrono.
- [x] **Step 3: Spostare il flush JS fuori dal gestore bloccante**, cancellare lo stato pending su timeout, e distruggere la finestra solo dopo salvataggio riuscito. Il pulsante dell’interfaccia usa lo stesso flusso.
- [x] **Step 4: Eseguire i test mirati** e provare il flusso su macOS, incluso il pulsante e la X nativa.

### Task 4: Testo robusto per PDF cliente

**Files:**
- Modify: `gestionale-pdf.js`
- Test: `tests/test_quote_pdf_layout.js`

**Interfaces:**
- Produces: testo normalizzato prima delle chiamate PDFLib; note multilinea non causano eccezioni di codifica.

- [x] **Step 1: Aggiungere test fallibili** per `\n`, `\r\n`, tab, controlli C0/C1, parola molto lunga e nota di un milione di caratteri.
- [x] **Step 2: Eseguire il test** e confermare il fallimento sulle note multilinea.
- [x] **Step 3: Normalizzare gli a capo e rimuovere i caratteri di controllo**, preservando testo utile e puntini di troncamento.
- [x] **Step 4: Eseguire il test PDF mirato** e controllare che il limite di misurazioni resti logaritmico per testi lunghi.

### Task 5: Due azioni di condivisione assistita WhatsApp

**Files:**
- Modify: `gestionale.js`, `desktop_app.py`, `Gestione_preventivi.html`
- Test: test JavaScript per flusso/URL e test Python per apertura URL consentita

**Interfaces:**
- Consumes: generazione PDF cliente/fornitore e cartelle già configurate.
- Produces: due pulsanti in preventivo; link `wa.me` con messaggio precompilato; apertura del browser predefinito solo dopo generazione e salvataggio riusciti.

- [x] **Step 1: Aggiungere test fallibili** per tipo di PDF, numero preventivo e nome cliente nel testo, ordine salva-prima/apri-dopo e rifiuto di URL esterni non WhatsApp.
- [x] **Step 2: Eseguire i test** e confermare che manca l’azione bridge e l’ordine richiesto.
- [x] **Step 3: Aggiungere `open_whatsapp` con allowlist HTTPS stretta** e i pulsanti **WhatsApp cliente** e **WhatsApp fornitore**. I pulsanti riusano il generatore, verificano il salvataggio e aprono WhatsApp col testo; la UI ricorda di selezionare il contatto, allegare il file dalla cartella e premere Invia.
- [x] **Step 4: Eseguire i test mirati** e verificare in un browser desktop che link e testo si aprano senza inviare nulla.

### Task 6: Versione e verifica rilascio 1.0.5

**Files:**
- Modify: `.github/workflows/windows-installer.yml`, `packaging/windows/GestionalePreventivi.iss`, `packaging/windows/version_info.txt`, `README_WINDOWS_MAC.md`, `docs/INSTALLAZIONE_WINDOWS.md`, istruzioni versione

**Interfaces:**
- Consumes: Tasks 1–5.
- Produces: installer e artefatto Windows 1.0.5 con checksum corrispondente.

- [ ] **Step 1: Aggiornare tutti i metadati 1.0.5**, compresi i campi filevers/prodvers che ora riportano un numero precedente.
- [ ] **Step 2: Eseguire suite Python e JavaScript**, controlli sintassi e `git diff --check`.
- [ ] **Step 3: Eseguire CI Windows** e verificare file inclusi, setup e checksum.
- [ ] **Step 4: Installare e provare su un Windows reale** avvio, chiusura, persistenza, PDF e link WhatsApp; annotare esplicitamente qualsiasi prova non eseguibile.
- [ ] **Step 5: Consegnare installer e checksum** insieme alle istruzioni d’uso WhatsApp assistito.
