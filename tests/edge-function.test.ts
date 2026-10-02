/**
 * Le Edge Function pubblicate sono una seconda copia del codice che sta qui, e
 * nessuna delle due avvisa l'altra quando divergono. Il caso in cui è
 * successo: dopo il passaggio a reportini.cazzevongole.com il repository aveva
 * l'origine nuova e la funzione pubblicata no, quindi il login con Google si è
 * fermato senza dire perché.
 *
 * E il caso in cui il controllo che doveva accorgersene non ha funzionato: per
 * mesi è passato verde senza confrontare nulla, perché interrogava un endpoint
 * che non risponde in JSON e trattava l'errore come se la funzione non fosse
 * raggiungibile. Qui si prova il meccanismo nuovo, che è l'hash registrato dal
 * deploy: la rete non la si tocca in un test.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { FUNZIONI, confronta, hashDi } from "../scripts/verifica-edge-function.mjs";
import {
  FUNZIONI as DA_PUBBLICARE,
  hashFunzione,
  leggiFile,
} from "../scripts/deploya-edge-function.mjs";

const SORGENTE = readFileSync("supabase/functions/google-token/index.ts", "utf8");
const HASH = "a".repeat(64);
/** I due hash del repository, per non dipendere dal contenuto reale dei file. */
const LOCALE = { "google-token": HASH, "notifica-richiesta": "b".repeat(64) };

