/**
 * Il rilascio è l'unica parte di questo progetto che gira una sola volta per
 * versione e fa fatica a essere verificata in tempo utile: quando si rompe,
 * la release è già a metà e il danno è pubblico.
 *
 * Qui non si prova GitHub Actions — si prova la **promessa** che il testo del
 * workflow fa, leggendolo come un file. È la stessa tecnica di
 * `ponte-aggiornamento.test.ts`: il guasto è silenzioso (nessun errore, solo
 * una release che non si aggiorna) e l'unico modo di accorgersene prima è
 * guardare.
 *
 * I comandi sono su più righe, con i `\` di continuazione: un test che cerca
 * una riga intera si romperebbe la prima volta che qualcuno formatta il
 * comando su due righe, senza che nessun comportamento sia cambiato. Qui si
 * legge il **blocco** e ci si cercano dentro i comandi.
 */
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const WORKFLOW = ".github/workflows/release-electron.yml";
const testo = readFileSync(WORKFLOW, "utf-8");

/**
 * Il testo da una riga in poi, con i `\` di continuazione tolti.
 *
 * Tolgere i `\` è quello che rende i comandi riconoscibili: `gh release edit
 * "$VERSIONE" \` seguito da `--title` è un comando solo, e cercarlo diventa
 * cercare la sua testa e i suoi flag nella stessa stringa.
 *
 * `\r?\n` e non `\n`: su un working copy Windows con `core.autocrlf` il file
 * arriva qui in CRLF, e un `\` seguito da CR e LF non è più una continuazione
 * — il test diventava rosso per come era scritto il file, non per quello che
 * il workflow fa. Nel repository (e sul runner, che parte dal repository) il
 * file è in LF: la forma che conta è quella, e questa riga la accetta
 * comunque.
 */
function da(segno: string) {
  const indice = testo.indexOf(segno);
  expect(indice, `non trovo "${segno}" nel workflow`).toBeGreaterThan(-1);
  return testo.slice(indice).replace(/ \\\r?\n\s*/g, " ");
}

