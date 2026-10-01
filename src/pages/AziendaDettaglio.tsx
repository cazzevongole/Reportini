import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import AppuntamentoForm from "../components/AppuntamentoForm";
import AziendaForm from "../components/AziendaForm";
import RelazioneForm from "../components/RelazioneForm";
import ReferenteForm from "../components/ReferenteForm";
import {
  CalendarIcon,
  EditIcon,
  FileTextIcon,
  MapPinIcon,
  PlusIcon,
  TrashIcon,
  UsersIcon,
} from "../components/icons";
import { Badge, Button, Card, Sheet } from "../components/ui";
import { useAvvisi } from "../components/Avvisi";
import { eliminaAppuntamentiEEventi } from "../lib/google/sync";
import { useLiveQuery } from "../hooks/useLiveQuery";
import { dataLunga, durata, ora, relativo } from "../lib/date";
import {
  appuntamentiConEventoDaEliminareAzienda,
  effettoEliminazioneAzienda,
  eliminaAzienda,
  eliminaReferente,
  elencaAppuntamenti,
  elencaReferenti,
  elencaRelazioni,
  inizialiAzienda,
  nomeAzienda,
  nomeReferente,
  ottieniAzienda,
} from "../lib/repo";
import type { Referente, StatoRelazione } from "../lib/types";

const TONO: Record<StatoRelazione, "neutral" | "brand" | "clay" | "muted"> = {
  bozza: "muted",
  revisione: "clay",
  firmato: "brand",
  consegnato: "neutral",
};

