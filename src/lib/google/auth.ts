/**
 * Accesso con Google, calendario incluso.
 *
 * Perché serve un backend. Un'app ospitata su GitHub Pages è un client
 * pubblico: non ha dove custodire un client_secret. E Google lo pretende
 * **sia** per scambiare l'authorization code **sia** per rinnovare il token,
 * anche in PKCE. Provato sull'endpoint reale:
 *
 *   POST https://oauth2.googleapis.com/token
 *   → {"error":"invalid_request","error_description":"client_secret is missing."}
 *
 * Mettere il secret nel bundle lo darebbe a chiunque, quindi il pezzo che
 * manca è un piccolo backend che lo custodisce: la Supabase Edge Function
 * `google-token` (supabase/functions/google-token).
 *
 * **Un solo accesso, un solo consenso.** L'app porta sé stessa all'authorize
 * di Google chiedendo lo scope del profilo *e* quello del calendario in una
 * volta sola. Al ritorno lo `id_token` passa a Supabase con
 * `signInWithIdToken` — che lo valida con lo stesso Client ID configurato nel
 * progetto, ed è quello che apre la sessione — e i token del calendario
 * restano all'app, che li rinnova in silenzio quando scadono.
 *
 * Perché funziona solo così: se l'accesso lo facesse Supabase, il profilo e
 * il calendario sarebbero due richieste OAuth diverse, e l'utente vedrebbe
 * due schermate di consenso. In più il token che Supabase restituisce non ha
 * un refresh token, quindi dopo un'ora l'app non potrebbe rinnovare nulla.
 *
 * Se il backend non è pronto l'accesso **non si blocca**: l'app ripiega
 * sull'accesso con Supabase da sola e dice, nelle impostazioni, cosa è
 * successo.
 */

import { supabase } from "../cloud/supabase";
import { baseRoutte, urlDiRitorno } from "../cloud/destinazione";

const TOKEN_KEY = "reportini.google.token";
const PROFILE_KEY = "reportini.google.profile";
const ERRORE_KEY = "reportini.google.errore";
/** Fra l'authorize e il ritorno: cosa stavamo facendo e con quale state. */
const RITORNO_KEY = "reportini.google.ritorno";

const PROFILE_ENDPOINT = "https://www.googleapis.com/oauth2/v3/userinfo";
const AUTHORIZE_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";

/** Scope necessario a creare e aggiornare eventi. */
export const SCOPO_CALENDARIO = "https://www.googleapis.com/auth/calendar.events";
/** Profilo e identità: senza questi non c'è `id_token`, quindi non c'è sessione. */
export const SCOPO_PROFILO = "openid email profile";

const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? "";
/** Il client id è pubblico per definizione: è il secret a stare nel backend. */
export const clientId = (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined) ?? "";
const FUNZIONE = SUPABASE_URL ? `${SUPABASE_URL}/functions/v1/google-token` : "";

export interface GoogleProfile {
  email: string;
  name: string;
  picture?: string;
}

export interface StoredToken {
  accessToken: string;
  /**
   * Senza questo l'access token muore dopo un'ora e non si rinnova: è la
   * differenza fra "l'utente deve ricollegarsi" e "non se ne accorge".
   */
  refreshToken: string | null;
  /** Epoch ms. I token Google durano un'ora. */
  expiresAt: number;
}

/**
 * Il calendario è integrato nell'accesso, non è una delle sue parti
 * accessorie: senza backend l'app entra comunque, ma questa parte manca.
 */
export const googleConfigured = Boolean(supabase && clientId);

/* ------------------------------- persistenza ------------------------------ */

function leggiToken(): StoredToken | null {
  try {
    const raw = localStorage.getItem(TOKEN_KEY);
    if (!raw) return null;
    const token = JSON.parse(raw) as Partial<StoredToken>;
    if (!token.accessToken) return null;
    return {
      accessToken: token.accessToken,
      refreshToken: token.refreshToken ?? null,
      expiresAt: token.expiresAt ?? 0,
    };
  } catch {
    return null;
  }
}

export function readToken(): StoredToken | null {
  return leggiToken();
}

function scriviToken(accessToken: string, refreshToken: string | null, expiresIn: number): void {
  localStorage.setItem(
    TOKEN_KEY,
    JSON.stringify({
      accessToken,
      refreshToken,
      // Margine di sicurezza: un token scaduto a metà richiesta fallirebbe
      // con un 401 senza motivo evidente.
      expiresAt: Date.now() + Math.max((expiresIn - 60) * 1000, 0),
    } satisfies StoredToken),
  );
  localStorage.removeItem(ERRORE_KEY);
}

export function readProfile(): GoogleProfile | null {
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    return raw ? (JSON.parse(raw) as GoogleProfile) : null;
  } catch {
    return null;
  }
}

/**
 * L'ultimo errore di collegamento, per poterlo dire anche dopo un rientro
 * da Google: al ritorno l'utente finisce nelle impostazioni, e un errore
 * mostrato solo in console lì non serve a nessuno.
 */
