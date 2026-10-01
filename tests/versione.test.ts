/**
 * Controllo versione: è lo script che fa scoppiare il rilascio se il tag
 * e la versione nei package.json non tornano. Un pacchetto pubblicato con
 * un numero diverso da quello del tag non si può più correggere, quindi il
 * controllo deve essere severo e leggibile.
 *
 * L'alzata si prova su una copia in una cartella temporanea, non sul
 * repository: prima non era possibile provarla e i tre livelli restavano
 * una cosa da verificare a occhio.
 */
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { problemi } from "../scripts/versione.mjs";

const SORGENTE = "package.json";
const ECO = "electron/package.json";
const SCRIPT = "scripts/versione.mjs";

const versione = (file: string) => JSON.parse(readFileSync(file, "utf8")).version as string;

/** Il controllo del tag in un processo figlio, con l'ambiente che il rilascio usa. */
function controlla(ref: { nome: string; tipo: string } | null): { esito: number; uscita: string } {
  try {
    const uscita = execFileSync("node", [SCRIPT], {
      encoding: "utf8",
      env: {
        ...process.env,
        GITHUB_REF_NAME: ref?.nome ?? "",
        GITHUB_REF_TYPE: ref?.tipo ?? "",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { esito: 0, uscita };
  } catch (errore) {
    const e = errore as { status: number; stderr: Buffer };
    return { esito: e.status, uscita: e.stderr.toString() };
  }
}

/**
 * Un albero minimo in cui lo script può lavorare, con una versione nota.
 *
 * `partiDa` è il punto di partenza esatto, così le aspettative non cambiano
 * a ogni rilascio: quello che si prova è la regola dell'incremento, non il
 * numero di oggi.
 */
function scenario(partiDa: string): string {
  const cartella = mkdtempSync(join(tmpdir(), "reportini-versione-"));
  mkdirSync(join(cartella, "electron"), { recursive: true });
  mkdirSync(join(cartella, "scripts"), { recursive: true });
  writeFileSync(join(cartella, SORGENTE), JSON.stringify({ name: "x", version: partiDa }, null, 2));
  writeFileSync(join(cartella, ECO), JSON.stringify({ name: "y", version: partiDa }, null, 2));
  writeFileSync(join(cartella, SCRIPT), readFileSync(SCRIPT));
  return cartella;
}

const alzaIn = (cartella: string, livello: string) =>
  execFileSync("node", ["scripts/versione.mjs", livello], { cwd: cartella, stdio: "pipe" });

const leggiVersione = (cartella: string, file: string) =>
  JSON.parse(readFileSync(join(cartella, file), "utf8")).version as string;

describe("L'ordine in .rilascio", () => {
  it("il livello viene da lì, e vale più della riga di comando", () => {
    // Il caso per cui il file esiste: il workflow rilascia sempre con patch,
    // e un modello dati che cambia deve uscire con un numero che lo dica.
    const cartella = scenario("0.8.8");
    try {
      writeFileSync(join(cartella, ".rilascio"), "minor\n");
      execFileSync("node", ["scripts/versione.mjs", "patch"], { cwd: cartella, stdio: "pipe" });
      expect(leggiVersione(cartella, SORGENTE)).toBe("0.9.0");
    } finally {
      rmSync(cartella, { recursive: true, force: true });
    }
  });

  it("dopo l'uso sparisce, o il rilascio dopo leverebbe minor due volte", () => {
    const cartella = scenario("0.8.8");
    try {
      writeFileSync(join(cartella, ".rilascio"), "minor");
      alzaIn(cartella, "patch");
      expect(existsSync(join(cartella, ".rilascio"))).toBe(false);
    } finally {
      rmSync(cartella, { recursive: true, force: true });
    }
  });

  it("se c'è ma non è un livello, si ferma invece di tirare a indovinare", () => {
    // La metà peggiore sarebbe un fallback sul patch: si pubblicherebbe un
    // numero che nessuno ha chiesto, e non ci sarebbe più modo di sapere che
    // l'ordine era stato scritto male.
    const cartella = scenario("0.8.8");
    try {
      writeFileSync(join(cartella, ".rilascio"), "enorme");
      expect(() =>
        execFileSync("node", ["scripts/versione.mjs", "patch"], { cwd: cartella, stdio: "pipe" }),
      ).toThrow();
      expect(leggiVersione(cartella, SORGENTE)).toBe("0.8.8");
    } finally {
      rmSync(cartella, { recursive: true, force: true });
    }
  });

  it("un file vuoto non è un ordine", () => {
    const cartella = scenario("0.8.8");
    try {
      writeFileSync(join(cartella, ".rilascio"), "\n");
      expect(
        execFileSync("node", ["scripts/versione.mjs"], { cwd: cartella, encoding: "utf8" }),
      ).toContain("versione coerente: 0.8.8");
    } finally {
      rmSync(cartella, { recursive: true, force: true });
    }
  });

  it("il controllo non alza niente, anche con un ordine in giro", () => {
    // Il difetto che è costato un rilascio: il job che impacchetta esegue
    // questo script per confrontare la versione con il tag, e nel tag c'era
    // ancora `.rilascio`. Il controllo ha letto l'ordine e ha fatto
    // 0.3.0 → 0.4.0, così i pacchetti sono usciti col numero sbagliato sotto
    // un tag che diceva un altro numero: un rilascio che non si può più
    // correggere. Senza argomenti non si scrive niente, e l'ordine resta
    // intatto per chi verrà a eseguirlo davvero.
    const cartella = scenario("0.8.8");
    try {
      writeFileSync(join(cartella, ".rilascio"), "major");
      const uscita = execFileSync("node", ["scripts/versione.mjs"], {
        cwd: cartella,
        encoding: "utf8",
      });
      expect(uscita).toContain("versione coerente: 0.8.8");
      expect(leggiVersione(cartella, SORGENTE)).toBe("0.8.8");
      expect(leggiVersione(cartella, ECO)).toBe("0.8.8");
      // E l'ordine non è stato consumato: consumarlo sarebbe stato un altro
      // modo di alzare la versione al momento sbagliato.
      expect(existsSync(join(cartella, ".rilascio"))).toBe(true);
    } finally {
      rmSync(cartella, { recursive: true, force: true });
    }
  });
});

describe("Versione del pacchetto", () => {
  it("è la stessa nel pacchetto principale e in quello di Electron", () => {
    expect(versione(ECO)).toBe(versione(SORGENTE));
  });

  it("passa quando non c'è un tag da controllare", () => {
    const { esito, uscita } = controlla(null);
    expect(esito).toBe(0);
    expect(uscita).toContain(versione(SORGENTE));
  });

  it("su un branch non guarda il nome del branch come se fosse un tag", () => {
    // Il run di versionazione parte da un push su master: senza questa
    // distinzione ogni merge si bloccherebbe.
    const { esito, uscita } = controlla({ nome: "master", tipo: "branch" });
    expect(esito).toBe(0);
    expect(uscita).toContain(versione(SORGENTE));
  });

  it("passa quando il tag corrisponde alla versione", () => {
    const { esito } = controlla({ nome: `v${versione(SORGENTE)}`, tipo: "tag" });
    expect(esito).toBe(0);
  });

  it("blocca un tag che non corrisponde alla versione", () => {
    const { esito, uscita } = controlla({ nome: "v99.0.0", tipo: "tag" });
    expect(esito).toBe(1);
    expect(uscita).toContain("v99.0.0");
    expect(uscita).toContain(versione(SORGENTE));
  });

  it("rifiuta un livello di incremento che non esiste", () => {
    expect(() =>
      execFileSync("node", [SCRIPT, "enorme"], { stdio: ["ignore", "pipe", "pipe"] }),
    ).toThrow();
  });

  it.each([
    ["patch", "0.8.9"],
    ["minor", "0.9.0"],
    ["major", "1.0.0"],
  ])("il livello %s porta 0.8.8 a %s", (livello, atteso) => {
    const cartella = scenario("0.8.8");
    try {
      alzaIn(cartella, livello);
      expect(leggiVersione(cartella, SORGENTE)).toBe(atteso);
    } finally {
      rmSync(cartella, { recursive: true, force: true });
    }
  });

  it("l'eco di Electron non viene lasciata indietro", () => {
    // È la ragione per cui il file c'è: electron-builder legge la versione da
    // lì, quindi alzare una copia e non l'altra produrrebbe pacchetti col
    // numero vecchio, pubblicati sotto un tag nuovo.
    const cartella = scenario("0.8.8");
    try {
      alzaIn(cartella, "patch");
      expect(leggiVersione(cartella, ECO)).toBe(leggiVersione(cartella, SORGENTE));
    } finally {
      rmSync(cartella, { recursive: true, force: true });
    }
  });

  it("un'eco disallineata viene segnalata, non ignorata", () => {
    // La funzione è quella che decide: senza un caso che la provi, un'eco
    // dimenticata passerebbe e il difetto resterebbe nascosto.
    const errori = problemi({ versione: "1.0.0", eco: "0.9.0" });
    expect(errori).toHaveLength(1);
    expect(errori[0]).toContain("0.9.0");
  });

  it("un tag e un'eco disallineati si vedono insieme", () => {
    // I due problemi insieme sono la situazione che il rilascio deve
    // fermare: si elencano entrambi, perché uno solo è già un motivo per
    // fermarsi e non serve indugiare a scoprire l'altro dopo.
    const errori = problemi({ versione: "1.0.0", eco: "0.9.0", tag: "v2.0.0" });
    expect(errori).toHaveLength(2);
  });
});
