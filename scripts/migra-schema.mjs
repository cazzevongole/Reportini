// =============================================================================
// Reportini · applicazione dello schema su Supabase
//
// Cosa fa. Esegue i file `supabase/*.sql` sul progetto remoto, nell'ordine in
// cui possono dipendere l'uno dall'altro, così che modificare una tabella non
// richieda di aprire la console SQL e incollare del testo a mano.
//
// Perché una riga dedicata e non `supabase db push`. Lo schema di Reportini
// è in tre file che si possono rieseguire — `if not exists`, `create or
// replace` — e non in una cartella di migrazioni numerate: ogni file
// descrive lo stato finale, non un passo. Rieseguirli è innocuo, ed è
// proprio questa proprietà che permette a questo script di non tenere
// nessun registro di cosa è già stato applicato: il database stesso è lo
// stato, e il file dice come arrivarci da qualunque punto di partenza.
//
// I segreti NON passano di qui, e non per scelta ma per struttura. Le righe
// che creano i segreti nel Vault sono dentro commenti, e `problemiNelSql`
// fallisce se qualcuno le decomenta: applicare una chiave dalla CI
// significherebbe metterla in un secret di GitHub, che è esattamente il
// posto da cui il progetto ha deciso di tenerla fuori. I due segreti del
// Vault si creano una volta sola, a mano, e da quel momento questo script non
// li tocca più.
//
// Non è un rollback. Applicare lo schema non può annullare un deploy: se un
// file dice qualcosa di sbagliato, il danno è già nel database. Per questo i
// file sono scritti per essere innocui da rieseguire, e non per essere
// annullabili: nessuno dei tre contiene un `drop table`.
// =============================================================================

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const QUI = dirname(fileURLToPath(import.meta.url));
const RADICE = join(QUI, "..");

/**
 * L'ordine non è alfabetico, è quello delle dipendenze.
 *
 * `setup.sql` crea il bucket e le RLS, e non dipende da niente.
 * `richieste.sql` crea le tabelle su cui poggia il trigger.
 * `notifica-richieste.sql` mette il trigger su `public.richieste`, quindi
 * viene per ultimo: applicarlo prima troverebbe una tabella che potrebbe
 * non esserci e fallirebbe per un motivo che non c'entra.
 */
export const FILE_SCHEMA = ["setup.sql", "richieste.sql", "notifica-richieste.sql"];

/**
 * Una riga che SCRIVE un segreto, per intero o in parte.
 *
 * Il controllo serve perché `vault.create_secret` con lo stesso nome
 * *sostituisce* il valore: un segreto eseguito per errore dalla CI
 * sovrascriverebbe la chiave vera con una stringa vuota, e il sintomo
 * sarebbe un `401` su ogni richiesta, senza che nessuno abbia toccato
 * niente. È il guasto che `notifica_richieste.sql` descrive a lungo prima
 * di arrivarci, e questa è la rete che lo intercetta.
 *
 * Si blocca solo ciò che scrive. **Leggere** il Vault non è un pericolo e
 * anzi è necessario: il trigger ne ha bisogno per funzionare, perché la
 * chiave sta in un posto solo e la funzione non ne ha una copia. Bloccare
 * anche la lettura romperebbe le notifiche, e per un guasto che la lettura
 * non può causare.
 */
export function segretiNelSql(sql) {
  const trovati = [];
  // Le righe commentate sono tollerate: è il modo in cui i due file
  // documentano i segreti da mettere a mano.
  const righe = sql.split("\n");
  righe.forEach((riga, indice) => {
    const attiva = !/^\s*--/.test(riga);
    // I tre modi in cui Postgres scrive in un Vault: la funzione
    // `create_secret`, un `insert` diretto nella tabella delle righe
    // decifrate, e la cifratura pgsodium. Coprono i tre, perché ognuno
    // finisce nella stessa tabella e `insert into` è già una scrittura.
    const scrive =
      /vault\.create_secret|create\s+secret|insert\s+into\s+vault\.|pgsodium\.crypto_secretbox|pgcrypto\.encrypt/i.test(
        riga,
      );
    if (attiva && scrive) trovati.push({ riga: indice + 1, testo: riga.trim() });
  });
  return trovati;
}

