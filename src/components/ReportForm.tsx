import { useState, type FormEvent } from "react";
import { aggiornaReport, type ReportInput } from "../lib/repo";
import { ETICHETTA_TIPO, type ReportDettagliato } from "../lib/types";
import { Button, Field, Input, Textarea } from "./ui";

/**
 * Il form del report, che **modifica** un report già generato.
 *
 * Qui non c'è "crea": il report nasce dal dettaglio di un'attività segnata
 * come completata, e non da una pagina di aziende. È la differenza che è
 * stata chiesta, ed è anche l'unica che tiene insieme le due metà: un report
 * scritto a mano non avrebbe nessun'attività cui riferirsi, e quindi nessun
 * tipo e nessuna data che non fossero stati scritti a mano due volte — due
 * fonti che possono dire una cosa diversa.
 *
 * Di conseguenza qui non ci sono né il tipo né la data: vengono dall'attività,
 * e sono mostrati come contesto, non come campi da compilare.
 *
 * La descrizione parte **vuota**, e senza scheletro. Uno scheletro usato come
 * placeholder sembra un testo già scritto: l'utente lo legge, deduce che il
 * report è già a metà e lo salva così. Un documento con "Antefatti", "Fatti
 * accertati" e "Conclusione" tutti vuoti sembra compilato, e non lo è.
 */
export default function ReportForm({
  report,
  onSaved,
  onCancel,
}: {
  report: ReportDettagliato;
  onSaved: (id: number) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<ReportInput>(() => {
    const { id: _id, createdAt: _c, updatedAt: _u, ...resto } = report;
    return resto;
  });
  const [errore, setErrore] = useState("");

  function set<K extends keyof ReportInput>(chiave: K, valore: ReportInput[K]) {
    setForm((precedente) => ({ ...precedente, [chiave]: valore }));
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!form.titolo.trim()) {
      setErrore("Il report deve avere un titolo.");
      return;
    }
    aggiornaReport(report.id, form);
    onSaved(report.id);
  }

  const quando = new Date(report.attivitaInizio).toLocaleDateString("it-IT", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  return (
    <form onSubmit={submit} className="space-y-4">
      {/* Il contesto non è modificabile: è l'attività, e l'attività non si
          cambia da qui. Serve a chi apre il report per sapere di cosa parla
          senza tornare indietro. */}
      <div className="rounded-xl border border-ink-100 bg-ink-50 px-3.5 py-3 text-sm">
        <p className="font-medium text-ink-700">{report.aziendaRagioneSociale}</p>
        <p className="mt-0.5 text-xs text-ink-500">
          {ETICHETTA_TIPO[report.attivitaTipo]} · {report.attivitaTitolo} · {quando}
        </p>
      </div>

      <Field label="Titolo">
        <Input
          value={form.titolo}
          onChange={(event) => set("titolo", event.target.value)}
          placeholder="Certificato di residenza"
        />
      </Field>

      <Field
        label="Descrizione"
        hint="Il testo viene salvato e stampato esattamente come lo scrivi."
      >
        <Textarea
          value={form.descrizione}
          onChange={(event) => set("descrizione", event.target.value)}
          className="min-h-64 font-mono text-[13px] leading-relaxed"
        />
      </Field>

      {errore ? <p className="text-sm text-clay-600">{errore}</p> : null}

      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" variant="secondary" onClick={onCancel}>
          Annulla
        </Button>
        <Button type="submit">Salva il report</Button>
      </div>
    </form>
  );
}
