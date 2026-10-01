/**
 * Le migrazioni del database locale.
 *
 * Il problema che qui si prova è uno solo, ed è serio: lo schema è scritto
 * come `CREATE TABLE IF NOT EXISTS`, che su una tabella già esistente non
 * aggiunge niente. Quindi chi ha il database dalla versione precedente si
 * troverebbe la tabella senza le colonne nuove, e ogni query che le nomina
 * fallirebbe — con un errore che non ha niente a che fare con la modifica.
 *
 * Qui si parte da un database *vecchio*, costruito a mano con la tabella di
 * allora, e si verifica che le colonne arrivino e che rifare la migrazione non
 * rompa niente.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("sql.js/dist/sql-wasm.wasm?url", () => ({
  default: `${process.cwd()}/node_modules/sql.js/dist/sql-wasm.wasm`,
}));

import initSqlJs from "sql.js";
import type { Database } from "sql.js";
import { runMigrations } from "../src/lib/sqlite/migrations";

/** La tabella `appuntamenti` come era prima di `googleErrore`. */
const APPUNTAMENTI_VECCHI = `
  CREATE TABLE appuntamenti (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    anagraficoId INTEGER,
    relazioneId INTEGER,
    titolo TEXT NOT NULL DEFAULT '',
    descrizione TEXT NOT NULL DEFAULT '',
    inizio TEXT NOT NULL,
    fine TEXT NOT NULL,
    luogo TEXT NOT NULL DEFAULT '',
    stato TEXT NOT NULL DEFAULT 'in-attesa',
    promemoriaMin INTEGER NOT NULL DEFAULT 30,
    googleEventId TEXT,
    googleCalendarId TEXT,
    googleHtmlLink TEXT,
    googleSyncAt TEXT,
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL
  );
`;

/** Lo schema di quando le anagrafiche erano persone fisiche. */
const SCHEMA_PERSONE = `
  CREATE TABLE anagrafici (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nome TEXT NOT NULL DEFAULT '',
    cognome TEXT NOT NULL DEFAULT '',
    documento TEXT NOT NULL DEFAULT '',
    dataNascita TEXT,
    sesso TEXT NOT NULL DEFAULT '',
    nazionalita TEXT NOT NULL DEFAULT '',
    indirizzo TEXT NOT NULL DEFAULT '',
    citta TEXT NOT NULL DEFAULT '',
    cap TEXT NOT NULL DEFAULT '',
    provincia TEXT NOT NULL DEFAULT '',
    telefono TEXT NOT NULL DEFAULT '',
    email TEXT NOT NULL DEFAULT '',
    note TEXT NOT NULL DEFAULT '',
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL
  );
  CREATE TABLE relazioni (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    anagraficoId INTEGER NOT NULL REFERENCES anagrafici(id) ON DELETE CASCADE,
    titolo TEXT NOT NULL DEFAULT '',
    tipo TEXT NOT NULL DEFAULT '',
    stato TEXT NOT NULL DEFAULT 'bozza',
    contenuto TEXT NOT NULL DEFAULT '',
    data TEXT NOT NULL,
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL
  );
  ${APPUNTAMENTI_VECCHI.replace("anagraficoId INTEGER,", "anagraficoId INTEGER REFERENCES anagrafici(id) ON DELETE SET NULL,")}
`;

let SQL: Awaited<ReturnType<typeof initSqlJs>>;

beforeAll(async () => {
  SQL = await initSqlJs();
});

async function databaseVecchio(): Promise<Database> {
  const db = new SQL.Database();
  // Solo `appuntamenti` è quella di allora. Le altre si lasciano creare a
  // `runMigrations`, che le fa come devono essere: pre-crearle a mano
  // riprodurrebbe un database che non è mai esistito.
  db.run(APPUNTAMENTI_VECCHI);
  return db;
}

function colonne(db: Database, tabella: string): string[] {
  const righe = db.exec(`PRAGMA table_info(${tabella})`);
  const valori = righe[0]?.values ?? [];
  return valoriInNomi(valori);
}

function valoriInNomi(valori: unknown[]): string[] {
  return valori
    .map((riga) => (Array.isArray(riga) ? riga[1] : undefined))
    .filter((nome): nome is string => typeof nome === "string");
}

