/**
 * L'applicazione dello schema su Supabase.
 *
 * Il file che viene eseguito dalla CI non è un semplice `cat`: è lo script
 * che garantisce che nessuno segreto finisca mai in un database, e in una
 * macchina che gira su ogni merge. Qui si prova la parte che può essere
 * provata senza rete — l'ordine dei file e i controlli sul testo — perché è
 * quella che decide se lo script esce prima di fare qualcosa.
 *
 * La rete non si prova: un test che chiama l'API di Supabase non
 * verificherebbe niente di quanto accade davvero, e su un fork il token non
 * c'è. Qui la rete è un finto che risponde quello che gli si dice di
 * rispondere, e si guarda che cosa lo script abbia provato a fare.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  FILE_SCHEMA,
  leggiSchema,
  problemiNelSql,
  promozioniNelSql,
  segretiNelSql,
  spiega,
} from "../scripts/migra-schema.mjs";

const RADICE = join(import.meta.dirname, "..");

/** Come si chiama un file di `supabase/`, per leggerlo dal repository. */
function sql(nome: string): string {
  return readFileSync(join(RADICE, "supabase", nome), "utf8");
}

describe("L'ordine in cui viene applicato lo schema", () => {
  it("il trigger viene dopo le tabelle su cui poggia", () => {
    // `notifica-richieste.sql` mette un trigger su `public.richieste`: se
    // arriva prima che la tabella esista, fallisce per un motivo che non
    // c'entra con il trigger, e l'errore dice "relation does not exist"
    // invece di "hai eseguito i file nel ordine sbagliato".
    const indiceTabelle = FILE_SCHEMA.indexOf("richieste.sql");
    const indiceTrigger = FILE_SCHEMA.indexOf("notifica-richieste.sql");
    expect(indiceTabelle).toBeGreaterThanOrEqual(0);
    expect(indiceTrigger).toBeGreaterThan(indiceTabelle);
  });

  it("il bucket viene prima di tutto il resto", () => {
    // Le RLS di `setup.sql` sono sul bucket: se non c'è ancora, la policy
    // viene creata su un oggetto che non esiste.
    expect(FILE_SCHEMA[0]).toBe("setup.sql");
  });

  it("i tre file esistono tutti", () => {
    // Uno script che legge un file che non c'è fallisce a metà applicazione,
    // con lo schema a metà: il caso peggiore, perché non è ripetibile.
    for (const nome of FILE_SCHEMA) {
      expect(() => sql(nome), `manca supabase/${nome}`).not.toThrow();
    }
  });

  it("legge esattamente i file dell'elenco", () => {
    const letti = leggiSchema().map((f) => f.nome);
    expect(letti).toEqual(FILE_SCHEMA);
    // E il contenuto è quello del file, non una versione in memoria.
    expect(letti[0]).toBe("setup.sql");
  });
});

describe("I segreti non passano da qui", () => {
  it("i file del repository non creano segreti attivi", () => {
    // È la condizione che rende sicuro eseguire questi file da una macchina
    // che ha i permessi di scrivere. Se un giorno qualcuno decomenta una
    // riga di Vault, questo test fallisce prima che lo faccia la CI.
    for (const nome of FILE_SCHEMA) {
      expect(segretiNelSql(sql(nome)), `supabase/${nome} ha una riga di segreto attiva`).toEqual(
        [],
      );
    }
  });

  it("una riga di Vault decomentata viene bloccata", () => {
    const pericoloso =
      "select vault.create_secret('https://x.supabase.co', 'notifica_richieste_url', 'x');";
    expect(segretiNelSql(pericoloso)).toHaveLength(1);
    expect(problemiNelSql("notifica-richieste.sql", pericoloso).join(" ")).toContain("segreto");
  });

  it("la stessa riga commentata passa, perché è il modo di documentarla", () => {
    // I due file spiegano i segreti da mettere a mano dentro commenti. Se
    // quello fosse un errore, i file di oggi non potrebbero neanche essere
    // letti senza toccarli.
    const commentata =
      "--   select vault.create_secret('https://{{REF}}.supabase.co', 'chiave', 'x');";
    expect(segretiNelSql(commentata)).toHaveLength(0);
    expect(problemiNelSql("notifica-richieste.sql", commentata)).toEqual([]);
  });

  it("leggere il Vault è ammesso, perché il trigger non funziona senza", () => {
    // Il trigger prende dal Vault la chiave da mettere nell'intestazione:
    // è il modo in cui il progetto tiene la chiave in un posto solo. Bloccare
    // anche la lettura romperebbe le notifiche, e non per evitare un guasto
    // che la lettura può causare. Qui il controllo si stringe a ciò che
    // scrive, ed è l'unico modo perché sia utile senza essere d'intralcio.
    const lettura =
      "select decrypted_secret from vault.decrypted_secrets where name = 'notifica_richieste_chiave';";
    expect(segretiNelSql(lettura)).toHaveLength(0);
    expect(problemiNelSql("notifica-richieste.sql", lettura)).toEqual([]);
  });

  it("una scrittura col nome di un segreto esistente viene bloccata", () => {
    // Il caso pericoloso vero: sovrascrivere la chiave vera. La riga non
    // contiene la parola "create_secret" ma scrive lo stesso, e senza
    // `create or replace` sul Vault il valore precedente è perso.
    const scrittura =
      "insert into vault.decrypted_secrets (name) values ('notifica_richieste_chiave');";
    expect(segretiNelSql(scrittura)).toHaveLength(1);
  });
});

