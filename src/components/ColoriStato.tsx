import { useState } from "react";
import { Button } from "./ui";
import {
  COLORI_PREDEFINITI,
  ETICHETTA_STATO,
  PALETTE,
  colorePer,
  leggiColori,
  ripristinaColori,
  scriviColore,
  type ColoriPerStato,
} from "../lib/google/colori";
import type { StatoAttivita } from "../lib/types";

const STATI: StatoAttivita[] = ["in-attesa", "confermato", "annullato"];

/**
 * La scelta del colore per ogni stato.
 *
 * Sono le undici tonalità della palette di Google Calendar, mostrate con la
 * loro campione: l'utente sceglie un nome che conosce ("il blu", "il grigio")
 * e vede subito che è un colore che Google accetterà. Non si potrebbe
 * inventare: gli ID sono quelli della palette, e un ID inesistente fa
 * fallire la pubblicazione dell'attivita.
 *
 * Il colore si applica alle **pubblicazioni successive**. Rigorettare gli
 * eventi già pubblicati è un'azione a parte, e l'app non la fa da sola perché
 * significherebbe toccare l'agenda di un utente che non l'ha chiesto in quel
 * momento.
 */
export default function ColoriStato({ onApplicati }: { onApplicati?: (n: number) => void }) {
  const [scelti, setScelti] = useState<ColoriPerStato>(() => leggiColori());

  function scegli(stato: StatoAttivita, id: string) {
    scriviColore(stato, id);
    const prossimi = leggiColori();
    setScelti(prossimi);
    onApplicati?.(STATI.filter((s) => prossimi[s] !== COLORI_PREDEFINITI[s]).length);
  }

  function tornaAiPredefiniti() {
    ripristinaColori();
    setScelti(leggiColori());
  }

  const personalizzati = STATI.filter((s) => scelti[s] !== COLORI_PREDEFINITI[s]).length;

  return (
    <div className="mt-5 border-t border-ink-100 pt-4">
      <h3 className="text-sm font-semibold text-ink-900">Colore degli eventi</h3>
      <p className="mt-1 text-sm text-ink-500">
        Il colore con cui l'evento compare su Google Calendar, per stato. Vale per le pubblicazioni
        successive: gli eventi già in agenda prendono il colore nuovo quando li modifichi e li
        ripubblichi.
      </p>

      <div className="mt-3 space-y-3">
        {STATI.map((stato) => (
          <fieldset key={stato}>
            <legend className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-ink-400">
              {ETICHETTA_STATO[stato]}
            </legend>
            <div className="flex flex-wrap gap-1.5">
              {PALETTE.map((colore) => {
                const attivo = scelti[stato] === colore.id;
                return (
                  <button
                    key={colore.id}
                    type="button"
                    onClick={() => scegli(stato, colore.id)}
                    aria-pressed={attivo}
                    title={`${colore.nome}${attivo && colore.id !== COLORI_PREDEFINITI[stato] ? " (scelto da te)" : ""}`}
                    className={`h-7 w-7 rounded-full border-2 transition ${
                      attivo
                        ? "border-ink-900 ring-2 ring-ink-900/15"
                        : "border-white/70 hover:scale-110"
                    }`}
                    style={{ backgroundColor: colore.campione }}
                  >
                    <span className="sr-only">
                      {ETICHETTA_STATO[stato]}: {colore.nome}
                    </span>
                  </button>
                );
              })}
            </div>
          </fieldset>
        ))}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <p className="text-sm text-ink-500">
          Ora:{" "}
          {STATI.map((stato) => (
            <span key={stato} className="mr-2 inline-flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className="inline-block h-3 w-3 rounded-full"
                style={{ backgroundColor: colorePer(scelti[stato])?.campione }}
              />
              {ETICHETTA_STATO[stato]}
            </span>
          ))}
        </p>
        {personalizzati > 0 ? (
          <Button variant="secondary" onClick={tornaAiPredefiniti}>
            Torna ai colori iniziali
          </Button>
        ) : null}
      </div>
    </div>
  );
}
