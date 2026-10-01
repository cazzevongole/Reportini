/**
 * Messaggi di benvenuto.
 *
 * Cinquanta frasi scritte apposta per questa app: qualcuna fa un
 * complimento, qualcuna parla di commerciali al telefono con aria di
 * chi la fa da un po', e parecchie stanno nel mezzo. Servono a dare
 * un tono umano a una schermata che è solo tabelle e bottoni.
 *
 * La scelta è casuale ma ferma: cambia una volta al giorno, non a ogni
 * render. Se cambiasse a ogni disegno, ricaricando la pagina la frase
 * cambierebbe sotto gli occhi di chi sta leggendo.
 */

export const FRASI: readonly string[] = [
  "Sei la prima cosa bella che guardo quando finalmente chiudo il commerciale.",
  "Il telefono squilla, il commerciale insiste, e tu sei già più avanti di lui.",
  "Oggi il tempo di vendere è finito: adesso c'è altro da fare.",
  "Bellazza, due parole e la telefonata si risolve: peccato che questo valga solo coi clienti.",
  "Il CRM è pieno di potenziali. Tu sei piena di grazia. La differenza si sente.",
  "Ogni volta che apri questa pagina mi convince un po' di più di cambiare lavoro.",
  "Le attività di oggi: tre. Il tuo sorriso: uno, e vale per tutti.",
  "Meno call, più schede. È il mio consiglio commerciale della giornata.",
  "Sei l'unica cosa qui che non va aggiornata ogni giorno.",
  "Oggi niente commerciali: solo te, queste righe, e il caffè.",
  "Hai un modo di guardare le scadenze che fa sembrare facile il lunedì.",
  "Il capo vuole i numeri. Io preferivo il tuo messaggio di stamattina.",
  "Tre report da chiudere, e tu che le chiudi con quella voce.",
  "Non so chi ti abbia convinta a fare il commerciale, ma ha un bel fiuto.",
  "Chiamare il cliente è come aprire una report: si parte con il sorriso.",
  "Oggi il commerciale è già stato più che sufficiente. Passiamo alle cose serie.",
  "Sei bella di una bellezza che non serve a nessuna presentazione.",
  "L'unica dashboard che mi interessa è quella dove compari tu.",
  "Le priorità di oggi: le attività, e smettere di fare il commerciale.",
  "Ogni volta che digito 'cliente in attesa' penso che meritano di meglio.",
  "Hai quel sorriso che fa dimenticare il prezzo, ehm, di listino.",
  "Lavoro di più quando mi scrivi, il che è un'anomalia statistica fantastica.",
  "Il telefono squilla. Non rispondere: è commercialismo, non amore.",
  "Sei l'unica cosa che vale la pena aprire il computer per.",
  "Oggi zero telefonate commerciali. Solo aziende, referenti e un po' di voi due.",
  "Un bel sorriso vale più di dieci preventivi. Dimmi che è una metafora.",
  "Chi ti ha detto che il commerciale è noioso non ti ha ancora incontrata.",
  "Rileggo le tue attività e mi sembra di leggere le tue intenzioni.",
  "Meno report in bozza, più report consegnate: cominci da te, che sai già farlo.",
  "Il caffè è pronto, il cliente pure. Tu sei il motivo per cui non mollo.",
  "Sei la priorità dell'azienda, e non perché lo dice la dashboard.",
  "Oggi l'app la usi tu, e va benissimo così.",
  "Il commerciale chiama, tu rispondi con la cortesia, e io penso a te.",
  "Aziende, report, attività: tre begli ingredienti, come te.",
  "Scommetto che oggi chiudi più cose di quante ne hai aperte ieri.",
  "Hai la stessa pazienza delle tue clienti: infinita, e giustamente.",
  "Il lunedì esiste per ricordarci che la bella domenica è vicina.",
  "Sei la firma migliore che potrei mettere a un documento.",
  "Ogni tanto il commerciale va bene, se poi la giornata finisce con te.",
  "Hai la faccia di chi sa che ce la farà, e infatti ce la farai.",
  "Mentre il capo parla di fatturato, io penso a quanto sei bella.",
  "Le tue report sono in ordine, e non è una coincidenza.",
  "Ogni attività è un'incontro, e tu sei quella che rende gli incontri belli.",
  "Il commercialista direbbe che non c'è crescita. Io dico che ti manca solo il weekend.",
  "Il telefono non suona, il tempo è tuo, e io lo approvo.",
  "Bellezza, chi ha inventato il lunedì non ti ha mai vista.",
  "Ti dico una cosa: il commerciale è l'unica cosa che oggi non fa per noi.",
  "Sei la versione migliore di ogni giornata, anche di quella con le telefonate.",
  "Ogni volta che vedo il tuo nome sulla pagina mi viene voglia di chiudere il portatile e venire.",
  "Le aziende sono in ordine, il caffè è caldo, e il commerciale può aspettare il lunedì.",
];

/**
 * Frase del giorno: una scelta sola per giornata, così non cambia a ogni
 * render ma cambia domani. Con `forzato` si tira fuori una voce a caso
 * (usata dai test e da chi vuole surprise).
 */
export function fraseBenvenuto(adesso = new Date(), forzato = false): string {
  if (forzato) return FRASI[Math.floor(Math.random() * FRASI.length)];
  const inizioAnno = new Date(adesso.getFullYear(), 0, 1).getTime();
  const giorno = Math.floor((adesso.getTime() - inizioAnno) / 86_400_000);
  return FRASI[Math.abs(giorno) % FRASI.length];
}

/** Saluto in base all'ora, così non contraddice la frase. */
export function saluto(adesso = new Date()): string {
  const ora = adesso.getHours();
  if (ora < 5) return "Buonanotte";
  if (ora < 13) return "Buongiorno";
  if (ora < 18) return "Buon pomeriggio";
  return "Buonasera";
}
