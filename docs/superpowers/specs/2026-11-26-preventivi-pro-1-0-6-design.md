# Preventivi Pro 1.0.6 — design

## Intento

Aggiornare il gestionale preventivi dalla base `v1.0.5`, migliorando la preparazione e la registrazione degli invii WhatsApp, la validazione del telefono cliente, la duplicazione dei preventivi e l’identità visibile del programma. Il flusso di preventivazione e i due PDF esistenti devono restare invariati.

## Stato attuale verificato

- Il tag `v1.0.5` punta a `2af16c3` sul branch remoto `feat/desktop-local-data-pdfs`; il branch predefinito è invece fermo a 1.0.2. Il branch di lavoro parte dal tag 1.0.5.
- Il prodotto è una desktop app Python + pywebview + HTML/CSS/JavaScript, non Electron/React/TypeScript/SQLite.
- Clienti, preventivi, listino e impostazioni aziendali sono salvati in `preventivi.json` scelto dall’utente. Le preferenze dei percorsi sono in `settings.json` sotto `AreaTendaPreventivi` nella cartella dati utente. I PDF cliente e fornitore hanno percorsi separati.
- L’invio WhatsApp apre oggi `https://wa.me/` nel browser con un messaggio. La generazione PDF è nel front-end e il bridge Python salva il PDF su disco.
- Il PDF fornitore assembla le sole pagine dei moduli; il riepilogo cliente e gli importi restano nel PDF cliente.

## Obiettivi

- Aggiornare i metadati alla versione 1.0.6 senza cambiare `AppId`, nome eseguibile, percorso database, nome database, formato JSON, chiavi di backup, chiavi IndexedDB o canali dei moduli.
- Aprire WhatsApp Desktop Windows con `whatsapp://send?phone=...`, precompilando soltanto il destinatario; il testo resta vuoto. Se manca il numero cliente, o si invia al fornitore, l’operatore inserisce il destinatario.
- Chiedere conferma manuale dopo che l’operatore ha completato l’invio; salvare timestamp indipendenti per PDF cliente e fornitore. L’apertura di WhatsApp e la generazione/allegato del PDF non equivalgono a invio.
- Accettare cellulare vuoto; normalizzare i numeri italiani con `+39`, accettare numeri internazionali in formato coerente e mostrare errori formali in anagrafica. La validità formale non dichiara l’esistenza dell’account WhatsApp.
- Duplicare dal preventivo aperto con nuovo ID e numero, mantenere i dati commerciali e i moduli, azzerare i metadati di invio e lasciare indipendenti originale e copia.
- Sostituire i riferimenti di autore/brand visibili con `CorradoWEB 2026`; mantenere i nomi tecnici e i percorsi legacy necessari a leggere installazioni e archivi esistenti.
- Conservare e verificare i dati al primo avvio aggiornato; fare una copia di sicurezza dell’archivio prima di scriverne una migrazione e non sovrascrivere dati non validi.

## Non obiettivi

- Riscrivere il prodotto in Electron/React/TypeScript o migrare l’archivio JSON a SQLite.
- Inviare messaggi o documenti automaticamente, accedere alle API WhatsApp, o presumere che un numero sia registrato su WhatsApp.
- Automatizzare l’incolla dell’allegato con CF_HDROP: gli appunti sono globali e l’app non può attestare in modo affidabile che WhatsApp Desktop e la conversazione corretta abbiano il focus. Questa strada contrasta con il requisito di non interferire con altre app e resta non verificabile senza un Windows reale. L’operatore allegherà manualmente il PDF salvato.
- Implementare gli approfondimenti elencati al §8 della richiesta. La loro fattibilità viene riportata a parte.
- Pubblicare una release prima del collaudo reale Windows e dell’approvazione dell’utente.

## Approcci

