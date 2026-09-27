import { useState, type FormEvent } from "react";
import { aggiornaAnagrafico, creaAnagrafico, type AnagraficoInput } from "../lib/repo";
import type { Anagrafico, Sesso } from "../lib/types";
import { Button, Field, Input, Select, Textarea } from "./ui";

export const ANAGRAFICO_VUOTO: AnagraficoInput = {
  nome: "",
  cognome: "",
  documento: "",
  dataNascita: null,
  sesso: "",
  nazionalita: "",
  indirizzo: "",
  citta: "",
  cap: "",
  provincia: "",
  telefono: "",
  email: "",
  note: "",
};

function daAnagrafico(anagrafico: Anagrafico): AnagraficoInput {
  const { id: _id, createdAt: _c, updatedAt: _u, ...resto } = anagrafico;
  return resto;
}

export default function AnagraficoForm({
  anagrafico,
  onSaved,
  onCancel,
}: {
  anagrafico?: Anagrafico | null;
  onSaved: (id: number) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<AnagraficoInput>(
    anagrafico ? daAnagrafico(anagrafico) : ANAGRAFICO_VUOTO,
  );
  const [errore, setErrore] = useState("");

  function set<K extends keyof AnagraficoInput>(chiave: K, valore: AnagraficoInput[K]) {
    setForm((precedente) => ({ ...precedente, [chiave]: valore }));
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!form.nome.trim() && !form.cognome.trim()) {
      setErrore("Inserisci almeno il nome o il cognome.");
      return;
    }
    if (anagrafico) {
      aggiornaAnagrafico(anagrafico.id, form);
      onSaved(anagrafico.id);
    } else {
      onSaved(creaAnagrafico(form));
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Nome">
          <Input
            value={form.nome}
            onChange={(e) => set("nome", e.target.value)}
            placeholder="Nome"
            autoComplete="given-name"
          />
        </Field>
        <Field label="Cognome">
          <Input
            value={form.cognome}
            onChange={(e) => set("cognome", e.target.value)}
            placeholder="Cognome"
            autoComplete="family-name"
          />
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Documento" hint="Carta d'identità, codice fiscale o passaporto">
          <Input
            value={form.documento}
            onChange={(e) => set("documento", e.target.value.toUpperCase())}
            placeholder="Documento"
          />
        </Field>
        <Field label="Data di nascita">
          <Input
            type="date"
            value={form.dataNascita ?? ""}
            onChange={(e) => set("dataNascita", e.target.value || null)}
          />
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Sesso">
          <Select value={form.sesso} onChange={(e) => set("sesso", e.target.value as Sesso)}>
            <option value="">Non specificato</option>
            <option value="F">Femmina</option>
            <option value="M">Maschio</option>
            <option value="O">Altro</option>
          </Select>
        </Field>
        <Field label="Nazionalità">
          <Input
            value={form.nazionalita}
            onChange={(e) => set("nazionalita", e.target.value)}
            placeholder="Italiana"
          />
        </Field>
      </div>

      <Field label="Indirizzo">
        <Input
          value={form.indirizzo}
          onChange={(e) => set("indirizzo", e.target.value)}
          placeholder="Via Roma 14, 3° B"
        />
      </Field>

      <div className="grid grid-cols-3 gap-3">
        <Field label="Comune">
          <Input value={form.citta} onChange={(e) => set("citta", e.target.value)} />
        </Field>
        <Field label="CAP">
          <Input
            value={form.cap}
            onChange={(e) => set("cap", e.target.value)}
            inputMode="numeric"
          />
        </Field>
        <Field label="Provincia">
          <Input value={form.provincia} onChange={(e) => set("provincia", e.target.value)} />
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Telefono">
          <Input
            type="tel"
            value={form.telefono}
            onChange={(e) => set("telefono", e.target.value)}
            placeholder="+39 320 000 0000"
          />
        </Field>
        <Field label="Email">
          <Input
            type="email"
            value={form.email}
            onChange={(e) => set("email", e.target.value)}
            placeholder="persona@example.com"
          />
        </Field>
      </div>

      <Field label="Note">
        <Textarea
          value={form.note}
          onChange={(e) => set("note", e.target.value)}
          placeholder="Annotazioni interne, requisiti particolari…"
        />
      </Field>

      {errore ? <p className="text-sm text-clay-600">{errore}</p> : null}

      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" variant="secondary" onClick={onCancel}>
          Annulla
        </Button>
        <Button type="submit">{anagrafico ? "Salva le modifiche" : "Crea anagrafico"}</Button>
      </div>
    </form>
  );
}
