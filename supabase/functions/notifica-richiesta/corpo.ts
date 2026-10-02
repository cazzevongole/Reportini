// =============================================================================
// Reportini · costruzione della mail di notifica (Supabase Edge Function)
//
// Il pezzo puro della funzione `notifica-richiesta`: nessun segreto, nessuna
// rete, nessun `Deno`. Sta in un file a parte per due motivi.
//
// Il primo è che questo è il posto dove il testo dell'utente diventa una mail.
// `titolo` e `corpo` li scrive chiunque abbia un account, quindi finiscono
// dentro un documento HTML che un programma di posta aprirà: senza escape,
// un utente potrebbe scrivere un'<a href="https://esempio.it">Segui il link</a>`
// e il titolo arriverebbe cliccabile, con il mittente spoofato. Qui si
// sostituiscono i quattro caratteri che hanno un significato in HTML.
//
// Il secondo è che un file senza `Deno` si può provare con vitest, e questa è
// la parte in cui un errore non si vede: la mail parte, arriva, e il problema
// emerge mesi dopo, da una casella che non si ricorda più.
// =============================================================================

/**
 * Quale delle due mail è questa.
 *
 * Sono due perché i destinatari sono due tabelle diverse: `nuova` va agli
 * indirizzi della tabella `sviluppatori`, `chiusura` all'unico indirizzo
 * dell'utente che ha scritto. Sono anche due lati opposti della stessa
 * conversazione, e tenerli insieme in una funzione sola significa che
 * ogni modifica alla mail di chiusura rischia di rompere quella d'avviso.
 */
export type ModoNotifica = "nuova" | "chiusura";

/** Come arriva la richiesta dal trigger, con i destinatari già risolti. */
export interface RichiestaNotifica {
  /** Quale delle due mail mandare. Se manca è `nuova`: è il modo di prima. */
  modo?: ModoNotifica;
  id?: string;
  tipo?: string;
  titolo?: string;
  corpo?: string;
  /** Email di chi ha scritto: viene dalla sessione, non dal modulo. */
  email?: string;
  /** La risposta dello sviluppatore, presente solo nella mail di chiusura. */
  risposta?: string | null;
  creata?: string;
  /** Quando la richiesta è passata a "risolta". */
  chiusa?: string;
  /** Agli indirizzi della tabella `sviluppatori`, letti dal database. */
  destinatari?: string[];
}

export interface Messaggio {
  /** Mittente, nella forma `Nome <indirizzo>` che Resend accetta. */
  da: string;
  a: string[];
  oggetto: string;
  testo: string;
  html: string;
  /** A chi risponde il pulsante "Rispondi" della mail: l'utente che ha scritto. */
  rispondiA?: string;
}

export interface Opzioni {
  mittente: string;
  /** Dove si risponde, cioè la sezione sviluppo. */
  sito?: string;
}

/**
 * Ciò che la funzione si trova nell'ambiente.
 *
 * `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` non li mette nessuno: li
 * inietta Supabase in ogni Edge Function. Ci sono perché senza quelli non c'è
 * modo di chiedere al database se la chiave sia quella giusta, e una funzione
 * che non può chiedere deve dire che non può, invece di accettare.
 */
export interface Segreti {
  RESEND_API_KEY?: string;
  RESEND_MITTENTE?: string;
  SITO_URL?: string;
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
}

/**
 * I segreti che mancano, per nome.
 *
 * Nomi e non un conteggio: il 503 li elenca, e «manca qualcosa» senza dire
 * cosa è un errore che si ripresenta a ogni tentativo.
 */
export function segretiMancanti(segreti: Segreti): string[] {
  const necessari = [
    "RESEND_API_KEY",
    "RESEND_MITTENTE",
    "SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
  ] as const;
  return necessari.filter((nome) => !segreti[nome]);
}

/** Etichetta leggibile per il tipo, senza dipendere dalla lingua del codice. */
const ETICHETTE: Record<string, string> = {
  fix: "Qualcosa non va",
  funzionalita: "Mi serve che si possa fare",
};

