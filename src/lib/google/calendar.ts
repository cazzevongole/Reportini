import { accessToken } from "./auth";
import { leggiColori } from "./colori";
import {
  etichettaStato,
  rigaStatoEvento,
  titoloEvento,
  type Attivita,
  type StatoAttivita,
} from "../types";

const API = "https://www.googleapis.com/calendar/v3";

/**
 * Fuso orario del dispositivo. Le date sono salvate come ISO con l'ora
 * locale, quindi è questo il fuso in cui vanno lette.
 */
const FUSO = Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/Rome";

export interface CalendarEvent {
  id: string;
  htmlLink?: string;
  summary?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
}

/**
 * Errore di Google Calendar, con il codice HTTP accanto al messaggio.
 *
 * Serve a distinguere i fallimenti veri da quelli che sono solo l'evento che
 * non c'è più: `404 Gone` e `410` dicono che la risorsa non esiste, e in quel
 * caso la cancellazione che l'utente ha chiesto è **già stata fatta**. Con
 * una stringa sola non era distinguibile, e un 410 finiva come qualsiasi
 * altro errore di rete.
 */
export class ErroreGoogle extends Error {
  readonly stato: number;

  constructor(stato: number, messaggio: string) {
    super(messaggio);
    this.name = "ErroreGoogle";
    this.stato = stato;
  }
}

/** L'evento che Google non ha più:Gone e Not Found sono la stessa cosa qui. */
export function eventoMancante(errore: unknown): boolean {
  return errore instanceof ErroreGoogle && (errore.stato === 404 || errore.stato === 410);
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = await accessToken();
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new ErroreGoogle(
      response.status,
      `Google Calendar (${response.status}): ${detail.slice(0, 180)}`,
    );
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
} /**
 * Come lo stato dell'attività si legge a occhio.
 *
 * `transparency` dice gia che un evento in attesa non occupa la fascia, ma è
 * una proprietà che si vede solo aprendo l'evento: in elenco due attivita
 * identici, uno in attesa e uno confermato, sembrano uguali. La riga qui sotto
 * la dice subito, e per l'esportazione .ics (dove `transparency` non esiste)
 * è l'unica traccia.
 */
const STATO_ICS: Record<StatoAttivita, string> = {
  "in-attesa": "TENTATIVE",
  confermato: "CONFIRMED",
  annullato: "CANCELLED",
};

/**
 * Come un annullato si vede su Google Calendar.
 *
 * `status: "cancelled"` NON va bene: è il modo in cui l'API **elimina** un
 * evento, e nell'interfaccia l'evento sparisce — finisce nel cestino, non
 * compare barrato. Chi guarda l'agenda vede solo che l'attività non c'è
 * più, senza sapere che era stato annullato.
 *
 * Quindi l'annullato resta un evento regolare (`status: "confirmed"`, come gli
 * altri) e si dichiara dove l'utente lo vede: nel **titolo**, col prefisso
 * ANNULLATO, e nel colore — Tomato, il rosso della palette, a meno che
 * l'utente non ne abbia scelto un altro. La riga "Stato: annullato" in
 * descrizione resta per chi apre l'evento.
 */
/**
 * Se l'evento blocca la fascia oraria.
 *
 * Un annullato non occupa mai: è un appuntamento che non ci sarà, e se
 * tenesse l'ora qualcun altro non potrebbe segnarsela.
 *
 * Una chiamata occupa **sempre**: se l'hai messa in agenda per le 15, le 15
 * sono tue, e l'evento non può presentarsi come un segnaposto che si può
 * ignorare. Per l'appuntamento resta la distinzione che c'èra — in attesa
 * non prenota, confermato prenota — perché là un appuntamento che
 * nessuno ha ancora confermato.
 */
function occupaFascia(attivita: Attivita): "opaque" | "transparent" {
  if (attivita.stato === "annullato") return "transparent";
  if (attivita.tipo === "chiamata") return "opaque";
  return attivita.stato === "confermato" ? "opaque" : "transparent";
}

