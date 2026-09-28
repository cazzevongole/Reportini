import { Link } from "react-router-dom";
import {
  CalendarIcon,
  ChevronRightIcon,
  CloudIcon,
  FileTextIcon,
  SparkIcon,
  UserIcon,
  UsersIcon,
} from "../components/icons";
import { useAccount } from "../lib/cloud/session";

const FUNZIONALITA = [
  {
    icon: UsersIcon,
    titolo: "Anagrafici sempre a portata di mano",
    testo:
      "Nome, documento, data di nascita, domicilio e contatti in un'unica scheda per persona.",
  },
  {
    icon: FileTextIcon,
    titolo: "Relazioni collegate",
    testo:
      "Ogni relazione è agganciata al suo anagrafico, con stato bozza, revisione, firmato o consegnato.",
  },
  {
    icon: CalendarIcon,
    titolo: "Appuntamenti su Google Calendar",
    testo:
      "Fissa l'appuntamento con promemoria e luogo e pubblicalo sul calendario con un tocco. Senza credenziali puoi esportare .ics.",
  },
  {
    icon: CloudIcon,
    titolo: "Sempre con te",
    testo:
      "Accedi con il tuo account Google e ritrovi tutto quello che hai scritto, su qualsiasi dispositivo.",
  },
];

const PASSI = [
  {
    passo: "01",
    titolo: "Registra l'anagrafico",
    testo:
      "Crea la scheda con i dati anagrafici e di residenza. Ritrovala subito per nome o documento.",
  },
  {
    passo: "02",
    titolo: "Redigi la relazione",
    testo:
      "Scrivi la relazione collegata a quella persona e aggiorna lo stato man mano che l'iterazione avanza.",
  },
  {
    passo: "03",
    titolo: "Sincronizza l'appuntamento",
    testo:
      "Scegli giorno e ora, aggiungi il promemoria e l'appuntamento compare su Google Calendar con il contesto della relazione.",
  },
];

