# Allegato WhatsApp verificato e sicuro

## Obiettivo

Generare il PDF della revisione attuale del preventivo, aprire WhatsApp sul destinatario scelto e allegare quel solo PDF con Ctrl+V. L’automazione si ferma quando WhatsApp mostra il nome esatto del documento; non preme Invio e non registra un invio. Su errore lascia negli appunti il solo PDF corretto e indica come allegarlo manualmente.

## Cause confermate nel branch

- Il branch attuale apre Esplora file sul PDF selezionato; non lancia WhatsApp, non copia file negli appunti e non invia Ctrl+V.
- I file sono nominati per numero e tipo, senza identificativo univoco del preventivo o impronta della revisione.
- Il PDF fornitore riceve i dati modulo originali, incluso il nome cliente; anche titolo e subject contengono il nome. Le note dei moduli possono contenere testo libero.
- Esiste solo l’anagrafica clienti. Per il fornitore il numero destinatario va inserito o scelto dall’operatore e confermato nella finestra WhatsApp.
- Gli indicatori di invio sono già indipendenti e vengono aggiornati solo tramite conferma esplicita; questa regola resta invariata.

## Architettura

- JavaScript congela un payload del preventivo, calcola una revisione SHA-256 e passa la stessa identità `quote_id`, `revision`, `kind` ai generatori, al nome file e ai metadati PDF.
- Il PDF cliente mantiene riepilogo, dati cliente, moduli e importi. Il PDF fornitore contiene i moduli tecnici filtrati secondo i relativi schemi; esclude anagrafica cliente, note libere e qualunque campo economico. I metadati non contengono dati cliente.
- Python verifica firma PDF, leggibilità, pagine, metadati di identità, tipo, revisione, nome file e SHA-256. Usa pypdf solo per verifiche locali, senza servizi di rete.
- Su Windows, un helper usa CF_HDROP solo quando gli appunti non contengono già l’unico percorso previsto. Un lock serializza le operazioni del gestionale; il numero di sequenza degli appunti rileva modifiche esterne.
- UI Automation individua univocamente WhatsApp, attende chat e compositore accessibili, verifica il focus, invia Ctrl+V, poi attende l’anteprima con il nome file esatto. Nessuna coordinata, tasto Invio o controllo di invio viene usato.
- L’operatore conferma esplicitamente il destinatario e invia manualmente da WhatsApp. Se identità, focus, anteprima o appunti non sono verificabili, l’automazione si interrompe; il PDF resta disponibile e negli appunti viene ripristinato solo il file corretto.

## Vincoli globali

- Nessun servizio esterno, API a pagamento o costo aggiuntivo.
- Nessun aggiornamento di `sentCustomerAt`/`sentSupplierAt` durante generazione, apertura chat, copia o allegato.
- Cliente e fornitore restano flussi distinti; i file hanno identificativo, revisione e tipo distinti.
- Il database esistente, le cartelle configurate, la generazione PDF cliente e le altre funzioni dell’app restano compatibili.
- Versione di rilascio: 1.0.7. Generare l’artefatto Windows x64 tramite GitHub Actions; il collaudo reale sul PC cliente rimane requisito prima di dichiarare il problema risolto o pubblicare una release.

## Verifica

- Test automatici con PDF sintetici: metadati e contenuto per entrambi i tipi, campi modulo riservati, file assente/vuoto/danneggiato/obsoleto, destinatario errato, nome esatto dell’allegato.
- Test unitari UIA e clipboard con driver isolati: CF_HDROP corretto o obsoleto, concorrenza, app aperta/chiusa, attese dinamiche, focus, Ctrl+V, anteprima esatta, timeout e divieto di Invio.
- Test dei flussi: cliente/fornitore in entrambe le sequenze, preventivi differenti, modifica e duplicazione dopo generazione, nessuna alterazione degli indicatori invio.
- Il PC Windows del cliente deve ancora verificare WhatsApp 2.3000.1056466723.264501, entrambi i tipi di PDF, destinatario, nome allegato e fallback senza inviare il messaggio.
