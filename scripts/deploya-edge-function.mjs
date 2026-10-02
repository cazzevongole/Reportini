// =============================================================================
// Reportini · pubblicazione delle Edge Function su Supabase
//
// Cosa fa. Prende `supabase/functions/<nome>/`, lo pubblica sul progetto remoto
// e scrive nel database l'hash del codice che ha appena pubblicato, così che
// `verifica-edge-function.mjs` possa dire se ciò che gira è ciò che sta qui.
//
// Perché l'hash e non un confronto del sorgente. La copia pubblicata non è il
// file che è stato scritto: Supabase lo transpila e lo riformatta prima di
// pubblicarlo, e nell'archivio che dà in restituzione l'API i commenti sono
// ripiegati su una riga e le dichiarazioni di tipo di TypeScript sono sparite
// del tutto. Confronto del testo, quindi, non può funzionare: direbbe che due
// funzioni sono diverse anche quando sono la stessa, e l'unico modo per
// farlo tacere sarebbe non guardare il codice.
//
// L'hash è calcolato sul file di partenza, prima del transpile, quindi
// sopravvive. Se qualcuno tocca una funzione e non la ripubblica, i due hash
// non coincidono e il controllo lo dice.
//
// Perché `verify_jwt` è dichiarato qui e non letto da Supabase. Il default
// della CLI è `true`, e sono entrambe le funzioni pubblicate con
// `--no-verify-jwt`: le chiama `pg_net` dal database, che non ha un JWT da
// mostrare. Un deploy che dimenticasse il parametro le renderebbe irraggiungibili
// con un 401 in cui nessun messaggio nomina la chiave. Sta quindi nella
// tabella qui sotto, dove si vede.
//
// Cosa NON fa. Non tocca i secret della funzione: sono un'altra cosa, vivono
// in `vault` e sull'ambiente delle Edge Functions, e non li si tocca da qui.
// Non è un rollback. Pubblicare non può annullare una pubblicazione: se un
// file dice qualcosa di sbagliato, il guasto è già in produzione.
//
// La pubblicazione, per ora, la fa la CLI e non questo script:
// `POST /functions/deploy` risponde 200 anche quando l'archivio non è quello
// giusto, e la funzione pubblicata così non parte (`503 BOOT_ERROR`). Provato
// su `notifica-richiesta` il 2 ottobre 2026. Quindi questo script registra
// l'hash di ciò che è stato pubblicato, e non pubblica: se lo facesse, la CI
// spegnerebbe le notifiche a ogni push.
//
//   supabase functions deploy <nome> --no-verify-jwt
//   node scripts/deploya-edge-function.mjs --registra
//
//   node scripts/deploya-edge-function.mjs --dry-run    # dice che cosa farebbe
// =============================================================================

import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { spiega } from "./migra-schema.mjs";

/**
 * Le funzioni da pubblicare, e come devono essere pubblicate.
 *
 * `verify_jwt: false` per entrambe, e non è un dettaglio: le chiama il
 * database con `pg_net`, che non ha un token di sessione da presentare. Sono
 * protette dalla chiave nel Vault che il trigger manda nell'intestazione
 * `x-reportini-notifica`, non da un JWT.
 */
export const FUNZIONI = [
  { nome: "google-token", entrypoint: "index.ts", verify_jwt: false },
  { nome: "notifica-richiesta", entrypoint: "index.ts", verify_jwt: false },
];

/**
 * I file di una funzione, come li ha il repository.
 *
 * La cartella è la fonte, non un elenco: una funzione con un file in più
 * (`corpo.ts` accanto a `index.ts`) viene pubblicata per intero senza che
 * nessuno debba ricordarsi di aggiungerlo.
 */
export function leggiFile(nome) {
  const cartella = join("supabase", "functions", nome);
  const file = [];
  for (const voce of readdirSync(cartella).sort()) {
    if (!voce.endsWith(".ts")) continue;
    file.push({ percorso: voce, contenuto: readFileSync(join(cartella, voce)) });
  }
  return file;
}

