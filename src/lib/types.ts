export type StatoAttivita = "in-attesa" | "confermato" | "annullato";

/**
 * I due tipi di attività. Appuntamento e chiamata sono la stessa cosa: si
 * creano entrambi dalla pagina dell'azienda e producono entrambi un evento su
 * Google Calendar, il cui titolo è questa parola in maiuscolo più il titolo
 * dell'attività. Sono due valori di un campo, non due entità.
 */
export type TipoAttivita = "appuntamento" | "chiamata";

/**
 * Come la parola del tipo si scrive nel titolo dell'evento.
 *
 * Sta in un posto solo perché il titolo è la cosa che l'utente legge sul
 * calendario: se la parola cambiasse in due punti, ci sarebbero due modi di
 * scrivere lo stesso titolo e il giorno uno dei due avrebbe la maiuscola.
 */
export const ETICHETTA_TIPO: Record<TipoAttivita, string> = {
  appuntamento: "APPUNTAMENTO",
  chiamata: "CHIAMATA",
};

/**
 * Quanto dura una chiamata, se non si dice.
 *
 * Una chiamata non ha un inizio e una fine: ha un momento. Sulla tabella
 * l'inizio e la fine ci devono stare lo stesso — il riepilogo e la ricerca
 * leggono sempre l'inizio — ma la fine si calcola qui invece di essere
 * scritta due volte e discordata.
 */
export const MINUTI_CHIAMATA = 30;

/** Il titolo dell'evento su Google Calendar, per un'attività. */
export function titoloEvento(tipo: TipoAttivita, titolo: string): string {
  // Un'attività senza titolo è possibile (il campo non è obbligatorio a
  // priori), ma un evento con un trattino sospeso in fondo sarebbe un evento
  // senza nome. Meglio il tipo da solo: su un calendario si vede comunque che
  // è un appuntamento o una chiamata.
  const testo = titolo.trim();
  return testo ? `${ETICHETTA_TIPO[tipo]} - ${testo}` : ETICHETTA_TIPO[tipo];
}

/** La fine di un'attività: per la chiamata è il momento più i minuti default. */
export function fineAttivita(tipo: TipoAttivita, inizio: string): string {
  const fine = new Date(new Date(inizio).getTime() + MINUTI_CHIAMATA * 60000);
  return tipo === "chiamata" ? fine.toISOString() : inizio;
}

/**
 * Come si legge lo stato, in italiano, per il tipo giusto.
 *
 * Una chiamata ha "fatta", un appuntamento ha "confermato": sono la stessa
 * informazione detta con le parole di ciascuno, e su una chiamata la parola
 * viene dalla sola casella. Senza questa funzione ogni
 * lista scriverebbe una delle due parole anche quando non è quella, e
 * l'utente leggerebbe "confermato" su una chiamata come se fosse un termine
 * burocratico.
 */
export function etichettaStato(
  tipo: TipoAttivita,
  stato: StatoAttivita,
  completata: boolean,
): string {
  if (tipo === "chiamata") {
    return completata ? "fatta" : "da fare";
  }
  return stato === "in-attesa" ? "in attesa" : stato === "confermato" ? "confermato" : "annullato";
}

/**
 * Le colonne che una chiamata finisce col avere, compresa la sola.
 *
 * Una chiamata si fa o non si fa: l'unico comando è la casella "fatta", e
 * non c'è una terza parola da scegliere. `stato` non è un dato che l'utente
 * abbia scritto — è quello che segue la casella, perché su Google orienta il
 * colore — quindi non ha senso esporlo come una scelta che possa divergere
 * dalla casella: è la stessa informazione in due colonne, e due scritture
 * lasciano una finestra in cui la chiamata è "fatta" e non ancora confermata.
 */
export function colonneChiamata(completata: boolean): {
  stato: StatoAttivita;
  completata: boolean;
} {
  return { stato: completata ? "confermato" : "in-attesa", completata };
}