1. **Estendere la desktop app esistente (scelto)** — Aggiungere funzioni limitate nel bridge Python e nel front-end attuale, mantenendo l’archivio e l’installer compatibili. È l’unico percorso che preserva direttamente la 1.0.5 e i suoi dati.
2. **Riscrivere in Electron/React/SQLite** — Scartato: è incompatibile con il repository reale, aumenterebbe il rischio di migrazione e non è necessario per i flussi richiesti.
3. **Automatizzare WhatsApp con appunti/UI automation** — Scartato per la versione 1.0.6: il clipboard CF_HDROP interferisce a livello di sistema e il focus/destinatario non è verificabile dal bridge attuale. L’apertura della chat e la conferma dell’invio restano esplicite e manuali.

## Design

- I timestamp sono campi opzionali `sentCustomerAt` e `sentSupplierAt` sui record preventivo, serializzati in ISO 8601. I preventivi 1.0.5 privi dei campi equivalgono a “non inviato”; non serve migrazione strutturale né aggiornamento del numero IndexedDB.
- La conferma manuale aggiorna un solo campo dopo l’azione esplicita dell’operatore. L’azione WhatsApp genera e salva il PDF del tipo scelto, apre il protocollo Desktop e mostra le istruzioni per allegarlo. Nessun testo viene passato al protocollo.
- Il bridge consente soltanto l’URI `whatsapp://send?phone=` con cifre normalizzate. Su Windows usa l’associazione del sistema; su altri sistemi dichiara che il flusso WhatsApp 1.0.6 richiede Windows. Non apre il browser.
- Il validatore del telefono è una funzione pura condivisa dalla UI e dai test. Normalizza spazi, parentesi e separatori; converte `00` in `+`; aggiunge `+39` a numeri nazionali italiani plausibili; valida la lunghezza E.164 (8–15 cifre) senza interrogare servizi esterni. Un campo vuoto è ammesso; un valore non vuoto formalmente errato mostra un messaggio e impedisce il salvataggio dell’anagrafica.
- Se il numero cliente manca, il flusso WhatsApp chiede un destinatario manuale. Per il PDF fornitore chiede sempre il numero del destinatario, perché il progetto non conserva un’anagrafica fornitori. L’operatore può annullare senza aprire WhatsApp o registrare l’invio.
- La copia ha nuovo ID, numero `-COPIA-NNN` univoco nell’intero archivio (parte da `001` per l’originale e incrementa fino a un numero libero), date di creazione/aggiornamento nuove e `status: 'bozza'`; tutti gli altri campi e moduli sono copiati in profondità. Salvataggio del preventivo originale invariato.
- Le impostazioni utente e gli identificatori legacy (`AreaTendaPreventivi`, `area-tenda-preventivi`, `AREA_TENDA_GESTIONALE_BACKUP`, `AppId`) restano stabili. L’aggiornamento non sposta né cancella i dati. Prima della prima scrittura applicativa del database esistente si conserva una copia JSON con nome univoco nella stessa cartella; la scrittura resta atomica.
- Installer Inno Setup mantiene lo stesso `AppId` e `DefaultDirName`, aggiorna `AppVersion`/nome file/metadati binari e mostra CorradoWEB 2026 come publisher. Nessun auto-update.

## Approfondimenti separati

- Segnalazione di preventivo modificato dopo invio: fattibile confrontando un hash/versione del contenuto inviato; richiede definire se un invio al cliente e uno al fornitore abbiano revisioni indipendenti.
- Storico revisioni e numerazione revisioni PDF: richiedono una politica di conservazione e un formato dati; rinviati.
- Salvataggio automatico bozze: il progetto ha già salvataggi differiti e salvataggio esplicito; un autosave più forte richiede definire quando una bozza è completa.
- Controlli aggiuntivi prima dell’invio: fattibili ma vanno definiti con criteri operativi.
- Anteprima affiancata: fattibile come modifica UX, senza necessità di cambiare i dati.

## Collaudo e limiti

- Eseguire i test Python e JavaScript già presenti e aggiungere test mirati per validazione, duplicazione, timestamp, migrazione/backup, URI, branding e separazione PDF.
- L’host di sviluppo è macOS: può eseguire test unitari, controllare il sorgente e verificare il build script. Non può dimostrare l’apertura di WhatsApp Desktop, il focus della conversazione, l’installazione sopra 1.0.5 o l’installer su Windows reale.
- Non allegare né inviare documenti reali nei test. Non pubblicare tag/release o fare push del branch.
