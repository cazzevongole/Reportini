const { app, BrowserWindow, ipcMain, shell, dialog } = require("electron");
const path = require("node:path");
const fs = require("node:fs/promises");
// Solo per una domanda di esistenza (`app-update.yml`): `fs/promises` non ha
// una versione sincrona, e `caricaAggiornatore` viene chiamata all'avvio.
const { existsSync } = require("node:fs");
const { avviaServer, riportaAllaApp } = require("./server-locale.cjs");

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
 * Porta a casa il rientro di Google: la finestra dell'app si riporta avanti e
 * da lì il renderer fa il resto.
 *
 * La query è già stata ripulita dal server, che ha tenuto solo i parametri
 * che Google usa davvero: questa porta è raggiungibile da qualunque
 * programma sulla macchina e non è il posto dove far arrivare un indirizzo di
 * scelta altrui. E non viene rimessa nell'URL, per il motivo che spiega
 * `riportaAllaApp`.
 */
async function riportaRitorno(query) {
  for (const finestra of BrowserWindow.getAllWindows()) {
    try {
      await riportaAllaApp(finestra, origineLocale, query);
      return;
    } catch (errore) {
      await registra(errore.message);
    }
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
  await avviaAggiornamenti();
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

/**
 * L'uscita dell'app è il momento in cui un aggiornamento rimandato entra.
 *
 * Lo gestiamo qui invece di lasciarlo a `autoInstallOnAppQuit` per una
 * ragione precisa: electron-updater registra il suo gestore di uscita **quando
 * finisce lo scarico**, e solo se il bandierino è già acceso. Accenderlo dopo,
 * nel momento in cui l'utente sceglie "alla chiusura", non avrebbe nessun
 * effetto: il pacchetto resterebbe scaricato e mai installato. Qui la
 * decisione è nostra e vale in ogni momento.
 */
app.on("before-quit", () => {
  if (!installaAllaChiusura || installaInCorso) return;
  // "pronto" vuol dire che il pacchetto è scaricato: senza, non c'è nulla da
  // installare e l'utente che chiude l'app vuol solo chiuderla.
  if (stato.fase !== "pronto") return;
  void registra("aggiornamento rimandato: lo installo all'uscita");
  installaEdEsci(true);
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
  // Il menù dell'aggiornamento lo scrive electron-builder dalla sezione
  // `publish` del pacchetto: un pacchetto costruito senza provider — la
  // variante dev, per esempio, che serve proprio a provare senza pubblicare —
  // quel file non ce l'ha. Senza, electron-updater non sa dove guardare e
  // fallisce a ogni avvio, con un errore che all'utente non dice niente di
  // utile; e l'unica cosa che si potrebbe fare con quel canale è installare
  // sopra la versione ufficiale. Quindi non si accende affatto.
  if (!existsSync(path.join(process.resourcesPath, "app-update.yml"))) {
    console.warn("Aggiornamento automatico non configurato: questo pacchetto non ne ha il menù.");
    return null;
  }
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
/** L'utente ha scelto "alla chiusura": l'aggiornamento entra all'uscita. */
let installaAllaChiusura = false;
/** Un tentativo di installazione è già partito: non se ne lancia un secondo. */
let installaInCorso = false;
/** @type {{ versione: string, tentativi: number } | null} */
let inAttesa = null;

const FILE_IN_ATTESA = () => path.join(app.getPath("userData"), "aggiornamento-in-attesa.json");
/**
 * Quante volte si può provare a installare da soli, all'avvio, prima di
 * smettere e chiedere. Serve a non chiudere l'app da soli per sempre: se
 * l'installazione fallisce, alla terza volta la domanda torna all'utente.
 */
const TENTATIVI_MAX = 2;
/** Quanto l'app resta aperta prima di chiudersi da sola, all'avvio. */
const ATTESA_PER_INSTALLARE_MS = 10_000;

function inviaStato(nuovo) {
  stato = nuovo;
  for (const finestra of BrowserWindow.getAllWindows()) {
    if (!finestra.isDestroyed()) finestra.webContents.send("aggiornamento:stato", nuovo);
  }
}

/**
 * Cosa resta da un avvio all'altro della scelta "alla chiusura".
 *
 * Sta su file perché la scelta deve sopravvivere alla chiusura: se l'app
 * viene chiusa di colpo, senza passare dall'uscita pulita, al riavvio
 * l'aggiornamento è ancora quello che l'utente aveva già accettato.
 */
async function leggiInAttesa() {
  try {
    const dati = JSON.parse(await fs.readFile(FILE_IN_ATTESA(), "utf8"));
    if (typeof dati?.versione !== "string" || dati.versione === "") return null;
    return { versione: dati.versione, tentativi: Number(dati.tentativi) || 0 };
  } catch {
    return null;
  }
}

async function scriviInAttesa(versione, tentativi) {
  try {
    await fs.writeFile(FILE_IN_ATTESA(), JSON.stringify({ versione, tentativi }), "utf8");
  } catch (errore) {
    await registra(`non riesco a ricordare l'aggiornamento in attesa: ${errore.message}`);
  }
}

async function dimenticaInAttesa() {
  inAttesa = null;
  try {
    await fs.rm(FILE_IN_ATTESA(), { force: true });
  } catch {
    // Se il file non c'è più, l'unica cosa che si perde è la promessa.
  }
}

/**
 * Installa il pacchetto scaricato e chiude l'app.
 *
 * `silenzioso` è per l'aggiornamento automatico: l'utente non sta guardando,
 * l'installatore non deve aprire finestre e l'app non si riapre (è già chiusa
 * o sta per chiudersi). Quando invece è lui a premere, l'installatore si vede
 * e l'app si riapre: è la differenza fra "è successo" e "che cosa sta
 * succedendo".
 */
function installaEdEsci(silenzioso) {
  if (!aggiornatore || installaInCorso) return false;
  installaInCorso = true;
  void dimenticaInAttesa();
  setImmediate(() => aggiornatore.quitAndInstall(silenzioso, !silenzioso));
  return true;
}

/**
 * L'avvio successivo, se l'utente aveva già scelto l'installazione automatica.
 *
 * Non succede subito: l'app si apre, il controllo trova la release, il
 * pacchetto si scarica, e solo allora l'app si chiude da sola. Il tentativo
 * viene contato **prima** di installare, così un'installazione che fallisce
 * non si ripete all'infinito.
 */
function programmaInstallazioneAutomatica(versione) {
  if (!inAttesa) return;

  if (inAttesa.tentativi >= TENTATIVI_MAX) {
    // La scelta è già stata provata il numero giusto di volte: meglio chiedere
    // che aprire e richiudere l'app da solo.
    void dimenticaInAttesa();
    installaAllaChiusura = false;
    void registra(`aggiornamento ${versione}: non lo installo più da solo, lo chiedo.`);
    return;
  }

  // Una versione diversa da quella rimandata riparte con il conto a zero: è
  // una richiesta nuova, non un tentativo ripetuto.
  if (versione && inAttesa.versione !== versione) {
    inAttesa = { versione, tentativi: 0 };
  }

  const daInstallare = inAttesa;
  setTimeout(() => {
    if (stato.fase !== "pronto" || installaInCorso) return;
    const prossimo = { versione: daInstallare.versione, tentativi: daInstallare.tentativi + 1 };
    inAttesa = prossimo;
    void scriviInAttesa(prossimo.versione, prossimo.tentativi).then(() => {
      void registra(
        `aggiornamento ${prossimo.versione}: lo installo da solo come richiesto ` +
          `(tentativo ${prossimo.tentativi} di ${TENTATIVI_MAX})`,
      );
      installaEdEsci(true);
    });
  }, ATTESA_PER_INSTALLARE_MS);
}

async function avviaAggiornamenti() {
  aggiornatore = caricaAggiornatore();
  if (!aggiornatore) return;

  // Lo scarico parte da solo appena l'app è aperta: quando l'utente decide,
  // il pacchetto è già in arrivo e la finestra non resta appesa a una barra
  // che avanza.
  aggiornatore.autoDownload = true;
  // Qui è sempre spento: l'installazione la decidiamo noi, al gestore di
  // `before-quit` e all'avvio, non alle spalle dell'utente.
  aggiornatore.autoInstallOnAppQuit = false;

  inAttesa = await leggiInAttesa();
  if (inAttesa) {
    installaAllaChiusura = true;
    await registra(
      `aggiornamento ${inAttesa.versione} in attesa dalla volta scorsa ` +
        `(${inAttesa.tentativi} tentativi): entra appena è pronto`,
    );
  }

  aggiornatore.on("checking-for-update", () => {
    void registra("controllo se c'è una versione nuova");
    inviaStato({ fase: "controllo" });
  });

  aggiornatore.on("update-available", (info) => {
    versioneInCorso = info?.version ?? null;
    void registra(`trovata la versione ${versioneInCorso ?? "nuova"}: la scarico in sottofondo`);
    inviaStato({ fase: "scarico", versione: versioneInCorso ?? undefined, percentuale: 0 });
  });

  aggiornatore.on("download-progress", (avanzamento) => {
    const percentuale = Number.isFinite(avanzamento?.percent)
      ? Math.max(0, Math.min(100, Math.round(avanzamento.percent)))
      : 0;
    inviaStato({ fase: "scarico", versione: versioneInCorso ?? undefined, percentuale });
  });

  aggiornatore.on("update-downloaded", (info) => {
    const versione = info?.version ?? versioneInCorso ?? "";
    inviaStato({ fase: "pronto", versione: versione || undefined });
    void registra(`versione ${versione || "nuova"} scaricata: pronta da installare`);
    programmaInstallazioneAutomatica(versione);
  });

  aggiornatore.on("update-not-available", () => {
    // Non c'è niente da aspettare: la promessa della volta scorsa vale solo
    // per una versione che ora non esiste più.
    if (inAttesa) void dimenticaInAttesa();
    installaAllaChiusura = false;
    void registra("sei già all'ultima versione");
    inviaStato({ fase: "aggiornato" });
  });

  aggiornatore.on("error", (errore) => {
    const motivo = errore?.message ?? String(errore);
    // Un controllo fallito (rete assente) non è un problema dell'utente: nel
    // log sì, in faccia a lui no. In un'app impacchettata `console.warn` finisce
    // nel nulla, perché non c'è un terminale ad aprirlo.
    void registra(`aggiornamento non riuscito: ${motivo}`);
    inviaStato({ fase: "errore", messaggio: motivo || "Aggiornamento non riuscito" });
  });
}

ipcMain.handle("update:stato", () => (aggiornatore ? stato : null));

ipcMain.handle("update:versione", () => app.getVersion());

ipcMain.handle("update:controlla", async () => {
  if (!aggiornatore) return null;
  try {
    await aggiornatore.checkForUpdates();
  } catch (errore) {
    void registra(`controllo non riuscito: ${errore?.message ?? errore}`);
  }
  return stato;
});

ipcMain.handle("update:installa", () => installaEdEsci(false));

ipcMain.handle("update:rimanda", async () => {
  if (!aggiornatore) return false;
  const versione = stato.versione ?? versioneInCorso ?? "";
  installaAllaChiusura = true;
  if (versione) {
    inAttesa = { versione, tentativi: 0 };
    await scriviInAttesa(versione, 0);
  }
  void registra(
    `aggiornamento ${versione || "pronto"} rimandato: entra alla chiusura dell'app, ` +
      "e da solo al prossimo avvio se l'app viene chiusa di colpo",
  );
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
