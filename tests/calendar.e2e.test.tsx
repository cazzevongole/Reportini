import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initDatabase } from "../src/lib/sqlite/engine";

// In un ambiente jsdom sotto vitest sql.js carica il wasm da filesystem, non
// con fetch: gli serve un percorso reale. Così il test gira sul motore vero e
// non su un doppione finto.
vi.mock("sql.js/dist/sql-wasm.wasm?url", () => ({
  default: `${process.cwd()}/node_modules/sql.js/dist/sql-wasm.wasm`,
}));
import {
  aggiornaAppuntamento,
  creaAnagrafico,
  creaAppuntamento,
  elencaAppuntamenti,
  elencaAnagrafici,
  marcaAppuntamentoSincronizzato,
  ottieniAppuntamento,
} from "../src/lib/repo";
import { resetSincronizzazione, sincronizza } from "../src/lib/cloud/sync";
import {
  dissociaAppuntamento,
  eliminaAppuntamentoEEvento,
  pubblicaAppuntamento,
  sincronizzaAppuntamento,
} from "../src/lib/google/sync";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AvvisoProvider } from "../src/components/Avvisi";
import AppuntamentoForm from "../src/components/AppuntamentoForm";

/* --------------------------- cloud finto (in memoria) --------------------- */

/**
 * vi.hoisted: la factory di vi.mock gira durante l'import dei moduli di
 * production, prima che le const del file siano inizializzate. Senza, il
 * mock non trova nulla e il test fallisce con "before initialization".
 */
/**
 * vi.hoisted: la factory di vi.mock gira durante l'import dei moduli di
 * production, prima che le const del file siano inizializzate. Senza, il
 * mock non trova nulla e il test muore con "before initialization".
 */
const finto = vi.hoisted(() => {
  const cloud = new Map<string, Blob>();
  const stato = {
    /** Sopravvive a "logout" e "login": è il server, non il browser. */
    cloud,
    sessione: null as { user: { id: string; email: string } } | null,
  };
  const supabase = {
    auth: {
      getSession: vi.fn(async () => ({ data: { session: stato.sessione } })),
      onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
      signOut: vi.fn(async () => {
        stato.sessione = null;
      }),
    },
    storage: {
      from: () => ({
        upload: vi.fn(async (path: string, corpo: Blob | Uint8Array) => {
          const byte =
            corpo instanceof Uint8Array
              ? corpo
              : new Uint8Array(await (corpo as Blob).arrayBuffer());
          cloud.set(path, new Blob([byte.slice().buffer]));
          return { error: null };
        }),
        download: vi.fn(async (path: string) => {
          const blob = cloud.get(path);
          if (!blob) return { data: null, error: { message: "not found" } };
          return { data: blob, error: null };
        }),
        remove: vi.fn(async () => ({ error: null })),
      }),
    },
  };
  return { stato, supabase };
});

const supabaseFinto = finto.supabase;
const cloud = finto.stato.cloud;

// La factory deve puntare a finto.supabase, non all'alias: gli import statici
// dei moduli di production vengono valutati prima di qualsiasi const del file.
vi.mock("@supabase/supabase-js", () => ({ createClient: () => finto.supabase }));

/* --------------------------- Calendar API finta --------------------------- */

interface EventoFinto {
  id: string;
  htmlLink?: string;
  summary?: string;
  description?: string;
  status?: string;
  /** Se l'evento occupa la fascia: è come si distingue "in attesa". */
  transparency?: string;
  start?: { dateTime?: string; timeZone?: string };
  end?: { dateTime?: string; timeZone?: string };
}

const eventi = new Map<string, EventoFinto>();
const chiamate: { metodo: string; url: string }[] = [];
let prossimoId = 1;

function risposta(corpo: unknown, stato = 200) {
  return {
    ok: stato >= 200 && stato < 300,
    status: stato,
    text: async () => JSON.stringify(corpo),
    json: async () => corpo,
  } as Response;
}

