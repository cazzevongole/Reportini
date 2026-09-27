/**
 * Test di montaggio: monta l'app reale in jsdom con un IndexedDB finto.
 * È il test che intercetterebbe un crash a runtime come il dereferenziamento
 * di window.reportini fatto al caricamento del modulo.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "fake-indexeddb/auto";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

// jsdom non implementa nessuna di queste API: le stubbiamo prima che il
// modulo engine le tocchi.
class FakeStatement {
  constructor(private righe: Record<string, unknown>[]) {}
  bind() {}
  step() {
    return false;
  }
  getAsObject() {
    return this.righe[0] ?? {};
  }
  free() {}
}

class FakeDatabase {
  run() {}
  exec() {
    return [{ columns: ["n"], values: [[0]] }];
  }
  prepare() {
    return new FakeStatement([]);
  }
  export() {
    return new Uint8Array(16);
  }
  close() {}
}

vi.mock("sql.js", () => ({
  default: vi.fn(async () => ({ Database: FakeDatabase })),
}));

vi.mock("sql.js/dist/sql-wasm.wasm?url", () => ({ default: "/fake.wasm" }));

import App from "../src/App";
import { AccountProvider } from "../src/lib/cloud/session";

let contenitore: HTMLDivElement;
let radice: Root;

const IN_CARICAMENTO = "Apertura dei tuoi dati";

async function monta(scheda = "/") {
  // App.tsx monta il proprio BrowserRouter: pilotiamo la URL reale.
  window.history.pushState({}, "", scheda);
  radice = createRoot(contenitore);
  await act(async () => {
    radice.render(
      <AccountProvider>
        <App />
      </AccountProvider>,
    );
  });
  // L'apertura dei dati è asincrona e, con IS_REACT_ACT_ENVIRONMENT attivo,
  // React non committa fuori da act(): quindi ogni attesa va dentro un act().
  for (let tentativo = 0; tentativo < 100; tentativo += 1) {
    if (!contenitore.textContent?.includes(IN_CARICAMENTO)) return;
    await act(async () => {
      await new Promise((risolvi) => setTimeout(risolvi, 10));
    });
  }
  throw new Error("La pagina non è uscita dal caricamento");
}

beforeEach(() => {
  contenitore = document.createElement("div");
  document.body.appendChild(contenitore);
});

afterEach(async () => {
  await act(async () => radice?.unmount());
  contenitore.remove();
  vi.restoreAllMocks();
});

describe("Reportini", () => {
  it("monta la landing senza errori", async () => {
    await monta("/");
    expect(contenitore.textContent).toContain("Reportini");
    expect(contenitore.textContent).toContain("anagrafici");
  });

  it("non accede a window.reportini in un browser senza Electron", async () => {
    expect("reportini" in window).toBe(false);
    await monta("/");
    // Se il modulo avesse dereferenziato il ponte, il render sarebbe esploso.
    expect(contenitore.innerHTML).not.toBe("");
  });

  it("raggiunge il pannello dal percorso /panel", async () => {
    await monta("/panel");
    expect(contenitore.textContent).toContain("La tua scrivania");
  });
});
