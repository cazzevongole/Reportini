import { useEffect } from "react";
import {
  avviaControlliAutomatici,
  useAggiornamento,
  type StatoAggiornamento,
} from "../lib/aggiornamento";
import { CloudIcon, RotateIcon } from "./icons";
import { Button, Sheet } from "./ui";

/**
 * L'aggiornamento automatico, in due tempi.
 *
 * Mentre il pacchetto scende c'è la **barra**: dice che sta succedendo e quanto
 * manca, senza coprire la pagina e senza chiedere niente. Quando è pronto parte
 * invece il **pop-up**, che è l'unico momento in cui si chiede una decisione:
 * installare adesso, chiudendo l'app, oppure lasciare che entri alla chiusura.
 *
 * La barra sta nel flusso della pagina e non a schermo fisso: coprire il
 * contenuto con una striscia per un aggiornamento sarebbe più fastidioso
 * dell'aggiornamento stesso.
 */
export default function Aggiornamento() {
  const { stato, descrizione, pronto, daDecidere, occupato, installa, rimanda } =
    useAggiornamento();

  // I controlli automatici partono da qui, una volta sola: il componente è
  // montato per tutta la vita dell'app, quindi il timer vive quanto lei.
  useEffect(() => avviaControlliAutomatici(), []);

  const versione = stato.versione ?? "";
  const cosa = versione ? `Reportini ${versione}` : "l'aggiornamento";

  return (
    <>
      {pronto || !descrizione ? null : <Barra stato={stato} descrizione={descrizione} />}

      {daDecidere ? (
        <Sheet
          open
          title="C'è una versione nuova"
          description={`${cosa} è già scaricata: si può installare adesso o aspettare la chiusura dell'app.`}
          footer={
            <>
              <Button variant="secondary" onClick={() => void rimanda()} disabled={occupato}>
                Alla chiusura dell'app
              </Button>
              <Button className="flex-1" onClick={() => void installa()} disabled={occupato}>
                {occupato ? "Installo…" : "Aggiorna adesso"}
              </Button>
            </>
          }
        >
          <ul className="space-y-3 text-sm">
            <li className="rounded-xl border border-ink-100 p-3">
              <p className="font-medium text-ink-900">Aggiorna adesso</p>
              <p className="mt-1 text-ink-500">
                Reportini si chiude, l'installazione parte e l'app si riapre già nuova. I tuoi dati
                restano dove sono: non vengono toccati.
              </p>
            </li>
            <li className="rounded-xl border border-ink-100 p-3">
              <p className="font-medium text-ink-900">Alla chiusura dell'app</p>
              <p className="mt-1 text-ink-500">
                Continui a lavorare come ora. L'aggiornamento entra quando chiudi Reportini, e da
                solo al prossimo avvio se lo chiudi di colpo. Non te lo chiedo più.
              </p>
            </li>
          </ul>
        </Sheet>
      ) : null}
    </>
  );
}

/**
 * La striscia dello scarico. Non ha pulsanti: è un'informazione, e chiedere
 * una scelta mentre il pacchetto non è pronto sarebbe chiedere una scelta
 * su una promessa.
 */
function Barra({ stato, descrizione }: { stato: StatoAggiornamento; descrizione: string }) {
  const scarico = stato.fase === "scarico";
  return (
    <div
      role="status"
      aria-live="polite"
      className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-brand-200 bg-brand-50 px-4 py-3"
    >
      {scarico ? (
        <RotateIcon className="h-5 w-5 shrink-0 animate-spin text-brand-700" />
      ) : (
        <CloudIcon className="h-5 w-5 shrink-0 text-brand-700" />
      )}
      <p className="min-w-0 flex-1 text-sm text-brand-900">{descrizione}</p>
    </div>
  );
}
