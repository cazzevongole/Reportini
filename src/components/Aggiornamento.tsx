import { useEffect } from "react";
import {
  avviaControlliAutomatici,
  useAggiornamento,
} from "../lib/aggiornamento";
import { CloudIcon, RotateIcon } from "./icons";
import { Button } from "./ui";

/**
 * Barra dell'aggiornamento automatico.
 *
 * Sta nel flusso della pagina e non a schermo fisso: coprire il contenuto con
 * una striscia per un aggiornamento sarebbe più fastidioso dell'aggiornamento
 * stesso. Quando l'app è già all'ultima versione, questa barra non esiste.
 */
export default function Aggiornamento() {
  const { descrizione, pronto, occupato, installa, rimanda } = useAggiornamento();

  // I controlli automatici partono da qui, una volta sola: il componente è
  // montato per tutta la vita dell'app, quindi il timer vive quanto lei.
  useEffect(() => avviaControlliAutomatici(), []);

  if (!descrizione) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-brand-200 bg-brand-50 px-4 py-3"
    >
      {pronto ? (
        <RotateIcon className="h-5 w-5 shrink-0 text-brand-700" />
      ) : (
        <CloudIcon className="h-5 w-5 shrink-0 text-brand-700" />
      )}
      <p className="min-w-0 flex-1 text-sm text-brand-900">{descrizione}</p>
      {pronto ? (
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={() => void installa()} disabled={occupato}>
            {occupato ? "Installo…" : "Aggiorna ora"}
          </Button>
          <Button size="sm" variant="ghost" onClick={rimanda} disabled={occupato}>
            Più tardi
          </Button>
        </div>
      ) : null}
    </div>
  );
}