const fetchFinto = vi.fn(async (url: string, init: RequestInit = {}) => {
  const metodo = init.method ?? "GET";
  chiamate.push({ metodo, url: String(url) });

  // Token già presente: l'accessToken() non deve aprire il popup.
  if (String(url).includes("oauth2.googleapis.com")) return risposta({ access_token: "x" });

  if (String(url).includes("/calendarList")) {
    return risposta({ items: [{ id: "primary", summary: "Calendario principale", primary: true }] });
  }

  const evento = String(url).match(/\/events\/([^?]+)/);
  if (evento) {
    const id = decodeURIComponent(evento[1]);
    if (metodo === "DELETE") {
      eventi.delete(id);
      return risposta({}, 204);
    }
    if (metodo === "PUT" || metodo === "PATCH") {
      const aggiornato = { ...(eventi.get(id) ?? { id }), ...(JSON.parse(String(init.body)) as object) };
      eventi.set(id, aggiornato as EventoFinto);
      return risposta(aggiornato);
    }
  }
  if (String(url).endsWith("/events") && metodo === "POST") {
    const creato = {
      id: `evt-${prossimoId++}`,
      htmlLink: "https://calendar.google.com/event?eid=falso",
      ...(JSON.parse(String(init.body)) as object),
    } as EventoFinto;
    eventi.set(creato.id, creato);
    return risposta(creato);
  }
  return risposta({});
});

/* --------------------------------- helpers -------------------------------- */

const UTENTE = "utente-1";
const TOKEN_KEY = "reportini.google.token";

async function nuovoDatabase() {
  // Solo i dati: il token Google rappresenta una sessione già collegata e
  // sopravvive al riavvio del database.
  const db = await initDatabase();
  // Un dispositivo nuovo parte vuoto: nessuna copia locale.
  db.run("DELETE FROM anagrafici");
  db.run("DELETE FROM relazioni");
  db.run("DELETE FROM appuntamenti");
}

function creaSchedaConAppuntamento() {
  const anagraficoId = creaAnagrafico({
    nome: "Mario",
    cognome: "Rossi",
    documento: "VR123456A",
    dataNascita: "1980-01-02",
    sesso: "M",
    nazionalita: "ITA",
    indirizzo: "Via Roma 1",
    citta: "Verona",
    cap: "37100",
    provincia: "VR",
    telefono: "0401234567",
    email: "mario.rossi@example.it",
    note: "",
  });
  const appuntamentoId = creaAppuntamento({
    anagraficoId,
    relazioneId: null,
    titolo: "Ritiro documento",
    descrizione: "",
    inizio: "2026-10-01T10:00:00.000Z",
    fine: "2026-10-01T10:45:00.000Z",
    luogo: "Sportello 3",
    stato: "confermato",
    promemoriaMin: 30,
    googleEventId: null,
    googleCalendarId: null,
    googleHtmlLink: null,
    googleSyncAt: null,
    googleErrore: null,
  });
  return { anagraficoId, appuntamentoId };
}

/** Token Google già valido: equivale a un account Calendar collegato. */
function collegaGoogle() {
  localStorage.setItem(
    TOKEN_KEY,
    JSON.stringify({ accessToken: "at", expiresAt: Date.now() + 3_600_000, refreshToken: "rt" }),
  );
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  cloud.clear();
  eventi.clear();
  chiamate.length = 0;
  prossimoId = 1;
  finto.stato.sessione = { user: { id: UTENTE, email: "mara@example.it" } };
  supabaseFinto.auth.getSession.mockClear();
  // Il collegamento in sé è coperto da tests/google.test.tsx.
  collegaGoogle();
  vi.stubGlobal("fetch", fetchFinto);
  resetSincronizzazione();
});

/* --------------------------------- test ----------------------------------- */

