import { useState, type FormEvent } from "react";
import {
  aggiornaRelazione,
  creaRelazione,
  elencaAnagrafici,
  nomeCompleto,
  type RelazioneInput,
} from "../lib/repo";
import type { Relazione, StatoRelazione } from "../lib/types";
import { Button, Field, Input, Select, Textarea } from "./ui";

const STATI: Array<{ valore: StatoRelazione; etichetta: string }> = [
  { valore: "bozza", etichetta: "Bozza" },
  { valore: "revisione", etichetta: "In revisione" },
  { valore: "firmato", etichetta: "Firmato" },
  { valore: "consegnato", etichetta: "Consegnato" },
];

const TIPO_ESEMPIO = [
  "Certificato di residenza",
  "Istanza di integrazione",
  "Attestazione",
  "Relazione sociale",
];

const MODELLO = `RELAZIONE

Anagrafico:
Documento:
Pratica:

Antefatti
----------
Motivo della richiesta:

Fatti accertati
---------------

Conclusione
----------
`;

export default function RelazioneForm({
  relazione,
  anagraficoIdIniziale,
  onSaved,
  onCancel,
}: {
  relazione?: Relazione | null;
  anagraficoIdIniziale?: number | null;
  onSaved: (id: number) => void;
  onCancel: () => void;
}) {
  const anagrafici = elencaAnagrafici();
  const [form, setForm] = useState<RelazioneInput>(() => {
    if (relazione) {
      const { id: _id, createdAt: _c, updatedAt: _u, ...resto } = relazione;
      return resto;
    }
    return {
      anagraficoId: anagraficoIdIniziale ?? anagrafici[0]?.id ?? 0,
      titolo: "",
      tipo: "",
      stato: "bozza",
      contenuto: MODELLO,
      data: new Date().toISOString().slice(0, 10),
    };
  });
  const [errore, setErrore] = useState("");

  function set<K extends keyof RelazioneInput>(chiave: K, valore: RelazioneInput[K]) {
    setForm((precedente) => ({ ...precedente, [chiave]: valore }));
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!form.anagraficoId) {
      setErrore("Seleziona l'anagrafico a cui appartiene la relazione.");
      return;
    }
    if (!form.titolo.trim()) {
      setErrore("La relazione deve avere un titolo.");
      return;
    }
    if (relazione) {
      aggiornaRelazione(relazione.id, form);
      onSaved(relazione.id);
    } else {
      onSaved(creaRelazione(form));
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <Field label="Anagrafico">
        <Select
          value={form.anagraficoId || ""}
          onChange={(event) => set("anagraficoId", Number(event.target.value))}
        >
          <option value="">Seleziona…</option>
          {anagrafici.map((anagrafico) => (
            <option key={anagrafico.id} value={anagrafico.id}>
              {nomeCompleto(anagrafico)}
              {anagrafico.documento ? ` · ${anagrafico.documento}` : ""}
            </option>
          ))}
        </Select>
      </Field>

      <Field label="Titolo">
        <Input
          value={form.titolo}
          onChange={(event) => set("titolo", event.target.value)}
          placeholder="Certificato di residenza"
        />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Tipo">
          <Input
            value={form.tipo}
            onChange={(event) => set("tipo", event.target.value)}
            placeholder="Certificato, integrazione…"
            list="tipi-relazione"
          />
          <datalist id="tipi-relazione">
            {TIPO_ESEMPIO.map((tipo) => (
              <option key={tipo} value={tipo} />
            ))}
          </datalist>
        </Field>
        <Field label="Data">
          <Input
            type="date"
            value={form.data}
            onChange={(event) => set("data", event.target.value)}
          />
        </Field>
      </div>

      <Field label="Stato">
        <div className="flex flex-wrap gap-2">
          {STATI.map((stato) => (
            <button
              key={stato.valore}
              type="button"
              onClick={() => set("stato", stato.valore)}
              className={`rounded-xl border px-3 py-2 text-[13px] font-medium transition-colors ${
                form.stato === stato.valore
                  ? "border-ink-950 bg-ink-950 text-white"
                  : "border-ink-200 bg-white text-ink-500 hover:border-ink-300"
              }`}
            >
              {stato.etichetta}
            </button>
          ))}
        </div>
      </Field>

      <Field label="Contenuto" hint="Il testo viene salvato e stampato esattamente come lo scrivi.">
        <Textarea
          value={form.contenuto}
          onChange={(event) => set("contenuto", event.target.value)}
          className="min-h-64 font-mono text-[13px] leading-relaxed"
        />
      </Field>

      {errore ? <p className="text-sm text-clay-600">{errore}</p> : null}

      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" variant="secondary" onClick={onCancel}>
          Annulla
        </Button>
        <Button type="submit">{relazione ? "Salva le modifiche" : "Crea relazione"}</Button>
      </div>
    </form>
  );
}
