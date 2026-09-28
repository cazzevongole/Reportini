import { useCallback, useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { Badge, Button, EmptyState, PageHeader, Stat, Textarea } from "../components/ui";
import { CheckIcon, MessageIcon, RotateIcon } from "../components/icons";
import { useAvvisi } from "../components/Avvisi";
import { relativo } from "../lib/date";
import {
  STATI,
  cambiaStato,
  elencaRichieste,
  etichettaStato,
  rispondi,
  verificaRuolo,
  type Richiesta,
  type StatoRichiesta,
} from "../lib/sviluppo/richieste";

/**
 * Sezione nascosta dello sviluppatore.
 *
 * Non è una pagina con un avviso "non sei autorizzato": prima di disegnare
 * qualcosa chiede al database chi è. Chi non è sviluppatore viene rimandato
 * al pannello, e soprattutto non arriva mai a vedere le richieste degli
 * altri, perché la RLS le filtra prima che escano dal server.
 *
 * Chi è sviluppatore sta nella tabella `sviluppatori`, non in una variabile
 * d'ambiente: nel bundle pubblico finirebbe, e chiunque potrebbe aggiungersi.
 */
type Vista = "caricamento" | "sviluppatore" | "utente" | "errore";

const FILTRI: { valore: StatoRichiesta | "tutte"; etichetta: string }[] = [
  { valore: "tutte", etichetta: "Tutte" },
  ...STATI.map((s) => ({ valore: s.valore, etichetta: s.etichetta })),
];

export default function Sviluppo() {
  const { esegui } = useAvvisi();
  const [vista, setVista] = useState<Vista>("caricamento");
  const [problema, setProblema] = useState("");
  const [richieste, setRichieste] = useState<Richiesta[]>([]);
  const [filtro, setFiltro] = useState<StatoRichiesta | "tutte">("tutte");
  const [bozze, setBozze] = useState<Record<string, string>>({});
  const [occupato, setOccupato] = useState(false);

  const carica = useCallback(async () => {
    try {
      setRichieste(await elencaRichieste());
    } catch (causa) {
      setRichieste([]);
      setProblema(causa instanceof Error ? causa.message : "Richieste non disponibili");
    }
  }, []);

  useEffect(() => {
    let vivo = true;
    verificaRuolo()
      .then((esito) => {
        if (!vivo) return;
        if (esito.ruolo === "errore") {
          setProblema(esito.messaggio);
          setVista("errore");
          return;
        }
        setVista(esito.ruolo === "sviluppatore" ? "sviluppatore" : "utente");
        if (esito.ruolo === "sviluppatore") void carica();
      })
      .catch((causa: unknown) => {
        if (!vivo) return;
        setProblema(causa instanceof Error ? causa.message : "Verifica non riuscita");
        setVista("errore");
      });
    return () => {
      vivo = false;
    };
  }, [carica]);

  const testoRisposta = (richiesta: Richiesta) =>
    bozze[richiesta.id] ?? richiesta.risposta ?? "";

  const cambia = useCallback(
    async (id: string, stato: StatoRichiesta, risposta?: string) => {
      setOccupato(true);
      const esito = await esegui(async () => {
        await cambiaStato(id, stato);
        if (risposta !== undefined) await rispondi(id, risposta);
      }, { successo: "Richiesta aggiornata" });
      setOccupato(false);
      if (!esito) return;
      await carica();
    },
    [carica, esegui],
  );

  if (vista === "utente") return <Navigate to="/panel" replace />;

  if (vista === "errore") {
    return (
      <div>
        <PageHeader title="Sviluppo" subtitle="Questa sezione non è disponibile" />
        <p className="card p-5 text-sm text-ink-500">{problema}</p>
      </div>
    );
  }

  if (vista === "caricamento") {
    return (
      <div className="card flex items-center gap-3 p-5 text-sm text-ink-400">
        <div className="h-4 w-4 animate-spin rounded-full border-2 border-ink-100 border-t-brand-500" />
        Controllo chi sei…
      </div>
    );
  }

  const visibili = filtro === "tutte" ? richieste : richieste.filter((r) => r.stato === filtro);
  const conta = (stato: StatoRichiesta) => richieste.filter((r) => r.stato === stato).length;

  return (
    <div>
      <PageHeader
        title="Richieste degli utenti"
        subtitle="Solo tu le vedi: la sezione non è nella barra e il database non le consegna agli altri."
        action={
          <Button variant="secondary" onClick={() => void carica()}>
            <RotateIcon className="h-4 w-4" />
            Aggiorna
          </Button>
        }
      />

      <div className="mb-5 grid grid-cols-3 gap-3">
        <Stat label="Da leggere" value={conta("aperta")} />
        <Stat label="In corso" value={conta("in corso")} />
        <Stat label="Risolte" value={conta("risolta")} />
      </div>

      <div className="mb-4 inline-flex flex-wrap rounded-xl border border-ink-200 p-1">
        {FILTRI.map((f) => (
          <button
            key={f.valore}
            type="button"
            aria-pressed={filtro === f.valore}
            onClick={() => setFiltro(f.valore)}
            className={`rounded-lg px-3 py-1.5 text-[13px] font-medium transition-colors ${
              filtro === f.valore ? "bg-ink-950 text-white" : "text-ink-500 hover:text-ink-900"
            }`}
          >
            {f.etichetta}
          </button>
        ))}
      </div>

      {visibili.length === 0 ? (
        <EmptyState
          icon={<MessageIcon className="h-7 w-7" />}
          title="Nessuna richiesta qui"
          description="Quando qualcuno scrive dalla sezione «Chiedilo allo sviluppatore», la richiesta arriva qui."
        />
      ) : (
        <ul className="flex flex-col gap-3">
          {visibili.map((richiesta) => (
            <li key={richiesta.id} className="card p-4">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={richiesta.tipo === "fix" ? "clay" : "brand"}>
                  {richiesta.tipo === "fix" ? "Fix" : "Funzionalità"}
                </Badge>
                <Badge tone={richiesta.stato === "risolta" ? "muted" : "neutral"}>
                  {etichettaStato(richiesta.stato)}
                </Badge>
                <span className="text-xs text-ink-400">{relativo(richiesta.createdAt)}</span>
                <span className="truncate text-xs text-ink-400">{richiesta.email}</span>
              </div>

              <h3 className="mt-2 text-[15px] font-medium text-ink-900">{richiesta.titolo}</h3>
              <p className="mt-1 whitespace-pre-wrap text-sm text-ink-500">{richiesta.corpo}</p>

              <div className="mt-3 flex flex-wrap gap-2">
                {richiesta.stato !== "in corso" ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={occupato}
                    onClick={() => void cambia(richiesta.id, "in corso", testoRisposta(richiesta))}
                  >
                    Prendo in carico
                  </Button>
                ) : null}
                {richiesta.stato !== "risolta" ? (
                  <Button
                    size="sm"
                    disabled={occupato}
                    onClick={() => void cambia(richiesta.id, "risolta", testoRisposta(richiesta))}
                  >
                    <CheckIcon className="h-4 w-4" />
                    Segna risolta
                  </Button>
                ) : null}
                {richiesta.stato === "risolta" ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={occupato}
                    onClick={() => void cambia(richiesta.id, "aperta", testoRisposta(richiesta))}
                  >
                    Riapri
                  </Button>
                ) : null}
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={occupato}
                  onClick={() =>
                    void cambia(richiesta.id, richiesta.stato, testoRisposta(richiesta))
                  }
                >
                  Salva la risposta
                </Button>
              </div>

              <div className="mt-3">
                <label className="field-label" htmlFor={`risposta-${richiesta.id}`}>
                  Risposta all'utente
                </label>
                <Textarea
                  id={`risposta-${richiesta.id}`}
                  rows={3}
                  value={testoRisposta(richiesta)}
                  onChange={(evento) =>
                    setBozze((precedenti) => ({
                      ...precedenti,
                      [richiesta.id]: evento.target.value,
                    }))
                  }
                  placeholder="Cosa hai fatto, o cosa hai deciso di fare. L'utente la vede nella sua sezione."
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
