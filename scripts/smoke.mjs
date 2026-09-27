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
stampa("nessun dato dimostrativo", `SELECT
  (SELECT COUNT(*) FROM anagrafici) AS anagrafici,
  (SELECT COUNT(*) FROM relazioni) AS relazioni,
  (SELECT COUNT(*) FROM appuntamenti) AS appuntamenti`);
if (db.exec("SELECT COUNT(*) FROM anagrafici")[0].values[0][0] !== 0) {
  console.error("ATTENZIONE: il database iniziale contiene righe");
  process.exit(1);
}

// Fixture minima: senza dati demo, l'app parte vuota.
const adesso = new Date().toISOString();
const domani = new Date(Date.now() + 86_400_000);
db.run(
  `INSERT INTO anagrafici (nome, cognome, documento, dataNascita, citta, createdAt, updatedAt)
   VALUES ('Mario', 'Rossi', 'VR123456A', '1980-01-02', 'Verona', :adesso, :adesso)`,
  { ":adesso": adesso },
);
db.run(
  `INSERT INTO relazioni (anagraficoId, titolo, tipo, stato, contenuto, data, createdAt, updatedAt)
   VALUES (1, 'Certificato', 'Residenza', 'bozza', 'Testo di prova', :oggi, :adesso, :adesso)`,
  { ":oggi": adesso.slice(0, 10), ":adesso": adesso },
);
db.run(
  `INSERT INTO appuntamenti (anagraficoId, relazioneId, titolo, inizio, fine, stato, createdAt, updatedAt)
   VALUES (1, 1, 'Sportello', :inizio, :fine, 'in-attesa', :adesso, :adesso)`,
  {
    ":inizio": domani.toISOString(),
    ":fine": new Date(domani.getTime() + 1_800_000).toISOString(),
    ":adesso": adesso,
  },
);

stampa("contatori con join", `SELECT
  (SELECT COUNT(*) FROM relazioni WHERE anagraficoId = 1) AS relazioni,
  (SELECT COUNT(*) FROM appuntamenti WHERE anagraficoId = 1) AS appuntamenti`);
stampa("ricerca per nome", "SELECT COUNT(*) FROM anagrafici WHERE nome LIKE ?", ["%Mario%"]);
stampa("ricerca libera", `SELECT COUNT(*) FROM relazioni r JOIN anagrafici a ON a.id = r.anagraficoId
  WHERE r.titolo LIKE ? OR r.tipo LIKE ? OR r.contenuto LIKE ? OR a.nome LIKE ? OR a.cognome LIKE ?`,
  ["%Cert%", "%Res%", "%prova%", "%Mario%", "%Rossi%"]);

// Cascata: eliminare un anagrafico elimina le relazioni e stacca gli appuntamenti.
db.run("DELETE FROM anagrafici WHERE id = 1");
stampa("dopo la cancellazione", `SELECT
  (SELECT COUNT(*) FROM anagrafici) AS anagrafici,
  (SELECT COUNT(*) FROM relazioni) AS relazioni,
  (SELECT COUNT(*) FROM appuntamenti WHERE anagraficoId IS NULL) AS appuntamenti_orfani`);

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
    console.error("QUERY NON VALIDA:", testo.replace(/\s+/g, " ").slice(0, 110), "→", errore.message);
  }
}
console.log(
  `query di repo.ts verificate: ${query.length}, non valide: ${fallite} (saltati ${candidate.length - query.length} template)`,
);

const byte = db.export();
console.log("byte esportati:", byte.length, "| intestazione:", String.fromCharCode(...byte.slice(0, 15)));
if (fallite > 0) process.exit(1);
