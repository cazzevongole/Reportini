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
--   select vault.create_secret(
--     'https://<ref>.supabase.co/functions/v1/notifica-richiesta',
--     'notifica_richieste_url',
--     'Indirizzo della Edge Function che manda le mail'
--   );
--
--   select vault.create_secret(
--     '<stringa lunga e casuale>',
--     'notifica_richieste_chiave',
--     'Stessa stringa del secret NOTIFICA_CHIAVE della funzione'
--   );
--
-- La stringa casuale si genera come si vuole, purché non sia una parola:
--   openssl rand -hex 32
--
-- Attenzione a una cosa che sembra un dettaglio. La chiave nel Vault e il
-- secret NOTIFICA_CHIAVE della funzione devono essere **la stessa stringa**:
-- il trigger la manda nell'intestazione `x-reportini-notifica` e la funzione
-- la confronta. Sono le due metà di una coppia, non due chiavi diverse.

/* ------------------------------- estensioni ------------------------------- */

-- pg_net è ciò che permette a Postgres di fare richieste HTTP. Su Supabase è
-- già disponibile, e non va abilitata per tutti: la creazione qui dentro
-- basta, e le funzioni finiscono nello schema `net`.
create extension if not exists pg_net;

/* --------------------------------- trigger -------------------------------- */

-- `security definer` perché la funzione deve poter leggere `sviluppatori`, che
-- nessun client può leggere: senza, la lista dei destinatari risulterebbe
-- vuota e nessuno riceverebbe niente.
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
    params := jsonb_build_object(
      'headers', jsonb_build_object(
        'content-type', 'application/json',
        'x-reportini-notifica', chiave_notifica
      ),
      -- Una richiesta che non risponde entro cinque secondi non deve
      -- trattenere la transazione dell'utente.
      'timeout_milliseconds', 5000
    )
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

/* ------------------------------ se qualcosa va storto ---------------------- */

-- pg_net non aspetta la risposta: accoda la richiesta e va avanti. Quando la
-- mail non arriva, il primo posto dove guardare è qui:
--
--   select id, status_code, left(content, 300) as risposta
--   from net._http_response order by id desc limit 5;
--
-- Le righe hanno `status_code` fra 200 e 299 se è andata. Un 401 vuol dire che
-- la chiave nel Vault e il secret della funzione non coincidono; un 503 che
-- manca un segreto; un 502 con `domain is not verified` che il mittente non è
-- un dominio verificato su Resend.
--
-- Le richieste accodate ma non ancora eseguite stanno in `net.http_curl_queue`.