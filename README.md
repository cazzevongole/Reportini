# Reportini

Gestione delle **attività sulle aziende** (appuntamenti e chiamate, sincronizzati con Google
Calendar) e dei **report** che nascono da un'attività svolta. App *mobile first*: si usa dal telefono, dal browser e come applicazione
desktop con Electron, con l'accesso tramite account Google e salvataggio online automatico.

---

## Com'è fatto

| Livello | Tecnologia |
| --- | --- |
| Interfaccia | React 18 + TypeScript + Vite + Tailwind CSS |
| Account | Accesso con Google tramite Supabase Auth |
| Salvataggio online | Supabase Storage, un file per account |
| Dati | SQLite via [sql.js](https://sql.js.org), copiato nel cloud dopo ogni modifica |
| Lavoro offline | SQLite in IndexedDB (browser) o in un file su disco (Electron) |
| Calendario | Google Calendar API (OAuth nel browser) + esportazione `.ics` |

L'app lavora **local-first**: il database è la fonte di lavoro, il cloud è la copia che segue
l'account. Ogni scrittura viene replicata in background con un cooldown di 5 secondi: la
sincronizzazione parte da `useSalvataggioCloud` (`src/hooks/`), montata nel guard delle pagine, e
resta accesa per tutta la sessione. Il percorso nel bucket è **`<user-id>/reportini.sqlite`**, non
l'email: è l'id che le Row Level Security confrontano con l'utente autenticato.

La sincronizzazione distingue due casi, ed è importante conoscerli:

- **primo accesso della sessione** — se il cloud ha già dei dati, vengono **ripristinati** e la
  copia locale non li sovrascrive (è il caso di chi cambia dispositivo);
- **sessione già allineata** — contano le modifiche locali non ancora replicate.

**Ma il cloud vince solo se l'utente non ha ancora scritto niente.** Il ripristino sostituisce
l'intero database, quindi applicarlo a un database modificato **cancella il lavoro locale**. Il
controllo è su due livelli, ed entrambi servono: prima del download e **di nuovo dopo**, perché
il download è una richiesta in rete e l'utente, in quei secondi, può salvare un appuntamento. Il
sintomo di questa corsia era un appuntamento appena creato che spariva, con la pubblicazione che
si fermava su «L'appuntamento non esiste più» — e non accadeva sempre, perché dipendeva da se la
scrittura capitava dentro la finestra del download. Se in quella finestra ci sono state scritture,
si **carica** il locale e il log lo dice.

Per lo stesso motivo `insert()` in `sqlite/engine.ts` legge `last_insert_rowid()` **prima** di
`notifyChange()`: quel valore vale solo per l'ultimo inserimento riuscito, e dopo aver avvisato gli
ascoltatori un inserimento fatto da uno di loro cambierebbe la risposta. Un id sbagliato fa
esattamente lo stesso danno: l'appuntamento c'è, ma per l'app non esiste.

### Modello dei dati

- `aziende` — scheda dell'azienda (ragione sociale, partita iva, sede, recapiti, note). È il
  soggetto di attività e report.
- `referenti` — le persone con cui si parla dell'azienda (nome, cognome, telefono, email),
  con `aziendaId` in cascata. **Non** sono il soggetto di nessuna attività e di nessun report:
  servono per sapere a chi scrivere e per ritrovare un'azienda dal nome di chi se ne occupa.
- `attivita` — **appuntamenti e chiamate insieme**: sono due valori di un campo (`tipo`), non due
  entità. Ogni riga ha `aziendaId` in cascata, titolo, descrizione, inizio, fine, luogo, stato
  (`in-attesa`, `confermato`, `annullato`), la casella `completata`, i promemoria e i dati Google
  (`googleEventId`, `googleHtmlLink`, `googleSyncAt`, `googleErrore`).
- `report` — azienda, titolo, descrizione e **`attivitaId` in cascata obbligatoria**: un report
  esiste perché esiste l'attività da cui è stato generato. Non ha né stato né tipo né date,
  perché sono già quelli dell'attività: scriverli di nuovo sarebbe una seconda fonte che può
  dire una cosa diversa. Il report si **genera dal dettaglio dell'attività** segnata come
  completata, non a mano; e sparisce con la sua attività.
- `preferenze` — coppia chiave/valore per le scelte dell'utente (per ora i colori degli eventi per
  stato). Sta nel database perché deve seguire l'utenza nel cloud e sui ripristini; non entra nel
  backup JSON, che è il patto dei dati.

Le chiavi esterne sono attive (`ON DELETE CASCADE` sui referenti, le attività e i report, grazie al
`PRAGMA foreign_keys = ON` in `migrations.ts`): cancellare un'azienda porta via le sue attività e
i loro report, in un colpo solo.

**Il tipo non è una scelta, è un'azione.** Nell'interfaccia non esiste nessun campo da
compilare per dire "questo è un appuntamento o una chiamata": ci sono **due bottoni** — «Fissa
un appuntamento» e «Registra una chiamata» — e il tipo arriva al modulo da quello che è stato
premuto (`tipoIniziale`). Scegliere da una lista chiederebbe all'utente una cosa che ha appena
detto facendo il gesto, e per giunta il tipo non si cambia dopo: è la parola nel titolo
dell'evento già pubblicato su Google Calendar. In tabella resta un solo campo `tipo`, perché
appuntamento e chiamata si comportano allo stesso identico modo e due tabelle avrebbero
divergito alla prima modifica.

I due tipi producono entrambi un evento su Google Calendar, il cui titolo è `APPUNTAMENTO - …`
oppure `CHIAMATA - …` (`titoloEvento()` in `src/lib/types.ts`).

**La chiamata è un momento, non un intervallo.** Nel modulo compaiono solo l'ora e la casella
«chiamata fatta»: niente fine, niente luogo, niente promemoria, niente lista di stati. La `fine`
esiste in tabella — la ricerca e i confronti leggono solo l'inizio, ma Google ha bisogno di una fine —
e viene calcolata, `fineAttivita()` in `src/lib/types.ts`: il momento più `MINUTI_CHIAMATA`. Non è un
dato che l'utente abbia scritto, quindi non viene scritto in due posti e non può discordare da sé.

**Lo stato di una chiamata è la casella, e nient'altro**: due parole, «da fare» e «fatta». Non c'è
un «annullata», perché un terzo stato che l'utente dovrebbe ricordare e che nessuno gli chiede: una
chiamata che non si fa resta fra le cose da fare, che è dove deve stare. La colonna `stato` c'è
tutta qui, ma non è un dato che l'utente abbia scelto — è la casella riscritta nella colonna che
serve al colore su Google, e `rigaAttivita()` in `repo.ts` la ricalcola in lettura perché le due colonne
non possano dire cose diverse. Sull'appuntamento la select con i tre stati resta: là l'attesa e la
conferma sono informazioni vere, non una casella.

**I recapiti sono cliccabili** ovunque (`src/components/Recapito.tsx`): il telefono diventa
`tel:` ripulito da tutto quello che non è digitabile e con `+39` davanti, l'email diventa
`mailto:`. Un numero di terra scrive `040 1234567` e si compone come `+390401234567`: lo `0` resta,
è parte del numero.

**Non ci sono dati dimostrativi**: l'installazione parte vuota.

> **Le attività hanno sostituito gli appuntamenti, i report hanno sostituito le relazioni.**
> Nella versione 3 dello schema (`PRAGMA user_version = 3`) la tabella `appuntamenti` è diventata
> `attivita` — con dentro anche le chiamate, che prima non esistevano — e `relazioni` è diventata
> `report`, senza stato né date proprie. **Il passaggio svuota le due tabelle**: non è una
> conversione, è un taglio. Un report vecchio non ha un'attività da cui nascere e un appuntamento
> vecchio non ne ha un'azienda (che è diventata obbligatoria), quindi non c'è niente che si possa
> portare dietro senza inventarlo. Le aziende, che sono la parte che nel modello non è cambiata,
> restano: si ripartisce dalle attività, che in un minuto si reinseriscono. `tests/migrazioni.test.ts`
> verifica il risultato partendo da uno schema vecchio, non da zero.

> **Le anagrafiche sono state aziende.** Nella versione 2 dello schema la scheda non è più di una
> persona fisica (nome, cognome, documento, nascita) ma di un'azienda, con i referenti a parte.
> Il passaggio **cancella** le anagrafiche di persona e le relazioni e gli appuntamenti che erano
> agganciati a esse: una persona non può diventare un'azienda, e quegli appuntamenti avrebbero
> un soggetto inesistente. Gli appuntamenti **senza** anagrafica sono invece conservati (sono quelli
> presi allo sportello, e non hanno niente a che fare con il passaggio). La migrazione gira una
> volta sola e si riconosce da `PRAGMA user_version = 2`: rifarla a ogni avvio azzererebbe tutto
> quello che l'utente crea dopo. Una copia JSON esportata dalla versione precedente non è più
> importabile, e l'app lo dice con una frase invece di svuotare il database a metà.

---

## Variabili d'ambiente

Tutte facoltative. Senza `VITE_SUPABASE_*` l'app resta usabile in locale, senza account e senza
salvataggio online.

| Variabile | A cosa serve |
| --- | --- |
| `VITE_SUPABASE_URL` | URL del progetto Supabase |
| `VITE_SUPABASE_ANON_KEY` | **chiave pubblica** del progetto (`sb_publishable_…`) |
| `VITE_GOOGLE_CLIENT_ID` | Client ID (pubblico) del client Google "Applicazione web" — **lo stesso di Supabase** |
| `VITE_DURATA_APERTURA_MS` | secondi (in millisecondi) della schermata di benvenuto; default 5000 |
| _(il client secret non sta qui)_ | vive nella Edge Function `google-token`, come secret di Supabase |

> **Non usare mai la chiave `secret`.** Le nuove chiavi `sb_secret_…` sostituiscono la vecchia
> `service_role`: danno accesso completo al database e ignorano le Row Level Security, e finiscono
> nel bundle perché Vite le sostituisce staticamente. Chiunque apra la pagina potrebbe leggere e
> scrivere i dati di tutti. Per questo la build di produzione **si rifiuta di partire** se trova
> una chiave privilegiata, e in sviluppo l'app mostra un avviso e resta in sola modalità locale.
> Se ti è capitato di usarla per sbaglio, **revocala** dalla pagina API keys di Supabase.

Il modulo `src/lib/cloud/diagnostica.ts` controlla endpoint, tipo di chiave, provider Google e
bucket, e dice cosa sistemare quando qualcosa non torna. Non è una pagina dell'app: gira nei
test, dove un guasto lo blocca prima di arrivare in giro.

> Il controllo del bucket **richiede un account**: con la sola chiave pubblica un bucket privato e
> un bucket inesistente sono indistinguibili (l'elenco restituisce una lista vuota in entrambi i
> casi). Perciò la verifica fa una vera scrittura e la cancella subito, usando le tue credenziali.

