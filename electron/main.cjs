const { app, BrowserWindow, ipcMain, shell, dialog } = require("electron");
const path = require("node:path");
const fs = require("node:fs/promises");

const DB_FILE = () => path.join(app.getPath("userData"), "reportini.sqlite");
const DEV_URL = process.env.VITE_DEV_SERVER_URL;

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

ipcMain.handle("db:choose-export", async (_event, suggestedName, contents) => {
  const { canceled, filePath } = await dialog.showSaveDialog(ventana, {
    title: "Salva copia di Reportini",
    defaultPath: path.join(app.getPath("downloads"), suggestedName),
  });
  if (canceled || !filePath) return null;
  await fs.writeFile(filePath, contents, "utf8");
  return filePath;
});
