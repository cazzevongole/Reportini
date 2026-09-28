import { Link } from "react-router-dom";
import { MessageIcon } from "./icons";
import { useRuoloSviluppatore } from "../lib/sviluppo/ruolo";

/**
 * Puntamento alla sezione nascosta dello sviluppatore.
 *
 * Sta nelle impostazioni, in fondo, e compare solo se il database dice che sei
 * lo sviluppatore. Non è un semplice `hidden` da togliere: il ruolo arriva
 * da `sei_sviluppatore()`, che legge una tabella che nessun client può
 * modificare, quindi nessuno altro vede questa riga.
 *
 * Il collegamento porta a una pagina che comunque riporterebbe al pannello chi
 * non è lo sviluppatore: qui si evita solo di mandare qualcuno a una porta
 * che si richiude.
 */
export default function SvoltaSviluppo() {
  const ruolo = useRuoloSviluppatore();
  if (ruolo?.ruolo !== "sviluppatore") return null;

  return (
    <Link
      to="/panel/sviluppo"
      className="mt-4 flex items-center gap-2.5 rounded-xl border border-white/10 bg-white/5 px-3.5 py-3 text-sm text-ink-100 transition-colors hover:border-brand-400/40 hover:bg-white/10"
    >
      <MessageIcon className="h-4 w-4 shrink-0 text-brand-300" />
      <span className="flex-1">Richieste degli utenti</span>
      <span className="text-xs text-ink-400">sezione sviluppo</span>
    </Link>
  );
}