export default function AziendaDettaglio() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { esegui } = useAvvisi();
  const aziendaId = Number(id);
  const [modificaAzienda, setModificaAzienda] = useState(false);
  const [foglio, setFoglio] = useState<"relazione" | "appuntamento" | "referente" | null>(null);
  const [referente, setReferente] = useState<Referente | null>(null);
  const [scheda, setScheda] = useState<"relazioni" | "appuntamenti">("relazioni");

  const azienda = useLiveQuery(() => ottieniAzienda(aziendaId), [aziendaId]);
  const relazioni = useLiveQuery(() => elencaRelazioni({ aziendaId }), [aziendaId]);
  const appuntamenti = useLiveQuery(() => elencaAppuntamenti({ aziendaId }), [aziendaId]);
  const referenti = useLiveQuery(() => elencaReferenti(aziendaId), [aziendaId]);

  if (!azienda) {
    return (
      <Card className="p-8 text-center">
        <h1 className="text-xl">Azienda non trovata</h1>
        <p className="mt-2 text-sm text-ink-400">Potrebbe essere stata eliminata.</p>
        <Link to="/panel/aziende" className="mt-4 inline-block text-sm text-brand-700">
          Torna all'elenco
        </Link>
      </Card>
    );
  }

  const dati: Array<[string, string | null]> = [
    ["Partita IVA", azienda.partitaIva || null],
    ["Sede", azienda.indirizzo || null],
    ["Comune", [azienda.citta, azienda.cap, azienda.provincia].filter(Boolean).join(" · ") || null],
    ["Telefono", azienda.telefono || null],
    ["Email", azienda.email || null],
  ];

  return (
    <div>
      <div className="mb-5 flex items-start gap-4">
        <span className="grid h-16 w-16 shrink-0 place-items-center rounded-3xl bg-ink-950 font-display text-xl text-white">
          {inizialiAzienda(azienda)}
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-2xl sm:text-3xl">{nomeAzienda(azienda)}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-400">
            {azienda.partitaIva ? <span>{azienda.partitaIva}</span> : null}
            {azienda.citta ? (
              <span className="inline-flex items-center gap-1">
                <MapPinIcon className="h-3.5 w-3.5" />
                {azienda.citta}
              </span>
            ) : null}
          </p>
        </div>
      </div>

      <div className="mb-5 flex flex-wrap gap-2">
        <Button variant="secondary" size="sm" onClick={() => setModificaAzienda(true)}>
          <EditIcon className="h-4 w-4" />
          Modifica
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => {
            setReferente(null);
            setFoglio("referente");
          }}
        >
          <PlusIcon className="h-4 w-4" />
          Referente
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
            // La conferma enumera quello che sparisce davvero: referenti,
            // relazioni e appuntamenti che resterebbero senza nessun
            // riferimento.
            const effetto = effettoEliminazioneAzienda(azienda.id);
            const extra = [
              effetto.referenti > 0
                ? `${effetto.referenti} ${effetto.referenti === 1 ? "referente" : "referenti"}`
                : "",
              effetto.relazioni > 0
                ? `${effetto.relazioni} ${effetto.relazioni === 1 ? "relazione" : "relazioni"}`
                : "",
              effetto.appuntamenti > 0
                ? `${effetto.appuntamenti} ${effetto.appuntamenti === 1 ? "appuntamento" : "appuntamenti"}`
                : "",
            ]
              .filter(Boolean)
              .join(" e ");
            if (
              !confirm(
                `Eliminare ${nomeAzienda(azienda)}?${
                  extra ? ` Verranno eliminati anche: ${extra}.` : ""
                }`,
              )
            )
              return;
            void (async () => {
              // Gli ID evento vanno raccolti PRIMA di cancellare: dopo, le
              // righe non esistono più e gli eventi su Google resterebbero
              // orfani in agenda per sempre.
              const conEvento = appuntamentiConEventoDaEliminareAzienda(azienda.id);
              const esito = await esegui(
                () => eliminaAppuntamentiEEventi(conEvento.map((a) => a.id)),
                { errore: "Eliminazione di alcuni appuntamenti non riuscita" },
              );
              if (!esito) return; // errore di rete: le righe restano, si può riprovare
              eliminaAzienda(azienda.id);
              navigate("/panel/aziende");
            })();
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
        {azienda.note ? (
          <p className="mt-4 whitespace-pre-wrap border-t border-ink-100 pt-4 text-sm leading-relaxed text-ink-500">
            {azienda.note}
          </p>
        ) : null}
      </Card>

      {/* I referenti vengono prima delle relazioni: sono le persone con cui
          si parla, e senza di loro la scheda non dice a chi scrivere. */}
      <Card className="mb-6 p-5">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 font-medium text-ink-900">
            <UsersIcon className="h-4 w-4 text-ink-400" />
            Referenti
            <span className="text-sm font-normal text-ink-400">({referenti.length})</span>
          </h2>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              setReferente(null);
              setFoglio("referente");
            }}
          >
            <PlusIcon className="h-3.5 w-3.5" />
            Aggiungi
          </Button>
        </div>
        {referenti.length === 0 ? (
          <p className="text-sm text-ink-400">
            Nessun referente: le relazioni e gli appuntamenti restano collegati all'azienda, ma
            nessuno sa a chi scrivere.
          </p>
        ) : (
          <ul className="divide-y divide-ink-100">
            {referenti.map((r) => (
              <li key={r.id} className="flex items-center gap-3 py-2.5">
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-ink-900">
                    {nomeReferente(r)}
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-ink-400">
                    {[r.telefono, r.email].filter(Boolean).join(" · ") || "Senza recapiti"}
                  </span>
                </span>
                <button
                  type="button"
                  aria-label={`Modifica ${nomeReferente(r)}`}
                  onClick={() => {
                    setReferente(r);
                    setFoglio("referente");
                  }}
                  className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-ink-300 transition-colors hover:bg-ink-100 hover:text-ink-700"
                >
                  <EditIcon className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  aria-label={`Elimina ${nomeReferente(r)}`}
                  onClick={() => {
                    if (!confirm(`Eliminare il referente ${nomeReferente(r)}?`)) return;
                    eliminaReferente(r.id);
                  }}
                  className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-ink-300 transition-colors hover:bg-ink-100 hover:text-clay-600"
                >
                  <TrashIcon className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
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
              Non ci sono ancora relazioni per questa azienda.
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
                {dataLunga(appuntamento.inizio)} · {durata(appuntamento.inizio, appuntamento.fine)}{" "}
                · {relativo(appuntamento.inizio)}
              </p>
              {appuntamento.luogo ? (
                <p className="mt-1 text-xs text-ink-400">{appuntamento.luogo}</p>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      <Sheet
        open={modificaAzienda}
        onClose={() => setModificaAzienda(false)}
        title="Modifica azienda"
        description={nomeAzienda(azienda)}
      >
        <AziendaForm
          azienda={azienda}
          onSaved={() => setModificaAzienda(false)}
          onCancel={() => setModificaAzienda(false)}
        />
      </Sheet>

      <Sheet
        open={foglio === "referente"}
        onClose={() => setFoglio(null)}
        title={referente ? "Modifica referente" : "Nuovo referente"}
        description={`Riferito a ${nomeAzienda(azienda)}.`}
      >
        <ReferenteForm
          aziendaId={azienda.id}
          referente={referente}
          onSaved={() => setFoglio(null)}
          onCancel={() => setFoglio(null)}
        />
      </Sheet>

      <Sheet
        open={foglio === "relazione"}
        onClose={() => setFoglio(null)}
        title="Nuova relazione"
        description={`Verrà collegata a ${nomeAzienda(azienda)}.`}
      >
        <RelazioneForm
          aziendaIdIniziale={azienda.id}
          onSaved={() => setFoglio(null)}
          onCancel={() => setFoglio(null)}
        />
      </Sheet>

      <Sheet
        open={foglio === "appuntamento"}
        onClose={() => setFoglio(null)}
        title="Nuovo appuntamento"
        description="Se Google Calendar è collegato, l'appuntamento viene pubblicato appena lo salvi."
      >
        <AppuntamentoForm
          aziendaIdIniziale={azienda.id}
          onSaved={() => setFoglio(null)}
          onCancel={() => setFoglio(null)}
        />
      </Sheet>
    </div>
  );
}
