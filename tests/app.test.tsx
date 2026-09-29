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
import { SchermataErrore } from "../src/components/ErroreAvvio";
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
  //
  // Si aspetta anche la pagina differita: le rotte dentro l'area autenticata
  // si scaricano a parte, quindi il database può essere pronto mentre la
  // pagina è ancora in volo. Il segnale è il fallback di Suspense, che porta
  // role="status".
  for (let tentativo = 0; tentativo < 100; tentativo += 1) {
    const inApertura = contenitore.textContent?.includes(IN_CARICAMENTO);
    const paginaInVolo = contenitore.querySelector('[role="status"]') !== null;
    if (!inApertura && !paginaInVolo) return;
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
  it("mostra la pagina di accesso a chi non ha un account", async () => {
    await monta("/accedi");
    expect(contenitore.textContent).toContain("Reportini");
    expect(contenitore.textContent).toContain("Accedi con Google");
  });

  it("non accede a window.reportini in un browser senza Electron", async () => {
    expect("reportini" in window).toBe(false);
    await monta("/");
    // Se il modulo avesse dereferenziato il ponte, il render sarebbe esploso.
    expect(contenitore.innerHTML).not.toBe("");
  });

  it("non lascia vedere le pagine interne senza accesso", async () => {
    for (const scheda of ["/", "/panel", "/panel/anagrafici", "/panel/impostazioni"]) {
      await monta(scheda);
      expect(window.location.pathname).toBe("/accedi");
      // Nessun dato, nemmeno una schermata di benvenuto con dentro l'app.
      expect(contenitore.textContent).not.toContain("La tua scrivania");
      expect(contenitore.textContent?.toLowerCase()).not.toContain("sqlite");
      // Ogni scheda parte da una radice pulita: createRoot sullo stesso
      // contenitore lascerebbe il render precedente dentro.
      await act(async () => radice.unmount());
    }
  });
});

describe("Un errore non può diventare una pagina bianca", () => {
  it("la schermata dice che cosa è andato storto e che i dati ci sono", async () => {
    radice = createRoot(contenitore);
    await act(async () => {
      radice.render(
        <SchermataErrore
          errore={new Error("asset non trovato: ./assets/index-xyz.js")}
          desktop={false}
        />,
      );
    });

    expect(contenitore.textContent).toContain("Impossibile mostrare l'app");
    expect(contenitore.textContent).toContain("asset non trovato");
    // La paura numero uno di chi trova una finestra bianca: aver perso i
    // dati. Il messaggio dice subito il contrario.
    expect(contenitore.textContent).toContain("I tuoi dati non sono persi");
    expect(contenitore.innerHTML).not.toBe("");
  });

  it("sul desktop dice dove trovare il dettaglio completo", async () => {
    radice = createRoot(contenitore);
    await act(async () => {
      radice.render(<SchermataErrore errore={new Error("boom")} desktop={true} />);
    });
    expect(contenitore.textContent).toContain("renderer.log");
    expect(contenitore.textContent).toContain("APPDATA");
  });
});
