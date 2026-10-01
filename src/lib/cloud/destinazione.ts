/**
 * URL a cui Supabase deve riportare l'utente dopo l'accesso con Google.
 *
 * Supabase confronta questo valore con la lista *Redirect URLs* e, se non
 * corrisponde, rimanda al *Site URL*: in quel caso l'utente finisce su una
 * pagina che non c'entra nulla e sembra che il login sia rotto.
 *
 * Per questo l'URL è normalizzato e senza slash finale: è esattamente la
 * stringa che va incollata nella lista di Supabase, mostrata anche in
 * Impostazioni per evitare di indovinarla.
 *
 * Su una web servita da una sottocartella (non è il caso di Reportini, che
 * sta nella radice di reportini.cazzevongole.com, ma può esserlo in un
 * self-hosting) va concatenato BASE_URL: tornare alla sola origine finirebbe
 * su una pagina che non è l'app.
 */
export function urlDiRitorno(origine: string, base: string): string {
  const percorso = base === "/" ? "" : base.replace(/\/+$/, "");
  return `${origine.replace(/\/+$/, "")}${percorso}`;
}

/** I pochi campi di un indirizzo di pagina che servono qui. */
export interface IndirizzoPagina {
  protocol: string;
  host: string;
  hostname: string;
  pathname: string;
  search: string;
  hash: string;
}

/**
 * Un ospite a cui non si può chiedere un certificato.
 *
 * Sono i nomi che il browser e Google già trattano come sicuri per
 * definizione: il certificato non esiste e non servirebbe. `127.0.0.1` e
 * `::1` sono qui perché è da lì che si serve l'app desktop — forzare https
 * lì romperebbe il pacchetto, che non ha da dove prendere un certificato.
 */
export function ospiteLocale(hostname: string): boolean {
  const h = hostname.replace(/^\[|\]$/g, "");
  return h === "localhost" || h === "127.0.0.1" || h === "::1" || h === "0.0.0.0";
}

/**
 * Lo stesso indirizzo, ma su https — o `null` se va bene come sta.
 *
 * Serve perché una pagina aperta in http non può fare l'accesso: Google
 * accetta `redirect_uri` in http solo per `localhost`, e su un dominio vero
 * risponde `redirect_uri_mismatch`. Il pulsante sembra premuto e non
 * succede niente.
 *
 * Qui non si decide *se* il sito va servito in https — quello lo decidono
 * GitHub Pages e Cloudflare — ma si corregge chi arriva comunque dalla
 * porta sbagliata, senza farglielo notare.
 */
export function indirizzoSicuro(url: IndirizzoPagina): string | null {
  if (url.protocol !== "http:") return null;
  if (ospiteLocale(url.hostname)) return null;
  return `https://${url.host}${url.pathname}${url.search}${url.hash}`;
}

/**
 * Il percorso base da dare al router e agli URL di rientro.
 *
 * Sulla web vale quello di Vite, cioè "/" sia in locale sia sul dominio
 * reportini.cazzevongole.com. Nell'app desktop la base è "./" — gli asset
 * devono essere relativi,
 * perché da file:// un "/assets/app.js" punta alla radice del filesystem e non
 * a nulla — ma "./" non è un percorso che un router possa usare: qui si
 * traduce in radice, che è la stessa app vista dal suo file.
 */
export function baseRoutte(): string {
  const base = import.meta.env.BASE_URL;
  return base.startsWith(".") ? "/" : base;
}

/**
 * L'indirizzo a cui Google deve riportare l'utente è utilizzabile?
 *
 * Vale la pena controllarlo perché senza controllo il pulsante di accesso
 * fallisce in silenzio: `file://` non ha un'origine — `window.location.origin`
 * restituisce la stringa "null" — quindi l'indirizzo di rientro diventa la
 * lettera `null` e nessun errore viene detto da nessuna parte.
 *
 * Sul pacchetto desktop non dovrebbe più succedere: l'app si serve da
 * `127.0.0.1` e ha quindi un'origine vera. Se questa frase compare, il
 * server locale non è partito e l'app è stata aperta in qualche altro modo:
 * meglio dirlo che mandare l'utente da Google con un indirizzo che non può
 * tornare.
 *
 * Un `http://` su un dominio vero è trattato come non valido, anche se è
 * una pagina web: su http Google non accetta il rientro, quindi accettarlo
 * qui significherebbe mandare l'utente a un errore di Google invece che
 * spiegare il problema. Su `localhost` e `127.0.0.1` resta valido: è l'app
 * desktop, e lì l'eccezione vale.
 *
 * Restituisce "" quando va bene, altrimenti la frase da mostrare.
 */
export function motivoRientroNonValido(url: string): string {
  if (/^https:\/\//i.test(url)) return "";
  if (/^http:\/\//i.test(url)) {
    let hostname = "";
    try {
      hostname = new URL(url).hostname;
    } catch {
      hostname = "";
    }
    if (!ospiteLocale(hostname)) {
      return (
        `Questa pagina è aperta in http ("${url}") e su http Google non accetta di riportarti qui, ` +
        "quindi l'accesso non può funzionare. Apri Reportini con l'indirizzo che inizia per https."
      );
    }
    return "";
  }
  return (
    `L'indirizzo di rientro "${url}" non è una pagina web, quindi Google non può riportarti qui. ` +
    "L'app desktop si serve da 127.0.0.1 per avere un origine: se questa frase compare, " +
    "il suo server locale non è partito. Riapri Reportini e, se torna, leggi renderer.log."
  );
}
