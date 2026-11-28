# Invio WhatsApp sicuro — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allegare al destinatario corretto il solo PDF verificato della revisione corrente, fermandosi prima dell’invio.

**Architecture:** JavaScript crea PDF con identità immutabile, revision hash e contenuti separati per cliente/fornitore. Il bridge Python convalida il file con pypdf; l’helper Windows usa CF_HDROP e UI Automation per verificare chat, focus, Ctrl+V e anteprima filename. Nessun Invio viene simulato e gli appunti restano sul PDF previsto in caso di errore.

**Tech Stack:** Python 3.12, pywebview, JavaScript, pdf-lib, pypdf 7.2.0, pywinauto 0.6.9, Windows CF_HDROP, unittest, Node `node:test`, PyInstaller, Inno Setup e GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-11-28-whatsapp-clipboard-safety-design.md`

## Global Constraints

- Niente servizi esterni, API a pagamento o costi aggiuntivi.
- Non inviare automaticamente e non premere Invio.
- Aggiornare gli indicatori invio solo dopo conferma esplicita separata.
- Il fornitore non riceve dati personali del cliente, prezzi, sconti, costi di installazione o riepiloghi economici.
- Aggiornamento versione a 1.0.7; generare installer Windows x64; non dichiarare risolto prima del test reale sul PC cliente.

## Review Focus

- Preventivo modificato o duplicato mentre il PDF viene creato: fermare la condivisione e non allegare una revisione obsoleta.
- PDF differente, danneggiato, vuoto o con metadati discordanti: bloccare prima di copiare/allegare.
- Clipboard sovrascritta da un’altra operazione: serializzare il gestionale, rilevare la sequenza e ripristinare solo il file previsto.
- Finestra WhatsApp/compositore/anteprima non univoci o senza focus verificabile: fallire chiuso senza tasti ciechi.
- Note e campi liberi nei moduli fornitore: filtrare e ispezionare l’output PDF prima di consentire l’allegato.

---

### Task 1: Identità PDF, revisione e PDF fornitore privato

**Files:** `gestionale.js`, `gestionale-pdf.js`, `tests/test_preventivi_v1_0_6.js`, `tests/test_quote_pdf_layout.js`.

- [x] Scrivere test per identità UUID/revisione/tipo, nomi file distinti, modifica/duplicazione e filtro riservati basato su tutti i 32 schemi.
- [x] Verificare metadata e contenuti commerciali/riservati con test sintetici; il test su `pypdf` reale gira nel workflow Windows (dipendenza non installabile localmente senza rete).
- [x] Implementare snapshot e fingerprint SHA-256; fallire se il preventivo cambia prima del salvataggio o dell’allegato.
- [x] Implementare metadati `quote_id`, `revision`, `kind`, destinatario e moduli selezionati; eliminare dati cliente dal PDF fornitore.
- [x] Eseguire i test Node mirati senza modificare formule del PDF cliente.

### Task 2: Convalida dell’artefatto PDF nel bridge locale

**Files:** `requirements.txt`, `local_store.py`, `desktop_app.py`, `tests/test_local_store.py`, `tests/test_desktop_api.py`.

- [x] Scrivere test per file mancante/danneggiato, hash, metadati, tipo/revisione, quote differenti e privacy fornitore.
- [x] Aggiungere pypdf 7.2.0; il bridge salva il documento con `LocalStore`, lo riapre, verifica metadata/pagine/contenuti e rilascia una receipt SHA-256.
- [x] Esporre solo i metodi bridge necessari; i log non includono destinatario o contenuto documento.
- [x] Eseguire le suite Python; database e percorsi esistenti rimangono invariati.

### Task 3: Clipboard CF_HDROP e automazione WhatsApp a fallimento sicuro

**Files:** `requirements.txt`, `whatsapp_windows.py`, `desktop_app.py`, `tests/test_whatsapp_windows.py`, `tests/test_desktop_api.py`.

- [x] Aggiungere test fake per appunti corretti/precedenti, finestra assente/multipla, focus mancante, filename vecchio/errato, timeout e assenza di Invio.
- [x] Implementare CF_HDROP, sequence number e lock; mantenere il percorso già corretto e ripristinare il solo documento atteso su errore.
- [x] Usare pywinauto 0.6.9; selezionare un’unica finestra WhatsApp, attendere focus/compositore e validare una nuova preview col nome completo.
- [x] Validare receipt, destinatario, percorso e nome file prima della UI; serializzare l’accesso agli appunti.
- [x] Eseguire test isolati su macOS; il contatto UI reale resta collaudo Windows.

### Task 4: Orchestrazione dei due flussi e indicatori

**Files:** `gestionale.js`, `tests/test_whatsapp_share.js`, `tests/test_preventivi_v1_0_6.js`.

- [x] Coprire entrambe le sequenze, cambio preventivo, duplicazione e timestamp indipendenti.
- [x] Aprire il destinatario validato e richiederne la conferma; chiedere telefono e moduli pertinenti del fornitore.
- [x] Mostrare bozza allegata solo con nuova preview verificata; su errore mostrare la stringa Ctrl+V richiesta.
- [x] Mantenere separati i due timestamp e la conferma esplicita esistente.
- [x] Eseguire tutti i test Node; nessuna azione Invia viene invocata.

### Task 5: Documentazione, versione e CI Windows

**Files:** README, istruzioni, documentazione installazione, workflow Windows, metadata PyInstaller/Inno Setup/versione, test di versione.

- [x] Aggiornare guide con flusso, fallback e distinzione tra test automatici e collaudo cliente.
- [x] Incrementare versione da 1.0.6 a 1.0.7 e nomi artefatto/checksum.
- [x] Configurare workflow per dipendenze, test, PyInstaller, Inno Setup e SHA-256.
- [x] Eseguire le suite complete locali, sintassi e `git diff --check`; build Windows è demandata al workflow CI.

### Task 6: Aggiornamento GitHub e artefatto Windows

**Files:** branch GitHub `fix/whatsapp-pdf-attachment`, tag `v1.0.7`, artefatto workflow.

- [ ] Commit e push del branch dopo test verdi e revisione diff.
- [ ] Creare il tag `v1.0.7` solo sul commit verificato per attivare il workflow Windows e attendere esito.
- [ ] Recuperare l’artefatto installer/checksum e documentare link/commit.
- [ ] Lasciare esplicito che il collaudo sul PC cliente con WhatsApp `2.3000.1056466723.264501` non è eseguibile dal runner/macOS e resta necessario prima di dichiarare risolto o pubblicare una release.
