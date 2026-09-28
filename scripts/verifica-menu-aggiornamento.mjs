// Verifica che i menù dell'aggiornamento automatico promettano file che
// esistono davvero.
//
//   node scripts/verifica-menu-aggiornamento.mjs dist
//
// electron-updater non scarica un pacchetto: legge `latest*.yml`, ci trova il
// nome di un file e lo va a prendere nella release. Se quel nome non coincide
// con nessun allegato, la richiesta finisce in un 404 e l'app installata resta
// sulla versione vecchia — senza alcun errore, senza avviso, per sempre.
//
// È successo su Windows: il yml prometteva "Reportini-Setup-0.1.24.exe" e
// l'allegato si chiamava "Reportini.Setup.0.1.24.exe". Su mac e Linux i nomi
// tornavano, quindi la verifica passava e il difetto restava nascosto.
//
// Per questo il controllo è qui e non dentro il workflow: è codice che si può
// provare, e un test che lo prova vale più di un `if` in un file di Actions
// dove nessuno lo eseguirebbe a mano.

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export const MENU = ["latest.yml", "latest-mac.yml", "latest-linux.yml"];

/**
 * I nomi che un menù promette.
 *
 * Bastano `url` e `path`: sono i due modi in cui electron-updater chiama
 * l'allegato, e compaiono entrambi nei yml che genera electron-builder. Non si
 * usa un parser YAML: aggiungerebbe una dipendenza per quattro righe, e qui
 * basta riconoscere le chiavi all'inizio della riga.
 */
export function nomiPromessi(yaml) {
  const nomi = [];
  for (const riga of yaml.split("\n")) {
    const trovato = /^\s*(?:url|path):\s*(\S+)\s*$/.exec(riga);
    if (trovato) nomi.push(trovato[1]);
  }
  return nomi;
}

/**
 * I problemi di una cartella di pacchetti, uno per frase pronta per il log.
 *
 * Vuota quando tutto torna: è questo il caso che il rilascio richiede.
 */
export function problemiIn(cartella) {
  const problemi = [];

  for (const menu of MENU) {
    const percorso = resolve(cartella, menu);
    if (!existsSync(percorso)) {
      problemi.push(`${menu} non c'è: l'aggiornamento automatico non funzionerebbe`);
      continue;
    }
    for (const nome of nomiPromessi(readFileSync(percorso, "utf8"))) {
      if (!existsSync(resolve(cartella, nome))) {
        problemi.push(`${menu} promuove ${nome}, che non è fra i file pubblicati`);
      }
    }
  }

  return problemi;
}

function main() {
  const cartella = resolve(process.argv[2] ?? "dist");
  const problemi = problemiIn(cartella);

  if (problemi.length > 0) {
    for (const problema of problemi) console.error(`::error::${problema}`);
    console.error("Un aggiornamento che non si può scaricare non si pubblica.");
    process.exit(1);
  }
  console.log(`i menù di aggiornamento promettono solo file pubblicati (${cartella})`);
}

// Da un test si importa il modulo e `main` non deve fare niente: si vede da
// questo nome di file, che è l'unico modo di chiamare lo script.
if (process.argv[1]?.endsWith("verifica-menu-aggiornamento.mjs")) main();
