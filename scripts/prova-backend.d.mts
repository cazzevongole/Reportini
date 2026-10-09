/**
 * Tipi di `prova-backend.mjs`, per chi lo importa da TypeScript.
 *
 * Come `verifica-edge-function.d.mts`: lo script è JavaScript perché gira nel
 * workflow senza compilazione, ma i test lo importano per provare il giudizio
 * sui casi — 404, 503, origine sbagliata — senza toccare la rete.
 */

/** Cosa ha risposto la funzione. */
export interface Esito {
  stato: number;
  intestazioni: Record<string, string>;
  /** Il corpo interpretato, quando è JSON. */
  corpo?: unknown;
  /** Il corpo come è arrivato: serve nei messaggi quando non è JSON. */
  testo: string;
}

/** Una richiesta che non è nemmeno arrivata, con la causa. */
export interface RichiestaPersa {
  errore: string;
}

/** Quello che si osserva da una sonda: una risposta, o un errore di rete. */
export type Osservazione = Esito | RichiestaPersa;

/** Una richiesta da fare alla funzione. */
export interface Richiesta {
  url: string;
  metodo?: string;
  /** L'origine da dichiarare: è la cosa che il preflight deve riconoscere. */
  origine: string;
  intestazioni?: Record<string, string>;
  corpo?: Record<string, unknown>;
}

/** Una sonda: cosa chiedere, e cosa dire quando la risposta non è quella attesa. */
export interface Prova {
  nome: string;
  richiesta: Richiesta;
  /** Il problema (una frase da leggere) oppure `null` quando va bene. */
  atteso: (esito: Esito) => string | null;
}

/**
 * Le sonde, nell'ordine in cui vanno fatte.
 *
 * Il nome di ognuna è anche il messaggio letto da chi guarda la CI: cambiarlo
 * cambia quello che si legge quando qualcosa non va.
 */
export declare function prove(indirizzi: {
  funzione: string;
  origine: string;
  origineLocale: string;
  origineEstranea: string;
}): Prova[];

/**
 * I problemi di tutte le sonde, nell'ordine in cui sono state fatte.
 *
 * Vuota quando il backend è quello che deve essere. Una richiesta che non è
 * nemmeno partita è un problema quanto una risposta sbagliata, e la causa
 * (rete, DNS, timeout) fa parte del messaggio.
 */
export declare function problemi(esiti: { prova: Prova; esito: Osservazione }[]): string[];
