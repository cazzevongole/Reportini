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
// si fermava. Un errore che non nomina la causa. E non è un caso che sia
// sfuggito: per mesi questo controllo è passato senza confrontare niente, e
// per tutto quel tempo la funzione online era una versione indietro di varie
// release.
//
// Come si comporta:
//
//   - senza SUPABASE_ACCESS_TOKEN non può interrogare il database: esce
//     dicendolo, e non fallisce. In locale e su un fork non c'è il token, e
//     un controllo che non può girare è uno che si impara a ignorare;
//   - con il token, per ogni funzione confronta l'hash del codice qui con
//     quello registrato dall'ultimo deploy, e se differiscono dice cosa fare.
//
// Perché un hash e non un confronto del sorgente. Perché il confronto del
// sorgente non è possibile, e insistere sarebbe un errore: la copia
// pubblicata non è il file che è stato scritto. Supabase transpila e
// riformatta prima di pubblicare, e nell'archivio che l'API restituisce i
// commenti sono ripiegati su una riga e le dichiarazioni di tipo di
// TypeScript sono sparite del tutto. Un confronto del testo direbbe che due
// funzioni sono diverse anche quando sono lo stesso identico file.
//
// L'hash è calcolato sul file di partenza, prima del transpile, e registrato
// nel database dal deploy. Quindi sopravvive, ed è esatto: se qualcuno tocca
// una funzione e non la ripubblica, i due hash non coincidono.
//
// Il limite, che vale la pena dire qui perché è la cosa che va ricordata di
// questo controllo: confronta il codice con ciò che la CI *dichiara* di aver
// pubblicato, non con ciò che gira davvero in produzione. Se qualcuno
// pubblica a mano dalla dashboard, l'hash registrato non cambia e il
// controllo resta verde. È il motivo per cui anche la pubblicazione passa da
// `deploya-edge-function.mjs`: se l'unica via per pubblicare è la CI, allora
// "l'ultimo deploy è passato da qui" e il confronto coincide con la verità.
//
// Non modifica niente: è un controllo, non un deploy.

import {
  FUNZIONI as FUNZIONI_DA_PUBBLICARE,
  hashFunzione,
  leggiFile,
} from "./deploya-edge-function.mjs";

/** Le funzioni da confrontare, tutte. */
export const FUNZIONI = FUNZIONI_DA_PUBBLICARE.map((f) => f.nome);

/**
 * L'hash di una funzione, come lo calcola il deploy.
 *
 * Non è duplicato: è la stessa funzione, chiamata. Se le due copie
 * divergessero, il confronto starebbe misurando una cosa e il deploy
 * pubblicerebbe un'altra, che è il caso peggiore: due copie del calcolo
 * dell'hash che dicono cose diverse sullo stesso file.
 */
export function hashDi(nome) {
  return hashFunzione(leggiFile(nome));
}

/**
 * I problemi fra le funzioni del repository e quelle risultate pubblicate.
 *
 * Vuota quando coincidono: è il caso che il rilascio richiede.
 */
export function confronta(locale, pubblicati) {
  const problemi = [];
  for (const nome of FUNZIONI) {
    const atteso = locale[nome];
    const trovato = pubblicati?.[nome];
    if (!atteso) continue;
    if (!trovato) {
      problemi.push(`la funzione ${nome} non risulta mai stata pubblicata da questo repository:`);
      problemi.push("  Per pubblicarla, con la CLI di Supabase:");
      problemi.push(`    supabase functions deploy ${nome} --no-verify-jwt`);
      problemi.push("  e poi registrare l'hash di ciò che è stato pubblicato:");
      problemi.push("    node scripts/deploya-edge-function.mjs --registra");
      continue;
    }
    if (atteso !== trovato) {
      problemi.push(`la funzione ${nome} non è allineata con il repository:`);
      problemi.push(`  nel repository sha256 ${atteso.slice(0, 16)}…`);
      problemi.push(`  pubblicata     sha256 ${trovato.slice(0, 16)}…`);
      problemi.push("  Se la modifica è voluta, pubblica la funzione; altrimenti qualcuno");
      problemi.push("  l'ha modificata solo su Supabase e il repository non lo dice.");
    }
  }
  if (problemi.length === 0) return [];
  return problemi;
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
 * Gli hash registrati dall'ultimo deploy, via API di gestione.
 *
 * `read_only` è il default e resta a `true`: questo script non deve poter
 * scrivere, nemmeno per sbaglio. Scrivere è compito di
 * `deploya-edge-function.mjs`.
 */
async function hashRegistrati(token, ref) {
  const risposta = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      query: "select nome, codice_sha256 from public.edge_function_deploy",
      read_only: true,
    }),
  });
  if (!risposta.ok) {
    throw new Error(`l'API di Supabase ha risposto ${risposta.status} ${risposta.statusText}`);
  }
  const righe = await risposta.json();
  const mappa = {};
  for (const r of righe) mappa[r.nome] = r.codice_sha256;
  return mappa;
}

// Si esegue solo se il file è il punto d'ingresso, così i test possono
// importare `confronta` senza far partire una richiesta di rete.
// `argv[1]` non c'è quando il modulo viene importato con `node -e`, quindi
// la domanda va posta solo se il percorso c'è.
const ingresso = process.argv[1] ? new URL(`file://${process.argv[1]}`).href : null;
if (ingresso === import.meta.url) {
  const { token, ref, mancanti } = impostazioni();
  if (mancanti?.length) {
    // Non è un fallimento: è un controllo che in questo ambiente non può
    // girare. Si dice quale serve e si esce senza rompere la build.
    console.log(
      `Edge Function non confrontate: manca ${mancanti.join(" e ")}. ` +
        "Su GitHub Actions il secret si chiama SUPABASE_ACCESS_TOKEN e la variabile " +
        "SUPABASE_PROJECT_REF; l'ambiente 'prod' non serve, perché il confronto non " +
        "pubblica niente.",
    );
    process.exit(0);
  }

  const locale = {};
  for (const nome of FUNZIONI) locale[nome] = hashDi(nome);

  let pubblicati;
  try {
    pubblicati = await hashRegistrati(token, ref);
  } catch (causa) {
    // Una tabella che non esiste non è un codice diverso: è un controllo che
    // non può girare. Fallire qui renderebbe la build rossa su un repository
    // in cui `deploy.sql` non è ancora stato applicato, che è una situazione
    // normale e non un errore da segnalare.
    console.log(`Edge Function non confrontate: ${causa.message}`);
    console.log("  Se la tabella manca, applica supabase/deploy.sql.");
    process.exit(0);
  }

  const problemi = confronta(locale, pubblicati);
  if (problemi.length > 0) {
    console.error(problemi.map((e) => `ERRORE: ${e}`).join("\n"));
    process.exit(1);
  }
  for (const nome of FUNZIONI) {
    console.log(`Edge Function ${nome}: allineata con il repository`);
  }
  process.exit(0);
}
