/**
 * `supabase/deploy.sql` crea la tabella in cui il deploy delle Edge Function
 * registra l'hash del codice che ha pubblicato.
 *
 * È una tabella piccola e quasi senza logica, ma le sue due proprietà sono
 * tutto ciò su cui si regge il controllo di allineamento fra il codice del
 * repository e quello che gira, quindi sono testati da sole.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const SQL = readFileSync("supabase/deploy.sql", "utf8");

describe("La tabella delle Edge Function pubblicate", () => {
  it("registra il nome della funzione e l'hash, e non è scrivibile da un client", () => {
    expect(SQL).toContain("create table if not exists public.edge_function_deploy");
    expect(SQL).toMatch(/nome\s+text\s+primary key/);
    // `char(64)` e non `text`: un sha256 è lungo 64 caratteri, e il vincolo
    // rende impossibile registrare un hash troncato o troppo corto senza
    // accorgersene.
    expect(SQL).toMatch(/codice_sha256\s+char\(64\)\s+not null/);
    // Senza `if not exists` rieseguire il file fallirebbe, e il file viene
    // rieseguito a ogni push.
    expect(SQL).not.toMatch(/create table public\.edge_function_deploy/);
  });

  it("non è leggibile con le chiavi pubbliche", () => {
    // La tabella dice quale codice è online: leggere quella riga da un client
    // non è un furto di segreti, ma è un posto dove non deve stare nulla che
    // un browser possa vedere. Come `sviluppatori`, RLS attiva e nessuna
    // policy: solo la CI, che ha i permessi del proprietario, la usa.
    expect(SQL).toMatch(/alter table public\.edge_function_deploy enable row level security/);
    expect(SQL).toMatch(
      /revoke all on table public\.edge_function_deploy from anon, authenticated/,
    );
    // Una policy di lettura aprirebbe la tabella al pubblico.
    expect(SQL).not.toMatch(/create policy/i);
  });

  it("non contiene segreti né segnaposto attivi", () => {
    // La stessa guardia che `migra-schema.mjs` applica a ogni file: questa
    // tabella viene scritta dalla CI, e una chiave qui finirebbe in un secret
    // di GitHub, che è il posto da cui il progetto tiene fuori le chiavi.
    expect(SQL).not.toMatch(/vault\.create_secret/i);
    expect(SQL).not.toMatch(/insert into\s+public\./i);
    // Le uniche `insert` che il progetto contiene sono esempi commentati, e
    // questo file non deve averne: qui scrive solo la CI.
    expect(SQL).not.toMatch(/^\s*insert\s/im);
  });

  it("ha le colonne che il deploy e il confronto usano", () => {
    // I due script parlano con il database per nome: se una colonna cambia
    // qui e non lì, la query fallisce in produzione e non in un test.
    for (const colonna of ["nome", "codice_sha256"]) {
      expect(SQL, colonna).toContain(colonna);
    }
  });
});
