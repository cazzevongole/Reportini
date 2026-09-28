import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  accessToken,
  adottaTokenDiSessione,
  connect,
  disconnect,
  isConnected,
  readToken,
  SCOPO_CALENDARIO,
} from "../src/lib/google/auth";

const TOKEN_KEY = "reportini.google.token";
const PROFILE_KEY = "reportini.google.profile";

type ChiamataOAuth = {
  provider: string;
  options: {
    redirectTo: string;
    scopes: string;
    queryParams: { access_type: string; prompt: string };
  };
};

// vi.hoisted: la factory gira durante l'import dei moduli di production,
// prima che le const del file siano inizializzate.
const finto = vi.hoisted(() => ({
  signInWithOAuth: vi.fn(async (_argomento: unknown) => ({ error: null })),
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({ auth: { signInWithOAuth: finto.signInWithOAuth } }),
}));

let fetchMock: ReturnType<typeof vi.fn>;

function rispostaJson(dati: unknown, ok = true) {
  return { ok, json: async () => dati, text: async () => JSON.stringify(dati) } as unknown as Response;
}

beforeEach(() => {
  localStorage.clear();
  finto.signInWithOAuth.mockClear();
  fetchMock = vi.fn(async () => rispostaJson({}));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Token Google dalla sessione Supabase", () => {
  it("custodisce il token che Supabase ha scambiato", () => {
    adottaTokenDiSessione("ya29.token-reale");

    expect(readToken()?.accessToken).toBe("ya29.token-reale");
    expect(isConnected()).toBe(true);
  });

  it("non lascia scadere il token: un'ora meno il margine di sicurezza", () => {
    adottaTokenDiSessione("ya29.token-reale");

    // 3600s - 60s di margine.
    const { expiresAt } = readToken()!;
    const rimanenti = expiresAt - Date.now();
    expect(rimanenti).toBeGreaterThan(3_500_000);
    expect(rimanenti).toBeLessThan(3_600_000);
  });

  it("non sovrascrive un token identico e non si rompe su sessione senza token", () => {
    adottaTokenDiSessione("ya29.token-reale");
    const primo = readToken();

    adottaTokenDiSessione("ya29.token-reale");
    expect(readToken()?.expiresAt).toBe(primo?.expiresAt);

    // Utente non Google, o scope non concesso: non deve succedere nulla.
    adottaTokenDiSessione(null);
    adottaTokenDiSessione(undefined);
    expect(readToken()?.accessToken).toBe("ya29.token-reale");
  });

  it("arricchisce il profilo quando Google risponde", async () => {
    fetchMock.mockImplementation(async () =>
      rispostaJson({ email: "mara@example.it", name: "Mara Rossi", picture: "https://img/f" }),
    );

    adottaTokenDiSessione("ya29.token-reale");
    await new Promise((r) => setTimeout(r, 0));

    const profilo = JSON.parse(localStorage.getItem(PROFILE_KEY) ?? "{}");
    expect(profilo.email).toBe("mara@example.it");
  });

  it("se il profilo non arriva il token resta valido: è solo cosmetico", async () => {
    fetchMock.mockImplementation(async () => rispostaJson({}, false));

    adottaTokenDiSessione("ya29.token-reale");
    await new Promise((r) => setTimeout(r, 0));

    expect(readToken()?.accessToken).toBe("ya29.token-reale");
    expect(localStorage.getItem(PROFILE_KEY)).toBeNull();
  });
});

describe("Collegamento", () => {
  it("chiede l'accesso con Google includendo lo scope Calendar", async () => {
    const inCorso = connect();
    // La pagina viene scaricata: la promise non si conclude mai.
    expect(finto.signInWithOAuth).toHaveBeenCalled();
    const opzioni = finto.signInWithOAuth.mock.calls[0][0] as ChiamataOAuth;
    expect(opzioni.provider).toBe("google");
    // Nella lista degli scope deve esserci l'URL esatto: "offline" e
    // "consent" finirebbero come scope letterali e non chiederebbero nulla.
    expect(opzioni.options.scopes).toBe(SCOPO_CALENDARIO);
    expect(opzioni.options.queryParams).toEqual({ access_type: "offline", prompt: "consent" });
    expect(opzioni.options.redirectTo).toBeTruthy();
    void inCorso;
  });

  it("usa lo scope calendar.events dichiarato nel modulo", () => {
    expect(SCOPO_CALENDARIO).toBe("https://www.googleapis.com/auth/calendar.events");
  });
});

describe("Scadenza del token", () => {
  it("accessToken restituisce il token valido", async () => {
    adottaTokenDiSessione("ya29.valido");
    await expect(accessToken()).resolves.toBe("ya29.valido");
  });

  it("un token scaduto spiega che serve un nuovo accesso, non fallisce in silenzio", async () => {
    // Un client pubblico non può rinnovare: pretende un client secret che
    // non possiede. Meglio un messaggio che dia la mano.
    localStorage.setItem(
      TOKEN_KEY,
      JSON.stringify({ accessToken: "vecchio", expiresAt: Date.now() - 1000 }),
    );
    await expect(accessToken()).rejects.toThrow(/scaduto/i);
  });

  it("scollegare cancella il token e revoca il consenso", () => {
    adottaTokenDiSessione("ya29.token-reale");
    disconnect();

    expect(readToken()).toBeNull();
    expect(isConnected()).toBe(false);
    const revoca = fetchMock.mock.calls.find(([u]) => String(u).includes("revoke"));
    expect(String(revoca?.[0])).toContain("token=ya29.token-reale");
  });
});
