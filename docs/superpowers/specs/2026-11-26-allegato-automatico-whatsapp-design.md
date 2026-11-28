# Allegato PDF automatico in WhatsApp Desktop

## Intento

Quando l’operatore sceglie WhatsApp cliente o fornitore, il gestionale deve generare e salvare il PDF del tipo corretto, aprire la chat con il destinatario scelto e preparare l’allegato in WhatsApp Desktop. L’operatore verifica la chat e conferma l’allegato; l’invio finale resta sempre manuale.

## Stato attuale e causa

`shareQuotePdfViaWhatsApp` chiama `generateQuotePdf(kind)`, che salva il PDF e restituisce un percorso. Il chiamante poi invoca `open_whatsapp(phone)` senza passare quel percorso: l’URI `whatsapp://send?phone=...` apre la chat ma non allega il file. Il test esistente codifica questo comportamento manuale.

## Approcci

1. **Windows UI Automation (raccomandato)** — Dopo una conferma esplicita della chat, individuare WhatsApp Desktop e i controlli accessibili per allegare un documento; usare il selettore file standard con il PDF già salvato. Non tocca gli appunti di sistema e non preme mai Invia. Se finestra o controlli non sono identificabili in modo univoco, interrompe l’automazione e lascia il PDF disponibile per l’allegato manuale.
2. **Clipboard CF_HDROP e Ctrl+V** — Più diretto, ma sostituisce gli appunti globali e dipende dal focus corretto. Scartato perché può interferire con altre applicazioni e non permette al bridge di verificare il destinatario.
3. **Protocollo WhatsApp e allegato manuale** — È il comportamento 1.0.6. Sicuro e stabile, ma non soddisfa la richiesta di allegare automaticamente.

Si sceglie l’approccio 1, in linea con la richiesta dell’utente di preparare l’allegato con conferma, preservare gli appunti e lasciare l’invio all’operatore.

## Flusso e vincoli

- Generare e salvare il PDF prima di aprire WhatsApp; cliente e fornitore mantengono generatori e cartelle separati.
- Mostrare tipo documento, nome file e destinatario; prima dell’automazione, chiedere all’operatore di verificare visivamente la chat aperta e confermare che il destinatario corrisponda.
- Il bridge valida Windows, numero, tipo PDF, esistenza del file e appartenenza alla cartella di output configurata per quel tipo. Non accetta percorsi arbitrari.
- L’automazione UIA deve verificare la finestra/processo WhatsApp e riconoscere senza ambiguità i controlli necessari. Apre il selettore Documenti, seleziona il solo PDF atteso e torna alla chat con l’anteprima dell’allegato.
- Non usare gli appunti, non scrivere testo nel messaggio, non premere Invia e non registrare l’invio quando il file viene solo allegato.
- In caso di timeout, finestra errata, destinatario non confermato, controlli UI mancanti o errore del selettore file, interrompere senza inviare nulla; mantenere il PDF salvato e mostrare un’indicazione per completare l’allegato manualmente.
- Se l’interfaccia WhatsApp non espone controlli accessibili stabili, fermare l’implementazione automatica e riportare il limite: niente fallback cieco basato su coordinate o tasti.

## Verifica e consegna

- Test automatici: selezione PDF cliente/fornitore, percorso approvato e rifiuto di percorsi fuori cartella, sequenza conferma/apertura/allegato, abort per finestra non WhatsApp e assenza di azioni d’invio.
- Su Windows isolato: verificare entrambi i PDF con dati fittizi, destinatario di prova, allegato visibile in anteprima, nessun messaggio inviato, appunti invariati e fallback manuale in caso di errore.
- Non pubblicare una nuova release finché il collaudo Windows richiesto non è riuscito e approvato dall’utente.
