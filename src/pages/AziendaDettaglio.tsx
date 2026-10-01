import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import AttivitaForm from "../components/AttivitaForm";
import AziendaForm from "../components/AziendaForm";
import DettaglioAttivita from "../components/DettaglioAttivita";
import ReferenteForm from "../components/ReferenteForm";
import {
  CalendarIcon,
  CheckIcon,
  EditIcon,
  FileTextIcon,
  MapPinIcon,
  PhoneIcon,
  PlusIcon,
  TrashIcon,
  UsersIcon,
} from "../components/icons";
import { Badge, Button, Card, Sheet } from "../components/ui";
import BadgeStato from "../components/BadgeStato";
import Recapito from "../components/Recapito";
import { useAvvisi } from "../components/Avvisi";
import { eliminaAttivitaEEventi } from "../lib/google/sync";
import { useLiveQuery } from "../hooks/useLiveQuery";
import { dataLunga, durata, ora, relativo } from "../lib/date";
import {
  attivitaConEventoDaEliminareAzienda,
  effettoEliminazioneAzienda,
  eliminaAzienda,
  eliminaReferente,
  elencaAttivita,
  elencaReferenti,
  elencaReport,
  inizialiAzienda,
  nomeAzienda,
  nomeReferente,
  ottieniAzienda,
} from "../lib/repo";
import { ETICHETTA_TIPO, type Referente, type TipoAttivita } from "../lib/types";

