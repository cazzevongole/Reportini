export type Sesso = "M" | "F" | "O" | "";
export type StatoRelazione = "bozza" | "revisione" | "firmato" | "consegnato";
export type StatoAppuntamento = "in-attesa" | "confermato" | "annullato";

export interface Anagrafico {
  id: number;
  nome: string;
  cognome: string;
  documento: string;
  dataNascita: string | null;
  sesso: Sesso;
  nazionalita: string;
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

export interface Relazione {
  id: number;
  anagraficoId: number;
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
  anagraficoId: number | null;
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

export interface AnagraficoConTotali extends Anagrafico {
  numRelazioni: number;
  numAppuntamenti: number;
}

export interface RelazioneDettagliata extends Relazione {
  anagraficoNome: string;
  anagraficoCognome: string;
  anagraficoDocumento: string;
}

export interface AppuntamentoDettagliato extends Appuntamento {
  anagraficoNome: string | null;
  anagraficoCognome: string | null;
  anagraficoDocumento: string | null;
  relazioneTitolo: string | null;
}
