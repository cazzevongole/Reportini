/**
 * La mail di notifica è l'unico posto dove il testo scritto da un utente
 * qualsiasi entra in un documento che un programma di posta aprirà. Qui si
 * prova la parte che decide se quel testo arriva come testo o come HTML.
 *
 * Non si prova la chiamata a Resend: è una rete, e un test che la chiama non
 * verificherebbe niente di quanto accade davvero in produzione. Qui si prova
 * quello che si può sbagliare in silenzio — un escape dimenticato, un
 * destinatario che sparisce, un oggetto illeggibile — perché sono gli errori
 * che nessuno vede finché non è troppo tardi.
 */
import { describe, expect, it } from "vitest";
import {
  costruisciMessaggio,
  indirizziValidi,
  oggetto,
  segretiMancanti,
  sfuggiHtml,
} from "../supabase/functions/notifica-richiesta/corpo.ts";

const RICHIESTA = {
  id: "3f2a",
  tipo: "fix",
  titolo: "La stampa del riepilogo resta bianca",
  corpo: "Apre il PDF e non compare niente.",
  email: "giuseppe@example.it",
  creata: "2026-09-29T10:00:00.000Z",
  destinatari: ["mammarellandrea@gmail.com"],
};

const OPZIONI = { mittente: "Reportini <segnalazioni@reportini.cazzevongole.com>" };

describe("Escape dell'HTML", () => {
  it("neutralizza i caratteri che HTML interpreta", () => {
    expect(sfuggiHtml(`<a href="x">y</a>`)).toBe("&lt;a href=&quot;x&quot;&gt;y&lt;/a&gt;");
    expect(sfuggiHtml("l'app")).toBe("l&#39;app");
  });

  it("sfugge la & per prima, altrimenti rifarebbe gli altri escape", () => {
    // Se si sostituissero gli altri prima della &, da `<` verrebbe fuori
    // `&lt;` e rifacendo la & diventerebbe `&amp;lt;`: l'utente vedrebbe
    // "&lt;" scritto nella mail invece che una parentesi angolare.
    expect(sfuggiHtml("&lt;")).toBe("&amp;lt;");
  });
});

describe("Il titolo dell'utente non può diventare markup", () => {
  it("non lascia passare un link nel titolo", () => {
    const messaggio = costruisciMessaggio(
      { ...RICHIESTA, titolo: '<img src=x onerror="alert(1)">' },
      OPZIONI,
    );
    expect(messaggio).not.toBeNull();
    const html = messaggio?.html ?? "";
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });

  it("non lascia passare un link nel corpo", () => {
    const corpo = 'clicca <a href="https://esempio.it">qui</a>';
    const messaggio = costruisciMessaggio({ ...RICHIESTA, corpo }, OPZIONI);
    expect(messaggio?.html).not.toContain('<a href="https://esempio.it">qui');
    expect(messaggio?.html).toContain("&lt;a href=&quot;https://esempio.it&quot;&gt;qui");
  });

  it("non lascia passare uno script nel corpo", () => {
    const corpo = "<script>alert(1)</script>";
    const messaggio = costruisciMessaggio({ ...RICHIESTA, corpo }, OPZIONI);
    expect(messaggio?.html).not.toContain("<script>");
  });

  it("l'unico collegamento è quello alla sezione sviluppo", () => {
    // È il punto della mail: l'utente non deve poter mettere un link che
    // somiglia a quello vero e portare chi legge da un'altra parte.
    const collegamenti = [
      ...(costruisciMessaggio(RICHIESTA, OPZIONI)?.html ?? "").matchAll(/href="([^"]*)"/g),
    ].map((m) => m[1]);
    expect(collegamenti).toEqual(["https://reportini.cazzevongole.com/panel/sviluppo"]);
  });
});

