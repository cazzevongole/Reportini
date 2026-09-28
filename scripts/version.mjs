// Incrementa la versione del pacchetto e la tiene allineata in tutti i
// posti dove compare: il package.json principale, quello di Electron e il
// CHANGELOG. Usato dal workflow che versiona a ogni merge su master.
//
//   node scripts/version.mjs patch|minor|major
//
// Non crea commit né tag: quello li fa il workflow, così lo script resta
// utilizzabile anche in locale per controllare il risultato.

import { readFileSync, writeFileSync } from "node:fs";

const LIVELLI = { major: 0, minor: 1, patch: 2 };
const livello = process.argv[2] ?? "patch";
if (!(livello in LIVELLI)) {
  console.error(`Uso: node scripts/version.mjs ${Object.keys(LIVELLI).join("|")}`);
  process.exit(1);
}

const POMI = ["package.json", "electron/package.json"];

function leggiVersione(file) {
  return JSON.parse(readFileSync(file, "utf8")).version;
}

function scriviVersione(file, versione) {
  const testo = readFileSync(file, "utf8");
  // Sostituisce solo la riga "version": gli altri campi restano come sono,
  // commenti compresi, cosa che riscrivere tutto il file non farebbe.
  const aggiornato = testo.replace(/("version":\s*")[^"]+(")/, `$1${versione}$2`);
  if (aggiornato === testo) {
    console.error(`Nessuna versione trovata in ${file}`);
    process.exit(1);
  }
  writeFileSync(file, aggiornato);
}

function nuovaVersione(attuale, livello) {
  const [maggiore, minore, patch] = attuale.split(".").map(Number);
  if ([maggiore, minore, patch].some((n) => Number.isNaN(n))) {
    console.error(`Versione non riconosciuta: "${attuale}"`);
    process.exit(1);
  }
  if (livello === "major") return `${maggiore + 1}.0.0`;
  if (livello === "minor") return `${maggiore}.${minore + 1}.0`;
  return `${maggiore}.${minore}.${patch + 1}`;
}

const attuale = leggiVersione("package.json");
const prossima = nuovaVersione(attuale, livello);

for (const file of POMI) {
  if (leggiVersione(file) !== attuale) {
    console.error(
      `${file} è alla versione ${leggiVersione(file)}, diversa da ${attuale}: allineali a mano prima di versionare.`,
    );
    process.exit(1);
  }
}

for (const file of POMI) scriviVersione(file, prossima);

const oggi = new Date().toISOString().slice(0, 10);
const riga = `## ${prossima} — ${oggi}\n\n- Versione incrementata automaticamente (${livello}).\n`;
try {
  const changelog = readFileSync("CHANGELOG.md", "utf8");
  const [testata, ...corpo] = changelog.split("\n");
  writeFileSync("CHANGELOG.md", `${testata}\n\n${riga}${corpo.join("\n")}`);
} catch {
  writeFileSync("CHANGELOG.md", `# Changelog\n\n${riga}`);
}

console.log(`${attuale} → ${prossima}`);
