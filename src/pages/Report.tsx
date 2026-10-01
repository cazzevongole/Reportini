import { useState } from "react";
import ReportForm from "../components/ReportForm";
import { EditIcon, FileTextIcon, SearchIcon, TrashIcon } from "../components/icons";
import { Badge, Button, EmptyState, Input, PageHeader, Sheet } from "../components/ui";
import { useAvvisi } from "../components/Avvisi";
import { useLiveQuery } from "../hooks/useLiveQuery";
import { dataBreve } from "../lib/date";
import { elencaReport, eliminaReport } from "../lib/repo";
import { ETICHETTA_TIPO, type ReportDettagliato } from "../lib/types";

/**
 * L'elenco dei report, che sono tutti nati da un'attività.
 *
 * Qui non c'è un pulsante per crearne uno: il report nasce segnando come
 * completata un'attività e generando il report dal suo dettaglio. È la
 * differenza richiesta, e per questo la pagina non ha né il filtro per lo
 * stato (il report non ha uno stato) né il campo tipo (è quello
 * dell'attività, e lo si legge nella riga).
 */
export default function Report() {
  const { esegui } = useAvvisi();
  const [ricerca, setRicerca] = useState("");
  const [inModifica, setInModifica] = useState<ReportDettagliato | null>(null);

  const report = useLiveQuery(() => elencaReport({ ricerca }), [ricerca]);

  return (
    <div>
      <PageHeader
        title="Report"
        subtitle={`${report.length} ${report.length === 1 ? "report generato" : "report generati"}`}
      />

      <div className="mb-4">
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-300" />
          <Input
            value={ricerca}
            onChange={(event) => setRicerca(event.target.value)}
            placeholder="Cerca fra i report"
            className="pl-10"
            type="search"
          />
        </div>
      </div>

      {report.length === 0 ? (
        <EmptyState
          icon={<FileTextIcon className="h-9 w-9" />}
          title="Nessun report"
          description="Apri un'attività, segnala come completata e da lì genera il report."
        />
      ) : (
        <ul className="space-y-2.5">
          {report.map((report) => (
            <li key={report.id} className="card p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="truncate font-medium text-ink-900">{report.titolo}</h3>
                  <p className="mt-0.5 truncate text-xs text-ink-400">
                    {report.aziendaRagioneSociale}
                    {report.aziendaPartitaIva ? ` · ${report.aziendaPartitaIva}` : ""}
                  </p>
                </div>
                {/* Il tipo è quello dell'attività: è la parola che finisce
                    anche nel titolo dell'evento su Google Calendar, quindi qui
                    è solo un richiamo di dove viene. */}
                <Badge tone="muted" className="shrink-0">
                  {ETICHETTA_TIPO[report.attivitaTipo]}
                </Badge>
              </div>

              <p className="mt-3 line-clamp-3 whitespace-pre-wrap text-[13px] leading-relaxed text-ink-500">
                {report.descrizione || "Report senza descrizione."}
              </p>

              <div className="mt-4 flex flex-wrap items-center gap-1.5">
                <span className="mr-auto text-[11px] uppercase tracking-wide text-ink-300">
                  {report.attivitaTitolo} · {dataBreve(report.attivitaInizio)}
                </span>
                <Button size="sm" variant="ghost" onClick={() => setInModifica(report)}>
                  <EditIcon className="h-4 w-4" />
                  Modifica
                </Button>
                <Button
                  size="sm"
                  variant="danger"
                  onClick={() => {
                    if (!confirm(`Eliminare il report "${report.titolo}"?`)) return;
                    // Solo il report: l'attività che lo ha generato resta,
                    // e da lei si può generarne un altro quando serve.
                    void esegui(async () => eliminaReport(report.id), {
                      errore: "Eliminazione del report non riuscita",
                    });
                  }}
                >
                  <TrashIcon className="h-4 w-4" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Sheet
        open={inModifica !== null}
        onClose={() => setInModifica(null)}
        title="Modifica report"
        description="Il testo viene salvato e stampato esattamente come lo scrivi."
      >
        {inModifica ? (
          <ReportForm
            report={inModifica}
            onSaved={() => setInModifica(null)}
            onCancel={() => setInModifica(null)}
          />
        ) : null}
      </Sheet>
    </div>
  );
}
