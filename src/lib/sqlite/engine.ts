import initSqlJs, { type Database, type SqlJsStatic } from "sql.js";
import wasmUrl from "sql.js/dist/sql-wasm.wasm?url";
import { storage } from "./storage";
import { runMigrations } from "./migrations";

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
  const current = getDatabase();
  // Copia l'heap WASM prima di cedere il controllo: la vista vale solo finché
  // nessuna altra istruzione tocca il database.
  const bytes = current.export();
  await storage.save(bytes);
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

export function run(sql: string, params: SqlValue[] = []): void {
  getDatabase().run(sql, params);
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
  getDatabase().run(sql, keys.map((key) => values[key]));
  schedulePersist();
  notifyChange();
  const result = get<{ id: number }>(`SELECT last_insert_rowid() AS id`);
  return result?.id ?? 0;
}

export function update(
  table: string,
  id: number,
  values: Record<string, SqlValue>,
): void {
  const keys = Object.keys(values);
  const sql = `UPDATE ${table} SET ${keys
    .map((key) => `${key} = ?`)
    .join(", ")} WHERE id = ?`;
  getDatabase().run(sql, [...keys.map((key) => values[key]), id]);
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
  return getDatabase().export();
}