function aEvento(attivita: Attivita) {
  // Letta qui e non al modulo: la preferenza può cambiare mentre l'app è
  // aperta, e va letta al momento in cui si scrive l'evento.
  const colori = leggiColori();
  return {
    // L'annullato si dichiara nel titolo: è l'unica cosa che si legge in una
    // vista per mese, senza aprire l'evento. Senza prefisso, l'evento resta
    // identico a un confermato e la cancellazione non si vede.
    summary:
      attivita.stato === "annullato"
        ? `ANNULLATO: ${titoloEvento(attivita.tipo, attivita.titolo)}`
        : titoloEvento(attivita.tipo, attivita.titolo),
    description: [
      rigaStatoEvento(attivita.tipo, attivita.stato, attivita.completata),
      attivita.descrizione,
      attivita.luogo ? `Luogo: ${attivita.luogo}` : "",
    ]
      .filter(Boolean)
      .join("\n\n"),
    location: attivita.luogo || undefined,
    // `status: "cancelled"` eliminerebbe l'evento dall'interfaccia (vedi il
    // commento sopra): l'annullato resta quindi un evento regolare, e la
    // cancellazione si dichiara nel titolo e nel colore.
    status: "confirmed",
    // E "in attesa" è un terzo stato, non una sfumatura di "confermato": un
    // attivita da confermare non occupa il tempo. Senza questo, passare
    // da in attesa a confermato non cambiava niente su Google Calendar, e non
    // perché la pubblicazione non partiva: partiva e mandava due volte lo
    // stesso evento.
    //
    // `transparent` è il modo normale di dirlo: l'evento resta in agenda ma
    // non blocca la fascia, e chi guarda l'agenda vede subito la differenza.
    //
    // Prenota solo lo stato "confermato", e per una chiamata anche quando
    // non è ancora fatta: vedi `occupaFascia` sotto.
    transparency: occupaFascia(attivita),
    // Il colore è l'ultimo pezzo: con stato e trasparenza l'attività è già
    // distinguibile, ma in una vista per mese riepilogativa — dove un evento è
    // una macchia di colore e nient'altro — era la tonalità dell'app a
    // comunicare lo stato, e quella di Google era casuale. Per l'annullato
    // però il rosso è la scelta di default anche se l'utente ha cambiato il
    // colore: Tomato è la tinta che la palette mette a disposizione per "non si
    // terrà", e l'annullato è il caso in cui il colore ha il compito di
    // urlare, non di accompagnare.
    colorId: attivita.stato === "annullato" ? "11" : colori[attivita.stato],
    // Il fuso va dichiarato: senza, Google interpreta l'ora nel fuso del
    // calendario di destinazione e un'attività delle 10:00 segnato a Roma
    // finisce a un'ora diversa per chi guarda il calendario da un'altra città.
    start: { dateTime: attivita.inizio, timeZone: FUSO },
    end: { dateTime: attivita.fine, timeZone: FUSO },
    // Il promemoria è una decisione che si prende sul momento della
    // chiamata, non un anticipo da programmare: arriva quando suona. Per
    // questo è un campo dell'appuntamento e non della chiamata, e qui non se
    // ne scrive nessuno — nemmeno quello di default, che altrimenti
    // ripartirebbe a ogni modifica.
    reminders: {
      useDefault: false,
      overrides:
        attivita.tipo !== "chiamata" && attivita.promemoriaMin > 0
          ? [{ method: "popup", minutes: attivita.promemoriaMin }]
          : [],
    },
    extendedProperties: {
      // Anche in forma leggibile da una macchina: `transparency` e `status`
      // coprono solo annullato e occupazione, e non dicono quale dei due stati
      // dell'app sia.
      private: {
        reportiniAttivitaId: String(attivita.id),
        reportiniStato: attivita.stato,
        // La chiamata ha una parola in più delle tre: "fatta" non è
        // "confermato". Senza questo, chi legge le proprietà private su una
        // chiamata vede un termine che non è quello che c'è scritto
        // nell'app e nel titolo.
        reportiniEtichetta: etichettaStato(attivita.tipo, attivita.stato, attivita.completata),
      },
    },
  };
}

