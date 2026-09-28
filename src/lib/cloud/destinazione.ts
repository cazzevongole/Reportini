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
 * Su GitHub Pages l'app vive in una sottocartella (/Reportini/), quindi va
 * concatenato BASE_URL: tornare alla sola origine finirebbe sulla pagina del
 * profilo invece che sull'app.
 */
export function urlDiRitorno(origine: string, base: string): string {
  const percorso = base === "/" ? "" : base.replace(/\/+$/, "");
  return `${origine.replace(/\/+$/, "")}${percorso}`;
}

/**
 * Il percorso base da dare al router e agli URL di rientro.
 *
 * Sulla web vale quello di Vite ("/" in locale, "/Reportini/" su GitHub
 * Pages). Nell'app desktop la base è "./" — gli asset devono essere relativi,
 * perché da file:// un "/assets/app.js" punta alla radice del filesystem e non
 * a nulla — ma "./" non è un percorso che un router possa usare: qui si
 * traduce in radice, che è la stessa app vista dal suo file.
 */
export function baseRoutte(): string {
  const base = import.meta.env.BASE_URL;
  return base.startsWith(".") ? "/" : base;
}
