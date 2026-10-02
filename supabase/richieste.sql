-- "Chiedilo allo sviluppatore"
--
-- Da eseguire una volta sola nella console SQL di Supabase
-- (Dashboard → SQL Editor → New query → Run). È sicuro rieseguirlo.
--
-- Due tabelle e tre regole:
--   sviluppatori  chi ha il diritto di vedere tutte le richieste
--   richieste      cosa chiedono gli utenti, e in che stato è
--
-- Chi decide se sei uno sviluppatore è **questa tabella**, non una variabile
-- d'ambiente: una variabile finisce nel bundle pubblico e chiunque potrebbe
-- mettersi nella sezione nascosta leggendola. Qui la lista vive nel database
-- e la difende la RLS, quindi nessun client può ampliarla da solo.

/* ----------------------------- sviluppatori ------------------------------ */

create table if not exists public.sviluppatori (
  email text primary key,
  inserito_il timestamptz not null default now()
);

alter table public.sviluppatori enable row level security;

-- Nessuna policy: con la RLS attiva e senza regole, nessuno legge questa
-- tabella con le chiavi pubbliche. La funzione sei_sviluppatore() la legge
-- lo stesso, perché gira con i permessi del proprietario del database.
revoke all on table public.sviluppatori from anon, authenticated;

-- Metti qui la tua email. È l'unica riga da scrivere a mano.
-- insert into public.sviluppatori (email) values ('mammarellandrea@gmail.com')
-- on conflict (email) do nothing;

/* ------------------------------- richieste ------------------------------- */

create table if not exists public.richieste (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  email text not null,
  tipo text not null default 'fix' check (tipo in ('fix', 'funzionalita')),
  titolo text not null check (char_length(titolo) between 1 and 120),
  corpo text not null check (char_length(corpo) between 1 and 4000),
  stato text not null default 'aperta' check (stato in ('aperta', 'in corso', 'risolta')),
  risposta text,
  -- Cancellazione logica, non una delete: la riga resta, sparisce dagli
  -- elenchi. È la parte che rende la cancellazione reversibile, che è il
  -- motivo per cui l'ho scelta: `create table if not exists` più sotto
  -- non aggiunge la colonna a una tabella già esistente, e senza questa
  -- riga l'app leggerebbe un campo che il database non ha.
  cancellata_il timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- La tabella può già esistere da un setup precedente: `create table if not
-- exists` la lascia com'è, colonne comprese. Senza questo `alter`, eseguire
-- lo script su un progetto già avviato lascerebbe `cancellata_il` inesistente
-- e ogni lettura delle richieste comincerebbe con un errore di colonna.
alter table public.richieste add column if not exists cancellata_il timestamptz;

create index if not exists richieste_created_at on public.richieste (created_at desc);

-- Le richieste non cancellate escono dai due elenchi normali. L'indice è
-- parziale per quello: senza, l'indice su `created_at` non basta quando la
-- tabella si riempie di richieste vecchie, perché il filtro su
-- `cancellata_il` non è quello iniziale.
create index if not exists richieste_aperte
  on public.richieste (created_at desc)
  where cancellata_il is null;

alter table public.richieste enable row level security;

-- La funzione che risponde "sono lo sviluppatore?". Security definer perché
-- deve poter leggere public.sviluppatori, che nessun client può leggere.
create or replace function public.sei_sviluppatore()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.sviluppatori s
    where lower(s.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

revoke all on function public.sei_sviluppatore() from anon;
grant execute on function public.sei_sviluppatore() to authenticated;

-- Tolte prima di essere ricreate, per lo stesso motivo di `setup.sql`: senza
-- il `drop`, rieseguire questo file si fermerebbe sul primo `create policy` che
-- trova il nome già preso, con un `42710` che dice "policy already exists" e
-- non dice perché. Il file si dichiara sicuro da rieseguire e deve esserlo:
-- da quando lo schema si applica a ogni merge, questa è la seconda volta che
-- lo esegue.
drop policy if exists "richieste_inserimento" on public.richieste;
drop policy if exists "richieste_lettura" on public.richieste;
drop policy if exists "richieste_modifica" on public.richieste;

-- Scrivere una richiesta: chiunque abbia un account, ma solo per sé stesso.
-- Il controllo su user_id è quello che impedisce a un utente di scrivere
-- richieste intestate a un altro.
create policy "richieste_inserimento"
  on public.richieste for insert to authenticated
  with check (auth.uid() = user_id);

-- Leggere: ognuno le proprie, lo sviluppatore tutte.
create policy "richieste_lettura"
  on public.richieste for select to authenticated
  using (auth.uid() = user_id or public.sei_sviluppatore());

-- Modificare stato e risposta: solo lo sviluppatore. È la regola che rende
-- "evadere" una richiesta un lavoro riservato, non una promessa.
create policy "richieste_modifica"
  on public.richieste for update to authenticated
  using (public.sei_sviluppatore())
  with check (public.sei_sviluppatore());

-- Cancella: nessuna policy `delete`, e non serve. La cancellazione è
-- logica, quindi passa da `update` e la riga resta nel database: le
-- richieste si risolvono, e quando non servono più sparisce `cancellata_il`.
-- Un utente normale non può neanche farlo, perché la `richieste_modifica`
-- sotto richiede di essere sviluppatore.
