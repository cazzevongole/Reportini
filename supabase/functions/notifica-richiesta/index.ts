// =============================================================================
// Reportini · avviso per mail delle richieste degli utenti (Supabase Edge Function)
//
// Cosa fa. Quando un utente scrive dalla sezione «Chiedilo allo sviluppatore»,
// il database chiama questa funzione e questa funzione manda una mail a
// chi sviluppa l'app. Nient'altro: la richiesta resta nella tabella
// `richieste`, che è la sua casa, e la sezione nascosta continua a essere il
// posto in cui si legge e si risponde. La mail è un avviso, non un archivio.
//
// Perché la chiama il database e non il browser. Se la chiamasse il browser, il
// messaggio partirebbe solo se la scheda restasse aperta un secondo dopo
// l'invio: sono due secondi che nessuno garantisce, e una richiesta che non
// parte non lascia traccia. Il trigger in `supabase/notifica-richieste.sql`
// parte invece dalla riga appena scritta, quindi arriva anche se l'utente ha
// già chiuso la scheda o il browser è andato in crash.
//
// Perché questa funzione non chiede la sessione. `pg_net` chiama dal
// database e non ha un JWT da mostrare, quindi la funzione va pubblicata con
// `--no-verify-jwt`. Il prezzo sarebbe una porta aperta a chiunque: chi trova
// l'URL potrebbe mandare a chi sviluppa mail a suo nome, e ripeterlo fino a
// riempire la casella di utenti che non hanno scritto niente. Il rimedio è la
// chiave condivisa: il trigger la prende dal Vault, questa funzione la
// confronta con il proprio segreto, e senza quella coppia la richiesta non
// esce. La chiave non sta nel repository (il SQL la legge dal Vault a runtime)
// e non sta nel bundle.
//
// Destinatari. Li manda il trigger, non questa funzione: sono gli indirizzi
// della tabella `sviluppatori`, gli stessi che decidono chi può vedere la
// sezione nascosta. Una casella in più si aggiunge con una riga, senza toccare
// codice e senza deploy.
//
// Deploy (una volta sola):
//   supabase functions deploy notifica-richiesta --no-verify-jwt
//   supabase secrets set RESEND_API_KEY=<chiave Resend>
//   supabase secrets set NOTIFICA_CHIAVE=<stringa lunga e casuale>
//   supabase secrets set RESEND_MITTENTE=Reportini <segnalazioni@dominio.verificato>
//   supabase secrets set SITO_URL=https://reportini.cazzevongole.com
//
// Poi, una volta sola anche lui, il trigger:
//   supabase/notifica-richieste.sql
//
// Sul mittente: Resend accetta la posta solo da un dominio verificato (o dal
// proprio indirizzo di prova, che può scrivere solo a chi ha l'account). Se la
// funzione risponde 502 con `domain is not verified`, il problema è lì e non
// qui: si verifica il dominio su Resend e si ricarica `RESEND_MITTENTE`.

import { costruisciMessaggio, type RichiestaNotifica } from "./corpo.ts";

const ORIGINE_RESEND = "https://api.resend.com/emails";

interface Env {
  /** Chiave dell'API di Resend. */
  RESEND_API_KEY?: string;
  /** La metà della coppia col Vault: senza, non si accetta nessuna chiamata. */
  NOTIFICA_CHIAVE?: string;
  /** Mittente, nella forma `Nome <indirizzo>`. */
  RESEND_MITTENTE?: string;
  /** Dove si risponde: la sezione sviluppo. */
  SITO_URL?: string;
}

/** L'intestazione che il trigger manda, e nessun'altra. */
const INTESTAZIONE_CHIAVE = "x-reportini-notifica";

/**
 * Confronto a tempo costante.
 *
 * Il segreto è una stringa, non una chiave crittografica: il confronto
 * "semplice" sarebbe già abbastanza, ma questo costa quattro righe e toglie
 * una classe di domande ("è davvero uguale?") dalla discussione. La lunghezza
 * si controlla prima, perché su stringhe di lunghezza diversa l'uscita
 * "tempo costante" non avrebbe senso.
 */
