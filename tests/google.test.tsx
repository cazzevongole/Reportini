import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MESSAGGIO_RITORNO,
  accessToken,
  connect,
  disconnect,
  isConnected,
  readToken,
  consegnaRitornoPopup,
  sfidaDi,
} from "../src/lib/google/auth";

const CLIENT_ID = "123.apps.googleusercontent.com";
const TOKEN_KEY = "reportini.google.token";
// Definito in vitest.config.ts: Vite sostituisce import.meta.env in fase di
// trasformazione, quindi lo stub a runtime arriverebbe troppo tardi.

function popupFalso() {
  return { close: vi.fn() };
}

function rispostaJson(dati: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    text: async () => JSON.stringify(dati),
    json: async () => dati,
  } as unknown as Response;
}

/** Trova il body della chiamata a un endpoint, decodificato da form. */
function corpoPost(url: string): URLSearchParams | null {
  const chiamata = fetchMock.mock.calls.find(([a]) => String(a).includes(url));
  if (!chiamata) return null;
  return new URLSearchParams(String((chiamata[1] as RequestInit | undefined)?.body ?? ""));
}

let fetchMock: ReturnType<typeof vi.fn>;
let aperto: ReturnType<typeof popupFalso>;
let urlAperta: string;

beforeEach(async () => {
  localStorage.clear();
  sessionStorage.clear();
  const modulo = await import("../src/lib/google/auth");
  expect(modulo.googleConfigured).toBe(true);

  aperto = popupFalso();
  urlAperta = "";
  vi.stubGlobal("open", vi.fn((url: string) => {
    urlAperta = String(url);
    return aperto;
  }));
  fetchMock = vi.fn(async () => rispostaJson({}));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Simula la risposta del popup di Google. */
function rispondiPopup(payload: Record<string, string>) {
  window.dispatchEvent(
    new MessageEvent("message", {
      data: { tipo: MESSAGGIO_RITORNO, ...payload },
      origin: window.location.origin,
    }),
  );
}

/** Fa partire connect() e risponde al popup con il codice ricavato dallo state. */
async function completaCollegamento(codice = "auth-code") {
  const attesa = connect();
  // Lo state è generato dentro connect(): lo si legge dalla URL del popup.
  for (let tentativo = 0; tentativo < 50 && !urlAperta.includes("state="); tentativo += 1) {
    await new Promise((r) => setTimeout(r, 0));
  }
  const state = new URL(urlAperta).searchParams.get("state") ?? "";
  rispondiPopup({ code: codice, state });
  return attesa;
}

describe("Flusso OAuth con PKCE", () => {
  it("calcola la sfida come S256 secondo la RFC 7636", async () => {
    // Vettore di prova ufficiale (RFC 7636, appendice B): se questo passa, il
    // computation della sfida è corretto e lo scambio del codice può riuscire.
    expect(
      await sfidaDi("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
    ).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });

  it("costruisce l'URL di autorizzazione con code_challenge S256 e offline access", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).includes("oauth2.googleapis.com/token")) {
        return rispostaJson({ access_token: "at-1", expires_in: 3600, refresh_token: "rt-1" });
      }
      return rispostaJson({ email: "mara@example.it", name: "Mara" });
    });

    await completaCollegamento();

    const url = new URL(urlAperta);
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(url.searchParams.get("client_id")).toBe(CLIENT_ID);
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("scope")).toContain("calendar.events");
    // La sfida non è il verifier: deve essere l'hash.
    expect(url.searchParams.get("code_challenge")).not.toBeNull();
    expect(url.searchParams.get("code_challenge")?.length).toBeGreaterThan(40);
  });

  it("scambia il codice con il verifier e conserva il refresh token", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).includes("oauth2.googleapis.com/token")) {
        return rispostaJson({ access_token: "at-1", expires_in: 3600, refresh_token: "rt-1" });
      }
      return rispostaJson({ email: "mara@example.it", name: "Mara Rossi" });
    });

    const profilo = await completaCollegamento();

    const scambio = corpoPost("oauth2.googleapis.com/token");
    expect(scambio?.get("grant_type")).toBe("authorization_code");
    expect(scambio?.get("code")).toBe("auth-code");
    // Il verifier non viaggia mai nell'URL: solo nello scambio, col codice.
    expect(scambio?.get("code_verifier")).toBeTruthy();
    expect(urlAperta).not.toContain(scambio?.get("code_verifier") ?? "impossibile");

    expect(profilo.email).toBe("mara@example.it");
    const token = readToken();
    expect(token?.accessToken).toBe("at-1");
    expect(token?.refreshToken).toBe("rt-1");
    expect(isConnected()).toBe(true);
  });

  it("rifiuta una risposta il cui state non corrisponde", async () => {
    const inCorso = connect();
    for (let i = 0; i < 50 && !urlAperta.includes("state="); i += 1) {
      await new Promise((r) => setTimeout(r, 0));
    }
    // state inventato: la risposta va scartata senza interrogare Google.
    rispondiPopup({ code: "iniettato", state: "altro" });
    await expect(inCorso).rejects.toThrow(/non riconosciuta/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("Rinnovo del token", () => {
  it("usa il refresh token quando il token è scaduto, senza aprire il popup", async () => {
    localStorage.setItem(
      TOKEN_KEY,
      JSON.stringify({ accessToken: "vecchio", expiresAt: Date.now() - 1000, refreshToken: "rt-1" }),
    );
    fetchMock.mockImplementation(async () =>
      rispostaJson({ access_token: "at-2", expires_in: 3600 }),
    );

    const token = await accessToken();

    expect(token).toBe("at-2");
    const rinnovo = corpoPost("oauth2.googleapis.com/token");
    expect(rinnovo?.get("grant_type")).toBe("refresh_token");
    expect(rinnovo?.get("refresh_token")).toBe("rt-1");
    expect(readToken()?.refreshToken).toBe("rt-1");
    // Nessun popup: è un rinnovo silenzioso.
    expect(aperto.close).not.toHaveBeenCalled();
  });

  it("non perde il refresh token quando Google non lo rinvia", async () => {
    localStorage.setItem(
      TOKEN_KEY,
      JSON.stringify({ accessToken: "vecchio", expiresAt: Date.now() - 1000, refreshToken: "rt-1" }),
    );
    fetchMock.mockImplementation(async () => rispostaJson({ access_token: "at-3", expires_in: 3600 }));

    await accessToken();

    expect(readToken()?.refreshToken).toBe("rt-1");
  });

  it("collega di nuovo quando il refresh token è stato revocato", async () => {
    localStorage.setItem(
      TOKEN_KEY,
      JSON.stringify({ accessToken: "vecchio", expiresAt: Date.now() - 1000, refreshToken: "rt-1" }),
    );
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).includes("oauth2.googleapis.com/token")) {
        // Prima il rinnovo fallisce, poi lo scambio del consenso riesce.
        const chiamate = fetchMock.mock.calls.filter(([u]) =>
          String(u).includes("oauth2.googleapis.com/token"),
        ).length;
        if (chiamate === 1) return rispostaJson({ error: "invalid_grant" }, false, 400);
        return rispostaJson({ access_token: "at-4", expires_in: 3600, refresh_token: "rt-2" });
      }
      return rispostaJson({ email: "mara@example.it", name: "Mara" });
    });

    const attesa = accessToken();
    for (let i = 0; i < 50 && !urlAperta.includes("state="); i += 1) {
      await new Promise((r) => setTimeout(r, 0));
    }
    const state = new URL(urlAperta).searchParams.get("state") ?? "";
    rispondiPopup({ code: "nuovo", state });

    expect(await attesa).toBe("at-4");
    expect(readToken()?.refreshToken).toBe("rt-2");
  });
});

