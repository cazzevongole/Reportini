import { useRef, useState, type ChangeEvent } from "react";
import GoogleStatus from "../components/GoogleStatus";
import {
  CalendarIcon,
  CheckIcon,
  CloseIcon,
  DownloadIcon,
  InfoIcon,
  SparkIcon,
  UploadIcon,
  UserIcon,
} from "../components/icons";
import { Button, Card, PageHeader } from "../components/ui";
import { useLiveQuery } from "../hooks/useLiveQuery";
import { useAccount } from "../lib/cloud/session";
import { sincronizza } from "../lib/cloud/sync";
import { cloudEnabled } from "../lib/cloud/supabase";
import { verificaIntegrazione, type Controllo } from "../lib/cloud/diagnostica";
import { urlDiRitorno } from "../lib/cloud/destinazione";
import { connect, disconnect, googleConfigured, readProfile } from "../lib/google/auth";
import { scaricaTuttiGliAppuntamenti } from "../lib/google/calendar";
import { sincronizzaInAttesa } from "../lib/google/sync";
import { creaBackup, elencaAppuntamenti, ripristinaBackup, type Backup } from "../lib/repo";
import { flush } from "../lib/sqlite/engine";

export default function Impostazioni() {
  const fileInput = useRef<HTMLInputElement>(null);
  const [messaggio, setMessaggio] = useState("");
  const [controlli, setControlli] = useState<Controllo[]>([]);
  const urlRitorno = urlDiRitorno(window.location.origin, import.meta.env.BASE_URL);
  const [verificaInCorso, setVerificaInCorso] = useState(false);
  const [occupato, setOccupato] = useState(false);
  const profilo = readProfile();
  const appuntamenti = useLiveQuery(() => elencaAppuntamenti());
  const sincronizzati = appuntamenti.filter((a) => a.googleEventId).length;
  const {
    email: accountEmail,
    signInWithGoogle: signInAccount,
    signOut: signOutAccount,
  } = useAccount();

  async function eseguiVerifica() {
    setVerificaInCorso(true);
    try {
      const esito = await verificaIntegrazione();
      setControlli(esito.controlli);
      setMessaggio(
        esito.tuttiOk
          ? "Integrazione pronta."
          : esito.nonVerificati > 0
            ? "Integrazione quasi pronta: accedi per completare i controlli che da anonimo non si possono concludere."
            : "Integrazione incompleta: correggi i punti segnalati sopra.",
      );
    } finally {
      setVerificaInCorso(false);
    }
  }

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
      <PageHeader title="Impostazioni" subtitle="Collegamenti, dati e copie di sicurezza" />

      {messaggio ? (
        <p className="mb-5 flex items-start gap-2 rounded-xl border border-ink-100 bg-white px-3.5 py-2.5 text-sm text-ink-600">
          <CheckIcon className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" />
          {messaggio}
        </p>
      ) : null}

      <section className="mb-5">
        <GoogleStatus />
        <Card className="p-5">
          <h2 className="flex items-center gap-2 text-lg">
            <CalendarIcon className="h-5 w-5 text-ink-400" />
            Google Calendar
          </h2>
          <p className="mt-1.5 text-sm text-ink-500">
            {profilo
              ? `Collegato come ${profilo.email}. ${sincronizzati} appuntamenti su ${appuntamenti.length} sono già pubblicati.`
              : googleConfigured
                ? "Collega il tuo account per pubblicare gli appuntamenti con un tocco."
                : "Aggiungi VITE_GOOGLE_CLIENT_ID nelle variabili d'ambiente per attivarlo."}
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            {profilo ? (
              <>
                <Button onClick={sincronizzaTutto} disabled={occupato}>
                  {occupato ? "Sincronizzazione…" : "Sincronizza in attesa"}
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => {
                    disconnect();
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

      <section className="mb-5">
        <Card className="p-5">
          <h2 className="flex items-center gap-2 text-lg">
            <CheckIcon className="h-5 w-5 text-ink-400" />
            Verifica integrazione
          </h2>
          <p className="mt-1.5 text-sm text-ink-500">
            Controlla che il progetto sia pronto: endpoint, tipo di chiave, accesso con Google e
            bucket.
          </p>
          <div className="mt-4 rounded-xl bg-ink-50 p-3 text-sm">
            <p className="font-medium text-ink-800">URL di ritorno dopo l&apos;accesso</p>
            <p className="mt-1 text-xs text-ink-500">
              Supabase rimanda l&apos;utente qui solo se questo URL è in
              <span className="font-medium"> Authentication → URL Configuration → Redirect URLs</span>.
              Se manca, il login finisce sul Site URL e sembra non funzionare.
            </p>
            <div className="mt-2 flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded-lg bg-white px-2.5 py-1.5 text-xs text-ink-700">
                {urlRitorno}
              </code>
              <Button
                variant="secondary"
                className="shrink-0"
                onClick={() => {
                  void navigator.clipboard
                    ?.writeText(urlRitorno)
                    .then(() => setMessaggio("URL di ritorno copiato negli appunti."));
                }}
              >
                Copia
              </Button>
            </div>
          </div>
          <Button
            variant="secondary"
            className="mt-4"
            onClick={() => void eseguiVerifica()}
            disabled={verificaInCorso}
          >
            {verificaInCorso ? "Verifica in corso…" : "Esegui verifica"}
          </Button>
          {controlli.length > 0 ? (
            <ul className="mt-4 space-y-2.5">
              {controlli.map((controllo) => (
                <li key={controllo.nome} className="flex items-start gap-2.5 text-sm">
                  {controllo.nonVerificato ? (
                    <InfoIcon className="mt-0.5 h-4 w-4 shrink-0 text-ink-400" />
                  ) : controllo.ok ? (
                    <CheckIcon className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" />
                  ) : (
                    <CloseIcon className="mt-0.5 h-4 w-4 shrink-0 text-clay-600" />
                  )}
                  <span>
                    <span className="font-medium text-ink-800">{controllo.nome}</span>
                    <span className="block text-xs text-ink-500">{controllo.dettaglio}</span>
                    {controllo.azione ? (
                      <span className="mt-1 block rounded-lg bg-ink-50 px-2.5 py-1.5 text-xs text-ink-600">
                        {controllo.azione}
                      </span>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </Card>
      </section>

      <section className="mb-5">
        <Card className="p-5">
          <h2 className="flex items-center gap-2 text-lg">
            <UserIcon className="h-5 w-5 text-ink-400" />
            Account e salvataggio online
          </h2>
          <p className="mt-1.5 text-sm text-ink-500">
            {cloudEnabled
              ? "Accedendo con Google i tuoi dati vengono salvati online dopo ogni modifica e ritrovati su qualsiasi dispositivo."
              : "L'accesso con Google non è configurato: i dati restano su questo dispositivo."}
          </p>
          <dl className="mt-3 space-y-2 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-ink-400">Account</dt>
              <dd className="truncate text-right text-ink-800">{accountEmail ?? "non collegato"}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-ink-400">Salvataggio online</dt>
              <dd className="text-ink-800">{cloudEnabled ? "attivo" : "disattivato"}</dd>
            </div>
          </dl>
          <div className="mt-4 flex flex-wrap gap-2">
            {accountEmail ? (
              <>
                <Button
                  variant="secondary"
                  onClick={async () => {
                    setOccupato(true);
                    const esito = await sincronizza(accountEmail);
                    setMessaggio(esito.messaggio);
                    setOccupato(false);
                  }}
                  disabled={occupato}
                >
                  Salva subito online
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => {
                    void signOutAccount();
                    setMessaggio("Account scollegato.");
                  }}
                >
                  Scollega
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
