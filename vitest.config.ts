import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

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
      VITE_DEV_WHITELIST: "mammarellandrea@gmail.com",
    },
  },
});
