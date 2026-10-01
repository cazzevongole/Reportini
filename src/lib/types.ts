export type StatoRelazione = "bozza" | "revisione" | "firmato" | "consegnato";
export type StatoAppuntamento = "in-attesa" | "confermato" | "annullato";

/**
 * Il soggetto di relazioni e appuntamenti: un'azienda, non una persona.
 *
 * I campi sono quelli che servono per identificarla e scriverle — ragione
 * sociale e partita iva, più il recapito — e niente altro. Quello che
 * riguarda le persone (nascita, sesso, nazionalità, documento) non è qui:
 * le persone sono i referenti, che vivono nella tabella accanto e non
 * entrano in nessuna relazione né in nessun appuntamento.
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
 * cercata e come si sa a chi scrivere, non un soggetto delle relazioni.
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

export interface Relazione {
  id: number;
  aziendaId: number;
  titolo: string;
  tipo: string;
  stato: StatoRelazione;
  contenuto: string;
  data: string;
  createdAt: string;
  updatedAt: string;
}

export interface Appuntamento {
  id: number;
  aziendaId: number | null;
  relazioneId: number | null;
  titolo: string;
  descrizione: string;
  inizio: string;
  fine: string;
  luogo: string;
  stato: StatoAppuntamento;
  promemoriaMin: number;
  googleEventId: string | null;
  googleCalendarId: string | null;
  googleHtmlLink: string | null;
  googleSyncAt: string | null;
  /**
   * Perché l'ultimo tentativo di pubblicazione è fallito, se è fallito.
   *
   * Vive sull'appuntamento e non in un avviso perché un avviso sparisce: un
   * salvataggio riuscito con la pubblicazione fallita sembrava identico a
   * uno riuscito del tutto, e l'unica traccia del problema era una notifica
   * verde sparita di lì a poco. Qui la ragione aspetta che l'utente la legga.
   */
  googleErrore: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AziendaConTotali extends Azienda {
  numRelazioni: number;
  numAppuntamenti: number;
  numReferenti: number;
}

export interface RelazioneDettagliata extends Relazione {
  aziendaRagioneSociale: string;
  aziendaPartitaIva: string;
}

export interface AppuntamentoDettagliato extends Appuntamento {
  aziendaRagioneSociale: string | null;
  aziendaPartitaIva: string | null;
  relazioneTitolo: string | null;
}
