import { useCallback, useEffect, useState } from "react";
import {
  elencoCorrente,
  iscrivitiElenco,
  leggiVersione,
  registraVersione,
  ricaricaElenco,
  scartaVersioniSuccessive,
  svuotaArchivio,
  type Versione,
} from "../lib/backup/archivio";
import { leggiAnteprima, type Anteprima } from "../lib/backup/anteprima";
import { flush, replaceDatabase, snapshot, subscribe } from "../lib/sqlite/engine";

/**
 * Versionamento del database: a ogni modifica viene tenuta una copia
 * dell'ora corrente, e si tiene quanto basta (tre giorni, vedi archivio).
 *
 * Sta in un hook e non dentro il motore SQLite per una ragione: il motore
 * non deve sapere nulla degli archivi, e l'archivio deve poter essere
 * svuotato senza toccare i dati di lavoro.
 *
 * La copia viene presa dopo un breve silenzio: mentre l'utente scrive non
 * si registrano trenta versioni al minuto.
 */

const ATTESA_MS = 2_000;

/* ---------------------------- registrazione ------------------------------ */

let smettiRegistrazione: (() => void) | null = null;

/**
 * Accende la registrazione delle versioni. È una sola per applicazione:
 * le impostazioni mostrano l'elenco, ma non devono accendere un secondo
 * ascolto del database.
 */
export function useRegistrazioneVersioni(): void {
  useEffect(() => {
    if (smettiRegistrazione) return;
    let timer: number | undefined;
    const programma = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        void registraVersione(snapshot());
      }, ATTESA_MS);
    };
    // La prima copia: all'avvio si registra com'è, così l'utente trova
    // subito un punto a cui tornare anche senza aver ancora cambiato nulla.
    programma();
    const smetti = subscribe(programma);
    smettiRegistrazione = () => {
      window.clearTimeout(timer);
      smetti();
      smettiRegistrazione = null;
    };
    void ricaricaElenco();
    return () => smettiRegistrazione?.();
  }, []);
}

/* ------------------------------ elenco e azioni -------------------------- */

export interface StatoVersioni {
  versioni: Versione[];
  occupato: boolean;
  /** Registra subito, senza aspettare: pulsante "Registra adesso". */
  registraAdesso: () => Promise<Versione | null>;
  apriAnteprima: (id: number) => Promise<Anteprima | null>;
  /**
   * Riparte dalla versione scelta: il database di lavoro diventa quello,
   * e tutto ciò che è stato scritto dopo viene scartato. Non è
   * reversibile, quindi chi chiama deve aver chiesto conferma.
   */
  ripristina: (id: number) => Promise<{ scartate: number }>;
  svuota: () => Promise<void>;
}

export function useVersioniBackup(): StatoVersioni {
  const [versioni, setVersioni] = useState<Versione[]>(elencoCorrente());
  const [occupato, setOccupato] = useState(false);

  useEffect(() => {
    setVersioni(elencoCorrente());
    return iscrivitiElenco(setVersioni);
  }, []);

  const registraAdesso = useCallback(async (): Promise<Versione | null> => {
    setOccupato(true);
    try {
      await flush();
      return await registraVersione(snapshot());
    } finally {
      setOccupato(false);
    }
  }, []);

  const apriAnteprima = useCallback(async (id: number) => {
    setOccupato(true);
    try {
      const byte = await leggiVersione(id);
      return byte ? await leggiAnteprima(byte) : null;
    } finally {
      setOccupato(false);
    }
  }, []);

  const ripristina = useCallback(async (id: number) => {
    setOccupato(true);
    try {
      const byte = await leggiVersione(id);
      // Meglio un errore esplicito che un null silenzioso: così l'avviso
      // spiega che la versione non c'è più.
      if (!byte) throw new Error("Questa versione non esiste più: potrebbe essere stata scartata.");
      await replaceDatabase(byte);
      // Ripartire da lì vale anche per la storia: le versioni scritte dopo
      // descrivono un lavoro abbandonato e non hanno più senso.
      const scartate = await scartaVersioniSuccessive(id);
      return { scartate };
    } finally {
      setOccupato(false);
    }
  }, []);

  const svuota = useCallback(async () => {
    setOccupato(true);
    try {
      await svuotaArchivio();
    } finally {
      setOccupato(false);
    }
  }, []);

  return { versioni, occupato, registraAdesso, apriAnteprima, ripristina, svuota };
}
