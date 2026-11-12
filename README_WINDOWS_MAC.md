# Gestionale preventivi — versione di prova

Questa versione avvia il gestionale in una finestra desktop su macOS e Windows. Non include ancora un `.exe`: la preparazione dell’eseguibile Windows resta per una fase successiva alla verifica dell’app.

## Requisiti

- Python 3 installato.
- Connessione Internet solo al primo avvio, quando viene installato `pywebview` nell’ambiente `.venv` del progetto.
- Windows 10/11: WebView2 Runtime. Sui sistemi aggiornati è normalmente già disponibile.

## Avvio

### macOS

1. Apri `Avvia_gestionale.command` con un doppio clic. Se necessario, usa il menu contestuale **Apri**.
2. Attendi la creazione di `.venv` e l’installazione dei componenti al primo avvio.
3. Si apre la finestra **Gestionale preventivi**. Chiudila per uscire.

### Windows

1. Installa Python 3 e, se necessario, WebView2 Runtime.
2. Avvia `Avvia_gestionale_windows.bat`.
3. Al primo avvio vengono creati `.venv` e i componenti Python. Gli avvii successivi aprono direttamente la finestra.

Il progetto deve restare nella sua cartella: i moduli HTML originali e i relativi file grafici sono caricati localmente. La cartella `.venv` contiene solo dipendenze di sviluppo e può essere ricreata dal launcher.

## Archiviazione e PDF

In **Azienda e PDF** seleziona una cartella database e due cartelle PDF diverse. Il database è `preventivi.json`; le preferenze dei percorsi vengono conservate nella configurazione utente del sistema operativo.

- Se la cartella database contiene un archivio valido, il gestionale lo apre.
- Se la cartella è vuota, scegli se copiare i dati correnti o iniziare con un archivio vuoto.
- Se il file esistente non è valido, non viene sovrascritto.
- **Genera PDF cliente completo** produce riepilogo aziendale e cliente, importi, sconti, IVA, note e tutti i moduli compilati.
- **Genera PDF fornitore · soli moduli** assembla solo le pagine dei moduli, senza riepilogo commerciale o prezzi.
- In entrambe le uscite, i moduli riportano il nome del cliente e il riferimento del preventivo.
- I file vengono messi nelle rispettive cartelle. Le collisioni di nome ricevono un suffisso numerico, senza sovrascrivere i PDF esistenti.

Esporta periodicamente un backup JSON e custodiscilo separatamente dal computer. Il database non è cifrato.

## Lista di verifica prima dell’eseguibile Windows

- [ ] Avvio e chiusura della finestra su macOS.
- [ ] Selezione cartelle e riapertura dello stesso database su macOS.
- [ ] Creazione di cliente/preventivo e persistenza dopo riavvio.
- [ ] PDF cliente: dati azienda/cliente, riepilogo, importi e tutti i moduli.
- [ ] PDF fornitore: tutti i moduli, nome cliente e numero preventivo, nessun riepilogo o prezzo.
- [ ] Verifica dei due PDF e dei percorsi su Windows 10/11.
- [ ] Verifica backup/importazione su Windows.

Non creare né consegnare un eseguibile finché la verifica Windows non è completata e l’utente non ha approvato esplicitamente la fase di packaging.
