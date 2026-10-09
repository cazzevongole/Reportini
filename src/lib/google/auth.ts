/**
 * Accesso con Google, calendario incluso.
 *
 * Perché serve un backend. Un'app ospitata su GitHub Pages è un client
 * pubblico: non ha dove custodire un client_secret. E Google lo pretende
 * **sia** per scambiare l'authorization code **sia** per rinnovare il token,
 * anche in PKCE. Provato sull'endpoint reale:
 *
 *   POST https://oauth2.googleapis.com/token
 *   → {"error":"invalid_request","error_description":"client_secret is missing."}
 *
 * Mettere il secret nel bundle lo darebbe a chiunque, quindi il pezzo che
 * manca è un piccolo backend che lo custodisce: la Supabase Edge Function
 * `google-token` (supabase/functions/google-token).
 *
 * **Un solo accesso, un solo consenso.** L'app porta sé stessa all'authorize
 * di Google chiedendo lo scope del profilo *e* quello del calendario in una
 * volta sola. Al ritorno lo `id_token` passa a Supabase con
 * `signInWithIdToken` — che lo valida con lo stesso Client ID configurato nel
 * progetto, ed è quello che apre la sessione — e i token del calendario
 * restano all'app, che li rinnova in silenzio quando scadono.
 *
 * Perché funziona solo così: se l'accesso lo facesse Supabase, il profilo e
 * il calendario sarebbero due richieste OAuth diverse, e l'utente vedrebbe
 * due schermate di consenso. In più il token che Supabase restituisce non ha
 * un refresh token, quindi dopo un'ora l'app non potrebbe rinnovare nulla.
 *
 * Se il backend non è pronto l'accesso **non si blocca**: l'app ripiega
 * sull'accesso con Supabase da sola e dice, nelle impostazioni, cosa è
 * successo.
 */

import { supabase } from "../cloud/supabase";
import { baseRoutte, motivoRientroNonValido, urlDiRitorno } from "../cloud/destinazione";

const TOKEN_KEY = "reportini.google.token";
const PROFILE_KEY = "reportini.google.profile";
const ERRORE_KEY = "reportini.google.errore";
/** Fra l'authorize e il ritorno: cosa stavamo facendo e con quale state. */
const RITORNO_KEY = "reportini.google.ritorno";

/**
 * Il rientro che il pacchetto desktop ha ricevuto, in attesa di chi lo chiede.
 *
 * **Perché non sta nella pagina.** Prima il main lo scriveva nella
 * `sessionStorage` della finestra e poi la ricaricava, contando che a leggerlo
 * fosse il documento nuovo. Non era vero: `finestra.show()` e `finestra.focus()`
 * svegliano il documento che c'è già — supabase-js risponde a `visibilitychange`
 * con un `SIGNED_IN` — e la finestra dell'app se lo prendeva da sotto il naso.
 * Così lo scambio partiva da un documento che stava per sparire: la richiesta
 * veniva uccisa dal ricaricamento, senza un messaggio in console, e l'app finiva
 * per dire "backend non raggiungibile" e rifare un accesso che non serviva. Nei
 * log della funzione, di quella richiesta non è arrivato niente.
 *
 * Adesso il rientro resta nel main process (`electron/main.cjs`, che lo consegna
 * sul canale `google:arrivo`) e il renderer lo chiede quando è pronto: chi lo
 * chiede lo consuma, e a chiederlo è solo il documento che vive. L'URL resta
 * pulito per il motivo che spiega `cERitornoDaChiudere`.
 */
let arrivoDesktop = "";

/** Il main ha consegnato il rientro: da qui in poi lo legge `completaAccesso`. */
export function impostaArrivoDesktop(query: string | null): void {
  arrivoDesktop = query ?? "";
}

const PROFILE_ENDPOINT = "https://www.googleapis.com/oauth2/v3/userinfo";
const AUTHORIZE_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";

/** Scope necessario a creare e aggiornare eventi. */
export const SCOPO_CALENDARIO = "https://www.googleapis.com/auth/calendar.events";
/** Profilo e identità: senza questi non c'è `id_token`, quindi non c'è sessione. */
export const SCOPO_PROFILO = "openid email profile";

const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? "";
/** Il client id è pubblico per definizione: è il secret a stare nel backend. */
export const clientId = (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined) ?? "";
const FUNZIONE = SUPABASE_URL ? `${SUPABASE_URL}/functions/v1/google-token` : "";