export default function Landing() {
  const { email, signInWithGoogle, cloudEnabled } = useAccount();

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-30 border-b border-ink-100/70 bg-[rgb(var(--paper))]/85 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-5 py-3.5">
          <span className="font-display text-xl leading-none">Reportini</span>
          <Link
            to="/panel"
            className="inline-flex items-center gap-1.5 rounded-xl bg-ink-950 px-4 py-2 text-sm font-medium text-white shadow-soft transition-colors hover:bg-ink-800"
          >
            {email ? "Vai al pannello" : "Accedi"}
            <ChevronRightIcon className="h-4 w-4" />
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-5">
        {/* Hero */}
        <section className="animate-fade-up pt-12 sm:pt-20">
          <p className="inline-flex items-center gap-2 rounded-full border border-brand-200 bg-brand-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-brand-800">
            <SparkIcon className="h-3.5 w-3.5" />
            Pensata per il cellulare
          </p>
          <h1 className="mt-5 text-[38px] leading-[1.05] sm:text-6xl">
            Le relazioni dei tuoi
            <span className="relative mx-2 inline-block">
              <span className="relative z-10 text-brand-700">anagrafici</span>
              <span className="absolute inset-x-0 bottom-1 z-0 h-3 rounded bg-brand-200/70" />
            </span>
            e i loro appuntamenti, in un posto solo.
          </h1>
          <p className="mt-5 max-w-xl text-[17px] leading-relaxed text-ink-500">
            Reportini unisce la scheda anagrafica, le relazioni e l'appuntamento allo sportello.
            Accedi con Google e ritrovi tutto quello che hai scritto, dal telefono o dal computer.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            {cloudEnabled && !email ? (
              <button
                type="button"
                onClick={() => void signInWithGoogle()}
                className="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-ink-950 px-6 text-[15px] font-medium text-white shadow-lift transition-colors hover:bg-ink-800"
              >
                <UserIcon className="h-4 w-4" />
                Accedi con Google
              </button>
            ) : (
              <Link
                to="/panel"
                className="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-ink-950 px-6 text-[15px] font-medium text-white shadow-lift transition-colors hover:bg-ink-800"
              >
                {email ? "Vai al pannello" : "Apri l'app"}
                <ChevronRightIcon className="h-4 w-4" />
              </Link>
            )}
            <a
              href="#come-funziona"
              className="inline-flex h-12 items-center justify-center rounded-xl border border-ink-200 bg-white px-6 text-[15px] font-medium text-ink-700 transition-colors hover:border-ink-300"
            >
              Come funziona
            </a>
          </div>
        </section>

        {/* Funzionalità */}
        <section className="py-16 sm:py-24">
          <h2 className="text-3xl sm:text-4xl">Tutto il fascicolo, a un tocco</h2>
          <p className="mt-3 max-w-lg text-ink-500">
            Tre schede, nessun menu nascosto. Pensata per essere usata con una mano sola mentre sei
            allo sportello.
          </p>
          <div className="mt-8 grid gap-4 sm:grid-cols-2">
            {FUNZIONALITA.map(({ icon: Icona, titolo, testo }) => (
              <article key={titolo} className="card p-5 transition-shadow hover:shadow-lift">
                <span className="grid h-10 w-10 place-items-center rounded-xl bg-ink-950 text-white">
                  <Icona className="h-5 w-5" />
                </span>
                <h3 className="mt-4 text-lg">{titolo}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-ink-500">{testo}</p>
              </article>
            ))}
          </div>
        </section>

        {/* Flusso */}
        <section id="come-funziona" className="py-4 sm:py-10">
          <h2 className="text-3xl sm:text-4xl">Dalla scheda all'appuntamento, in tre passi</h2>
          <ol className="mt-8 space-y-4">
            {PASSI.map((passo) => (
              <li key={passo.passo} className="card flex gap-4 p-5">
                <span className="font-display text-2xl text-brand-500">{passo.passo}</span>
                <div>
                  <h3 className="text-lg">{passo.titolo}</h3>
                  <p className="mt-1 text-sm leading-relaxed text-ink-500">{passo.testo}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        {/* Account */}
        <section className="py-16 sm:py-20">
          <div className="card overflow-hidden p-0">
            <div className="grid gap-0 sm:grid-cols-2">
              <div className="bg-ink-950 p-7 text-white sm:p-9">
                <CloudIcon className="h-7 w-7 text-brand-300" />
                <h2 className="mt-4 text-2xl text-white">Un account, ovunque</h2>
                <p className="mt-3 text-sm leading-relaxed text-ink-200">
                  Ogni modifica viene salvata online mentre lavori. Se cambi telefono, apri
                  Reportini da un altro dispositivo e trovi tutto esattamente dove l'avevi lasciato.
                </p>
              </div>
              <div className="p-7 sm:p-9">
                <h3 className="text-lg">Senza account propri</h3>
                <ul className="mt-4 space-y-3 text-sm text-ink-500">
                  {[
                    "Accedi con l'account Google che usi già.",
                    "Ogni persona vede solo i propri dati.",
                    "Puoi esportare tutto quando vuoi, anche senza rete.",
                  ].map((voce) => (
                    <li key={voce} className="flex gap-2.5">
                      <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-500" />
                      {voce}
                    </li>
                  ))}
                </ul>
                <Link
                  to="/panel/impostazioni"
                  className="mt-6 inline-flex items-center gap-1.5 text-sm font-medium text-brand-700 hover:text-brand-800"
                >
                  Vai alle impostazioni
                  <ChevronRightIcon className="h-4 w-4" />
                </Link>
              </div>
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="pb-20">
          <div className="rounded-3xl border border-ink-100 bg-white p-8 text-center shadow-soft sm:p-12">
            <h2 className="text-3xl sm:text-4xl">Pronto quando lo sei tu</h2>
            <p className="mx-auto mt-3 max-w-md text-ink-500">
              Crea il primo anagrafico, allega la relazione e fissa l'appuntamento. Tre passi e
              hai il fascicolo completo.
            </p>
            <Link
              to="/panel"
              className="mt-7 inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-brand-600 px-7 text-[15px] font-medium text-white shadow-lift transition-colors hover:bg-brand-700"
            >
              {email ? "Vai al pannello" : "Accedi con Google"}
              <ChevronRightIcon className="h-4 w-4" />
            </Link>
          </div>
        </section>
      </main>

      <footer className="border-t border-ink-100/70 py-8">
        <div className="mx-auto flex max-w-5xl flex-col items-center justify-between gap-2 px-5 text-xs text-ink-400 sm:flex-row">
          <p>Reportini · relazioni anagrafiche e gestione appuntamenti</p>
          <p>Accesso con account Google</p>
        </div>
      </footer>
    </div>
  );
}
