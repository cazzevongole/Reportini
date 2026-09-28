import { useEffect, useRef, useState, type ChangeEvent } from "react";
import {
  CalendarIcon,
  CheckIcon,
  CloudIcon,
  DownloadIcon,
  SparkIcon,
  UploadIcon,
  UserIcon,
} from "../components/icons";
import { Badge, Button, Card, PageHeader } from "../components/ui";
import { useLiveQuery } from "../hooks/useLiveQuery";
import { useSalvataggioCloud } from "../hooks/useSalvataggioCloud";
import { useAccount } from "../lib/cloud/session";
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
  const [messaggio, setMessaggio] = useState("");
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
    isDeveloper,
    signInWithGoogle: signInAccount,
    signOut: signOutAccount,
  } = useAccount();
  const salvataggio = useSalvataggioCloud();
  // Il bucket tiene i file in <user-id>/… e le RLS lo confrontano con l'id
  // dell'utente autenticato: con l'email la scrittura viene respinta.
  const userId = session?.user?.id ?? null;

  useEffect(() => {
    setCollegato(isConnected());
    setProfilo(readProfile());
  }, []);

  async function esportaCopia() {
    await flush();
    const copia = creaBackup();
    const blob = new Blob([JSON.stringify(copia, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `reportini-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
    setMessaggio(
      `Copia esportata: ${copia.anagrafici.length} anagrafici, ${copia.relazioni.length} relazioni, ${copia.appuntamenti.length} appuntamenti.`,
    );
  }

  async function importaCopia(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!confirm("Questo sostituirà tutti i dati attuali. Vuoi continuare?")) {
      event.target.value = "";
      return;
    }
    try {
      const copia = JSON.parse(await file.text()) as Backup;
      if (!Array.isArray(copia.anagrafici) || !Array.isArray(copia.appuntamenti)) {
        throw new Error("Il file non ha il formato atteso");
      }
      ripristinaBackup(copia);
      setMessaggio("Copia ripristinata correttamente.");
    } catch (error) {
      setMessaggio(error instanceof Error ? error.message : "Impossibile leggere la copia");
    } finally {
      event.target.value = "";
    }
  }

  async function collegaGoogle() {
    setOccupato(true);
    setMessaggio("");
    try {
      const account = await connect();
      setMessaggio(`Collegato come ${account.email}.`);
    } catch (error) {
      setMessaggio(error instanceof Error ? error.message : "Collegamento non riuscito");
    } finally {
      setOccupato(false);
    }
  }

  async function sincronizzaTutto() {
    setOccupato(true);
    setMessaggio("");
    try {
      const risultato = await sincronizzaInAttesa();
      setMessaggio(risultato.messaggio);
    } finally {
      setOccupato(false);
    }
  }

  return (
    <div>
      <PageHeader title="Impostazioni" subtitle="Il tuo account, i collegamenti e le copie" />

      {messaggio ? (
        <p className="mb-5 flex items-start gap-2 rounded-xl border border-ink-100 bg-white px-3.5 py-2.5 text-sm text-ink-600">
          <CheckIcon className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" />
          {messaggio}
        </p>
      ) : null}

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
                {isDeveloper ? <Badge tone="clay">Sviluppo</Badge> : null}
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
                      setMessaggio("Non riesco a riconoscere l'utente: esci e rientra.");
                      return;
                    }
                    setOccupato(true);
                    setMessaggio("");
                    try {
                      // "solo_upload": il pulsante manda i dati locali al cloud.
                      // Con la sincronizzazione completa una copia vuota su un
                      // dispositivo nuovo verrebbe riscaricata al posto di quella
                      // appena scritta.
                      const esito = await sincronizza(userId, "solo_upload");
                      setMessaggio(esito.messaggio);
                    } catch (errore) {
                      setMessaggio(
                        errore instanceof Error
                          ? `Salvataggio online non riuscito: ${errore.message}`
                          : "Salvataggio online non riuscito",
                      );
                    } finally {
                      setOccupato(false);
                    }
                  }}
                  disabled={occupato || !userId}
                >
                  Salva subito online
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => {
                    // Il guard delle pagine manda alla schermata di accesso
                    // appena la sessione sparisce: non serve navigare qui.
                    void signOutAccount();
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
                  onClick={() => {
                    disconnect();
                    setCollegato(false);
                    setProfilo(null);
                    setMessaggio("Account Google scollegato.");
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
                setMessaggio(`${appuntamenti.length} appuntamenti esportati in formato .ics.`);
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
