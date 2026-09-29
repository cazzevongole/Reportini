import { useState } from "react";
import { Link } from "react-router-dom";
import AnagraficoForm from "../components/AnagraficoForm";
import AppuntamentoForm from "../components/AppuntamentoForm";
import {
  CalendarIcon,
  ChevronRightIcon,
  FileTextIcon,
  PlusIcon,
  UsersIcon,
} from "../components/icons";
import { Button, Card, EmptyState, Sheet, Stat } from "../components/ui";
import { useLiveQuery } from "../hooks/useLiveQuery";
import { dataLunga, durata, inizioGiorno, ora, relativo } from "../lib/date";
import {
  elencaAnagrafici,
  elencaAppuntamenti,
  elencaRelazioni,
  iniziali,
  nomeCompleto,
  riepilogo,
} from "../lib/repo";

export default function Panel() {
  const [foglio, setFoglio] = useState<"anagrafico" | "appuntamento" | null>(null);
  const dati = useLiveQuery(() => riepilogo());
  const oggi = useLiveQuery(() =>
    elencaAppuntamenti({
      da: inizioGiorno(),
      a: new Date(Date.now() + 86_400_000).toISOString(),
    }),
  );
  const recenti = useLiveQuery(() => elencaRelazioni().slice(0, 3));
  const anagraficiRecenti = useLiveQuery(() => elencaAnagrafici().slice(0, 4));
  const attivi = oggi.filter((appuntamento) => appuntamento.stato !== "annullato");

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
        <Stat
          label="Anagrafici"
          value={dati.anagrafici}
          hint={`${dati.relazioni} relazioni`}
          tone="muted"
        />
        <Stat
          label="Questa settimana"
          value={dati.appuntamentiSettimana}
          hint={`${dati.appuntamentiInAttesa} in attesa`}
          tone="brand"
        />
        <Stat label="Bozze" value={dati.relazioniBozza} hint="relazioni" tone="clay" />
        <Stat
          label="Prossimo"
          value={dati.prossimoAppuntamento ? ora(dati.prossimoAppuntamento.inizio) : "—"}
          hint={
            dati.prossimoAppuntamento ? relativo(dati.prossimoAppuntamento.inizio) : "da fissare"
          }
          tone="neutral"
        />
      </div>

      <div className="mb-6 grid gap-2.5 sm:grid-cols-2">
        <Button onClick={() => setFoglio("anagrafico")} size="lg">
          <PlusIcon className="h-4 w-4" />
          Nuovo anagrafico
        </Button>
        <Button variant="secondary" size="lg" onClick={() => setFoglio("appuntamento")}>
          <CalendarIcon className="h-4 w-4" />
          Fissa un appuntamento
        </Button>
      </div>

      <section className="mb-8">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg">Agenda di oggi</h2>
          <Link to="/panel/appuntamenti" className="text-[13px] font-medium text-brand-700">
            Vedi tutti
          </Link>
        </div>
        {attivi.length === 0 ? (
          <EmptyState
            icon={<CalendarIcon className="h-8 w-8" />}
            title="Giornata libera"
            description="Nessun appuntamento per oggi. Ideale per chiudere le relazioni in sospeso."
            action={
              <Button variant="secondary" onClick={() => setFoglio("appuntamento")}>
                <PlusIcon className="h-4 w-4" />
                Fissa un appuntamento
              </Button>
            }
          />
        ) : (
          <ul className="space-y-2.5">
            {attivi.map((appuntamento) => (
              <li key={appuntamento.id} className="card flex items-center gap-4 p-4">
                <div className="w-16 shrink-0 text-center">
                  <p className="font-display text-2xl leading-none">{ora(appuntamento.inizio)}</p>
                  <p className="mt-1 text-[11px] uppercase tracking-wide text-ink-300">
                    {durata(appuntamento.inizio, appuntamento.fine)}
                  </p>
                </div>
                <div className="min-w-0 flex-1 border-l border-ink-100 pl-4">
                  <p className="truncate font-medium text-ink-900">{appuntamento.titolo}</p>
                  <p className="mt-0.5 truncate text-xs text-ink-400">
                    {appuntamento.anagraficoNome
                      ? `${appuntamento.anagraficoNome} ${appuntamento.anagraficoCognome}`
                      : "Senza anagrafico"}
                    {appuntamento.luogo ? ` · ${appuntamento.luogo}` : ""}
                  </p>
                </div>
                {appuntamento.googleEventId ? (
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
          <h2 className="text-lg">Anagrafici recenti</h2>
          <Link to="/panel/anagrafici" className="text-[13px] font-medium text-brand-700">
            Vedi tutti
          </Link>
        </div>
        {anagraficiRecenti.length === 0 ? (
          <Card className="p-6 text-center">
            <UsersIcon className="mx-auto h-7 w-7 text-ink-300" />
            <p className="mt-3 text-sm text-ink-400">Crea il primo anagrafico per iniziare.</p>
          </Card>
        ) : (
          <ul className="grid gap-2.5 sm:grid-cols-2">
            {anagraficiRecenti.map((anagrafico) => (
              <li key={anagrafico.id}>
                <Link
                  to={`/panel/anagrafici/${anagrafico.id}`}
                  className="card flex items-center gap-3 p-3.5 transition-shadow hover:shadow-lift"
                >
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-ink-100 font-display text-sm text-ink-700">
                    {iniziali(anagrafico)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-ink-900">
                      {nomeCompleto(anagrafico)}
                    </span>
                    <span className="block truncate text-xs text-ink-400">
                      {anagrafico.numRelazioni} relazioni · {anagrafico.numAppuntamenti}{" "}
                      appuntamenti
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
          <h2 className="text-lg">Relazioni recenti</h2>
          <Link to="/panel/relazioni" className="text-[13px] font-medium text-brand-700">
            Vedi tutte
          </Link>
        </div>
        {recenti.length === 0 ? (
          <Card className="p-6 text-center">
            <FileTextIcon className="mx-auto h-7 w-7 text-ink-300" />
            <p className="mt-3 text-sm text-ink-400">Ancora nessuna relazione.</p>
          </Card>
        ) : (
          <ul className="space-y-2.5">
            {recenti.map((relazione) => (
              <li key={relazione.id} className="card p-4">
                <p className="font-medium text-ink-900">{relazione.titolo}</p>
                <p className="mt-0.5 text-xs text-ink-400">
                  {relazione.anagraficoNome} {relazione.anagraficoCognome} ·{" "}
                  {dataLunga(`${relazione.data}T12:00:00`)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <Sheet
        open={foglio === "anagrafico"}
        onClose={() => setFoglio(null)}
        title="Nuovo anagrafico"
        description="Basta il nome: il resto puoi completarlo dopo."
      >
        <AnagraficoForm onSaved={() => setFoglio(null)} onCancel={() => setFoglio(null)} />
      </Sheet>

      <Sheet
        open={foglio === "appuntamento"}
        onClose={() => setFoglio(null)}
        title="Nuovo appuntamento"
        description="Poi lo sincronizzi con Google Calendar dalla sezione Appuntamenti."
      >
        <AppuntamentoForm onSaved={() => setFoglio(null)} onCancel={() => setFoglio(null)} />
      </Sheet>
    </div>
  );
}
