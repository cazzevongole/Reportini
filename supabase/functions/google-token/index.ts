// =============================================================================
// Reportini · backend Google (Supabase Edge Function)
//
// Il problema che risolve: un'app ospitata su GitHub Pages è un client
// pubblico e non ha un backend dove custodire il client_secret di Google.
// Provato sull'endpoint reale, Google risponde:
//
//   POST https://oauth2.googleapis.com/token
//   → {"error":"invalid_request","error_description":"client_secret is missing."}
//
// e lo fa anche in PKCE. Quindi dal browser non si può scambiare l'authorization
// code né rinnovare il token: mettere il secret nel bundle lo darebbe a
// chiunque.
//
// Questa funzione è il pezzo che manca. Sta nel progetto Supabase, dove i
// segreti non finiscono nel bundle, e fa tre cose:
//
//   scambio  { code, redirect_uri } → scambia il code e restituisce
//             id_token + token del calendario
//   rinnovo  { refresh_token }      → rinnova l'access token in silenzio
//   revoca   { token }              → revoca il consenso
//
// **Un solo consenso per login e calendario.** Lo `id_token` che torna dallo
// scambio viene passato dal browser a Supabase con `signInWithIdToken`, che
// lo valida con lo stesso Client ID configurato nel progetto: per questo i
// due devono essere lo stesso client OAuth di tipo "Applicazione web".
//
// Deploy (una volta sola):
//   supabase functions deploy google-token --no-verify-jwt
//   supabase secrets set GOOGLE_CLIENT_ID=<client id>
//   supabase secrets set GOOGLE_CLIENT_SECRET=<client secret>
//   supabase secrets set SUPABASE_URL=<project url>
//   supabase secrets set SUPABASE_ANON_KEY=<chiave pubblica>
//   supabase secrets set ORIGINI_AMMESSE=https://cazzevongole.github.io,http://localhost:5173
//
// Perché `--no-verify-jwt`: lo scambio avviene *durante* l'accesso, quando
// l'utente non ha ancora una sessione da cui trarre un JWT. Il prezzo è che
// lo `scambio` è aperto a chiunque: ma l'unica cosa che se ne ottiene è una
// sessione per il proprio account Google, attraverso il nostro client, che è
// pubblico per definizione. `rinnovo` e `revoca` invece richiedono una
// sessione vera, e questa funzione la verifica da sé chiamando Supabase Auth.

const ORIGINE_TOKEN = "https://oauth2.googleapis.com/token";
const ORIGINE_REVOCA = "https://oauth2.googleapis.com/revoke";

interface Env {
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  SUPABASE_URL?: string;
  SUPABASE_ANON_KEY?: string;
  /** Origini autorizzate, separate da virgola. */
  ORIGINI_AMMESSE?: string;
}

const PREDEFINITE = [
  "https://cazzevongole.github.io",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
];

function originiAmmesse(env: Env): string[] {
  const configurate = (env.ORIGINI_AMMESSE ?? "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
  return configurate.length > 0 ? configurate : PREDEFINITE;
}

/**
 * L'eco dell'origine, ma solo se è in lista. `*` qui non romperebbe nulla,
 * ma un elenco esplicito dice cosa è aspettato e dove.
 */
function intestazioniCors(richiesta: Request, env: Env): Record<string, string> {
  const origine = richiesta.headers.get("origin") ?? "";
  const ammesse = originiAmmesse(env);
  return {
    "Access-Control-Allow-Origin": ammesse.includes(origine) ? origine : ammesse[0],
    "Access-Control-Allow-Headers": "authorization,content-type,apikey",
    "Access-Control-Allow-Methods": "POST,OPTIONS",
    "Vary": "Origin",
  };
}

function json(corpo: unknown, stato: number, richiesta: Request, env: Env): Response {
  return new Response(JSON.stringify(corpo), {
    status: stato,
    headers: { ...intestazioniCors(richiesta, env), "Content-Type": "application/json" },
  });
}

function segretiMancanti(env: Env): string[] {
  return [
    env.GOOGLE_CLIENT_ID ? "" : "GOOGLE_CLIENT_ID",
    env.GOOGLE_CLIENT_SECRET ? "" : "GOOGLE_CLIENT_SECRET",
    // Non servono allo scambio, ma senza questi la funzione non può
    // verificare la sessione: meglio dirlo qui che rispondere "401 serve un
    // account" a chi invece ha dimenticato un segreto.
    env.SUPABASE_URL ? "" : "SUPABASE_URL",
    env.SUPABASE_ANON_KEY ? "" : "SUPABASE_ANON_KEY",
  ].filter(Boolean);
}

/**
 * C'è davvero un utente Reportini dietro a questa richiesta?
 *
 * Va verificata qui perché la funzione è pubblicata senza la verifica
 * automatica di Supabase (vedi la nota in cima). Il rimedio è chiedere a
 * Supabase Auth chi è: se risponde 200, il JWT è buono.
 */
async function sessioneVerificata(richiesta: Request, env: Env): Promise<boolean> {
  const portatore = richiesta.headers.get("authorization") ?? "";
  if (!portatore.startsWith("Bearer ")) return false;
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) return false;
  const risposta = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: {
      Authorization: portatore,
      apikey: env.SUPABASE_ANON_KEY,
    },
  });
  return risposta.ok;
}

