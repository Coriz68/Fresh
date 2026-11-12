# Gestionale preventivi Windows — specifica di progetto

## Intento

Trasformare il gestionale preventivi esistente in un’app desktop per Windows, mantenendo l’interfaccia e i moduli HTML già presenti. La versione di sviluppo deve potersi avviare anche su macOS per consentire all’utente di provarla lì prima del packaging Windows. L’app deve salvare su disco il database e generare due PDF distinti per ogni preventivo: uno completo per il cliente e uno con i soli moduli per il fornitore.

## Obiettivi

- Avviare una finestra desktop Windows, senza richiedere all’utente di gestire manualmente un browser o un terminale.
- Permettere dalla configurazione di scegliere la cartella del database, la cartella dei PDF cliente e la cartella dei PDF fornitore.
- Salvare i dati applicativi in un file JSON locale nella cartella database selezionata; scrivere gli aggiornamenti in modo atomico per non lasciare un database parziale in caso di interruzione.
- Produrre con due azioni indipendenti:
  - **PDF cliente**: riepilogo completo del preventivo, dati aziendali e cliente, prezzi, sconti, IVA, note e tutti i moduli compilati.
  - **PDF fornitore**: solo tutti i moduli compilati, senza riepilogo economico, intestazione cliente o condizioni commerciali.
- Inserire nome cliente e numero preventivo nei campi “Cliente” e “Riferimento” di ogni modulo in entrambi i PDF. I 32 moduli esistenti hanno già entrambi i campi.
- Salvare ogni PDF nella relativa cartella scelta, con nomi contenenti numero preventivo, cliente e tipo documento.
- Conservare le funzioni di backup JSON esistenti e permettere di importare un backup prodotto dalla versione browser.
- Mantenere tutte le operazioni locali, senza servizi cloud o invio remoto dei dati.
- Consegnare prima una versione di sviluppo avviabile su Windows e macOS da sorgente/script, senza creare l’eseguibile finale. L’utente deve poterla verificare su entrambi i sistemi prima che inizi la fase di packaging.

## Fuori ambito

- Sincronizzazione tra computer o utenti.
- Invio automatico di email o collegamento a servizi esterni.
- Cifratura del database applicativo in questa fase.
- Modifiche alla geometria o ai campi tecnici dei moduli originali.

## Approcci considerati

1. **Finestra desktop multipiattaforma con interfaccia web riusata (scelto)** — Eseguire il backend Python e l’interfaccia HTML/JavaScript in una finestra desktop `pywebview`, usando WebView2 su Windows e WebKit su macOS. Il backend locale gestisce database JSON, dialoghi nativi per le cartelle e scrittura dei PDF. Riusa il progetto attuale, consente la verifica sul Mac e offre il comportamento richiesto da un’app Windows.
2. **Eseguibile che apre Edge o il browser predefinito** — Riutilizza quasi tutto, ma lascia l’utente nel browser e non corrisponde bene alla richiesta di finestra desktop.
3. **Riscrittura completa in un framework Windows nativo** — Offre integrazione più profonda, ma richiede di ricostruire l’interfaccia e i flussi già esistenti senza vantaggi necessari per questa consegna.

## Flusso e dati