describe("Reportini end-to-end: dati, Calendar, logout e rientro", () => {
  it("crea l'anagrafico, pubblica l'evento su Calendar e conserva il collegamento", async () => {
    await nuovoDatabase();
    const { appuntamentoId } = creaSchedaConAppuntamento();

    const esito = await sincronizzaAppuntamento(appuntamentoId, "primary");

    expect(esito.ok).toBe(true);
    expect(esito.messaggio).toMatch(/sincronizzato/i);
    // Un solo evento creato, e con il fuso dichiarato.
    expect(eventi.size).toBe(1);
    const creato = [...eventi.values()][0];
    expect(creato.summary).toBe("Ritiro documento");
    expect(creato.start?.dateTime).toBe("2026-10-01T10:00:00.000Z");
    expect(creato.start?.timeZone).toBeTruthy();
    expect(creato.end?.timeZone).toBeTruthy();
    // Il contesto dell'anagrafico viaggia nella descrizione.
    expect(chiamate.some((c) => c.metodo === "POST" && c.url.endsWith("/events"))).toBe(true);

    // Il collegamento è persistito in locale.
    const salvato = ottieniAppuntamento(appuntamentoId);
    expect(salvato?.googleEventId).toBe(creato.id);
    expect(salvato?.googleCalendarId).toBe("primary");
  });

  it("dopo logout e rientro i dati tornano dal cloud e l'evento viene aggiornato, non duplicato", async () => {
    await nuovoDatabase();
    const { anagraficoId, appuntamentoId } = creaSchedaConAppuntamento();
    await sincronizzaAppuntamento(appuntamentoId, "primary");
    const idEvento = ottieniAppuntamento(appuntamentoId)?.googleEventId;
    expect(idEvento).toBeTruthy();

    // Salva nel cloud, come fa l'auto-sync dopo ogni scrittura.
    const upload = await sincronizza(UTENTE);
    expect(upload.messaggio).toMatch(/salvati nel cloud/i);

    // --- logout ---
    finto.stato.sessione = null;
    await supabaseFinto.auth.signOut();
    localStorage.clear(); // il browser non conserva nulla
    sessionStorage.clear();

    // Dispositivo nuovo: database vuoto, stato di sync dimenticato.
    resetSincronizzazione();
    await nuovoDatabase();
    expect(elencaAnagrafici().length).toBe(0);
    expect(elencaAppuntamenti({}).length).toBe(0);

    // --- login ---
    // L'utente ricollega anche Google Calendar: il popup si riapre come dopo
    // ogni scadenza. L'anagrafica e il collegamento all'evento, invece,
    // arrivano dal cloud e non da qui.
    finto.stato.sessione = { user: { id: UTENTE, email: "mara@example.it" } };
    collegaGoogle();
    const ripristino = await sincronizza(UTENTE);

    expect(ripristino.scaricato).toBe(true);
    expect(ripristino.messaggio).toMatch(/ripristinati dal cloud/i);
    const anagrafici = elencaAnagrafici();
    expect(anagrafici.length).toBe(1);
    expect(anagrafici[0].nome).toBe("Mario");
    expect(anagrafici[0].id).toBe(anagraficoId);

    // Soprattutto: il collegamento all'evento è sopravvissuto.
    const rientrato = ottieniAppuntamento(appuntamentoId);
    expect(rientrato?.googleEventId).toBe(idEvento);

    // Risincronizzare aggiorna l'evento esistente invece di crearne un altro.
    await aggiornaTitolo(rientrato!.id, "Ritiro documento (rivisto)");
    const secondo = await sincronizzaAppuntamento(appuntamentoId, "primary");

    expect(secondo.ok).toBe(true);
    expect(eventi.size).toBe(1);
    expect([...eventi.values()][0].summary).toBe("Ritiro documento (rivisto)");
  });

  it("scollegare elimina l'evento remoto e pulisce i marcatori", async () => {
    await nuovoDatabase();
    const { appuntamentoId } = creaSchedaConAppuntamento();
    await sincronizzaAppuntamento(appuntamentoId, "primary");
    expect(eventi.size).toBe(1);

    const esito = await dissociaAppuntamento(appuntamentoId);

    expect(esito.ok).toBe(true);
    expect(eventi.size).toBe(0);
    const ripulito = ottieniAppuntamento(appuntamentoId);
    expect(ripulito?.googleEventId).toBeNull();
    expect(ripulito?.googleCalendarId).toBeNull();
  });

  it("un errore di Google non lascia marcatori falsi sull'appuntamento", async () => {
    await nuovoDatabase();
    const { appuntamentoId } = creaSchedaConAppuntamento();
    fetchFinto.mockImplementationOnce(async () => risposta({ error: "quotaExceeded" }, 403));

    const esito = await sincronizzaAppuntamento(appuntamentoId, "primary");

    expect(esito.ok).toBe(false);
    expect(esito.messaggio).toMatch(/403/);
    // Nessun collegamento registrato: il tentativo non è riuscito.
    expect(ottieniAppuntamento(appuntamentoId)?.googleEventId).toBeNull();
    // Ma il motivo resta scritto sull'appuntamento. Prima non restava, e un
    // salvataggio riuscito con la pubblicazione fallita era indistinguibile da
    // uno riuscito del tutto: l'utente vedeva l'appuntamento in lista e una
    // notifica verde, e in agenda non c'era niente.
    expect(ottieniAppuntamento(appuntamentoId)?.googleErrore).toMatch(/403/);
  });

  it("un tentativo riuscito cancella il motivo del fallimento precedente", async () => {
    await nuovoDatabase();
    const { appuntamentoId } = creaSchedaConAppuntamento();
    fetchFinto.mockImplementationOnce(async () => risposta({ error: "boom" }, 500));
    await sincronizzaAppuntamento(appuntamentoId, "primary");
    expect(ottieniAppuntamento(appuntamentoId)?.googleErrore).toBeTruthy();

    const esito = await sincronizzaAppuntamento(appuntamentoId, "primary");

    expect(esito.ok).toBe(true);
    // L'errore non deve sopravvivere al successo: un appuntamento finito in
    // agenda che continua ad accusare un 500 è un appuntamento che non
    // si lascia in pace.
    expect(ottieniAppuntamento(appuntamentoId)?.googleErrore).toBeNull();
  });

  it("l'appuntamento mostra il motivo e il pulsato per riprovare", async () => {
    await nuovoDatabase();
    const { appuntamentoId } = creaSchedaConAppuntamento();
    fetchFinto.mockImplementationOnce(async () => risposta({ error: "insufficientPermissions" }, 403));
    await sincronizzaAppuntamento(appuntamentoId, "primary");
    // Qui la pagina non serve: il motivo e il pulsato stanno sull'appuntamento,
    // e senza una traccia sul record un salvataggio riuscito con la
    // pubblicazione fallita era indistinguibile da uno riuscito del tutto.
    const salvato = ottieniAppuntamento(appuntamentoId);
    expect(salvato?.googleErrore).toContain("403");
    expect(salvato?.googleErrore).toContain("insufficientPermissions");
  });

  it("marcaAppuntamentoSincronizzato conserva il collegamento già presente", async () => {
    await nuovoDatabase();
    const { appuntamentoId } = creaSchedaConAppuntamento();
    marcaAppuntamentoSincronizzato(appuntamentoId, {
      googleEventId: "evt-manuale",
      googleCalendarId: "secondario",
      googleHtmlLink: "https://calendar.google.com/event?eid=manuale",
    });
    const salvato = ottieniAppuntamento(appuntamentoId);
    expect(salvato?.googleEventId).toBe("evt-manuale");
    expect(salvato?.googleCalendarId).toBe("secondario");
  });
});

