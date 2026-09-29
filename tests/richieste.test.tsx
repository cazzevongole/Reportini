/**
 * "Chiedilo allo sviluppatore": le richieste che gli utenti lasciano e la
 * sezione nascosta in cui lo sviluppatore le evade.
 *
 * Il finto Supabase applica la stessa regola del database — un utente vede
 * solo le proprie richieste, lo sviluppatore le vede tutte — perché è
 * quella la garanzia che conta, e una fake che restituisce tutto a chiunque
 * passerebbe anche con la pagina sbagliata.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { AvvisoProvider } from "../src/components/Avvisi";
import ChiediloAlloSviluppatore from "../src/components/ChiediloAlloSviluppatore";
import SvoltaSviluppo from "../src/components/SvoltaSviluppo";
import Sviluppo from "../src/pages/Sviluppo";
import {
  RichiesteNonAttive,
  cambiaStato,
  elencaRichieste,
  inviaRichiesta,
  resettaRuolo,
  verificaRuolo,
} from "../src/lib/sviluppo/richieste";

/* ------------------------------ Supabase finto ---------------------------- */

interface Riga {
  id: string;
  user_id: string;
  email: string;
  tipo: "fix" | "funzionalita";
  titolo: string;
  corpo: string;
  stato: "aperta" | "in corso" | "risolta";
  risposta: string | null;
  created_at: string;
  updated_at: string;
}

const UTENTE = { id: "u-1", email: "anna@esempio.it" };
const Sviluppatore = { id: "u-2", email: "dev@esempio.it" };

// vi.hoisted: il mock di @supabase/supabase-js viene alzato in cima al file e
// viene chiamato mentre gli import si valutano, quindi il finto deve esistere
// già a quel punto.
const { stato, supabaseFinto } = vi.hoisted(() => {
  const stato = {
    sessione: null as { user: { id: string; email: string } } | null,
    sviluppatore: false,
    /** Se è impostato, ogni chiamata fallisce con questo codice PostgREST. */
    errore: null as { message: string; code?: string } | null,
    righe: [] as Riga[],
    prossimoId: 1,
    /** Contatore delle interrogazioni al database sul ruolo. */
    chiamateRpc: 0,
  };

  // È la RLS: le righe degli altri non arrivano al client, punto.
  const visibili = () =>
    stato.sviluppatore
      ? stato.righe
      : stato.righe.filter((r) => r.user_id === stato.sessione?.user.id);

  const supabaseFinto = {
    auth: {
      getSession: async () => ({ data: { session: stato.sessione }, error: null }),
    },
    rpc: async () => {
      stato.chiamateRpc += 1;
      return { data: stato.sviluppatore, error: stato.errore };
    },
    from: (tabella: string) => {
      if (tabella !== "richieste") throw new Error(`tabella inattesa: ${tabella}`);
      return {
        select: () => {
          let filtro: { colonna: string; valore: string } | null = null;
          const catena = {
            eq: (colonna: string, valore: string) => {
              filtro = { colonna, valore };
              return catena;
            },
            order: () => ({
              limit: async () => {
                if (stato.errore) return { data: null, error: stato.errore };
                const scelto = filtro;
                const righe = scelto
                  ? visibili().filter((r) => r[scelto.colonna as keyof Riga] === scelto.valore)
                  : visibili();
                return { data: righe, error: null };
              },
            }),
          };
          return catena;
        },
        insert: (riga: Record<string, unknown>) => ({
          select: () => ({
            single: async () => {
              if (stato.errore) return { data: null, error: stato.errore };
              const nuova = {
                ...(riga as unknown as Riga),
                id: `r-${stato.prossimoId++}`,
                stato: "aperta",
                risposta: null,
              } as Riga;
              stato.righe = [nuova, ...stato.righe];
              return { data: nuova, error: null };
            },
          }),
        }),
        update: (patch: Record<string, unknown>) => ({
          eq: async (colonna: keyof Riga, valore: string) => {
            if (stato.errore) return { data: null, error: stato.errore };
            stato.righe = stato.righe.map((r) =>
              r[colonna] === valore ? ({ ...r, ...patch } as Riga) : r,
            );
            return { data: null, error: null };
          },
        }),
      };
    },
  };

  return { stato, supabaseFinto };
});

vi.mock("@supabase/supabase-js", () => ({ createClient: () => supabaseFinto }));

/* --------------------------------- montaggio ------------------------------ */

