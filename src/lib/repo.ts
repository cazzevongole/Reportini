import { all, get, insert, notifyChange, run, update, type SqlValue } from "./sqlite/engine";
import type {
  Anagrafico,
  AnagraficoConTotali,
  Appuntamento,
  AppuntamentoDettagliato,
  Relazione,
  RelazioneDettagliata,
} from "./types";

const now = () => new Date().toISOString();

export function nomeCompleto(a: Pick<Anagrafico, "nome" | "cognome">): string {
  return `${a.nome} ${a.cognome}`.trim();
}

export function iniziali(a: Pick<Anagrafico, "nome" | "cognome">): string {
  const parti = `${a.nome} ${a.cognome}`.trim().split(/\s+/);
  const primo = parti[0]?.[0] ?? "?";
  const ultimo = parti.length > 1 ? parti[parti.length - 1][0] ?? "" : "";
  return (primo + ultimo).toUpperCase();
}

/* -------------------------------- Anagrafici ------------------------------ */

export function elencaAnagrafici(ricerca = ""): AnagraficoConTotali[] {
  const termine = `%${ricerca.trim()}%`;
  return all<AnagraficoConTotali>(
    `SELECT a.*,
       (SELECT COUNT(*) FROM relazioni r WHERE r.anagraficoId = a.id) AS numRelazioni,
       (SELECT COUNT(*) FROM appuntamenti p WHERE p.anagraficoId = a.id) AS numAppuntamenti
     FROM anagrafici a
     WHERE ? = '%%'
        OR a.nome LIKE ? OR a.cognome LIKE ? OR a.documento LIKE ?
        OR a.citta LIKE ? OR a.email LIKE ? OR a.telefono LIKE ?
     ORDER BY a.cognome COLLATE NOCASE, a.nome COLLATE NOCASE`,
    [termine, termine, termine, termine, termine, termine, termine],
  );
}

export function ottieniAnagrafico(id: number): AnagraficoConTotali | null {
  return get<AnagraficoConTotali>(
    `SELECT a.*,
       (SELECT COUNT(*) FROM relazioni r WHERE r.anagraficoId = a.id) AS numRelazioni,
       (SELECT COUNT(*) FROM appuntamenti p WHERE p.anagraficoId = a.id) AS numAppuntamenti
     FROM anagrafici a WHERE a.id = ?`,
    [id],
  );
}

export type AnagraficoInput = Omit<Anagrafico, "id" | "createdAt" | "updatedAt">;

function valoriAnagrafico(data: AnagraficoInput) {
  return {
    nome: data.nome.trim(),
    cognome: data.cognome.trim(),
    documento: data.documento.trim().toUpperCase(),
    dataNascita: data.dataNascita || null,
    sesso: data.sesso,
    nazionalita: data.nazionalita.trim(),
    indirizzo: data.indirizzo.trim(),
    citta: data.citta.trim(),
    cap: data.cap.trim(),
    provincia: data.provincia.trim(),
    telefono: data.telefono.trim(),
    email: data.email.trim(),
    note: data.note.trim(),
    updatedAt: now(),
  };
}

export function creaAnagrafico(data: AnagraficoInput): number {
  const timestamp = now();
  return insert("anagrafici", {
    ...valoriAnagrafico(data),
    createdAt: timestamp,
    updatedAt: timestamp,
  });
}

export function aggiornaAnagrafico(id: number, data: AnagraficoInput): void {
  update("anagrafici", id, valoriAnagrafico(data));
}

/**
 * Cosa verrebbe eliminato insieme all'anagrafica: le relazioni (in
 * cascata) e gli appuntamenti che, senza la persona, resterebbero senza
 * nessun riferimento. Serve alla conferma prima di cancellare: nessuno
 * deve scoprire dopo che un appuntamento è sparito.
 */
