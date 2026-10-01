import { useCallback, useEffect, useState } from "react";
import { Badge, Button, Card, Field, Input, Textarea } from "./ui";
import { MessageIcon, RotateIcon, SendIcon } from "./icons";
import { useAvvisi } from "./Avvisi";
import { relativo } from "../lib/date";
import {
  LIMITE_CORPO,
  LIMITE_TITOLO,
  TIPI,
  elencaRichieste,
  etichettaStato,
  inviaRichiesta,
  servizioAttivo,
  type Richiesta,
  type StatoRichiesta,
  type TipoRichiesta,
} from "../lib/sviluppo/richieste";

/**
 * Chiedilo allo sviluppatore.
 *
 * Un modulo e l'elenco di quello che è già stato chiesto, con la risposta
 * quando arriva. L'utente non deve tenere traccia delle richieste in un
 * documento a parte: la parte che conta è vedere se qualcuno l'ha letta.
 *
 * Nella versione web l'elenco contiene solo le richieste di chi sta guardando:
 * non è un filtro dell'app, è la RLS che scarta le altre prima che arrivino
 * qui.
 */

const TONE_STATO: Record<StatoRichiesta, "brand" | "clay" | "muted"> = {
  aperta: "clay",
  "in corso": "brand",
  risolta: "muted",
};

function RichiestaCard({
  richiesta,
  mostraEmail,
}: {
  richiesta: Richiesta;
  mostraEmail?: boolean;
}) {
  return (
    <li className="rounded-xl border border-ink-100 p-3.5">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={richiesta.tipo === "fix" ? "clay" : "brand"}>
          {richiesta.tipo === "fix" ? "Fix" : "Funzionalità"}
        </Badge>
        <Badge tone={TONE_STATO[richiesta.stato]}>{etichettaStato(richiesta.stato)}</Badge>
        <span className="text-xs text-ink-400">{relativo(richiesta.createdAt)}</span>
        {mostraEmail ? (
          <span className="truncate text-xs text-ink-400">{richiesta.email}</span>
        ) : null}
      </div>
      <p className="mt-2 text-sm font-medium text-ink-900">{richiesta.titolo}</p>
      <p className="mt-1 whitespace-pre-wrap text-sm text-ink-500">{richiesta.corpo}</p>
      {richiesta.risposta ? (
        <p className="mt-3 rounded-lg border-l-2 border-brand-300 bg-brand-50 px-3 py-2 text-sm text-brand-900">
          {richiesta.risposta}
        </p>
      ) : null}
    </li>
  );
}

export default function ChiediloAlloSviluppatore() {
  const { esegui } = useAvvisi();
  const [tipo, setTipo] = useState<TipoRichiesta>("fix");
  const [titolo, setTitolo] = useState("");
  const [corpo, setCorpo] = useState("");
  const [occupato, setOccupato] = useState(false);
  const [elenco, setElenco] = useState<Richiesta[]>([]);
  const [problema, setProblema] = useState<string | null>(null);

  const carica = useCallback(async () => {
    try {
      // Solo le proprie, anche per chi è lo sviluppatore: qui l'intestazione
      // dice "le tue richieste" e deve essere vero.
      setElenco(await elencaRichieste(true));
      setProblema(null);
    } catch (causa) {
      setElenco([]);
      setProblema(causa instanceof Error ? causa.message : "Richieste non disponibili");
    }
  }, []);

  useEffect(() => {
    void carica();
  }, [carica]);

  const invia = useCallback(async () => {
    setOccupato(true);
    const esito = await esegui(() => inviaRichiesta(tipo, titolo, corpo), {
      successo: "Richiesta inviata. Lo sviluppatore la vedrà nella sua sezione.",
      errore: "Richiesta non inviata",
    });
    setOccupato(false);
    if (!esito) return;
    setTitolo("");
    setCorpo("");
    await carica();
  }, [corpo, esegui, titolo, tipo, carica]);

  if (!servizioAttivo()) {
    return (
      <section className="mb-8">
        <Card className="p-5">
          <h2 className="text-lg">Chiedilo allo sviluppatore</h2>
          <p className="mt-1.5 text-sm text-ink-500">
            Le richieste viaggiano su Supabase. Senza un account collegato non c'è dove scriverle.
          </p>
        </Card>
      </section>
    );
  }

  return (
    <section className="mb-8">
      <Card className="p-5">
        <h2 className="flex items-center gap-2 text-lg">
          <MessageIcon className="h-5 w-5 text-brand-600" />
          Chiedilo allo sviluppatore
        </h2>
        <p className="mt-1.5 text-sm text-ink-500">
          Qualcosa non va, o manca un passaggio che ti servirebbe? Scrivilo qui: arriva direttamente
          allo sviluppatore, e sotto vedi cosa è già stato chiesto e se ha risposto.
        </p>

        {problema ? (
          <p className="mt-4 rounded-xl border border-clay-200 bg-clay-50 px-3.5 py-3 text-sm text-clay-800">
            {problema}
          </p>
        ) : null}

        <form
          className="mt-4 flex flex-col gap-3"
          onSubmit={(evento) => {
            evento.preventDefault();
            void invia();
          }}
        >
          <div className="inline-flex w-fit rounded-xl border border-ink-200 p-1">
            {TIPI.map((opzione) => (
              <button
                key={opzione.valore}
                type="button"
                aria-pressed={tipo === opzione.valore}
                onClick={() => setTipo(opzione.valore)}
                className={`rounded-lg px-3 py-1.5 text-[13px] font-medium transition-colors ${
                  tipo === opzione.valore
                    ? "bg-ink-950 text-white"
                    : "text-ink-500 hover:text-ink-900"
                }`}
              >
                {opzione.etichetta}
              </button>
            ))}
          </div>

          <Field label="Titolo" hint={`Massimo ${LIMITE_TITOLO} caratteri`}>
            <Input
              value={titolo}
              maxLength={LIMITE_TITOLO}
              onChange={(evento) => setTitolo(evento.target.value)}
              placeholder="Es. la report non si salva se chiudo a metà"
            />
          </Field>

          <Field
            label="Che cosa è successo"
            hint={`Massimo ${LIMITE_CORPO} caratteri. Più dettagli ci dai, meno ti chiedo indietro`}
          >
            <Textarea
              value={corpo}
              maxLength={LIMITE_CORPO}
              rows={4}
              onChange={(evento) => setCorpo(evento.target.value)}
              placeholder="Cosa hai fatto, cosa ti aspettavi, cosa è successo davvero."
            />
          </Field>

          <div>
            <Button type="submit" disabled={occupato}>
              <SendIcon className="h-4 w-4" />
              {occupato ? "Invio…" : "Invia allo sviluppatore"}
            </Button>
          </div>
        </form>

        <div className="mt-6 flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-ink-400">
            Le tue richieste
          </h3>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void carica()}
            aria-label="Ricarica le richieste"
          >
            <RotateIcon className="h-3.5 w-3.5" />
            Aggiorna
          </Button>
        </div>

        {elenco.length === 0 ? (
          <p className="mt-2 text-sm text-ink-400">
            Non hai ancora scritto niente. Quando lo fai, la richiesta resta qui e puoi seguire
            quello che succede.
          </p>
        ) : (
          <ul className="mt-2 flex flex-col gap-2.5">
            {elenco.map((richiesta) => (
              <RichiestaCard key={richiesta.id} richiesta={richiesta} />
            ))}
          </ul>
        )}
      </Card>
    </section>
  );
}
