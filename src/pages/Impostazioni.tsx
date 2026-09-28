import { useEffect, useRef, useState, type ChangeEvent } from "react";
import {
  CalendarIcon,
  CloudIcon,
  DownloadIcon,
  RotateIcon,
  SparkIcon,
  UploadIcon,
  UserIcon,
} from "../components/icons";
import { Button, Card, PageHeader } from "../components/ui";
import { useAvvisi } from "../components/Avvisi";
import ChiediloAlloSviluppatore from "../components/ChiediloAlloSviluppatore";
import VersioniBackup from "../components/VersioniBackup";
import { useLiveQuery } from "../hooks/useLiveQuery";
import { useSalvataggioCloud } from "../hooks/useSalvataggioCloud";
import { useAccount } from "../lib/cloud/session";
import { useAggiornamento } from "../lib/aggiornamento";
import { sincronizza } from "../lib/cloud/sync";
import { cloudEnabled } from "../lib/cloud/supabase";
import {
  connect,
  disconnect,
  googleConfigured,
  isConnected,
  readProfile,
  type GoogleProfile,
} from "../lib/google/auth";
import { scaricaTuttiGliAppuntamenti } from "../lib/google/calendar";
import { sincronizzaInAttesa } from "../lib/google/sync";
import { creaBackup, elencaAppuntamenti, ripristinaBackup, type Backup } from "../lib/repo";
import { flush } from "../lib/sqlite/engine";

