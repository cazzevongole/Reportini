import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { CheckIcon, CloseIcon, InfoIcon } from "./icons";

/**
 * Avvisi brevi per le azioni che parlano con la rete.
 *
 * Il motivo è uno solo: senza un riscontro, un'azione che fallisce e una che
 * riesce si somigliano. Il pulsante torna comodo, lo schermo non cambia, e
 * l'utente non sa se la copia online è salita o se l'attività è finito
 * su Google Calendar. Qui ogni chiamata ha sempre una riga di esito, e un
 * errore non passa mai in silenzio.
 */

export type TipoAvviso = "ok" | "errore" | "info";

export interface Avviso {
  id: number;
  tipo: TipoAvviso;
  testo: string;
}

/** Quanto resta un avviso. Gli errori restano più a lungo: vanno letti. */
const DURATA: Record<TipoAvviso, number> = { ok: 4000, info: 4000, errore: 9000 };

export interface Messaggi<T> {
  /** Messaggio di successo: testo fisso o derivato dal risultato. */
  successo?: string | ((esito: T) => string);
  /** Se assente si usa il messaggio dell'errore, o un testo generico. */
  errore?: string;
}

export interface AvvisiApi {
  avvisi: Avviso[];
  notifica: (tipo: TipoAvviso, testo: string) => void;
  chiudi: (id: number) => void;
  /**
   * Esegue un'azione che chiama la rete e mostra sempre l'esito: la riga di
   * successo arriva dalla risposta, l'errore viene tradotto e mostrato.
   * Restituisce null se l'azione è fallita, così il chiamante non prosegue
   * con dati che non ci sono.
   */
  esegui: <T>(azione: () => Promise<T>, messaggi?: Messaggi<T>) => Promise<T | null>;
}

const Contesto = createContext<AvvisiApi | null>(null);

export function AvvisoProvider({ children }: { children: ReactNode }) {
  const [avvisi, setAvvisi] = useState<Avviso[]>([]);
  const prossimoId = useRef(1);
  const timer = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const chiudi = useCallback((id: number) => {
    setAvvisi((correnti) => correnti.filter((a) => a.id !== id));
    const inCoda = timer.current.get(id);
    if (inCoda) {
      clearTimeout(inCoda);
      timer.current.delete(id);
    }
  }, []);

  const notifica = useCallback(
    (tipo: TipoAvviso, testo: string) => {
      const id = prossimoId.current;
      prossimoId.current += 1;
      // Tre avvisi insieme: oltre diventa una parete di testo e non si legge
      // nessuno. Il più recente ha la precedenza.
      setAvvisi((correnti) => [...correnti.slice(-2), { id, tipo, testo }]);
      timer.current.set(
        id,
        setTimeout(() => chiudi(id), DURATA[tipo]),
      );
    },
    [chiudi],
  );

  // Svuota i timer allo smontaggio: evita di chiamare setState su un
  // componente sparito quando l'app viene chiusa.
  useEffect(() => {
    const inCoda = timer.current;
    return () => {
      for (const t of inCoda.values()) clearTimeout(t);
      inCoda.clear();
    };
  }, []);

  const esegui = useCallback(
    async <T,>(azione: () => Promise<T>, messaggi?: Messaggi<T>): Promise<T | null> => {
      try {
        const esito = await azione();
        const testo =
          typeof messaggi?.successo === "function"
            ? messaggi.successo(esito)
            : (messaggi?.successo ?? "");
        if (testo) notifica("ok", testo);
        return esito;
      } catch (causa) {
        // Il testo del chiamante dice cosa si stava facendo, il messaggio
        // dell'eccezione dice perché è fallito: servono entrambi, e il primo
        // da solo nasconderebbe la causa.
        const dettaglio = causa instanceof Error ? causa.message : "";
        const contesto = messaggi?.errore ?? "";
        const testo = contesto
          ? dettaglio && !contesto.toLowerCase().includes(dettaglio.toLowerCase())
            ? `${contesto}: ${dettaglio}`
            : contesto
          : dettaglio || "Operazione non riuscita";
        notifica("errore", testo);
        return null;
      }
    },
    [notifica],
  );

  const valore = useMemo<AvvisiApi>(
    () => ({ avvisi, notifica, chiudi, esegui }),
    [avvisi, notifica, chiudi, esegui],
  );

  return (
    <Contesto.Provider value={valore}>
      {children}
      <Avvisi avvisi={avvisi} chiudi={chiudi} />
    </Contesto.Provider>
  );
}

export function useAvvisi(): AvvisiApi {
  const contesto = useContext(Contesto);
  if (!contesto) throw new Error("useAvvisi va usato dentro <AvvisoProvider>");
  return contesto;
}

const STILI: Record<TipoAvviso, string> = {
  ok: "border-brand-200 bg-brand-50 text-brand-900",
  errore: "border-clay-300 bg-clay-50 text-clay-900",
  info: "border-ink-200 bg-white text-ink-800",
};

const ICONI = { ok: CheckIcon, errore: CloseIcon, info: InfoIcon };

function Avvisi({ avvisi, chiudi }: { avvisi: Avviso[]; chiudi: (id: number) => void }) {
  return (
    // Sopra la barra in basso sul telefono, in basso sul desktop: la barra ha
    // il posto fisso in fondo allo schermo.
    <div
      className="pointer-events-none fixed inset-x-0 bottom-20 z-50 flex flex-col items-center gap-2 px-4 sm:bottom-6"
      aria-live="polite"
      aria-atomic="false"
    >
      {avvisi.map(({ id, tipo, testo }) => {
        const Icona = ICONI[tipo];
        return (
          <div
            key={id}
            role={tipo === "errore" ? "alert" : "status"}
            className={`pointer-events-auto flex w-full max-w-sm items-start gap-2.5 rounded-xl border px-3.5 py-3 text-sm shadow-soft ${STILI[tipo]}`}
          >
            <Icona className="mt-0.5 h-4 w-4 shrink-0" />
            <p className="min-w-0 flex-1">{testo}</p>
            <button
              type="button"
              onClick={() => chiudi(id)}
              className="-mr-1 -mt-1 rounded-lg p-1 opacity-60 transition-opacity hover:opacity-100"
              aria-label="Chiudi avviso"
            >
              <CloseIcon className="h-3.5 w-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
