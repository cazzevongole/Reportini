import {
  eliminaAppuntamento,
  elencaAppuntamenti,
  marcaAppuntamentoSincronizzato,
  marcaErroreGoogle,
  ottieniAppuntamento,
  rimuoviCollegamentoGoogle,
} from "../repo";
import {
  aggiornaEvento,
  creaEvento,
  eliminaEvento,
  eventoMancante,
  type CalendarEvent,
} from "./calendar";
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
    descrizione: descrizioneConContesto(appuntamento.descrizione, contesto),
  };
}

/**
 * Aggiunge il contesto dell'anagrafico, una volta sola.
 *
 * Il contesto non sta nella descrizione salvata: sta solo nell'evento. Ma
 * può esserci già dentro, perché le versioni precedenti scrivevano qui
 * l'appuntamento arricchito e il modulo di modifica lo mostrava. Senza
 * questo controllo, ogni sincronizzazione avrebbe aggiunto un blocco in più
 * e la descrizione sarebbe cresciuta a ogni modifica.
 */
function descrizioneConContesto(descrizione: string, contesto: string): string {
  if (!contesto) return descrizione;
  let testo = (descrizione ?? "").trimEnd();
  const suffisso = `\n\n${contesto}`;
  // Si toglie ogni copia finale, non solo l'ultima: la ripetizione è
  // esattamente il danno da riparare, e fermarsi alla prima lascerebbe
  // indietro quelle già accumulate.
  while (testo.endsWith(suffisso)) testo = testo.slice(0, -suffisso.length);
  // Una descrizione ridotta al solo contesto non aveva testo proprio.
  if (testo === contesto) testo = "";
  return [testo, contesto].filter(Boolean).join("\n\n");
}

/** Invia un appuntamento a Google Calendar, creando o aggiornando l'evento. */
export async function sincronizzaAppuntamento(
  id: number,
  calendarId = "primary",
): Promise<SyncResult> {
  const salvato = ottieniAppuntamento(id);
  if (!salvato) return { ok: false, messaggio: "L'appuntamento non esiste più" };
  const appuntamento = aSincronizzabile(salvato);
  const calendario = appuntamento.googleCalendarId ?? calendarId;
  try {
    let evento: CalendarEvent;
    if (!appuntamento.googleEventId) {
      evento = await creaEvento(appuntamento, calendario);
    } else {
      try {
        evento = await aggiornaEvento(appuntamento.googleEventId, appuntamento, calendario);
      } catch (errore) {
        // L'utente ha cancellato l'evento direttamente su Google Calendar: il
        // collegamento punta a qualcosa che non esiste più. Senza questo, ogni
        // modifica successiva riceverebbe lo stesso 404 e l'appuntamento
        // resterebbe bloccato per sempre, con l'evento che non c'è. Qui
        // l'evento viene ricreato: è quello che l'utente si aspetta salvando,
        // e non si duplica nulla perché il precedente non è più in agenda.
        if (!eventoMancante(errore)) throw errore;
        console.warn(
          `google-calendar: l'evento ${appuntamento.googleEventId} non esiste più, se ne crea uno nuovo`,
        );
        evento = await creaEvento(appuntamento, calendario);
      }
    }
    marcaAppuntamentoSincronizzato(appuntamento.id, {
      googleEventId: evento.id,
      googleCalendarId: calendario,
      googleHtmlLink: evento.htmlLink ?? null,
    });
    return { ok: true, messaggio: "Appuntamento sincronizzato con Google Calendar" };
  } catch (error) {
    const messaggio = spiega(error);
    // Il motivo resta sull'appuntamento: è l'unica traccia che sopravvive
    // all'avviso e al riavvio, ed è quella che dice se il problema è la rete,
    // i permessi o il token.
    marcaErroreGoogle(appuntamento.id, messaggio);
    console.error("google-calendar: sincronizzazione fallita —", messaggio);
    return { ok: false, messaggio };
  }
}

/**
 * Pubblicazione automatica, quella che fa il modulo a ogni salvataggio.
 *
 * Non è un semplice `sincronizzaAppuntamento`: qui si decide *cosa* fare
 * guardando lo stato. Un appuntamento già pubblicato viene aggiornato e non
 * duplicato, e uno annullato viene **segnato annullato** sull'evento invece
 * che cancellato: è quello che distingue "non si è più tenuto" da "non è
 * mai esistito", e fa sì che l'app e il calendario non si contraddicano.
 */
