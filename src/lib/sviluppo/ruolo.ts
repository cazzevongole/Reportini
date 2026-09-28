import { useEffect, useState } from "react";
import { verificaRuolo, type EsitoRuolo } from "./richieste";

/**
 * Chi è l'utente, per l'app.
 *
 * `null` finché il database non ha risposto, e va trattato come "non
 * Mostrare niente": mostrare il collegamento allo sviluppo e poi tirarlo
 * indietro sarebbe peggio che non mostrarlo.
 *
 * Il ruolo è memorizzato per la sessione, quindi la pagina delle impostazioni
 * e quella dello sviluppo non fanno due richieste per la stessa domanda.
 */
export function useRuoloSviluppatore(): EsitoRuolo | null {
  const [ruolo, setRuolo] = useState<EsitoRuolo | null>(null);

  useEffect(() => {
    let vivo = true;
    void verificaRuolo().then((esito) => {
      if (vivo) setRuolo(esito);
    });
    return () => {
      vivo = false;
    };
  }, []);

  return ruolo;
}
