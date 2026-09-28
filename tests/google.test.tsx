/**
 * Google: accesso e calendario in un solo consenso.
 *
 * Qui si prova il pezzo che prima non esisteva: il passaggio dal "token
 * arriva con la sessione Supabase e muore dopo un'ora" a un flusso unico,
 * dove l'authorize chiede profilo e calendario insieme, l'id_token apre la
 * sessione su Supabase e i token del calendario restano all'app. Il backend è
 * finto con fetch: quello che conta è che il secret resti da qualche parte
 * che non sia il browser.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  SCOPO_CALENDARIO,
  SCOPO_PROFILO,
  accessToken,
  avviaAccessoGoogle,
  clientId,
  completaAccesso,
  disconnect,
  googleConfigured,
  isConnected,
  readErroreCollegamento,
  readToken,
  statoBackend,
} from "../src/lib/google/auth";
import { urlDiRitorno } from "../src/lib/cloud/destinazione";

const TOKEN_KEY = "reportini.google.token";
const PROFILE_KEY = "reportini.google.profile";
const RITORNO_KEY = "reportini.google.ritorno";

/** Sessione Supabase: senza, la funzione rifiuterebbe la richiesta. */
const SESSIONE = { access_token: "jwt-utente", user: { id: "u-1" } };

const finto = vi.hoisted(() => ({
  getSession: vi.fn(async () => ({ data: { session: null as { access_token: string } | null } })),
  signInWithIdToken: vi.fn(async (_argomento: unknown) => ({ data: {}, error: null })),
  signInWithOAuth: vi.fn(async (_argomento: unknown) => ({ error: null })),
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    auth: {
      getSession: finto.getSession,
      signInWithIdToken: finto.signInWithIdToken,
      signInWithOAuth: finto.signInWithOAuth,
    },
  }),
}));

let fetchMock: ReturnType<typeof vi.fn>;
/** Dove finisce la navigazione di `window.location.assign`. */
let assegnata: string | null = null;

function rispostaJson(dati: unknown, stato = 200) {
  return {
    ok: stato >= 200 && stato < 300,
    status: stato,
    json: async () => dati,
    text: async () => JSON.stringify(dati),
  } as unknown as Response;
}

/** Risposte della funzione, per azione. */
const risposte = new Map<string, { dati: unknown; stato: number }>();

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  risposte.clear();
  finto.getSession.mockReset();
  finto.getSession.mockResolvedValue({ data: { session: SESSIONE } });
  finto.signInWithIdToken.mockClear();
  finto.signInWithOAuth.mockClear();
  assegnata = null;
  fetchMock = vi.fn(async (url: unknown, opzioni?: { body?: string }) => {
    const corpo = opzioni?.body ? (JSON.parse(opzioni.body) as { azione: string }) : { azione: "" };
    const risposta = risposte.get(corpo.azione);
    if (risposta) return rispostaJson(risposta.dati, risposta.stato);
    if (String(url).includes("userinfo")) {
      return rispostaJson({ email: "mara@example.it", name: "Mara Rossi" });
    }
    return rispostaJson({});
  });
  vi.stubGlobal("fetch", fetchMock);
  // Il modulo costruisce gli URL a partire da window.location, e in jsdom
  // l'origin è fisso: qui basta sapere da dove si parte.
  Object.defineProperty(window, "location", {
    configurable: true,
    value: {
      ...window.location,
      origin: "https://cazzevongole.github.io",
      href: "https://cazzevongole.github.io/Reportini/panel",
      pathname: "/Reportini/panel",
      search: "",
      hash: "",
      assign: (destinazione: string) => {
        assegnata = destinazione;
      },
      replaceState: () => {},
    },
  });
  window.history.replaceState({}, "", "/Reportini/panel");
});

afterEach(() => {
  vi.unstubAllGlobals();
  // Il ponte desktop si mette e si toglie qui: un test che lo lascia dietro
  // farebbe fallire tutti quelli dopo, che si aspettano la navigazione.
  delete (window as unknown as { reportini?: unknown }).reportini;
});

function scriveToken(accessToken: string, refreshToken: string | null, scadeFra: number) {
  localStorage.setItem(
    TOKEN_KEY,
    JSON.stringify({ accessToken, refreshToken, expiresAt: Date.now() + scadeFra }),
  );
}

function chiamateFunzione(): Record<string, unknown>[] {
  return fetchMock.mock.calls
    .map(([url, opzioni]) => ({ url: String(url), opzioni }))
    .filter((c) => c.url.includes("/functions/v1/google-token"))
    .map((c) => JSON.parse((c.opzioni as { body: string }).body));
}

