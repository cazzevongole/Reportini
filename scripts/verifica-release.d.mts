/**
 * Tipi di `verifica-release.mjs`, per chi lo importa da TypeScript.
 *
 * Lo script è JavaScript perché gira dentro GitHub Actions, senza passare da
 * una compilazione. Ma i test lo importano per provare il giudizio sulla
 * release senza dover chiamare GitHub, e senza questo file TypeScript lo
 * tratta come un modulo senza dichiarazioni. Lo stesso motivo per cui esiste
 * `scripts/verifica-node.d.mts`.
 */

/** Un allegato della release, come lo restituisce `gh release view --json`. */
export interface AllegatoRelease {
  name: string;
}

/** La release come la legge `gh release view --json`. */
export interface Release {
  /** Una bozza esiste ma non è visibile: `--latest` non la pubblica. */
  isDraft?: boolean;
  /** Una prerelease non viene proposta come aggiornamento. */
  isPrerelease?: boolean;
  /** Il titolo, che è `Reportini <tag>`. */
  name?: string;
  tagName?: string;
  assets?: AllegatoRelease[];
}

/** I pacchetti che una release deve avere, per estensione. */
export declare const PACCHETTI: { estensione: string; sistema: string }[];

/**
 * I problemi di una release pubblicata, uno per frase pronta per il log.
 *
 * Vuota quando tutto torna: è questo il caso che il rilascio richiede.
 */
export declare function problemiInRelease(release: Release, attesi?: string[]): string[];

/** I nomi dei file in una cartella, senza le directory. */
export declare function nomiIn(cartella: string): string[];

/**
 * Il guscio: legge la release, giudica, scrive, e restituisce il codice di
 * uscita.
 *
 * `leggi` riceve il tag e restituisce la release; `scrive` riceve i messaggi.
 * Sono parametri perché il test non può chiamare GitHub.
 */
export declare function verifica(
  tag: string,
  cartella: string,
  leggi: (tag: string) => Release,
  scrive?: { log: (riga: string) => void; error: (riga: string) => void },
): number;

/** Come legge la release il workflow: da GitHub, con `gh`. */
export declare function leggiDaGitHub(tag: string): Release;
