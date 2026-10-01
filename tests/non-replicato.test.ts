/**
 * Il flag "ci sono scritture non ancora salite nel cloud" con il motore vero.
 *
 * Qui non interessa il cloud, ma che il flag **sopravviva al riavvio**: è la
 * differenza fra un appuntamento eliminato che resta eliminato e uno che
 * torna in lista al riavvio dell'app. Un contatore in memoria non basterebbe,
 * perché riparte da zero a ogni avvio.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "fake-indexeddb/auto";

// In un ambiente jsdom sotto vitest sql.js carica il wasm da filesystem, non
// dalla rete: senza questo mock non trova il file e ogni test muore subito.
vi.mock("sql.js/dist/sql-wasm.wasm?url", () => ({
  default: `${process.cwd()}/node_modules/sql.js/dist/sql-wasm.wasm`,
}));

import { initDatabase, nonReplicato, segnaReplicato } from "../src/lib/sqlite/engine";
import { creaAzienda, eliminaAzienda, elencaAziende } from "../src/lib/repo";

const AZIENDA = {
  ragioneSociale: "Ferramenta Rossi S.r.l.",
  partitaIva: "01234567890",
  indirizzo: "Via Roma 1",
  citta: "Verona",
  cap: "37100",
  provincia: "VR",
  telefono: "",
  email: "",
  note: "",
};

describe("Scritture non ancora replicate", () => {
  beforeEach(async () => {
    localStorage.clear();
    await initDatabase();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("all'inizio non c'è niente da replicare", () => {
    expect(nonReplicato()).toBe(false);
  });

  it("una scrittura lo accende", async () => {
    creaAzienda(AZIENDA);
    expect(nonReplicato()).toBe(true);
  });

  it("una cancellazione lo accende: è il caso che riportava gli appuntamenti eliminati", async () => {
    const id = creaAzienda(AZIENDA);
    segnaReplicato();
    expect(nonReplicato()).toBe(false);

    eliminaAzienda(id);

    // Una cancellazione non è una scrittura che lascia il cloud più recente di
    // quanto sembri: il cloud ha ancora la riga che qui non c'è più.
    expect(nonReplicato()).toBe(true);
  });

  it("un caricamento riuscito lo spegne", () => {
    creaAzienda(AZIENDA);
    expect(nonReplicato()).toBe(true);

    segnaReplicato();

    expect(nonReplicato()).toBe(false);
  });

  it("sopravvive a un riavvio, che è tutto il punto", async () => {
    const id = creaAzienda(AZIENDA);
    expect(nonReplicato()).toBe(true);

    // Riavvio: il modulo è ricaricato da capo, come fa l'app quando si
    // riapre. Tutto ciò che è in memoria — il contatore di versione, il
    // database — è perso; il flag no, perché sta in `localStorage`.
    vi.resetModules();
    const riavviato = await import("../src/lib/sqlite/engine");

    expect(riavviato.nonReplicato()).toBe(true);
    // E il contatore di versione, invece, è ripartito da zero: è per questo
    // che da solo non bastava.
    expect(riavviato.getVersion()).toBe(0);
    // Il database, invece, è sopravvissuto al riavvio: era già salvato.
    expect(elencaAziende().map((a) => a.id)).toContain(id);
  });

  it("un riavvio dopo il caricamento non lascia il flag acceso", async () => {
    creaAzienda(AZIENDA);
    segnaReplicato();

    vi.resetModules();
    const riavviato = await import("../src/lib/sqlite/engine");

    // Il cloud ha tutto, quindi l'app non deve riscaricare la copia locale al
    // primo contatto della nuova sessione.
    expect(riavviato.nonReplicato()).toBe(false);
  });
});
