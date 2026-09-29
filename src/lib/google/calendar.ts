import { accessToken } from "./auth";
import { leggiColori } from "./colori";
import type { Appuntamento, StatoAppuntamento } from "../types";

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
 * Come lo stato dell'appuntamento si legge a occhio.
 *
 * `transparency` dice gia che un evento in attesa non occupa la fascia, ma è
 * una proprietà che si vede solo aprendo l'evento: in elenco due appuntamenti
 * identici, uno in attesa e uno confermato, sembrano uguali. La riga qui sotto
 * la dice subito, e per l'esportazione .ics (dove `transparency` non esiste)
 * è l'unica traccia.
 */
const STATO_SU_EVENTO: Record<StatoAppuntamento, string> = {
  "in-attesa": "in attesa di conferma",
  confermato: "confermato",
  annullato: "annullato",
};

const STATO_ICS: Record<StatoAppuntamento, string> = {
  "in-attesa": "TENTATIVE",
  confermato: "CONFIRMED",
  annullato: "CANCELLED",
};

/**
 * Come un annullato si vede su Google Calendar.
 *
 * `status: "cancelled"` NON va bene: è il modo in cui l'API **elimina** un
 * evento, e nell'interfaccia l'evento sparisce — finisce nel cestino, non
 * compare barrato. Chi guarda l'agenda vede solo che l'appuntamento non c'è
 * più, senza sapere che era stato annullato.
 *
 * Quindi l'annullato resta un evento regolare (`status: "confirmed"`, come gli
 * altri) e si dichiara dove l'utente lo vede: nel **titolo**, col prefisso
 * ANNULLATO, e nel colore — Tomato, il rosso della palette, a meno che
 * l'utente non ne abbia scelto un altro. La riga "Stato: annullato" in
 * descrizione resta per chi apre l'evento.
 */
function aEvento(appuntamento: Appuntamento) {
  // Letta qui e non al modulo: la preferenza può cambiare mentre l'app è
  // aperta, e va letta al momento in cui si scrive l'evento.
  const colori = leggiColori();
  return {
    // L'annullato si dichiara nel titolo: è l'unica cosa che si legge in una
    // vista per mese, senza aprire l'evento. Senza prefisso, l'evento resta
    // identico a un confermato e la cancellazione non si vede.
    summary:
      appuntamento.stato === "annullato"
        ? `ANNULLATO: ${appuntamento.titolo || "Appuntamento"}`
        : appuntamento.titolo || "Appuntamento",
    description: [
      `Stato: ${STATO_SU_EVENTO[appuntamento.stato]}`,
      appuntamento.descrizione,
      appuntamento.luogo ? `Luogo: ${appuntamento.luogo}` : "",
    ]
      .filter(Boolean)
      .join("\n\n"),
    location: appuntamento.luogo || undefined,
    // `status: "cancelled"` eliminerebbe l'evento dall'interfaccia (vedi il
    // commento sopra): l'annullato resta quindi un evento regolare, e la
    // cancellazione si dichiara nel titolo e nel colore.
    status: "confirmed",
    // E "in attesa" è un terzo stato, non una sfumatura di "confermato": un
    // appuntamento da confermare non occupa il tempo. Senza questo, passare
    // da in attesa a confermato non cambiava niente su Google Calendar, e non
    // perché la pubblicazione non partiva: partiva e mandava due volte lo
    // stesso evento.
    //
    // `transparent` è il modo normale di dirlo: l'evento resta in agenda ma
    // non blocca la fascia, e chi guarda l'agenda vede subito la differenza.
    //
    // Prenota solo lo stato "confermato": un annullato scritto *Cancelled* che
    // occupasse il tempo continuerebbe a bloccare la fascia di chi lo cerca,
    // e sarebbe una contraddizione.
    transparency: appuntamento.stato === "confermato" ? "opaque" : "transparent",
    // Il colore è l'ultimo pezzo: con stato e trasparenza l'appuntamento è già
    // distinguibile, ma in una vista per mese riepilogativa — dove un evento è
    // una macchia di colore e nient'altro — era la tonalità dell'app a
    // comunicare lo stato, e quella di Google era casuale. Per l'annullato
    // però il rosso è la scelta di default anche se l'utente ha cambiato il
    // colore: Tomato è la tinta che la palette mette a disposizione per "non si
    // terrà", e l'annullato è il caso in cui il colore ha il compito di
    // urlare, non di accompagnare.
    colorId: appuntamento.stato === "annullato" ? "11" : colori[appuntamento.stato],
    // Il fuso va dichiarato: senza, Google interpreta l'ora nel fuso del
    // calendario di destinazione e un appuntamento delle 10:00 segnato a Roma
    // finisce a un'ora diversa per chi guarda il calendario da un'altra città.
    start: { dateTime: appuntamento.inizio, timeZone: FUSO },
    end: { dateTime: appuntamento.fine, timeZone: FUSO },
    reminders: {
      useDefault: false,
      overrides:
        appuntamento.promemoriaMin > 0
          ? [{ method: "popup", minutes: appuntamento.promemoriaMin }]
          : [],
    },
    extendedProperties: {
      // Anche in forma leggibile da una macchina: `transparency` e `status`
      // coprono solo annullato e occupazione, e non dicono quale dei due stati
      // dell'app sia.
      private: {
        reportiniAppuntamentoId: String(appuntamento.id),
        reportiniStato: appuntamento.stato,
      },
    },
  };
}

