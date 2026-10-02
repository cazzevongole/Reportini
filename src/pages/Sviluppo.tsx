import { useCallback, useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { Badge, Button, EmptyState, PageHeader, Stat, Textarea } from "../components/ui";
import { CheckIcon, MessageIcon, RotateIcon, TrashIcon } from "../components/icons";
import { useAvvisi } from "../components/Avvisi";
import { relativo } from "../lib/date";
import {
  STATI,
  cambiaStato,
  cancellaRichiesta,
  elencaRichieste,
  etichettaStato,
  rispondi,
  verificaRuolo,
  visibili,
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

/**
 * Che cosa offre la pagina su una richiesta, per stato.
 *
 * Una riga per stato, con un solo bottone che cambia lo stato: è la
 * risposta alla domanda "come vanno usati i pulsanti?". Prima ce n'erano
 * quattro per richiesta e due scrivevano lo stesso campo, quindi l'ordine
 * in cui venivano premuti decideva se la risposta veniva salvata o persa.
 * Qui l'azione primaria porta con sé la risposta, e "Salva la risposta"
 * esiste solo per il caso in cui si vuole salvare senza cambiare stato.
 *
 * `risolvi` è diverso dagli altri due solo per l'icona: è l'unica azione
 * che chiude il lavoro, e renderla uguale alle altre la renderebbe
 * invisibile in una lista lunga.
 */
const AZIONI: Record<
  StatoRichiesta,
  { etichetta: string; stato: StatoRichiesta | null; primaria: "prendi" | "risolvi" | null }
> = {
  aperta: { etichetta: "Prendo in carico", stato: "in corso", primaria: "prendi" },
  "in corso": { etichetta: "Segna risolta", stato: "risolta", primaria: "risolvi" },
  risolta: { etichetta: "", stato: null, primaria: null },
};

export default function Sviluppo() {
  const { esegui } = useAvvisi();
  const [vista, setVista] = useState<Vista>("caricamento");
  const [problema, setProblema] = useState("");
  const [richieste, setRichieste] = useState<Richiesta[]>([]);
  const [filtro, setFiltro] = useState<StatoRichiesta | "tutte">("tutte");
  const [bozze, setBozze] = useState<Record<string, string>>({});
  // Quale richiesta ha il riquadro di conferma aperto: una stringa e non un
  // booleano, perché due richieste aperte insieme porterebbero a confermare
  // quella sbagliata con un bottone che dice "cancella" senza dire quale.
  const [daCancellare, setDaCancellare] = useState<string | null>(null);
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

  const testoRisposta = (richiesta: Richiesta) => bozze[richiesta.id] ?? richiesta.risposta ?? "";

  const cambia = useCallback(
    async (id: string, stato: StatoRichiesta, risposta?: string) => {
      setOccupato(true);
      // `esito` non viene confrontato con `null` per capire se è andata: le
      // tre operazioni ritornano `void`, quindi `esegui` restituisce
      // `undefined` anche quando riescono, e `if (!esito)` prendeva sempre
      // la via dell'errore. Il risultato era che la pagina non si
      // ricaricava e la richiesta restava con lo stato vecchio anche se il
      // database l'aveva cambiato — la metà delle volte in cui l'utente ha
      // premuto "Segna risolta" e non è successo niente. `=== null` è
      // l'unico valore che `esegui` restituisce quando l'azione è fallita.
      const esito = await esegui(
        async () => {
          await cambiaStato(id, stato);
          if (risposta !== undefined) await rispondi(id, risposta);
        },
        { successo: "Richiesta aggiornata" },
      );
      setOccupato(false);
      if (esito === null) return;
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

  // Le cancellate non compaiono in nessun gruppo, nemmeno nel conteggio: un
  // numero che include richieste che l'elenco sotto non mostra mente su
  // quello che conta.
  const attive = visibili(richieste);
  const filtrate = filtro === "tutte" ? attive : attive.filter((r) => r.stato === filtro);
  const conta = (stato: StatoRichiesta) => attive.filter((r) => r.stato === stato).length;
  const nascoste = richieste.length - attive.length;

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

      {nascoste > 0 ? (
        <p className="mt-3 text-sm text-ink-400">
          {nascoste === 1
            ? "Una richiesta è nascosta e non compare qui."
            : `${nascoste} richieste sono nascoste e non compaiono qui.`}{" "}
          Sono ancora nel database: si recupera annullando la cancellazione.
        </p>
      ) : null}

      <div className="mt-4 inline-flex flex-wrap rounded-xl border border-ink-200 p-1">
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

      {filtrate.length === 0 ? (
        <EmptyState
          icon={<MessageIcon className="h-7 w-7" />}
          title="Nessuna richiesta qui"
          description="Quando qualcuno scrive dalla sezione «Chiedilo allo sviluppatore», la richiesta arriva qui."
        />
      ) : (
        <ul className="flex flex-col gap-3">
          {filtrate.map((richiesta) => (
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

              {/* Un'azione sola per stato, e dice cosa succede.
                  Prima erano quattro pulsanti e due facevano cose che si
                  sovrapponevano: "Segna risolta" e "Salva la risposta"
                  scrivevano entrambi lo stesso campo, e quello che restava
                  premendo per primo decideva se la risposta appena scritta
                  veniva salvata o persa. Qui la risposta si scrive una
                  volta e l'azione la porta con sé, quindi non c'è un ordine
                  giusto da indovinare. */}
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {AZIONI[richiesta.stato].primaria ? (
                  <Button
                    size="sm"
                    disabled={occupato}
                    onClick={() =>
                      void cambia(
                        richiesta.id,
                        AZIONI[richiesta.stato].stato!,
                        testoRisposta(richiesta),
                      )
                    }
                  >
                    {AZIONI[richiesta.stato].primaria === "risolvi" ? (
                      <CheckIcon className="h-4 w-4" />
                    ) : null}
                    {AZIONI[richiesta.stato].etichetta}
                  </Button>
                ) : null}
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={occupato}
                  onClick={() =>
                    void cambia(richiesta.id, richiesta.stato, testoRisposta(richiesta))
                  }
                >
                  Salva la risposta
                </Button>
                {richiesta.stato === "risolta" ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={occupato}
                    onClick={() => void cambia(richiesta.id, "aperta", testoRisposta(richiesta))}
                  >
                    Riapri
                  </Button>
                ) : null}
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={occupato}
                  onClick={() => setDaCancellare(richiesta.id)}
                >
                  <TrashIcon className="h-4 w-4" />
                  Cancella
                </Button>
              </div>

              {daCancellare === richiesta.id ? (
                <div className="mt-3 rounded-xl border border-clay-200 bg-clay-50 p-3 text-sm text-clay-900">
                  <p>
                    Nascondere questa richiesta dagli elenchi? Non sparisce: resta nel database con
                    la risposta, e si può recuperare.
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button
                      variant="danger"
                      disabled={occupato}
                      onClick={() => {
                        setOccupato(true);
                        void esegui(() => cancellaRichiesta(richiesta.id), {
                          successo: "Richiesta nascosta",
                          errore: "Cancellazione non riuscita",
                        }).then((esito) => {
                          setOccupato(false);
                          if (esito === null) return;
                          setDaCancellare(null);
                          return carica();
                        });
                      }}
                    >
                      Sì, nascondila
                    </Button>
                    <Button variant="ghost" onClick={() => setDaCancellare(null)}>
                      Annulla
                    </Button>
                  </div>
                </div>
              ) : null}

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
