/**
 * Un recapito cliccabile: telefono con `tel:`, email con `mailto:`.
 *
 * Sta in un componente perché i recapiti compaiono in quattro posti (scheda
 * azienda, lista dei referenti, dettaglio dell'attività, dettaglio del
 * report) e la regola da non sbagliare è la stessa in tutti: il numero
 * ripulito dal formato con cui è stato scritto, l'email come sta.
 *
 * Il telefono è la parte con la trappola. `tel:+3901234567890` funziona,
 * `tel:340 123 4567` no sulla maggior parte dei dispositivi, e
 * `tel:040 1234567` non funziona dall'estero. Qui si tiene solo ciò che si
 * può digitare — il `+` iniziale, le cifre, i separatori — che è l'unica
 * forma che ogni telefono capisce.
 *
 * Il link ha l'aspetto del testo, non della capsula blu: in una scheda
 * azienda una riga di dati non è un indice, e un hyperlink colorato
 * sembrerebbe una voce di menu. Il colore cambia solo all'hover, per far
 * capire che si può premere.
 */

export type TipoRecapito = "telefono" | "email";

/**
 * Il numero come va digitato: solo il che si può premere sul tastierino.
 *
 * Si aggiunge `+39` davanti, e basta: lo `0` dei numeri di terra **resta**,
 * perché fa parte del numero (`040 1234567` è `+390401234567`, non
 * `+39401234567`). Sostituirlo era un errore silenzioso: il link continuava
 * a sembrare un link, e sul cellulare semplicemente non squillava.
 *
 * Un numero con `+` davanti è già internazionale e resta com'è.
 */
export function numeroTelefonico(valore: string): string {
  const ripulito = valore.replace(/[^\d+]/g, "");
  return ripulito.startsWith("+") ? ripulito : `+39${ripulito}`;
}

/** L'indirizzo come va messo in `mailto:`. */
export function indirizzoEmail(valore: string): string {
  return valore.trim();
}

export default function Recapito({
  tipo,
  valore,
  className = "",
}: {
  tipo: TipoRecapito;
  valore: string;
  className?: string;
}) {
  const testo = valore.trim();
  if (!testo) return null;

  const href =
    tipo === "telefono" ? `tel:${numeroTelefonico(testo)}` : `mailto:${indirizzoEmail(testo)}`;
  // L'etichetta accessibile dice cosa succede, non solo qual è il numero:
  // altrimenti un link che legge "340 1234567" non dice che cosa fa.
  const etichetta = tipo === "telefono" ? `Chiama il ${testo}` : `Scrivi a ${testo}`;

  return (
    <a
      href={href}
      aria-label={etichetta}
      onClick={(event) => event.stopPropagation()}
      className={`break-words text-brand-700 underline decoration-brand-700/30 underline-offset-2 transition-colors hover:decoration-brand-700 ${className}`}
    >
      {testo}
    </a>
  );
}
