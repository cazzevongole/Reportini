/**
 * Le migrazioni del database locale.
 *
 * Qui si costruisce a mano un database **come era** e si verifica che
 * `runMigrations` lo porti allo schema di adesso. Il motivo per cui esiste
 * un test dedicato è che `CREATE TABLE IF NOT EXISTS` non aggiunge niente a
 * una tabella che c'è già: chi ha il database dalla versione precedente si
 * troverebbe una tabella senza le colonne nuove, e ogni query che le nomina
 * fallirebbe — cioè l'app non aprirebbe più.
 *
 * I nomi delle tabelle qui sono quelli **vecchi** di proposito. Le migrazioni
 * si provano contro lo schema di allora, non contro quello di adesso: se il
 * test costruisse il database con i nomi nuovi, proverebbe che il codice
 * gira su un database che lui stesso ha appena creato, che è useless.
 */

vi.mock("sql.js/dist/sql-wasm.wasm?url", () => ({
  default: `${process.cwd()}/node_modules/sql.js/dist/sql-wasm.wasm`,
}));

import initSqlJs from "sql.js";
import type { Database } from "sql.js";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { runMigrations } from "../src/lib/sqlite/migrations";

/** La tabella `appuntamenti` come era prima di `googleErrore` e `aziendaId`. */
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

/** Lo schema di quando le anagrafiche erano persone fisiche (versione 1). */
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
  ${APPUNTAMENTI_VECCHI.replace(
    "anagraficoId INTEGER,",
    "anagraficoId INTEGER REFERENCES anagrafici(id) ON DELETE SET NULL,",
  )}