describe("L'oggetto", () => {
  it("dice di che tipo è la richiesta e porta il titolo", () => {
    expect(oggetto(RICHIESTA)).toBe(
      "Reportini · Qualcosa non va: La stampa del riepilogo resta bianca",
    );
    expect(oggetto({ ...RICHIESTA, tipo: "funzionalita" })).toContain("Mi serve che si possa fare");
  });

  it("accorcia un titolo lunghissimo invece di far esplodere la riga", () => {
    const lungo = "a".repeat(200);
    const oggettoLungo = oggetto({ ...RICHIESTA, titolo: lungo });
    expect(oggettoLungo.length).toBeLessThanOrEqual(100);
    expect(oggettoLungo.endsWith("…")).toBe(true);
  });

  it("tiene conto anche del prefisso, non solo del titolo", () => {
    // L'etichetta di "funzionalita" è il prefisso più lungo: se il tetto
    // valesse solo sul titolo, l'oggetto passerebbe le duecento caratteri
    // che la casella mostra e nasconderebbe il resto.
    const oggettoLungo = oggetto({ ...RICHIESTA, tipo: "funzionalita", titolo: "a".repeat(200) });
    expect(oggettoLungo.length).toBeLessThanOrEqual(100);
    expect(oggettoLungo.endsWith("…")).toBe(true);
  });

  it("non si rompe con un titolo vuoto o con un tipo sconosciuto", () => {
    // Arriverebbero da una richiesta scritta a mano o da una versione futura:
    // meglio un oggetto generico che un'eccezione, perché l'eccezione
    // costerebbe l'avviso.
    expect(oggetto({ titolo: "   " })).toBe("Reportini · Richiesta");
    expect(oggetto({ titolo: "x", tipo: "futuro" })).toBe("Reportini · Richiesta: x");
  });
});

describe("I destinatari", () => {
  it("tiene solo gli indirizzi che sono indirizzi", () => {
    expect(
      indirizziValidi([
        "uno@example.it",
        "non-una-mail",
        "due@example.it",
        "vuoto@",
        "@senza-nome.it",
        "con spazio@example.it",
      ]),
    ).toEqual(["uno@example.it", "due@example.it"]);
  });

  it("non lascia iniettare altri destinatari con una virgola", () => {
    // Il caso che vale la riga: un elenco che qualcosa ci mette dentro una
    // virgola, e la funzione manda la mail anche a chi non l'ha scritta.
    expect(indirizziValidi(["a@example.it, b@example.it"])).toEqual([]);
    expect(indirizziValidi(["a@example.it", "b@example.it"])).toEqual([
      "a@example.it",
      "b@example.it",
    ]);
  });

  it("elimina i doppioni, perché due righe nella tabella non sono due caselle", () => {
    expect(indirizziValidi(["a@example.it", "A@Example.it"])).toEqual(["a@example.it"]);
  });

  it("non lascia crescere la lista senza fine", () => {
    const molti = Array.from({ length: 50 }, (_, i) => `utente${i}@example.it`);
    expect(indirizziValidi(molti)).toHaveLength(20);
  });
});

