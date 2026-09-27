import { get as idbGet, set as idbSet } from "idb-keyval";

const IDB_KEY = "reportini.sqlite";

export interface DesktopBridge {
  readDb(): Promise<Uint8Array | null>;
  writeDb(bytes: Uint8Array): Promise<void>;
  /** Percorso assoluto del file SQLite, risolto dal preload script. */
  dbPath: string;
  platform: string;
}

declare global {
  interface Window {
    reportini?: DesktopBridge;
  }
}

export interface DbStorage {
  /** Descrizione leggibile di dove vive il database. */
  readonly location: string;
  load(): Promise<Uint8Array | null>;
  save(bytes: Uint8Array): Promise<void>;
}

const webStorage: DbStorage = {
  location: "questo browser (IndexedDB)",
  async load() {
    const value = await idbGet<ArrayBuffer | Uint8Array>(IDB_KEY);
    if (!value) return null;
    return value instanceof Uint8Array ? value : new Uint8Array(value);
  },
  async save(bytes) {
    // Salva una copia in ArrayBuffer: le viste Uint8Array sull'heap WASM vengono
    // staccate alla chiusura del database e non vanno persistite.
    await idbSet(IDB_KEY, bytes.slice().buffer);
  },
};

function desktopStorage(ponte: DesktopBridge): DbStorage {
  return {
    location: ponte.dbPath,
    load: async () => (await ponte.readDb()) ?? null,
    save: async (bytes) => {
      await ponte.writeDb(bytes);
    },
  };
}

// `ponte` viene valutato una sola volta: nel browser resta `undefined` e non
// viene mai costruito l'adapter desktop.
const ponte: DesktopBridge | undefined = window.reportini;

export const storage: DbStorage = ponte ? desktopStorage(ponte) : webStorage;

export const isDesktop = Boolean(ponte);
