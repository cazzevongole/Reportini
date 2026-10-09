/**
 * Il nome dell'app.
 *
 * Le due app — quella ufficiale installata e quella di prova — si aprono
 * insieme, e il nome è l'unica cosa che dice quale si sta guardando. Se resta
 * "Reportini" nel pacchetto di prova, o se i due posti che lo scrivono dicono
 * due cose diverse, **non si rompe niente**: la prova si confonde con l'app
 * vera, e si finisce per provare la cosa sbagliata. È il tipo di guasto per cui
 * in questo progetto si legge un file invece di eseguirlo.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NOME_APP, NOME_UFFICIALE, nomeAppDa } from "../src/lib/nome";
import { IDENTITA_DEV } from "../scripts/identita-desktop.mjs";

const RADICE = join(import.meta.dirname, "..");

describe("Il nome dell'app", () => {
  it("senza la variabile della build è quello ufficiale", () => {
    expect(nomeAppDa(undefined)).toBe(NOME_UFFICIALE);
    // Dichiarata e lasciata vuota vale come assente: senza questo, l'app
    // resterebbe senza nome, e a occhio sarebbe un guasto del disegno.
    expect(nomeAppDa("")).toBe(NOME_UFFICIALE);
    expect(nomeAppDa("   ")).toBe(NOME_UFFICIALE);
    // Nei test la variabile non c'è, come nella web e nell'app installata:
    // la stessa condizione in cui il nome non deve cambiare.
    expect(NOME_APP).toBe(NOME_UFFICIALE);
  });

  it("usa il nome che arriva dalla build", () => {
    expect(nomeAppDa("Reportini Dev")).toBe("Reportini Dev");
    expect(nomeAppDa("  Reportini Dev  ")).toBe("Reportini Dev");
  });

  it("index.html dice lo stesso nome", () => {
    // Il `<title>` di `index.html` è quello che si vede prima che il JavaScript
    // parta: due nomi diversi sarebbero una parola che cambia da sola appena
    // l'app si apre.
    const html = readFileSync(join(RADICE, "index.html"), "utf8");
    expect(html).toContain(`<title>${NOME_UFFICIALE}</title>`);
  });

  it("il pacchetto di prova scrive il nome in un modo solo, in due punti", () => {
    // Il nome di prova lo scrivono due cose diverse: la variabile della build
    // (dentro l'app) e l'identità del pacchetto, che riscrive la pagina
    // costruita (la barra della finestra). Non c'è niente che li tenga
    // allineati: se divergono, la stessa app si presenta in due modi.
    const workflow = readFileSync(join(RADICE, ".github", "workflows", "desktop-dev.yml"), "utf8");
    const variabile = workflow.match(/^\s*VITE_NOME_APP:\s*(.+)$/m);
    expect(variabile, "VITE_NOME_APP non è più nel workflow di prova").toBeTruthy();
    const valore = (variabile?.[1] ?? "").trim().replace(/^["']|["']$/g, "");
    expect(valore).toBe(IDENTITA_DEV.productName);
    // E non è il nome ufficiale: un pacchetto di prova con il nome dell'app
    // vera è esattamente ciò che questa variabile esiste per evitare.
    expect(IDENTITA_DEV.productName).not.toBe(NOME_UFFICIALE);
  });
});
