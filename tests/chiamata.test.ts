/**
 * Le regole della **chiamata**, che non sono quelle dell'appuntamento.
 *
 * Una chiamata ha un momento e basta, e una casella: si fa o non si fa.
 * Qui si provano le funzioni che decidono, perché sono decisioni e non
 * dettagli di aspetto: una `fine` sbagliata finisce **prima** dell'inizio, e
 * due colonne che dicono cose diverse fanno leggere "confermato" su una
 * chiamata che nessuno ha ancora fatta.
 */
import "fake-indexeddb/auto";
import { describe, expect, it, vi } from "vitest";

// Il wasm va letto dal disco: in jsdom non c'è un server che lo serva.
vi.mock("sql.js/dist/sql-wasm.wasm?url", () => ({
  default: `${process.cwd()}/node_modules/sql.js/dist/sql-wasm.wasm`,
}));
import {
  colonneChiamata,
  etichettaStato,
  fineAttivita,
  MINUTI_CHIAMATA,
  rigaStatoEvento,
  titoloEvento,
} from "../src/lib/types";
import { segnaChiamataCompletata } from "../src/lib/repo";
import { initDatabase } from "../src/lib/sqlite/engine";
import { creaAzienda, creaAttivita, ottieniAttivita } from "../src/lib/repo";

describe("Una chiamata è un momento, non un intervallo", () => {
  it("la fine si calcola, non si scrive", () => {
    const fine = fineAttivita("chiamata", "2026-10-01T15:00:00.000Z");
    expect(fine).toBe("2026-10-01T15:30:00.000Z");
    expect(new Date(fine).getTime() - new Date("2026-10-01T15:00:00.000Z").getTime()).toBe(
      MINUTI_CHIAMATA * 60000,
    );
  });

  it("sull'appuntamento la fine non la tocca", () => {
    const inizioFine = "2026-10-01T15:00:00.000Z";
    expect(fineAttivita("appuntamento", inizioFine)).toBe(inizioFine);
    // Il punto del controllo: la funzione va chiamata con l'inizio, e per
    // un appuntamento la fine se la decide l'utente.
    expect(fineAttivita("appuntamento", "2026-10-01T15:00:00.000Z")).not.toBe(
      "2026-10-01T15:30:00.000Z",
    );
  });

  it("il titolo dell'evento è lo stesso dei due tipi", () => {
    expect(titoloEvento("chiamata", "Sollecito fattura")).toBe("CHIAMATA - Sollecito fattura");
    expect(titoloEvento("appuntamento", "Ritiro documento")).toBe(
      "APPUNTAMENTO - Ritiro documento",
    );
  });
});

describe("Una chiamata ha due soli stati: si fa o non si fa", () => {
  it("la casella dice da fare o fatta, e nient'altro", () => {
    expect(etichettaStato("chiamata", "in-attesa", false)).toBe("da fare");
    expect(etichettaStato("chiamata", "confermato", true)).toBe("fatta");
    // La parola viene dalla casella e non dalla colonna: una riga con le due
    // discordi deve leggersi come la casella, che è l'unico comando.
    expect(etichettaStato("chiamata", "confermato", false)).toBe("da fare");
    expect(etichettaStato("chiamata", "in-attesa", true)).toBe("fatta");
  });

  it("sull'appuntamento le parole restano quelle di prima", () => {
    expect(etichettaStato("appuntamento", "in-attesa", false)).toBe("in attesa");
    expect(etichettaStato("appuntamento", "confermato", false)).toBe("confermato");
    expect(etichettaStato("appuntamento", "annullato", false)).toBe("annullato");
  });

  it("la casella decide anche la colonna che serve al colore", () => {
    expect(colonneChiamata(true)).toEqual({ stato: "confermato", completata: true });
    expect(colonneChiamata(false)).toEqual({ stato: "in-attesa", completata: false });
  });

  it("la riga sull'evento usa le parole della chiamata", () => {
    expect(rigaStatoEvento("chiamata", "in-attesa", false)).toBe("Stato: da fare");
    expect(rigaStatoEvento("chiamata", "confermato", true)).toBe("Stato: fatta");
    expect(rigaStatoEvento("appuntamento", "in-attesa", false)).toBe(
      "Stato: in attesa di conferma",
    );
  });
});

describe("Lo stato della chiamata finisce nel database intero", () => {
  it("stato e completata si scrivono insieme, senza stati impossibili", async () => {
    await initDatabase();
    const aziendaId = creaAzienda({
      ragioneSociale: "Ferramenta Rossi S.r.l.",
      partitaIva: "04567890123",
      indirizzo: "",
      citta: "",
      cap: "",
      provincia: "",
      telefono: "",
      email: "",
      note: "",
    });
    const attivitaId = creaAttivita({
      aziendaId,
      titolo: "Sollecito fattura",
      descrizione: "",
      tipo: "chiamata",
      inizio: "2026-10-01T15:00:00.000Z",
      fine: "2026-10-01T15:30:00.000Z",
      luogo: "",
      stato: "in-attesa",
      completata: false,
      promemoriaMin: 0,
      googleEventId: null,
      googleCalendarId: null,
      googleHtmlLink: null,
      googleSyncAt: null,
      googleErrore: null,
    });

    segnaChiamataCompletata(attivitaId, true);
    let salvata = ottieniAttivita(attivitaId)!;
    expect(salvata.stato).toBe("confermato");
    expect(salvata.completata).toBe(true);

    // E tornare indietro non lascia tracce della casella.
    segnaChiamataCompletata(attivitaId, false);
    salvata = ottieniAttivita(attivitaId)!;
    expect(salvata.stato).toBe("in-attesa");
    expect(salvata.completata).toBe(false);
  });

  it("una riga con le due colonne discordi si legge come la casella", async () => {
    await initDatabase();
    const aziendaId = creaAzienda({
      ragioneSociale: "Ferramenta Rossi S.r.l.",
      partitaIva: "04567890123",
      indirizzo: "",
      citta: "",
      cap: "",
      provincia: "",
      telefono: "",
      email: "",
      note: "",
    });
    const attivitaId = creaAttivita({
      aziendaId,
      titolo: "Sollecito fattura",
      descrizione: "",
      tipo: "chiamata",
      inizio: "2026-10-01T15:00:00.000Z",
      fine: "2026-10-01T15:30:00.000Z",
      luogo: "",
      // Le colonne discordi sono il caso che non dovrebbe arrivare dal cloud:
      // nessuno dei due modi di scrivere le lascia così, ma se arrivassero
      // l'utente deve leggere quello che dice la casella.
      stato: "confermato",
      completata: false,
      promemoriaMin: 0,
      googleEventId: null,
      googleCalendarId: null,
      googleHtmlLink: null,
      googleSyncAt: null,
      googleErrore: null,
    });

    const salvata = ottieniAttivita(attivitaId)!;
    expect(salvata.completata).toBe(false);
    expect(salvata.stato).toBe("in-attesa");
  });
});
