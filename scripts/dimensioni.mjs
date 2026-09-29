// Misura quanto pesa la web e tiene il conto con un budget.
//
//   node scripts/dimensioni.mjs               report completo e verifica del budget
//   node scripts/dimensioni.mjs --semplice    solo una riga, per la CI
//
// I numeri sono divisi in tre gruppi perché si scaricano in tre momenti
// diversi, e misurarli insieme darebbe un totale che non corrisponde a nessuna
// situazione reale:
//
//   pagina        quello che serve a far comparire l'app
//   installazione le icone, che il browser chiede solo se l'utente installa
//   dopo         il database nel browser e le pagine aperte col caricamento
//                differito, cioè ciò che arriva quando l'utente entra
//
// Il database è un WASM di SQLite da 643 kB: non serve a chi sta ancora sulla
// schermata di accesso, e per questo sta nel gruppo "dopo".
//
// I numeri valgono solo con una build fatta con VITE_SUPABASE_URL e
// VITE_SUPABASE_ANON_KEY valorizzate: senza, esbuild elimina staticamente
// @supabase/supabase-js dal bundle e la misura è falsata di oltre 50 kB.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { brotliCompressSync, gzipSync } from "node:zlib";

/**
 * Tetti, in byte compressi con gzip.
 *
 * Servono a notare una regressione, non a inseguire un record. Quando un
 * aggiornamento di una dipendenza fa salire un numero, si alza qui e si lascia
 * qualche kB di margine sotto: un tetto che si tocca ogni volta che si
 * aggiorna una dipendenza è un tetto che non insegna niente.
 */
export const BUDGET_PAGINA_GZIP = 145 * 1024;
export const BUDGET_INSTALLAZIONE_GZIP = 40 * 1024;
export const BUDGET_DOPO_GZIP = 420 * 1024;

const kB = (byte) => (byte / 1024).toFixed(1).padStart(7);
const somma = (gruppo, chiave) => gruppo.reduce((totale, v) => totale + v[chiave], 0);

/** I numeri di un file: grezzo e compresso, che è come viaggia sul filo. */
export function misura(file) {
  const contenuto = readFileSync(file);
  return {
    grezzo: contenuto.length,
    gzip: gzipSync(contenuto, { level: 9 }).length,
    brotli: brotliCompressSync(contenuto).length,
  };
}