describe("Chi è sviluppatore non si promuove da solo", () => {
  it("la riga che scrive nella tabella degli sviluppatori è bloccata", () => {
    // `public.sviluppatori` decide chi legge le richieste di tutti gli
    // utenti. È una riga sola, ed è volutamente commentata: se la CI la
    // eseguisse, chi apre una pull request deciderebbe chi vede i dati degli
    // altri, e il merge passerebbe inosservato. Questa è la ragione per cui
    // lo schema si applica automaticamente ma i permessi no.
    const promozione =
      "insert into public.sviluppatori (email) values ('nuovo@esempio.it') on conflict do nothing;";
    expect(promozioniNelSql(promozione)).toHaveLength(1);
    expect(problemiNelSql("richieste.sql", promozione).join(" ")).toContain("sviluppatori");
  });

  it("anche un update o un delete sono bloccati", () => {
    // Non basta vietare l'inserimento: un `update` sulla stessa tabella
    // cambierebbe il ruolo di qualcuno che già c'è, con la stessa
    // invisibilità di un merge.
    expect(promozioniNelSql("update public.sviluppatori set email = 'altro@x.it';")).toHaveLength(
      1,
    );
    expect(promozioniNelSql("delete from public.sviluppatori;")).toHaveLength(1);
  });

  it("la riga commentata passa, perché è il modo di documentarla", () => {
    const commentata = "-- insert into public.sviluppatori (email) values ('io@esempio.it');";
    expect(promozioniNelSql(commentata)).toHaveLength(0);
  });

  it("i file del repository non scrivono nella tabella", () => {
    for (const nome of FILE_SCHEMA) {
      expect(promozioniNelSql(sql(nome)), `supabase/${nome} promuove qualcuno`).toEqual([]);
    }
  });

  it("le tabelle delle richieste non vengono toccate: l'applicazione è schema, non dati", () => {
    // Applicare lo schema non deve poter creare né cancellare richieste: un
    // `delete from public.richieste` in un file di setup eliminerebbe le
    // richieste degli utenti a ogni merge, in silenzio.
    const cancellazione = "delete from public.richieste;";
    expect(cancellazione).toContain("richieste");
    // I file del repository non contengono scritture di dati sulle richieste.
    for (const nome of FILE_SCHEMA) {
      const attive = sql(nome)
        .split("\n")
        .filter((r) => !/^\s*--/.test(r))
        .filter((r) => /\b(delete\s+from|truncate)\b/i.test(r));
      expect(attive, `supabase/${nome} cancella dati`).toEqual([]);
    }
  });
});

describe("I segnaposto non vengono applicati", () => {
  it("un {{REF}} in una riga attiva blocca il file", () => {
    // `{{REF}}` è voluto nei commenti, dove spiega dove mettere il ref. In
    // una riga che gira, manderebbe le richieste all'indirizzo sbagliato: la
    // funzione risponderebbe e il trigger resterebbe attaccato a niente.
    const attivo = "select net.http_post(url := 'https://{{REF}}.supabase.co/f', body := '{}');";
    expect(problemiNelSql("notifica-richieste.sql", attivo).join(" ")).toContain("segnaposto");
  });

  it("i file del repository passano il controllo", () => {
    for (const nome of FILE_SCHEMA) {
      expect(problemiNelSql(nome, sql(nome)), `supabase/${nome} ha un problema`).toEqual([]);
    }
  });
});

