import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { BugIcon, CheckIcon, CloudIcon } from "../components/icons";
import { Badge, Button, Card, PageHeader, Stat } from "../components/ui";
import { useLiveQuery } from "../hooks/useLiveQuery";
import { useAccount } from "../lib/cloud/session";
import { sincronizza } from "../lib/cloud/sync";
import { cloudEnabled } from "../lib/cloud/supabase";
import { elencaAnagrafici, elencaAppuntamenti, elencaRelazioni, riepilogo } from "../lib/repo";
import { isDesktop } from "../lib/sqlite/storage";

/**
 * Dashboard di controllo riservata agli account presenti in VITE_DEV_WHITELIST.
 * Chi non è in lista viene reindirizzato al pannello.
 */
export default function DashboardSviluppatore() {
  const { email, isDeveloper, session, signOut } = useAccount();
  const [azione, setAzione] = useState("");
  const dati = useLiveQuery(() => riepilogo());
  const anagrafici = useLiveQuery(() => elencaAnagrafici());
  const relazioni = useLiveQuery(() => elencaRelazioni());
  const appuntamenti = useLiveQuery(() => elencaAppuntamenti());

  useEffect(() => {
    setAzione("");
  }, [email]);

  if (!isDeveloper) return <Navigate to="/panel" replace />;

  async function forzaSalvataggio() {
    if (!email) return;
    setAzione("Salvataggio in corso…");
    try {
      const esito = await sincronizza(email);
      setAzione(esito.messaggio);
    } catch (errore) {
      setAzione(errore instanceof Error ? errore.message : "Salvataggio non riuscito");
    }
  }

  const tabelle = [
    { nome: "Anagrafici", righe: anagrafici.length },
    { nome: "Relazioni", righe: relazioni.length },
    { nome: "Appuntamenti", righe: appuntamenti.length },
  ];

  return (
    <div>
      <PageHeader
        title="Dashboard sviluppatore"
        subtitle="Visibile solo agli account in whitelist"
        action={<Badge tone="clay">whitelist</Badge>}
      />

      <Card className="mb-5 flex items-start gap-3 border-clay-200 bg-clay-50 p-4">
        <BugIcon className="mt-0.5 h-5 w-5 shrink-0 text-clay-700" />
        <div className="text-sm text-clay-900">
          <p className="font-medium">Account: {email}</p>
          <p className="mt-0.5 text-xs text-clay-800">
            La whitelist arriva da VITE_DEV_WHITELIST ed è compilata nel bundle: protegge contro
            accessi casuali, non è un controllo di sicurezza.
          </p>
        </div>
      </Card>

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Anagrafici" value={dati.anagrafici} />
        <Stat label="Relazioni" value={dati.relazioni} hint={`${dati.relazioniBozza} bozze`} tone="clay" />
        <Stat label="Appuntamenti" value={appuntamenti.length} tone="brand" />
        <Stat
          label="Ambiente"
          value={isDesktop ? "Desktop" : "Web"}
          hint={cloudEnabled ? "cloud on" : "solo locale"}
          tone={cloudEnabled ? "brand" : "muted"}
        />
      </div>

      <section className="mb-5">
        <Card className="p-5">
          <h2 className="flex items-center gap-2 text-lg">
            <CheckIcon className="h-5 w-5 text-ink-400" />
            Stato dei dati
          </h2>
          <dl className="mt-3 space-y-2 text-sm">
            {tabelle.map((tabella) => (
              <div key={tabella.nome} className="flex justify-between gap-4">
                <dt className="text-ink-400">{tabella.nome}</dt>
                <dd className="text-ink-800">{tabella.righe}</dd>
              </div>
            ))}
          </dl>
        </Card>
      </section>

      <section className="mb-5">
        <Card className="p-5">
          <h2 className="flex items-center gap-2 text-lg">
            <CloudIcon className="h-5 w-5 text-ink-400" />
            Sincronizzazione
          </h2>
          <p className="mt-1.5 text-sm text-ink-500">
            I dati vengono copiati nel cloud dopo ogni modifica. Al primo accesso su un nuovo
            dispositivo vince la copia online; poi contano le modifiche locali non ancora replicate.
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Button variant="secondary" onClick={() => void forzaSalvataggio()}>
              <CloudIcon className="h-4 w-4" />
              Salva subito nel cloud
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                void navigator.clipboard?.writeText(session?.user.id ?? "");
                setAzione("ID account copiato negli appunti.");
              }}
            >
              Copia ID account
            </Button>
          </div>
          {azione ? (
            <p className="mt-3 flex items-center gap-2 text-sm text-ink-600">
              <CheckIcon className="h-4 w-4 text-brand-600" />
              {azione}
            </p>
          ) : null}
        </Card>
      </section>

      <section>
        <Card className="p-5">
          <h2 className="text-lg">Sessione</h2>
          <p className="mt-1.5 text-sm text-ink-500">
            Account Google collegato: {email}
          </p>
          <Button variant="secondary" className="mt-4" onClick={() => void signOut()}>
            Esci
          </Button>
        </Card>
      </section>
    </div>
  );
}