export interface GoogleProfile {
  email: string;
  name: string;
  picture?: string;
}

export interface StoredToken {
  accessToken: string;
  /**
   * Senza questo l'access token muore dopo un'ora e non si rinnova: è la
   * differenza fra "l'utente deve ricollegarsi" e "non se ne accorge".
   */
  refreshToken: string | null;
  /** Epoch ms. I token Google durano un'ora. */
  expiresAt: number;
}

/**
 * Il calendario è integrato nell'accesso, non è una delle sue parti
 * accessorie: senza backend l'app entra comunque, ma questa parte manca.
 */
export const googleConfigured = Boolean(supabase && clientId);

/* ------------------------------- persistenza ------------------------------ */

function leggiToken(): StoredToken | null {
  try {
    const raw = localStorage.getItem(TOKEN_KEY);
    if (!raw) return null;
    const token = JSON.parse(raw) as Partial<StoredToken>;
    if (!token.accessToken) return null;
    return {
      accessToken: token.accessToken,
      refreshToken: token.refreshToken ?? null,
      expiresAt: token.expiresAt ?? 0,
    };
  } catch {
    return null;
  }
}

export function readToken(): StoredToken | null {
  return leggiToken();
}

function scriviToken(accessToken: string, refreshToken: string | null, expiresIn: number): void {
  localStorage.setItem(
    TOKEN_KEY,
    JSON.stringify({
      accessToken,
      refreshToken,
      // Margine di sicurezza: un token scaduto a metà richiesta fallirebbe
      // con un 401 senza motivo evidente.
      expiresAt: Date.now() + Math.max((expiresIn - 60) * 1000, 0),
    } satisfies StoredToken),
  );
  localStorage.removeItem(ERRORE_KEY);
}

export function readProfile(): GoogleProfile | null {
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    return raw ? (JSON.parse(raw) as GoogleProfile) : null;
  } catch {
    return null;
  }
}

/**
 * L'ultimo errore di collegamento, per poterlo dire anche dopo un rientro
 * da Google: al ritorno l'utente finisce nelle impostazioni, e un errore
 * mostrato solo in console lì non serve a nessuno.
 */
export function readErroreCollegamento(): string | null {
  return localStorage.getItem(ERRORE_KEY);
}

function ricordaErrore(messaggio: string): void {
  localStorage.setItem(ERRORE_KEY, messaggio);
}

/** Dimentica l'errore dell'ultimo rientro, quando l'utente lo ha letto. */
export function scordaErroreCollegamento(): void {
  localStorage.removeItem(ERRORE_KEY);
}

/**
 * Ricorda un errore e lo mette anche nel log.
 *
 * Tutti i rientri che finiscono male passano di qui: senza la riga nel log,
 * dalla finestra dell'app non si vede niente e l'unico posto dove la ragione
 * compare è la schermata di accesso, che è proprio quella da cui si guarda.
 */
function ricordaErroreNelLog(messaggio: string): void {
  console.warn(`accesso: ${messaggio}`);
  ricordaErrore(messaggio);
}

/* --------------------------------- stato ---------------------------------- */

/**
 * Il calendario è collegato se c'è un access token valido **oppure** un
 * refresh token: con il secondo il rinnovo è automatico e non c'è nulla da
 * fare. Se si mostrasse "collega" con un token semplicemente scaduto,
 * l'app chiederebbe ogni volta un consenso che l'utente ha già dato.
 */
export function isConnected(): boolean {
  const token = leggiToken();
  if (!token) return false;
  return Boolean(token.refreshToken) || token.expiresAt > Date.now() + 30_000;
}

/* -------------------------------- accesso --------------------------------- */

interface Ritorno {
  state: string;
  redirect: string;
}

function leggiRITORNO(): Ritorno | null {
  try {
    const raw = sessionStorage.getItem(RITORNO_KEY);
    return raw ? (JSON.parse(raw) as Ritorno) : null;
  } catch {
    return null;
  }
}

/** Il rientro consegnato dal main process, vuoto se non c'è. */
function leggiArrivo(): string {
  return arrivoDesktop;
}

/**
 * C'è un rientorno da chiudere?
 *
 * Nell'URL c'è solo sulla web: sul desktop il main process lo tiene per sé e lo
 * consegna al renderer, perché rimetterlo nell'URL farebbe sembrare il rientro a
 * un rientro e l'app si ricaricherebbe da sola all'infinito. Chi deve decidere se
 * chiamare `completaAccesso()` non può controllare solo l'URL, o sul desktop non
 * chiamerebbe mai.
 */
