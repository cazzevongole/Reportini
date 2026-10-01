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
  appuntamentiConEventoDaEliminareAzienda,
  creaAppuntamento,
  creaAzienda,
  creaReferente,
  eliminaPreferenza,
  elencaAppuntamenti,
  elencaAziende,
  marcaAppuntamentoSincronizzato,
  ottieniAppuntamento,
  scriviPreferenza,
} from "../src/lib/repo";
import { resetSincronizzazione, sincronizza } from "../src/lib/cloud/sync";
import {
  dissociaAppuntamento,
  eliminaAppuntamentiEEventi,
  eliminaAppuntamentoEEvento,
  pubblicaAppuntamento,
  sincronizzaAppuntamento,
} from "../src/lib/google/sync";
import { eliminaEvento } from "../src/lib/google/calendar";
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
  /** ID della palette di Google: nell'API è una stringa, non un numero. */
  colorId?: string;
  /** Se l'evento occupa la fascia: è come si distingue "in attesa". */
  transparency?: string;
  start?: { dateTime?: string; timeZone?: string };
  end?: { dateTime?: string; timeZone?: string };
  extendedProperties?: { private?: Record<string, string> };
}

const eventi = new Map<string, EventoFinto>();

/**
 * La risposta che dà Google quando l'evento non c'è più. Il corpo è quello
 * vero, copiato dalla 410 reale: la ragione è `deleted` e il messaggio
 * "Resource has been deleted".
 */
