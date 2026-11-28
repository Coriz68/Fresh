# Condivisione PDF tramite Windows Share

## Intento

Rendere affidabile la preparazione della condivisione del PDF cliente o fornitore, delegando il passaggio a WhatsApp al pannello Condividi di Windows. Il PDF deve restare salvato e l’utente deve scegliere destinatario e invio.

## Approcci

1. **Aprire Esplora file sul PDF selezionato (scelto)** — Il gestionale genera il PDF e apre la cartella con il file evidenziato. L’utente sceglie Condividi → WhatsApp e completa la procedura. Si basa sul flusso che l’utente ha osservato funzionare, senza automazione della finestra WhatsApp.
2. **Aprire direttamente il pannello Condividi via API Windows** — Più integrato, ma richiede di verificare compatibilità tra API, pacchettizzazione desktop e versione Windows; non scelto per questa correzione.
3. **Copiare il file negli appunti** — Ctrl+V dipende dal supporto dell’app e sovrascrive gli appunti; non scelto.

## Flusso e vincoli

- Generare e salvare il PDF corretto prima di aprire Esplora file; evidenziare quel file, senza avviare WhatsApp né chiedere al gestionale di selezionare un destinatario.
- Mostrare istruzioni persistenti nella finestra di anteprima PDF: in Esplora file usare Condividi → WhatsApp, controllare destinatario e allegato, quindi inviare manualmente. Se Explorer non si apre, mostrare lì il percorso completo del PDF salvato.
- Il bridge accetta solo un PDF esistente nella cartella configurata per il suo tipo (cliente/fornitore); non apre percorsi arbitrari.
- Non usare o modificare gli appunti. Non automatizzare la scelta del contatto, l’allegato nel pannello, né il pulsante Invia.
- Se Esplora file non può essere aperto, lasciare il PDF salvato e mostrarne il percorso per l’allegato manuale.
- Nessun servizio o dipendenza a pagamento. Nessun tag o release finché il flusso non è verificato su Windows.

## Verifica

- Test automatici: richiesta di condivisione passa il percorso PDF validato al bridge; nessun URI di avvio WhatsApp o automazione clipboard; PDF cliente e fornitore restano nelle rispettive cartelle.
- Test manuale Windows con file fittizi: Esplora file evidenzia il PDF; Condividi → WhatsApp apre la composizione con file e destinatario scelto dall’utente; appunti invariati; nessun invio automatico. Verificare anche il fallback se WhatsApp non appare tra le destinazioni.
