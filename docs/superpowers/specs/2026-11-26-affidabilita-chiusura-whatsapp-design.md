# Stabilità, chiusura e invio assistito WhatsApp

## Obiettivo

Rendere più affidabili avvio, salvataggio, chiusura e creazione PDF del gestionale; aggiungere un pulsante di chiusura nell’interfaccia e due azioni WhatsApp che preparino l’invio dei PDF cliente e fornitore.

## Approcci considerati

1. **WhatsApp assistito (scelto):** il gestionale salva il PDF nella cartella già configurata, apre WhatsApp con un testo precompilato e lascia all’utente la scelta del contatto, l’allegato del PDF e l’invio. Funziona con l’uso normale di WhatsApp e non richiede credenziali/API.
2. **Invio automatico:** invio diretto tramite WhatsApp Business Platform. Richiede account e configurazione Meta, credenziali, connessione e una gestione sicura dei segreti; non è incluso.

La modalità assistita è scelta dall’utente. Il gestionale non invia messaggi o allegati senza un’azione esplicita nella chat WhatsApp.

## Comportamento richiesto

- Il nuovo pulsante **Chiudi programma** è visibile nella finestra desktop Windows/macOS. Prima raccoglie i dati dell’eventuale modulo aperto e salva il database; chiude soltanto se entrambe le operazioni riescono.
- Anche il pulsante nativo **X** chiude in sicurezza senza bloccare la finestra se il bridge non risponde. Un timeout sblocca il tentativo e lascia l’app utilizzabile; gli esiti vengono registrati.
- Le funzioni esposte da pywebview comprendono solo le azioni necessarie all’interfaccia; oggetti interni come archivio e finestra restano privati.
- Gli errori e le fasi di avvio, caricamento database, salvataggio, chiusura e PDF vengono registrati in un log locale in rotazione. Un errore di log del server HTTP non deve impedire di servire la pagina quando `stderr` non è disponibile.
- I testi passati a PDFLib vengono normalizzati: ritorni a capo, tab e caratteri di controllo non devono interrompere il PDF.
- Il pulsante **WhatsApp cliente** genera e salva il PDF cliente completo; il pulsante **WhatsApp fornitore** genera e salva il PDF con i soli moduli. Poi apre un link WhatsApp con messaggio precompilato e istruzioni per allegare il PDF salvato. L’utente sceglie il contatto e conferma l’invio in WhatsApp.
- Le azioni WhatsApp restano disabilitate quando il PDF non può essere generato o salvato. In modalità browser senza bridge desktop non vengono presentate come invio su disco.
- La release successiva è la **1.0.5**; il numero versione incorporato nell’eseguibile deve corrispondere a quello dell’installer.

## Correzioni e verifica

- Test del ciclo di chiusura: raccolta dati dal modulo aperto, salvataggio riuscito/fallito, timeout/callback assente e tentativo ripetuto.
- Test che l’API pywebview non esponga gli oggetti `LocalStore` e `Window` né i loro metodi.
- Test PDF con `\n`, `\r\n`, tab, caratteri di controllo e note lunghe.
- Test delle due azioni WhatsApp: tipo PDF corretto, file salvato prima dell’apertura del link e testo precompilato con cliente e numero preventivo.
- Test del server HTTP con `sys.stderr = None` e di errori di configurazione leggibili nel log.
- Esecuzione delle suite esistenti, compilazione Windows in CI e prova pratica del ciclo avvio/chiusura e dei due PDF su Windows reale prima di dichiarare il comportamento verificato.

## Limiti

La modalità assistita richiede che WhatsApp sia accessibile e che l’utente alleghi il file dalla cartella indicata; non automatizza l’upload né l’invio. La build CI non sostituisce una prova sul computer Windows che manifesta i blocchi.
