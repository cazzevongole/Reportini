/**
 * La Edge Function pubblicata è una seconda copia del codice che sta qui, e
 * nessuna delle due avvisa l'altra quando divergono. Il caso in cui è
 * successo: dopo il passaggio a reportini.cazzevongole.com il repository
 * aveva l'origine nuova nell'elenco delle origini ammesse e la funzione
 * pubblicata no, quindi il preflight CORS rispondeva con l'origine sbagliata
 * e l'accesso con Google si fermava senza dire perché.
 *
 * Qui si prova solo il confronto, che è la parte con i casi limite: la rete
 * non la si tocca in un test.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { confronta, normalizza } from "../scripts/verifica-edge-function.mjs";

const LOCALE = readFileSync("supabase/functions/google-token/index.ts", "utf8");

describe("Confronto della Edge Function", () => {
  it("non segnala nulla quando i due sorgenti coincidono", () => {
    expect(confronta({ locale: LOCALE, pubblicato: LOCALE })).toEqual([]);
  });

  it("non segnala nulla per i fine riga diversi", () => {
    // Su Windows il file del repository è CRLF, su Supabase no. Segnalarlo
    // come differenza renderebbe il controllo urlabile in ogni esecuzione.
    // La conversione parte dai fine riga normalizzati: il file del repository
    // è già CRLF, e sostituire "\n" alla cieca aggiungerebbe un "\r" di troppo.
    const comeSuSupabase = normalizza(LOCALE).replace(/\n/g, "\r\n");
    expect(confronta({ locale: LOCALE, pubblicato: comeSuSupabase })).toEqual([]);
  });

  it("segnala una funzione che non risulta pubblicata", () => {
    // È una terza situazione, diversa dal codice diverso: la funzione non c'è
    // e va pubblicata, non allineata.
    const problemi = confronta({ locale: LOCALE, pubblicato: null });
    expect(problemi).toHaveLength(1);
    expect(problemi[0]).toContain("non risulta pubblicata");
  });

  it("segnala un codice diverso e dice come procedere", () => {
    const diverso = LOCALE.replace("reportini.cazzevongole.com", "cazzevongole.github.io");
    const problemi = confronta({ locale: LOCALE, pubblicato: diverso });
    expect(problemi.length).toBeGreaterThan(0);
    // Il messaggio deve nominare il file del repository, altrimenti chi legge
    // il log non sa che cosa ripubblicare.
    expect(problemi.join("\n")).toContain("supabase/functions/google-token/index.ts");
  });

  it("non si confonde per uno spazio finale in più", () => {
    expect(confronta({ locale: LOCALE, pubblicato: `${LOCALE}\n\n  ` })).toEqual([]);
  });

  it("normalizza i fine riga e la shebang, non il resto", () => {
    expect(normalizza("a\r\nb")).toBe("a\nb");
    expect(normalizza("#!/usr/bin/env deno\na")).toBe("a");
    // La normalizzazione non deve nascondere una differenza vera: qui il
    // commento conta, perché è ciò che spiega a chi legge il codice.
    expect(normalizza("a\nb")).not.toBe(normalizza("a\n// spiegazione\nb"));
  });

  it("l'origine nuova è fra quelle ammesse nel codice del repository", () => {
    // Una guardia sul valore, non sul meccanismo: è il fatto che ha rotto
    // l'accesso, e nessun test sul confronto lo avrebbe notato.
    expect(LOCALE).toContain("https://reportini.cazzevongole.com");
  });
});