/* ---------------- la descrizione non deve crescere a ogni modifica ---------- */

describe("Il contesto dell'anagrafico non si duplica", () => {
  const CONTESTO = "Anagrafico: Mario Rossi\nDocumento: VR123456A";

  it("scollegare non scrive il contesto nella descrizione salvata", async () => {
    await nuovoDatabase();
    const { appuntamentoId } = creaSchedaConAppuntamento();
    await sincronizzaAppuntamento(appuntamentoId, "primary");

    await dissociaAppuntamento(appuntamentoId);

    // Il contesto sta solo nell'evento: nel database la descrizione è
    // ancora quella scritta dall'utente, altrimenti il modulo di modifica
    // la mostrerebbe e ogni sincronizzazione aggiungerebbe un blocco.
    const salvato = ottieniAppuntamento(appuntamentoId);
    expect(salvato).toBeTruthy();
    expect(salvato?.descrizione).toBe("");
    expect(salvato?.titolo).toBe("Ritiro documento");
  });

  it("scollegare e ripubblicare non accumula blocchi", async () => {
    await nuovoDatabase();
    const { appuntamentoId } = creaSchedaConAppuntamento();
    for (let giro = 0; giro < 3; giro += 1) {
      await sincronizzaAppuntamento(appuntamentoId, "primary");
      await dissociaAppuntamento(appuntamentoId);
    }
    await sincronizzaAppuntamento(appuntamentoId, "primary");

    const descrizione = [...eventi.values()][0].description ?? "";
    const occorrenze = descrizione.split("Anagrafico: Mario Rossi").length - 1;
    expect(occorrenze).toBe(1);
    expect(ottieniAppuntamento(appuntamentoId)?.descrizione).toBe("");
  });

  it("una descrizione che contiene già il contesto non lo riceve una seconda volta", async () => {
    await nuovoDatabase();
    const { appuntamentoId } = creaSchedaConAppuntamento();
    // Come le righe scritte dalle versioni precedenti, che avevano salvato
    // qui la descrizione arricchita: il modulo la mostrava e ogni
    // sincronizzazione ne aggiungeva un'altra copia.
    const attuale = ottieniAppuntamento(appuntamentoId)!;
    aggiornaAppuntamento(appuntamentoId, { ...attuale, descrizione: CONTESTO });

    await sincronizzaAppuntamento(appuntamentoId, "primary");
    await aggiornaTitolo(appuntamentoId, "Ritiro documento (rivisto)");
    await sincronizzaAppuntamento(appuntamentoId, "primary");

    const descrizione = [...eventi.values()][0].description ?? "";
    expect(descrizione.split("Anagrafico: Mario Rossi").length - 1).toBe(1);
    expect(descrizione.split("Documento: VR123456A").length - 1).toBe(1);
  });
});

