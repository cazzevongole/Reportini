import { etichettaStato, type StatoAttivita, type TipoAttivita } from "../lib/types";
import { Badge, type BadgeTone } from "./ui";

/**
 * Il badge dello stato di un'attività, con le parole del tipo giusto.
 *
 * Sta in un componente perché la parola dipende dal tipo e l'errore è
 * silenzioso: scrivere "confermato" su una chiamata che l'utente ha segnata
 * come fatta non è un errore di compilazione, è solo una parola sbagliata in
 * tre pagine diverse. Qui la traduzione è in un posto solo — le stesse
 * funzioni che scrivono il titolo dell'evento — e non può divergere.
 */
const TONO: Record<StatoAttivita, BadgeTone> = {
  "in-attesa": "clay",
  confermato: "brand",
  annullato: "muted",
};

export default function BadgeStato({
  tipo,
  stato,
  completata,
}: {
  tipo: TipoAttivita;
  stato: StatoAttivita;
  completata: boolean;
}) {
  return <Badge tone={TONO[stato]}>{etichettaStato(tipo, stato, completata)}</Badge>;
}
