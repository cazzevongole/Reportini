// Controlla che la versione sia coerente ovunque e che il tag dia la
// versione giusta. Lo usa il rilascio desktop: un tag sbagliato
// produrrebbe un pacchetto con un numero diverso da quello che si
// downloada, e non c'è modo di accorgersene dopo.

import { readFileSync } from "node:fs";

const POMI = ["package.json", "electron/package.json"];
const versione = (file) => JSON.parse(readFileSync(file, "utf8")).version;

const [principale, desktop] = POMI.map(versione);
const problemi = [];

if (principale !== desktop) {
  problemi.push(`package.json è a ${principale} ma electron/package.json a ${desktop}`);
}

// Il tag si controlla solo quando il run è davvero partito da un tag: su un
// push su un branch GITHUB_REF_NAME è "master", e confrontarlo con la
// versione bloccherebbe ogni versionamento.
const daTag = process.env.GITHUB_REF_TYPE === "tag";
const tag = daTag ? process.env.GITHUB_REF_NAME : undefined;
if (tag) {
  const atteso = `v${principale}`;
  if (tag !== atteso) {
    problemi.push(`il tag è ${tag} ma la versione è ${principale}: dovrebbe essere ${atteso}`);
  }
}

if (problemi.length > 0) {
  console.error(problemi.map((p) => `ERRORE: ${p}`).join("\n"));
  process.exit(1);
}

console.log(`versione coerente: ${principale}${tag ? ` (tag ${tag})` : ""}`);
