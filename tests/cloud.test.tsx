/**
 * Verifica i flussi di account e salvataggio online con un client Supabase finto:
 * non servono credenziali reali per controllare che il login, la sincronizzazione
 * e il gating della dashboard sviluppatore si comportino come previsto.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "fake-indexeddb/auto";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { urlDiRitorno } from "../src/lib/cloud/destinazione";

const CHIAVE = "sviluppo@example.it";

/* ------------------------------ Supabase finto ----------------------------- */

type Ascoltatore = (evento: string, sessione: unknown) => void;

const stato = {
  sessione: null as { user: { id: string; email: string } } | null,
  storage: new Map<string, Blob>(),
  listener: null as Ascoltatore | null,
  firmati: [] as Array<{ path: string; bytes: Uint8Array }>,
  versione: 0,
};

const supabaseFinto = {
  auth: {
    getSession: vi.fn(async () => ({ data: { session: stato.sessione } })),
    onAuthStateChange: vi.fn((cb: Ascoltatore) => {
      stato.listener = cb;
      return { data: { subscription: { unsubscribe: vi.fn() } } };
    }),
    signInWithOAuth: vi.fn(async () => ({ error: null })),
    signOut: vi.fn(async () => {
      stato.sessione = null;
      stato.firmati = [];
    }),
  },
  storage: {
    from: () => ({
      upload: vi.fn(async (path: string, corpo: Blob | Uint8Array) => {
        const byte =
          corpo instanceof Uint8Array ? corpo : new Uint8Array(await (corpo as Blob).arrayBuffer());
        stato.storage.set(path, new Blob([byte.slice().buffer]));
        stato.firmati.push({ path, bytes: byte });
        return { error: null };
      }),
      download: vi.fn(async (path: string) => {
        const blob = stato.storage.get(path);
        if (!blob) return { data: null, error: { message: "not found" } };
        return { data: blob, error: null };
      }),
      remove: vi.fn(async (percorsi: string[]) => {
        for (const percorso of percorsi) stato.storage.delete(percorso);
        return { error: null };
      }),
    }),
  },
};

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => supabaseFinto,
}));

/** fetch stub: la diagnosi interroga /auth/v1/settings. */
const risposteFetch = new Map<string, unknown>();
vi.stubGlobal("fetch", async (url: string) => {
  const chiave = [...risposteFetch.entries()].find(([prefisso]) => String(url).startsWith(prefisso));
  return {
    ok: true,
    json: async () => chiave?.[1] ?? { external: { google: true } },
  } as Response;
});

/* ------------------------------ engine finto ------------------------------ */

vi.mock("../src/lib/sqlite/engine", () => ({
  initDatabase: vi.fn(async () => ({})),
  flush: vi.fn(async () => {}),
  snapshot: vi.fn(() => new Uint8Array([1, 2, 3, 4])),
  replaceDatabase: vi.fn(async () => {}),
  subscribe: vi.fn(() => () => {}),
  notifyChange: vi.fn(),
  getVersion: () => stato.versione,
  all: vi.fn(() => []),
  get: vi.fn(() => null),
  run: vi.fn(),
  insert: vi.fn(() => 1),
  update: vi.fn(),
  getDatabase: vi.fn(() => ({})),
  persist: vi.fn(async () => {}),
}));

/* ------------------------------- rendering --------------------------------- */

let contenitore: HTMLDivElement;
let radice: Root;

async function monta(scheda: string) {
  window.history.pushState({}, "", scheda);
  radice = createRoot(contenitore);
  await act(async () => {
    const { default: App } = await import("../src/App");
    const { AccountProvider } = await import("../src/lib/cloud/session");
    radice.render(
      <AccountProvider>
        <App />
      </AccountProvider>,
    );
  });
  for (let i = 0; i < 100; i += 1) {
    if (!contenitore.textContent?.includes("Apertura dei tuoi dati")) return;
    await act(async () => {
      await new Promise((r) => setTimeout(r, 5));
    });
  }
}

beforeEach(() => {
  stato.sessione = null;
  stato.storage.clear();
  stato.firmati = [];
  stato.listener = null;
  stato.versione = 0;
  supabaseFinto.auth.getSession.mockReset();
  supabaseFinto.auth.getSession.mockResolvedValue({ data: { session: null } });
  supabaseFinto.auth.signInWithOAuth.mockClear();
  supabaseFinto.auth.signOut.mockClear();
  contenitore = document.createElement("div");
  document.body.appendChild(contenitore);
});

