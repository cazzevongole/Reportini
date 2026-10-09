// Interroga la funzione `google-token` **pubblicata** e dice se risponde come
// deve.
//
//   node scripts/prova-backend.mjs https://<ref>.supabase.co
//
// Perché serve. `scripts/verifica-edge-function.mjs` confronta il *codice*
// (repository contro Supabase) e per farlo vuole un token di accesso. Questo
// guarda l'altra metà: la funzione risponde, e risponde bene a chi la chiama
// dal browser. Sono due domande diverse, e la seconda si rompe in silenzio —
// una funzione pubblicata e identica al repository può comunque avere i
// segreti vuoti, un elenco di origini sbagliato, o un progetto che non
// risponde più.
//
// Il caso che ha reso necessario il controllo è già successo una volta: al
// passaggio a reportini.cazzevongole.com l'elenco delle origini ammesse aveva
// il dominio nuovo nel repository e quello vecchio su Supabase, il preflight
// rispondeva con l'origine di ripiego, e l'accesso con Google si fermava senza
// nominare la causa. Da fuori non si vedeva niente: la funzione rispondeva,
// solo non a quella domanda.
//
// **Non ha segreti e non ne vuole.** Usa solo quello che il browser usa già:
// l'indirizzo pubblico del progetto e nessuna chiave. Non modifica niente —
// un GET, dei preflight, e uno scambio con un **codice finto**, che Google
// rifiuta e di cui non resta traccia. È proprio da quel rifiuto che si capisce
// se il backend sa parlare con Google: con i segreti mancanti la funzione
// risponde 503 senza nemmeno provarci, e con il client sbagliato Google
// risponde `invalid_client`.
//
// Come si comporta:
//
//   - senza l'indirizzo del progetto non può interrogare nessuno: esce
//     dicendolo, e non fallisce. Su un fork la variabile non c'è, e un
//     controllo che fallisce perché non ha di che lavorare è un controllo che
//     si impara a ignorare (la stessa scelta del confronto dei sorgenti);
//   - con l'indirizzo, ogni sonda che non risponde come deve è un errore e
//     l'uscita è 1, con scritto cosa è arrivato davvero: chi legge deve poter
//     decidere se è il backend o è l'attesa a essere sbagliata.
//
// L'origine del sito si può cambiare con `PROVA_ORIGINE`, per provare un
// dominio nuovo prima di spostarci l'app.

import { pathToFileURL } from "node:url";

/** Il sito, cioè l'origine che la funzione deve riconoscere per prima. */
const ORIGINE_SITO = "https://reportini.cazzevongole.com";
/** Il pacchetto desktop: le origini in loopback sono ammesse sempre. */
const ORIGINE_DESKTOP = "http://127.0.0.1:42720";
/** Un'origine che non deve mai ricevere l'eco, qualunque sia l'elenco. */
const ORIGINE_ESTRANEA = "https://estraneo.example";

/** Quanto si aspetta una risposta prima di considerarla perduta. */
const ATTESA_MS = 15_000;

/**
 * Il rifiuto che Google dà a un codice finto, ed è quello che si vuole vedere.
 *
 * Un codice malformato è `invalid_grant` / "Malformed auth code."; un client
 * sbagliato è `invalid_client`, che è un guasto vero e va detto. Distinguerli
 * è tutto il punto della prova: senza, un client secret sbagliato passerebbe
 * per un successo, perché anche lui è un 400.
 */
const RIFIUTO_ATTESO = /malformed auth code|invalid_grant/i;

function descrivi(esito) {
  const testo = (esito.testo ?? "").replace(/\s+/g, " ").slice(0, 120);
  return `${esito.stato} ${testo}`.trim();
}

/**
 * Una richiesta, con un tentativo in più se la rete o Google hanno un
 * singhiozzo.
 *
 * Un 5xx isolato non deve far diventare rossa la CI: un backend davvero giù
 * risponde male anche al secondo tentativo, mentre una risposta persa per
 * strada una volta sola non è una regressione di questo repository. I due
 * tentativi sono distanziati perché un guasto momentaneo non è finito
 * nell'istante in cui è cominciato.
 */
async function unaVolta(richiesta) {
  const risposta = await fetch(richiesta.url, {
    method: richiesta.metodo ?? "POST",
    headers: { Origin: richiesta.origine, ...(richiesta.intestazioni ?? {}) },
    body: richiesta.corpo ? JSON.stringify(richiesta.corpo) : undefined,
    signal: AbortSignal.timeout(ATTESA_MS),
  });
  const testo = await risposta.text();
  let corpo = null;
  try {
    corpo = JSON.parse(testo);
  } catch {
    // Non è JSON: resta il testo, che nel messaggio serve comunque.
  }
  return {
    stato: risposta.status,
    intestazioni: Object.fromEntries(risposta.headers),
    corpo,
    testo,
  };
}