export function cERitornoDaChiudere(): boolean {
  if (leggiArrivo()) return true;
  const url = new URL(window.location.href);
  return url.searchParams.has("code") || url.searchParams.has("error");
}

/** Toglie i parametri di Google dalla barra degli indirizzi. */
function ripulisciUrl(): void {
  const url = new URL(window.location.href);
  for (const chiave of ["code", "state", "scope", "authuser", "prompt", "hd"]) {
    url.searchParams.delete(chiave);
  }
  window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
}

function stateCasuale(): string {
  const byte = new Uint8Array(16);
  crypto.getRandomValues(byte);
  return Array.from(byte, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Apre un indirizzo dove l'utente può davvero vedere cosa sta accadendo.
 *
 * Sul desktop è il browser di sistema: Google non accetta il consenso da un
 * browser incorporato, quindi aprire la pagina dentro la finestra di Electron
 * finirebbe con "This browser or app may not be secure". Nella web — e in
 * sviluppo, dove l'origine è già quella del dev server — si naviga come
 * sempre.
 */
function apriIndirizzo(url: string): boolean {
  const ponte = (window as { reportini?: { apriUrlEsterno?: (u: string) => Promise<boolean> } })
    .reportini;
  if (ponte?.apriUrlEsterno) {
    void ponte.apriUrlEsterno(url);
    return true;
  }
  window.location.assign(url);
  return false;
}

/**
 * Dove l'utente è stato mandato a fare il consenso.
 *
 * "browser" significa che l'app è ancora viva e aspetta: il ritorno arriva
 * dalla porta locale e la riporta avanti. "navigazione" significa che la
 * pagina stessa sta per essere scaricata, e chi chiama non deve aspettare
 * niente.
 */
export type EsitoAvvio = "browser" | "navigazione";

/**
 * Porta all'authorize di Google chiedendo profilo **e** calendario.
 *
 * È un flusso che lascia la pagina: l'utente vede il consenso e torna, e a
 * quel punto chiama `completaAccesso()`.
 */
export async function avviaAccessoGoogle(): Promise<EsitoAvvio> {
  if (!clientId) {
    throw new Error(
      "Manca VITE_GOOGLE_CLIENT_ID: senza il client Google l'accesso passa da Supabase.",
    );
  }
  // Deve combaciare al segno con uno registrato in Google Cloud, altrimenti
  // lo scambio del code si ferma con redirect_uri_mismatch.
  const redirect = urlDiRitorno(window.location.origin, baseRoutte());
  // Senza un'origine utilizzabile non c'è indirizzo di rientro, e mandare
  // l'utente da Google con un indirizzo che non può funzionare è solo una
  // promessa non mantenuta. Il messaggio finisce anche nel log del desktop.
  const motivo = motivoRientroNonValido(redirect);
  if (motivo) {
    console.error("google-token: accesso non avviato —", motivo);
    throw new Error(motivo);
  }
  const state = stateCasuale();
  sessionStorage.setItem(RITORNO_KEY, JSON.stringify({ state, redirect } satisfies Ritorno));
  // Il tentativo precedente, se c'è stato, non vale più: senza, un errore
  // vecchio resta a schermo mentre l'utente sta provando di nuovo.
  localStorage.removeItem(ERRORE_KEY);

  const url = new URL(AUTHORIZE_ENDPOINT);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirect);
  url.searchParams.set("response_type", "code");
  // I due scope nella stessa richiesta: è questo che fa risparmiare all'utente
  // una seconda schermata di consenso.
  url.searchParams.set("scope", `${SCOPO_PROFILO} ${SCOPO_CALENDARIO}`);
  // offline serve il refresh token; consent serve a riaverlo anche al secondo
  // tentativo, quando Google ha già visto una volta questa app.
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("include_granted_scopes", "true");
  url.searchParams.set("state", state);

  return apriIndirizzo(url.toString()) ? "browser" : "navigazione";
}

/* --------------------------------- backend -------------------------------- */

interface RispostaScambio {
  id_token: string;
  access_token: string;
  refresh_token: string | null;
  expires_in: number;
}

interface RispostaRinnovo {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
}

/**
 * Un rifiuto del backend, con lo stato HTTP che l'ha prodotto.
 *
 * Serve perché la funzione risponde 401 per due motivi diversi — "la tua
 * sessione non vale" e "il consenso Google non vale più" — e chi chiama deve
 * poterli trattare senza leggere una frase italiana. Lo stato è il contratto;
 * il testo è per l'utente.
 */
class ErroreBackend extends Error {
  readonly stato: number;

  constructor(messaggio: string, stato: number) {
    super(messaggio);
    this.name = "ErroreBackend";
    this.stato = stato;
  }
}

async function chiamaBackend<T>(corpo: Record<string, unknown>): Promise<T> {
  if (!supabase) throw new Error("Supabase non è collegato.");
  // Senza l'indirizzo del progetto non c'è nessuna funzione da chiamare: è un
  // pacchetto costruito senza `VITE_SUPABASE_URL`, e va detto così, invece di
  // mandare a cercare una funzione che non è mai stata nominata.
  if (!FUNZIONE) {
    throw new Error("Manca VITE_SUPABASE_URL: questo pacchetto non sa dove sta il backend.");
  }

  // Il rinnovo e la revoca chiedono un account; lo scambio no, perché
  // avviene proprio mentre l'utente sta ancora entrando. Si manda il JWT
  // quando c'è, e la funzione lo usa solo se sa cosa farne.
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  const intestazioni: Record<string, string> = { "Content-Type": "application/json" };
  if (token) intestazioni.Authorization = `Bearer ${token}`;

  let risposta: Response;
  try {
    risposta = await fetch(FUNZIONE, {
      method: "POST",
      headers: intestazioni,
      body: JSON.stringify(corpo),
    });
  } catch (causa) {
    // Che la richiesta sia arrivata o no, è una cosa che qui si sa; **perché**
    // no, no. Quindi il messaggio dice il fatto e la causa va nel log.
    //
    // Prima qui c'era "controlla che la funzione google-token sia
    // pubblicata": un'accusa che nessuno aveva verificato. Con la funzione
    // pubblicata e che risponde — il caso normale — mandava a cercare un
    // problema di deploy mentre il problema era la rete, ed è il tipo di
    // pista falsa che costa un pomeriggio.
    console.error("accesso: la richiesta al backend non è arrivata —", causa);
    throw new Error(
      "Backend non raggiungibile: la richiesta è stata bloccata prima di arrivare (rete, proxy o firewall).",
    );
  }

  const dati = (await risposta.json().catch(() => ({}))) as { errore?: string } & T;
  if (!risposta.ok) {
    // Un 404 è l'unica risposta che dice davvero "questa funzione non esiste".
    // Verificato sull'API: una funzione che non c'è risponde 404 con
    // `Access-Control-Allow-Origin: *` e `{"code":"NOT_FOUND"}`, quindi il
    // browser la legge senza equivoci — non è una risposta che si confonde con
    // un errore di rete, che invece qui non arriva affatto.
    if (risposta.status === 404 && !dati.errore) {
      throw new ErroreBackend(
        "La funzione google-token non è pubblicata: pubblicala con " +
          "`supabase functions deploy google-token`.",
        404,
      );
    }
    throw new ErroreBackend(
      dati.errore ?? `Il backend ha risposto ${risposta.status}.`,
      risposta.status,
    );
  }
  return dati;
}

/**
 * Come entrava prima: profilo e basta, senza calendario.
 *
 * **Solo se una sessione non c'è già.** Questo è il ripiego di un
 * ricollegamento del calendario andato storto, e non un motivo per buttare
 * fuori chi è già dentro: senza il controllo qui sotto, un guasto di rete di
 * mezzo secondo faceva sparire una sessione valida e ricomparire la schermata
 * di accesso. L'utente premeva "Ricollega" e si ritrovava a rifare l'accesso,
 * che è un'altra cosa da quella che aveva chiesto. Con la sessione in piedi il
 * calendario resta scollegato, la ragione sta nelle impostazioni, e riprovare
 * costa un clic invece di un accesso intero.
 */
async function accessoSupabaseSemplice(): Promise<void> {
  if (!supabase) return;
  const { data: corrente } = await supabase.auth.getSession();
  if (corrente.session) return;
  const rientro = urlDiRitorno(window.location.origin, baseRoutte());
  // `skipBrowserRedirect` fa restare l'URL a noi invece di navigare: serve
  // perché sul desktop l'indirizzo va aperto nel browser di sistema, dove
  // dentro la finestra finirebbe con la pagina "browser non sicuro" di
  // Google. Sulla web `apriIndirizzo` naviga, quindi il risultato non cambia.
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: rientro, skipBrowserRedirect: true },
  });
  if (error) throw new Error(error.message);
  if (data?.url) apriIndirizzo(data.url);
}

