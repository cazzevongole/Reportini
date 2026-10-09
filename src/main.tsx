import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";
import ErroreAvvio from "./components/ErroreAvvio";
import { AccountProvider } from "./lib/cloud/session";
import { indirizzoSicuro } from "./lib/cloud/destinazione";
import { NOME_APP } from "./lib/nome";

function monta() {
  // Il titolo della finestra — e della scheda, sulla web. Sul desktop è questa
  // riga a decidere cosa si legge nella barra: Electron lo prende dalla pagina,
  // non dal nome del pacchetto (`BrowserWindow` non ha un `title` suo).
  document.title = NOME_APP;
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      {/* Fuori da tutto il resto: senza, un errore in una qualsiasi vista
          smonterebbe l'albero e lascerebbe una finestra bianca — sul desktop,
          dove non c'è una console, anche senza sapere che c'è stato un errore. */}
      <ErroreAvvio>
        <AccountProvider>
          <App />
        </AccountProvider>
      </ErroreAvvio>
    </StrictMode>,
  );
}

/**
 * Una pagina aperta in http non fa entrare nessuno: Google accetta il rientro
 * solo su https, fuori che per localhost — dove l'app desktop si serve, e lì
 * l'eccezione vale. Premere "Accedi" non produrrebbe niente.
 *
 * Il rimando vero lo fa il server (GitHub Pages con `https_enforced`,
 * Cloudflare con Always Use HTTPS). Qui è la seconda linea, per chi arriva
 * dalla porta sbagliata da un link vecchio o da un segnalibro.
 *
 * Se il rimando non funziona — un proxy dell'utente lo blocca, o il
 * browser lo rifiuta — l'app viene montata lo stesso dopo un istante: una
 * pagina bianca non dice niente, mentre l'app si vede e l'accesso fallisce
 * con una frase che spiega il perché. Il `replace` è in un `setTimeout`
 * perché durante il caricamento del modulo nessuna navigazione parte
 * davvero: si perderebbe.
 */
function rimandaInHttps(): void {
  const sicuro = indirizzoSicuro(window.location);
  if (!sicuro) {
    monta();
    return;
  }
  document.title = NOME_APP;
  const avviso = document.createElement("p");
  avviso.className = "grid min-h-dvh place-items-center p-6 text-center text-sm text-ink-400";
  avviso.textContent = "Ti riporto su https…";
  document.body.replaceChildren(avviso);
  window.setTimeout(() => window.location.replace(sicuro), 0);
  window.setTimeout(() => {
    if (window.location.protocol === "http:") {
      document.body.replaceChildren();
      monta();
    }
  }, 2000);
}

rimandaInHttps();