export function effettoEliminazioneAnagrafica(id: number): {
  relazioni: number;
  appuntamenti: number;
} {
  return {
    relazioni:
      get<{ n: number }>("SELECT COUNT(*) AS n FROM relazioni WHERE anagraficoId = ?", [id])
        ?.n ?? 0,
    appuntamenti:
      get<{ n: number }>(
        `SELECT COUNT(*) AS n FROM appuntamenti
          WHERE anagraficoId = ?
             OR relazioneId IN (SELECT id FROM relazioni WHERE anagraficoId = ?)`,
        [id, id],
      )?.n ?? 0,
  };
}

export function eliminaAnagrafico(id: number): void {
  // Prima gli appuntamenti, poi l'anagrafica: così la cascata sulle
  // relazioni non può lasciare appuntamenti appesi a un riferimento che
  // non esiste più, che sulle altre pagine resterebbero visibili come righe
  // senza nome.
  run(
    `DELETE FROM appuntamenti
      WHERE anagraficoId = ?
         OR relazioneId IN (SELECT id FROM relazioni WHERE anagraficoId = ?)`,
    [id, id],
  );
  run("DELETE FROM anagrafici WHERE id = ?", [id]);
}

/* --------------------------------- Relazioni ------------------------------ */

export function elencaRelazioni(filtro: {
  anagraficoId?: number | null;
  stato?: string | null;
  ricerca?: string;
} = {}): RelazioneDettagliata[] {
  const condizioni: string[] = [];
  const parametri: Array<string | number> = [];
  if (filtro.anagraficoId) {
    condizioni.push("r.anagraficoId = ?");
    parametri.push(filtro.anagraficoId);
  }
  if (filtro.stato) {
    condizioni.push("r.stato = ?");
    parametri.push(filtro.stato);
  }
  if (filtro.ricerca?.trim()) {
    condizioni.push(
      "(r.titolo LIKE ? OR r.tipo LIKE ? OR r.contenuto LIKE ? OR a.nome LIKE ? OR a.cognome LIKE ?)",
    );
    const termine = `%${filtro.ricerca.trim()}%`;
    parametri.push(termine, termine, termine, termine, termine);
  }
  const where = condizioni.length ? `WHERE ${condizioni.join(" AND ")}` : "";
  return all<RelazioneDettagliata>(
    `SELECT r.*, a.nome AS anagraficoNome, a.cognome AS anagraficoCognome,
            a.documento AS anagraficoDocumento
     FROM relazioni r JOIN anagrafici a ON a.id = r.anagraficoId
     ${where}
     ORDER BY r.data DESC, r.id DESC`,
    parametri,
  );
}

export function ottieniRelazione(id: number): RelazioneDettagliata | null {
  return get<RelazioneDettagliata>(
    `SELECT r.*, a.nome AS anagraficoNome, a.cognome AS anagraficoCognome,
            a.documento AS anagraficoDocumento
     FROM relazioni r JOIN anagrafici a ON a.id = r.anagraficoId
     WHERE r.id = ?`,
    [id],
  );
}

export type RelazioneInput = Omit<Relazione, "id" | "createdAt" | "updatedAt">;

function valoriRelazione(data: RelazioneInput) {
  return {
    anagraficoId: data.anagraficoId,
    titolo: data.titolo.trim(),
    tipo: data.tipo.trim(),
    stato: data.stato,
    contenuto: data.contenuto,
    data: data.data,
    updatedAt: now(),
  };
}

export function creaRelazione(data: RelazioneInput): number {
  const timestamp = now();
  return insert("relazioni", {
    ...valoriRelazione(data),
    createdAt: timestamp,
    updatedAt: timestamp,
  });
}

export function aggiornaRelazione(id: number, data: RelazioneInput): void {
  update("relazioni", id, valoriRelazione(data));
}

/**
 * Appuntamenti che, cancellando la relazione, perderebbero l'ultimo
 * riferimento: hanno la relazione ma non una persona. Quelli che hanno
 * anche l'anagrafica restano: la persona esiste ancora.
 */
