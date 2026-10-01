import { useState, type FormEvent } from "react";
import { useAvvisi } from "./Avvisi";
import { aInputDateTime, aggiungiMinuti, daInputDateTime } from "../lib/date";
import { isConnected } from "../lib/google/auth";
import { pubblicaAttivita } from "../lib/google/sync";
import {
  aggiornaAttivita,
  creaAttivita,
  elencaAziende,
  nomeAzienda,
  type AttivitaInput,
} from "../lib/repo";
import {
  ETICHETTA_TIPO,
  fineAttivita,
  MINUTI_CHIAMATA,
  type AttivitaDettagliata,
  type StatoAttivita,
  type TipoAttivita,
} from "../lib/types";
import { Button, Checkbox, Field, Input, Select, Textarea } from "./ui";

const DURATE = [15, 30, 45, 60, 90];
const PROMEMORIE = [0, 10, 30, 60, 1440];

/**
 * Il modulo dell'attività, che è anche quello della chiamata.
 *
 * Sono la stessa entità e quindi lo stesso modulo: cambia il `tipo`, e il resto
 * è identico. Due moduli avrebbero finito per divergere — uno con una regola che
 * l'altro non aveva — ed è il difetto che l'unificazione voleva evitare.
 *
 * Il tipo **non si sceglie qui dentro**: arriva da `tipoIniziale`, cioè dal
 * bottone premuto per arrivare qui. «Fissa un appuntamento» e «Fai una
 * chiamata» sono due azioni diverse, e metterci dentro una casella da compilare
 * chiederebbe all'utente una cosa che ha già detto con il dito: ha premuto
 * «chiamata», non sta schedulando un appuntamento e scegliendo dopo che è una
 * chiamata.
 *
 * In modifica il tipo non si tocca: è la parola nel titolo dell'evento che
 * l'attività ha già pubblicato su Google Calendar, e cambiarla in silenzio
 * lascerebbe in agenda un evento con un nome diverso da quello che l'app
 * mostra.
 *
 * L'azienda è **obbligatoria**: è il contesto che rende il report leggibile e
 * il motivo per cui l'attività esiste. Un'attività senza azienda non potrebbe
 * generare un report, quindi qui si sceglie sempre a chi si parla.
 */
