import { Component, type ErrorInfo, type ReactNode } from "react";
import { isDesktop } from "../lib/sqlite/storage";

/**
 * Una pagina bianca non dice niente.
 *
 * Un errore durante un render di React smonta l'albero e lascia il contenitore
 * vuoto: senza questa rete l'utente vede una finestra bianca e non sa se
 * l'app sia rotta, se i suoi dati siano spariti o che cosa sia successo. Il
 * gate del database copre il caso più probabile (il file SQLite che non si
 * apre) ma non un errore in una vista, e nel desktop non c'è nemmeno una
 * console in cui leggerlo.
 *
 * Qui si mostra l'errore per esteso, e si dice dove trovarne il dettaglio:
 * nel desktop è il file `renderer.log` accanto ai dati.
 */
export function SchermataErrore({ errore, desktop }: { errore: Error; desktop: boolean }) {
  return (
    <div className="flex min-h-dvh items-center justify-center p-6">
      <div className="card max-w-lg p-6">
        <h1 className="font-display text-2xl leading-tight">Impossibile mostrare l'app</h1>
        <p className="mt-2 text-sm text-ink-500">
          I tuoi dati non sono persi: restano dove sono. Qualcosa è andato storto mentre l'app
          disegnava la schermata, e la pagina è rimasta bianca.
        </p>
        <pre className="mt-4 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-ink-950 p-3 text-[11px] leading-relaxed text-ink-100">
          {errore.message || String(errore)}
        </pre>
        <p className="mt-4 text-xs text-ink-400">
          {desktop
            ? "Il dettaglio completo, con lo stack, è nel file renderer.log nella cartella dati di Reportini (%APPDATA%\\reportini su Windows)."
            : "Ricarica la pagina: se il messaggio torna, segnalalo dalla sezione Chiedilo allo sviluppatore."}
        </p>
      </div>
    </div>
  );
}

export default class ErroreAvvio extends Component<
  { children: ReactNode },
  { errore: Error | null }
> {
  // Lo stato arriva da getDerivedStateFromError: React lo mette in this.state.
  state: { errore: Error | null } = { errore: null };

  static getDerivedStateFromError(errore: Error) {
    return { errore };
  }

  componentDidCatch(errore: Error, info: ErrorInfo) {
    console.error("Reportini non è riuscito a mostrare l'app:", errore, info.componentStack);
  }

  render() {
    const { errore } = this.state;
    if (!errore) return this.props.children;
    return <SchermataErrore errore={errore} desktop={isDesktop} />;
  }
}
