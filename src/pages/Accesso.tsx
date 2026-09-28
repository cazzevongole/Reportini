import { Navigate, useLocation } from "react-router-dom";
import { CalendarIcon, FileTextIcon, UsersIcon } from "../components/icons";
import { Button } from "../components/ui";
import { useAvvisi } from "../components/Avvisi";
import { useAccount } from "../lib/cloud/session";
import { problemaConfigurazione } from "../lib/cloud/supabase";

/**
 * Unica pagina raggiungibile senza un account. Mostra cosa si trova dentro
 * l'app, così chi arriva dalla schermata di accesso sa cosa sta facendo,
 * senza vedere dati: sono descrizioni, non contenuti.
 */
const PERCHE = [
  {
    Icona: UsersIcon,
    titolo: "Anagrafiche",
    testo: "Un schedario per le persone, con documento, contatti e domicilio.",
  },
  {
    Icona: FileTextIcon,
    titolo: "Relazioni",
    testo: "Ogni relazione è legata alla sua anagrafica e ne segue lo stato.",
  },
  {
    Icona: CalendarIcon,
    titolo: "Appuntamenti",
    testo: "Si pubblicano su Google Calendar e restano collegati alla scheda.",
  },
];

export default function Accesso() {
  const { email, loading, error, signInWithGoogle } = useAccount();
  const { esegui } = useAvvisi();
  const posizione = useLocation();
  const da = (posizione.state as { da?: string } | null)?.da ?? "/panel";

  if (!loading && email) return <Navigate to={da} replace />;

  return (
    <div className="flex min-h-dvh flex-col">
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col justify-center px-5 py-12 sm:px-6">
        <div className="mx-auto w-full max-w-md text-center">
          <p className="font-display text-3xl leading-none text-ink-950">Reportini</p>
          <p className="mt-2 text-sm text-ink-400">Anagrafiche, relazioni e appuntamenti</p>

          <div className="card mt-8 p-6 text-left">
            <h1 className="text-lg text-ink-900">Accedi per continuare</h1>
            <p className="mt-1.5 text-sm text-ink-500">
              L&apos;accesso è con il tuo account Google. Ogni utente vede solo i propri dati, e
              restano salvati online.
            </p>

            <Button
              className="mt-5 w-full justify-center"
              onClick={() => {
                void esegui(() => signInWithGoogle(), {
                  // signInWithGoogle non conclude quasi mai: la pagina viene
                  // scaricata verso Google. Si arriva qui solo se è fallito.
                  errore: "Accesso con Google non riuscito",
                });
              }}
              disabled={loading}
            >
              {loading ? "Accesso in corso…" : "Accedi con Google"}
            </Button>

            {/* L'errore dell'accesso resta qui, non solo nell'avviso che sparisce
                dopo qualche secondo: è l'unica spiegazione quando il pulsante
                premuto non porta da nessuna parte. */}
            {error ? (
              <p className="mt-3 rounded-xl bg-clay-50 px-3 py-2 text-xs leading-relaxed text-clay-900">
                {error}
              </p>
            ) : null}

            {problemaConfigurazione ? (
              <p className="mt-3 rounded-xl bg-clay-50 px-3 py-2 text-xs text-clay-900">
                {problemaConfigurazione}
              </p>
            ) : null}
          </div>

          <p className="mt-4 text-xs leading-relaxed text-ink-400">
            Nessuna password da ricordare: l&apos;accesso passa da Google. Esci quando vuoi, i
            dati restano dove sono.
          </p>
        </div>

        <ul className="mx-auto mt-10 grid w-full max-w-3xl gap-3 sm:grid-cols-3">
          {PERCHE.map(({ Icona, titolo, testo }) => (
            <li key={titolo} className="card p-4">
              <Icona className="h-5 w-5 text-brand-600" />
              <p className="mt-2 text-sm font-semibold text-ink-800">{titolo}</p>
              <p className="mt-1 text-xs leading-relaxed text-ink-500">{testo}</p>
            </li>
          ))}
        </ul>
      </main>
    </div>
  );
}
