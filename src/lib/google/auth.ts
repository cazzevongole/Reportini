const SCOPES = "https://www.googleapis.com/auth/calendar.events";
const TOKEN_KEY = "reportini.google.token";
const PROFILE_KEY = "reportini.google.profile";

const GSI_SRC = "https://accounts.google.com/gsi/client";

export interface GoogleProfile {
  email: string;
  name: string;
  picture?: string;
}

export interface StoredToken {
  accessToken: string;
  expiresAt: number;
}

let gisLoading: Promise<void> | null = null;

/** Carica lo script Google Identity Services una sola volta per sessione. */
function loadGis(): Promise<void> {
  if (gisLoading) return gisLoading;
  gisLoading = new Promise<void>((resolve, reject) => {
    if (document.querySelector(`script[src="${GSI_SRC}"]`)) {
      resolve();
      return;
    }
    const script = document.createElement("script");
    script.src = GSI_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () =>      reject(new Error("Impossibile caricare l'SDK di Google"));
    document.head.appendChild(script);
  });
  return gisLoading;
}

export const clientId = (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined) ?? "";

export const googleConfigured = Boolean(clientId);

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

function storeToken(accessToken: string, profile?: GoogleProfile): void {
  localStorage.setItem(
    TOKEN_KEY,
    JSON.stringify({ accessToken, expiresAt: Date.now() + 55 * 60_000 }),
  );
  if (profile) localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
}

export function disconnect(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(PROFILE_KEY);
}

async function fetchProfile(accessToken: string): Promise<GoogleProfile> {
  const response = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) throw new Error("Impossibile ottenere il profilo Google");
  const data = (await response.json()) as { email: string; name: string; picture?: string };
  return { email: data.email, name: data.name, picture: data.picture };
}

/** Apre il popup di consenso Google e conserva il token di accesso ottenuto. */
export async function connect(): Promise<GoogleProfile> {
  if (!googleConfigured) {
    throw new Error(
      "Manca VITE_GOOGLE_CLIENT_ID. Aggiungilo in Settings → Environment per collegare Google Calendar.",
    );
  }
  await loadGis();
  const oauth2 = (
    window as unknown as {
      google: {
        accounts: {
          oauth2: {
            initTokenClient: (config: {
              client_id: string;
              scope: string;
              callback: (response: { access_token?: string; error?: string }) => void;
              error_callback: (error: { type?: string; message?: string }) => void;
            }) => { requestAccessToken: (options?: { prompt?: string }) => void };
          };
        };
      };
    }
  ).google.accounts.oauth2;

  return new Promise<GoogleProfile>((resolve, reject) => {
    const client = oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPES,
      callback: async (response) => {
        if (!response.access_token) {
          reject(new Error("Google non ha restituito un token di accesso"));
          return;
        }
        try {
          const profile = await fetchProfile(response.access_token);
          storeToken(response.access_token, profile);
          resolve(profile);
        } catch (error) {
          reject(error);
        }
      },
      error_callback: (error) => {
        reject(new Error(error.message || "Connessione a Google annullata"));
      },
    });
    client.requestAccessToken({ prompt: "consent" });
  });
}

/**
 * Restituisce un token di accesso valido, ricollegandosi in silenzio quando
 * scade: Google concede token di un'ora, quindi una sessione lunga va rinnovata.
 */
export async function accessToken(): Promise<string> {
  const token = readToken();
  if (token && token.expiresAt > Date.now() + 60_000) return token.accessToken;
  const profile = await connect();
  const fresh = readToken();
  if (!fresh) throw new Error("Impossibile rinnovare la sessione Google");
  void profile;
  return fresh.accessToken;
}
