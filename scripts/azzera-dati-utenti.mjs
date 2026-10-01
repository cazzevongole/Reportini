// Azzera i dati di **tutti** gli utenti: bucket incluso.
//
//   node scripts/azzera-dati-utenti.mjs                 elenco, non cancella
//   node scripts/azzera-dati-utenti.mjs --conferma       cancella
//
// Perché esiste. Il modello dati è cambiato (le relazioni sono diventate
// report, gli appuntamenti sono diventati attività) e la migrazione butta via
// attività e report. Chi ha già aperto l'app dopo il cambio ha azzerebbe in
// locale, ma il database nel cloud tornerebbe giù a ogni avvio e rimetterebbe
// in piedi il modello vecchio: è il caso in cui l'utente vedecomparire un
// appuntamento che aveva già perso. Per il beta testing si svuota tutto, e si
// dice che è un'operazione che non si torna indietro.
//
// Il bucket è il posto dove sta il database di ciascuno: svuotare solo il
// locale lascerebbe la copia online, che al prossimo avvio riscenderebbe
// tutta. Per questo la cancellazione parte dal bucket e va all'indietro.
//
// Non richiede le credenziali del frontend: usa la chiave di servizio del
// progetto, che sta nelle variabili d'ambiente della CLI di Supabase. Il
// progetto si legge da supabase/.temp/linked-project.json, quindi lo script
// non ha un ref scritto a mano che possa dimenticare di aggiornare.

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const BUCKET = "reportini";
const LINKED = "supabase/.temp/linked-project.json";
const CONFERMA = "--conferma";

/** Il progetto collegato, o un errore che spiega cosa manca. */
export function progettoCollegato(testo) {
  if (!testo) return null;
  try {
    const { ref } = JSON.parse(testo);
    return typeof ref === "string" && ref.length > 0 ? ref : null;
  } catch {
    return null;
  }
}

/**
 * Le cartelle dentro il bucket sono gli utenti: ogni utente ha la sua, e il
 * primo segmento del percorso è il suo id (è la regola delle RLS in
 * `supabase/setup.sql`).
 */
export function cartelleUtenti(nomi) {
  const uniche = new Set();
  for (const nome of nomi) {
    const primo = String(nome).split("/").filter(Boolean)[0];
    if (primo) uniche.add(primo);
  }
  return [...uniche].sort();
}

/**
 * I file di un utente, dai nomi che il bucket restituisce.
 *
 * Sono due per utente: il database e il file di metadati che dice quando è
 * stato salvato. Vanno via entrambi: lasciare il metadati senza il database
 * farebbe pensare all'app che la copia online sia più recente di quel che è,
 * e al prossimo avvio non riscaricherebbe niente.
 */
export function fileDiUtente(nomi, utente) {
  return nomi.filter((nome) => String(nome).startsWith(`${utente}/`));
}

/** Quanti byte occupa un utente: serve per dire che cosa sta per sparire. */
export function byteDi(oggetti) {
  return oggetti.reduce((totale, o) => totale + ((o?.metadata?.size ?? o?.size ?? 0) || 0), 0);
}

const byteLeggibili = (n) => {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} kB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
};

const ref = progettoCollegato(
  (() => {
    try {
      return readFileSync(LINKED, "utf8");
    } catch {
      return "";
    }
  })(),
);

if (!ref) {
  console.error(
    `Non trovo il progetto collegato in ${LINKED}.\n` +
      "Collegalo con: supabase link --project-ref <ref>",
  );
  process.exit(1);
}

const url = process.env.SUPABASE_URL;
const chiave = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !chiave) {
  console.error(
    "Mancano SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY nell'ambiente.\n" +
      "Si prendono dalla dashboard del progetto (Settings → API) e si esportano\n" +
      "prima di lanciare lo script. Serve la chiave di servizio, non quella anonima:\n" +
      "con quella anonima le RLS lasciano vedere solo i file dell'utente collegato,\n" +
      "e lo script sembrerebbe funzionare avendo cancellato una cartella sola.",
  );
  process.exit(1);
}

const supabase = createClient(url, chiave, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const { data: elenco, error } = await supabase.storage.from(BUCKET).list("", { limit: 1000 });
if (error) {
  console.error(`Non riesco a leggere il bucket "${BUCKET}":`, error.message);
  process.exit(1);
}

const nomi = (elenco ?? []).map((voce) => voce.name);
const utenti = cartelleUtenti(nomi);

console.log(`Progetto:  ${ref}`);
console.log(`Bucket:    ${BUCKET}`);
console.log(`Utenti:    ${utenti.length}`);

if (utenti.length === 0) {
  console.log("\nIl bucket è già vuoto: non c'è niente da azzerare.");
  process.exit(0);
}

// La dimensione per utente serve a far capire che cosa sta per sparire: un
// numero di file senza byte dice poco, e qui si cancella senza tornare indietro.
const dettagli = [];
for (const utente of utenti) {
  const { data: file } = await supabase.storage.from(BUCKET).list(utente, { limit: 1000 });
  const voci = file ?? [];
  dettagli.push({ utente, file: voci.length, byte: byteDi(voci) });
  console.log(
    `  ${utente}  ${voci.length} file  ${byteLeggibili(byteDi(voci))}` +
      voci.map((v) => `\n      ${v.name}`).join(""),
  );
}

const totale = dettagli.reduce((somma, d) => somma + d.byte, 0);
console.log(`\nTotale: ${byteLeggibili(totale)}`);

if (!process.argv.includes(CONFERMA)) {
  console.log(
    `\nNon ho cancellato niente. Per azzerare davvero tutti questi dati,\n` +
      `incluso il database nel bucket, rilancia con:\n\n` +
      `  node scripts/azzera-dati-utenti.mjs ${CONFERMA}\n\n` +
      "L'operazione non si può annullare: chi avrà aperto l'app ricomincerà\n" +
      "dalle aziende.",
  );
  process.exit(0);
}

const { error: erroreCancellazione } = await supabase.storage.from(BUCKET).remove(nomi);
if (erroreCancellazione) {
  console.error("Cancellazione non riuscita:", erroreCancellazione.message);
  process.exit(1);
}

// La verifica non è un vezzo: senza, uno script che dice "fatto" mentre nel
// bucket c'è ancora qualcosa fa perdere il tempo della persona che deve
// rimettere a posto i dati di un utente.
const { data: dopo } = await supabase.storage.from(BUCKET).list("", { limit: 1000 });
const rimasti = cartelleUtenti((dopo ?? []).map((voce) => voce.name));

console.log(
  rimasti.length === 0
    ? `\nDati azzerati per ${utenti.length} utenti, bucket vuoto.`
    : `\nATTENZIONE: restano ${rimasti.length} utenti nel bucket: ${rimasti.join(", ")}`,
);
if (rimasti.length > 0) process.exit(1);
