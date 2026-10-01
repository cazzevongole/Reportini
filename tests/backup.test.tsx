/**
 * Versionamento del database: si tiene una copia per ora, per tre giorni,
 * e da lì si può tornare indietro o ripartire davvero.
 *
 * L'archivio gira su IndexedDB finto, il motore SQLite è finto (così i
 * byte si controllano a piacere) e le copie sono scritte a mano con il
 * vero sql.js, per controllare che l'anteprima legga dati veri.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "fake-indexeddb/auto";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import initSqlJs from "sql.js";
import { clear } from "idb-keyval";

/* ------------------------------ motore finto ----------------------------- */

const stato = {
  byte: new Uint8Array([1, 2, 3]),
  sostituito: [] as Uint8Array[],
};

vi.mock("../src/lib/sqlite/engine", () => ({
  initDatabase: vi.fn(async () => ({})),
  flush: vi.fn(async () => {}),
  snapshot: vi.fn(() => stato.byte.slice()),
  replaceDatabase: vi.fn(async (bytes: Uint8Array) => {
    stato.sostituito.push(bytes.slice());
    stato.byte = bytes.slice();
  }),
  subscribe: vi.fn(() => () => {}),
  notifyChange: vi.fn(),
  getVersion: () => 1,
  all: vi.fn(() => []),
  get: vi.fn(() => null),
  run: vi.fn(),
  insert: vi.fn(() => 1),
  update: vi.fn(),
  getDatabase: vi.fn(() => ({})),
  persist: vi.fn(async () => {}),
}));

const { AvvisoProvider } = await import("../src/components/Avvisi");
const VersioniBackup = (await import("../src/components/VersioniBackup")).default;
const { useRegistrazioneVersioni } = await import("../src/hooks/useVersioniBackup");
const archivio = await import("../src/lib/backup/archivio");
const { leggiAnteprima } = await import("../src/lib/backup/anteprima");

/* ------------------------------ utilità ---------------------------------- */

const ORA = new Date("2026-03-10T12:00:00Z").getTime();

/** Costruisce un SQLite vero con un paio di righe, per l'anteprima. */
async function copiaConDati(ragioneSociale: string): Promise<Uint8Array> {
  const sql = await initSqlJs({
    locateFile: () => `${process.cwd()}/node_modules/sql.js/dist/sql-wasm.wasm`,
  });
  const db = new sql.Database();
  db.run(`
    CREATE TABLE aziende (id INTEGER PRIMARY KEY, ragioneSociale TEXT, partitaIva TEXT, updatedAt TEXT);
    CREATE TABLE referenti (id INTEGER PRIMARY KEY, aziendaId INTEGER, updatedAt TEXT);
    CREATE TABLE report (id INTEGER PRIMARY KEY, updatedAt TEXT);
    CREATE TABLE attivita (id INTEGER PRIMARY KEY, titolo TEXT, inizio TEXT, stato TEXT, updatedAt TEXT);
  `);
  const adesso = new Date().toISOString();
  db.run("INSERT INTO aziende (ragioneSociale, partitaIva, updatedAt) VALUES (?,?,?)", [
    ragioneSociale,
    "03012345678",
    adesso,
  ]);
  db.run("INSERT INTO referenti (aziendaId, updatedAt) VALUES (1, ?)", [adesso]);
  db.run("INSERT INTO report (updatedAt) VALUES (?)", [adesso]);
  db.run("INSERT INTO attivita (titolo, inizio, stato, updatedAt) VALUES (?,?,?,?)", [
    "Sportello",
    adesso,
    "in-attesa",
    adesso,
  ]);
  const byte = db.export();
  db.close();
  return byte;
}

let contenitore: HTMLDivElement;
let radice: Root;

/**
 * Il tempo si sposta col mocking di Date.now() e non con i timer finti:
 * fake-indexeddbpromise tramite il loop di eventi, e con i timer bloccati
 * ogni richiesta resterebbe appesa per sempre.
 */
let orologio = ORA;

const aspetta = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function monta() {
  radice = createRoot(contenitore);
  await act(async () => {
    radice.render(
      <AvvisoProvider>
        <App />
      </AvvisoProvider>,
    );
  });
}

/** Come nell'app vera: il guard accende la registrazione, le impostazioni
 *  mostrano l'elenco. Qui si monta la stessa coppia. */
