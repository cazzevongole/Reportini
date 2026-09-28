import { useState, type FormEvent } from "react";
import { useAvvisi } from "./Avvisi";
import { aInputDateTime, aggiungiMinuti, daInputDateTime } from "../lib/date";
import { isConnected } from "../lib/google/auth";
import { pubblicaAppuntamento } from "../lib/google/sync";
import {
  aggiornaAppuntamento,
  creaAppuntamento,
  elencaAnagrafici,
  elencaRelazioni,
  nomeCompleto,
  type AppuntamentoInput,
} from "../lib/repo";
import type { Appuntamento, StatoAppuntamento } from "../lib/types";
import { Button, Checkbox, Field, Input, Select, Textarea } from "./ui";

const DURATE = [15, 30, 45, 60, 90];
const PROMEMORIE = [0, 10, 30, 60, 1440];

export default function AppuntamentoForm({
  appuntamento,
  anagraficoIdIniziale,
  onSaved,
  onCancel,
}: {
  appuntamento?: Appuntamento | null;
  anagraficoIdIniziale?: number | null;
  onSaved: (id: number) => void;
  onCancel: () => void;
}) {
  const anagrafici = elencaAnagrafici();
  const [anagraficoId, setAnagraficoId] = useState<number | null>(
    appuntamento
      ? appuntamento.anagraficoId
      : anagraficoIdIniziale ?? anagrafici[0]?.id ?? null,
  );
  const relazioni = elencaRelazioni({ anagraficoId });
  const googlePronto = isConnected();
  const { notifica, esegui } = useAvvisi();
  const [errore, setErrore] = useState("");
  const [inCorso, setInCorso] = useState(false);
  // La pubblicazione è il comportamento normale, non un extra: la spunta
  // parte accesa e serve solo a chi la vuole disattivata per un appuntamento.
  const [pubblica, setPubblica] = useState(isConnected);

  const [form, setForm] = useState<AppuntamentoInput>(() => {
    if (appuntamento) {
      const { id: _id, createdAt: _c, updatedAt: _u, ...resto } = appuntamento;
      return resto;
    }
    const inizio = aggiungiMinuti(new Date().toISOString(), 60);
    return {
      anagraficoId: anagraficoIdIniziale ?? anagrafici[0]?.id ?? null,
      relazioneId: null,
      titolo: "Appuntamento allo sportello",
      descrizione: "",
      inizio,
      fine: aggiungiMinuti(inizio, 30),
      luogo: "",
      stato: "in-attesa",
      promemoriaMin: 30,
      googleEventId: null,
      googleCalendarId: null,
      googleHtmlLink: null,
      googleSyncAt: null,
      // Un appuntamento nuovo non ha ancora un motivo di fallimento: quello
      // arriva dalla pubblicazione, e la riga sparisce al primo successo.
      googleErrore: null,
    };
  });

  function set<K extends keyof AppuntamentoInput>(chiave: K, valore: AppuntamentoInput[K]) {
    setForm((precedente) => ({ ...precedente, [chiave]: valore }));
  }

  function cambiaInizio(valore: string) {
    if (!valore) return;
    const inizio = daInputDateTime(valore);
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
    if (new Date(form.fine) <= new Date(form.inizio)) {
      setErrore("L'ora di fine deve essere successiva a quella di inizio.");
      return;
    }
    const dati = { ...form, anagraficoId };
    // Prima il salvataggio in locale, sempre: se Google è irraggiungibile
    // l'appuntamento non deve perdersi, e l'errore di rete non deve
    // cancellare quello che l'utente aveva scritto.
    let id: number;
    if (appuntamento) {
      aggiornaAppuntamento(appuntamento.id, dati);
      id = appuntamento.id;
    } else {
      id = creaAppuntamento(dati);
    }

    if (googlePronto && pubblica) {
      setInCorso(true);
      notifica("info", "Salvo e pubblico su Google Calendar…");
      // `pubblicaAppuntamento` non solleva: ritorna `{ ok: false }`. Passarlo a
      // `esegui` con `successo: (r) => r.messaggio` mostrava un fallimento
      // come se fosse un avviso verde, con dentro la frase dell'errore che poi
      // spariva: l'utente vedeva una notifica di successo su un'operazione
      // fallita, e restava con la convinzione che l'evento fosse in agenda.
      // Qui l'esito decide il colore, e il motivo va anche sull'appuntamento.
      const esito = await esegui(() => pubblicaAppuntamento(id), {
        errore: "Appuntamento salvato, ma non pubblicato su Google Calendar",
      });
      if (esito?.ok) notifica("ok", esito.messaggio);
      else if (esito) notifica("errore", `Non pubblicato: ${esito.messaggio}`);
      setInCorso(false);
    }
    onSaved(id);
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <Field label="Titolo">
        <Input
          value={form.titolo}
          onChange={(event) => set("titolo", event.target.value)}
          placeholder="Titolo dell'appuntamento"
        />
      </Field>

      <Field label="Anagrafico" hint="Facoltativo: un appuntamento può non essere collegato.">
        <Select
          value={anagraficoId ?? ""}
          onChange={(event) => {
            const id = event.target.value ? Number(event.target.value) : null;
            setAnagraficoId(id);
            setForm((precedente) => ({ ...precedente, anagraficoId: id, relazioneId: null }));
          }}
        >
          <option value="">Senza anagrafico</option>
          {anagrafici.map((anagrafico) => (
            <option key={anagrafico.id} value={anagrafico.id}>
              {nomeCompleto(anagrafico)}
            </option>
          ))}
        </Select>
      </Field>

      {anagraficoId && relazioni.length > 0 ? (
        <Field label="Relazione collegata">
          <Select
            value={form.relazioneId ?? ""}
            onChange={(event) =>
              set("relazioneId", event.target.value ? Number(event.target.value) : null)
            }
          >
            <option value="">Nessuna relazione</option>
            {relazioni.map((relazione) => (
              <option key={relazione.id} value={relazione.id}>
                {relazione.titolo}
              </option>
            ))}
          </Select>
        </Field>
      ) : null}

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

      <Field label="Descrizione">
        <Textarea
          value={form.descrizione}
          onChange={(event) => set("descrizione", event.target.value)}
          placeholder="Documenti da portare…"
        />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Stato">
          <Select
            value={form.stato}
            onChange={(event) => set("stato", event.target.value as StatoAppuntamento)}
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
                {minuti === 0 ? "Nessun avviso" : minuti >= 1440 ? "1 giorno prima" : `${minuti} min prima`}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      {errore ? <p className="text-sm text-clay-600">{errore}</p> : null}

      {googlePronto ? (
        <div className="rounded-xl border border-ink-100 bg-ink-50 px-3.5 py-3">
          <Checkbox
            label="Pubblica su Google Calendar"
            hint={
              appuntamento?.googleEventId
                ? "L'evento già creato viene aggiornato con queste modifiche."
                : "L'evento viene creato appena salvi. Se lo annulli, sparisce anche dal calendario."
            }
            checked={pubblica}
            onChange={(event) => setPubblica(event.target.checked)}
          />
        </div>
      ) : (
        <p className="rounded-xl bg-ink-50 px-3.5 py-3 text-xs leading-relaxed text-ink-500">
          Senza Google Calendar collegato puoi esportare l'appuntamento in formato .ics.
        </p>
      )}

      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" variant="secondary" onClick={onCancel} disabled={inCorso}>
          Annulla
        </Button>
        <Button type="submit" disabled={inCorso}>
          {inCorso ? "Pubblico…" : appuntamento ? "Salva le modifiche" : "Crea appuntamento"}
        </Button>
      </div>
    </form>
  );
}
