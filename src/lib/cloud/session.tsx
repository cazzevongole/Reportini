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
import { baseRoutte, motivoRientroNonValido, urlDiRitorno } from "./destinazione";
import { cloudEnabled, supabase } from "./supabase";
import {
  avviaAccessoGoogle,
  completaAccesso,
  cERitornoDaChiudere,
  googleConfigured,
  impostaArrivoDesktop,
  type EsitoAvvio,
} from "../google/auth";
import { resettaRuolo } from "../sviluppo/richieste";

export interface AccountState {
  /** Supabase non configurato: l'app lavora solo in locale. */
  cloudEnabled: boolean;
  session: Session | null;
  loading: boolean;
  email: string | null;
  signInWithGoogle: () => Promise<EsitoAvvio>;
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
  // Non basta guardare l'URL: sul desktop il rientro lo consegna il main
  // process, perché lì rimetterlo nell'indirizzo significherebbe far sembrare
  // il ricaricamento della finestra un rientro nuovo, e l'app ripartirebbe da
  // capo per sempre.
  if (!cERitornoDaChiudere()) return;
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

    // Il rientro del desktop lo tiene il main process finché qualcuno non lo
    // chiede: qui lo si chiede, una volta per finestra. È l'unico modo perché a
    // consumarlo sia il documento che vive e non quello che il main sta
    // ricaricando — la corsa che faceva morire lo scambio a metà strada
    // (electron/main.cjs, e il perché sta scritto in google/auth.ts).
    const ponte = (window as { reportini?: { arrivoGoogle?: () => Promise<string | null> } })
      .reportini;
    void ponte?.arrivoGoogle?.().then((arrivo) => {
      if (!attivo || !arrivo) return;
      impostaArrivoDesktop(arrivo);
      giraRientroDaGoogle();
    });

    return () => {
      attivo = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  const signInWithGoogle = useCallback(async (): Promise<EsitoAvvio> => {
    if (!supabase) {
      const messaggio =
        "Collega l'accesso con Google dalle variabili d'ambiente (VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY).";
      // Va nel log del desktop: senza, l'utente vede solo una riga che
      // sparisce e non sa che l'app non è collegata a nulla.
      console.error("accesso: Supabase non è configurato —", messaggio);
      setError(messaggio);
      return "navigazione";
    }
    setError(null);
    // Con il backend configurato l'accesso passa da Google **con** lo scope
    // del calendario: profilo e attivita in un consenso solo. Senza
    // backend si entra lo stesso, ma solo col profilo, e le impostazioni
    // dicono cosa manca.
    if (googleConfigured) {
      try {
        return await avviaAccessoGoogle();
      } catch (causa) {
        setError(causa instanceof Error ? causa.message : "Accesso non riuscito");
        return "navigazione";
      }
    }
    // Su una web in sottocartella tornare all'origine finirebbe su una pagina
    // che non è l'app: meglio aggiungere la base. Su reportini.cazzevongole.com
    // la base è "/" e l'origine va bene così com'è.
    const rientro = urlDiRitorno(window.location.origin, baseRoutte());
    // Stessa guardia del percorso con il calendario: senza un'origine
    // utilizzabile non c'è dove tornare, e senza controllo l'accesso fallisce
    // in silenzio. Qui la frase la dice l'utente, nel log la dice anche chi
    // deve sistemare.
    const motivo = motivoRientroNonValido(rientro);
    if (motivo) {
      console.error("accesso: rientro non utilizzabile —", motivo);
      setError(motivo);
      return "navigazione";
    }
    const { data, error: errore } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: rientro, skipBrowserRedirect: true },
    });
    if (errore) {
      setError(errore.message);
      return "navigazione";
    }
    if (!data?.url) {
      setError("Supabase non ha indicato l'indirizzo di accesso.");
      return "navigazione";
    }
    // Sul desktop l'indirizzo si apre nel browser di sistema; sulla web si
    // naviga come sempre. La stessa distinzione del percorso col calendario.
    const ponte = (window as { reportini?: { apriUrlEsterno?: (u: string) => Promise<boolean> } })
      .reportini;
    if (ponte?.apriUrlEsterno) {
      await ponte.apriUrlEsterno(data.url);
      return "browser";
    }
    window.location.assign(data.url);
    return "navigazione";
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