Deno.serve(async (richiesta: Request): Promise<Response> => {
  const env = Deno.env.toObject() as unknown as Env;
  const cors = intestazioniCors(richiesta, env);

  // Il preflight: senza questo il browser non manda nemmeno il POST.
  if (richiesta.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors });
  }

  if (richiesta.method !== "POST") {
    return json({ errore: "Serve un POST." }, 405, richiesta, env);
  }

  const mancanti = segretiMancanti(env);
  if (mancanti.length > 0) {
    // 503 e non 500: non è un bug, è una funzione pubblicata senza segreti.
    return json(
      {
        errore: `Backend Google non pronto: manca ${mancanti.join(" e ")}. Caricali con "supabase secrets set <NOME>=<valore>".`,
      },
      503,
      richiesta,
      env,
    );
  }

  let corpo: {
    azione?: string;
    code?: string;
    redirect_uri?: string;
    refresh_token?: string;
    token?: string;
  };
  try {
    corpo = await richiesta.json();
  } catch {
    return json({ errore: "Corpo della richiesta non leggibile." }, 400, richiesta, env);
  }

  // Tutto tranne lo scambio chiede un account Reportini.
  if (corpo.azione !== "scambio" && !(await sessioneVerificata(richiesta, env))) {
    return json(
      { errore: "Serve un account Reportini per questa operazione." },
      401,
      richiesta,
      env,
    );
  }

  const posta = async (parametri: Record<string, string>): Promise<Response> => {
    return await fetch(ORIGINE_TOKEN, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(parametri).toString(),
    });
  };

  try {
    switch (corpo.azione) {
      /* ------------ scambio: qui nascono sia la sessione sia il calendario ---- */
      case "scambio": {
        if (!corpo.code || !corpo.redirect_uri) {
          return json({ errore: "Servono code e redirect_uri." }, 400, richiesta, env);
        }
        const risposta = await posta({
          code: corpo.code,
          client_id: env.GOOGLE_CLIENT_ID,
          client_secret: env.GOOGLE_CLIENT_SECRET,
          // Deve essere identico a quello usato per l'authorize, altrimenti
          // Google risponde "redirect_uri_mismatch".
          redirect_uri: corpo.redirect_uri,
          grant_type: "authorization_code",
        });
        const dati = await risposta.json();
        if (!risposta.ok) {
          return json(
            { errore: dati?.error_description ?? "Google ha rifiutato lo scambio del codice." },
            400,
            richiesta,
            env,
          );
        }
        if (!dati.id_token) {
          // Succede solo se l'authorize non avesse chiesto lo scope "openid":
          // senza id_token non c'è nemmeno la sessione.
          return json(
            { errore: "Nessun id_token: lo scope openid manca nella richiesta di accesso." },
            400,
            richiesta,
            env,
          );
        }
        return json(
          {
            // Supabase valida questo token con il Client ID configurato nel
            // progetto: è lui che apre la sessione, non questa funzione.
            id_token: dati.id_token,
            access_token: dati.access_token,
            // Con access_type=offline Google lo manda alla prima e poi può
            // smettere: in quel caso si tiene il precedente.
            refresh_token: dati.refresh_token ?? null,
            expires_in: dati.expires_in ?? 3600,
            token_type: dati.token_type ?? "Bearer",
          },
          200,
          richiesta,
          env,
        );
      }

      /* ------------------------------ rinnovo silenzioso -------------------- */
      case "rinnovo": {
        if (!corpo.refresh_token) {
          return json({ errore: "Manca il refresh_token." }, 400, richiesta, env);
        }
        const risposta = await posta({
          refresh_token: corpo.refresh_token,
          client_id: env.GOOGLE_CLIENT_ID,
          client_secret: env.GOOGLE_CLIENT_SECRET,
          grant_type: "refresh_token",
        });
        const dati = await risposta.json();
        if (!risposta.ok) {
          // invalid_grant vuol dire che il consenso è stato revocato: in quel
          // caso l'utente deve ricollegarsi, ed è giusto che glielo si dica.
          return json(
            {
              errore:
                dati?.error === "invalid_grant"
                  ? "Il collegamento con Google non è più valido: ricollegalo dalle impostazioni."
                  : (dati?.error_description ?? "Rinnovo non riuscito."),
            },
            dati?.error === "invalid_grant" ? 401 : 400,
            richiesta,
            env,
          );
        }
        return json(
          {
            access_token: dati.access_token,
            refresh_token: dati.refresh_token ?? corpo.refresh_token,
            expires_in: dati.expires_in ?? 3600,
            token_type: dati.token_type ?? "Bearer",
          },
          200,
          richiesta,
          env,
        );
      }

      /* --------------------------------- revoca ---------------------------- */
      case "revoca": {
        if (!corpo.token) return json({ errore: "Manca il token da revocare." }, 400, richiesta, env);
        const risposta = await fetch(`${ORIGINE_REVOCA}?token=${encodeURIComponent(corpo.token)}`, {
          method: "POST",
        });
        return json({ revocato: risposta.ok }, 200, richiesta, env);
      }

      default:
        return json({ errore: "Azione sconosciuta." }, 400, richiesta, env);
    }
  } catch (causa) {
    // Rete o Google irraggiungibili: si risponde 502 così il client distingue
    // "backend giù" da "consenso non valido".
    console.error("google-token:", causa);
    return json({ errore: "Backend non raggiungibile." }, 502, richiesta, env);
  }
});
