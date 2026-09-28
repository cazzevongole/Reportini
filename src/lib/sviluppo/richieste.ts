/**
 * "Chiedilo allo sviluppatore": le richieste che gli utenti lasciano, e la
 * sezione nascosta in cui lo sviluppatore le legge e le evade.
 *
 * Tutto qui gira sul database che c'è già (Supabase), senza servizi nuovi: una
 * tabella `richieste` e una tabella `sviluppatori`, entrambe protette dalla
 * RLS. Chi è sviluppatore lo decide il database, non l'app: una lista scritta
 * nel bundle pubblico la leggerebbe chiunque, e il mese scorso l'abbiamo
 * proprio tolta per quello. Qui la lista vive nel database e la difende la
 * RLS, quindi nessun client può ampliarla da solo.
 *
 * Anche la sezione nascosta è una conseguenza di questa scelta: l'utente
 * normale non vede le richieste degli altri, perché la RLS gliele filtra
 * prima che arrivino al browser. Non è una scritta "if (utente)": è una riga
 * di permesso.
 */
import { supabase } from "../cloud/supabase";

export type TipoRichiesta = "fix" | "funzionalita";
export type StatoRichiesta = "aperta" | "in corso" | "risolta";

export interface Richiesta {
  id: string;
  tipo: TipoRichiesta;
  titolo: string;
  corpo: string;
  stato: StatoRichiesta;
  /** La risposta dello sviluppatore, se l'ha scritta. */
  risposta: string | null;
  email: string;
  createdAt: string;
  updatedAt: string;
}

export const TIPI: { valore: TipoRichiesta; etichetta: string }[] = [
  { valore: "fix", etichetta: "Qualcosa non va" },
  { valore: "funzionalita", etichetta: "Mi serve che si possa fare" },
];

export const STATI: { valore: StatoRichiesta; etichetta: string }[] = [
  { valore: "aperta", etichetta: "Da leggere" },
  { valore: "in corso", etichetta: "In corso" },
  { valore: "risolta", etichetta: "Risolta" },
];

const ETICHETTA_STATO: Record<StatoRichiesta, string> = {
  aperta: "Da leggere",
  "in corso": "In corso",
  risolta: "Risolta",
};

export function etichettaStato(stato: StatoRichiesta): string {
  return ETICHETTA_STATO[stato] ?? stato;
}

export const LIMITE_TITOLO = 120;
export const LIMITE_CORPO = 4000;

/* -------------------------------- errori --------------------------------- */

/**
 * Gli errori di PostgREST hanno un codice parlante. Senza tradurli, un utente
 * vedrebbe "Could not find the table public.richieste in the schema cache" e
 * non capirebbe che manca solo uno script da eseguire una volta.
 */
const CODICI: Record<string, string> = {
  "42P01":
    "Il servizio richieste non è ancora attivo: lo script supabase/richieste.sql non è stato eseguito su Supabase.",
  "42883":
    "Il servizio richieste non è ancora attivo: manca la funzione sei_sviluppatore(). Esegui di nuovo supabase/richieste.sql.",
  PGRST202:
    "Il servizio richieste non è ancora attivo: manca la funzione sei_sviluppatore(). Esegui di nuovo supabase/richieste.sql.",
  "42501": "Non hai i permessi per questa operazione.",
};

export class RichiesteNonAttive extends Error {}

function spiega(causa: unknown): Error {
  const errore = causa as { code?: string; message?: string; error_description?: string } | null;
  const testoTradotto = (errore?.code && CODICI[errore.code]) || "";
  if (testoTradotto) return new RichiesteNonAttive(testoTradotto);
  return new Error(errore?.error_description ?? errore?.message ?? "Operazione non riuscita");
}

/** Il servizio c'è solo con Supabase collegato e senza errori di schema. */
export function servizioAttivo(): boolean {
  return supabase !== null;
}

/* --------------------------------- dati ---------------------------------- */

interface RigaRichiesta {
  id: string;
  tipo: TipoRichiesta;
  titolo: string;
  corpo: string;
  stato: StatoRichiesta;
  risposta: string | null;
  email: string;
  created_at: string;
  updated_at: string;
}

function rigaARichiesta(riga: RigaRichiesta): Richiesta {
  return {
    id: riga.id,
    tipo: riga.tipo,
    titolo: riga.titolo,
    corpo: riga.corpo,
    stato: riga.stato,
    risposta: riga.risposta ?? null,
    email: riga.email,
    createdAt: riga.created_at,
    updatedAt: riga.updated_at,
  };
}

const COLONNE = "id,tipo,titolo,corpo,stato,risposta,email,created_at,updated_at";

