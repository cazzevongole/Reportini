/**
 * La verifica della release pubblicata: il controllo che decide se il
 * rilascio è riuscito davvero.
 *
 * Il guasto che copre è silenzioso per costruzione — `gh` esce con codice 0
 * e il workflow va verde mentre la release è a metà, o è una bozza che
 * nessuno vede, o ha un titolo diverso. Qui si provano le regole, perché
 * l'unico momento in cui si possono provare è prima del rilascio: dopo, il
 * danno è pubblico e si scopre che l'app non si aggiorna.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { nomiIn, PACCHETTI, problemiInRelease, verifica } from "../scripts/verifica-release.mjs";

/** Una release come la pubblica il job, quando è andata bene. */
function buona(pezzi: Record<string, unknown> = {}) {
  return {
    isDraft: false,
    isPrerelease: false,
    name: "Reportini v0.3.1",
    tagName: "v0.3.1",
    assets: [
      { name: "Reportini-0.3.1.dmg" },
      { name: "Reportini-Setup-0.3.1.exe" },
      { name: "reportini_0.3.1_amd64.AppImage" },
      { name: "latest.yml" },
      { name: "latest-mac.yml" },
      { name: "latest-linux.yml" },
    ],
    ...pezzi,
  };
}

describe("Una release pubblicata e completa non ha problemi", () => {
  it("il caso buono resta buono", () => {
    expect(problemiInRelease(buona())).toEqual([]);
    // E con la lista dei file che si aveva in mano, che è come lo chiama il
    // workflow.
    expect(
      problemiInRelease(buona(), [
        "Reportini-0.3.1.dmg",
        "latest.yml",
        "latest-mac.yml",
        "latest-linux.yml",
      ]),
    ).toEqual([]);
  });
});

describe("Una bozza non è una release", () => {
  it("la bozza è un problema, anche con tutti i file dentro", () => {
    // Il caso più insidioso, perché è l'unico in cui il job va verde e la
    // release non esiste per nessuno: esiste, ma `--latest` su una bozza non
    // la pubblica.
    const problemi = problemiInRelease(buona({ isDraft: true }));
    expect(problemi).toHaveLength(1);
    expect(problemi[0]).toMatch(/bozza/i);
  });

  it("la prerelease non viene proposta come aggiornamento", () => {
    const problemi = problemiInRelease(buona({ isPrerelease: true }));
    expect(problemi.join(" ")).toMatch(/prerelease/i);
  });
});

describe("Una release a metà si vede, anche se i comandi sono riusciti", () => {
  it("mancano i tre sistemi, uno alla volta", () => {
    // Ogni pacchetto mancante va detto per nome: "manca qualcosa" non
    // dice all'utente quale piattaforma è scoperta.
    for (const { estensione, sistema } of PACCHETTI) {
      const senza = buona();
      senza.assets = senza.assets.filter((a) => !a.name.endsWith(estensione));
      const problemi = problemiInRelease(senza);
      expect(problemi).toHaveLength(1);
      expect(problemi[0]).toContain(sistema);
      expect(problemi[0]).toContain(estensione);
    }
  });

  it("mancano i tre menù dell'aggiornamento", () => {
    for (const menu of ["latest.yml", "latest-mac.yml", "latest-linux.yml"]) {
      const senza = buona();
      senza.assets = senza.assets.filter((a) => a.name !== menu);
      const problemi = problemiInRelease(senza);
      expect(problemi).toHaveLength(1);
      // La parola che riguarda l'aggiornamento: è il guasto che l'utente
      // non vede e che questa verifica esiste per trovare.
      expect(problemi[0]).toMatch(/aggiornamento/i);
    }
  });

  it("un allegato che l'upload ha rifiutato senza fermarsi", () => {
    // `gh release upload` prosegue anche quando un file fallisce: il comando
    // esce con 0 e il file manca. È il caso in cui la cartella locale e la
    // release divergono, e la release è quella che conta.
    const problemi = problemiInRelease(buona(), ["Reportini-0.3.1.dmg", "Reportini.zip"]);
    expect(problemi).toHaveLength(1);
    expect(problemi[0]).toContain("Reportini.zip");
  });

  it("il titolo è quello che l'utente legge prima di scaricare", () => {
    const problemi = problemiInRelease(buona({ name: "v0.3.1" }));
    expect(problemi).toHaveLength(1);
    expect(problemi[0]).toContain("Reportini v0.3.1");
  });
});

describe("Tutti i problemi insieme, non uno alla volta", () => {
  it("li elenca tutti, perché il log sia una lista da spuntare", () => {
    // Se il controllo si fermasse al primo, il log mostrerebbe un problema
    // e gli altri resterebbero nascosti: si correggerebbe, si rilancia, si
    // scopre il secondo. Meglio vederli tutti insieme.
    const rotta = buona({
      isDraft: true,
      isPrerelease: true,
      name: "bozza",
      assets: [],
    });
    const problemi = problemiInRelease(rotta);
    // bozza + prerelease + titolo + 3 pacchetti + 3 menù
    expect(problemi).toHaveLength(9);
  });
});