export function effettoEliminazioneRelazione(id: number): { appuntamenti: number } {
  return {
    appuntamenti:
      get<{ n: number }>(
        "SELECT COUNT(*) AS n FROM appuntamenti WHERE relazioneId = ? AND anagraficoId IS NULL",
        [id],
      )?.n ?? 0,
  };
}

export function eliminaRelazione(id: number): void {
  run("DELETE FROM appuntamenti WHERE relazioneId = ? AND anagraficoId IS NULL", [id]);
  run("DELETE FROM relazioni WHERE id = ?", [id]);
}

/* ------------------------------- Appuntamenti ---------------------------- */

export function elencaAppuntamenti(filtro: {
  da?: string | null;
  a?: string | null;
  anagraficoId?: number | null;
} = {}): AppuntamentoDettagliato[] {
  const condizioni: string[] = [];
  const parametri: Array<string | number> = [];
  if (filtro.da) {
    condizioni.push("p.inizio >= ?");
    parametri.push(filtro.da);
  }
  if (filtro.a) {
    condizioni.push("p.inizio <= ?");
    parametri.push(filtro.a);
  }
  if (filtro.anagraficoId) {
    condizioni.push("p.anagraficoId = ?");
    parametri.push(filtro.anagraficoId);
  }
  const where = condizioni.length ? `WHERE ${condizioni.join(" AND ")}` : "";
  return all<AppuntamentoDettagliato>(
    `SELECT p.*, a.nome AS anagraficoNome, a.cognome AS anagraficoCognome,
            a.documento AS anagraficoDocumento, r.titolo AS relazioneTitolo
     FROM appuntamenti p
     LEFT JOIN anagrafici a ON a.id = p.anagraficoId
     LEFT JOIN relazioni r ON r.id = p.relazioneId
     ${where}
     ORDER BY p.inizio ASC`,
    parametri,
  );
}

export function ottieniAppuntamento(id: number): AppuntamentoDettagliato | null {
  return get<AppuntamentoDettagliato>(
    `SELECT p.*, a.nome AS anagraficoNome, a.cognome AS anagraficoCognome,
            a.documento AS anagraficoDocumento, r.titolo AS relazioneTitolo
     FROM appuntamenti p
     LEFT JOIN anagrafici a ON a.id = p.anagraficoId
     LEFT JOIN relazioni r ON r.id = p.relazioneId
     WHERE p.id = ?`,
    [id],
  );
}

export type AppuntamentoInput = Omit<Appuntamento, "id" | "createdAt" | "updatedAt">;

function valoriAppuntamento(data: AppuntamentoInput) {
  return {
    anagraficoId: data.anagraficoId,
    relazioneId: data.relazioneId,
    titolo: data.titolo.trim(),
    descrizione: data.descrizione,
    inizio: data.inizio,
    fine: data.fine,
    luogo: data.luogo.trim(),
    stato: data.stato,
    promemoriaMin: Number(data.promemoriaMin) || 0,
    googleEventId: data.googleEventId,
    googleCalendarId: data.googleCalendarId,
    googleHtmlLink: data.googleHtmlLink,
    googleSyncAt: data.googleSyncAt,
    updatedAt: now(),
  };
}

export function creaAppuntamento(data: AppuntamentoInput): number {
  const timestamp = now();
  return insert("appuntamenti", {
    ...valoriAppuntamento(data),
    createdAt: timestamp,
    updatedAt: timestamp,
  });
}

export function aggiornaAppuntamento(id: number, data: AppuntamentoInput): void {
  update("appuntamenti", id, valoriAppuntamento(data));
}

export function marcaAppuntamentoSincronizzato(
  id: number,
  dati: { googleEventId: string | null; googleCalendarId: string | null; googleHtmlLink: string | null },
): void {
  update("appuntamenti", id, {
    googleEventId: dati.googleEventId,
    googleCalendarId: dati.googleCalendarId,
    googleHtmlLink: dati.googleHtmlLink,
    googleSyncAt: now(),
    updatedAt: now(),
  });
}

export function eliminaAppuntamento(id: number): void {
  run("DELETE FROM appuntamenti WHERE id = ?", [id]);
}

