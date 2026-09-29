/**
 * Il budget sulla dimensione serve a una cosa sola: accorgersi che qualcosa sia
 * tornato dentro il primo caricamento. Il caso reale è il bundle principale
 * che si gonfia di qualche decina di kB perché una dipendenza ha fatto un
 * upgrade, e nessuno se ne accorge guardando i numeri di Vite.
 *
 * Qui si prova la classificazione (che cosa è "primo caricamento" e che cosa
 * no) e la verifica del budget, costruendo una `dist` finita in una cartella
 * temporanea. I byte sono casuali: una sequenza di lettere uguali si
 * comprime a quasi niente e il test passerebbe anche con un file enorme.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  analizzaDist,
  iconeDelManifest,
  riferimentiPagina,
  verifica,
  type Analisi,
} from "../scripts/dimensioni.mjs";

let cartella = "";

beforeEach(() => {
  cartella = mkdtempSync(join(tmpdir(), "reportini-dimensioni-"));
});

afterEach(() => {
  rmSync(cartella, { recursive: true, force: true });
});

/** Scrive una `dist` fitta e restituisce il percorso. */
function scrivi(files: Record<string, number | string>): string {
  mkdirSync(join(cartella, "assets"), { recursive: true });
  for (const [nome, contenuto] of Object.entries(files)) {
    const p = join(cartella, nome);
    mkdirSync(join(p, ".."), { recursive: true });
    writeFileSync(p, typeof contenuto === "number" ? randomBytes(contenuto) : contenuto);
  }
  return cartella;
}

const PAGINA = [
  "<!doctype html><html><head>",
  '<link rel="icon" href="/favicon.svg" />',
  '<link rel="manifest" href="/manifest.webmanifest" />',
  "</head><body>",
  '<script type="module" src="/assets/principale-aaa.js"></script>',
  "</body></html>",
].join("");

const MANIFEST = JSON.stringify({ name: "Reportini", icons: [{ src: "/icon-192.png" }] });

describe("Che cosa conta come primo caricamento", () => {
  it("prende lo script e il foglio di stile citati nell'HTML", () => {
    const html =
      '<link rel="stylesheet" href="/assets/stile-bbb.css" />' +
      '<script type="module" src="/assets/principale-aaa.js"></script>';
    const trovati = riferimentiPagina(html);
    expect([...trovati].sort()).toEqual(["assets/principale-aaa.js", "assets/stile-bbb.css"]);
  });

  it("accetta i percorsi relativi della build di Electron", () => {
    // Su file:// un percorso assoluto punterebbe alla radice del disco, quindi
    // la build di Electron usa base relative: vanno lette uguale.
    const trovati = riferimentiPagina('<script type="module" src="./assets/principale-aaa.js">');
    expect([...trovati]).toEqual(["assets/principale-aaa.js"]);
  });

  it("ignora ciò che viene da un altro dominio", () => {
    // Non lo scarica il pacchetto, quindi non è un peso che controlliamo.
    const trovati = riferimentiPagina(
      '<link rel="preconnect" href="https://accounts.google.com" />' +
        '<script src="https://cdn.esempio.it/roba.js"></script>',
    );
    expect([...trovati]).toEqual([]);
  });

  it("toglie query e frammenti dal nome", () => {
    const trovati = riferimentiPagina('<script src="/assets/a.js?v=3#inizio"></script>');
    expect([...trovati]).toEqual(["assets/a.js"]);
  });

  it("non mette tra le icone un manifest illeggibile", () => {
    // Meglio nessuna icona che un'eccezione: un manifest scritto male non deve
    // far saltare la misura di tutta la build.
    expect(iconeDelManifest("{ questo non è JSON")).toEqual(new Set());
  });
});

