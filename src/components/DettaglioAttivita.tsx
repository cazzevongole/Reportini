import { useState } from "react";
import AttivitaForm from "./AttivitaForm";
import ReportForm from "./ReportForm";
import { CheckIcon, EditIcon, FileTextIcon, TrashIcon } from "./icons";
import BadgeStato from "./BadgeStato";
import { Badge, Button, Card, Checkbox } from "./ui";
import { useAvvisi } from "./Avvisi";
import { useLiveQuery } from "../hooks/useLiveQuery";
import { dataLunga, durata, ora } from "../lib/date";
import { eliminaAttivitaEEvento } from "../lib/google/sync";
import {
  creaReport,
  eliminaReport,
  elencaReport,
  segnaAttivitaCompletata,
  segnaChiamataCompletata,
} from "../lib/repo";
import { ETICHETTA_TIPO, titoloEvento, type AttivitaDettagliata } from "../lib/types";

/**
 * Il dettaglio di un'attività, che è anche il posto da cui nasce il report.
 *
 * Il percorso richiesto è questo: si apre l'attività, la si **segna come
 * completata**, e da lì si genera il report. Il report non si crea dalla
 * pagina dell'azienda, e soprattutto non si crea a mano: un report scritto
 * senza un'attività non avrebbe né un tipo né una data che non fossero
 * inventati.
 *
 * Il report è unico per attività, quindi qui non si offrono due bottoni
 * ("genera" e "rigenera") che farebbero la stessa cosa: se il report c'è già,
 * si apre per modificarlo. Rigenerarlo significherebbe gettare via un testo
 * scritto, e nessuno lo chiede esplicitamente.
 */
