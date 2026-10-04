-- HandBase : remise à zéro des données de test.
-- À coller dans Supabase > SQL Editor, puis « Run ». Tout est fait d'un bloc : si une étape échoue, rien n'est modifié.
--
-- GARDE :
--   - les joueurs importés depuis Gest'Hand (ceux qui ont un n° de club), avec UNIQUEMENT les informations du
--     fichier (nom, prénom, sexe, naissance, latéralité, licence(s), état et type de licence, club, n° de club,
--     nationalité) + le POSTE ;
--   - leur taille « déclarée à la licence » (mesure créée par l'import) ;
--   - les GROUPES (publics et privés), débarrassés des joueurs supprimés ;
--   - la configuration : critères, régions, départements, membres du staff et leurs rôles.
-- SUPPRIME :
--   - tous les avis, toutes les autres mesures (poids, tests physiques, tailles saisies…) ;
--   - tous les événements ;
--   - les fiches créées à la main ou proposées (sans n° de club) et les joueurs de démonstration ;
--   - sur les fiches gardées : photo, notes, lacunes, taille des parents, équipe, catégorie, internat, validation…
-- Les suppressions passent sur tous les appareils à la synchronisation suivante.
-- ⚠ Irréversible. Conseil : avant, Réglages → Sauvegarde → Exporter (JSON) sur un appareil à jour.

begin;

-- Pas une ligne de journal par fiche (des milliers) : une seule ligne de synthèse à la fin.
alter table public.hb_players disable trigger hb_log;
alter table public.hb_measurements disable trigger hb_log;
alter table public.hb_evaluations disable trigger hb_log;
alter table public.hb_events disable trigger hb_log;
alter table public.hb_groups disable trigger hb_log;

drop table if exists _avant;
create temp table _avant as
select (select count(*) from public.hb_players where not deleted) as joueurs,
       (select count(*) from public.hb_measurements where not deleted) as mesures,
       (select count(*) from public.hb_evaluations where not deleted) as avis,
       (select count(*) from public.hb_events where not deleted) as evenements,
       (select count(*) from public.hb_groups where not deleted) as groupes;

do $$
declare
  -- Horodatage plus récent que toute version existante : la suppression l'emporte sur tous les appareils.
  v_now bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
  v_keep text[] := array['id', 'firstName', 'lastName', 'sex', 'birthDate', 'laterality', 'license', 'previousLicenses',
                         'licenseStatus', 'licenseRequestType', 'club', 'clubCode', 'nationality', 'position',
                         'createdBy', 'createdByName', 'createdAtServer'];
begin
  -- Joueurs gardés : importés de Gest'Hand (n° de club à 7 chiffres), hors démonstration.
  create temp table _gardes on commit drop as
  select id from public.hb_players
   where not deleted and data ->> 'clubCode' ~ '^\d{7}$' and id not like 'demo-%';

  -- Fiches gardées : seulement les informations du fichier + le poste.
  update public.hb_players p
     set data = (select coalesce(jsonb_object_agg(key, value), '{}'::jsonb) from jsonb_each(p.data) where key = any (v_keep))
                || jsonb_build_object('updatedAt', v_now),
         updated_at_client = v_now
   where p.id in (select id from _gardes);

  -- Autres fiches : supprimées.
  update public.hb_players
     set data = data || jsonb_build_object('deleted', true, 'updatedAt', v_now), deleted = true, updated_at_client = v_now
   where not deleted and id not in (select id from _gardes);

  -- Mesures : seule la taille déclarée à la licence (import) des joueurs gardés reste.
  update public.hb_measurements
     set data = data || jsonb_build_object('deleted', true, 'updatedAt', v_now), deleted = true, updated_at_client = v_now
   where not deleted
     and not (data ->> 'criterionId' = 'taille' and data ->> 'author' = 'Licence FFHB (déclarée)'
              and data ->> 'playerId' in (select id from _gardes));

  -- Avis et événements : tous supprimés.
  update public.hb_evaluations
     set data = data || jsonb_build_object('deleted', true, 'updatedAt', v_now), deleted = true, updated_at_client = v_now
   where not deleted;
  update public.hb_events
     set data = data || jsonb_build_object('deleted', true, 'updatedAt', v_now), deleted = true, updated_at_client = v_now
   where not deleted;

  -- Groupes : gardés, sans les joueurs supprimés (fiches manuelles, proposées, démonstration).
  update public.hb_groups g
     set data = g.data || jsonb_build_object('updatedAt', v_now, 'playerIds', (
           select coalesce(jsonb_agg(x order by o), '[]'::jsonb)
             from jsonb_array_elements_text(g.data -> 'playerIds') with ordinality a(x, o)
            where x in (select id from _gardes))),
         updated_at_client = v_now
   where not g.deleted
     and exists (select 1 from jsonb_array_elements_text(g.data -> 'playerIds') x where x not in (select id from _gardes));
end $$;

alter table public.hb_players enable trigger hb_log;
alter table public.hb_measurements enable trigger hb_log;
alter table public.hb_evaluations enable trigger hb_log;
alter table public.hb_events enable trigger hb_log;
alter table public.hb_groups enable trigger hb_log;

-- Une ligne dans le journal d'activité.
insert into public.hb_audit (user_id, user_name, user_role, table_name, row_id, action, summary, changes)
select null, 'Administration Supabase (SQL)', null, 'players', 'nettoyage', 'suppression',
       'Remise à zéro des données de test (import Gest''Hand, postes et groupes gardés)',
       jsonb_build_object(
         'joueurs', jsonb_build_array(a.joueurs, (select count(*) from public.hb_players where not deleted)),
         'mesures', jsonb_build_array(a.mesures, (select count(*) from public.hb_measurements where not deleted)),
         'avis', jsonb_build_array(a.avis, 0), 'evenements', jsonb_build_array(a.evenements, 0))
  from _avant a;

commit;

-- Vérification : avant → après.
select 'joueurs' as donnees, a.joueurs as avant, (select count(*) from public.hb_players where not deleted) as apres from _avant a
union all select 'mesures (taille licence)', a.mesures, (select count(*) from public.hb_measurements where not deleted) from _avant a
union all select 'avis', a.avis, (select count(*) from public.hb_evaluations where not deleted) from _avant a
union all select 'événements', a.evenements, (select count(*) from public.hb_events where not deleted) from _avant a
union all select 'groupes', a.groupes, (select count(*) from public.hb_groups where not deleted) from _avant a
union all select 'joueurs avec un poste', null, (select count(*) from public.hb_players where not deleted and data ? 'position') from _avant a;
