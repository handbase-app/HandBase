-- HandBase : durcissement (ceinture en plus des bretelles). Relançable.
-- 1) Les visiteurs non connectés (anon) n'ont plus aucun droit sur les tables (la protection par ligne les bloquait
--    déjà : aucune règle de lecture ne vise anon).
-- 2) Les comptes connectés gardent la seule lecture : toutes les écritures passent par les fonctions du serveur
--    (hb_upsert…) ; aucune règle RLS n'autorisait d'écriture directe.
-- 3) Mêmes règles pour les tables créées plus tard.
-- 4) rls_auto_enable (fonction créée par Supabase, pas par HandBase) n'est plus appelable depuis l'API.
do $$
declare t record;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('revoke all on table public.%I from anon', t.tablename);
    execute format('revoke insert, update, delete, truncate, references, trigger on table public.%I from authenticated', t.tablename);
  end loop;
end $$;
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke insert, update, delete, truncate, references, trigger on tables from authenticated;
do $$
begin
  if exists (select 1 from pg_proc where proname = 'rls_auto_enable' and pronamespace = 'public'::regnamespace) then
    revoke all on function public.rls_auto_enable() from public, anon, authenticated;
  end if;
end $$;