describe("Il rilascio desktop sopravvive a una release che esiste già", () => {
  it("non chiama gh release create senza aver controllato prima", () => {
    // Il punto esatto del guasto: `gh release create` su un tag già
    // pubblicato esce con codice 1. Il job falliva e i pacchetti già
    // costruiti non arrivavano da nessuna parte.
    const indiceControllo = testo.indexOf('gh release view "$VERSIONE"');
    const indiceCreazione = testo.indexOf('gh release create "$VERSIONE"');
    expect(indiceControllo).toBeGreaterThan(-1);
    expect(indiceCreazione).toBeGreaterThan(-1);
    expect(indiceControllo).toBeLessThan(indiceCreazione);
    // E il controllo è dentro un `if`: due comandi in fila significherebbero
    // che il controllo è decorativo.
    const inizioRiga = testo.lastIndexOf("\n", indiceControllo) + 1;
    expect(testo.lastIndexOf("if ", indiceControllo)).toBeGreaterThan(inizioRiga - 1);
  });

  it("carica sopra gli allegati invece di fallire sul nome già preso", () => {
    const blocco = da('gh release view "$VERSIONE" >/dev/null 2>&1; then');
    expect(blocco).toContain('gh release upload "$VERSIONE" dist/* --clobber');
    // Senza --clobber anche l'upload fallirebbe: un allegato con lo stesso
    // nome non si sostituisce, si rifiuta.
  });

  it('rimette titolo, pubblicazione e "latest" quando la release c\'era già', () => {
    // Sono le tre cose che un'altra esecuzione può aver lasciato indietro, e
    // la seconda è quella che il titolo corretto a mano dopo la 0.3.0 non
    // aveva potuto notare: `--latest` su una bozza non la pubblica.
    const blocco = da('gh release view "$VERSIONE" >/dev/null 2>&1; then');
    const edit = blocco.split("\n").find((r) => r.includes("gh release edit")) ?? "";
    expect(edit).toContain("--title");
    expect(edit).toContain("--latest");
    // `--draft=false` è la differenza fra una release e una che non esiste.
    expect(edit).toContain("--draft=false");
  });

  it("salta la costruzione solo se la release è completa davvero", () => {
    // Una release vuota esiste e non serve a nessuno: rispettarla lascerebbe
    // pubblicato un tag da cui l'app non si aggiorna, senza alcun errore.
    const blocco = da("ULTIMA=");
    expect(blocco).toContain("--json isDraft,assets");
    expect(blocco).toContain('index("latest.yml") != null');
    // Le tre condizioni insieme: pubblicata, con i menù, ed è l'ultima. Il
    // salto è uno skip solo se valgono tutte.
    const rigaIf = 'if [ "$COMPLETA" = "true" ] && [ "$ULTIMA" = "$TAG" ]; then';
    expect(blocco).toContain(rigaIf);
    // E il salto dev'essere davvero uno skip: dentro quel `if`, non dopo.
    const corpoIf = blocco.slice(blocco.indexOf(rigaIf)).split("exit 0")[0];
    expect(corpoIf).toContain("daRilasciare=false");

    // Il campo `isLatest` non esiste fra quelli che `gh release view --json`
    // espone: chiederlo fa fallire tutta la chiamata, e il rilascio si
    // rifarebbe ogni volta senza che nulla sembri rotto. Il controllo qui
    // guarda le righe di comando, non i commenti che parlano del campo.
    const comandi = testo
      .split("\n")
      .filter((r) => !r.trimStart().startsWith("#"))
      .join("\n");
    expect(comandi).not.toContain("isLatest");
  });

  it("continua a controllare i pacchetti prima di pubblicarli", () => {
    // Il rischio è che "tollera" diventi "pubblica quello che c'è". I tre
    // controlli restano, e restano prima.
    for (const atteso of [
      "for estensione in dmg exe AppImage",
      "for menu in latest.yml latest-mac.yml latest-linux.yml",
    ]) {
      expect(testo.replace(/\s+/g, " ")).toContain(atteso);
    }
    expect(testo).toContain("Manca il pacchetto");
    expect(testo).toContain("node scripts/verifica-menu-aggiornamento.mjs dist");
    const indiceVerifica = testo.indexOf("verifica-menu-aggiornamento.mjs dist");
    const indicePubblica = testo.indexOf('gh release view "$VERSIONE"');
    expect(indiceVerifica).toBeLessThan(indicePubblica);
  });

  it("dopo aver pubblicato, rilegge la release e si accorge se è a metà", () => {
    // Il verde del workflow vuol dire solo che i comandi sono usciti con 0:
    // `gh release upload` prosegue anche quando un file fallisce. Senza
    // questa verifica finale, un allegato mancante e una release lasciata in
    // bozza restano due rilasci "riusciti" che non si possono scaricare.
    const indiceCrea = testo.indexOf('gh release create "$VERSIONE"');
    const indiceVerifica = testo.indexOf("node scripts/verifica-release.mjs");
    expect(indiceVerifica).toBeGreaterThan(indiceCrea);
    // E lo script va provato da solo: la verifica è codice, non un `if` in un
    // file di Actions dove nessuno lo eseguirebbe.
    expect(existsSync("scripts/verifica-release.mjs")).toBe(true);
    expect(existsSync("tests/verifica-release.test.ts")).toBe(true);
  });

  it("è un YAML che GitHub riesce a leggere", () => {
    // Il controllo più economico di tutti e l'unico che non dipende da quando
    // si guarda: un workflow malformato non parte, e senza che nessuno se ne
    // accorga finché non c'è una release da fare. Il formato si controlla
    // anche a occhi, ma a occhi non è un test.
    //
    // Il tab è il motivo per cui questo test esiste: nell'YAML il tab è
    // sempre un errore di indentazione, e dentro un `run: |` un tab
    // all'inizio della riga si vede come spazio solo in un editor che lo
    // sostituisce — quindi proprio nel posto dove lo scrivi.
    expect(testo).not.toContain("\t");
  });
});
