// Copia la build web dentro electron/renderer.
//
// Sostituisce `rm -rf && cp -R` perché su Windows la shell di GitHub
// Actions è PowerShell, dove quei comandi non esistono: il rilascio
// desktop girerebbe solo su Linux e macOS. Qui si usa node, che è
// uguale dappertutto.

import { cpSync, existsSync, rmSync } from "node:fs";
import { resolve } from "node:path";

const sorgente = resolve("dist");
const destinazione = resolve("electron/renderer");

if (!existsSync(sorgente)) {
  console.error("dist/ non esiste: lancia prima la build della web.");
  process.exit(1);
}

rmSync(destinazione, { recursive: true, force: true });
cpSync(sorgente, destinazione, { recursive: true });
console.log(`renderer copiato in ${destinazione}`);
