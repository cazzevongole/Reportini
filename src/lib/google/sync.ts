import {
  aggiornaAppuntamento,
  elencaAppuntamenti,
  marcaAppuntamentoSincronizzato,
  ottieniAppuntamento,
} from "../repo";
import { aggiornaEvento, creaEvento, eliminaEvento } from "./calendar";
import type { Appuntamento, AppuntamentoDettagliato } from "../types";

export interface SyncResult {
  ok: boolean;
  messaggio: string;
}

function aSincronizzabile(appuntamento: Appuntamento | AppuntamentoDettagliato): Appuntamento {
  const {
    anagraficoNome,
    anagraficoCognome,
    anagraficoDocumento,
    relazioneTitolo,
    ...base
  } = appuntamento as AppuntamentoDettagliato;
  const contesto = [
    anagraficoNome ? `Anagrafico: ${anagraficoNome} ${anagraficoCognome ?? ""}`.trim() : "",
    anagraficoDocumento ? `Documento: ${anagraficoDocumento}` : "",
    relazioneTitolo ? `Relazione: ${relazioneTitolo}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  return {
    ...(base as Appuntamento),
    descrizione: [appuntamento.descrizione, contesto].filter(Boolean).join("\n\n"),
  };
}

/** Invia un appuntamento a Google Calendar, creando o aggiornando l'evento. */
export async function sincronizzaAppuntamento(
  id: number,
  calendarId = "primary",
): Promise<SyncResult> {
  const salvato = ottieniAppuntamento(id);
  if (!salvato) return { ok: false, messaggio: "L'appuntamento non esiste più" };
  const appuntamento = aSincronizzabile(salvato);
  try {
    const evento = appuntamento.googleEventId
      ? await aggiornaEvento(
          appuntamento.googleEventId,
          appuntamento,
          appuntamento.googleCalendarId ?? calendarId,
        )
      : await creaEvento(appuntamento, calendarId);
    marcaAppuntamentoSincronizzato(appuntamento.id, {
      googleEventId: evento.id,
      googleCalendarId: appuntamento.googleEventId
        ? appuntamento.googleCalendarId ?? calendarId
        : calendarId,
      googleHtmlLink: evento.htmlLink ?? null,
    });
    return { ok: true, messaggio: "Appuntamento sincronizzato con Google Calendar" };
  } catch (error) {
    return { ok: false, messaggio: spiega(error) };
  }
}

/** Rimuove l'evento remoto e pulisce i marcatori di sincronizzazione locali. */
export async function dissociaAppuntamento(id: number): Promise<SyncResult> {
  const salvato = ottieniAppuntamento(id);
  if (!salvato) return { ok: false, messaggio: "L'appuntamento non esiste più" };
  try {
    if (salvato.googleEventId) {
      await eliminaEvento(salvato.googleEventId, salvato.googleCalendarId ?? "primary");
    }
    aggiornaAppuntamento(salvato.id, {
      ...aSincronizzabile(salvato),
      googleEventId: null,
      googleCalendarId: null,
      googleHtmlLink: null,
      googleSyncAt: null,
    });
    return { ok: true, messaggio: "Appuntamento scollegato da Google Calendar" };
  } catch (error) {
    return { ok: false, messaggio: spiega(error) };
  }
}

/** Invia tutti gli appuntamenti non ancora sincronizzati. */
export async function sincronizzaInAttesa(calendarId = "primary"): Promise<SyncResult> {
  const inAttesa = elencaAppuntamenti().filter(
    (appuntamento) => appuntamento.stato !== "annullato" && !appuntamento.googleEventId,
  );
  if (inAttesa.length === 0) {
    return { ok: true, messaggio: "Non ci sono nuovi appuntamenti da sincronizzare" };
  }
  const errori: string[] = [];
  for (const appuntamento of inAttesa) {
    const risultato = await sincronizzaAppuntamento(appuntamento.id, calendarId);
    if (!risultato.ok) errori.push(`${appuntamento.titolo}: ${risultato.messaggio}`);
  }
  return errori.length
    ? { ok: false, messaggio: `${errori.length} appuntamenti non riusciti: ${errori[0]}` }
    : { ok: true, messaggio: `${inAttesa.length} appuntamenti sincronizzati` };
}

function spiega(error: unknown): string {
  if (error instanceof Error) return error.message;
  return "Errore sconosciuto durante la sincronizzazione";
}