`;

/** Lo schema 2: aziende e referenti, con relazioni e appuntamenti. */
const SCHEMA_AZIENDE_VECCHIE = `
  CREATE TABLE aziende (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ragioneSociale TEXT NOT NULL DEFAULT '',
    partitaIva TEXT NOT NULL DEFAULT '',
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
  CREATE TABLE referenti (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    aziendaId INTEGER NOT NULL REFERENCES aziende(id) ON DELETE CASCADE,
    nome TEXT NOT NULL DEFAULT '',
    cognome TEXT NOT NULL DEFAULT '',
    telefono TEXT NOT NULL DEFAULT '',
    email TEXT NOT NULL DEFAULT '',
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL
  );
  CREATE TABLE relazioni (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    aziendaId INTEGER NOT NULL REFERENCES aziende(id) ON DELETE CASCADE,
    titolo TEXT NOT NULL DEFAULT '',
    tipo TEXT NOT NULL DEFAULT '',
    stato TEXT NOT NULL DEFAULT 'bozza',
    contenuto TEXT NOT NULL DEFAULT '',
    data TEXT NOT NULL,
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL
  );
  CREATE TABLE appuntamenti (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    aziendaId INTEGER REFERENCES aziende(id) ON DELETE SET NULL,
    relazioneId INTEGER REFERENCES relazioni(id) ON DELETE SET NULL,
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
    googleErrore TEXT,
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL
  );
`;

let SQL: Awaited<ReturnType<typeof initSqlJs>>;

beforeAll(async () => {
  SQL = await initSqlJs();
});

/** Un database con lo schema di allora, vuoto. */
async function databaseCon(schema: string): Promise<Database> {
  const db = new SQL.Database();
  db.run(schema);
  return db;
}

/**
 * La seconda colonna di ogni riga di un PRAGMA: il nome.
 *
 * `PRAGMA table_info` restituisce una riga per colonna e il nome è il
 * secondo elemento, non il primo — leggerlo come primo faceva credere che la
 * tabella non avesse colonne.
 */
function valoriInNomi(valori: unknown[][]): string[] {
  return valori
    .map((riga) => (Array.isArray(riga) ? riga[1] : undefined))
    .filter((nome): nome is string => typeof nome === "string");
}

function colonne(db: Database, tabella: string): string[] {
  const righe = db.exec(`PRAGMA table_info(${tabella})`);
  return valoriInNomi(righe[0]?.values ?? []);
}

/**
 * La prima colonna di ogni riga: il nome.
 *
 * È un aiutante diverso da `valoriInNomi` perché quello legge un PRAGMA,
 * dove il nome è il secondo elemento; qui la query è `SELECT name` e il
 * nome è il primo. Confonderli dava liste vuote senza alcun errore.
 */
function valoriInPrimaColonna(valori: unknown[][]): string[] {
  return valori
    .map((riga) => (Array.isArray(riga) ? riga[0] : undefined))
    .filter((nome): nome is string => typeof nome === "string");
}

function tabelle(db: Database): string[] {
  const righe = db.exec("SELECT name FROM sqlite_master WHERE type = 'table'");
  return valoriInPrimaColonna(righe[0]?.values ?? []);
}

function versione(db: Database): number {
  const righe = db.exec("PRAGMA user_version");
  const valore = righe[0]?.values[0]?.[0];
  return typeof valore === "number" ? valore : 0;
}

describe("Passaggio dalle anagrafiche di persona alle aziende", () => {
  it("butta via le persone e crea aziende, referenti, attivita e report", async () => {
    const db = await databaseCon(SCHEMA_PERSONE);
    const ora = new Date().toISOString();
    db.run(
      `INSERT INTO anagrafici (nome, cognome, createdAt, updatedAt)
       VALUES ('Mario', 'Rossi', :ora, :ora)`,
      { ":ora": ora },
    );

    runMigrations(db);

    // Le persone non sono aziende: resterebbero numeri senza significato.
    expect(tabelle(db)).not.toContain("anagrafici");
    expect(tabelle(db)).toEqual(
      expect.arrayContaining(["aziende", "referenti", "attivita", "report"]),
    );
    // Le aziende sono vuote: non c'è modo di sapere quale persona fosse
    // quale azienda, e indovinare sarebbe peggio che chiedere.
    expect(db.exec("SELECT COUNT(*) FROM aziende")[0].values[0][0]).toBe(0);
    // Chiavi esterne tornate attive dopo il passaggio: senza, le cascate
    // delle tabelle nuove non funzionerebbero.
    expect(db.exec("PRAGMA foreign_keys")[0].values[0][0]).toBe(1);
  });

  it("non rifà il passaggio al secondo avvio, e non butta le aziende create", async () => {
    const db = await databaseCon(SCHEMA_PERSONE);
    runMigrations(db);
    const ora = new Date().toISOString();
    db.run(
      `INSERT INTO aziende (ragioneSociale, createdAt, updatedAt)
       VALUES ('Ferramenta Rossi S.r.l.', :ora, :ora)`,
      { ":ora": ora },
    );

    runMigrations(db);

    // È il caso che rende necessario il numero di versione: rifare il
    // passaggio azzererebbe quello che l'utente ha creato dopo.
    expect(db.exec("SELECT COUNT(*) FROM aziende")[0].values[0][0]).toBe(1);
  });

  it("azzera anche gli appuntamenti salvati, che nel modello nuovo non hanno casa", async () => {
    const db = await databaseCon(SCHEMA_PERSONE);
    const ora = new Date().toISOString();
    db.run(`INSERT INTO anagrafici (nome, createdAt, updatedAt) VALUES ('Mario', :ora, :ora)`, {
      ":ora": ora,
    });
    db.run(
      `INSERT INTO appuntamenti (anagraficoId, titolo, inizio, fine, createdAt, updatedAt)
       VALUES (1, 'Sportello', :ora, :ora, :ora, :ora)`,
      { ":ora": ora },
    );

    runMigrations(db);

    // Nell'attività nuova l'azienda è obbligatoria: un appuntamento legato a
    // una persona che non è un'azienda non potrebbe generare un report.
    expect(db.exec("SELECT COUNT(*) FROM attivita")[0].values[0][0]).toBe(0);
  });
});

describe("Passaggio da relazioni e appuntamenti a report e attività", () => {
  it("butta via le due tabelle vecchie e crea le due nuove", async () => {
    const db = await databaseCon(SCHEMA_AZIENDE_VECCHIE);
    // Il database si dichiara già alla versione 2: è il caso reale di chi ha
    // fatto il passaggio alle aziende e poi aggiorna l'app.
    db.run("PRAGMA user_version = 2");
    const ora = new Date().toISOString();
    db.run(
      `INSERT INTO aziende (ragioneSociale, createdAt, updatedAt) VALUES ('Rossi', :ora, :ora)`,
      { ":ora": ora },
    );
    db.run(
      `INSERT INTO appuntamenti (aziendaId, titolo, inizio, fine, createdAt, updatedAt)
       VALUES (1, 'Sportello', :ora, :ora, :ora, :ora)`,
      { ":ora": ora },
    );

    runMigrations(db);

    expect(tabelle(db)).not.toContain("relazioni");
    expect(tabelle(db)).not.toContain("appuntamenti");
    expect(tabelle(db)).toEqual(expect.arrayContaining(["attivita", "report"]));
    // Le attività e i report ricominciano vuoti: la migrazione è una
    // cancellazione, e l'utente reinserisce le aziende che sono rimaste.
    expect(db.exec("SELECT COUNT(*) FROM attivita")[0].values[0][0]).toBe(0);
    expect(db.exec("SELECT COUNT(*) FROM report")[0].values[0][0]).toBe(0);
    // Le aziende invece restano: sono la parte che nel modello non è cambiata.
    expect(db.exec("SELECT COUNT(*) FROM aziende")[0].values[0][0]).toBe(1);
    expect(versione(db)).toBe(3);
  });

  it("il report non ha né stato né tipo né data: vengono dall'attività", async () => {
    const db = new SQL.Database();
    runMigrations(db);

    // Sono le colonne che un report non deve avere: lo stato era una macchina
    // di stati senza uso, il tipo e la data sono quelli dell'attività, e
    // copiarli qui sarebbe una seconda fonte che può dire una cosa diversa.
    expect(colonne(db, "report")).not.toContain("stato");
    expect(colonne(db, "report")).not.toContain("tipo");
    expect(colonne(db, "report")).not.toContain("data");
    expect(colonne(db, "report")).toEqual(
      expect.arrayContaining(["aziendaId", "attivitaId", "titolo", "descrizione"]),
    );
  });

  it("l'attività ha il tipo e la casella di completamento", async () => {
    const db = new SQL.Database();
    runMigrations(db);

    expect(colonne(db, "attivita")).toEqual(
      expect.arrayContaining(["aziendaId", "tipo", "completata", "stato", "inizio", "fine"]),
    );
    // `completata` è un intero nella tabella e un sí/no in TypeScript: la
    // colonna su cui poggia la generazione del report.
    const tipo = db.exec("SELECT typeof(completata) FROM attivita LIMIT 1");
    expect(tipo).toHaveLength(0); // nessuna riga: il tipo si vede sullo schema
  });

  it("non rifà il passaggio al secondo avvio", async () => {
    const db = await databaseCon(SCHEMA_AZIENDE_VECCHIE);
    db.run("PRAGMA user_version = 2");
    runMigrations(db);
    const ora = new Date().toISOString();
    // L'azienda resta dal passaggio precedente, e serve perché l'attività
    // ha il vincolo di chiave esterna: senza di lei l'inserimento fallirebbe
    // e il test misurerebbe la chiave esterna, non la versione.
    db.run(
      `INSERT INTO aziende (ragioneSociale, createdAt, updatedAt) VALUES ('Rossi', :ora, :ora)`,
      { ":ora": ora },
    );
    db.run(
      `INSERT INTO attivita (aziendaId, titolo, tipo, inizio, fine, createdAt, updatedAt)
       VALUES (1, 'Chiamata', 'chiamata', :ora, :ora, :ora, :ora)`,
      { ":ora": ora },
    );

    runMigrations(db);

    // Senza il numero di versione, rifare il passaggio azzererebbe
    // l'attività appena creata.
    expect(db.exec("SELECT COUNT(*) FROM attivita")[0].values[0][0]).toBe(1);
  });
});

describe("Migrazioni del database locale", () => {
  it("aggiunge a un database vecchio le colonne che gli mancano", async () => {
    // Un database con la tabella appuntamenti di allora e niente aziende:
    // il caso di chi ha aperto l'app prima del passaggio alle aziende.
    const db = await databaseCon(APPUNTAMENTI_VECCHI);

    runMigrations(db);

    // La tabella nuova nasce intera dallo schema, quindi non è la stessa
    // tabella ad aggiungersi colonne: qui si verifica che il giro non
    // fallisce e che le tabelle nuove ci sono.
    expect(colonne(db, "attivita")).toContain("googleErrore");
    expect(colonne(db, "attivita")).toContain("completata");
  });

  it("rifare le migrazioni non è un errore", async () => {
    const db = await databaseCon(APPUNTAMENTI_VECCHI);
    runMigrations(db);
    expect(() => runMigrations(db)).not.toThrow();
    expect(() => runMigrations(db)).not.toThrow();
  });

  it("su un database già nuovo non cambia niente", async () => {
    const db = new SQL.Database();
    runMigrations(db);
    const prima = tabelle(db).sort();

    runMigrations(db);

    expect(tabelle(db).sort()).toEqual(prima);
  });

  it("la tabella preferenze nasce anche su un database che non ce l'aveva", async () => {
    const db = new SQL.Database();
    runMigrations(db);
    expect(tabelle(db)).toContain("preferenze");
  });

  it("gli indici sono creati dopo le colonne, o il giro si ferma", async () => {
    const db = await databaseCon(APPUNTAMENTI_VECCHI);
    // Se gli indici fossero dentro lo schema, il primo `CREATE INDEX` su una
    // colonna che non esiste ancora farebbe fallire l'intero giro e l'app
    // non aprirebbe.
    expect(() => runMigrations(db)).not.toThrow();
    const indici = db.exec("SELECT name FROM sqlite_master WHERE type = 'index'");
    const nomi = valoriInPrimaColonna(indici[0]?.values ?? []);
    expect(nomi).toEqual(expect.arrayContaining(["idx_attivita_azienda", "idx_report_azienda"]));
  });
});
