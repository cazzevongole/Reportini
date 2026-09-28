/**
 * Collegamento a Google Calendar.
 *
 * L'app è un client pubblico ospitato su GitHub Pages: non ha backend e non
 * può custodire un client secret, quindi il flusso è **authorization code con
 * PKCE**, scambiato direttamente dal browser.
 *
 * Perché non si usa Google Identity Services: `initCodeClient` genera il
 * code verifier internamente ma non lo espone, e senza il verifier il codice
 * non può essere scambiato. Serve quindi costruire l'URL di autorizzazione e
 * ascoltare la risposta da soli.
 *
 * PKCE: all'inizio si genera un verifier casuale e si invia il suo hash come
 * `code_challenge`; Google rimanda un codice che si può scambiare solo
 * dimostrando di conoscere il verifier. Chi intercetta il codice non ottiene
 * nulla, ed è lo stesso motivo per cui non serve alcun secret.
 */

import { urlDiRitorno } from "../cloud/destinazione";

const SCOPES = "https://www.googleapis.com/auth/calendar.events";
const TOKEN_KEY = "reportini.google.token";
const PROFILE_KEY = "reportini.google.profile";
const PENDING_KEY = "reportini.google.pkce";
const POPUP_NAME = "reportini-google-calendar";
export const MESSAGGIO_RITORNO = "reportini:google-calendar";

const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const PROFILE_ENDPOINT = "https://www.googleapis.com/oauth2/v3/userinfo";

export interface GoogleProfile {
  email: string;
  name: string;
  picture?: string;
}

export interface StoredToken {
  accessToken: string;
  /** Epoch ms. Google rilascia token di un'ora. */
  expiresAt: number;
  /**
   * Senza refresh token ogni scadenza obbligherebbe a riaprire il popup di
   * consenso. Con refresh token il rinnovo è silenzioso.
   */
  refreshToken?: string;
}

export const clientId = (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined) ?? "";

export const googleConfigured = Boolean(clientId);

/** Google confronta questo valore con le origini autorizzate nella console. */
function redirectUri(): string {
  return urlDiRitorno(window.location.origin, import.meta.env.BASE_URL);
}

/* --------------------------------- PKCE ---------------------------------- */

function base64Url(bytes: Uint8Array): string {
  let bin = "";
  for (const byte of bytes) bin += String.fromCharCode(byte);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function casuale(length: number): string {
  const byte = new Uint8Array(length);
  crypto.getRandomValues(byte);
  return base64Url(byte);
}

/**
 * Code challenge S256. Esportata per essere verificata con il vettore di prova
 * della RFC 7636: se il computation sbaglia, ogni scambio di codice fallisce
 * con "invalid_grant" e il motivo non è immediato.
 */
export async function sfidaDi(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64Url(new Uint8Array(digest));
}

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
  // Un token scaduto non significa "collegato": senza refresh token
  // l'utente dovrebbe riaprire il consenso a ogni scadenza.
  const token = readToken();
  return Boolean(token && token.expiresAt > Date.now() + 30_000);
}

function storeToken(accessToken: string, expiresIn: number, refreshToken?: string): void {
  const precedente = readToken();
  localStorage.setItem(
    TOKEN_KEY,
    JSON.stringify({
      accessToken,
      // Margine di sicurezza: l'orario di Google è approssimativo e un token
      // scaduto a metà richiesta fallirebbe con un 401.
      expiresAt: Date.now() + Math.max((expiresIn - 60) * 1000, 0),
      // Google restituisce il refresh token solo alla prima concessione: in
      // seguito va conservato quello già salvato.
      refreshToken: refreshToken ?? precedente?.refreshToken,
    } satisfies StoredToken),
  );
}

function dimenticaPending(): void {
  sessionStorage.removeItem(PENDING_KEY);
}