async function utenteCorrente(): Promise<{ id: string; email: string }> {
  if (!supabase) throw new Error("Supabase non è collegato: senza account non si può scrivere.");
  const { data, error } = await supabase.auth.getSession();
  if (error) throw spiega(error);
  const utente = data.session?.user;
  if (!utente) throw new Error("Accedi con il tuo account Google per scrivere allo sviluppatore.");
  return { id: utente.id, email: utente.email ?? "" };
}

/* ------------------------------- operazioni ------------------------------ */

/**
 * Le richieste che l'utente corrente può vedere: le proprie, più tutte se è
 * lo sviluppatore. Non serve una funzione separata per lo sviluppatore: è la
 * RLS a decidere, e una sola query evita che le due liste possano divergere.
 *
 * Con `mie` si restringe alle proprie anche per chi è sviluppatore: la pagina
 * delle impostazioni dice "le tue richieste", e lì un elenco con quelle degli
 * altri sarebbe solo una bugia nell'intestazione.
 */
export async function elencaRichieste(mie = false): Promise<Richiesta[]> {
  if (!supabase) throw new RichiesteNonAttive("Supabase non è collegato.");
  let domanda = supabase.from("richieste").select(COLONNE);
  if (mie) {
    const utente = await utenteCorrente();
    domanda = domanda.eq("user_id", utente.id);
  }
  const { data, error } = await domanda
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw spiega(error);
  return ((data ?? []) as RigaRichiesta[]).map(rigaARichiesta);
}

export async function inviaRichiesta(
  tipo: TipoRichiesta,
  titolo: string,
  corpo: string,
): Promise<Richiesta> {
  if (!supabase) throw new RichiesteNonAttive("Supabase non è collegato.");
  const titoloPulito = titolo.trim();
  const corpoPulito = corpo.trim();
  if (!titoloPulito) throw new Error("Scrivi un titolo: serve a capire di che si tratta.");
  if (titoloPulito.length > LIMITE_TITOLO) {
    throw new Error(`Il titolo è troppo lungo: massimo ${LIMITE_TITOLO} caratteri.`);
  }
  if (!corpoPulito) throw new Error("Scrivi cosa è successo, o cosa dovrebbe succedere.");
  if (corpoPulito.length > LIMITE_CORPO) {
    throw new Error(`La richiesta è troppo lunga: massimo ${LIMITE_CORPO} caratteri.`);
  }

  const utente = await utenteCorrente();
  const adesso = new Date().toISOString();
  const { data, error } = await supabase
    .from("richieste")
    .insert({
      user_id: utente.id,
      // L'email la prende la sessione, non il modulo: altrimenti sarebbe
      // possibile scrivere richieste intestate a qualcun altro.
      email: utente.email,
      tipo,
      titolo: titoloPulito,
      corpo: corpoPulito,
      stato: "aperta",
      created_at: adesso,
      updated_at: adesso,
    })
    .select(COLONNE)
    .single();
  if (error) throw spiega(error);
  return rigaARichiesta(data as unknown as RigaRichiesta);
}

export async function cambiaStato(id: string, stato: StatoRichiesta): Promise<void> {
  if (!supabase) throw new RichiesteNonAttive("Supabase non è collegato.");
  const { error } = await supabase
    .from("richieste")
    .update({ stato, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw spiega(error);
}

export async function rispondi(id: string, testo: string): Promise<void> {
  if (!supabase) throw new RichiesteNonAttive("Supabase non è collegato.");
  const { error } = await supabase
    .from("richieste")
    .update({ risposta: testo.trim() || null, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw spiega(error);
}

/* ---------------------------- ruolo dell'utente --------------------------- */

export type Ruolo = "sviluppatore" | "utente" | "errore";

export interface EsitoRuolo {
  ruolo: Ruolo;
  messaggio: string;
}

/**
 * Se l'utente corrente è lo sviluppatore.
 *
 * "errore" è distinto da "utente" di proposito: se lo script non è stato
 * eseguito la risposta è "non lo so", e farlo entrare dalla porta sbagliata
 * (cioè come utente normale) nasconderebbe proprio il problema da segnalare.
 */
export async function verificaRuolo(): Promise<EsitoRuolo> {
  if (!supabase) {
    return { ruolo: "errore", messaggio: "Supabase non è collegato: niente sezione sviluppo." };
  }
  const { data, error } = await supabase.rpc("sei_sviluppatore");
  if (error) return { ruolo: "errore", messaggio: spiega(error).message };
  return data === true
    ? { ruolo: "sviluppatore", messaggio: "" }
    : { ruolo: "utente", messaggio: "" };
}
