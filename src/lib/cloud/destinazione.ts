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