/** Orario dell'ultimo salvataggio, in formato breve italiano. */
function orario(iso: string): string {
  return new Date(iso).toLocaleTimeString("it-IT", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export default function Impostazioni() {
  const fileInput = useRef<HTMLInputElement>(null);
  const { notifica, esegui } = useAvvisi();
  const [occupato, setOccupato] = useState(false);
  // Lo stato di collegamento lo decide il token, non il profilo: il profilo
  // arriva con una richiesta a parte e può arrivare dopo il primo render.
  const [collegato, setCollegato] = useState(() => isConnected());
  const [profilo, setProfilo] = useState<GoogleProfile | null>(() => readProfile());
  const appuntamenti = useLiveQuery(() => elencaAppuntamenti());
  const sincronizzati = appuntamenti.filter((a) => a.googleEventId).length;
  const {
    email: accountEmail,
    session,
    signInWithGoogle: signInAccount,
    signOut: signOutAccount,
  } = useAccount();
  const salvataggio = useSalvataggioCloud();
  const aggiornamento = useAggiornamento();
  // Il bucket tiene i file in <user-id>/… e le RLS lo confrontano con l'id
  // dell'utente autenticato: con l'email la scrittura viene respinta.
  const userId = session?.user?.id ?? null;

  useEffect(() => {
    setCollegato(isConnected());
    setProfilo(readProfile());
  }, []);

  async function esportaCopia() {
    await esegui(
      async () => {
        await flush();
        const copia = creaBackup();
        const blob = new Blob([JSON.stringify(copia, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `reportini-${new Date().toISOString().slice(0, 10)}.json`;
        link.click();
        URL.revokeObjectURL(url);
        return copia;
      },
      {
        successo: (c) =>
          `Copia esportata: ${c.anagrafici.length} anagrafiche, ${c.relazioni.length} relazioni, ${c.appuntamenti.length} appuntamenti.`,
        errore: "Esportazione non riuscita",
      },
    );
  }

  async function importaCopia(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!confirm("Questo sostituirà tutti i dati attuali. Vuoi continuare?")) {
      event.target.value = "";
      return;
    }
    await esegui(
      async () => {
        const copia = JSON.parse(await file.text()) as Backup;
        if (!Array.isArray(copia.anagrafici) || !Array.isArray(copia.appuntamenti)) {
          throw new Error("Il file non ha il formato atteso");
        }
        ripristinaBackup(copia);
      },
      { successo: "Copia ripristinata correttamente.", errore: "" },
    );
    event.target.value = "";
  }

  async function collegaGoogle() {
    setOccupato(true);
    // connect() lascia la pagina verso Google: qui si arriva solo se è
    // fallito, e la riga di errore è l'unica cosa che resta.
    await esegui(() => connect(), {
      successo: (account) => `Collegato come ${account.email}.`,
      errore: "Collegamento a Google Calendar non riuscito",
    });
    setOccupato(false);
  }

  async function sincronizzaTutto() {
    setOccupato(true);
    await esegui(() => sincronizzaInAttesa(), {
      successo: (r) => r.messaggio,
      errore: "Sincronizzazione degli appuntamenti non riuscita",
    });
    setOccupato(false);
  }

  return (
    <div>
      <PageHeader title="Impostazioni" subtitle="Il tuo account, i collegamenti e le copie" />

      <section className="mb-5">
        <Card className="p-5">
          <h2 className="flex items-center gap-2 text-lg">
            <UserIcon className="h-5 w-5 text-ink-400" />
            Il tuo account
          </h2>
          <p className="mt-1.5 text-sm text-ink-500">
            {cloudEnabled
              ? "Con l'accesso con Google i tuoi dati vengono salvati online dopo ogni modifica e ritrovati su qualsiasi dispositivo."
              : "L'accesso con Google non è configurato: i dati restano su questo dispositivo."}
          </p>
          <dl className="mt-3 space-y-2 text-sm">
            <div className="flex items-center justify-between gap-4">
              <dt className="text-ink-400">Account</dt>
              <dd className="flex min-w-0 items-center gap-2">
                <span className="truncate text-ink-800">{accountEmail ?? "non collegato"}</span>
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-ink-400">Salvataggio online</dt>
              <dd className="flex items-center gap-1.5 text-ink-800">
                <CloudIcon className="h-3.5 w-3.5 text-ink-400" />
                {cloudEnabled ? "attivo" : "disattivato"}
              </dd>
            </div>
            {cloudEnabled ? (
              <div className="flex justify-between gap-4">
                <dt className="text-ink-400">Ultimo salvataggio</dt>
                <dd
                  className={`text-right ${salvataggio.stato === "errore" ? "text-clay-700" : "text-ink-800"}`}
                >
                  {salvataggio.stato === "errore"
                    ? salvataggio.messaggio
                    : salvataggio.ultimoSalvataggio
                      ? `${orario(salvataggio.ultimoSalvataggio)} · ${salvataggio.messaggio || "salvato"}`
                      : "in corso…"}
                </dd>
              </div>
            ) : null}
          </dl>
          <div className="mt-4 flex flex-wrap gap-2">
            {accountEmail ? (
              <>
                <Button
                  variant="secondary"
                  onClick={async () => {
                    if (!userId) {
                      notifica("errore", "Non riesco a riconoscere l'utente: esci e rientra.");
                      return;
                    }
                    setOccupato(true);
                    // "solo_upload": il pulsante manda i dati locali al cloud.
                    // Con la sincronizzazione completa una copia vuota su un
                    // dispositivo nuovo verrebbe riscaricata al posto di quella
                    // appena scritta.
                    await esegui(() => sincronizza(userId, "solo_upload"), {
                      successo: (r) => r.messaggio,
                      errore: "Salvataggio online non riuscito",
                    });
                    setOccupato(false);
                  }}
                  disabled={occupato || !userId}
                >
                  Salva subito online
                </Button>
                <Button
                  variant="ghost"
                  onClick={async () => {
                    // Il guard delle pagine manda alla schermata di accesso
                    // appena la sessione sparisce: non serve navigare qui, e
                    // l'avviso resta visibile perché vive fuori dal router.
                    await esegui(() => signOutAccount(), {
                      successo: "Sessione chiusa",
                      errore: "Uscita non riuscita",
                    });
                  }}
                >
                  Esci
                </Button>
              </>
            ) : (
              <Button onClick={() => void signInAccount()} disabled={!cloudEnabled}>
                Accedi con Google
              </Button>
            )}
          </div>
        </Card>
      </section>

      <section className="mb-5">
        <Card className="p-5">
          <h2 className="flex items-center gap-2 text-lg">
            <CalendarIcon className="h-5 w-5 text-ink-400" />
            Google Calendar
          </h2>
          <p className="mt-1.5 text-sm text-ink-500">
            {collegato
              ? `Collegato come ${profilo?.email ?? accountEmail ?? "questo account"}. ${sincronizzati} appuntamenti su ${appuntamenti.length} sono già pubblicati.`
              : googleConfigured
                ? "Collega il tuo account per pubblicare gli appuntamenti con un tocco."
                : "L'accesso con Google passa da Supabase: senza, non c'è modo di ottenere un token Calendar."}
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            {collegato ? (
              <>
                <Button onClick={sincronizzaTutto} disabled={occupato}>
                  {occupato ? "Sincronizzazione…" : "Sincronizza in attesa"}
                </Button>
                <Button
                  variant="secondary"
                  onClick={async () => {
                    // disconnect() revoca il consenso via API: se la revoca
                    // fallisce l'utente deve saperlo, perché l'app resta
                    // autorizzata su myaccount.google.com/permissions.
                    await esegui(() => disconnect(), {
                      successo: (r) =>
                        r.revocato
                          ? "Account Google scollegato."
                          : "Token rimosso, ma la revoca su Google non è riuscita: l'app resta autorizzata su myaccount.google.com/permissions.",
                    });
                    setCollegato(false);
                    setProfilo(null);
                  }}
                >
                  Scollega
                </Button>
              </>
            ) : (
              <Button onClick={collegaGoogle} disabled={occupato || !googleConfigured}>
                {occupato ? "Collegamento…" : "Collega account"}
              </Button>
            )}
            <Button
              variant="secondary"
              onClick={() => {
                scaricaTuttiGliAppuntamenti(appuntamenti);
                notifica("ok", `${appuntamenti.length} appuntamenti esportati in formato .ics.`);
              }}
              disabled={appuntamenti.length === 0}
            >
              <DownloadIcon className="h-4 w-4" />
              Esporta .ics
            </Button>
          </div>
        </Card>
      </section>

      <section className="mb-8">
        <Card className="p-5">
          <h2 className="text-lg">Copie di sicurezza</h2>
          <p className="mt-1.5 text-sm text-ink-500">
            Esporta tutto il contenuto in un file JSON e ripristinalo su qualunque dispositivo.
            È utile come copia di sicurezza quando non hai un account collegato.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button variant="secondary" onClick={esportaCopia}>
              <DownloadIcon className="h-4 w-4" />
              Esporta copia
            </Button>
            <Button variant="secondary" onClick={() => fileInput.current?.click()}>
              <UploadIcon className="h-4 w-4" />
              Ripristina copia
            </Button>
            <input
              ref={fileInput}
              type="file"
              accept="application/json"
              className="hidden"
              onChange={importaCopia}
            />
          </div>
        </Card>
      </section>

      <ChiediloAlloSviluppatore />

      <VersioniBackup />

      <section className="mb-8">
        <Card className="p-5">
          <h2 className="text-lg">Aggiornamenti</h2>
          <p className="mt-1.5 text-sm text-ink-500">
            {aggiornamento.disponibile
              ? "L'app controlla da sola se c'è una versione nuova e la scarica in sottofondo. Quando è pronta la trovi in alto, e un clic la installa."
              : "Qui Reportini gira nel browser: non c'è niente da installare, ogni volta che torni basta ricaricare la pagina per avere l'ultima versione."}
          </p>
          <p className="mt-3 text-sm text-ink-400">
            {aggiornamento.descrizione ??
              (aggiornamento.disponibile
                ? "Nessun aggiornamento da mettere."
                : "Versione web.")}
            {aggiornamento.versione ? ` Versione installata ${aggiornamento.versione}.` : ""}
          </p>
          {aggiornamento.disponibile ? (
            <div className="mt-4 flex flex-wrap gap-2">
              <Button
                variant="secondary"
                onClick={() => void aggiornamento.controlla()}
                disabled={aggiornamento.occupato}
              >
                <RotateIcon className="h-4 w-4" />
                Controlla adesso
              </Button>
              {aggiornamento.pronto ? (
                <Button
                  onClick={() => void aggiornamento.installa()}
                  disabled={aggiornamento.occupato}
                >
                  {aggiornamento.occupato ? "Installo…" : "Installa l'aggiornamento"}
                </Button>
              ) : null}
            </div>
          ) : null}
        </Card>
      </section>

      <section>
        <Card className="bg-ink-950 p-5 text-white">
          <h2 className="flex items-center gap-2 text-lg text-white">
            <SparkIcon className="h-5 w-5 text-brand-300" />
            Su questa versione
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-ink-200">
            Reportini funziona sul cellulare, nel browser e come app desktop con Electron. Ogni
            persona vede solo i propri dati, grazie all'accesso con il proprio account Google.
          </p>
        </Card>
      </section>
    </div>
  );
}
