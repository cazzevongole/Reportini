/**
 * Verifica i flussi di account e salvataggio online con un client Supabase finto:
 * non servono credenziali reali per controllare che il login e la sincronizzazione
 * si comportino come previsto.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "fake-indexeddb/auto";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

/* ------------------------------ Supabase finto ----------------------------- */

type Ascoltatore = (evento: string, sessione: unknown) => void;

const stato = {
  sessione: null as { user: { id: string; email: string } } | null,
  storage: new Map<string, Blob>(),
  listener: null as Ascoltatore | null,
  firmati: [] as Array<{ path: string; bytes: Uint8Array }>,
  versione: 0,
  /** Scritture locali non ancora salite nel cloud: sopravvive al riavvio. */
  nonReplicato: false,
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
  // Le richieste allo sviluppatore stanno su una tabella, non nel bucket: qui
  // nessuno è sviluppatore e non c'è nessuna richiesta da leggere.
  from: vi.fn((tabella: string) => {
    if (tabella !== "richieste") return supabaseFinto.storage.from();
    const catena = {
      eq: () => catena,
      order: () => ({ limit: async () => ({ data: [], error: null }) }),
    };
    return { select: () => catena };
  }),
  rpc: vi.fn(async () => ({ data: false, error: null })),
};

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => supabaseFinto,
}));

