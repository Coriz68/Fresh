# Gestionale Preventivi 1.0 — specifica installer Windows

## Intento

Produrre un installer Windows 10/11 a 64 bit consegnabile al cliente, denominato `Gestionale Preventivi 1.0 Setup.exe`, con numero versione applicativo `1.0.0`.

## Obiettivi

- Installare l’app desktop e i file HTML, JavaScript, immagini e moduli necessari senza richiedere Python sul computer del cliente.
- Creare collegamenti dal menu Start e offrire la normale procedura di disinstallazione Windows.
- Conservare database, impostazioni e PDF nelle cartelle scelte dall’utente, fuori dalla directory d’installazione e intatti durante aggiornamenti o disinstallazione.
- Generare l’installer su un runner Windows x64 e pubblicarlo come artefatto scaricabile, con hash SHA-256 e istruzioni per l’installazione.
- Dichiarare chiaramente l’eventuale prerequisito WebView2 Evergreen e lo stato di firma digitale dell’installer.

## Fuori ambito

- Firma Authenticode, che richiede un certificato e credenziali non presenti nel progetto.
- Modifica dei flussi preventivi o dei contenuti dei PDF.
- Caricamento di dati operativi o database dei clienti nel processo di build.

## Approcci considerati

1. **Build privata su GitHub Actions Windows (scelto)** — Un workflow `windows-latest` crea l’app Windows con PyInstaller, la avvolge in un setup Inno Setup versione 1.0.0, verifica i file e carica l’installer come artefatto. È ripetibile e usa un sistema Windows reale, necessario per costruire e controllare il pacchetto Windows.
2. **Build locale manuale su PC Windows** — Produce lo stesso pacchetto, ma richiede l’installazione e l’esecuzione manuale di Python, PyInstaller e Inno Setup e rende meno ripetibili le build.
3. **Build cross-platform da macOS** — Scartata: il progetto non ha Wine, Inno Setup o un ambiente Windows e PyInstaller non produce un’app Windows da questo host macOS ARM.

## Architettura del pacchetto

- Applicazione: PyInstaller in modalità `onedir`, includendo `desktop_app.py`, `local_store.py`, `Gestione_preventivi.html`, gli script e gli stili JS/CSS, `Moduli/`, `Disegni/` e il logo.
- Installer: Inno Setup con `AppVersion=1.0.0`, architettura x64, percorso di installazione sotto Program Files, collegamento Start e disinstallazione standard.
- Dati: restano nelle directory utente o scelte in configurazione; nessun file utente viene messo o rimosso con i file del programma.
- WebView2: il setup controlla il runtime Evergreen e mostra istruzioni chiare se manca; non include un runtime Microsoft non redistribuibile dal progetto.
- Rilascio: `Gestionale Preventivi 1.0 Setup.exe`, SHA-256 e log della build. L’installer sarà dichiarato non firmato finché non è disponibile un certificato Authenticode.

## Vincoli e approvazioni

- Il worktree corrente non ha un remoto Git e il runner locale è macOS ARM; il connettore GitHub non mostra repository disponibili.
- Per eseguire la build automatica il codice sorgente dovrà essere caricato in un repository **privato** accessibile a GitHub Actions. Nessun dato cliente o archivio locale deve essere caricato.
- L’installer finale dovrà superare controlli di integrità e contenuto sul runner Windows. La verifica visiva e funzionale dell’installazione su un PC Windows reale resta necessaria prima di dichiararlo collaudato.

## Chiamate lasciate al builder

- Aggiungere metadati di versione e configurazione PyInstaller/Inno Setup.
- Creare workflow Windows che esegua i test, produca il setup, verifichi la presenza dei moduli e degli asset, e pubblichi l’artefatto con hash.
- Aggiornare il manuale e le istruzioni di installazione per la versione 1.0.
