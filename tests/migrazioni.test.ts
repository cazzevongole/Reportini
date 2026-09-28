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

describe("Migrazioni del database locale", () => {
  it("aggiunge a un database vecchio la colonna che gli manca", async () => {
    const db = await databaseVecchio();
    expect(colonne(db, "appuntamenti")).not.toContain("googleErrore");

    runMigrations(db);

    expect(colonne(db, "appuntamenti")).toContain("googleErrore");
    // E la colonna è utilizzabile, non solo presente: è quello che serve per
    // scriverci dentro il motivo di una pubblicazione fallita.
    db.run("INSERT INTO appuntamenti (titolo, inizio, fine, createdAt, updatedAt) VALUES ('t', 'a', 'b', 'c', 'd')");
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
});
