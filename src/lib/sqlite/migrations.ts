import type { Database } from "sql.js";

/**
 * Il numero di versione dello schema, in `PRAGMA user_version`.
 *
 * Serve a una cosa sola: sapere quali passaggi **cancellano** dati sono già
 * avvenuti. Sono cancellazioni vere, e rifarle a ogni avvio azzererebbe tutto
 * quello che l'utente ha creato dopo — quindi vanno fatte una volta sola, e il
 * numero è l'unico posto dove dire che sono state fatte.
 *
 * - 2: le anagrafiche di persona diventano aziende (persone → aziende/referenti).
 * - 3: report e attivita diventano report e attività, e la chiamata
 *   smette di essere un tipo diverso dall'attivita.
 */
const VERSIONE_SCHEMA = 3;

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
-- soggetto dei report né delle attività (quelli restano all'azienda),
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

-- Una sola tabella per attività e chiamate, separate da un campo tipo. Sono la
-- stessa cosa con un nome diverso: si creano entrambi dalla pagina
-- dell'azienda e producono entrambi un evento su Google Calendar, il cui
-- titolo è il tipo in maiuscolo più il titolo dell'attività. Diventare entità
-- diverse aveva creato due liste, due form e due percorsi di pubblicazione per
-- un concetto che è uno solo.
--
-- completata è un sí/no e non uno stato: la domanda che l'utente si pone è
-- "l'ho fatta?", non "in che punto è". Da lì si genera il report.
CREATE TABLE IF NOT EXISTS attivita (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  aziendaId INTEGER NOT NULL REFERENCES aziende(id) ON DELETE CASCADE,
  titolo TEXT NOT NULL DEFAULT '',
  descrizione TEXT NOT NULL DEFAULT '',
  -- Il default è 'appuntamento' e non una terza parola: TipoAttivita ne ha
  -- due, e un valore che non esiste renderebbe il titolo dell'evento
  -- 'undefined - Ritiro documento'.
  tipo TEXT NOT NULL DEFAULT 'appuntamento',
  inizio TEXT NOT NULL,
  fine TEXT NOT NULL,
  luogo TEXT NOT NULL DEFAULT '',
  stato TEXT NOT NULL DEFAULT 'in-attesa',
  completata INTEGER NOT NULL DEFAULT 0,
  promemoriaMin INTEGER NOT NULL DEFAULT 30,
  googleEventId TEXT,
  googleCalendarId TEXT,
  googleHtmlLink TEXT,
  googleSyncAt TEXT,
  googleErrore TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);

-- Il report è quello che si scrive **dopo** aver svolto un'attività: non ha
-- uno stato (non c'è una macchina di stati da cui passare) e non ha una data
-- propria, perché la data è quella dell'attività a cui si riferisce.
--
-- Non ha nemmeno un tipo: il tipo è quello dell'attività, ed è quello che
-- finisce nel titolo dell'evento su Google Calendar. Copiarlo qui sarebbe una
-- seconda fonte che può dire una cosa diversa dall'altra.
--
-- attivitaId è NOT NULL e la cancellazione è in cascata: il report è la
-- descrizione di quell'attività, quindi senza l'attività non è niente. Non è
-- una scelta discussa, è la conseguenza di che cos'è un report.
CREATE TABLE IF NOT EXISTS report (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  aziendaId INTEGER NOT NULL REFERENCES aziende(id) ON DELETE CASCADE,
  attivitaId INTEGER NOT NULL REFERENCES attivita(id) ON DELETE CASCADE,
  titolo TEXT NOT NULL DEFAULT '',
  descrizione TEXT NOT NULL DEFAULT '',
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
CREATE INDEX IF NOT EXISTS idx_report_azienda ON report(aziendaId);
CREATE INDEX IF NOT EXISTS idx_attivita_azienda ON attivita(aziendaId);
CREATE INDEX IF NOT EXISTS idx_attivita_inizio ON attivita(inizio);
CREATE INDEX IF NOT EXISTS idx_report_attivita ON report(attivitaId);
CREATE UNIQUE INDEX IF NOT EXISTS idx_attivita_google ON attivita(googleEventId) WHERE googleEventId IS NOT NULL;
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
  // `aziendaId` è nella lista per un caso particolare: un database senza la
  // tabella `anagrafici` non viene azzerato (non è mai esistito, o è già stato
  // azzerato), ma le sue tabelle possono essere vecchie. senza questa riga, un
  // attivita salvato avrebbe la colonna e ogni query che nomina l'azienda
  // su quella tabella fallirebbe.
  { tabella: "attivita", colonna: "googleErrore", tipo: "TEXT" },
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
 * Il passaggio da persone fisiche ad aziende (schema 2).
 *
 * Una volta sola, e con una cancellazione: le anagrafiche di persona non sono
 * aziende, quindi non c'è niente da convertire — resterebbero numeri senza
 * significato (codice fiscale in un campo "ragione sociale") e relazioni e
 * appuntamenti agganciati a una persona che non esiste più non avrebbero un
 * soggetto. Per questo le tabelle vengono buttate: ALTER TABLE può solo
 * aggiungere colonne, e qui il nome delle colonne è cambiato.
 *
 * Qui i nomi sono quelli **vecchi**, ed è la tabella anagrafici la prova che il
 * passaggio non è ancora avvenuto: senza di lei non si toccherebbe niente,
 * perché su un database nato già con questo schema non c'è nulla da migrare.
 *
 * Le chiavi esterne sono disattivate durante il passaggio: senza, il DROP
 * TABLE delle relazioni metterebbe NULL negli appuntamenti già salvati e
 * lascerebbe in giro indici e riferimenti a metà.
 */
function passaAdAziende(db: Database): void {
  if (versioneSchema(db) >= 2) return;
  if (!tabellaEsiste(db, "anagrafici")) return; // un database nato già con questo schema
  db.run("PRAGMA foreign_keys = OFF");
  // `IF EXISTS` su tutte e tre: un database può avere `anagrafici` senza le
  // altre due (sono state aggiunte in momenti diversi), e un `DROP TABLE` su
  // una tabella che non c'è è un errore che blocca l'apertura dell'app.
  db.run("DROP TABLE IF EXISTS relazioni");
  db.run("DROP TABLE IF EXISTS appuntamenti");
  db.run("DROP TABLE IF EXISTS anagrafici");
}

/**
 * Il passaggio a report e attività (schema 3), che sostituisce relazioni e
 * appuntamenti.
 *
 * Una volta sola, e con una cancellazione: qui cambia il nome delle tabelle e
 * cambia la forma dei dati. Un report non ha più né lo stato né il tipo, e
 * un'attività non ha più il riferimento alla relazione. Non c'è una conversione
 * che conservi qualcosa di utile: una relazione in bozza non è un report, e un
 * appuntamento non diventa un'attività — l'attività si crea da un'azienda e si
 * segna come completata. ALTER TABLE può solo aggiungere colonne, quindi le
 * tabelle vecchie vengono buttate e quelle nuove create dallo schema.
 *
 * Anche gli appuntamenti senza azienda spariscono, e questa è una scelta:
 * nell'attività nuova l'azienda è obbligatoria, perché il contesto è
 * l'unica cosa che rende un report leggibile, e un'attività orfana non
 * potrebbe essere generata. Le due tabelle nuove nascono vuote e l'utente
 * ricomincia dalle aziende, che sono la parte che nel modello non è cambiata
 * e che si riinseriscono in un minuto. Al contrario, lasciare in giro righe
 * senza azienda sarebbe stato un caso che nessuno può aprire.
 */
function passaARiportEAttivita(db: Database): void {
  if (versioneSchema(db) >= VERSIONE_SCHEMA) return;
  if (!tabellaEsiste(db, "appuntamenti")) return; // un database nato già con questo schema
  db.run("PRAGMA foreign_keys = OFF");
  // `IF EXISTS` per lo stesso motivo di sopra: `relazioni` può non esserci
  // su un database che ha solo gli appuntamenti, e il DROP fallirebbe.
  db.run("DROP TABLE IF EXISTS relazioni");
  db.run("DROP TABLE IF EXISTS appuntamenti");
}

/**
 * SQLite mantiene le chiavi esterne disattivate di default: senza questo
 * PRAGMA le ON DELETE CASCADE non verrebbero mai applicate.
 */
export function runMigrations(db: Database): void {
  db.run(PRAGMA_CHIAVI_ESTERNE);
  passaAdAziende(db);
  passaARiportEAttivita(db);
  db.run(SCHEMA);
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
