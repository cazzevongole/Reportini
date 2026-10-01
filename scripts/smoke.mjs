// Smoke test: esegue lo schema reale contro sql.js e controlla che tutte le
// query di src/lib/repo.ts siano valide su di esso.
import initSqlJs from "sql.js";
import { readFileSync } from "node:fs";

const sql = await initSqlJs({ locateFile: () => "node_modules/sql.js/dist/sql-wasm.wasm" });
const db = new sql.Database();

const migrazioni = readFileSync("src/lib/sqlite/migrations.ts", "utf8");
const schema = migrazioni.match(/const SCHEMA = `([\s\S]*?)`;/)[1];
db.run("PRAGMA foreign_keys = ON");
db.run(schema);

const stampa = (etichetta, testo, parametri = []) =>
  console.log(`${etichetta}:`, JSON.stringify(db.exec(testo, parametri)[0].values));

stampa("tabelle", "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name");
// Requisito: l'installazione deve partire vuota, senza dati dimostrativi.
stampa(
  "nessun dato dimostrativo",
  `SELECT
  (SELECT COUNT(*) FROM aziende) AS aziende,
  (SELECT COUNT(*) FROM referenti) AS referenti,
  (SELECT COUNT(*) FROM relazioni) AS relazioni,
  (SELECT COUNT(*) FROM appuntamenti) AS appuntamenti`,
);
if (db.exec("SELECT COUNT(*) FROM aziende")[0].values[0][0] !== 0) {
  console.error("ATTENZIONE: il database iniziale contiene righe");
  process.exit(1);
}

// Fixture minima: senza dati demo, l'app parte vuota.
const adesso = new Date().toISOString();
const domani = new Date(Date.now() + 86_400_000);
db.run(
  `INSERT INTO aziende (ragioneSociale, partitaIva, citta, createdAt, updatedAt)
   VALUES ('Ferramenta Rossi S.r.l.', '03012345678', 'Verona', :adesso, :adesso)`,
  { ":adesso": adesso },
);
db.run(
  `INSERT INTO referenti (aziendaId, nome, cognome, telefono, email, createdAt, updatedAt)
   VALUES (1, 'Mario', 'Rossi', '3401234567', 'mario.rossi@example.it', :adesso, :adesso)`,
  { ":adesso": adesso },
);
db.run(
  `INSERT INTO relazioni (aziendaId, titolo, tipo, stato, contenuto, data, createdAt, updatedAt)
   VALUES (1, 'Certificato', 'Residenza', 'bozza', 'Testo di prova', :oggi, :adesso, :adesso)`,
  { ":oggi": adesso.slice(0, 10), ":adesso": adesso },
);
db.run(
  `INSERT INTO appuntamenti (aziendaId, relazioneId, titolo, inizio, fine, stato, createdAt, updatedAt)
   VALUES (1, 1, 'Sportello', :inizio, :fine, 'in-attesa', :adesso, :adesso)`,
  {
    ":inizio": domani.toISOString(),
    ":fine": new Date(domani.getTime() + 1_800_000).toISOString(),
    ":adesso": adesso,
  },
);

stampa(
  "contatori con join",
  `SELECT
  (SELECT COUNT(*) FROM relazioni WHERE aziendaId = 1) AS relazioni,
  (SELECT COUNT(*) FROM appuntamenti WHERE aziendaId = 1) AS appuntamenti,
  (SELECT COUNT(*) FROM referenti WHERE aziendaId = 1) AS referenti`,
);
stampa("ricerca per ragione sociale", "SELECT COUNT(*) FROM aziende WHERE ragioneSociale LIKE ?", [
  "%Ferramenta%",
]);
stampa(
  "ricerca per il nome del referente",
  `SELECT COUNT(*) FROM aziende a WHERE EXISTS (SELECT 1 FROM referenti f
    WHERE f.aziendaId = a.id AND f.nome LIKE ?)`,
  ["%Mario%"],
);
stampa(
  "ricerca libera",
  `SELECT COUNT(*) FROM relazioni r JOIN aziende a ON a.id = r.aziendaId
  WHERE r.titolo LIKE ? OR r.tipo LIKE ? OR r.contenuto LIKE ? OR a.ragioneSociale LIKE ?`,
  ["%Cert%", "%Res%", "%prova%", "%Ferramenta%"],
);

// Cascata: eliminare un'azienda elimina relazioni e referenti, e stacca
// gli appuntamenti.
db.run("DELETE FROM aziende WHERE id = 1");
stampa(
  "dopo la cancellazione",
  `SELECT
  (SELECT COUNT(*) FROM aziende) AS aziende,
  (SELECT COUNT(*) FROM referenti) AS referenti,
  (SELECT COUNT(*) FROM relazioni) AS relazioni,
  (SELECT COUNT(*) FROM appuntamenti WHERE aziendaId IS NULL) AS appuntamenti_orfani`,
);

// Ogni statement di repo.ts deve essere preparabile sullo schema reale.
// I template con ${...} vengono saltati: contengono interpolazioni, non SQL puro.
const sorgente = readFileSync("src/lib/repo.ts", "utf8");
const candidate = [
  ...sorgente.matchAll(/`([^`]*SELECT[^`]*)`/g),
  ...sorgente.matchAll(/"(DELETE FROM [^"]*)"/g),
].map((m) => m[1]);
const query = candidate.filter((testo) => !testo.includes("${"));
let fallite = 0;
for (const testo of query) {
  try {
    db.prepare(testo);
  } catch (errore) {
    fallite += 1;
    console.error(
      "QUERY NON VALIDA:",
      testo.replace(/\s+/g, " ").slice(0, 110),
      "→",
      errore.message,
    );
  }
}
console.log(
  `query di repo.ts verificate: ${query.length}, non valide: ${fallite} (saltati ${candidate.length - query.length} template)`,
);

// Deriva delle colonne: repo.ts costruisce le INSERT a partire da chiavi di
// oggetto, quindi un errore di battitura (una colonna che si chiama come nello
// spagnolo) fallisce solo a runtime, quando l'app prova a salvare. Qui le
// chiavi di ogni factory di valori vengono confrontate con lo schema reale.
const TABELLE_DAL_REPO = {
  valoriAzienda: "aziende",
  valoriReferente: "referenti",
  valoriRelazione: "relazioni",
  valoriAppuntamento: "appuntamenti",
};
let disallineamenti = 0;
for (const [funzione, tabella] of Object.entries(TABELLE_DAL_REPO)) {
  const corpo = sorgente.match(new RegExp(`function ${funzione}\\([\\s\\S]*?\\n\\}`))?.[0];
  if (!corpo) {
    console.log(`factory non trovata: ${funzione}`);
    continue;
  }
  const colonne = new Set(
    db.exec(`PRAGMA table_info(${tabella})`)[0].values.map((riga) => riga[1]),
  );
  const chiavi = [...corpo.matchAll(/^\s{4}([A-Za-z][A-Za-z0-9]*):/gm)].map((m) => m[1]);
  for (const chiave of chiavi) {
    if (!colonne.has(chiave)) {
      console.error(`COLONNA INESISTENTE: ${tabella}.${chiave} (usata da ${funzione})`);
      disallineamenti += 1;
    }
  }
  console.log(`${funzione}: ${chiavi.length} colonne verificate su ${tabella}`);
}

const byte = db.export();
console.log(
  "byte esportati:",
  byte.length,
  "| intestazione:",
  String.fromCharCode(...byte.slice(0, 15)),
);
if (fallite > 0 || disallineamenti > 0) process.exit(1);