### Supabase (account + salvataggio online)

1. Crea un progetto su [supabase.com](https://supabase.com).
2. In **Authentication → Providers → Google** abilita Google e incolla il Client ID e il Client
   Secret del tuo progetto Google Cloud. Per il calendario ne serve uno **solo**: è lo stesso
   client che va in `VITE_GOOGLE_CLIENT_ID` (vedi la sezione sotto).
3. In **Authentication → URL Configuration** aggiungi in *Redirect URLs* `http://localhost:5173`,
   `http://127.0.0.1:42720` (il pacchetto desktop) e l'URL della web, cioè
   `https://reportini.cazzevongole.com`.
4. Crea il bucket e le relative politiche RLS. **Non devi incollare niente**: da quando lo
   schema si applica da solo (vedi *Lo schema si applica da solo*), il bucket e le RLS vengono
   creati al prossimo merge su `master`. Se vuoi farlo adesso senza aspettare, apri
   `supabase/setup.sql` ed eseguilo nel **SQL Editor** (sidebar → *SQL Editor* → *New query* →
   *Run*): è idempotente, quindi puoi rieseguirlo. In fondo ci sono le due query di verifica.
5. Copia il **Project URL** e la chiave **public** (`sb_publishable_…`) nelle variabili
   `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY`.
6. Se vuoi Google Calendar, pubblica anche la Edge Function `google-token` (vedi la sezione
   sotto): è lei che custodisce il `client_secret`. Senza, l'accesso funziona lo stesso ma gli
   appuntamenti restano solo nell'app.

La sicurezza per account si basa sulle Row Level Security di Supabase: ogni utente vede e scrive
solo i propri file, perché il percorso nel bucket è `<user-id>/reportini.sqlite`.

### Schermata di benvenuto

All'accesso e a ogni ricaricamento l'app si apre su una schermata di **cinque secondi** con un
saluto e una frase, poi si dissolve e rivela il sito (`src/components/SchermataApertura.tsx`).
La pausa è voluta: dà il tempo di leggere, copre l'apertura del database e mette un po' di
ritmo fra tornare e lavorare.

La frase viene scelta **a caso a ogni caricamento** fra le cinquanta di `src/lib/benvenuto.ts`, non
una al giorno: due ricariche consecutive non direbbero la stessa identica cosa. Nella home non c'è
più nessun saluto, che ripetuto ogni volta che si apre il pannello diventerebbe un avviso.

La durata si accorcia con `VITE_DURATA_APERTURA_MS` (serve ai test, che altrimenti aspetterebbero
tutti la stessa pausa).

### Versioni di backup

Ogni volta che il database cambia viene tenuta una copia: **una per ora**, aggiornata a ogni
modifica dentro quell'ora, e si conservano **tre giorni** (`GIORNI_RITENUTI` in
`src/lib/backup/archivio.ts`). Non una copia per modifica — sarebbero centinaia al giorno — ma
un punto a cui tornare: "come erano le cose alle 10:14". Se i byte non sono cambiati la copia non
si riscrive, e c'è anche un tetto in spazio oltre al quale le versioni più vecchie cadono per
prime.

La registrazione è accesa dal guard delle pagine (`useRegistrazioneVersioni`), copre tutta la
sessione ed è una sola per applicazione: le impostazioni la mostrano, non la raddoppiano.

Da **Impostazioni → Versioni di backup** si può:

- **guardare** una versione: si apre la copia in un database a parte e se ne vedono conteggi e
  nomi, senza toccare nulla (`src/lib/backup/anteprima.ts`);
- **ripartire da lì**: il database di lavoro diventa quello e le versioni più recenti vengono
  scartate, perché descrivono un lavoro abbandonato. Non è reversibile, quindi la conferma è
  esplicita e ricorda di esportare prima una copia.

Le copie stanno in un IndexedDB separato (`reportini-backup`), anche nella versione Electron.

### "Questa app non è verificata da Google"

Quando si accede con Google, finché l'app è in fase di test la schermata di consenso avvisa che
**non è verificata**. Non è un errore: è Google che avvisa gli utenti quando lo scope chiesto è
"sensibile" e nessuno ha ancora verificato l'app. Per farlo sparire ci sono due passi, uno
facoltativo e uno che dipende da Google.

**1. Passa la schermata di consenso da "In test" a "In produzione"** (scompare subito, ed è
gratis):

1. *Google Cloud Console → API e servizi → OAuth 2.0 → Schermata di consenso* (in inglese
   *Google Auth Platform → Branding*);
2. stato del rilascio: da **In test** a **In produzione**;
3. compila *Informazioni sull'app*: nome, logo, email di supporto, homepage
   (`https://reportini.cazzevongole.com`), privacy policy e condizioni;