/**
 * L'hash di una funzione, calcolato sui file che la compongono.
 *
 * Il nome del file entra nell'hash oltre al suo contenuto, e serve a una
 * cosa precisa: che spostare un file o cambiarne il nome cambi l'hash anche
 * se il contenuto è identico. Altrimenti `corpo.ts` potrebbe diventare
 * ` Corpo.ts` — o essere scambiato con un file gemello — senza che l'hash se
 * ne accorgesse, e la funzione pubblicata continuerebbe a sembrare allineata
 * mentre gira con il file sbagliato.
 *
 * I fine riga non contano: su Windows il file del repository è CRLF e su
 * Linux LF, e senza questa normalizzazione ogni sviluppatore su Windows
 * produrrebbe un hash diverso per lo stesso codice.
 */
export function hashFunzione(file) {
  const h = createHash("sha256");
  for (const f of [...file].sort((a, b) => (a.percorso < b.percorso ? -1 : 1))) {
    h.update(f.percorso);
    h.update("\0");
    h.update(f.contenuto.toString("utf8").replace(/\r\n/g, "\n"));
    h.update("\0");
  }
  return h.digest("hex");
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
 * L'hash attualmente registrato nel database per ogni funzione.
 *
 * Va letto dal database e non dai secret delle funzioni: l'API che elenca i
 * secret restituisce il loro *digest*, non il valore, quindi un hash messo
 * lì non si può rileggere e il confronto non avrebbe niente da confrontare.
 */
export async function hashPubblicati(token, ref) {
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
    const corpo = await risposta.text().catch(() => "");
    throw new Error(
      `l'API di Supabase ha risposto ${risposta.status} ${risposta.statusText}` +
        (corpo ? `: ${corpo.slice(0, 300)}` : ""),
    );
  }
  const righe = await risposta.json();
  const mappa = {};
  for (const r of righe) mappa[r.nome] = r.codice_sha256;
  return mappa;
}

/** Registra l'hash di ciò che è stato pubblicato. */
export async function registraHash(token, ref, nome, hash) {
  const risposta = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      query:
        "insert into public.edge_function_deploy (nome, codice_sha256) values " +
        `('${nome}', '${hash}') on conflict (nome) do update ` +
        "set codice_sha256 = excluded.codice_sha256, pubblicato_il = now()",
      read_only: false,
    }),
  });
  if (!risposta.ok) {
    const corpo = await risposta.text().catch(() => "");
    throw new Error(
      `l'hash di ${nome} non è stato registrato: ${risposta.status} ${risposta.statusText}` +
        (corpo ? `: ${corpo.slice(0, 300)}` : ""),
    );
  }
  return await risposta.json();
}

/**
 * Pubblica una funzione.
 *
 * NON È IN USO, e non deve esserlo finché non c'è un modo di produrre l'eszip
 * che accetta il runtime. Resta qui perché il tentativo merita la documentazione
 * più che la rimozione: è la strada che sembrava giusta e che non lo era.
 *
 * I due modi provati, e perché nessuno dei due serve:
 *
 *   - `POST /functions/deploy` con multipart: risponde 201 e **crea** una
 *     funzione nuova con slug UUID, senza toccare quella esistente. Prove:
 *     sono nate due funzioni spurie, poi cancellate.
 *   - `PATCH /functions/<nome>` con `application/vnd.denoland.eszip`:
 *     aggiorna davvero la funzione esistente, ma un eszip costruito a mano
 *     non si avvia (`503 BOOT_ERROR`) perché non contiene i pezzi che il
 *     runtime usa all'avvio.
 *
 * Il corpo è multipart con un campo `file` per ogni sorgente e un `metadata`
 * JSON che dice il punto d'ingresso e se va verificato il JWT.
 */