afterEach(async () => {
  await act(async () => radice?.unmount());
  contenitore.remove();
});

async function entraCome(email: string) {
  stato.sessione = { user: { id: "utente-1", email } };
  supabaseFinto.auth.getSession.mockResolvedValue({ data: { session: stato.sessione } });
}

describe("Accesso con Google", () => {
  /** Condiviso dai test: monta il provider e tiene l'API dell'account. */
  async function montaAccount() {
    const { useAccount, AccountProvider } = await import("../src/lib/cloud/session");
    let stato: ReturnType<typeof useAccount> | null = null;

    function Sonda() {
      stato = useAccount();
      return null;
    }

    radice = createRoot(contenitore);
    await act(async () => {
      radice.render(
        <AccountProvider>
          <Sonda />
        </AccountProvider>,
      );
    });
    return () => stato!.signInWithGoogle();
  }

  it("chiama signInWithOAuth con il provider google e il redirect alla pagina", async () => {
    const accedi = await montaAccount();
    await act(async () => {
      await accedi();
    });

    expect(supabaseFinto.auth.signInWithOAuth).toHaveBeenCalledWith({
      provider: "google",
      options: {
        redirectTo: urlDiRitorno(window.location.origin, import.meta.env.BASE_URL),
      },
    });
  });

  it("torna alla sottocartella quando l'app è pubblicata su GitHub Pages", async () => {
    // Su github.io l'app vive in /Reportini/: tornare all'origine finirebbe
    // sulla pagina del profilo invece che sull'app.
    vi.stubEnv("BASE_URL", "/Reportini/");
    try {
      const accedi = await montaAccount();
      await act(async () => {
        await accedi();
      });
      expect(supabaseFinto.auth.signInWithOAuth).toHaveBeenCalledWith({
        provider: "google",
        options: { redirectTo: `${window.location.origin}/Reportini` },
      });
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("espone l'email dell'utente dopo l'accesso", async () => {
    await entraCome("utente@esempio.it");
    await monta("/panel");
    expect(contenitore.textContent).toContain("utente@esempio.it");
  });

  it("offre l'accesso quando non c'è sessione", async () => {
    await monta("/panel");
    expect(contenitore.textContent).toContain("Accedi con Google");
  });
});

describe("Salvataggio online", () => {
  it("carica il file dell'utente quando non esiste ancora nulla online", async () => {
    const { sincronizza } = await import("../src/lib/cloud/sync");
    const esito = await sincronizza("utente-1");
    expect(esito.scaricato).toBe(false);
    expect(stato.firmati.map((f) => f.path)).toContain("utente-1/reportini.sqlite");
    expect(stato.firmati.map((f) => f.path)).toContain("utente-1/reportini-meta.json");
  });

  it("ripristina la copia online quando un altro dispositivo ha scritto dopo", async () => {
    const { sincronizza, resetSincronizzazione } = await import("../src/lib/cloud/sync");
    const { replaceDatabase } = await import("../src/lib/sqlite/engine");
    vi.mocked(replaceDatabase).mockClear();

    // 1. Primo avvio su questo dispositivo: il cloud è vuoto, quindi si carica.
    await sincronizza("utente-1");
    expect(vi.mocked(replaceDatabase)).not.toHaveBeenCalled();

    // 2. Simula un altro dispositivo che scrive dopo di noi.
    stato.versione += 1;
    await sincronizza("utente-1");
    expect(vi.mocked(replaceDatabase)).not.toHaveBeenCalled();

    // 3. Cambio di account o di sessione: il device "nuovo" non sa nulla,
    //    quindi il cloud deve vincere e la copia locale vuota NON deve
    //    sovrascrivere i dati già presenti.
    resetSincronizzazione();
    stato.versione = 0;
    stato.firmati = [];
    const esito = await sincronizza("utente-1");
    expect(esito.scaricato).toBe(true);
    expect(esito.messaggio).toBe("Dati ripristinati dal cloud");
    expect(vi.mocked(replaceDatabase)).toHaveBeenCalledOnce();
    expect(stato.firmati).toHaveLength(0);
  });

  it("carica in locale le modifiche fatte dopo l'ultimo allineamento", async () => {
    const { sincronizza } = await import("../src/lib/cloud/sync");
    const { replaceDatabase } = await import("../src/lib/sqlite/engine");
    vi.mocked(replaceDatabase).mockClear();

    await sincronizza("utente-1"); // primo allineamento
    stato.firmati = [];

    // Una scrittura locale incrementa la versione del database.
    stato.versione += 1;
    const esito = await sincronizza("utente-1");

    expect(esito.scaricato).toBe(false);
    expect(esito.messaggio).toBe("Dati salvati nel cloud");
    expect(stato.firmati.map((f) => f.path)).toContain("utente-1/reportini.sqlite");
    expect(vi.mocked(replaceDatabase)).not.toHaveBeenCalled();
  });

  it("non fa nulla quando è già allineato", async () => {
    const { sincronizza } = await import("../src/lib/cloud/sync");
    await sincronizza("utente-1");
    stato.firmati = [];
    const esito = await sincronizza("utente-1");
    expect(esito.messaggio).toBe("Già allineato");
    expect(stato.firmati).toHaveLength(0);
  });

  it("forza l'upload quando richiesto esplicitamente", async () => {
    const { sincronizza } = await import("../src/lib/cloud/sync");
    await sincronizza("utente-1");
    stato.firmati = [];
    const esito = await sincronizza("utente-1", "solo_upload");
    expect(esito.scaricato).toBe(false);
    expect(stato.firmati.length).toBe(2);
  });

  it("salva automaticamente dopo ogni modifica locale", async () => {
    const { avviaAutoSync } = await import("../src/lib/cloud/sync");
    let notificato: string | null = null;
    const { invia, annulla } = avviaAutoSync("utente-1", (info) => {
      notificato = info.messaggio;
    });
    await act(async () => {
      await invia(true);
    });
    expect(notificato).toBe("Dati salvati nel cloud");
    expect(stato.firmati.length).toBe(2);
    annulla();
  });

  it("non sincronizza nulla senza un account collegato", async () => {
    const { avviaAutoSync } = await import("../src/lib/cloud/sync");
    const { invia } = avviaAutoSync(null, () => {});
    await act(async () => {
      await invia(true);
    });
    expect(stato.firmati.length).toBe(0);
  });

  it("il client cloud risulta configurato", async () => {
    const { cloudEnabled } = await import("../src/lib/cloud/supabase");
    expect(cloudEnabled).toBe(true);
  });
});

describe("Chiave API", () => {
  it("rifiuta di avviare il client con una chiave segreta sb_secret_", async () => {
    // L'import.meta.env viene sostituito in fase di trasformazione: per questo
    // caso serve un modulo dedicato che legga da una sorgente diverse.
    const { problemaDiChiave } = await import("../src/lib/cloud/chiave");
    expect(problemaDiChiave("sb_secret_abc123")).toMatch(/segreta/i);
    expect(problemaDiChiave("sb_publishable_abc123")).toBeNull();
    expect(problemaDiChiave("")).toBeNull();
  });
});

describe("URL di ritorno", () => {
  it("è l'URL che va incollato in Supabase, senza slash finali", async () => {
    const { urlDiRitorno } = await import("../src/lib/cloud/destinazione");
    // Lo slash finale è la causa tipica del rimbalzo sul Site URL: Supabase
    // confronta le stringhe e "https://a.app/" != "https://a.app".
    expect(urlDiRitorno("https://a.app", "/")).toBe("https://a.app");
    expect(urlDiRitorno("https://a.app/", "/")).toBe("https://a.app");
    expect(urlDiRitorno("https://a.app/", "/Reportini/")).toBe("https://a.app/Reportini");
    expect(urlDiRitorno("https://a.app", "/Reportini")).toBe("https://a.app/Reportini");
    expect(urlDiRitorno("http://localhost:5173", "/")).toBe("http://localhost:5173");
  });
});

describe("Verifica del bucket", () => {
  it("distingue il bucket mancante da quello protetto dalle RLS", async () => {
    const { bucketMancaDaErrore } = await import("../src/lib/cloud/diagnostica");
    // Errore esplicito di Supabase: il bucket non esiste.
    expect(bucketMancaDaErrore({ message: "Bucket not found" })).toBe(true);
    expect(bucketMancaDaErrore({ message: "NoSuchBucket" })).toBe(true);
    // Divieto RLS: il bucket esiste ed è correttamente protetto.
    expect(
      bucketMancaDaErrore({ message: "new row violates row-level security policy" }),
    ).toBe(false);
    // Lista vuota senza errore: non distingue nulla, quindi non è un assente.
    expect(bucketMancaDaErrore(null)).toBe(false);
  });

  it("con un account la verifica scrive davvero e poi ripulisce", async () => {
    const { verificaIntegrazione } = await import("../src/lib/cloud/diagnostica");
    await entraCome("sviluppo@example.it");
    // Il client finto risponde anche all'endpoint delle impostazioni auth.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ json: async () => ({ external: { google: true } }) })),
    );

    const esito = await verificaIntegrazione();
    const bucket = esito.controlli.find((c) => c.nome.includes("Bucket"));
    expect(bucket?.ok).toBe(true);
    expect(bucket?.dettaglio).toMatch(/scrittura e cancellazione riuscite/i);
    // Il file di sonda non deve restare nel bucket.
    expect([...stato.storage.keys()]).toEqual([]);
    // Il solo controllo non concluso è Calendar, che la pagina non può
    // verificare: il bucket, con l'account, è stato provato davvero.
    expect(esito.controlli.find((c) => c.nome.includes("Bucket"))?.nonVerificato).toBeUndefined();
    expect(esito.nonVerificati).toBe(1);
  });

  it("senza account dichiara il bucket non verificabile invece di darlo per buono", async () => {
    const { verificaIntegrazione } = await import("../src/lib/cloud/diagnostica");
    const esito = await verificaIntegrazione();
    const bucket = esito.controlli.find((c) => c.nome.includes("Bucket"));
    expect(bucket?.nonVerificato).toBe(true);
    expect(esito.nonVerificati).toBe(2);
    expect(esito.tuttiOk).toBe(false);
  });

  it("riporta Google Calendar come configurato ma non verificabile dalla pagina", async () => {
    const { verificaIntegrazione } = await import("../src/lib/cloud/diagnostica");
    const esito = await verificaIntegrazione();
    const calendar = esito.controlli.find((c) => c.nome === "Google Calendar");
    expect(calendar?.ok).toBe(true);
    expect(calendar?.dettaglio).toMatch(/Client OAuth configurato/);
    // Non si può sapere dalla pagina se la Calendar API è abilitata nel
    // progetto Google Cloud: dichiararlo pronto sarebbe buggy.
    expect(calendar?.nonVerificato).toBe(true);
  });
});

describe("Dashboard sviluppatore", () => {
  it("compare per un account in whitelist", async () => {
    await entraCome(CHIAVE);
    await monta("/panel/sviluppo");
    expect(contenitore.textContent).toContain("Dashboard sviluppatore");
  });

  it("non compare per un account fuori whitelist e reindirizza al pannello", async () => {
    await entraCome("esterno@esempio.it");
    await monta("/panel/sviluppo");
    expect(contenitore.textContent).not.toContain("Dashboard sviluppatore");
    expect(window.location.pathname).toBe("/panel");
  });

  it("non mostra la voce di menu agli account non autorizzati", async () => {
    await entraCome("esterno@esempio.it");
    await monta("/panel");
    expect(contenitore.textContent).not.toContain("Sviluppo");
  });

  it("mostra la voce di menu agli account autorizzati", async () => {
    await entraCome(CHIAVE);
    await monta("/panel");
    expect(contenitore.textContent).toContain("Sviluppo");
  });
});

describe("Riferimenti rimossi", () => {
  it("la landing non parla più di database né di dati dimostrativi", async () => {
    await monta("/");
    const testo = contenitore.textContent ?? "";
    expect(testo.toLowerCase()).not.toContain("sqlite");
    expect(testo.toLowerCase()).not.toContain("database");
    expect(testo.toLowerCase()).not.toContain("dati di esempio");
  });

  it("le impostazioni non mostrano la sezione del database", async () => {
    await monta("/panel/impostazioni");
    const testo = (contenitore.textContent ?? "").toLowerCase();
    expect(testo).not.toContain("sqlite");
    expect(testo).toContain("account e salvataggio online");
  });
});