let contenitore: HTMLDivElement;
let radice: Root | null = null;

function riga(parte: Partial<Riga> = {}): Riga {
  return {
    id: "r-1",
    user_id: UTENTE.id,
    email: UTENTE.email,
    tipo: "fix",
    titolo: "La relazione non si salva",
    corpo: "Chiudo la schedata a metà e la perdo.",
    stato: "aperta",
    risposta: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...parte,
  };
}

async function monta(nodo: React.ReactNode) {
  radice = createRoot(contenitore);
  await act(async () => {
    radice?.render(<AvvisoProvider>{nodo}</AvvisoProvider>);
  });
}

function testo() {
  return contenitore.textContent ?? "";
}

function perEtichetta(nome: string): HTMLElement {
  const campi = [...contenitore.querySelectorAll<HTMLElement>("input, textarea, button")];
  const trovato = campi.find(
    (c) => c.getAttribute("aria-label") === nome || c.textContent === nome,
  );
  if (!trovato) throw new Error(`elemento non trovato: ${nome}`);
  return trovato;
}

function scrivi(elemento: HTMLInputElement | HTMLTextAreaElement, testo: string) {
  const setter = Object.getOwnPropertyDescriptor(
    elemento instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype,
    "value",
  )?.set;
  setter?.call(elemento, testo);
  elemento.dispatchEvent(new Event("input", { bubbles: true }));
}