export function disconnect(): void {
  const token = readToken();
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(PROFILE_KEY);
  dimenticaPending();
  if (!token?.accessToken) return;
  // Revocare il consenso conta più che cancellare il token dal browser:
  // altrimenti l'app resta autorizzata su myaccount.google.com/permissions.
  // Non è bloccante, quindi l'errore si ignora.
  void fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token.accessToken)}`, {
    method: "POST",
  }).catch(() => undefined);
}

/* --------------------------------- richieste ------------------------------ */

interface Scambio {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
}

async function scambiaCodice(codice: string, verifier: string): Promise<Scambio> {
  const risposta = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      code: codice,
      code_verifier: verifier,
      grant_type: "authorization_code",
      redirect_uri: redirectUri(),
    }),
  });
  if (!risposta.ok) {
    const dettaglio = await risposta.text();
    throw new Error(`Google ha rifiutato lo scambio del codice: ${dettaglio.slice(0, 160)}`);
  }
  return (await risposta.json()) as Scambio;
}

async function rinnovaConRefresh(refreshToken: string): Promise<string> {
  const risposta = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });
  if (!risposta.ok) {
    // 400 invalid_grant: il refresh token è stato revocato o è scaduto, e
    // non c'è altro modo se non chiedere il consenso da capo.
    throw new Error("COLLEGAMENTO_SCADUTO");
  }
  const dati = (await risposta.json()) as { access_token: string; expires_in: number };
  storeToken(dati.access_token, dati.expires_in);
  return dati.access_token;
}

async function fetchProfile(accessToken: string): Promise<GoogleProfile> {
  const response = await fetch(PROFILE_ENDPOINT, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) throw new Error("Impossibile ottenere il profilo Google");
  const data = (await response.json()) as { email: string; name: string; picture?: string };
  return { email: data.email, name: data.name, picture: data.picture };
}

/* ------------------------------ flusso OAuth ------------------------------ */

interface Pending {
  verifier: string;
  state: string;
}

export interface MessaggioRitorno {
  tipo: typeof MESSAGGIO_RITORNO;
  state?: string;
  code?: string;
  errore?: string;
}

/**
 * Da eseguire all'avvio dell'app. Se questa scheda è il popup tornato da
 * Google, rimanda il codice a chi lo ha aperto e si chiude: senza questo il
 * popup resterebbe aperto sulla pagina dell'app.
 */
export function consegnaRitornoPopup(): void {
  if (!window.opener) return;
  const parametri = new URLSearchParams(window.location.search);
  const errore = parametri.get("error");
  const code = parametri.get("code");
  if (!errore && !code) return;
  const messaggio: MessaggioRitorno = {
    tipo: MESSAGGIO_RITORNO,
    state: parametri.get("state") ?? undefined,
    code: code ?? undefined,
    errore: errore
      ? (parametri.get("error_description") ?? errore)
      : undefined,
  };
  window.opener.postMessage(messaggio, window.location.origin);
  window.close();
}

function ascoltaRitorno(): Promise<{ code?: string; errore?: string; state?: string }> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      cleanup();
      reject(new Error("Tempo scaduto: la finestra di autorizzazione non ha risposto."));
    }, 5 * 60_000);

    function onMessage(evento: MessageEvent) {
      const dato = evento.data as MessaggioRitorno | null;
      if (evento.origin !== window.location.origin || dato?.tipo !== MESSAGGIO_RITORNO) return;
      cleanup();
      resolve(dato);
    }

    function cleanup() {
      window.clearTimeout(timer);
      window.removeEventListener("message", onMessage);
    }

    window.addEventListener("message", onMessage);
  });
}

/** Apre il popup di Google e scambia il codice ottenuto con PKCE. */
export async function connect(): Promise<GoogleProfile> {
  if (!googleConfigured) {
    throw new Error(
      "Manca VITE_GOOGLE_CLIENT_ID. Aggiungilo in Settings → Environment per collegare Google Calendar.",
    );
  }

  const verifier = casuale(96).slice(0, 96);
  const state = casuale(24);
  const pendente: Pending = { verifier, state };
  sessionStorage.setItem(PENDING_KEY, JSON.stringify(pendente));

  const url = new URL(AUTH_ENDPOINT);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri());
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", SCOPES);
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", await sfidaDi(verifier));
  url.searchParams.set("code_challenge_method", "S256");
  // offline access: è ciò che fa arrivare il refresh token, altrimenti ogni
  // ora si dovrebbe ripetere il consenso.
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("include_granted_scopes", "true");
  if (!readToken()?.refreshToken) url.searchParams.set("prompt", "consent");

  const popup = window.open(url.toString(), POPUP_NAME, "width=520,height=680,noopener=noopener");
  if (!popup) {
    dimenticaPending();
    throw new Error("Il browser ha bloccato la finestra di autorizzazione: consenti i popup.");
  }

  let risposta: { code?: string; errore?: string; state?: string };
  try {
    risposta = await ascoltaRitorno();
  } catch (errore) {
    popup.close();
    dimenticaPending();
    throw errore;
  }
  popup.close();
  dimenticaPending();

  if (risposta.errore) throw new Error(risposta.errore);
  if (!risposta.code) throw new Error("Google non ha restituito un codice di autorizzazione");
  // Lo state fa da prova che la risposta è davvero alla richiesta che abbiamo
  // fatto: senza, un'altra pagina potrebbe iniettare un codice al suo posto.
  if (risposta.state !== state) throw new Error("Risposta di Google non riconosciuta: riprova.");

  const scambio = await scambiaCodice(risposta.code, pendente.verifier);
  storeToken(scambio.access_token, scambio.expires_in, scambio.refresh_token);

  try {
    const profile = await fetchProfile(scambio.access_token);
    localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
    return profile;
  } catch {
    // Il calendario è collegato anche senza il profilo: meglio un collegamento
    // senza nome mostrato che un errore che fa credere fallito l'accesso.
    return { email: "", name: "Account Google" };
  }
}

/**
 * Restituisce un token valido, rinnovandolo in silenzio quando scade e, solo
 * se non è possibile, riaprendo il consenso.
 */
export async function accessToken(): Promise<string> {
  const token = readToken();
  if (token && token.expiresAt > Date.now() + 60_000) return token.accessToken;
  if (token?.refreshToken) {
    try {
      return await rinnovaConRefresh(token.refreshToken);
    } catch (error) {
      if (!(error instanceof Error) || error.message !== "COLLEGAMENTO_SCADUTO") throw error;
      disconnect();
    }
  }
  await connect();
  const fresco = readToken();
  if (!fresco) throw new Error("Impossibile ottenere un token da Google");
  return fresco.accessToken;
}
