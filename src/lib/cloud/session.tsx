import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { Session } from "@supabase/supabase-js";
import { baseRoutte, urlDiRitorno } from "./destinazione";
import { cloudEnabled, supabase } from "./supabase";
import { avviaAccessoGoogle, completaAccesso, googleConfigured } from "../google/auth";
import { resettaRuolo } from "../sviluppo/richieste";

export interface AccountState {
  /** Supabase non configurato: l'app lavora solo in locale. */
  cloudEnabled: boolean;
  session: Session | null;
  loading: boolean;
  email: string | null;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
  error: string | null;
}

const AccountContext = createContext<AccountState | null>(null);

/**
 * Il rientro da Google si chiude una volta sola per caricamento: la pagina
 * viene ricaricata, quindi l'URL con il `code` c'è fino a quando non è stato
 * scambiato. Senza questo blocco, un cambio di sessione lo rischierebbe di
 * farlo due volte e il secondo scambio fallirebbe.
 */
let accessoGirato = false;

function giraRientroDaGoogle(): void {
  if (accessoGirato) return;
  const url = new URL(window.location.href);
  if (!url.searchParams.has("code") && !url.searchParams.has("error")) return;
  accessoGirato = true;
  // Non è bloccante: se il backend non è pronto, `completaAccesso` ripiega
  // sull'accesso con Supabase da sola. Un errore qui non deve impedire
  // all'utente di entrare, quindi resta scritto e le impostazioni lo
  // mostrano.
  void completaAccesso().catch((causa: unknown) => {
    console.warn("Accesso con Google non riuscito:", causa);
  });
}

export function AccountProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(cloudEnabled);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!supabase) return;
    let attivo = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!attivo) return;
      setSession(data.session ?? null);
      giraRientroDaGoogle();
      setLoading(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_evento, prossima) => {
      setSession(prossima ?? null);
      giraRientroDaGoogle();
      setLoading(false);
    });

    return () => {
      attivo = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  const signInWithGoogle = useCallback(async () => {
    if (!supabase) {
      setError("Collega l'accesso con Google dalle variabili d'ambiente (VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY).");
      return;
    }
    setError(null);
    // Con il backend configurato l'accesso passa da Google **con** lo scope
    // del calendario: profilo e appuntamenti in un consenso solo. Senza
    // backend si entra lo stesso, ma solo col profilo, e le impostazioni
    // dicono cosa manca.
    if (googleConfigured) {
      try {
        await avviaAccessoGoogle();
      } catch (causa) {
        setError(causa instanceof Error ? causa.message : "Accesso non riuscito");
      }
      return;
    }
    // Su GitHub Pages l'app vive in una sottocartella (/Reportini/): tornare
    // all'origine finirebbe sulla pagina del profilo, non sull'app.
    const { error: errore } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: urlDiRitorno(window.location.origin, baseRoutte()) },
    });
    if (errore) setError(errore.message);
  }, []);

  const signOut = useCallback(async () => {
    if (!supabase) return;
    // Il ruolo (sviluppatore o no) è legato a chi è entrato: uscendo, la
    // risposta va dimenticata, altrimenti il prossimo utente di questo
    // dispositivo troverebbe la sezione sviluppo già aperta.
    resettaRuolo();
    await supabase.auth.signOut();
  }, []);

  const email = session?.user?.email ?? null;

  const valore = useMemo<AccountState>(
    () => ({
      cloudEnabled,
      session,
      loading,
      email,
      signInWithGoogle,
      signOut,
      error,
    }),
    [session, loading, email, signInWithGoogle, signOut, error],
  );

  return <AccountContext.Provider value={valore}>{children}</AccountContext.Provider>;
}

export function useAccount(): AccountState {
  const contesto = useContext(AccountContext);
  if (!contesto) throw new Error("useAccount va usato dentro <AccountProvider>");
  return contesto;
}
