/**
 * Aggiornamento automatico: qui si prova la parte che decide, non Electron.
 *
 * Il processo principale fa il lavoro meccanico; quello che si sbaglia è
 * sempre la decisione: mostrare un errore per un controllo che nessuno ha
 * chiesto, chiedere due volte la stessa cosa, o lasciare un pop-up che non si
 * può chiudere. Quindi qui il ponte è finto e si guida come arriva dal main.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import Aggiornamento from "../src/components/Aggiornamento";
import {
  INTERVALLO_CONTROLLO_MS,
  RITARDO_PRIMO_CONTROLLO_MS,
  avviaControlliAutomatici,
  controllaAggiornamenti,
  descrizioneAggiornamento,
  resettaAggiornamenti,
  type PonteAggiornamento,
  type StatoAggiornamento,
} from "../src/lib/aggiornamento";

interface PonteFinto extends PonteAggiornamento {
  /** Come un evento di electron-updater. */
  emetti(stato: StatoAggiornamento): void;
  quanteVolteEStatoChiesto(): number;
  quanteVolteHannoControllato(): number;
  quanteVolteHannoInstallato(): number;
  /** Quante volte è stato scelto "alla chiusura dell'app". */
  quanteVolteHannoRimandatoAllaChiusura(): number;
  fallisciControllo( messaggio: string | null): void;
}

function ponteFinto(statoIniziale: StatoAggiornamento = { fase: "idle" }): PonteFinto {
  let ascoltatore: ((stato: StatoAggiornamento) => void) | null = null;
  let stato = statoIniziale;
  let statoRichiesti = 0;
  let controlli = 0;
  let installazioni = 0;
  let rimande = 0;
  let errore: string | null = null;

  return {
    async stato() {
      statoRichiesti += 1;
      return stato;
    },
    async versione() {
      return "0.1.4";
    },
    async controlla() {
      controlli += 1;
      if (errore) throw new Error(errore);
      return stato;
    },
    async installa() {
      installazioni += 1;
      return true;
    },
    async rimandaAllaChiusura() {
      rimande += 1;
      return true;
    },
    onCambio(ascolta) {
      ascoltatore = ascolta;
      return () => {
        ascoltatore = null;
      };
    },
    emetti(nuovo) {
      stato = nuovo;
      ascoltatore?.(nuovo);
    },
    quanteVolteEStatoChiesto: () => statoRichiesti,
    quanteVolteHannoControllato: () => controlli,
    quanteVolteHannoInstallato: () => installazioni,
    quanteVolteHannoRimandatoAllaChiusura: () => rimande,
    fallisciControllo(messaggio) {
      errore = messaggio;
    },
  };
}

function montaDesktop(ponte: PonteAggiornamento | undefined) {
  if (ponte) {
    window.reportini = {
      readDb: async () => null,
      writeDb: async () => {},
      dbPath: "reportini.sqlite",
      platform: "linux",
      aggiornamento: ponte,
    };
  } else {
    delete window.reportini;
  }
}

let contenitore: HTMLDivElement;
let radice: Root | null = null;

async function monta() {
  radice = createRoot(contenitore);
  await act(async () => {
    radice?.render(<Aggiornamento />);
  });
}

function testo() {
  return contenitore.textContent ?? "";
}

function pulsante(nome: string): HTMLButtonElement | undefined {
  return [...contenitore.querySelectorAll("button")].find((b) =>
    b.textContent?.includes(nome),
  ) as HTMLButtonElement | undefined;
}

async function aggiorna(azione: () => void) {
  await act(async () => {
    azione();
  });
}

beforeEach(() => {
  resettaAggiornamenti();
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
  delete window.reportini;
  contenitore.remove();
});

