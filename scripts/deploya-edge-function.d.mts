/**
 * Tipi di `deploya-edge-function.mjs`, per chi lo importa da TypeScript.
 *
 * Come `migra-schema.d.mts` e `verifica-edge-function.d.mts`: lo script è
 * JavaScript perché gira nel workflow senza compilazione, ma i test lo
 * importano per provarlo senza toccare la rete.
 */

/** Una funzione da pubblicare, con come va pubblicata. */
export interface Funzione {
  /** Il nome della funzione, come la chiama Supabase. */
  nome: string;
  /** Il file da cui parte la funzione. */
  entrypoint: string;
  /**
   * Se va verificato il JWT.
   *
   * `false` per entrambe: le chiama il database con `pg_net`, che non ha un
   * token di sessione. Il default della CLI è `true`, e un deploy che
   * dimenticasse questo le renderebbe irraggiungibili.
   */
  verify_jwt: boolean;
}

/** Un file di sorgente, con il percorso relativo alla cartella della funzione. */
export interface FileSorgente {
  percorso: string;
  contenuto: Buffer;
}

/** Le funzioni da pubblicare, tutte. */
export declare const FUNZIONI: Funzione[];

/** I file di una funzione, come li ha il repository. */
export declare function leggiFile(nome: string): FileSorgente[];

/** L'hash di una funzione, calcolato sui file che la compongono. */
export declare function hashFunzione(file: FileSorgente[]): string;

/** Il token e il progetto, dai nomi che usa la CLI di Supabase. */
export declare function impostazioni(): {
  token?: string;
  ref?: string;
  mancanti: string[];
};

/** Gli hash registrati dall'ultimo deploy. */
export declare function hashPubblicati(token: string, ref: string): Promise<Record<string, string>>;

/** Registra l'hash di ciò che è stato pubblicato. */
export declare function registraHash(
  token: string,
  ref: string,
  nome: string,
  hash: string,
): Promise<unknown>;

/** Pubblica una funzione. */
export declare function pubblica(
  token: string,
  ref: string,
  funzione: Funzione,
  file: FileSorgente[],
): Promise<unknown>;
