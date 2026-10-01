// La versione del pacchetto, in un posto solo.
//
//   node scripts/versione.mjs                 controlla (non scrive niente)
//   node scripts/versione.mjs patch|minor|major  alza la versione
//
// C'è anche un ordine che vale più di ogni altro: il file `.rilascio` nella
// radice, contenente `patch`, `minor` o `major`. Quando c'è, il livello viene
// da lì e non dalla riga di comando.
//
// Perché serve. Il workflow che pubblica i pacchetti alza la versione da solo
// e il suo default è `patch`: un modello dati che cambia (le anagrafiche che
// diventano aziende, le relazioni che diventano report) uscirebbe come
// 0.2.11, lo stesso numero di una correzione di refuso. Il file dice invece
// "questa volta minor", e il rilascio lo rispetta. Viene cancellato dopo
// l'uso, perché un ordine consumed è un ordine eseguito: lasciarlo farebbe
// alzare di minor anche il rilascio successivo, che invece sarà una patch.
//
//   echo minor > .rilascio     e poi si fa il push
//
// Perché un solo script. Prima la versione era in tre posti (package.json,
// electron/package.json, CHANGELOG.md) e i compiti erano spartiti fra
// `version.mjs` e `versione-check.mjs`: uno alzava, l'altro guardava, e
// nessuno dei due sapeva dell'altro. Il difetto che ne è venuto fuori è
// pubblico e irreversibile — un pacchetto il cui numero non coincide con il
// tag non si può più correggere, e l'aggiornamento automatico legge un
// `latest.yml` che promette un file con un altro nome. Qui le due metà sono
// la stessa funzione: chi alza è lo stesso codice che controlla, quindi non
// possono divergere.
//
// **electron/package.json tiene ancora la versione**, e non per comodità:
// electron-builder la legge da lì per il nome dei file e per i metadati del
// pacchetto. Non si può toglierla senza passare la versione sulla riga di
// comando di electron-builder, cosa che in questo ambiente non è collaudabile
// e che romperebbe i rilasci. Quindi la fonte è `package.json` e l'altro
// file è un'eco controllata: se differiscono, `controlla` lo dice e si ferma.

import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const SORGENTE = "package.json";
const ECO = "electron/package.json";
const ORDINE = ".rilascio";
const LIVELLI = { major: 0, minor: 1, patch: 2 };

const leggi = (file) => JSON.parse(readFileSync(file, "utf8")).version;

