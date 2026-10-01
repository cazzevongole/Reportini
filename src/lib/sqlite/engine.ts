import type { Database, SqlJsStatic } from "sql.js";
import wasmUrl from "sql.js/dist/sql-wasm.wasm?url";
import { storage } from "./storage";
import { PRAGMA_CHIAVI_ESTERNE, runMigrations } from "./migrations";

let SQL: SqlJsStatic | null = null;
let db: Database | null = null;
let saveTimer: number | undefined;
let saving: Promise<void> | null = null;

type Listener = () => void;
const listeners = new Set<Listener>();
let version = 0;

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getVersion(): number {
  return version;
}

/** Avvisa le viste montate che il database è cambiato, così rieseguono la query. */
export function notifyChange(): void {
  version += 1;
  listeners.forEach((listener) => listener());
}

async function loadSql(): Promise<SqlJsStatic> {
  if (!SQL) {
    // Import dinamico: il collante di sql.js sono circa 15 kB gzip e serve
    // solo quando il database si apre davvero, cioè dopo l'accesso.
    // Con l'import statico finiva nel chunk principale e lo scaricava
    // anche chi non arriva mai a entrare.
    const { default: initSqlJs } = await import("sql.js");
    SQL = await initSqlJs({ locateFile: () => wasmUrl });
  }
  return SQL;
}

export async function initDatabase(): Promise<Database> {
  if (db) return db;
  const sql = await loadSql();
  const persisted = await storage.load();
  if (persisted && persisted.byteLength > 0) {
    db = new sql.Database(persisted);
  } else {
    db = new sql.Database();
  }
  runMigrations(db);
  await persist();
  return db;
}

export function getDatabase(): Database {
  if (!db) throw new Error("I dati non sono ancora stati aperti");
  return db;
}

export async function persist(): Promise<void> {
  const bytes = esporta();
  await storage.save(bytes);
}

/**
 * Esporta il database e rimette le chiavi esterne.
 *
 * export() in sql.js chiude il database e lo riapre dal file interno:
 * tutto ciò che è stato impostato con PRAGMA torna al default, e
 * `foreign_keys` è disattivato di default. Senza rimetterlo qui, dal
 * primo salvataggio in poi le ON DELETE CASCADE e SET NULL non farebbero
 * più niente: cancellando un'azienda le relazioni resterebbero a
 * puntare a un'azienda che non esiste più, e sulle altre pagine
 * continuerebbero a comparire come righe senza nome.
 */
function esporta(): Uint8Array {
  const current = getDatabase();
  // Copia l'heap WASM prima di cedere il controllo: la vista vale solo finché
  // nessuna altra istruzione tocca il database.
  const bytes = current.export();
  current.run(PRAGMA_CHIAVI_ESTERNE);
  return bytes;
}

function schedulePersist(): void {
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    saving = (saving ?? Promise.resolve())
      .then(persist)
      .catch((error) => console.error("Impossibile salvare i dati", error));
  }, 250);
}

export type SqlValue = string | number | null | Uint8Array;

const NON_REPLICATO = "reportini.db.nonReplicato";

/**
 * Ci sono scritture locali che il cloud non ha ancora visto?
 *
 * Il contatore di `getVersion()` dice se il database è cambiato **in questa
 * sessione**, ma riparte da zero a ogni avvio: un'appuntamento eliminato e poi
 * chiusa l'app prima che la copia online si aggiornasse, al riavvio sembrerebbe
 * un database intatto — e il cloud, più vecchio, avrebbe la precedenza e
 * restituirebbe l'appuntamento eliminato. Il flag è su `localStorage` perché
 * deve sopravvivere al riavvio, che è esattamente il caso in cui serve.
 */
export function nonReplicato(): boolean {
  try {
    return localStorage.getItem(NON_REPLICATO) === "1";
  } catch {
    return false;
  }
}

/** Una scrittura locale: il cloud ora è più vecchio di questo dispositivo. */
export function segnaNonReplicato(): void {
  try {
    localStorage.setItem(NON_REPLICATO, "1");
  } catch {
    // Senza spazio il flag non si può scrivere: la sincronizzazione userà il
    // contatore di sessione, che è comunque meglio di niente.
  }
}

/** Il cloud ha tutto: da adesso è lui la copia più recente. */
export function segnaReplicato(): void {
  try {
    localStorage.removeItem(NON_REPLICATO);
  } catch {
    // Come sopra: senza spazio il flag resta, e si risincronizza prima.
  }
}

export function run(sql: string, params: SqlValue[] = []): void {
  getDatabase().run(sql, params);
  segnaNonReplicato();
  schedulePersist();
  notifyChange();
}

export function all<T>(sql: string, params: SqlValue[] = []): T[] {
  const statement = getDatabase().prepare(sql);
  try {
    statement.bind(params);
    const rows: T[] = [];
    while (statement.step()) rows.push(statement.getAsObject() as T);
    return rows;
  } finally {
    statement.free();
  }
}

export function get<T>(sql: string, params: SqlValue[] = []): T | null {
  const rows = all<T>(sql, params);
  return rows.length > 0 ? rows[0] : null;
}

/** Helper INSERT/UPDATE che restituisce l'id della nuova riga. */
export function insert(table: string, values: Record<string, SqlValue>): number {
  const keys = Object.keys(values);
  const sql = `INSERT INTO ${table} (${keys.join(", ")}) VALUES (${keys
    .map(() => "?")
    .join(", ")})`;
  getDatabase().run(
    sql,
    keys.map((key) => values[key]),
  );
  // `last_insert_rowid()` vale per l'ultimo inserimento riuscito: va letto
  // subito, prima di avvisare gli ascoltatori. Dopo `notifyChange()` un
  // ascoltatore che scrivesse a sua volta farebbe cambiare la risposta, e
  // `inserisci` restituirebbe l'id di una riga appena creata da qualcun
  // altro: un appuntamento appena salvato risulterebbe inesistente.
  const result = get<{ id: number }>(`SELECT last_insert_rowid() AS id`);
  segnaNonReplicato();
  schedulePersist();
  notifyChange();
  return result?.id ?? 0;
}

export function update(table: string, id: number, values: Record<string, SqlValue>): void {
  const keys = Object.keys(values);
  const sql = `UPDATE ${table} SET ${keys.map((key) => `${key} = ?`).join(", ")} WHERE id = ?`;
  getDatabase().run(sql, [...keys.map((key) => values[key]), id]);
  segnaNonReplicato();
  schedulePersist();
  notifyChange();
}

/** Forza la scrittura pendenti (usata prima di esportare o salvare una copia). */
export async function flush(): Promise<void> {
  window.clearTimeout(saveTimer);
  if (saving) await saving;
  saving = null;
  await persist();
}

/** Sostituisce il database aperto con uno scaricato dal cloud. */
export async function replaceDatabase(bytes: Uint8Array): Promise<void> {
  const sql = await loadSql();
  db?.close();
  db = new sql.Database(bytes);
  runMigrations(db);
  await persist();
  notifyChange();
}

/** Istantanea grezza del database, usata dai backup e dalla sincronizzazione. */
export function snapshot(): Uint8Array {
  return esporta();
}
