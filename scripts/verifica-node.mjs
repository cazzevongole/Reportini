// La versione di Node sotto cui i test non possono partire, e perché.
//
// L'ambiente di test è jsdom, e jsdom richiede `@exodus/bytes` con
// `require()`. Quel modulo è ESM puro: Node lo carica da `require()` solo
// dalla 22.12, e prima l'errore è `ERR_REQUIRE_ESM` dentro un worker che
// muore mentre avvia.
//
// `vitest.config.ts` dice la stessa cosa, ma arriva dopo che Vite ha costruito
// la configurazione e mostra una pila di frame. Qui si esce subito e si dice
// cosa fare, per chi lancia `bun run test` e non ha idea di che cosa sia
// jsdom.
//
// Non si controlla nient'altro: la compilazione gira su bun e l'app nel
// browser gira su quello che c'è. Node serve solo per i test.

import { pathToFileURL } from "node:url";

export const NODE_MINIMO = [22, 12];

/** La versione è troppo vecchia? Un numero non riconosciuto conta come sì. */
export function troppoVecchio(versione, minimo = NODE_MINIMO) {
  const [maggiore, minore] = String(versione).replace(/^v/, "").split(".").map(Number);
  if ([maggiore, minore].some((n) => Number.isNaN(n))) return true;
  return maggiore < minimo[0] || (maggiore === minimo[0] && minore < minimo[1]);
}

/**
 * Il messaggio, fatto perché chi lo legge sappia cosa fare e non soltanto che
 * cosa è successo.
 */
export function messaggio(versione) {
  return (
    `I test hanno bisogno di Node ${NODE_MINIMO[0]}.${NODE_MINIMO[1]} o successivo: qui c'è Node ${versione}.\n` +
    "Il motivo è jsdom, che carica un modulo ESM con require(): Node lo permette solo dalla 22.12.\n" +
    "Aggiorna Node (o usa un gestore di versioni come fnm/nvm) e rilancia.\n" +
    "Senza installare nulla, per una prova:\n" +
    "  npx -y node@24 node_modules/vitest/vitest.mjs run"
  );
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (troppoVecchio(process.versions.node)) {
    console.error(messaggio(process.versions.node));
    process.exit(1);
  }
}
