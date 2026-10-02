-- HandBase : synchronisation en direct (Supabase Realtime).
-- À exécuter une fois dans Supabase > SQL Editor, APRÈS 005_avis_evenement.sql.
--
-- Ajoute les tables de l'appli à la diffusion temps réel : chaque appareil connecté est prévenu
-- dès qu'une donnée change et va chercher les nouveautés aussitôt. Les règles d'accès (RLS)
-- s'appliquent : seuls les comptes connectés reçoivent les notifications.

do $$
declare t text;
begin
  foreach t in array array['players','criteria','measurements','events','evaluations'] loop
    if not exists (
      select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'hb_' || t
    ) then
      execute format('alter publication supabase_realtime add table public.hb_%s', t);
    end if;
  end loop;
end $$;

-- Vérification : les 5 tables doivent apparaître.
select tablename from pg_publication_tables
 where pubname = 'supabase_realtime' and tablename like 'hb_%'
 order by tablename;
