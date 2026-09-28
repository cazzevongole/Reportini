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
bun run test       # test vitest (58 test) + smoke test dello schema
bun run test:ui    # solo i test vitest
```

I test vitest coprono cinque file:

- `tests/app.test.tsx` monta l'app reale in jsdom con un IndexedDB finto: è la rete che
  intercetta i crash a runtime (per esempio un dereferenziamento di `window.reportini` fatto al
  caricamento del modulo, che produceva una pagina bianca). Verifica anche che senza account non
  si veda nessuna pagina interna.
- `tests/avvisi.test.tsx` verifica il meccanismo degli avvisi: successo, errore con la causa,
  auto-chiusura, durata maggiore per gli errori, tetto di tre avvisi contemporanei.
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
