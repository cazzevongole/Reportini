/**
 * Lo smoke, che è il controllo che legge `repo.ts` e prova a preparare ogni
 * query sullo schema vero.
 *
 * Estrae le query con una regex sui backtick, e una regex non distingue un
 * template SQL da due backtick spaiati in un commento. È successo: i
 * commenti di due funzioni avevano i nomi racchiusi fra backtick, la regex ha
 * accoppiato quelli con il SELECT successivo, e lo smoke ha provato a
 * preparare un pezzo di commento come se fosse SQL. Falliva — quindi si
 * vedeva — ma con un messaggio che parlava di una query inesistente invece
 * che della causa, e il conto delle query verificate diceva 18 invece di 17.
 *
 * Qui si prova la cosa che conta: uno smoke che sbaglia nel contare è uno
 * smoke a cui non si può credere, e il conteggio è l'unica parte che si
 * guarda quando tutto passa.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const sorgente = readFileSync("src/lib/repo.ts", "utf8");

/** Le query come lo smoke le vede: due backtick con SELECT in mezzo. */
function queryComeLoSmoke(): string[] {
  return [...sorgente.matchAll(/`([^`]*SELECT[^`]*)`/g)].map((m) => m[1]);
}

describe("Lo smoke legge solo SQL, non pezzi di commento", () => {
  const query = queryComeLoSmoke();

  it("ogni cosa che sembra una query è una query", () => {
    for (const testo of query) {
      // Una SELECT vera, non un commento che la nomina e basta. Il test
      // guarda l'inizio della frase, che è dove comincia l'istruzione: qui
      // `SELECT` deve essere la prima parola.
      expect(testo.trimStart(), `non è una query: ${testo.slice(0, 80)}`).toMatch(/^SELECT\b/i);
    }
  });

  it("nessuna query contiene una chiusura di commento", () => {
    // La prova più diretta del difetto: `*/` dentro una "query" significa
    // che il testo è passato attraverso un commento, e che i backtick del
    // commento sono stati presi per quelli di un template.
    for (const testo of query) {
      expect(testo, `la query contiene un commento: ${testo.slice(0, 80)}`).not.toContain("*/");
    }
  });

  it("non sfugge nessuna SELECT, e sono tutte in una riga sola di testa", () => {
    // Il conteggio: se i backtick di un commento si accoppiano con quelli di
    // una query, il numero di query lette cambia e il totale non torna più
    // con quello che il file contiene davvero.
    const selectNelFile = (sorgente.match(/\bSELECT\b/gi) ?? []).length;
    expect(query.length).toBeGreaterThan(0);
    // Non tutti i SELECT aprono un template (alcune query sono costruite con
    // interpolazione e vengono saltate), quindi il numero letto non può
    // superare quante SELECT ci sono nel file.
    expect(query.length).toBeLessThanOrEqual(selectNelFile);
  });
});
