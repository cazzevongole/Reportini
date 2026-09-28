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
  // Aggiornamento automatico: il main tiene il stato (controllo, scarico,
  // pronto) e lo ripubblica a ogni finestra. `null` vuol dire "qui gli
  // aggiornamenti non esistono", cioè app aperta dal sorgente.
  aggiornamento: {
    stato: () => ipcRenderer.invoke("update:stato"),
    versione: () => ipcRenderer.invoke("update:versione"),
    controlla: () => ipcRenderer.invoke("update:controlla"),
    installa: () => ipcRenderer.invoke("update:installa"),
    onCambio: (ascoltatore) => {
      const ascolta = (_evento, nuovo) => ascoltatore(nuovo);
      ipcRenderer.on("aggiornamento:stato", ascolta);
      return () => ipcRenderer.removeListener("aggiornamento:stato", ascolta);
    },
  },
});
