/**
 * Tipi di `verifica-edge-function.mjs`, per chi lo importa da TypeScript.
 *
 * Come `versione.d.mts`: lo script è JavaScript perché gira nel workflow
 * senza compilazione, ma i test lo importano per provare il confronto senza
 * toccare la rete.
 */

/** Una funzione da confrontare, con tutti i suoi file. */
export interface Confronto {
  /** Il nome della funzione, come la chiama Supabase. */
  nome: string;
  /** I file del repository: percorso relativo → contenuto. */
  locale: Record<string, string>;
  /** I file pubblicati, se la funzione esiste. */
  pubblicato?: Record<string, string> | null;
}

/**
 * I problemi fra i file di una funzione nel repository e quelli pubblicati.
 *
 * Vuota quando coincidono: è il caso che il rilascio richiede.
 */
export declare function confronta(confronto: Confronto): string[];

/**
 * Le parti del sorgente che non cambiano il comportamento.
 *
 * Toglie solo i fine riga e l'eventuale shebang, così un file davvero
 * diverso viene ancora segnalato.
 */
export declare function normalizza(testo: string): string;

/** Le funzioni da confrontare, tutte. */
export declare const FUNZIONI: string[];

/**
 * I file di una funzione, come li ha il repository: percorso relativo →
 * contenuto. La cartella della funzione è la fonte, così un file nuovo non
 * può restare fuori dal confronto per dimenticanza.
 */
export declare function leggiFunzione(nome: string): Record<string, string>;
