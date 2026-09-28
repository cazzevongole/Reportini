/**
 * Tipi del server locale, per chi lo importa da TypeScript.
 *
 * `server-locale.cjs` è CommonJS e gira nel main process di Electron, dove
 * non serve un tipo. Ma i test lo importano, e senza questo file TypeScript
 * lo tratta come un modulo senza dichiarazioni.
 */
import type { Server } from "node:http";

export interface OpzioniServer {
  /** Porta prestabilita: quella che va registrata come indirizzo di rientro. */
  porta: number;
  /** Quante porte più in là provare se la prima è occupata. */
  tentativi?: number;
  /** Cartella servita: il renderer compilato. */
  radice: string;
  /** Chiamata quando arriva il ritorno di Google, con la query già ripulita. */
  alRitorno: (query: string) => void;
  /** Una riga da scrivere nel log, per quello che non si può mostrare a schermo. */
  alLog?: (riga: string) => void;
}

/** Solleva il server e risolve quando è in ascolto. */
export declare function avviaServer(opzioni: OpzioniServer): Promise<Server>;

/** Il server come è, per chi lo composition a mano (i test). */
export declare function creaServer(opzioni: Omit<OpzioniServer, "porta" | "tentativi">): Server;

/** La richiesta è il ritorno di Google? */
export declare function eRitorno(url: URL): boolean;

/** Il file da servire, o `null` se la richiesta vuole uscire dalla cartella. */
export declare function percorsoDi(radice: string, url: URL): string | null;

/** Torna la query con i soli parametri che Google usa davvero. */
export declare function queryRitorno(parametri: URLSearchParams): string;

export declare const TIPI: Record<string, string>;
export declare const PAGINA_ATTESA: string;
export declare const CHIAVI_RITORNO: string[];
