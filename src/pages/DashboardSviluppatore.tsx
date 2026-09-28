import { Navigate } from "react-router-dom";
import { BugIcon, CheckIcon, CloudIcon } from "../components/icons";
import { Badge, Button, Card, PageHeader, Stat } from "../components/ui";
import { useAvvisi } from "../components/Avvisi";
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
  const { notifica, esegui } = useAvvisi();
  const dati = useLiveQuery(() => riepilogo());
  const anagrafici = useLiveQuery(() => elencaAnagrafici());
  const relazioni = useLiveQuery(() => elencaRelazioni());
  const appuntamenti = useLiveQuery(() => elencaAppuntamenti());

  if (!isDeveloper) return <Navigate to="/panel" replace />;

  async function forzaSalvataggio() {
    // Nel bucket il percorso è <user-id>/…: con l'email la scrittura viene
    // respinta dalle RLS e il pulsante sembra non fare nulla.
    const userId = session?.user?.id;
    if (!userId) {
      notifica("errore", "Sessione senza id utente: esci e rientra.");
      return;
    }
    await esegui(() => sincronizza(userId, "solo_upload"), {
      successo: (r) => r.messaggio,
      errore: "Salvataggio nel cloud non riuscito",
    });
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
              onClick={async () => {
                const id = session?.user.id ?? "";
                if (!id) {
                  notifica("errore", "Sessione senza id utente: esci e rientra.");
                  return;
                }
                await esegui(() => navigator.clipboard.writeText(id), {
                  successo: "ID account copiato negli appunti.",
                  errore: "Copia negli appunti non riuscita",
                });
              }}
            >
              Copia ID account
            </Button>
          </div>
        </Card>
      </section>

      <section>
        <Card className="p-5">
          <h2 className="text-lg">Sessione</h2>
          <p className="mt-1.5 text-sm text-ink-500">
            Account Google collegato: {email}
          </p>
          <Button
            variant="secondary"
            className="mt-4"
            onClick={() => {
              void esegui(() => signOut(), {
                successo: "Sessione chiusa",
                errore: "Uscita non riuscita",
              });
            }}
          >
            Esci
          </Button>
        </Card>
      </section>
    </div>
  );
}