export async function pubblicaAppuntamento(
  id: number,
  calendarId = "primary",
): Promise<SyncResult> {
  const salvato = ottieniAppuntamento(id);
  if (!salvato) return { ok: false, messaggio: "L'appuntamento non esiste più" };
  if (salvato.stato === "annullato" && !salvato.googleEventId) {
    return { ok: true, messaggio: "Appuntamento annullato: non era su Google Calendar" };
  }
  const esito = await sincronizzaAppuntamento(id, calendarId);
  if (!esito.ok) return esito;
  if (salvato.stato === "annullato") {
    return { ok: true, messaggio: "Appuntamento segnato come annullato su Google Calendar" };
  }
  return {
    ok: true,
    messaggio: salvato.googleEventId
      ? `Appuntamento aggiornato su Google Calendar${inAttesaDi(salvato) ? " (in attesa)" : ""}`
      : `Appuntamento pubblicato su Google Calendar${inAttesaDi(salvato) ? " (in attesa)" : ""}`,
  };
}

function inAttesaDi(appuntamento: Appuntamento): boolean {
  return appuntamento.stato === "in-attesa";
}

/** Rimuove l'evento remoto e pulisce i marcatori di sincronizzazione locali. */
export async function dissociaAppuntamento(
  id: number,
  calendarId = "primary",
): Promise<SyncResult> {
  const salvato = ottieniAppuntamento(id);
  if (!salvato) return { ok: false, messaggio: "L'appuntamento non esiste più" };
  try {
    if (salvato.googleEventId) {
      await eliminaEvento(
        salvato.googleEventId,
        salvato.googleCalendarId ?? calendarId,
      );
    }
  } catch (error) {
    // Se l'evento non c'è più, lo scollegamento è riuscito: il collegamento
    // è a un evento che non esiste, quindi toglierlo è esattamente quello che
    // l'utente voleva. Fallire qui lo lascerebbe collegato per sempre, a un
    // evento che non si può più toccare.
    if (!eventoMancante(error)) return { ok: false, messaggio: spiega(error) };
  }
  // Solo i marcatori di Google: l'appuntamento non si tocca. Riscriverlo
  // porterebbe nel database la descrizione arricchita che va solo
  // all'evento, e il modulo di modifica la mostrerebbe con dentro il
  // contesto dell'anagrafico — che si accoderebbe a ogni passaggio.
  rimuoviCollegamentoGoogle(salvato.id);
  return {
    ok: true,
    messaggio: "Appuntamento scollegato da Google Calendar",
  };
}

/**
 * Cancella l'appuntamento e, se c'era, anche l'evento che ne era stato creato.
 *
 * L'ordine è quello che sembra controintuitivo e non lo è: prima l'evento,
 * poi l'appuntamento. Se la rete fallisce l'appuntamento **resta in lista**,
 * con l'avviso che spiega il motivo, e premere di nuovo Elimina riprova. Il
 * contrario — cancellare in locale e fallire la rete — lascerebbe un evento
 * orfano in agenda del quale l'app non saprebbe più niente: impossibile
 * ritrovarlo e impossibile toglierlo.
 */
export async function eliminaAppuntamentoEEvento(id: number): Promise<SyncResult> {
  const salvato = ottieniAppuntamento(id);
  if (!salvato) return { ok: true, messaggio: "L'appuntamento era già stato eliminato" };
  try {
    if (salvato.googleEventId) {
      await eliminaEvento(salvato.googleEventId, salvato.googleCalendarId ?? "primary");
    }
  } catch (error) {
    // Se l'utente ha cancellato l'evento direttamente da Google Calendar,
    // l'evento non c'è più: toglierlo dall'agenda è ** già riuscito**, e
    // trattenere l'appuntamento per questo impedirebbe di eliminarlo del tutto
    // — ogni nuovo tentativo riceverebbe lo stesso 410. È il caso in cui il
    // calendario e l'app sono d'accordo sul fatto che l'evento non esiste, e va
    // trattato come quello che è.
    if (!eventoMancante(error)) {
      return {
        ok: false,
        messaggio: `L'appuntamento non è stato eliminato: ${spiega(error)}`,
      };
    }
  }
  eliminaAppuntamento(salvato.id);
  return {
    ok: true,
    messaggio: salvato.googleEventId
      ? "Appuntamento eliminato, evento rimosso anche da Google Calendar"
      : "Appuntamento eliminato",
  };
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