function scrivi(file, versione) {
  const testo = readFileSync(file, "utf8");
  // Sostituisce solo la riga "version": gli altri campi restano come sono,
  // commenti compresi, cosa che riscrivere tutto il file non farebbe.
  const aggiornato = testo.replace(/("version":\s*")[^"]+(")/, `$1${versione}$2`);
  if (aggiornato === testo) {
    console.error(`ERRORE: nessuna versione trovata in ${file}`);
    process.exit(1);
  }
  writeFileSync(file, aggiornato);
}

function nuovaVersione(attuale, livello) {
  const [maggiore, minore, patch] = attuale.split(".").map(Number);
  if ([maggiore, minore, patch].some((n) => Number.isNaN(n))) {
    console.error(`ERRORE: versione non riconosciuta: "${attuale}"`);
    process.exit(1);
  }
  if (livello === "major") return `${maggiore + 1}.0.0`;
  if (livello === "minor") return `${maggiore}.${minore + 1}.0`;
  return `${maggiore}.${minore}.${patch + 1}`;
}

/**
 * I problemi della versione, uno per frase pronta per il log.
 *
 * Vuota quando tutto torna: è il caso che il rilascio richiede.
 */
export function problemi({ versione, eco, tag } = {}) {
  const problemi = [];
  if (eco !== undefined && eco !== versione) {
    problemi.push(
      `${ECO} è alla versione ${eco}, diversa da ${SORGENTE} (${versione}): l'eco si riscrive con questo script, non a mano.`,
    );
  }
  if (tag !== undefined) {
    const atteso = `v${versione}`;
    if (tag !== atteso) {
      problemi.push(`il tag è ${tag} ma la versione è ${versione}: dovrebbe essere ${atteso}`);
    }
  }
  return problemi;
}

/**
 * Controlla, e in caso di problemi esce con codice 1.
 *
 * Il tag si guarda solo quando il run è davvero partito da un tag: su un push
 * su un branch `GITHUB_REF_NAME` è "master", e confrontarlo con la versione
 * bloccherebbe ogni versionamento.
 */
export function controlla() {
  const versione = leggi(SORGENTE);
  const tag = process.env.GITHUB_REF_TYPE === "tag" ? process.env.GITHUB_REF_NAME : undefined;
  const errori = problemi({ versione, eco: leggi(ECO), tag });
  if (errori.length > 0) {
    console.error(errori.map((p) => `ERRORE: ${p}`).join("\n"));
    process.exit(1);
  }
  return versione;
}

/**
 * Il livello scritto in `.rilascio`, o "" se non c'è.
 *
 * Una parola sola, senza spazi: è un file che si scrive a mano e che non
 * deve avere dentro la metà di un errore. Se c'è ma non è un livello noto
 * viene detto e si esce: continuare con un valore di default sarebbe
 * pubblicare un numero che nessuno ha chiesto.
 */
export function leggiOrdine(percorso = ORDINE) {
  if (!existsSync(percorso)) return "";
  const testo = readFileSync(percorso, "utf8").trim();
  if (testo === "") return "";
  if (!(testo in LIVELLI)) {
    console.error(
      `ERRORE: ${percorso} contiene "${testo}" e i livelli sono ${Object.keys(LIVELLI).join("|")}.`,
    );
    process.exit(1);
  }
  return testo;
}

/**
 * Alza la versione in tutti i punti in cui compare, e annota il CHANGELOG.
 *
 * L'ordine in `.rilascio` vale più dell'argomento della riga di comando, e
 * viene cancellato qui dentro: chi lo scrive non deve ricordarsi di
 * toglierlo, e un rilascio dopo non eredita un livello che non gli spetta.
 */
export function alza(livello, { ordine = ORDINE } = {}) {
  if (!(livello in LIVELLI)) {
    console.error(`ERRORE: uso: node scripts/versione.mjs ${Object.keys(LIVELLI).join("|")}`);
    process.exit(1);
  }
  const attuale = leggi(SORGENTE);
  const prossima = nuovaVersione(attuale, livello);

  for (const file of [SORGENTE, ECO]) scrivi(file, prossima);

  const oggi = new Date().toISOString().slice(0, 10);
  const riga = `## ${prossima} — ${oggi}\n\n- Versione incrementata automaticamente (${livello}).\n`;
  try {
    const changelog = readFileSync("CHANGELOG.md", "utf8");
    const [testata, ...corpo] = changelog.split("\n");
    writeFileSync("CHANGELOG.md", `${testata}\n\n${riga}${corpo.join("\n")}`);
  } catch {
    writeFileSync("CHANGELOG.md", `# Changelog\n\n${riga}`);
  }

  return { attuale, prossima, consumato: leggiOrdine(ordine) !== "" };
}

// Si esegue solo se il file è il punto d'ingresso, così i test possono
// importare le funzioni senza far partire il controllo. pathToFileURL e non
// una stringa costruita a mano: su Windows il percorso è `C:/...` e
// `file://` + quello dà due slash, mentre l'URL ne ha tre.
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const argomento = process.argv[2];
  const ordine = leggiOrdine();
  if (argomento === undefined && ordine === "") {
    console.log(`versione coerente: ${controlla()}`);
  } else {
    const livello = ordine || argomento;
    if (ordine) console.log(`ordine in ${ORDINE}: ${ordine}`);
    const { attuale, prossima, consumato } = alza(livello);
    // L'ordine è eseguito: sparisce, o il prossimo rilascio si leverebbe
    // ancora di minor. Il file è in `paths-ignore`, quindi questa rimozione
    // non mette in moto un rilascio nuovo.
    if (consumato) rmSync(ORDINE, { force: true });
    // Dopo aver scritto, si ricontrolla: se le tre copie non tornano è un
    // difetto di questo script, e deve fermare il rilascio qui e non dopo.
    controlla();
    console.log(`${attuale} → ${prossima}`);
  }
}
