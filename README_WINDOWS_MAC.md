# Gestionale preventivi — versione 1.0.15 · CorradoWEB 2026

Il progetto include la configurazione per creare il setup Windows x64 `Gestionale Preventivi 1.0.15 Setup.exe` tramite GitHub Actions. Il setup usa PyInstaller e Inno Setup e non richiede Python sul computer del cliente. Per prerequisiti, download e installazione consulta [docs/INSTALLAZIONE_WINDOWS.md](docs/INSTALLAZIONE_WINDOWS.md).

## Requisiti

- Python 3 installato.
- Connessione Internet solo al primo avvio, quando viene installato `pywebview` nell’ambiente `.venv` del progetto.
- Windows 10/11: WebView2 Runtime. Il setup Windows lo installa automaticamente se manca e in quel caso richiede Internet.

## Avvio

### macOS

1. Apri `Avvia_gestionale.command` con un doppio clic. Se necessario, usa il menu contestuale **Apri**.
2. Attendi la creazione di `.venv` e l’installazione dei componenti al primo avvio.
3. Si apre la finestra **Gestionale preventivi**. Usa **Chiudi programma** per salvare e uscire in sicurezza.

### Windows — avvio dalla sorgente

1. Installa Python 3 e, se necessario, WebView2 Runtime.
2. Avvia `Avvia_gestionale_windows.bat`.
3. Al primo avvio vengono creati `.venv` e i componenti Python. Gli avvii successivi aprono direttamente la finestra.

Il setup per la distribuzione installa invece l'applicazione autonoma. Se Microsoft Edge WebView2 Evergreen Runtime manca, il setup lo installa automaticamente tramite il bootstrapper ufficiale Microsoft; in quel caso serve una connessione Internet.

Il progetto deve restare nella sua cartella: i moduli HTML originali e i relativi file grafici sono caricati localmente. La cartella `.venv` contiene solo dipendenze di sviluppo e può essere ricreata dal launcher.

## Archiviazione e PDF

In **Azienda e PDF** seleziona una cartella database e due cartelle PDF diverse. Il database è `preventivi.json`; le preferenze dei percorsi vengono conservate nella configurazione utente del sistema operativo.

- Se la cartella database contiene un archivio valido, il gestionale lo apre.
- Se la cartella è vuota, scegli se copiare i dati correnti o iniziare con un archivio vuoto.
- Se il file esistente non è valido, non viene sovrascritto.
- **Genera PDF cliente completo** produce riepilogo aziendale e cliente, importi, sconti, IVA, note e tutti i moduli compilati.
- **Genera PDF fornitore · soli moduli** assembla solo le pagine dei moduli, senza riepilogo commerciale o prezzi.
- Il PDF cliente contiene i dati anagrafici e il riepilogo economico. Il PDF fornitore contiene solo i moduli tecnici selezionati e non include dati cliente, prezzi, sconti, IVA, costi di installazione o riepiloghi economici.
- I file vengono messi nelle rispettive cartelle. Le collisioni di nome ricevono un suffisso numerico, senza sovrascrivere i PDF esistenti.
- Ogni PDF salvato ha un nome distinto con identificativo del preventivo, revisione e tipo (`cliente` o `fornitore`); i nomi duplicati ricevono un suffisso numerico senza sovrascrivere file precedenti. Nell’anteprima ci sono tre azioni indipendenti: **Copia PDF cliente/fornitore**, **Apri chat WhatsApp**, **Apri cartella**. Su Windows, Copia PDF usa `Set-Clipboard -Path` e verifica il contenuto con `Get-Clipboard -Format FileDropList`; in caso di errore suggerisce Apri cartella. Apri chat valida il numero e prova `whatsapp://send`; solo se Windows rifiuta il protocollo apre WhatsApp Web. Aprire la chat non tocca gli appunti. Poi l’operatore preme Ctrl+V, controlla l’allegato e invia manualmente. L’app non automatizza la UI WhatsApp e non dichiara l’invio riuscito. Su macOS resta disponibile il percorso browser/Finder per allegare manualmente; la copia file negli appunti è disattivata.
- In caso di problemi, il registro tecnico locale con metodo, fase, durata, esito e tipo di errore si trova in `logs/app.log` nella cartella dati dell’applicazione; non registra numeri, percorsi o contenuti dei PDF.

Nell’aggiornamento da 1.0.5 a 1.0.6 l’archivio esistente viene salvato in una copia di sicurezza prima dell’aggiunta dei campi di stato invio. Le versioni successive preservano gli stessi dati locali. Esporta periodicamente un backup JSON e custodiscilo separatamente dal computer. Il database non è cifrato.

## Verifiche

- [ ] Avvio e chiusura della finestra su macOS.
- [ ] Selezione cartelle e riapertura dello stesso database su macOS.
- [ ] Creazione di cliente/preventivo e persistenza dopo riavvio.
- [ ] PDF cliente: dati azienda/cliente, riepilogo, importi e tutti i moduli.
- [ ] PDF fornitore: solo moduli pertinenti, nessun dato cliente, importo, prezzo o riepilogo economico.
- [ ] Verifica dei due PDF e dei percorsi su Windows 10/11.
- [ ] Verifica backup/importazione su Windows.
- [ ] Prova installazione, avvio e disinstallazione del setup su Windows 10/11.
