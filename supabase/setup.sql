-- =============================================================================
-- Reportini · setup Supabase
--
-- Esegui questo script una volta nel SQL Editor del progetto Supabase
-- (sidebar del progetto → "SQL Editor" → New query → Run).
-- È idempotente: puoi rieseguirlo senza problemi.
--
-- Cosa fa:
--   1. crea il bucket privato "reportini" se non esiste
--   2. crea le quattro Row Level Security che permettono a ogni utente
--      di leggere e scrivere solo i file nella propria cartella
-- =============================================================================

-- 1) Bucket -------------------------------------------------------------------
-- L'app scrive in reportini/<id-utente>/reportini.sqlite
insert into storage.buckets (id, name, public)
select 'reportini', 'reportini', false
where not exists (select 1 from storage.buckets where id = 'reportini');

-- 2) Politiche ---------------------------------------------------------------
-- Rimosse prima di essere ricreate, così lo script si può rieseguire.
drop policy if exists "reportini_select" on storage.objects;
drop policy if exists "reportini_insert" on storage.objects;
drop policy if exists "reportini_update" on storage.objects;
drop policy if exists "reportini_delete" on storage.objects;

-- (storage.foldername(name))[1] è il primo segmento del percorso, cioè l'id
-- dell'utente: è il confronto che tiene separati i dati di ciascuno.
create policy "reportini_select" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'reportini'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "reportini_insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'reportini'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Serve all'upsert usato dall'app quando risincronizza.
create policy "reportini_update" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'reportini'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'reportini'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "reportini_delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'reportini'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- 3) Verifica ----------------------------------------------------------------
-- Deve restituire 5 righe: "bucket" con public = f e le quattro policy
-- reportini_* (SELECT, INSERT, UPDATE, DELETE).
select 'bucket' as voce, id as nome, public::text as dettaglio
  from storage.buckets where id = 'reportini'
union all
select 'policy', policyname, cmd
  from pg_policies
 where schemaname = 'storage' and tablename = 'objects' and policyname like 'reportini%'
 order by 1, 2;
