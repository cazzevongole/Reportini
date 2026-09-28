import { useState } from "react";
import {
  CalendarIcon,
  CheckIcon,
  ClockIcon,
  EyeIcon,
  InfoIcon,
  RotateIcon,
  TrashIcon,
} from "../components/icons";
import { Badge, Button, Card, Sheet, Stat } from "../components/ui";
import { useAvvisi } from "./Avvisi";
import { useVersioniBackup } from "../hooks/useVersioniBackup";
import { GIORNI_RITENUTI, oraDi, type Versione } from "../lib/backup/archivio";
import type { Anteprima } from "../lib/backup/anteprima";

/** "oggi 14:00", "ieri 9:00", "12 marzo 08:00". */
function etichetta(versione: Versione): string {
  const ora = oraDi(versione.ora);
  const adesso = new Date();
  const oggi = oraDi(adesso.getTime());
  const ieri = oggi - 86_400_000;
  const oraLocale = new Date(ora).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });

  if (ora === oggi) return `Oggi, ${oraLocale}`;
  if (ora === ieri) return `Ieri, ${oraLocale}`;
  return `${new Date(ora).toLocaleDateString("it-IT", { day: "numeric", month: "short" })}, ${oraLocale}`;
}

function peso(byte: number): string {
  if (byte < 1024) return `${byte} B`;
  if (byte < 1024 * 1024) return `${Math.round(byte / 1024)} kB`;
  return `${(byte / (1024 * 1024)).toFixed(1)} MB`;
}

type Scelta = { versione: Versione; anteprima: Anteprima | null } | null;

/**
 * Versioni di backup del database: cosa c'era a un certo momento, e due
 * strade per usarle — darci un'occhiata e chiudere, oppure ripartire da
 * lì davvero (scartando tutto ciò che è venuto dopo).
 */
