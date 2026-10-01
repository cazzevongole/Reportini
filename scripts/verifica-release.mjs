// Verifica che la release appena pubblicata sia davvero pubblicabile.
//
//   node scripts/verifica-release.mjs <tag> [cartella]
//
// Il job `pubblica` finisce e il workflow va verde: ma "verde" vuol dire
// solo che i comandi sono usciti con codice 0. Un allegato che non è salito,
// una release lasciata come bozza, un titolo che un'altra esecuzione ha
// cambiato: sono tutti casi in cui `gh` esce con successo e il risultato è
// una release che l'utente non può scaricare.
//
// Il caso più insidioso è la bozza. Una release in bozza esiste ma non è
// visibile: `gh release view` la trova, `gh release upload` funziona, e
// `--latest` non la pubblica — quel flag serve solo per una release già
// pubblica, e su una bozza non fa niente. Il risultato è un tag su GitHub e
// nessuna release: l'aggiornamento automatico non parte e non c'è nessun
// errore da nessuna parte.
//
// Un secondo caso, meno raro di quanto sembri: `gh release upload` continua
// anche quando un file fallisce, quindi un allegato rifiutato non ferma il
// comando e non cambia il codice di uscita. Il file manca e il rilascio
// passa.
//
// Qui si rilegge la release **da GitHub**, non la cartella locale: la
// cartella è ciò che si voleva pubblicare, la release è ciò che c'è. Se
// differiscono, è la seconda che conta.
//
// Come `verifica-menu-aggiornamento.mjs`, le funzioni sono pure e provabili e
// il guscio è sottile: qui si chiama GitHub, che un test non può fare, quindi
// `leggi` è il punto in cui il test passa la propria risposta.

import { execFileSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { MENU } from "./verifica-menu-aggiornamento.mjs";

/**
 * I pacchetti che una release deve avere, per estensione.
 *
 * Sono gli stessi tre che il workflow controlla prima di pubblicare: senza
 * uno dei tre l'app non è installabile su quella piattaforma, e la release
 * sembra comunque pubblicata.
 */
export const PACCHETTI = [
  { estensione: ".dmg", sistema: "mac" },
  { estensione: ".exe", sistema: "Windows" },
  { estensione: ".AppImage", sistema: "Linux" },
];

/**
 * I problemi di una release pubblicata, uno per frase pronta per il log.
 *
 * `release` è l'oggetto JSON di `gh release view --json`, `attesi` la lista
 * dei nomi che ci si aspettava di allegare. Vuota quando tutto torna.
 */
export function problemiInRelease(release, attesi = []) {
  const problemi = [];
  const allegati = (release.assets ?? []).map((a) => a.name);

  // Una bozza non è una release: esiste, si vede solo da GitHub in
  // autenticato, e l'utente che cerca l'aggiornamento non la trova.
  if (release.isDraft) {
    problemi.push("la release è ancora una bozza: nessuno la vede e l'aggiornamento non parte");
  }

  // Una prerelease è un'altra promessa rotta: electron-updater la considera,
  // ma non è quello che l'utente si aspetta di scaricare.
  if (release.isPrerelease) {
    problemi.push("la release è una prerelease: non viene proposta come aggiornamento");
  }

  // Il titolo è l'unica cosa che si legge prima di scaricare, ed è quello
  // che il rilascio precedente ha dovuto correggere a mano.
  const titoloAtteso = `Reportini ${release.tagName}`;
  if (release.name !== titoloAtteso) {
    problemi.push(`il titolo è "${release.name}" e doveva essere "${titoloAtteso}"`);
  }

  // Ogni pacchetto, per estensione: il nome cambia a ogni versione.
  for (const { estensione, sistema } of PACCHETTI) {
    if (!allegati.some((nome) => nome.endsWith(estensione))) {
      problemi.push(`manca il pacchetto ${sistema} (${estensione})`);
    }
  }

  // I menù dell'aggiornamento: senza questi l'app installata resta ferma, ed
  // è il guasto di cui non si accorge nessuno.
  for (const menu of MENU) {
    if (!allegati.includes(menu)) {
      problemi.push(`manca ${menu}: l'aggiornamento automatico non funzionerebbe`);
    }
  }

  // Ogni file che si aveva in mano e che sulla release non c'è: l'upload può
  // averlo rifiutato senza fermarsi.
  for (const nome of attesi) {
    if (!allegati.includes(nome)) {
      problemi.push(`${nome} era fra i pacchetti ma non è allegato alla release`);
    }
  }

  return problemi;
}

/** I nomi dei file in una cartella, senza le directory. */
export function nomiIn(cartella) {
  try {
    return readdirSync(cartella).filter((nome) => statSync(resolve(cartella, nome)).isFile());
  } catch {
    return [];
  }
}

/**
 * Il guscio: legge la release, giudica, scrive.
 *
 * `leggi` riceve il tag e restituisce la release: di solito è `gh`. È un
 * parametro perché il test non può chiamare GitHub e un `gh` finto sul PATH
 * non è una prova — su Windows un `.cmd` senza shell non viene eseguito, e il
 * finto non verrebbe mai chiamato, quindi il test passerebbe senza provare
 * niente. Qui il test passa la risposta e prova davvero il giudizio e
 * l'uscita.
 *
 * Restituisce il codice di uscita invece di chiamare `process.exit`: è lui
 * che il workflow guarda, e restituirlo lo rende provabile.
 */
export function verifica(tag, cartella, leggi, scrive = console) {
  let release;
  try {
    release = leggi(tag);
  } catch {
    scrive.error(`::error::La release ${tag} non si può leggere da GitHub`);
    return 1;
  }

  const problemi = problemiInRelease(release, nomiIn(cartella));

  if (problemi.length > 0) {
    for (const problema of problemi) scrive.error(`::error::${problema}`);
    scrive.error("Una release che non si può scaricare non è un rilascio.");
    return 1;
  }
  scrive.log(
    `la release ${tag} è pubblicata e completa (${(release.assets ?? []).length} allegati)`,
  );
  return 0;
}

/** Come legge la release il workflow: da GitHub, con `gh`. */
export function leggiDaGitHub(tag) {
  return JSON.parse(
    execFileSync(
      "gh",
      ["release", "view", tag, "--json", "isDraft,isPrerelease,name,tagName,assets"],
      {
        encoding: "utf8",
      },
    ),
  );
}

function main() {
  const tag = process.argv[2];
  if (!tag) {
    console.error("::error::Va indicato il tag della release da verificare");
    process.exit(1);
  }
  process.exit(verifica(tag, resolve(process.argv[3] ?? "dist"), leggiDaGitHub));
}

// Da un test si importa il modulo e `main` non deve fare niente: si vede da
// questo nome di file, che è l'unico modo di chiamare lo script.
if (process.argv[1]?.endsWith("verifica-release.mjs")) main();
