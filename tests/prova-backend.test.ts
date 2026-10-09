/**
 * La prova del backend pubblicato.
 *
 * Qui si esercita il giudizio, non la rete: ogni caso è un backend che
 * risponde qualcosa di diverso da quello che deve, e il test dice se il
 * controllo se ne accorge. I casi non sono inventati — sono quelli già visti:
 * la funzione non pubblicata (404), il preflight che torna con l'origine di
 * ripiego, i segreti vuoti (503), il rinnovo che risponde a chi non ha una
 * sessione.
 *
 * Il caso più insidioso è quello del client: un `client_secret` sbagliato
 * produce anche lui un 400, quindi un controllo che guardasse solo lo stato
 * direbbe "va tutto bene" con il calendario rotto.
 */
import { describe, expect, it } from "vitest";
import { prove, problemi, type Esito, type Prova } from "../scripts/prova-backend.mjs";

const FUNZIONE = "https://progetto.supabase.co/functions/v1/google-token";
const ORIGINE = "https://reportini.cazzevongole.com";
const DESKTOP = "http://127.0.0.1:42720";
const ESTRANEA = "https://estraneo.example";

/** Una risposta cambiata rispetto a quella sana, o una richiesta che non parte. */
type Cambio = Partial<Esito> & { errore?: string };

/** Come si riconosce ogni sonda: l'inizio del nome, che è anche il messaggio letto. */
const CHIAVI = {
  pubblicata: "La funzione è pubblicata",
  preflightSito: "Il preflight risponde al sito",
  preflightDesktop: "Il preflight risponde all'app desktop",
  preflightEstranea: "Un'origine estranea non riceve l'eco",
  scambio: "Lo scambio arriva fino a Google",
  rinnovo: "Il rinnovo pretende un account",
} as const;

type Chiave = keyof typeof CHIAVI;

const SONDE: Prova[] = prove({
  funzione: FUNZIONE,
  origine: ORIGINE,
  origineLocale: DESKTOP,
  origineEstranea: ESTRANEA,
});

function risposta(
  stato: number,
  corpo: unknown = {},
  intestazioni: Record<string, string> = {},
): Esito {
  return { stato, corpo, testo: JSON.stringify(corpo), intestazioni };
}

/** Un backend che risponde bene a tutto: da qui parte ogni scenario. */
const BENE: Record<Chiave, Esito> = {
  pubblicata: risposta(405, { errore: "Serve un POST." }),
  preflightSito: risposta(204, {}, { "access-control-allow-origin": ORIGINE }),
  preflightDesktop: risposta(204, {}, { "access-control-allow-origin": DESKTOP }),
  // L'origine estranea non riceve la sua eco: torna quella di ripiego.
  preflightEstranea: risposta(204, {}, { "access-control-allow-origin": ORIGINE }),
  scambio: risposta(400, { errore: "Malformed auth code." }),
  rinnovo: risposta(401, { errore: "Serve un account Reportini per questa operazione." }),
};

function provaDi(chiave: Chiave): Prova {
  const sonda = SONDE.find((p) => p.nome.startsWith(CHIAVI[chiave]));
  if (!sonda) throw new Error(`la prova "${CHIAVI[chiave]}" non esiste più`);
  return sonda;
}

/** I problemi con una o più risposte cambiate rispetto a un backend sano. */
function verifica(cambi: Partial<Record<Chiave, Cambio>> = {}): string[] {
  return problemi(
    (Object.keys(CHIAVI) as Chiave[]).map((chiave) => ({
      prova: provaDi(chiave),
      esito: { ...BENE[chiave], ...cambi[chiave] },
    })),
  );
}

describe("La prova del backend pubblicato", () => {
  it("non segnala nulla quando il backend è quello che deve essere", () => {
    expect(verifica()).toEqual([]);
  });

  it("una funzione non pubblicata è un 404, e viene detto cosa fare", () => {
    const trovati = verifica({ pubblicata: risposta(404, { code: "NOT_FOUND" }) }).join("\n");
    expect(trovati).toMatch(/non risulta pubblicata/);
    expect(trovati).toMatch(/supabase functions deploy google-token/);
  });

  it("una funzione che risponde altro non passa per pubblicata", () => {
    const trovati = verifica({ pubblicata: risposta(405, { errore: "Serve un GET." }) }).join("\n");
    expect(trovati).toMatch(/invece di "Serve un POST\./);
  });

  it("il preflight con l'origine di ripiego ferma l'app nel browser", () => {
    // Il caso vero: la funzione risponde 204 anche a un'origine che non
    // conosce, quindi da curl il preflight sembra a posto e nel browser
    // nessuna richiesta passa.
    const trovati = verifica({
      preflightSito: risposta(
        204,
        {},
        { "access-control-allow-origin": "https://vecchio.example" },
      ),
    }).join("\n");
    expect(trovati).toMatch(/invece di "https:\/\/reportini\.cazzevongole\.com"/);
    expect(trovati).toMatch(/ORIGINI_AMMESSE/);
  });

  it("il pacchetto desktop ha bisogno che le origini in loopback restino ammesse", () => {
    const trovati = verifica({
      preflightDesktop: risposta(204, {}, { "access-control-allow-origin": ORIGINE }),
    }).join("\n");
    expect(trovati).toMatch(/loopback/);
  });

  it("un'origine estranea che riceve l'eco vuol dire che il backend è aperto a chiunque", () => {
    const trovati = verifica({
      preflightEstranea: risposta(204, {}, { "access-control-allow-origin": ESTRANEA }),
    }).join("\n");
    expect(trovati).toMatch(/qualunque sito/);
  });

  it("i segreti mancanti si vedono dallo scambio, non solo dai log di Supabase", () => {
    const trovati = verifica({
      scambio: risposta(503, { errore: "Backend Google non pronto: manca GOOGLE_CLIENT_SECRET." }),
    }).join("\n");
    expect(trovati).toMatch(/i segreti non sono caricati/);
    expect(trovati).toMatch(/GOOGLE_CLIENT_SECRET/);
  });

  it("un client id e un secret di due client diversi non passano per un successo", () => {
    const trovati = verifica({
      scambio: risposta(400, { errore: "The OAuth client was not found." }),
    }).join("\n");
    expect(trovati).toMatch(/Google non riconosce il client/);
    expect(trovati).toMatch(/GOOGLE_CLIENT_ID/);
  });

  it("un redirect_uri non registrato in Google viene nominato", () => {
    const trovati = verifica({
      scambio: risposta(400, { errore: "redirect_uri_mismatch" }),
    }).join("\n");
    expect(trovati).toMatch(/redirect_uri_mismatch/);
  });

  it("uno scambio che risponde 200 a un codice finto non è un successo", () => {
    const trovati = verifica({ scambio: risposta(200, { id_token: "id-token" }) }).join("\n");
    expect(trovati).toMatch(/invece del rifiuto di un codice finto/);
  });

  it("un rinnovo che risponde a chi non ha una sessione è un buco", () => {
    const trovati = verifica({
      rinnovo: risposta(200, { access_token: "ya29.appena-rinnovato" }),
    }).join("\n");
    expect(trovati).toMatch(/deve pretendere una sessione/);
  });

  it("una richiesta che non parte è un problema, e la causa si legge", () => {
    const trovati = verifica({ pubblicata: { errore: "fetch failed" } }).join("\n");
    expect(trovati).toMatch(/la richiesta non è arrivata \(fetch failed\)/);
  });
});