/* ---------------------------------- Riepilogo ----------------------------- */

export interface Riepilogo {
  anagrafici: number;
  relazioni: number;
  relazioniBozza: number;
  appuntamentiSettimana: number;
  appuntamentiInAttesa: number;
  prossimoAppuntamento: AppuntamentoDettagliato | null;
}

export function riepilogo(): Riepilogo {
  const inizioSettimana = new Date();
  inizioSettimana.setDate(inizioSettimana.getDate() - ((inizioSettimana.getDay() + 6) % 7));
  inizioSettimana.setHours(0, 0, 0, 0);
  const fineSettimana = new Date(inizioSettimana);
  fineSettimana.setDate(fineSettimana.getDate() + 7);

  const conteggi = get<{
    anagrafici: number;
    relazioni: number;
    relazioniBozza: number;
  }>(
    `SELECT (SELECT COUNT(*) FROM anagrafici) AS anagrafici,
            (SELECT COUNT(*) FROM relazioni) AS relazioni,
            (SELECT COUNT(*) FROM relazioni WHERE stato = 'bozza') AS relazioniBozza`,
  );

  const settimana = get<{ totale: number }>(
    "SELECT COUNT(*) AS totale FROM appuntamenti WHERE inizio >= ? AND inizio < ? AND stato <> 'annullato'",
    [inizioSettimana.toISOString(), fineSettimana.toISOString()],
  );

  const inAttesa = get<{ totale: number }>(
    "SELECT COUNT(*) AS totale FROM appuntamenti WHERE stato = 'in-attesa'",
  );

  const prossimo = get<AppuntamentoDettagliato>(
    `SELECT p.*, a.nome AS anagraficoNome, a.cognome AS anagraficoCognome,
            a.documento AS anagraficoDocumento, r.titolo AS relazioneTitolo
     FROM appuntamenti p
     LEFT JOIN anagrafici a ON a.id = p.anagraficoId
     LEFT JOIN relazioni r ON r.id = p.relazioneId
     WHERE p.inizio >= ? AND p.stato <> 'annullato'
     ORDER BY p.inizio ASC LIMIT 1`,
    [new Date().toISOString()],
  );

  return {
    anagrafici: Number(conteggi?.anagrafici ?? 0),
    relazioni: Number(conteggi?.relazioni ?? 0),
    relazioniBozza: Number(conteggi?.relazioniBozza ?? 0),
    appuntamentiSettimana: Number(settimana?.totale ?? 0),
    appuntamentiInAttesa: Number(inAttesa?.totale ?? 0),
    prossimoAppuntamento: prossimo ?? null,
  };
}

export interface Backup {
  version: 1;
  exportedAt: string;
  anagrafici: Anagrafico[];
  relazioni: Relazione[];
  appuntamenti: Appuntamento[];
}

export function creaBackup(): Backup {
  return {
    version: 1,
    exportedAt: now(),
    anagrafici: all<Anagrafico>("SELECT * FROM anagrafici ORDER BY id"),
    relazioni: all<Relazione>("SELECT * FROM relazioni ORDER BY id"),
    appuntamenti: all<Appuntamento>("SELECT * FROM appuntamenti ORDER BY id"),
  };
}

/** Svuota il database e ricarica una copia esportata in precedenza. */
export function ripristinaBackup(backup: Backup): void {
  const senzaId = <T extends { id: number }>(righe: T[]): Record<string, SqlValue>[] =>
    righe.map(({ id: _id, ...resto }) => ({ ...resto }) as Record<string, SqlValue>);
  run("DELETE FROM appuntamenti");
  run("DELETE FROM relazioni");
  run("DELETE FROM anagrafici");
  senzaId(backup.anagrafici).forEach((riga) => insert("anagrafici", riga));
  senzaId(backup.relazioni).forEach((riga) => insert("relazioni", riga));
  senzaId(backup.appuntamenti).forEach((riga) => insert("appuntamenti", riga));
  notifyChange();
}
