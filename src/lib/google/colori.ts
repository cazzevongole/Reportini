import type { StatoAttivita } from "../types";
import { eliminaPreferenza, leggiPreferenza, scriviPreferenza } from "../repo";

/**
 * La palette dei colori che Google Calendar offre a un evento.
 *
 * Gli ID sono quelli della palette **globale**: 1 Lavender, 2 Sage, 3 Grape,
 * 4 Flamingo, 5 Banana, 6 Tangerine, 7 Peacock, 8 Graphite, 9 Blueberry,
 * 10 Basil, 11 Tomato. Un ID fuori da questo elenco viene rifiutato
 * dall'API, quindi non è una bella dicitura ma un vincolo.
 *
 * `colorId` è una **stringa**, non un numero: inviata come numero Google
 * risponde 400.
 */
export interface ColorePalette {
  id: string;
  nome: string;
  /** Tinta campionata, per mostrare la scelta in modo leggibile. */
  campione: string;
}

export const PALETTE: ColorePalette[] = [
  { id: "1", nome: "Lavender", campione: "#7986cb" },
  { id: "2", nome: "Sage", campione: "#33b679" },
  { id: "3", nome: "Grape", campione: "#8e24aa" },
  { id: "4", nome: "Flamingo", campione: "#e67c73" },
  { id: "5", nome: "Banana", campione: "#fbd75b" },
  { id: "6", nome: "Tangerine", campione: "#ffb878" },
  { id: "7", nome: "Peacock", campione: "#039be5" },
  { id: "8", nome: "Graphite", campione: "#616161" },
  { id: "9", nome: "Blueberry", campione: "#3f51b5" },
  { id: "10", nome: "Basil", campione: "#0b8043" },
  { id: "11", nome: "Tomato", campione: "#d50000" },
];

const ID_VALIDI = new Set(PALETTE.map((colore) => colore.id));

/** Il colore di un ID della palette, se l'ID esiste. */
export function colorePer(id: string): ColorePalette | null {
  return PALETTE.find((colore) => colore.id === id) ?? null;
}

/** Esiste questo ID nella palette? È ciò che tiene lontani i valori inventati. */
export function idValido(id: unknown): id is string {
  return typeof id === "string" && ID_VALIDI.has(id);
}

/**
 * I colori di partenza, scelti per somigliare alle tonalità che l'app usa già:
 * Sage sta al verde del brand, Tangerine all'arancio del clay, Graphite al
 * grigio del muted. Agenda ed elenco dicono la stessa cosa con lo stesso
 * colore.
 */
export const COLORI_PREDEFINITI: Record<StatoAttivita, string> = {
  "in-attesa": "6",
  confermato: "2",
  annullato: "8",
};

/** Come si chiama uno stato nelle impostazioni. */
export const ETICHETTA_STATO: Record<StatoAttivita, string> = {
  "in-attesa": "In attesa di conferma",
  confermato: "Confermato",
  annullato: "Annullato",
};

/**
 * La preferenza sta in una riga sola: tre stati in un oggetto JSON. Una riga
 * per stato would add table churn per una cosa che si cambia una volta.
 */
const CHIAVE = "colori-stato";

export type ColoriPerStato = Record<StatoAttivita, string>;

/**
 * I colori scelti dall'utente, con i predefiniti per quello che non ha ancora
 * scelto. La preferenza sta nel **database**, che sale nel cloud e si
 * ripristina su un altro dispositivo: la scelta segue l'utenza, non la
 * macchina.
 *
 * Il valore è validato **in lettura**: arriva da un file SQLite che può essere
 * una copia ripristinata da un backup o scritta da una versione diversa, e un
 * ID inesistente finito nell'evento farebbe rispondere 400 a Google — cioè
 * l'attività non sarebbe pubblicato, per un colore. Meglio il predefinito.
 */
export function leggiColori(): ColoriPerStato {
  const scelti: ColoriPerStato = { ...COLORI_PREDEFINITI };
  const grezzo = leggiPreferenza(CHIAVE);
  if (!grezzo) return scelti;
  try {
    const letto: unknown = JSON.parse(grezzo);
    if (!letto || typeof letto !== "object" || Array.isArray(letto)) return scelti;
    const valori = letto as Partial<Record<StatoAttivita, unknown>>;
    for (const stato of Object.keys(COLORI_PREDEFINITI) as StatoAttivita[]) {
      if (idValido(valori[stato])) scelti[stato] = valori[stato];
    }
  } catch {
    // JSON illeggibile: si parte dai predefiniti, che è sempre una scelta
    // valida. Un colore sbagliato non deve bloccare la pubblicazione.
  }
  return scelti;
}

/** Salva un colore. Un ID inesistente non viene scritto: si rimane sui dati buoni. */
export function scriviColore(stato: StatoAttivita, id: string): void {
  if (!idValido(id)) return;
  const scelti = leggiColori();
  scelti[stato] = id;
  scriviPreferenza(CHIAVE, JSON.stringify(scelti));
}

/** Torna ai colori di partenza: la riga del database non c'è più. */
export function ripristinaColori(): void {
  eliminaPreferenza(CHIAVE);
}
