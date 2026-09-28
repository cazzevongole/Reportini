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
  googleErrore TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_relazioni_anagrafico ON relazioni(anagraficoId);
CREATE INDEX IF NOT EXISTS idx_appuntamenti_anagrafico ON appuntamenti(anagraficoId);
CREATE INDEX IF NOT EXISTS idx_appuntamenti_inizio ON appuntamenti(inizio);
CREATE UNIQUE INDEX IF NOT EXISTS idx_appuntamenti_google ON appuntamenti(googleEventId) WHERE googleEventId IS NOT NULL;

-- Le preferenze dell'utente stanno qui e non in \`localStorage\`: il database è
-- quello che sale nel cloud e che si ripristina su un altro dispositivo, e un
-- colore scelto qui è una scelta dell'utenza, non della macchina. La tabella
-- nasce con \`IF NOT EXISTS\`, quindi su un database che c'era già viene creata
-- al primo avvio senza bisogno di una migrazione.
--
-- Coppia chiave/valore invece di una colonna per impostazione: aggiungerne una
-- nuova deve poter avvenire senza toccare lo schema, e ogni valore è validato
-- da chi lo scrive, perché qui dentro può arrivare solo quello che l'app ha
-- scritto — non c'è \`localStorage\` da modificare a mano.
CREATE TABLE IF NOT EXISTS preferenze (
  chiave TEXT PRIMARY KEY NOT NULL,
  valore TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);
`;

/**
 * Colonne nate dopo la prima versione, e come aggiungerle ai database già
 * esistenti.
 *
 * `CREATE TABLE IF NOT EXISTS` non aggiunge niente a una tabella che c'è già:
 * chi ha il database dalla versione precedente si troverebbe una tabella senza
 * la nuova colonna, e ogni query che la nomina fallirebbe. Per questo qui si
 * guarda prima `PRAGMA table_info` e si aggiunge solo quello che manca, che è
 * anche l'unico modo che SQLite permette: non si può togliere una colonna.
 */
const COLONNE_AGGIUNTE: { tabella: string; colonna: string; tipo: string }[] = [
  { tabella: "appuntamenti", colonna: "googleErrore", tipo: "TEXT" },
];

function colonneDi(db: Database, tabella: string): string[] {
  // `exec` su un PRAGMA restituisce tutte le righe in `values`, ognuna un
  // array: `name` è il secondo elemento di ciascuna, non il primo. Leggere
  // `values` come se fosse una riga sola faceva pensare che la colonna non
  // ci fosse, e l'ALTER TABLE veniva eseguito ogni volta: "duplicate column".
  const righe = db.exec(`PRAGMA table_info(${tabella})`);
  const valori = righe[0]?.values ?? [];
  return valori
    .map((riga) => (Array.isArray(riga) ? riga[1] : undefined))
    .filter((nome): nome is string => typeof nome === "string");
}

function aggiungiColonneMancanti(db: Database): void {
  for (const { tabella, colonna, tipo } of COLONNE_AGGIUNTE) {
    if (colonneDi(db, tabella).includes(colonna)) continue;
    db.run(`ALTER TABLE ${tabella} ADD COLUMN ${colonna} ${tipo}`);
  }
}

/**
 * SQLite mantiene le chiavi esterne disattivate di default: senza questo
 * PRAGMA le ON DELETE CASCADE / SET NULL non verrebbero mai applicate.
 */
export function runMigrations(db: Database): void {
  db.run(PRAGMA_CHIAVI_ESTERNE);
  db.run(SCHEMA);
  aggiungiColonneMancanti(db);
}

/**
 * sql.js chiude e riapre il database a ogni export: le impostazioni di
 * sessione tornano al valore di default, e `foreign_keys` è una di
 * queste. Va rimessa dopo ogni esportazione, altrimenti le ON DELETE
 * CASCADE e SET NULL smettono di funzionare e restano righe appese a
 * riferimenti che non esistono più.
 */
export const PRAGMA_CHIAVI_ESTERNE = "PRAGMA foreign_keys = ON";
