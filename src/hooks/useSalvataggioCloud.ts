import { useEffect, useState } from "react";
import { useAccount } from "../lib/cloud/session";
import {
  avviaAutoSync,
  iscrivitiAllaSalvataggio,
  resetSincronizzazione,
  statoSalvataggio,
  type SincronizzazioneInfo,
} from "../lib/cloud/sync";

/**
 * Salvataggio online automatico: dopo ogni scrittura locale il database
 * viene copiato nel cloud, con un cooldown di qualche secondo.
 *
 * Sta in un hook e non in un componente di pagina per due motivi: deve
 * accendersi per tutta la sessione, non solo su una schermata, e non
 * deve stare nella barra in cima alle pagine, che l'utente ha chiesto di
 * alleggerire. Il pulsante "Salva subito online" delle impostazioni usa
 * questo stesso stato per dire a quando risale l'ultimo salvataggio.
 */

let annullaAttiva: (() => void) | null = null;
let utenteAttivo: string | null = null;

export function useSalvataggioCloud(): SincronizzazioneInfo {
  const { cloudEnabled, session } = useAccount();
  // Il percorso nel bucket è <user-id>/… e le politiche RLS lo confrontano
  // con l'id dell'utente autenticato: qui serve l'id, non l'email.
  const userId = session?.user?.id ?? null;
  const [info, setInfo] = useState<SincronizzazioneInfo>(statoSalvataggio);

  useEffect(() => iscrivitiAllaSalvataggio(setInfo), []);

  useEffect(() => {
    if (!cloudEnabled || !userId) {
      annullaAttiva?.();
      annullaAttiva = null;
      utenteAttivo = null;
      // Cambiando account (o uscendo) lo stato va dimenticato: al prossimo
      // accesso il cloud deve fare da fonte di verità.
      resetSincronizzazione();
      return;
    }

    // Più pagine possono usare l'hook: la sincronizzazione parte una volta sola.
    if (utenteAttivo === userId) return;

    annullaAttiva?.();
    // Utente nuovo: il dispositivo "non sa nulla" del cloud, quindi al primo
    // contatto deve poter scaricare la copia esistente invece di sovrascriverla.
    resetSincronizzazione();
    const { invia, annulla } = avviaAutoSync(userId);
    annullaAttiva = annulla;
    utenteAttivo = userId;
    void invia(true);

    return () => {
      annulla();
      if (utenteAttivo === userId) {
        annullaAttiva = null;
        utenteAttivo = null;
      }
    };
  }, [cloudEnabled, userId]);

  return info;
}
