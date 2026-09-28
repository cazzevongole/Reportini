/**
 * Collegamento a Google Calendar.
 *
 * Perché il token non si ottiene qui. Un'app ospitata su GitHub Pages è un
 * client pubblico: non ha backend e quindi non può custodire un client
 * secret. Ma Google pretende il secret **sia** per scambiare l'authorization
 * code **sia** per rinnovare il token, anche con PKCE:
 *
 *   POST https://oauth2.googleapis.com/token
 *   → {"error":"invalid_request","error_description":"client_secret is missing."}
 *
 * Provato sull'endpoint reale. Quindi da qui non si può fare né lo scambio né
 * il rinnovo silenzioso: mettere il secret nel browser lo esporrebbe a tutti.
 *
 * La strada che funziona è far viaggiare il token sulla sessione Supabase,
 * che è già un client *confidenziale*: l'accesso con Google avviene una volta,
 *Supabase lo scambia lato server e restituisce il token Google nella sessione.
 * Qui non resta altro da fare che custodirlo e usarlo.
 *
 * Il rinnovo non può essere silenzioso: quando il token scade (un'ora) serve
 * un gesto dell'utente, che è ciò che Google si aspetta da un'app senza
 * backend.
 */

import { supabase } from "../cloud/supabase";
import { urlDiRitorno } from "../cloud/destinazione";

const TOKEN_KEY = "reportini.google.token";
const PROFILE_KEY = "reportini.google.profile";

const PROFILE_ENDPOINT = "https://www.googleapis.com/oauth2/v3/userinfo";

/** Scope necessario a creare e aggiornare eventi. */
export const SCOPO_CALENDARIO = "https://www.googleapis.com/auth/calendar.events";

export interface GoogleProfile {
  email: string;
  name: string;
  picture?: string;
}

export interface StoredToken {
  accessToken: string;
  /** Epoch ms. I token Google durano un'ora. */
  expiresAt: number;
}

/** Il collegamento esiste se c'è Supabase: è lui a fare da client OAuth. */
export const googleConfigured = supabase !== null;

export const clientId = "";

/* ------------------------------- persistenza ------------------------------ */

export function readToken(): StoredToken | null {
  try {
    const raw = localStorage.getItem(TOKEN_KEY);
    if (!raw) return null;
    const token = JSON.parse(raw) as StoredToken;
    if (!token.accessToken) return null;
    return token;
  } catch {
    return null;
  }
}

export function readProfile(): GoogleProfile | null {
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    return raw ? (JSON.parse(raw) as GoogleProfile) : null;
  } catch {
    return null;
  }
}

export function isConnected(): boolean {
  const token = readToken();
  return Boolean(token && token.expiresAt > Date.now() + 30_000);
}

function storeToken(accessToken: string, expiresIn: number): void {
  localStorage.setItem(
    TOKEN_KEY,
    JSON.stringify({
      accessToken,
      // Margine di sicurezza: un token scaduto a metà richiesta fallirebbe
      // con un 401 senza motivo evidente.
      expiresAt: Date.now() + Math.max((expiresIn - 60) * 1000, 0),
    } satisfies StoredToken),
  );
}

/**
 * Cattura il token Google che Supabase ha scambiato per noi. Va chiamata a ogni
 * cambio di sessione: il token arriva insieme all'accesso, non con una
 * richiesta separata.
 */
export function adottaTokenDiSessione(providerToken: string | null | undefined): void {
  if (!providerToken) return;
  if (readToken()?.accessToken === providerToken) return;
  // Supabase non comunica la scadenza: un'ora è il valore documentato da Google.
  storeToken(providerToken, 3600);
  void arricchisciProfilo(providerToken);
}

async function arricchisciProfilo(accessToken: string): Promise<void> {
  try {
    const risposta = await fetch(PROFILE_ENDPOINT, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!risposta.ok) return;
    const dati = (await risposta.json()) as { email: string; name: string; picture?: string };
    localStorage.setItem(
      PROFILE_KEY,
      JSON.stringify({ email: dati.email, name: dati.name, picture: dati.picture } satisfies GoogleProfile),
    );
  } catch {
    // Il profilo è solo cosmetico: senza nome l'app funziona lo stesso.
  }
}

export async function disconnect(): Promise<{ revocato: boolean }> {
  const token = readToken();
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(PROFILE_KEY);
  if (!token?.accessToken) return { revocato: true };
  // Revocare conta più che cancellare il token: altrimenti l'app resta
  // autorizzata su myaccount.google.com/permissions. Non è bloccante per
  // l'utente, quindi una revoca fallita va detta, non nascosta.
  try {
    await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token.accessToken)}`, {
      method: "POST",
    });
    return { revocato: true };
  } catch {
    return { revocato: false };
  }
}

/* ------------------------------- collegamento ----------------------------- */

/**
 * Avvia l'accesso con Google chiedendo anche lo scope Calendar. Supabase fa
 * lo scambio lato server e al ritorno la sessione porta con sé il token.
 *
 * Non è una richiesta che si conclude qui: l'utente lascia la pagina e
 * torna. Per questo non restituisce un profilo.
 */
export async function connect(): Promise<GoogleProfile> {
  if (!supabase) {
    throw new Error(
      "Collega Supabase dalle variabili d'ambiente (VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY): senza account non c'è modo di ottenere un token Google.",
    );
  }
  const { error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: urlDiRitorno(window.location.origin, import.meta.env.BASE_URL),
      scopes: SCOPO_CALENDARIO,
      queryParams: { access_type: "offline", prompt: "consent" },
    },
  });
  if (error) throw new Error(error.message);
  // La pagina sta per essere scaricata: nessun profilo, nessun errore.
  return new Promise<GoogleProfile>(() => undefined);
}

/**
 * Token valido, oppure un errore che spiega cosa fare. Non può rinnovare da
 * solo: senza backend non possiede il client secret che Google pretende.
 */
export async function accessToken(): Promise<string> {
  const token = readToken();
  if (token && token.expiresAt > Date.now() + 60_000) return token.accessToken;
  throw new Error(
    "Il collegamento con Google Calendar è scaduto. Accedi di nuovo con Google per rinnovarlo.",
  );
}