describe("Accesso con Google, calendario incluso", () => {
  it("va all'authorize chiedendo profilo e calendario nella stessa richiesta", async () => {
    const inCorso = avviaAccessoGoogle();
    void inCorso; // la pagina viene scaricata: la promise non si conclude

    expect(assegnata).toBeTruthy();
    const url = new URL(assegnata!);
    expect(url.origin).toBe("https://accounts.google.com");
    expect(url.pathname).toBe("/o/oauth2/v2/auth");
    expect(url.searchParams.get("client_id")).toBe(clientId);
    expect(url.searchParams.get("response_type")).toBe("code");
    // È questo il punto: una sola schermata di consenso per profilo e
    // calendario. Con due richieste OAuth separate l'utente ne vedrebbe due.
    const scope = (url.searchParams.get("scope") ?? "").split(" ");
    expect(scope).toContain("openid");
    expect(scope).toContain("email");
    expect(scope).toContain(SCOPO_CALENDARIO);
    // offline è ciò che fa arrivare il refresh token: senza, il rinnovo non
    // esiste e il backend è inutile.
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(url.searchParams.get("state")).toBeTruthy();
  });

  it("dichiara gli scope attesi dal modulo", () => {
    expect(SCOPO_CALENDARIO).toBe("https://www.googleapis.com/auth/calendar.events");
    expect(SCOPO_PROFILO).toBe("openid email profile");
  });

  it("sul desktop apre il consenso nel browser di sistema, non nella finestra", async () => {
    // Google rifiuta l'accesso dai browser incorporati: aperto nella finestra
    // di Electron il consenso risponde "This browser or app may not be
    // secure". Quindi sul desktop la pagina non deve navigare, e l'app deve
    // restare viva ad aspettare che il ritorno arrivi dalla porta locale.
    const aperte: string[] = [];
    (window as unknown as { reportini: unknown }).reportini = {
      apriUrlEsterno: async (url: string) => {
        aperte.push(url);
        return true;
      },
    };

    const esito = await avviaAccessoGoogle();

    expect(esito).toBe("browser");
    // Navigare sarebbe finito nella pagina di blocco di Google: qui la
    // finestra deve restare dov'è.
    expect(assegnata).toBeNull();
    expect(aperte[0]).toBeTruthy();
    expect(new URL(aperte[0]).origin).toBe("https://accounts.google.com");
  });

  it("il redirect dichiarato a Google è quello che verrà usato nello scambio", async () => {
    void avviaAccessoGoogle();
    const dichiarato = new URL(assegnata!).searchParams.get("redirect_uri");
    const salvato = JSON.parse(sessionStorage.getItem(RITORNO_KEY) ?? "{}");
    expect(dichiarato).toBe(salvato.redirect);
    // Se i due differiscono, Google risponde redirect_uri_mismatch e il
    // collegamento muore con un errore che sembra di permessi. Qui BASE_URL è
    // "/" (in produzione su GitHub Pages aggiunge /Reportini).
    expect(dichiarato).toBe("https://cazzevongole.github.io");
  });
});

