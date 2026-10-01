import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

/**
 * La versione di Node sotto cui i test non partono, e perché.
 *
 * L'ambiente di test è jsdom, e jsdom richiede `@exodus/bytes` con
 * `require()`. Quel modulo è ESM puro, e Node lo carica da `require()` solo
 * dalla 22.12: prima l'errore è `ERR_REQUIRE_ESM`, dentro un worker che
 * muore mentre avvia, e la sola cosa che si legge è una riga su
 * `html-encoding-sniffer` — che non dice niente di questo progetto e non dice
 * cosa fare. Meglio fermarsi qui, prima di avviare i worker, con la
 * versione che manca e il rimedio.
 */
const [maggiore, minore] = process.versions.node.split(".").map(Number);
const NODE_MINIMO = [22, 12];
const troppoVecchio =
  maggiore < NODE_MINIMO[0] || (maggiore === NODE_MINIMO[0] && minore < NODE_MINIMO[1]);

if (troppoVecchio) {
  throw new Error(
    `I test hanno bisogno di Node ${NODE_MINIMO[0]}.${NODE_MINIMO[1]} o successivo: qui c'è Node ${process.versions.node}.\n` +
      "Il motivo è jsdom, che carica un modulo ESM con require(): Node lo permette solo dalla 22.12.\n" +
      "Aggiorna Node (o usa un gestore di versioni come fnm/nvm) e rilancia. Senza installare nulla, per una prova:\n" +
      "  npx -y node@24 node_modules/vitest/vitest.mjs run",
  );
}

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    include: ["tests/**/*.test.tsx", "tests/**/*.test.ts"],
    setupFiles: ["tests/setup.ts"],
    testTimeout: 20_000,
    // Vite sostituisce import.meta.env al momento della trasformazione: le
    // variabili devono quindi esistere qui per esercitare i percorsi cloud.
    // app.test.tsx gira senza queste e copre il fallback "solo locale".
    env: {
      VITE_SUPABASE_URL: "https://esempio.supabase.co",
      VITE_SUPABASE_ANON_KEY: "anon-key-di-prova",
      VITE_GOOGLE_CLIENT_ID: "123.apps.googleusercontent.com",
      // La schermata di apertura dura cinque secondi: in test deve durare
      // zero, altrimenti ogni montaggio aspetterebbe la stessa pausa.
      VITE_DURATA_APERTURA_MS: "0",
    },
  },
});
