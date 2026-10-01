import { useState } from "react";
import RelazioneForm from "../components/RelazioneForm";
import {
  DownloadIcon,
  EditIcon,
  FileTextIcon,
  PlusIcon,
  SearchIcon,
  TrashIcon,
} from "../components/icons";
import { Badge, Button, EmptyState, Input, PageHeader, Select, Sheet } from "../components/ui";
import { useAvvisi } from "../components/Avvisi";
import { eliminaAppuntamentiEEventi } from "../lib/google/sync";
import { useLiveQuery } from "../hooks/useLiveQuery";
import { scaricaTesto } from "../lib/google/calendar";
import { dataBreve } from "../lib/date";
import {
  appuntamentiConEventoDaEliminareRelazione,
  effettoEliminazioneRelazione,
  elencaRelazioni,
  eliminaRelazione,
} from "../lib/repo";
import type { Relazione, StatoRelazione } from "../lib/types";

const STATI: Array<{ valore: StatoRelazione | ""; etichetta: string }> = [
  { valore: "", etichetta: "Tutti gli stati" },
  { valore: "bozza", etichetta: "Bozza" },
  { valore: "revisione", etichetta: "In revisione" },
  { valore: "firmato", etichetta: "Firmato" },
  { valore: "consegnato", etichetta: "Consegnato" },
];

const TONO: Record<StatoRelazione, "neutral" | "brand" | "clay" | "muted"> = {
  bozza: "muted",
  revisione: "clay",
  firmato: "brand",
  consegnato: "neutral",
};

export default function Relazioni() {
  const { esegui } = useAvvisi();
  const [ricerca, setRicerca] = useState("");
  const [stato, setStato] = useState<StatoRelazione | "">("");
  const [aperto, setAperto] = useState(false);
  const [inModifica, setInModifica] = useState<Relazione | null>(null);

  const relazioni = useLiveQuery(() => elencaRelazioni({ ricerca, stato }), [ricerca, stato]);

  function apriNuova() {
    setInModifica(null);
    setAperto(true);
  }

  function apriModifica(relazione: Relazione) {
    setInModifica(relazione);
    setAperto(true);
  }

  return (
    <div>
      <PageHeader
        title="Relazioni"
        subtitle={`${relazioni.length} ${relazioni.length === 1 ? "relazione" : "relazioni"}`}
        action={
          <Button onClick={apriNuova} className="hidden sm:inline-flex">
            <PlusIcon className="h-4 w-4" />
            Nuova
          </Button>
        }
      />

      <div className="mb-4 grid gap-2.5 sm:grid-cols-[1fr_180px]">
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-300" />
          <Input
            value={ricerca}
            onChange={(event) => setRicerca(event.target.value)}
            placeholder="Cerca fra le relazioni"
            className="pl-10"
            type="search"
          />
        </div>
        <Select
          value={stato}
          onChange={(event) => setStato(event.target.value as StatoRelazione | "")}
        >
          {STATI.map((voce) => (
            <option key={voce.valore} value={voce.valore}>
              {voce.etichetta}
            </option>
          ))}
        </Select>
      </div>

      {relazioni.length === 0 ? (
        <EmptyState
          icon={<FileTextIcon className="h-9 w-9" />}
          title="Nessuna relazione"
          description="Crea una relazione e collegala all'azienda corrispondente per ritrovarla subito."
          action={
            <Button onClick={apriNuova}>
              <PlusIcon className="h-4 w-4" />
              Nuova relazione
            </Button>
          }
        />
      ) : (
        <ul className="space-y-2.5">
          {relazioni.map((relazione) => (
            <li key={relazione.id} className="card p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="truncate font-medium text-ink-900">{relazione.titolo}</h3>
                  <p className="mt-0.5 truncate text-xs text-ink-400">
                    {relazione.aziendaRagioneSociale}
                    {relazione.aziendaPartitaIva ? ` · ${relazione.aziendaPartitaIva}` : ""}
                  </p>
                </div>
                <Badge tone={TONO[relazione.stato]} className="shrink-0">
                  {relazione.stato}
                </Badge>
              </div>

              <p className="mt-3 line-clamp-3 whitespace-pre-wrap text-[13px] leading-relaxed text-ink-500">
                {relazione.contenuto || "Relazione senza contenuto."}
              </p>

              <div className="mt-4 flex flex-wrap items-center gap-1.5">
                <span className="mr-auto text-[11px] uppercase tracking-wide text-ink-300">
                  {relazione.tipo || "Senza tipo"} · {dataBreve(relazione.data)}
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    scaricaTesto(
                      `${relazione.titolo}.txt`,
                      `${relazione.titolo}\n${"—".repeat(relazione.titolo.length)}\n\nAzienda: ${relazione.aziendaRagioneSociale}${
                        relazione.aziendaPartitaIva
                          ? `\nPartita Iva: ${relazione.aziendaPartitaIva}`
                          : ""
                      }\nData: ${relazione.data}\n\n${relazione.contenuto}`,
                      "text/plain",
                    )
                  }
                >
                  <DownloadIcon className="h-4 w-4" />
                  .txt
                </Button>
                <Button size="sm" variant="ghost" onClick={() => apriModifica(relazione)}>
                  <EditIcon className="h-4 w-4" />
                  Modifica
                </Button>
                <Button
                  size="sm"
                  variant="danger"
                  onClick={() => {
                    const effetto = effettoEliminazioneRelazione(relazione.id);
                    if (
                      !confirm(
                        `Eliminare la relazione “${relazione.titolo}”?${
                          effetto.appuntamenti > 0
                            ? ` Verranno eliminati anche ${effetto.appuntamenti} ${
                                effetto.appuntamenti === 1
                                  ? "appuntamento che si riferiva"
                                  : "appuntamenti che si riferivano"
                              } solo a questa relazione.`
                            : ""
                        }`,
                      )
                    )
                      return;
                    void (async () => {
                      // Gli ID evento prima della cancellazione: dopo, gli
                      // eventi resterebbero orfani su Google Calendar.
                      const conEvento = appuntamentiConEventoDaEliminareRelazione(relazione.id);
                      const esito = await esegui(
                        () => eliminaAppuntamentiEEventi(conEvento.map((a) => a.id)),
                        { errore: "Eliminazione di alcuni appuntamenti non riuscita" },
                      );
                      if (!esito) return; // errore di rete: le righe restano
                      eliminaRelazione(relazione.id);
                    })();
                  }}
                >
                  <TrashIcon className="h-4 w-4" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <button
        type="button"
        onClick={apriNuova}
        aria-label="Nuova relazione"
        className="fixed bottom-24 right-5 z-30 grid h-14 w-14 place-items-center rounded-2xl bg-ink-950 text-white shadow-lift transition-transform active:scale-95 sm:hidden"
      >
        <PlusIcon className="h-6 w-6" />
      </button>

      <Sheet
        open={aperto}
        onClose={() => setAperto(false)}
        title={inModifica ? "Modifica relazione" : "Nuova relazione"}
        description="Il contenuto viene salvato esattamente come lo scrivi, a capo compresi."
      >
        <RelazioneForm
          relazione={inModifica}
          onSaved={() => setAperto(false)}
          onCancel={() => setAperto(false)}
        />
      </Sheet>
    </div>
  );
}