/**
 * La riga "Stato: ..." che va nella descrizione dell'evento.
 *
 * Su Google la parola è l'unica che resta aperta a chi legge l'evento da
 * solo, e per una chiamata "in attesa di conferma" non significa niente:
 * significa solo "non l'ho ancora fatta".
 */
export function rigaStatoEvento(
  tipo: TipoAttivita,
  stato: StatoAttivita,
  completata: boolean,
): string {
  if (tipo === "chiamata") {
    return completata ? "Stato: fatta" : "Stato: da fare";
  }
  const parole: Record<StatoAttivita, string> = {
    "in-attesa": "in attesa di conferma",
    confermato: "confermato",
    annullato: "annullato",
  };
  return `Stato: ${parole[stato]}`;
}

/**
 * Il soggetto di report e attività: un'azienda, non una persona.
 *
 * I campi sono quelli che servono per identificarla e scriverle — ragione
 * sociale e partita iva, più il recapito — e niente altro. Quello che
 * riguarda le persone (nascita, sesso, nazionalità, documento) non è qui:
 * le persone sono i referenti, che vivono nella tabella accanto e non sono
 * il soggetto di nessun report né di nessuna attività.
 */
export interface Azienda {
  id: number;
  ragioneSociale: string;
  partitaIva: string;
  indirizzo: string;
  citta: string;
  cap: string;
  provincia: string;
  telefono: string;
  email: string;
  note: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * La persona con cui si parla dell'azienda.
 *
 * Nobile, non referentato: il referente è il modo in cui l'azienda viene
 * cercata e come si sa a chi scrivere, non il soggetto di un report.
 */
export interface Referente {
  id: number;
  aziendaId: number;
  nome: string;
  cognome: string;
  telefono: string;
  email: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Il report di un'attività svolta.
 *
 * Non ha uno `stato` e non ha una `data`: il report descrive quello che è
 * successo, e sia il quando sia il come stanno già nell'attività a cui si
 * riferisce. Non ha nemmeno un `tipo`: quello è dell'attività, e averlo
 * anche qui sarebbe una seconda fonte che può dire una cosa diversa.
 */
export interface Report {
  id: number;
  aziendaId: number;
  attivitaId: number;
  titolo: string;
  descrizione: string;
  createdAt: string;
  updatedAt: string;
}

export interface Attivita {
  id: number;
  aziendaId: number;
  titolo: string;
  descrizione: string;
  tipo: TipoAttivita;
  inizio: string;
  fine: string;
  luogo: string;
  stato: StatoAttivita;
  /**
   * L'attività è stata svolta. È da qui che si genera il report, ed è
   * l'unica cosa che rende la casella utile: senza di lei il report non ha un
   * soggetto da cui nascere.
   */
  completata: boolean;
  promemoriaMin: number;
  googleEventId: string | null;
  googleCalendarId: string | null;
  googleHtmlLink: string | null;
  googleSyncAt: string | null;
  /**
   * Perché l'ultimo tentativo di pubblicazione è fallito, se è fallito.
   *
   * Vive sull'attività e non in un avviso perché un avviso sparisce: un
   * salvataggio riuscito con la pubblicazione fallita sembrava identico a
   * uno riuscito del tutto, e l'unica traccia del problema era una notifica
   * verde sparita di lì a poco. Qui la ragione aspetta che l'utente la legga.
   */
  googleErrore: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AziendaConTotali extends Azienda {
  numReport: number;
  numAttivita: number;
  numReferenti: number;
}

export interface ReportDettagliato extends Report {
  aziendaRagioneSociale: string;
  aziendaPartitaIva: string;
  /** Dall'attività: è il tipo che finisce nel titolo dell'evento. */
  attivitaTipo: TipoAttivita;
  attivitaTitolo: string;
  attivitaInizio: string;
}

export interface AttivitaDettagliata extends Attivita {
  aziendaRagioneSociale: string;
  aziendaPartitaIva: string;
}
