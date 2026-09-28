const { app, BrowserWindow, ipcMain, shell, dialog } = require("electron");
const path = require("node:path");
const fs = require("node:fs/promises");

const DB_FILE = () => path.join(app.getPath("userData"), "reportini.sqlite");
const LOG_FILE = () => path.join(app.getPath("userData"), "renderer.log");
const DEV_URL = process.env.VITE_DEV_SERVER_URL;

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

  // Quello che il renderer scrive, su file. Le due forme del evento sono
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
    await ventana.loadURL(DEV_URL);
  } else {
    await ventana.loadFile(path.join(__dirname, "renderer", "index.html"));
  }
}

app.whenReady().then(() => {
  avviaAggiornamenti();
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
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