- La configurazione mostra i tre percorsi correnti e un pulsante “Scegli cartella” per ciascuno. Il percorso del database contiene un file dal nome fisso e riconoscibile. Le due cartelle PDF devono essere diverse; non si genera un documento se la destinazione richiesta non è configurata o non è scrivibile.
- Le impostazioni dei percorsi risiedono in un piccolo file locale per utente Windows, separato dal database scelto. Il database contiene clienti, preventivi, listino, dati aziendali e configurazioni dei moduli.
- Al primo avvio, se non esiste ancora un database configurato, l’app chiede di scegliere la cartella database. L’utente può quindi importare un backup JSON della versione browser; il ripristino mostra conferma perché sostituisce i dati del database selezionato.
- Se si seleziona una cartella database diversa e questa contiene un database valido, l’app apre quell’archivio. Se la cartella è vuota, l’app chiede se copiare i dati dell’archivio corrente o iniziare da zero. Se il database esiste ma non è valido o non è leggibile, l’app mostra l’errore e non lo sovrascrive.
- Ogni generazione valida i dati e prepara i PDF dei moduli una sola volta. Il PDF cliente viene composto con riepilogo e moduli. Il PDF fornitore concatena solo i moduli, senza aggiungere pagine riepilogative.
- Prima di creare i PDF, i dati di ciascun modulo vengono integrati con nome cliente e numero preventivo nei campi esistenti `cliente` e `riferimento`; tali valori non devono sovrascrivere altri dati del modulo.
- Le due azioni “Genera PDF cliente” e “Genera PDF fornitore” producono e salvano soltanto il documento scelto, nella cartella corrispondente. A salvataggio riuscito, l’app mostra il percorso completo del file.
- I file vengono denominati, salvo caratteri non ammessi da Windows, `PREV-AAAA-NNNN_<Cliente>_CLIENTE.pdf` e `PREV-AAAA-NNNN_<Cliente>_FORNITORE.pdf`. Nomi già esistenti vengono sostituiti solo dopo conferma oppure salvati con un suffisso progressivo; la scelta precisa è lasciata al builder, purché nessun PDF esistente venga sovrascritto silenziosamente.

## Vincoli e decisioni lasciate al builder

- Il target di rilascio è Windows 10/11; l’ambiente di sviluppo deve funzionare anche su macOS. Usare WebView2 Evergreen su Windows e il backend WebKit nativo su macOS. Verificare il runtime richiesto all’avvio e mostrare istruzioni chiare se manca.
- Usare soltanto dipendenze necessarie alla finestra WebView e al packaging; documentare licenze e requisiti d’installazione.
- La selezione di cartelle e la scrittura di file devono avvenire nel backend locale, con percorsi normalizzati e accesso limitato alle operazioni richieste dall’interfaccia.
- Fornire un pacchetto/launcher Windows riproducibile e aggiornare le istruzioni italiane per installazione, primo avvio, scelta delle cartelle, backup e recupero.
- La prima consegna include launcher di sviluppo per Windows e macOS e istruzioni per installare le dipendenze Python e avviare l’app senza `.exe`. Non generare l’eseguibile Windows finché l’utente non ha verificato l’app sui sistemi disponibili e dato il via libera alla fase di packaging.
- Conservare la modalità macOS/browser esistente se possibile; in ogni caso non alterare o cancellare i dati browser preesistenti.

## Criteri di accettazione

- La versione di sviluppo si apre in una finestra desktop su Windows e macOS, senza connessione Internet dopo l’installazione delle dipendenze.
- Le cartelle selezionate sopravvivono alla chiusura e al riavvio dell’app; il database scelto viene riletto e aggiornato su disco.
- Un backup della versione browser può essere importato e i relativi clienti, preventivi, listino e impostazioni appaiono nell’app Windows.
- Il PDF cliente contiene riepilogo e tutti i moduli compilati con cliente e riferimento corretti; si salva solo nella cartella cliente.
- Il PDF fornitore contiene tutti e soli i moduli compilati, senza importi o riepilogo commerciale, con cliente e riferimento corretti; si salva solo nella cartella fornitore.
- L’app gestisce chiaramente cartelle non selezionate, cartelle non scrivibili, backup non valido, moduli incompleti e file già esistenti senza perdita silenziosa di dati.
- La consegna iniziale è verificabile su Windows e macOS senza installare o avviare l’eseguibile finale.

## Riferimenti tecnici

- Microsoft, distribuzione WebView2: https://learn.microsoft.com/microsoft-edge/webview2/concepts/distribution
- Microsoft, confronto Evergreen / Fixed Version: https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/evergreen-vs-fixed-version
- Documentazione pywebview, dialoghi nativi e API JavaScript/Python: https://pywebview.flowrl.com/guide/api/