export default function VersioniBackup() {
  const { versioni, occupato, registraAdesso, apriAnteprima, ripristina, svuota } =
    useVersioniBackup();
  const { esegui } = useAvvisi();
  const [scelta, setScelta] = useState<Scelta>(null);
  const [conferma, setConferma] = useState(false);

  async function guarda(versione: Versione) {
    setScelta({ versione, anteprima: null });
    const anteprima = await apriAnteprima(versione.id);
    setScelta((attuale) =>
      attuale && attuale.versione.id === versione.id ? { versione, anteprima } : attuale,
    );
  }

  async function riprendi() {
    if (!scelta) return;
    const esito = await esegui(() => ripristina(scelta.versione.id), {
      successo: (r) =>
        r.scartate > 0
          ? `Dati ripristinati. ${r.scartate} ${r.scartate === 1 ? "versione scartata" : "versioni scartate"}.`
          : "Dati ripristinati.",
      errore: "Ripristino non riuscito",
    });
    // null vuol dire che l'azione è fallita: il foglio resta aperto, con
    // l'avviso di errore, invece di chiudersi come se fosse andata bene.
    if (esito !== null) {
      setScelta(null);
      setConferma(false);
    }
  }

  return (
    <section className="mb-5">
      <Card className="p-5">
        <h2 className="flex items-center gap-2 text-lg">
          <ClockIcon className="h-5 w-5 text-ink-400" />
          Versioni di backup
        </h2>
        <p className="mt-1.5 text-sm text-ink-500">
          Ogni volta che i dati cambiano viene tenuta una copia, una per ora, e si conservano{" "}
          {GIORNI_RITENUTI} giorni. Puoi guardarne una senza toccare nulla, oppure ripartire da
          lì: in quel caso tutto ciò che è stato scritto dopo viene scartato.
        </p>

        <div className="mt-4 flex flex-wrap gap-2">
          <Button
            variant="secondary"
            disabled={occupato}
            onClick={() => {
              void esegui(() => registraAdesso(), {
                successo: (v) =>
                  v
                    ? `Versione delle ${new Date(v.aggiornataIl).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" })} registrata.`
                    : "I dati sono già identici all'ultima versione di quest'ora.",
                errore: "Registrazione della versione non riuscita",
              });
            }}
          >
            <CheckIcon className="h-4 w-4" />
            Registra adesso
          </Button>
          {versioni.length > 0 ? (
            <Button
              variant="ghost"
              disabled={occupato}
              onClick={() => {
                setConferma(true);
              }}
            >
              <TrashIcon className="h-4 w-4" />
              Cancella le versioni
            </Button>
          ) : null}
        </div>

        {conferma ? (
          <div className="mt-4 rounded-xl border border-clay-200 bg-clay-50 p-3 text-sm text-clay-900">
            <p>
              Cancellare tutte le {versioni.length} versioni? I dati di lavoro non vengono toccati,
              ma non resterà più niente a cui tornare.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                variant="danger"
                onClick={() => {
                  void esegui(() => svuota(), {
                    successo: "Versioni cancellate.",
                    errore: "Cancellazione non riuscita",
                  }).then((r) => {
                    if (r !== null) setConferma(false);
                  });
                }}
              >
                Sì, cancella
              </Button>
              <Button variant="ghost" onClick={() => setConferma(false)}>
                Annulla
              </Button>
            </div>
          </div>
        ) : null}

        {versioni.length === 0 ? (
          <p className="mt-4 flex items-start gap-2 rounded-xl bg-ink-50 p-3 text-sm text-ink-500">
            <InfoIcon className="mt-0.5 h-4 w-4 shrink-0" />
            Ancora nessuna versione. Appena i dati cambiano ne viene tenuta una.
          </p>
        ) : (
          <ul className="mt-4 divide-y divide-ink-100">
            {versioni.map((versione) => (
              <li key={versione.id} className="flex items-center gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-ink-800">
                    {etichetta(versione)}
                  </p>
                  <p className="text-xs text-ink-400">{peso(versione.byte)}</p>
                </div>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => void guarda(versione)}
                  disabled={occupato}
                >
                  <EyeIcon className="h-4 w-4" />
                  Guarda
                  <span className="sr-only"> {etichetta(versione)}</span>
                </Button>
              </li>
            ))}
          </ul>
        )}

        {versioni.length > 0 ? (
          <p className="mt-3 text-xs text-ink-400">
            {versioni.length}{" "}
            {versioni.length === 1 ? "versione conservata" : "versioni conservate"},{" "}
            {GIORNI_RITENUTI} giorni.
          </p>
        ) : null}
      </Card>

      <Sheet
        open={scelta !== null}
        title={scelta ? etichetta(scelta.versione) : ""}
        description="Solo anteprima: questi dati non sono quelli su cui stai lavorando."
        onClose={() => {
          setScelta(null);
          setConferma(false);
        }}
        footer={
          scelta ? (
            <div className="flex flex-wrap gap-2">
              <Button variant="ghost" onClick={() => setConferma(true)}>
                <RotateIcon className="h-4 w-4" />
                Riparti da qui
              </Button>
              <Button
                variant="secondary"
                onClick={() => {
                  setScelta(null);
                  setConferma(false);
                }}
              >
                Chiudi
              </Button>
            </div>
          ) : null
        }
      >
        {scelta?.anteprima ? (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-2">
              <Stat label="Anagrafiche" value={scelta.anteprima.anagrafici} />
              <Stat label="Relazioni" value={scelta.anteprima.relazioni} />
              <Stat label="Appuntamenti" value={scelta.anteprima.appuntamenti} />
            </div>

            {conferma ? (
              <div className="rounded-xl border border-clay-200 bg-clay-50 p-3 text-sm text-clay-900">
                <p className="font-medium">Questo non si può annullare.</p>
                <p className="mt-1">
                  I dati di lavoro diventano quelli del{" "}
                  {new Date(scelta.versione.ora).toLocaleString("it-IT", {
                    day: "numeric",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                  , e le versioni più recenti vengono scartate. Prima conviene esportare una
                  copia dalla sezione "Copie di sicurezza".
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button
                    variant="danger"
                    disabled={occupato}
                    onClick={() => void riprendi()}
                  >
                    Sì, riparti da qui
                  </Button>
                  <Button variant="ghost" onClick={() => setConferma(false)}>
                    Annulla
                  </Button>
                </div>
              </div>
            ) : null}

            <div>
              <p className="flex items-center gap-2 text-sm font-medium text-ink-800">
                <CalendarIcon className="h-4 w-4 text-ink-400" />
                Prime anagrafiche
              </p>
              {scelta.anteprima.anagraficheElenco.length === 0 ? (
                <p className="mt-1 text-sm text-ink-400">Nessuna.</p>
              ) : (
                <ul className="mt-1 space-y-1 text-sm text-ink-600">
                  {scelta.anteprima.anagraficheElenco.map((a) => (
                    <li key={a.id} className="truncate">
                      {a.cognome} {a.nome}
                      {a.documento ? <span className="text-ink-400"> · {a.documento}</span> : null}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div>
              <p className="flex items-center gap-2 text-sm font-medium text-ink-800">
                <CalendarIcon className="h-4 w-4 text-ink-400" />
                Prossimi appuntamenti
              </p>
              {scelta.anteprima.appuntamentiElenco.length === 0 ? (
                <p className="mt-1 text-sm text-ink-400">Nessuno.</p>
              ) : (
                <ul className="mt-1 space-y-1 text-sm text-ink-600">
                  {scelta.anteprima.appuntamentiElenco.map((a) => (
                    <li key={a.id} className="truncate">
                      {a.titolo}
                      <span className="text-ink-400">
                        {" "}
                        · {new Date(a.inizio).toLocaleString("it-IT", {
                          day: "numeric",
                          month: "short",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <Badge tone="muted">Anteprima: niente è stato modificato</Badge>
          </div>
        ) : (
          <p className="text-sm text-ink-500">Apro la copia…</p>
        )}
      </Sheet>
    </section>
  );
}
