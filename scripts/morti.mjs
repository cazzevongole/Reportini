// Elenco gli export che nessuno importa e i file che nessuno raggiunge.
//
//   node scripts/morti.mjs
//
// Non sostituisce un analizzatore: guarda i nomi e li cerca in tutto il
// progetto, e segnala quello che non trova. Serve a far emergere il codice
// morto durante la pulizia, non a fare da guardia in CI — un export può
// essere usato solo da un test o da uno script, e qui non lo si distingue.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const RADICE = "src";
const ALTRI = ["tests", "scripts"];

const file = [];
function gira(dir) {
  let voci;
  try {
    voci = readdirSync(dir);
  } catch {
    return;
  }
  for (const nome of voci) {
    const p = join(dir, nome);
    if (statSync(p).isDirectory()) gira(p);
    else if (/\.(ts|tsx)$/.test(nome)) file.push(p);
  }
}
gira(RADICE);

const sorgenti = new Map(file.map((f) => [f, readFileSync(f, "utf8")]));

// Tutto il testo in cui un nome può essere citato: il codice, i test e gli
// script. Un export usato solo da un test è usato, e va tenuto.
const ovunque = [
  ...sorgenti.values(),
  ...ALTRI.flatMap((d) => {
    const fuori = [];
    try {
      for (const n of readdirSync(d)) {
        const p = join(d, n);
        if (statSync(p).isFile() && /\.tsx?$|\.mjs$/.test(n)) fuori.push(readFileSync(p, "utf8"));
      }
    } catch {
      // la cartella può non esistere: non è un errore
    }
    return fuori;
  }),
].join("\n");

// I nomi che qualcuno importa davvero, con o senza rinomina.
const importati = new Set();
for (const t of sorgenti.values()) {
  for (const m of t.matchAll(/import\s+(?:type\s+)?\{([^}]*)\}\s+from/g)) {
    for (const pezzo of m[1].split(",")) {
      const nome = pezzo.trim().split(/\s+as\s+/).pop()?.trim();
      if (nome) importati.add(nome);
    }
  }
}

// Gli export pubblicati, e il file che li dichiara.
const dichiarati = [];
for (const [f, t] of sorgenti) {
  for (const m of t.matchAll(
    /(?:^|\n)\s*export\s+(?:async\s+)?(?:declare\s+)?(?:function|const|let|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/g,
  )) {
    dichiarati.push({ file: f, nome: m[1] });
  }
}

const morti = dichiarati.filter(({ nome }) => {
  if (importati.has(nome)) return false;
  // Un nome compare almeno una volta alla dichiarazione: se è quello tutto,
  // nessuno lo usa. `export default` e i re-export non sono qui.
  return (ovunque.match(new RegExp(`\\b${nome}\\b`, "g")) ?? []).length <= 1;
});

// I file che nessun `from "..."` raggiunge.
const raggiunti = new Set();
for (const [f, t] of sorgenti) {
  for (const m of t.matchAll(/from\s+"(\.[^"]+)"/g)) {
    const parti = m[1].split("/");
    const base = parti.length > 1 ? parti.slice(0, -1).join("/") : ".";
    raggiunti.add(resolve(dirname(f), `${base}/x`).replace(/\\/g, "/"));
  }
}
const orfani = file.filter((f) => !raggiunti.has(resolve(f, "../x").replace(/\\/g, "/")));

console.log(`File analizzati: ${file.length}`);
if (morti.length === 0) {
  console.log("Nessun export inutilizzato.");
} else {
  console.log(`\nExport che nessuno importa (${morti.length}):`);
  for (const m of morti) console.log(`  ${relative(".", m.file)}  ${m.nome}`);
}
if (orfani.length === 0) {
  console.log("Nessun file orfano.");
} else {
  console.log(`\nFile mai importati (${orfani.length}):`);
  for (const o of orfani) console.log(`  ${relative(".", o)}`);
}
