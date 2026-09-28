const { app, BrowserWindow, ipcMain, shell, dialog } = require("electron");
const path = require("node:path");
const fs = require("node:fs/promises");
const { avviaServer } = require("./server-locale.cjs");

const DB_FILE = () => path.join(app.getPath("userData"), "reportini.sqlite");
const LOG_FILE = () => path.join(app.getPath("userData"), "renderer.log");
const DEV_URL = process.env.VITE_DEV_SERVER_URL;

/**
 * La porta su cui l'app si mette in ascolto, e l'origine che ne nasce.
 *
 * **Perché un server e non `file://`.** Da `file://` non esiste un'origine:
 * `window.location.origin` è la stringa "null", e un indirizzo di rientro
 * senza origine non è un indirizzo che Google accetta. Servendo l'app da
 * `127.0.0.1` si ha un'origine vera — sicura, perché resta sulla macchina e
 * non sulla rete — e l'accesso con Google è lo stesso della web.
 *
 * Perché una porta fissa e non una libera: l'indirizzo di rientro va
 * registrato prima, in Google e in Supabase, e un numero che cambia a ogni
 * avvio non si può registrare. Se la porta è occupata se ne prende una
 * vicina, ma quella va registrata al suo posto: il log dice quale.
 */
const PORTA_ACCESSO = 42720;

/**
 * Scrive una riga nel log accanto ai dati.
 *
 * Nell'app impacchettata non esiste una console: quello che il renderer
 * scrive va su devtools, che l'utente non apre mai. Un errore di caricamento
 * — per esempio i suoi asset non trovati — si manifesta come pagina bianca e
 * basta. Con questo file il motivo è leggibile, e la schermata d'errore dice
 * dove cercarlo.
 */
async function registra(riga) {
  try {
    await fs.appendFile(LOG_FILE(), `${new Date().toISOString()} ${riga}\n`, "utf8");
  } catch {
    // Se il log non si può scrivere, l'app deve comunque aprire.
  }
}

/** @type {BrowserWindow | null} */
let ventana = null;
/** @type {import("node:http").Server | null} */
let serverLocale = null;
/** Dove l'app è in ascolto, per il log e per la schermata di accesso. */
let origineLocale = "";

/**
 * Porta a casa il rientro di Google: la finestra dell'app si riporta
 * all'indirizzo con il `code`, e da lì il renderer fa il resto.
 *
 * La query è già stata ripulita dal server, che ha tenuto solo i parametri
 * che Google usa davvero: questa porta è raggiungibile da qualunque
 * programma sulla macchina e non è il posto dove far arrivare un indirizzo di
 * scelta altrui.
 */
async function riportaRitorno(query) {
  for (const finestra of BrowserWindow.getAllWindows()) {
    if (finestra.isDestroyed()) continue;
    if (finestra.isMinimized()) finestra.restore();
    finestra.show();
    finestra.focus();
    await finestra.webContents.loadURL(`${origineLocale}/?${query}`);
    return;
  }
}

