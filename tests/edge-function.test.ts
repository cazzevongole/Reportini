/**
 * Le Edge Function pubblicate sono una seconda copia del codice che sta qui, e
 * nessuna delle due avvisa l'altra quando divergono. Il caso in cui è
 * successo: dopo il passaggio a reportini.cazzevongole.com il repository aveva
 * l'origine nuova nell'elenco delle origini ammesse e la funzione pubblicata
 * no, quindi il preflight CORS rispondeva con l'origine sbagliata e l'accesso
 * con Google si fermava senza dire perché.
 *
 * Qui si prova solo il confronto, che è la parte con i casi limite: la rete
 * non la si tocca in un test.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  FUNZIONI,
  confronta,
  leggiFunzione,
  normalizza,
} from "../scripts/verifica-edge-function.mjs";

const SORGENTE = readFileSync("supabase/functions/google-token/index.ts", "utf8");
const FUNZIONE = { "google-token/index.ts": SORGENTE };

describe("Confronto delle Edge Function", () => {
  it("non segnala nulla quando i due sorgenti coincidono", () => {
    expect(confronta({ nome: "google-token", locale: FUNZIONE, pubblicato: FUNZIONE })).toEqual([]);
  });

  it("non segnala nulla per i fine riga diversi", () => {
    // Su Windows il file del repository è CRLF, su Supabase no. Segnalarlo
    // come differenza renderebbe il controllo urlabile in ogni esecuzione.
    const comeSuSupabase = Object.fromEntries(
      Object.entries(FUNZIONE).map(([nome, testo]) => [
        nome,
        normalizza(testo).replace(/\n/g, "\r\n"),
      ]),
    );
    expect(
      confronta({ nome: "google-token", locale: FUNZIONE, pubblicato: comeSuSupabase }),
    ).toEqual([]);
  });

  it("segnala una funzione che non risulta pubblicata", () => {
    // È una terza situazione, diversa dal codice diverso: la funzione non c'è
    // e va pubblicata, non allineata.
    const problemi = confronta({ nome: "google-token", locale: FUNZIONE, pubblicato: null });
    expect(problemi).toHaveLength(1);
    expect(problemi[0]).toContain("non risulta pubblicata");
  });

  it("segnala un codice diverso e dice come procedere", () => {
    const diverso = Object.fromEntries(
      Object.entries(FUNZIONE).map(([nome, testo]) => [
        nome,
        testo.replace("reportini.cazzevongole.com", "cazzevongole.github.io"),
      ]),
    );
    const problemi = confronta({ nome: "google-token", locale: FUNZIONE, pubblicato: diverso });
    expect(problemi.length).toBeGreaterThan(0);
    // Il messaggio deve nominare il file del repository, altrimenti chi legge
    // il log non sa che cosa ripubblicare.
    expect(problemi.join("\n")).toContain("supabase/functions/google-token/index.ts");
  });

  it("segnala un file che manca da un lato", () => {
    // I due casi opposti dello stesso problema: una funzione pubblicata a
    // metà, o una copia che sul server ha un file che nel repository non c'è.
    const soloIndice = { "google-token/index.ts": SORGENTE };
    const mancante = confronta({
      nome: "notifica-richiesta",
      locale: soloIndice,
      pubblicato: soloIndice,
    });
    expect(mancante).toEqual([]);

    const conCorpo = { ...soloIndice, "notifica-richiesta/corpo.ts": "export const x = 1;\n" };
    const escluso = confronta({
      nome: "notifica-richiesta",
      locale: conCorpo,
      pubblicato: soloIndice,
    });
    expect(escluso.join("\n")).toContain("notifica-richiesta/corpo.ts");

    const diPiu = confronta({
      nome: "notifica-richiesta",
      locale: soloIndice,
      pubblicato: conCorpo,
    });
    expect(diPiu.join("\n")).toContain("non nel repository");
  });

  it("non si confonde per uno spazio finale in più", () => {
    const conSpazi = { "google-token/index.ts": `${SORGENTE}\n\n  ` };
    expect(confronta({ nome: "google-token", locale: FUNZIONE, pubblicato: conSpazi })).toEqual([]);
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
    expect(SORGENTE).toContain("https://reportini.cazzevongole.com");
  });
});

describe("Le funzioni da confrontare", () => {
  it("sono tutte e due presenti nel repository, con tutti i loro file", () => {
    // Una funzione aggiunta all'elenco ma non alla cartella (o viceversa)
    // è il caso che lascerebbe una delle due copie senza controllo: ed è
    // successo che il controllo ne guardasse una sola.
    expect(FUNZIONI).toEqual(["google-token", "notifica-richiesta"]);
    // Ogni funzione con la sua lista di file: `google-token` sta in un file
    // solo, `notifica-richiesta` ha accanto a `index.ts` il `corpo.ts` che
    // costruisce la mail, ed è proprio quello che un confronto sul solo punto
    // d'ingresso lascerebbe fuori.
    const attesi: Record<string, string[]> = {
      "google-token": ["google-token/index.ts"],
      "notifica-richiesta": ["notifica-richiesta/corpo.ts", "notifica-richiesta/index.ts"],
    };
    for (const nome of FUNZIONI) {
      expect(Object.keys(leggiFunzione(nome)).sort()).toEqual(attesi[nome]);
    }
  });
});
