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
// riempire la casella di utenti che non hanno scritto niente. Il rimedio è una
// chiave: il trigger la prende dal Vault e la manda nell'intestazione
// `x-reportini-notifica`.
//
// La chiave sta in un posto solo, il Vault. Questa funzione non ne ha una
// copia: riporta al database quella che ha ricevuto e gli chiede, con
// `notifica_chiave_valida`, se è ancora quella valida. Prima la copia esisteva
// anche come secret della funzione, ed è stato proprio quello il difetto: le
// due copie potevano divergere e l'unico sintomo era un `401` che non diceva
// se l'intestazione non era arrivata o se erano diverse. Una copia sola
// elimina la metà di quel dubbio e rende l'altra metà verificabile.
//
// La chiave non sta nel repository, non sta nel bundle e non sta in nessun
// secret: il repository contiene il nome sotto cui cercarla, non il valore.
//
// Destinatari. Li manda il trigger, non questa funzione: sono gli indirizzi
// della tabella `sviluppatori`, gli stessi che decidono chi può vedere la
// sezione nascosta. Una casella in più si aggiunge con una riga, senza toccare
// codice e senza deploy.
//
// Deploy (una volta sola):
//   supabase functions deploy notifica-richiesta --no-verify-jwt
//   supabase secrets set RESEND_API_KEY=<chiave Resend>
//   supabase secrets set RESEND_MITTENTE=Reportini <segnalazioni@dominio.verificato>
//   supabase secrets set SITO_URL=https://reportini.cazzevongole.com
//
// Poi, una volta sola anche lui, il trigger, che è dove sta la chiave:
//   supabase/notifica-richieste.sql
//
// Nessun secret NOTIFICA_CHIAVE: se ne trova uno da un setup precedente si può
// cancellare, non è più letto da niente.
//
// Sul mittente: Resend accetta la posta solo da un dominio verificato (o dal
// proprio indirizzo di prova, che può scrivere solo a chi ha l'account). Se la
// funzione risponde 502 con `domain is not verified`, il problema è lì e non
// qui: si verifica il dominio su Resend e si ricarica `RESEND_MITTENTE`.

import { costruisciMessaggio, segretiMancanti, type RichiestaNotifica, type Segreti } from "./corpo.ts";

const ORIGINE_RESEND = "https://api.resend.com/emails";

type Env = Segreti;

/** L'intestazione che il trigger manda, e nessun'altra. */
const INTESTAZIONE_CHIAVE = "x-reportini-notifica";

/** La funzione SQL che sa se una chiave è ancora quella buona. */
const RPC_CHIAVE = "notifica_chiave_valida";

/** Cosa è venuto a dire il database sulla chiave ricevuta. */
type Verdetto = "accettata" | "rifiutata" | "non_verificabile";

/**
 * Il database decide, non questa funzione.
 *
 * `false` e un errore sono due risposte diverse: `false` vuol dire che la
 * chiave non è quella (401, la chiamata non esce), un errore vuol dire che non
 * si è potuto chiedere (503, la funzione è viva ma non può decidere). Il
 * secondo caso è quello in cui un `401` sarebbe bugiardo: si punirebbe il
 * chiamante per un problema nostro.
 */
async function verificaChiave(ricevuta: string, env: Env): Promise<Verdetto> {
  const chiave = env.SUPABASE_SERVICE_ROLE_KEY as string;
  const risposta = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/${RPC_CHIAVE}`, {
    method: "POST",
    headers: {
      apikey: chiave,
      Authorization: `Bearer ${chiave}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ p: ricevuta }),
  });
  if (!risposta.ok) return "non_verificabile";
  return (await risposta.json()) === true ? "accettata" : "rifiutata";
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

  const mancanti = segretiMancanti(env);
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

  const ricevuta = richiesta.headers.get(INTESTAZIONE_CHIAVE) ?? "";
  let verdetto: Verdetto;
  try {
    verdetto = await verificaChiave(ricevuta, env);
  } catch (causa) {
    console.error("notifica-richiesta: il database non risponde", causa);
    verdetto = "non_verificabile";
  }

  if (verdetto === "non_verificabile") {
    // Quasi sempre è il file SQL non eseguito: `notifica_chiave_valida` non
    // esiste e PostgREST risponde 404. Il corpo lo dice, perché un 503 qui
    // sembrerebbe un segreto mancante e porterebrebbe a cercarlo nel posto
    // sbagliato.
    console.error("notifica-richiesta: il database non sa verificare la chiave");
    return json(
      {
        errore:
          `Il database non espone ${RPC_CHIAVE}(). ` +
          "Esegui supabase/notifica-richieste.sql nella console SQL.",
      },
      503,
    );
  }

  if (verdetto === "rifiutata") {
    // Il 401 non dice nulla a chi lo riceve, di proposito: a chi non è il
    // database non serve sapere quale sia la chiave, né quante richieste
    // mancano per indovinarla a forza. Nel log invece ci finisce la lunghezza
    // di quello che è arrivato, che è la differenza fra «l'intestazione non è
    // arrivata» (zero caratteri) e «è arrivata ma il Vault ne contiene un
    //'altra»: due problemi che fino a poco tempo fa erano indistinguibili.
    console.error(
      `notifica-richiesta: chiave rifiutata dal database, ${ricevuta.length} caratteri ricevuti`,
    );
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