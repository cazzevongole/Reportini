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
| `VITE_DURATA_APERTURA_MS` | secondi (in millisecondi) della schermata di benvenuto; default 5000 |
| _(nessuna per Calendar)_ | il token Google Calendar viaggia sulla sessione Supabase |

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
   Secret del tuo progetto Google Cloud.
3. In **Authentication → URL Configuration** aggiungi in *Redirect URLs* `http://localhost:5173`
   e l'URL delle GitHub Pages. Con il workflow di questo repository l'app è pubblicata in una
   sottocartella, quindi gli URL sono `https://cazzevongole.github.io/Reportini/` e
   `https://cazzevongole.github.io/Reportini/**`.
4. Crea il bucket e le relative politiche RLS: apri `supabase/setup.sql`, copialo tutto ed
   eseguilo nel **SQL Editor** del progetto Supabase (sidebar → *SQL Editor* → *New query* → *Run*).
   È idempotente, quindi puoi rieseguirlo. In fondo ci sono le due query di verifica.
5. Copia il **Project URL** e la chiave **public** (`sb_publishable_…`) nelle variabili
   `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY`.

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
  usare `prompt=consent` per far accettare lo scope aggiuntivo al primo uso (è già così: l'app
  chiede `calendar.events` fin dall'accesso, quindi niente passaggi aggiuntivi).

Nel dubbio: il messaggio è un avviso di Google, non un errore dell'app, e l'accesso funziona
lo stesso — ogni volta che l'app chiede il consenso, però, l'utente lo vede.

### Versionamento e rilascio

La versione non sta in una discussione: sale da sola.

| Dove | Cosa fa |
| --- | --- |
| `scripts/version.mjs` | alza la versione in `package.json` e in `electron/package.json` e scrive il `CHANGELOG.md` |
| `scripts/versione-check.mjs` | controlla che le due versioni coincidano e che il tag sia quello giusto |
| `.github/workflows/auto-version.yml` | a ogni merge su `master` alza la versione (patch) e crea il tag `v<versione>` |
| `.github/workflows/release-electron.yml` | costruisce i pacchetti desktop (mac, Windows, Linux) e pubblica la release come **latest** |

Il rilascio parte sia da un tag `v*` spinto a mano, sia da un push su `master`: in quest'ultimo
caso il workflow prende la versione da `package.json`, crea il tag se manca e non fa niente se
quella versione è già stata rilasciata. Il motivo è che **un workflow non ne innesca un altro
quando usa `GITHUB_TOKEN`**: se il tag lo spingesse solo il workflow di versione, la release non
partirebbe mai.

In pratica: si mergea su `master`, il commit di versione sale da solo, il tag scatta da solo e
la release desktop viene pubblicata come **latest** (le prerelease restano fuori dal latest, se un
giorno serviranno). Il commit di versione tocca solo i tre file della versione, e per quello
`paths-ignore` impedisce al workflow di rilanciarsi da solo all'infinito.

Il rilascio si può forzare a mano: *Actions → Versione automatica → Run workflow* scegliendo
`minor` o `major` invece di `patch`.

La build desktop usa `BASE_PATH` vuoto (l'app si apre da `file://`), e `scripts/copia-renderer.mjs`
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

### Google Calendar (facoltativo)

Non serve un client OAuth dedicato: il token Calendar viaggia sulla **sessione Supabase**,
che fa da client *confidenziale* lato server. Un'app su GitHub Pages non potrebbe farlo da
sola — Google pretende il `client_secret` sia per scambiare l'authorization code sia per
rinnovare il token, anche con PKCE, e metterlo nel browser lo esporrebbe a tutti.

Per abilitarlo:

1. In Google Cloud, sul **client usato da Supabase** (quello con la redirect URI
   `https://<ref>.supabase.co/auth/v1/callback`): *Google Auth Platform → Data Access* →
   aggiungi lo scope `https://www.googleapis.com/auth/calendar.events`
2. In Supabase, *Authentication → Providers → Google*: lo scope deve comparire fra quelli
   concessi

Il token dura un'ora. **Non può essere rinnovato in silenzio**: quando scade serve un nuovo
accesso con Google, e l'app lo dice esplicitamente invece di fallire in silenzio.

Senza questo scope ogni appuntamento si esporta comunque in formato `.ics`.

---

## Script

```bash
bun install
bun run dev        # server di sviluppo su http://localhost:5173
bun run build      # build statica in dist/ (+ 404.html per GitHub Pages)
bun run typecheck  # tsc -b --noEmit
bun run test       # test vitest (105 test) + smoke test dello schema
bun run test:ui    # solo i test vitest
bun run version:check  # la versione è coerente? (lo usa anche il rilascio)
bun run version:patch  # alza la versione di un patch, come fa il workflow
```

I test vitest coprono dodici file:

- `tests/app.test.tsx` monta l'app reale in jsdom con un IndexedDB finto: è la rete che
  intercetta i crash a runtime (per esempio un dereferenziamento di `window.reportini` fatto al
  caricamento del modulo, che produceva una pagina bianca). Verifica anche che senza account non
  si veda nessuna pagina interna.
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
- `tests/google.test.tsx` copre il token Calendar che arriva sulla sessione Supabase: custodia,
  scadenza con un'ora di margine, revoca allo scollegamento e i parametri OAuth richiesti.
- `tests/calendar.e2e.test.tsx` crea un appuntamento, esce e rientra, e verifica che non venga
  pubblicato due volte.
- `tests/aggiornamento.test.tsx` guida l'aggiornamento automatico con un ponte finto (Electron
  non serve): verifica che un controllo automatico fallito resti silenzioso, che quello chiesto a
  mano risponda, che l'avanzamento e il pacchetto pronto si vedano, che «più tardi» nasconda solo
  quella versione e  che nel browser non compaia niente.
- `tests/richieste.test.tsx` prova "Chiedilo allo sviluppatore" con un Supabase finto che
  applica la stessa regola del database (un utente vede solo le proprie richieste, lo
  sviluppatore tutte): l'email viene dalla sessione, il titolo vuoto non parte, lo stato
  cambia solo da sviluppatore, la sezione nascosta rimanda al pannello chi non lo è, e se lo
  script SQL non è stato eseguito l'errore viene tradotto in una frase che dice cosa fare.

`scripts/smoke.mjs` esegue invece lo schema vero su sql.js e controlla che ogni query di
`repo.ts` sia valida, che le chiavi esterne cancellino in cascata e che l'installazione parta
**vuota**.

### Desktop (Electron)

```bash
bun run electron:install   # installa electron ed electron-builder
bun run electron:build     # compila la web e la copia in electron/renderer
bun run electron:pack      # impacchetta (dmg / nsis / AppImage)
```

`electron/main.cjs` apre `electron/renderer/index.html` ed espone via IPC solo quattro operazioni:
leggere il file SQLite, scriverlo, mostrarlo nel file manager e chiedere lo stato
dell'aggiornamento automatico. Il renderer gira con `contextIsolation` e senza accesso a Node.

---

## Pubblicare su GitHub Pages

Il repository include già `.github/workflows/deploy-pages.yml`. Per attivarlo:

1. Carica il progetto sul branch `main`.
2. In **Settings → Pages** scegli *Source: GitHub Actions*.
3. In *Settings → Secrets and variables → Actions → Variables* aggiungi le variabili sopra.

Il workflow compila con `BASE_PATH=/Reportini`, copia `index.html` in `404.html` perché il router
funzioni ricaricando una route interna, e usa `public/.nojekyll` per non far intervenire Jekyll.
