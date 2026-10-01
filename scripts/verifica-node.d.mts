/**
 * Tipi di `verifica-node.mjs`, per chi lo importa da TypeScript.
 *
 * Lo script è JavaScript perché gira anche come `pretest` in un `package.json`,
 * senza passare da una compilazione. Ma i test lo importano per provare il
 * confronto delle versioni senza doverlo eseguire, e senza questo file
 * TypeScript lo tratta come un modulo senza dichiarazioni. Lo stesso motivo
 * per cui esiste `scripts/versione.d.mts`.
 */

/** Il minimo, come lo confronta lo script: maggiore e minore. */
export declare const NODE_MINIMO: [number, number];

/**
 * La versione è troppo vecchia? Un numero non riconosciuto conta come sì.
 *
 * Accetta la `v` che mette `node --version`.
 */
export declare function troppoVecchio(
  versione: string | undefined,
  minimo?: [number, number],
): boolean;

/** Il messaggio: che versione c'è, perché non basta e che cosa fare. */
export declare function messaggio(versione: string): string;
