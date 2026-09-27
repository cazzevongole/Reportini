const { contextBridge, ipcRenderer } = require("electron");

const dbPath =
  process.argv
    .find((argument) => argument.startsWith("--reportini-db="))
    ?.slice("--reportini-db=".length) ?? "reportini.sqlite";

/**
 * Il renderer esegue la stessa build sql.js della web; l'unico potere in più
 * sul desktop è salvare quel database come vero file .sqlite.
 */
contextBridge.exposeInMainWorld("reportini", {
  platform: process.platform,
  dbPath,
  readDb: () => ipcRenderer.invoke("db:read"),
  writeDb: (bytes) => ipcRenderer.invoke("db:write", bytes),
  revealDb: () => ipcRenderer.invoke("db:reveal"),
  saveText: (suggestedName, contents) =>
    ipcRenderer.invoke("db:choose-export", suggestedName, contents),
});
