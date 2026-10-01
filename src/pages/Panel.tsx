import { useState } from "react";
import { Link } from "react-router-dom";
import AttivitaForm from "../components/AttivitaForm";
import AziendaForm from "../components/AziendaForm";
import {
  BuildingIcon,
  CalendarIcon,
  ChevronRightIcon,
  FileTextIcon,
  PhoneIcon,
  PlusIcon,
} from "../components/icons";
import { Button, Card, EmptyState, Sheet, Stat } from "../components/ui";
import { useLiveQuery } from "../hooks/useLiveQuery";
import { dataLunga, durata, inizioGiorno, ora, relativo } from "../lib/date";
import {
  elencaAttivita,
  elencaAziende,
  elencaReport,
  inizialiAzienda,
  nomeAzienda,
  riepilogo,
} from "../lib/repo";
import type { TipoAttivita } from "../lib/types";

export default function Panel() {
  const [foglio, setFoglio] = useState<"azienda" | "attivita" | null>(null);
  // Il tipo lo dice il bottone premuto: dal pannello si fissa un appuntamento
  // o si registra una chiamata, e non si sceglie poi quale dei due sia.
  const [tipo, setTipo] = useState<TipoAttivita>("appuntamento");

  function apriAttivita(scelto: TipoAttivita) {
    setTipo(scelto);
    setFoglio("attivita");
  }
  const dati = useLiveQuery(() => riepilogo());
  const oggi = useLiveQuery(() =>
    elencaAttivita({
      da: inizioGiorno(),
      a: new Date(Date.now() + 86_400_000).toISOString(),
    }),
  );
  const recenti = useLiveQuery(() => elencaReport().slice(0, 3));
  const aziendeRecenti = useLiveQuery(() => elencaAziende().slice(0, 4));
  const attivi = oggi.filter((attivita) => attivita.stato !== "annullato");

  return (
    <div>
      <header className="mb-6">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-brand-700">
          {new Date().toLocaleDateString("it-IT", {
            weekday: "long",
            day: "numeric",
            month: "long",
          })}
        </p>
        <h1 className="mt-1 text-[28px] leading-tight sm:text-4xl">La tua scrivania</h1>
      </header>

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Aziende" value={dati.aziende} hint={`${dati.report} report`} tone="muted" />
        <Stat
          label="Questa settimana"
          value={dati.attivitaSettimana}
          hint={`${dati.attivitaInAttesa} in attesa`}
          tone="brand"
        />
        <Stat label="Report" value={dati.report} hint="generati" tone="clay" />
        <Stat
          label="Prossimo"
          value={dati.prossimaAttivita ? ora(dati.prossimaAttivita.inizio) : "—"}
          hint={dati.prossimaAttivita ? relativo(dati.prossimaAttivita.inizio) : "da fissare"}
          tone="neutral"
        />
      </div>

      <div className="mb-6 grid gap-2.5 sm:grid-cols-3">
        <Button onClick={() => setFoglio("azienda")} size="lg">
          <PlusIcon className="h-4 w-4" />
          Nuova azienda
        </Button>
        {/* Appuntamento e chiamata sono due azioni, quindi due bottoni: qui si
            dichiara il tipo facendo la cosa, non scegliendolo dopo. */}
        <Button variant="secondary" size="lg" onClick={() => apriAttivita("appuntamento")}>
          <CalendarIcon className="h-4 w-4" />
          Appuntamento
        </Button>
        <Button variant="secondary" size="lg" onClick={() => apriAttivita("chiamata")}>
          <PhoneIcon className="h-4 w-4" />
          Chiamata
        </Button>
      </div>

      <section className="mb-8">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg">Agenda di oggi</h2>
          <Link to="/panel/attivita" className="text-[13px] font-medium text-brand-700">
            Vedi tutti
          </Link>
        </div>
        {attivi.length === 0 ? (
          <EmptyState
            icon={<CalendarIcon className="h-8 w-8" />}
            title="Giornata libera"
            description="Nessuna attività per oggi. Ideale per chiudere i report in sospeso."
            action={
              <div className="flex flex-wrap justify-center gap-2">
                <Button variant="secondary" onClick={() => apriAttivita("appuntamento")}>
                  <PlusIcon className="h-4 w-4" />
                  Fissa un appuntamento
                </Button>
                <Button variant="secondary" onClick={() => apriAttivita("chiamata")}>
                  <PhoneIcon className="h-4 w-4" />
                  Registra una chiamata
                </Button>
              </div>
            }
          />
        ) : (
          <ul className="space-y-2.5">
            {attivi.map((attivita) => (
              <li key={attivita.id} className="card flex items-center gap-4 p-4">
                <div className="w-16 shrink-0 text-center">
                  <p className="font-display text-2xl leading-none">{ora(attivita.inizio)}</p>
                  {/* Solo l'appuntamento ha una durazione: per una chiamata
                      qui sotto l'orario ci starebbe "30 min", che non è un
                      dato ma una convenzione, e la farebbe sembrare un campo. */}
                  {attivita.tipo === "appuntamento" ? (
                    <p className="mt-1 text-[11px] uppercase tracking-wide text-ink-300">
                      {durata(attivita.inizio, attivita.fine)}
                    </p>
                  ) : null}
                </div>
                <div className="min-w-0 flex-1 border-l border-ink-100 pl-4">
                  <p className="truncate font-medium text-ink-900">{attivita.titolo}</p>
                  <p className="mt-0.5 truncate text-xs text-ink-400">
                    {attivita.aziendaRagioneSociale || "Senza azienda"}
                    {attivita.tipo === "appuntamento" && attivita.luogo
                      ? ` · ${attivita.luogo}`
                      : ""}
                  </p>
                </div>
                {attivita.googleEventId ? (
                  <span className="shrink-0 rounded-full bg-brand-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-brand-800">
                    Google
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mb-8">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg">Aziende recenti</h2>
          <Link to="/panel/aziende" className="text-[13px] font-medium text-brand-700">
            Vedi tutte
          </Link>
        </div>
        {aziendeRecenti.length === 0 ? (
          <Card className="p-6 text-center">
            <BuildingIcon className="mx-auto h-7 w-7 text-ink-300" />
            <p className="mt-3 text-sm text-ink-400">Crea la prima azienda per iniziare.</p>
          </Card>
        ) : (
          <ul className="grid gap-2.5 sm:grid-cols-2">
            {aziendeRecenti.map((azienda) => (
              <li key={azienda.id}>
                <Link
                  to={`/panel/aziende/${azienda.id}`}
                  className="card flex items-center gap-3 p-3.5 transition-shadow hover:shadow-lift"
                >
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-ink-100 font-display text-sm text-ink-700">
                    {inizialiAzienda(azienda)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-ink-900">
                      {nomeAzienda(azienda)}
                    </span>
                    <span className="block truncate text-xs text-ink-400">
                      {azienda.numReferenti} referenti · {azienda.numReport} report
                    </span>
                  </span>
                  <ChevronRightIcon className="h-4 w-4 text-ink-300" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg">Report recenti</h2>
          <Link to="/panel/report" className="text-[13px] font-medium text-brand-700">
            Vedi tutte
          </Link>
        </div>
        {recenti.length === 0 ? (
          <Card className="p-6 text-center">
            <FileTextIcon className="mx-auto h-7 w-7 text-ink-300" />
            <p className="mt-3 text-sm text-ink-400">Ancora nessun report.</p>
          </Card>
        ) : (
          <ul className="space-y-2.5">
            {recenti.map((report) => (
              <li key={report.id} className="card p-4">
                <p className="font-medium text-ink-900">{report.titolo}</p>
                <p className="mt-0.5 text-xs text-ink-400">
                  {report.aziendaRagioneSociale} · {dataLunga(report.attivitaInizio)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <Sheet
        open={foglio === "azienda"}
        onClose={() => setFoglio(null)}
        title="Nuova azienda"
        description="Basta la ragione sociale: il resto puoi completarlo dopo."
      >
        <AziendaForm onSaved={() => setFoglio(null)} onCancel={() => setFoglio(null)} />
      </Sheet>

      <Sheet
        open={foglio === "attivita"}
        onClose={() => setFoglio(null)}
        title={tipo === "chiamata" ? "Nuova chiamata" : "Nuovo appuntamento"}
        description="Poi lo sincronizzi con Google Calendar dalla sezione Attività."
      >
        <AttivitaForm
          tipoIniziale={tipo}
          onSaved={() => setFoglio(null)}
          onCancel={() => setFoglio(null)}
        />
      </Sheet>
    </div>
  );
}
