import { useEffect, useState } from "react";
import {
  connect,
  disconnect,
  googleConfigured,
  isConnected,
  readProfile,
  type GoogleProfile,
} from "../lib/google/auth";
import { Button } from "./ui";

/** Banner che invita a collegare Google Calendar, o mostra l'account collegato. */
export default function GoogleStatus({ compatto = false }: { compatto?: boolean }) {
  // Lo stato di collegamento lo decide il token, non il profilo: il profilo
  // arriva con una richiesta a parte e può arrivare dopo il primo render.
  const [collegato, setCollegato] = useState(() => isConnected());
  const [profilo, setProfilo] = useState<GoogleProfile | null>(() => readProfile());
  const [occupato, setOccupato] = useState(false);
  const [errore, setErrore] = useState("");

  useEffect(() => {
    setCollegato(isConnected());
    setProfilo(readProfile());
  }, []);

  async function collega() {
    setOccupato(true);
    setErrore("");
    try {
      await connect();
      // connect() avvia un accesso che lascia la pagina: si arriva qui solo
      // se è fallito.
      setCollegato(false);
    } catch (cause) {
      setErrore(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setOccupato(false);
    }
  }

  if (compatto) {
    return (
      <div className="rounded-2xl border border-ink-100 bg-white/70 p-4 text-xs text-ink-500">
        <p className="font-semibold text-ink-700">Google Calendar</p>
        <p className="mt-1">
          {collegato
            ? `Collegato${profilo?.email ? ` come ${profilo.email}` : ""}`
            : "Non collegato"}
        </p>
        {!collegato && googleConfigured ? (
          <Button
            size="sm"
            variant="secondary"
            className="mt-3 w-full"
            onClick={collega}
            disabled={occupato}
          >
            {occupato ? "Collegamento…" : "Collega"}
          </Button>
        ) : null}
      </div>
    );
  }

  if (collegato) {
    return (
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-brand-200 bg-brand-50 px-4 py-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-brand-900">
            Google Calendar collegato{profilo?.email ? ` · ${profilo.email}` : ""}
          </p>
          <p className="text-xs text-brand-700">
            Gli appuntamenti vengono pubblicati automaticamente quando li invii.
          </p>
        </div>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => {
            disconnect();
            setCollegato(false);
            setProfilo(null);
          }}
        >
          Scollega
        </Button>
      </div>
    );
  }

  return (
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-ink-200 bg-white/80 px-4 py-3">
      <div className="min-w-0">
        <p className="text-sm font-medium text-ink-800">
          {googleConfigured
            ? "Collega Google Calendar per fissare gli appuntamenti"
            : "Google Calendar non configurato"}
        </p>
        <p className="text-xs text-ink-400">
          {googleConfigured
            ? "Senza credenziali puoi comunque esportare ogni appuntamento in formato .ics."
            : "Collega Supabase dalle variabili d'ambiente per attivare la sincronizzazione."}
        </p>
        {errore ? <p className="mt-1 text-xs text-clay-600">{errore}</p> : null}
      </div>
      {googleConfigured ? (
        <Button size="sm" onClick={collega} disabled={occupato}>
          {occupato ? "Collegamento…" : "Collega account"}
        </Button>
      ) : null}
    </div>
  );
}