describe("Un errore di Supabase spiega che cosa fare", () => {
  it("403 vuol dire che il token non può scrivere", () => {
    // Il caso più probabile: un token di sola lettura funziona per
    // `verifica-edge-function.mjs` e non per questo. Senza questa
    // spiegazione l'errore dice solo "403" e si cerca nel posto sbagliato.
    expect(spiega(new Error("l'API di Supabase ha risposto 403 Forbidden"))).toContain(
      "database:write",
    );
  });

  it("401 vuol dire che il token non è accettato", () => {
    expect(spiega(new Error("risposta 401 Unauthorized"))).toContain("scaduto");
  });

  it("un oggetto che esiste già dice che il file non è innocuo da rieseguire", () => {
    // I tre file devono poter essere riapplicati a ogni merge. Se uno dice
    // "already exists", vuol dire che ha un `create` senza `if not exists`,
    // e da quel momento ogni deploy successivo fallisce.
    expect(spiega(new Error('relation "richieste" already exists'))).toContain("rieseguire");
  });

  it("quello che non riconosce passa com'è", () => {
    expect(spiega(new Error("qualcosa di nuovo"))).toBe("qualcosa di nuovo");
  });
});

/**
 * I file che si dichiarano innocui da rieseguire devono esserlo davvero.
 *
 * Da quando lo schema si applica a ogni merge, "si può rieseguire" non è
 * una proprietà comoda: è il presupposto di tutto il meccanismo. Un file con
 * un `create` senza `if not exists` fallisce alla seconda esecuzione, cioè al
 * merge successivo, con un errore che riguarda una policy o una tabella e
 * non dice che il motivo è che il file è già stato eseguito una volta.
 *
 * Il caso reale: `richieste.sql` aveva `create policy` senza il `drop` che
 * `setup.sql` ha, ed è fallito con `42710` alla prima esecuzione in CI. Il
 * file non era mai stato rieseguito prima, perché prima non lo eseguiva
 * nessuno da solo.
 */
describe("I file si possono rieseguire", () => {
  /** Le policy che ogni file crea, per controllare che siano tolte prima. */
  function policyCreate(sql: string): string[] {
    return [...sql.matchAll(/create policy "(\w+)"/g)].map((m) => m[1]);
  }

  it("ogni policy creata viene prima tolta", () => {
    for (const nome of FILE_SCHEMA) {
      const testo = sql(nome);
      const create = policyCreate(testo);
      // Un file senza policy non ha niente da togliere: va bene così.
      for (const policy of create) {
        const tolta = new RegExp(`drop\\s+policy\\s+if\\s+exists\\s+"${policy}"`).test(testo);
        expect(
          tolta,
          `supabase/${nome} crea la policy "${policy}" senza toglierla prima: ` +
            "rieseguirlo fallirebbe con 42710",
        ).toBe(true);
      }
    }
  });

  it("nessuna tabella viene creata senza 'if not exists'", () => {
    for (const nome of FILE_SCHEMA) {
      // Le righe commentate si contano solo se parlano di `create table` in
      // un commento che spiega la guardia: sono il modo in cui questi file
      // documentano perché la riscrivono. Contarle sarebbe leggere la
      // documentazione come se fosse codice.
      const testo = sql(nome)
        .split("\n")
        .filter((r) => !/^\s*--/.test(r))
        .join("\n");
      const crea = [...testo.matchAll(/create table (if not exists )?(\w+)/g)];
      for (const [, guardia, tabella] of crea) {
        // Le tabelle di Supabase (`storage.objects`) sono create dal
        // provider, non dal progetto: non c'è `if not exists` possibile.
        if (tabella.startsWith("storage.")) continue;
        expect(guardia, `supabase/${nome} crea "${tabella}" senza if not exists`).toBeTruthy();
      }
    }
  });

  it("nessuna funzione viene creata senza 'or replace'", () => {
    for (const nome of FILE_SCHEMA) {
      const testo = sql(nome);
      const crea = [...testo.matchAll(/create (or replace )?function (\w+)/g)];
      for (const [, guardia, funzione] of crea) {
        expect(
          guardia,
          `supabase/${nome} crea la funzione "${funzione}" senza or replace`,
        ).toBeTruthy();
      }
    }
  });
});
