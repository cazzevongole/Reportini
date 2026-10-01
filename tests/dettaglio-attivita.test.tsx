/**
 * Il percorso che è stato chiesto: il report **non** si crea a mano, nasce
 * dall'attività quando la si segna come completata. Qui si prova sul
 * componente vero, non sul repository: il punto che conta è che il bottone
 * "Genera il report" ci sia solo dopo la spunta, e che il titolo copiato sia
 * quello dell'attività.
 *
 * Nello stesso file c'è `Recapito`, che è l'altra metà della richiesta: i
 * recapiti cliccabili. Sta qui perché la regola del telefono (il prefisso
 * `+39` implicito, il resto come si può digitare) è una decisione, e una
 * decisione non coperta da un test la si riscrive per sbaglio.
 */
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("sql.js/dist/sql-wasm.wasm?url", () => ({
  default: `${process.cwd()}/node_modules/sql.js/dist/sql-wasm.wasm`,
}));

import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { initDatabase } from "../src/lib/sqlite/engine";
import { creaAzienda, creaAttivita, elencaReport, ottieniAttivita } from "../src/lib/repo";
import { AvvisoProvider } from "../src/components/Avvisi";
import DettaglioAttivita from "../src/components/DettaglioAttivita";
import Recapito, { numeroTelefonico } from "../src/components/Recapito";

function nuovaAttivita(): { aziendaId: number; attivitaId: number } {
  const aziendaId = creaAzienda({
    ragioneSociale: "Ferramenta Rossi S.r.l.",
    partitaIva: "01234567890",
    indirizzo: "",
    citta: "Verona",
    cap: "",
    provincia: "",
    telefono: "",
    email: "",
    note: "",
  });
  const attivitaId = creaAttivita({
    aziendaId,
    titolo: "Ritiro documento",
    descrizione: "",
    tipo: "appuntamento",
    inizio: "2026-10-01T10:00:00.000Z",
    fine: "2026-10-01T10:30:00.000Z",
    luogo: "",
    stato: "in-attesa",
    completata: false,
    promemoriaMin: 30,
    googleEventId: null,
    googleCalendarId: null,
    googleHtmlLink: null,
    googleSyncAt: null,
    googleErrore: null,
  });
  return { aziendaId, attivitaId };
}

