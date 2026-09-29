/**
 * Tipi di `versione.mjs`, per chi lo importa da TypeScript.
 *
 * Lo script è JavaScript perché gira anche dentro il workflow, senza passare
 * da una compilazione. Ma i test lo importano per provare `problemi` senza
 * doverlo eseguire, e senza questo file TypeScript lo tratta come un modulo
 * senza dichiarazioni. Lo stesso motivo per cui esiste
 * `electron/server-locale.d.cts`.
 */

/** Una versione di pacchetto, come la scrive chi la usa. */
export interface VersioniDaControllare {
  /** La versione della fonte, `package.json`. */
  versione?: string;
  /** L'eco in `electron/package.json`, che electron-builder legge per i pacchetti. */
  eco?: string;
  /** Il tag, quando il run è partito da un tag e non da un branch. */
  tag?: string;
}

/**
 * I problemi della versione, uno per frase pronta per il log.
 *
 * Vuota quando tutto torna: è il caso che il rilascio richiede.
 */
export declare function problemi(versioni?: VersioniDaControllare): string[];

/**
 * Controlla, e in caso di problemi esce con codice 1.
 *
 * Il tag si guarda solo quando il run è davvero partito da un tag: su un push
 * su un branch `GITHUB_REF_NAME` è "master", e confrontarlo con la versione
 * bloccherebbe ogni versionamento.
 */
export declare function controlla(): string;

/** Alza la versione in tutti i punti in cui compare, e annota il CHANGELOG. */
export declare function alza(livello: string): { attuale: string; prossima: string };