beforeEach(() => {
  resettaRuolo();
  stato.sessione = { user: UTENTE };
  stato.sviluppatore = false;
  stato.errore = null;
  stato.righe = [];
  stato.prossimoId = 1;
  stato.chiamateRpc = 0;
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

/* ---------------------------------- test ---------------------------------- */

describe("Richieste allo sviluppatore", () => {
  it("un utente scrive col proprio nome, non con quello che gli si passa", async () => {
    const creata = await inviaRichiesta(
      "funzionalita",
      "Esporta tutto in una volta",
      "Adesso devo esportare un file per volta.",
    );
    expect(creata.email).toBe(UTENTE.email);
    expect(creata.stato).toBe("aperta");
    // Nello stato remoto l'email è quella della sessione.
    expect(stato.righe[0].email).toBe(UTENTE.email);
    expect(stato.righe[0].user_id).toBe(UTENTE.id);
  });

  it("un titolo vuoto non parte: la richiesta senza titolo non si può evadere", async () => {
    await expect(inviaRichiesta("fix", "   ", "Corpo")).rejects.toThrow(/titolo/i);
    expect(stato.righe).toHaveLength(0);
  });

  it("l'utente vede solo le proprie richieste", async () => {
    stato.righe = [
      riga(),
      riga({ id: "r-2", user_id: Sviluppatore.id, email: Sviluppatore.email }),
    ];
    const mie = await elencaRichieste();
    expect(mie.map((r) => r.id)).toEqual(["r-1"]);
  });

  it("anche lo sviluppatore, nelle impostazioni, vede solo le sue", async () => {
    stato.sviluppatore = true;
    stato.sessione = { user: Sviluppatore };
    stato.righe = [
      riga(),
      riga({ id: "r-2", user_id: Sviluppatore.id, email: Sviluppatore.email }),
    ];
    expect((await elencaRichieste(true)).map((r) => r.id)).toEqual(["r-2"]);
  });

  it("lo sviluppatore vede tutte, e cambia stato", async () => {
    stato.sviluppatore = true;
    stato.righe = [
      riga(),
      riga({ id: "r-2", user_id: Sviluppatore.id, email: Sviluppatore.email, titolo: "Altra" }),
    ];
    const tutte = await elencaRichieste();
    expect(tutte).toHaveLength(2);
    await cambiaStato("r-1", "risolta");
    expect(stato.righe.find((r) => r.id === "r-1")?.stato).toBe("risolta");
  });

  it("se lo script SQL non è stato eseguito, il motivo è detto per nome", async () => {
    stato.errore = {
      code: "42P01",
      message: "Could not find the table 'public.richieste' in the schema cache",
    };
    await expect(elencaRichieste()).rejects.toBeInstanceOf(RichiesteNonAttive);
    await expect(elencaRichieste()).rejects.toThrow(/richieste\.sql/);
  });

  it("il ruolo distingue 'non sei tu' da 'non lo so'", async () => {
    expect((await verificaRuolo()).ruolo).toBe("utente");
    stato.sviluppatore = true;
    expect((await verificaRuolo(true)).ruolo).toBe("sviluppatore");
    stato.errore = { code: "42883", message: "function public.sei_sviluppatore does not exist" };
    const esito = await verificaRuolo(true);
    expect(esito.ruolo).toBe("errore");
    expect(esito.messaggio).toMatch(/richieste\.sql/);
  });

  it("il ruolo si chiede una volta sola, finché non cambia account", async () => {
    stato.chiamateRpc = 0;
    await verificaRuolo();
    await verificaRuolo();
    expect(stato.chiamateRpc).toBe(1);
    // Cambiando account la risposta va rinfrescata: altrimenti il secondo
    // utente di questo dispositivo eredita il ruolo del primo.
    stato.sviluppatore = true;
    expect((await verificaRuolo()).ruolo).toBe("utente");
    resettaRuolo();
    expect((await verificaRuolo()).ruolo).toBe("sviluppatore");
  });
});

describe("Sezione Chiedilo allo sviluppatore", () => {
  it("mostra le richieste dell'utente con la risposta dello sviluppatore", async () => {
    stato.righe = [riga({ stato: "risolta", risposta: "Corretto: ora salva anche chiudendo." })];
    await monta(<ChiediloAlloSviluppatore />);
    expect(testo()).toContain("La relazione non si salva");
    expect(testo()).toContain("Risolta");
    expect(testo()).toContain("Corretto: ora salva anche chiudendo.");
  });

  it("invia quello che è scritto e poi lo ritrova nell'elenco", async () => {
    await monta(<ChiediloAlloSviluppatore />);
    const [titolo, corpo] = contenitore.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
      "input, textarea",
    );
    await act(async () => {
      scrivi(titolo!, "Esporta tutto");
      scrivi(corpo!, "Vorrei un pulsante solo.");
    });
    await act(async () => {
      perEtichetta("Invia allo sviluppatore").click();
    });
    expect(stato.righe).toHaveLength(1);
    expect(testo()).toContain("Esporta tutto");
  });

  it("senza Supabase dice perché non può scrivere", async () => {
    stato.sessione = null;
    await monta(<ChiediloAlloSviluppatore />);
    expect(testo()).toContain("Chiedilo allo sviluppatore");
  });
});

describe("Puntamento dalla pagina impostazioni", () => {
  async function montaSvolta() {
    await monta(
      <MemoryRouter>
        <SvoltaSviluppo />
      </MemoryRouter>,
    );
  }

  it("per un utente qualsiasi non c'è", async () => {
    await montaSvolta();
    expect(testo()).toBe("");
    expect(contenitore.querySelector("a")).toBeNull();
  });

  it("per lo sviluppatore c'è, e porta alla sezione nascosta", async () => {
    stato.sviluppatore = true;
    await montaSvolta();
    expect(testo()).toContain("Richieste degli utenti");
    expect(contenitore.querySelector("a")?.getAttribute("href")).toBe("/panel/sviluppo");
  });
});

describe("Sezione nascosta dello sviluppatore", () => {
  async function montaSviluppo() {
    await monta(
      <MemoryRouter initialEntries={["/panel/sviluppo"]}>
        <Routes>
          <Route path="/panel/sviluppo" element={<Sviluppo />} />
          <Route path="/panel" element={<p>Il pannello</p>} />
        </Routes>
      </MemoryRouter>,
    );
  }

  it("chi non è lo sviluppatore viene rimandato al pannello, senza vedere nulla", async () => {
    await montaSviluppo();
    expect(testo()).toBe("Il pannello");
  });

  it("lo sviluppatore trova le richieste e le evade", async () => {
    stato.sviluppatore = true;
    stato.righe = [
      riga(),
      riga({ id: "r-2", user_id: Sviluppatore.id, email: Sviluppatore.email }),
    ];
    await montaSviluppo();
    expect(testo()).toContain("Richieste degli utenti");
    expect(testo()).toContain("anna@esempio.it");

    await act(async () => {
      perEtichetta("Segna risolta").click();
    });
    expect(stato.righe[0].stato).toBe("risolta");
  });

  it("se la verifica non riesce, spiega il motivo invece di far finta di niente", async () => {
    stato.errore = { code: "42P01", message: "relation does not exist" };
    await montaSviluppo();
    expect(testo()).toContain("richieste.sql");
  });
});