describe("Ritorno dal popup", () => {
  it("consegna il codice a chi ha aperto la finestra e si chiude", () => {
    const post = vi.fn();
    const chiudi = vi.fn();
    // jsdom espone opener come proprietà semplice.
    Object.defineProperty(window, "opener", { value: { postMessage: post }, configurable: true });
    window.close = chiudi;
    const storico = window.location.search;
    window.history.replaceState({}, "", "/?code=abc&state=xyz");

    consegnaRitornoPopup();

    expect(post).toHaveBeenCalledWith(
      { tipo: MESSAGGIO_RITORNO, state: "xyz", code: "abc", errore: undefined },
      window.location.origin,
    );
    expect(chiudi).toHaveBeenCalled();

    window.history.replaceState({}, "", storico || "/");
    Object.defineProperty(window, "opener", { value: null, configurable: true });
  });

  it("non fa nulla in una scheda normale", () => {
    Object.defineProperty(window, "opener", { value: null, configurable: true });
    const post = vi.fn();
    window.history.replaceState({}, "", "/");
    expect(() => consegnaRitornoPopup()).not.toThrow();
    expect(post).not.toHaveBeenCalled();
  });
});

describe("Scollegamento", () => {
  it("cancella i dati locali e revoca il consenso", () => {
    localStorage.setItem(TOKEN_KEY, JSON.stringify({ accessToken: "at-1", expiresAt: Date.now() + 1000 }));
    disconnect();
    expect(readToken()).toBeNull();
    expect(isConnected()).toBe(false);
    const revoca = fetchMock.mock.calls.find(([u]) => String(u).includes("revoke"));
    expect(revoca).toBeDefined();
    // Il token da revocare viaggia nella query, non nel corpo della richiesta.
    expect(String(revoca?.[0])).toContain("token=at-1");
  });
});
