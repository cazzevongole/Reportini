/**
 * Il colore degli eventi è una scelta dell'utente che sta nel **database** —
 * quindi sale nel cloud e segue l'utenza su un altro dispositivo — e finisce
 * in una richiesta a Google. Qui si controllano la palette e la persistenza;
 * il collegamento scelta → evento è coperto dai test end-to-end del calendario.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import "fake-indexeddb/auto";

// In un ambiente jsdom sotto vitest sql.js carica il wasm da filesystem, non
// dalla rete: senza questo mock non trova il file e ogni test muore subito.
vi.mock("sql.js/dist/sql-wasm.wasm?url", () => ({
  default: `${process.cwd()}/node_modules/sql.js/dist/sql-wasm.wasm`,
}));

import {
  COLORI_PREDEFINITI,
  ETICHETTA_STATO,
  PALETTE,
  colorePer,
  idValido,
  leggiColori,
  ripristinaColori,
  scriviColore,
} from "../src/lib/google/colori";
import { eliminaPreferenza, leggiPreferenza, scriviPreferenza } from "../src/lib/repo";
import type { StatoAttivita } from "../src/lib/types";

const CHIAVE = "colori-stato";
const STATI: StatoAttivita[] = ["in-attesa", "confermato", "annullato"];

describe("Palette di Google Calendar", () => {
  it("contiene gli undici ID della palette, come stringhe", () => {
    expect(PALETTE).toHaveLength(11);
    expect(PALETTE.map((c) => c.id)).toEqual([
      "1",
      "2",
      "3",
      "4",
      "5",
      "6",
      "7",
      "8",
      "9",
      "10",
      "11",
    ]);
    // Nell'API `colorId` è una stringa: un numero qui diventerebbe un 400.
    for (const colore of PALETTE) expect(typeof colore.id).toBe("string");
  });

  it("distingue un ID inventato da uno vero", () => {
    expect(idValido("6")).toBe(true);
    expect(idValido("12")).toBe(false);
    expect(idValido("0")).toBe(false);
    expect(idValido("")).toBe(false);
    // Soprattutto i numeri, che è la forma in cui l'errore si nasconderebbe.
    expect(idValido(6)).toBe(false);
    expect(idValido(null)).toBe(false);
    expect(idValido(undefined)).toBe(false);
  });

  it("ogni colore ha un nome e un campione riconoscibile", () => {
    for (const colore of PALETTE) {
      expect(colore.campione).toMatch(/^#[0-9a-f]{6}$/);
      expect(colore.nome.length).toBeGreaterThan(0);
    }
  });

  it("i tre stati hanno un nome per l'utente e un colore iniziale valido", () => {
    for (const stato of STATI) {
      expect(ETICHETTA_STATO[stato].length).toBeGreaterThan(0);
      expect(colorePer(COLORI_PREDEFINITI[stato])).not.toBeNull();
    }
    // E i predefiniti sono tre tinte diverse fra loro.
    expect(new Set(STATI.map((s) => COLORI_PREDEFINITI[s])).size).toBe(3);
  });
});

describe("Colori nel database", () => {
  beforeEach(async () => {
    const { initDatabase } = await import("../src/lib/sqlite/engine");
    await initDatabase();
    // Partenza pulita: nessuna preferenza lasciata dal test precedente.
    eliminaPreferenza(CHIAVE);
  });

  it("senza scelte vale il colore iniziale di ogni stato", () => {
    const colori = leggiColori();
    for (const stato of STATI) expect(colori[stato]).toBe(COLORI_PREDEFINITI[stato]);
  });

  it("la scelta vale per uno stato solo e sopravvive alla rilettura", () => {
    scriviColore("in-attesa", "9");

    const colori = leggiColori();
    expect(colori["in-attesa"]).toBe("9");
    expect(colori.confermato).toBe(COLORI_PREDEFINITI.confermato);
    expect(colori.annullato).toBe(COLORI_PREDEFINITI.annullato);
  });

  it("una preferenza scritta due volte vale solo l'ultima", () => {
    scriviColore("confermato", "3");
    scriviColore("confermato", "7");
    expect(leggiColori().confermato).toBe("7");
  });

  it("non scrive un ID che non sta nella palette", () => {
    scriviColore("in-attesa", "99");
    // Nessuna riga: un ID inventato verrebbe rifiutato da Google e farebbe
    // fallire la pubblicazione dell'attivita.
    expect(leggiPreferenza(CHIAVE)).toBeNull();
    expect(leggiColori()["in-attesa"]).toBe(COLORI_PREDEFINITI["in-attesa"]);
  });

  it("un valore corrotto nel database non impedisce la lettura", () => {
    // Tutto quello che può trovarsi in una copia ripristinata da un backup, o
    // scritta da una versione diversa dell'app.
    const sporchi = [
      "non è json",
      "42",
      "[1, 2, 3]",
      JSON.stringify({ "in-attesa": 99 }), // numero, non stringa
      JSON.stringify({ "in-attesa": "99" }), // ID inesistente
      JSON.stringify({ inesistente: "1" }),
      JSON.stringify({}),
    ];

    for (const sporco of sporchi) {
      scriviPreferenza(CHIAVE, sporco);
      const colori = leggiColori();
      for (const stato of STATI) {
        expect(idValido(colori[stato])).toBe(true);
      }
    }
  });

  it("un solo stato valido tiene quello e rimedia agli altri", () => {
    scriviPreferenza(CHIAVE, JSON.stringify({ "in-attesa": "5", confermato: 42 }));

    const colori = leggiColori();
    expect(colori["in-attesa"]).toBe("5");
    expect(colori.confermato).toBe(COLORI_PREDEFINITI.confermato);
    expect(colori.annullato).toBe(COLORI_PREDEFINITI.annullato);
  });

  it("ripristinare porta ai colori iniziali", () => {
    scriviColore("in-attesa", "9");
    scriviColore("annullato", "4");
    expect(leggiColori()["in-attesa"]).toBe("9");

    ripristinaColori();

    expect(leggiPreferenza(CHIAVE)).toBeNull();
    const colori = leggiColori();
    for (const stato of STATI) expect(colori[stato]).toBe(COLORI_PREDEFINITI[stato]);
  });
});
