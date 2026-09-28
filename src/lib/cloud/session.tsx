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
import { adottaTokenDiSessione, SCOPO_CALENDARIO } from "../google/auth";
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

export function AccountProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(cloudEnabled);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!supabase) return;
    let attivo = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!attivo) return;
      adottaTokenDiSessione(data.session?.provider_token);
      setSession(data.session ?? null);
      setLoading(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_evento, prossima) => {
      // Supabase ha scambiato il codice per noi lato server: il token Google
      // arriva qui con la sessione e va custodito per Calendar.
      adottaTokenDiSessione(prossima?.provider_token);
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
      options: {
        redirectTo: urlDiRitorno(window.location.origin, import.meta.env.BASE_URL),
        // Lo scope Calendar è un accesso solo, non un secondo consenso.
        // "scopes" finisce nella lista degli scope: qui deve esserci l'URL
        // esatto, non un'impostazione come "offline".
        scopes: SCOPO_CALENDARIO,
        // offline e prompt sono parametri OAuth, non scope: senza, Google non
        // consegna il refresh token e il rinnovo non è nemmeno ipotizzabile.
        queryParams: { access_type: "offline", prompt: "consent" },
      },
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
