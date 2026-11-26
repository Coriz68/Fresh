# Gestionale Preventivi 1.0.6 — CorradoWEB 2026 — installazione Windows

## Requisiti

- Windows 10 o 11 a 64 bit.
- Connessione Internet se Microsoft Edge WebView2 Evergreen Runtime non è già presente. Il setup lo installa automaticamente solo quando manca.
- Python non è richiesto sul computer di destinazione.

## Installazione

1. Scarica `Gestionale Preventivi 1.0.6 Setup.exe` e `SHA256SUMS.txt` dall'artefatto Windows x64 della build.
2. Confronta l'hash SHA-256 del setup con quello riportato nel file.
3. Avvia il setup. Windows può segnalare che l'app è di un autore sconosciuto: l'eseguibile non è firmato digitalmente.
4. Segui la procedura guidata e avvia il gestionale dal menu Start.

Il setup installa il programma in Program Files e crea la voce di disinstallazione di Windows. Database, impostazioni e PDF restano nelle cartelle locali configurate dall'utente, fuori dalla cartella del programma; aggiornamento e disinstallazione non rimuovono i dati. Al primo avvio della 1.0.6, il programma crea una copia byte per byte dell’archivio prima della migrazione; se la copia non riesce, l’archivio resta invariato e l’avvio segnala l’errore. L’aggiornamento non introduce un updater automatico.

Per l'aggiornamento in-place dalla 1.0.5, avvia il setup 1.0.6 sul computer che contiene già la versione precedente e mantieni le cartelle dati esistenti. Prima dell'uso verifica l'avvio, il preventivo esistente e i PDF salvati. Questa sequenza va collaudata su Windows 10/11 reale prima di distribuire l'installer.

## Allegare un PDF a WhatsApp

I pulsanti WhatsApp generano e salvano il PDF nella cartella configurata, quindi aprono la chat del destinatario. Controlla il numero e la chat mostrati da WhatsApp; torna al gestionale e conferma l'allegato solo se la chat è corretta. Il gestionale usa i controlli standard di WhatsApp Desktop per scegliere **Allega > Documento** e apre il PDF salvato. WhatsApp mostra l'anteprima: controllala e premi **Invia** manualmente. Il gestionale non invia il messaggio e non modifica gli appunti di Windows.

Se non trova una sola finestra WhatsApp o i controlli attesi, l'operazione si interrompe senza inviare nulla. Il PDF resta nella cartella e puoi allegarlo dalla chat con **Allega > Documento**. Su macOS l'allegato è manuale. L'automazione Windows usa `pywinauto`, una dipendenza gratuita e open source inclusa nel pacchetto; non richiede abbonamenti, API a pagamento o servizi esterni.

## Ottenere il pacchetto

La build si esegue su GitHub Actions Windows x64. Apri l'esecuzione completata del workflow **Windows installer 1.0** e scarica l'artefatto `Gestionale-Preventivi-1.0.6-Windows-x64`. L'artefatto contiene il setup, il checksum e queste istruzioni.

Per distribuire un setup, verifica anche l'installazione e l'avvio su un computer Windows 10/11 reale. L'hash rileva modifiche accidentali, ma non sostituisce una firma digitale.
