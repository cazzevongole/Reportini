import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

// BASE_PATH lets the same build target the root (local / Freebuff hosting)
// and a project subpath (GitHub Pages: https://<user>.github.io/Reportini/).
//
// ELECTRON=1 forces a *relative* base instead. The desktop app opens
// index.html from file://, where a path like "/assets/app.js" points to
// file:///assets/app.js — the filesystem root, where nothing is. Relative
// paths are the only ones that resolve there.
const base = process.env.ELECTRON
  ? "./"
  : process.env.BASE_PATH
    ? `${process.env.BASE_PATH}/`
    : "/";

const PREFISSI_PRIVILEGIATI = ["sb_secret_", "sbp_"];

export default defineConfig(({ command, mode }) => {
  const env = {
    ...loadEnv(mode ?? "development", process.cwd(), ""),
    // Alcuni ambienti (CI, Freebuff) iniettano le variabili nel processo
    // invece di esporle in un file .env.
    ...(process.env.VITE_SUPABASE_ANON_KEY ? { VITE_SUPABASE_ANON_KEY: process.env.VITE_SUPABASE_ANON_KEY } : {}),
  };
  const chiave = env.VITE_SUPABASE_ANON_KEY ?? "";

  // Vite sostituisce import.meta.env in fase di build: una chiave segreta
  // finirebbe per forza dentro il bundle. In sviluppo l'app mostra un avviso e
  // si comporta in sola modalità locale; in produzione la build si ferma.
  if (command === "build" && PREFISSI_PRIVILEGIATI.some((p) => chiave.startsWith(p))) {
    throw new Error(
      "VITE_SUPABASE_ANON_KEY contiene una chiave Supabase segreta (sb_secret_).\n" +
        "Equivale alla vecchia service_role: nel bundle darebbe a chiunque l'accesso " +
        "ai dati di tutti gli utenti.\n" +
        "Sostituiscila con la chiave pubblica sb_publishable_ " +
        "(Supabase → Project Settings → API → chiave 'public').\n" +
        "La chiave segreta usata va anche revocata dalla pagina delle API keys.",
    );
  }

  return {
    base,
    plugins: [react()],
    server: {
      // Required so the managed preview (and devices on the LAN) can reach it.
      host: "0.0.0.0",
      port: 5173,
      // The managed preview reaches Vite through this public hostname, which Vite
      // would otherwise reject as an unknown Host header.
      allowedHosts: ["5173-iny83tlpokz9nx0xg4bkl.e2b.app"],
    },
    build: {
      outDir: "dist",
      target: "es2020",
      chunkSizeWarningLimit: 1200,
    },
    // sql.js is a UMD/CommonJS bundle: let esbuild pre-bundle it so the default
    // import works in dev, and resolve the .wasm separately through `?url`.
    optimizeDeps: { include: ["sql.js"] },
  };
});
