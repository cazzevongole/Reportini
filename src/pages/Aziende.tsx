import { useState } from "react";
import { Link } from "react-router-dom";
import AziendaForm from "../components/AziendaForm";
import {
  BuildingIcon,
  ChevronRightIcon,
  EditIcon,
  PlusIcon,
  SearchIcon,
} from "../components/icons";
import { Badge, Button, EmptyState, Input, PageHeader, Sheet } from "../components/ui";
import { useLiveQuery } from "../hooks/useLiveQuery";
import { elencaAziende, inizialiAzienda, nomeAzienda } from "../lib/repo";
import type { Azienda } from "../lib/types";

export default function Aziende() {
  const [ricerca, setRicerca] = useState("");
  const [aperto, setAperto] = useState(false);
  const [inModifica, setInModifica] = useState<Azienda | null>(null);

  const aziende = useLiveQuery(() => elencaAziende(ricerca), [ricerca]);
  const totale = useLiveQuery(() => elencaAziende().length);

  function apriNuovo() {
    setInModifica(null);
    setAperto(true);
  }

  function apriModifica(azienda: Azienda) {
    setInModifica(azienda);
    setAperto(true);
  }

  return (
    <div>
      <PageHeader
        title="Aziende"
        subtitle={`${totale} ${totale === 1 ? "azienda" : "aziende"} registrate`}
        action={
          <Button onClick={apriNuovo} className="hidden sm:inline-flex">
            <PlusIcon className="h-4 w-4" />
            Nuova
          </Button>
        }
      />

      <div className="relative mb-4">
        <SearchIcon className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-300" />
        <Input
          value={ricerca}
          onChange={(event) => setRicerca(event.target.value)}
          placeholder="Cerca per ragione sociale, p. IVA, comune o referente"
          className="pl-10"
          type="search"
        />
      </div>

      {aziende.length === 0 ? (
        <EmptyState
          icon={<BuildingIcon className="h-9 w-9" />}
          title={ricerca ? "Nessun risultato" : "Ancora nessuna azienda"}
          description={
            ricerca
              ? "Prova con un'altra ragione sociale, p. IVA o il nome di un referente."
              : "Crea la prima azienda per iniziare a collegare relazioni e appuntamenti."
          }
          action={
            ricerca ? null : (
              <Button onClick={apriNuovo}>
                <PlusIcon className="h-4 w-4" />
                Crea azienda
              </Button>
            )
          }
        />
      ) : (
        <ul className="space-y-2.5">
          {aziende.map((azienda) => (
            <li key={azienda.id}>
              <Link
                to={`/panel/aziende/${azienda.id}`}
                className="card flex items-center gap-3.5 p-3.5 transition-shadow hover:shadow-lift"
              >
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-ink-950 font-display text-sm text-white">
                  {inizialiAzienda(azienda)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-ink-900">
                    {nomeAzienda(azienda)}
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-ink-400">
                    {[azienda.partitaIva, azienda.citta, azienda.telefono, azienda.email]
                      .filter(Boolean)
                      .join(" · ") || "Senza recapiti"}
                  </span>
                  <span className="mt-2 flex flex-wrap gap-1.5">
                    <Badge tone="neutral">{azienda.numReferenti} referenti</Badge>
                    <Badge tone="neutral">{azienda.numRelazioni} relazioni</Badge>
                    <Badge tone={azienda.numAppuntamenti > 0 ? "brand" : "muted"}>
                      {azienda.numAppuntamenti} appuntamenti
                    </Badge>
                  </span>
                </span>
                <button
                  type="button"
                  aria-label={`Modifica ${nomeAzienda(azienda)}`}
                  onClick={(event) => {
                    event.preventDefault();
                    apriModifica(azienda);
                  }}
                  className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-ink-300 transition-colors hover:bg-ink-100 hover:text-ink-700"
                >
                  <EditIcon className="h-[18px] w-[18px]" />
                </button>
                <ChevronRightIcon className="h-5 w-5 shrink-0 text-ink-300" />
              </Link>
            </li>
          ))}
        </ul>
      )}

      {/* Pulsante a portata di pollice sui telefoni */}
      <button
        type="button"
        onClick={apriNuovo}
        aria-label="Nuova azienda"
        className="fixed bottom-24 right-5 z-30 grid h-14 w-14 place-items-center rounded-2xl bg-ink-950 text-white shadow-lift transition-transform active:scale-95 sm:hidden"
      >
        <PlusIcon className="h-6 w-6" />
      </button>

      <Sheet
        open={aperto}
        onClose={() => setAperto(false)}
        title={inModifica ? "Modifica azienda" : "Nuova azienda"}
        description={
          inModifica
            ? nomeAzienda(inModifica)
            : "La ragione sociale basta per iniziare: il resto si aggiunge dopo."
        }
      >
        <AziendaForm
          azienda={inModifica}
          onCancel={() => setAperto(false)}
          onSaved={() => setAperto(false)}
        />
      </Sheet>
    </div>
  );
}
