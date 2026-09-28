/**
 * Le chiave `sb_secret_` sostituiscono la vecchia `service_role`: danno
 * accesso completo al database e bypassano le Row Level Security. Finitirebbero
 * nel bundle del browser, quindi chi aprirebbe la pagina potrebbe leggere e
 * scrivere i dati di tutti gli utenti.
 */
const PREFISSI_PRIVILEGIATI = ["sb_secret_", "sbp_"];

export function eChiavePrivilegiata(chiave: string): boolean {
  return PREFISSI_PRIVILEGIATI.some((prefisso) => chiave.startsWith(prefisso));
}

export type TipoChiave = "pubblica" | "segreta" | "nessuna";

export function tipoDiChiave(chiave: string): TipoChiave {
  if (!chiave) return "nessuna";
  return eChiavePrivilegiata(chiave) ? "segreta" : "pubblica";
}

/** Messaggio d'errore se la chiave è pericolosa, altrimenti null. */
export function problemaDiChiave(chiave: string): string | null {
  if (!eChiavePrivilegiata(chiave)) return null;
  return "VITE_SUPABASE_ANON_KEY contiene una chiave segreta (sb_secret_). Usa la chiave pubblica sb_publishable_: una chiave segreta finirebbe nel bundle e darebbe a chiunque l'accesso ai dati di tutti.";
}
