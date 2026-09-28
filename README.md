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
| `VITE_DEV_WHITELIST` | email separate da virgola autorizzate alla dashboard sviluppatore |
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

### Dashboard sviluppatore

Gli account la cui email è in `VITE_DEV_WHITELIST` vedono un badge *Sviluppo* nelle impostazioni e
possono aprire `/panel/sviluppo`, con stato dei dati, controllo della sincronizzazione e azioni di
manutenzione. Non c'è una voce di menu: si arriva alla pagina con l'indirizzo.

> La whitelist viene compilata nel bundle del browser: protegge contro accessi casuali, **non** è
> un controllo di sicurezza. Per una barriera vera va verificata lato server.

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
bun run test       # test vitest (83 test) + smoke test dello schema
bun run test:ui    # solo i test vitest
bun run version:check  # la versione è coerente? (lo usa anche il rilascio)
bun run version:patch  # alza la versione di un patch, come fa il workflow
```

I test vitest coprono otto file:

- `tests/app.test.tsx` monta l'app reale in jsdom con un IndexedDB finto: è la rete che
  intercetta i crash a runtime (per esempio un dereferenziamento di `window.reportini` fatto al
  caricamento del modulo, che produceva una pagina bianca). Verifica anche che senza account non
  si veda nessuna pagina interna.
- `tests/avvisi.test.tsx` verifica il meccanismo degli avvisi: successo, errore con la causa,
  auto-chiusura, durata maggiore per gli errori, tetto di tre avvisi contemporanei.
- `tests/backup.test.tsx` verifica il versionamento: una copia per ora, potatura a tre giorni,
  scarto delle versioni successive, anteprima che legge una copia senza toccare il database di
  lavoro, e il percorso completo "guarda e richiudi" / "riparti da qui" dalle impostazioni.
- `tests/repo.test.ts` gira sul motore SQLite vero e controlla le cancellazioni: che portino
  via i riferimenti orfani e che le chiavi esterne restino attive anche dopo un salvataggio
  (sql.js chiude e riapre il database a ogni export: senza rimettere il PRAGMA, le cascate
  smetterebbero di funzionare).
- `tests/benvenuto.test.ts` e `tests/versione.test.ts` coprono i messaggi di benvenuto e il
  controllo di versione che fa scoppiare il rilascio se il tag non torna.
- `tests/cloud.test.tsx` verifica con un client Supabase finto l'accesso con Google, il
  caricamento e il ripristino della copia online, il pulsante "Salva subito online" con
  l'id dell'utente e non l'email, l'auto-salvataggio dopo ogni modifica, il
  gating della dashboard sviluppatore per whitelist, il controllo del bucket, la barra di
  navigazione, l'assenza di sezioni di sviluppo nelle impostazioni e la presenza di account e
  uscita sempre lì, e non in cima alle pagine.
- `tests/google.test.tsx` copre il token Calendar che arriva sulla sessione Supabase: custodia,
  scadenza con un'ora di margine, revoca allo scollegamento e i parametri OAuth richiesti.
- `tests/calendar.e2e.test.tsx` crea un appuntamento, esce e rientra, e verifica che non venga
  pubblicato due volte.

`scripts/smoke.mjs` esegue invece lo schema vero su sql.js e controlla che ogni query di
`repo.ts` sia valida, che le chiavi esterne cancellino in cascata e che l'installazione parta
**vuota**.

### Desktop (Electron)

```bash
bun run electron:install   # installa electron ed electron-builder
bun run electron:build     # compila la web e la copia in electron/renderer
bun run electron:pack      # impacchetta (dmg / nsis / AppImage)
```

`electron/main.cjs` apre `electron/renderer/index.html` ed espone via IPC solo tre operazioni:
leggere il file SQLite, scriverlo e mostrarlo nel file manager. Il renderer gira con
`contextIsolation` e senza accesso a Node.

---

## Pubblicare su GitHub Pages

Il repository include già `.github/workflows/deploy-pages.yml`. Per attivarlo:

1. Carica il progetto sul branch `main`.
2. In **Settings → Pages** scegli *Source: GitHub Actions*.
3. In *Settings → Secrets and variables → Actions → Variables* aggiungi le variabili sopra.

Il workflow compila con `BASE_PATH=/Reportini`, copia `index.html` in `404.html` perché il router
funzioni ricaricando una route interna, e usa `public/.nojekyll` per non far intervenire Jekyll.
