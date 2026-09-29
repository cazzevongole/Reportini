// Controlla che la Edge Function pubblicata sia il codice che sta nel
// repository.
//
//   node scripts/verifica-edge-function.mjs
//
// Perché serve. La funzione `google-token` gira su Supabase e il suo codice
// vive qui. Sono due copie distinte di cosa dovrebbe essere lo stesso
// programma, e nessuna delle due avvisa l'altra quando divergono: si
// scoprono solo quando qualcuno non riesce a entrare.
//
// Non è un caso ipotetico. Dopo il passaggio a reportini.cazzevongole.com il
// codice nel repository aveva il nuovo dominio nell'elenco delle origini
// ammesse, ma la funzione pubblicata era ancora la versione precedente: il
// preflight CORS rispondeva con l'origine sbagliata e l'accesso con Google
// si fermava. Un errore che non nomina la causa.
//
// Come si comporta:
//
//   - senza SUPABASE_ACCESS_TOKEN non può interrogare l'API: esce dicendolo,
//     e non fallisce. In locale e su un fork non c'è il token, e un controllo
//     che non può girare è uno che si impara a ignorare;
//   - con il token, confronta il sorgente pubblicato con quello del
//     repository e, se differiscono, dice cosa fare.
//
// Non modifica niente: è un controllo, non un deploy. Il deploy resta una
// scelta, perché pubblicare allegramente una versione nuova del backend non è
// una cosa da fare in risposta a un merge.

import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const FUNZIONE = "google-token";
const SORGENTE = `supabase/functions/${FUNZIONE}/index.ts`;

/**
 * Le parti del sorgente che non cambiano il comportamento.
 *
 * Il confronto è sul testo, non sul comportamento: l'API restituisce il
 * sorgente come l'ha impacchettato il runtime, che può differire per i fine
 * riga e per la riga di shebang. Qui si tolgono solo le differenze che
 * non possono cambiare cosa fa la funzione, così un file davvero diverso
 * viene ancora segnalato.
 */
export function normalizza(testo) {
  return testo
    .replace(/\r\n/g, "\n")
    .replace(/^#![^\n]*\n/, "")
    .trimEnd();
}

/**
 * I problemi fra il codice nel repository e quello pubblicato.
 *
 * Vuota quando coincidono: è il caso che il rilascio richiede.
 */
export function confronta({ locale, pubblicato }) {
  if (pubblicato === undefined || pubblicato === null) {
    return [`la funzione ${FUNZIONE} non risulta pubblicata su questo progetto`];
  }
  if (normalizza(locale) !== normalizza(pubblicato)) {
    return [
      `la funzione ${FUNZIONE} pubblicata non è il codice di ${SORGENTE}:`,
      `  nel repository ${normalizza(locale).length} caratteri,`,
      `  su Supabase     ${normalizza(pubblicato).length} caratteri.`,
      "  Se la modifica è voluta, pubblica la funzione; altrimenti qualcuno",
      "  l'ha modificata solo su Supabase e il repository non lo dice.",
    ];
  }
  return [];
}

/** Il token e il progetto, dai nomi che usa la CLI di Supabase. */
function impostazioni() {
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  const ref = process.env.SUPABASE_PROJECT_REF;
  if (!token || !ref)
    return {
      mancanti: [!token && "SUPABASE_ACCESS_TOKEN", !ref && "SUPABASE_PROJECT_REF"].filter(Boolean),
    };
  return { token, ref };
}

/** Il sorgente pubblicato, via API di gestione. */
async function sorgentePubblicato(token, ref) {
  const risposta = await fetch(
    `https://api.supabase.com/v1/projects/${ref}/functions/${FUNZIONE}/body`,
    { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } },
  );
  if (!risposta.ok) {
    throw new Error(`l'API di Supabase ha risposto ${risposta.status} ${risposta.statusText}`);
  }
  const dati = await risposta.json();
  // La risposta è un array di file: quello del punto d'ingresso è l'unico
  // che conta, e arriva con il nome relativo ("google-token/index.ts").
  const file =
    (Array.isArray(dati) ? dati : []).find((f) => f?.name === `${FUNZIONE}/index.ts`) ??
    (Array.isArray(dati) ? dati[0] : undefined);
  if (!file?.content) throw new Error("la risposta non contiene il sorgente della funzione");
  return file.content;
}

// Si esegue solo se il file è il punto d'ingresso, così i test possono
// importare `confronta` senza far partire una richiesta di rete.
// `argv[1]` non c'è quando il modulo viene importato con `node -e`, quindi
// la domanda va posta solo se il percorso c'è.
const ingresso = process.argv[1] ? pathToFileURL(process.argv[1]).href : null;
if (ingresso === import.meta.url) {
  const { token, ref, mancanti } = impostazioni();
  if (mancanti?.length) {
    // Non è un fallimento: è un controllo che in questo ambiente non può
    // girare. Si dice quale serve e si esce senza rompere la build.
    console.log(
      `Edge Function non confrontata: manca ${mancanti.join(" e ")}. ` +
        "Su GitHub Actions il secret si chiama SUPABASE_ACCESS_TOKEN e si imposta in " +
        "Settings > Secrets and variables > Actions; l'ambiente 'prod' non serve, " +
        "perché il confronto non pubblica niente.",
    );
    process.exit(0);
  }

  try {
    const errori = confronta({
      locale: readFileSync(SORGENTE, "utf8"),
      pubblicato: await sorgentePubblicato(token, ref),
    });
    if (errori.length > 0) {
      console.error(errori.map((e) => `ERRORE: ${e}`).join("\n"));
      process.exit(1);
    }
    console.log(`Edge Function ${FUNZIONE}: il codice pubblicato è quello del repository`);
  } catch (causa) {
    // Un controllo che non riesce a girare non deve far fallire la build: si
    // segnala e si lascia decidere a chi guarda. Il fallimento vero, il codice
    // diverso, è già gestito sopra e lì l'uscita è 1.
    console.log(`Edge Function non confrontata: ${causa.message}`);
    process.exit(0);
  }
}
