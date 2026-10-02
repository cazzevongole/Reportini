/**
 * Tipi di `verifica-edge-function.mjs`, per chi lo importa da TypeScript.
 *
 * Come `versione.d.mts`: lo script è JavaScript perché gira nel workflow
 * senza compilazione, ma i test lo importano per provare il confronto senza
 * toccare la rete.
 */

/** Le funzioni da confrontare, tutte. */
export declare const FUNZIONI: string[];

/** L'hash del codice di una funzione, come lo calcola il deploy. */
export declare function hashDi(nome: string): string;

/**
 * I problemi fra le funzioni del repository e quelle risultate pubblicate.
 *
 * Vuota quando coincidono: è il caso che il rilascio richiede.
 */
export declare function confronta(
  locale: Record<string, string>,
  pubblicati: Record<string, string> | null,
): string[];
