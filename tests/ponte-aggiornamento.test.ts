/**
 * Il ponte dell'aggiornamento, letto nei due file che lo scrivono.
 *
 * Una riga dimenticata da una parte e non dall'altra non dà nessun errore: il
 * renderer chiama un canale che nessuno gestisce, riceve silenzio, e
 * l'aggiornamento semplicemente non succede — né in fase di prova né in
 * installazione silenziosa. Lo stesso vale per un metodo del ponte dichiarato
 * in TypeScript e assente nel preload: il tipo dice che esiste, a runtime no.
 *
 * Qui il ponte non viene eseguito (ci vuole Electron): viene **letto**, e
 * confrontato. È la verifica più economica che esista su questo confine.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const radice = process.cwd();
const sorgente = (file: string) => readFileSync(path.join(radice, "electron", file), "utf8");

function canali(sorgentePreload: string): string[] {
  return [...sorgentePreload.matchAll(/ipcRenderer\.invoke\("([^"]+)"/g)].map((m) => m[1]);
}

function canaliGestiti(sorgenteMain: string): string[] {
  return [...sorgenteMain.matchAll(/ipcMain\.handle\("([^"]+)"/g)].map((m) => m[1]);
}

describe("Ponte dell'aggiornamento", () => {
  it("ogni canale che il preload invoca è gestito dal processo principale", () => {
    const invocati = canali(sorgente("preload.cjs"));
    const gestiti = new Set(canaliGestiti(sorgente("main.cjs")));

    // Il controllo non può passare per caso: se un giorno il preload smette di
    // invocare canali, il test deve accorgersene invece di restare verde.
    expect(invocati.length).toBeGreaterThan(0);
    for (const canale of invocati) {
      expect(gestiti.has(canale), `canale "${canale}" senza ipcMain.handle`).toBe(true);
    }
  });

  it("ogni canale di aggiornamento gestito dal main è invocato dal preload", () => {
    // Il contrario della riga sopra: un gestore che nessuno chiama è un canale
    // rimasto indietro in una rinomina, e la rinomina non dà nessun errore.
    const invocati = new Set(canali(sorgente("preload.cjs")));
    const dellAggiornamento = canaliGestiti(sorgente("main.cjs")).filter((c) =>
      c.startsWith("update:"),
    );
    expect(dellAggiornamento.length).toBeGreaterThan(0);
    for (const canale of dellAggiornamento) {
      expect(invocati.has(canale), `canale "${canale}" gestito ma mai invocato`).toBe(true);
    }
  });

  it("i metodi dichiarati nell'interfaccia esistono davvero nel preload", () => {
    const libreria = readFileSync(path.join(radice, "src/lib/aggiornamento.ts"), "utf8");
    const interfaccia = libreria.match(/export interface PonteAggiornamento \{([\s\S]*?)\n\}/);
    expect(interfaccia).toBeTruthy();
    const dichiarati = [...(interfaccia?.[1] ?? "").matchAll(/^ {2}(\w+)\(/gm)].map((m) => m[1]);
    expect(dichiarati.length).toBeGreaterThan(0);

    const blocco = sorgente("preload.cjs").match(/aggiornamento:\s*\{([\s\S]*?)\n {2}\}/);
    expect(blocco).toBeTruthy();
    const esposti = new Set([...(blocco?.[1] ?? "").matchAll(/(\w+):/g)].map((m) => m[1]));

    for (const metodo of dichiarati) {
      expect(esposti.has(metodo), `metodo "${metodo}" assente nel preload`).toBe(true);
    }
  });

  it("le due scelte dell'aggiornamento arrivano al processo principale", () => {
    // Le due strade dell'utente non possono finire sulla stessa: installare
    // adesso e rimandare alla chiusura sono due canali distinti, e il secondo
    // è quello che porta anche "al prossimo avvio".
    const gestiti = canaliGestiti(sorgente("main.cjs"));
    expect(gestiti).toContain("update:installa");
    expect(gestiti).toContain("update:rimanda");
  });
});