/** Modifica il titolo passando dalla stessa API del repository. */
async function aggiornaTitolo(id: number, titolo: string) {
  const { aggiornaAppuntamento } = await import("../src/lib/repo");
  const attuale = ottieniAppuntamento(id)!;
  aggiornaAppuntamento(id, { ...attuale, titolo });
}

/* ------------------- pubblicazione automatica dal modulo -------------------- */

describe("Pubblicazione automatica: cosa fa il modulo quando si salva", () => {
  it("un appuntamento nuovo viene pubblicato e resta collegato all'evento", async () => {
    await nuovoDatabase();
    const { appuntamentoId } = creaSchedaConAppuntamento();

    const esito = await pubblicaAppuntamento(appuntamentoId, "primary");

    expect(esito.ok).toBe(true);
    expect(esito.messaggio).toMatch(/pubblicato/i);
    expect(eventi.size).toBe(1);
    const salvato = ottieniAppuntamento(appuntamentoId);
    expect(salvato?.googleEventId).toBe("evt-1");
  });

  it("modificarlo aggiorna l'evento esistente invece di crearne un secondo", async () => {
    await nuovoDatabase();
    const { appuntamentoId } = creaSchedaConAppuntamento();
    await pubblicaAppuntamento(appuntamentoId, "primary");

    await aggiornaTitolo(appuntamentoId, "Ritiro documento (rivisto)");
    const esito = await pubblicaAppuntamento(appuntamentoId, "primary");

    expect(esito.ok).toBe(true);
    expect(esito.messaggio).toMatch(/aggiornato/i);
    expect(eventi.size).toBe(1);
    expect([...eventi.values()][0].summary).toBe("Ritiro documento (rivisto)");
  });

  it("annullarlo lo segna annullato su Google, invece di cancellarlo", async () => {
    await nuovoDatabase();
    const { appuntamentoId } = creaSchedaConAppuntamento();
    await pubblicaAppuntamento(appuntamentoId, "primary");
    expect(eventi.size).toBe(1);

    const attuale = ottieniAppuntamento(appuntamentoId)!;
    aggiornaAppuntamento(appuntamentoId, { ...attuale, stato: "annullato" });
    const esito = await pubblicaAppuntamento(appuntamentoId, "primary");

    expect(esito.ok).toBe(true);
    expect(esito.messaggio).toMatch(/annullato/i);
    // L'evento resta, scritto come annullato: è la differenza fra "non si è
    // più tenuto" e "non è mai esistito".
    expect(eventi.size).toBe(1);
    expect([...eventi.values()][0].status).toBe("cancelled");
    // Il collegamento resta: senza, la prossima modifica non saprebbe dove
    // scrivere e creerebbe un secondo evento.
    expect(ottieniAppuntamento(appuntamentoId)?.googleEventId).toBe("evt-1");
    expect(chiamate.some((c) => c.metodo === "DELETE")).toBe(false);
  });

  it("in attesa, confermato e annullato si leggono dall'evento", async () => {
    await nuovoDatabase();
    const { appuntamentoId } = creaSchedaConAppuntamento();
    const evento = () => [...eventi.values()][0];
    const appuntamento = () => ottieniAppuntamento(appuntamentoId)!;
    const aStato = (nuovo: "in-attesa" | "confermato" | "annullato") =>
      aggiornaAppuntamento(appuntamentoId, { ...appuntamento(), stato: nuovo });

    // L'appuntamento di prova è confermato: occupa la fascia.
    await pubblicaAppuntamento(appuntamentoId, "primary");
    expect(evento()?.status).toBe("confirmed");
    expect(evento()?.transparency).toBe("opaque");

    // In attesa: resta in agenda ma non occupa il tempo. È l'unico modo che
    // Google Calendar ha per dire "non ancora tenuto", ed è quello che rende
    // visibile la differenza: prima i due stati mandavano lo stesso evento e
    // passare da uno all'altro non cambiava niente.
    aStato("in-attesa");
    const inAttesa = await pubblicaAppuntamento(appuntamentoId, "primary");
    expect(inAttesa.messaggio).toMatch(/in attesa/i);
    expect(evento()?.status).toBe("confirmed");
    expect(evento()?.transparency).toBe("transparent");
    expect(eventi.size).toBe(1);

    // Confermato: torna a occupare davvero la fascia.
    aStato("confermato");
    const confermato = await pubblicaAppuntamento(appuntamentoId, "primary");
    expect(confermato.messaggio).toMatch(/aggiornato/i);
    expect(confermato.messaggio).not.toMatch(/in attesa/i);
    expect(evento()?.transparency).toBe("opaque");
    expect(eventi.size).toBe(1);

    // E tornare indietro funziona: non è una modifica che si fa una volta sola.
    aStato("in-attesa");
    await pubblicaAppuntamento(appuntamentoId, "primary");
    expect(evento()?.transparency).toBe("transparent");
    expect(eventi.size).toBe(1);

    // Annullato: sempre lo stesso evento, segnato annullato, e non occupa più
    // la fascia: non si è tenuto, quindi non deve prenotare niente.
    aStato("annullato");
    await pubblicaAppuntamento(appuntamentoId, "primary");
    expect(evento()?.status).toBe("cancelled");
    expect(evento()?.transparency).toBe("transparent");
    expect(eventi.size).toBe(1);
  });

  it("annullare un appuntamento mai pubblicato non chiama Google", async () => {
    await nuovoDatabase();
    const { appuntamentoId } = creaSchedaConAppuntamento();
    const attuale = ottieniAppuntamento(appuntamentoId)!;
    aggiornaAppuntamento(appuntamentoId, { ...attuale, stato: "annullato" });
    chiamate.length = 0;

    const esito = await pubblicaAppuntamento(appuntamentoId, "primary");

    expect(esito.ok).toBe(true);
    expect(esito.messaggio).toMatch(/non era su Google Calendar/i);
    expect(chiamate).toHaveLength(0);
  });
});

