import { useState } from "react";
import AttivitaForm from "../components/AttivitaForm";
import {
  CalendarIcon,
  CheckIcon,
  ClockIcon,
  DownloadIcon,
  EditIcon,
  ExternalLinkIcon,
  MapPinIcon,
  PhoneIcon,
  PlusIcon,
  TrashIcon,
} from "../components/icons";
import { Badge, Button, EmptyState, PageHeader, Sheet } from "../components/ui";
import BadgeStato from "../components/BadgeStato";
import { useAvvisi } from "../components/Avvisi";
import { useLiveQuery } from "../hooks/useLiveQuery";
import { dataLunga, giornoISO, durata, ora, relativo } from "../lib/date";
import { isConnected } from "../lib/google/auth";
import { scaricaIcs } from "../lib/google/calendar";
import { dissociaAttivita, eliminaAttivitaEEvento, sincronizzaAttivita } from "../lib/google/sync";
import { daFare, elencaAttivita, ottieniAttivita } from "../lib/repo";
import { ETICHETTA_TIPO, type AttivitaDettagliata, type TipoAttivita } from "../lib/types";

/**
 * I filtri della lista.
 *
 * Non c'è "confermati": un appuntamento si conferma, una chiamata si fa, e
 * un filtro con una parola che vale solo per uno dei due mostrerebbe metà
 * delle cose. "Da fare" è la domanda che l'utente si fa davvero, ed è la
 * stessa del riepilogo: non è ancora fatta **e** non annullata.
 */
const FILTRI: Array<{ valore: Filtro; etichetta: string }> = [
  { valore: "prossimi", etichetta: "Prossimi" },
  { valore: "tutti", etichetta: "Tutti" },
  { valore: "da-fare", etichetta: "Da fare" },
  { valore: "annullate", etichetta: "Annullate" },
];

type Filtro = "tutti" | "prossimi" | "da-fare" | "annullate";

