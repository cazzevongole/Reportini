import { all, get, insert, notifyChange, run, update, type SqlValue } from "./sqlite/engine";
import { colonneChiamata } from "./types";
import type {
  Attivita,
  AttivitaDettagliata,
  Azienda,
  AziendaConTotali,
  Referente,
  Report,
  ReportDettagliato,
  TipoAttivita,
} from "./types";

const now = () => new Date().toISOString();

/** Il nome con cui l'azienda si mostra: la ragione sociale, o un avviso. */
export function nomeAzienda(a: Pick<Azienda, "ragioneSociale">): string {
  return a.ragioneSociale.trim() || "Senza ragione sociale";
}

/**
 * Le iniziali di un'azienda, dalla ragione sociale.
 *
 * Non si può fare come per una persona: "Ferramenti Rossi S.r.l." non ha un
 * nome e un cognome separati. Qui si prende la prima lettera delle prime due
 * parole, che è quello che si vede in un riquadro.
 */
export function inizialiAzienda(a: Pick<Azienda, "ragioneSociale">): string {
  const parti = a.ragioneSociale.trim().split(/\s+/).filter(Boolean);
  const primo = parti[0]?.[0] ?? "?";
  const secondo = parti.length > 1 ? (parti[1][0] ?? "") : "";
  return (primo + secondo).toUpperCase();
}

/** "Rossi Mario" — l'ordine con cui un referente si legge. */
export function nomeReferente(r: Pick<Referente, "nome" | "cognome">): string {
  return `${r.nome} ${r.cognome}`.trim() || "Senza nome";
}

/* --------------------------------- Aziende -------------------------------- */

export function elencaAziende(ricerca = ""): AziendaConTotali[] {
  const termine = `%${ricerca.trim()}%`;
  return all<AziendaConTotali>(
    `SELECT a.*,
       (SELECT COUNT(*) FROM report r WHERE r.aziendaId = a.id) AS numReport,
       (SELECT COUNT(*) FROM attivita t WHERE t.aziendaId = a.id) AS numAttivita,
       (SELECT COUNT(*) FROM referenti f WHERE f.aziendaId = a.id) AS numReferenti
     FROM aziende a
     WHERE ? = '%%'
        OR a.ragioneSociale LIKE ? OR a.partitaIva LIKE ?
        OR a.citta LIKE ? OR a.email LIKE ? OR a.telefono LIKE ?
        -- Anche per il nome del referente: è spesso l'unica traccia che
        -- fa trovare un'azienda ("quella di Mario").
        OR EXISTS (SELECT 1 FROM referenti f
                    WHERE f.aziendaId = a.id
                      AND (f.nome LIKE ? OR f.cognome LIKE ? OR f.email LIKE ?))
     ORDER BY a.ragioneSociale COLLATE NOCASE`,
    [termine, termine, termine, termine, termine, termine, termine, termine, termine],
  );
}

export function ottieniAzienda(id: number): AziendaConTotali | null {
  return get<AziendaConTotali>(
    `SELECT a.*,
       (SELECT COUNT(*) FROM report r WHERE r.aziendaId = a.id) AS numReport,
       (SELECT COUNT(*) FROM attivita t WHERE t.aziendaId = a.id) AS numAttivita,
       (SELECT COUNT(*) FROM referenti f WHERE f.aziendaId = a.id) AS numReferenti
     FROM aziende a WHERE a.id = ?`,
    [id],
  );
}

export type AziendaInput = Omit<Azienda, "id" | "createdAt" | "updatedAt">;

