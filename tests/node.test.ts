/**
 * Il controllo che sta davanti ai test: che cosa accetta e che cosa no.
 *
 * È il posto dove si sbaglia in silenzio. Un controllo che sbaglia fa due
 * cose a caso: se rifiuta una versione buona, l'utente crede che il progetto
 * sia rotto e prova a reinstallare tutto; se accetta una versione troppo
 * vecchia, torna l'errore di prima (`ERR_REQUIRE_ESM` dentro un worker), cioè
 * la ragione per cui questo controllo esiste.
 */
import { describe, expect, it } from "vitest";
import { messaggio, troppoVecchio } from "../scripts/verifica-node.mjs";

describe("La versione di Node per i test", () => {
  it("accetta da 22.12 in su", () => {
    expect(troppoVecchio("22.12.0")).toBe(false);
    expect(troppoVecchio("22.20.1")).toBe(false);
    expect(troppoVecchio("24.0.0")).toBe(false);
    expect(troppoVecchio("v24.21.0")).toBe(false); // `node --version` mette la v
    expect(troppoVecchio("23.0.0")).toBe(false);
  });

  it("rifiuta sotto la 22.12, che è dove require() non sa caricare un ESM", () => {
    expect(troppoVecchio("22.9.0")).toBe(true);
    expect(troppoVecchio("22.0.0")).toBe(true);
    expect(troppoVecchio("20.19.0")).toBe(true);
    expect(troppoVecchio("18.20.4")).toBe(true);
  });

  it("un numero che non si riconosce viene rifiutato, non passato", () => {
    // Meglio fermarsi che dire «va bene» a una versione che non è stata letta:
    // il caso sconosciuto è quello che non sappiamo spiegare.
    expect(troppoVecchio("")).toBe(true);
    expect(troppoVecchio("versione")).toBe(true);
    expect(troppoVecchio(undefined)).toBe(true);
  });

  it("il messaggio dice la versione che manca e il rimedio", () => {
    const testo = messaggio("22.9.0");
    expect(testo).toContain("22.12");
    expect(testo).toContain("22.9.0");
    // Il rimedio è un comando, non un consiglio: chi legge deve poter
    // incollarlo e andare.
    expect(testo).toContain("npx -y node@24");
  });
});