/** Toglie query, frammenti e prefissi di percorso, lasciando il nome in dist. */
function nomeDentro(valore) {
  return valore.replace(/[?#].*$/, "").replace(/^\.?\//, "");
}

/**
 * I file che il browser chiede per far comparire la prima schermata.
 *
 * Si legge `index.html` invece di elencare i nomi a mano: i nomi hanno un hash
 * che cambia a ogni build, e un elenco scritto qui invecchierebbe senza che
 * nessuno se ne accorga. I riferimenti esterni non si contano: non li scarica
 * il nostro pacchetto.
 */
export function riferimentiPagina(html) {
  const trovati = new Set();
  const aggiungi = (valore) => {
    if (!valore || /^(https?:)?\/\//.test(valore)) return;
    const nome = nomeDentro(valore);
    if (nome && nome !== "index.html") trovati.add(nome);
  };
  for (const m of html.matchAll(/<script[^>]+src="([^"]+)"/g)) aggiungi(m[1]);
  for (const m of html.matchAll(/<link[^>]+href="([^"]+)"/g)) aggiungi(m[1]);
  return trovati;
}

/** Le icone dichiarate dal manifest, cioè ciò che serve a installare l'app. */
export function iconeDelManifest(manifest) {
  const icone = new Set();
  let dati;
  try {
    dati = JSON.parse(manifest);
  } catch {
    return icone;
  }
  for (const icona of dati.icons ?? []) {
    if (typeof icona?.src === "string") {
      const nome = nomeDentro(icona.src);
      if (nome) icone.add(nome);
    }
  }
  return icone;
}

/** Elenco dei file di `dist`, divisi nei tre gruppi e con la misura di ciascuno. */
export function analizzaDist(cartella) {
  if (!existsSync(join(cartella, "index.html"))) {
    throw new Error(`Non c'è un index.html in ${cartella}: la build non è stata fatta.`);
  }

  const leggi = (nome) => {
    const p = join(cartella, nome);
    return existsSync(p) ? readFileSync(p, "utf8") : null;
  };
  const html = leggi("index.html");
  const pagina = new Set(riferimentiPagina(html));
  const icone = new Set();
  for (const nome of pagina) {
    if (nome.endsWith(".webmanifest"))
      for (const i of iconeDelManifest(leggi(nome) ?? "")) icone.add(i);
  }

  const voci = [];
  const gira = (dir) => {
    for (const nome of readdirSync(dir)) {
      const p = join(dir, nome);
      if (statSync(p).isDirectory()) gira(p);
      else voci.push(p);
    }
  };
  gira(cartella);

  const gruppo = { pagina: [], installazione: [], dopo: [] };
  for (const percorso of voci) {
    const nome = percorso.slice(cartella.length + 1).replace(/\\/g, "/");
    const voce = { nome, ...misura(percorso) };
    // index.html non è tra i propri riferimenti: va aggiunto a mano.
    if (nome === "index.html" || pagina.has(nome)) gruppo.pagina.push(voce);
    else if (icone.has(nome)) gruppo.installazione.push(voce);
    else gruppo.dopo.push(voce);
  }
  for (const lista of Object.values(gruppo)) lista.sort((a, b) => b.grezzo - a.grezzo);

  return {
    ...gruppo,
    gzipPagina: somma(gruppo.pagina, "gzip"),
    gzipInstallazione: somma(gruppo.installazione, "gzip"),
    gzipDopo: somma(gruppo.dopo, "gzip"),
  };
}

/** I problemi del budget, uno per frase pronta per il log. */
export function verifica(
  analisi,
  budgetPagina = BUDGET_PAGINA_GZIP,
  budgetInstallazione = BUDGET_INSTALLAZIONE_GZIP,
  budgetDopo = BUDGET_DOPO_GZIP,
) {
  const confronta = (nome, attuale, tetto) =>
    attuale > tetto
      ? `${nome}: ${kB(attuale)} kB gzip, oltre il tetto di ${kB(tetto)} kB (${kB(attuale - tetto)} kB da togliere).`
      : null;
  return [
    confronta("Primo caricamento", analisi.gzipPagina, budgetPagina),
    confronta("Icone per l'installazione", analisi.gzipInstallazione, budgetInstallazione),
    confronta("Dopo l'accesso", analisi.gzipDopo, budgetDopo),
  ].filter(Boolean);
}

function tabella(gruppo) {
  for (const v of gruppo) {
    console.log(
      `  ${v.nome.padEnd(38)} ${kB(v.grezzo)} kB  ${kB(v.gzip)} kB gzip  ${kB(v.brotli)} kB brotli`,
    );
  }
  console.log(`  ${"totale".padEnd(38)} ${"".padStart(9)}  ${kB(somma(gruppo, "gzip"))} kB gzip`);
}

const semplice = process.argv.includes("--semplice");
// argv[0] e argv[1] sono l'eseguibile e questo script: il primo argomento
// vero è il primo da argv[2] in poi.
const cartella = process.argv.slice(2).find((a) => !a.startsWith("--")) ?? "dist";

/**
 * La parte qui sotto gira solo quando lo script è lanciato dalla riga di
 * comando. I test importano le funzioni per provarle: senza questo controllo
 * l'import stamperebbe il report e, se il tetto fosse superato, chiamerebbe
 * process.exit(1) facendo fallire la suite per colpa di un numero.
 */
const eseguitoDirettamente =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (eseguitoDirettamente) {
  const analisi = analizzaDist(cartella);
  const problemi = verifica(analisi);

  if (semplice) {
    console.log(
      `Pagina ${kB(analisi.gzipPagina)} kB gzip (tetto ${kB(BUDGET_PAGINA_GZIP)} kB), ` +
        `installazione ${kB(analisi.gzipInstallazione)} kB, dopo l'accesso ${kB(analisi.gzipDopo)} kB.`,
    );
  } else {
    console.log("Primo caricamento (chi apre l'app, anche senza account):");
    tabella(analisi.pagina);
    console.log("\nIcone (solo se l'utente installa l'app):");
    tabella(analisi.installazione);
    console.log("\nDopo l'accesso (database nel browser, sql.js, pagine differite):");
    tabella(analisi.dopo);
    console.log(
      `\nTetti: pagina ${kB(BUDGET_PAGINA_GZIP)} kB, installazione ${kB(BUDGET_INSTALLAZIONE_GZIP)} kB, ` +
        `dopo l'accesso ${kB(BUDGET_DOPO_GZIP)} kB gzip.`,
    );
  }

  if (problemi.length === 0) {
    if (!semplice) console.log("Dimensione entro i tetti.");
  } else {
    for (const p of problemi) console.error(`\n${p}`);
    process.exit(1);
  }
}