/** Quante righe ha una tabella. */
function conta(db: Database, tabella: string): number {
  const righe = db.exec(`SELECT COUNT(*) FROM ${tabella}`);
  return Number(righe[0]?.values[0]?.[0] ?? 0);
}

describe("Passaggio dalle anagrafiche di persona alle aziende", () => {
  it("butta via le persone e crea aziende e referenti", async () => {
    const db = new SQL.Database();
    db.run(SCHEMA_PERSONE);
    db.run(
      `INSERT INTO anagrafici (nome, cognome, documento, createdAt, updatedAt)
       VALUES ('Mario', 'Rossi', 'VR123456A', 'a', 'b')`,
    );
    db.run(
      `INSERT INTO relazioni (anagraficoId, titolo, data, createdAt, updatedAt)
       VALUES (1, 'Certificato', '2026-01-01', 'a', 'b')`,
    );
    db.run(
      `INSERT INTO appuntamenti (anagraficoId, titolo, inizio, fine, createdAt, updatedAt)
       VALUES (1, 'Sportello', 'a', 'b', 'a', 'b')`,
    );

    runMigrations(db);

    // La tabella delle persone non esiste più, e le sue righe con lei.
    expect(colonne(db, "anagrafici")).toEqual([]);
    expect(
      db.exec("SELECT COUNT(*) FROM sqlite_master WHERE name = 'anagrafici'")[0].values[0][0],
    ).toBe(0);
    // Le aziende ci sono, con i campi giusti e **vuote**: nessuna persona
    // è diventata un'azienda.
    expect(colonne(db, "aziende")).toEqual([
      "id",
      "ragioneSociale",
      "partitaIva",
      "indirizzo",
      "citta",
      "cap",
      "provincia",
      "telefono",
      "email",
      "note",
      "createdAt",
      "updatedAt",
    ]);
    expect(conta(db, "aziende")).toBe(0);
    expect(colonne(db, "referenti")).toEqual([
      "id",
      "aziendaId",
      "nome",
      "cognome",
      "telefono",
      "email",
      "createdAt",
      "updatedAt",
    ]);
    // Le relazioni agganciate a una persona che non c'è più non hanno più
    // un soggetto: resterebbero come righe invisibili in ogni elenco.
    expect(conta(db, "relazioni")).toBe(0);
    expect(conta(db, "appuntamenti")).toBe(0);
    // E le chiavi esterne tornano su: dopo un DROP TABLE SQLite le lascia
    // disattivate, e senza cascate eliminare un'azienda lascerebbe
    // referenti e relazioni appesi.
    expect(db.exec("PRAGMA foreign_keys")[0].values[0][0]).toBe(1);
  });

  it("non rifà il passaggio al secondo avvio, e non butta le aziende create", async () => {
    const db = new SQL.Database();
    db.run(SCHEMA_PERSONE);
    runMigrations(db);

    const adesso = new Date().toISOString();
    db.run(
      `INSERT INTO aziende (ragioneSociale, partitaIva, createdAt, updatedAt)
       VALUES ('Ferramenta Rossi S.r.l.', '03012345678', ?, ?)`,
      [adesso, adesso],
    );
    const idAzienda = db.exec("SELECT id FROM aziende")[0].values[0][0];
    db.run(
      `INSERT INTO referenti (aziendaId, nome, cognome, createdAt, updatedAt)
       VALUES (?, 'Mario', 'Rossi', ?, ?)`,
      [idAzienda, adesso, adesso],
    );

    // Ogni avvio dell'app ripercorre le migrazioni: se il passaggio si
    // rifacesse, qui sparirebbe tutto quello che l'utente ha appena creato.
    runMigrations(db);
    runMigrations(db);

    expect(conta(db, "aziende")).toBe(1);
    expect(conta(db, "referenti")).toBe(1);
  });

  it("un appuntamento senza anagrafica resta: non c'entra con il passaggio", async () => {
    const db = new SQL.Database();
    // Il database più vecchio di tutti: `appuntamenti` senza neanche
    // googleErrore. Il passaggio non può nominare una colonna che a quel
    // database non esiste, o l'app non aprirebbe più.
    db.run(SCHEMA_PERSONE);
    db.run(
      `INSERT INTO appuntamenti (anagraficoId, titolo, inizio, fine, createdAt, updatedAt)
       VALUES (NULL, 'Sportello', 'a', 'b', 'a', 'b')`,
    );
    expect(colonne(db, "appuntamenti")).not.toContain("googleErrore");

    runMigrations(db);

    // Non aveva una persona e non ne ha una azienda: è un appuntamento
    // preso allo sportello, e perderlo sarebbe una perdita senza motivo.
    expect(conta(db, "appuntamenti")).toBe(1);
    expect(db.exec("SELECT titolo FROM appuntamenti")[0].values[0][0]).toBe("Sportello");
    expect(colonne(db, "appuntamenti")).toContain("aziendaId");
    expect(colonne(db, "appuntamenti")).toContain("googleErrore");
    // E la tabella di passaggio non resta li a fare rumore.
    expect(
      db.exec("SELECT COUNT(*) FROM sqlite_master WHERE name = 'appuntamenti_da_recuperare'")[0]
        .values[0][0],
    ).toBe(0);
  });
});

