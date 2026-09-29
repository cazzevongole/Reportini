/**
 * Il controllo che impedisce di pubblicare un aggiornamento che non si può
 * scaricare.
 *
 * electron-updater non scarica un pacchetto: legge `latest*.yml`, ci trova il
 * nome di un file e lo va a prendere nella release. Un nome che non coincide
 * con nessun allegato è un 404, e l'app installata resta sulla versione
 * vecchia senza dirlo in nessun modo.
 *
 * Il caso su Windows era la differenza fra un trattino e un punto: il menù
 * prometteva `Reportini-Setup-0.1.24.exe` e l'allegato si chiamava
 * `Reportini.Setup.0.1.24.exe`. Su mac e Linux i nomi tornavano, quindi una
 * verifica che guardasse solo la versione — o solo due dei tre sistemi —
 * passava e il difetto restava nascosto.
 *
 * Qui lo script viene **eseguito**, non importato: è quello che vede il
 * workflow, quindi è quello che conta.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

let pacchetti: string;

/** Una release come quella che esce davvero: tre sistemi, tre menù. */
function release(nomeInstaller: string, ancheIlFile: string): void {
  writeFileSync(
    path.join(pacchetti, "latest.yml"),
    `version: 1.0.0\nfiles:\n  - url: ${nomeInstaller}\n    sha512: jxbCZLQPC+kVvs9nsGaAUd1vE/p0x1AAwHuqh+h7XpptztTJrROe51UAL2eij4MDEyTtbcI2vzhk/jOIyXBC2w==\n    size: 79024782\npath: ${nomeInstaller}\n`,
  );
  writeFileSync(
    path.join(pacchetti, "latest-mac.yml"),
    "version: 1.0.0\npath: Reportini-1.0.0-arm64-mac.zip\n",
  );
  writeFileSync(
    path.join(pacchetti, "latest-linux.yml"),
    "version: 1.0.0\npath: Reportini-1.0.0.AppImage\n",
  );
  writeFileSync(path.join(pacchetti, "Reportini-1.0.0-arm64-mac.zip"), "zip");
  writeFileSync(path.join(pacchetti, "Reportini-1.0.0.AppImage"), "appimage");
  writeFileSync(path.join(pacchetti, ancheIlFile), "installer");
}

function verifica(): { esito: number; uscita: string } {
  try {
    const uscita = execFileSync("node", ["scripts/verifica-menu-aggiornamento.mjs", pacchetti], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { esito: 0, uscita };
  } catch (errore) {
    const e = errore as { status?: number; stdout?: string; stderr?: string };
    return { esito: e.status ?? 1, uscita: `${e.stdout ?? ""}${e.stderr ?? ""}` };
  }
}

beforeEach(() => {
  pacchetti = mkdtempSync(path.join(tmpdir(), "reportini-menu-"));
});

describe("Prima di pubblicare, i menù promettono file che ci sono", () => {
  it("passa quando ogni nome promesso è un allegato", () => {
    release("Reportini-Setup-1.0.0.exe", "Reportini-Setup-1.0.0.exe");
    const { esito } = verifica();
    expect(esito).toBe(0);
  });

  it("ferma la release quando il menù promette un nome che non esiste", () => {
    // Il caso reale, trattino contro punto: il menù e l'allegato hanno nomi
    // diversi e l'aggiornamento finirebbe in un 404.
    release("Reportini-Setup-1.0.0.exe", "Reportini.Setup.1.0.0.exe");
    const { esito, uscita } = verifica();
    expect(esito).not.toBe(0);
    expect(uscita).toContain("Reportini-Setup-1.0.0.exe");
    expect(uscita).toContain("non è fra i file pubblicati");
  });

  it("ferma la release se un allegato promesso manca, anche su un solo sistema", () => {
    release("Reportini-Setup-1.0.0.exe", "Reportini-Setup-1.0.0.exe");
    rmSync(path.join(pacchetti, "Reportini-1.0.0-arm64-mac.zip"));
    const { esito, uscita } = verifica();
    expect(esito).not.toBe(0);
    expect(uscita).toContain("latest-mac.yml");
    expect(uscita).toContain("Reportini-1.0.0-arm64-mac.zip");
  });

  it("ferma la release se manca un menù: lì non si aggiornerebbe mai", () => {
    release("Reportini-Setup-1.0.0.exe", "Reportini-Setup-1.0.0.exe");
    rmSync(path.join(pacchetti, "latest-linux.yml"));
    const { esito, uscita } = verifica();
    expect(esito).not.toBe(0);
    expect(uscita).toContain("latest-linux.yml");
  });

  it("non scambia sha512 e size per nomi di file", () => {
    // Presi per nomi farebbero fallire ogni rilascio, perché nessuno dei due è
    // un allegato: un controllo troppo zelante è un controllo che non gira.
    release("Reportini-Setup-1.0.0.exe", "Reportini-Setup-1.0.0.exe");
    const { esito, uscita } = verifica();
    expect(esito).toBe(0);
    expect(uscita).not.toContain("sha512");
  });
});
