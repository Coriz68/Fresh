# Gestionale Preventivi 1.0.12 — CorradoWEB 2026 — installazione Windows

## Requisiti

- Windows 10 o 11 a 64 bit.
- Connessione Internet se Microsoft Edge WebView2 Evergreen Runtime non è già presente. Il setup lo installa automaticamente solo quando manca.
- Python non è richiesto sul computer di destinazione.

## Installazione

1. Scarica `Gestionale Preventivi 1.0.12 Setup.exe` e `SHA256SUMS.txt` dall'artefatto Windows x64 della build.
2. Confronta l'hash SHA-256 del setup con quello riportato nel file.
3. Avvia il setup. Windows può segnalare che l'app è di un autore sconosciuto: l'eseguibile non è firmato digitalmente.
4. Segui la procedura guidata e avvia il gestionale dal menu Start.

Il setup installa il programma in Program Files e crea la voce di disinstallazione di Windows. Database, impostazioni e PDF restano nelle cartelle locali configurate dall'utente, fuori dalla cartella del programma; aggiornamento e disinstallazione non rimuovono i dati. L’aggiornamento dalla 1.0.5 alla 1.0.6 ha creato una copia byte per byte dell’archivio prima della migrazione; le versioni successive mantengono il database esistente. L’aggiornamento non introduce un updater automatico.

Per l'aggiornamento in-place dalla 1.0.5, avvia il setup 1.0.12 sul computer che contiene già la versione precedente e mantieni le cartelle dati esistenti. Prima dell'uso verifica l'avvio, il preventivo esistente e i PDF salvati. Questa sequenza va collaudata su Windows 10/11 reale prima di distribuire l'installer.

## Allegare un PDF a WhatsApp

La versione 1.0.12 copia prima il PDF verificato negli appunti, poi apre direttamente `whatsapp://send?phone=...&text=...` tramite l'associazione Windows. Non attende il focus della finestra e non dipende da UI Automation. Se l'avvio del protocollo fallisce, prova l'attivazione Store e poi apre `https://web.whatsapp.com/send?phone=...&text=...` nel browser; seleziona inoltre il PDF in Esplora file. Sono sempre disponibili i pulsanti **Apri WhatsApp**, **Apri chat nel browser** e **Apri cartella col PDF selezionato**. Premi Ctrl+V nella chat per allegare il documento e usa il pulsante Invia di WhatsApp. Il gestionale non simula Invio e mostra solo **PDF pronto per l'invio**.

I pulsanti WhatsApp generano e salvano un PDF identificato da preventivo, revisione e tipologia. Il gestionale usa il numero cliente oppure chiede il numero del fornitore e quali moduli tecnici sono pertinenti. Gli appunti contengono il percorso esatto del PDF scelto. Verifica il destinatario nella chat, premi Ctrl+V e invia manualmente. Se la chat Desktop non si apre, il browser e la cartella del PDF vengono aperti come alternativa.

Se WhatsApp Desktop non parte o la chat non accetta automaticamente l’allegato, il PDF resta negli appunti e puoi allegarlo manualmente. L’indicatore cliente/fornitore resta separato dalla generazione e dalla preparazione del PDF; l’app non dichiara che un messaggio è stato inviato. Il flusso non richiede servizi o API a pagamento.

I test automatici verificano identità/revisione, privacy e campi riservati, testo economico del PDF fornitore con pypdf, appunti, fallback Web, URL, doppio clic e log senza dati sensibili. Non sostituiscono il collaudo su Windows 11 reale. Sul PC cliente prova WhatsApp Store aperto e chiuso, non installato e solo Web; numero mancante/non valido; nome cliente con accenti e apostrofi; doppio clic; entrambi i tipi di PDF, le due sequenze, preventivi distinti, modifica dopo generazione e duplicazione. Verifica il nome dell’allegato nella chat e controlla visivamente i moduli riservati. Non premere Invia durante il collaudo.

## Ottenere il pacchetto

La build si esegue su GitHub Actions Windows x64. Apri l'esecuzione completata del workflow **Windows installer 1.0** e scarica l'artefatto `Gestionale-Preventivi-1.0.12-Windows-x64`. L'artefatto contiene il setup, il checksum e queste istruzioni.

Per distribuire un setup, verifica anche l'installazione e l'avvio su un computer Windows 10/11 reale. L'hash rileva modifiche accidentali, ma non sostituisce una firma digitale.