describe("I nomi in una cartella sono nomi di file", () => {
  it("una cartella che non esiste non è un errore: non c'è niente da aspettarsi", () => {
    // Il workflow chiama questo prima di scaricare gli artefatti: se la
    // cartella non c'è ancora, la verifica deve poter girare lo stesso e
    // limitarsi a controllare la release.
    expect(nomiIn("cartella-che-non-esiste")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Il guscio, provato con la release al posto di GitHub.
//
// Le funzioni pure dicono che il giudizio è giusto; questo dice che il
// giudizio diventa un codice di uscita e un messaggio. Il workflow non vede
// `problemiInRelease`, vede l'uscita del processo: se il guscio dimenticasse di
// restituire 1, il rilascio passerebbe verde con la release rotta.
//
// Il `gh` qui non è quello vero, e non è neppure un finto sul PATH: su Windows
// Node esegue solo un `.exe` senza shell, quindi un `.cmd` finto non verrebbe
// mai chiamato e il test passerebbe senza aver provato niente. Si passa
// quindi la risposta al punto in cui lo script legge.
// ---------------------------------------------------------------------------

let cartella: string;

/** Uno `scrive` che mette via ciò che è stato scritto. */
function raccolta() {
  const righe: string[] = [];
  const errori: string[] = [];
  return {
    righe,
    errori,
    log: (riga: string) => righe.push(riga),
    error: (riga: string) => errori.push(riga),
  };
}

beforeEach(() => {
  cartella = mkdtempSync(path.join(tmpdir(), "reportini-release-"));
  mkdirSync(path.join(cartella, "dist"), { recursive: true });
  writeFileSync(path.join(cartella, "dist", "Reportini-0.3.1.dmg"), "dmg");
});

afterEach(() => {
  rmSync(cartella, { recursive: true, force: true });
});

describe("Il guscio della verifica, con la release al posto di GitHub", () => {
  it("esce con 0 e dice che cosa ha verificato", () => {
    const scrive = raccolta();
    const esito = verifica("v0.3.1", path.join(cartella, "dist"), () => buona(), scrive);
    expect(esito).toBe(0);
    expect(scrive.errori).toEqual([]);
    // Un rilascio che passa in silenzio non lascia traccia di sé nel log:
    // fra sei mesi nessuno saprà se il controllo è stato eseguito.
    expect(scrive.righe.join("\n")).toMatch(/pubblicata e completa/);
  });

  it("esce con 1 e un errore marcato quando la release è una bozza", () => {
    const scrive = raccolta();
    const esito = verifica(
      "v0.3.1",
      path.join(cartella, "dist"),
      () => buona({ isDraft: true }),
      scrive,
    );
    expect(esito).toBe(1);
    // Il formato `::error::` è quello che GitHub Actions mostra in rosso
    // accanto al passo: un messaggio senza il marcatore passa inosservato.
    expect(scrive.errori.join("\n")).toMatch(/::error::.*bozza/is);
  });

  it("esce con 1 quando la release non si può leggere", () => {
    // Il caso in cui il controllo non è stato fatto: non è "tutto va bene",
    // è "non lo so", e su un rilascio la differenza è la release.
    const scrive = raccolta();
    const esito = verifica(
      "v0.3.1",
      path.join(cartella, "dist"),
      () => {
        throw new Error("release not found");
      },
      scrive,
    );
    expect(esito).toBe(1);
    expect(scrive.errori.join("\n")).toMatch(/non si può leggere/);
  });

  it("controlla anche i file che erano in cartella e non sono saliti", () => {
    const scrive = raccolta();
    const esito = verifica("v0.3.1", path.join(cartella, "dist"), () => buona(), scrive);
    expect(esito).toBe(0);
    // La cartella del workflow contiene i pacchetti: è la lista di ciò che
    // si aspettava di allegare, ed è quello che distingue una release
    // completa da una a cui manca un file.
    expect(nomiIn(path.join(cartella, "dist"))).toEqual(["Reportini-0.3.1.dmg"]);
  });

  it("senza tag lo script esce con 1, invece di dare un voto a caso", () => {
    // Qui si esegue davvero il processo, perché è l'unica cosa che non si
    // può provare dalla funzione: `main` legge gli argomenti.
    //
    // `stdio` tutto in pipe: senza, l'errore che lo script scrive -- e che è
    // un'annotazione GitHub Actions, perché lo script è pensato per la CI --
    // finisce nello stderr del test runner e la CI lo raccoglie come se fosse
    // un difetto del repository. È successo: l'annotazione "Va indicato il tag
    // della release da verificare" è comparsa sulla run che ha passato tutto.
    try {
      execFileSync("node", ["scripts/verifica-release.mjs"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
      expect.unreachable("senza tag lo script doveva fallire");
    } catch (errore) {
      expect((errore as { status?: number }).status).toBe(1);
    }
  });
});