export async function pubblica(token, ref, { nome, entrypoint, verify_jwt }, file) {
  const form = new FormData();
  for (const f of file) {
    form.append(
      "file",
      new Blob([f.contenuto], { type: "application/typescript" }),
      `${nome}/${f.percorso}`,
    );
  }
  form.append(
    "metadata",
    new Blob([JSON.stringify({ entrypoint_path: entrypoint, verify_jwt })], {
      type: "application/json",
    }),
  );
  const risposta = await fetch(`https://api.supabase.com/v1/projects/${ref}/functions/deploy`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  if (!risposta.ok) {
    const corpo = await risposta.text().catch(() => "");
    throw new Error(
      `la pubblicazione di ${nome} è fallita: ${risposta.status} ${risposta.statusText}` +
        (corpo ? `: ${corpo.slice(0, 400)}` : ""),
    );
  }
  return await risposta.json().catch(() => ({}));
}

// Si esegue solo se il file è il punto d'ingresso, così i test possono
// importare le funzioni senza che parta una richiesta di rete.
const ingresso = process.argv[1] ? pathToFileURL(process.argv[1]).href : null;
if (ingresso === import.meta.url) {
  const asciutto = process.argv.includes("--dry-run");
  const registra = process.argv.includes("--registra");

  // L'hash si calcola sempre: è la parte che non scrive niente, e su una pull
  // request è l'unica che può girare senza permessi.
  const calcolati = FUNZIONI.map((f) => {
    const file = leggiFile(f.nome);
    return { ...f, file, hash: hashFunzione(file) };
  });

  if (asciutto) {
    console.log("Hash del codice (--dry-run):");
    for (const f of calcolati) {
      console.log(
        `  ${f.nome} (${f.file.length} file, verify_jwt=${f.verify_jwt}) sha256 ${f.hash.slice(0, 12)}…`,
      );
    }
    process.exit(0);
  }

  const { token, ref, mancanti } = impostazioni();
  if (mancanti.length > 0) {
    console.log(
      `Hash non registrati: manca ${mancanti.join(" e ")}. Su GitHub Actions ` +
        "il secret è SUPABASE_ACCESS_TOKEN e la variabile è SUPABASE_PROJECT_REF.",
    );
    process.exit(0);
  }

  if (!registra) {
    // Senza `--registra` non si fa niente, e si dice perché: la pubblicazione
    // la fa la CLI. Registrarlo comunque, senza aver pubblicato niente,
    // scriverebbe un hash che non descrive il codice online e il confronto
    // direbbe che è tutto allineato.
    console.log(
      "Nessuna modifica eseguita. Per registrare l'hash di una funzione già " +
        "pubblicata con la CLI:\n" +
        "  supabase functions deploy <nome> --no-verify-jwt\n" +
        "  node scripts/deploya-edge-function.mjs --registra",
    );
    process.exit(0);
  }

  // Si registra solo ciò che risulta diverso: riscrivere un hash identico non
  // cambia niente e tocca la tabella senza motivo.
  let noti = {};
  try {
    noti = await hashPubblicati(token, ref);
  } catch (causa) {
    // La tabella può non esistere ancora, se `deploy.sql` non è stato
    // applicato. Non è un errore che ferma tutto: si registra lo stesso, e la
    // prima registrazione è quella che rende la tabella utilizzabile.
    console.log(`  (non riesco a leggere gli hash già registrati: ${spiega(causa)})`);
  }

  let fallite = 0;
  for (const f of calcolati) {
    if (noti[f.nome] === f.hash) {
      console.log(`  già registrato  ${f.nome} (sha256 ${f.hash.slice(0, 12)}…)`);
      continue;
    }
    try {
      await registraHash(token, ref, f.nome, f.hash);
      console.log(`  registrato     ${f.nome} (sha256 ${f.hash.slice(0, 12)}…)`);
    } catch (causa) {
      fallite++;
      console.error(`  FALLITO  ${f.nome}: ${spiega(causa)}`);
    }
  }

  if (fallite > 0) {
    console.error(`Edge Function: ${fallite} hash non registrati.`);
    process.exit(1);
  }
  process.exit(0);
}
