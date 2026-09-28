import { useEffect, useState, type ReactNode } from "react";
import { fraseBenvenuto, saluto } from "../lib/benvenuto";

/** Quanto dura il dissolvenza che chiude la schermata. */
const USCITA_MS = 700;

/** Cinque secondi: la pausa che separa il saluto dal lavoro vero. */
const CINQUE_SECONDI = 5000;

/**
 * Dura la schermata, in millisecondi. La variabile d'ambiente serve ai
 * test (che altrimenti aspetterebbero tutti la stessa pausa); se manca o
 * non è un numero vale il default, così una variabile scritta male non
 * lascia l'app con una schermata di durata zero.
 */
export function durataAperturaDa(variabile: string | undefined): number {
  if (variabile === undefined || variabile.trim() === "") return CINQUE_SECONDI;
  const grezza = Number(variabile);
  return Number.isFinite(grezza) && grezza >= 0 ? grezza : CINQUE_SECONDI;
}

export const DURATA_APERTURA_MS = durataAperturaDa(import.meta.env.VITE_DURATA_APERTURA_MS);

/**
 * Schermata di benvenuto: copre l'apertura per qualche istante e poi si
 * dissolve rivelando l'app.
 *
 * La frase viene tirata a caso **una volta per caricamento** (e non una
 * volta per giornata come nella home): due aperture consecutive non
 * devono dire la stessa cosa. Nella home la frase era stabilissima, e
 * cinque secondi di greeting fermo ogni mattina diventano presto noia.
 */
export default function SchermataApertura({
  children,
  durataMs = DURATA_APERTURA_MS,
}: {
  children: ReactNode;
  /** Va in sovrapporre per un tempo più breve: serve ai test. */
  durataMs?: number;
}) {
  const [visibile, setVisibile] = useState(durataMs > 0);
  const [opaca, setOpaca] = useState(false);
  // useState con inizializzatore: la frase è scelta una volta sola e non
  // cambia al re-render, altrimenti cambierebbe mentre la si legge.
  const [frase] = useState(() => fraseBenvenuto(new Date(), true));
  const [salutoIniziale] = useState(() => saluto());

  useEffect(() => {
    if (!visibile) return;
    // Un frame di attesa: senza, il passaggio a opaca avverrebbe
    // insieme al primo render e il browser non avrebbe una partenza da
    // cui animare — la schermata comparirebbe di colpo.
    const primo = requestAnimationFrame(() => setOpaca(true));
    const chiudi = setTimeout(() => setOpaca(false), durataMs);
    const smonta = setTimeout(() => setVisibile(false), durataMs + USCITA_MS);
    return () => {
      cancelAnimationFrame(primo);
      clearTimeout(chiudi);
      clearTimeout(smonta);
    };
  }, [visibile, durataMs]);

  if (!visibile) return <>{children}</>;

  return (
    <div
      aria-hidden={opaca}
      className={`fixed inset-0 z-40 flex flex-col items-center justify-center bg-ink-950 px-6 text-center transition-opacity duration-700 ease-out ${
        opaca ? "opacity-100" : "opacity-0"
      }`}
    >
      <p className="font-display text-4xl leading-none text-white">Reportini</p>

      <div className="mt-8 h-px w-16 bg-brand-500/60" />

      <p className="mt-8 max-w-sm text-lg leading-relaxed text-ink-100">
        <span className="font-medium text-white">{salutoIniziale},</span> {frase}
      </p>

      <div className="mt-10 h-9 w-9 animate-spin rounded-full border-2 border-white/20 border-t-white" />
    </div>
  );
}
