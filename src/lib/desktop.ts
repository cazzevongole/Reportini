/**
 * Il pacchetto desktop giusto per il sistema su cui si sta leggendo.
 *
 * Il link non può puntare direttamente al file: il nome cambia a ogni
 * versione (`Reportini-Setup-0.4.1.exe`, `Reportini-0.4.2-arm64.dmg`, …) e
 * un URL scritto a mano va bene solo fino alla release successiva, poi porta
 * a un 404 che l'utente vede come "il download non funziona".
 *
 * Per questo il link va alla **pagina della release**, non all'allegato:
 * GitHub ci mette vicino il pulsante di download del pacchetto giusto per il
 * sistema che sta leggendo, e quel pulsante non si rompe. Il tag si ricava
 * dalla versione in esecuzione, così la pagina aperta è quella che
 * corrisponde a quello che l'utente sta usando — e se la versione locale non
 * è ancora stata pubblicata, la pagina della release più recente è comunque
 * il posto giusto in cui andare.
 */

/** Il repository dove stanno le release. */
export const REPO = "cazzevongole/Reportini";

/** I tre sistemi per cui esiste un pacchetto. */
export type Sistema = "mac" | "windows" | "linux";

/**
 * Il sistema su cui sta girando il browser, se è uno di quelli supportati.
 *
 * `"unknown"` quando non lo si riconosce: meglio non offrire un download che
 * probabilmente non parte, che offrire `.dmg` a chi è su Linux. Il caso
 * davvero sconosciuto è raro (un browser su un sistema embedded, un test), e
 * in quel caso l'utente vede la pagina della release e sceglie da solo.
 */
export function sistema(): Sistema | "unknown" {
  // navigator è assente in un contesto non-browser: lo script gira anche
  // dentro GitHub Actions e nei test, dove non c'è nessuna finestra.
  if (typeof navigator === "undefined") return "unknown";

  const agente = navigator.userAgent || "";

  // **Prima** i telefoni, e questo è il punto di tutto: un telefono Android
  // scrive "Linux" nel user agent e un iPhone scrive "Mac OS X", quindi
  // senza questa riga i due righe sotto li avrebbero riconosciuti come
  // desktop e avrebbero offerto un pacchetto che non parte. Un download che
  // non funziona è peggio di nessun download: l'utente lo scarica, non si
  // apre, e conclude che l'app sia rotta.
  //
  // Ci mette anche i tablet, che hanno gli stessi segni nei nomi.
  if (/android|iphone|ipad|ipod/i.test(agente)) return "unknown";

  // Poi i tre sistemi, e l'ordine fra loro conta meno di quanto sembri:
  // nessuno dei tre nomi è contenuto in un altro. Resta che Windows sta
  // anche in "Windows Phone" e "Windows CE", che però sono già esclusi dalla
  // riga qui sopra: è l'unico modo in cui quelle stringhe non passerebbero.
  if (/windows/i.test(agente)) return "windows";
  // "Macintosh" e "Mac OS X" sono i due modi in cui il browser si presenta su
  // un computer Apple. Interessa il sistema, non l'apparecchio: qui dentro
  // non c'è nessun device senza pacchetto, perché i telefoni sono già fuori.
  if (/mac ?os|macintosh/i.test(agente)) return "mac";
  // "cros" è Chrome OS, che è un Linux e ha bisogno del pacchetto Linux.
  if (/linux|x11|cros/i.test(agente)) return "linux";
  return "unknown";
}

/** Come chiama ciascun sistema il proprio pacchetto, per dirlo all'utente. */
const ETICHETTA: Record<Sistema, { nome: string; estensione: string; come: string }> = {
  mac: {
    nome: "macOS",
    estensione: ".dmg",
    come: "aprilo e trascina Reportini nelle Applicazioni",
  },
  windows: {
    nome: "Windows",
    estensione: ".exe",
    come: "avvialo e segui l'installazione",
  },
  linux: {
    nome: "Linux",
    estensione: ".AppImage",
    come: "rendilo eseguibile e avvialo",
  },
};

/**
 * Il link alla pagina della release, per il sistema giusto.
 *
 * `versione` è la versione dell'app in esecuzione: se c'è, il link porta
 * alla release di quella versione, così quello che l'utente sta usando e
 * quello che scarica sono la stessa cosa. Senza versione (nel browser non
 * c'è, per costruzione) va all'ultima release.
 */
export function linkDownload(versione?: string): string {
  const base = `https://github.com/${REPO}/releases`;
  return versione ? `${base}/tag/v${versione}` : `${base}/latest`;
}

/**
 * Come si installa, per il sistema su cui si sta leggendo.
 *
 * `null` quando il sistema non è riconosciuto: in quel caso non si spiega
 * un'installazione che potrebbe non essere quella giusta, e la pagina della
 * release ha comunque le istruzioni di GitHub accanto al pulsante.
 */
export function istruzioni(sist: Sistema | "unknown"): string | null {
  if (sist === "unknown") return null;
  const { nome, estensione, come } = ETICHETTA[sist];
  return `Per ${nome}: scarica il pacchetto ${estensione} e ${come}.`;
}
