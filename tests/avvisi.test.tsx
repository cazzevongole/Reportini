/**
 * Avvisi brevi: il contratto è che ogni azione che chiama la rete mostra
 * sempre un esito. Qui si controlla il meccanismo, non le singole azioni:
 * successo, errore, composizione del testo e auto-chiusura.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AvvisoProvider, useAvvisi } from "../src/components/Avvisi";

let contenitore: HTMLDivElement;
let radice: Root;
let ultimo: ReturnType<typeof useAvvisi> | null = null;

function Sonda() {
  ultimo = useAvvisi();
  return null;
}

async function monta() {
  radice = createRoot(contenitore);
  await act(async () => {
    radice.render(
      <AvvisoProvider>
        <Sonda />
      </AvvisoProvider>,
    );
  });
}

function testo() {
  return contenitore.textContent ?? "";
}

beforeEach(() => {
  ultimo = null;
  contenitore = document.createElement("div");
  document.body.appendChild(contenitore);
});

afterEach(async () => {
  await act(async () => radice?.unmount());
  contenitore.remove();
  vi.restoreAllMocks();
});

describe("Avvisi", () => {
  it("un'azione riuscita mostra la riga di successo", async () => {
    await monta();
    await act(async () => {
      await ultimo!.esegui(async () => ({ messaggio: "Dati salvati nel cloud" }), {
        successo: (r) => r.messaggio,
      });
    });

    expect(testo()).toContain("Dati salvati nel cloud");
    // Gli avvisi di successo si annunciano senza interrompere.
    expect(contenitore.querySelector('[role="status"]')).not.toBeNull();
    expect(contenitore.querySelector('[role="alert"]')).toBeNull();
  });

  it("un'azione fallita mostra l'errore e restituisce null", async () => {
    await monta();
    let esito: { ok: string } | null = null;
    await act(async () => {
      esito = await ultimo!.esegui(
        async () => {
          throw new Error("bucket non raggiungibile");
        },
        { errore: "Salvataggio online non riuscito" },
      );
    });

    expect(esito).toBeNull();
    // Il testo del chiamante dice cosa si stava facendo, quello dell'errore
    // perché è fallito: nell'avviso devono restare entrambi.
    expect(testo()).toContain("Salvataggio online non riuscito");
    expect(testo()).toContain("bucket non raggiungibile");
    // Un errore interrompe: è un problema, non un'informazione di servizio.
    expect(contenitore.querySelector('[role="alert"]')).not.toBeNull();
  });

  it("un'azione riuscita restituisce il risultato al chiamante", async () => {
    await monta();
    let esito: number | null = null;
    await act(async () => {
      esito = await ultimo!.esegui(async () => 42);
    });
    expect(esito).toBe(42);
  });

  it("l'avviso sparisce da solo dopo qualche secondo", async () => {
    vi.useFakeTimers();
    try {
      await monta();
      await act(async () => {
        await ultimo!.esegui(async () => undefined, { successo: "Fatto" });
      });
      expect(testo()).toContain("Fatto");

      await act(async () => {
        vi.advanceTimersByTime(5000);
      });
      expect(testo()).not.toContain("Fatto");
    } finally {
      vi.useRealTimers();
    }
  });

  it("l'errore resta più a lungo, così si ha tempo di leggerlo", async () => {
    vi.useFakeTimers();
    try {
      await monta();
      await act(async () => {
        await ultimo!.esegui(async () => {
          throw new Error("timeout");
        });
      });
      expect(testo()).toContain("timeout");

      await act(async () => {
        vi.advanceTimersByTime(5000);
      });
      // Cinque secondi non bastano: l'errore è ancora lì.
      expect(testo()).toContain("timeout");
    } finally {
      vi.useRealTimers();
    }
  });

  it("non accumula più di tre avvisi contemporaneamente", async () => {
    await monta();
    await act(async () => {
      for (const testo of ["uno", "due", "tre", "quattro"]) {
        await ultimo!.esegui(async () => undefined, { successo: testo });
      }
    });
    const avvisi = contenitore.querySelectorAll('[role="status"]');
    expect(avvisi.length).toBeLessThanOrEqual(3);
    // L'ultimo la vince: è quello che l'utente ha appena chiesto.
    expect(testo()).toContain("quattro");
  });

  it("l'avviso si può chiudere a mano", async () => {
    await monta();
    await act(async () => {
      await ultimo!.esegui(async () => undefined, { successo: "Chiedimi" });
    });
    const chiudi = contenitore.querySelector<HTMLButtonElement>(
      'button[aria-label="Chiudi avviso"]',
    );
    expect(chiudi).not.toBeNull();
    await act(async () => {
      chiudi!.click();
    });
    expect(testo()).not.toContain("Chiedimi");
  });
});
