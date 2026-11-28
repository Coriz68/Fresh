# Gestionale Preventivi 1.0.15 — CorradoWEB 2026 — installazione Windows

## Requisiti

- Windows 10 o 11 a 64 bit.
- Connessione Internet se Microsoft Edge WebView2 Evergreen Runtime non è già presente. Il setup lo installa automaticamente solo quando manca.
- Python non è richiesto sul computer di destinazione.

## Installazione

1. Scarica `Gestionale Preventivi 1.0.15 Setup.exe` e `SHA256SUMS.txt` dall'artefatto Windows x64 della build.
2. Confronta l'hash SHA-256 del setup con quello riportato nel file.
3. Avvia il setup. Windows può segnalare che l'app è di un autore sconosciuto: l'eseguibile non è firmato digitalmente.
4. Segui la procedura guidata e avvia il gestionale dal menu Start.

Il setup installa il programma in Program Files e crea la voce di disinstallazione di Windows. Database, impostazioni e PDF restano nelle cartelle locali configurate dall'utente, fuori dalla cartella del programma; aggiornamento e disinstallazione non rimuovono i dati. L’aggiornamento dalla 1.0.5 alla 1.0.6 ha creato una copia byte per byte dell’archivio prima della migrazione; le versioni successive mantengono il database esistente. L’aggiornamento non introduce un updater automatico.

Per l'aggiornamento in-place dalla 1.0.5, avvia il setup 1.0.15 sul computer che contiene già la versione precedente e mantieni le cartelle dati esistenti. Prima dell'uso verifica l'avvio, il preventivo esistente e i PDF salvati. Questa sequenza va collaudata su Windows 10/11 reale prima di distribuire l'installer.

## Preparare e allegare un PDF a WhatsApp

Nell’anteprima del PDF sono disponibili tre azioni separate: **Copia PDF cliente/fornitore**, **Apri chat WhatsApp** e **Apri cartella**. Il nome include l’identificativo del preventivo, la revisione e la tipologia; i file precedenti non vengono sovrascritti.

- **Copia PDF** verifica preventivo, revisione, tipologia, ricevuta e contenuto del documento. Su Windows copia il PDF come file tramite `Set-Clipboard -Path` e controlla il risultato con `Get-Clipboard -Format FileDropList`. Se il contenuto non coincide, segnala l’errore e invita a usare **Apri cartella**.
- **Apri chat WhatsApp** valida il numero (anche prefissi `+39`, `00` e spazi) e apre `whatsapp://send?phone=...&text=...`; se Windows rifiuta il protocollo, passa a `https://web.whatsapp.com/send?phone=...&text=...` nel browser. Questa azione non modifica gli appunti.
- **Apri cartella** mostra il PDF previsto selezionato in Esplora file.

Dopo **Copia PDF**, apri la chat e premi Ctrl+V; controlla destinatario e nome file allegato, poi invia manualmente. L’app non usa UI Automation, non preme Invio e non dichiara che il PDF è stato inviato. Le conferme cliente e fornitore restano separate e richiedono conferma esplicita dell’operatore.

Su macOS la chat continua ad aprirsi nel browser e il Finder mostra il PDF selezionato per l’allegato manuale; il pulsante di copia file negli appunti è disattivato. La generazione PDF e l’archiviazione locale restano invariate.

Il PDF fornitore viene riletto con pypdf e bloccato se il testo o i campi compilati contengono importi, prezzi, totali, IVA o dati riservati del cliente. I test automatici verificano URL, numeri, copia con un PDF reale temporaneo, identità/revisione e privacy del PDF fornitore. Il collaudo effettivo degli appunti e di WhatsApp richiede Windows 10/11 reale.

Checklist manuale Windows: copia cliente e fornitore, chat corretta, Ctrl+V, anteprima e nome dell’allegato, Invio manuale; numeri mancanti/non validi, nomi con accenti/apostrofi e doppio clic. Verifica inoltre WhatsApp Store aperto/chiuso/non installato e solo Web, appunti con file precedente e i due flussi in entrambe le sequenze. Durante il collaudo non segnare il PDF come inviato finché non è stato inviato davvero.

## Ottenere il pacchetto

La build si esegue su GitHub Actions Windows x64. Apri l'esecuzione completata del workflow **Windows installer 1.0** e scarica l'artefatto `Gestionale-Preventivi-1.0.15-Windows-x64`. L'artefatto contiene il setup, il checksum e queste istruzioni.

Per distribuire un setup, verifica anche l'installazione e l'avvio su un computer Windows 10/11 reale. L'hash rileva modifiche accidentali, ma non sostituisce una firma digitale.