/**
 * I quattro caratteri che HTML interpreta.
 *
 * `&` va per primo: rifarlo dopo gli altri produrrebbe `&amp;lt;` invece di
 * `&lt;`, cioè un doppio escape che l'utente vedrebbe come testo sparso nella
 * mail invece che come carattere.
 */
export function sfuggiHtml(testo: string): string {
  return testo
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Gli indirizzi che sono davvero indirizzi.
 *
 * Non è paranoia sul database: è che la funzione è pubblicata su un URL
 * pubblico e, se un domani dell'iniezione riuscisse a far arrivare un corpo
 * fasullo, l'unico controllo che glielo impedisce è questo. Bastano anche i
 * due filtri più banali, `spazi` e `virgola`, che sono i modi con cui un
 * elenco finisce per aggiungere destinatari che nessuno ha scritto.
 */
export function indirizziValidi(indirizzi: readonly string[]): string[] {
  const unici = new Set<string>();
  for (const candidato of indirizzi) {
    const indirizzo = (candidato ?? "").trim().toLowerCase();
    if (!indirizzo || /[\s,<>"']/.test(indirizzo)) continue;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(indirizzo)) continue;
    unici.add(indirizzo);
  }
  // Una cifra non è paranoia: è il numero di sviluppatori che nella pratica
  // possono esistere. Se un domani sciagurato mettesse mille indirizzi falsi,
  // la coda di Resend si riempirebbe di posta a persone che non l'hanno chiesta.
  return [...unici].slice(0, 20);
}

/** Tetto dell'oggetto: la casella mostra una riga sola, il resto finisce in … */
const OGGETTO_MASSIMO = 100;

/** Sotto questo titolo non si scende, nemmeno con un'etichetta lunga. */
const TITOLO_MINIMO = 20;

/**
 * L'oggetto, con il titolo accorciato.
 *
 * Il tetto è sul testo intero e non sul titolo: è l'oggetto che finisce
 * nella riga di anteprima, e un prefisso come "Reportini · Mi serve che si
 * possa fare: " è metà della riga. Il titolo riceve quello che resta, col
 * pavimento di `TITOLO_MINIMO` per non restare senza niente se un'etichetta
 * dovesse crescere ancora.
 */
export function oggetto(richiesta: RichiestaNotifica, lunghezzaMassima = OGGETTO_MASSIMO): string {
  // La mail di chiusura non porta la domanda dell'utente nel soggetto: porta
  // il fatto che è stata chiusa, che è la notizia. Il titolo della richiesta
  // resta nel corpo, dove c'è spazio per leggerlo intero.
  if (richiesta.modo === "chiusura") {
    return "Reportini · la tua richiesta è stata risolta";
  }
  const etichetta = ETICHETTE[richiesta.tipo ?? ""] ?? "Richiesta";
  const titolo = (richiesta.titolo ?? "").trim().replace(/\s+/g, " ");
  if (!titolo) return `Reportini · ${etichetta}`;
  const prefisso = `Reportini · ${etichetta}: `;
  const spazio = Math.max(TITOLO_MINIMO, lunghezzaMassima - prefisso.length);
  const corto = titolo.length > spazio ? `${titolo.slice(0, spazio - 1)}…` : titolo;
  return `${prefisso}${corto}`;
}

/** Il testo come lo mostra un programma di posta che non legge l'HTML. */
function testoPiano(richiesta: RichiestaNotifica, sito: string): string {
  return [
    "Richiesta da Reportini.",
    "",
    `Chi l'ha scritta: ${richiesta.email ?? "indirizzo non noto"}`,
    `Quando: ${richiesta.creata ?? "momento non noto"}`,
    "",
    (richiesta.titolo ?? "").trim(),
    "",
    (richiesta.corpo ?? "").trim(),
    "",
    `Per leggerla e rispondere: ${sito}/panel/sviluppo`,
    "Nella risposta alla mail, l'utente vede solo quello che scrivi tu:",
    "la sezione sviluppo non manda mail al posto tuo.",
  ].join("\n");
}

/**
 * Il documento HTML.
 *
 * Niente tabelle a celle fisse: sono la cosa che si rompe quando il programma
 * di posta raddoppia la dimensione del carattere, e qui non c'è nessuna
 * tabella da allineare. Il collegamento è l'unica cosa cliccabile, e porta
 * alla sezione sviluppo: da lì si risponde all'utente come si risponde a
 * qualunque altra richiesta.
 */
function corpoHtml(richiesta: RichiestaNotifica, sito: string): string {
  const titolo = sfuggiHtml((richiesta.titolo ?? "").trim());
  const corpo = sfuggiHtml((richiesta.corpo ?? "").trim());
  const email = sfuggiHtml((richiesta.email ?? "indirizzo non noto"));
  const quando = sfuggiHtml((richiesta.creata ?? "momento non noto"));
  return `<!doctype html>
<html lang="it">
<body style="margin:0;padding:24px;background:#f7f6f2;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#1c1b18">
  <div style="max-width:600px;margin:0 auto;background:#fff;border:1px solid #e6e4de;border-radius:12px;padding:24px">
    <p style="margin:0 0 4px;font-size:13px;color:#6f6b63">Richiesta da Reportini</p>
    <p style="margin:0 0 16px;font-size:13px;color:#6f6b63">
      Scritta da ${email} &middot; ${quando}
    </p>
    <h1 style="margin:0 0 12px;font-size:18px;line-height:1.35;font-weight:600">${titolo}</h1>
    <p style="margin:0 0 20px;font-size:15px;line-height:1.6;white-space:pre-wrap">${corpo}</p>
    <p style="margin:0 0 20px">
      <a href="${sito}/panel/sviluppo" style="background:#1c1b18;color:#fff;text-decoration:none;padding:10px 16px;border-radius:8px;display:inline-block;font-size:14px">Apri la sezione sviluppo</a>
    </p>
    <p style="margin:0;font-size:12px;line-height:1.6;color:#6f6b63">
      Rispondere alla mail non registra niente: la risposta all'utente si scrive
      nella sezione sviluppo, che &egrave; l'unica che lui vede.
    </p>
  </div>
</body>
</html>`;
}

/* ----------------------------- la mail di chiusura ------------------------- */

/**
 * Il testo della risposta, o un testo che dice comunque qualcosa.
 *
 * Il "se non c'è risposta" non è una cortesia: è il caso in cui lo sviluppatore
 * chiude la richiesta senza scrivere niente, che è una richiesta chiusa senza
 * spiegazione. Meglio una riga che dice come trovare la risposta che una mail
 * vuota, che l'utente legge come un errore dell'invio.
 */
function rispostaLeggibile(risposta: string | null | undefined): string {
  const testo = (risposta ?? "").trim();
  return testo || "La richiesta è stata chiusa senza una risposta scritta.";
}

/**
 * Il corpo della mail di chiusura, in testo piano.
 *
 * Qui `email` non è il mittente: è il destinatario, e non compare nel testo
 * perché scrivere a qualcuno il suo indirizzo non aggiunge niente.
 */
function testoChiusura(richiesta: RichiestaNotifica, sito: string): string {
  return [
    "La tua richiesta su Reportini è stata risolta.",
    "",
    `Richiesta: ${(richiesta.titolo ?? "").trim() || "(senza titolo)"}`,
    "",
    "Che cosa è stato fatto:",
    rispostaLeggibile(richiesta.risposta),
    "",
    `Per rileggerla e aprirne un'altra: ${sito}/panel`,
    "",
    "Questa mail l'ha mandata Reportini quando la richiesta è passata a",
    "risolta. Se hai scritto qualcosa che non ti torna, rispondi pure.",
  ].join("\n");
}

/**
 * Il documento HTML della mail di chiusura.
 *
 * La risposta dello sviluppatore viene sfuggita come tutto il resto: è testo
 * che arriva dal database, e senza `sfuggiHtml` un `<a href=…>` scritto in una
 * risposta diventerebbe un collegamento cliccabile nella mail di qualcun altro.
 */
function corpoChiusuraHtml(richiesta: RichiestaNotifica, sito: string): string {
  const titolo = sfuggiHtml((richiesta.titolo ?? "").trim() || "Richiesta senza titolo");
  const risposta = sfuggiHtml(rispostaLeggibile(richiesta.risposta));
  return `<!doctype html>
<html lang="it">
<body style="margin:0;padding:24px;background:#f7f6f2;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#1c1b18">
  <div style="max-width:600px;margin:0 auto;background:#fff;border:1px solid #e6e4de;border-radius:12px;padding:24px">
    <p style="margin:0 0 4px;font-size:13px;color:#6f6b63">Reportini</p>
    <p style="margin:0 0 16px;font-size:13px;color:#6f6b63">La tua richiesta è stata risolta</p>
    <h1 style="margin:0 0 20px;font-size:17px;line-height:1.4;font-weight:600;color:#6f6b63">${titolo}</h1>
    <div style="margin:0 0 20px;border-left:2px solid #12b394;padding:2px 0 2px 12px">
      <p style="margin:0 0 6px;font-size:13px;color:#6f6b63">Che cosa è stato fatto</p>
      <p style="margin:0;font-size:15px;line-height:1.6;white-space:pre-wrap">${risposta}</p>
    </div>
    <p style="margin:0 0 20px">
      <a href="${sito}/panel" style="background:#1c1b18;color:#fff;text-decoration:none;padding:10px 16px;border-radius:8px;display:inline-block;font-size:14px">Apri Reportini</a>
    </p>
    <p style="margin:0;font-size:12px;line-height:1.6;color:#6f6b63">
      Se hai scritto qualcosa che non ti torna, puoi rispondere a questa mail:
      arriva a chi sviluppa l'app.
    </p>
  </div>
</body>
</html>`;
}

/**
 * Il messaggio da mandare, o `null` se non c'è nessuno a cui mandarlo.
 *
 * `null` invece di un errore: una richiesta senza sviluppatori in lista
 * (una tabella appena svuotata, un progetto appena creato) è una situazione
 * che si risolve scrivendo una riga, e far fallire l'invio non aiuterebbe
 * nessuno. La richiesta resta comunque nella tabella, che è la sua vera casa.
 */
export function costruisciMessaggio(
  richiesta: RichiestaNotifica,
  opzioni: Opzioni,
): Messaggio | null {
  const sito = (opzioni.sito ?? "https://reportini.cazzevongole.com").replace(/\/+$/, "");

  // Il modo di prima è "nuova": senza il campo si continua a mandare la mail
  // d'avviso, ed è quello che vuole un trigger vecchio che non è stato
  // ancora rigenerato.
  const modo = richiesta.modo ?? "nuova";

  if (modo === "chiusura") {
    // Qui il destinatario è l'utente che ha scritto, che arriva in `email` e
    // non in `destinatari`: passare per lo stesso filtro serve anche perché
    // l'indirizzo viene dal database e non da un modulo, ma il filtro resta
    // quello che scarta un indirizzo che non è un indirizzo.
    const allUtente = indirizziValidi([richiesta.email ?? ""]);
    if (allUtente.length === 0) return null;
    return {
      da: opzioni.mittente,
      a: allUtente,
      oggetto: oggetto(richiesta),
      testo: testoChiusura(richiesta, sito),
      html: corpoChiusuraHtml(richiesta, sito),
    };
  }

  const a = indirizziValidi(richiesta.destinatari ?? []);
  if (a.length === 0) return null;
  const rispondiA = (richiesta.email ?? "").trim();
  return {
    da: opzioni.mittente,
    a,
    oggetto: oggetto(richiesta),
    testo: testoPiano(richiesta, sito),
    html: corpoHtml(richiesta, sito),
    // Se l'indirizzo dell'utente non c'è (sessione Google senza email), la
    // mail parte senza `Reply-To` invece di dichiarare come destinatario di
    // risposta un indirizzo vuoto, che Resend rifiuta.
    ...(rispondiA && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rispondiA)
      ? { rispondiA }
      : {}),
  };
}