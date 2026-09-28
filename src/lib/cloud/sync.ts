import { flush, getVersion, replaceDatabase, snapshot, subscribe } from "../sqlite/engine";
import { supabase } from "./supabase";

const BUCKET = "reportini";
const DB_PATH = "reportini.sqlite";
const META_PATH = "reportini-meta.json";

interface RemoteMeta {
  updatedAt: string;
  bytes: number;
}

export type SincronizzazioneStato =
  | "spento"
  | "inattivo"
  | "in corso"
  | "sincronizzato"
  | "errore";

export interface SincronizzazioneInfo {
  stato: SincronizzazioneStato;
  messaggio: string;
  ultimoSalvataggio: string | null;
  prossimoTra: number | null;
}

function percorso(userId: string, nome: string): string {
  return `${userId}/${nome}`;
}

async function scarica(userId: string, nome: string): Promise<Uint8Array | null> {
  const { data, error } = await supabase!.storage
    .from(BUCKET)
    .download(percorso(userId, nome));
  if (error || !data) return null;
  return new Uint8Array(await data.arrayBuffer());
}

async function carica(userId: string, nome: string, corpo: Blob | Uint8Array): Promise<void> {
  const { error } = await supabase!.storage.from(BUCKET).upload(percorso(userId, nome), corpo, {
    upsert: true,
    cacheControl: "3600",
  });
  if (error) throw new Error(error.message);
}

async function leggiMeta(userId: string): Promise<RemoteMeta | null> {
  const { data, error } = await supabase!.storage
    .from(BUCKET)
    .download(percorso(userId, META_PATH));
  if (error || !data) return null;
  try {
    return JSON.parse(await data.text()) as RemoteMeta;
  } catch {
    return null;
  }
}

async function scriviMeta(userId: string, meta: RemoteMeta): Promise<void> {
  await carica(userId, META_PATH, new Blob([JSON.stringify(meta)], { type: "application/json" }));
}

/**
 * Versione del database locale già allineata con il cloud in questa sessione.
 * `null` = non ci siamo mai sincronizzati, quindi il cloud fa da fonte di verità.
 */
let versioneSincronizzata: number | null = null;

/** Dimentica lo stato di sincronizzazione (usato dopo un cambio account). */
export function resetSincronizzazione(): void {
  versioneSincronizzata = null;
}

async function caricaLocale(userId: string): Promise<{ scaricato: boolean; messaggio: string }> {
  const remoto = await scarica(userId, DB_PATH);
  if (!remoto) return { scaricato: false, messaggio: "Nessuna copia online" };
  await replaceDatabase(remoto);
  versioneSincronizzata = getVersion();
  return { scaricato: true, messaggio: "Dati ripristinati dal cloud" };
}

async function salvaLocale(userId: string): Promise<{ scaricato: boolean; messaggio: string }> {
  const byte = snapshot();
  await carica(
    userId,
    DB_PATH,
    new Blob([byte.slice().buffer], { type: "application/vnd.sqlite3" }),
  );
  await scriviMeta(userId, { updatedAt: new Date().toISOString(), bytes: byte.byteLength });
  versioneSincronizzata = getVersion();
  return { scaricato: false, messaggio: "Dati salvati nel cloud" };
}

/**
 * Allinea il database locale e la copia online.
 *
 * Al primo contatto della sessione non sappiamo nulla del dispositivo: se il
 * cloud ha già dei dati, sono quelli la fonte di verità (l'utente sta tornando
 * su un altro dispositivo, spesso con la copia locale vuota). Dopo il primo
 * allineamento valgono invece le modifiche locali non ancora replicate.
 */
export async function sincronizza(
  userId: string,
  direzione: "entrambe" | "solo_upload" = "entrambe",
): Promise<{ scaricato: boolean; messaggio: string }> {
  if (!supabase) return { scaricato: false, messaggio: "Cloud non configurato" };

  await flush();

  if (direzione === "solo_upload") return salvaLocale(userId);

  const meta = await leggiMeta(userId);

  if (!meta) return salvaLocale(userId);
  if (versioneSincronizzata === null) return caricaLocale(userId);
  if (getVersion() !== versioneSincronizzata) return salvaLocale(userId);

  return { scaricato: false, messaggio: "Già allineato" };
}

/**
 * Rincarica automaticamente dopo ogni scrittura locale, con un cooldown per
 * non fare una richiesta a ogni tasto premuto.
 */
export function avviaAutoSync(userId: string | null, suCambio: (info: SincronizzazioneInfo) => void) {
  let cooldown = 0;

  const base = {
    ultimoSalvataggio: new Date().toISOString(),
  };

  const invia = async (forzato = false) => {
    if (!userId || !supabase) return;
    if (!forzato && Date.now() < cooldown) return;
    cooldown = Date.now() + 5_000;
    suCambio({
      stato: "in corso",
      messaggio: "Salvataggio nel cloud…",
      ultimoSalvataggio: base.ultimoSalvataggio,
      prossimoTra: 5_000,
    });
    try {
      const esito = await sincronizza(userId);
      base.ultimoSalvataggio = new Date().toISOString();
      suCambio({
        stato: "sincronizzato",
        messaggio: esito.messaggio,
        ultimoSalvataggio: base.ultimoSalvataggio,
        prossimoTra: null,
      });
    } catch (errore) {
      suCambio({
        stato: "errore",
        messaggio: errore instanceof Error ? errore.message : "Salvataggio cloud non riuscito",
        ultimoSalvataggio: base.ultimoSalvataggio,
        prossimoTra: null,
      });
    }
  };

  const annulla = subscribe(() => {
    void invia();
  });

  return { invia, annulla };
}
