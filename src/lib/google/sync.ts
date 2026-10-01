import {
  eliminaAttivita,
  elencaAttivita,
  marcaAttivitaSincronizzata,
  marcaErroreGoogle,
  ottieniAttivita,
  rimuoviCollegamentoGoogle,
} from "../repo";
import {
  aggiornaEvento,
  creaEvento,
  eliminaEvento,
  eventoMancante,
  type CalendarEvent,
} from "./calendar";
import type { Attivita, AttivitaDettagliata } from "../types";

export interface SyncResult {
  ok: boolean;
  messaggio: string;
}

/**
 * La riga da mandare a Google, senza il contesto dell'azienda.
 *
 * Il contesto viene aggiunto qui e non resta nel database: è roba dell'evento,
 * e salvarlo significherebbe ritrovarselo nel modulo di modifica e accodarlo a
 * ogni passaggio.
 */
function aSincronizzabile(attivita: Attivita | AttivitaDettagliata): Attivita {
  const { aziendaRagioneSociale, aziendaPartitaIva, ...base } = attivita as AttivitaDettagliata;
  const contesto = [
    aziendaRagioneSociale ? `Azienda: ${aziendaRagioneSociale}` : "",
    aziendaPartitaIva ? `Partita Iva: ${aziendaPartitaIva}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  return {
    ...(base as Attivita),
    descrizione: descrizioneConContesto(attivita.descrizione, contesto),
  };
}

/**
 * Aggiunge il contesto dell'azienda, una volta sola.
 *
 * Il contesto non sta nella descrizione salvata: sta solo nell'evento. Ma
 * può esserci già dentro, perché le versioni precedenti scrivevano qui
 * l'attività arricchita e il modulo di modifica lo mostrava. Senza questo
 * controllo, ogni sincronizzazione avrebbe aggiunto un blocco in più e la
 * descrizione sarebbe cresciuta a ogni modifica.
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

/** Invia un'attività a Google Calendar, creando o aggiornando l'evento. */
export async function sincronizzaAttivita(id: number, calendarId = "primary"): Promise<SyncResult> {
  const salvato = ottieniAttivita(id);
  if (!salvato) return { ok: false, messaggio: "L'attività non esiste più" };
  const attivita = aSincronizzabile(salvato);
  const calendario = attivita.googleCalendarId ?? calendarId;
  try {
    let evento: CalendarEvent;
    if (!attivita.googleEventId) {
      evento = await creaEvento(attivita, calendario);
    } else {
      try {
        evento = await aggiornaEvento(attivita.googleEventId, attivita, calendario);
      } catch (errore) {
        // L'utente ha cancellato l'evento direttamente su Google Calendar: il
        // collegamento punta a qualcosa che non esiste più. Senza questo, ogni
        // modifica successiva riceverebbe lo stesso 404 e l'attività resterebbe
        // bloccata per sempre, con l'evento che non c'è. Qui l'evento viene
        // ricreato: è quello che l'utente si aspetta salvando, e non si
        // duplica nulla perché il precedente non è più in agenda.
        if (!eventoMancante(errore)) throw errore;
        console.warn(
          `google-calendar: l'evento ${attivita.googleEventId} non esiste più, se ne crea uno nuovo`,
        );
        evento = await creaEvento(attivita, calendario);
      }
    }
    marcaAttivitaSincronizzata(attivita.id, {
      googleEventId: evento.id,
      googleCalendarId: calendario,
      googleHtmlLink: evento.htmlLink ?? null,
    });
    return { ok: true, messaggio: "Attività sincronizzata con Google Calendar" };
  } catch (error) {
    const messaggio = spiega(error);
    // Il motivo resta sull'attività: è l'unica traccia che sopravvive
    // all'avviso e al riavvio, ed è quella che dice se il problema è la rete,
    // i permessi o il token.
    marcaErroreGoogle(attivita.id, messaggio);
    console.error("google-calendar: sincronizzazione fallita —", messaggio);
    return { ok: false, messaggio };
  }
}

/**
 * Pubblicazione automatica, quella che fa il modulo a ogni salvataggio.
 *
 * Non è un semplice `sincronizzaAttivita`: qui si decide *cosa* fare
 * guardando lo stato. Un'attività già pubblicata viene aggiornata e non
 * duplicata, e una annullata viene **segnalata annullata** sull'evento invece
 * che cancellata: è quello che distingue "non si è più tenuto" da "non è
 * mai esistito", e fa sì che l'app e il calendario non si contraddicano.
 */
export async function pubblicaAttivita(id: number, calendarId = "primary"): Promise<SyncResult> {
  const salvato = ottieniAttivita(id);
  if (!salvato) return { ok: false, messaggio: "L'attività non esiste più" };
  if (salvato.stato === "annullato" && !salvato.googleEventId) {
    return { ok: true, messaggio: "Attività annullata: non era su Google Calendar" };
  }
  const esito = await sincronizzaAttivita(id, calendarId);
  if (!esito.ok) return esito;
  if (salvato.stato === "annullato") {
    return { ok: true, messaggio: "Attività segnata come annullata su Google Calendar" };
  }
  return {
    ok: true,
    messaggio: salvato.googleEventId
      ? `Attività aggiornata su Google Calendar${inAttesaDi(salvato) ? " (in attesa)" : ""}`
      : `Attività pubblicata su Google Calendar${inAttesaDi(salvato) ? " (in attesa)" : ""}`,
  };
}

function inAttesaDi(attivita: Attivita): boolean {
  return attivita.stato === "in-attesa";
}