async function createWindow() {
  ventana = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 380,
    minHeight: 560,
    backgroundColor: "#f7f6f2",
    show: false,
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      // Il preload ha bisogno del percorso assoluto del file SQLite prima che la finestra esista.
      additionalArguments: [`--reportini-db=${DB_FILE()}`],
    },
  });

  ventana.once("ready-to-show", () => ventana && ventana.show());

  // La testata: senza, il log nasce solo al primo messaggio del renderer, e
  // "non ho log" non distingue un'app muta da un log che non c'è. Qui si
  // vede subito quale versione è partita, su cosa, e dove sta il database.
  registra(
    `Reportini ${app.getVersion()} su ${process.platform} — dati in ${DB_FILE()} — log in ${LOG_FILE()}` +
      (origineLocale ? ` — ascolto su ${origineLocale}` : ""),
  );

  // Quello che il renderer scrive, su file. Le due forme dell'evento sono
  // entrambe gestite: Electron 31 passa ancora i parametri posizionali, le
  // versioni più recenti un oggetto.
  ventana.webContents.on("console-message", (...argomenti) => {
    const evento = argomenti[0];
    const riga =
      evento && typeof evento === "object" && "message" in evento
        ? `[${evento.level}] ${evento.message} (${evento.sourceId}:${evento.lineNumber})`
        : `[${argomenti[1]}] ${argomenti[2]} (${argomenti[4]}:${argomenti[3]})`;
    registra(riga);
  });
  ventana.webContents.on("render-process-gone", (_evento, dettagli) => {
    registra(`render process gone: ${JSON.stringify(dettagli)}`);
  });
  ventana.webContents.on("did-fail-load", (_evento, codice, descrizione, url) => {
    registra(`did-fail-load ${codice} ${descrizione} ${url}`);
  });
  ventana.webContents.on("preload-error", (_evento, percorso, errore) => {
    registra(`preload-error ${percorso}: ${errore.message}`);
  });

  // I link esterni (Google Calendar, documentazione) si aprono nel browser vero.
  ventana.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  if (DEV_URL) {
    // In sviluppo c'è già un server, quello di Vite, e la sua origine
    // 127.0.0.1:5173 è già registrata: niente da avviare.
    await ventana.loadURL(DEV_URL);
  } else {
    await ventana.loadURL(`${origineLocale}/`);
  }
}