async function chiedi(richiesta) {
  let ultimo = null;
  for (let tentativo = 1; tentativo <= 2; tentativo += 1) {
    try {
      const esito = await unaVolta(richiesta);
      if (esito.stato < 500 || tentativo === 2) return esito;
      ultimo = esito;
    } catch (causa) {
      ultimo = { errore: causa instanceof Error ? causa.message : String(causa) };
      if (tentativo === 2) return ultimo;
    }
    await new Promise((gira) => setTimeout(gira, 2_000));
  }
  return ultimo;
}

/**
 * Il preflight ha risposto con l'origine che gli è stata chiesta?
 *
 * È il controllo che si rompe in silenzio. La funzione risponde 204 **anche
 * quando l'origine non è in elenco**: cambia solo `Access-Control-Allow-Origin`,
 * che è l'unica cosa che il browser guarda. Visto con curl il preflight sembra
 * a posto, e nel browser ogni richiesta viene rifiutata.
 */
function attesoPreflight(esito, origine, quandoManca) {
  const torna = esito.intestazioni["access-control-allow-origin"];
  if (esito.stato !== 204) return `ha risposto ${descrivi(esito)} invece di 204.`;
  if (torna !== origine) {
    return `ha risposto con l'origine "${torna ?? "(nessuna)"}" invece di "${origine}": ${quandoManca}`;
  }
  return null;
}

/**
 * Le sonde, ognuna con cosa deve tornare indietro.
 *
 * `atteso` restituisce il problema (una frase) o `null` quando va bene: il
 * messaggio si scrive qui accanto alla condizione che lo fa scattare, così non
 * c'è un secondo posto da aggiornare quando l'attesa cambia.
 */
export function prove({ funzione, origine, origineLocale, origineEstranea }) {
  const preflight = (da) => ({
    url: funzione,
    metodo: "OPTIONS",
    origine: da,
    intestazioni: {
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "authorization,content-type",
    },
  });
  const invio = (corpo) => ({
    url: funzione,
    metodo: "POST",
    origine,
    intestazioni: { "Content-Type": "application/json" },
    corpo,
  });

  return [
    {
      nome: "La funzione è pubblicata",
      richiesta: { url: funzione, metodo: "GET", origine },
      atteso(esito) {
        if (esito.stato === 404) {
          return (
            "non risulta pubblicata su questo progetto (404): pubblicala con " +
            "`supabase functions deploy google-token --no-verify-jwt`."
          );
        }
        if (esito.stato !== 405) return `ha risposto ${descrivi(esito)} invece di 405.`;
        if (!/serve un post/i.test(esito.corpo?.errore ?? "")) {
          return `ha risposto 405 ma con "${esito.testo.slice(0, 80)}" invece di "Serve un POST."`;
        }
        return null;
      },
    },
    {
      nome: `Il preflight risponde al sito (${origine})`,
      richiesta: preflight(origine),
      atteso(esito) {
        return attesoPreflight(
          esito,
          origine,
          "nel browser il preflight passa, la richiesta no: l'elenco `ORIGINI_AMMESSE` della " +
            "funzione non contiene questa origine (o la contiene con una virgola scritta male, " +
            "che dà una sola origine lunghissima e nessun avviso).",
        );
      },
    },
    {
      nome: `Il preflight risponde all'app desktop (${origineLocale})`,
      richiesta: preflight(origineLocale),
      atteso(esito) {
        return attesoPreflight(
          esito,
          origineLocale,
          "le origini in loopback devono essere ammesse a prescindere dall'elenco: se questa " +
            "non torna, la versione pubblicata non ha più la regola che le riconosce, e " +
            "l'accesso dal pacchetto desktop si ferma.",
        );
      },
    },
    {
      nome: `Un'origine estranea non riceve l'eco (${origineEstranea})`,
      richiesta: preflight(origineEstranea),
      atteso(esito) {
        const torna = esito.intestazioni["access-control-allow-origin"];
        if (torna === origineEstranea) {
          return (
            "la funzione ha risposto con l'origine che le è stata chiesta: se qualunque sito " +
            "riceve l'eco, il suo JavaScript può chiamare `google-token` dal browser di chi lo " +
            "visita. `ORIGINI_AMMESSE` deve elencare le origini, non ammetterle tutte."
          );
        }
        return null;
      },
    },
    {
      nome: "Lo scambio arriva fino a Google",
      richiesta: invio({
        azione: "scambio",
        code: "codice-finto-di-prova",
        redirect_uri: origine,
      }),
      atteso(esito) {
        if (esito.stato === 404) return "non risulta pubblicata su questo progetto (404).";
        const rifiuto = esito.corpo?.errore ?? esito.testo;
        if (esito.stato === 503) {
          return `i segreti non sono caricati: ${rifiuto}`;
        }
        if (/invalid_client|oauth client was not found/i.test(rifiuto)) {
          return (
            `Google non riconosce il client: ${rifiuto}. ` +
            "`GOOGLE_CLIENT_ID` e `GOOGLE_CLIENT_SECRET` non sono dello stesso client OAuth, " +
            "o sono di un altro progetto."
          );
        }
        if (/redirect_uri_mismatch/i.test(rifiuto)) {
          return `il redirect_uri dichiarato non è registrato in Google: ${rifiuto}`;
        }
        if (esito.stato === 400 && RIFIUTO_ATTESO.test(rifiuto)) return null;
        return (
          `ha risposto ${descrivi(esito)} invece del rifiuto di un codice finto ` +
          '(400 con un errore del tipo "Malformed auth code.").'
        );
      },
    },
    {
      nome: "Il rinnovo pretende un account",
      richiesta: invio({ azione: "rinnovo" }),
      atteso(esito) {
        if (esito.stato === 401) return null;
        return (
          `ha risposto ${descrivi(esito)} invece di 401: il rinnovo deve pretendere una ` +
          "sessione, altrimenti chiunque può farsi rinnovare un token altrui."
        );
      },
    },
  ];
}

