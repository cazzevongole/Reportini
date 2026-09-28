# Reportini

Gestione delle **relazioni associate alle anagrafiche** e degli **appuntamenti sincronizzati con
Google Calendar**. App *mobile first*: si usa dal telefono, dal browser e come applicazione
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

### Modello dei dati

- `anagrafici` — scheda anagrafica (nome, cognome, documento, nascita, domicilio, contatti).
- `relazioni` — relazioni con `anagraficoId` e stato (`bozza`, `revisione`, `firmato`, `consegnato`).
- `appuntamenti` — appuntamenti con `anagraficoId` / `relazioneId`, promemoria e dati Google
  (`googleEventId`, `googleHtmlLink`, `googleSyncAt`).

Le chiavi esterne sono attive (`ON DELETE CASCADE` sulle relazioni, `SET NULL` sugli appuntamenti,
grazie al `PRAGMA foreign_keys = ON` in `migrations.ts`).

**Non ci sono dati dimostrativi**: l'installazione parte vuota.

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
   `http://127.0.0.1:42720` (il pacchetto desktop) e l'URL delle GitHub Pages. Con il workflow di
   questo repository l'app è pubblicata in una sottocartella, quindi gli URL sono
   `https://cazzevongole.github.io/Reportini/` e `https://cazzevongole.github.io/Reportini/**`.
4. Crea il bucket e le relative politiche RLS: apri `supabase/setup.sql`, copialo tutto ed
   eseguilo nel **SQL Editor** del progetto Supabase (sidebar → *SQL Editor* → *New query* → *Run*).
   È idempotente, quindi puoi rieseguirlo. In fondo ci sono le due query di verifica.
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
   (`https://cazzevongole.github.io/Reportini/`), privacy policy e condizioni;
4. nei *Domini autorizzati* aggiungi `cazzevongole.github.io`.

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
| `scripts/version.mjs` | alza la versione in `package.json` e in `electron/package.json` e scrive il `CHANGELOG.md` |
| `scripts/versione-check.mjs` | controlla che le due versioni coincidano e che il tag sia quello giusto |
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
release GitHub, la scarica in sottofondo e, quando il pacchetto è pronto, lo dice: una barra in
alto con **Aggiorna ora**. Se l'utente preferisce rimandare, l'aggiornamento entra comunque alla
chiusura dell'app. Nelle impostazioni c'è anche **Controlla adesso**, che risponde anche quando
non c'è niente da aggiornare.

| Dove | Cosa fa |
| --- | --- |
| `electron/package.json` (`build.publish`) | dice a electron-updater dove cercare: GitHub, repository `cazzevongole/Reportini` |
| `electron/main.cjs` | avvia i controlli, tiene lo stato e lo manda a ogni finestra via IPC |
| `electron/preload.cjs` | espone `window.reportini.aggiornamento` (stato, controlla, installa, eventi) |
| `src/lib/aggiornamento.ts` | store condiviso e decisione su cosa mostrare |
| `src/components/Aggiornamento.tsx` | la barra in alto |

Due dettagli che sembrano secondari e non lo sono:

- **I `latest*.yml` nella release.** Sono il menù che l'app installata legge per capire se
  c'è qualcosa di nuovo. Il workflow li pubblica e, se mancano, **fallisce**: senza
  `latest.yml`, `latest-mac.yml` e `latest-linux.yml` l'aggiornamento non funzionerebbe e
  nessuno se ne accorgerebbe.
- **Lo `.zip` su macOS.** Sulla mac l'aggiornamento automatico può solo sostituire un `.zip`,
  non un `.dmg`: il `.dmg` resta per chi scarica a mano, lo `.zip` serve solo all'auto-update.

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

Le azioni che scrivono solo in locale (anagrafiche, relazioni, appuntamenti, copie di sicurezza)
non fanno richieste di rete e quindi non hanno bisogno di avvisi.

### Chiedilo allo sviluppatore

Nelle impostazioni c'è una sezione **Chiedilo allo sviluppatore**: si scrive cosa non va
(fix) o cosa dovrebbe poter fare il programma (funzionalità), e sotto si vanno le proprie
richieste con lo stato — *da leggere*, *in corso*, *risolta* — e la risposta quando arriva.

Alla URL `/panel/sviluppo` c'è la **sezione nascosta dello sviluppatore**: non è nella barra
e non la vede nessun altro. Chi non è lo sviluppatore viene rimandato al pannello.

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

Per attivarla, una volta sola, nella console SQL di Supabase
(*Dashboard → SQL Editor → New query*):

```bash
# incolla e esegui il file
supabase/richieste.sql
```

Poi la riga unica da scrivere a mano, dentro lo stesso script, è in fondo al file:
`insert into public.sviluppatori (email) values ('<la tua email>')`.

Se lo script non è stato eseguito l'app **non si rompe e lo dice**: al posto del modulo compare
un avviso che nomina il file da eseguire, e la sezione nascosta spiega lo stesso invece di
mandarti fuori con un errore generico.

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