describe("Il messaggio", () => {
  it("va a chi sviluppa e risponde all'utente che ha scritto", () => {
    const messaggio = costruisciMessaggio(RICHIESTA, OPZIONI);
    expect(messaggio?.a).toEqual(["mammarellandrea@gmail.com"]);
    expect(messaggio?.rispondiA).toBe("giuseppe@example.it");
  });

  it("senza un indirizzo dell'utente parte senza rispondiA, non con uno vuoto", () => {
    // Una sessione Google può non avere l'email: dichiarare come destinatario
    // di risposta una stringa vuota fa fallire l'invio per tutti.
    const messaggio = costruisciMessaggio({ ...RICHIESTA, email: "" }, OPZIONI);
    expect(messaggio).not.toBeNull();
    expect(messaggio && "rispondiA" in messaggio).toBe(false);
  });

  it("non parte se non c'è nessuno a cui mandarla", () => {
    // Tabella sviluppatori vuota: la richiesta è comunque salvata e si legge
    // nella sezione nascosta, quindi nessun errore e nessuna coda da gestire.
    expect(costruisciMessaggio({ ...RICHIESTA, destinatari: [] }, OPZIONI)).toBeNull();
    expect(costruisciMessaggio({ ...RICHIESTA, destinatari: ["rotta"] }, OPZIONI)).toBeNull();
  });

  it("ha una parte in testo per i programmi che non leggono l'HTML", () => {
    // Gmail sul telefono e la notifica del sistema possono mostrare solo il
    // testo: senza, l'utente vede il titolo e niente il resto.
    const testo = costruisciMessaggio(RICHIESTA, OPZIONI)?.testo ?? "";
    expect(testo).toContain(RICHIESTA.titolo);
    expect(testo).toContain(RICHIESTA.corpo);
    expect(testo).toContain("giuseppe@example.it");
    expect(testo).toContain("https://reportini.cazzevongole.com/panel/sviluppo");
  });

  it("mette la sezione sviluppo nell'indirizzo indicato dal sito", () => {
    // L'app desktop e un eventuale dominio diverso devono arrivare alla sezione
    // giusta senza toccare il codice.
    const messaggio = costruisciMessaggio(RICHIESTA, {
      ...OPZIONI,
      sito: "https://reportini.cazzevongole.com/",
    });
    expect(messaggio?.html).toContain("https://reportini.cazzevongole.com/panel/sviluppo");
    // La barra finale non deve raddoppiare lo slash: doppio slash su alcuni
    // server è un'altra pagina, e su altri un errore.
    expect(messaggio?.html).not.toContain("com//panel");
  });
});

