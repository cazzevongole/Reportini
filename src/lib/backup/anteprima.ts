import type { Database, SqlJsStatic } from "sql.js";
import wasmUrl from "sql.js/dist/sql-wasm.wasm?url";

/**
 * Lettura di una copia senza toccare il database di lavoro.
 *
 * "Visualizzare temporaneamente" una versione significa guardarla, non
 * sostituirla: si apre la copia in un database a parte e se ne ricavano
 * solo conteggi e nomi. Così l'utente guarda prima di decidere, e il
 * database su cui sta lavorando resta intatto anche se chiude il
 * foglio senza scegliere niente.
 */

let SQL: SqlJsStatic | null = null;

async function caricaSql(): Promise<SqlJsStatic> {
  if (!SQL) {
    const { default: initSqlJs } = await import("sql.js");
    SQL = await initSqlJs({ locateFile: () => wasmUrl });
  }
  return SQL;
}

export interface Anteprima {
  aziende: number;
  referenti: number;
  report: number;
  attivita: number;
  ultimoAggiornamento: string | null;
  aziendeElenco: Array<{ id: number; ragioneSociale: string; partitaIva: string }>;
  attivitaElenco: Array<{ id: number; titolo: string; inizio: string; stato: string }>;
}

function interroga<T>(db: Database, sql: string): T[] {
  try {
    const statement = db.prepare(sql);
    try {
      const righe: T[] = [];
      while (statement.step()) righe.push(statement.getAsObject() as T);
      return righe;
    } finally {
      statement.free();
    }
  } catch {
    // Una copia vecchia o corrotta non deve far cadere l'intera pagina:
    // meglio una lista vuota che un'anteprima illeggibile.
    return [];
  }
}

/** Apre la copia e ne ricava il necessario per decidere. */
export async function leggiAnteprima(byte: Uint8Array): Promise<Anteprima> {
  const sql = await caricaSql();
  const copia = new sql.Database(byte);
  try {
    const conteggi = interroga<{
      aziende: number;
      referenti: number;
      report: number;
      attivita: number;
      ultimoAggiornamento: string | null;
    }>(
      copia,
      `SELECT (SELECT COUNT(*) FROM aziende) AS aziende,
              (SELECT COUNT(*) FROM referenti) AS referenti,
              (SELECT COUNT(*) FROM report) AS report,
              (SELECT COUNT(*) FROM attivita) AS attivita,
              (SELECT MAX(updatedAt) FROM attivita) AS ultimoAggiornamento`,
    )[0] ?? {
      aziende: 0,
      referenti: 0,
      report: 0,
      attivita: 0,
      ultimoAggiornamento: null,
    };

    return {
      aziende: conteggi.aziende ?? 0,
      referenti: conteggi.referenti ?? 0,
      report: conteggi.report ?? 0,
      attivita: conteggi.attivita ?? 0,
      ultimoAggiornamento: conteggi.ultimoAggiornamento ?? null,
      aziendeElenco: interroga(
        copia,
        `SELECT id, ragioneSociale, partitaIva
        FROM aziende ORDER BY ragioneSociale COLLATE NOCASE LIMIT 20`,
      ),
      attivitaElenco: interroga(
        copia,
        `SELECT id, titolo, inizio, stato
        FROM attivita ORDER BY inizio LIMIT 20`,
      ),
    };
  } finally {
    // La copia vive solo per la lettura: chiuderla libera subito la memoria.
    copia.close();
  }
}
