import { all, get, insert, notifyChange, run, update, type SqlValue } from "./sqlite/engine";
import type {
  Appuntamento,
  AppuntamentoDettagliato,
  Azienda,
  AziendaConTotali,
  Referente,
  Relazione,
  RelazioneDettagliata,
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
       (SELECT COUNT(*) FROM relazioni r WHERE r.aziendaId = a.id) AS numRelazioni,
       (SELECT COUNT(*) FROM appuntamenti p WHERE p.aziendaId = a.id) AS numAppuntamenti,
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
       (SELECT COUNT(*) FROM relazioni r WHERE r.aziendaId = a.id) AS numRelazioni,
       (SELECT COUNT(*) FROM appuntamenti p WHERE p.aziendaId = a.id) AS numAppuntamenti,
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
 * Cosa verrebbe eliminato insieme all'azienda: i referenti e le relazioni (in
 * cascata) e gli appuntamenti che, senza il soggetto, resterebbero senza
 * nessun riferimento. Serve alla conferma prima di cancellare: nessuno
 * deve scoprire dopo che un appuntamento è sparito.
 */
export function effettoEliminazioneAzienda(id: number): {
  referenti: number;
  relazioni: number;
  appuntamenti: number;
} {
  return {
    referenti:
      get<{ n: number }>("SELECT COUNT(*) AS n FROM referenti WHERE aziendaId = ?", [id])?.n ?? 0,
    relazioni:
      get<{ n: number }>("SELECT COUNT(*) AS n FROM relazioni WHERE aziendaId = ?", [id])?.n ?? 0,
    appuntamenti:
      get<{ n: number }>(
        `SELECT COUNT(*) AS n FROM appuntamenti
          WHERE aziendaId = ?
             OR relazioneId IN (SELECT id FROM relazioni WHERE aziendaId = ?)`,
        [id, id],
      )?.n ?? 0,
  };
}

export function eliminaAzienda(id: number): void {
  // Prima gli appuntamenti, poi l'azienda: così la cascata sulle relazioni
  // non può lasciare appuntamenti appesi a un riferimento che non esiste
  // più, che sulle altre pagine resterebbero visibili come righe senza nome.
  run(
    `DELETE FROM appuntamenti
      WHERE aziendaId = ?
         OR relazioneId IN (SELECT id FROM relazioni WHERE aziendaId = ?)`,
    [id, id],
  );
  run("DELETE FROM aziende WHERE id = ?", [id]);
}

/**
 * Gli appuntamenti che eliminando l'azienda porterebbero dietro l'evento su
 * Google, con i loro ID evento. La pagina raccoglie questa lista **prima** di
 * cancellare: dopo, le righe non esistono più e gli eventi resterebbero in
 * agenda orfani, non più raggiungibili da nessuno.
 */