describe("Ritorno da Google", () => {
  function tornaCon(parametri: Record<string, string>) {
    const cerca = new URLSearchParams(parametri);
    Object.defineProperty(window, "location", {
      configurable: true,
      value: {
        ...window.location,
        href: `https://cazzevongole.github.io/Reportini/panel?${cerca.toString()}`,
        search: `?${cerca.toString()}`,
      },
    });
  }

  function statoRitorno(state: string) {
    // Lo stesso URL che avviaAccessoGoogle() dichiara a Google: è la condizione
    // perché lo scambio non si fermi con redirect_uri_mismatch.
    sessionStorage.setItem(
      RITORNO_KEY,
      JSON.stringify({ state, redirect: urlDiRitorno(window.location.origin, import.meta.env.BASE_URL) }),
    );
  }

  function scambioPronto() {
    risposte.set("scambio", {
      dati: {
        id_token: "id-token-di-google",
        access_token: "ya29.nuovo",
        refresh_token: "1//refresh",
        expires_in: 3600,
      },
      stato: 200,
    });
  }

  it("dal code apre la sessione su Supabase e tiene il token del calendario", async () => {
    statoRitorno("abc123");
    tornaCon({ code: "il-code", state: "abc123" });
    scambioPronto();

    await expect(completaAccesso()).resolves.toBe("calendario");

    const [chiamata] = chiamateFunzione();
    expect(chiamata.azione).toBe("scambio");
    expect(chiamata.code).toBe("il-code");
    // Il redirect_uri deve combaciare con quello dell'authorize, altrimenti
    // Google risponde redirect_uri_mismatch.
    expect(chiamata.redirect_uri).toBe("https://cazzevongole.github.io");
    // La sessione la apre Supabase validando l'id_token con il Client ID
    // configurato nel progetto: se non passasse quello, l'accesso non
    // funzionerebbe e l'errore sarebbe un "audience" incomprensibile.
    expect(finto.signInWithIdToken).toHaveBeenCalledWith({
      provider: "google",
      token: "id-token-di-google",
    });
    expect(readToken()?.accessToken).toBe("ya29.nuovo");
    expect(readToken()?.refreshToken).toBe("1//refresh");
    expect(isConnected()).toBe(true);
  });

  it("sul desktop il rientro arriva dalla session, non dall'URL", async () => {
    // Il main process mette il rientro in `sessionStorage` e riporta la
    // finestra su un indirizzo pulito. Se il renderer guardasse solo l'URL, sul
    // desktop non chiuderebbe mai l'accesso — ed è esattamente quello che
    // faceva, con la pagina che non si aggiornava.
    statoRitorno("abc123");
    tornaCon({});
    sessionStorage.setItem("reportini.google.arrivo", "code=il-code&state=abc123");
    scambioPronto();

    await expect(completaAccesso()).resolves.toBe("calendario");

    expect(chiamateFunzione()[0].code).toBe("il-code");
    // E non resta appeso: un rientno vecchio non deve riaprire l'accesso al
    // ricaricamento successivo.
    expect(sessionStorage.getItem("reportini.google.arrivo")).toBeNull();
  });

  it("dopo lo scambio arricchisce il profilo, ma senza profilo il collegamento regge", async () => {
    statoRitorno("abc123");
    tornaCon({ code: "il-code", state: "abc123" });
    scambioPronto();

    await completaAccesso();
    await new Promise((r) => setTimeout(r, 0));

    // Il profilo è cosmetico: anche se Google non risponde, il token c'è.
    expect(JSON.parse(localStorage.getItem(PROFILE_KEY) ?? "{}").email).toBe("mara@example.it");
    expect(readToken()?.accessToken).toBe("ya29.nuovo");
  });

  it("manda il JWT di Supabase quando c'è: il rinnovo lo pretende", async () => {
    statoRitorno("abc123");
    tornaCon({ code: "il-code", state: "abc123" });
    scambioPronto();

    await completaAccesso();

    const conToken = fetchMock.mock.calls.find(([url]) => String(url).includes("/functions/v1/"));
    const intestazioni = (conToken?.[1] as { headers: Record<string, string> }).headers;
    expect(intestazioni.Authorization).toBe("Bearer jwt-utente");
  });

  it("un code con uno state diverso dal nostro viene rifiutato", async () => {
    statoRitorno("abc123");
    tornaCon({ code: "code-di-qualcun-altro", state: "inventato" });

    await expect(completaAccesso()).resolves.toBe("nessuno");
    expect(readErroreCollegamento()).toMatch(/non riconosciuto/i);
    expect(readToken()).toBeNull();
    expect(chiamateFunzione()).toHaveLength(0);
  });

  it("un consenso annullato viene detto, non lasciato in silenzio", async () => {
    statoRitorno("abc123");
    tornaCon({ error: "access_denied", state: "abc123" });

    await expect(completaAccesso()).resolves.toBe("nessuno");
    expect(readErroreCollegamento()).toMatch(/annullato/i);
  });

  it("senza code non è un rientro: non fa niente e non tocca nulla", async () => {
    await expect(completaAccesso()).resolves.toBe("nessuno");
    expect(chiamateFunzione()).toHaveLength(0);
  });

  it("un code di cui non ci siamo persi traccia non è nostro: si ignora", async () => {
    // Nessun ritorno salvato in sessionStorage: questo `code` arriva da
    // qualcos'altro (un accesso in PKCE, per esempio) e non deve produrre né
    // una richiesta al backend né un errore in faccia all'utente.
    tornaCon({ code: "code-di-un-altro-flusso" });
    await expect(completaAccesso()).resolves.toBe("nessuno");
    expect(chiamateFunzione()).toHaveLength(0);
    expect(readErroreCollegamento()).toBeNull();
  });

  it("se il backend non ha i segreti, l'utente entra comunque e sa cosa manca", async () => {
    statoRitorno("abc123");
    tornaCon({ code: "il-code", state: "abc123" });
    risposte.set("scambio", {
      dati: { errore: "Backend Google non pronto: manca GOOGLE_CLIENT_SECRET." },
      stato: 503,
    });

    // Non si butta fuori l'utente: ripiega sull'accesso con Supabase da sola.
    await expect(completaAccesso()).resolves.toBe("solo-account");
    expect(finto.signInWithOAuth).toHaveBeenCalled();
    expect(readErroreCollegamento()).toMatch(/GOOGLE_CLIENT_SECRET/);
    expect(readErroreCollegamento()).toMatch(/senza calendario/);
    expect(readToken()).toBeNull();
  });

  it("se Supabase rifiuta l'id_token, l'utente entra lo stesso", async () => {
    statoRitorno("abc123");
    tornaCon({ code: "il-code", state: "abc123" });
    scambioPronto();
    finto.signInWithIdToken.mockResolvedValueOnce({
      data: {},
      error: { message: "invalid audience in ID token" },
    } as never);

    await expect(completaAccesso()).resolves.toBe("solo-account");
    expect(readErroreCollegamento()).toMatch(/audience/);
  });
});

