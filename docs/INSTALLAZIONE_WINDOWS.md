# Gestionale Preventivi 1.0.4 — installazione Windows

## Requisiti

- Windows 10 o 11 a 64 bit.
- Connessione Internet se Microsoft Edge WebView2 Evergreen Runtime non è già presente. Il setup lo installa automaticamente solo quando manca.
- Python non è richiesto sul computer di destinazione.

## Installazione

1. Scarica `Gestionale Preventivi 1.0.4 Setup.exe` e `SHA256SUMS.txt` dall'artefatto Windows x64 della build.
2. Confronta l'hash SHA-256 del setup con quello riportato nel file.
3. Avvia il setup. Windows può segnalare che l'app è di un autore sconosciuto: l'eseguibile non è firmato digitalmente.
4. Segui la procedura guidata e avvia il gestionale dal menu Start.

Il setup installa il programma in Program Files e crea la voce di disinstallazione di Windows. Database, impostazioni e PDF restano nelle cartelle locali configurate dall'utente, fuori dalla cartella del programma; aggiornamento e disinstallazione non rimuovono i dati.

## Ottenere il pacchetto

La build si esegue su GitHub Actions Windows x64. Apri l'esecuzione completata del workflow **Windows installer 1.0** e scarica l'artefatto `Gestionale-Preventivi-1.0.4-Windows-x64`. L'artefatto contiene il setup, il checksum e queste istruzioni.

Per distribuire un setup, verifica anche l'installazione e l'avvio su un computer Windows 10/11 reale. L'hash rileva modifiche accidentali, ma non sostituisce una firma digitale.