function App() {
  useRegistrazioneVersioni();
  return <VersioniBackup />;
}

function testo() {
  return contenitore.textContent ?? "";
}

function bottone(contenuto: string) {
  return [...contenitore.querySelectorAll("button")].find((b) =>
    b.textContent?.includes(contenuto),
  ) as HTMLButtonElement | undefined;
}

function bottoni(contenuto: string) {
  return [...contenitore.querySelectorAll("button")].filter((b) =>
    b.textContent?.includes(contenuto),
  ) as HTMLButtonElement[];
}

beforeEach(async () => {
  orologio = ORA;
  vi.spyOn(Date, "now").mockImplementation(() => orologio);
  stato.byte = new Uint8Array([1, 2, 3]);
  stato.sostituito = [];
  await clear();
  await archivio.svuotaArchivio();
  contenitore = document.createElement("div");
  document.body.appendChild(contenitore);
});

afterEach(async () => {
  await act(async () => radice?.unmount());
  contenitore.remove();
  vi.restoreAllMocks();
});

describe("Archivio delle versioni", () => {
  it("registra una versione per ora e non riscrive contenuti identici", async () => {
    const primo = await archivio.registraVersione(new Uint8Array([1, 2, 3]), ORA);
    expect(primo).not.toBeNull();

    // Stessi byte nella stessa ora: niente da scrivere.
    const identico = await archivio.registraVersione(new Uint8Array([1, 2, 3]), ORA + 5_000);
    expect(identico).toBeNull();
    expect(await archivio.elencaVersioni()).toHaveLength(1);

    // Cambiamenti nella stessa ora: la versione di quell'ora si aggiorna.
    const aggiornata = await archivio.registraVersione(new Uint8Array([1, 2, 3, 4]), ORA + 9_000);
    expect(aggiornata).not.toBeNull();
    const versioni = await archivio.elencaVersioni();
    expect(versioni).toHaveLength(1);
    expect(versioni[0].aggiornataIl).toBe(ORA + 9_000);

    // Ora dopo: versione nuova.
    await archivio.registraVersione(new Uint8Array([9]), ORA + 3_600_000);
    expect(await archivio.elencaVersioni()).toHaveLength(2);
  });

  it("tiene solo gli ultimi tre giorni", async () => {
    for (let giorni = 5; giorni >= 1; giorni -= 1) {
      const quando = ORA - giorni * 86_400_000;
      await archivio.registraVersione(new Uint8Array([giorni]), quando);
    }
    await archivio.registraVersione(new Uint8Array([99]), ORA);

    const versioni = await archivio.elencaVersioni();
    // Oggi e i tre giorni precedenti: il quinto giorno è fuori.
    expect(versioni).toHaveLength(4);
    for (const versione of versioni) {
      expect(ORA - versione.ora).toBeLessThanOrEqual(3 * 86_400_000);
    }
    // La più recente in cima.
    expect(versioni[0].ora).toBe(archivio.oraDi(ORA));
  });

  it("scarta le versioni successive a quella scelta", async () => {
    await archivio.registraVersione(new Uint8Array([1]), ORA);
    await archivio.registraVersione(new Uint8Array([2]), ORA + 3_600_000);
    await archivio.registraVersione(new Uint8Array([3]), ORA + 7_200_000);

    const versioni = await archivio.elencaVersioni();
    const piuVecchia = versioni[versioni.length - 1];
    const scartate = await archivio.scartaVersioniSuccessive(piuVecchia.id);

    expect(scartate).toBe(2);
    const rimaste = await archivio.elencaVersioni();
    expect(rimaste).toHaveLength(1);
    expect(rimaste[0].id).toBe(piuVecchia.id);
  });

  it("la versione scelta si rilegge byte per byte", async () => {
    const byte = await copiaConDati("Ferramenta Rossi S.r.l.");
    await archivio.registraVersione(byte, ORA);
    const versione = (await archivio.elencaVersioni())[0];
    const riletta = await archivio.leggiVersione(versione.id);
    expect(riletta).not.toBeNull();
    expect(Array.from(riletta!)).toEqual(Array.from(byte));
  });
});