/**
 * Una riga che scrive nella tabella che decide chi è sviluppatore.
 *
 * Questa è la guardia più importante di tutte, e non riguarda i segreti.
 * `public.sviluppatori` è la lista di chi può leggere le richieste di tutti
 * gli utenti: è scritta a mano, è una riga sola, ed è l'unica cosa che
 * separa lo sviluppatore da un utente normale. Se questa riga la esegue una
 * macchina che gira su ogni merge, allora chi apre una pull request decide
 * chi legge i dati degli altri — e la decisione passa inosservata, perché
 * un merge è un merge.
 *
 * Per questo la riga resta dentro un commento, anche se è innocua:
 * applicare uno schema non deve poter promuovere nessuno a sviluppatore.
 */
export function promozioniNelSql(sql) {
  const trovate = [];
  sql.split("\n").forEach((riga, indice) => {
    const attiva = !/^\s*--/.test(riga);
    const scrive = /\b(insert\s+into|update|delete\s+from)\b[^;]*\bsviluppatori\b/i.test(riga);
    if (attiva && scrive) trovate.push({ riga: indice + 1, testo: riga.trim() });
  });
  return trovate;
}

/**
 * Il motivo per cui il file non può essere applicato così com'è.
 *
 * `null` significa che va bene. La forma è un array di frasi, perché i
 * controlli possono fallire insieme e dirlo in un colpo solo vale più che
 * fare l'utente girare due volte.
 */
export function problemiNelSql(nome, sql) {
  const problemi = [];
  const segreti = segretiNelSql(sql);
  if (segreti.length > 0) {
    problemi.push(
      `${nome}: ${segreti.length} riga/e che creano un segreto non sono commentate. ` +
        "I segreti non si applicano dalla CI: togli i '--' e applicali a mano nel Vault.",
    );
  }
  const promozioni = promozioniNelSql(sql);
  if (promozioni.length > 0) {
    problemi.push(
      `${nome}: ${promozioni.length} riga/e scrivono nella tabella degli sviluppatori. ` +
        "Chi è sviluppatore si scrive a mano, non dalla CI: lascia la riga fra i commenti.",
    );
  }
  // Un segnaposto non sostituito è il modo più economico di mandare una
  // richiesta all'indirizzo sbagliato: l'API risponde e il trigger resta
  // attaccato a niente.
  const segnaposto = sql.match(/^[^-\n]*\{\{[A-Z_]+\}\}/m);
  if (segnaposto) {
    problemi.push(
      `${nome}: c'è un segnaposto {{…}} in una riga attiva. Sostituiscilo, o metti la riga fra i commenti.`,
    );
  }
  return problemi;
}

/** I file da applicare, con il loro contenuto. */
export function leggiSchema() {
  return FILE_SCHEMA.map((nome) => ({
    nome,
    sql: readFileSync(join(RADICE, "supabase", nome), "utf8"),
  }));
}

/** Il token e il progetto, dagli stessi nomi che usa la CLI di Supabase. */
export function impostazioni() {
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  const ref = process.env.SUPABASE_PROJECT_REF;
  return {
    token,
    ref,
    mancanti: [!token && "SUPABASE_ACCESS_TOKEN", !ref && "SUPABASE_PROJECT_REF"].filter(Boolean),
  };
}

/**
 * Applica lo SQL a un progetto, via l'API di gestione.
 *
 * `read_only` è il default per un motivo: sbagliare non deve poter scrivere.
 * Per applicare va detto `read_only: false`, e senza l'ambiente giusto
 * Supabase risponde 403 — che è la risposta giusta, non un errore da
 * nascondere.
 */