/** fetch stub: la diagnosi interroga /auth/v1/settings. */
const risposteFetch = new Map<string, unknown>();
vi.stubGlobal("fetch", async (url: string) => {
  const chiave = [...risposteFetch.entries()].find(([prefisso]) =>
    String(url).startsWith(prefisso),
  );
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
  nonReplicato: () => stato.nonReplicato,
  segnaNonReplicato: vi.fn(() => {
    stato.nonReplicato = true;
  }),
  segnaReplicato: vi.fn(() => {
    stato.nonReplicato = false;
  }),
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
  stato.nonReplicato = false;
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

  it("con il client Google l'accesso non passa da Supabase", async () => {
    // Con il backend l'app porta sé stessa da Google, profilo e calendario
    // insieme: è l'unico modo per avere un solo consenso e un token
    // rinnovabile. Supabase non viene coinvolto nell'accesso. (L'URL di
    // reindirizzamento è provato in tests/google.test.tsx, dove si può
    // intercettare la navigazione senza toccare il location di jsdom.)
    const accedi = await montaAccount();
    await act(async () => {
      void accedi();
    });

    expect(supabaseFinto.auth.signInWithOAuth).not.toHaveBeenCalled();
  });

  it("espone l'email dell'utente dopo l'accesso, nelle impostazioni", async () => {
    await entraCome("utente@esempio.it");
    await monta("/panel/impostazioni");
    expect(contenitore.textContent).toContain("utente@esempio.it");
    // Nelle altre pagine l'account non ripete le stesse righe a ogni passaggio.
    await act(async () => radice.unmount());
    await monta("/panel");
    expect(contenitore.textContent).not.toContain("utente@esempio.it");
  });

  it("offre l'accesso quando non c'è sessione", async () => {
    await monta("/panel");
    expect(contenitore.textContent).toContain("Accedi con Google");
  });

  it("dice sul posto perché l'ultimo rientro è fallito", async () => {
    // Finora l'errore del rientro stava solo nelle impostazioni, cioè dove
    // non si arriva senza essere già entrati. Il sintomo che ne nasceva è
    // "l'app non si aggiorna" senza nessuna spiegazione: qui la ragione deve
    // trovarsi sulla stessa schermata da cui si guarda.
    // Chiave e formato li scrive auth.ts al rientro fallito; qui si mette a
    // mano quello che l'utente si troverebbe davanti.
    localStorage.setItem(
      "reportini.google.errore",
      "redirect_uri_mismatch: l'indirizzo di rientro non è registrato in Google.",
    );

    await monta("/panel");

    expect(contenitore.textContent).toContain("redirect_uri_mismatch");
    // E si può togliere: un errore che resta lì mentre l'utente riprova
    // sembra un errore nuovo.
    const nascondi = [...contenitore.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Nascondi"),
    );
    expect(nascondi).toBeTruthy();
    await act(async () => nascondi!.click());
    expect(contenitore.textContent).not.toContain("redirect_uri_mismatch");
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
    //    sovrascrivere i dati già presenti. Il database è quello di quando la
    //    sessione è iniziata, quindi l'azzeramento viene *prima*: è una
    //    versione che non è mai cambiata, non un dispositivo che ha lavorato.
    stato.versione = 0;
    resetSincronizzazione();
    stato.firmati = [];
    const esito = await sincronizza("utente-1");
    expect(esito.scaricato).toBe(true);
    expect(esito.messaggio).toBe("Dati ripristinati dal cloud");
    expect(vi.mocked(replaceDatabase)).toHaveBeenCalledOnce();
    expect(stato.firmati).toHaveLength(0);
  });

  it("non lascia che la copia online cancelli un appuntamento appena creato", async () => {
    const { sincronizza, resetSincronizzazione } = await import("../src/lib/cloud/sync");
    const { replaceDatabase } = await import("../src/lib/sqlite/engine");

    // Il cloud ha già dei dati, quindi al primo contatto verrebbe scaricato.
    await sincronizza("utente-1");
    vi.mocked(replaceDatabase).mockClear();
    stato.firmati = [];

    // Nuova sessione, e l'utente salva un appuntamento prima che la
    // sincronizzazione sia finita: è la finestra in cui il download è in
    // corso e la sostituzione del database può arrivare dopo la scrittura.
    stato.versione = 0;
    resetSincronizzazione();
    stato.versione = 1; // l'appuntamento è stato creato

    const esito = await sincronizza("utente-1");

    // Il lavoro locale vince: sostituire il database qui farebbe sparire
    // l'appuntamento, e la pubblicazione si fermerebbe con «L'appuntamento non
    // esiste più».
    expect(vi.mocked(replaceDatabase)).not.toHaveBeenCalled();
    expect(esito.scaricato).toBe(false);
    expect(stato.firmati.map((f) => f.path)).toContain("utente-1/reportini.sqlite");
  });

  it("ricontrolla dopo il download, non solo prima", async () => {
    const { sincronizza, resetSincronizzazione } = await import("../src/lib/cloud/sync");
    const { replaceDatabase } = await import("../src/lib/sqlite/engine");

    await sincronizza("utente-1");
    vi.mocked(replaceDatabase).mockClear();
    stato.firmati = [];

    stato.versione = 0;
    resetSincronizzazione();

    // Il download parte quando il database è ancora intatto, e l'utente
    // scrive mentre la rete è occupata. Il controllo fatto prima di scaricare
    // non lo vede: solo quello fatto dopo lo vede.
    const inCorso = sincronizza("utente-1");
    stato.versione = 1;
    const esito = await inCorso;

    expect(vi.mocked(replaceDatabase)).not.toHaveBeenCalled();
    expect(esito.scaricato).toBe(false);
    expect(stato.firmati.map((f) => f.path)).toContain("utente-1/reportini.sqlite");
  });

  it("un appuntamento eliminato non torna indietro al riavvio", async () => {
    const { sincronizza, resetSincronizzazione } = await import("../src/lib/cloud/sync");
    const { replaceDatabase, segnaNonReplicato } = await import("../src/lib/sqlite/engine");

    // La copia online ha ancora l'appuntamento: è la situazione reale, cioè
    // l'utente ha eliminato qualcosa e l'app si è chiusa prima che la
    // sincronizzazione partisse.
    await sincronizza("utente-1");
    vi.mocked(replaceDatabase).mockClear();
    stato.firmati = [];

    // L'utente elimina un appuntamento: la scrittura è locale e non è ancora
    // salita.
    segnaNonReplicato();
    stato.versione += 1;
    expect(stato.nonReplicato).toBe(true);

    // Riavvio dell'app: il contatore di versione riparte da zero, come fa a ogni
    // avvio, e la sessione non sa niente.
    stato.versione = 0;
    resetSincronizzazione();

    const esito = await sincronizza("utente-1");

    // Il cloud è più vecchio e non deve prendersi la precedenza: qui si
    // sostituirebbe il database e l'appuntamento eliminato **tornerebbe** in
    // lista, come se non fosse mai stato cancellato.
    expect(vi.mocked(replaceDatabase)).not.toHaveBeenCalled();
    expect(esito.scaricato).toBe(false);
    expect(stato.firmati.map((f) => f.path)).toContain("utente-1/reportini.sqlite");
    // E una volta salito, il cloud ha davvero tutto: il flag si spegne.
    expect(stato.nonReplicato).toBe(false);
  });

  it("scaricando dal cloud il flag si spegne: la copia è la stessa", async () => {
    const { sincronizza, resetSincronizzazione } = await import("../src/lib/cloud/sync");
    const { segnaNonReplicato } = await import("../src/lib/sqlite/engine");

    await sincronizza("utente-1");
    stato.versione = 0;
    resetSincronizzazione();

    // Dispositivo nuovo, che non ha scritto niente: qui il cloud deve vincere,
    // altrimenti l'utente che torna su un altro dispositivo resterebbe con una
    // copia vuota per sempre.
    const esito = await sincronizza("utente-1");
    expect(esito.scaricato).toBe(true);
    expect(stato.nonReplicato).toBe(false);

    // E da quel momento la copia locale è quella del cloud: una scrittura
    // cambia di nuovo la situazione.
    segnaNonReplicato();
    stato.versione += 1;
    const dopo = await sincronizza("utente-1");
    expect(dopo.scaricato).toBe(false);
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
    const { avviaAutoSync, iscrivitiAllaSalvataggio } = await import("../src/lib/cloud/sync");
    let notificato: string | null = null;
    const smetti = iscrivitiAllaSalvataggio((info) => {
      notificato = info.messaggio;
    });
    const { invia, annulla } = avviaAutoSync("utente-1");
    await act(async () => {
      await invia(true);
    });
    expect(notificato).toBe("Dati salvati nel cloud");
    expect(stato.firmati.length).toBe(2);
    annulla();
    smetti();
  });

  it("non sincronizza nulla senza un account collegato", async () => {
    const { avviaAutoSync } = await import("../src/lib/cloud/sync");
    const { invia } = avviaAutoSync(null);
    await act(async () => {
      await invia(true);
    });
    expect(stato.firmati.length).toBe(0);
  });

  it("un errore di caricamento arriva a chi ascolta, non muore in silenzio", async () => {
    const { avviaAutoSync, iscrivitiAllaSalvataggio, statoSalvataggio } =
      await import("../src/lib/cloud/sync");
    const finto = await import("../src/lib/sqlite/engine");
    vi.mocked(finto.snapshot).mockImplementationOnce(() => {
      throw new Error("disco pieno");
    });
    let ultimo: { stato: string; messaggio: string } | null = null;
    const smetti = iscrivitiAllaSalvataggio((info) => {
      ultimo = { stato: info.stato, messaggio: info.messaggio };
    });
    const { invia, annulla } = avviaAutoSync("utente-1");
    await act(async () => {
      await invia(true);
    });
    // Il pulsante "Salva subito online" mostra questo messaggio: senza di esso
    // l'errore spariva e sembrava che il salvataggio non facesse niente.
    expect(ultimo).toEqual({ stato: "errore", messaggio: "disco pieno" });
    expect(statoSalvataggio().stato).toBe("errore");
    annulla();
    smetti();
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

describe("L'indirizzo di rientro deve essere una pagina web", () => {
  it("su web e su GitHub Pages va bene", async () => {
    const { motivoRientroNonValido } = await import("../src/lib/cloud/destinazione");
    expect(motivoRientroNonValido("https://cazzevongole.github.io/Reportini")).toBe("");
    expect(motivoRientroNonValido("http://localhost:5173")).toBe("");
    // Il pacchetto desktop: si serve da 127.0.0.1 e ha quindi un'origine
    // vera, proprio per poter essere riportato qui da Google.
    expect(motivoRientroNonValido("http://127.0.0.1:42720")).toBe("");
  });

  it("senza origine dice cosa è andato storto", async () => {
    const { motivoRientroNonValido } = await import("../src/lib/cloud/destinazione");
    // Da `file://` window.location.origin restituisce la stringa "null" e
    // l'indirizzo di rientro che finisce a Google è la parola "null". Sul
    // pacchetto non dovrebbe più capitare, ma se la frase compare vuol dire
    // che il server locale non è partito, e quello sì va detto.
    const motivo = motivoRientroNonValido("null");
    expect(motivo).toContain("non è una pagina web");
    expect(motivo).toContain("127.0.0.1");
    expect(motivoRientroNonValido("file:///C:/Program%20Files/Reportini/index.html")).toContain(
      "non è una pagina web",
    );
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
    expect(bucketMancaDaErrore({ message: "new row violates row-level security policy" })).toBe(
      false,
    );
    // Lista vuota senza errore: non distingue nulla, quindi non è un assente.
    expect(bucketMancaDaErrore(null)).toBe(false);
  });

  it("con un account la verifica scrive davvero e poi ripulisce", async () => {
    const { verificaIntegrazione } = await import("../src/lib/cloud/diagnostica");
    await entraCome("esempio@esempio.it");
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
    // Il bucket, con l'account, è stato provato davvero: nessun controllo
    // resta scoperto.
    expect(esito.controlli.find((c) => c.nome.includes("Bucket"))?.nonVerificato).toBeUndefined();
    expect(esito.nonVerificati).toBe(0);
  });

  it("senza account dichiara il bucket non verificabile invece di darlo per buono", async () => {
    const { verificaIntegrazione } = await import("../src/lib/cloud/diagnostica");
    const esito = await verificaIntegrazione();
    const bucket = esito.controlli.find((c) => c.nome.includes("Bucket"));
    expect(bucket?.nonVerificato).toBe(true);
    expect(esito.nonVerificati).toBe(1);
    expect(esito.tuttiOk).toBe(false);
  });

  it("riporta Google Calendar come pronto solo se il client c'è e la funzione risponde", async () => {
    const { verificaIntegrazione } = await import("../src/lib/cloud/diagnostica");
    const esito = await verificaIntegrazione();
    const calendar = esito.controlli.find((c) => c.nome === "Google Calendar");
    // Il finto risponde a tutto: la funzione risulta pubblicata e il client
    // c'è (VITE_GOOGLE_CLIENT_ID è nei test).
    expect(calendar?.ok).toBe(true);
    // Qui il controllo è concluso: 404 o no, la pagina lo distingue.
    expect(calendar?.nonVerificato).toBe(false);
  });

  it("distingue la funzione non pubblicata dal backend che risponde", async () => {
    const { verificaIntegrazione } = await import("../src/lib/cloud/diagnostica");
    // 404 è la risposta di Supabase per un indirizzo che non è nessuna funzione.
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: unknown) =>
        String(url).includes("/functions/v1/")
          ? { status: 404, ok: false, json: async () => ({ code: "WORKER_NOT_FOUND" }) }
          : { status: 200, ok: true, json: async () => ({ external: { google: true } }) },
      ),
    );
    const esito = await verificaIntegrazione();
    const calendar = esito.controlli.find((c) => c.nome === "Google Calendar");
    expect(calendar?.ok).toBe(false);
    expect(calendar?.azione).toMatch(/supabase functions deploy/);
  });
});

describe("Sezione sviluppo", () => {
  it("resta nascosta: chi non è lo sviluppatore viene riportato al pannello", async () => {
    await entraCome("sviluppo@example.it");
    await monta("/panel/sviluppo");
    expect(contenitore.textContent).not.toContain("Richieste degli utenti");
    expect(window.location.pathname).toBe("/panel");
  });

  it("le impostazioni non hanno più il badge Sviluppo", async () => {
    await entraCome("sviluppo@example.it");
    await monta("/panel/impostazioni");
    expect(contenitore.textContent).not.toContain("Sviluppo");
  });
});

describe("Riferimenti rimossi", () => {
  it("la pagina di accesso non parla di database né di dati dimostrativi", async () => {
    await monta("/accedi");
    const testo = (contenitore.textContent ?? "").toLowerCase();
    expect(testo).not.toContain("sqlite");
    expect(testo).not.toContain("database");
    expect(testo).not.toContain("dati di esempio");
  });

  it("le impostazioni non hanno sezioni di sviluppo", async () => {
    await entraCome("utente@esempio.it");
    await monta("/panel/impostazioni");
    const testo = (contenitore.textContent ?? "").toLowerCase();
    expect(testo).not.toContain("sqlite");
    // Controlli tecnici: servivano a chi sviluppa l'app, non a chi la usa.
    expect(testo).not.toContain("verifica integrazione");
    expect(testo).not.toContain("url di ritorno");
    expect(testo).not.toContain("bucket");
    expect(testo).not.toContain("redirect urls");
    expect(testo).toContain("il tuo account");
  });

  it("l'account e l'uscita stanno nelle impostazioni", async () => {
    await entraCome("utente@esempio.it");
    await monta("/panel/impostazioni");
    const testo = contenitore.textContent ?? "";
    // Profilo: l'email con cui si è entrati.
    expect(testo).toContain("utente@esempio.it");
    // Uscita: il pulsante che chiude la sessione.
    expect(testo).toContain("Esci");
    // E lo stato del collegamento con Google Calendar, senza duplicarlo.
    expect(testo).toContain("Google Calendar");
    expect(testo).toContain("Salvataggio online");
  });
});

describe("Salvataggio online nelle impostazioni", () => {
  it("salva con l'id dell'utente, non con l'email", async () => {
    await entraCome("utente@esempio.it");
    await monta("/panel/impostazioni");
    // Il mount avvia già il salvataggio automatico: azzeriamo per isolare
    // quello che fa il pulsante.
    stato.firmati = [];

    const bottone = [...contenitore.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Salva subito online"),
    );
    expect(bottone).toBeDefined();
    await act(async () => {
      bottone!.click();
      await new Promise((r) => setTimeout(r, 0));
    });

    const percorsi = stato.firmati.map((f) => f.path);
    // Nel bucket il percorso è <user-id>/…: con l'email le RLS respongono la
    // scrittura e il pulsante sembra non salvare nulla.
    expect(percorsi).toContain("utente-1/reportini.sqlite");
    expect(percorsi).toContain("utente-1/reportini-meta.json");
    expect(percorsi.some((p) => p.startsWith("utente@esempio.it"))).toBe(false);
    expect(contenitore.textContent).toContain("Dati salvati nel cloud");
  });

  it("mostra l'esito del salvataggio, anche quando fallisce", async () => {
    await entraCome("utente@esempio.it");
    await monta("/panel/impostazioni");
    const { snapshot } = await import("../src/lib/sqlite/engine");
    vi.mocked(snapshot).mockImplementationOnce(() => {
      throw new Error("disco pieno");
    });
    const bottone = [...contenitore.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Salva subito online"),
    );
    await act(async () => {
      bottone!.click();
      await new Promise((r) => setTimeout(r, 0));
    });
    // Senza questo messaggio l'errore spariva e il pulsante restava muto.
    expect(contenitore.textContent).toContain("disco pieno");
  });
});

describe("Accesso obbligatorio", () => {
  it("la pagina di accesso si vede anche senza sessione", async () => {
    await monta("/accedi");
    expect(window.location.pathname).toBe("/accedi");
    expect(contenitore.textContent).toContain("Accedi con Google");
  });

  it("senza sessione rimanda alla pagina di accesso", async () => {
    await monta("/panel/anagrafici");
    expect(window.location.pathname).toBe("/accedi");
    // Nessuna schermata dell'app deve comparire nel frattempo.
    expect(contenitore.textContent).not.toContain("Schede anagrafiche");
  });

  it("su GitHub Pages i link restano dentro /Reportini", async () => {
    // Senza basename ogni link punterebbe a /panel e lascerebbe la
    // sottocartella: dopo l'accesso si finiva fuori dall'app e al
    // ricaricare si prendeva un 404.
    vi.stubEnv("BASE_URL", "/Reportini/");
    try {
      await entraCome("utente@esempio.it");
      await monta("/Reportini/panel");
      expect(contenitore.textContent).toContain("La tua scrivania");

      const link = [...contenitore.querySelectorAll("a")].find((a) =>
        a.getAttribute("href")?.includes("anagrafici"),
      );
      expect(link?.getAttribute("href")).toBe("/Reportini/panel/anagrafici");
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("con la sessione le pagine si aprono normalmente", async () => {
    await entraCome("utente@esempio.it");
    await monta("/panel");
    expect(window.location.pathname).toBe("/panel");
    expect(contenitore.textContent).toContain("La tua scrivania");
  });
});

describe("Barra di navigazione", () => {
  it("ha cinque icone e l'etichetta solo sulla voce attiva", async () => {
    await entraCome("utente@esempio.it");
    await monta("/panel");

    const barra = contenitore.querySelector('nav[aria-label="Navigazione principale"]');
    expect(barra).not.toBeNull();
    const voci = [...(barra!.querySelectorAll("a") as NodeListOf<HTMLAnchorElement>)];
    // Cinque voci: Home, Anagrafici, Relazioni, Appuntamenti, Impostazioni.
    expect(voci).toHaveLength(5);
    // Le relazioni devono restare raggiungibili dalla barra: sono il
    // documento che si consegna, non una schermata interna.
    expect(voci.map((voce) => voce.textContent)).toContain("Relazioni");

    const attive = voci.filter((voce) => voce.getAttribute("aria-current") === "page");
    expect(attive).toHaveLength(1);

    for (const voce of voci) {
      const etichetta = voce.querySelector("span:last-child") as HTMLElement;
      const nascosta = etichetta.querySelector(".invisible") !== null;
      // L'etichetta si vede solo sulla voce attiva, ma il testo resta nel
      // posto: è quello che dà il movimento alla barra.
      expect(nascosta).toBe(voce !== attive[0]);
      expect(etichetta.textContent?.trim()).toBeTruthy();
    }
  });

  it("l'etichetta segue la pagina aperta", async () => {
    await entraCome("utente@esempio.it");
    await monta("/panel/appuntamenti");

    const barra = contenitore.querySelector('nav[aria-label="Navigazione principale"]')!;
    const attiva = barra.querySelector('a[aria-current="page"]')!;
    expect(attiva.textContent).toContain("Appuntamenti");
    const etichetta = attiva.querySelector("span:last-child") as HTMLElement;
    expect(etichetta.querySelector(".invisible")).toBeNull();
  });
});

describe("Base dei percorsi", () => {
  it("sul web il router usa la base di Vite", async () => {
    const { baseRoutte } = await import("../src/lib/cloud/destinazione");
    expect(baseRoutte()).toBe("/");
  });

  it("nell'app desktop, che si apre da file://, il router prende la radice", async () => {
    // L'app desktop si costruisce con base "./" (gli asset devono essere
    // relativi: da file:// un /assets/app.js punta alla radice del
    // filesystem). Per il router "./" però non è un percorso utilizzabile.
    vi.stubEnv("BASE_URL", "./");
    try {
      const { baseRoutte } = await import("../src/lib/cloud/destinazione");
      expect(baseRoutte()).toBe("/");
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
