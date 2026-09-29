import {
  flush,
  getVersion,
  nonReplicato,
  replaceDatabase,
  segnaReplicato,
  snapshot,
  subscribe,
} from "../sqlite/engine";
import { supabase } from "./supabase";

const BUCKET = "reportini";
const DB_PATH = "reportini.sqlite";
const META_PATH = "reportini-meta.json";

interface RemoteMeta {
  updatedAt: string;
  bytes: number;
}

export type SincronizzazioneStato = "spento" | "inattivo" | "in corso" | "sincronizzato" | "errore";

export interface SincronizzazioneInfo {
  stato: SincronizzazioneStato;
  messaggio: string;
  ultimoSalvataggio: string | null;
  prossimoTra: number | null;
}

const INIZIALE: SincronizzazioneInfo = {
  stato: "inattivo",
  messaggio: "",
  ultimoSalvataggio: null,
  prossimoTra: null,
};

/**
 * L'ultimo esito della sincronizzazione, in un punto solo: le impostazioni
 * lo possono mostrare senza avviare una seconda sincronizzazione.
 */
let ultimoStato: SincronizzazioneInfo = INIZIALE;
const ascoltatori = new Set<(info: SincronizzazioneInfo) => void>();

export function statoSalvataggio(): SincronizzazioneInfo {
  return ultimoStato;
}

export function iscrivitiAllaSalvataggio(
  ascolta: (info: SincronizzazioneInfo) => void,
): () => void {
  ascoltatori.add(ascolta);
  return () => ascoltatori.delete(ascolta);
}

function pubblica(info: SincronizzazioneInfo): void {
  ultimoStato = info;
  for (const ascolta of ascoltatori) ascolta(info);
}

function percorso(userId: string, nome: string): string {
  return `${userId}/${nome}`;
}

async function scarica(userId: string, nome: string): Promise<Uint8Array | null> {
  const { data, error } = await supabase!.storage.from(BUCKET).download(percorso(userId, nome));
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

/**
 * Versione del database com'era all'inizio della sessione.
 *
 * È ciò che distingue "l'utente sta tornando su un altro dispositivo, qui non
 * c'è niente" da "l'utente sta lavorando e le sue scritture non sono ancora
 * salite". Nel secondo caso il cloud **non** può fare da fonte di verità: la
 * copia online è più vecchia di quello che c'è qui, e sostituirla cancella il
 * lavoro dell'utente.
 *
 * Senza questo controllo il sintomo era un appuntamento creato che spariva, e
 * la pubblicazione si fermava con «L'appuntamento non esiste più»: non
 * accadeva sempre, perché dipende da se la scrittura capitava dentro la
 * finestra del download.
 */
let versioneAllaPartenza = 0;

/**
 * Il database ha cose che il cloud non ha ancora visto?
 *
 * Due fonti, e servono entrambe. `getVersion()` confrontato con la versione
 * di partenza cattura le scritture di **questa sessione**. Il flag
 * `nonReplicato()` cattura quello che è successo **prima**: senza, un
 * appuntamento eliminato e chiusa l'app prima della sincronizzazione tornava
 * indietro al riavvio, perché il contatore riparte da zero e il cloud, che lo
 * aveva ancora, sembrava la copia più recente.
 */
function ciSonoModificheLocali(): boolean {
  return getVersion() !== versioneAllaPartenza || nonReplicato();
}

/** Dimentica lo stato di sincronizzazione (usato dopo un cambio account). */
export function resetSincronizzazione(): void {
  versioneSincronizzata = null;
  versioneAllaPartenza = getVersion();
}

async function caricaLocale(userId: string): Promise<{ scaricato: boolean; messaggio: string }> {
  const remoto = await scarica(userId, DB_PATH);
  if (!remoto) return { scaricato: false, messaggio: "Nessuna copia online" };
  // Il download è stato in rete e l'utente, in quei secondi, ha potuto
  // salvare qualcosa. Sostituire il database adesso butterebbe via quello che
  // ha appena scritto: quindi si ricontrolla **dopo** aver scaricato, non solo
  // prima. È la differenza fra un errore che capita una volta e uno che non
  // capita mai.
  if (ciSonoModificheLocali()) {
    console.warn(
      "cloud: il database locale è cambiato durante il download, quindi la copia online non lo sostituisce",
    );
    return salvaLocale(userId);
  }
  await replaceDatabase(remoto);
  versioneSincronizzata = getVersion();
  // Il database è adesso quello del cloud: non c'è più niente da replicare.
  segnaReplicato();
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
  // Solo adesso, e non prima: il cloud ha tutto quello che c'era qui, quindi
  // il flag può spegnersi. Se il caricamento è fallito a metà, resta acceso.
  segnaReplicato();
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
  if (versioneSincronizzata === null) {
    // Primo contatto della sessione. Il cloud vince solo se questo database
    // è ancora quello di quando l'app si è aperta: se l'utente ha già scritto,
    // salire sono i dati suoi, non scendere quelli di una copia più vecchia.
    if (ciSonoModificheLocali()) return salvaLocale(userId);
    return caricaLocale(userId);
  }
  if (getVersion() !== versioneSincronizzata) return salvaLocale(userId);

  return { scaricato: false, messaggio: "Già allineato" };
}

/**
 * Rincarica automaticamente dopo ogni scrittura locale, con un cooldown per
 * non fare una richiesta a ogni tasto premuto.
 */
export function avviaAutoSync(userId: string | null) {
  let cooldown = 0;

  const base = {
    ultimoSalvataggio: new Date().toISOString(),
  };

  const invia = async (forzato = false) => {
    if (!userId || !supabase) return;
    if (!forzato && Date.now() < cooldown) return;
    cooldown = Date.now() + 5_000;
    pubblica({
      stato: "in corso",
      messaggio: "Salvataggio nel cloud…",
      ultimoSalvataggio: base.ultimoSalvataggio,
      prossimoTra: 5_000,
    });
    try {
      const esito = await sincronizza(userId);
      base.ultimoSalvataggio = new Date().toISOString();
      pubblica({
        stato: "sincronizzato",
        messaggio: esito.messaggio,
        ultimoSalvataggio: base.ultimoSalvataggio,
        prossimoTra: null,
      });
    } catch (errore) {
      pubblica({
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
