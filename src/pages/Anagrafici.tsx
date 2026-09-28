import { useState } from "react";
import { Link } from "react-router-dom";
import AnagraficoForm from "../components/AnagraficoForm";
import { ChevronRightIcon, EditIcon, PlusIcon, SearchIcon, UsersIcon } from "../components/icons";
import { Badge, Button, EmptyState, Input, PageHeader, Sheet } from "../components/ui";
import { useLiveQuery } from "../hooks/useLiveQuery";
import { eta } from "../lib/date";
import { elencaAnagrafici, iniziali, nomeCompleto } from "../lib/repo";
import type { Anagrafico } from "../lib/types";

export default function Anagrafici() {
  const [ricerca, setRicerca] = useState("");
  const [aperto, setAperto] = useState(false);
  const [inModifica, setInModifica] = useState<Anagrafico | null>(null);

  const anagrafici = useLiveQuery(() => elencaAnagrafici(ricerca), [ricerca]);
  const totale = useLiveQuery(() => elencaAnagrafici().length);

  function apriNuovo() {
    setInModifica(null);
    setAperto(true);
  }

  function apriModifica(anagrafico: Anagrafico) {
    setInModifica(anagrafico);
    setAperto(true);
  }

  return (
    <div>
      <PageHeader
        title="Anagrafici"
        subtitle={`${totale} ${totale === 1 ? "scheda" : "schede"} registrate`}
        action={
          <Button onClick={apriNuovo} className="hidden sm:inline-flex">
            <PlusIcon className="h-4 w-4" />
            Nuovo
          </Button>
        }
      />

      <div className="relative mb-4">
        <SearchIcon className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-300" />
        <Input
          value={ricerca}
          onChange={(event) => setRicerca(event.target.value)}
          placeholder="Cerca per nome, documento o comune"
          className="pl-10"
          type="search"
        />
      </div>

      {anagrafici.length === 0 ? (
        <EmptyState
          icon={<UsersIcon className="h-9 w-9" />}
          title={ricerca ? "Nessun risultato" : "Ancora nessun anagrafico"}
          description={
            ricerca
              ? "Prova con un altro nome, documento o comune."
              : "Crea la prima scheda per iniziare a collegare relazioni e appuntamenti."
          }
          action={
            ricerca ? null : (
              <Button onClick={apriNuovo}>
                <PlusIcon className="h-4 w-4" />
                Crea anagrafico
              </Button>
            )
          }
        />
      ) : (
        <ul className="space-y-2.5">
          {anagrafici.map((anagrafico) => (
            <li key={anagrafico.id}>
              <Link
                to={`/panel/anagrafici/${anagrafico.id}`}
                className="card flex items-center gap-3.5 p-3.5 transition-shadow hover:shadow-lift"
              >
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-ink-950 font-display text-sm text-white">
                  {iniziali(anagrafico)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-ink-900">
                    {nomeCompleto(anagrafico) || "Senza nome"}
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-ink-400">
                    {[anagrafico.documento, anagrafico.citta, eta(anagrafico.dataNascita)]
                      .filter(Boolean)
                      .join(" · ") || "Senza contatti"}
                  </span>
                  <span className="mt-2 flex flex-wrap gap-1.5">
                    <Badge tone="neutral">{anagrafico.numRelazioni} relazioni</Badge>
                    <Badge tone={anagrafico.numAppuntamenti > 0 ? "brand" : "muted"}>
                      {anagrafico.numAppuntamenti} appuntamenti
                    </Badge>
                  </span>
                </span>
                <button
                  type="button"
                  aria-label={`Modifica ${nomeCompleto(anagrafico)}`}
                  onClick={(event) => {
                    event.preventDefault();
                    apriModifica(anagrafico);
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
        aria-label="Nuovo anagrafico"
        className="fixed bottom-24 right-5 z-30 grid h-14 w-14 place-items-center rounded-2xl bg-ink-950 text-white shadow-lift transition-transform active:scale-95 sm:hidden"
      >
        <PlusIcon className="h-6 w-6" />
      </button>

      <Sheet
        open={aperto}
        onClose={() => setAperto(false)}
        title={inModifica ? "Modifica anagrafico" : "Nuovo anagrafico"}
        description={
          inModifica
            ? nomeCompleto(inModifica)
            : "I campi sono facoltativi, ma il documento rende le ricerche più veloci."
        }
      >
        <AnagraficoForm
          anagrafico={inModifica}
          onCancel={() => setAperto(false)}
          onSaved={() => setAperto(false)}
        />
      </Sheet>
    </div>
  );
}
