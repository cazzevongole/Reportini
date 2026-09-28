/**
 * Cancellazioni: quando sparisce un record, devono sparire anche i
 * riferimenti che rimarrebbero sospesi. Qui il motore SQLite è quello
 * vero (sql.js su IndexedDB finto): è l'unico modo di vedere se una
 * cancellazione lascia davvero indietro qualcosa.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import "fake-indexeddb/auto";

// Il wasm va letto dal disco: in jsdom non c'è un server che lo serva.
vi.mock("sql.js/dist/sql-wasm.wasm?url", () => ({
  default: `${process.cwd()}/node_modules/sql.js/dist/sql-wasm.wasm`,
}));

import { all, initDatabase, insert } from "../src/lib/sqlite/engine";
import {
  effettoEliminazioneAnagrafica,
  effettoEliminazioneRelazione,
  eliminaAnagrafico,
  eliminaRelazione,
} from "../src/lib/repo";

const ora = () => new Date().toISOString();

function creaAnagrafico(nome: string): number {
  return insert("anagrafici", {
    nome,
    cognome: "Rossi",
    documento: `DOC-${nome}`,
    dataNascita: "1980-01-01",
    sesso: "",
    nazionalita: "",
    indirizzo: "",
    citta: "Verona",
    cap: "",
    provincia: "",
    telefono: "",
    email: "",
    note: "",
    createdAt: ora(),
    updatedAt: ora(),
  });
}

function creaRelazione(anagraficoId: number, titolo: string): number {
  return insert("relazioni", {
    anagraficoId,
    titolo,
    tipo: "Residenza",
    stato: "bozza",
    contenuto: "Testo",
    data: ora().slice(0, 10),
    createdAt: ora(),
    updatedAt: ora(),
  });
}

function creaAppuntamento(
  persona: number | null,
  relazione: number | null,
  titolo: string,
): number {
  return insert("appuntamenti", {
    anagraficoId: persona,
    relazioneId: relazione,
    titolo,
    descrizione: "",
    inizio: ora(),
    fine: ora(),
    luogo: "",
    stato: "in-attesa",
    promemoriaMin: 60,
    googleEventId: null,
    googleCalendarId: null,
    googleHtmlLink: null,
    googleSyncAt: null,
    createdAt: ora(),
    updatedAt: ora(),
  });
}

const id = (riga: { id: number }) => riga.id;

beforeAll(async () => {
  await initDatabase();
});

describe("Chiavi esterne", () => {
  it("restano attive anche dopo un salvataggio", async () => {
    // sql.js chiude e riapre il database a ogni export: se il PRAGMA non
    // viene rimesso, dal primo salvataggio in poi le cascate smettono di
    // funzionare e restano righe appese.
    const { snapshot, flush } = await import("../src/lib/sqlite/engine");
    await flush();
    expect(all("PRAGMA foreign_keys")).toEqual([{ foreign_keys: 1 }]);

    snapshot();
    expect(all("PRAGMA foreign_keys")).toEqual([{ foreign_keys: 1 }]);

    await flush();
    expect(all("PRAGMA foreign_keys")).toEqual([{ foreign_keys: 1 }]);
  });
});

beforeEach(() => {
  // Un database pulito a ogni test: l'ordine non deve contare.
  all("DELETE FROM appuntamenti");
  all("DELETE FROM relazioni");
  all("DELETE FROM anagrafici");
});

describe("Eliminazione di un'anagrafica", () => {
  it("porta via relazioni e appuntamenti che si riferivano a lei", () => {
    const persona = creaAnagrafico("Mario");
    const altra = creaAnagrafico("Giulia");
    const relazione = creaRelazione(persona, "Certificato");
    // Appuntamento legato solo alla relazione: senza la persona resterebbe
    // appeso a un riferimento cancellato.
    const orfano = creaAppuntamento(null, relazione, "Consegna");
    // Appuntamento di un'altra persona: non c'entra e deve restare.
    const diAltra = creaAppuntamento(altra, null, "Sportello");

    const effetto = effettoEliminazioneAnagrafica(persona);
    expect(effetto.relazioni).toBe(1);
    expect(effetto.appuntamenti).toBe(1);

    eliminaAnagrafico(persona);

    expect(all("SELECT id FROM appuntamenti WHERE id = ?", [orfano])).toHaveLength(0);
    expect(all("SELECT id FROM appuntamenti WHERE id = ?", [diAltra])).toHaveLength(1);
    // Nessuna riga senza più nessun riferimento: è quello che resterebbe
    // visibile sulle altre pagine.
    expect(
      all("SELECT id FROM appuntamenti WHERE anagraficoId IS NULL AND relazioneId IS NULL"),
    ).toHaveLength(0);
    expect(all("SELECT id FROM relazioni WHERE anagraficoId = ?", [persona])).toHaveLength(0);
  });
});

describe("Eliminazione di una relazione", () => {
  it("porta via solo gli appuntamenti che si riferivano solo a lei", () => {
    const persona = creaAnagrafico("Mario");
    const relazione = creaRelazione(persona, "Certificato");
    const soloRelazione = creaAppuntamento(null, relazione, "Consegna");
    const anchePersona = creaAppuntamento(persona, relazione, "Sportello");

    expect(effettoEliminazioneRelazione(relazione).appuntamenti).toBe(1);

    eliminaRelazione(relazione);

    expect(all("SELECT id FROM appuntamenti WHERE id = ?", [soloRelazione])).toHaveLength(0);
    // Questo ha ancora una persona: resta, e senza più la relazione.
    const rimasto = all<{ id: number; relazioneId: number | null }>(
      "SELECT id, relazioneId FROM appuntamenti WHERE id = ?",
      [anchePersona],
    );
    expect(rimasto).toHaveLength(1);
    expect(rimasto.map(id)).toEqual([anchePersona]);
    expect(rimasto[0].relazioneId).toBeNull();
  });
});