**Per metterlo in piedi** (una volta sola):

1. In Google Cloud crea un **client OAuth di tipo "Applicazione web"**. Ne serve **uno solo**,
   lo stesso che va configurato su Supabase: `signInWithIdToken` valida l'`id_token` con il
   Client ID del progetto, quindi i due devono coincidere.
2. Nei *URI di reindirizzamento autorizzati* metti:
   - l'URL di callback di Supabase (lo trovi in *Authentication → Providers → Google*),
   - `https://cazzevongole.github.io/Reportini`,
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
supabase secrets set ORIGINI_AMMESSE=https://cazzevongole.github.io,http://localhost:5173
```

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
| Appuntamento portato ad "annullato" | **segnal annullato** sull'evento, che resta in agenda scritto *Cancelled* |
| Appuntamento **eliminato** | **toglie** l'evento dal calendario di Google |
| Spunta disattivata | salva solo in locale, Google non viene toccato |

Lo stato segue l'appuntamento, quindi l'evento dice sempre la stessa cosa
che dice l'app. Un annullato in Google Calendar non è sparito, è scritto
*Cancelled* nella sua fascia: è la differenza fra "non si è più tenuto" e
"non è mai esistito", e senza quell'informazione l'app e il calendario si
contraddirebbero. Il collegamento all'evento resta anche quando l'appuntamento
è annullato, così la prossima modifica non crea un secondo evento.

L'unico modo di togliere davvero l'evento è **eliminare** l'appuntamento, o
premere "Su Google" su un appuntamento già pubblicato, che è lo scollegamento
manuale.

Due dettagli che contano più di quanto sembrino:

- **Prima il locale, poi Google.** Il salvataggio nell'app non dipende dalla rete: se Google è
  irraggiungibile l'appuntamento è salvo lo stesso e l'avviso dice che non è stato pubblicato. Si
  riprova con **Invia a Google** nella lista appuntamenti, senza riscriverlo.
- **Un appuntamento annullato non può restare in agenda senza dirlo.** L'evento non viene
  cancellato, viene segnato annullato: Google Calendar accetta `status: "cancelled"` e lo
  mostra come *Cancelled*. Sarebbe più semplice sparirlo del tutto, ma si perderebbe la traccia
  di un appuntamento che è esistito, e il calendario direbbe una cosa diversa dall'app.
- **Il contesto dell'anagrafico vive solo nell'evento.** All'evento viene aggiunto
  `Anagrafico: …`, `Documento: …` e `Relazione: …`; la descrizione che l'utente scrive resta quella
  nel database e nel modulo di modifica. Scollegare l'evento tocca **solo** i marcatori di Google
  (`rimuoviCollegamentoGoogle()`), non riscrive l'appuntamento: prima scriveva qui anche la
  descrizione arricchita, e il blocco si accodava a ogni passaggio fino a ripetersi due, tre volte.

---

## Script

```bash
bun install
bun run dev        # server di sviluppo su http://localhost:5173
bun run build      # build statica in dist/ (+ 404.html per GitHub Pages)
bun run typecheck  # tsc -b --noEmit
bun run test       # test vitest (158 test) + smoke test dello schema
bun run test:ui    # solo i test vitest
bun run version:check  # la versione è coerente? (lo usa anche il rilascio)
bun run version:patch  # alza la versione di un patch, come fa il workflow
```

I test vitest coprono dodici file:

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
  via i riferimenti orfani e che le chiavi esterne restino attive anche dopo un salvataggio
  (sql.js chiude e riapre il database a ogni export: senza rimettere il PRAGMA, le cascate
  smetterebbero di funzionare).
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
- `tests/calendar.e2e.test.tsx` gira sul motore vero e copre il calendario: pubblica un
  appuntamento, esce e rientra e verifica che non venga pubblicato due volte, che lo scollegamento
  elimini l'evento remoto e che un errore di Google non lasci marcatori falsi. Verifica anche la
  **pubblicazione automatica**: che cosa fa il modulo quando si salva — evento nuovo, aggiornamento
  di quello esistente, rimozione se l'appuntamento viene annullato — e che la spunta disattivata
  salvi in locale senza toccare Google. E che **eliminare** un appuntamento taga l'evento, con il
  caso in cui Google non risponde: l'appuntamento resta in lista e si riprova, invece di lasciare
  un evento orfano di cui l'app non sa più niente. Verifica infine che il contesto dell'anagrafico
  (nome, documento, relazione) finisca **solo** nell'evento e non nella descrizione salvata: è la
  duplicazione che si vedeva a ogni modifica.
- `tests/aggiornamento.test.tsx` guida l'aggiornamento automatico con un ponte finto (Electron
  non serve): verifica che un controllo automatico fallito resti silenzioso, che quello chiesto a
  mano risponda, che l'avanzamento e il pacchetto pronto si vedano, che «più tardi» nasconda solo
  quella versione e  che nel browser non compaia niente.
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
