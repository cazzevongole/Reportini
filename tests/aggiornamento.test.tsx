/**
 * Aggiornamento automatico: qui si prova la parte che decide, non Electron.
 *
 * Il processo principale fa il lavoro meccanico; quello che si sbaglia è
 * sempre la decisione: mostrare un errore per un controllo che nessuno ha
 * chiesto, o far sparire "più tardi" e lasciare la barra per sempre. Quindi
 * qui il ponte è finto e si guida come arriva dal main.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import Aggiornamento from "../src/components/Aggiornamento";
import {
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
  fallisciControllo( messaggio: string | null): void;
}

function ponteFinto(statoIniziale: StatoAggiornamento = { fase: "idle" }): PonteFinto {
  let ascoltatore: ((stato: StatoAggiornamento) => void) | null = null;
  let stato = statoIniziale;
  let statoRichiesti = 0;
  let controlli = 0;
  let installazioni = 0;
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
    expect(descrizioneAggiornamento({ fase: "pronto", versione: "0.1.6" }, true)).toContain(
      "0.1.6",
    );
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

  it("mostra la barra appena il pacchetto è pronto e la installa", async () => {
    const ponte = ponteFinto();
    montaDesktop(ponte);
    await monta();
    // Lo stato iniziale viene chiesto al main: una finestra nata dopo
    // l'evento deve vedere comunque l'aggiornamento.
    expect(ponte.quanteVolteEStatoChiesto()).toBe(1);
    expect(testo()).toBe("");

    await aggiorna(() => ponte.emetti({ fase: "scarico", versione: "0.1.6", percentuale: 80 }));
    expect(testo()).toContain("80%");

    await aggiorna(() => ponte.emetti({ fase: "pronto", versione: "0.1.6" }));
    expect(testo()).toContain("Aggiorna ora");

    const pulsante = [...contenitore.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Aggiorna ora"),
    );
    expect(pulsante).toBeTruthy();
    await aggiorna(() => pulsante?.click());
    expect(ponte.quanteVolteHannoInstallato()).toBe(1);
  });

  it("«più tardi» nasconde quella versione, non le successive", async () => {
    const ponte = ponteFinto();
    montaDesktop(ponte);
    await monta();

    await aggiorna(() => ponte.emetti({ fase: "pronto", versione: "0.1.6" }));
    const rimanda = [...contenitore.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Più tardi"),
    );
    await aggiorna(() => rimanda?.click());
    expect(testo()).toBe("");

    // Stessa versione: continua a stare zitta.
    await aggiorna(() => ponte.emetti({ fase: "pronto", versione: "0.1.6" }));
    expect(testo()).toBe("");

    // Versione nuova: la domanda si ripete.
    await aggiorna(() => ponte.emetti({ fase: "pronto", versione: "0.1.7" }));
    expect(testo()).toContain("0.1.7");
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