/** Rimuove l'evento remoto e pulisce i marcatori di sincronizzazione locali. */
export async function dissociaAttivita(id: number, calendarId = "primary"): Promise<SyncResult> {
  const salvato = ottieniAttivita(id);
  if (!salvato) return { ok: false, messaggio: "L'attività non esiste più" };
  try {
    if (salvato.googleEventId) {
      await eliminaEvento(salvato.googleEventId, salvato.googleCalendarId ?? calendarId);
    }
  } catch (error) {
    // Se l'evento non c'è più, lo scollegamento è riuscito: il collegamento
    // è a un evento che non esiste, quindi toglierlo è esattamente quello che
    // l'utente voleva. Fallire qui lo lascerebbe collegato per sempre, a un
    // evento che non si può più toccare.
    if (!eventoMancante(error)) return { ok: false, messaggio: spiega(error) };
  }
  // Solo i marcatori di Google: l'attività non si tocca. Riscriverlo
  // porterebbe nel database la descrizione arricchita che va solo
  // all'evento, e il modulo di modifica la mostrerebbe con dentro il
  // contesto dell'azienda — che si accoderebbe a ogni passaggio.
  rimuoviCollegamentoGoogle(salvato.id);
  return {
    ok: true,
    messaggio: "Attività scollegata da Google Calendar",
  };
}

/**
 * Cancella una lista di attività e, se c'era, anche l'evento su Google.
 *
 * È la versione plurale di `eliminaAttivitaEEvento`, e serve alla
 * cancellazione a cascata: chi elimina un'azienda elimina con lei le sue
 * attività, e quegli eventi su Google resterebbero in agenda per sempre —
 * orfani, non più raggiungibili dall'app. L'ordine è quello di sempre: prima
 * l'evento, poi la riga locale.
 *
 * Un evento che non c'è più (404/410) non è un fallimento: la cancellazione
 * che l'utente ha chiesto è già stata fatta. Un fallimento vero invece **non
 * cancella la riga locale**: l'attività resta in lista e si può riprovare,
 * invece di lasciare un orfano.
 */
export async function eliminaAttivitaEEventi(
  ids: number[],
): Promise<{ riusciti: number[]; falliti: Array<{ id: number; messaggio: string }> }> {
  const riusciti: number[] = [];
  const falliti: Array<{ id: number; messaggio: string }> = [];
  for (const id of ids) {
    const salvato = ottieniAttivita(id);
    // Già sparito: è un successo, la lista locale e quella di Google
    // concordano già.
    if (!salvato) {
      riusciti.push(id);
      continue;
    }
    try {
      if (salvato.googleEventId) {
        await eliminaEvento(salvato.googleEventId, salvato.googleCalendarId ?? "primary");
      }
    } catch (error) {
      if (!eventoMancante(error)) {
        falliti.push({ id, messaggio: spiega(error) });
        continue;
      }
    }
    eliminaAttivita(id);
    riusciti.push(id);
  }
  return { riusciti, falliti };
}

/**
 * Cancella l'attività e, se c'era, anche l'evento che ne era stato creato.
 *
 * L'ordine è quello che sembra controintuitivo e non lo è: prima l'evento, poi
 * l'attività. Se la rete fallisce l'attività **resta in lista**, con l'avviso
 * che spiega il motivo, e premere di nuovo Elimina riprova. Il contrario —
 * cancellare in locale e fallire la rete — lascerebbe un evento orfano in
 * agenda del quale l'app non saprebbe più niente: impossibile ritrovarlo e
 * impossibile toglierlo.
 */
export async function eliminaAttivitaEEvento(id: number): Promise<SyncResult> {
  const salvato = ottieniAttivita(id);
  if (!salvato) return { ok: true, messaggio: "L'attività era già stata eliminata" };
  try {
    if (salvato.googleEventId) {
      await eliminaEvento(salvato.googleEventId, salvato.googleCalendarId ?? "primary");
    }
  } catch (error) {
    // Se l'utente ha cancellato l'evento direttamente da Google Calendar,
    // l'evento non c'è più: toglierlo dall'agenda è **già riuscito**, e
    // trattenere l'attività per questo impedirebbe di eliminarla del tutto —
    // ogni nuovo tentativo riceverebbe lo stesso 410. È il caso in cui il
    // calendario e l'app sono d'accordo sul fatto che l'evento non esiste, e va
    // trattato come quello che è.
    if (!eventoMancante(error)) {
      return {
        ok: false,
        messaggio: `L'attività non è stata eliminata: ${spiega(error)}`,
      };
    }
  }
  eliminaAttivita(salvato.id);
  return {
    ok: true,
    messaggio: salvato.googleEventId
      ? "Attività eliminata, evento rimosso anche da Google Calendar"
      : "Attività eliminata",
  };
}

/** Invia tutte le attività non ancora sincronizzate. */
export async function sincronizzaInAttesa(calendarId = "primary"): Promise<SyncResult> {
  const inAttesa = elencaAttivita().filter(
    (attivita) => attivita.stato !== "annullato" && !attivita.googleEventId,
  );
  if (inAttesa.length === 0) {
    return { ok: true, messaggio: "Non ci sono nuove attività da sincronizzare" };
  }
  const errori: string[] = [];
  for (const attivita of inAttesa) {
    const risultato = await sincronizzaAttivita(attivita.id, calendarId);
    if (!risultato.ok) errori.push(`${attivita.titolo}: ${risultato.messaggio}`);
  }
  return errori.length
    ? { ok: false, messaggio: `${errori.length} attività non riusciti: ${errori[0]}` }
    : { ok: true, messaggio: `${inAttesa.length} attività sincronizzate` };
}

function spiega(error: unknown): string {
  if (error instanceof Error) return error.message;
  return "Errore sconosciuto durante la sincronizzazione";
}
