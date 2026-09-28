import { accessToken } from "./auth";
import type { Appuntamento } from "../types";

const API = "https://www.googleapis.com/calendar/v3";

/**
 * Fuso orario del dispositivo. Le date sono salvate come ISO con l'ora
 * locale, quindi è questo il fuso in cui vanno lette.
 */
const FUSO = Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/Rome";

export interface CalendarInfo {
  id: string;
  summary: string;
  primary: boolean;
  accessRole?: string;
}

export interface CalendarEvent {
  id: string;
  htmlLink?: string;
  summary?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
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
    throw new Error(`Google Calendar (${response.status}): ${detail.slice(0, 180)}`);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export async function elencaCalendar(): Promise<CalendarInfo[]> {
  const data = await request<{ items?: CalendarInfo[] }>("/users/me/calendarList");
  return data.items ?? [];
}

function aEvento(appuntamento: Appuntamento) {
  return {
    summary: appuntamento.titolo || "Appuntamento",
    description: [
      appuntamento.descrizione,
      appuntamento.luogo ? `Luogo: ${appuntamento.luogo}` : "",
    ]
      .filter(Boolean)
      .join("\n\n"),
    location: appuntamento.luogo || undefined,
    // Lo stato dell'appuntamento viaggia con l'evento. Un annullato in Google
    // Calendar non è sparito: è scritto "Cancelled" nella sua fascia, e
    // l'app e il calendario dicono la stessa cosa. Cancellarlo del tutto
    // farebbe sparire la traccia di un appuntamento che è esistito.
    status: appuntamento.stato === "annullato" ? "cancelled" : "confirmed",
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
      private: { reportiniAppuntamentoId: String(appuntamento.id) },
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

export async function eventiTra(da: string, a: string, calendarId = "primary") {
  const params = new URLSearchParams({
    timeMin: da,
    timeMax: a,
    singleEvents: "true",
    orderBy: "startTime",
    maxResults: "250",
  });
  return request<{ items?: CalendarEvent[] }>(
    `/calendars/${encodeURIComponent(calendarId)}/events?${params.toString()}`,
  );
}

/* ----------------------------- Export .ics ------------------------------- */

function dataIcs(iso: string): string {
  return new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
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
    `STATUS:${appuntamento.stato === "annullato" ? "CANCELLED" : "CONFIRMED"}`,
    "BEGIN:VALARM",
    "TRIGGER:-PT30M",
    "ACTION:DISPLAY",
    `DESCRIPTION:${escapeIcs(appuntamento.titolo || "Appuntamento")}`,
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ].filter(Boolean);
  scaricaTesto(`${slug(appuntamento.titolo || "appuntamento")}.ics`, righe.join("\r\n"), "text/calendar");
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
      appuntamento.descrizione ? `DESCRIPTION:${escapeIcs(appuntamento.descrizione)}` : "",
      appuntamento.luogo ? `LOCATION:${escapeIcs(appuntamento.luogo)}` : "",
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
