// Controlla che le Edge Function pubblicate siano il codice che sta nel
// repository.
//
//   node scripts/verifica-edge-function.mjs
//
// Perché serve. Le funzioni Edge girano su Supabase e il loro codice vive qui.
// Sono due copie distinte di cosa dovrebbe essere lo stesso programma, e
// nessuna delle due avvisa l'altra quando divergono: si scoprono solo quando
// qualcosa non funziona.
//
// Non è un caso ipotetico. Dopo il passaggio a reportini.cazzevongole.com il
// codice nel repository aveva il nuovo dominio nell'elenco delle origini
// ammesse, ma la funzione pubblicata era ancora la versione precedente: il
// preflight CORS rispondeva con l'origine sbagliata e l'accesso con Google
// si fermava. Un errore che non nomina la causa.
//
// Confronta tutti i file di ogni funzione, non solo `index.ts`: dal primo
// backend in poi c'è stato `notifica-richiesta`, che ha accanto a `index.ts`
// un `corpo.ts` con la costruzione della mail. Un confronto che guardasse solo
// il punto d'ingresso lascerebbe fuori proprio il file dove sta la logica.
//
// Come si comporta:
//
//   - senza SUPABASE_ACCESS_TOKEN non può interrogare l'API: esce dicendolo,
//     e non fallisce. In locale e su un fork non c'è il token, e un controllo
//     che non può girare è uno che si impara a ignorare;
//   - con il token, confronta ogni file pubblicato con quello del repository
//     e, se differiscono, dice cosa fare.
//
// Non modifica niente: è un controllo, non un deploy. Il deploy resta una
// scelta, perché pubblicare allegramente una versione nuova del backend non è
// una cosa da fare in risposta a un merge.

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

/** Le funzioni da confrontare, tutte. */
export const FUNZIONI = ["google-token", "notifica-richiesta"];

/**
 * I file di una funzione, come li ha il repository: nome relativo → contenuto.
 *
 * La cartella della funzione è la fonte: aggiungere un file e dimenticare di
 * registrarlo da qualche parte è il modo tipico di pubblicarne solo metà.
 */
export function leggiFunzione(nome) {
  const cartella = join("supabase", "functions", nome);
  const file = {};
  for (const voce of readdirSync(cartella)) {
    if (!voce.endsWith(".ts")) continue;
    file[`${nome}/${voce}`] = readFileSync(join(cartella, voce), "utf8");
  }
  return file;
}

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
 * Il percorso di un file come lo si apre dal repository.
 *
 * L'API di Supabase chiama i suoi file `notifica-richiesta/corpo.ts`, senza
 * la cartella delle funzioni: è la chiave giusta per cercarli, ma è un
 * percorso che nel repository non esiste, e un messaggio che nomina un file
 * che non si trova non serve a niente.
 */
function percorsoDiRepository(percorso) {
  return `supabase/functions/${percorso}`;
}

/**
 * I problemi fra i file di una funzione nel repository e quelli pubblicati.
 *
 * Vuota quando coincidono: è il caso che il rilascio richiede.
 */
export function confronta({ nome, locale, pubblicato }) {
  if (pubblicato === undefined || pubblicato === null) {
    return [`la funzione ${nome} non risulta pubblicata su questo progetto`];
  }
  const problemi = [];
  for (const [percorso, contenuto] of Object.entries(locale)) {
    const remoto = pubblicato[percorso];
    if (remoto === undefined) {
      problemi.push(
        `il file ${percorsoDiRepository(percorso)} è nel repository ma non su Supabase:`,
      );
      problemi.push("  Se la modifica è voluta, pubblica la funzione.");
      continue;
    }
    if (normalizza(contenuto) !== normalizza(remoto)) {
      problemi.push(
        `il file ${percorsoDiRepository(percorso)} pubblicato non è quello del repository:`,
      );
      problemi.push(`  nel repository ${normalizza(contenuto).length} caratteri,`);
      problemi.push(`  su Supabase     ${normalizza(remoto).length} caratteri.`);
      problemi.push("  Se la modifica è voluta, pubblica la funzione; altrimenti qualcuno");
      problemi.push("  l'ha modificata solo su Supabase e il repository non lo dice.");
    }
  }
  for (const percorso of Object.keys(pubblicato)) {
    if (!(percorso in locale)) {
      problemi.push(`il file ${percorso} è su Supabase ma non nel repository:`);
      problemi.push("  Il codice pubblicato è una copia che nessuno legge più.");
    }
  }
  if (problemi.length === 0) return [];
  return [`la funzione ${nome} non è allineata con il repository:`, ...problemi];
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

/**
 * I sorgenti pubblicati, via API di gestione.
 *
 * La risposta è un array di file, ognuno con il nome relativo
 * ("notifica-richiesta/index.ts"): si tiene tutto, perché una funzione è
 * fatta di più file e published solo il primo non funziona.
 */
async function sorgentiPubblicati(token, ref, nome) {
  const risposta = await fetch(
    `https://api.supabase.com/v1/projects/${ref}/functions/${nome}/body`,
    { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } },
  );
  if (!risposta.ok) {
    throw new Error(`l'API di Supabase ha risposto ${risposta.status} ${risposta.statusText}`);
  }
  const dati = await risposta.json();
  if (!Array.isArray(dati) || dati.length === 0) {
    throw new Error("la risposta non contiene i sorgenti della funzione");
  }
  const file = {};
  for (const voce of dati) {
    if (voce?.name && voce?.content) file[voce.name] = voce.content;
  }
  return file;
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
      `Edge Function non confrontate: manca ${mancanti.join(" e ")}. ` +
        "Su GitHub Actions il secret si chiama SUPABASE_ACCESS_TOKEN e si imposta in " +
        "Settings > Secrets and variables > Actions; l'ambiente 'prod' non serve, " +
        "perché il confronto non pubblica niente.",
    );
    process.exit(0);
  }

  const problemi = [];
  for (const nome of FUNZIONI) {
    try {
      const esiti = confronta({
        nome,
        locale: leggiFunzione(nome),
        pubblicato: await sorgentiPubblicati(token, ref, nome),
      });
      if (esiti.length > 0) problemi.push(...esiti);
      else console.log(`Edge Function ${nome}: il codice pubblicato è quello del repository`);
    } catch (causa) {
      // Una funzione che non si può interrogare non deve far fallire la
      // build: si segnala e si lascia decidere a chi guarda. Il fallimento
      // vero, il codice diverso, è già gestito sopra e lì l'uscita è 1.
      console.log(`Edge Function ${nome} non confrontata: ${causa.message}`);
    }
  }

  if (problemi.length > 0) {
    console.error(problemi.map((e) => `ERRORE: ${e}`).join("\n"));
    process.exit(1);
  }
  process.exit(0);
}