export type EsitoAccesso = "calendario" | "solo-account" | "nessuno";

/**
 * Chiude l'accesso al ritorno da Google.
 *
 * Percorso normale: scambio del `code` col backend, `id_token` a Supabase per
 * la sessione, token del calendario per l'app. Se qualcosa va storto non si
 * lascia l'utente fuori dalla porta: si ripiega sull'accesso con Supabase
 * da sola e si ricorda perché il calendario manca, così nelle impostazioni
 * c'è scritto cosa fare.
 *
 * Ogni passo lascia una riga nel log. Non è pignoleria: qui l'utente sta
 * guardando una finestra che sembra bloccata, e senza righe l'unica cosa che
 * si può fare è tirare a indovinare — cosa che è già costato due release.
 */
export async function completaAccesso(): Promise<EsitoAccesso> {
  // Sul desktop il rientro non è nell'URL: lo tiene il main process e ce lo
  // consegna quando lo chiediamo. Sulla web un main process non esiste e tutto
  // torna da Google nell'indirizzo, quindi si prova lì.
  const dallUrl = new URL(window.location.href).searchParams;
  const dallArrivo = new URLSearchParams(leggiArrivo());
  const presa = dallArrivo.get("code") || dallArrivo.get("error") ? dallArrivo : dallUrl;

  const code = presa.get("code");
  const state = presa.get("state");
  const erroreGoogle = presa.get("error");
  const ritorno = leggiRITORNO();
  sessionStorage.removeItem(RITORNO_KEY);
  // Il rientro si consuma adesso, chi lo ha letto: un documento nuovo non deve
  // ritrovarselo e rifare lo scambio con lo stesso codice.
  impostaArrivoDesktop(null);

  if (erroreGoogle) {
    ripulisciUrl();
    const messaggio =
      erroreGoogle === "access_denied"
        ? "Accesso annullato."
        : `Google ha rifiutato l'accesso (${erroreGoogle}).`;
    ricordaErrore(messaggio);
    console.warn(`accesso: rientro senza esito, ${erroreGoogle}`);
    return "nessuno";
  }

  if (!code) return "nessuno";

  // Un `code` di cui non ci siamo persi traccia non è nostro: può arrivare da
  // un altro accesso. Si ignora, e non è un errore da mostrare a nessuno.
  if (!ritorno) {
    console.warn("accesso: è arrivato un codice senza un accesso avviato da questa finestra");
    return "nessuno";
  }

  if (ritorno.state !== state) {
    ripulisciUrl();
    ricordaErroreNelLog("Accesso non riconosciuto: riprova.");
    return "nessuno";
  }

  // Il `code` non entra nel log: è una credenzione. Si dice solo che c'è.
  console.info("accesso: rientro da Google, scambio del codice col backend");

  try {
    const scambio = await chiamaBackend<RispostaScambio>({
      azione: "scambio",
      code,
      redirect_uri: ritorno.redirect,
    });

    if (!supabase) throw new Error("Supabase non è collegato.");
    // È Supabase ad aprire la sessione, validando l'id_token con il Client
    // ID configurato nel progetto: deve essere lo stesso client dell'app.
    const { error } = await supabase.auth.signInWithIdToken({
      provider: "google",
      token: scambio.id_token,
    });
    if (error) throw new Error(error.message);

    scriviToken(scambio.access_token, scambio.refresh_token, scambio.expires_in);
    ripulisciUrl();
    console.info("accesso: sessione aperta, calendario collegato");
    void arricchisciProfilo(scambio.access_token);
    return "calendario";
  } catch (causa) {
    const messaggio = causa instanceof Error ? causa.message : "Accesso non riuscito";
    // Qui la riga che conta: il messaggio del backend è la ragione vera
    // (redirect_uri_mismatch, client_secret, id_token rifiutato) e senza
    // questa non c'è niente su cui lavorare.
    console.error("accesso: scambio o apertura di sessione falliti —", messaggio);
    ricordaErrore(
      `${messaggio} L'accesso continua senza calendario: le impostazioni dicono come rimetterlo.`,
    );
    ripulisciUrl();
    // L'utente entra comunque. È la differenza fra un backend da
    // configurare e un'app che non si apre più.
    await accessoSupabaseSemplice();
    return "solo-account";
  }
}