describe("I segreti che servono", () => {
  const COMPLETI = {
    RESEND_API_KEY: "re_1",
    RESEND_MITTENTE: "Reportini <segnalazioni@cazzevongole.com>",
    SUPABASE_URL: "https://esempio.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "sb_secret_1",
  };

  it("non manca niente quando la funzione è stata pubblicata come si deve", () => {
    expect(segretiMancanti(COMPLETI)).toEqual([]);
  });

  it("elenca per nome ciò che manca", () => {
    // Un 503 che dice solo «manca qualcosa» fa perdere il tempo a cercare il
    // segreto nel posto sbagliato: i due che mancano sono quasi sempre la
    // chiave di Resend e il mittente non verificato.
    const { RESEND_API_KEY: _, RESEND_MITTENTE: __, ...incompleti } = COMPLETI;
    expect(segretiMancanti(incompleti)).toEqual(["RESEND_API_KEY", "RESEND_MITTENTE"]);
  });

  it("chiede anche quelli per cui parlare al database", () => {
    // Sono quelli che inietta Supabase, non uno che si carica a mano: senza
    // di loro la funzione non può chiedere se la chiave sia buona, e una
    // funzione che non può chiedere deve dirlo invece di accettare.
    expect(
      segretiMancanti({
        RESEND_API_KEY: "re_1",
        RESEND_MITTENTE: "Reportini <a@example.it>",
      }),
    ).toEqual(["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]);
  });

  it("non si accontenta di una stringa vuota", () => {
    // Un secret impostato a stringa vuota è un secret che non c'è: la
    // funzione deve accorgersene prima di chiamare Resend e riceverne un
    // errore che parla d'API.
    expect(segretiMancanti({ ...COMPLETI, RESEND_API_KEY: "" })).toEqual(["RESEND_API_KEY"]);
  });
});

/* ----------------------------- la mail di chiusura ------------------------ */

/**
 * La mail di chiusura va all'utente che ha scritto la richiesta, non agli
 * sviluppatori: sono due lati opposti della stessa conversazione e mandare
 * il messaggio sbagliato significa che lo sviluppatore riceve la risposta
 * che ha appena scritto, e l'utente non riceve niente.
 */
const CHIUSURA = {
  modo: "chiusura" as const,
  id: "3f2a",
  tipo: "fix",
  titolo: "La stampa del riepilogo resta bianca",
  corpo: "Apre il PDF e non compare niente.",
  email: "anna@esempio.it",
  risposta: "Corretto: il riepilogo ora include l'azienda.",
  creata: "2026-10-01 10:00",
  chiusa: "2026-10-02 09:00",
};

describe("La mail di chiusura", () => {
  it("va all'utente che ha scritto la richiesta", () => {
    const messaggio = costruisciMessaggio(CHIUSURA, { mittente: "Reportini <segnalazioni@x.it>" });
    expect(messaggio?.a).toEqual(["anna@esempio.it"]);
  });

  it("non usa la lista degli sviluppatori", () => {
    // Il trigger di chiusura non manda `destinatari`, e se lo facesse
    // andrebbe a leggere la tabella sbagliata: la prova è che il
    // destinatario esiste anche senza quella lista.
    const messaggio = costruisciMessaggio(CHIUSURA, { mittente: "Reportini <segnalazioni@x.it>" });
    expect(messaggio?.a).not.toContain("dev@esempio.it");
  });

  it("porta la risposta dello sviluppatore, che è la notizia", () => {
    const messaggio = costruisciMessaggio(CHIUSURA, { mittente: "Reportini <segnalazioni@x.it>" });
    // Nel testo piano la risposta è quella scritta, apostrofo compreso.
    expect(messaggio?.testo).toContain("Corretto: il riepilogo ora include l'azienda.");
    // Nell'HTML gli stessi caratteri sono le entità: confrontare la stringa
    // grezza fallirebbe per l'apostrofo, che qui è `&#39;`. Il punto del
    // confronto è che la risposta c'è, non che resti identica.
    expect(messaggio?.html).toContain("Corretto: il riepilogo ora include l&#39;azienda.");
  });

  it("non parte se l'utente non ha un indirizzo", () => {
    // Una sessione Google può non dare l'email. Senza destinatario la mail
    // non parte: meglio che partire e rimbalzare, che è quello che fa
    // `indirizziValidi` anche nella mail d'avviso.
    const messaggio = costruisciMessaggio(
      { ...CHIUSURA, email: "" },
      { mittente: "Reportini <segnalazioni@x.it>" },
    );
    expect(messaggio).toBeNull();
  });

  it("senza risposta scritta dice lo stesso, invece di mandare una mail vuota", () => {
    // Chiudere senza scrivere è una richiesta chiusa senza spiegazione, e
    // una mail vuota si legge come un errore dell'invio.
    const messaggio = costruisciMessaggio(
      { ...CHIUSURA, risposta: null },
      { mittente: "Reportini <segnalazioni@x.it>" },
    );
    expect(messaggio?.testo).toContain("senza una risposta scritta");
  });

  it("sfuggia la risposta come ogni altro testo", () => {
    // La risposta viene dal database e finisce in una mail che un programma
    // di posta apre: senza escape, un `<a href>` scritto in una risposta
    // diventa un collegamento cliccabile.
    const messaggio = costruisciMessaggio(
      { ...CHIUSURA, risposta: "Prova <a href='https://esempio.it'>Segui</a>" },
      { mittente: "Reportini <segnalazioni@x.it>" },
    );
    expect(messaggio?.html).toContain("&lt;a href=");
    expect(messaggio?.html).not.toContain("<a href='https://esempio.it'>");
  });

  it("dice risolta, non chiusa, che è la parola che l'utente ha visto", () => {
    expect(oggetto(CHIUSURA)).toContain("risolta");
  });

  it("senza modo resta la mail d'avviso, per un trigger vecchio", () => {
    // Chi ha eseguito lo script vecchio e non lo ha rigenerato ha ancora il
    // trigger che non manda `modo`: deve continuare a funzionare.
    const { modo: _modo, ...senzaModo } = CHIUSURA;
    const messaggio = costruisciMessaggio(
      { ...senzaModo, destinatari: ["dev@esempio.it"] },
      { mittente: "Reportini <segnalazioni@x.it>" },
    );
    expect(messaggio?.a).toEqual(["dev@esempio.it"]);
  });
});