export default function DettaglioAttivita({
  attivita,
  onChiudi,
  onModificata,
}: {
  attivita: AttivitaDettagliata;
  onChiudi: () => void;
  onModificata: () => void;
}) {
  const { notifica, esegui } = useAvvisi();
  const [inModifica, setInModifica] = useState(false);
  // L'id del report aperto, non un booleano: il form vuole il report
  // intero e non sa leggerlo da solo. Con l'id la riga si cerca nella query,
  // che è già aggiornata perché la creazione scrive sul database.
  const [reportAperto, setReportAperto] = useState<number | null>(null);

  // I report dell'attività: uno solo per costruzione, ma la query è quella
  // che risponde, così se un domani il modello cambiasse la pagina non
  // dipenderebbe da un conteggio contato a mano.
  const report = useLiveQuery(
    () =>
      elencaReport({ aziendaId: attivita.aziendaId }).filter((r) => r.attivitaId === attivita.id),
    [attivita.aziendaId, attivita.id],
  );
  const esistente = report[0] ?? null;
  const inReport = reportAperto !== null;
  const reportInModifica = report.find((r) => r.id === reportAperto) ?? esistente;

  function segna(completata: boolean) {
    // Su una chiamata la casella è tutto lo stato: `segnaChiamataCompletata`
    // scrive `stato` e `completata` insieme, perché sono la stessa informazione
    // in due colonne e due scritture lasciano una riga che dice "fatta" e
    // "in attesa" nello stesso momento.
    if (attivita.tipo === "chiamata") {
      segnaChiamataCompletata(attivita.id, completata);
    } else {
      segnaAttivitaCompletata(attivita.id, completata);
    }
    onModificata();
  }

  function generaReport() {
    // Il titolo parte da quello dell'attività, ed è correggibile: è il
    // documento che l'utente consegnerà, e il nome dell'attività ("Sportello")
    // è il punto di partenza, non il titolo definitivo.
    const id = creaReport({
      aziendaId: attivita.aziendaId,
      attivitaId: attivita.id,
      titolo: attivita.titolo,
      descrizione: "",
    });
    notifica("ok", "Report generato: puoi scriverlo adesso.");
    onModificata();
    setReportAperto(id);
  }

  return (
    <div className="space-y-4">
      {inModifica ? (
        <AttivitaForm
          attivita={attivita}
          aziendaIdIniziale={attivita.aziendaId}
          onSaved={() => {
            setInModifica(false);
            onModificata();
          }}
          onCancel={() => setInModifica(false)}
        />
      ) : inReport && reportInModifica ? (
        <ReportForm
          report={reportInModifica}
          onSaved={() => {
            setReportAperto(null);
            onModificata();
          }}
          onCancel={() => setReportAperto(null)}
        />
      ) : (
        <>
          <div>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="truncate font-medium text-ink-900">{attivita.titolo}</h3>
                <p className="mt-0.5 truncate text-xs text-ink-400">
                  {attivita.aziendaRagioneSociale}
                </p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1.5">
                <BadgeStato
                  tipo={attivita.tipo}
                  stato={attivita.stato}
                  completata={attivita.completata}
                />
                <Badge tone="muted">{ETICHETTA_TIPO[attivita.tipo]}</Badge>
              </div>
            </div>

            <p className="mt-3 text-sm text-ink-500">
              {dataLunga(attivita.inizio)} · {ora(attivita.inizio)}
              {/* Una chiamata è un momento: scriverle accanto una durata
                  significherebbe fargliela durare un tempo che nessuno ha
                  deciso. */}
              {attivita.tipo === "appuntamento"
                ? ` · ${durata(attivita.inizio, attivita.fine)}`
                : ""}
            </p>
            {attivita.tipo === "appuntamento" && attivita.luogo ? (
              <p className="mt-1 text-sm text-ink-500">{attivita.luogo}</p>
            ) : null}
            {attivita.descrizione ? (
              <p className="mt-3 whitespace-pre-wrap text-[13px] leading-relaxed text-ink-600">
                {attivita.descrizione}
              </p>
            ) : null}
          </div>

          {/* Il titolo dell'evento, mostrato per quello che è: la parola del
              tipo non sta nell'interfaccia dell'attività, sta nel calendario. */}
          <p className="rounded-xl bg-ink-50 px-3.5 py-2.5 text-xs text-ink-500">
            Su Google Calendar compare come{" "}
            <span className="font-medium text-ink-800">
              {titoloEvento(attivita.tipo, attivita.titolo)}
            </span>
          </p>

          {/* La casella che genera il report. È il punto in cui il lavoro
              diventa una cosa da cui si scrive un documento, ed è per questo
              che sta qui e non nella pagina dell'azienda. */}
          <Card className="p-4">
            <Checkbox
              label={attivita.tipo === "chiamata" ? "Chiamata fatta" : "Attività completata"}
              hint="Quando l'hai fatta, segnala qui e genera il report."
              checked={attivita.completata}
              onChange={(event) => segna(event.target.checked)}
            />

            {esistente ? (
              <div className="mt-3 border-t border-ink-100 pt-3">
                <p className="text-sm font-medium text-ink-900">{esistente.titolo}</p>
                <p className="mt-0.5 line-clamp-2 text-xs text-ink-400">
                  {esistente.descrizione || "Report ancora da scrivere."}
                </p>
                <div className="mt-2.5 flex flex-wrap gap-1.5">
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => setReportAperto(esistente.id)}
                  >
                    <EditIcon className="h-3.5 w-3.5" />
                    Apri il report
                  </Button>
                  <Button
                    size="sm"
                    variant="danger"
                    onClick={() => {
                      if (!confirm(`Eliminare il report "${esistente.titolo}"?`)) return;
                      // Solo il report: l'attività resta, e da lei se ne può
                      // generare un altro.
                      void esegui(async () => eliminaReport(esistente.id), {
                        errore: "Eliminazione del report non riuscita",
                      });
                      onModificata();
                    }}
                  >
                    <TrashIcon className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            ) : attivita.completata ? (
              <Button size="sm" className="mt-3" onClick={generaReport}>
                <FileTextIcon className="h-3.5 w-3.5" />
                Genera il report
              </Button>
            ) : (
              <p className="mt-3 text-xs text-ink-400">
                <CheckIcon className="mr-1 inline h-3.5 w-3.5" />
                {attivita.tipo === "chiamata"
                  ? "Segna la chiamata come fatta per poter generare il report."
                  : "Segna l'attività come completata per poter generare il report."}
              </p>
            )}
          </Card>

          <div className="flex flex-wrap justify-between gap-2 border-t border-ink-100 pt-4">
            <Button size="sm" variant="secondary" onClick={() => setInModifica(true)}>
              <EditIcon className="h-3.5 w-3.5" />
              Modifica attività
            </Button>
            <Button
              size="sm"
              variant="danger"
              onClick={() => {
                if (!confirm(`Eliminare l'attività "${attivita.titolo}"?`)) return;
                void (async () => {
                  // Il report va con l'attività: è la sua descrizione, e senza
                  // l'attività non ha più né data né tipo.
                  if (esistente) eliminaReport(esistente.id);
                  const esito = await esegui(() => eliminaAttivitaEEvento(attivita.id), {
                    errore: "Eliminazione non riuscita",
                  });
                  if (esito) onChiudi();
                })();
              }}
            >
              <TrashIcon className="h-3.5 w-3.5" />
              Elimina
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