export function appuntamentiConEventoDaEliminareAzienda(id: number): {
  id: number;
  googleEventId: string | null;
}[] {
  return all<{ id: number; googleEventId: string | null }>(
    `SELECT id, googleEventId FROM appuntamenti
      WHERE aziendaId = ?
         OR relazioneId IN (SELECT id FROM relazioni WHERE aziendaId = ?)`,
    [id, id],
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

/**
 * Lo stesso per una relazione: gli appuntamenti che, senza di lei, resterebbero
 * senza nessun riferimento — e i cui eventi su Google sarebbero orfani.
 */
export function appuntamentiConEventoDaEliminareRelazione(id: number): {
  id: number;
  googleEventId: string | null;
}[] {
  return all<{ id: number; googleEventId: string | null }>(
    "SELECT id, googleEventId FROM appuntamenti WHERE relazioneId = ? AND aziendaId IS NULL",
    [id],
  );
}

/* --------------------------------- Relazioni ------------------------------ */

export function elencaRelazioni(
  filtro: {
    aziendaId?: number | null;
    stato?: string | null;
    ricerca?: string;
  } = {},
): RelazioneDettagliata[] {
  const condizioni: string[] = [];
  const parametri: Array<string | number> = [];
  if (filtro.aziendaId) {
    condizioni.push("r.aziendaId = ?");
    parametri.push(filtro.aziendaId);
  }
  if (filtro.stato) {
    condizioni.push("r.stato = ?");
    parametri.push(filtro.stato);
  }
  if (filtro.ricerca?.trim()) {
    condizioni.push(
      "(r.titolo LIKE ? OR r.tipo LIKE ? OR r.contenuto LIKE ? OR a.ragioneSociale LIKE ?)",
    );
    const termine = `%${filtro.ricerca.trim()}%`;
    parametri.push(termine, termine, termine, termine);
  }
  const where = condizioni.length ? `WHERE ${condizioni.join(" AND ")}` : "";
  return all<RelazioneDettagliata>(
    `SELECT r.*, a.ragioneSociale AS aziendaRagioneSociale,
            a.partitaIva AS aziendaPartitaIva
     FROM relazioni r JOIN aziende a ON a.id = r.aziendaId
     ${where}
     ORDER BY r.data DESC, r.id DESC`,
    parametri,
  );
}

export type RelazioneInput = Omit<Relazione, "id" | "createdAt" | "updatedAt">;

function valoriRelazione(data: RelazioneInput) {
  return {
    aziendaId: data.aziendaId,
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
 * riferimento: hanno la relazione ma non un'azienda. Quelli che hanno
 * anche l'azienda restano: il soggetto esiste ancora.
 */
export function effettoEliminazioneRelazione(id: number): { appuntamenti: number } {
  return {
    appuntamenti:
      get<{ n: number }>(
        "SELECT COUNT(*) AS n FROM appuntamenti WHERE relazioneId = ? AND aziendaId IS NULL",
        [id],
      )?.n ?? 0,
  };
}

export function eliminaRelazione(id: number): void {
  run("DELETE FROM appuntamenti WHERE relazioneId = ? AND aziendaId IS NULL", [id]);
  run("DELETE FROM relazioni WHERE id = ?", [id]);
}
/* ------------------------------- Appuntamenti ---------------------------- */

export function elencaAppuntamenti(
  filtro: {
    da?: string | null;
    a?: string | null;
    aziendaId?: number | null;
  } = {},
): AppuntamentoDettagliato[] {
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
  if (filtro.aziendaId) {
    condizioni.push("p.aziendaId = ?");
    parametri.push(filtro.aziendaId);
  }
  const where = condizioni.length ? `WHERE ${condizioni.join(" AND ")}` : "";
  return all<AppuntamentoDettagliato>(
    `SELECT p.*, a.ragioneSociale AS aziendaRagioneSociale,
            a.partitaIva AS aziendaPartitaIva, r.titolo AS relazioneTitolo
     FROM appuntamenti p
     LEFT JOIN aziende a ON a.id = p.aziendaId
     LEFT JOIN relazioni r ON r.id = p.relazioneId
     ${where}
     ORDER BY p.inizio ASC`,
    parametri,
  );
}

export function ottieniAppuntamento(id: number): AppuntamentoDettagliato | null {
  return get<AppuntamentoDettagliato>(
    `SELECT p.*, a.ragioneSociale AS aziendaRagioneSociale,
            a.partitaIva AS aziendaPartitaIva, r.titolo AS relazioneTitolo
     FROM appuntamenti p
     LEFT JOIN aziende a ON a.id = p.aziendaId
     LEFT JOIN relazioni r ON r.id = p.relazioneId
     WHERE p.id = ?`,
    [id],
  );
}

export type AppuntamentoInput = Omit<Appuntamento, "id" | "createdAt" | "updatedAt">;

function valoriAppuntamento(data: AppuntamentoInput) {
  return {
    aziendaId: data.aziendaId,
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
    googleErrore: data.googleErrore,
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
  dati: {
    googleEventId: string | null;
    googleCalendarId: string | null;
    googleHtmlLink: string | null;
  },
): void {
  update("appuntamenti", id, {
    googleEventId: dati.googleEventId,
    googleCalendarId: dati.googleCalendarId,
    googleHtmlLink: dati.googleHtmlLink,
    googleSyncAt: now(),
    // Col riuscito sparisce anche il motivo del fallimento precedente: se non
    // restasse, l'appuntamento pubblicato continuerebbe ad accusare un
    // errore che non c'è più.
    googleErrore: null,
    updatedAt: now(),
  });
}

/**
 * Scrive perché la pubblicazione è fallita, e lo scrive **sull'appuntamento**.
 *
 * Il motivo di un errore di rete è la cosa che serve di più e quella che
 * sparisce per prima: un avviso dura pochi secondi, un riavvio lo cancella, e
 * senza questo l'unico sintomo era un appuntamento che non compare in
 * agenda e una notifica verde passata.
 */
export function marcaErroreGoogle(id: number, messaggio: string): void {
  update("appuntamenti", id, { googleErrore: messaggio, updatedAt: now() });
}

/**
 * Toglie solo i marcatori di Google, senza toccare il resto dell'appuntamento.
 *
 * Serve perché "scollegare l'evento" non è un salvataggio dell'appuntamento:
 * farlo con aggiornaAppuntamento richiederebbe di riscrivere la descrizione,
 * e quella che si manda a Google è arricchita con il contesto dell'azienda.
 * Riscrivendola, il contesto finirebbe nel database e da lì nel modulo di
 * modifica, dove si accumulerebbe a ogni passaggio.
 */
export function rimuoviCollegamentoGoogle(id: number): void {
  update("appuntamenti", id, {
    googleEventId: null,
    googleCalendarId: null,
    googleHtmlLink: null,
    googleSyncAt: null,
    googleErrore: null,
    updatedAt: now(),
  });
}

export function eliminaAppuntamento(id: number): void {
  run("DELETE FROM appuntamenti WHERE id = ?", [id]);
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
    aziende: number;
    relazioni: number;
    relazioniBozza: number;
  }>(
    `SELECT (SELECT COUNT(*) FROM aziende) AS aziende,
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
    `SELECT p.*, a.ragioneSociale AS aziendaRagioneSociale,
            a.partitaIva AS aziendaPartitaIva, r.titolo AS relazioneTitolo
     FROM appuntamenti p
     LEFT JOIN aziende a ON a.id = p.aziendaId
     LEFT JOIN relazioni r ON r.id = p.relazioneId
     WHERE p.inizio >= ? AND p.stato <> 'annullato'
     ORDER BY p.inizio ASC LIMIT 1`,
    [new Date().toISOString()],
  );

  return {
    aziende: Number(conteggi?.aziende ?? 0),
    relazioni: Number(conteggi?.relazioni ?? 0),
    relazioniBozza: Number(conteggi?.relazioniBozza ?? 0),
    appuntamentiSettimana: Number(settimana?.totale ?? 0),
    appuntamentiInAttesa: Number(inAttesa?.totale ?? 0),
    prossimoAppuntamento: prossimo ?? null,
  };
}

export interface Backup {
  version: 2;
  exportedAt: string;
  aziende: Azienda[];
  referenti: Referente[];
  relazioni: Relazione[];
  appuntamenti: Appuntamento[];
}

export function creaBackup(): Backup {
  return {
    version: 2,
    exportedAt: now(),
    aziende: all<Azienda>("SELECT * FROM aziende ORDER BY id"),
    referenti: all<Referente>("SELECT * FROM referenti ORDER BY id"),
    relazioni: all<Relazione>("SELECT * FROM relazioni ORDER BY id"),
    appuntamenti: all<Appuntamento>("SELECT * FROM appuntamenti ORDER BY id"),
  };
}

/** Svuota il database e ricarica una copia esportata in precedenza. */
export function ripristinaBackup(backup: Backup): void {
  const senzaId = <T extends { id: number }>(righe: T[]): Record<string, SqlValue>[] =>
    righe.map(({ id: _id, ...resto }) => ({ ...resto }) as Record<string, SqlValue>);
  // Nell'ordine inverso di come si scrive: referenti e relazioni dipendono
  // dall'azienda, gli appuntamenti da entrambe. Svuotare al contrario
  // lascerebbe, per un attimo, righe che puntano a qualcosa che non c'è.
  run("DELETE FROM appuntamenti");
  run("DELETE FROM relazioni");
  run("DELETE FROM referenti");
  run("DELETE FROM aziende");
  senzaId(backup.aziende).forEach((riga) => insert("aziende", riga));
  senzaId(backup.referenti).forEach((riga) => insert("referenti", riga));
  senzaId(backup.relazioni).forEach((riga) => insert("relazioni", riga));
  senzaId(backup.appuntamenti).forEach((riga) => insert("appuntamenti", riga));
  notifyChange();
}