app.whenReady().then(async () => {
  avviaAggiornamenti();
  if (!DEV_URL) {
    try {
      serverLocale = await avviaServer({
        porta: PORTA_ACCESSO,
        radice: path.join(__dirname, "renderer"),
        alRitorno: riportaRitorno,
        alLog: registra,
      });
      origineLocale = `http://127.0.0.1:${serverLocale.address().port}`;
    } catch (errore) {
      // Senza un'origine non c'è accesso con Google, e aprire l'app da
      // `file://` significherebbe ripartire da una pagina bianca: meglio
      // dirlo e non partire.
      dialog.showErrorBox(
        "Reportini non può aprire la sua porta locale",
        `L'accesso con Google torna a 127.0.0.1:${PORTA_ACCESSO} e le porte vicine sono occupate.\n\n` +
          "Chiudi le applicazioni che le occupano e riapri Reportini.\n\n" +
          errore.message,
      );
      app.quit();
      return;
    }
  }
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

// La porta si chiude con l'app: lasciare in ascolto 127.0.0.1 dopo la chiusura
// non serve a nessuno e su un computer acceso giorno e notte è solo una porta
// aperta.
app.on("will-quit", () => {
  serverLocale?.close();
  serverLocale = null;
});

/* -------------------------- Apertura nel browser ------------------------- */

/**
 * Apre un indirizzo nel browser vero, non dentro la finestra.
 *
 * **Perché non basta navigare.** Google rifiuta l'accesso dai browser
 * incorporati: aperta nella finestra di Electron, la schermata di consenso
 * risponde "This browser or app may not be secure" e non si passa. Il consenso
 * va visto dal browser di sistema, quindi serve un ponte.
 *
 * Si accetta solo `https`, e `http` solo verso la macchina stessa: il renderer
 * è l'app, ma un ponte che apre qualunque URL sarebbe un altro modo per
 * aprire qualunque cosa.
 */
ipcMain.handle("browser:apri", async (_event, url) => {
  let destinazione;
  try {
    destinazione = new URL(String(url));
  } catch {
    return false;
  }
  const inLocale = destinazione.hostname === "127.0.0.1" || destinazione.hostname === "localhost";
  if (destinazione.protocol !== "https:" && !(destinazione.protocol === "http:" && inLocale)) {
    return false;
  }
  await shell.openExternal(destinazione.toString());
  return true;
});

/* ------------------------- Ponte per il file SQLite ----------------------- */

ipcMain.handle("db:read", async () => {
  try {
    const buffer = await fs.readFile(DB_FILE());
    return new Uint8Array(buffer);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
});

ipcMain.handle("db:write", async (_event, bytes) => {
  await fs.writeFile(DB_FILE(), Buffer.from(bytes));
  return true;
});

ipcMain.handle("db:reveal", async () => {
  shell.showItemInFolder(DB_FILE());
  return DB_FILE();
});

/* ------------------------ Aggiornamento automatico ----------------------- */

// electron-updater funziona solo sull'app impacchettata: in sviluppo non c'è
// una release da cui prendere gli aggiornamenti, e una richiesta di rete
// inutile a ogni avvio non serve a nessuno.
function caricaAggiornatore() {
  if (!app.isPackaged) return null;
  try {
    return require("electron-updater").autoUpdater;
  } catch (errore) {
    console.warn("Aggiornamento automatico non disponibile:", errore.message);
    return null;
  }
}

let aggiornatore = null;
let versioneInCorso = null;
/** @type {{ fase: string, versione?: string, percentuale?: number, messaggio?: string }} */
let stato = { fase: "idle" };

function inviaStato(nuovo) {
  stato = nuovo;
  for (const finestra of BrowserWindow.getAllWindows()) {
    if (!finestra.isDestroyed()) finestra.webContents.send("aggiornamento:stato", nuovo);
  }
}

function avviaAggiornamenti() {
  aggiornatore = caricaAggiornatore();
  if (!aggiornatore) return;

  // Lo scarico parte da solo appena l'app è aperta: quando l'utente decide
  // di installare, il pacchetto è già in arrivo e la finestra non resta
  // appesa a una barra che avanza.
  aggiornatore.autoDownload = true;
  // Se l'utente rimanda, l'aggiornamento entra comunque alla chiusura.
  aggiornatore.autoInstallOnAppQuit = true;

  aggiornatore.on("checking-for-update", () => inviaStato({ fase: "controllo" }));

  aggiornatore.on("update-available", (info) => {
    versioneInCorso = info?.version ?? null;
    inviaStato({ fase: "scarico", versione: versioneInCorso ?? undefined, percentuale: 0 });
  });

  aggiornatore.on("download-progress", (avanzamento) => {
    const percentuale = Number.isFinite(avanzamento?.percent)
      ? Math.max(0, Math.min(100, Math.round(avanzamento.percent)))
      : 0;
    inviaStato({ fase: "scarico", versione: versioneInCorso ?? undefined, percentuale });
  });

  aggiornatore.on("update-downloaded", (info) => {
    inviaStato({ fase: "pronto", versione: info?.version ?? versioneInCorso ?? undefined });
  });

  aggiornatore.on("update-not-available", () => inviaStato({ fase: "aggiornato" }));

  aggiornatore.on("error", (errore) => {
    // Un controllo fallito (rete assente) non è un problema dell'utente: va
    // tenuto in console e non trasformato in un avviso a ogni avvio.
    console.warn("Aggiornamento automatico non riuscito:", errore?.message ?? errore);
    inviaStato({ fase: "errore", messaggio: errore?.message ?? "Aggiornamento non riuscito" });
  });
}

ipcMain.handle("update:stato", () => (aggiornatore ? stato : null));

ipcMain.handle("update:versione", () => app.getVersion());

ipcMain.handle("update:controlla", async () => {
  if (!aggiornatore) return null;
  try {
    await aggiornatore.checkForUpdates();
  } catch (errore) {
    console.warn("Controllo aggiornamenti non riuscito:", errore?.message ?? errore);
  }
  return stato;
});

ipcMain.handle("update:installa", () => {
  if (!aggiornatore) return false;
  // silent = false: l'installatore mostra quello che sta facendo; l'app si
  // riapre da sola quando ha finito.
  setImmediate(() => aggiornatore.quitAndInstall(false, true));
  return true;
});

ipcMain.handle("db:choose-export", async (_event, suggestedName, contents) => {
  const { canceled, filePath } = await dialog.showSaveDialog(ventana, {
    title: "Salva copia di Reportini",
    defaultPath: path.join(app.getPath("downloads"), suggestedName),
  });
  if (canceled || !filePath) return null;
  await fs.writeFile(filePath, contents, "utf8");
  return filePath;
});