describe("Anteprima", () => {
  it("legge la copia senza toccare il database di lavoro", async () => {
    const byte = await copiaConDati("Ferramenta Rossi S.r.l.");
    const anteprima = await leggiAnteprima(byte);

    expect(anteprima.aziende).toBe(1);
    expect(anteprima.referenti).toBe(1);
    expect(anteprima.report).toBe(1);
    expect(anteprima.attivita).toBe(1);
    expect(anteprima.aziendeElenco[0].ragioneSociale).toBe("Ferramenta Rossi S.r.l.");
    expect(anteprima.aziendeElenco[0].partitaIva).toBe("03012345678");
    expect(anteprima.attivitaElenco[0].titolo).toBe("Sportello");
    // Il database di lavoro non è stato sfiorato: è un'altra istanza.
    expect(stato.sostituito).toHaveLength(0);
  });

  it("una copia illeggibile non fa cadere la pagina", async () => {
    const anteprima = await leggiAnteprima(new Uint8Array([9, 9, 9, 9, 9]));
    expect(anteprima.aziende).toBe(0);
    expect(anteprima.aziendeElenco).toEqual([]);
  });
});

describe("Versioni nelle impostazioni", () => {
  it("l'elenco parte vuoto e si riempie a ogni modifica", async () => {
    await monta();
    expect(testo()).toContain("Ancora nessuna versione");

    // Una modifica al database: dopo la pausa di raccolta la versione c'è.
    await act(async () => {
      stato.byte = new Uint8Array([7, 7, 7]);
      const { notifyChange } = await import("../src/lib/sqlite/engine");
      notifyChange();
      await aspetta(2_600);
    });

    expect(testo()).toContain("1 versione conservata");
    expect(await archivio.elencaVersioni()).toHaveLength(1);
  });

  it("guardare una versione non modifica nulla", async () => {
    const byte = await copiaConDati("Ferramenta Rossi S.r.l.");
    await archivio.registraVersione(byte, ORA);
    await monta();

    await act(async () => {
      bottone("Guarda")?.click();
      await aspetta(50);
    });

    expect(testo()).toContain("Solo anteprima");
    expect(testo()).toContain("Ferramenta Rossi");
    // Nessuna sostituzione, nessuno scarto.
    expect(stato.sostituito).toHaveLength(0);
    expect(await archivio.elencaVersioni()).toHaveLength(1);
  });

  it("ripartire da una versione sostituisce i dati e scarta le successive", async () => {
    const vecchia = await copiaConDati("Ferramenta Rossi S.r.l.");
    await archivio.registraVersione(vecchia, ORA - 7_200_000);
    const nuova = await copiaConDati("Verdi Impianti S.n.c.");
    await archivio.registraVersione(nuova, ORA);
    await monta();

    // Prima si guarda, poi si sceglie di ripartire: è una scelta, non un
    // effetto collaterale.
    await act(async () => {
      // L'elenco va dalla più recente alla più vecchia: il secondo bottone
      // "Guarda" è quello della versione vecchia, quella da cui si vuole
      // ripartire.
      bottoni("Guarda")[1]?.click();
      await aspetta(50);
    });
    expect(testo()).toContain("Ferramenta Rossi");

    await act(async () => {
      bottone("Riparti da qui")?.click();
      await aspetta(20);
    });
    // Serve la conferma esplicita.
    expect(testo()).toContain("Questo non si può annullare");
    expect(stato.sostituito).toHaveLength(0);

    await act(async () => {
      bottone("Sì, riparti da qui")?.click();
      await aspetta(50);
    });

    expect(stato.sostituito).toHaveLength(1);
    expect(Array.from(stato.sostituito[0])).toEqual(Array.from(vecchia));
    // La versione più recente è stata scartata, come chiesto.
    const rimaste = await archivio.elencaVersioni();
    expect(rimaste).toHaveLength(1);
    expect(rimaste[0].id).toBe(archivio.oraDi(ORA - 7_200_000));
    expect(testo()).toContain("Dati ripristinati");
  });

  it("registrare adesso segnala che i dati non sono cambiati", async () => {
    await archivio.registraVersione(new Uint8Array([1, 2, 3]), ORA);
    await monta();
    await act(async () => {
      bottone("Registra adesso")?.click();
      await aspetta(50);
    });
    expect(testo()).toContain("già identici all'ultima versione");
  });
});