/**
 * I problemi delle sonde, nell'ordine in cui sono state fatte.
 *
 * Vuota quando il backend è quello che deve essere: è il caso che la CI
 * richiede. Una richiesta che non è nemmeno partita è un problema quanto una
 * risposta sbagliata, e va detto con la causa (rete, DNS, timeout).
 */
export function problemi(esiti) {
  const trovati = [];
  for (const { prova, esito } of esiti) {
    if (esito.errore) {
      trovati.push(`${prova.nome}: la richiesta non è arrivata (${esito.errore}).`);
      continue;
    }
    const problema = prova.atteso(esito);
    if (problema) trovati.push(`${prova.nome}: ${problema}`);
  }
  return trovati;
}

/** L'indirizzo del progetto: dalla riga di comando, poi dall'ambiente. */
function indirizzoProgetto() {
  const daArgomento = (process.argv[2] ?? "").trim();
  const daAmbiente = (process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? "").trim();
  return (daArgomento || daAmbiente).replace(/\/+$/, "");
}

// Si esegue solo se il file è il punto d'ingresso, così i test possono
// importare `prove` e `problemi` senza far partire richieste di rete.
const ingresso = process.argv[1] ? pathToFileURL(process.argv[1]).href : null;
if (ingresso === import.meta.url) {
  const base = indirizzoProgetto();
  if (!base) {
    // Non è un fallimento: è un controllo che in questo ambiente non può
    // girare. Si dice quale indirizzo serve e si esce senza rompere la build.
    console.log(
      "Backend non interrogato: manca l'indirizzo del progetto. Passalo come argomento " +
        "(node scripts/prova-backend.mjs https://<ref>.supabase.co) oppure in SUPABASE_URL — " +
        "in CI è la variabile VITE_SUPABASE_URL dell'ambiente 'prod'.",
    );
    process.exit(0);
  }

  const funzione = `${base}/functions/v1/google-token`;
  const origine = (process.env.PROVA_ORIGINE ?? ORIGINE_SITO).trim();

  const esiti = [];
  for (const prova of prove({
    funzione,
    origine,
    origineLocale: ORIGINE_DESKTOP,
    origineEstranea: ORIGINE_ESTRANEA,
  })) {
    const esito = await chiedi(prova.richiesta);
    esiti.push({ prova, esito });
    console.log(
      `· ${prova.nome}: ${esito.errore ? `niente risposta (${esito.errore})` : descrivi(esito)}`,
    );
  }

  const trovati = problemi(esiti);
  if (trovati.length > 0) {
    console.error(trovati.map((problema) => `ERRORE: ${problema}`).join("\n"));
    process.exit(1);
  }
  console.log(`Backend a posto: ${funzione} risponde come deve da ${origine}.`);
  process.exit(0);
}