function confrontoCostante(atteso: string, ricevuto: string): boolean {
  if (atteso.length !== ricevuto.length) return false;
  let differenze = 0;
  for (let i = 0; i < atteso.length; i++) {
    differenze |= atteso.charCodeAt(i) ^ ricevuto.charCodeAt(i);
  }
  return differenze === 0;
}

/**
 * La chiamata arriva dal database?
 *
 * Se `NOTIFICA_CHIAVE` non è impostata non si accetta *nessuna* richiesta,
 * nemmeno quelle senza intestazione: una funzione appena pubblicata senza
 * segreti che rispondesse "va bene" a chiunque sarebbe una porta spalancata,
 * e il sintomo (mail a chi non ha scritto niente) comparirebbe solo dopo.
 */
function chiamataAutorizzata(richiesta: Request, env: Env): boolean {
  const atteso = env.NOTIFICA_CHIAVE ?? "";
  if (!atteso) return false;
  return confrontoCostante(atteso, richiesta.headers.get(INTESTAZIONE_CHIAVE) ?? "");
}

function json(corpo: unknown, stato: number): Response {
  return new Response(JSON.stringify(corpo), {
    status: stato,
    headers: { "Content-Type": "application/json" },
  });
}

Deno.serve(async (richiesta: Request): Promise<Response> => {
  const env = Deno.env.toObject() as unknown as Env;

  if (richiesta.method !== "POST") {
    return json({ errore: "Serve un POST." }, 405);
  }

  const mancanti = [
    env.RESEND_API_KEY ? "" : "RESEND_API_KEY",
    env.NOTIFICA_CHIAVE ? "" : "NOTIFICA_CHIAVE",
    env.RESEND_MITTENTE ? "" : "RESEND_MITTENTE",
  ].filter(Boolean);
  if (mancanti.length > 0) {
    // 503 e non 500: non è un bug, è una funzione pubblicata senza segreti.
    return json(
      {
        errore:
          `Avviso per le richieste non pronto: manca ${mancanti.join(" e ")}. ` +
          'Caricali con "supabase secrets set <NOME>=<valore>".',
      },
      503,
    );
  }

  // 401 senza corpo: a chi non è il database non serve sapere quale sia il
  // segreto, né quante richieste mancano per indovinarlo a forza.
  if (!chiamataAutorizzata(richiesta, env)) {
    console.error("notifica-richiesta: chiamata senza chiave valida");
    return json({ errore: "Chiamata non autorizzata." }, 401);
  }

  let notifica: RichiestaNotifica;
  try {
    notifica = (await richiesta.json()) as RichiestaNotifica;
  } catch {
    return json({ errore: "Corpo della richiesta non leggibile." }, 400);
  }

  const messaggio = costruisciMessaggio(notifica, {
    mittente: env.RESEND_MITTENTE as string,
    sito: env.SITO_URL,
  });

  // Nessuno sviluppatore in lista: la richiesta è comunque nel database, e
  // nessuno si mette a scrivere codice per una lista vuota.
  if (!messaggio) return json({ inviata: false, motivo: "nessun destinatario" }, 200);

  try {
    const risposta = await fetch(ORIGINE_RESEND, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: messaggio.da,
        to: messaggio.a,
        subject: messaggio.oggetto,
        text: messaggio.testo,
        html: messaggio.html,
        ...(messaggio.rispondiA ? { reply_to: messaggio.rispondiA } : {}),
      }),
    });
    const dati = await risposta.json().catch(() => ({}));

    if (!risposta.ok) {
      console.error("notifica-richiesta: Resend ha rifiutato", risposta.status, dati);
      // 502 come in google-token: il client (qui il database) distingue
      // "provider giù o che rifiuta" da "richiesta malformata".
      return json(
        {
          errore: "Resend ha rifiutato la mail.",
          dettaglio: dati?.message ?? dati?.name ?? `HTTP ${risposta.status}`,
        },
        502,
      );
    }

    // Il corpo della risposta suona nella pagina del database, non in una
    // casella: un id serve a chi legge `net._http_response` per capire che
    // l'invio è andato e non è stato solo accettato.
    return json({ inviata: true, a: messaggio.a, id: dati?.id ?? null }, 200);
  } catch (causa) {
    console.error("notifica-richiesta:", causa);
    return json({ errore: "Provider di posta non raggiungibile." }, 502);
  }
});