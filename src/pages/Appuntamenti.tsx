import { useState } from "react";
import AppuntamentoForm from "../components/AppuntamentoForm";
import {
  CalendarIcon,
  CheckIcon,
  ClockIcon,
  DownloadIcon,
  EditIcon,
  ExternalLinkIcon,
  MapPinIcon,
  PlusIcon,
  TrashIcon,
} from "../components/icons";
import { Badge, Button, EmptyState, PageHeader, Sheet } from "../components/ui";
import { useAvvisi } from "../components/Avvisi";
import { useLiveQuery } from "../hooks/useLiveQuery";
import { dataLunga, giornoISO, durata, ora, relativo } from "../lib/date";
import { isConnected } from "../lib/google/auth";
import { scaricaIcs } from "../lib/google/calendar";
import {
  dissociaAppuntamento,
  eliminaAppuntamentoEEvento,
  sincronizzaAppuntamento,
} from "../lib/google/sync";
import { elencaAppuntamenti } from "../lib/repo";
import type { Appuntamento, AppuntamentoDettagliato, StatoAppuntamento } from "../lib/types";

const FILTRI: Array<{ valore: StatoAppuntamento | "tutti" | "prossimi"; etichetta: string }> = [
  { valore: "prossimi", etichetta: "Prossimi" },
  { valore: "tutti", etichetta: "Tutti" },
  { valore: "in-attesa", etichetta: "In attesa" },
  { valore: "confermato", etichetta: "Confermati" },
  { valore: "annullato", etichetta: "Annullati" },
];

const TONO: Record<StatoAppuntamento, "neutral" | "brand" | "clay" | "muted"> = {
  "in-attesa": "clay",
  confermato: "brand",
  annullato: "muted",
};

