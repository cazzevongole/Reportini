import { useCallback, useEffect, useSyncExternalStore } from "react";

/**
 * Aggiornamento automatico dell'app installata.
 *
 * Il processo principale (electron-updater) fa il lavoro grosso: cerca la
 * release, scarica il pacchetto e lo installa. Qui si tiene solo quello che
 * l'utente vede e può scegliere, e la decisione è tenuta in un piccolo store
 * condiviso perché la barra in alto e la scheda in Impostazioni parlino
 * sempre dello stesso stato senza duplicare la rete.
 *
 * Le funzioni pure (quello che si mostra, quando) sono qui e sono testate
 * senza Electron.
 */

export type FaseAggiornamento =
  | "idle"
  | "controllo"
  | "scarico"
  | "pronto"
  | "aggiornato"
  | "errore";

export interface StatoAggiornamento {
  fase: FaseAggiornamento;
  /** Versione in arrivo, per esempio "0.1.6". */
  versione?: string;
  /** Avanzamento dello scarico da 0 a 100. */
  percentuale?: number;
  /** Dettaglio dell'errore, quando c'è. */
  messaggio?: string;
}

/** Quello che il preload espone sulla finestra. */
export interface PonteAggiornamento {
  /** Stato corrente, oppure null se qui gli aggiornamenti non esistono. */
  stato(): Promise<StatoAggiornamento | null>;
  /** Versione dell'app in esecuzione. */
  versione(): Promise<string>;
  controlla(): Promise<StatoAggiornamento | null>;
  installa(): Promise<boolean>;
  /** L'aggiornamento entra alla chiusura dell'app, o da solo al prossimo avvio. */
  rimandaAllaChiusura(): Promise<boolean>;
  onCambio(ascoltatore: (stato: StatoAggiornamento) => void): () => void;
}

const NIENTE: StatoAggiornamento = { fase: "idle" };

/**
 * Quanto si aspetta prima del primo controllo e ogni quanto si controlla.
 * L'avvio ritardato tiene libero ilTelefono e il portatile: la rete serve
 * dopo che l'app è usata, non mentre si apre.
 *
 * L'intervallo è volutamente stretto: sei ore erano troppe per un'app che si
 * usa tutto il giorno, e chi apriva Reportini al mattino restava sulla
 * versione di ieri fino alla sera. Mezz'ora è una richiesta leggera — un file
 * di testo piccolo; il pacchetto grosso si scarica solo se c'è qualcosa di
 * nuovo, e resta in attesa della scelta dell'utente.
 */
export const RITARDO_PRIMO_CONTROLLO_MS = 8000;
export const INTERVALLO_CONTROLLO_MS = 30 * 60 * 1000;

/** Quanto resta la risposta a un controllo chiesto a mano. */
const DURATA_RISPOSTA_MANUALE_MS = 20_000;

interface Istante {
  stato: StatoAggiornamento;
  /** Il controllo corrente l'ha chiesto l'utente: in quel caso si parla. */
  manuale: boolean;
  /** L'utente ha rimandato proprio questa versione. */
  rimandato: boolean;
  versioneRimandata: string | null;
  installando: boolean;
  /** Versione dell'app in esecuzione, letta una volta sola. */
  versione: string;
}

let istante: Istante = {
  stato: NIENTE,
  manuale: false,
  rimandato: false,
  versioneRimandata: null,
  installando: false,
  versione: "",
};

const ascoltatori = new Set<() => void>();

function scrivi(parziale: Partial<Istante>) {
  istante = { ...istante, ...parziale };
  for (const ascoltatore of ascoltatori) ascoltatore();
}

function leggi(): Istante {
  return istante;
}

function sottoscrivi(ascoltatore: () => void) {
  ascoltatori.add(ascoltatore);
  return () => {
    ascoltatori.delete(ascoltatore);
  };
}

/** Stato nuovo dal processo principale. */
function arrivo(nuovo: StatoAggiornamento) {
  if (nuovo.fase === "pronto") {
    // "Più tardi" vale per quella versione, non per tutte: se ne arriva una
    // nuova la domanda si ripete.
    const rimandato =
      nuovo.versione != null && nuovo.versione === istante.versioneRimandata;
    scrivi({
      stato: nuovo,
      rimandato,
      versioneRimandata: rimandato ? nuovo.versione ?? null : null,
    });
    return;
  }
  scrivi({ stato: nuovo });
}

function ponte(): PonteAggiornamento | undefined {
  return window.reportini?.aggiornamento;
}

/**
 * Controlla se c'è una versione nuova.
 *
 * `manuale` distingue le due chiamate: un controllo automatico che fallisce
 * o non trova nulla resta in silenzio, mentre quello chiesto dalla scheda in
 * Impostazioni ha sempre una risposta da mostrare.
 */
export async function controllaAggiornamenti(manuale: boolean): Promise<void> {
  const collegamento = ponte();
  if (!collegamento) return;
  if (manuale) scrivi({ manuale: true, rimandato: false, versioneRimandata: null });
  try {
    const risultato = await collegamento.controlla();
    if (risultato) arrivo(risultato);
  } catch {
    // L'auto-aggiornamento non è un servizio che l'utente ha pagato: se
    // fallisce, si nota e basta. L'errore vero è già in console lato main.
  }
  if (!manuale) return;
  setTimeout(() => {
    if (istante.manuale) scrivi({ manuale: false });
  }, DURATA_RISPOSTA_MANUALE_MS);
}

export async function installaAggiornamento(): Promise<void> {
  const collegamento = ponte();
  if (!collegamento) return;
  scrivi({ installando: true });
  try {
    await collegamento.installa();
  } catch {
    scrivi({ installando: false });
  }
}