function eventoMorto(stato: 404 | 410) {
  return risposta(
    {
      error: {
        errors: [
          {
            domain: "global",
            reason: "deleted",
            message: "Resource has been deleted",
          },
        ],
        code: stato,
        message: "Resource has been deleted",
      },
    },
    stato,
  );
}
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
    return risposta({
      items: [{ id: "primary", summary: "Calendario principale", primary: true }],
    });
  }
  const evento = String(url).match(/\/events\/([^?]+)/);
  if (evento) {
    const id = decodeURIComponent(evento[1]);
    if (metodo === "DELETE") {
      if (!eventi.has(id)) return eventoMorto(410);
      eventi.delete(id);
      return risposta({}, 204);
    }
    if (metodo === "PUT" || metodo === "PATCH") {
      if (!eventi.has(id)) return eventoMorto(410);
      const aggiornato = {
        ...(eventi.get(id) as EventoFinto),
        ...(JSON.parse(String(init.body)) as object),
      };
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
  db.run("DELETE FROM referenti");
  db.run("DELETE FROM aziende");
  db.run("DELETE FROM relazioni");
  db.run("DELETE FROM appuntamenti");
}

function creaSchedaConAppuntamento() {
  const aziendaId = creaAzienda({
    ragioneSociale: "Ferramenta Rossi S.r.l.",
    partitaIva: "03012345678",
    indirizzo: "Via Roma 1",
    citta: "Verona",
    cap: "37100",
    provincia: "VR",
    telefono: "0451234567",
    email: "segreteria@ferramentarossi.it",
    note: "",
  });
  // Il referente esiste per essere cercato e chiamato: nessuna delle due
  // cose finisce nell'evento, quindi qui serve solo a coprire il fatto che
  // azienda e referenti viaggiano insieme nel database che sale nel cloud.
  creaReferente({
    aziendaId,
    nome: "Mario",
    cognome: "Rossi",
    telefono: "3401234567",
    email: "mario.rossi@ferramentarossi.it",
  });
  const appuntamentoId = creaAppuntamento({
    aziendaId,
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
  return { aziendaId, appuntamentoId };
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
  it("crea l'azienda, pubblica l'evento su Calendar e conserva il collegamento", async () => {
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
    // Il contesto dell'azienda viaggia nella descrizione: nell'evento, non
    // nel database, e il referente non ci finisce — è un recapito, non il
    // soggetto dell'appuntamento.
    const eventoCreato = [...eventi.values()][0];
    expect(eventoCreato.description).toContain("Ferramenta Rossi S.r.l.");
    expect(eventoCreato.description).toContain("03012345678");
    expect(eventoCreato.description).not.toContain("Mario");
    expect(chiamate.some((c) => c.metodo === "POST" && c.url.endsWith("/events"))).toBe(true);

    // Il collegamento è persistito in locale.
    const salvato = ottieniAppuntamento(appuntamentoId);
    expect(salvato?.googleEventId).toBe(creato.id);
    expect(salvato?.googleCalendarId).toBe("primary");
  });

  it("dopo logout e rientro i dati tornano dal cloud e l'evento viene aggiornato, non duplicato", async () => {
    await nuovoDatabase();
    const { aziendaId, appuntamentoId } = creaSchedaConAppuntamento();
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
    expect(elencaAziende().length).toBe(0);
    expect(elencaAppuntamenti({}).length).toBe(0);

    // --- login ---
    // L'utente ricollega anche Google Calendar: il popup si riapre come dopo
    // ogni scadenza. L'azienda e il collegamento all'evento, invece,
    // arrivano dal cloud e non da qui.
    finto.stato.sessione = { user: { id: UTENTE, email: "mara@example.it" } };
    collegaGoogle();
    const ripristino = await sincronizza(UTENTE);

    expect(ripristino.scaricato).toBe(true);
    expect(ripristino.messaggio).toMatch(/ripristinati dal cloud/i);
    const aziende = elencaAziende();
    expect(aziende.length).toBe(1);
    expect(aziende[0].ragioneSociale).toBe("Ferramenta Rossi S.r.l.");
    expect(aziende[0].id).toBe(aziendaId);
    // Anche i referenti sono tornati: senza, la scheda sarebbe quella di
    // un'azienda a cui nessuno sa scrivere.
    expect(aziende[0].numReferenti).toBe(1);

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
    fetchFinto.mockImplementationOnce(async () =>
      risposta({ error: "insufficientPermissions" }, 403),
    );
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

describe("Il contesto dell'azienda non si duplica", () => {
  const CONTESTO = "Azienda: Ferramenta Rossi S.r.l.\nPartita Iva: 03012345678";

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
    const occorrenze = descrizione.split("Azienda: Ferramenta Rossi S.r.l.").length - 1;
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
    expect(descrizione.split("Azienda: Ferramenta Rossi S.r.l.").length - 1).toBe(1);
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

  it("annullarlo lo rende visibile e chiaro su Google, non lo fa sparire", async () => {
    await nuovoDatabase();
    const { appuntamentoId } = creaSchedaConAppuntamento();
    await pubblicaAppuntamento(appuntamentoId, "primary");
    expect(eventi.size).toBe(1);

    const attuale = ottieniAppuntamento(appuntamentoId)!;
    aggiornaAppuntamento(appuntamentoId, { ...attuale, stato: "annullato" });
    const esito = await pubblicaAppuntamento(appuntamentoId, "primary");

    expect(esito.ok).toBe(true);
    expect(esito.messaggio).toMatch(/annullato/i);
    // L'evento resta e si VEDE: `status: "cancelled"` sarebbe la via dell'API
    // per eliminarlo dall'interfaccia, e chi guarda l'agenda perderebbe la
    // ragione della fascia vuota. La cancellazione si dichiara nel titolo.
    expect(eventi.size).toBe(1);
    expect([...eventi.values()][0].status).toBe("confirmed");
    expect([...eventi.values()][0].summary).toMatch(/^ANNULLATO: /);
    expect([...eventi.values()][0].colorId).toBe("11"); // Tomato, il rosso
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

    // Annullato: sempre lo stesso evento, che non occupa la fascia e ora
    // si dichiara nel titolo con il rosso — prima l'evento spariva
    // dall'interfaccia, e la ragione della fascia vuota con lui.
    aStato("annullato");
    await pubblicaAppuntamento(appuntamentoId, "primary");
    expect(evento()?.status).toBe("confirmed");
    expect(evento()?.transparency).toBe("transparent");
    expect(evento()?.summary).toMatch(/^ANNULLATO: /);
    expect(evento()?.colorId).toBe("11");
    expect(eventi.size).toBe(1);
  });

  it("lo stato si legge a occhio sull'evento, non solo dalle sue proprietà", async () => {
    await nuovoDatabase();
    const { appuntamentoId } = creaSchedaConAppuntamento();
    const evento = () => [...eventi.values()][0];
    const appuntamento = () => ottieniAppuntamento(appuntamentoId)!;
    const descrizione = () => evento()?.description ?? "";

    // `transparency` e `status` non bastano: dicono solo se l'evento occupa
    // la fascia e se è annullato, ma non distinguono "in attesa" da
    // "confermato". Chi guarda l'elenco deve poter capire quale dei due sia
    // senza aprire l'evento, quindi lo stato va scritto in chiaro.
    await pubblicaAppuntamento(appuntamentoId, "primary");
    expect(descrizione()).toMatch(/^Stato: confermato/);

    aggiornaAppuntamento(appuntamentoId, { ...appuntamento(), stato: "in-attesa" });
    await pubblicaAppuntamento(appuntamentoId, "primary");
    expect(descrizione()).toMatch(/^Stato: in attesa di conferma/);

    aggiornaAppuntamento(appuntamentoId, { ...appuntamento(), stato: "annullato" });
    await pubblicaAppuntamento(appuntamentoId, "primary");
    expect(descrizione()).toMatch(/^Stato: annullato/);

    // E resta leggibile da una macchina, per chi legge l'evento e non l'app.
    expect(evento()?.extendedProperties?.private?.reportiniStato).toBe("annullato");
  });

  it("il colore segue lo stato, e le tonalità sono diverse fra loro", async () => {
    await nuovoDatabase();
    const { appuntamentoId } = creaSchedaConAppuntamento();
    const appuntamento = () => ottieniAppuntamento(appuntamentoId)!;
    const colore = () => [...eventi.values()][0].colorId;

    await pubblicaAppuntamento(appuntamentoId, "primary");
    const confermato = colore();

    aggiornaAppuntamento(appuntamentoId, { ...appuntamento(), stato: "in-attesa" });
    await pubblicaAppuntamento(appuntamentoId, "primary");
    const inAttesa = colore();

    aggiornaAppuntamento(appuntamentoId, { ...appuntamento(), stato: "annullato" });
    await pubblicaAppuntamento(appuntamentoId, "primary");
    const annullato = colore();

    // Tre colori distinti: se due stati condividessero la tinta, in una vista
    // per mese — dove l'evento è solo una macchia — sarebbero indistinguibili,
    // che è proprio il motivo per cui il colore è stato aggiunto.
    expect(new Set([confermato, inAttesa, annullato]).size).toBe(3);
    // E sono della palette reale, non inventati: un ID inesistente
    // verrebbe rifiutato da Google.
    for (const id of [confermato, inAttesa, annullato]) {
      expect(id).toMatch(/^(1|2|3|4|5|6|7|8|9|10|11)$/);
    }
    // Stringa, non numero: è così che l'API lo vuole.
    expect(typeof confermato).toBe("string");
  });

  it("il colore che l'utente sceglie nelle impostazioni è quello che va su Google", async () => {
    await nuovoDatabase();
    const { appuntamentoId } = creaSchedaConAppuntamento();
    const { scriviColore, ripristinaColori, COLORI_PREDEFINITI } =
      await import("../src/lib/google/colori");

    // L'utente sceglie il blu per "confermato" e lascia gli altri due.
    scriviColore("confermato", "9");
    try {
      await pubblicaAppuntamento(appuntamentoId, "primary");
      expect([...eventi.values()][0].colorId).toBe("9");

      // E la scelta vale per lo stato che riguarda, non per tutti: un colore
      // unico per i tre stati sarebbe inutile come scelta.
      const attuale = ottieniAppuntamento(appuntamentoId)!;
      aggiornaAppuntamento(appuntamentoId, { ...attuale, stato: "in-attesa" });
      await pubblicaAppuntamento(appuntamentoId, "primary");
      expect([...eventi.values()][0].colorId).toBe(COLORI_PREDEFINITI["in-attesa"]);
    } finally {
      ripristinaColori();
    }

    // Tornando ai predefiniti, l'evento torna al suo colore iniziale.
    aggiornaAppuntamento(appuntamentoId, {
      ...ottieniAppuntamento(appuntamentoId)!,
      stato: "confermato",
    });
    await pubblicaAppuntamento(appuntamentoId, "primary");
    expect([...eventi.values()][0].colorId).toBe(COLORI_PREDEFINITI.confermato);
  });

  it("una preferenza corrotta non fa fallire la pubblicazione", async () => {
    await nuovoDatabase();
    const { appuntamentoId } = creaSchedaConAppuntamento();

    // Il tipo sbagliato è l'errore che fa davvero danno: se finisse
    // nell'evento, Google risponderebbe 400 e l'appuntamento non sarebbe
    // pubblicato — per un colore che l'utente non ha nemmeno chiesto. La
    // preferenza ora sta nel database, quindi è una copia ripristinata da un
    // backup o scritta da una versione diversa a farlo arrivare.
    scriviPreferenza(
      "colori-stato",
      JSON.stringify({ confermato: 6, annullato: "colore-che-non-esiste" }),
    );
    try {
      const esito = await pubblicaAppuntamento(appuntamentoId, "primary");

      expect(esito.ok).toBe(true);
      expect([...eventi.values()][0].colorId).toMatch(/^(1|2|3|4|5|6|7|8|9|10|11)$/);
    } finally {
      eliminaPreferenza("colori-stato");
    }
  });

  it("tornando confermato il titolo torna normale e il colore con lui", async () => {
    await nuovoDatabase();
    const { appuntamentoId } = creaSchedaConAppuntamento();
    await pubblicaAppuntamento(appuntamentoId, "primary");

    aggiornaAppuntamento(appuntamentoId, {
      ...ottieniAppuntamento(appuntamentoId)!,
      stato: "annullato",
    });
    await pubblicaAppuntamento(appuntamentoId, "primary");
    expect([...eventi.values()][0].summary).toMatch(/^ANNULLATO: /);

    // Ripensamento: si conferma di nuovo. L'evento non deve restare per sempre
    // etichettato annullato — il prefisso è una dichiarazione dello stato, non
    // una cicatrice.
    aggiornaAppuntamento(appuntamentoId, {
      ...ottieniAppuntamento(appuntamentoId)!,
      stato: "confermato",
    });
    await pubblicaAppuntamento(appuntamentoId, "primary");
    expect([...eventi.values()][0].summary).toBe("Ritiro documento");
    expect([...eventi.values()][0].colorId).not.toBe("11");
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

  it("se l'evento è già sparito da Google, eliminare riesce lo stesso", async () => {
    await nuovoDatabase();
    const { appuntamentoId } = creaSchedaConAppuntamento();
    await pubblicaAppuntamento(appuntamentoId, "primary");

    // L'utente cancella l'evento direttamente da Google Calendar: l'app non
    // lo sa, e il collegamento punta a un evento che non esiste più.
    const eventoId = ottieniAppuntamento(appuntamentoId)!.googleEventId!;
    await eliminaEvento(eventoId, "primary");

    const esito = await eliminaAppuntamentoEEvento(appuntamentoId);

    // Togliere l'evento dall'agenda è **già** riuscito: il 410 è Google che
    // conferma che l'evento non c'è. Fallire qui non proteggerebbe nulla e
    // renderebbe l'appuntamento non eliminabile, perché ogni nuovo tentativo
    // riceverebbe lo stesso 410.
    expect(esito.ok).toBe(true);
    expect(ottieniAppuntamento(appuntamentoId)).toBeNull();
    expect(esito.messaggio).not.toMatch(/410/);
  });

  it("scollegare un evento già sparito da Google riesce e pulisce il collegamento", async () => {
    await nuovoDatabase();
    const { appuntamentoId } = creaSchedaConAppuntamento();
    await pubblicaAppuntamento(appuntamentoId, "primary");
    const eventoId = ottieniAppuntamento(appuntamentoId)!.googleEventId!;
    await eliminaEvento(eventoId, "primary");

    const esito = await dissociaAppuntamento(appuntamentoId);

    expect(esito.ok).toBe(true);
    // Il collegamento a un evento che non esiste non può più essere tolto, e
    // quindi non può più essere ripulito: resterebbe lì per sempre.
    expect(ottieniAppuntamento(appuntamentoId)?.googleEventId).toBeNull();
  });

  it("modificare un appuntamento il cui evento è sparito lo ricrea", async () => {
    await nuovoDatabase();
    const { appuntamentoId } = creaSchedaConAppuntamento();
    await pubblicaAppuntamento(appuntamentoId, "primary");
    const eventoId = ottieniAppuntamento(appuntamentoId)!.googleEventId!;
    await eliminaEvento(eventoId, "primary");

    await aggiornaTitolo(appuntamentoId, "Ritiro documento (rivisto)");
    const esito = await sincronizzaAppuntamento(appuntamentoId, "primary");

    // Senza questo, ogni modifica successiva avrebbe ricevuto lo stesso 404
    // e l'appuntamento sarebbe restato bloccato per sempre, con un collegamento
    // a un evento morto.
    expect(esito.ok).toBe(true);
    expect(eventi.size).toBe(1);
    expect([...eventi.values()][0].summary).toBe("Ritiro documento (rivisto)");
    // E il collegamento è tornato a puntare a qualcosa che esiste.
    expect(ottieniAppuntamento(appuntamentoId)?.googleEventId).toBeTruthy();
  });

  it("eliminare un'azienda porta via anche gli eventi su Google", async () => {
    await nuovoDatabase();
    const { aziendaId, appuntamentoId } = creaSchedaConAppuntamento();
    await pubblicaAppuntamento(appuntamentoId, "primary");
    expect(eventi.size).toBe(1);

    // La cascata: gli ID evento si raccolgono prima che le righe spariscano,
    // poi l'eliminazione passa da Google prima di toccare il database.
    const conEvento = appuntamentiConEventoDaEliminareAzienda(aziendaId);
    expect(conEvento.map((a) => a.id)).toContain(appuntamentoId);
    const esito = await eliminaAppuntamentiEEventi(conEvento.map((a) => a.id));

    expect(esito.falliti).toEqual([]);
    expect(esito.riusciti).toContain(appuntamentoId);
    expect(eventi.size).toBe(0);
    expect(ottieniAppuntamento(appuntamentoId)).toBeNull();
  });

  it("se Google non risponde nella cascata, la riga locale resta e si può riprovare", async () => {
    await nuovoDatabase();
    const { aziendaId, appuntamentoId } = creaSchedaConAppuntamento();
    await pubblicaAppuntamento(appuntamentoId, "primary");
    fetchFinto.mockImplementationOnce(async () => risposta({ error: "rateLimitExceeded" }, 429));

    const conEvento = appuntamentiConEventoDaEliminareAzienda(aziendaId);
    const esito = await eliminaAppuntamentiEEventi(conEvento.map((a) => a.id));

    // L'appuntamento resta: cancellarlo comunque lascerebbe l'evento orfano
    // in agenda, non più raggiungibile da nessuno.
    expect(esito.falliti).toHaveLength(1);
    expect(esito.falliti[0].id).toBe(appuntamentoId);
    expect(ottieniAppuntamento(appuntamentoId)?.googleEventId).toBe("evt-1");
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
    const campi = [...contenitore.querySelectorAll<HTMLElement>("input, button, select, textarea")];
    const trovato = campi.find(
      (c) => c.textContent?.includes(nome) || c.getAttribute("aria-label") === nome,
    );
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
    creaSchedaConAppuntamento(); // almeno un'azienda, come nella pagina reale
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
    const salvato = elencaAppuntamenti({}).find((a) => a.titolo === "Appuntamento allo sportello");
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
    const salvato = elencaAppuntamenti({}).find((a) => a.titolo === "Appuntamento allo sportello");
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
    expect(elencaAppuntamenti({}).some((a) => a.titolo === "Appuntamento allo sportello")).toBe(
      true,
    );
    expect(document.body.textContent).toContain("Non pubblicato");
  });
});
