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
 * Restituisce "" quando va bene, altrimenti la frase da mostrare.
 */
export function motivoRientroNonValido(url: string): string {
  if (/^https?:\/\//i.test(url)) return "";
  return (
    `L'indirizzo di rientro "${url}" non è una pagina web, quindi Google non può riportarti qui. ` +
    "L'app desktop si serve da 127.0.0.1 per avere un origine: se questa frase compare, " +
    "il suo server locale non è partito. Riapri Reportini e, se torna, leggi renderer.log."
  );
}