describe("Migrazioni del database locale", () => {
  it("aggiunge a un database vecchio la colonna che gli manca", async () => {
    const db = await databaseVecchio();
    expect(colonne(db, "appuntamenti")).not.toContain("googleErrore");

    runMigrations(db);

    expect(colonne(db, "appuntamenti")).toContain("googleErrore");
    // E la colonna è utilizzabile, non solo presente: è quello che serve per
    // scriverci dentro il motivo di una pubblicazione fallita.
    db.run(
      "INSERT INTO appuntamenti (titolo, inizio, fine, createdAt, updatedAt) VALUES ('t', 'a', 'b', 'c', 'd')",
    );
    db.run("UPDATE appuntamenti SET googleErrore = 'perché no'");
    const letta = db.exec("SELECT googleErrore FROM appuntamenti");
    expect(letta[0]?.values[0]?.[0]).toBe("perché no");
  });

  it("rifare le migrazioni non è un errore", async () => {
    const db = await databaseVecchio();
    runMigrations(db);
    // Il secondo giro è quello che capita a ogni avvio dell'app: se la
    // migrazione ric controllasse male le colonne, qui esploderebbe con
    // "duplicate column name" e l'app non aprirebbe più.
    expect(() => runMigrations(db)).not.toThrow();
    expect(() => runMigrations(db)).not.toThrow();
    expect(colonne(db, "appuntamenti").filter((c) => c === "googleErrore")).toHaveLength(1);
  });

  it("su un database già nuovo non cambia niente", async () => {
    const db = new SQL.Database();
    runMigrations(db);
    const prima = colonne(db, "appuntamenti");
    runMigrations(db);
    expect(colonne(db, "appuntamenti")).toEqual(prima);
    expect(prima).toContain("googleErrore");
  });

  it("la tabella preferenze nasce anche su un database che non ce l'aveva", async () => {
    const db = await databaseVecchio();
    expect(colonne(db, "preferenze")).toEqual([]);

    runMigrations(db);

    // C'è, ed è utilizzabile: qui finiscono le preferenze dell'utente — i
    // colori degli eventi — che devono seguire l'utenza su un altro
    // dispositivo, e quindi devono stare nel database che sale nel cloud.
    expect(colonne(db, "preferenze")).toEqual(["chiave", "valore", "updatedAt"]);
    db.run("INSERT INTO preferenze (chiave, valore, updatedAt) VALUES ('colori-stato', '{}', 'c')");
    db.run(
      "INSERT INTO preferenze (chiave, valore, updatedAt) VALUES ('colori-stato', '{\"confermato\":\"9\"}', 'd') ON CONFLICT(chiave) DO UPDATE SET valore = excluded.valore",
    );
    const letta = db.exec("SELECT valore FROM preferenze WHERE chiave = 'colori-stato'");
    expect(JSON.parse(String(letta[0]?.values[0]?.[0]))).toEqual({ confermato: "9" });

    // E rifare le migrazioni non deve far perdere la riga scritta.
    expect(() => runMigrations(db)).not.toThrow();
    expect(db.exec("SELECT COUNT(*) FROM preferenze")[0].values[0][0]).toBe(1);
  });
});