export async function creaEvento(
  attivita: Attivita,
  calendarId = "primary",
): Promise<CalendarEvent> {
  return request<CalendarEvent>(`/calendars/${encodeURIComponent(calendarId)}/events`, {
    method: "POST",
    body: JSON.stringify(aEvento(attivita)),
  });
}

export async function aggiornaEvento(
  eventId: string,
  attivita: Attivita,
  calendarId = "primary",
): Promise<CalendarEvent> {
  return request<CalendarEvent>(
    `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    { method: "PUT", body: JSON.stringify(aEvento(attivita)) },
  );
}

export async function eliminaEvento(eventId: string, calendarId = "primary"): Promise<void> {
  await request<void>(
    `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    { method: "DELETE" },
  );
}

/* ----------------------------- Export .ics ------------------------------- */

function dataIcs(iso: string): string {
  return new Date(iso)
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");
}

function escapeIcs(value: string): string {
  return value.replace(/([,;\\])/g, "\\$1").replace(/\n/g, "\\n");
}

/** Download .ics singolo, così l'attività arriva in qualsiasi calendario senza OAuth. */
export function scaricaIcs(attivita: Attivita): void {
  const uid = `${attivita.id}-${Date.now()}@reportini`;
  const righe = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Reportini//IT",
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${dataIcs(new Date().toISOString())}`,
    `DTSTART:${dataIcs(attivita.inizio)}`,
    `DTEND:${dataIcs(attivita.fine)}`,
    `SUMMARY:${escapeIcs(titoloEvento(attivita.tipo, attivita.titolo))}`,
    attivita.descrizione ? `DESCRIPTION:${escapeIcs(attivita.descrizione)}` : "",
    attivita.luogo ? `LOCATION:${escapeIcs(attivita.luogo)}` : "",
    `STATUS:${STATO_ICS[attivita.stato]}`,
    "BEGIN:VALARM",
    "TRIGGER:-PT30M",
    "ACTION:DISPLAY",
    `DESCRIPTION:${escapeIcs(titoloEvento(attivita.tipo, attivita.titolo))}`,
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ].filter(Boolean);
  scaricaTesto(
    `${slug(titoloEvento(attivita.tipo, attivita.titolo))}.ics`,
    righe.join("\r\n"),
    "text/calendar",
  );
}

export function scaricaTutteLeAttivita(attivita: Attivita[]): void {
  const eventi = attivita.map((attivita) =>
    [
      "BEGIN:VEVENT",
      `UID:${attivita.id}@reportini`,
      `DTSTAMP:${dataIcs(new Date().toISOString())}`,
      `DTSTART:${dataIcs(attivita.inizio)}`,
      `DTEND:${dataIcs(attivita.fine)}`,
      `SUMMARY:${escapeIcs(titoloEvento(attivita.tipo, attivita.titolo))}`,
      // Nell'ics lo stato lo dice `STATUS`, che è il campo standard: qui non
      // serve anche la riga nella descrizione.
      attivita.descrizione ? `DESCRIPTION:${escapeIcs(attivita.descrizione)}` : "",
      attivita.luogo ? `LOCATION:${escapeIcs(attivita.luogo)}` : "",
      `STATUS:${STATO_ICS[attivita.stato]}`,
      "END:VEVENT",
    ]
      .filter(Boolean)
      .join("\r\n"),
  );
  scaricaTesto(
    "attivita-reportini.ics",
    [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Reportini//IT",
      "CALSCALE:GREGORIAN",
      ...eventi,
      "END:VCALENDAR",
    ].join("\r\n"),
    "text/calendar",
  );
}

function slug(value: string): string {
  return (
    value
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "")
      .slice(0, 48) || "evento"
  );
}

/**
 * Fa partire il download di un file di testo.
 *
 * Non è più esportata: il `.txt` dei report è stato tolto, e l'unico uso che
 * resta sono i `.ics`. Un export che nessuno importa è una porta aperta che
 * nessuno attraversa.
 */
function scaricaTesto(nome: string, contenuto: string, tipo: string): void {
  const blob = new Blob([contenuto], { type: `${tipo};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = nome;
  link.click();
  URL.revokeObjectURL(url);
}
