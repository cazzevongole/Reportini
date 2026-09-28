/**
 * Il server locale che dà all'app desktop un'origine.
 *
 * È il pezzo che rende possibile l'accesso con Google dal pacchetto: senza
 * un'origine vera (`file://` non ne ha) l'indirizzo di rientro sarebbe la
 * parola "null" e Google non lo accetterebbe.
 *
 * Qui si provano le tre cose che potrebbero andare storte in silenzio: che
 * serva l'app, che il ritorno di Google venga intercettato e non confuso con
 * una pagina, e che nessuna richiesta possa uscire dalla cartella del
 * renderer.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import http from "node:http";
import path from "node:path";
import {
  avviaServer,
  eRitorno,
  percorsoDi,
  queryRitorno,
} from "../electron/server-locale.cjs";

let radice: string;
let server: import("node:http").Server;
let origine: string;
let ritorni: string[];

beforeEach(async () => {
  radice = await mkdtemp(path.join(tmpdir(), "reportini-server-"));
  await mkdir(path.join(radice, "assets"));
  await writeFile(path.join(radice, "index.html"), "<!doctype html><title>Reportini</title>");
  await writeFile(path.join(radice, "assets", "app.js"), "console.log('app')");

  ritorni = [];
  // Porta 0: se la fissa è occupata il test non diventa una lotta per la porta.
  // avviaServer risolve quando il server è già in ascolto, quindi qui non
  // c'è nessun "listening" da aspettare.
  server = await avviaServer({
    porta: 0,
    tentativi: 0,
    radice,
    alRitorno: (query: string) => ritorni.push(query),
  });
  origine = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});

afterEach(async () => {
  // close() da solo aspetta che il client chiuda: fetch tiene la connessione
  // aperta e l'afterEach si mangerebbe il timeout.
  server.closeAllConnections();
  await new Promise<void>((chiusa) => server.close(() => chiusa()));
});

async function chiedi(percorso: string, intestazioni: Record<string, string> = {}) {
  const risposta = await fetch(`${origine}${percorso}`, { headers: intestazioni });
  return { stato: risposta.status, tipo: risposta.headers.get("content-type"), testo: await risposta.text() };
}

describe("Il server locale dell'app desktop", () => {
  it("serve l'app, così la finestra ha un'origine vera", async () => {
    const indice = await chiedi("/");
    expect(indice.stato).toBe(200);
    expect(indice.testo).toContain("Reportini");
    // Il tipo giusto: senza, sql.js non parte e il database non si apre.
    expect(indice.tipo).toContain("text/html");

    const asset = await chiedi("/assets/app.js");
    expect(asset.stato).toBe(200);
    expect(asset.tipo).toContain("text/javascript");

    // Il wasm è il pezzo più sensibile al tipo MIME.
    await writeFile(path.join(radice, "assets", "sql.wasm"), "fake");
    const wasm = await chiedi("/assets/sql.wasm");
    expect(wasm.tipo).toBe("application/wasm");
  });

  it("intercetta il ritorno di Google invece di cercarlo come un file", async () => {
    const risposta = await chiedi("/?code=4/abc&state=xyz");

    // Non un 404: è qui che l'utente viene riportato dopo il consenso.
    expect(risposta.stato).toBe(200);
    expect(risposta.testo).toContain("Accesso completato");
    // E soprattutto: il main process è stato avvisato, perché l'ha aperto il
    // browser di sistema e la finestra non se ne sarebbe accorta da sola.
    expect(ritorni).toEqual(["code=4%2Fabc&state=xyz"]);
  });

  it("intercetta anche un rientro rifiutato", async () => {
    await chiedi("/?error=access_denied&state=xyz");
    expect(ritorni).toHaveLength(1);
    expect(ritorni[0]).toContain("error=access_denied");
  });

  it("non lascia uscire dalla cartella del renderer", async () => {
    // I `..` in chiaro non arrivano mai al server: il client li normalizza
    // via, e quello che resta è un percorso dentro la cartella che non
    // esiste. Il caso pericoloso è il percorso **codificato**, che passa
    // intatto e viene decodificato dal server: quello deve essere rifiutato,
    // perché su Windows porta dentro app.asar, dove c'è il codice.
    const fuori = await chiedi("/../../../etc/passwd");
    expect(fuori.stato).toBe(404);

    const codificato = await chiedi("/%2e%2e%2f%2e%2e%2fsegreto");
    expect(codificato.stato).toBe(403);
  });

  it("non parla con chi si presenta con un altro nome di dominio", async () => {
    // Un sito che risolve a 127.0.0.1 non deve poter parlare con l'app
    // presentandosi con un Host di sua scelta: è la difesa base contro il
    // DNS rebinding. Serve node:http perché fetch non permette di cambiare
    // l'intestazione Host, ed è proprio quella che si sta cercando di forzare.
    const stato = await new Promise<number>((pronto, rifiuta) => {
      const richiesta = http.request(
        { host: "127.0.0.1", port: Number(new URL(origine).port), path: "/", headers: { Host: "reportini.example.com" } },
        (risposta) => {
          risposta.resume();
          pronto(risposta.statusCode ?? 0);
        },
      );
      richiesta.on("error", rifiuta);
      richiesta.end();
    });
    expect(stato).toBe(421);
  });

  it("un file che non c'è è un 404, non una pagina bianca", async () => {
    const mancante = await chiedi("/assets/non-esiste.js");
    expect(mancante.stato).toBe(404);
    expect(ritorni).toEqual([]);
  });
});

describe("La query di rientro", () => {
  it("tiene i parametri che Google usa e lascia fuori il resto", () => {
    const utili = new URLSearchParams({
      code: "4/abc",
      state: "xyz",
      error_description: "Accesso negato",
      // Un altro programma sulla macchina potrebbe provare a reindirizzare
      // la finestra dell'app da qui: questi non passano.
      redirect: "https://esempio.example",
      next: "https://esempio.example",
    });

    const query = queryRitorno(utili);
    const letti = new URLSearchParams(query);

    expect(letti.get("code")).toBe("4/abc");
    expect(letti.get("state")).toBe("xyz");
    expect(letti.get("error_description")).toBe("Accesso negato");
    expect(letti.get("redirect")).toBeNull();
    expect(letti.get("next")).toBeNull();
  });

  it("riconosce il ritorno anche senza code, per un accesso negato", () => {
    const conCode = new URL("http://127.0.0.1/?code=abc", "http://127.0.0.1");
    const conErrore = new URL("http://127.0.0.1/?error=access_denied", "http://127.0.0.1");
    const normale = new URL("http://127.0.0.1/assets/app.js", "http://127.0.0.1");
    expect(eRitorno(conCode)).toBe(true);
    expect(eRitorno(conErrore)).toBe(true);
    expect(eRitorno(normale)).toBe(false);
  });
});

describe("Il percorso del file", () => {
  it("la radice è l'indice, e resta dentro", () => {
    const percorso = new URL("http://127.0.0.1/", "http://127.0.0.1");
    expect(percorsoDi("/ragione", percorso)).toBe(path.join("/ragione", "index.html"));
  });

  it("un percorso codificato che sale viene rifiutato, non risolto", () => {
    // È la forma che arriva davvero: i `..` in chiaro vengono normalizzati
    // prima di toccare la rete, quelli codificati no.
    const percorso = new URL("http://127.0.0.1/%2e%2e%2fsegreto", "http://127.0.0.1");
    expect(percorsoDi(path.join("/ragione", "renderer"), percorso)).toBeNull();
  });

  it("un percorso normale dentro la cartella si risolve", () => {
    const percorso = new URL("http://127.0.0.1/assets/app.js", "http://127.0.0.1");
    expect(percorsoDi(path.join("/ragione", "renderer"), percorso)).toBe(
      path.join("/ragione", "renderer", "assets", "app.js"),
    );
  });

  it("una radice relativa funziona lo stesso", () => {
    // Il difetto che questa riga copre: path.resolve restituisce sempre un
    // percorso assoluto, quindi se la radice è relativa il confronto con lei
    // non combacia e il server risponde 403 a tutto — un'app che non si apre.
    const percorso = new URL("http://127.0.0.1/assets/app.js", "http://127.0.0.1");
    expect(percorsoDi(path.join("electron", "renderer"), percorso)).toBe(
      path.resolve("electron/renderer/assets/app.js"),
    );
    expect(percorsoDi("electron/renderer", new URL("http://127.0.0.1/", "http://127.0.0.1"))).toBe(
      path.resolve("electron/renderer/index.html"),
    );
  });
});