export default function Appuntamenti() {
  const [filtro, setFiltro] = useState<StatoAppuntamento | "tutti" | "prossimi">("prossimi");
  const [aperto, setAperto] = useState(false);
  const [inModifica, setInModifica] = useState<Appuntamento | null>(null);
  const { notifica, esegui } = useAvvisi();
  const googlePronto = isConnected();

  const appuntamenti = useLiveQuery(() => {
    const tutti = elencaAppuntamenti();
    if (filtro === "tutti") return tutti;
    if (filtro === "prossimi") {
      const adesso = new Date().toISOString();
      return tutti.filter((a) => a.inizio >= adesso && a.stato !== "annullato");
    }
    return tutti.filter((a) => a.stato === filtro);
  }, [filtro]);

  const perGiorno = appuntamenti.reduce<Record<string, AppuntamentoDettagliato[]>>(
    (acc, appuntamento) => {
      const chiave = giornoISO(new Date(appuntamento.inizio));
      acc[chiave] = acc[chiave] ?? [];
      acc[chiave].push(appuntamento);
      return acc;
    },
    {},
  );

  function apriNuovo() {
    setInModifica(null);
    setAperto(true);
  }

  async function sincronizza(appuntamento: Appuntamento) {
    notifica("info", `Sincronizzo “${appuntamento.titolo}” con Google Calendar…`);
    // Come nel modulo: queste funzioni non sollevano, ritornano `{ ok: false }`.
    // Passarle a `esegui` con `successo` mostrava il fallimento come un avviso
    // verde: verde e con dentro la frase dell'errore.
    const esito = await esegui(() => sincronizzaAppuntamento(appuntamento.id), {
      errore: "Sincronizzazione con Google Calendar non riuscita",
    });
    if (esito?.ok) notifica("ok", esito.messaggio);
    else if (esito) notifica("errore", esito.messaggio);
  }

  async function dissocia(appuntamento: Appuntamento) {
    const esito = await esegui(() => dissociaAppuntamento(appuntamento.id), {
      errore: "Scollegamento dall'evento non riuscito",
    });
    if (esito?.ok) notifica("ok", esito.messaggio);
    else if (esito) notifica("errore", esito.messaggio);
  }

  async function elimina(appuntamento: Appuntamento) {
    if (!confirm(`Eliminare l'appuntamento “${appuntamento.titolo}”?`)) return;
    notifica("info", "Elimino l'appuntamento…");
    await esegui(() => eliminaAppuntamentoEEvento(appuntamento.id), {
      successo: (r) => r.messaggio,
      errore: "Eliminazione non riuscita",
    });
  }

  return (
    <div>
      <PageHeader
        title="Appuntamenti"
        subtitle={`${appuntamenti.length} ${appuntamenti.length === 1 ? "appuntamento" : "appuntamenti"} in questa vista`}
        action={
          <Button onClick={apriNuovo} className="hidden sm:inline-flex">
            <PlusIcon className="h-4 w-4" />
            Nuovo
          </Button>
        }
      />

      <div className="mb-4 flex gap-1.5 overflow-x-auto pb-1">
        {FILTRI.map((voce) => (
          <button
            key={voce.valore}
            type="button"
            onClick={() => setFiltro(voce.valore)}
            className={`shrink-0 rounded-full px-3.5 py-1.5 text-[13px] font-medium transition-colors ${
              filtro === voce.valore
                ? "bg-ink-950 text-white"
                : "border border-ink-200 bg-white text-ink-500 hover:border-ink-300"
            }`}
          >
            {voce.etichetta}
          </button>
        ))}
      </div>

      {appuntamenti.length === 0 ? (
        <EmptyState
          icon={<CalendarIcon className="h-9 w-9" />}
          title="Nessun appuntamento in questa vista"
          description="Fissa un appuntamento: se Google Calendar è collegato lo pubblichi senza pensarci."
          action={
            <Button onClick={apriNuovo}>
              <PlusIcon className="h-4 w-4" />
              Nuovo appuntamento
            </Button>
          }
        />
      ) : (
        <div className="space-y-6">
          {Object.entries(perGiorno).map(([giorno, lista]) => (
            <section key={giorno}>
              <h2 className="mb-2 flex items-baseline gap-2 text-[13px] font-semibold uppercase tracking-[0.12em] text-ink-400">
                {dataLunga(lista[0].inizio)}
                <span className="text-[11px] font-normal normal-case tracking-normal text-ink-300">
                  {relativo(lista[0].inizio)}
                </span>
              </h2>
              <ul className="space-y-2.5">
                {lista.map((appuntamento) => (
                  <li
                    key={appuntamento.id}
                    className={`card p-4 ${appuntamento.stato === "annullato" ? "opacity-60" : ""}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-display text-2xl leading-none text-ink-950">
                          {ora(appuntamento.inizio)}
                        </p>
                        <h3 className="mt-1.5 truncate font-medium text-ink-900">
                          {appuntamento.titolo}
                        </h3>
                        {appuntamento.anagraficoNome ? (
                          <p className="mt-0.5 truncate text-xs text-ink-400">
                            {appuntamento.anagraficoNome} {appuntamento.anagraficoCognome}
                            {appuntamento.relazioneTitolo
                              ? ` · ${appuntamento.relazioneTitolo}`
                              : ""}
                          </p>
                        ) : null}
                      </div>
                      <Badge tone={TONO[appuntamento.stato]} className="shrink-0">
                        {appuntamento.stato}
                      </Badge>
                    </div>

                    <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-400">
                      <span className="inline-flex items-center gap-1.5">
                        <ClockIcon className="h-3.5 w-3.5" />
                        {durata(appuntamento.inizio, appuntamento.fine)}
                      </span>
                      {appuntamento.luogo ? (
                        <span className="inline-flex items-center gap-1.5">
                          <MapPinIcon className="h-3.5 w-3.5" />
                          {appuntamento.luogo}
                        </span>
                      ) : null}
                    </div>

                    {appuntamento.googleErrore ? (
                      // La ragione del fallimento sta qui, non in un avviso: un
                      // avviso sparisce in pochi secondi e al riavvio non
                      // resta niente, quindi un appuntamento mai finito in
                      // agenda sembrava uno a posto.
                      <div className="mt-3 rounded-xl bg-clay-50 px-3 py-2 text-xs leading-relaxed text-clay-900">
                        <p className="font-semibold">Non pubblicato su Google Calendar</p>
                        <p className="mt-0.5 break-words">{appuntamento.googleErrore}</p>
                        <p className="mt-1 text-clay-700">
                          Il pulsato “Invia a Google” qui sotto riprova senza perdere quello che hai
                          scritto.
                        </p>
                      </div>
                    ) : null}

                    <div className="mt-4 flex flex-wrap items-center gap-1.5 border-t border-ink-100 pt-3">
                      {googlePronto ? (
                        <Button
                          size="sm"
                          variant={appuntamento.googleEventId ? "secondary" : "primary"}
                          // Il pulsante è anche l'unico modo di togliere il
                          // collegamento a mano: premendolo su un appuntamento
                          // già pubblicato, l'evento viene cancellato da Google.
                          // Annullare l'appuntamento, invece, lo segna annullato.
                          title={
                            appuntamento.googleEventId
                              ? "Scollega l'evento da Google Calendar"
                              : "Invia a Google Calendar"
                          }
                          onClick={() =>
                            appuntamento.googleEventId
                              ? dissocia(appuntamento)
                              : sincronizza(appuntamento)
                          }
                        >
                          {appuntamento.googleEventId ? (
                            <>
                              <CheckIcon className="h-4 w-4" />
                              Su Google
                            </>
                          ) : (
                            "Invia a Google"
                          )}
                        </Button>
                      ) : null}
                      {appuntamento.googleHtmlLink ? (
                        <a
                          href={appuntamento.googleHtmlLink}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-medium text-ink-500 transition-colors hover:bg-ink-100"
                        >
                          <ExternalLinkIcon className="h-4 w-4" />
                          Apri
                        </a>
                      ) : null}
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          scaricaIcs(appuntamento);
                          notifica("ok", `File .ics di “${appuntamento.titolo}” scaricato`);
                        }}
                      >
                        <DownloadIcon className="h-4 w-4" />
                        .ics
                      </Button>
                      <span className="flex-1" />
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setInModifica(appuntamento);
                          setAperto(true);
                        }}
                      >
                        <EditIcon className="h-4 w-4" />
                        Modifica
                      </Button>
                      <Button size="sm" variant="danger" onClick={() => elimina(appuntamento)}>
                        <TrashIcon className="h-4 w-4" />
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      <button
        type="button"
        onClick={apriNuovo}
        aria-label="Nuovo appuntamento"
        className="fixed bottom-24 right-5 z-30 grid h-14 w-14 place-items-center rounded-2xl bg-ink-950 text-white shadow-lift transition-transform active:scale-95 sm:hidden"
      >
        <PlusIcon className="h-6 w-6" />
      </button>

      <Sheet
        open={aperto}
        onClose={() => setAperto(false)}
        title={inModifica ? "Modifica appuntamento" : "Nuovo appuntamento"}
        description="Con Google Calendar collegato l'appuntamento viene pubblicato appena lo salvi."
      >
        <AppuntamentoForm
          appuntamento={inModifica}
          onSaved={() => setAperto(false)}
          onCancel={() => setAperto(false)}
        />
      </Sheet>
    </div>
  );
}
