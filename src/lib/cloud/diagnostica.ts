import { cloudEnabled, problemaConfigurazione, supabase, tipoChiave } from "./supabase";

const BUCKET = "reportini";
const SONDAGGIO = ".verifica-bucket";

export interface Controllo {
  nome: string;
  ok: boolean;
  dettaglio: string;
  azione?: string;
  /** Il controllo non è fallito, ma non è nemmeno concluso. */
  nonVerificato?: boolean;
}

/** Riconosce l'errore con cui Supabase segnala un bucket inesistente. */
export function bucketMancaDaErrore(
  errore: { message?: string; statusCode?: string | number } | null,
): boolean {
  if (!errore) return false;
  const testo = (errore.message ?? "").toLowerCase();
  return testo.includes("bucket not found") || testo.includes("nosuchbucket");
}

/**
 * Con la chiave pubblica un bucket privato e un bucket inesistente sono
 * indistinguibili: elenco, lettura e upload anonimo rispondono entrambi come
 * se il bucket fosse vuoto o vietato. L'unico controllo che non dà equivoci è
 * una scrittura reale da parte di un account autenticato: lì un bucket che
 * manca produce "Bucket not found", mentre uno protetto dalle RLS accetta il
 * file perché il percorso è sotto l'id dell'utente.
 */
async function verificaBucketAutenticata(
  client: NonNullable<typeof supabase>,
  userId: string,
): Promise<Controllo> {
  const percorso = `${userId}/${SONDAGGIO}`;
  const { error: erroreScrittura } = await client.storage
    .from(BUCKET)
    .upload(percorso, new Blob(["ok"]), { upsert: true });

  if (erroreScrittura) {
    const mancante = bucketMancaDaErrore(erroreScrittura);
    return {
      nome: `Bucket "${BUCKET}"`,
      ok: !mancante,
      dettaglio: mancante
        ? "Il bucket non esiste: la scrittura è stata respinta perché il bucket manca."
        : `Prova di scrittura respinta: ${erroreScrittura.message}`,
      azione: mancante
        ? `Supabase → Storage → Buckets → New bucket, nome esatto "${BUCKET}", Public bucket disattivato.`
        : "Controlla le politiche RLS del bucket: l'utente deve poter scrivere sotto la propria cartella.",
    };
  }

  await client.storage.from(BUCKET).remove([percorso]);
  return {
    nome: `Bucket "${BUCKET}"`,
    ok: true,
    dettaglio: "Bucket presente: scrittura e cancellazione riuscite con il tuo account.",
  };
}

export interface EsitoDiagnostica {
  controlli: Controllo[];
  tuttiOk: boolean;
  /** Controlli che non si possono concludere dalla pagina (serve un account). */
  nonVerificati: number;
}

/**
 * Verifica che il progetto Supabase sia configurato per l'app: endpoint
 * raggiungibile, tipo di chiave corretto, provider Google attivo e bucket
 * presente. Pensata per la pagina Impostazioni e per la dashboard sviluppatore.
 */
export async function verificaIntegrazione(): Promise<EsitoDiagnostica> {
  const controlli: Controllo[] = [];

  // Google Calendar è un collegamento indipendente da Supabase: usa un
  // proprio client OAuth della console Google Cloud. Va controllato per primo
  // perché non dipende dagli altri e deve comparire anche se Supabase manca.
  const clientCalendar = (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined) ?? "";
  controlli.push({
    nome: "Google Calendar",
    ok: true,
    dettaglio: clientCalendar
      ? "Client OAuth configurato."
      : "Non configurato: ogni appuntamento si esporta comunque in formato .ics.",
    azione: clientCalendar
      ? undefined
      : "Google Cloud → APIs and Services → Library → abilita Google Calendar API → crea un client OAuth di tipo Web application e copiane il Client ID in VITE_GOOGLE_CLIENT_ID.",
    nonVerificato: clientCalendar ? true : undefined,
  });

  const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? "";

  if (!url) {
    controlli.push({
      nome: "Endpoint",
      ok: false,
      dettaglio: "VITE_SUPABASE_URL non è impostata.",
      azione: "Copia il Project URL da Supabase → Project Settings → API.",
    });
    return { controlli, tuttiOk: false, nonVerificati: 0 };
  }

  controlli.push({ nome: "Endpoint", ok: true, dettaglio: "Project URL configurato." });

  if (problemaConfigurazione) {
    controlli.push({
      nome: "Chiave API",
      ok: false,
      dettaglio: "La chiave configurata è privilegiata.",
      azione: problemaConfigurazione,
    });
    return { controlli, tuttiOk: false, nonVerificati: 0 };
  }

  controlli.push({
    nome: "Chiave API",
    ok: true,
    dettaglio:
      tipoChiave === "pubblica"
        ? "Chiave pubblica (sb_publishable_), corretta per il browser."
        : "Chiave presente.",
  });

  if (!supabase || !cloudEnabled) {
    controlli.push({
      nome: "Client",
      ok: false,
      dettaglio: "Client Supabase non inizializzato.",
    });
    return { controlli, tuttiOk: false, nonVerificati: 0 };
  }

  // Impostazioni di autenticazione: endpoint pubblico, leggibile anche con
  // la chiave pubblica.
  try {
    const risposta = await fetch(`${url}/auth/v1/settings`, {
      headers: { apikey: (import.meta.env.VITE_SUPABASE_ANON_KEY as string) ?? "" },
    });
    const impostazioni = (await risposta.json()) as { external?: { google?: boolean } };
    const google = impostazioni.external?.google === true;
    controlli.push({
      nome: "Accesso con Google",
      ok: google,
      dettaglio: google
        ? "Provider Google attivo."
        : "Il provider Google è disattivato: l'accesso con Google non può funzionare.",
      azione: google
        ? undefined
        : "Supabase → Authentication → Providers → Google → abilita e inserisci Client ID e Secret di Google Cloud.",
    });
  } catch (errore) {
    controlli.push({
      nome: "Accesso con Google",
      ok: false,
      dettaglio: `Impossibile leggere le impostazioni di autenticazione: ${
        errore instanceof Error ? errore.message : "errore sconosciuto"
      }`,
      azione: "Verifica che VITE_SUPABASE_URL sia corretto e che il progetto sia attivo.",
    });
  }

  const { data: sessione } = await supabase.auth.getSession();
  const userId = sessione?.session?.user?.id;
  if (userId) {
    controlli.push(await verificaBucketAutenticata(supabase, userId));
  } else {
    controlli.push({
      nome: `Bucket "${BUCKET}"`,
      // Non è un esito negativo: è un controllo che da anonimo è impossibile.
      ok: true,
      nonVerificato: true,
      dettaglio: "Non verificabile senza un account: da anonimo un bucket privato e uno inesistente sembrano identici.",
      azione: `Accedi e ricarica questa pagina, oppure controlla con la query:
select id, public from storage.buckets where id = '${BUCKET}';`,
    });
  }

  const nonVerificati = controlli.filter((c) => c.nonVerificato).length;
  return {
    controlli,
    tuttiOk: controlli.every((c) => c.ok) && nonVerificati === 0,
    nonVerificati,
  };
}
