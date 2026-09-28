import type { Database } from "sql.js";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS anagrafici (
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

CREATE TABLE IF NOT EXISTS relazioni (
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

CREATE TABLE IF NOT EXISTS appuntamenti (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  anagraficoId INTEGER REFERENCES anagrafici(id) ON DELETE SET NULL,
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
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_relazioni_anagrafico ON relazioni(anagraficoId);
CREATE INDEX IF NOT EXISTS idx_appuntamenti_anagrafico ON appuntamenti(anagraficoId);
CREATE INDEX IF NOT EXISTS idx_appuntamenti_inizio ON appuntamenti(inizio);
CREATE UNIQUE INDEX IF NOT EXISTS idx_appuntamenti_google ON appuntamenti(googleEventId) WHERE googleEventId IS NOT NULL;
`;

/**
 * SQLite mantiene le chiavi esterne disattivate di default: senza questo
 * PRAGMA le ON DELETE CASCADE / SET NULL non verrebbero mai applicate.
 */
export function runMigrations(db: Database): void {
  db.run("PRAGMA foreign_keys = ON");
  db.run(SCHEMA);
}
