const http = require("node:http");
const path = require("node:path");
const fs = require("node:fs/promises");

/**
 * Il server che dà all'app desktop un'origine vera.
 *
 * **Perché serve.** Aperta da `file://` l'app non ha un'origine:
 * `window.location.origin` è la stringa "null", e Google non può riportare
 * l'utente a un indirizzo senza origine. Servendola da `127.0.0.1` l'origine
 * c'è, ed è sicura: resta sulla macchina e non è in ascolto sulla rete.
 *
 * Fa due cose: serve i file del renderer, e intercetta il ritorno di Google.
 * Il secondo punto è il motivo per cui sta qui e non dentro il main process:
 * l'ha aperto il browser di sistema, quindi l'app da sola non lo saprebbe mai.
 *
 * Non richiede Electron di proposito: è logica, non finestra, e così si
 * verifica senza un display.
 */

const TIPI = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".wasm": "application/wasm",
};

/** Quello che vede il browser quando l'accesso è tornato a casa. */
const PAGINA_ATTESA = `<!doctype html>
<html lang="it"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Reportini</title>
<style>
  body { font: 16px/1.6 system-ui, sans-serif; color: #26251f; background: #f7f6f2;
         display: grid; place-items: center; height: 100vh; margin: 0; text-align: center; }
  main { max-width: 32rem; padding: 2rem; }
  h1 { font-size: 1.25rem; margin: 0 0 .5rem; }
  p { color: #6b6a62; margin: 0; }
</style></head>
<body><main>
<h1>Accesso completato</h1>
<p>Torna a Reportini: ti sta aspettando.<br>Questa pagina puoi chiuderla.</p>
</main></body></html>`;

/** I parametri che Google manda davvero al ritorno. */
const CHIAVI_RITORNO = ["code", "state", "error", "error_description"];

/**
 * Tiene solo ciò che serve, e lo ricostruisce da capo.
 *
 * Questa porta è raggiungibile da qualunque programma sulla macchina, quindi
 * non è il posto dove far arrivare un indirizzo di scelta altrui: un parametro
 * `redirect` finirebbe nella barra degli indirizzi della finestra dell'app.
 */
function queryRitorno(parametri) {
  const utili = new URLSearchParams();
  for (const chiave of CHIAVI_RITORNO) {
    const valore = parametri.get(chiave);
    if (valore) utili.set(chiave, valore);
  }
  return utili.toString();
}

/** La richiesta è il ritorno di Google? */
function eRitorno(url) {
  return url.searchParams.has("code") || url.searchParams.has("error");
}

/**
 * Il file da servire, o `null` se la richiesta vuole uscire dalla cartella.
 *
 * `path.resolve` da solo non basta: senza questo controllo `GET /../../..`
 * su Windows porta fuori da `resources/`, e lì dentro c'è anche il
 * `app.asar` con il codice.
 *
 * La radice viene risolta per prima cosa, e qui sta il motivo: `path.resolve`
 * restituisce sempre un percorso assoluto, mentre il confronto seguente è con
 * la radice come è stata passata. Con una radice relativa — `electron/renderer`
 * invece di un percorso assoluto — i due non combaciano mai e il server
 * risponde 403 a tutto, cioè a un'app che non si apre. Meglio una riga in più
 * qui che una pagina bianca.
 */
function percorsoDi(radice, url) {
  const base = path.resolve(radice);
  const chiesto = decodeURIComponent(url.pathname);
  const relativa = chiesto === "/" || chiesto === "" ? "index.html" : chiesto.slice(1);
  const percorso = path.resolve(base, relativa);
  if (percorso !== path.join(base, "index.html") && !percorso.startsWith(base + path.sep)) {
    return null;
  }
  return percorso;
}

function creaServer({ radice, alRitorno, alLog }) {
  return http.createServer(async (richiesta, risposta) => {
    // Solo da questa macchina, e solo con un Host che è quello giusto: un sito
    // qualsiasi che punta a 127.0.0.1 non deve poter parlare con l'app
    // presentandosi con un proprio nome di dominio.
    const host = (richiesta.headers.host ?? "").split(":")[0];
    if (host !== "127.0.0.1" && host !== "localhost") {
      risposta.writeHead(421).end();
      return;
    }

    const url = new URL(richiesta.url ?? "/", "http://127.0.0.1");

    if (eRitorno(url)) {
      // Il `code` non entra nel log: è una credenzione, anche se vale un minuto.
      alLog?.("ritorno da Google ricevuto dal browser");
      alRitorno(queryRitorno(url.searchParams));
      risposta.writeHead(200, { "Content-Type": TIPI[".html"] }).end(PAGINA_ATTESA);
      return;
    }

    const percorso = percorsoDi(radice, url);
    if (!percorso) {
      risposta.writeHead(403).end();
      return;
    }

    try {
      const contenuto = await fs.readFile(percorso);
      risposta.writeHead(200, {
        "Content-Type": TIPI[path.extname(percorso)] ?? "application/octet-stream",
      });
      risposta.end(contenuto);
    } catch (errore) {
      if (errore.code !== "ENOENT" && errore.code !== "EISDIR") alLog?.(errore.message);
      risposta.writeHead(404).end("Non trovato");
    }
  });
}

/**
 * Alza il server, e restituisce l'indirizzo su cui è in ascolto.
 *
 * `porta` è quella prestabilita perché l'indirizzo di rientro va registrato in
 * Google e in Supabase *prima* di usarlo, e un numero che cambia a ogni avvio
 * non si può registrare. Se è occupata se ne prende una vicina: il main
 * process scrive nel log quale, perché quella va registrata al suo posto.
 */
function avviaServer({ porta, tentativi = 10, ...resto }) {
  const server = creaServer(resto);

  return new Promise((risolvi, rifiuta) => {
    let tentativiFatti = 0;

    const prova = () => {
      const onError = (errore) => {
        if (errore.code === "EADDRINUSE" && tentativiFatti < tentativi) {
          tentativiFatti += 1;
          prova();
          return;
        }
        rifiuta(errore);
      };
      server.once("error", onError);
      server.listen(porta + tentativiFatti, "127.0.0.1", () => {
        server.removeListener("error", onError);
        risolvi(server);
      });
    };

    prova();
  });
}

module.exports = {
  TIPI,
  PAGINA_ATTESA,
  CHIAVI_RITORNO,
  avviaServer,
  creaServer,
  eRitorno,
  percorsoDi,
  queryRitorno,
};
