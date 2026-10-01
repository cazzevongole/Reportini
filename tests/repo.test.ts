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
  aggiornaAzienda,
  creaAzienda,
  creaReferente as nuovoReferente,
  effettoEliminazioneAzienda,
  effettoEliminazioneRelazione,
  eliminaAzienda,
  eliminaRelazione,
  elencaAziende,
  elencaReferenti,
  inizialiAzienda,
  nomeAzienda,
  nomeReferente,
  ottieniAzienda,
} from "../src/lib/repo";

const ora = () => new Date().toISOString();

function nuovaAzienda(ragioneSociale: string): number {
  return insert("aziende", {
    ragioneSociale,
    partitaIva: `PIVA-${ragioneSociale}`,
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

function creaReferente(aziendaId: number, nome: string): number {
  return insert("referenti", {
    aziendaId,
    nome,
    cognome: "Rossi",
    telefono: "",
    email: "",
    createdAt: ora(),
    updatedAt: ora(),
  });
}

function creaRelazione(aziendaId: number, titolo: string): number {
  return insert("relazioni", {
    aziendaId,
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
  azienda: number | null,
  relazione: number | null,
  titolo: string,
): number {
  return insert("appuntamenti", {
    aziendaId: azienda,
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
  all("DELETE FROM referenti");
  all("DELETE FROM aziende");
});

describe("Eliminazione di un'azienda", () => {
  it("porta via referenti, relazioni e appuntamenti che si riferivano a lei", () => {
    const azienda = nuovaAzienda("Ferramenta Rossi");
    const altra = nuovaAzienda("Verdi S.r.l.");
    const referente = creaReferente(azienda, "Mario");
    creaReferente(altra, "Giulia");
    const relazione = creaRelazione(azienda, "Certificato");
    // Appuntamento legato solo alla relazione: senza l'azienda resterebbe
    // appeso a un riferimento cancellato.
    const orfano = creaAppuntamento(null, relazione, "Consegna");
    // Appuntamento di un'altra azienda: non c'entra e deve restare.
    const diAltra = creaAppuntamento(altra, null, "Sportello");

    const effetto = effettoEliminazioneAzienda(azienda);
    expect(effetto.referenti).toBe(1);
    expect(effetto.relazioni).toBe(1);
    expect(effetto.appuntamenti).toBe(1);

    eliminaAzienda(azienda);

    // Il referente è nato con la tabella referenti, quindi sparisce in
    // cascata: senza quel controllo resterebbe un id che non punta a nulla.
    expect(all("SELECT id FROM referenti WHERE id = ?", [referente])).toHaveLength(0);
    expect(all("SELECT id FROM referenti WHERE aziendaId = ?", [altra])).toHaveLength(1);
    expect(all("SELECT id FROM appuntamenti WHERE id = ?", [orfano])).toHaveLength(0);
    expect(all("SELECT id FROM appuntamenti WHERE id = ?", [diAltra])).toHaveLength(1);
    // Nessuna riga senza più nessun riferimento: è quello che resterebbe
    // visibile sulle altre pagine.
    expect(
      all("SELECT id FROM appuntamenti WHERE aziendaId IS NULL AND relazioneId IS NULL"),
    ).toHaveLength(0);
    expect(all("SELECT id FROM relazioni WHERE aziendaId = ?", [azienda])).toHaveLength(0);
  });
});

describe("Eliminazione di una relazione", () => {
  it("porta via solo gli appuntamenti che si riferivano solo a lei", () => {
    const azienda = nuovaAzienda("Ferramenta Rossi");
    const relazione = creaRelazione(azienda, "Certificato");
    const soloRelazione = creaAppuntamento(null, relazione, "Consegna");
    const ancheAzienda = creaAppuntamento(azienda, relazione, "Sportello");

    expect(effettoEliminazioneRelazione(relazione).appuntamenti).toBe(1);

    eliminaRelazione(relazione);

    expect(all("SELECT id FROM appuntamenti WHERE id = ?", [soloRelazione])).toHaveLength(0);
    // Questo ha ancora un'azienda: resta, e senza più la relazione.
    const rimasto = all<{ id: number; relazioneId: number | null }>(
      "SELECT id, relazioneId FROM appuntamenti WHERE id = ?",
      [ancheAzienda],
    );
    expect(rimasto).toHaveLength(1);
    expect(rimasto.map(id)).toEqual([ancheAzienda]);
    expect(rimasto[0].relazioneId).toBeNull();
  });
});

describe("Aziende e referenti", () => {
  it("la ragione sociale viene ripulita e la partita iva messa in maiuscolo", () => {
    const id = creaAzienda({
      ragioneSociale: "  Ferramenta Rossi S.r.l.  ",
      partitaIva: " 03012345678 ",
      indirizzo: " Via Roma 1 ",
      citta: " Verona ",
      cap: "37100",
      provincia: "vr",
      telefono: "",
      email: "",
      note: "",
    });

    const salvata = ottieniAzienda(id);
    expect(salvata?.ragioneSociale).toBe("Ferramenta Rossi S.r.l.");
    expect(salvata?.partitaIva).toBe("03012345678");
    expect(salvata?.indirizzo).toBe("Via Roma 1");
    expect(salvata?.provincia).toBe("vr");
  });

  it("il conteggio dei referenti segue quello che c'è davvero", () => {
    const azienda = nuovaAzienda("Ferramenta Rossi");
    expect(ottieniAzienda(azienda)?.numReferenti).toBe(0);

    const mario = nuovoReferente({
      aziendaId: azienda,
      nome: " Mario ",
      cognome: " Rossi ",
      telefono: " 3401234567 ",
      email: " mario.rossi@example.it ",
    });
    nuovoReferente({
      aziendaId: azienda,
      nome: "Giulia",
      cognome: "Verdi",
      telefono: "",
      email: "",
    });
    nuovoReferente({
      aziendaId: nuovaAzienda("Altra S.r.l."),
      nome: "Luca",
      cognome: "Bianchi",
      telefono: "",
      email: "",
    });

    expect(ottieniAzienda(azienda)?.numReferenti).toBe(2);
    // I referenti sono ordinati per cognome: è l'elenco di chi si chiama, e
    // l'utente li cerca per quello.
    const elenco = elencaReferenti(azienda);
    expect(elenco.map(nomeReferente)).toEqual(["Mario Rossi", "Giulia Verdi"]);
    // I valori sono ripuliti: uno spazio in più qui finirebbe nelle
    // ricerche e nei contatti.
    expect(elenco[0].nome).toBe("Mario");
    expect(elenco[0].telefono).toBe("3401234567");
    expect(elencaReferenti(ottieniAzienda(azienda)!.id)).toHaveLength(2);
    expect(mario).toBeGreaterThan(0);
  });

  it("la ricerca trova l'azienda per ragione sociale, p. iva e anche per il referente", () => {
    const ferramento = nuovaAzienda("Ferramenta Rossi S.r.l.");
    aggiornaAzienda(ferramento, {
      ragioneSociale: "Ferramenta Rossi S.r.l.",
      partitaIva: "03012345678",
      indirizzo: "",
      citta: "Verona",
      cap: "",
      provincia: "",
      telefono: "",
      email: "",
      note: "",
    });
    nuovoReferente({
      aziendaId: ferramento,
      nome: "Mario",
      cognome: "Rossi",
      telefono: "",
      email: "",
    });
    const altra = nuovaAzienda("Verdi Impianti S.n.c.");
    nuovoReferente({
      aziendaId: altra,
      nome: "Luca",
      cognome: "Verdi",
      telefono: "",
      email: "",
    });

    // Per il nome dell'azienda.
    expect(elencaAziende("Ferramenta").map((a) => a.id)).toEqual([ferramento]);
    // Per la partita iva.
    expect(elencaAziende("03012345678").map((a) => a.id)).toEqual([ferramento]);
    // Per il nome del referente: è spesso l'unica traccia che fa trovare
    // un'azienda, e senza questa ricerca non si trova più.
    expect(elencaAziende("Mario").map((a) => a.id)).toEqual([ferramento]);
    expect(elencaAziende("Verdi").map((a) => a.id)).toEqual([altra]);
    // Una ricerca vuota le restituisce tutte, ordinate per ragione sociale.
    expect(elencaAziende().map((a) => a.ragioneSociale)).toEqual([
      "Ferramenta Rossi S.r.l.",
      "Verdi Impianti S.n.c.",
    ]);
  });

  it("il nome mostrato e le iniziali hanno un ripiego quando la ragione sociale manca", () => {
    const id = creaAzienda({
      ragioneSociale: "",
      partitaIva: "",
      indirizzo: "",
      citta: "",
      cap: "",
      provincia: "",
      telefono: "",
      email: "",
      note: "",
    });
    const azienda = ottieniAzienda(id)!;
    // Una scheda senza ragione sociale deve comunque dire qualcosa: "Senza
    // ragione sociale" è leggibile, una cella vuota no.
    expect(nomeAzienda(azienda)).toBe("Senza ragione sociale");
    expect(inizialiAzienda(azienda)).toBe("?");
    expect(inizialiAzienda({ ragioneSociale: "Ferramenta Rossi S.r.l." })).toBe("FR");
    // Una sola parola: una sola iniziale, non una lettera a caso della
    // seconda parola (che non c'è).
    expect(inizialiAzienda({ ragioneSociale: "Verdi" })).toBe("V");
  });
});