export default function AttivitaForm({
  attivita,
  aziendaIdIniziale,
  tipoIniziale = "appuntamento",
  onSaved,
  onCancel,
}: {
  attivita?: AttivitaDettagliata | null;
  aziendaIdIniziale?: number;
  tipoIniziale?: TipoAttivita;
  onSaved: (id: number) => void;
  onCancel: () => void;
}) {
  // Il tipo che verrà salvato: in creazione è quello dell'azione premuta, in
  // modifica è quello che l'attività aveva già.
  const tipo: TipoAttivita = attivita ? attivita.tipo : tipoIniziale;
  const aziende = elencaAziende();
  const [aziendaId, setAziendaId] = useState<number>(
    attivita ? attivita.aziendaId : (aziendaIdIniziale ?? aziende[0]?.id ?? 0),
  );
  const googlePronto = isConnected();
  const { notifica, esegui } = useAvvisi();
  const [errore, setErrore] = useState("");
  const [inCorso, setInCorso] = useState(false);
  // La pubblicazione è il comportamento normale, non un extra: la spunta
  // parte accesa e serve solo a chi la vuole disattivata per un'attività.
  const [pubblica, setPubblica] = useState(isConnected);

  const [form, setForm] = useState<AttivitaInput>(() => {
    if (attivita) {
      // La riga che arriva dal dettaglio porta anche ragione sociale e
      // partita iva, che sono campi dell'azienda: toglierli qui è quello che
      // tiene il modulo allineato alla tabella, senza doverli elencare uno a
      // uno. Il tipo è dichiarato qui perché è la destructuring a sapere
      // quali campi ci sono: senza, TypeScript li toglierebbe ma non
      // controllerebbe che il resto sia davvero un AttivitaInput.
      const {
        id: _id,
        createdAt: _c,
        updatedAt: _u,
        aziendaRagioneSociale: _r,
        aziendaPartitaIva: _p,
        ...resto
      }: AttivitaDettagliata = attivita;
      // Il resto è un Attivita per costruzione (sono spariti solo i campi
      // dell'id e dell'azienda), ma TypeScript non lo può sapere: dopo una
      // destructuring con tipo dichiarato perde il legame con l'interfaccia.
      return resto as AttivitaInput;
    }
    const inizio = aggiungiMinuti(new Date().toISOString(), 60);
    return {
      aziendaId: aziendaIdIniziale ?? aziende[0]?.id ?? 0,
      titolo: tipo === "chiamata" ? "Chiamata di sollecito" : "Appuntamento allo sportello",
      descrizione: "",
      tipo,
      inizio,
      fine: aggiungiMinuti(inizio, 30),
      luogo: "",
      stato: "in-attesa" as StatoAttivita,
      completata: false,
      promemoriaMin: 30,
      googleEventId: null,
      googleCalendarId: null,
      googleHtmlLink: null,
      googleSyncAt: null,
      // Un'attività nuova non ha ancora un motivo di fallimento: quello
      // arriva dalla pubblicazione, e la riga sparisce al primo successo.
      googleErrore: null,
    };
  });

  /**
   * Spuntare o togliere "chiamata fatta".
   *
   * Sul modulo la casella tocca solo `completata`: `stato` la deduce chi
   * salva, in `colonneChiamata()`, perché è la stessa informazione in due
   * colonne e due copie si sbagliano. Sull'appuntamento resta invece la
   * select, che è uno stato vero e proprio.
   */
  function cambiaCompletata(completata: boolean) {
    setForm((precedente) => ({ ...precedente, completata }));
  }

  function set<K extends keyof AttivitaInput>(chiave: K, valore: AttivitaInput[K]) {
    setForm((precedente) => ({ ...precedente, [chiave]: valore }));
  }

  function cambiaInizio(valore: string) {
    if (!valore) return;
    const inizio = daInputDateTime(valore);
    // Su un appuntamento si tiene la durazione che c'era; su una chiamata la
    // fine non è un dato che l'utente abbia scritto, è il momento più i
    // minuti di default. Senza questo, spostando l'orario di una chiamata la
    // fine restava ferma e finiva **prima** dell'inizio.
    if (tipo === "chiamata") {
      setForm((precedente) => ({ ...precedente, inizio, fine: fineAttivita("chiamata", inizio) }));
      return;
    }
    const minuti = Math.round(
      (new Date(form.fine).getTime() - new Date(form.inizio).getTime()) / 60000,
    );
    setForm((precedente) => ({
      ...precedente,
      inizio,
      fine: aggiungiMinuti(inizio, Number.isFinite(minuti) && minuti > 0 ? minuti : 30),
    }));
  }

  function applicaDurata(minuti: number) {
    setForm((precedente) => ({ ...precedente, fine: aggiungiMinuti(precedente.inizio, minuti) }));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (inCorso) return;
    if (!aziendaId) {
      setErrore("Scegli l'azienda: senza di lei l'attività non ha un contesto.");
      return;
    }
    if (new Date(form.fine) <= new Date(form.inizio)) {
      setErrore("L'ora di fine deve essere successiva a quella di inizio.");
      return;
    }
    // La fine non si scrive mai a mano per una chiamata: qui viene ricalcolata,
    // così anche una riga venuta dal cloud con la fine sbagliata torna a posto
    // appena qualcuno la tocca.
    const dati = { ...form, aziendaId, tipo, fine: fineAttivita(tipo, form.inizio) };
    // Prima il salvataggio in locale, sempre: se Google è irraggiungibile
    // l'attività non deve perdersi, e l'errore di rete non deve
    // cancellare quello che l'utente aveva scritto.
    let id: number;
    if (attivita) {
      aggiornaAttivita(attivita.id, dati);
      id = attivita.id;
    } else {
      id = creaAttivita(dati);
    }

    if (googlePronto && pubblica) {
      setInCorso(true);
      notifica("info", "Salvo e pubblico su Google Calendar…");
      // `pubblicaAttivita` non solleva: ritorna `{ ok: false }`. Passarlo a
      // `esegui` con `successo: (r) => r.messaggio` mostrava un fallimento
      // come se fosse un avviso verde, con dentro la frase dell'errore che poi
      // spariva: l'utente vedeva una notifica di successo su un'operazione
      // fallita, e restava con la convinzione che l'evento fosse in agenda.
      // Qui l'esito decide il colore, e il motivo va anche sull'attività.
      const esito = await esegui(() => pubblicaAttivita(id), {
        errore: "Attività salvata, ma non pubblicata su Google Calendar",
      });
      if (esito?.ok) notifica("ok", esito.messaggio);
      else if (esito) notifica("errore", `Non pubblicata: ${esito.messaggio}`);
      setInCorso(false);
    }
    onSaved(id);
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      {/* Il tipo, dichiarato e non scelto: è l'azione che ha portato qui.
          Senza questa riga chi è dentro per una chiamata non avrebbe modo di
          sapere che l'evento si chiamerà "CHIAMATA - …": lo scoprirebbe solo
          dal titolo, e magari dopo. */}
      {!attivita ? (
        <p className="text-sm text-ink-500">
          {tipo === "chiamata" ? "Chiamata" : "Appuntamento"} — nel calendario l'evento si chiamerà{" "}
          <span className="font-medium text-ink-800">{ETICHETTA_TIPO[tipo]} - …</span>
        </p>
      ) : null}

      <Field label="Azienda" hint="L'azienda di cui fanno parte questa attività e il suo report.">
        <Select
          value={aziendaId || ""}
          onChange={(event) => {
            const id = Number(event.target.value);
            setAziendaId(id);
            setForm((precedente) => ({ ...precedente, aziendaId: id }));
          }}
        >
          {aziende.length === 0 ? <option value="">Nessuna azienda</option> : null}
          {aziende.map((azienda) => (
            <option key={azienda.id} value={azienda.id}>
              {nomeAzienda(azienda)}
            </option>
          ))}
        </Select>
      </Field>

      <Field label="Titolo">
        <Input
          value={form.titolo}
          onChange={(event) => set("titolo", event.target.value)}
          placeholder="Titolo dell'attività"
        />
      </Field>

      {/* Una chiamata ha un momento, non un intervallo: niente fine e niente
          pulsanti di durata, che su una chiamata non avrebbero niente da
          cambiare. L'appuntamento resta com'è. */}
      {tipo === "chiamata" ? (
        <Field label="Quando" hint={`In agenda occupa ${MINUTI_CHIAMATA} minuti.`}>
          <Input
            type="datetime-local"
            value={aInputDateTime(form.inizio)}
            onChange={(event) => cambiaInizio(event.target.value)}
          />
        </Field>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Inizio">
              <Input
                type="datetime-local"
                value={aInputDateTime(form.inizio)}
                onChange={(event) => cambiaInizio(event.target.value)}
              />
            </Field>
            <Field label="Fine">
              <Input
                type="datetime-local"
                value={aInputDateTime(form.fine)}
                onChange={(event) => set("fine", daInputDateTime(event.target.value))}
              />
            </Field>
          </div>

          <div className="flex flex-wrap gap-1.5">
            {DURATE.map((minuti) => (
              <button
                key={minuti}
                type="button"
                onClick={() => applicaDurata(minuti)}
                className="rounded-lg border border-ink-200 bg-white px-2.5 py-1.5 text-xs font-medium text-ink-500 transition-colors hover:border-ink-300"
              >
                {minuti < 60 ? `${minuti} min` : `${minuti / 60} h`}
              </button>
            ))}
          </div>

          <Field label="Luogo">
            <Input
              value={form.luogo}
              onChange={(event) => set("luogo", event.target.value)}
              placeholder="Comune · Sportello 3"
            />
          </Field>
        </>
      )}

      <Field label="Descrizione">
        <Textarea
          value={form.descrizione}
          onChange={(event) => set("descrizione", event.target.value)}
          placeholder="Documenti da portare…"
        />
      </Field>

      {/* Una chiamata si fa o non si fa: una casella, non una lista di stati.
          Il select qui sotto è quello dell'appuntamento, che ha davvero
          l'attesa e la conferma. */}
      {tipo === "chiamata" ? (
        <Checkbox
          label="Chiamata fatta"
          hint="Da qui si genera il report, come per l'appuntamento."
          checked={form.completata}
          onChange={(event) => cambiaCompletata(event.target.checked)}
        />
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <Field label="Stato">
            <Select
              value={form.stato}
              onChange={(event) => set("stato", event.target.value as StatoAttivita)}
            >
              <option value="in-attesa">In attesa</option>
              <option value="confermato">Confermato</option>
              <option value="annullato">Annullato</option>
            </Select>
          </Field>
          <Field label="Promemoria">
            <Select
              value={form.promemoriaMin}
              onChange={(event) => set("promemoriaMin", Number(event.target.value))}
            >
              {PROMEMORIE.map((minuti) => (
                <option key={minuti} value={minuti}>
                  {minuti === 0
                    ? "Nessun avviso"
                    : minuti >= 1440
                      ? "1 giorno prima"
                      : `${minuti} min prima`}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      )}

      {errore ? <p className="text-sm text-clay-600">{errore}</p> : null}

      {googlePronto ? (
        <div className="rounded-xl border border-ink-100 bg-ink-50 px-3.5 py-3">
          <Checkbox
            label="Pubblica su Google Calendar"
            hint={
              attivita?.googleEventId
                ? "L'evento già creato viene aggiornato con queste modifiche."
                : `L'evento viene creato appena salvi, col titolo "${ETICHETTA_TIPO[tipo]} - ${form.titolo}".`
            }
            checked={pubblica}
            onChange={(event) => setPubblica(event.target.checked)}
          />
        </div>
      ) : (
        <p className="rounded-xl bg-ink-50 px-3.5 py-3 text-xs leading-relaxed text-ink-500">
          Senza Google Calendar collegato puoi esportare l'attività in formato .ics.
        </p>
      )}

      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" variant="secondary" onClick={onCancel} disabled={inCorso}>
          Annulla
        </Button>
        <Button type="submit" disabled={inCorso}>
          {inCorso
            ? "Pubblico…"
            : attivita
              ? "Salva le modifiche"
              : tipo === "chiamata"
                ? "Crea chiamata"
                : "Crea appuntamento"}
        </Button>
      </div>
    </form>
  );
}
