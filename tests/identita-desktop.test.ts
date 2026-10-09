/**
 * L'identità del pacchetto desktop.
 *
 * Il file che la CI riscrive per le prove — `electron/package.json` — è anche
 * il file da cui si costruisce la release ufficiale, quindi la cosa da
 * verificare non è "la trasformazione funziona" ma due cose più strette:
 *
 *   1. il manifest del repository resta quello ufficiale, perché il controllo
 *      del rilascio lo pretende e una svista qui diventa un rilascio dev
 *      pubblicato come ultima versione — cioè installato a tutti;
 *   2. l'identità dev cambia *tutte* le cose che tengono separate le due app:
 *      cartella di installazione, eseguibile, cartella dei dati, identità e
 *      canale di aggiornamento, più una versione che si riconosce da dentro.
 *
 * Niente pacchetti veri: qui si prova il giudizio, che è la parte che decide
 * se il pacchetto può essere costruito.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  IDENTITA_DEV,
  IDENTITA_UFFICIALE,
  identitaDev,
  problemiIdentita,
  suffissoDaAmbiente,
  versioneDev,
  type ManifestDesktop,
} from "../scripts/identita-desktop.mjs";

const RADICE = join(import.meta.dirname, "..");

/** Il manifest vero, quello da cui si costruisce il pacchetto ufficiale. */
function manifestDelRepository(): ManifestDesktop {
  return JSON.parse(readFileSync(join(RADICE, "electron", "package.json"), "utf8"));
}

