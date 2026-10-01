/**
 * Il link al download del pacchetto desktop.
 *
 * La parte che conta non è il link — quello è una stringa — ma la scelta del
 * **sistema**: offrire un `.dmg` a chi è su Linux, o un `.exe` a chi è su un
 * telefono Android, è peggio che non offrire niente, perché l'utente scarica
 * un pacchetto che non parte e conclude che l'app sia rotta.
 *
 * Il riconoscimento è fatto sul user agent, che è una stringa scritta da
 * altri e non da noi: contiene nomi che si somigliano (`Windows Phone`
 * contiene "Windows"), sistemi dentro altri (Chrome su Linux è "X11" dentro
 * "Linux"), e parole che c'entrano col nome del prodotto ma non col sistema
 * ("Mac" in un nome qualsiasi). Ognuna di queste ha già fatto un caso in cui
 * la regex abbagliava.
 */
import { describe, expect, it } from "vitest";
import { istruzioni, linkDownload, REPO, sistema } from "../src/lib/desktop";

/** Il riconoscimento con un user agent finto, come lo vede il browser. */
function riconosci(agente: string): ReturnType<typeof sistema> {
  const originale = navigator.userAgent;
  Object.defineProperty(navigator, "userAgent", {
    value: agente,
    configurable: true,
  });
  try {
    return sistema();
  } finally {
    Object.defineProperty(navigator, "userAgent", {
      value: originale,
      configurable: true,
    });
  }
}

describe("Il sistema si riconosce, e non si confonde", () => {
  it("i tre sistemi hanno i loro nomi come li scrive il browser", () => {
    expect(riconosci("Mozilla/5.0 (Windows NT 10.0; Win64; x64)")).toBe("windows");
    expect(
      riconosci(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15",
      ),
    ).toBe("mac");
    expect(riconosci("Mozilla/5.0 (X11; Linux x86_64)")).toBe("linux");
  });

  it("un telefono non riceve un pacchetto desktop", () => {
    // Il caso che ha fatto scrivere questo test. Il user agent di Android
    // contiene "Linux" e quello di iOS contiene "Mac OS": senza un controllo
    // esplicito, un telefono Android si sarebbe visto come Linux e avrebbe
    // offerto il .AppImage, che su Android non parte. L'utente scarica, non
    // funziona, e conclude che l'app sia rotta.
    expect(
      riconosci("Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120 Mobile"),
    ).toBe("unknown");
    expect(
      riconosci(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148",
      ),
    ).toBe("unknown");
    expect(
      riconosci("Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148"),
    ).toBe("unknown");
    // Il tablet Android ha anche lui "Android" nel user agent, e nessun
    // pacchetto desktop gli va.
    expect(riconosci("Mozilla/5.0 (Linux; Android 13; SM-X700)")).toBe("unknown");
  });

  it("Chrome e Firefox su Linux restano Linux", () => {
    // Il controllo sui telefoni non deve essere tanto largo da mangiare il
    // desktop: qui i browser sono due diversi, e nessuno dei due nomi è un
    // telefono.
    expect(riconosci("Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:109.0) Gecko/20100101")).toBe(
      "linux",
    );
    expect(riconosci("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120.0.0.0")).toBe(
      "linux",
    );
    // E Chromium in un ambiente senza desktop ("cros") è ancora un Linux.
    expect(riconosci("Mozilla/5.0 (X11; CrOS x86_64 14541.0.0)")).toBe("linux");
  });

  it("un sistema che non c'è si dichiara sconosciuto, invece di tirare a indovinare", () => {
    // Il caso in cui l'app è su un dispositivo che nessuno dei tre copre:
    // meglio la pagina della release senza istruzioni che un pacchetto
    // sbagliato con tre passaggi per installarlo.
    expect(riconosci("Mozilla/5.0 (PlayStation 5)")).toBe("unknown");
    expect(riconosci("")).toBe("unknown");
  });

  it("senza navigator non è un errore", () => {
    // Lo script gira anche dove non c'è una finestra (GitHub Actions, gli
    // script Node): `typeof navigator` è la difesa, non un fatto raro.
    expect(typeof navigator).not.toBe("undefined");
    const senza = (() => {
      const g = globalThis as { navigator?: unknown };
      const originale = g.navigator;
      // In jsdom la proprietà non è cancellabile, quindi si toglie il valore
      // e si rimette: quello che si prova è che il codice regge l'assenza.
      Object.defineProperty(globalThis, "navigator", { value: undefined, configurable: true });
      try {
        return sistema();
      } finally {
        Object.defineProperty(globalThis, "navigator", { value: originale, configurable: true });
      }
    })();
    expect(senza).toBe("unknown");
  });
});

describe("Il link porta alla pagina della release, non all'allegato", () => {
  it("senza versione va all'ultima release", () => {
    // Nel browser non c'è una versione installata: è una pagina, non un
    // programma. "latest" è la pagina che non invecchia mai.
    expect(linkDownload()).toBe(`https://github.com/${REPO}/releases/latest`);
  });

  it("non contiene mai il nome di un pacchetto", () => {
    // Il nome del file è `${productName}-Setup-${version}.${ext}`, e la
    // versione cambia a ogni rilascio: un link all'allegato va bene fino
    // alla release dopo, poi è un 404 che l'utente legge come "non
    // funziona". Il link alla pagina è la forma che non si rompe.
    for (const link of [linkDownload(), linkDownload("0.4.1")]) {
      expect(link).not.toMatch(/\.(dmg|exe|AppImage|zip)(\?|$)/);
    }
  });

  it("il repository è quello giusto", () => {
    expect(linkDownload()).toContain(REPO);
  });
});

describe("Le istruzioni dicono il pacchetto giusto", () => {
  it("ogni sistema ha la sua estensione", () => {
    expect(istruzioni("mac")).toMatch(/\.dmg/);
    expect(istruzioni("windows")).toMatch(/\.exe/);
    expect(istruzioni("linux")).toMatch(/\.AppImage/);
  });

  it("il sistema sconosciuto non spiega un'installazione a caso", () => {
    // Meglio nessuna istruzione che una sbagliata: la pagina della release
    // ha comunque quello che serve accanto al pulsante di GitHub.
    expect(istruzioni("unknown")).toBeNull();
  });

  it("ogni sistema si nomina con il nome che l'utente conosce", () => {
    expect(istruzioni("mac")).toContain("macOS");
    expect(istruzioni("windows")).toContain("Windows");
    expect(istruzioni("linux")).toContain("Linux");
  });
});
