import { useState, type FormEvent } from "react";
import { aggiornaReferente, creaReferente, type ReferenteInput } from "../lib/repo";
import type { Referente } from "../lib/types";
import { Button, Field, Input } from "./ui";

export const REFERENTE_VUOTO: Omit<ReferenteInput, "aziendaId"> = {
  nome: "",
  cognome: "",
  telefono: "",
  email: "",
};

/**
 * Una scheda dentro la pagina dell'azienda.
 *
 * I referenti non hanno pagina propria e non hanno un loro elenco: si
 * cercano dall'azienda (anche per nome, vedi `elencaAziende`) perché è da
 * lì che si sa a chi scrivere. Questo modulo è quindi pensato per il foglio
 * che si apre dalla scheda azienda, non per una rotta.
 */
export default function ReferenteForm({
  aziendaId,
  referente,
  onSaved,
  onCancel,
}: {
  aziendaId: number;
  referente?: Referente | null;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<Omit<ReferenteInput, "aziendaId">>(() => {
    if (!referente) return REFERENTE_VUOTO;
    const { id: _id, aziendaId: _a, createdAt: _c, updatedAt: _u, ...resto } = referente;
    return resto;
  });
  const [errore, setErrore] = useState("");

  function set<K extends keyof typeof form>(chiave: K, valore: (typeof form)[K]) {
    setForm((precedente) => ({ ...precedente, [chiave]: valore }));
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    // Il nome basta: il cognome da solo non distingue ("Rossi" è il nome
    // di un'azienda, non di una persona) e il referente senza nome non
    // serve a niente.
    if (!form.nome.trim() && !form.cognome.trim()) {
      setErrore("Inserisci almeno il nome o il cognome.");
      return;
    }
    if (referente) {
      aggiornaReferente(referente.id, { aziendaId, ...form });
    } else {
      creaReferente({ aziendaId, ...form });
    }
    onSaved();
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Nome">
          <Input
            value={form.nome}
            onChange={(e) => set("nome", e.target.value)}
            placeholder="Mario"
            autoComplete="given-name"
          />
        </Field>
        <Field label="Cognome">
          <Input
            value={form.cognome}
            onChange={(e) => set("cognome", e.target.value)}
            placeholder="Rossi"
            autoComplete="family-name"
          />
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Telefono">
          <Input
            type="tel"
            value={form.telefono}
            onChange={(e) => set("telefono", e.target.value)}
            placeholder="+39 320 000 0000"
            autoComplete="tel"
          />
        </Field>
        <Field label="Email">
          <Input
            type="email"
            value={form.email}
            onChange={(e) => set("email", e.target.value)}
            placeholder="mario.rossi@azienda.it"
            autoComplete="email"
          />
        </Field>
      </div>

      {errore ? <p className="text-sm text-clay-600">{errore}</p> : null}

      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" variant="secondary" onClick={onCancel}>
          Annulla
        </Button>
        <Button type="submit">{referente ? "Salva" : "Aggiungi referente"}</Button>
      </div>
    </form>
  );
}
