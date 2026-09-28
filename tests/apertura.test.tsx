/**
 * Schermata di apertura: deve coprire l'app all'accesso e alla ricarica,
 * dire una frase di benvenuto e poi dissolversi rivelando il contenuto.
 *
 * Si monta il componente da solo con una durata breve: montare l'app
 * intera imporrebbe i cinque secondi veri a ogni test.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import SchermataApertura, { durataAperturaDa } from "../src/components/SchermataApertura";
import { FRASI } from "../src/lib/benvenuto";

let contenitore: HTMLDivElement;
let radice: Root | null = null;

function attendere(ms: number) {
  return act(async () => {
    await new Promise((risolvi) => setTimeout(risolvi, ms));
  });
}

beforeEach(() => {
  contenitore = document.createElement("div");
  document.body.appendChild(contenitore);
});

afterEach(async () => {
  await act(async () => radice?.unmount());
  radice = null;
  contenitore.remove();
});

/** Monta, aspetta e restituisce il testo che la schermata mostra. */
async function apri(durata: number) {
  // createRoot su un contenitore già montato è un errore: ogni apertura
  // riparte da una radice pulita.
  const precedente = radice;
  if (precedente) await act(async () => precedente.unmount());
  const nuova = createRoot(contenitore);
  radice = nuova;
  await act(async () => {
    nuova.render(
      <SchermataApertura durataMs={durata}>
        <p>il contenuto dell'app</p>
      </SchermataApertura>,
    );
  });
  return contenitore.textContent ?? "";
}

describe("Schermata di apertura", () => {
  it("copre l'app con una frase, poi la dissolve", async () => {
    const testo = await apri(40);
    expect(testo).toContain("Reportini");
    expect(testo).not.toContain("il contenuto dell'app");

    // La scena parte opaca e si accende: senza una partenza da cui
    // animare, il dissolvenza non ci sarebbe.
    const scena = contenitore.querySelector("[aria-hidden]") as HTMLElement;
    expect(scena.className).toContain("opacity-0");
    await attendere(10);
    expect(scena.className).toContain("opacity-100");

    // Passata la durata comincia il dissolvenza...
    await attendere(50);
    expect(scena.className).toContain("opacity-0");

    // ...e finito, l'app è sotto.
    await attendere(800);
    expect(contenitore.textContent).toContain("il contenuto dell'app");
  });

  it("resta in campo per cinque secondi", () => {
    // Senza variabile d'ambiente, e con una variabile mal scritta, la
    // pausa resta quella: una schermata di durata zero sarebbe un
    // lampo e l'app sembrerebbe scattare.
    expect(durataAperturaDa(undefined)).toBe(5000);
    expect(durataAperturaDa("")).toBe(5000);
    expect(durataAperturaDa("   ")).toBe(5000);
    expect(durataAperturaDa("cinque")).toBe(5000);
    expect(durataAperturaDa("-100")).toBe(5000);
    expect(durataAperturaDa("30000")).toBe(30000);
    expect(durataAperturaDa("0")).toBe(0);
  });

  it("a due aperture successive non dice sempre la stessa frase", async () => {
    // La frase è casuale a ogni caricamento, non una al giorno: altrimenti
    // ogni ricarica ripeterebbe la stessa identica frase, e il messaggio
    // diventerebbe un avviso invece di un saluto.
    const viste = new Set<string>();
    for (let apertura = 0; apertura < 4; apertura += 1) {
      viste.add(await apri(10));
      await attendere(800);
    }
    // Quattro aperture: la probabilità di quattro frasi identiche con un
    // archivio di 50 è trascurabile, quindi qui si prende un bug.
    expect(viste.size).toBeGreaterThan(1);
    expect(FRASI.length).toBeGreaterThan(20);
  });

  it("la frase mostrata viene dall'archivio delle frasi", async () => {
    const testo = await apri(10);
    const frasi = FRASI.filter((frase) => testo.includes(frase));
    expect(frasi.length).toBe(1);
  });
});