export async function applica(token, ref, sql, { readOnly = true } = {}) {
  const risposta = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ query: sql, read_only: readOnly }),
  });
  if (!risposta.ok) {
    const corpo = await risposta.text().catch(() => "");
    throw new Error(
      `l'API di Supabase ha risposto ${risposta.status} ${risposta.statusText}` +
        (corpo ? `: ${corpo.slice(0, 400)}` : ""),
    );
  }
  return await risposta.json();
}

/** Un errore di Supabase spiegato, perché i codici da soli non dicono niente. */
export function spiega(causa) {
  const testo = causa instanceof Error ? causa.message : String(causa);
  if (/401/.test(testo)) {
    return (
      "il token non è stato accettato. SUPABASE_ACCESS_TOKEN è scaduto, o è un token " +
      "di un altro account. Su supabase.com/account/tokens se ne fa uno nuovo."
    );
  }
  if (/403/.test(testo)) {
    return (
      "il token può leggere ma non scrivere il database. Serve un token con lo " +
      "scope database:write — quello di sola lettura va bene per " +
      "verifica-edge-function.mjs, che non modifica niente."
    );
  }
  if (/429/.test(testo)) {
    return "troppe richieste all'API di Supabase. Riprova fra qualche minuto.";
  }
  if (/already exists|duplicate key/.test(testo)) {
    return (
      "il database ha già quell'oggetto. I file sono scritti per essere innocui da " +
      "rieseguire: se questo errore compare, è un `create` senza `if not exists` " +
      "o senza `or replace`."
    );
  }
  return testo;
}

// Si esegue solo se il file è il punto d'ingresso, così i test possono
// importare le funzioni senza che parta una richiesta di rete.
const ingresso = process.argv[1] ? new URL(`file://${process.argv[1]}`).href : null;
if (ingresso === import.meta.url) {
  const asciutto = process.argv.includes("--dry-run");
  const soloVerifica = process.argv.includes("--check");

  const file = leggiSchema();

  // I controlli sul testo girano SEMPRE, anche in `--check` e anche senza
  // token: sono la parte che può essere fatta su una pull request, dove
  // nessuno deve poter scrivere sul database.
  const problemi = file.flatMap((f) => problemiNelSql(f.nome, f.sql));
  if (problemi.length > 0) {
    for (const problema of problemi) console.error(`  ${problema}`);
    process.exit(1);
  }
  console.log(`Schema: ${file.length} file, nessun segreto e nessun segnaposto attivo.`);

  if (soloVerifica) {
    console.log("Controllo finito: nessuna modifica eseguita (--check).");
    process.exit(0);
  }

  const { token, ref, mancanti } = impostazioni();
  if (mancanti.length > 0) {
    console.log(
      `Schema non applicato: manca ${mancanti.join(" e ")}. Su GitHub Actions il ` +
        "secret è SUPABASE_ACCESS_TOKEN e la variabile è SUPABASE_PROJECT_REF, " +
        "entrambe nell'ambiente 'prod'.",
    );
    process.exit(0);
  }

  if (asciutto) {
    console.log("Would apply (--dry-run):");
    for (const f of file) console.log(`  supabase/${f.nome} (${f.sql.length} caratteri)`);
    process.exit(0);
  }

  let fallite = 0;
  for (const f of file) {
    try {
      await applica(token, ref, f.sql, { readOnly: false });
      console.log(`  applicato  supabase/${f.nome}`);
    } catch (causa) {
      fallite += 1;
      // Si va avanti anche dopo un errore: `notifica-richieste.sql` crea un
      // trigger su `public.richieste`, e se le tabelle non ci sono ancora
      // fallirebbe per un motivo che il file dopo risolverebbe. Fermarsi al
      // primo errore lascerebbe lo schema a metà, che è lo stato peggiore.
      console.error(`  FALLITO    supabase/${f.nome}: ${spiega(causa)}`);
    }
  }
  if (fallite > 0) {
    console.error(
      `\n${fallite} file non applicati. Lo schema è a metà: controlla il messaggio ` +
        "sopra prima di riprovare, perché rieseguire applica di nuovo anche " +
        "quelli che sono andati bene.",
    );
    process.exit(1);
  }
  console.log("Schema applicato.");
}
