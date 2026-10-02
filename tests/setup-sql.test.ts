/**
 * Lo script di setup si esegue una volta sola, a mano, incollato nella console
 * SQL di Supabase: il repository non lo esegue mai e nessuno lo rilegge prima.
 * È anche l'unico file che decide chi può leggere il database degli altri.
 *
 * Le quattro Row Level Security in `setup.sql` sono il muro fra un utente e il
 * database di tutti gli altri, e il muro è una riga di confronto:
 *
 *     (storage.foldername(name))[1] = auth.uid()::text
 *
 * Quel muro tiene solo se l'app scrive davvero il file sotto `<id-utente>/`, e
 * `percorso()` in `src/lib/cloud/sync.ts` lo fa: `${userId}/${nome}`. I due
 * lati non si vedono mai insieme — uno è TypeScript, l'altro è SQL eseguito a
 * mano — quindi il confronto che li tiene insieme è qui.
 *
 * Se i due si disaccordano succede una delle due cose, ed entrambe sono
 * invisibili da fuori: il caricamento smette di funzionare per tutti
 * (`access_denied` su un upload che sembra andare), oppure — se il percorso
 * cambiasse mettendo l'id più in fondo — il controllo continuerebbe a passare
 * per un motivo sbagliato, che è il caso per cui il muro va scritto come
 * confronta il primo segmento e non l'ultimo.
 *
 * Qui si controlla il testo, non il comportamento: eseguire questo script
 * richiederebbe un progetto Supabase vero.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const SQL = readFileSync("supabase/setup.sql", "utf8");
const SYNC = readFileSync("src/lib/cloud/sync.ts", "utf8");

/** Le quattro operazioni che l'app usa sul bucket, e le quattro policy che le coprono. */
const COMANDI = ["select", "insert", "update", "delete"] as const;

describe("Il bucket", () => {
  it("è quello su cui l'app scrive", () => {
    // Il nome è in due posti che non si vedono: la costante in sync.ts e
    // l'insert in setup.sql. Se cambiasse uno solo dei due, l'app scriverebbe
    // in un bucket che non esiste e l'errore sarebbe un 400 su ogni upload.
    const nelCodice = SYNC.match(/const BUCKET = "([^"]+)"/)?.[1];
    expect(nelCodice).toBeTruthy();
    expect(SQL).toContain(`select '${nelCodice}', '${nelCodice}', false`);
  });

  it("è privato", () => {
    // `public = true` metterebbe il database di ogni utente in chiaro per
    // chiunque abbia l'indirizzo, e le RLS sotto non servirebbero a niente:
    // si applicano alle richieste firmate, non a un download anonimo.
    expect(SQL).toMatch(/insert into storage\.buckets[\s\S]*?false/);
    expect(SQL).not.toMatch(/insert into storage\.buckets[\s\S]*?,\s*true\s*\)?;/);
  });
});

describe("Il percorso del file", () => {
  it("è `<id-utente>/<nome>`, col nome del file dentro una cartella", () => {
    // È la forma che le policy confrontano: il primo segmento del percorso
    // deve essere l'id, perché è quello che le policy leggono.
    expect(SYNC).toMatch(
      /function percorso\(userId: string, nome: string\): string \{[\s\S]*?\$\{userId\}\/\$\{nome\}/,
    );
  });

  it("è l'id dell'utente, non l'email", () => {
    // Il bucket è ragionato sull'id e l'id è ciò che `auth.uid()` restituisce.
    // Scrivere nell'email qui non romperebbe niente in fase di scrittura: lo
    // romperebbe al primo caricamento, quando la policy cerca l'id in un
    // percorso che non lo contiene.
    const id = SYNC.match(/userId|user\.id/);
    expect(id).toBeTruthy();
    expect(SYNC).not.toMatch(/percorso\([^)]*email/i);
  });
});

describe("Le Row Level Security", () => {
  it("sono una per operazione, tutte sul bucket giusto", () => {
    // Una policy che manca non è un errore: è un'operazione che torna
    // `permission denied` a un utente che ha ogni diritto di farla, e
    // l'app lo legge come un guasto del cloud.
    for (const comando of COMANDI) {
      // Fino al `;` che chiude l'istruzione: il confronto col bucket sta
      // nel corpo della policy, non nella sua intestazione.
      const policy = SQL.match(
        new RegExp(`create policy "reportini_${comando}"[\\s\\S]*?for ${comando}\\b[\\s\\S]*?;`),
      );
      expect(policy, `manca la policy reportini_${comando}`).toBeTruthy();
      expect(policy?.[0]).toContain("bucket_id = 'reportini'");
    }
  });

  it("confrontano il primo segmento del percorso con l'utente autenticato", () => {
    // Il cuore del muro. `(storage.foldername(name))[1]` è l'id; l'indice `[1]`
    // è la parte che non si può toccare: con l'ultimo segmento il confronto
    // continuerebbe a passare anche se il file non fosse nella cartella
    // dell'utente che lo sta leggendo.
    const confronti = SQL.match(/\(storage\.foldername\(name\)\)\[1\]\s*=\s*auth\.uid\(\)::text/g);
    expect(confronti?.length ?? 0).toBeGreaterThanOrEqual(COMANDI.length);
    expect(SQL).not.toMatch(/storage\.foldername\(name\)\)\[2\]/);
  });

  it("coprono l'update anche in scrittura", () => {
    // L'app risincronizza con un upsert: senza il `with check` la policy
    // controlla da dove arriva la riga ma non dove va a finire, e un utente
    // potrebbe scrivere fuori dalla propria cartella. È l'unico modo in cui
    // `update` si distingue da `insert` dentro una policy.
    const update = SQL.match(/create policy "reportini_update"[\s\S]*?;/)?.[0];
    expect(update).toContain("using (");
    expect(update).toContain("with check (");
  });

  it("si applicano agli utenti autenticati, non agli anonimi", () => {
    // `to anon` aprirebbe il bucket a chi non ha un account, che è
    // esattamente la condizione che il resto dell'app impedisce.
    expect(SQL).toContain("to authenticated");
    expect(SQL).not.toMatch(/to anon/);
  });

  it("sono ricreabili, perché lo script si riesegue", () => {
    // Il file si dichiara idempotente e lo è solo se prima di creare le
    // policy le toglie: senza il drop, il secondo giro si ferma sul primo
    // `create policy` che trova il nome già preso.
    for (const comando of COMANDI) {
      expect(SQL).toContain(`drop policy if exists "reportini_${comando}"`);
    }
  });
});

describe("La verifica in fondo", () => {
  it("controlla le quattro policy, non solo il bucket", () => {
    // È la query che l'utente legge per credere che sia andato tutto bene.
    // Se lista solo il bucket, dice "tutto a posto" anche quando le policy
    // non ci sono, ed è l'unico riscontro che esiste.
    const query = SQL.slice(SQL.lastIndexOf("select 'bucket'"));
    expect(query).toContain("policyname like 'reportini%'");
    expect(query).toContain("pg_policies");
  });
});