describe("Analisi di una build", () => {
  it("separa pagina, icone e ciò che arriva dopo", () => {
    scrivi({
      "index.html": PAGINA,
      "manifest.webmanifest": MANIFEST,
      "favicon.svg": "<svg/>",
      "icon-192.png": 2000,
      "assets/principale-aaa.js": 40_000,
      "assets/sql-wasm-ccc.js": 30_000,
    });
    const analisi = analizzaDist(cartella);

    const nomi = (gruppo: Analisi["pagina"]) => gruppo.map((v) => v.nome).sort();
    expect(nomi(analisi.pagina)).toEqual([
      "assets/principale-aaa.js",
      "favicon.svg",
      "index.html",
      "manifest.webmanifest",
    ]);
    // L'icona non è nell'HTML: arriva solo se l'utente installa l'app, e
    // contare 2 kB nel primo caricamento sarebbe un numero che non esiste.
    expect(nomi(analisi.installazione)).toEqual(["icon-192.png"]);
    expect(nomi(analisi.dopo)).toEqual(["assets/sql-wasm-ccc.js"]);
  });

  it("somma ogni gruppo per conto suo", () => {
    scrivi({
      "index.html": PAGINA,
      "manifest.webmanifest": MANIFEST,
      "favicon.svg": "<svg/>",
      "icon-192.png": 2000,
      "assets/principale-aaa.js": 40_000,
    });
    const analisi = analizzaDist(cartella);
    const atteso = (gruppo: Analisi["pagina"]) => gruppo.reduce((totale, v) => totale + v.gzip, 0);
    expect(analisi.gzipPagina).toBe(atteso(analisi.pagina));
    expect(analisi.gzipInstallazione).toBe(atteso(analisi.installazione));
    expect(analisi.gzipDopo).toBe(atteso(analisi.dopo));
  });

  it("rifiuta una cartella senza index.html", () => {
    // I numeri di una build non fatta non sono numeri: meglio fermarsi che
    // mostrare uno zero e far credere che tutto vada bene.
    expect(() => analizzaDist(cartella)).toThrow(/index\.html/);
  });
});

describe("Verifica del budget", () => {
  const analisi = (p: Partial<Analisi>): Analisi =>
    ({
      pagina: [],
      installazione: [],
      dopo: [],
      gzipPagina: 0,
      gzipInstallazione: 0,
      gzipDopo: 0,
      ...p,
    }) as Analisi;

  it("non segnala nulla quando tutto sta sotto", () => {
    expect(
      verifica(analisi({ gzipPagina: 1000, gzipInstallazione: 1000, gzipDopo: 1000 })),
    ).toEqual([]);
  });

  it("accetta esattamente il tetto", () => {
    // Il tetto è un limite, non un divieto: arrivarci non è ancora un problema.
    // Il caso qui è il gruppo di mezzo, che è l'unico dei tre la cui soglia
    // non viene toccata mai dagli altri due.
    expect(
      verifica(analisi({ gzipPagina: 1, gzipInstallazione: 5000, gzipDopo: 1 }), 5000, 5000, 5000),
    ).toEqual([]);
  });

  it("segnala di quanto il primo caricamento è andato oltre", () => {
    const problemi = verifica(analisi({ gzipPagina: 5001 }), 5000, 99_999, 99_999);
    expect(problemi).toHaveLength(1);
    expect(problemi[0]).toContain("Primo caricamento");
    // Il messaggio deve dire quanto manca da togliere, altrimenti chi legge il
    // log deve fare la differenza a mano per capire quanto è grave.
    expect(problemi[0]).toMatch(/da togliere/);
  });

  it("segnala ogni gruppo oltre il proprio tetto", () => {
    // Tetti piccoli e uguali: il solo gruppo gonfio deve essere quello citato,
    // altrimenti la frase non serve a distinguere i tre casi.
    const problemi = verifica(
      analisi({ gzipPagina: 1, gzipInstallazione: 1, gzipDopo: 99_999 }),
      5000,
      5000,
      5000,
    );
    expect(problemi).toHaveLength(1);
    expect(problemi[0]).toContain("Dopo l'accesso");
  });
});