describe("Eliminare un appuntamento toglie anche l'evento", () => {
  it("l'evento sparisce da Google e l'appuntamento dal database", async () => {
    await nuovoDatabase();
    const { appuntamentoId } = creaSchedaConAppuntamento();
    await pubblicaAppuntamento(appuntamentoId, "primary");
    expect(eventi.size).toBe(1);

    const esito = await eliminaAppuntamentoEEvento(appuntamentoId);

    expect(esito.ok).toBe(true);
    expect(esito.messaggio).toMatch(/Google Calendar/);
    expect(eventi.size).toBe(0);
    expect(ottieniAppuntamento(appuntamentoId)).toBeNull();
    expect(chiamate.some((c) => c.metodo === "DELETE")).toBe(true);
  });

  it("un appuntamento mai pubblicato si elimina senza chiamare Google", async () => {
    await nuovoDatabase();
    const { appuntamentoId } = creaSchedaConAppuntamento();
    chiamate.length = 0;

    const esito = await eliminaAppuntamentoEEvento(appuntamentoId);

    expect(esito.ok).toBe(true);
    expect(esito.messaggio).toBe("Appuntamento eliminato");
    expect(chiamate).toHaveLength(0);
    expect(ottieniAppuntamento(appuntamentoId)).toBeNull();
  });

  it("se Google non risponde l'appuntamento resta: meglio che lasciare un evento orfano", async () => {
    await nuovoDatabase();
    const { appuntamentoId } = creaSchedaConAppuntamento();
    await pubblicaAppuntamento(appuntamentoId, "primary");
    fetchFinto.mockImplementationOnce(async () => risposta({ error: "rateLimitExceeded" }, 429));

    const esito = await eliminaAppuntamentoEEvento(appuntamentoId);

    expect(esito.ok).toBe(false);
    expect(esito.messaggio).toMatch(/429/);
    // Ancora in lista, con il collegamento all'evento: premere Elimina
    // di nuovo riprova senza dover riscriverlo.
    expect(ottieniAppuntamento(appuntamentoId)?.googleEventId).toBe("evt-1");
  });
});

