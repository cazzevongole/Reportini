import { createStore, del, entries, get, set } from "idb-keyval";

/**
 * Archivio delle versioni del database.
 *
 * Ogni volta che il database cambia si tiene una copia: non una per
 * modifica (sarebbero centinaia al giorno e il browser si riempirebbe),
 * ma una per ora, aggiornata a ogni modifica dentro quell'ora. In
 * pratica: "come erano le cose alle 10:14", non "come erano le cose
 * prima del tasto premuto".
 *
 * Quanto si tiene: tre giorni. È il patto con l'utente — abbastanza per
 * tornare indietro qualche giorno, non abbastanza per riempire il
 * dispositivo. C'è anche un tetto in byte, perché un database grosso
 * moltiplicato per 72 copie farebbe esplodere lo spazio: se si supera, le
 * versioni più vecchie cadono per prime, e comunque non cade mai
 * l'ultima.
 */

const NEGOZIO = createStore("reportini-backup", "versioni");

/** Una versione per ora, per tre giorni. */
export const ORE_PER_GIORNIO = 24;
export const GIORNI_RITENUTI = 3;
export const MAX_VERSIONI = ORE_PER_GIORNIO * GIORNI_RITENUTI;
const MS_GIORNO = 86_400_000;

/** Tetto di spazio: con database grandi 72 copie sarebbero troppe. */
export const BUDGET_BYTE = 24 * 1024 * 1024;

export interface Versione {
  /** Chiave dell'archivio: timestamp numerico, così l'ordinamento è gratis. */
  id: number;
  /** Inizio dell'ora coperta da questa versione. */
  ora: number;
  /** Momento dell'ultima modifica salvata, più fine dell'ora. */
  aggiornataIl: number;
  byte: number;
  /** Somma di controllo: serve a non riscrivere copie identiche. */
  impronta: string;
}

interface RecordVersione extends Versione {
  dati: ArrayBuffer;
}

const chiave = (id: number) => `v:${id}`;

/** Inizio dell'ora che contiene il momento indicato. */
export function oraDi(quando: number): number {
  const d = new Date(quando);
  d.setMinutes(0, 0, 0);
  return d.getTime();
}

/**
 * Impronta del contenuto (FNV-1a a 32 bit). Non serve resistenza: serve
 * solo capire se due copie sono identiche senza rileggere il database.
 */
export function impronta(byte: Uint8Array): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < byte.length; i += 1) {
    h ^= byte[i];
    h = Math.imul(h, 0x01000193);
  }
  return `${h.toString(16)}-${byte.length}`;
}

function ordina(a: Versione, b: Versione): number {
  return b.ora - a.ora || b.aggiornataIl - a.aggiornataIl;
}

/* ------------------------- elenco condiviso nel processo -------------------- */

/**
 * L'elenco vive in un posto solo: le impostazioni lo mostrano e chi ha
 * registrato una versione non deve costringere a ricaricare a mano.
 */
let elenco: Versione[] = [];
const ascoltatori = new Set<(versioni: Versione[]) => void>();

export function elencoCorrente(): Versione[] {
  return elenco;
}

export function iscrivitiElenco(
  ascolta: (versioni: Versione[]) => void,
): () => void {
  ascoltatori.add(ascolta);
  return () => ascoltatori.delete(ascolta);
}

export async function ricaricaElenco(): Promise<Versione[]> {
  elenco = await elencaVersioni();
  for (const ascolta of ascoltatori) ascolta(elenco);
  return elenco;
}

/** Tutte le versioni, dalla più recente alla più vecchia. */
export async function elencaVersioni(): Promise<Versione[]> {
  const tutto = await entries<string, RecordVersione>(NEGOZIO);
  return tutto
    .map(([, valore]) => ({
      id: valore.id,
      ora: valore.ora,
      aggiornataIl: valore.aggiornataIl,
      byte: valore.byte,
      impronta: valore.impronta,
    }))
    .sort(ordina);
}

export async function leggiVersione(id: number): Promise<Uint8Array | null> {
  const record = await get<RecordVersione>(chiave(id), NEGOZIO);
  return record ? new Uint8Array(record.dati) : null;
}

/**
 * Tiene il posto solo se il contenuto è cambiato davvero: riscrivere la
 * stessa ora con gli stessi byte non aggiunge niente e consuma spazio.
 */
async function oraUguale(ora: number, firma: string): Promise<boolean> {
  const record = await get<RecordVersione>(chiave(ora), NEGOZIO);
  return record?.impronta === firma;
}

/** Cancella le versioni più vecchie di quanto si tiene, e rifila lo spazio. */
async function pota(tutte: Versione[], adesso: number): Promise<void> {
  const limite = adesso - GIORNI_RITENUTI * MS_GIORNO;
  const daCancellare = tutte.filter((v) => v.ora < limite);

  let superstiti = tutte.filter((v) => v.ora >= limite);
  if (superstiti.length > MAX_VERSIONI) {
    // La lista è dalla più recente alla più vecchia: le code sono le
    // superflue e cadono per prime.
    daCancellare.push(...superstiti.slice(0, superstiti.length - MAX_VERSIONI));
    superstiti = superstiti.slice(0, MAX_VERSIONI);
  }

  let occupato = superstiti.reduce((totale, v) => totale + v.byte, 0);
  for (let i = superstiti.length - 1; i >= 1 && occupato > BUDGET_BYTE; i -= 1) {
    daCancellare.push(superstiti[i]);
    occupato -= superstiti[i].byte;
  }

  for (const versione of daCancellare) {
    await del(chiave(versione.id), NEGOZIO);
  }
}

/**
 * Registra lo stato corrente del database. Restituisce la versione
 * effettivamente scritta, o null se non è cambiato niente.
 */
export async function registraVersione(
  byte: Uint8Array,
  adesso = Date.now(),
): Promise<Versione | null> {
  const firma = impronta(byte);
  const ora = oraDi(adesso);
  if (await oraUguale(ora, firma)) return null;

  const versione: RecordVersione = {
    id: ora,
    ora,
    aggiornataIl: adesso,
    byte: byte.length,
    impronta: firma,
    // Copia staccata: come per il database, le viste sull'heap WASM non
    // sopravvivono alla chiusura.
    dati: byte.slice().buffer,
  };
  await set(chiave(ora), versione, NEGOZIO);

  const tutte = await elencaVersioni();
  await pota(tutte, adesso);
  await ricaricaElenco();
  const { dati, ...meta } = versione;
  return meta;
}

/**
 * Scarta tutto ciò che è più recente della versione scelta: si è deciso di
 * ripartire da lì, quindi la storia successiva non esiste più.
 */
export async function scartaVersioniSuccessive(id: number): Promise<number> {
  const tutte = await elencaVersioni();
  const daCancellare = tutte.filter((v) => v.ora > id);
  for (const versione of daCancellare) {
    await del(chiave(versione.id), NEGOZIO);
  }
  await ricaricaElenco();
  return daCancellare.length;
}

export async function svuotaArchivio(): Promise<void> {
  const tutto = await entries<string, RecordVersione>(NEGOZIO);
  for (const [chiaveV] of tutto) {
    await del(chiaveV, NEGOZIO);
  }
  await ricaricaElenco();
}
