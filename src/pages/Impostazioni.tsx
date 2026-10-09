import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import {
  CalendarIcon,
  CloudIcon,
  DownloadIcon,
  ExternalLinkIcon,
  RotateIcon,
  SparkIcon,
  UploadIcon,
  UserIcon,
} from "../components/icons";
import { Button, Card, PageHeader } from "../components/ui";
import { useAvvisi } from "../components/Avvisi";
import ChiediloAlloSviluppatore from "../components/ChiediloAlloSviluppatore";
import ColoriStato from "../components/ColoriStato";
import SvoltaSviluppo from "../components/SvoltaSviluppo";
import VersioniBackup from "../components/VersioniBackup";
import { useLiveQuery } from "../hooks/useLiveQuery";
import { useSalvataggioCloud } from "../hooks/useSalvataggioCloud";
import { useAccount } from "../lib/cloud/session";
import { useAggiornamento } from "../lib/aggiornamento";
import { istruzioni, linkDownload, sistema } from "../lib/desktop";
import { sincronizza } from "../lib/cloud/sync";
import { cloudEnabled } from "../lib/cloud/supabase";
import {
  avviaAccessoGoogle,
  disconnect,
  googleConfigured,
  isConnected,
  readErroreCollegamento,
  readProfile,
  type GoogleProfile,
} from "../lib/google/auth";
import { scaricaTutteLeAttivita } from "../lib/google/calendar";
import { sincronizzaInAttesa } from "../lib/google/sync";
import { creaBackup, elencaAttivita, ripristinaBackup, type Backup } from "../lib/repo";
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
  // L'ultimo rifiuto del backend, mostrato qui: dopo un rientro da Google
  // l'utente torna in questa pagina, ed è qui che deve leggere cosa è successo.
  const [erroreCollegamento, setErroreCollegamento] = useState(() => readErroreCollegamento());
  const attivita = useLiveQuery(() => elencaAttivita());
  const sincronizzati = attivita.filter((a) => a.googleEventId).length;
  const {
    email: accountEmail,
    session,
    signInWithGoogle: signInAccount,
    signOut: signOutAccount,
  } = useAccount();
  const salvataggio = useSalvataggioCloud();
  const aggiornamento = useAggiornamento();
  // Il sistema su cui si sta leggendo: serve solo per spiegare come si
  // installa il pacchetto giusto, e si calcola una volta sola — chiamarlo a ogni
  // render significa rileggere il user agent per niente.
  const sistemaQui = useMemo(sistema, []);
  // Il bucket tiene i file in <user-id>/… e le RLS lo confrontano con l'id
  // dell'utente autenticato: con l'email la scrittura viene respinta.
  const userId = session?.user?.id ?? null;

  useEffect(() => {
    setCollegato(isConnected());
    setProfilo(readProfile());
  }, []);

  // Un errore ricordato è un tentativo fallito: finché c'è, la scheda non può
  // dire "Collegato" — e non può nascondere, insieme, il modo di rimettere a
  // posto il collegamento. Era lo stato da cui è nata la segnalazione:
  // "Collegato come …" sopra e, due righe sotto, "il collegamento non è più
  // valido", senza nessun pulsante per ricollegarlo.
  const daRicollegare = !collegato || Boolean(erroreCollegamento);

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
          `Copia esportata: ${c.aziende.length} aziende, ${c.report.length} report, ${c.attivita.length} attività.`,
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
        if (!Array.isArray(copia.aziende) || !Array.isArray(copia.attivita)) {
          // Una copia esportata prima del passaggio alle aziende ha il campo
          // "anagrafici": importarla cosi fallirebbe a metà, con il
          // database già svuotato. Meglio dirlo prima di toccare niente.
          throw new Error(
            (copia as { anagrafici?: unknown }).anagrafici
              ? "Questa copia è di una versione precedente (anagrafiche di persona) e non può essere importata."
              : "Il file non ha il formato atteso",
          );
        }
        ripristinaBackup(copia);
      },
      { successo: "Copia ripristinata correttamente.", errore: "" },
    );
    event.target.value = "";
  }

  async function ricollegaCalendar() {
    setOccupato(true);
    setErroreCollegamento(null);
    // avviaAccessoGoogle() lascia la pagina verso Google: qui si arriva solo
    // se è fallito, e la riga di errore è l'unica cosa che resta.
    await esegui(() => avviaAccessoGoogle(), {
      errore: "Ricollegamento a Google Calendar non riuscito",
    });
    setOccupato(false);
  }

  async function sincronizzaTutto() {
    setOccupato(true);
    await esegui(() => sincronizzaInAttesa(), {
      successo: (r) => r.messaggio,
      errore: "Sincronizzazione delle attività non riuscita",
    });
    // Un tentativo fallito può aver scoperto che il collegamento non vale più
    // (consenso revocato, token morto): senza rileggere, la scheda resterebbe
    // "Collegato" fino alla prossima visita della pagina.
    setCollegato(isConnected());
    setErroreCollegamento(readErroreCollegamento());
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
            {daRicollegare
              ? googleConfigured
                ? "Il calendario fa parte dell'accesso con Google: si concede insieme. Se manca, è perché il consenso è stato revocato o annullato."
                : "Serve il collegamento con Supabase e il client Google: senza, l'accesso funziona ma le attività restano solo nell'app."
              : `Collegato come ${profilo?.email ?? accountEmail ?? "questo account"}. ${sincronizzati} attività su ${attivita.length} sono già pubblicati.`}
          </p>
          {daRicollegare ? null : (
            <p className="mt-1.5 text-sm text-ink-400">
              Il collegamento si rinnova da solo: non devi ricollegarti ogni ora.
            </p>
          )}
          {erroreCollegamento ? (
            <p className="mt-3 rounded-xl border border-clay-200 bg-clay-50 px-3.5 py-2.5 text-sm text-clay-800">
              {erroreCollegamento}
            </p>
          ) : null}
          <div className="mt-4 flex flex-wrap gap-2">
            {daRicollegare ? (
              // Il calendario fa parte dell'accesso: questo pulsante non è
              // "attivare una funzione in più", è rimettere in pari un
              // collegamento che manca (consenso revocato, backend non
              // pubblicato, consenso annullato al rientro).
              <Button onClick={ricollegaCalendar} disabled={occupato || !googleConfigured}>
                {occupato ? "Ricollegamento…" : "Ricollega il calendario"}
              </Button>
            ) : (
              <Button onClick={sincronizzaTutto} disabled={occupato}>
                {occupato ? "Sincronizzazione…" : "Sincronizza in attesa"}
              </Button>
            )}
            {collegato ? (
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
                  setErroreCollegamento(null);
                }}
              >
                Scollega
              </Button>
            ) : null}
            <Button
              variant="secondary"
              onClick={() => {
                scaricaTutteLeAttivita(attivita);
                notifica("ok", `${attivita.length} attività esportate in formato .ics.`);
              }}
              disabled={attivita.length === 0}
            >
              <DownloadIcon className="h-4 w-4" />
              Esporta .ics
            </Button>
          </div>
          <ColoriStato
            onApplicati={(n) =>
              notifica(
                "ok",
                n === 0
                  ? "Colori tornati quelli iniziali."
                  : `Colori salvati. Valgono dalle prossime pubblicazioni.`,
              )
            }
          />
        </Card>
      </section>

      <section className="mb-8">
        <Card className="p-5">
          <h2 className="text-lg">Copie di sicurezza</h2>
          <p className="mt-1.5 text-sm text-ink-500">
            Esporta tutto il contenuto in un file JSON e ripristinalo su qualunque dispositivo. È
            utile come copia di sicurezza quando non hai un account collegato.
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
              ? "L'app controlla da sola, ogni mezz'ora, se c'è una versione nuova e la scarica in sottofondo. Quando è pronta ti chiede se installarla adesso chiudendo l'app o se farla entrare alla chiusura."
              : "Qui Reportini gira nel browser: non c'è niente da installare, ogni volta che torni basta ricaricare la pagina per avere l'ultima versione. Se lo preferisci come programma, puoi scaricarlo per il computer."}
          </p>
          <p className="mt-3 text-sm text-ink-400">
            {aggiornamento.descrizione ??
              (aggiornamento.disponibile ? "Nessun aggiornamento da mettere." : "Versione web.")}
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
                <>
                  <Button
                    onClick={() => void aggiornamento.installa()}
                    disabled={aggiornamento.occupato}
                  >
                    {aggiornamento.occupato ? "Installo…" : "Aggiorna adesso"}
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() => void aggiornamento.rimanda()}
                    disabled={aggiornamento.occupato}
                  >
                    Alla chiusura dell'app
                  </Button>
                </>
              ) : null}
            </div>
          ) : (
            /* Solo nel browser: su desktop l'aggiornamento automatico c'è e
               questo link sarebbe un secondo modo di fare la stessa cosa.
               Qui invece non c'è niente da installare, e la domanda che
               capita è "posso averla come app?". Il link porta alla pagina
               della release, dove GitHub mette il pulsante del pacchetto
               giusto per il sistema da cui si sta leggendo: un link
               all'allegato andrebbe rotto alla release successiva, perché
               il nome contiene il numero di versione. */
            <div className="mt-4">
              <a
                href={linkDownload()}
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex items-center gap-2 rounded-lg bg-ink-950 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-ink-800"
              >
                <DownloadIcon className="h-4 w-4" />
                Scarica l'app per il computer
                <ExternalLinkIcon className="h-3.5 w-3.5 text-ink-300" />
              </a>
              {istruzioni(sistemaQui) ? (
                <p className="mt-2 text-xs text-ink-400">{istruzioni(sistemaQui)}</p>
              ) : null}
            </div>
          )}
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
          {/* Solo per lo sviluppatore: se il database non lo riconosce, questa
              riga non viene nemmeno disegnata. */}
          <SvoltaSviluppo />
        </Card>
      </section>
    </div>
  );
}
