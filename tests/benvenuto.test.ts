/**
 * Messaggi di benvenuto: devono essere fifty, non vuoti e stabili
 * dentro la giornata (una frase che cambia a ogni render sarebbe
 * fastidiosa), e diversi da un giorno all'altro.
 */
import { describe, expect, it } from "vitest";
import { FRASI, fraseBenvenuto, saluto } from "../src/lib/benvenuto";

describe("Messaggi di benvenuto", () => {
  it("sono cinquanta, tutte diverse e non vuote", () => {
    expect(FRASI).toHaveLength(50);
    expect(new Set(FRASI).size).toBe(50);
    for (const frase of FRASI) {
      expect(frase.trim().length).toBeGreaterThan(10);
      expect(frase).toBe(frase.trim());
    }
  });

  it("restano uguali per tutto il giorno e cambiano il giorno dopo", () => {
    const mattina = new Date(2026, 2, 10, 8, 0);
    const sera = new Date(2026, 2, 10, 21, 30);
    const dopodomani = new Date(2026, 2, 12, 8, 0);

    expect(fraseBenvenuto(mattina)).toBe(fraseBenvenuto(sera));
    expect(fraseBenvenuto(mattina)).not.toBe(fraseBenvenuto(dopodomani));
  });

  it("la frase di oggi è una di quelle scritte", () => {
    expect(FRASI).toContain(fraseBenvenuto(new Date()));
  });

  it("forzata sceglie comunque una delle cinquanta", () => {
    for (let i = 0; i < 20; i += 1) {
      expect(FRASI).toContain(fraseBenvenuto(new Date(), true));
    }
  });

  it("il saluto segue l'ora", () => {
    expect(saluto(new Date(2026, 2, 10, 3))).toBe("Buonanotte");
    expect(saluto(new Date(2026, 2, 10, 9))).toBe("Buongiorno");
    expect(saluto(new Date(2026, 2, 10, 15))).toBe("Buon pomeriggio");
    expect(saluto(new Date(2026, 2, 10, 20))).toBe("Buonasera");
  });
});
