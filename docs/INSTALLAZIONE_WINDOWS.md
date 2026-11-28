# Gestionale Preventivi 1.0.9 — CorradoWEB 2026 — installazione Windows

## Requisiti

- Windows 10 o 11 a 64 bit.
- Connessione Internet se Microsoft Edge WebView2 Evergreen Runtime non è già presente. Il setup lo installa automaticamente solo quando manca.
- Python non è richiesto sul computer di destinazione.

## Installazione

1. Scarica `Gestionale Preventivi 1.0.9 Setup.exe` e `SHA256SUMS.txt` dall'artefatto Windows x64 della build.
2. Confronta l'hash SHA-256 del setup con quello riportato nel file.
3. Avvia il setup. Windows può segnalare che l'app è di un autore sconosciuto: l'eseguibile non è firmato digitalmente.
4. Segui la procedura guidata e avvia il gestionale dal menu Start.

Il setup installa il programma in Program Files e crea la voce di disinstallazione di Windows. Database, impostazioni e PDF restano nelle cartelle locali configurate dall'utente, fuori dalla cartella del programma; aggiornamento e disinstallazione non rimuovono i dati. L’aggiornamento dalla 1.0.5 alla 1.0.6 ha creato una copia byte per byte dell’archivio prima della migrazione; le versioni successive mantengono il database esistente. L’aggiornamento non introduce un updater automatico.

Per l'aggiornamento in-place dalla 1.0.5, avvia il setup 1.0.9 sul computer che contiene già la versione precedente e mantieni le cartelle dati esistenti. Prima dell'uso verifica l'avvio, il preventivo esistente e i PDF salvati. Questa sequenza va collaudata su Windows 10/11 reale prima di distribuire l'installer.

## Allegare un PDF a WhatsApp

La versione 1.0.9 avvia il collegamento WhatsApp tramite l'associazione protocolli di Windows (ShellExecuteW), senza passare dal browser predefinito, e attende la finestra WhatsApp Desktop visibile e attiva prima di chiedere conferma. Se Windows non trova un'app associata o la finestra non diventa disponibile, il gestionale segnala l'errore e non dichiara WhatsApp avviato; controlla Impostazioni > App > App predefinite > Protocolli > WHATSAPP e installa/aggiorna WhatsApp Desktop. Il PDF verificato resta negli appunti per l'allegato manuale.

I pulsanti WhatsApp generano e salvano un PDF identificato da preventivo, revisione e tipologia. Il gestionale apre WhatsApp sul numero cliente oppure chiede il numero del fornitore e quali moduli tecnici sono pertinenti; richiede conferma visiva del destinatario e prepara l’allegato con Ctrl+V. Controlla nome del file e destinatario nella bozza; il gestionale non preme **Invia**. Gli appunti contengono il percorso esatto del solo PDF selezionato. Se l’allegato non è verificabile, il PDF corretto resta negli appunti per l’allegato manuale.

Se WhatsApp è chiuso, il campo di composizione non è accessibile o non compare il nome del file allegato, il gestionale interrompe la preparazione e mostra l’istruzione per Ctrl+V manuale. L’operatore deve confermare l’invio in un secondo momento per aggiornare l’indicatore “inviato”. Il flusso non richiede servizi o API a pagamento.

La verifica automatica copre identità e revisione PDF, privacy del PDF fornitore, percorso e sequenza degli appunti, file precedente/mancante/danneggiato/obsoleto, focus UI Automation, anteprima e nome allegato; include cliente→fornitore, fornitore→cliente, cambio preventivo e duplicazione. La verifica automatica non sostituisce il collaudo sul PC del cliente con Windows 11 e la versione WhatsApp Desktop installata. Sul PC cliente prova entrambi i tipi di PDF, le due sequenze, due preventivi distinti, modifica dopo generazione, duplicazione, WhatsApp aperto e chiuso, appunti con PDF precedente e nome effettivo dell’allegato in bozza. Verifica i moduli riservati nel PDF fornitore e non premere Invia durante il test. Non dichiarare il problema risolto prima di questo collaudo.

## Ottenere il pacchetto

La build si esegue su GitHub Actions Windows x64. Apri l'esecuzione completata del workflow **Windows installer 1.0** e scarica l'artefatto `Gestionale-Preventivi-1.0.9-Windows-x64`. L'artefatto contiene il setup, il checksum e queste istruzioni.

Per distribuire un setup, verifica anche l'installazione e l'avvio su un computer Windows 10/11 reale. L'hash rileva modifiche accidentali, ma non sostituisce una firma digitale.
