import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import AnagraficoForm from "../components/AnagraficoForm";
import AppuntamentoForm from "../components/AppuntamentoForm";
import RelazioneForm from "../components/RelazioneForm";
import {
  CalendarIcon,
  EditIcon,
  FileTextIcon,
  MapPinIcon,
  PlusIcon,
  TrashIcon,
} from "../components/icons";
import { Badge, Button, Card, Sheet } from "../components/ui";
import { useLiveQuery } from "../hooks/useLiveQuery";
import { dataLunga, durata, ora, relativo } from "../lib/date";
import {
  eliminaAnagrafico,
  elencaAppuntamenti,
  elencaRelazioni,
  iniziali,
  nomeCompleto,
  ottieniAnagrafico,
} from "../lib/repo";
import type { StatoRelazione } from "../lib/types";

const TONO: Record<StatoRelazione, "neutral" | "brand" | "clay" | "muted"> = {
  bozza: "muted",
  revisione: "clay",
  firmato: "brand",
  consegnato: "neutral",
};

export default function AnagraficoDettaglio() {
  const { id } = useParams();
  const navigate = useNavigate();
  const anagraficoId = Number(id);
  const [modificaAnagrafico, setModificaAnagrafico] = useState(false);
  const [foglio, setFoglio] = useState<"relazione" | "appuntamento" | null>(null);
  const [scheda, setScheda] = useState<"relazioni" | "appuntamenti">("relazioni");

  const anagrafico = useLiveQuery(() => ottieniAnagrafico(anagraficoId), [anagraficoId]);
  const relazioni = useLiveQuery(() => elencaRelazioni({ anagraficoId }), [anagraficoId]);
  const appuntamenti = useLiveQuery(() => elencaAppuntamenti({ anagraficoId }), [anagraficoId]);

  if (!anagrafico) {
    return (
      <Card className="p-8 text-center">
        <h1 className="text-xl">Anagrafico non trovato</h1>
        <p className="mt-2 text-sm text-ink-400">Potrebbe essere stato eliminato.</p>
        <Link to="/panel/anagrafici" className="mt-4 inline-block text-sm text-brand-700">
          Torna all'elenco
        </Link>
      </Card>
    );
  }

  const dati: Array<[string, string | null]> = [
    ["Documento", anagrafico.documento || null],
    ["Nascita", anagrafico.dataNascita],
    ["Nazionalità", anagrafico.nazionalita || null],
    ["Domicilio", anagrafico.indirizzo || null],
    [
      "Comune",
      [anagrafico.citta, anagrafico.cap, anagrafico.provincia].filter(Boolean).join(" · ") || null,
    ],
    ["Telefono", anagrafico.telefono || null],
    ["Email", anagrafico.email || null],
  ];

  return (
    <div>
      <div className="mb-5 flex items-start gap-4">
        <span className="grid h-16 w-16 shrink-0 place-items-center rounded-3xl bg-ink-950 font-display text-xl text-white">
          {iniziali(anagrafico)}
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-2xl sm:text-3xl">
            {nomeCompleto(anagrafico) || "Senza nome"}
          </h1>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-400">
            {anagrafico.documento ? <span>{anagrafico.documento}</span> : null}
            {anagrafico.citta ? (
              <span className="inline-flex items-center gap-1">
                <MapPinIcon className="h-3.5 w-3.5" />
                {anagrafico.citta}
              </span>
            ) : null}
          </p>
        </div>
      </div>

      <div className="mb-5 flex flex-wrap gap-2">
        <Button variant="secondary" size="sm" onClick={() => setModificaAnagrafico(true)}>
          <EditIcon className="h-4 w-4" />
          Modifica
        </Button>
        <Button size="sm" onClick={() => setFoglio("relazione")}>
          <PlusIcon className="h-4 w-4" />
          Relazione
        </Button>
        <Button size="sm" variant="secondary" onClick={() => setFoglio("appuntamento")}>
          <CalendarIcon className="h-4 w-4" />
          Appuntamento
        </Button>
        <Button
          size="sm"
          variant="danger"
          onClick={() => {
            if (
              confirm(
                `Eliminare ${nomeCompleto(anagrafico)}? Verranno eliminate anche le sue relazioni.`,
              )
            ) {
              eliminaAnagrafico(anagrafico.id);
              navigate("/panel/anagrafici");
            }
          }}
        >
          <TrashIcon className="h-4 w-4" />
        </Button>
      </div>

      <Card className="mb-6 p-5">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
          {dati
            .filter(([, valore]) => valore)
            .map(([etichetta, valore]) => (
              <div key={etichetta}>
                <dt className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-400">
                  {etichetta}
                </dt>
                <dd className="mt-0.5 break-words text-[15px] text-ink-800">{valore}</dd>
              </div>
            ))}
        </dl>
        {anagrafico.note ? (
          <p className="mt-4 whitespace-pre-wrap border-t border-ink-100 pt-4 text-sm leading-relaxed text-ink-500">
            {anagrafico.note}
          </p>
        ) : null}
      </Card>

      <div className="mb-4 flex gap-1.5">
        {(
          [
            ["relazioni", `Relazioni (${relazioni.length})`],
            ["appuntamenti", `Appuntamenti (${appuntamenti.length})`],
          ] as const
        ).map(([chiave, etichetta]) => (
          <button
            key={chiave}
            type="button"
            onClick={() => setScheda(chiave)}
            className={`rounded-full px-4 py-1.5 text-[13px] font-medium transition-colors ${
              scheda === chiave
                ? "bg-ink-950 text-white"
                : "border border-ink-200 bg-white text-ink-500"
            }`}
          >
            {etichetta}
          </button>
        ))}
      </div>

      {scheda === "relazioni" ? (
        relazioni.length === 0 ? (
          <Card className="p-6 text-center">
            <FileTextIcon className="mx-auto h-7 w-7 text-ink-300" />
            <p className="mt-3 text-sm text-ink-400">
              Non ci sono ancora relazioni per questo anagrafico.
            </p>
            <Button size="sm" className="mt-4" onClick={() => setFoglio("relazione")}>
              <PlusIcon className="h-4 w-4" />
              Crea relazione
            </Button>
          </Card>
        ) : (
          <ul className="space-y-2.5">
            {relazioni.map((relazione) => (
              <li key={relazione.id} className="card p-4">
                <div className="flex items-start justify-between gap-3">
                  <h3 className="font-medium text-ink-900">{relazione.titolo}</h3>
                  <Badge tone={TONO[relazione.stato]}>{relazione.stato}</Badge>
                </div>
                <p className="mt-2 line-clamp-2 whitespace-pre-wrap text-[13px] text-ink-500">
                  {relazione.contenuto}
                </p>
                <p className="mt-3 text-[11px] uppercase tracking-wide text-ink-300">
                  {relazione.tipo || "Senza tipo"} · {relazione.data}
                </p>
              </li>
            ))}
          </ul>
        )
      ) : appuntamenti.length === 0 ? (
        <Card className="p-6 text-center">
          <CalendarIcon className="mx-auto h-7 w-7 text-ink-300" />
          <p className="mt-3 text-sm text-ink-400">Nessun appuntamento collegato.</p>
          <Button size="sm" className="mt-4" onClick={() => setFoglio("appuntamento")}>
            <PlusIcon className="h-4 w-4" />
            Fissa un appuntamento
          </Button>
        </Card>
      ) : (
        <ul className="space-y-2.5">
          {appuntamenti.map((appuntamento) => (
            <li key={appuntamento.id} className="card p-4">
              <div className="flex items-baseline justify-between gap-3">
                <h3 className="font-medium text-ink-900">{appuntamento.titolo}</h3>
                <span className="shrink-0 font-display text-lg text-ink-950">
                  {ora(appuntamento.inizio)}
                </span>
              </div>
              <p className="mt-1 text-xs text-ink-400">
                {dataLunga(appuntamento.inizio)} · {durata(appuntamento.inizio, appuntamento.fine)} ·{" "}
                {relativo(appuntamento.inizio)}
              </p>
              {appuntamento.luogo ? (
                <p className="mt-1 text-xs text-ink-400">{appuntamento.luogo}</p>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      <Sheet
        open={modificaAnagrafico}
        onClose={() => setModificaAnagrafico(false)}
        title="Modifica anagrafico"
        description={nomeCompleto(anagrafico)}
      >
        <AnagraficoForm
          anagrafico={anagrafico}
          onSaved={() => setModificaAnagrafico(false)}
          onCancel={() => setModificaAnagrafico(false)}
        />
      </Sheet>

      <Sheet
        open={foglio === "relazione"}
        onClose={() => setFoglio(null)}
        title="Nuova relazione"
        description={`Verrà collegata a ${nomeCompleto(anagrafico)}.`}
      >
        <RelazioneForm
          anagraficoIdIniziale={anagrafico.id}
          onSaved={() => setFoglio(null)}
          onCancel={() => setFoglio(null)}
        />
      </Sheet>

      <Sheet
        open={foglio === "appuntamento"}
        onClose={() => setFoglio(null)}
        title="Nuovo appuntamento"
        description="Puoi pubblicarlo su Google Calendar dalla sezione Appuntamenti."
      >
        <AppuntamentoForm
          anagraficoIdIniziale={anagrafico.id}
          onSaved={() => setFoglio(null)}
          onCancel={() => setFoglio(null)}
        />
      </Sheet>
    </div>
  );
}