4. nei *Domini autorizzati* aggiungi `cazzevongole.com` (il dominio, non
   l'host: così vale anche per `reportini.`).

Finché l'app resta in "In test" Google mostra anche il banner "App in fase di test" e limita a
100 utenti e 7 giorni la validità del token: per un uso normale conviene la produzione.

**2. La verifica vera e propria** serve solo per togliere l'avviso agli utenti *esterni* quando
si chiedono scope come `calendar.events`, ed è una procedura di Google, non un'impostazione:

- il progetto Google Cloud deve essere **verificato** (schermata di consenso → *Passa alla
  verifica*): servono homepage e privacy policy pubbliche, una descrizione precisa dello scope e
  il **video dimostrativo** (≤ 5 minuti) che mostra l|accesso e l'uso della funzione;
- se l'app resta per uso interno, l'alternativa è **Google Workspace**: gli account del tuo
  dominio non vedono l'avviso, perché l'applicazione è considerata interna;
- finché la verifica non arriva, l'alternativa tecnica è chiedere **solo** lo scope minimo e
  usare `prompt=consent` per far accettare lo scope aggiuntivo al primo uso. Con il flusso
  attuale lo scope Calendar viene chiesto **all'accesso**, insieme al profilo: chi usa
  l'app vede l'avviso una volta sola e poi può pubblicare gli eventi.

Nel dubbio: il messaggio è un avviso di Google, non un errore dell'app, e l'accesso funziona
lo stesso — ogni volta che l'app chiede il consenso, però, l'utente lo vede.

### Versionamento e rilascio

La versione non sta in una discussione: sale da sola.

| Dove | Cosa fa |
| --- | --- |
| `scripts/verifica-edge-function.mjs` | confronta il codice delle Edge Function nel repository (file per file) con quello pubblicato su Supabase, e dice quale dei due è da cambiare |
| `scripts/versione.mjs` | **un unico script per la versione**: senza argomenti controlla che le copie coincidano e che il tag sia quello giusto; con `patch`, `minor` o `major` alza la versione in `package.json` e in `electron/package.json` e scrive il `CHANGELOG.md`. Un `.rilascio` nella radice vince sul suo argomento e viene cancellato dopo l'uso |
| `scripts/verifica-node.mjs` | controlla che Node sia abbastanza recente per i test, e spiega cosa fare se non lo è |
| `.github/workflows/release-electron.yml` | **un unico workflow**: a ogni merge su `master` alza la versione, crea il tag, costruisce i pacchetti (mac, Windows, Linux) e pubblica la release come **latest** |

Versionare e rilasciare stanno **nello stesso workflow**, ed è voluto. Erano due, e la corsa fra
loro era la ragione per cui la release era sempre un numero indietro:

1. al merge partivano insieme, perché uno sul `push` e l'altro sul tag che il primo non aveva
   ancora spinto;
2. il rilascio leggeva la versione da `package.json` **prima** che il versionamento la alzasse, e
   costruiva e pubblicava una release con il numero vecchio;
3. il commit di versione ripartiva il rilascio, che rifaceva tutto da capo con il numero giusto.

Il risultato erano **due release per ogni merge**, una delle quali marcata *latest* con dentro i
pacchetti di un'altra versione — e un `latest.yml` che non corrispondeva al proprio pacchetto, che
è esattamente il file che `electron-updater` usa per capire se c'è qualcosa di nuovo.

Adesso chi decide il numero è la stessa esecuzione che costruisce, e i pacchetti si compilano dal
**tag** (`ref:` nel checkout), non dal commit che ha fatto partire il workflow: il tag è l'unico
punto in cui i due fatti sono coerenti per costruzione.

Il rilascio parte anche da un tag `v*` spinto a mano, che rilascia quella versione così com'è senza
alzarla, e non fa niente se la release esiste già. Il commit di versione tocca solo i tre file
della versione, e per quello `paths-ignore` impedisce al workflow di rilanciarsi da solo
all'infinito.

Il rilascio si può forzare a mano: *Actions → Versione e rilascio desktop → Run workflow*,
scegliendo `minor` o `major` invece di `patch`, oppure indicando un `tag` da rilasciare.

### Quando il rilascio non è una patch

Il default del workflow è `patch`, che è giusto per quasi tutto: una correzione di refuso e
una frase nuova sulla schermata di benvenuto sono la stessa cosa. Ma non per un **modello dati**,
che cambia la forma dei dati e azzera quello che l'utenza aveva scritto: quello uscirebbe come
0.2.11, lo stesso numero di un refuso, e nessuno capirebbe dal numero perché è saltato un
campo.

Per questi casi c'è **`.rilascio`**, un file nella radice che contiene `patch`, `minor` o `major`:

```bash
echo minor > .rilascio   # e poi si fa il push
```

Vale più della riga di comando e più del default del workflow, anche quando il rilascio parte
da solo da un push su `master`. Viene **cancellato dopo l'uso**, perché un ordine eseguito è un
ordine finito: lasciato, farebbe salire di minor anche il rilascio successivo. Se il file c'è ma
contiene una parola che non è un livello, il rilascio **si ferma** invece di tirare a indovinare:
pubblicare un numero che nessuno ha chiesto è peggio che non pubblicare niente. `.rilascio` è in
`paths-ignore`, perché il commit che prepara l'ordine non deve far partire un rilascio: quello
deve partire dal push *successivo*, quello con dentro il codice da rilasciare.

La cancellazione finisce **nel commit di versione**, e non è un dettaglio: il pacchetto si
costruisce dal tag, e se `minor` restasse dentro il tag il job che impacchetta — che esegue
`versione.mjs` per controllare che la versione torni con il tag — avrebbe trovato l'ordine e
alzato la versione *di nuovo*, pubblicando pacchetti con un numero che non era quello della
release. Per questo `versione.mjs` senza argomenti controlla e non scrive mai, `.rilascio` o no:
è un controllo, e un controllo che alza la versione è il difetto più grave che quel file possa
avere, perché il numero del pacchetto è pubblico e non si può più correggere. Il test
`il controllo non alza niente, anche con un ordine in giro` copre esattamente questo.

E non parte per niente quando il commit tocca solo ciò che non finisce nel pacchetto — le funzioni
Supabase, i test, il README, gli script di CI, la formattazione. Il filtro è una lista di path in
`paths-ignore`, e ogni riga che manca è un pacchetto identico al precedente pubblicato come nuovo:
è successo con un aggiornamento di dipendenze e con un ritocco alla documentazione. Ciò che non ci
va mai in lista è `src/`, `public/`, `index.html` e la configurazione di build: un commit che li
tocca cambia l'app che l'utente scarica, e per quello il rilascio serve.

La build desktop usa `BASE_PATH` vuoto e `ELECTRON=1`, che forza la base **relativa**:
l'app si apre da `file://`, e un percorso assoluto come `/assets/app.js` li punterebbe alla
radice del filesystem, dove non c'è nulla — il pacchetto si aprirebbe bianco. `baseRoutte()`
(`src/lib/cloud/destinazione.ts`) traduce la base "./" in radice per il router, che con "./"
non saprebbe che fare. E `scripts/copia-renderer.mjs`
sostituisce `rm -rf && cp -R` perché su Windows la shell di GitHub Actions è PowerShell: senza,
i pacchetti si costruirebbero solo su Linux e macOS.

### Aggiornamento automatico dell'app

L'app **installata** si aggiorna da sola: non va riscaricata a mano.

Il meccanismo è `electron-updater`, montato in `electron/main.cjs`. Al primo avvio — otto
secondi dopo, per non occupare la rete mentre l'app si apre — cerca una versione nuova sulle
release GitHub, e da quel momento **ripete il controllo ogni mezz'ora**: sei ore erano troppe per
un'app che si usa tutto il giorno, e chi apriva Reportini al mattino restava sulla versione di
ieri fino alla sera.

Quando trova una versione nuova **la scarica da sola, in sottofondo**, senza chiedere: il
pacchetto ci mette qualche minuto, e l'utente può continuare a lavorare. Durante lo scarico c'è
solo una **barra** in alto con la percentuale (niente domande: è un'informazione). Quando il
pacchetto è pronto parte un **pop-up** con le due strade, e sono soltanto due:

| Scelta | Cosa succede |
| --- | --- |
| **Aggiorna adesso** | l'app si chiude, l'installatore si vede, e Reportini si riapre già nuova. I dati restano dove sono |
| **Alla chiusura dell'app** | l'utente continua a lavorare; l'aggiornamento entra quando chiude l'app, e **da solo al prossimo avvio** se l'app viene chiusa di colpo |

Il pop-up non ha una X e non si chiude con Esc: sono le due risposte previste, una terza non
esiste. Dopo «alla chiusura» la domanda non torna per quella versione — l'utente ha già
risposto — ma si ripete se ne arriva un'altra. Nelle impostazioni c'è anche **Controlla adesso**,
che risponde anche quando non c'è niente da aggiornare, e le stesse due scelte.

Tre dettagli che sembrano secondari e non lo sono:

- **`autoInstallOnAppQuit` è spento, e l'installazione all'uscita è nostra.** electron-updater
  registra il suo gestore di uscita **quando finisce lo scarico**, e solo se il bandierino è
  già acceso: accenderlo dopo, quando l'utente sceglie «alla chiusura», non avrebbe nessun
  effetto e il pacchetto resterebbe scaricato e mai installato. In `electron/main.cjs` c'è il
  nostro `before-quit`, che installa solo se l'utente ha davvero scelto quella strada.
- **La scelta «alla chiusura» resta sul disco** (`aggiornamento-in-attesa.json` nella cartella
  dati di Electron, accanto al database): è l'unico modo che l'aggiornamento entri anche al
  prossimo avvio dopo una chiusura di colpo. I tentativi sono contati e fermati a due, così
  un'installazione che fallisce non lascia l'app che si apre e si richiude da sola per sempre.
- **Ogni passo finisce in `renderer.log`.** Nell'app impacchettata non esiste una console:
  quello che il main scriveva con `console.warn` finiva nel nulla. Controllo, versione trovata,
  pacchetto pronto, scelta dell'utente, errori: tutto leggibile accanto ai dati.

| Dove | Cosa fa |
| --- | --- |
| `electron/package.json` (`build.publish`) | dice a electron-updater dove cercare: GitHub, repository `cazzevongole/Reportini` |
| `electron/main.cjs` | tiene lo stato, lo manda a ogni finestra via IPC, scrive il log, installa all'uscita e al primo avvio successivo |
| `electron/preload.cjs` | espone `window.reportini.aggiornamento` (stato, controlla, installa, rimanda alla chiusura, eventi) |
| `src/lib/aggiornamento.ts` | intervalli dei controlli, store condiviso e decisione su cosa mostrare |
| `src/components/Aggiornamento.tsx` | la barra durante lo scarico e il pop-up con le due scelte |
| `tests/ponte-aggiornamento.test.ts` | confronta i file che scrivono il ponte: nessun canale senza gestore e nessun metodo dichiarato e assente |

Due dettagli che sembrano secondari e non lo sono:

- **I `latest*.yml` nella release.** Sono il menù che l'app installata legge per capire se
  c'è qualcosa di nuovo. Il workflow li pubblica e, se mancano, **fallisce**: senza
  `latest.yml`, `latest-mac.yml` e `latest-linux.yml` l'aggiornamento non funzionerebbe e
  nessuno se ne accorgerebbe.
- **E che i nomi che promettono siano nomi di file veri.** `scripts/verifica-menu-aggiornamento.mjs`
  legge ogni `url` e ogni `path` dei tre menù e controlla che il file corrispondente sia fra
  gli allegati; se non c'è, il rilascio **fallisce**. Non è pignoleria: electron-builder
  ricava il nome che scrive nel menù da un posto diverso rispetto a quello del file che
  produce, e su Windows i due erano diversi — il menù prometteva
  `Reportini-Setup-0.1.24.exe` e l'allegato si chiamava `Reportini.Setup.0.1.24.exe`.
  L'aggiornamento finiva in un 404, l'app restava sulla versione vecchia, e non c'era errore
  da nessuna parte. Su mac e Linux i nomi tornavano, quindi il difetto stava solo in un
  sistema e nessuna verifica fatta a occhio lo avrebbe visto. Per questo il controllo è
  uno script **con un test** (`tests/menu-aggiornamento.test.ts`, eseguito a ogni PR) e non
  una riga dentro il workflow. `win.artifactName` in `electron/package.json` è esplicito
  per lo stesso motivo: allinea il file al nome che electron-builder scrive nel menù.
- **Lo `.zip` su macOS.** Sulla mac l'aggiornamento automatico può solo sostituire un `.zip`,
  non un `.dmg`: il `.dmg` resta per chi scarica a mano, lo `.zip` serve solo all'auto-update.
- **Che la release, dopo, sia davvero pubblicata.** Tutti i controlli precedenti guardano la
  cartella: che cosa si voleva allegare. `scripts/verifica-release.mjs`, che gira **dopo**, rilegge
  la release da GitHub e controlla che ci siano i tre sistemi, i tre menù, il titolo
  `Reportini <tag>` e che non sia una bozza. È l'unico controllo che vede il risultato invece
  dell'intenzione, ed esiste perché "verde" nel workflow vuol dire solo che i comandi sono usciti
  con codice 0: `gh release upload` **prosegue anche quando un file fallisce**, quindi un allegato
  può mancare senza che nessuno se ne accorga. E una release in bozza è il caso peggiore:
  esiste, `gh release view` la trova, l'upload funziona, ma `--latest` su una bozza non la
  pubblica — quindi un tag su GitHub e nessuna release, con l'aggiornamento fermo e nessun errore.
  Per questo nel workflow c'è anche `--draft=false`, e per questo il controllo di "release già
  completa, non rifare tutto" richiede tre cose insieme (pubblicata, con i menù, ed è
  l'ultima) invece di una. Come il menü, è uno script **con un test**
  (`tests/verifica-release.test.ts`).

Cosa aspettarsi davvero:

- le release pubblicate **prima** di questa modifica non hanno i `latest*.yml`: un'app
  installata allora si aggiorna dalla prima release che li contiene in poi, non prima;
- i pacchetti **non sono firmati** (non c'è un certificato). Su Windows e mac l'installatore
  mostra sempre l'avviso di applicazione non verificata, e su mac una prima apertura può
  richiedere di confermare. Firmarli (certificato + notarizzazione Apple) è il passo dopo, se
  un giorno serve;
- nel browser non c'è niente da aggiornare: la versione web è sempre l'ultima pubblicata.

La via manuale resta valida e funziona sempre: scaricare il pacchetto dalla
[release](https://github.com/cazzevongole/Reportini/releases) e installarlo sopra a quello
vecchio.

### Avvisi

Ogni azione che chiama la rete — salvataggio online, pubblicazione su Google Calendar,
scollegamento, uscita dalla sessione, esportazione — mostra sempre un avviso breve con l'esito:
verde per il successo, rosso per l'errore, e l'errore riporta sia l'azione fallita sia la causa
vera. Le azioni passano da `useAvvisi()` (`src/components/Avvisi.tsx`): `esegui()` avvolge la
chiamata, mostra il messaggio e restituisce `null` se è fallita, così chi chiama non prosegue con
dati che non ci sono. Il provider sta fuori dal router: un avviso resta visibile anche cambiando
pagina, per esempio dopo un'uscita dalla sessione.

Le azioni che scrivono solo in locale (aziende, referenti, relazioni, appuntamenti, copie di
sicurezza) non fanno richieste di rete e quindi non hanno bisogno di avvisi.

### Chiedilo allo sviluppatore

Nelle impostazioni c'è una sezione **Chiedilo allo sviluppatore**: si scrive cosa non va
(fix) o cosa dovrebbe poter fare il programma (funzionalità), e sotto si vanno le proprie
richieste con lo stato — *da leggere*, *in corso*, *risolta* — e la risposta quando arriva.

Le richieste sono divise in **In corso** e **Risolte**: le prime sono quelle su cui qualcuno sta
lavorando (aperte o prese in carico), le seconde quelle chiuse. Sono le due domande che l'utente
si fa guardando la pagina, ed è la stessa distinzione che lo sviluppatore vede nei suoi gruppi.

Ogni richiesta nuova **fa anche arrivare una mail** a chi sviluppa: è un avviso, non un archivio,
e la sezione nascosta resta il posto in cui si legge e si risponde. Come è montata è descritto
più giù, in *Quando un utente scrive, arriva una mail*.

E quando una richiesta **passa a risolta, l'utente riceve una mail con la risposta**. È la
seconda metà di quella stessa notifica: stessa Edge Function, stesso segreto nel Vault, stesso
trigger generato da `supabase/notifica-richieste.sql`, che ora ne installa due — uno per
l'inserimento e uno per il passaggio a risolta. Il secondo ha una condizione che conta più delle
altre: parte **solo** quando lo stato passa a `risolta` e prima non lo era, altrimenti salvare la
risposta senza cambiare stato — cioè correggere un refuso — manderebbe all'utente una mail di
chiusura ogni volta.

Alla URL `/panel/sviluppo` c'è la **sezione nascosta dello sviluppatore**: non è nella barra
e non la vede nessun altro. Chi non è lo sviluppatore viene rimandato al pannello.

**Come si usa.** Su ogni richiesta c'è **un'azione sola**, che cambia a seconda dello stato e dice
cosa succede: *Prendo in carico* su una aperta, *Segna risolta* su una già presa. Prima erano
quattro pulsanti e due scrivevano lo stesso campo, quindi l'ordine in cui venivano premuti decideva
se la risposta appena scritta veniva salvata o persa: qui l'azione porta con sé la risposta, e
*Salva la risposta* esiste solo per volerne salvare una senza cambiare stato.

**Le richieste passate si cancellano** con *Cancella*, che chiede conferma. La cancellazione è
**logica**: la riga resta nel database con la sua risposta e sparisce dagli elenchi, quindi è
recuperabile (`cancellata_il` diventa `null`). Non è una `delete` e non serve una policy `delete`:
passa dalla stessa `richieste_modifica` che richiede di essere sviluppatore. La pagina dichiara
quante richieste sono nascoste invece di farle sparire in silenzio.

Per arrivarci c'è un puntamento in fondo alla pagina **Impostazioni** — la scheda scura "Su
questa versione" — che **compare solo se il database ti riconosce come sviluppatore**
(`src/components/SvoltaSviluppo.tsx`). Non è una riga nascosta da togliere: chi non è
sviluppatore non la vede nemmeno disegnata, e in più la pagina di destinazione lo riporterebbe
al pannello. Il ruolo viene chiesto una volta sola per sessione e dimenticato all'uscita
dall'account, così il secondo utente di un dispositivo non eredita il ruolo del primo.

Come è protetta, e perché conta:

| Cosa | Come è fatto |
| --- | --- |
| Chi è sviluppatore | la riga nella tabella `sviluppatori`, non una variabile d'ambiente |
| Chi vede cosa | tre regole RLS su `public.richieste` (`supabase/richieste.sql`) |
| Chi può evasorla | solo lo sviluppatore: la *update* policy chiama `sei_sviluppatore()` |
| L'email della richiesta | la prende la sessione, non il modulo |

La scelta che regge tutto è una sola: **l'elenco degli sviluppatori sta nel database e non nel
bundle**. Un mese fa la sezione sviluppo era una `VITE_DEV_WHITELIST` dentro l'app, e finiva
pubblicata su GitHub Pages: chiunque leggendo il JavaScript poteva aggiungersi. Con la tabella
la lista non esiste lato browser — nessun client può ampliarla, e la funzione che la consulta
gira con i permessi del database.

Anche `supabase/richieste.sql` **non va eseguito a mano**: si applica da solo al prossimo merge
su `master`, come `setup.sql`.

Quello che resta a mano è **una riga sola**, in fondo al file, ed è voluta:
`insert into public.sviluppatori (email) values ('<la tua email>')`. Decide chi legge le richieste
di tutti gli utenti, e per questo non la esegue nessuna macchina: se lo facesse, chi apre una pull
request deciderebbe chi vede i dati degli altri, e il merge passerebbe inosservato.

Se lo script non è stato eseguito l'app **non si rompe e lo dice**: al posto del modulo compare
un avviso che nomina il file da eseguire, e la sezione nascosta spiega lo stesso invece di
mandarti fuori con un errore generico.

### Quando un utente scrive, arriva una mail

Una richiesta nuova non resta in una tabella in attesa che qualcuno ci guarda: **arriva una mail**
a ogni indirizzo della tabella `sviluppatori`. La catena è tutta sul database, e l'app non c'è:

```
utente scrive  →  riga in public.richieste  →  trigger  →  Edge Function  →  Resend  →  mail
```

**Perché non la manda l'app.** Se la chiamasse il browser, il messaggio partirebbe solo se la
scheda restasse aperta un secondo dopo l'invio, e sono due secondi che nessuno garantisce: chi
preme "Invia" e chiude il portatile lascerebbe una richiesta senza avviso e senza traccia. Qui
invece a far partire la mail è la riga appena scritta nella tabella, quindi l'avviso arriva anche
se il browser è già chiuso.

| Domanda | Risposta |
| --- | --- |
| Chi riceve | gli indirizzi di `public.sviluppatori`, gli stessi della sezione nascosta |
| Chi può farsi mandare la mail a nome proprio | nessuno: serve una chiave, e sta **solo** nel Vault |
| Cosa contiene | titolo e corpo della richiesta, l'email di chi l'ha scritta, l'ora, e un link alla sezione sviluppo |
| Dove si risponde all'utente | nella sezione nascosta, non per mail: la risposta alla mail non lascia traccia nell'app |
| Se non c'è nessuno in `sviluppatori` | avviso nella console del database, e la richiesta resta comunque salvata |

**Per metterlo in piedi** (una volta sola), nell'ordine:

1. Su [resend.com](https://resend.com) verificare il dominio e prendere una chiave API.
2. Pubblicare la funzione e caricare i segreti:

```bash
supabase link --project-ref <ref>
supabase functions deploy notifica-richiesta --no-verify-jwt
supabase secrets set RESEND_API_KEY=<chiave resend>
supabase secrets set RESEND_MITTENTE=Reportini <segnalazioni@dominio.verificato>
supabase secrets set SITO_URL=https://reportini.cazzevongole.com
```

3. Nella console SQL (*Dashboard → SQL Editor → New query*) eseguire:

```bash
# incolla e esegui il file
supabase/notifica-richieste.sql
```

Il file contiene anche i due segreti da scrivere a mano nel **Vault** (`notifica_richieste_url`
e `notifica_richieste_chiave`), perché il trigger deve poter chiamare la funzione e la chiave non
può stare in una tabella che chiunque legge. Istruzioni e testo esatto sono in testa al file, dove
l'indirizzo è un segnaposto `{{REF}}` da sostituire con il reference del progetto: nel repository
non c'è nessun ref scritto, perché un ref copiato a mano e sbagliato dà un `401` che non dice
niente, e un test fallisce se dentro compare.

Il `--no-verify-jwt` è inevitabile — a chiamare è il database, che non ha un JWT da mostrare — e
il suo costo è una porta aperta a chiunque trovi l'URL. Chi lo fa può solo mandare una mail a
nome tuo, e la chiave lo ferma: senza l'intestazione `x-reportini-notifica` giusta la funzione
risponde `401` e non manda niente.

**Dove sta la chiave, e perché è una cosa sola.** Il trigger la prende dal Vault e la manda
nell'intestazione; la funzione non ne tiene una copia, la riporta al database con la funzione SQL
`notifica_chiave_valida` e gli chiede se è ancora quella valida. Prima la copia esisteva anche
come secret della funzione, ed è stato proprio quello il difetto: le due copie potevano divergere
e l'unico sintomo era un `401` che non diceva se l'intestazione non era arrivata o se erano
diverse — due problemi che si risolvono in modo opposto. **Nel Vault c'è una chiave sola**: se la
cambi lì, basta cambiare lì, e non c'è nessun `supabase secrets set` da tenere allineato.

**Se la mail non arriva**, il primo posto dove guardare non è la casella ma la coda del database,
perché `pg_net` non aspetta la risposta e l'inserimento della richiesta riesce comunque:

```sql
select id, status_code, left(content, 300) as risposta
from net._http_response order by id desc limit 5;
```

`200` vuol dire inviata. `401` che il Vault non riconosce la chiave arrivata, e con una copia sola
non può voler dire che sono diverse: vuol dire che l'intestazione non è arrivata (rigenera il
trigger rieseguendo il file) o che nel Vault la chiave è un'altra. `503` che manca un segreto, o
che il file SQL non è stato rieseguito e la funzione di verifica non esiste — il corpo del
messaggio dice quale delle due. `502` con `domain is not verified` che il mittente non è un
dominio verificato su Resend. Quello che è partito ma non è ancora uscito sta in
`net.http_curl_queue`.

Sul testo della mail: `titolo` e `corpo` li scrive chiunque abbia un account e finiscono dentro
un documento HTML, quindi vengono **escapati** prima di diventare markup
(`supabase/functions/notifica-richiesta/corpo.ts`): senza, un utente potrebbe scrivere un
`<a href="…">` e il titolo arriverebbe cliccabile, col mittente spoofato. Il `Reply-To` è
l'indirizzo dell'utente, ma rispondere alla mail non registra niente nell'app: la risposta
all'utente si scrive nella sezione sviluppo, che è l'unica che lui vede.

### Google: accesso e calendario insieme

Il calendario **non è una funzione a parte**: si concede insieme all'accesso, con una sola
schermata di consenso, e poi si rinnova da solo.

Perché dietro c'è un backend. Un'app su GitHub Pages è un client pubblico e non ha dove tenere
un segreto; Google pretende il `client_secret` sia per scambiare l'authorization code sia per
rinnovare il token, anche in PKCE — provato sull'endpoint reale, la risposta è
`client_secret is missing`. Metterlo nel bundle lo darebbe a chiunque apra la pagina. Il pezzo
che mancava è un piccolo servizio che parla con Google per conto dell'app: la **Supabase Edge
Function `google-token`**, in `supabase/functions/google-token/index.ts`.

Il percorso, che è uno solo:

1. l'utente preme **Accedi con Google** e l'app lo porta all'*authorize* di Google chiedendo
   **profilo e calendario nella stessa richiesta**;
2. al ritorno lo `id_token` passa a Supabase con `signInWithIdToken` — è lui che apre la
   sessione — e i token del calendario restano all'app;
3. il `refresh_token` fa sì che il rinnovo sia **in silenzio**: prima, scaduto il token dopo
   un'ora, l'utente doveva ricollegarsi.

Perché non può essere fatto diversamente: se l'accesso lo facesse Supabase, profilo e
calendario sarebbero due richieste OAuth diverse e l'utente vedrebbe **due** schermate di
consenso. In più il token che Supabase restituisce non ha un refresh token, quindi dopo un'ora
l'app non potrebbe rinnovare niente.

#### Gli step che vivono fuori dal repository

Nessuno di questi si trova nel codice, quindi nessuno viene controllato da una build, e
tutti e tre hanno lo stesso effetto quando mancano: **l'accesso con Google non parte**, con
un errore che non dice quale dei tre sia. Se l'app viene rimossa e ricostruita, sono i
passi che si saltano.

| Dove | Cosa | Cosa succede se manca |
| --- | --- | --- |
| [Google Cloud Console](https://console.cloud.google.com/apis/credentials) → *OAuth 2.0 Client ID* → **URI di reindirizzamento autorizzati** | il dominio dell'app | `redirect_uri_mismatch` |
| Google Cloud Console → **Schermata di consenso OAuth** | nome e dominio dell'app | schermata "non verificata" |
| Supabase → *Authentication → URL Configuration* → **Redirect URLs** | il dominio dell'app | percorso di rientro non valido |

Il primo è quello che blocca l'accesso ed è il più silenzioso dei tre: Google risponde
`redirect_uri_mismatch` **prima** di chiedere le credenziali, quindi l'utente vede subito
un errore che nomina l'app, non l'elenco degli URI. Per verificarlo senza indovinare,
basta aprire la pagina di accesso e premere **Accedi con Google**: se compare la
schermata di Google, l'URI c'è; se compare `redirect_uri_mismatch`, manca.

**Per metterlo in piedi** (una volta sola):

1. In Google Cloud crea un **client OAuth di tipo "Applicazione web"**. Ne serve **uno solo**,
   lo stesso che va configurato su Supabase: `signInWithIdToken` valida l'`id_token` con il
   Client ID del progetto, quindi i due devono coincidere.
2. Nei *URI di reindirizzamento autorizzati* metti:
   - l'URL di callback di Supabase (lo trovi in *Authentication → Providers → Google*),
   - `https://reportini.cazzevongole.com`,
   - `http://localhost:5173`,
   - `http://127.0.0.1:42720`, che è l'indirizzo a cui il pacchetto desktop fa tornare
     l'utente: non serve un secondo client OAuth.
3. In Supabase, *Authentication → Providers → Google*: incolla **lo stesso** Client ID e Client
   Secret del passo 1.
4. Pubblica la funzione e carica i segreti:

```bash
supabase link --project-ref <ref>
supabase functions deploy google-token --no-verify-jwt
supabase secrets set GOOGLE_CLIENT_ID=<client id>
supabase secrets set GOOGLE_CLIENT_SECRET=<client secret>
supabase secrets set PROGETTO_URL=<project url>
supabase secrets set PROGETTO_CHIAVE=<chiave pubblica>
supabase secrets set ORIGINI_AMMESSE=https://reportini.cazzevongole.com,http://localhost:5173
```

In `ORIGINI_AMMESSE` le origini si separano con la **virgola**, e la virgola va
messa fra apici se la shell o il terminale potrebbe mangiarla: uno spazio al suo
posto non dà alcun errore, ma la funzione legge l'intera stringa come se fosse
un'unica origine, nessuna corrisponde e ogni richiesta del browser viene
rifiutata. Il sintomo è che l'accesso con Google fallisce con un errore CORS
senza che niente dica il perché. Per capire quale sia l'elenco effettivamente
in uso, senza indovinare:

```bash
curl -sI -X OPTIONS https://<ref>.supabase.co/functions/v1/google-token \
  -H "Origin: https://reportini.cazzevongole.com" | grep -i allow-origin
```

Se la risposta contiene l'origine esatta che hai chiesto, l'elenco la
riconosce; se contiene altro, è il valore di ripiego e quell'origine non è in
lista.

5. Metti il **Client ID** (solo quello, non il secret) in `VITE_GOOGLE_CLIENT_ID` nelle
   variabili d'ambiente della web.

I due segreti del progetto si chiamano `PROGETTO_URL` e `PROGETTO_CHIAVE`, non
`SUPABASE_URL` e `SUPABASE_ANON_KEY`: la CLI rifiuta i nomi che iniziano con `SUPABASE_` perché
quel prefisso è riservato alle sue variabili interne, e va avanti senza impostarli
(*Env name cannot start with SUPABASE_, skipping*). Per la funzione non cambia niente: sono due
etichette, i valori sono quelli che leggi in *Project Settings → API*.

Sul `--no-verify-jwt`: lo scambio avviene *mentre* l'utente sta entrando, quando non ha ancora
una sessione da cui trarre un JWT, quindi la verifica automatica di Supabase non può
applicarsi. Il costo è che lo `scambio` è aperto a chiunque; l'unica cosa che se ne ottiene è
una sessione per il **proprio** account Google, attraverso un client che è pubblico per
definizione. `rinnovo` e `revoca` invece richiedono un account Reportini e la funzione lo
verifica da sé, interrogando Supabase Auth.

Se Google rifiuta l'`id_token` con un errore sulla *audience*, il client ID del passo 1 e
quello di Supabase non coincidono: è l'unico disallineamento possibile, e si vede subito
perché l'accesso funziona ma il calendario no.

Se i segreti non sono caricati la funzione risponde `503` con il nome del segreto mancante. Se
il backend non è pronto, **l'accesso non si blocca**: l'app ripiega su Supabase da sola, e le
impostazioni dicono cosa manca.

Senza backend l'app funziona lo stesso: ogni appuntamento si esporta in formato `.ics`, e
l'area Calendar resta semplicemente non collegata.

### La pubblicazione è automatica

Con Google Calendar collegato, **salvare un appuntamento lo pubblica**: non c'è un secondo passo da
ricordare e non un pulsante da premere. Nel modulo c'è la spunta **Pubblica su Google Calendar**,
accesa di default, da disattivare solo per l'appuntamento per cui serve il contrario.

Cosa succede a seconda della situazione, deciso in `pubblicaAppuntamento()`
(`src/lib/google/sync.ts`):

| Situazione | Cosa fa |
| --- | --- |
| Appuntamento nuovo | crea l'evento e salva il collegamento sull'appuntamento |
| Appuntamento già pubblicato, ora modificato | **aggiorna** l'evento esistente, non ne crea un secondo |
| Appuntamento portato ad "annullato" | **l'evento resta in agenda e si dichiara**: titolo `ANNULLATO: …` e colore rosso |
| Appuntamento **eliminato** | **toglie** l'evento dal calendario di Google |
| Spunta disattivata | salva solo in locale, Google non viene toccato |
| **Google risponde con un errore** | l'appuntamento resta salvato, e sulla scheda compare **perché** non è stato pubblicato, con il pulsato per riprovare |

Quel'ultima riga è la conseguenza di un difetto che è costato tre release a
capirlo. `pubblicaAppuntamento()` non solleva mai: ritorna `{ ok: false }`. Passata
a `esegui()` come `successo: (r) => r.messaggio`, un fallimento arrivava a schermo
come una **notifica verde** con dentro la frase dell'errore, e spariva di lì a
pochi secondi. Risultato: l'appuntamento in lista sembrava a posto, l'utente aveva
visto un avviso di successo, e in agenda non c'era niente.

Ora il motivo sta in una colonna dell'appuntamento (`googleErrore`, con migrazione
per i database già esistenti) e la scheda lo mostra finché non si riesce: un
avviso sparisce, un riavvio lo cancella, un campo no. Al primo tentativo riuscito
la colonna si svuota, perché un appuntamento finito in agenda non deve continuare
ad accusare un errore che non c'è più.

Lo stato segue l'appuntamento, quindi l'evento dice sempre la stessa cosa
che dice l'app. Un annullato resta in agenda e si **dichiara**: titolo `ANNULLATO: …` e colore
rosso. `status: "cancelled"` non si usa — è il modo in cui l'API **elimina** un evento, e
nell'interfaccia l'evento sparisce nel cestino invece di comparire barrato: chi guarda l'agenda
vedrebbe solo una fascia vuota, senza la ragione. La differenza fra "non si è più tenuto" e "non è
mai esistito" sta proprio in questo. Il collegamento all'evento resta anche quando l'appuntamento
è annullato, così la prossima modifica non crea un secondo evento — e tornando confermati il
titolo e il colore tornano normali: il prefisso è una dichiarazione dello stato, non una cicatrice.

E **la cancellazione a cascata pulisce anche Google**. Eliminare un'azienda o una relazione
elimina con lei gli appuntamenti collegati: gli ID evento vengono raccolti **prima** che le righe
spariscano (`appuntamentiConEventoDaEliminare*`), poi ogni evento viene tolto da Google e solo alla
fine si cancella la riga locale (`eliminaAppuntamentiEEventi`). Se Google non risponde per uno degli
appuntamenti, le righe restano nel database e si può riprovare — meglio di un evento orfano in
agenda, non più raggiungibile da nessuno. Un evento già sparito (404/410) non blocca: la
cancellazione richiesta è già stata fatta.

E **solo lo stato "confermato" occupa la fascia** (`transparency: opaque`); in attesa e
annullato mandano `transparent`, cioè l'evento resta in agenda ma non blocca il tempo. Non è una
decorazione: senza, passare da in attesa a confermato non cambiava **niente** su Google Calendar —
i due stati producevano lo stesso identico evento, e la sola traccia era la parola "(in attesa)"
nell'avviso dell'app. Un appuntamento da confermare che occupa il tempo mente sul fatto che non
è ancora tenuto, e un annullato che occupa la fascia blocca chi cerca lo slot.

**Lo stato è scritto in chiaro sull'evento**, in tre punti. La riga `Stato: in attesa di
conferma` (o `confermato`, o `annullato`) in cima alla descrizione: `transparency` e `status`
sono proprietà che si vedono solo aprendo l'evento, quindi due appuntamenti identici in elenco
sembravano uguali. Poi `extendedProperties.private.reportiniStato`, per chi legge l'evento e non
l'app. E nell'export `.ics` il campo standard `STATUS`, che per "in attesa" è `TENTATIVE` — prima
valeva `CONFIRMED` anche per un appuntamento non ancora confermato, e in un calendario importato
non c'era modo di distinguerlo.

**E il colore segue lo stato**, con `colorId` — la palette globale di Google Calendar (1 Lavender,
2 Sage, 3 Grape, 4 Flamingo, 5 Banana, 6 Tangerine, 7 Peacock, 8 Graphite, 9 Blueberry, 10 Basil,
11 Tomato). Le tre tonalità sono scelte per somigliare a quelle che l'app usa già nella sua `TONO`:
Sage per **confermato**, Tangerine per **in attesa**, Graphite per **annullato**. Così l'agenda e
l'elenco dicono la stessa cosa con lo stesso colore, e in una vista per mese — dove un evento è una
macchia e nient'altro — lo stato si legge senza aprire nulla. Un test verifica che i tre colori siano
distinti e che appartengano alla palette reale: un ID inesistente viene rifiutato da Google.

`colorId` è una **stringa** nell'API, non un numero.

**E la scelta è dell'utente**, in *Impostazioni → Google Calendar*: le undici tonalità sono mostrate
con il loro nome e il loro campione, una riga per stato (`ColoriStato.tsx`). I predefiniti sono
quelli qui sopra, scelti per somigliare ai colori dell'app, ma ognuno può cambiarlo.

La preferenza vive **nel database**, in una tabella `preferenze` (coppia chiave/valore): la scelta
segue l'utenza, non la macchina — la copia cloud e i ripristini su un altro dispositivo la portano
dietro. Resta **validata in lettura**: un ID che non sta nella palette viene scartato e sostituito
col predefinito. Non è pignoleria, è il punto in cui un dato corrotto farebbe danno vero:
`colorId` finito nell'evento fa rispondere 400 a Google e **l'appuntamento non viene pubblicato**,
per un colore che l'utente non ha nemmeno chiesto. Un test prova esattamente quello, scrivendo nel
database un numero invece di una stringa — la forma che avrebbe una copia scritta male o da una
versione diversa.

Le preferenze **non** entrano nel backup JSON: quello è il patto dei dati, e le preferenze sono
impostazioni. Le porta invece la copia cloud del database, che è il caso che conta — cambiare
dispositivo.

I colori valgono per le pubblicazioni successive: un evento già in agenda prende il nuovo colore
quando l'appuntamento viene modificato e ripubblicato. Cambiare il colore non riscrive da solo
l'agenda di un utente che non l'ha chiesto in quel momento.

L'unico modo di togliere davvero l'evento è **eliminare** l'appuntamento, o
premere "Su Google" su un appuntamento già pubblicato, che è lo scollegamento
manuale.

**Un evento che l'utente ha cancellato da Google Calendar non è un errore.** L'evento sparisso
fa rispondere `404` o `410 Gone` a ogni operazione, e quelle risposte non sono guasti: sono Google
che conferma che l'evento non è più in agenda, cioè che **l'operazione che l'utente ha chiesto è
già stata fatta**. Per questo `ErroreGoogle` porta con sé il codice HTTP ed `eventoMancante()` lo
riconosce, e in tutti e tre i punti in cui può capitare vale la regola "l'evento non c'è, quindi
quello che volevo ottenere è ottenuto":

- **eliminare** l'appuntamentoElimina la riga locale e va avanti. Prima l'appuntamento restava
  in lista e ogni nuovo tentativo riceveva lo stesso `410`, quindi non era eliminabile;
- **scollegare** ripulisce i marcatori locali. Senza, il collegamento a un evento che non esiste
  non poteva più essere tolto, e restava lì per sempre;
- **modificare** l'appuntamento ricrea l'evento. Altrimenti ogni salvataggio successivo riceveva
  lo stesso `404` e l'appuntamento rimaneva bloccato, con un collegamento a un evento morto.

Un fallimento vero — rete, quota, permessi — si comporta come prima: l'appuntamento resta in
lista con il collegamento, e premere Elimina di nuovo riprova.

Due dettagli che contano più di quanto sembrino:

- **Prima il locale, poi Google.** Il salvataggio nell'app non dipende dalla rete: se Google è
  irraggiungibile l'appuntamento è salvo lo stesso e l'avviso dice che non è stato pubblicato. Si
  riprova con **Invia a Google** nella lista appuntamenti, senza riscriverlo.
- **Un appuntamento annullato non può restare in agenda senza dirlo.** L'evento resta con titolo
  `ANNULLATO: …` e colore rosso. `status: "cancelled"`, che sembrava la via giusta, in realtà è il
  modo in cui l'API elimina un evento: nell'interfaccia sparisce, e con lui la ragione della
  fascia vuota. Il prefisso nel titolo è l'unica cosa che si legge in una vista per mese senza
  aprire l'evento.
- **Il contesto dell'azienda vive solo nell'evento.** All'evento viene aggiunto
  `Azienda: …`, `Partita Iva: …` e `Relazione: …`; la descrizione che l'utente scrive resta quella
  nel database e nel modulo di modifica. Il referente non ci finisce: è un recapito, non il
  soggetto dell'appuntamento. Scollegare l'evento tocca **solo** i marcatori di Google
  (`rimuoviCollegamentoGoogle()`), non riscrive l'appuntamento: prima scriveva qui anche la
  descrizione arricchita, e il blocco si accodava a ogni passaggio fino a ripetersi due, tre volte.

---

## Script

```bash
bun install
bun run dev        # server di sviluppo su http://localhost:5173
bun run build      # build statica in dist/ (+ 404.html per GitHub Pages)
bun run typecheck  # tsc -b --noEmit
bun run lint       # ESLint: regole sugli hook di React e codice sospetto
bun run lint:fix   # corregge quello che si può correggere da solo
bun run format     # riformatta con Prettier
bun run format:check  # segnala cosa non è conforme, senza toccare nulla
bun run test       # test vitest + smoke test dello schema
bun run test:ui    # solo i test vitest
bun run version:check  # la versione è coerente? (lo usa anche il rilascio)
bun run version:patch  # alza la versione di un patch, come fa il workflow
bun run dimensioni    # quanto pesa la web, e rispetta i tetti?
```

C'è anche `scripts/azzera-dati-utenti.mjs`, che **non** sta in `package.json` perché non
va lanciato per sbaglio: elenca per ogni utente del progetto Supabase quanti dati ha e quanto
pesano, e solo con `--conferma` li cancella, bucket compreso. Serve al beta testing (far partire
tutti gli utenti da zero), e chiede `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` perché una chiave
di servizio è l'unica che può arrivare dove le RLS dell'utente non fanno passare nessuno.

`lint` e `format:check` girano in CI, e girano in **modalità segnalazione**: non
correggono e non scrivono. Un controllo che riscrive il codice al posto tuo
lascia il lavoro a metà e un check verde su un file che nessuno ha scritto.

### La dimensione della web

`bun run dimensioni` divide i file di `dist/` in tre gruppi, perché vengono
scaricati in tre momenti diversi e misurarli insieme darebbe un totale che non
corrisponde a nessuna situazione reale:

| gruppo | chi lo scarica | adesso |
| --- | --- | --- |
| pagina | chi apre l'app, anche senza account | 141 kB gzip |
| installazione | le icone, solo se l'utente installa l'app | 26 kB gzip |
| dopo l'accesso | il database nel browser e le pagine differite | 359 kB gzip |

Il primo caricamento è l'unico numero che conta per la velocità con cui
l'app compare, ed è quello col tetto più stretto. Il grosso di "dopo l'accesso"
è il WASM di SQLite (643 kB, 315 kB compressi): è il database stesso e non si
può alleggerire senza rinunciarci.

Il controllo gira in CI e **ha bisogno che `@supabase/supabase-js` resti nel
bundle**: senza `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` esbuild lo
elimina in modo statico, e la misura risulta più leggera di quella reale di
oltre 50 kB. Le variabili vere stanno nell'ambiente `prod`, che il job di CI non
dichiara, quindi il build in CI riceve un segnaposto della stessa forma quando
non le trova: la chiave pubblica è pubblica per definizione, e per misurare
basta che la libreria ci sia. I tetti sono in `scripts/dimensioni.mjs`, con
scritti accanto i numeri di riferimento: alzarli è una decisione, non un
effetto collaterale di un upgrade.

> Il numero più facile da sbagliare è proprio questo. Una build senza le
> variabili Supabase **rientra nei tetti e il controllo passa**: per accorgersene
> guarda che `dist/assets/index-*.js` sia sui 460 kB circa, non sui 220.

### Node serve abbastanza recente

I test hanno bisogno di **Node 22.12 o successivo**, e non è una scelta stylistica: l'ambiente
di test è jsdom, jsdom arriva fino a `@exodus/bytes` con `require()`, e quel modulo è ESM puro.
Node lo carica da `require()` solo dalla 22.12 — prima è `ERR_REQUIRE_ESM`, dentro un worker che
muore mentre avvia e con una pila di frame che non porta da nessuna parte.

È successo proprio in questo repository: la CI è su Node 24 e passa, ma sulla macchina di
lavoro c'era Node 22.9 e la suite si fermava al primo file, con un errore che sembrava di jsdom e
non era. `--experimental-require-module` sposta l'errore di un pezzo (emerge
`webidl.util.markAsUncloneable is not a function`) senza toccare la causa vera.

Non serve installare niente per dargli un'occhiata:

```bash
npx -y node@24 node_modules/vitest/vitest.mjs run
```

`scripts/verifica-node.mjs`, che gira prima di `vitest` in `test` e `test:ui`, controlla la
versione e dice cosa fare; `package.json` lo dichiara in `engines.node`, così anche un
installatore lo segnala. `vitest.config.ts` ripete il controllo per chi lancia `vitest`
direttamente, ma arriva dopo che Vite ha costruito la configurazione: è la rete di sicurezza,
non il primo avviso. Il motivo di tutto questo è in `scripts/verifica-node.mjs`, in testa al file.

I test vitest coprono **294 prove in 25 file**; questi sono quelli che meritano una riga:

- `tests/app.test.tsx` monta l'app reale in jsdom con un IndexedDB finto: è la rete che
  intercetta i crash a runtime (per esempio un dereferenziamento di `window.reportini` fatto al
  caricamento del modulo, che produceva una pagina bianca). Verifica anche che senza account non
  si veda nessuna pagina interna, e che la schermata di errore dica che cosa è andato storto e che
  i dati non sono persi.
- `tests/desktop-renderer.test.tsx` monta l'app **con il ponte di Electron in piedi** e la apre su
  un percorso di file vero (`/C:/Program Files/Reportini/…/index.html`): verifica che il percorso
  non venga ripulito fino alla radice del disco, che era la pagina bianca su Windows. Con il
  `BrowserRouter` di prima il test fallisce.
- `tests/avvisi.test.tsx` verifica il meccanismo degli avvisi: successo, errore con la causa,
  auto-chiusura, durata maggiore per gli errori, tetto di tre avvisi contemporanei.
- `tests/apertura.test.tsx` monta la schermata di benvenuto da sola: copre l'app, la frase è
  presa dall'archivio e cambia a ogni apertura, il dissolvenza parte opaca e si accende, e la
  durata resta di cinque secondi anche con la variabile d'ambiente scritta male.
- `tests/backup.test.tsx` verifica il versionamento: una copia per ora, potatura a tre giorni,
  scarto delle versioni successive, anteprima che legge una copia senza toccare il database di
  lavoro, e il percorso completo "guarda e richiudi" / "riparti da qui" dalle impostazioni.
- `tests/repo.test.ts` gira sul motore SQLite vero e controlla le cancellazioni: che portino
  via i riferimenti orfani (referenti, report, attività) e che le chiavi esterne restino
  attive anche dopo un salvataggio (sql.js chiude e riapre il database a ogni export: senza
  rimettere il PRAGMA, le cascate smetterebbero di funzionare). Controlla anche che la ricerca
  trovi un'azienda per ragione sociale, per partita iva **e per il nome del referente**, e che i
  campi vengano ripuliti prima di essere salvati.
- `tests/migrazioni.test.ts` parte da un database costruito a mano con lo schema **vecchio** e
  verifica che le colonne nuove arrivino e che rifare le migrazioni non rompa niente. Copre i due
  passaggi, alle aziende e alle attività coi report: le persone spariscono, gli appuntamenti senza
  soggetto
  restano, il secondo avvio non azzera le aziende appena create e le chiavi esterne tornano
  attive dopo il `DROP TABLE`. Copre anche la cascata fra report e attività nei due sensi: un
  report sparisce con la sua attività, e cancellando un report l'attività resta (e da lei se ne
  può generare un altro).
- `tests/benvenuto.test.ts` e `tests/versione.test.ts` coprono l'archivio delle frasi di benvenuto
  e il controllo di versione che fa scoppiare il rilascio se il tag non torna.
- `tests/cloud.test.tsx` verifica con un client Supabase finto l'accesso con Google, il
  caricamento e il ripristino della copia online, il pulsante "Salva subito online" con
  l'id dell'utente e non l'email, l'auto-salvataggio dopo ogni modifica, il
  controllo del bucket, la barra di navigazione, l'assenza di account e uscita fuori dalle
  impostazioni e la sparizione della sezione sviluppo.
- `tests/google.test.tsx` copre il percorso col backend: l'authorize che chiede profilo e
  calendario **nella stessa richiesta** (una sola schermata di consenso) e l'`offline` senza il
  quale il refresh token non arriva, il ritorno con lo `state` confrontato, lo `id_token` che
  apre la sessione su Supabase, il rinnovo in silenzio — incluso il caso di due chiamate
  contemporanee che ne fanno una sola — e i due ripieghi: backend senza segreti e `audience`
  sbagliata lasciano comunque entrare l'utente, dicendo che il calendario manca.
- `tests/calendar.e2e.test.tsx` gira sul motore vero e copre il calendario: pubblica
  un'attività, esce e rientra e verifica che non venga pubblicato due volte, che lo scollegamento
  elimini l'evento remoto e che un errore di Google non lasci marcatori falsi. Verifica anche la
  **pubblicazione automatica**: che cosa fa il modulo quando si salva — evento nuovo, aggiornamento
  di quello esistente, rimozione se l'appuntamento viene annullato — e che la spunta disattivata
  salvi in locale senza toccare Google. E che **eliminare** un appuntamento taga l'evento, con il
  caso in cui Google non risponde: l'appuntamento resta in lista e si riprova, invece di lasciare
  un evento orfano di cui l'app non sa più niente. Verifica infine che il contesto dell'azienda
  (ragione sociale, partita iva, relazione) finisca **solo** nell'evento e non nella descrizione
  salvata: è la duplicazione che si vedeva a ogni modifica.
- `tests/dettaglio-attivita.test.tsx` monta il dettaglio dell'attività, che è il posto da cui
  nasce il report: verifica che **prima** della spunta il bottone "Genera il report" non ci sia,
  che dopo la spunta il report prenda il titolo dell'attività e che tipo e data arrivino
  dall'attività senza essere riscritti, che il titolo sia correggibile e che un report già
  generato si apra invece di generarne un secondo. Nello stesso file, i recapiti cliccabili: il
  telefono ripulito con `+39` davanti (lo `0` dei numeri di terra resta), l'email in `mailto:`, e
  un recapito vuoto che non lascia un link vuoto.
- `tests/aggiornamento.test.tsx` guida l'aggiornamento automatico con un ponte finto (Electron
  non serve): verifica che i controlli automatici partano presto e si ripetano **ogni mezz'ora**
  (e che la pulizia li fermi), che un controllo fallito resti silenzioso, che quello chiesto a mano
  risponda, che durante lo scarico ci sia la barra e **nessuna domanda**, che il pacchetto pronto
  apra il pop-up con le due scelte, che «aggiorna adesso» installi, che «alla chiusura» chieda al
  processo principale di installare all'uscita e tacca per quella versione, che il pop-up non si
  chiuda con Esc, e che nel browser non compaia niente.
- `tests/ponte-aggiornamento.test.ts` legge `electron/preload.cjs` e `electron/main.cjs` e li
  confronta: un canale che il preload invoca e il main non gestisce — o un gestore che nessuno
  chiama — non dà nessun errore a runtime, l'aggiornamento semplicemente non succede. Qui si
  accorge prima.
- `tests/rilascio.test.ts` e `tests/verifica-release.test.ts` custodiscono il rilascio, che è
  l'unica parte che gira una volta per versione e fa fatica a essere verificata in tempo utile:
  quando si rompe, il danno è già pubblico. Il primo legge il workflow come un file e verifica
  che `gh release create` sia preceduto dal controllo, che gli allegati si carichino **sopra**
  (`--clobber`) quando la release c'è già, che titolo, `--draft=false` e "latest" vengano
  rimessi, e che il salto alla costruzione richieda tutte e tre le condizioni. Il secondo prova la
  verifica della release pubblicata: bozza, prerelease, titolo, i tre sistemi, i tre menù e
  gli allegati rifiutati — e che il giudizio diventi un **codice di uscita**, che è l'unica
  cosa che il workflow guarda.
- `tests/notifica-richiesta.test.ts` prova la costruzione della mail, che è la parte dove un
  errore non si vede subito: il titolo e il corpo dell'utente vengono **escapati** prima di
  diventare HTML (con l'ampersand per primo, altrimenti l'utente vedrebbe `&amp;lt;` sparso
  nella mail), l'oggetto viene accorciato **compreso il prefisso** e non solo il titolo, i
  destinatari vengono filtrati e deduplicati, una lista vuota dà un messaggio `null` invece di
  un'eccezione, e i segreti mancanti vengono elencati **per nome**: un `503` che dice solo
  «manca qualcosa» fa perdere il tempo a cercare il segreto nel posto sbagliato.
- `tests/notifica-sql.test.ts` custodisce lo script SQL della notifica, che il repository non
  esegue mai e che nessuno rilegge prima di incollarlo nella console di Supabase: nessun ref
  scritto a mano al posto del segnaposto, le intestazioni nell'argomento giusto di `net.http_post`
  e non dentro `params` — che è l'errore che ha fatto finire la chiave nell'URL e ha lasciato la
  funzione a uno `401` senza spiegazione —, un solo trigger, e lo stesso nome d'intestazione fra
  il trigger e la funzione, che sono le due cose che devono accordarsi senza avere un posto dove
  accordarsi.
- `tests/edge-function.test.ts` prova il confronto fra il codice nel repository e quello
  pubblicato su Supabase, che vale per **entrambe** le funzioni e **file per file**: una funzione
  aggiunta all'elenco con un file in più (`corpo.ts` accanto a `index.ts`) resterebbe fuori dal
  controllo, ed è già successo che il controllo ne guardasse una sola.
- `tests/richieste.test.tsx` prova "Chiedilo allo sviluppatore" con un Supabase finto che
  applica la stessa regola del database (un utente vede solo le proprie richieste, lo
  sviluppatore tutte): l'email viene dalla sessione, il titolo vuoto non parte, lo stato
  cambia solo da sviluppatore, la sezione nascosta rimanda al pannello chi non lo è, e se lo
  script SQL non è stato eseguito l'errore viene tradotto in una frase che dice cosa fare. Verifica
  anche il puntamento nelle impostazioni: per un utente non c'è, per lo sviluppatore porta a
  `/panel/sviluppo`, e il ruolo si chiede una volta sola finché non si cambia account.

`scripts/smoke.mjs` esegue invece lo schema vero su sql.js e controlla che ogni query di
`repo.ts` sia valida, che le chiavi esterne cancellino in cascata e che l'installazione parta
**vuota**.

### Desktop (Electron)

```bash
bun run electron:install   # installa electron ed electron-builder
bun run electron:build     # compila la web e la copia in electron/renderer
bun run electron:pack      # impacchetta (dmg / nsis / AppImage)
```

`electron/main.cjs` serve `electron/renderer/` da `127.0.0.1` e espone via IPC cinque operazioni:
leggere il file SQLite, scriverlo, mostrarlo nel file manager, chiedere lo stato
dell'aggiornamento automatico e aprire un indirizzo nel browser di sistema. Il renderer gira con
`contextIsolation` e senza accesso a Node.

**Due reti di sicurezza, perché una pagina bianca non serve a nessuno.** Nell'app impacchettata
non esiste una console: quello che il renderer scrive finisce nei devtools, che nessuno apre. Quindi
`main.cjs` copia ogni messaggio del renderer — e gli errori di caricamento, di preload e la morte
del processo di rendering — in un file `renderer.log` nella stessa cartella del database
(`%APPDATA%\reportini` su Windows, `~/Library/Application Support/Reportini` su mac). E se un
errore capita durante un render, invece di lasciare la finestra vuota compare
`src/components/ErroreAvvio.tsx`: il messaggio dell'errore e la reassurance che **i dati non sono
persi**, con il percorso del log per i dettagli.

**E sul desktop il router guarda l'hash, non il percorso** (`HashRouter` invece di
`BrowserRouter`, scelto da `isDesktop`). La pagina è un file, e il suo "percorso" è
`/C:/Program Files/Reportini/resources/app.asar/renderer/index.html`: non è un percorso di rotte,
quindi il router non trovava nulla e il fallback riportava a `/`, facendo navigare il browser a
`file:///C:/` — la **radice del disco**, dove non c'è un indice.html. Il sintomo era la pagina
bianca dopo quella di benvenuto, e nel log `did-fail-load -6 ERR_FILE_NOT_FOUND file:///C:/`. Con
l'hash la rotta iniziale è `/` e nessuna navigazione può portare fuori dal file. Sulla web resta il
`BrowserRouter`, perché lì gli URL puliti servono.

**Il pacchetto desktop si costruisce con le stesse variabili della web.** Il job che impacchetta
dichiara `environment: prod` e passa `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` e
`VITE_GOOGLE_CLIENT_ID` alla build; se mancano le prime due il pacchetto **non esce**. Senza quelle
variabili, infatti, il pacchetto si apre su una schermata di accesso che non può mai entrare:
Supabase non è collegato, e senza account l'app non mostra niente. Meglio un pacchetto che non
viene costruito che uno che sembra funzionante e non lo è.

**Un server locale su `127.0.0.1`, perché l'accesso con Google ha bisogno di un'origine.** Da `file://`
non esiste un'origine: `window.location.origin` restituisce la stringa `null`, e un indirizzo di
rientro senza origine non è un indirizzo che Google accetta. Quindi l'app impacchettata non si
apre da un file: `electron/main.cjs` alza un server su `127.0.0.1:42720` che serve
`electron/renderer/` e da cui la finestra si carica. L'origine è vera e sicura — resta sulla
macchina, non è in ascolto sulla rete — e l'accesso con Google è esattamente quello della web.
Il server accetta richieste solo con `Host` localhost, non lascia uscire da `electron/renderer/`, e
si chiude con l'app.

**Tre pezzi, e ognuno serve a qualcosa.** Il consenso si apre nel **browser di sistema** e non nella
finestra: Google rifiuta l'accesso dai browser incorporati, quindi aperto dentro Electron si
raggiunge "This browser or app may not be secure". Da qui il ponte `apriUrlEsterno` nel preload, che
accetta solo `https` e `http` verso la macchina stessa. Il ritorno arriva a `127.0.0.1:42720` e
**nessuno lo ascolterebbe**: l'ha aperto un altro programma, quindi è il main process a vederlo,
a ripulire i parametri e a riportare la finestra avanti. Da lì il renderer fa lo scambio come sulla
web. Il `code` non finisce nel `renderer.log`.

**Il rientro non viene rimesso nell'URL, e questo è il punto.** Il server riconosce il rientro proprio
da quei parametri, quindi chiedere alla finestra di caricare `/?code=…` la farebbe sembrare un
rientro nuovo: il main rimanda la finestra, la finestra chiede di nuovo, e l'app si ricarica
all'infinito. Il sintomo era "la pagina non si aggiorna" e nessun errore — il renderer non arrivava
mai a mostrare niente. Quindi i parametri passano dalla `sessionStorage` della pagina corrente
(`riportaAllaApp` in `electron/server-locale.cjs`, che li scrive e poi porta la finestra a un
indirizzo pulito) e `completaAccesso()` li legge da lì quando non arrivano dall'URL, cioè
sempre sul desktop e mai sulla web.

**Perché una porta fissa e non una libera.** L'indirizzo di rientro va registrato *prima*, in Google e
in Supabase, e un numero che cambia a ogni avvio non si può registrare. Se la porta è occupata se ne
prende una vicina — la testata nel log dice quale, e quella va registrata al suo posto.

Cosa registrare, una volta sola:

- **Google Cloud → Client OAuth 2.0** del client già esistente: aggiungi
  `http://127.0.0.1:42720` fra i *Authorized redirect URIs*. Non serve un secondo client.
- **Supabase → Authentication → URL Configuration → Redirect URLs**: aggiungi
  `http://127.0.0.1:42720`. Serve al percorso di riserva, quello col solo profilo e senza calendario.
- **La funzione `google-token`**: nulla. Le origini in loopback sono ammesse a prescindere da
  `ORIGINI_AMMESSE`, perché non sono raggiungibili dalla rete — e così nessun numero di porta
  finisce in un segreto da ricordare.

Sviluppando l'app con `bun run dev` il server locale non parte: c'è già quello di Vite, la sua
origine è `127.0.0.1:5173` ed è già registrata.

`motivoRientroNonValido()` resta, come rete di sicurezza: se la frase compare, il server locale non
è partito, e il messaggio dice di leggere il `renderer.log` invece di lasciare il pulsante muto.

**Se il rientro fallisce, la ragione è sulla schermata di accesso, non nelle impostazioni.** Il primo
tentativo la teneva solo nelle impostazioni, cioè dove non si arriva senza essere già entrati: il
sintomo che ne veniva fuori era "l'app non si aggiorna" senza nessuna spiegazione, che è un modo
costoso di dire "non lo so". Ora `Accesso.tsx` mostra `readErroreCollegamento()` sotto il pulsante,
con un *Nascondi* perché un errore vecchio non resti mentre l'utente riprova, e `completaAccesso()`
lascia una riga per ogni passo in `renderer.log`. Il `code` non ci finisce mai: è una credenziale.

---

## Lo schema si applica da solo

**Modificare una tabella non richiede di aprire la console SQL.** Si cambia il file
`supabase/*.sql` e la cosa finisce lì: al prossimo merge su `master` la CI esegue quei file sul
progetto, nell'ordine in cui dipendono l'uno dall'altro.

```bash
node scripts/migra-schema.mjs --check     # solo controlla il testo, non scrive
node scripts/migra-schema.mjs --dry-run   # dice che cosa applicherebbe
node scripts/migra-schema.mjs             # applica davvero
```

`scripts/migra-schema.mjs` è il pezzo che lo fa, e in CI è in due posti con due scopi:

| Quando | Cosa | Perché lì |
| --- | --- | --- |
| su **qualsiasi** push e pull request | `--check` | controlla il testo, non scrive niente |
| su push a **`master`** | applica | è il posto in cui lo schema cambia davvero |

La divisione è la parte che conta. Su una pull request la macchina **non deve poter scrivere sul
database**, per quanto sia fidato il branch: su `master` il token c'è, e quel qualcuno non è
necessariamente chi ha aperto la pull request. Applicare lì avrebbe significato che una
pull request potesse cambiare il database di produzione passando per un merge, che è esattamente
ciò che una pull request dovrebbe evitare.

### Perché non `supabase db push`

Lo schema è in tre file che si possono rieseguire — `if not exists`, `create or replace` — e non
in una cartella di migrazioni numerate. Ogni file descrive **lo stato finale**, non un passo, e
rieseguirlo è innocuo: è questa proprietà che permette allo script di non tenere nessun registro
di cosa è già stato applicato. Il database stesso è lo stato, e il file dice come arrivarci da
qualunque punto di partenza — anche da un database di tre settimane fa.

Il rovescio della medaglia è che **non c'è un rollback**. Applicare lo schema non può annullare un
deploy: se un file dice qualcosa di sbagliato, il danno è già dentro. Per questo i file sono
scritti per essere innocui da rieseguire, e non per essere annullabili: nessuno contiene un
`drop table`, e i tre non si cancellano fra loro.

### Cosa non passa da qui, e perché

Tre cose restano a mano, tutte per la stessa ragione: sono **permessi**, non schema.

1. **I due segreti nel Vault** (`notifica_richieste_url`, `notifica_richieste_chiave`). Le righe
   che li creano sono dentro commenti, e `problemiNelSql` **fallisce** se qualcuno le decomenta.
   Applicare una chiave dalla CI significherebbe metterla in un secret di GitHub, che è
   proprio il posto da cui il progetto ha deciso di tenerla fuori. Si creano una volta sola, a
   mano, e da quel momento lo script non li tocca più.

2. **La riga che ti registra come sviluppatore** (`insert into public.sviluppatori`). È la lista
   di chi può leggere le richieste di tutti gli utenti. Se la eseguisse una macchina, chi apre
   una pull request deciderebbe chi vede i dati degli altri, e il merge passerebbe inosservato.
   `promozioniNelSql` blocca `insert`, `update` e `delete` su quella tabella.

3. **Leggere il Vault è invece ammesso**, ed è una distinzione deliberata: il trigger ne ha
   bisogno per funzionare, perché la chiave sta in un posto solo e la funzione non ne ha una
   copia. Bloccare anche la lettura romperebbe le notifiche, e per evitare un guasto che la
   lettura non può causare.

### Se un file non si applica

Lo script **non si ferma al primo errore** e va avanti con gli altri. `notifica-richieste.sql`
mette un trigger su `public.richieste`, quindi fallirebbe se le tabelle non ci fossero ancora —
fermarsi lascerebbe lo schema a metà, che è lo stato peggiore. Al termine esce con codice 1 e il
messaggio dice quale file è fallito e perché.

Un `403` vuol dire che il token può leggere ma non scrivere: serve uno scope `database:write`, e
`verifica-edge-function.mjs` va bene con quello di sola lettura perché non modifica niente. Un
`already exists` vuol dire che un file ha un `create` senza `if not exists`, e da quel momento
ogni merge successivo fallisce: è il difetto che questa automatizzazione rende visibile, perché
prima nessuno lo notava.

## Pubblicare su GitHub Pages

Il repository include già `.github/workflows/deploy-pages.yml`. Per attivarlo:

1. Carica il progetto sul branch `main`.
2. In **Settings → Pages** scegli *Source: GitHub Actions*.
3. In *Settings → Secrets and variables → Actions → Variables* aggiungi le variabili sopra, nella
   scheda dell'ambiente **`prod`**.

Il workflow compila con `BASE_PATH=/Reportini`, copia `index.html` in `404.html` perché il router
funzioni ricaricando una route interna, e usa `public/.nojekyll` per non far intervenire Jekyll.

Ogni variabile `VITE_*` va passata **esplicitamente** allo step *Build*: le variabili dell'ambiente
non arrivano da sole alla compilazione. Per `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` il
workflow sbaglia a morte se mancano; per `VITE_GOOGLE_CLIENT_ID` no — la build esce lo stesso
verde, ma Vite sostituisce la variabile con una stringa vuota, a quel punto `googleConfigured` è
`false` e l'intera funzione di accesso con Google **viene eliminata dal bundle**. Il risultato è
un'app pubblicata che funziona e non fa entrare nessuno con Google, senza un errore in console.
Per questo il workflow avvisa con un `::warning::` quando il client id manca, e l'app nelle
impostazioni dice "Client Google non configurato".

### Il sito deve stare in https

Non è una buona pratica: **senza https l'accesso con Google non funziona**. Google accetta
`redirect_uri` in http solo per `localhost`, quindi su un dominio vero risponde
`redirect_uri_mismatch` e il pulsante "Accedi" sembra premuto ma non succede niente.

L'indirizzo di rientro è costruito da `window.location.origin` (`urlDiRitorno()` in
`src/lib/cloud/destinazione.ts`), quindi *la pagina aperta decide*: aperta in http, il redirect
che va su Google è in http, e fallisce. Sono tre i livelli che lo impediscono, ognuno con un
compito diverso:

1. **GitHub Pages** — in *Settings → Pages*, l'opzione **Enforce HTTPS**. Il server risponde con
   un 301 verso `https://` e il problema sparisce alla fonte. Si può impostare anche dall'API:
   `gh api -X PUT repos/<owner>/<repo>/pages -f cname=<dominio> -F https_enforced=true`.
2. **Cloudflare** — con il record del dominio in modalità **proxied** e **Always Use HTTPS** acceso.
   Copre anche i link e i segnaliboli che puntano a `http://`, e i domini serviti da Cloudflare
   prima che GitHub Pages risponda.
3. **Nel codice** — `indirizzoSicuro()` in `destinazione.ts`, chiamata da `src/main.tsx` prima di
   montare l'app: se la pagina è in http e l'ospite non è locale, la rimanda su https conservando
   percorso, query e frammento. `localhost`, `127.0.0.1` e `::1` sono esclusi di proposito: è da
   lì che si serve l'app desktop, che non ha un certificato e deve restare in http.
   `motivoRientroNonValido()` adesso rifiuta anche un `http://` su dominio vero, con una frase
   che dice la causa invece di lasciare che l'errore arrivi da Google senza nome.

I tre livelli servono tutti: il primo e il secondo chiudono la porta, il terzo copre il caso in
cui qualcuno spegne il primo (per esempio un fork).