describe("Rinnovo in silenzio", () => {
  it("un token scaduto con refresh token si rinnova da solo", async () => {
    scriveToken("ya29.vecchio", "1//refresh", -1000);
    risposte.set("rinnovo", { dati: { access_token: "ya29.fresco", expires_in: 3600 }, stato: 200 });

    await expect(accessToken()).resolves.toBe("ya29.fresco");
    expect(readToken()?.accessToken).toBe("ya29.fresco");
    // Se Google non rimanda il refresh token si tiene quello di prima.
    expect(readToken()?.refreshToken).toBe("1//refresh");
  });

  it("un token ancora valido non fa nessuna richiesta", async () => {
    scriveToken("ya29.valido", "1//refresh", 3_600_000);
    await expect(accessToken()).resolves.toBe("ya29.valido");
    expect(chiamateFunzione()).toHaveLength(0);
  });

  it("due richieste contemporanee fanno un solo rinnovo", async () => {
    scriveToken("ya29.vecchio", "1//refresh", -1000);
    risposte.set("rinnovo", { dati: { access_token: "ya29.fresco", expires_in: 3600 }, stato: 200 });

    const [uno, due] = await Promise.all([accessToken(), accessToken()]);
    expect(uno).toBe("ya29.fresco");
    expect(due).toBe("ya29.fresco");
    expect(chiamateFunzione()).toHaveLength(1);
  });

  it("senza refresh token spiega che va ricollegato", async () => {
    localStorage.setItem(
      TOKEN_KEY,
      JSON.stringify({ accessToken: "vecchio", refreshToken: null, expiresAt: Date.now() - 1000 }),
    );
    await expect(accessToken()).rejects.toThrow(/ricollegalo/i);
  });

  it("un consenso revocato da Google viene detto all'utente", async () => {
    scriveToken("ya29.vecchio", "1//refresh", -1000);
    risposte.set("rinnovo", {
      dati: { errore: "Il collegamento con Google non è più valido: ricollegalo dalle impostazioni." },
      stato: 401,
    });

    await expect(accessToken()).rejects.toThrow(/non è più valido/i);
    expect(readErroreCollegamento()).toMatch(/non è più valido/i);
  });
});

describe("Scollegare e stato del backend", () => {
  it("scollegare cancella il token e revoca il consenso", async () => {
    scriveToken("ya29.token-reale", "1//refresh", 3_600_000);
    await disconnect();

    expect(readToken()).toBeNull();
    expect(isConnected()).toBe(false);
    const revoca = fetchMock.mock.calls.find(([u]) => String(u).includes("revoke"));
    expect(String(revoca?.[0])).toContain("token=ya29.token-reale");
  });

  it("un collegamento senza refresh token ma ancora valido resta collegato", () => {
    scriveToken("ya29.valido", null, 3_600_000);
    expect(isConnected()).toBe(true);
  });

  it("dice se la funzione è pubblicata: 404 vuol dire che manca", async () => {
    fetchMock.mockImplementation(async (url: unknown) =>
      String(url).includes("/functions/v1/")
        ? rispostaJson({ code: "WORKER_NOT_FOUND" }, 404)
        : rispostaJson({}),
    );
    await expect(statoBackend()).resolves.toBe("non-pubblicata");

    fetchMock.mockImplementation(async (url: unknown) =>
      String(url).includes("/functions/v1/") ? rispostaJson({ errore: "Serve un POST." }, 405) : rispostaJson({}),
    );
    await expect(statoBackend()).resolves.toBe("pronto");
  });
});

describe("Configurazione", () => {
  it("senza client Google il calendario è dichiarato non disponibile", () => {
    expect(googleConfigured).toBe(Boolean(clientId));
  });
});