function valoriAzienda(data: AziendaInput) {
  return {
    ragioneSociale: data.ragioneSociale.trim(),
    // La partita iva è una cifra: si scrive sempre così, anche se l'utente
    // la digita con i punti o con le lettere del regime differenzato.
    partitaIva: data.partitaIva.trim().toUpperCase(),
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

export function creaAzienda(data: AziendaInput): number {
  const timestamp = now();
  return insert("aziende", {
    ...valoriAzienda(data),
    createdAt: timestamp,
    updatedAt: timestamp,
  });
}

export function aggiornaAzienda(id: number, data: AziendaInput): void {
  update("aziende", id, valoriAzienda(data));
}

/**
 * Cosa verrebbe eliminato insieme all'azienda: i referenti, i report e le
 * attività. Serve alla conferma prima di cancellare: nessuno deve scoprire
 * dopo che un report è sparito.
 *
 * I report si contano per azienda e non per attività perché è la domanda che
 * fa la pagina ("quante cose di questa azienda ci perderei?"): il report ha il
 * proprio aziendaId e viene cancellato in cascata con l'attività che genera.
 */
export function effettoEliminazioneAzienda(id: number): {
  referenti: number;
  report: number;
  attivita: number;
} {
  return {
    referenti:
      get<{ n: number }>("SELECT COUNT(*) AS n FROM referenti WHERE aziendaId = ?", [id])?.n ?? 0,
    report:
      get<{ n: number }>("SELECT COUNT(*) AS n FROM report WHERE aziendaId = ?", [id])?.n ?? 0,
    attivita:
      get<{ n: number }>("SELECT COUNT(*) AS n FROM attivita WHERE aziendaId = ?", [id])?.n ?? 0,
  };
}

export function eliminaAzienda(id: number): void {
  // Le attività prima, poi l'azienda. La cascata sui report parte dalle
  // attività, e farle qui evita che un report resti appeso a un'attività che
  // non esiste più: la cascata richiede che la tabella referenziatasia ancora
  // presente quando viene cancellata la riga che la nomina.
  run("DELETE FROM attivita WHERE aziendaId = ?", [id]);
  run("DELETE FROM aziende WHERE id = ?", [id]);
}

/**
 * Le attività che eliminando l'azienda porterebbero dietro l'evento su
 * Google, con i loro ID evento. La pagina raccoglie questa lista **prima** di
 * cancellare: dopo, le righe non esistono più e gli eventi resterebbero in
 * agenda orfani, non più raggiungibili da nessuno.
 */
export function attivitaConEventoDaEliminareAzienda(id: number): {
  id: number;
  googleEventId: string | null;
}[] {
  return all<{ id: number; googleEventId: string | null }>(
    "SELECT id, googleEventId FROM attivita WHERE aziendaId = ?",
    [id],
  );
}

/* -------------------------------- Referenti ------------------------------ */

export function elencaReferenti(aziendaId: number): Referente[] {
  return all<Referente>(
    `SELECT * FROM referenti WHERE aziendaId = ?
     ORDER BY cognome COLLATE NOCASE, nome COLLATE NOCASE`,
    [aziendaId],
  );
}

export type ReferenteInput = Omit<Referente, "id" | "createdAt" | "updatedAt">;

function valoriReferente(data: ReferenteInput) {
  return {
    aziendaId: data.aziendaId,
    nome: data.nome.trim(),
    cognome: data.cognome.trim(),
    telefono: data.telefono.trim(),
    email: data.email.trim(),
    updatedAt: now(),
  };
}

export function creaReferente(data: ReferenteInput): number {
  const timestamp = now();
  return insert("referenti", {
    ...valoriReferente(data),
    createdAt: timestamp,
    updatedAt: timestamp,
  });
}

export function aggiornaReferente(id: number, data: ReferenteInput): void {
  update("referenti", id, valoriReferente(data));
}

export function eliminaReferente(id: number): void {
  run("DELETE FROM referenti WHERE id = ?", [id]);
}

/* --------------------------------- Report --------------------------------- */

/**
 * Le attività ancora da fare: non segnate come fatte e non annullate.
 *
 * È la regola che usa già il riepilogo per il contatore "in attesa", e sta
 * qui perché una domanda sul dato, non una scelta della pagina: se la
 * scrivesse anche la lista, le due copie inizierebbero a divergere alla prima
 * modifica e nessuno se ne accorgerebbe.
 */
export function daFare(filtro: { da?: string; a?: string } = {}): AttivitaDettagliata[] {
  const condizioni = ["stato = 'in-attesa'", "completata = 0"];
  const parametri: string[] = [];
  if (filtro.da) {
    condizioni.push("t.inizio >= ?");
    parametri.push(filtro.da);
  }
  if (filtro.a) {
    condizioni.push("t.inizio <= ?");
    parametri.push(filtro.a);
  }
  return all<AttivitaDettagliata>(
    `SELECT t.*, a.ragioneSociale AS aziendaRagioneSociale,
            a.partitaIva AS aziendaPartitaIva
     FROM attivita t
     JOIN aziende a ON a.id = t.aziendaId
     WHERE ${condizioni.join(" AND ")}
     ORDER BY t.inizio ASC`,
    parametri,
  ).map(rigaAttivita);
}

/**
 * I report, con il contesto dell'attività da cui sono nati.
 *
 * La JOIN con `attivita` è interna e non si può evitare: il tipo e la data
 * dell'attività sono la parte del report che rende leggibile la riga. E
 * senza l'attività il report non esiste comunque, perché la cancellazione è in
 * cascata: quello che si perderebbe con una LEFT JOIN sono righe che nessuno
 * potrebbe aprire.
 */
export function elencaReport(
  filtro: { aziendaId?: number | null; ricerca?: string } = {},
): ReportDettagliato[] {
  const condizioni: string[] = [];
  const parametri: Array<string | number> = [];
  if (filtro.aziendaId) {
    condizioni.push("r.aziendaId = ?");
    parametri.push(filtro.aziendaId);
  }
  if (filtro.ricerca?.trim()) {
    condizioni.push(
      "(r.titolo LIKE ? OR r.descrizione LIKE ? OR a.ragioneSociale LIKE ? OR t.titolo LIKE ?)",
    );
    const termine = `%${filtro.ricerca.trim()}%`;
    parametri.push(termine, termine, termine, termine);
  }
  const where = condizioni.length ? `WHERE ${condizioni.join(" AND ")}` : "";
  return all<ReportDettagliato>(
    `SELECT r.*, a.ragioneSociale AS aziendaRagioneSociale,
            a.partitaIva AS aziendaPartitaIva,
            t.tipo AS attivitaTipo, t.titolo AS attivitaTitolo,
            t.inizio AS attivitaInizio
     FROM report r
     JOIN aziende a ON a.id = r.aziendaId
     JOIN attivita t ON t.id = r.attivitaId
     ${where}
     ORDER BY t.inizio DESC, r.id DESC`,
    parametri,
  );
}

export type ReportInput = Omit<Report, "id" | "createdAt" | "updatedAt">;

function valoriReport(data: ReportInput) {
  return {
    aziendaId: data.aziendaId,
    attivitaId: data.attivitaId,
    titolo: data.titolo.trim(),
    descrizione: data.descrizione,
    updatedAt: now(),
  };
}

export function creaReport(data: ReportInput): number {
  const timestamp = now();
  return insert("report", {
    ...valoriReport(data),
    createdAt: timestamp,
    updatedAt: timestamp,
  });
}

export function aggiornaReport(id: number, data: ReportInput): void {
  update("report", id, valoriReport(data));
}

export function eliminaReport(id: number): void {
  run("DELETE FROM report WHERE id = ?", [id]);
}

/* -------------------------------- Attività -------------------------------- */

export function elencaAttivita(
  filtro: {
    da?: string | null;
    a?: string | null;
    aziendaId?: number | null;
    tipo?: TipoAttivita | null;
  } = {},
): AttivitaDettagliata[] {
  const condizioni: string[] = [];
  const parametri: Array<string | number> = [];
  if (filtro.da) {
    condizioni.push("t.inizio >= ?");
    parametri.push(filtro.da);
  }
  if (filtro.a) {
    condizioni.push("t.inizio <= ?");
    parametri.push(filtro.a);
  }
  if (filtro.aziendaId) {
    condizioni.push("t.aziendaId = ?");
    parametri.push(filtro.aziendaId);
  }
  if (filtro.tipo) {
    condizioni.push("t.tipo = ?");
    parametri.push(filtro.tipo);
  }
  const where = condizioni.length ? `WHERE ${condizioni.join(" AND ")}` : "";
  return all<AttivitaDettagliata>(
    `SELECT t.*, a.ragioneSociale AS aziendaRagioneSociale,
            a.partitaIva AS aziendaPartitaIva
     FROM attivita t
     JOIN aziende a ON a.id = t.aziendaId
     ${where}
     ORDER BY t.inizio ASC`,
    parametri,
  ).map(rigaAttivita);
}

/**
 * Una riga di `attivita` con `completata` come sí e no.
 *
 * SQLite non ha i booleani: la colonna è `INTEGER` e la query restituisce `1`.
 * Rendersela `1` significa che `Attivita.completata` mente sul proprio tipo, e
 * la prima cosa che si rompe è un `=== true` — che fallisce senza che nessuno
 * capisca perché. La conversione sta qui, una volta sola, e non in ogni
 * lettore.
 */
function rigaAttivita<T extends Attivita>(riga: T): T {
  const completata = Boolean(riga.completata);
  // Su una chiamata `stato` non è un dato: è la casella "fatta" scritta nella
  // colonna che ne ha bisogno per il colore su Google. Ricalcolarlo in lettura
  // tiene la parola giusta anche su una riga venuta dal cloud con le due
  // colonne discordi, che è il caso in cui l'utente legge "confermato" su una
  // chiamata mai fatta.
  return {
    ...riga,
    completata,
    stato: riga.tipo === "chiamata" ? colonneChiamata(completata).stato : riga.stato,
  };
}

export function ottieniAttivita(id: number): AttivitaDettagliata | null {
  const riga = get<AttivitaDettagliata>(
    `SELECT t.*, a.ragioneSociale AS aziendaRagioneSociale,
            a.partitaIva AS aziendaPartitaIva
     FROM attivita t
     JOIN aziende a ON a.id = t.aziendaId
     WHERE t.id = ?`,
    [id],
  );
  return riga ? rigaAttivita(riga) : null;
}

export type AttivitaInput = Omit<Attivita, "id" | "createdAt" | "updatedAt">;

function valoriAttivita(data: AttivitaInput) {
  return {
    aziendaId: data.aziendaId,
    titolo: data.titolo.trim(),
    descrizione: data.descrizione,
    tipo: data.tipo,
    inizio: data.inizio,
    fine: data.fine,
    luogo: data.luogo.trim(),
    stato: data.stato,
    // completata è un intero nella tabella e un sí/no qui: è la colonna su
    // cui poggia la generazione del report, e deve tornare vera dopo un
    // salvataggio o un riavvio, non valere solo finché la pagina è aperta.
    completata: data.completata ? 1 : 0,
    promemoriaMin: Number(data.promemoriaMin) || 0,
    googleEventId: data.googleEventId,
    googleCalendarId: data.googleCalendarId,
    googleHtmlLink: data.googleHtmlLink,
    googleSyncAt: data.googleSyncAt,
    googleErrore: data.googleErrore,
    updatedAt: now(),
  };
}

export function creaAttivita(data: AttivitaInput): number {
  const timestamp = now();
  return insert("attivita", {
    ...valoriAttivita(data),
    createdAt: timestamp,
    updatedAt: timestamp,
  });
}

export function aggiornaAttivita(id: number, data: AttivitaInput): void {
  update("attivita", id, valoriAttivita(data));
}

/**
 * Segna l'attività come svolta senza riscriverla tutta.
 *
 * È una colonna e non uno stato, quindi non ha bisogno della riga completa.
 * Serve perché dalla casella si arriva al report senza passare dal modulo di
 * modifica: farlo con aggiornaAttivita significherebbe riscrivere la
 * descrizione, che nel frattempo potrebbe essere cambiata in un'altra scheda.
 */
export function segnaAttivitaCompletata(id: number, completata: boolean): void {
  update("attivita", id, { completata: completata ? 1 : 0, updatedAt: now() });
}

/**
 * Segna una chiamata come fatta, o torna indietro.
 *
 * Scrive `stato` e `completata` **insieme**, e non in due chiamate: sono la
 * stessa cosa detta in due colonne, e due scritture lasciano una finestra in
 * cui la chiamata è "fatta" ma non ancora confermata. In quella finestra un
 * evento su Google la mostra occupata ma non come fatta — una contraddizione
 * che nessuno vede e che il riepilogo conta come "da fare".
 *
 * La traduzione la fa `colonneChiamata()` in `types.ts`, e non va rifatta a
 * mano nei moduli.
 */
export function segnaChiamataCompletata(id: number, completata: boolean): void {
  const colonne = colonneChiamata(completata);
  update("attivita", id, {
    stato: colonne.stato,
    completata: colonne.completata ? 1 : 0,
    updatedAt: now(),
  });
}

export function marcaAttivitaSincronizzata(
  id: number,
  dati: {
    googleEventId: string | null;
    googleCalendarId: string | null;
    googleHtmlLink: string | null;
  },
): void {
  update("attivita", id, {
    googleEventId: dati.googleEventId,
    googleCalendarId: dati.googleCalendarId,
    googleHtmlLink: dati.googleHtmlLink,
    googleSyncAt: now(),
    // Col riuscito sparisce anche il motivo del fallimento precedente: se non
    // restasse, l'attività pubblicata continuerebbe ad accusare un errore
    // che non c'è più.
    googleErrore: null,
    updatedAt: now(),
  });
}

/**
 * Scrive perché la pubblicazione è fallita, e lo scrive **sull'attività**.
 *
 * Il motivo di un errore di rete è la cosa che serve di più e quella che
 * sparisce per prima: un avviso dura pochi secondi, un riavvio lo cancella, e
 * senza questo l'unico sintomo era un'attività che non compare in agenda e
 * una notifica verde passata.
 */
export function marcaErroreGoogle(id: number, messaggio: string): void {
  update("attivita", id, { googleErrore: messaggio, updatedAt: now() });
}

/**
 * Toglie solo i marcatori di Google, senza toccare il resto dell'attività.
 *
 * Serve perché "scollegare l'evento" non è un salvataggio dell'attività:
 * farlo con aggiornaAttivita richiederebbe di riscrivere la descrizione, e
 * quella che si manda a Google è arricchita con il contesto dell'azienda.
 * Riscrivendola, il contesto finirebbe nel database e da lì nel modulo di
 * modifica, dove si accumulerebbe a ogni passaggio.
 */
export function rimuoviCollegamentoGoogle(id: number): void {
  update("attivita", id, {
    googleEventId: null,
    googleCalendarId: null,
    googleHtmlLink: null,
    googleSyncAt: null,
    googleErrore: null,
    updatedAt: now(),
  });
}

export function eliminaAttivita(id: number): void {
  run("DELETE FROM attivita WHERE id = ?", [id]);
}

/* ------------------------------- Preferenze ----------------------------- */

/**
 * Le preferenze dell'utente, nel database e non in localStorage.
 *
 * Il database è quello che sale nel cloud e si ripristina su un altro
 * dispositivo: un colore scelto qui è una scelta dell'utenza, e seguirlo è
 * quello che l'utente si aspetta. Ogni valore è validato da chi lo scrive —
 * qui dentro può arrivare solo quello che l'app scrive, e chi scrive un
 * colorId deve controllare che stia nella palette prima di chiamare.
 *
 * Coppia chiave/valore invece di una colonna per impostazione: aggiungerne
 * una nuova non deve richiedere una migrazione.
 *
 * (Niente backtick in questi commenti: lo smoke test riconosce le query di
 * questo file proprio dai backtick, e un paio di più nel testo di un commento
 * gli farebbe catturare e provare fraseggi che non sono SQL.)
 */
export function leggiPreferenza(chiave: string): string | null {
  return (
    get<{ valore: string }>("SELECT valore FROM preferenze WHERE chiave = ?", [chiave])?.valore ??
    null
  );
}

/** Upsert: una preferenza scritta due volte vale solo l'ultima. */
export function scriviPreferenza(chiave: string, valore: string): void {
  run(
    `INSERT INTO preferenze (chiave, valore, updatedAt)
     VALUES (?, ?, ?)
     ON CONFLICT(chiave) DO UPDATE SET valore = excluded.valore, updatedAt = excluded.updatedAt`,
    [chiave, valore, now()],
  );
}

/** Toglie la preferenza: la chiave torna a non esistere, come non l'avesse mai scelta. */
export function eliminaPreferenza(chiave: string): void {
  run("DELETE FROM preferenze WHERE chiave = ?", [chiave]);
}

export interface Riepilogo {
  aziende: number;
  report: number;
  attivitaSettimana: number;
  attivitaInAttesa: number;
  prossimaAttivita: AttivitaDettagliata | null;
}

export function riepilogo(): Riepilogo {
  const inizioSettimana = new Date();
  inizioSettimana.setDate(inizioSettimana.getDate() - ((inizioSettimana.getDay() + 6) % 7));
  inizioSettimana.setHours(0, 0, 0, 0);
  const fineSettimana = new Date(inizioSettimana);
  fineSettimana.setDate(fineSettimana.getDate() + 7);

  const conteggi = get<{ aziende: number; report: number }>(
    `SELECT (SELECT COUNT(*) FROM aziende) AS aziende,
            (SELECT COUNT(*) FROM report) AS report`,
  );

  const settimana = get<{ totale: number }>(
    `SELECT COUNT(*) AS totale FROM attivita
      WHERE inizio >= ? AND inizio < ? AND stato <> 'annullato'`,
    [inizioSettimana.toISOString(), fineSettimana.toISOString()],
  );

  // Una'attività segnata come svolta non è più "da fare", anche se nessuno ha
  // cambiato il suo stato: la casella di completamento vale quanto lo stato,
  // altrimenti una attività fatta resterebbe nelle cose da fare per sempre.
  const inAttesa = get<{ totale: number }>(
    "SELECT COUNT(*) AS totale FROM attivita WHERE stato = 'in-attesa' AND completata = 0",
  );

  const prossimo = get<AttivitaDettagliata>(
    `SELECT t.*, a.ragioneSociale AS aziendaRagioneSociale,
            a.partitaIva AS aziendaPartitaIva
     FROM attivita t
     JOIN aziende a ON a.id = t.aziendaId
     WHERE t.inizio >= ? AND t.stato <> 'annullato'
     ORDER BY t.inizio ASC LIMIT 1`,
    [new Date().toISOString()],
  );
  const prossima = prossimo ? rigaAttivita(prossimo) : null;

  return {
    aziende: Number(conteggi?.aziende ?? 0),
    report: Number(conteggi?.report ?? 0),
    attivitaSettimana: Number(settimana?.totale ?? 0),
    attivitaInAttesa: Number(inAttesa?.totale ?? 0),
    prossimaAttivita: prossima,
  };
}

export interface Backup {
  version: 3;
  exportedAt: string;
  aziende: Azienda[];
  referenti: Referente[];
  attivita: Attivita[];
  report: Report[];
}

export function creaBackup(): Backup {
  return {
    version: 3,
    exportedAt: now(),
    aziende: all<Azienda>("SELECT * FROM aziende ORDER BY id"),
    referenti: all<Referente>("SELECT * FROM referenti ORDER BY id"),
    attivita: all<Attivita>("SELECT * FROM attivita ORDER BY id"),
    report: all<Report>("SELECT * FROM report ORDER BY id"),
  };
}

/** Svuota il database e ricarica una copia esportata in precedenza. */
export function ripristinaBackup(backup: Backup): void {
  const senzaId = <T extends { id: number }>(righe: T[]): Record<string, SqlValue>[] =>
    righe.map(({ id: _id, ...resto }) => ({ ...resto }) as Record<string, SqlValue>);
  // Nell'ordine inverso di come si scrive: report e attività dipendono
  // dall'azienda, i referenti dall'azienda. Svuotare al contrario lascerebbe,
  // per un attimo, righe che puntano a qualcosa che non c'è.
  run("DELETE FROM report");
  run("DELETE FROM attivita");
  run("DELETE FROM referenti");
  run("DELETE FROM aziende");
  senzaId(backup.aziende).forEach((riga) => insert("aziende", riga));
  senzaId(backup.referenti).forEach((riga) => insert("referenti", riga));
  senzaId(backup.attivita).forEach((riga) => insert("attivita", riga));
  senzaId(backup.report).forEach((riga) => insert("report", riga));
  notifyChange();
}