export function readErroreCollegamento(): string | null {
  return localStorage.getItem(ERRORE_KEY);
}

function ricordaErrore(messaggio: string): void {
  localStorage.setItem(ERRORE_KEY, messaggio);
}

/* --------------------------------- stato ---------------------------------- */

/**
 * Il calendario è collegato se c'è un access token valido **oppure** un
 * refresh token: con il secondo il rinnovo è automatico e non c'è nulla da
 * fare. Se si mostrasse "collega" con un token semplicemente scaduto,
 * l'app chiederebbe ogni volta un consenso che l'utente ha già dato.
 */
export function isConnected(): boolean {
  const token = leggiToken();
  if (!token) return false;
  return Boolean(token.refreshToken) || token.expiresAt > Date.now() + 30_000;
}

/* -------------------------------- accesso --------------------------------- */

interface Ritorno {
  state: string;
  redirect: string;
}

function leggiRITORNO(): Ritorno | null {
  try {
    const raw = sessionStorage.getItem(RITORNO_KEY);
    return raw ? (JSON.parse(raw) as Ritorno) : null;
  } catch {
    return null;
  }
}

/** Toglie i parametri di Google dalla barra degli indirizzi. */
function ripulisciUrl(): void {
  const url = new URL(window.location.href);
  for (const chiave of ["code", "state", "scope", "authuser", "prompt", "hd"]) {
    url.searchParams.delete(chiave);
  }
  window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
}

function stateCasuale(): string {
  const byte = new Uint8Array(16);
  crypto.getRandomValues(byte);
  return Array.from(byte, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Porta all'authorize di Google chiedendo profilo **e** calendario.
 *
 * È un flusso che lascia la pagina: l'utente vede il consenso e torna, e a
 * quel punto chiama `completaAccesso()`. Per questo non restituisce nulla.
 */
export async function avviaAccessoGoogle(): Promise<void> {
  if (!clientId) {
    throw new Error("Manca VITE_GOOGLE_CLIENT_ID: senza il client Google l'accesso passa da Supabase.");
  }
  // Deve combaciare al segno con uno registrato in Google Cloud, altrimenti
  // lo scambio del code si ferma con redirect_uri_mismatch.
  const redirect = urlDiRitorno(window.location.origin, baseRoutte());
  const state = stateCasuale();
  sessionStorage.setItem(RITORNO_KEY, JSON.stringify({ state, redirect } satisfies Ritorno));

  const url = new URL(AUTHORIZE_ENDPOINT);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirect);
  url.searchParams.set("response_type", "code");
  // I due scope nella stessa richiesta: è questo che fa risparmiare all'utente
  // una seconda schermata di consenso.
  url.searchParams.set("scope", `${SCOPO_PROFILO} ${SCOPO_CALENDARIO}`);
  // offline serve il refresh token; consent serve a riaverlo anche al secondo
  // tentativo, quando Google ha già visto una volta questa app.
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("include_granted_scopes", "true");
  url.searchParams.set("state", state);

  window.location.assign(url.toString());
  // La pagina viene scaricata: nessuno aspetta oltre.
  return new Promise<void>(() => undefined);
}

/* --------------------------------- backend -------------------------------- */

interface RispostaScambio {
  id_token: string;
  access_token: string;
  refresh_token: string | null;
  expires_in: number;
}

interface RispostaRinnovo {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
}

async function chiamaBackend<T>(corpo: Record<string, unknown>): Promise<T> {
  if (!supabase) throw new Error("Supabase non è collegato.");

  // Il rinnovo e la revoca chiedono un account; lo scambio no, perché
  // avviene proprio mentre l'utente sta ancora entrando. Si manda il JWT
  // quando c'è, e la funzione lo usa solo se sa cosa farne.
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  const intestazioni: Record<string, string> = { "Content-Type": "application/json" };
  if (token) intestazioni.Authorization = `Bearer ${token}`;

  let risposta: Response;
  try {
    risposta = await fetch(FUNZIONE, { method: "POST", headers: intestazioni, body: JSON.stringify(corpo) });
  } catch {
    throw new Error("Backend non raggiungibile: controlla che la funzione google-token sia pubblicata.");
  }

  const dati = (await risposta.json().catch(() => ({}))) as { errore?: string } & T;
  if (!risposta.ok) {
    throw new Error(dati.errore ?? `Il backend ha risposto ${risposta.status}.`);
  }
  return dati;
}

/** Come entrava prima: profilo e basta, senza calendario. */
async function accessoSupabaseSemplice(): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: urlDiRitorno(window.location.origin, baseRoutte()) },
  });
  if (error) throw new Error(error.message);
}

export type EsitoAccesso = "calendario" | "solo-account" | "nessuno";

/**
 * Chiude l'accesso al ritorno da Google.
 *
 * Percorso normale: scambio del `code` col backend, `id_token` a Supabase per
 * la sessione, token del calendario per l'app. Se qualcosa va storto non si
 * lascia l'utente fuori dalla porta: si ripiega sull'accesso con Supabase
 * da sola e si ricorda perché il calendario manca, così nelle impostazioni
 * c'è scritto cosa fare.
 */
