/**
 * Il renderer desktop, che si apre da un file.
 *
 * La pagina bianca su Windows veniva da qui: aperta da
 * `file:///C:/Program Files/.../app.asar/renderer/index.html`, il
 * BrowserRouter non trovava nessuna rotta in quel percorso e il fallback
 * riportava a "/", facendo navigare il browser a `file:///C:/` — la radice
 * del disco, dove non c'è un indice.html. Nel log del main process
 * compariva `did-fail-load -6 ERR_FILE_NOT_FOUND file:///C:/`.
 *
 * Il test mette il ponte di Electron in piedi prima di importare l'app, e
 * verifica che il percorso di file non venga mai "pulito" fino alla radice.
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

// Il ponte deve esistere PRIMA che i moduli lo valutino: storage.ts lo legge
// una volta sola, al caricamento, e da quello dipende la scelta del router.
vi.hoisted(() => {
  (window as unknown as { reportini: unknown }).reportini = {
    platform: "win32",
    dbPath: "C:\\Users\\mara\\AppData\\Roaming\\Reportini\\reportini.sqlite",
    readDb: async () => null,
    writeDb: async () => {},
    revealDb: async () => "",
    saveText: async () => "",
  };
});

import App from "../src/App";
import { AccountProvider } from "../src/lib/cloud/session";

/** Il percorso vero di un file su Windows, con lo spazio di "Program Files". */
const PERCORSO_FILE =
  "/C:/Program%20Files/Reportini/resources/app.asar/renderer/index.html";

let contenitore: HTMLDivElement;
let radice: Root | null = null;

async function monta(percorso: string) {
  window.history.pushState({}, "", percorso);
  radice = createRoot(contenitore);
  await act(async () => {
    radice!.render(
      <AccountProvider>
        <App />
      </AccountProvider>,
    );
  });
  for (let tentativo = 0; tentativo < 100; tentativo += 1) {
    if (!contenitore.textContent?.includes("Apertura dei tuoi dati")) return;
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
  const radiceDaSmontare = radice;
  if (radiceDaSmontare) {
    await act(async () => radiceDaSmontare.unmount());
    radice = null;
  }
  contenitore.remove();
  vi.restoreAllMocks();
});

describe("Renderer desktop: aperto da un file, non dalla radice del disco", () => {
  it("non ripulisce il percorso del file fino a /", async () => {
    await monta(PERCORSO_FILE);

    // Il percorso del file è ancora quello: nessuna navigazione alla
    // radice del disco, che su Windows è una cartella senza indice.html.
    expect(window.location.pathname).toBe(PERCORSO_FILE);
    // E la pagina ha qualcosa da mostrare invece del vuoto.
    expect(contenitore.innerHTML).not.toBe("");
    expect(contenitore.textContent).toContain("Reportini");
  });

  it("la schermata di benvenuto copre l'app come nel browser", async () => {
    await monta(PERCORSO_FILE);
    // Senza account si arriva alla richiesta di accesso, e non a un 404:
    // la barra e l'intestazione sono la prova che il router ha risolto la
    // rotta iniziale.
    expect(window.location.pathname).toBe(PERCORSO_FILE);
    expect(contenitore.textContent).toContain("Accedi con Google");
  });
});
