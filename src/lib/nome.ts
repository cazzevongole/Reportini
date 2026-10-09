/**
 * Il nome dell'app, in un posto solo.
 *
 * Perché serve. Mentre si prova, le due app si aprono **insieme** — quella
 * ufficiale installata e quella di prova — e devono dirsi diverse: se il nome
 * sta scritto in tre componenti, il pacchetto di prova cambia dove qualcuno si
 * è ricordato di cambiarlo, e la prova si confonde con l'app vera.
 *
 * Da dove arriva il nome di prova. Da `VITE_NOME_APP`, cioè dalla build, non da
 * una modifica ai sorgenti: la mette solo il workflow del pacchetto di prova.
 * Senza quella variabile — la web, l'app installata, i test — vale il nome
 * ufficiale, quindi l'app che l'utente scarica resta identica. È lo stesso
 * meccanismo di `VITE_DURATA_APERTURA_MS` in SchermataApertura.tsx.
 *
 * `index.html` ha lo stesso nome scritto una volta: è quello che si vede prima
 * che il JavaScript parta, e i due non possono divergere — a dirlo è un test
 * (`tests/nome-app.test.ts`), perché mezza scheda con la parola sbagliata è il
 * tipo di guasto che nessuno nota e che sembra un difetto di disegno.
 */
export const NOME_UFFICIALE = "Reportini";

/**
 * Il nome da mostrare, dal valore che arriva dalla build.
 *
 * Una variabile dichiarata e lasciata vuota non è un nome: vale come assente.
 * Senza questo controllo, un `VITE_NOME_APP:` scritto e non riempito darebbe
 * un'app senza nome — e a occhio sarebbe un guasto del disegno invece che della
 * configurazione.
 */
export function nomeAppDa(variabile: string | undefined): string {
  const scritto = (variabile ?? "").trim();
  return scritto || NOME_UFFICIALE;
}

/** Il nome dell'app in questa build. */
export const NOME_APP = nomeAppDa(import.meta.env.VITE_NOME_APP);