describe("Il manifest del repository", () => {
  it("è ancora quello ufficiale", () => {
    // È la guardia del rilascio: se qualcuno applica l'identità dev in locale
    // e la committa, questo test lo dice prima che il pacchetto si costruisca.
    expect(problemiIdentita(manifestDelRepository())).toEqual([]);
  });

  it("dichiara la versione senza suffisso dev", () => {
    expect(manifestDelRepository().version).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

describe("L'identità dev applicata al manifest", () => {
  const ufficiale = manifestDelRepository();
  const dev = identitaDev(ufficiale, "dev.abc1234");

  it("cambia le cinque cose che tengono separate le due app", () => {
    // La cartella di installazione su Windows viene da `name`…
    expect(dev.name).toBe(IDENTITA_DEV.name);
    expect(dev.name).not.toBe(ufficiale.name);
    // …l'eseguibile, le scorciatoie e la cartella dei dati dal `productName`,
    // che dentro `build` vince su quello in cima al file: se restasse uguale,
    // le due app scriverebbero nella stessa cartella dei dati.
    expect(dev.productName).toBe("Reportini Dev");
    expect(dev.productName).not.toBe(ufficiale.productName);
    expect(dev.build?.productName).toBe("Reportini Dev");
    expect(dev.build?.productName).not.toBe(ufficiale.build?.productName);
    // …l'identità dell'applicazione dal `appId`.
    expect(dev.build?.appId).toBe(IDENTITA_DEV.appId);
    // …e il nome dell'installer dal bersaglio Windows.
    expect(dev.build?.win?.artifactName).toBe("Reportini-Dev-Setup-${version}.${ext}");
  });

  it("non lascia nessun canale di aggiornamento ufficiale", () => {
    // `resources/app-update.yml` — il menù che electron-updater legge per
    // sapere se c'è una versione nuova — lo scrive electron-builder dal
    // `publish` del pacchetto. Ma non basta toglierlo: senza, il fornitore
    // viene **ricavato** dal campo `repository`, che qui punta al repository
    // ufficiale, e il menù nasce lo stesso. Quindi `null` esplicito, in due
    // punti: a livello di pacchetto e sul bersaglio, che ha la precedenza.
    expect(dev.build?.publish).toBeNull();
    expect((dev.build?.nsis as { publish?: unknown } | undefined)?.publish).toBeNull();
    expect(ufficiale.build?.publish).toBeDefined();
    expect(ufficiale.build?.publish).not.toBeNull();
  });

  it("porta la versione del pacchetto ufficiale più il suffisso", () => {
    expect(dev.version).toBe(`${ufficiale.version}-dev.abc1234`);
  });

  it("lascia intatto il resto del pacchetto", () => {
    // Il pacchetto dev è lo stesso pacchetto: cambia solo chi dice di essere.
    // Nel bersaglio Windows cambia solo il nome del file: il tipo di
    // pacchetto — l'installer NSIS — resta quello dell'ufficiale.
    expect(dev.main).toBe(ufficiale.main);
    expect(dev.build?.files).toEqual(ufficiale.build?.files);
    expect(dev.build?.win?.target).toEqual(
      (ufficiale.build?.win as { target?: unknown } | undefined)?.target,
    );
  });

  it("non tocca il manifest da cui è ricavata", () => {
    // L'originale lo rilegge il rilascio ufficiale: se la trasformazione lo
    // modificasse in loco, il controllo successivo troverebbe già i nomi dev.
    expect(ufficiale.name).toBe(IDENTITA_UFFICIALE.name);
    expect(ufficiale.productName).toBe(IDENTITA_UFFICIALE.productName);
    expect(ufficiale.build?.productName).toBe(IDENTITA_UFFICIALE.productName);
    expect(ufficiale.build?.appId).toBe(IDENTITA_UFFICIALE.appId);
    expect(ufficiale.build?.publish).toBeDefined();
  });

  it("applicata due volte non accumula suffissi", () => {
    const due = identitaDev(dev, "dev.abc1234");
    expect(due.version).toBe(dev.version);
  });
});

describe("Il controllo dell'identità ufficiale", () => {
  it("nomina ogni cosa che non va, non solo la prima", () => {
    const problemi = problemiIdentita(identitaDev(manifestDelRepository(), "dev.abc1234"));
    expect(problemi).toHaveLength(6);
    expect(problemi.join("\n")).toMatch(/name/);
    expect(problemi.join("\n")).toMatch(/productName/);
    expect(problemi.join("\n")).toMatch(/build\.productName/);
    expect(problemi.join("\n")).toMatch(/appId/);
    expect(problemi.join("\n")).toMatch(/suffisso dev/);
    expect(problemi.join("\n")).toMatch(/publish/);
  });

  it("riconosce un pacchetto ufficiale senza la sezione publish", () => {
    // Un pacchetto senza menù dell'aggiornamento si installa e funziona, ma
    // non si aggiorna più: è un guasto silenzioso, e va fermato qui.
    const senzaPublish = structuredClone(manifestDelRepository());
    delete senzaPublish.build?.publish;
    expect(problemiIdentita(senzaPublish).join("\n")).toMatch(/manca la sezione publish/);
  });
});

describe("Il pacchetto dev e l'aggiornamento automatico", () => {
  it("l'app non accende l'aggiornatore quando il menù non c'è", () => {
    // L'identità dev toglie `publish`, quindi il pacchetto nasce senza
    // `resources/app-update.yml`. Senza questo controllo nel main process,
    // electron-updater verrebbe comunque acceso e fallirebbe a ogni avvio.
    //
    // Qui il main process non si può eseguire (ci vuole Electron): si legge,
    // come già fa tests/ponte-aggiornamento.test.ts per il ponte. È la verifica
    // più economica che esista su questo confine.
    const main = readFileSync(join(RADICE, "electron", "main.cjs"), "utf8");
    const inizio = main.indexOf("function caricaAggiornatore()");
    expect(inizio, "caricaAggiornatore non c'è più in main.cjs").toBeGreaterThan(-1);
    const corpo = main.slice(inizio, inizio + 800);
    expect(corpo).toContain("app-update.yml");
    expect(corpo).toMatch(/return null;/);
  });
});

describe("La versione dev", () => {
  it("parte dalla versione ufficiale, senza il suffisso di prima", () => {
    expect(versioneDev("0.4.3", "dev.abc1234")).toBe("0.4.3-dev.abc1234");
    expect(versioneDev("0.4.3-dev.vecchio", "dev.abc1234")).toBe("0.4.3-dev.abc1234");
  });

  it("rifiuta un suffisso che semver non accetta, e dice perché", () => {
    // Senza questo controllo il fallimento arriverebbe da electron-builder,
    // con un messaggio su semver che non nomina ciò che si è scritto.
    expect(() => versioneDev("0.4.3", "dev abc")).toThrow(/Suffisso della versione non ammesso/);
    expect(() => versioneDev("0.4.3", "")).toThrow(/non ammesso/);
  });

  it("prende il suffisso scritto, poi lo sha della CI, poi quello di git", () => {
    expect(suffissoDaAmbiente(["mio.suffisso"], { SUFFISSO: "altro" })).toBe("mio.suffisso");
    expect(suffissoDaAmbiente([], { SUFFISSO: "altro" })).toBe("altro");
    expect(suffissoDaAmbiente([], { GITHUB_SHA: "abcdef1234567890" })).toBe("dev.abcdef1");
    // In un repository git vero l'ultima strada risponde comunque qualcosa di
    // riconoscibile: è il caso di chi lo lancia a mano.
    expect(suffissoDaAmbiente([], {})).toMatch(/^dev\.[0-9a-f]+$|^dev$/);
  });
});
