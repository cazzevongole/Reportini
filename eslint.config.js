// Configurazione di ESLint.
//
// Vanno d'accordo due esigenze opposte. La prima è che `tsc` fa già il
// typecheck e segnala gli errori che ESLint non vede: qui non si ripete
// nulla, perché due strumenti che segnalano la stessa riga fanno perdere
// fiducia a entrambi. La seconda è che le regole sugli hook di React
// esistono, e il loro caso peggiore — chiamare un hook dopo un return
// anticipato — è proprio il tipo di difetto che in questa base di codice
// si può introdurre spostando due righe.

import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";

/**
 * Le variabili dichiarate e non usate.
 *
 * `ignoreRestSiblings` è la parte che conta: in questo progetto si
 * destruttura per escludere (`const { id: _id, ...resto } = anagrafico`),
 * cioè per dire "questa non mi serve" scrivendolo. Senza questa opzione
 * ogni esclusione deliberate diventerebbe un errore, e la regola
 * insegnerebbe a non scrivere il pattern più chiaro.
 *
 * `argsIgnorePattern` copre i parametri ignorati, che già si chiamano con
 * l'underscore.
 */
const INUTILI = [
  "error",
  {
    argsIgnorePattern: "^_",
    varsIgnorePattern: "^_",
    caughtErrors: "none",
    ignoreRestSiblings: true,
  },
];

export default tseslint.config(
  { ignores: ["dist/**", "electron/renderer/**", "electron/release/**", "node_modules/**"] },

  // Il codice dell'app: browser moderno, nessuna variabile globale.
  {
    files: ["src/**/*.{ts,tsx}"],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    plugins: { "react-hooks": reactHooks },
    languageOptions: {
      globals: globals.browser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // TypeScript segnala già le variabili locali inutilizzate, ma non le
      // dichiarazioni multiple: quelle le vede solo ESLint.
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": INUTILI,
    },
  },

  // I test parlano con il DOM e con il mocking: `any` è normale quando si
  // costruisce una risposta finta, e segnalarlo rende il segnale illeggibile.
  {
    files: ["tests/**/*.{ts,tsx}"],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    rules: {
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": INUTILI,
      "@typescript-eslint/no-explicit-any": "off",
    },
  },

  // Gli script girano su Node, non nel browser.
  {
    files: ["scripts/**/*.mjs", "*.config.{ts,js}"],
    extends: [js.configs.recommended],
    languageOptions: { globals: globals.node },
    rules: { "no-unused-vars": INUTILI },
  },
);
