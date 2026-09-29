/**
 * Tipi di `verifica-edge-function.mjs`, per chi lo importa da TypeScript.
 *
 * Come `versione.d.mts`: lo script è JavaScript perché gira nel workflow
 * senza compilazione, ma i test lo importano per provare il confronto senza
 * toccare la rete.
 */

/** Un sorgente da confrontare. */
export interface Confronto {
  /** Il codice del repository. */
  locale: string;
  /** Il codice pubblicato su Supabase, se la funzione esiste. */
  pubblicato?: string | null;
}

/**
 * I problemi fra il codice nel repository e quello pubblicato.
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