function PaginaAttivita() {
  const [filtro, setFiltro] = useState<Filtro>("prossimi");
  const [aperto, setAperto] = useState(false);
  // Il modulo di modifica vuole la riga con il contesto dell'azienda, quindi
  // non basta la riga della lista: si rilegge dal database per id.
  const [inModifica, setInModifica] = useState<number | null>(null);
  // Il tipo arriva dal bottone premuto, non da una scelta dentro il modulo:
  // qui si crea un appuntamento o si registra una chiamata, e sono due azioni.
  const [tipo, setTipo] = useState<TipoAttivita>("appuntamento");
  const { notifica, esegui } = useAvvisi();
  const googlePronto = isConnected();

  const attivita = useLiveQuery(() => {
    const tutti = elencaAttivita();
    if (filtro === "tutti") return tutti;
    if (filtro === "prossimi") {
      const adesso = new Date().toISOString();
      return tutti.filter((a) => a.inizio >= adesso && a.stato !== "annullato");
    }
    if (filtro === "da-fare") return daFare();
    return tutti.filter((a) => a.stato === "annullato");
  }, [filtro]);

  const perGiorno = attivita.reduce<Record<string, AttivitaDettagliata[]>>((acc, attivita) => {
    const chiave = giornoISO(new Date(attivita.inizio));
    acc[chiave] = acc[chiave] ?? [];
    acc[chiave].push(attivita);
    return acc;
  }, {});

  function apriNuovo(scelto: TipoAttivita = "appuntamento") {
    setInModifica(null);
    setTipo(scelto);
    setAperto(true);
  }

  async function sincronizza(attivita: AttivitaDettagliata) {
    notifica("info", `Sincronizzo “${attivita.titolo}” con Google Calendar…`);
    // Come nel modulo: queste funzioni non sollevano, ritornano `{ ok: false }`.
    // Passarle a `esegui` con `successo` mostrava il fallimento come un avviso
    // verde: verde e con dentro la frase dell'errore.
    const esito = await esegui(() => sincronizzaAttivita(attivita.id), {
      errore: "Sincronizzazione con Google Calendar non riuscita",
    });
    if (esito?.ok) notifica("ok", esito.messaggio);
    else if (esito) notifica("errore", esito.messaggio);
  }

  async function dissocia(attivita: AttivitaDettagliata) {
    const esito = await esegui(() => dissociaAttivita(attivita.id), {
      errore: "Scollegamento dall'evento non riuscito",
    });
    if (esito?.ok) notifica("ok", esito.messaggio);
    else if (esito) notifica("errore", esito.messaggio);
  }

  async function elimina(attivita: AttivitaDettagliata) {
    if (!confirm(`Eliminare l'attività “${attivita.titolo}”?`)) return;
    notifica("info", "Elimino l'attività…");
    await esegui(() => eliminaAttivitaEEvento(attivita.id), {
      successo: (r) => r.messaggio,
      errore: "Eliminazione non riuscita",
    });
  }

  return (
    <div>
      <PageHeader
        title="Attività"
        // "attività" è già singolare e plurale: la parola non cambia, e così un ternario
        // con due rami uguali insegnerebbe che la differenza esiste.
        subtitle={`${attivita.length} attività in questa vista`}
        action={
          <div className="hidden gap-2 sm:flex">
            <Button onClick={() => apriNuovo("appuntamento")}>
              <PlusIcon className="h-4 w-4" />
              Appuntamento
            </Button>
            <Button onClick={() => apriNuovo("chiamata")}>
              <PhoneIcon className="h-4 w-4" />
              Chiamata
            </Button>
          </div>
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

      {attivita.length === 0 ? (
        <EmptyState
          icon={<CalendarIcon className="h-9 w-9" />}
          title="Nessuna attività in questa vista"
          description="Fissa un'attività: se Google Calendar è collegato la pubblichi senza pensarci."
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <Button onClick={() => apriNuovo("appuntamento")}>
                <PlusIcon className="h-4 w-4" />
                Fissa un appuntamento
              </Button>
              <Button onClick={() => apriNuovo("chiamata")}>
                <PhoneIcon className="h-4 w-4" />
                Registra una chiamata
              </Button>
            </div>
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
                {lista.map((attivita) => (
                  <li
                    key={attivita.id}
                    className={`card p-4 ${attivita.stato === "annullato" ? "opacity-60" : ""}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-display text-2xl leading-none text-ink-950">
                          {ora(attivita.inizio)}
                        </p>
                        <h3 className="mt-1.5 truncate font-medium text-ink-900">
                          {attivita.titolo}
                        </h3>
                        {attivita.aziendaRagioneSociale ? (
                          <p className="mt-0.5 truncate text-xs text-ink-400">
                            {attivita.aziendaRagioneSociale}
                          </p>
                        ) : null}
                      </div>
                      {/* Il tipo è la parola che finisce nel titolo
                          dell'evento su Google Calendar: qui dice di che
                          attività si tratta senza aprire il calendario. */}
                      <div className="flex shrink-0 flex-col items-end gap-1.5">
                        <BadgeStato
                          tipo={attivita.tipo}
                          stato={attivita.stato}
                          completata={attivita.completata}
                        />
                        <Badge tone="muted">{ETICHETTA_TIPO[attivita.tipo]}</Badge>
                        {attivita.completata ? (
                          <span className="inline-flex items-center gap-1 text-[11px] text-brand-600">
                            <CheckIcon className="h-3 w-3" />
                            completata
                          </span>
                        ) : null}
                      </div>
                    </div>

                    {/* Una chiamata non ha durata né luogo: i due campi
                        non esistono, e mostrarli vuoti ogni volta insegnerebbe
                        all'utente che se li aspetta. */}
                    {attivita.tipo === "appuntamento" ? (
                      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-400">
                        <span className="inline-flex items-center gap-1.5">
                          <ClockIcon className="h-3.5 w-3.5" />
                          {durata(attivita.inizio, attivita.fine)}
                        </span>
                        {attivita.luogo ? (
                          <span className="inline-flex items-center gap-1.5">
                            <MapPinIcon className="h-3.5 w-3.5" />
                            {attivita.luogo}
                          </span>
                        ) : null}
                      </div>
                    ) : null}

                    {attivita.googleErrore ? (
                      // La ragione del fallimento sta qui, non in un avviso: un
                      // avviso sparisce in pochi secondi e al riavvio non
                      // resta niente, quindi un'attività mai finito in
                      // agenda sembrava uno a posto.
                      <div className="mt-3 rounded-xl bg-clay-50 px-3 py-2 text-xs leading-relaxed text-clay-900">
                        <p className="font-semibold">Non pubblicato su Google Calendar</p>
                        <p className="mt-0.5 break-words">{attivita.googleErrore}</p>
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
                          variant={attivita.googleEventId ? "secondary" : "primary"}
                          // Il pulsante è anche l'unico modo di togliere il
                          // collegamento a mano: premendolo su un attivita
                          // già pubblicato, l'evento viene cancellato da Google.
                          // Annullare l'attivita, invece, lo segna annullato.
                          title={
                            attivita.googleEventId
                              ? "Scollega l'evento da Google Calendar"
                              : "Invia a Google Calendar"
                          }
                          onClick={() =>
                            attivita.googleEventId ? dissocia(attivita) : sincronizza(attivita)
                          }
                        >
                          {attivita.googleEventId ? (
                            <>
                              <CheckIcon className="h-4 w-4" />
                              Su Google
                            </>
                          ) : (
                            "Invia a Google"
                          )}
                        </Button>
                      ) : null}
                      {attivita.googleHtmlLink ? (
                        <a
                          href={attivita.googleHtmlLink}
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
                          scaricaIcs(attivita);
                          notifica("ok", `File .ics di “${attivita.titolo}” scaricato`);
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
                          setInModifica(attivita.id);
                          setAperto(true);
                        }}
                      >
                        <EditIcon className="h-4 w-4" />
                        Modifica
                      </Button>
                      <Button size="sm" variant="danger" onClick={() => elimina(attivita)}>
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
        onClick={() => apriNuovo("appuntamento")}
        aria-label="Nuovo appuntamento"
        className="fixed bottom-24 right-5 z-30 grid h-14 w-14 place-items-center rounded-2xl bg-ink-950 text-white shadow-lift transition-transform active:scale-95 sm:hidden"
      >
        <PlusIcon className="h-6 w-6" />
      </button>

      <Sheet
        open={aperto}
        onClose={() => setAperto(false)}
        title={
          inModifica
            ? "Modifica attività"
            : tipo === "chiamata"
              ? "Nuova chiamata"
              : "Nuovo appuntamento"
        }
        description="Con Google Calendar collegato l'attività viene pubblicata appena la salvi."
      >
        <AttivitaForm
          attivita={inModifica ? (ottieniAttivita(inModifica) ?? undefined) : undefined}
          tipoIniziale={tipo}
          onSaved={() => setAperto(false)}
          onCancel={() => setAperto(false)}
        />
      </Sheet>
    </div>
  );
}

export default PaginaAttivita;
