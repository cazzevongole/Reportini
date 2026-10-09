// =============================================================================
// Reportini · l'identità del pacchetto desktop
//
// Cosa fa. Due cose opposte, sullo stesso file (`electron/package.json`):
//
//   dev        riscrive l'identità del pacchetto in quella di prova;
//   controlla  verifica che il file sia ancora quello ufficiale.
//
// Perché serve. Il rilascio ufficiale pubblica un tag, alza la versione e mette
// la release come "ultima": da lì tutte le app installate si aggiornano da
// sole. Per provare una correzione sulla macchina vera — che è l'unica prova
// che conta per l'accesso — serve un pacchetto che non possa entrare in quel
// canale e che non si sovrapponga all'app installata. Le separazioni sono
// cinque, e ognuna chiude un modo diverso di pestare i piedi all'ufficiale:
//
//   - `name`: la cartella di installazione su Windows è
//     `%LOCALAPPDATA%\Programs\<name>`, quindi il dev ha una cartella sua e
//     non sostituisce l'app vera;
//   - `productName`: da qui vengono l'eseguibile (`Reportini Dev.exe`), le
//     scorciatoie e — per Electron — la cartella dei dati
//     (`%APPDATA%\Reportini Dev`), accanto a quella vera e senza toccarla;
//   - `appId`: l'identità dell'applicazione per Windows e macOS, così
//     installazione e disinstallazione restano due cose distinte;
//   - `publish` tolto: `resources/app-update.yml` lo scrive electron-builder
//     dalla sezione `publish`, e senza quel file non esiste nessun canale
//     ufficiale da cui il dev possa aggiornarsi (l'app non accende nemmeno
//     l'aggiornatore: vedi `caricaAggiornatore` in electron/main.cjs);
//   - la versione porta il suffisso `-dev.<sha>`: `app.getVersion()` è quello
//     che l'app mostra nelle impostazioni, quindi la prova si riconosce da
//     dentro e non solo dal nome del file scaricato.
//
// Perché il controllo sta nel rilascio. L'identità dev la si applica in locale
// o in CI, e in CI il file viene buttato via col runner. In locale no: basta
// `node scripts/identita-desktop.mjs dev` e un `git add` distratto perché il
// rilascio ufficiale impacchetti "Reportini Dev" e lo pubblichi come ultima
// versione, con l'aggiornamento automatico che la installa a tutti. Il
// controllo nel workflow ufficiale chiude quella porta *prima* di costruire.
//
// Cosa NON fa. Non tocca la versione in `package.json`, non crea tag, non
// pubblica niente: l'unica versione che cambia è quella del pacchetto desktop,
// e solo perché un'app dev con il numero dell'ufficiale non si riconoscerebbe.
// =============================================================================

import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const QUI = dirname(fileURLToPath(import.meta.url));
const MANIFEST = join(QUI, "..", "electron", "package.json");

/** L'identità dell'app che si scarica dal rilascio ufficiale. */
export const IDENTITA_UFFICIALE = {
  name: "reportini-desktop",
  productName: "Reportini",
  appId: "app.reportini.desktop",
};

/** L'identità del pacchetto di prova: stesso codice, nome e cartelle suoi. */
export const IDENTITA_DEV = {
  name: "reportini-desktop-dev",
  productName: "Reportini Dev",
  appId: "app.reportini.desktop.dev",
  // Esplicito e senza spazi: il nome dell'installer lo promette anche il menù
  // dell'aggiornamento, e in questo progetto un nome promesso e non mantenuto
  // è già costato un rilascio che nessuno riusciva a scaricare.
  artifactName: "Reportini-Dev-Setup-${version}.${ext}",
};

/**
 * Il suffisso ammesso in una versione.
 *
 * Semver accetta, dopo il trattino, gruppi di caratteri alfanumerici e
 * trattini separati da punti. Un suffisso fuori da queste regole non è un
 * errore da correggere in silenzio: electron-builder fallirebbe più avanti
 * con un messaggio che parla di semver e non di quello che si è scritto.
 */
