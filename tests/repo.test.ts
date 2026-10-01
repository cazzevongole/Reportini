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
  eliminaAzienda,
  eliminaReport,
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

/** Il report non ha tipo, stato né data: vengono dall'attività che lo genera. */
function creaReport(aziendaId: number, attivitaId: number, titolo = "Certificato"): number {
  return insert("report", {
    aziendaId,
    attivitaId,
    titolo,
    descrizione: "Testo",
    createdAt: ora(),
    updatedAt: ora(),
  });
}

function creaAttivita(azienda: number, titolo: string, tipo = "appuntamento"): number {
  return insert("attivita", {
    aziendaId: azienda,
    titolo,
    descrizione: "",
    inizio: ora(),
    fine: ora(),
    luogo: "",
    tipo,
    stato: "in-attesa",
    completata: 0,
    promemoriaMin: 60,
    googleEventId: null,
    googleCalendarId: null,
    googleHtmlLink: null,
    googleSyncAt: null,
    createdAt: ora(),
    updatedAt: ora(),
  });
}

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
  all("DELETE FROM attivita");
  all("DELETE FROM report");
  all("DELETE FROM referenti");
  all("DELETE FROM aziende");
});

describe("Eliminazione di un'azienda", () => {
  it("porta via referenti, report e attivita che si riferivano a lei", () => {
    const azienda = nuovaAzienda("Ferramenta Rossi");
    const altra = nuovaAzienda("Verdi S.r.l.");
    const referente = creaReferente(azienda, "Mario");
    creaReferente(altra, "Giulia");
    const attivita = creaAttivita(azienda, "Consegna");
    creaReport(azienda, attivita);
    // Attivita di un'altra azienda: non c'entra e deve restare.
    const diAltra = creaAttivita(altra, "Sportello");

    const effetto = effettoEliminazioneAzienda(azienda);
    expect(effetto.referenti).toBe(1);
    expect(effetto.report).toBe(1);
    expect(effetto.attivita).toBe(1);

    eliminaAzienda(azienda);

    // Il referente è nato con la tabella referenti, quindi sparisce in
    // cascata: senza quel controllo resterebbe un id che non punta a nulla.
    expect(all("SELECT id FROM referenti WHERE id = ?", [referente])).toHaveLength(0);
    expect(all("SELECT id FROM referenti WHERE aziendaId = ?", [altra])).toHaveLength(1);
    expect(all("SELECT id FROM attivita WHERE id = ?", [attivita])).toHaveLength(0);
    expect(all("SELECT id FROM attivita WHERE id = ?", [diAltra])).toHaveLength(1);
    // Nessuna attività senza azienda: è il caso che nessuno potrebbe aprire,
    // perché il contesto è ciò che rende leggibile il report.
    expect(all("SELECT id FROM attivita WHERE aziendaId IS NULL")).toHaveLength(0);
    // E nessun report rimasto appeso: sparisce con la sua attività.
    expect(all("SELECT id FROM report WHERE aziendaId = ?", [azienda])).toHaveLength(0);
  });
});

describe("Il report e la sua attività", () => {
  it("eliminare il report lascia l'attività, che è la sua causa", () => {
    const azienda = nuovaAzienda("Ferramenta Rossi");
    const attivita = creaAttivita(azienda, "Sportello");
    const report = creaReport(azienda, attivita);

    eliminaReport(report);

    expect(all("SELECT id FROM report WHERE id = ?", [report])).toHaveLength(0);
    // L'attività resta: è lei che si segna come completata e da lei si può
    // generare un report nuovo. Il rapporto è uno a uno ma non è proprietà:
    // è la cascata nel verso opposto.
    expect(all("SELECT id FROM attivita WHERE id = ?", [attivita])).toHaveLength(1);
  });

  it("eliminando l'attività sparisce anche il report che l'ha generato", () => {
    const azienda = nuovaAzienda("Ferramenta Rossi");
    const altra = nuovaAzienda("Verdi S.r.l.");
    const attivita = creaAttivita(azienda, "Sportello");
    const report = creaReport(azienda, attivita);
    const intatta = creaAttivita(altra, "Sportello");
    const suoReport = creaReport(altra, intatta);

    all("DELETE FROM attivita WHERE id = ?", [attivita]);

    // Il report è la descrizione di quell'attività: senza di lei non ha più
    // né tipo né data, e restare sarebbe una riga che nessuno può aprire.
    expect(all("SELECT id FROM report WHERE id = ?", [report])).toHaveLength(0);
    // Quello dell'altra attività non c'entra e resta.
    expect(all("SELECT id FROM report WHERE id = ?", [suoReport])).toHaveLength(1);
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