describe("Il dettaglio dell'attività", () => {
  let contenitore: HTMLDivElement;
  let radice: Root | null = null;

  beforeEach(async () => {
    // Un dispositivo nuovo parte vuoto: senza questo il database sopravvive
    // da un test all'altro e i report di uno appaiono nel successivo.
    const db = await initDatabase();
    db.run("DELETE FROM report");
    db.run("DELETE FROM attivita");
    db.run("DELETE FROM referenti");
    db.run("DELETE FROM aziende");
    contenitore = document.createElement("div");
    document.body.appendChild(contenitore);
  });

  afterEach(async () => {
    if (radice) {
      await act(async () => {
        radice?.unmount();
      });
      radice = null;
    }
    contenitore.remove();
  });

  /**
   * Il componente riceve l'attività dal padre, quindi il padre deve rileggerla
   * dopo ogni modifica: è quello che fa la pagina dell'azienda, e senza questo
   * la spunta resterebbe sempre "non fatta" anche dopo il clic.
   */
  function monta(attivitaId: number) {
    radice = createRoot(contenitore);
    function Contenitore() {
      const [, forza] = useState(0);
      const attivita = ottieniAttivita(attivitaId)!;
      return (
        <AvvisoProvider>
          <DettaglioAttivita
            key={attivita.updatedAt + ":" + attivita.completata}
            attivita={attivita}
            onChiudi={() => {}}
            onModificata={() => forza((n) => n + 1)}
          />
        </AvvisoProvider>
      );
    }
    return act(async () => {
      radice?.render(<Contenitore />);
    });
  }

  function perEtichetta(nome: string): HTMLElement {
    const campi = [...contenitore.querySelectorAll<HTMLElement>("input, button, select, textarea")];
    const trovato = campi.find(
      (c) => c.textContent?.includes(nome) || c.getAttribute("aria-label") === nome,
    );
    if (!trovato) throw new Error(`elemento non trovato: ${nome}`);
    return trovato;
  }

  it("prima della spunta il report non si può generare", async () => {
    const { attivitaId } = nuovaAttivita();
    await monta(attivitaId);

    expect(contenitore.textContent).toContain("Segna l'attività come completata");
    expect(() => perEtichetta("Genera il report")).toThrow();
    expect(elencaReport({})).toHaveLength(0);
  });

  it("segnalata completata, genera il report con il titolo dell'attività", async () => {
    const { aziendaId, attivitaId } = nuovaAttivita();
    await monta(attivitaId);

    const spunta = contenitore.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    await act(async () => {
      spunta.click();
    });
    expect(ottieniAttivita(attivitaId)?.completata).toBe(true);

    await act(async () => {
      perEtichetta("Genera il report").click();
    });

    const report = elencaReport({});
    expect(report).toHaveLength(1);
    expect(report[0].titolo).toBe("Ritiro documento");
    expect(report[0].attivitaId).toBe(attivitaId);
    expect(report[0].aziendaId).toBe(aziendaId);
    // Il tipo e la data non stanno nel report: vengono dall'attività, e qui
    // devono arrivare senza essere stati scritti due volte.
    expect(report[0].attivitaTipo).toBe("appuntamento");
    expect(report[0].attivitaInizio).toBe("2026-10-01T10:00:00.000Z");
  });

  it("il report appena generato si apre e il titolo si corregge", async () => {
    const { attivitaId } = nuovaAttivita();
    await monta(attivitaId);

    const spunta = contenitore.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    await act(async () => {
      spunta.click();
    });
    await act(async () => {
      perEtichetta("Genera il report").click();
    });

    // Il form è già aperto sul report nuovo: si cambia il titolo e si salva.
    // Gli input senza attributo `type` sono text: non si possono cercare con
    // `[type="text"]`, perché l'attributo non c'è.
    const titolo = contenitore.querySelector<HTMLInputElement>('input:not([type="checkbox"])')!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      )!.set!;
      setter.call(titolo, "Ritiro documento — verbale");
      titolo.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      perEtichetta("Salva").click();
    });

    expect(elencaReport({})[0].titolo).toBe("Ritiro documento — verbale");
  });

  it("un report già generato non se ne genera un secondo, si apre", async () => {
    const { attivitaId } = nuovaAttivita();
    await monta(attivitaId);

    const spunta = contenitore.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    await act(async () => {
      spunta.click();
    });
    await act(async () => {
      perEtichetta("Genera il report").click();
    });
    await monta(attivitaId);

    expect(() => perEtichetta("Genera il report")).toThrow();
    expect(() => perEtichetta("Apri il report")).not.toThrow();
    expect(elencaReport({})).toHaveLength(1);
  });
});

describe("I recapiti cliccabili", () => {
  function renderizza(asse: React.ReactElement): HTMLElement {
    const contenitore = document.createElement("div");
    document.body.appendChild(contenitore);
    const radice = createRoot(contenitore);
    act(() => {
      radice.render(asse);
    });
    const nodo = contenitore.querySelector("a")!;
    return nodo;
  }

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("il telefono si ripulisce e mette il prefisso italiano", () => {
    expect(numeroTelefonico("340 123 4567")).toBe("+393401234567");
    expect(numeroTelefonico("040 1234567")).toBe("+390401234567");
    // Con il + già scritto non si aggiunge niente: è un numero estero.
    expect(numeroTelefonico("+39 340 123 4567")).toBe("+393401234567");
    expect(numeroTelefonico("+1 415 555 0100")).toBe("+14155550100");
  });

  it("il telefono e l'email diventano link chiamabili e scrivibili", () => {
    const telefono = renderizza(<Recapito tipo="telefono" valore="340 123 4567" />);
    expect(telefono.getAttribute("href")).toBe("tel:+393401234567");
    expect(telefono.getAttribute("aria-label")).toBe("Chiama il 340 123 4567");

    const email = renderizza(<Recapito tipo="email" valore="  info@rossi.it " />);
    expect(email.getAttribute("href")).toBe("mailto:info@rossi.it");
    expect(email.getAttribute("aria-label")).toBe("Scrivi a info@rossi.it");
  });

  it("un recapito vuoto non lascia un link vuoto", () => {
    const contenitore = document.createElement("div");
    document.body.appendChild(contenitore);
    const radice = createRoot(contenitore);
    act(() => {
      radice.render(
        <div>
          <Recapito tipo="telefono" valore="   " />
          <Recapito tipo="email" valore="" />
        </div>,
      );
    });
    expect(contenitore.querySelector("a")).toBeNull();
    radice.unmount();
  });
});
