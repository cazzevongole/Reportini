import { Suspense, lazy, useEffect, useState, type ReactNode } from "react";
import { BrowserRouter, HashRouter, Navigate, Route, Routes } from "react-router-dom";
import AppShell from "./components/AppShell";
import { AvvisoProvider } from "./components/Avvisi";
import RichiedeAccesso from "./components/RichiedeAccesso";
import SchermataApertura from "./components/SchermataApertura";
import Accesso from "./pages/Accesso";
import { initDatabase } from "./lib/sqlite/engine";
import { isDesktop } from "./lib/sqlite/storage";
import { baseRoutte } from "./lib/cloud/destinazione";
import { useAccount } from "./lib/cloud/session";

// Le pagine dietro l'accesso si scaricano quando servono.
//
// Sono tutte dentro `RichiedeAccesso`: chi non ha un account non le vede
// mai, e chi ce l'ha arriva dalla schermata di accesso, cioè dopo che la
// pagina è già a posto. Tenerle nel pacchetto iniziale costava a chi apre
// l'app una banda e una decina di richieste che non avrebbe mai usato.
//
// Il caricamento differito funziona anche sul desktop perché l'app non si
// apre da file:// ma da un server locale (electron/main.cjs): un `import()`
// su file:// fallirebbe, e qui non è il caso.
const Panel = lazy(() => import("./pages/Panel"));
const Aziende = lazy(() => import("./pages/Aziende"));
const AziendaDettaglio = lazy(() => import("./pages/AziendaDettaglio"));
const Report = lazy(() => import("./pages/Report"));
const Attivita = lazy(() => import("./pages/Attivita"));
const Impostazioni = lazy(() => import("./pages/Impostazioni"));
const Sviluppo = lazy(() => import("./pages/Sviluppo"));

/**
 * Il database viene aperto qui, prima di montare le pagine: così ogni vista
 * può interrogarlo senza dover verificare da parte sua che sia pronto.
 *
 * **Solo se c'è un account.** Il motore è SQLite compilato in WebAssembly e
 * pesa 325 kB compressi: era più della metà di tutto quello che chi apriva
 * l'app scaricava, e serviva a chi non aveva ancora fatto nulla. Senza
 * account non c'è niente da aprire — la pagina di accesso non interroga il
 * database — quindi l'apertura aspetta, e avviene nel momento in cui
 * l'utente rientra da Google.
 *
 * Finché l'account non è noto la pagina di accesso resta comunque visibile:
 * aspettare il caricamento della sessione prima di mostrare cosa c'è
 * dentro l'app farebbe lampeggiare lo schermo a chi è già entrato.
 */
function DatabaseGate({ children }: { children: ReactNode }) {
  const { email, loading } = useAccount();
  const [stato, setStato] = useState<"inattivo" | "caricamento" | "pronto" | "errore">("inattivo");
  const [errore, setErrore] = useState("");

  useEffect(() => {
    // Finché la sessione non è nota non si sa se aprire: aprire e poi
    // richiudere costerebbe il download del motore a chi sta solo guardando
    // la pagina di accesso.
    if (loading || !email || stato !== "inattivo") return;
    setStato("caricamento");
    initDatabase()
      .then(() => setStato("pronto"))
      .catch((causa: unknown) => {
        console.error(causa);
        setErrore(causa instanceof Error ? causa.message : String(causa));
        setStato("errore");
      });
  }, [loading, email, stato]);

  // Senza account non c'è database da aspettare: si lascia passare tutto, e
  // la pagina di accesso si vede subito.
  if (stato === "inattivo") return <>{children}</>;

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

/**
 * Mentre una pagina differita si scarica.
 *
 * Girando dentro AppShell, il fallback non toglie la barra né la pagina
 * corrente: mostra solo che sotto sta arrivando altro. Un `null` qui
 * lascerebbe la pagina a metà, che è peggio di una pausa.
 */
function CaricamentoPagina() {
  return (
    <div className="flex min-h-[50vh] items-center justify-center p-6" role="status">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-ink-100 border-t-brand-500" />
      <span className="sr-only">Caricamento della pagina…</span>
    </div>
  );
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
          {/* basename: sulla web vale la base di Vite, cioè "/" sia in locale
              sia su reportini.cazzevongole.com. Senza, ogni link punterebbe a
              /panel e lascerebbe la radice: dopo l'accesso l'utente finiva su
              una pagina di profilo e poi su un 404 al ricaricare. Nell'app
              desktop, che si apre da file://, la base è "./" e per il router
              vale la radice. */}
          <Router basename={baseRoutte()}>
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
                {/* Il fallback è la stessa schermata di apertura: dentro
                    AppShell c'è già la barra e il resto, e rimetterla a zero
                    durante il caricamento farebbe saltare il layout. */}
                <Route
                  path="/panel"
                  element={
                    <Suspense fallback={<CaricamentoPagina />}>
                      <Panel />
                    </Suspense>
                  }
                />
                <Route
                  path="/panel/aziende"
                  element={
                    <Suspense fallback={<CaricamentoPagina />}>
                      <Aziende />
                    </Suspense>
                  }
                />
                <Route
                  path="/panel/aziende/:id"
                  element={
                    <Suspense fallback={<CaricamentoPagina />}>
                      <AziendaDettaglio />
                    </Suspense>
                  }
                />
                <Route
                  path="/panel/report"
                  element={
                    <Suspense fallback={<CaricamentoPagina />}>
                      <Report />
                    </Suspense>
                  }
                />
                <Route
                  path="/panel/attivita"
                  element={
                    <Suspense fallback={<CaricamentoPagina />}>
                      <Attivita />
                    </Suspense>
                  }
                />
                <Route
                  path="/panel/impostazioni"
                  element={
                    <Suspense fallback={<CaricamentoPagina />}>
                      <Impostazioni />
                    </Suspense>
                  }
                />
                {/* Nascosta per scelta: nessuna voce nella barra, e chi non è
                    lo sviluppatore viene rimandato al pannello dalla pagina
                    stessa. Nell'elenco pubblico questa rotta non compare. */}
                <Route
                  path="/panel/sviluppo"
                  element={
                    <Suspense fallback={<CaricamentoPagina />}>
                      <Sviluppo />
                    </Suspense>
                  }
                />
              </Route>
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Router>
        </AvvisoProvider>
      </DatabaseGate>
    </SchermataApertura>
  );
}
