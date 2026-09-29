/**
 * Tipi di `dimensioni.mjs`, per chi lo importa da TypeScript.
 *
 * Lo script è JavaScript perché gira anche dentro il workflow, senza passare
 * da una compilazione. Ma i test lo importano per provare la verifica del
 * budget senza dover costruire un bundle vero, e senza questo file TypeScript
 * lo tratta come un modulo senza dichiarazioni. Lo stesso motivo per cui
 * esiste `scripts/versione.d.mts`.
 */

/** Le misure di un file: come è sul disco e come viaggia compresso. */
export interface Voce {
  /** Il percorso dentro `dist`, con `/` come separatore. */
  nome: string;
  /** Byte sul disco. */
  grezzo: number;
  /** Byte compressi con gzip, il formato che il server offre comunemente. */
  gzip: number;
  /** Byte compressi con brotli. */
  brotli: number;
}

/** I file di `dist`, divisi per quando il browser li chiede. */
export interface Analisi {
  /** Quanto serve a far comparire l'app, account o no. */
  pagina: Voce[];
  /** Le icone, che il browser chiede solo se l'utente installa l'app. */
  installazione: Voce[];
  /** Il database nel browser e le pagine aperte col caricamento differito. */
  dopo: Voce[];
  gzipPagina: number;
  gzipInstallazione: number;
  gzipDopo: number;
}

/** Tetto in byte gzip del primo caricamento. */
export declare const BUDGET_PAGINA_GZIP: number;
/** Tetto in byte gzip delle icone per l'installazione. */
export declare const BUDGET_INSTALLAZIONE_GZIP: number;
/** Tetto in byte gzip di ciò che arriva dopo l'accesso. */
export declare const BUDGET_DOPO_GZIP: number;

/** Misura un file: grezzo, gzip e brotli. */
export declare function misura(file: string): Omit<Voce, "nome">;

/**
 * I file che `index.html` chiede per far comparire la pagina.
 *
 * I riferimenti a domini esterni non si contano: non li scarica il pacchetto.
 */
export declare function riferimentiPagina(html: string): Set<string>;

/** Le icone dichiarate da un manifest. Un manifest illeggibile non dà errori. */
export declare function iconeDelManifest(manifest: string): Set<string>;

/**
 * Misura una cartella già costruita.
 *
 * Dà errore se dentro non c'è `index.html`: i numeri di una build non fatta
 * non sono numeri, e continuare a mostrarne di inventati è peggio che fermarsi.
 */
export declare function analizzaDist(cartella: string): Analisi;

/** I problemi del budget, una frase per ciascuno; vuota quando è tutto a posto. */
export declare function verifica(
  analisi: Analisi,
  budgetPagina?: number,
  budgetInstallazione?: number,
  budgetDopo?: number,
): string[];
