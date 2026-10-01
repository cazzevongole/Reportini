import type { Database } from "sql.js";

/**
 * Il numero di versione dello schema, in `PRAGMA user_version`.
 *
 * Serve a una cosa sola: sapere se il passaggio dalle anagrafiche di persona
 * alle aziende è già avvenuto. È una migrazione che **cancella** i dati, e
 * rifarla a ogni avvio azzererebbe tutto quello che l'utente ha creato dopo
 * — quindi va fatta una volta sola, e il numero è l'unico posto dove dire
 * che è stata fatta.
 */
const VERSIONE_SCHEMA = 2;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS aziende (
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

-- I referenti sono le persone con cui si parla dell'azienda: non sono il
-- soggetto delle relazioni né degli appuntamenti (quelli restano all'azienda),
-- ma senza di loro non c'è nessuno a cui scrivere.
CREATE TABLE IF NOT EXISTS referenti (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  aziendaId INTEGER NOT NULL REFERENCES aziende(id) ON DELETE CASCADE,
  nome TEXT NOT NULL DEFAULT '',
  cognome TEXT NOT NULL DEFAULT '',
  telefono TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS relazioni (
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

CREATE TABLE IF NOT EXISTS appuntamenti (
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
 * Gli indici stanno **dopo** \`SCHEMA\` e non dentro.
 *
 * Un \`CREATE INDEX\` su una colonna che non esiste ancora fallisce, e su un
 * database vecchio le colonne nuove arrivano con gli \`ALTER TABLE\` di sotto.
 * Con gli indici dentro lo schema, il giro che apre un database vecchio —
 * quello che crea le tabelle mancanti e aggiunge le colonne — si fermerebbe
 * sul primo indice, e l'app non aprirebbe più.
 */
const INDICI = `
CREATE INDEX IF NOT EXISTS idx_referenti_azienda ON referenti(aziendaId);
CREATE INDEX IF NOT EXISTS idx_relazioni_azienda ON relazioni(aziendaId);
CREATE INDEX IF NOT EXISTS idx_appuntamenti_azienda ON appuntamenti(aziendaId);
CREATE INDEX IF NOT EXISTS idx_appuntamenti_inizio ON appuntamenti(inizio);
CREATE UNIQUE INDEX IF NOT EXISTS idx_appuntamenti_google ON appuntamenti(googleEventId) WHERE googleEventId IS NOT NULL;
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
  // `aziendaId` è nella stessa lista per un caso particolare: un database
  // senza la tabella `anagrafici` non viene azzerato (non è mai esistito,
  // o è già stato azzerato), ma le sue tabelle possono essere vecchie. senza
  // questa riga, un appuntamento salvato li avrebbe e ogni query che nomina
  // l'azienda su quella tabella fallirebbe.
  { tabella: "appuntamenti", colonna: "aziendaId", tipo: "INTEGER" },
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

function tabellaEsiste(db: Database, tabella: string): boolean {
  const righe = db.exec(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`, [
    tabella,
  ]);
  return (righe[0]?.values.length ?? 0) > 0;
}

function versioneSchema(db: Database): number {
  const righe = db.exec("PRAGMA user_version");
  const valore = righe[0]?.values[0]?.[0];
  return typeof valore === "number" ? valore : 0;
}

/**
 * Il passaggio da persone fisiche ad aziende.
 *
 * Una volta sola, e con una cancellazione: le anagrafiche di persona non sono
 * aziende, quindi non c'è niente da convertire — resterebbero numeri senza
 * significato (codice fiscale in un campo "ragione sociale") e relazioni e
 * appuntamenti agganciati a una persona che non esiste più non avrebbero un
 * soggetto. Per questo le tabelle vengono buttate e ricreate: `ALTER TABLE`
 * può solo aggiungere colonne, e qui il nome delle colonne è cambiato.
 *
 * Gli appuntamenti **senza** anagrafica e senza relazione si salvano: sono
 * quelli presi allo sportello senza soggetto, non hanno niente a che fare con
 * il passaggio e perderli sarebbe una perdita gratuita. Vengono messi da
 * parte in una tabella temporanea e rimessi dentro da `recuperaSenzaSoggetto`,
 * che gira dopo che le tabelle nuove esistono.
 *
 * Le chiavi esterne sono disattivate durante il passaggio: senza, il
 * `DROP TABLE` delle relazioni metterebbe `NULL` negli appuntamenti già
 * salvati e lascerebbe in giro indici e riferimenti a metà.
 */
function passaAdAziende(db: Database): void {
  if (versioneSchema(db) >= VERSIONE_SCHEMA) return;
  if (!tabellaEsiste(db, "anagrafici")) return; // un database nato già con questo schema
  db.run("PRAGMA foreign_keys = OFF");
  // `SELECT *` e non un elenco di colonne: la tabella degli appuntamenti è
  // quella che nel tempo ha avuto le colonne aggiunte una alla volta
  // (googleErrore, per esempio), e qui una colonna in elenco che a quel
  // database non esiste farebbe fallire l'intero passaggio — cioè
  // l'app non aprirebbe più.
  db.run(`CREATE TABLE appuntamenti_da_recuperare AS
            SELECT * FROM appuntamenti
            WHERE anagraficoId IS NULL AND relazioneId IS NULL`);
  db.run("DROP TABLE relazioni");
  db.run("DROP TABLE appuntamenti");
  db.run("DROP TABLE anagrafici");
}

/**
 * Le colonne che le due tabelle hanno davvero in comune.
 *
 * Serve per lo stesso motivo di `SELECT *`: la tabella di passaggio ha lo
 * schema del database di allora, quello nuovo ha una colonna in più, e
 * nominare quella colonna in una tabella che non la ha è un errore.
 * `id` si esclude: la ricreazione riparte da 1 e non c'è nessun
 * riferimento a quegli appuntamenti da conservare.
 */
function colonneComuni(db: Database, una: string, altra: string): string[] {
  const colonne = new Set(colonneDi(db, altra));
  return colonneDi(db, una).filter((nome) => nome !== "id" && colonne.has(nome));
}

/** Rimette gli appuntamenti senza soggetto e butta via la tabella di passaggio. */
function recuperaSenzaSoggetto(db: Database): void {
  if (!tabellaEsiste(db, "appuntamenti_da_recuperare")) return;
  const colonne = colonneComuni(db, "appuntamenti_da_recuperare", "appuntamenti");
  // Le due colonne dei riferimenti sono escluse per costruzione (la riga
  // salvata non ne aveva), ma restano nell'elenco: senza, l'appuntamento
  // rientrerebbe con una colonna NOT NULL mancante.
  const elenco = colonne.filter((nome) => nome !== "aziendaId" && nome !== "relazioneId");
  if (elenco.length > 0) {
    db.run(
      `INSERT INTO appuntamenti (${elenco.join(", ")})
       SELECT ${elenco.join(", ")} FROM appuntamenti_da_recuperare`,
    );
  }
  db.run("DROP TABLE appuntamenti_da_recuperare");
}

/**
 * SQLite mantiene le chiavi esterne disattivate di default: senza questo
 * PRAGMA le ON DELETE CASCADE / SET NULL non verrebbero mai applicate.
 */
export function runMigrations(db: Database): void {
  db.run(PRAGMA_CHIAVI_ESTERNE);
  passaAdAziende(db);
  db.run(SCHEMA);
  recuperaSenzaSoggetto(db);
  aggiungiColonneMancanti(db);
  // Solo adesso le colonne esistono tutte: gli indici le cercano per nome.
  db.run(INDICI);
  // La versione si scrive **dopo** lo schema: così un'interruzione a metà non
  // lascia il database dichiarato "già passato" quando le tabelle non ci sono
  // ancora, che alla riapertura lo farebbe ripartire da capo.
  db.run(`PRAGMA user_version = ${VERSIONE_SCHEMA}`);
  db.run(PRAGMA_CHIAVI_ESTERNE);
}

/**
 * sql.js chiude e riapre il database a ogni export: le impostazioni di
 * sessione tornano al valore di default, e `foreign_keys` è una di
 * queste. Va rimessa dopo ogni esportazione, altrimenti le ON DELETE
 * CASCADE e SET NULL smettono di funzionare e restano righe appese a
 * riferimenti che non esistono più.
 */
export const PRAGMA_CHIAVI_ESTERNE = "PRAGMA foreign_keys = ON";