async function arricchisciProfilo(accessToken: string): Promise<void> {
  try {
    const risposta = await fetch(PROFILE_ENDPOINT, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!risposta.ok) return;
    const dati = (await risposta.json()) as { email: string; name: string; picture?: string };
    localStorage.setItem(
      PROFILE_KEY,
      JSON.stringify({
        email: dati.email,
        name: dati.name,
        picture: dati.picture,
      } satisfies GoogleProfile),
    );
  } catch {
    // Il profilo è solo cosmetico: senza nome l'app funziona lo stesso.
  }
}

/** Rinnovo in corso: due chiamate contemporanee ne fanno una sola. */
let rinnovoInCorso: Promise<string> | null = null;

/**
 * Token valido, rinnovato in silenzio se necessario.
 *
 * Prima questo non era possibile: scaduto il token (un'ora) l'unica strada
 * era far ricollegare l'utente. Ora il refresh token torna dal backend e
 * l'utente non se ne accorge.
 */
export async function accessToken(): Promise<string> {
  const token = leggiToken();
  if (token && token.expiresAt > Date.now() + 60_000) return token.accessToken;

  if (!token?.refreshToken) {
    throw new Error("Il calendario non è collegato: ricollegalo dalle impostazioni.");
  }

  if (rinnovoInCorso) return rinnovoInCorso;

  rinnovoInCorso = (async () => {
    try {
      const rinnovo = await chiamaBackend<RispostaRinnovo>({
        azione: "rinnovo",
        refresh_token: token.refreshToken,
      });
      scriviToken(
        rinnovo.access_token,
        rinnovo.refresh_token ?? token.refreshToken,
        rinnovo.expires_in,
      );
      return rinnovo.access_token;
    } catch (causa) {
      const messaggio = causa instanceof Error ? causa.message : "Rinnovo non riuscito";
      // Un 401 sul rinnovo è un consenso che non c'è più (o una sessione che
      // non vale): in entrambi i casi la via d'uscita è la stessa — rifare
      // l'accesso, che riporta anche il consenso del calendario. Quindi il
      // token morto va tolto di mezzo adesso: senza, l'app si dichiara
      // collegata e intanto, nello stesso riquadro delle impostazioni, dice
      // che il collegamento non è più valido.
      if (causa instanceof ErroreBackend && causa.stato === 401) dimenticaToken();
      ricordaErrore(messaggio);
      throw new Error(messaggio);
    } finally {
      rinnovoInCorso = null;
    }
  })();

  return rinnovoInCorso;
}