describe("Il confronto delle Edge Function", () => {
  it("non segnala nulla quando i due hash coincidono", () => {
    expect(confronta(LOCALE, LOCALE)).toEqual([]);
  });

  it("segnala una funzione mai pubblicata da questo repository", () => {
    // `confronta` restituisce righe, non problemi: un problema è il titolo più
    // le righe che spiegano cosa fare. Quindi si conta sui titoli, che sono
    // quelli che iniziano per "la funzione".
    const problemi = confronta(LOCALE, { "google-token": HASH });
    const titoli = problemi.filter((r) => r.startsWith("la funzione"));
    expect(titoli).toHaveLength(1);
    expect(titoli[0]).toContain("non risulta mai stata pubblicata");
    // Il messaggio deve dire come si risolve: un controllo che segnala un
    // problema senza indicare il comando è un controllo che si impara a
    // ignorare. I due comandi sono quelli giusti: prima si pubblica con la CLI,
    // poi si registra l'hash, che è il secondo passo di cui si parla nella
    // sezione "Le Edge Function" del README.
    const testo = problemi.join("\n");
    expect(testo).toContain("supabase functions deploy");
    expect(testo).toContain("--registra");
  });

  it("segnala un codice diverso e dice come procedere", () => {
    const diverso = { ...LOCALE, "google-token": "c".repeat(64) };
    const problemi = confronta(LOCALE, diverso);
    expect(problemi.length).toBeGreaterThan(0);
    const testo = problemi.join("\n");
    expect(testo).toContain("non è allineata");
    expect(testo).toContain("pubblica la funzione");
    // I due hash devono comparire entrambi: senza i due valori chi legge il
    // log non può nemmeno dire se il problema è recente.
    expect(testo).toContain(HASH.slice(0, 16));
    expect(testo).toContain("c".repeat(16));
  });

  it("segnala tutte le funzioni disallineate, non solo la prima", () => {
    // Il caso reale: due funzioni indietro di varie release, e un controllo
    // che ne segnala una lascia l'altra in pace per settimane.
    const problemi = confronta(LOCALE, { "google-token": "c".repeat(64) });
    const titoli = problemi.filter((r) => r.startsWith("la funzione"));
    // Una disallineata (l'hash diverso) e una mai pubblicata.
    expect(titoli).toHaveLength(2);
    expect(titoli.some((t) => t.includes("non è allineata"))).toBe(true);
    expect(titoli.some((t) => t.includes("non risulta mai stata pubblicata"))).toBe(true);
  });

  it("non segnala nulla se non gli si dice nulla", () => {
    // `pubblicati` arriva dal database e può non esserci: una tabella vuota
    // non deve diventare un'allerta.
    const problemi = confronta({}, {});
    expect(problemi).toEqual([]);
  });

  it("l'hash del repository è quello che il deploy calcola davvero", () => {
    // Le due copie del calcolo devono dare lo stesso risultato sullo stesso
    // file: è il confronto stesso a dipenderne, e se divergessero misurerebbe
    // una cosa mentre il deploy ne pubblica un'altra.
    const dalDeploy = hashFunzione([{ percorso: "index.ts", contenuto: Buffer.from(SORGENTE) }]);
    expect(dalDeploy).toMatch(/^[0-9a-f]{64}$/);
    expect(hashDi("google-token")).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("L'hash di una funzione", () => {
  const file = (percorso: string, testo: string) => ({
    percorso,
    contenuto: Buffer.from(testo),
  });

  it("cambia se cambia il contenuto di un file", () => {
    const a = hashFunzione([file("index.ts", "export const x = 1;\n")]);
    const b = hashFunzione([file("index.ts", "export const x = 2;\n")]);
    expect(a).not.toBe(b);
  });

  it("cambia se un file viene aggiunto", () => {
    // È il caso reale di `notifica-richiesta`: `corpo.ts` è nato dopo
    // `index.ts` e contiene metà della logica. Un hash che ignorasse i file
    // nuovi direbbe che la funzione è allineata mentre metà del codice non è
    // mai stato pubblicato.
    const solo = hashFunzione([file("index.ts", "export const x = 1;\n")]);
    const conCipo = hashFunzione([
      file("index.ts", "export const x = 1;\n"),
      file("corpo.ts", "export const y = 2;\n"),
    ]);
    expect(solo).not.toBe(conCipo);
  });

  it("cambia se un file cambia nome, anche con lo stesso contenuto", () => {
    // Altrimenti uno scambio fra due file gemelli passerebbe inosservato: gli
    // hash coinciderebbero mentre la funzione gira con i file scambiati.
    const a = hashFunzione([file("corpo.ts", "export const y = 2;\n")]);
    const b = hashFunzione([file("altro.ts", "export const y = 2;\n")]);
    expect(a).not.toBe(b);
  });

  it("non cambia per i fine riga", () => {
    // Su Windows il file del repository è CRLF e su Supabase no: senza
    // questa normalizzazione ogni sviluppatore su Windows produrrebbe un hash
    // diverso per lo stesso codice, e il controllo segnalerebbe un problema
    // che non esiste.
    const lf = hashFunzione([file("index.ts", "const a = 1;\nconst b = 2;\n")]);
    const crlf = hashFunzione([file("index.ts", "const a = 1;\r\nconst b = 2;\r\n")]);
    expect(lf).toBe(crlf);
  });

  it("non dipende dall'ordine in cui i file vengono passati", () => {
    const a = hashFunzione([file("index.ts", "1"), file("corpo.ts", "2")]);
    const b = hashFunzione([file("corpo.ts", "2"), file("index.ts", "1")]);
    expect(a).toBe(b);
  });

  it("è un sha256 in esadecimale", () => {
    expect(hashFunzione([file("index.ts", "x")])).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("Le funzioni da confrontare e da pubblicare", () => {
  it("sono le stesse da entrambi i lati, ognuna con tutti i suoi file", () => {
    // Una funzione nell'elenco del deploy ma non in quello del confronto (o
    // viceversa) è una copia senza controllo. Le due liste sono derivate
    // dallo stesso elenco, quindi non possono divergere: è il motivo per cui
    // qui basta guardare la lista una volta.
    expect(FUNZIONI).toEqual(["google-token", "notifica-richiesta"]);

    // Ogni funzione con i suoi file, e i file sono quelli della cartella: un
    // hash calcolato su un elenco di file scritto a mano lascerebbe fuori
    // `corpo.ts`, che è metà della logica di `notifica-richiesta`.
    const attesi: Record<string, string[]> = {
      "google-token": ["index.ts"],
      "notifica-richiesta": ["corpo.ts", "index.ts"],
    };
    for (const funzione of DA_PUBBLICARE) {
      const percorso = `supabase/functions/${funzione.nome}`;
      expect(
        leggiFile(funzione.nome).map((f) => f.percorso),
        funzione.nome,
      ).toEqual(attesi[funzione.nome]);
      expect(hashDi(funzione.nome), percorso).toMatch(/^[0-9a-f]{64}$/);
    }
  });
});

describe("Le funzioni da pubblicare", () => {
  it("sono pubblicate senza verifica del JWT, come sono oggi", () => {
    // È il parametro che un deploy può dimenticare, e dimenticarlo costa un
    // 401 su ogni chiamata: le funzioni le chiama `pg_net` dal database, che
    // non ha un token di sessione da mostrare. La difesa è che il valore sia
    // scritto qui e che un test lo guardi, non che qualcuno se ne ricordi al
    // prossimo deploy.
    for (const f of DA_PUBBLICARE) {
      expect(f.verify_jwt, f.nome).toBe(false);
    }
  });

  it("dicono quale file è il punto d'ingresso, e quel file esiste", () => {
    for (const f of DA_PUBBLICARE) {
      expect(f.entrypoint, f.nome).toBe("index.ts");
      const file = leggiFile(f.nome).map((x) => x.percorso);
      expect(file, f.nome).toContain(f.entrypoint);
    }
  });
});