/**
 * «Non adesso»: l'aggiornamento entra comunque, alla chiusura dell'app.
 *
 * Non è un "non me ne importa", quindi non è un semplice nascondere: si dice
 * al processo principale di installare all'uscita, e lui lo ricorda anche
 * su disco, così un avvio successivo lo installa da solo. Dopo questa scelta
 * la domanda tace per quella versione: l'utente ha già risposto.
 */
export async function rimandaAggiornamento(): Promise<void> {
  const collegamento = ponte();
  if (!collegamento) return;
  try {
    await collegamento.rimandaAllaChiusura();
  } catch {
    // Se il ponte non risponde resta comunque valido il silenzio: il
    // pacchetto è scaricato e l'utente può riprovare da Impostazioni.
  }
  scrivi({
    rimandato: true,
    versioneRimandata: istante.stato.versione ?? null,
  });
}

/**
 * Programma i controlli automatici. Va chiamato una volta sola, da un
 * componente montato per tutta la vita dell'app: restituisce la pulizia.
 */
export function avviaControlliAutomatici(): () => void {
  const primo = setTimeout(() => {
    void controllaAggiornamenti(false);
  }, RITARDO_PRIMO_CONTROLLO_MS);
  const periodo = setInterval(() => {
    void controllaAggiornamenti(false);
  }, INTERVALLO_CONTROLLO_MS);
  return () => {
    clearTimeout(primo);
    clearInterval(periodo);
  };
}

/**
 * Cosa dire all'utente, o null se non c'è niente da dire.
 *
 * È la scelta, non il semplice testo: senza questo un controllo automatico
 * fallito al primo avvio mostrerebbe un errore per un aggiornamento che
 * nessuno aveva chiesto.
 */
export function descrizioneAggiornamento(
  stato: StatoAggiornamento,
  manuale: boolean,
  rimandato = false,
): string | null {
  if (rimandato) return null;
  switch (stato.fase) {
    case "controllo":
      return manuale ? "Sto controllando se c'è una versione nuova…" : null;
    case "scarico": {
      const cosa = stato.versione
        ? `Reportini ${stato.versione}`
        : "l'aggiornamento";
      const percentuale =
        stato.percentuale != null && stato.percentuale > 0
          ? ` ${stato.percentuale}%`
          : "";
      return `Sto scaricando ${cosa}…${percentuale}`;
    }
    case "pronto":
      return `Reportini ${stato.versione ?? "nuova"} è pronto: puoi installarlo adesso o lasciare che entri alla chiusura dell'app.`;
    case "aggiornato":
      return manuale ? "Sei già all'ultima versione." : null;
    case "errore":
      return manuale
        ? `Aggiornamento non riuscito: ${stato.messaggio ?? "prova fra poco"}`
        : null;
    default:
      return null;
  }
}

/** Riparte da uno stato noto: usato dai test. */
export function resettaAggiornamenti(): void {
  istante = {
    stato: NIENTE,
    manuale: false,
    rimandato: false,
    versioneRimandata: null,
    installando: false,
    versione: "",
  };
  for (const ascoltatore of ascoltatori) ascoltatore();
}

export interface AggiornamentoApi {
  stato: StatoAggiornamento;
  /** Testo da mostrare, o null quando non c'è niente da dire. */
  descrizione: string | null;
  /** C'è un pacchetto scaricato e pronto. */
  pronto: boolean;
  /** Su desktop: qui l'aggiornamento automatico esiste. */
  disponibile: boolean;
  /** Versione dell'app in esecuzione, vuota nel browser. */
  versione: string;
  occupato: boolean;
  /** Il pacchetto è scaricato e l'utente non ha ancora scelto. */
  daDecidere: boolean;
  controlla(): Promise<void>;
  installa(): Promise<void>;
  rimanda(): Promise<void>;
}

export function useAggiornamento(): AggiornamentoApi {
  const corrente = useSyncExternalStore(sottoscrivi, leggi, leggi);

  useEffect(() => {
    const collegamento = ponte();
    if (!collegamento) return;
    let vivo = true;
    const smetti = collegamento.onCambio((nuovo) => {
      if (vivo) arrivo(nuovo);
    });
    // Lo stato già noto: la finestra potrebbe essere nata dopo l'ultimo
    // evento, e senza questo l'aggiornamento pronto resterebbe invisibile.
    collegamento
      .stato()
      .then((iniziale) => {
        if (vivo && iniziale) arrivo(iniziale);
      })
      .catch(() => {});
    if (istante.versione === "") {
      collegamento
        .versione()
        .then((numero) => {
          if (vivo && numero) scrivi({ versione: numero });
        })
        .catch(() => {});
    }
    return () => {
      vivo = false;
      smetti();
    };
  }, []);

  const controlla = useCallback(() => controllaAggiornamenti(true), []);
  const installa = useCallback(() => installaAggiornamento(), []);
  const rimanda = useCallback(() => rimandaAggiornamento(), []);

  return {
    stato: corrente.stato,
    descrizione: descrizioneAggiornamento(
      corrente.stato,
      corrente.manuale,
      corrente.rimandato,
    ),
    pronto: corrente.stato.fase === "pronto" && !corrente.rimandato,
    daDecidere: corrente.stato.fase === "pronto" && !corrente.rimandato && !corrente.installando,
    disponibile: Boolean(ponte()),
    versione: corrente.versione,
    occupato: corrente.installando,
    controlla,
    installa,
    rimanda,
  };
}
