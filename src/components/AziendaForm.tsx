import { useState, type FormEvent } from "react";
import { aggiornaAzienda, creaAzienda, type AziendaInput } from "../lib/repo";
import type { Azienda } from "../lib/types";
import { Button, Field, Input, Textarea } from "./ui";

export const AZIENDA_VUOTA: AziendaInput = {
  ragioneSociale: "",
  partitaIva: "",
  indirizzo: "",
  citta: "",
  cap: "",
  provincia: "",
  telefono: "",
  email: "",
  note: "",
};

function daAzienda(azienda: Azienda): AziendaInput {
  const { id: _id, createdAt: _c, updatedAt: _u, ...resto } = azienda;
  return resto;
}

export default function AziendaForm({
  azienda,
  onSaved,
  onCancel,
}: {
  azienda?: Azienda | null;
  onSaved: (id: number) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<AziendaInput>(azienda ? daAzienda(azienda) : AZIENDA_VUOTA);
  const [errore, setErrore] = useState("");

  function set<K extends keyof AziendaInput>(chiave: K, valore: AziendaInput[K]) {
    setForm((precedente) => ({ ...precedente, [chiave]: valore }));
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    // La ragione sociale è l'unica cosa che identifica l'azienda in tutte le
    // liste: senza, le ricerche resterebbero vuote e ogni schermata
    // mostrerebbe "senza nome". Gli altri campi si aggiungono dopo.
    if (!form.ragioneSociale.trim()) {
      setErrore("La ragione sociale è l'unico campo obbligatorio.");
      return;
    }
    if (azienda) {
      aggiornaAzienda(azienda.id, form);
      onSaved(azienda.id);
    } else {
      onSaved(creaAzienda(form));
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <Field label="Ragione sociale" hint="Come si chiede nei moduli e come va firmato">
        <Input
          value={form.ragioneSociale}
          onChange={(e) => set("ragioneSociale", e.target.value)}
          placeholder="Ferramenta Rossi S.r.l."
          autoComplete="organization"
        />
      </Field>

      <Field label="Partita IVA" hint="Facoltativa">
        <Input
          value={form.partitaIva}
          onChange={(e) => set("partitaIva", e.target.value.toUpperCase())}
          placeholder="01234567890"
          inputMode="numeric"
        />
      </Field>

      <Field label="Indirizzo">
        <Input
          value={form.indirizzo}
          onChange={(e) => set("indirizzo", e.target.value)}
          placeholder="Via Roma 14, 3° B"
          autoComplete="street-address"
        />
      </Field>

      <div className="grid grid-cols-3 gap-3">
        <Field label="Comune">
          <Input
            value={form.citta}
            onChange={(e) => set("citta", e.target.value)}
            autoComplete="address-level2"
          />
        </Field>
        <Field label="CAP">
          <Input
            value={form.cap}
            onChange={(e) => set("cap", e.target.value)}
            inputMode="numeric"
            autoComplete="postal-code"
          />
        </Field>
        <Field label="Provincia">
          <Input
            value={form.provincia}
            onChange={(e) => set("provincia", e.target.value.toUpperCase())}
            autoComplete="address-level1"
          />
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Telefono">
          <Input
            type="tel"
            value={form.telefono}
            onChange={(e) => set("telefono", e.target.value)}
            placeholder="+39 045 000 0000"
            autoComplete="tel"
          />
        </Field>
        <Field label="Email">
          <Input
            type="email"
            value={form.email}
            onChange={(e) => set("email", e.target.value)}
            placeholder="segreteria@azienda.it"
            autoComplete="email"
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
        <Button type="submit">{azienda ? "Salva le modifiche" : "Crea azienda"}</Button>
      </div>
    </form>
  );
}
