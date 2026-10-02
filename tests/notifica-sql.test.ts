/**
 * Lo script SQL della notifica si esegue a mano, incollato nella console di
 * Supabase, e nessuno lo rilegge prima: è codice che il repository non
 * esegue mai. Quello che non gira da solo è anche quello che non ha un
 * errore all'istante, e i due problemi che sono costati più tempo sono
 * passati entrambi da qui senza dire una parola.
 *
 * Il primo è stato mettere le intestazioni dentro `params`, che in `pg_net` è
 * l'elenco dei parametri che vengono appesi alla URL: la chiave è finita
 * nell'indirizzo della richiesta, l'intestazione non è partita, e la funzione
 * ha risposto `401` a ogni tentativo. Il secondo è un ref scritto a mano,
 * che è un ref che prima o poi qualcuno sbaglia.
 *
 * Qui si controlla il testo, non il comportamento: eseguire qui questo
 * script richiederebbe un Postgres vero con il Vault dentro.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const SQL = readFileSync("supabase/notifica-richieste.sql", "utf8");
const FUNZIONE = readFileSync("supabase/functions/notifica-richiesta/index.ts", "utf8");

describe("L'indirizzo della funzione", () => {
  it("è un segnaposto, non un ref scritto a mano", () => {
    // Un ref nel repository è un ref che prima o poi è quello di un altro
    // progetto, e l'effetto è un `401` che non dice nulla. Il segnaposto
    // `{{REF}}` invece è falso per definizione: se qualcuno lo usa senza
    // sostituirlo, la chiave non arriva e la richiesta non parte.
    const indirizzi = SQL.match(/https:\/\/[^'\s`]*supabase\.co/g) ?? [];
    expect(indirizzi.length).toBeGreaterThan(0);
    for (const indirizzo of indirizzi) {
      expect(indirizzo).toBe("https://{{REF}}.supabase.co");
    }
  });

  it("dice dove si trova il ref da mettere al posto del segnaposto", () => {
    // Un segnaposto che non si sa sostituire è solo un altro modo di sbagliare.
    expect(SQL).toContain("va sostituito con il reference del progetto");
  });
});

describe("La chiamata al database", () => {
  it("manda le intestazioni nell'argomento giusto", () => {
    // `net.http_post(url, body, params, headers, timeout)`: `params` sono i
    // parametri che finiscono nella query string della URL, `headers` sono le
    // intestazioni. Sono due argomenti consecutivi che si somigliano, e
    // confonderli non dà nessun errore: la richiesta parte e arriva senza
    // la chiave.
    expect(SQL).toMatch(/headers := jsonb_build_object\(/);
    expect(SQL).not.toMatch(/params\s*:?=/);
  });

  it("mette la chiave fra le intestazioni, non nel corpo", () => {
    // Nel corpo la chiave finirebbe insieme ai dati della richiesta, che
    // finiscono in `net._http_response` e nei log di Resend.
    const intestazioni = SQL.match(/headers := jsonb_build_object\(([^)]*)\)/)?.[1] ?? "";
    expect(intestazioni).toContain("'x-reportini-notifica'");
  });
});

describe("Le due metà della notifica", () => {
  it("usano lo stesso nome di intestazione", () => {
    // Le due cose che devono accordarsi e non hanno un posto dove accordarsi
    // da sole: il trigger la manda, la funzione la cerca. Un nome diverso
    // fra le due è un `401` e basta, per sempre.
    const nome = FUNZIONE.match(/INTESTAZIONE_CHIAVE = "([^"]+)"/)?.[1];
    expect(nome).toBeTruthy();
    expect(SQL).toContain(`'${nome}'`);
  });

  it("installano i trigger con create or replace, senza duplicarli", () => {
    // `create or replace trigger` sostituisce solo il trigger con lo stesso
    // nome. Un `create trigger` con un altro nome lascia il precedente
    // attaccato, e da quel momento ogni richiesta produce due mail.
    //
    // Sono due trigger e non uno, perché sono due eventi: l'inserimento avvisa
    // gli sviluppatori, il passaggio a "risolta" avvisa l'utente. Il numero
    // che conta è che ciascuno abbia un nome suo e nessuno ne abbia due.
    const trigger = SQL.match(/^create or replace trigger (\w+)/gm) ?? [];
    expect(trigger).toHaveLength(2);
    const nomi = trigger.map((riga) => riga.split(" ").pop());
    expect(new Set(nomi).size).toBe(2);
    expect(SQL).not.toMatch(/^\s*create trigger/m);
  });

  it("la chiusura parte solo quando lo stato cambia, non a ogni modifica", () => {
    // Il trigger è su `update`, e un `update` c'è anche quando lo sviluppatore
    // salva la risposta senza cambiare stato: correggere un refuso manderebbe
    // all'utente una mail di chiusura ogni volta. La condizione `when` è
    // ciò che distingue "l'ho risolta adesso" da "sto risolvendo".
    const quando = SQL.match(
      /create or replace trigger richieste_avviso_chiusura[\s\S]*?when \(([\s\S]*?)\)[\s\S]*?execute function/,
    );
    expect(quando?.[1]).toContain("new.stato = 'risolta'");
    // `is distinct from` e non `<>`: con `old.stato` null il confronto darebbe
    // null e il trigger non partirebbe mai per le richieste senza stato
    // precedente, cioè tutte.
    expect(quando?.[1]).toContain("old.stato is distinct from 'risolta'");
  });

  it("la chiusura manda la risposta, che è il contenuto della mail", () => {
    // Se `risposta` manca dal corpo, l'utente riceve una mail che dice solo
    // che la richiesta è stata chiusa, cioè la notizia che già sapeva e
    // nessuna delle cose che gli servono.
    const funzione = SQL.slice(SQL.indexOf("manda_avviso_chiusura"));
    const corpo = funzione.match(/body := jsonb_build_object\(([\s\S]*?)\);/)?.[1] ?? "";
    expect(corpo).toContain("'modo', 'chiusura'");
    expect(corpo).toContain("'risposta', new.risposta");
  });

  it("le due mail si distinguono per il modo che dichiarano", () => {
    // È il campo su cui la Edge Function sceglie a chi scrivere: senza, il
    // trigger di chiusura manderebbe la mail d'avviso agli sviluppatori
    // invece che la risposta all'utente che l'ha scritta.
    expect(SQL).toContain("'modo', 'nuova'");
    expect(SQL).toContain("'modo', 'chiusura'");
  });
});
