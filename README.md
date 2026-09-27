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
l'account. Ogni scrittura viene replicata in background con un cooldown di 5 secondi.

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
| `VITE_GOOGLE_CLIENT_ID` | client OAuth per pubblicare gli appuntamenti su Google Calendar |

> **Non usare mai la chiave `secret`.** Le nuove chiavi `sb_secret_…` sostituiscono la vecchia
> `service_role`: danno accesso completo al database e ignorano le Row Level Security, e finiscono
> nel bundle perché Vite le sostituisce staticamente. Chiunque apra la pagina potrebbe leggere e
> scrivere i dati di tutti. Per questo la build di produzione **si rifiuta di partire** se trova
> una chiave privilegiata, e in sviluppo l'app mostra un avviso e resta in sola modalità locale.
> Se ti è capitato di usarla per sbaglio, **revocala** dalla pagina API keys di Supabase.

La pagina *Impostazioni → Verifica integrazione* controlla endpoint, tipo di chiave, provider
Google e bucket, e dice cosa sistemare quando qualcosa non torna.

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

Gli account la cui email è in `VITE_DEV_WHITELIST` vedono una voce in più nel menu e la pagina
`/panel/sviluppo`, con stato dei dati, controllo della sincronizzazione e azioni di manutenzione.

> La whitelist viene compilata nel bundle del browser: protegge contro accessi casuali, **non** è
> un controllo di sicurezza. Per una barriera vera va verificata lato server.

### Google Calendar (facoltativo)

1. In Google Cloud attiva la **Google Calendar API** e crea un client OAuth 2.0 di tipo
   *Web application*.
2. Aggiungi fra le *origini JavaScript autorizzate* `http://localhost:5173` e
   `https://cazzevongole.github.io`.
3. Salva il Client ID in `VITE_GOOGLE_CLIENT_ID`.

Senza questa chiave ogni appuntamento si esporta comunque in formato `.ics`.

---

## Script

```bash
bun install
bun run dev        # server di sviluppo su http://localhost:5173
bun run build      # build statica in dist/ (+ 404.html per GitHub Pages)
bun run typecheck  # tsc -b --noEmit
bun run test       # test vitest (25 test) + smoke test dello schema
bun run test:ui    # solo i test vitest
```

I test vitest coprono due file:

- `tests/app.test.tsx` monta l'app reale in jsdom con un IndexedDB finto: è la rete che
  intercetta i crash a runtime (per esempio un dereferenziamento di `window.reportini` fatto al
  caricamento del modulo, che produceva una pagina bianca).
- `tests/cloud.test.tsx` verifica con un client Supabase finto l'accesso con Google, il
  caricamento e il ripristino della copia online, l'auto-salvataggio dopo ogni modifica, il
  gating della dashboard sviluppatore per whitelist e il controllo del bucket.

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
