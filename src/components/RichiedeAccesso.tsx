import { Navigate, useLocation } from "react-router-dom";
import type { ReactNode } from "react";
import { useSalvataggioCloud } from "../hooks/useSalvataggioCloud";
import { useRegistrazioneVersioni } from "../hooks/useVersioniBackup";
import { useAccount } from "../lib/cloud/session";

/**
 * Le due cose che devono stare accese per tutta la sessione e non appartengono
 * a una schermata: il salvataggio online automatico e le versioni di backup
 * del database.
 *
 * Stanno in un componente a parte, non nel padre, per due motivi. Primo: un
 * hook non si può chiamare dopo un `return` anticipato, e senza un account il
 * padre ritorna subito alla pagina di accesso. Secondo, e più importante:
 * `useRegistrazioneVersioni` registra una copia del database e `snapshot()` ne
 * legge il contenuto, quindi senza un account non deve nemmeno partire. Fino a
 * poco fa partiva lo stesso, dalla pagina di accesso, e costringeva
 * l'apertura del database a chi non aveva ancora fatto nulla.
 */
function AreaAutenticata({ children }: { children: ReactNode }) {
  useSalvataggioCloud();
  useRegistrazioneVersioni();
  return <>{children}</>;
}

/**
 * Le pagine dell'applicazione sono riservate a chi ha effettuato l'accesso:
 * senza un account l'utente non deve vedere nulla, nemmeno una schermata di
 * benvenuto con i dati di altre persone dentro.
 *
 * Finché la sessione non è nota non si rimanda a caso: mostrare la pagina di
 * accesso per un istante a chi è già entrato fa saltare lo schermo.
 */
export default function RichiedeAccesso({ children }: { children: ReactNode }) {
  const { email, loading } = useAccount();
  const posizione = useLocation();

  if (loading) {
    return (
      <div className="flex min-h-dvh items-center justify-center p-6">
        <div
          className="h-9 w-9 animate-spin rounded-full border-2 border-ink-100 border-t-brand-500"
          aria-label="Caricamento"
        />
      </div>
    );
  }

  if (!email) {
    // Si ricorda da dove si è arrivati, così dopo l'accesso si torna indietro.
    return <Navigate to="/accedi" replace state={{ da: posizione.pathname }} />;
  }

  return <AreaAutenticata>{children}</AreaAutenticata>;
}