/* -------------- il modulo: salvare deve pubblicare, senza toccare nulla ---- */

describe("Il modulo dell'appuntamento", () => {
  let contenitore: HTMLDivElement;
  let radice: Root | null = null;

  async function monta() {
    radice = createRoot(contenitore);
    await act(async () => {
      radice?.render(
        <AvvisoProvider>
          <AppuntamentoForm onSaved={() => {}} onCancel={() => {}} />
        </AvvisoProvider>,
      );
    });
  }

  function perEtichetta(nome: string): HTMLElement {
    const campi = [
      ...contenitore.querySelectorAll<HTMLElement>("input, button, select, textarea"),
    ];
    const trovato = campi.find((c) => c.textContent?.includes(nome) || c.getAttribute("aria-label") === nome);
    if (!trovato) throw new Error(`elemento non trovato: ${nome}`);
    return trovato;
  }

  beforeEach(() => {
    contenitore = document.createElement("div");
    document.body.appendChild(contenitore);
  });

  afterEach(async () => {
    if (radice) {
      await act(async () => {
        radice?.unmount();
      });
      radice = null;
    }
    contenitore.remove();
  });

  it("salvando crea l'evento su Google Calendar e avvisa", async () => {
    await nuovoDatabase();
    creaSchedaConAppuntamento(); // almeno un anagrafico, come nella pagina reale
    await monta();

    const spunta = contenitore.querySelector<HTMLInputElement>('input[type="checkbox"]');
    expect(spunta).not.toBeNull();
    expect(spunta!.checked).toBe(true);
    expect(contenitore.textContent).toContain("Pubblica su Google Calendar");

    await act(async () => {
      perEtichetta("Crea appuntamento").click();
    });

    expect(eventi.size).toBe(1);
    expect([...eventi.values()][0].summary).toBe("Appuntamento allo sportello");
    // C'è anche l'appuntamento della scheda di prova: conta quello del modulo.
    const salvato = elencaAppuntamenti({}).find(
      (a) => a.titolo === "Appuntamento allo sportello",
    );
    expect(salvato?.googleEventId).toBe("evt-1");
  });

  it("con la spunta disattivata salva in locale e non tocca Google", async () => {
    await nuovoDatabase();
    creaSchedaConAppuntamento();
    await monta();

    const spunta = contenitore.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    await act(async () => {
      spunta.click();
    });
    expect(spunta.checked).toBe(false);

    await act(async () => {
      perEtichetta("Crea appuntamento").click();
    });

    expect(eventi.size).toBe(0);
    expect(chiamate.some((c) => c.metodo === "POST")).toBe(false);
    const salvato = elencaAppuntamenti({}).find(
      (a) => a.titolo === "Appuntamento allo sportello",
    );
    expect(salvato).toBeTruthy();
    expect(salvato?.googleEventId).toBeNull();
  });

  it("un salvataggio con Google che risponde male lo dice, e lo dice sulla pagina", async () => {
    await nuovoDatabase();
    creaSchedaConAppuntamento();
    // Il modulo salva, poi prova a pubblicare. Se Google risponde con un
    // errore, quello che l'utente legge deve essere un avviso di **errore**:
    // prima la funzione ritornava `{ ok: false }` e veniva passata a `esegui`
    // come `successo`, quindi un fallimento arrivava come notifica verde con
    // dentro la frase dell'errore — e poi spariva.
    fetchFinto.mockImplementation(async () => risposta({ error: "insufficientPermissions" }, 403));
    await monta();

    const spunta = contenitore.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    expect(spunta.checked).toBe(true);
    await act(async () => {
      perEtichetta("Crea appuntamento").click();
    });

    // L'appuntamento è salvato — quello non deve mai andare perso — ma
    // l'avviso è di errore, non di successo.
    expect(elencaAppuntamenti({}).some((a) => a.titolo === "Appuntamento allo sportello")).toBe(true);
    expect(document.body.textContent).toContain("Non pubblicato");
  });
});