describe("Aggiornamento automatico", () => {
  it("non parla quando il controllo non l'ha chiesto nessuno", () => {
    expect(descrizioneAggiornamento({ fase: "aggiornato" }, false)).toBeNull();
    expect(descrizioneAggiornamento({ fase: "controllo" }, false)).toBeNull();
    expect(
      descrizioneAggiornamento({ fase: "errore", messaggio: "rete assente" }, false),
    ).toBeNull();
  });

  it("risponde quando il controllo è chiesto a mano", () => {
    expect(descrizioneAggiornamento({ fase: "aggiornato" }, true)).toBe(
      "Sei già all'ultima versione.",
    );
    expect(
      descrizioneAggiornamento({ fase: "errore", messaggio: "rete assente" }, true),
    ).toContain("rete assente");
  });

  it("mostra l'avanzamento e poi il pacchetto pronto", () => {
    expect(
      descrizioneAggiornamento({ fase: "scarico", versione: "0.1.6", percentuale: 42 }, true),
    ).toBe("Sto scaricando Reportini 0.1.6… 42%");
    // La percentuale non c'è ancora al primo evento: non si inventa uno zero.
    expect(descrizioneAggiornamento({ fase: "scarico" }, true)).toBe(
      "Sto scaricando l'aggiornamento…",
    );
    const pronto = descrizioneAggiornamento({ fase: "pronto", versione: "0.1.6" }, true);
    expect(pronto).toContain("0.1.6");
    // Le due vie sono annunciate già nella barra: la domanda non arriva a
    // sorpresa.
    expect(pronto).toContain("alla chiusura");
  });

  it("cerca una versione nuova più spesso: subito e poi ogni mezz'ora", () => {
    vi.useFakeTimers();
    try {
      const ponte = ponteFinto();
      montaDesktop(ponte);
      const smetti = avviaControlliAutomatici();
      expect(ponte.quanteVolteHannoControllato()).toBe(0);

      vi.advanceTimersByTime(RITARDO_PRIMO_CONTROLLO_MS);
      expect(ponte.quanteVolteHannoControllato()).toBe(1);

      vi.advanceTimersByTime(INTERVALLO_CONTROLLO_MS);
      expect(ponte.quanteVolteHannoControllato()).toBe(2);

      // Sei ore erano l'intervallo di prima: chi apriva l'app al mattino restava
      // sulla versione di ieri per tutta la giornata.
      expect(INTERVALLO_CONTROLLO_MS).toBe(30 * 60 * 1000);
      expect(INTERVALLO_CONTROLLO_MS).toBeLessThan(60 * 60 * 1000);

      // E la pulizia funziona: smontato il componente i controlli finiscono.
      smetti();
      vi.advanceTimersByTime(INTERVALLO_CONTROLLO_MS);
      expect(ponte.quanteVolteHannoControllato()).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("un controllo automatico fallito lascia la barra in pace", async () => {
    const ponte = ponteFinto();
    montaDesktop(ponte);
    ponte.fallisciControllo("rete assente");
    await aggiorna(() => {
      void controllaAggiornamenti(false);
    });
    expect(ponte.quanteVolteHannoControllato()).toBe(1);
    expect(testo()).toBe("");
  });

  it("scarica in silenzio e poi chiede, anche se nessuno ha chiesto il controllo", async () => {
    const ponte = ponteFinto();
    montaDesktop(ponte);
    await monta();
    // Lo stato iniziale viene chiesto al main: una finestra nata dopo
    // l'evento deve vedere comunque l'aggiornamento.
    expect(ponte.quanteVolteEStatoChiesto()).toBe(1);
    expect(testo()).toBe("");

    await aggiorna(() => ponte.emetti({ fase: "scarico", versione: "0.1.6", percentuale: 80 }));
    // Durante lo scarico si guarda, ma non si sceglie: la barra è informazione.
    expect(testo()).toContain("80%");
    expect(pulsante("Aggiorna adesso")).toBeUndefined();

    await aggiorna(() => ponte.emetti({ fase: "pronto", versione: "0.1.6" }));
    // Il pop-up, non una striscia: è una domanda, e la barra non è il posto
    // giusto per farla.
    const dialogo = contenitore.querySelector('[role="dialog"]');
    expect(dialogo?.textContent).toContain("C'è una versione nuova");
    expect(testo()).toContain("0.1.6");
    expect(pulsante("Aggiorna adesso")).toBeTruthy();
    expect(pulsante("Alla chiusura dell'app")).toBeTruthy();
  });

  it("«aggiorna adesso» installa e chiude l'app", async () => {
    const ponte = ponteFinto();
    montaDesktop(ponte);
    await monta();
    await aggiorna(() => ponte.emetti({ fase: "pronto", versione: "0.1.6" }));

    await aggiorna(() => pulsante("Aggiorna adesso")?.click());
    expect(ponte.quanteVolteHannoInstallato()).toBe(1);
    // Scegliere "adesso" non è anche un "rimanda": un solo canale.
    expect(ponte.quanteVolteHannoRimandatoAllaChiusura()).toBe(0);
  });

  it("«alla chiusura» non installa, lo dice al main e non chiede più", async () => {
    const ponte = ponteFinto();
    montaDesktop(ponte);
    await monta();

    await aggiorna(() => ponte.emetti({ fase: "pronto", versione: "0.1.6" }));
    await aggiorna(() => pulsante("Alla chiusura dell'app")?.click());
    expect(ponte.quanteVolteHannoRimandatoAllaChiusura()).toBe(1);
    expect(ponte.quanteVolteHannoInstallato()).toBe(0);
    expect(testo()).toBe("");

    // Stessa versione: continua a stare zitta, l'utente ha già risposto.
    await aggiorna(() => ponte.emetti({ fase: "pronto", versione: "0.1.6" }));
    expect(testo()).toBe("");

    // Versione nuova: la domanda si ripete, perché è una richiesta nuova.
    await aggiorna(() => ponte.emetti({ fase: "pronto", versione: "0.1.7" }));
    expect(testo()).toContain("0.1.7");
  });

  it("il pop-up non ha una terza via: niente X, Esc non lo chiude", async () => {
    const ponte = ponteFinto();
    montaDesktop(ponte);
    await monta();
    await aggiorna(() => ponte.emetti({ fase: "pronto", versione: "0.1.6" }));

    expect(contenitore.querySelector('[aria-label="Chiudi"]')).toBeNull();
    await aggiorna(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    // Le due scelte sono le due uniche: chiudere il pop-up senza scegliere
    // lascerebbe l'utente con un aggiornamento scaricato e la stessa domanda
    // al prossimo riavvio.
    expect(pulsante("Aggiorna adesso")).toBeTruthy();
    expect(ponte.quanteVolteHannoInstallato()).toBe(0);
    expect(ponte.quanteVolteHannoRimandatoAllaChiusura()).toBe(0);
  });

  it("nel browser non c'è barra né errori", async () => {
    montaDesktop(undefined);
    await monta();
    await aggiorna(() => {
      void controllaAggiornamenti(true);
    });
    expect(testo()).toBe("");
  });
});