export default function AziendaDettaglio() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { esegui } = useAvvisi();
  const aziendaId = Number(id);
  const [modificaAzienda, setModificaAzienda] = useState(false);
  // Il tipo fa parte del foglio aperto: è l'azione premuta a portare qui, e
  // non una scelta da fare dentro il modulo. Senza, "appuntamento" e
  // "chiamata" sarebbero lo stesso bottone con un campino da cambiare dopo.
  const [foglio, setFoglio] = useState<"attivita" | "referente" | null>(null);
  const [tipo, setTipo] = useState<TipoAttivita>("appuntamento");

  function apriAttivita(scelto: TipoAttivita) {
    setTipo(scelto);
    setFoglio("attivita");
  }
  const [referente, setReferente] = useState<Referente | null>(null);
  const [scheda, setScheda] = useState<"attivita" | "report">("attivita");
  // L'attività aperta in dettaglio: è da lì che si segna come completata e
  // si genera il report, quindi serve un'id e non un semplice "aperto".
  const [attivitaAperta, setAttivitaAperta] = useState<number | null>(null);
  const [riga, setRiga] = useState(0);

  const azienda = useLiveQuery(() => ottieniAzienda(aziendaId), [aziendaId]);
  const report = useLiveQuery(() => elencaReport({ aziendaId }), [aziendaId]);
  const attivita = useLiveQuery(() => elencaAttivita({ aziendaId }), [aziendaId]);
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

  const aperta = attivita.find((a) => a.id === attivitaAperta) ?? null;
  // Serve a far rimontare il foglio quando si salva qualcosa: senza, il
  // dettaglio mostrerebbe ancora i valori di prima, perché il form chiude e
  // riapre sullo stesso componente con le stesse props.
  const dettaglio = aperta ? { attivita: aperta, chiave: riga } : null;

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
        {/* Le due azioni sulla scheda stanno in testata, a destra di ragione
            sociale e partita iva: modificare l'azienda e cancellarla. Sono
            cose che riguardano la scheda — nome, indirizzo, recapiti — e non il
            lavoro di oggi, quindi non si mescolano con le azioni che creano
            qualcosa (referente, appuntamento, chiamata), che restano nella riga
            sotto. L'ordine non è una questione di bellezza: è ciò che
            l'utente non debba cercare dove si cancella una cosa che contiene
            tutto il resto. */}
        <div className="flex shrink-0 items-center gap-2">
          <Button variant="secondary" size="sm" onClick={() => setModificaAzienda(true)}>
            <EditIcon className="h-4 w-4" />
            Modifica
          </Button>
          <Button
            size="sm"
            variant="danger"
            onClick={() => {
              // La conferma enumera quello che sparisce davvero: referenti,
              // attività e i report che sono nati da quelle attività.
              const effetto = effettoEliminazioneAzienda(azienda.id);
              const extra = [
                effetto.referenti > 0
                  ? `${effetto.referenti} ${effetto.referenti === 1 ? "referente" : "referenti"}`
                  : "",
                effetto.attivita > 0 ? `${effetto.attivita} attività` : "",
                effetto.report > 0 ? `${effetto.report} report` : "",
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
                const conEvento = attivitaConEventoDaEliminareAzienda(azienda.id);
                const esito = await esegui(
                  () => eliminaAttivitaEEventi(conEvento.map((a) => a.id)),
                  {
                    errore: "Eliminazione di alcune attività non riuscita",
                  },
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
      </div>

      <div className="mb-5 flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="secondary"
          onClick={() => {
            setReferente(null);
            setFoglio("referente");
          }}
        >
          <UsersIcon className="h-4 w-4" />
          Referente
        </Button>
        {/* Due bottoni e non uno con un menu: sono due cose che l'utente
            decide di fare, non due modi di dire la stessa cosa. */}
        <Button size="sm" onClick={() => apriAttivita("appuntamento")}>
          <CalendarIcon className="h-4 w-4" />
          Appuntamento
        </Button>
        <Button size="sm" onClick={() => apriAttivita("chiamata")}>
          <PhoneIcon className="h-4 w-4" />
          Chiamata
        </Button>
      </div>

      <Card className="mb-6 p-5">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
          {azienda.partitaIva ? (
            <div>
              <dt className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-400">
                Partita IVA
              </dt>
              <dd className="mt-0.5 break-words text-[15px] text-ink-800">{azienda.partitaIva}</dd>
            </div>
          ) : null}
          {azienda.indirizzo ? (
            <div>
              <dt className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-400">
                Sede
              </dt>
              <dd className="mt-0.5 break-words text-[15px] text-ink-800">{azienda.indirizzo}</dd>
            </div>
          ) : null}
          {[azienda.citta, azienda.cap, azienda.provincia].filter(Boolean).length > 0 ? (
            <div>
              <dt className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-400">
                Comune
              </dt>
              <dd className="mt-0.5 break-words text-[15px] text-ink-800">
                {[azienda.citta, azienda.cap, azienda.provincia].filter(Boolean).join(" · ")}
              </dd>
            </div>
          ) : null}
          {/* Telefono ed email sono cliccabili: sono recapiti, e un recapito
              che si deve copiare a mano è un recapito che non si usa. */}
          {azienda.telefono ? (
            <div>
              <dt className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-400">
                Telefono
              </dt>
              <dd className="mt-0.5">
                <Recapito tipo="telefono" valore={azienda.telefono} />
              </dd>
            </div>
          ) : null}
          {azienda.email ? (
            <div>
              <dt className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-400">
                Email
              </dt>
              <dd className="mt-0.5 break-words">
                <Recapito tipo="email" valore={azienda.email} />
              </dd>
            </div>
          ) : null}
        </dl>
        {azienda.note ? (
          <p className="mt-4 whitespace-pre-wrap border-t border-ink-100 pt-4 text-sm leading-relaxed text-ink-500">
            {azienda.note}
          </p>
        ) : null}
      </Card>

      {/* I referenti vengono prima delle attività: sono le persone con cui
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
            Nessun referente: attività e report restano collegati all'azienda, ma nessuno sa a chi
            scrivere.
          </p>
        ) : (
          <ul className="divide-y divide-ink-100">
            {referenti.map((r) => (
              <li key={r.id} className="flex items-center gap-3 py-2.5">
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-ink-900">
                    {nomeReferente(r)}
                  </span>
                  <span className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs">
                    {r.telefono ? <Recapito tipo="telefono" valore={r.telefono} /> : null}
                    {r.email ? <Recapito tipo="email" valore={r.email} /> : null}
                    {!r.telefono && !r.email ? (
                      <span className="text-ink-400">Senza recapiti</span>
                    ) : null}
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
            ["attivita", `Attività (${attivita.length})`],
            ["report", `Report (${report.length})`],
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

      {scheda === "attivita" ? (
        attivita.length === 0 ? (
          <Card className="p-6 text-center">
            <CalendarIcon className="mx-auto h-7 w-7 text-ink-300" />
            <p className="mt-3 text-sm text-ink-400">Nessuna attività per questa azienda.</p>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              <Button size="sm" onClick={() => apriAttivita("appuntamento")}>
                <PlusIcon className="h-4 w-4" />
                Fissa un appuntamento
              </Button>
              <Button size="sm" onClick={() => apriAttivita("chiamata")}>
                <PhoneIcon className="h-4 w-4" />
                Registra una chiamata
              </Button>
            </div>
          </Card>
        ) : (
          <ul className="space-y-2.5">
            {attivita.map((attivita) => (
              <li key={attivita.id}>
                {/* La riga è un bottone: da qui si apre il dettaglio, che è il
                    posto dove l'attività si segna come completata e da dove si
                    genera il report. */}
                <button
                  type="button"
                  onClick={() => setAttivitaAperta(attivita.id)}
                  className="card block w-full p-4 text-left transition-colors hover:border-ink-200"
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <h3 className="truncate font-medium text-ink-900">{attivita.titolo}</h3>
                    <span className="shrink-0 font-display text-lg text-ink-950">
                      {ora(attivita.inizio)}
                    </span>
                  </div>
                  {/* Su una chiamata la durata non c'è: c'è un momento. E il
                      chip "completata" sparisce, perché il badge dice già
                      "fatta" — dirlo due volte con due parole diverse è il
                      modo più rapido per far dubitare l'utente su quale sia
                      quello giusto. */}
                  <p className="mt-1 text-xs text-ink-400">
                    {dataLunga(attivita.inizio)}
                    {attivita.tipo === "appuntamento"
                      ? ` · ${durata(attivita.inizio, attivita.fine)}`
                      : ""}{" "}
                    · {relativo(attivita.inizio)}
                  </p>
                  <p className="mt-2 flex flex-wrap items-center gap-1.5">
                    <BadgeStato
                      tipo={attivita.tipo}
                      stato={attivita.stato}
                      completata={attivita.completata}
                    />
                    <Badge tone="muted">{ETICHETTA_TIPO[attivita.tipo]}</Badge>
                    {attivita.completata && attivita.tipo === "appuntamento" ? (
                      <span className="inline-flex items-center gap-1 text-[11px] text-brand-600">
                        <CheckIcon className="h-3 w-3" />
                        completata
                      </span>
                    ) : null}
                  </p>
                  {attivita.tipo === "appuntamento" && attivita.luogo ? (
                    <p className="mt-2 text-xs text-ink-400">{attivita.luogo}</p>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        )
      ) : report.length === 0 ? (
        <Card className="p-6 text-center">
          <FileTextIcon className="mx-auto h-7 w-7 text-ink-300" />
          <p className="mt-3 text-sm text-ink-400">
            Nessun report per questa azienda. Apri un'attività, segnala come completata e da lì
            genera il report.
          </p>
        </Card>
      ) : (
        <ul className="space-y-2.5">
          {report.map((report) => (
            <li key={report.id} className="card p-4">
              <div className="flex items-start justify-between gap-3">
                <h3 className="min-w-0 truncate font-medium text-ink-900">{report.titolo}</h3>
                <Badge tone="muted" className="shrink-0">
                  {ETICHETTA_TIPO[report.attivitaTipo]}
                </Badge>
              </div>
              <p className="mt-2 line-clamp-2 whitespace-pre-wrap text-[13px] text-ink-500">
                {report.descrizione || "Report ancora da scrivere."}
              </p>
              <p className="mt-3 text-[11px] uppercase tracking-wide text-ink-300">
                {report.attivitaTitolo} · {dataLunga(report.attivitaInizio)}
              </p>
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
        open={foglio === "attivita"}
        onClose={() => setFoglio(null)}
        title={tipo === "chiamata" ? "Nuova chiamata" : "Nuovo appuntamento"}
        description={`Collegata a ${nomeAzienda(azienda)}. Se Google Calendar è collegato, viene pubblicata appena la salvi.`}
      >
        <AttivitaForm
          aziendaIdIniziale={azienda.id}
          tipoIniziale={tipo}
          onSaved={() => setFoglio(null)}
          onCancel={() => setFoglio(null)}
        />
      </Sheet>

      <Sheet
        open={dettaglio !== null}
        onClose={() => setAttivitaAperta(null)}
        title={dettaglio?.attivita.titolo ?? "Attività"}
        description={dettaglio ? dettaglio.attivita.aziendaRagioneSociale : undefined}
      >
        {dettaglio ? (
          <DettaglioAttivita
            key={dettaglio.chiave}
            attivita={dettaglio.attivita}
            onChiudi={() => setAttivitaAperta(null)}
            onModificata={() => setRiga((n) => n + 1)}
          />
        ) : null}
      </Sheet>
    </div>
  );
}
