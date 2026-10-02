-- Avviso per mail delle richieste degli utenti
--
-- Da eseguire una volta sola nella console SQL di Supabase
-- (Dashboard → SQL Editor → New query → Run). È sicuro rieseguirlo.
--
-- Cosa fa. Mette un trigger su `public.richieste`: quando un utente scrive una
-- richiesta, il database chiama da sé la Edge Function `notifica-richiesta`,
-- che manda una mail a chi sviluppa. La richiesta resta nella tabella e la
-- sezione nascosta resta il posto in cui si legge e si risponde: la mail è un
-- avviso, non un archivio.
--
-- Perché la chiama il database e non il browser. Se la chiamasse il client, il
-- messaggio partirebbe solo se la scheda restasse aperta un secondo dopo
-- l'invio — due secondi che nessuno garantisce — e una richiesta che non
-- parte non lascia traccia. Da qui la mail arriva anche se l'utente ha già
-- chiuso la scheda.
--
-- Prima di tutto, due segreti nel Vault.
--
-- Sono l'unica parte che va scritta a mano, e non finisce nel repository:
-- il codice qui sotto li legge dal Vault a ogni chiamata. Senza questi due
-- segreti il trigger esiste ma non fa niente, e lo dice con un avviso nella
-- console, non con un errore all'utente.
--
-- `{{REF}}` va sostituito con il reference del progetto, che è la parte fra
-- `https://` e `.supabase.co` nell'indirizzo del dashboard. Il segnaposto è un
-- segnaposto e non un ref vero: nessun ref sta scritto in questo file, perché
-- un ref copiato a mano e sbagliato dà un `401` che non spiega nulla, e
-- `tests/notifica-sql.test.ts` fallisce se qui dentro ne compare uno.
--
--   select vault.create_secret(
--     'https://{{REF}}.supabase.co/functions/v1/notifica-richiesta',
--     'notifica_richieste_url',
--     'Indirizzo della Edge Function che manda le mail'
--   );
--
--   select vault.create_secret(
--     '<stringa lunga e casuale>',
--     'notifica_richieste_chiave',
--     'Chiave che la Edge Function verifica con notifica_chiave_valida()'
--   );
--
-- La stringa casuale si genera come si vuole, purché non sia una parola:
--   openssl rand -hex 32
--
-- Attenzione a una cosa che sembra un dettaglio e non lo è. La chiave sta
-- **soltanto qui dentro**, nel Vault: il trigger la prende e la manda
-- nell'intestazione `x-reportini-notifica`, e la Edge Function non ha una copia
-- propria con cui confrontarla — chiede a questo database, con la funzione
-- `notifica_chiave_valida` in fondo al file, se quella che ha in mano è
-- ancora quella di adesso.
--
-- Prima era diverso: la stessa chiave era nel Vault *e* in un secret della
-- funzione, e le due copie potevano divergere. Quando succedeva, l'unico
-- sintomo era un `401` che non diceva niente — né quale delle due fosse
-- quella sbagliata, né se l'intestazione fosse arrivata. Con una copia sola
-- non c'è più niente da tenere allineato.

/* ------------------------------- estensioni ------------------------------- */

-- pg_net è ciò che permette a Postgres di fare richieste HTTP. Su Supabase è
-- già disponibile, e non va abilitata per tutti: la creazione qui dentro
-- basta, e le funzioni finiscono nello schema `net`.
create extension if not exists pg_net;

/* --------------------------------- trigger -------------------------------- */

-- `security definer` perché la funzione deve poter leggere `sviluppatori`, che
-- nessun client può leggere: senza, la lista dei destinatari risulterebbe
-- vuota e nessuno riceverebbe niente.
-- `modo` distingue le due mail, che sono due destinatari diversi dello stesso
-- evento: `nuova` avvisa gli sviluppatori, `chiusura` avvisa l'utente che ha
-- scritto. Sono due funzioni e non una perché i destinatari si leggono da due
-- tabelle diverse, e farlo con una sola avrebbe significato scegliere a ogni
-- richiesta quale delle due liste mandare a `array_agg`.
create or replace function public.manda_avviso_chiusura()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  indirizzo_funzione text;
  chiave_notifica text;
