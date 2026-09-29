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
  anagrafici: number;
  relazioni: number;
  appuntamenti: number;
  ultimoAggiornamento: string | null;
  anagraficheElenco: Array<{ id: number; nome: string; cognome: string; documento: string }>;
  appuntamentiElenco: Array<{ id: number; titolo: string; inizio: string; stato: string }>;
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
      anagrafici: number;
      relazioni: number;
      appuntamenti: number;
      ultimoAggiornamento: string | null;
    }>(
      copia,
      `SELECT (SELECT COUNT(*) FROM anagrafici) AS anagrafici,
              (SELECT COUNT(*) FROM relazioni) AS relazioni,
              (SELECT COUNT(*) FROM appuntamenti) AS appuntamenti,
              (SELECT MAX(updatedAt) FROM appuntamenti) AS ultimoAggiornamento`,
    )[0] ?? { anagrafici: 0, relazioni: 0, appuntamenti: 0, ultimoAggiornamento: null };

    return {
      anagrafici: conteggi.anagrafici ?? 0,
      relazioni: conteggi.relazioni ?? 0,
      appuntamenti: conteggi.appuntamenti ?? 0,
      ultimoAggiornamento: conteggi.ultimoAggiornamento ?? null,
      anagraficheElenco: interroga(
        copia,
        `SELECT id, nome, cognome, documento
        FROM anagrafici ORDER BY cognome, nome LIMIT 20`,
      ),
      appuntamentiElenco: interroga(
        copia,
        `SELECT id, titolo, inizio, stato
        FROM appuntamenti ORDER BY inizio LIMIT 20`,
      ),
    };
  } finally {
    // La copia vive solo per la lettura: chiuderla libera subito la memoria.
    copia.close();
  }
}
