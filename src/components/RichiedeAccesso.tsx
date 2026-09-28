import { Navigate, useLocation } from "react-router-dom";
import type { ReactNode } from "react";
import { useSalvataggioCloud } from "../hooks/useSalvataggioCloud";
import { useRegistrazioneVersioni } from "../hooks/useVersioniBackup";
import { useAccount } from "../lib/cloud/session";

/**
 * Le pagine dell'applicazione sono riservate a chi ha effettuato l'accesso:
 * senza un account l'utente non deve vedere nulla, nemmeno una schermata di
 * benvenuto con i dati di altre persone dentro.
 *
 * Finché la sessione non è nota non si rimanda a caso: mostrere la pagina di
 * accesso per un istante a chi è già entrato fa saltare lo schermo.
 */
export default function RichiedeAccesso({ children }: { children: ReactNode }) {
  const { email, loading } = useAccount();
  const posizione = useLocation();
  // Con l'account aperto partono le due cose che devono stare accese per
  // tutta la sessione e non appartencono a una schermata: il salvataggio
  // online automatico e le versioni di backup del database.
  useSalvataggioCloud();
  useRegistrazioneVersioni();

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

  return <>{children}</>;
}