/**
 * Butta via il token quando non c'è più niente da rinnovare.
 *
 * Il rifiuto di Google non si aggiusta da solo: tenendo il refresh token,
 * `isConnected()` resta vero, la scheda dice "Collegato" e ogni salvataggio
 * ritenta un rinnovo che non può riuscire. Il profilo (nome ed email) resta:
 * è cosmetico, non un'autorizzazione.
 */
function dimenticaToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

export async function disconnect(): Promise<{ revocato: boolean }> {
  const token = leggiToken();
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(PROFILE_KEY);
  localStorage.removeItem(ERRORE_KEY);
  if (!token?.accessToken) return { revocato: true };
  // Revocare conta più che cancellare il token: altrimenti l'app resta
  // autorizzata su myaccount.google.com/permissions. Non è bloccante per
  // l'utente, quindi una revoca fallita va detta, non nascosta.
  try {
    await fetch(
      `https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token.accessToken)}`,
      {
        method: "POST",
      },
    );
    return { revocato: true };
  } catch {
    return { revocato: false };
  }
}

/* ------------------------------ stato del backend ------------------------ */

export type StatoBackend = "pronto" | "non-pubblicata" | "irraggiungibile";

/**
 * La funzione `google-token` esiste davvero?
 *
 * Non serve un endpoint di stato: se l'indirizzo non corrisponde a nessuna
 * funzione Supabase risponde 404, mentre una funzione pubblicata risponde
 * qualcosa (405, perché vuole un POST). È il controllo che dice "hai
 * dimenticato di pubblicarla" invece di lasciare l'utente a litigare con un
 * errore generico.
 */
export async function statoBackend(): Promise<StatoBackend> {
  if (!supabase || !FUNZIONE) return "irraggiungibile";
  try {
    const { data } = await supabase.auth.getSession();
    const risposta = await fetch(FUNZIONE, {
      method: "GET",
      headers: data.session ? { Authorization: `Bearer ${data.session.access_token}` } : {},
    });
    return risposta.status === 404 ? "non-pubblicata" : "pronto";
  } catch {
    return "irraggiungibile";
  }
}
