-- "Le Edge Function pubblicate"
--
-- Da eseguire una volta sola nella console SQL di Supabase
-- (Dashboard → SQL Editor → New query → Run). È sicuro rieseguirlo.
--
-- Una tabella e una regola:
--   edge_function_deploy  quale codice è stato pubblicato, e quando
--
-- Perché una tabella e non un confronto del sorgente. Le Edge Function sono
-- una seconda copia del codice che sta in `supabase/functions/`, e la copia
-- pubblicata non è il file che è stato scritto: Supabase lo transpila e lo
-- riformatta prima di pubblicarlo. Nell'archivio che restituisce l'API i
-- commenti sono ripiegati su una riga e le dichiarazioni di tipo di
-- TypeScript sono sparite del tutto. Un confronto del testo segnalerebbe
-- quindi due funzioni diverse anche quando sono la stessa identica cosa, e
-- l'unico modo per farlo tacere sarebbe ignorare il codice, che è il peggio
-- che un controllo di allineamento possa fare.
--
-- Qui invece il deploy scrive l'hash del codice che ha pubblicato, e il
-- controllo ricalcola quell'hash dal repository e lo confronta. L'hash
-- sopravvive al transpile perché è calcolato prima, sul file di partenza: se
-- qualcuno modifica una funzione e non la ripubblica, i due hash non
-- coincidono e il controllo lo dice.
--
-- Il limite, detto qui perché è la cosa che va ricordata: questo confronta
-- il codice con ciò che la CI *dice* di aver pubblicato, non con ciò che
-- gira davvero. Se qualcuno pubblica a mano dalla dashboard, l'hash non
-- cambia e il controllo resta verde. È il motivo per cui il deploy è in CI e
-- non a mano: se l'unica via per pubblicare passa da qui, il confronto
-- coincide con la verità.

create table if not exists public.edge_function_deploy (
  nome text primary key,
  -- L'hash del codice al momento della pubblicazione, in esadecimale.
  -- `char(64)` e non `text`: la lunghezza è quella di uno sha256 ed è un
  -- controllo in più sui dati, non un dettaglio di stile.
  codice_sha256 char(64) not null,
  pubblicato_il timestamptz not null default now()
);

alter table public.edge_function_deploy enable row level security;

-- Nessuna policy, come per `sviluppatori`: la tabella serve solo alla CI,
-- che scrive e legge con i permessi del proprietario del database. Con la
-- RLS attiva e senza regole, nessun client la legge con le chiavi pubbliche.
revoke all on table public.edge_function_deploy from anon, authenticated;