begin
  select decrypted_secret into indirizzo_funzione
    from vault.decrypted_secrets where name = 'notifica_richieste_url';
  select decrypted_secret into chiave_notifica
    from vault.decrypted_secrets where name = 'notifica_richieste_chiave';

  if indirizzo_funzione is null or chiave_notifica is null then
    raise warning 'notifica_richieste: manca nel Vault url o chiave, nessuna chiusura per %',
      new.id;
    return new;
  end if;

  perform net.http_post(
    url := indirizzo_funzione,
    body := jsonb_build_object(
      -- `modo` è ciò che la Edge Function usa per scegliere a chi scrivere.
      'modo', 'chiusura',
      'id', new.id::text,
      'tipo', new.tipo,
      'titolo', new.titolo,
      'corpo', new.corpo,
      -- Qui l'email è il destinatario, non il mittente: è l'utente che ha
      -- scritto la richiesta ed è a lui che si risponde.
      'email', new.email,
      'risposta', new.risposta,
      'creata', new.created_at,
      'chiusa', new.updated_at
    ),
    headers := jsonb_build_object(
      'x-reportini-notifica', chiave_notifica
    )
  );

  return new;
end;
$$;

create or replace function public.manda_avviso_richiesta()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  destinatari text[];
  indirizzo_funzione text;
  chiave_notifica text;
begin
  select coalesce(array_agg(s.email), '{}'::text[])
    into destinatari
    from public.sviluppatori s;

  if destinatari = '{}'::text[] then
    -- Nessuno sviluppatore in lista: la richiesta è comunque salvata e la si
    -- legge nella sezione nascosta. Avvisare e fermarsi, senza fallire.
    raise warning 'nessuno sviluppatore in public.sviluppatori: nessuna mail per la richiesta %',
      new.id;
    return new;
  end if;

  select decrypted_secret into indirizzo_funzione
    from vault.decrypted_secrets where name = 'notifica_richieste_url';
  select decrypted_secret into chiave_notifica
    from vault.decrypted_secrets where name = 'notifica_richieste_chiave';

  if indirizzo_funzione is null or chiave_notifica is null then
    -- Manca uno dei due segreti: è un setup incompiuto, non un errore della
    -- richiesta. Sollevare qui l'eccezione annullerebbe l'inserimento e
    -- l'utente perderebbe la sua richiesta per un segreto mancante: peggio
    -- di non mandare la mail.
    raise warning 'notifica_richieste: manca nel Vault url o chiave, nessuna mail per %',
      new.id;
    return new;
  end if;

  perform net.http_post(
    url := indirizzo_funzione,
    body := jsonb_build_object(
      -- `modo` è ciò che la Edge Function usa per scegliere a chi scrivere:
      -- questa mail va agli sviluppatori, quella di chiusura all'utente.
      'modo', 'nuova',
      'id', new.id::text,
      'tipo', new.tipo,
      'titolo', new.titolo,
      'corpo', new.corpo,
      -- L'email non la scrive il modulo ma la sessione, quindi qui arriva
      -- già verificata: è quella che diventa il `Reply-To` della mail.
      'email', new.email,
      'creata', new.created_at,
      'destinatari', to_jsonb(destinatari)
    ),
    -- `headers` è un argomento a sé, non una chiave dentro `params`: `params`
    -- è per i parametri che vanno appesi alla URL, e una chiave finita lì
    -- finisce nell'indirizzo della richiesta, dove finiscono i log.
    --
    -- Il `content-type` non serve scriverlo: `net.http_post` lo mette già di
    -- default, e scriverlo è solo un modo di metterlo due volte.
    headers := jsonb_build_object(
      'x-reportini-notifica', chiave_notifica
    )
    -- `timeout_milliseconds` c'è ma `pg_net` lo ignora: la richiesta è in
    -- coda e non blocca la transazione dell'utente comunque, quindi non
    -- serve a nulla scriverlo per far sembrare il trigger più sicuro.
  );

  return new;
