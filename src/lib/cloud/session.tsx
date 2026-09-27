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
import { urlDiRitorno } from "./destinazione";
import { cloudEnabled, supabase } from "./supabase";

/**
 * Email autorizzate a vedere la dashboard di sviluppo, lette dalla variabile
 * d'ambiente VITE_DEV_WHITELIST (separate da virgola).
 *
 * Attenzione: la whitelist vive nel bundle del browser, quindi protegge solo
 * contro accessi casuali. Per una barriera vera va verificata lato server.
 */
const WHITELIST_RAW = ((import.meta.env.VITE_DEV_WHITELIST as string | undefined) ?? "").trim();

const WHITELIST = WHITELIST_RAW.split(",")
  .map((email) => email.trim().toLowerCase())
  .filter(Boolean);

export interface AccountState {
  /** Supabase non configurato: l'app lavora solo in locale. */
  cloudEnabled: boolean;
  session: Session | null;
  loading: boolean;
  email: string | null;
  /** L'email dell'utente è nella whitelist di sviluppo. */
  isDeveloper: boolean;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
  error: string | null;
}

const AccountContext = createContext<AccountState | null>(null);

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
      setLoading(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_evento, prossima) => {
      setSession(prossima ?? null);
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
    // Su GitHub Pages l'app vive in una sottocartella (/Reportini/): tornare
    // all'origine finirebbe sulla pagina del profilo, non sull'app.
    const { error: errore } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: urlDiRitorno(window.location.origin, import.meta.env.BASE_URL) },
    });
    if (errore) setError(errore.message);
  }, []);

  const signOut = useCallback(async () => {
    if (!supabase) return;
    await supabase.auth.signOut();
  }, []);

  const email = session?.user?.email ?? null;

  const valore = useMemo<AccountState>(
    () => ({
      cloudEnabled,
      session,
      loading,
      email,
      isDeveloper: Boolean(email && WHITELIST.includes(email.toLowerCase())),
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
