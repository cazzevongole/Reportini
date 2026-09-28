/**
 * Controllo versione: è lo script che fa scoppiare il rilascio se il tag
 * e la versione nei package.json non tornano. Un pacchetto pubblicato con
 * un numero diverso da quello del tag non si può più correggere, quindi il
 * controllo deve essere severo e leggibile.
 */
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const versione = (file: string) => JSON.parse(readFileSync(file, "utf8")).version as string;

function controlla(tag?: string): { esito: number; uscita: string } {
  try {
    const uscita = execFileSync("node", ["scripts/versione-check.mjs"], {
      encoding: "utf8",
      env: { ...process.env, GITHUB_REF_NAME: tag ?? "" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { esito: 0, uscita };
  } catch (errore) {
    const e = errore as { status: number; stderr: Buffer };
    return { esito: e.status, uscita: e.stderr.toString() };
  }
}

describe("Versione del pacchetto", () => {
  it("è la stessa nel pacchetto principale e in quello di Electron", () => {
    expect(versione("electron/package.json")).toBe(versione("package.json"));
  });

  it("passa quando non c'è un tag da controllare", () => {
    const { esito, uscita } = controlla();
    expect(esito).toBe(0);
    expect(uscita).toContain(versione("package.json"));
  });

  it("passa quando il tag corrisponde alla versione", () => {
    const { esito } = controlla(`v${versione("package.json")}`);
    expect(esito).toBe(0);
  });

  it("blocca un tag che non corrisponde alla versione", () => {
    const { esito, uscita } = controlla("v99.0.0");
    expect(esito).toBe(1);
    expect(uscita).toContain("v99.0.0");
    expect(uscita).toContain(versione("package.json"));
  });

  it("rifiuta un livello di incremento che non esiste", () => {
    expect(() =>
      execFileSync("node", ["scripts/version.mjs", "enorme"], { stdio: ["ignore", "pipe", "pipe"] }),
    ).toThrow();
  });
});
