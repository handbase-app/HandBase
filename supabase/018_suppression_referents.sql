-- HandBase : suppression des adultes référents.
-- À exécuter une fois dans Supabase > SQL Editor, APRÈS 017_groupes_prives.sql.
--
-- Les adultes référents (parents, professeurs d'EPS…, avec leurs coordonnées) sont retirés de l'appli :
-- ce n'est pas utile pour l'instant, et moins on garde de coordonnées, moins il y a de risque.
--   - toutes les fiches référents sont effacées définitivement, ainsi que leurs traces dans le journal ;
--   - la table reste (d'anciens scripts y font référence) mais plus rien ne peut y être écrit ni lu.
-- ⚠ Irréversible : les référents saisis jusqu'ici sont perdus.

-- Plus aucune écriture : une ligne envoyée par une ancienne version de l'appli est ignorée.
create or replace function public.hb_referents_closed() returns trigger
language plpgsql as $$
begin
  return null;
end $$;
drop trigger if exists hb_referents_closed on public.hb_referents;
create trigger hb_referents_closed before insert or update on public.hb_referents
  for each row execute function public.hb_referents_closed();

-- Plus aucune lecture.
drop policy if exists "staff_read" on public.hb_referents;

-- Effacement des référents et de leurs traces dans le journal d'activité.
delete from public.hb_referents;
delete from public.hb_audit where table_name = 'referents';

-- Vérification : 0 et 0.
select (select count(*) from public.hb_referents) as referents,
       (select count(*) from public.hb_audit where table_name = 'referents') as lignes_journal;