const SUFFISSO_AMMESSO = /^[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*$/;

/** La versione senza un eventuale suffisso dev già applicato. */
function versioneBase(versione) {
  return String(versione ?? "").replace(/-dev\..*$/, "");
}

/**
 * La versione del pacchetto dev: quella ufficiale più il suffisso.
 *
 * Riparte sempre dalla versione senza suffisso, così rieseguire lo script non
 * produce `0.4.3-dev.abc-dev.abc`.
 */
export function versioneDev(versione, suffisso) {
  const base = versioneBase(versione);
  if (!base) throw new Error("Il pacchetto non ha una versione da cui partire.");
  if (!SUFFISSO_AMMESSO.test(suffisso)) {
    throw new Error(
      `Suffisso della versione non ammesso: "${suffisso}". Semver accetta lettere, ` +
        "numeri e trattini, separati da punti (per esempio dev.abc1234).",
    );
  }
  return `${base}-${suffisso}`;
}

/**
 * Il manifest del pacchetto con l'identità dev, senza toccare l'originale.
 *
 * Il resto del file — `main`, `files`, i bersagli, le icone — resta com'è: il
 * pacchetto dev è lo stesso pacchetto, cambia solo chi dice di essere.
 */
export function identitaDev(manifest, suffisso) {
  const dev = structuredClone(manifest);
  dev.name = IDENTITA_DEV.name;
  dev.productName = IDENTITA_DEV.productName;
  dev.version = versioneDev(manifest.version, suffisso);

  dev.build = dev.build ?? {};
  // Dentro `build` il nome del prodotto **vince** su quello in cima al file,
  // ed è quello che decide l'eseguibile, le scorciatoie e — per Electron — la
  // cartella dei dati. Se restasse "Reportini", le due app scriverebbero nello
  // stesso `%APPDATA%\Reportini`: due localStorage sullo stesso database, che è
  // esattamente la cosa da non fare mentre si prova.
  dev.build.productName = IDENTITA_DEV.productName;
  dev.build.appId = IDENTITA_DEV.appId;
  dev.build.win = { ...(dev.build.win ?? {}), artifactName: IDENTITA_DEV.artifactName };

  // `publish: null` e non la sezione tolta, perché la differenza è tutta qui:
  // senza `publish` electron-builder **ricava** il fornitore dal campo
  // `repository` del pacchetto (che qui punta al repository ufficiale) e scrive
  // lo stesso `resources/app-update.yml` — è scritto nel suo sorgente, con la
  // motivazione "il file va generato comunque, così si può provare
  // l'installer in locale". Il risultato sarebbe un pacchetto di prova che si
  // aggiorna da solo con la release ufficiale, cioè esattamente la cosa da cui
  // questo script deve tenere lontano. Con `null` esplicito non si ricava
  // niente: nessun menù, nessun aggiornatore, nessun canale.
  dev.build.publish = null;
  // Anche sul bersaglio, perché la ricerca parte da lì: se un giorno il
  // pacchetto ufficiale dichiarasse `publish` dentro `win`, quella vince e la
  // riga qui sopra non basterebbe più.
  dev.build.nsis = { ...(dev.build.nsis ?? {}), publish: null };

  return dev;
}

/**
 * Perché questo manifest non è quello ufficiale, una frase per motivo.
 *
 * Vuota quando va bene: è il caso che il rilascio richiede. Guarda anche la
 * versione e la presenza di `publish`, perché sono le due cose che si possono
 * rompere senza toccare i nomi: una versione `-dev.x` pubblicata come ultima
 * è un aggiornamento che arriva a tutti, e un pacchetto ufficiale senza menù
 * dell'aggiornamento è un'app che non si aggiorna più e non lo dice.
 */
export function problemiIdentita(manifest) {
  const build = manifest?.build ?? {};
  const problemi = [];

  for (const campo of ["name", "productName"]) {
    const atteso = IDENTITA_UFFICIALE[campo];
    if (manifest?.[campo] !== atteso) {
      problemi.push(
        `${campo} è "${manifest?.[campo]}": il pacchetto ufficiale deve chiamarsi "${atteso}".`,
      );
    }
  }

  // Quello dentro `build` vince su quello in cima: è lui a decidere
  // l'eseguibile, le scorciatoie e la cartella dei dati.
  if (build.productName !== IDENTITA_UFFICIALE.productName) {
    problemi.push(
      `build.productName è "${build.productName}": il pacchetto ufficiale deve chiamarsi "${IDENTITA_UFFICIALE.productName}".`,
    );
  }

  if (build.appId !== IDENTITA_UFFICIALE.appId) {
    problemi.push(
      `appId è "${build.appId}": il pacchetto ufficiale deve usare "${IDENTITA_UFFICIALE.appId}".`,
    );
  }

  if (/-dev\./.test(String(manifest?.version ?? ""))) {
    problemi.push(
      `la versione "${manifest?.version}" porta un suffisso dev: un pacchetto così non è una versione da pubblicare.`,
    );
  }

  if (!build.publish) {
    problemi.push(
      "manca la sezione publish (o è null): senza, il pacchetto non nasce con il menù dell'aggiornamento e le app installate non si aggiornerebbero più.",
    );
  }

  return problemi;
}

/** Il suffisso dell'identità dev: quello chiesto, altrimenti `dev.<sha corto>`. */
export function suffissoDaAmbiente(argomenti = [], ambiente = {}) {
  const scritto = (argomenti[0] ?? ambiente.SUFFISSO ?? "").trim();
  if (scritto) return scritto;

  const sha = (ambiente.GITHUB_SHA ?? "").trim();
  if (sha) return `dev.${sha.slice(0, 7)}`;

  try {
    const corto = execFileSync("git", ["rev-parse", "--short", "HEAD"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (corto) return `dev.${corto}`;
  } catch {
    // Nessun repository da cui leggere uno sha: il pacchetto resta
    // riconoscibile come dev, che è l'unica cosa che conta davvero.
  }
  return "dev";
}

// Si esegue solo se è il punto d'ingresso: i test importano le funzioni qui
// sopra e non devono riscrivere niente.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const azione = (process.argv[2] ?? "").trim();
  const manifest = JSON.parse(readFileSync(MANIFEST, "utf8"));

  if (azione === "dev") {
    const suffisso = suffissoDaAmbiente(process.argv.slice(3), process.env);
    const dev = identitaDev(manifest, suffisso);
    writeFileSync(MANIFEST, `${JSON.stringify(dev, null, 2)}\n`, "utf8");
    console.log(
      `Identità dev applicata in electron/package.json: ${dev.productName} ` +
        `${dev.version}, cartella "${dev.name}", installer "${dev.build.win.artifactName}".`,
    );
    console.log(
      "Nessuna release, nessun tag, nessun commit: solo il pacchetto di questa macchina.",
    );
  } else if (azione === "controlla") {
    const problemi = problemiIdentita(manifest);
    if (problemi.length > 0) {
      console.error(
        problemi.map((problema) => `ERRORE: ${problema}`).join("\n") +
          "\nIl pacchetto ufficiale non si costruisce da qui.",
      );
      process.exit(1);
    }
    console.log(
      `electron/package.json è quello ufficiale: ${manifest.productName} ${manifest.version}, ` +
        `cartella "${manifest.name}".`,
    );
  } else {
    console.error(
      "Serve un'azione: `dev` per applicare l'identità di prova, " +
        "`controlla` per verificare che il pacchetto sia quello ufficiale.",
    );
    process.exit(2);
  }
}
