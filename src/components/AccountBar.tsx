import { useEffect, useState } from "react";
import { CheckIcon, CloudIcon, UserIcon } from "./icons";
import { Button } from "./ui";
import { useAccount } from "../lib/cloud/session";
import { problemaConfigurazione } from "../lib/cloud/supabase";
import {
  avviaAutoSync,
  resetSincronizzazione,
  sincronizza,
  type SincronizzazioneInfo,
} from "../lib/cloud/sync";

const INIZIALE: SincronizzazioneInfo = {
  stato: "inattivo",
  messaggio: "",
  ultimoSalvataggio: null,
  prossimoTra: null,
};

/** Barra di account: accesso con Google e stato del salvataggio online. */
export default function AccountBar() {
  const { cloudEnabled, email, loading, isDeveloper, signInWithGoogle, signOut, error } =
    useAccount();
  const [info, setInfo] = useState<SincronizzazioneInfo>(INIZIALE);
  const userId = useAccount().session?.user?.id ?? null;

  useEffect(() => {
    if (!userId) {
      // Cambiando account (o uscendo) lo stato di sync va dimenticato:
      // al prossimo accesso il cloud deve fare da fonte di verità.
      resetSincronizzazione();
      setInfo(INIZIALE);
      return;
    }
    resetSincronizzazione();
    const { invia, annulla } = avviaAutoSync(userId, setInfo);
    void invia(true);
    return annulla;
  }, [userId]);

  if (problemaConfigurazione) {
    return (
      <p className="mb-5 rounded-2xl border border-clay-300 bg-clay-50 px-4 py-3 text-xs leading-relaxed text-clay-900">
        <span className="font-semibold">Configurazione non valida.</span>{" "}
        {problemaConfigurazione}
      </p>
    );
  }

  if (!cloudEnabled) {
    return (
      <p className="mb-5 rounded-2xl border border-ink-200 bg-white/80 px-4 py-3 text-xs text-ink-400">
        Accesso con Google non configurato: i dati restano su questo dispositivo.
      </p>
    );
  }

  if (loading) return null;

  if (!email) {
    return (
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-ink-200 bg-white/80 px-4 py-3">
        <p className="text-sm text-ink-600">
          <span className="font-medium text-ink-800">Accedi con Google</span> per ritrovare i
          tuoi dati su qualsiasi dispositivo.
        </p>
        <Button size="sm" onClick={() => void signInWithGoogle()}>
          <UserIcon className="h-4 w-4" />
          Accedi
        </Button>
        {error ? <p className="w-full text-xs text-clay-600">{error}</p> : null}
      </div>
    );
  }

  return (
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-ink-200 bg-white/80 px-4 py-3">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-ink-800">{email}</p>
        <p className="flex items-center gap-1.5 text-xs text-ink-400">
          {info.stato === "sincronizzato" ? (
            <CheckIcon className="h-3.5 w-3.5 text-brand-600" />
          ) : (
            <CloudIcon className="h-3.5 w-3.5" />
          )}
          {info.messaggio || "Dati salvati online"}
        </p>
      </div>
      <div className="flex gap-2">
        {isDeveloper ? (
          <BadgeSviluppatore />
        ) : null}
        <Button
          size="sm"
          variant="secondary"
          onClick={() => email && void sincronizza(email)}
          title="Salva subito nel cloud"
        >
          Salva ora
        </Button>
        <Button size="sm" variant="ghost" onClick={() => void signOut()}>
          Esci
        </Button>
      </div>
    </div>
  );
}

function BadgeSviluppatore() {
  return (
    <span className="inline-flex h-9 items-center rounded-lg bg-clay-100 px-2.5 text-[11px] font-semibold uppercase tracking-wide text-clay-800">
      Sviluppo
    </span>
  );
}
