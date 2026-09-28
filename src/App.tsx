import { useEffect, useState, type ReactNode } from "react";
import {
  BrowserRouter,
  HashRouter,
  Navigate,
  Route,
  Routes,
} from "react-router-dom";
import AppShell from "./components/AppShell";
import { AvvisoProvider } from "./components/Avvisi";
import RichiedeAccesso from "./components/RichiedeAccesso";
import SchermataApertura from "./components/SchermataApertura";
import Accesso from "./pages/Accesso";
import AnagraficoDettaglio from "./pages/AnagraficoDettaglio";
import Anagrafici from "./pages/Anagrafici";
import Appuntamenti from "./pages/Appuntamenti";
import Impostazioni from "./pages/Impostazioni";
import Panel from "./pages/Panel";
import Relazioni from "./pages/Relazioni";
import Sviluppo from "./pages/Sviluppo";
import { initDatabase } from "./lib/sqlite/engine";
import { isDesktop } from "./lib/sqlite/storage";
import { baseRoutte } from "./lib/cloud/destinazione";

/**
 * Il database viene aperto qui, prima di montare le pagine: così ogni vista
 * può interrogarlo senza dover verificare da parte sua che sia pronto.
 */
function DatabaseGate({ children }: { children: ReactNode }) {
  const [stato, setStato] = useState<"caricamento" | "pronto" | "errore">("caricamento");
  const [errore, setErrore] = useState("");

  useEffect(() => {
    initDatabase()
      .then(() => setStato("pronto"))
      .catch((causa: unknown) => {
        console.error(causa);
        setErrore(causa instanceof Error ? causa.message : String(causa));
        setStato("errore");
      });
  }, []);

  if (stato === "caricamento") {
    return (
      <div className="flex min-h-dvh items-center justify-center p-6">
        <div className="card max-w-sm p-6 text-center">
          <div className="mx-auto mb-4 h-9 w-9 animate-spin rounded-full border-2 border-ink-100 border-t-brand-500" />
          <p className="text-sm text-ink-400">Apertura dei tuoi dati…</p>
        </div>
      </div>
    );
  }

  if (stato === "errore") {
    return (
      <div className="flex min-h-dvh items-center justify-center p-6">
        <div className="card max-w-sm p-6 text-center">
          <h1 className="text-xl">Impossibile aprire i dati</h1>
          <p className="mt-2 text-sm text-ink-400">{errore}</p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}

export default function App() {
  /**
   * Sul desktop la pagina è un file — `file:///C:/Program Files/.../index.html`
   * — e il suo percorso non è un percorso di rotte. Con un BrowserRouter la
   * posizione iniziale non combacia con nessuna rotta, scatta il fallback che
   * riporta a "/", e il browser va davvero a `file:///C:/`: cioè alla radice
   * del disco, dove non c'è un indice.html. La pagina resta bianca e nel log
   * c'è `did-fail-load ERR_FILE_NOT_FOUND file:///C:/`.
   *
   * Sul desktop si usa quindi il router con l'hash, che guarda il frammento
   * invece del percorso: la rotta iniziale è "/" e nessuna navigazione può
   * portare fuori dal file. Sulla web resta il BrowserRouter, perché lì
   * gli URL puliti servono (GitHub Pages, link, ricaricare la pagina).
   */
  const Router = isDesktop ? HashRouter : BrowserRouter;

  return (
    // Fuori da tutto, gate del database compreso: l'ospite non deve vedere
    // il doppio salto fra "saluto" e "apertura dei tuoi dati".
    <SchermataApertura>
      <DatabaseGate>
        {/* Gli avvisi stanno fuori dal router: un'azione che chiama la rete deve
            poter parlare anche cambiando pagina (per esempio uscendo). */}
        <AvvisoProvider>
          {/* basename: su GitHub Pages l'app vive in /Reportini/. Senza, ogni
              link punterebbe a /panel e lascerebbe la sottocartella: dopo
              l'accesso l'utente finiva su una pagina di profilo e poi su un
              404 al ricaricare. Nell'app desktop, che si apre da file://, la
              base è "./" e per il router vale la radice. */}
          <Router
            basename={baseRoutte()}
            future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
          >
            <Routes>
              {/* Unica rotta aperta: senza account non si vede nient'altro. */}
              <Route path="/accedi" element={<Accesso />} />
              <Route
                path="/"
                element={
                  <RichiedeAccesso>
                    <Navigate to="/panel" replace />
                  </RichiedeAccesso>
                }
              />
              <Route
                element={
                  <RichiedeAccesso>
                    <AppShell />
                  </RichiedeAccesso>
                }
              >
                <Route path="/panel" element={<Panel />} />
                <Route path="/panel/anagrafici" element={<Anagrafici />} />
                <Route path="/panel/anagrafici/:id" element={<AnagraficoDettaglio />} />
                <Route path="/panel/relazioni" element={<Relazioni />} />
                <Route path="/panel/appuntamenti" element={<Appuntamenti />} />
                <Route path="/panel/impostazioni" element={<Impostazioni />} />
                {/* Nascosta per scelta: nessuna voce nella barra, e chi non è
                    lo sviluppatore viene rimandato al pannello dalla pagina
                    stessa. Nell'elenco pubblico questa rotta non compare. */}
                <Route path="/panel/sviluppo" element={<Sviluppo />} />
              </Route>
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Router>
        </AvvisoProvider>
      </DatabaseGate>
    </SchermataApertura>
  );
}