end;
$$;

-- `create or replace trigger` invece di `drop` + `create`: rieseguire lo
-- script non lascia trigger duplicati, che scriverebbero due mail per ogni
-- richiesta.
create or replace trigger richieste_avviso_mail
  after insert on public.richieste
  for each row execute function public.manda_avviso_richiesta();

-- Quando una richiesta passa a "risolta", l'utente che l'ha scritta riceve
-- una mail con la risposta. Il trigger è su `update` e non su `delete`, quindi
-- non parte quando una richiesta già risolta viene riaperta e poi risolta di
-- nuovo: la condizione sotto è ciò che distingue le due cose.
--
-- `when` conta anche le modifiche che non c'entrano. Salvare la risposta senza
-- cambiare stato è un `update` come gli altri, e senza il confronto qui
-- sotto l'utente riceverebbe una mail ogni volta che lo sviluppatore
-- corregge un refuso. La condizione guarda i due stati, non il fatto che la
-- riga sia cambiata.
create or replace trigger richieste_avviso_chiusura
  after update on public.richieste
  for each row
  when (
    new.stato = 'risolta'
    and old.stato is distinct from 'risolta'
  )
  execute function public.manda_avviso_chiusura();

/* ------------------------- la verifica della chiave ------------------------ */

-- L'altra metà del rimozzo della copia. La Edge Function riceve la chiave
-- nell'intestazione e la riporta qui: questa funzione risponde solo se è
-- quella che il Vault conosce *adesso*.
--
-- Perché non basta un confronto dentro la funzione: le due copie del
-- segreto erano proprio il problema, perché potevano divergere senza che
-- nessuno lo dicesse.
--
-- Chi può chiedere. Solo il `service_role`, cioè la Edge Function con la sua
-- chiave di servizio. Chiunque altro — un client anonimo che abbia indovinato
-- l'indirizzo della funzione PostgREST — riceve `false` senza che la funzione
-- confronti niente. Non è che la risposta sia un segreto: è che due `false` e
-- due `true` non dicono a un indovino quale delle due chiave sia quella buona.
create or replace function public.notifica_chiave_valida(p text)
returns boolean
language sql
security definer
set search_path = public
as $$
  select case
    when coalesce(
      nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
      ''
    ) <> 'service_role' then false
    else coalesce(
      p = (
        select decrypted_secret from vault.decrypted_secrets
        where name = 'notifica_richieste_chiave'
      ),
      false
    )
  end;
$$;

/* ------------------------------ se qualcosa va storto ---------------------- */

-- pg_net non aspetta la risposta: accoda la richiesta e va avanti. Quando la
-- mail non arriva, il primo posto dove guardare è qui:
--
--   select id, status_code, left(content, 300) as risposta
--   from net._http_response order by id desc limit 5;
--
-- Cosa dicono i codici, ora che la chiave ha una copia sola:
--
--   200  inviata. Nel corpo c'è `inviata: true` e l'id del messaggio Resend.
--   401  il Vault non riconosce la chiave arrivata. Con una copia sola non
--        può voler dire che sono diverse: vuol dire che l'intestazione non è
--        arrivata (rigenera il trigger con questo file) o che nel Vault la
--        chiave è un'altra. Per il lungo: `select decrypted_secret from
--        vault.decrypted_secrets where name = 'notifica_richieste_chiave'`.
--   503  manca un segreto alla funzione, oppure questo file non è stato
--        rieseguito e `notifica_chiave_valida` non esiste: il corpo lo dice.
--   502  Resend ha rifiutato, quasi sempre `domain is not verified`.
--
-- Le richieste accodate ma non ancora eseguite stanno in `net.http_curl_queue`.