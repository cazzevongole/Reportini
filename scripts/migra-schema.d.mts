/**
 * Tipi di `migra-schema.mjs`, per chi lo importa da TypeScript.
 *
 * Lo script è JavaScript perché gira dentro GitHub Actions, senza passare da
 * una compilazione. Ma i test lo importano per provare i controlli sul testo
 * — l'ordine dei file, il blocco dei segreti, quello delle promozioni — senza
 * dover scrivere su un database vero, e senza questo file TypeScript lo
 * tratta come un modulo senza dichiarazioni. Lo stesso motivo per cui esiste
 * `scripts/verifica-release.d.mts`.
 */

/** Una riga segnalata, con il numero che serve a trovarla nel file. */
export interface RigaSegnalata {
  /** Il numero della riga nel file, cominciando da 1. */
  riga: number;
  /** La riga, ripulita dagli spazi. */
  testo: string;
}

/** Un file di schema e il suo contenuto. */
export interface FileSchema {
  /** Il nome dentro `supabase/`, come va eseguito nell'ordine. */
  nome: string;
  /** Il contenuto del file. */
  sql: string;
}

/**
 * I tre file da applicare, nell'ordine in cui dipendono l'uno dall'altro.
 *
 * L'ordine è una parte del contratto, non una convenzione: `setup.sql` crea
 * il bucket, `richieste.sql` le tabelle, `notifica-richieste.sql` il trigger
 * che poggia su quelle tabelle. Un ordine diverso fa fallire il terzo per un
 * motivo che non c'entra, e l'errore dice che manca una tabella invece che
 * "hai eseguito i file in ordine sbagliato".
 */
export declare const FILE_SCHEMA: string[];

/** Una riga attiva che scrive in un Vault: non può passare. */
export declare function segretiNelSql(sql: string): RigaSegnalata[];

/**
 * Una riga attiva che scrive nella tabella degli sviluppatori.
 *
 * È la guardia più importante: `public.sviluppatori` decide chi legge le
 * richieste di tutti gli utenti, e se la applicasse una macchina chi apre una
 * pull request deciderebbe chi vede i dati degli altri.
 */
export declare function promozioniNelSql(sql: string): RigaSegnalata[];

/**
 * I motivi per cui il file non può essere applicato così com'è, uno per frase.
 *
 * Vuota quando va bene. Un array e non una stringa perché i controlli possono
 * fallire insieme, e dirlo in un colpo solo vale più che far girare lo script
 * due volte.
 */
export declare function problemiNelSql(nome: string, sql: string): string[];

/** I file da applicare, con il loro contenuto letto dal repository. */
export declare function leggiSchema(): FileSchema[];

/** Applica lo SQL a un progetto, via API di gestione. */
export declare function applica(
  token: string,
  ref: string,
  sql: string,
  opzioni?: { readOnly?: boolean },
): Promise<unknown>;

/** Un errore di Supabase spiegato in italiano, con che cosa fare. */
export declare function spiega(causa: unknown): string;