export async function completaAccesso(): Promise<EsitoAccesso> {
  const url = new URL(window.location.href);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const erroreGoogle = url.searchParams.get("error");
  const ritorno = leggiRITORNO();
  sessionStorage.removeItem(RITORNO_KEY);

  if (erroreGoogle) {
    ripulisciUrl();
    const messaggio =
      erroreGoogle === "access_denied"
        ? "Accesso annullato."
        : `Google ha rifiutato l'accesso (${erroreGoogle}).`;
    ricordaErrore(messaggio);
    return "nessuno";
  }

  if (!code) return "nessuno";

  // Un `code` di cui non ci siamo persi traccia non è nostro: può arrivare da
  // un altro accesso. Si ignora, e non è un errore da mostrare a nessuno.
  if (!ritorno) return "nessuno";

  if (ritorno.state !== state) {
    ripulisciUrl();
    ricordaErrore("Accesso non riconosciuto: riprova.");
    return "nessuno";
  }

  try {
    const scambio = await chiamaBackend<RispostaScambio>({
      azione: "scambio",
      code,
      redirect_uri: ritorno.redirect,
    });

    if (!supabase) throw new Error("Supabase non è collegato.");
    // È Supabase ad aprire la sessione, validando l'id_token con il Client
    // ID configurato nel progetto: deve essere lo stesso client dell'app.
    const { error } = await supabase.auth.signInWithIdToken({
      provider: "google",
      token: scambio.id_token,
    });
    if (error) throw new Error(error.message);

    scriviToken(scambio.access_token, scambio.refresh_token, scambio.expires_in);
    ripulisciUrl();
    void arricchisciProfilo(scambio.access_token);
    return "calendario";
  } catch (causa) {
    const messaggio = causa instanceof Error ? causa.message : "Accesso non riuscito";
    ricordaErrore(
      `${messaggio} L'accesso continua senza calendario: le impostazioni dicono come rimetterlo.`,
    );
    ripulisciUrl();
    // L'utente entra comunque. È la differenza fra un backend da
    // configurare e un'app che non si apre più.
    await accessoSupabaseSemplice();
    return "solo-account";
  }
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

/** Rinnovo in corso: due chiamate contemporanee ne fanno una sola. */
let rinnovoInCorso: Promise<string> | null = null;

/**
 * Token valido, rinnovato in silenzio se necessario.
 *
 * Prima questo non era possibile: scaduto il token (un'ora) l'unica strada
 * era far ricollegare l'utente. Ora il refresh token torna dal backend e
 * l'utente non se ne accorge.
 */
export async function accessToken(): Promise<string> {
  const token = leggiToken();
  if (token && token.expiresAt > Date.now() + 60_000) return token.accessToken;

  if (!token?.refreshToken) {
    throw new Error("Il calendario non è collegato: ricollegalo dalle impostazioni.");
  }

  if (rinnovoInCorso) return rinnovoInCorso;

  rinnovoInCorso = (async () => {
    try {
      const rinnovo = await chiamaBackend<RispostaRinnovo>({
        azione: "rinnovo",
        refresh_token: token.refreshToken,
      });
      scriviToken(
        rinnovo.access_token,
        rinnovo.refresh_token ?? token.refreshToken,
        rinnovo.expires_in,
      );
      return rinnovo.access_token;
    } catch (causa) {
      const messaggio = causa instanceof Error ? causa.message : "Rinnovo non riuscito";
      ricordaErrore(messaggio);
      throw new Error(messaggio);
    } finally {
      rinnovoInCorso = null;
    }
  })();

  return rinnovoInCorso;
}

export async function disconnect(): Promise<{ revocato: boolean }> {
  const token = leggiToken();
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(PROFILE_KEY);
  localStorage.removeItem(ERRORE_KEY);
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

/* ------------------------------ stato del backend ------------------------ */

export type StatoBackend = "pronto" | "non-pubblicata" | "irraggiungibile";

/**
 * La funzione `google-token` esiste davvero?
 *
 * Non serve un endpoint di stato: se l'indirizzo non corrisponde a nessuna
 * funzione Supabase risponde 404, mentre una funzione pubblicata risponde
 * qualcosa (405, perché vuole un POST). È il controllo che dice "hai
 * dimenticato di pubblicarla" invece di lasciare l'utente a litigare con un
 * errore generico.
 */
export async function statoBackend(): Promise<StatoBackend> {
  if (!supabase || !FUNZIONE) return "irraggiungibile";
  try {
    const { data } = await supabase.auth.getSession();
    const risposta = await fetch(FUNZIONE, {
      method: "GET",
      headers: data.session ? { Authorization: `Bearer ${data.session.access_token}` } : {},
    });
    return risposta.status === 404 ? "non-pubblicata" : "pronto";
  } catch {
    return "irraggiungibile";
  }
}