export async function creaEvento(
  appuntamento: Appuntamento,
  calendarId = "primary",
): Promise<CalendarEvent> {
  return request<CalendarEvent>(`/calendars/${encodeURIComponent(calendarId)}/events`, {
    method: "POST",
    body: JSON.stringify(aEvento(appuntamento)),
  });
}

export async function aggiornaEvento(
  eventId: string,
  appuntamento: Appuntamento,
  calendarId = "primary",
): Promise<CalendarEvent> {
  return request<CalendarEvent>(
    `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    { method: "PUT", body: JSON.stringify(aEvento(appuntamento)) },
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

/** Download .ics singolo, così l'appuntamento arriva in qualsiasi calendario senza OAuth. */
export function scaricaIcs(appuntamento: Appuntamento): void {
  const uid = `${appuntamento.id}-${Date.now()}@reportini`;
  const righe = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Reportini//IT",
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${dataIcs(new Date().toISOString())}`,
    `DTSTART:${dataIcs(appuntamento.inizio)}`,
    `DTEND:${dataIcs(appuntamento.fine)}`,
    `SUMMARY:${escapeIcs(appuntamento.titolo || "Appuntamento")}`,
    appuntamento.descrizione ? `DESCRIPTION:${escapeIcs(appuntamento.descrizione)}` : "",
    appuntamento.luogo ? `LOCATION:${escapeIcs(appuntamento.luogo)}` : "",
    `STATUS:${STATO_ICS[appuntamento.stato]}`,
    "BEGIN:VALARM",
    "TRIGGER:-PT30M",
    "ACTION:DISPLAY",
    `DESCRIPTION:${escapeIcs(appuntamento.titolo || "Appuntamento")}`,
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ].filter(Boolean);
  scaricaTesto(
    `${slug(appuntamento.titolo || "appuntamento")}.ics`,
    righe.join("\r\n"),
    "text/calendar",
  );
}

export function scaricaTuttiGliAppuntamenti(appuntamenti: Appuntamento[]): void {
  const eventi = appuntamenti.map((appuntamento) =>
    [
      "BEGIN:VEVENT",
      `UID:${appuntamento.id}@reportini`,
      `DTSTAMP:${dataIcs(new Date().toISOString())}`,
      `DTSTART:${dataIcs(appuntamento.inizio)}`,
      `DTEND:${dataIcs(appuntamento.fine)}`,
      `SUMMARY:${escapeIcs(appuntamento.titolo || "Appuntamento")}`,
      // Nell'ics lo stato lo dice `STATUS`, che è il campo standard: qui non
      // serve anche la riga nella descrizione.
      appuntamento.descrizione ? `DESCRIPTION:${escapeIcs(appuntamento.descrizione)}` : "",
      appuntamento.luogo ? `LOCATION:${escapeIcs(appuntamento.luogo)}` : "",
      `STATUS:${STATO_ICS[appuntamento.stato]}`,
      "END:VEVENT",
    ]
      .filter(Boolean)
      .join("\r\n"),
  );
  scaricaTesto(
    "appuntamenti-reportini.ics",
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

export function scaricaTesto(nome: string, contenuto: string, tipo: string): void {
  const blob = new Blob([contenuto], { type: `${tipo};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = nome;
  link.click();
  URL.revokeObjectURL(url);
}
