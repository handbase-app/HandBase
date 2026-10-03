-- HandBase : expiration des données personnelles (RGPD).
-- À exécuter une fois dans Supabase > SQL Editor, APRÈS 011_fusion_fiches.sql.
--
-- hb_purge_expired() :
--   - fiche proposée jamais traitée (toujours « en attente ») 12 mois après sa création :
--     la fiche, ses adultes référents, ses avis et ses mesures sont effacés ; le joueur est retiré
--     des listes d'événements ;
--   - fiche mise hors cadre depuis 12 mois : seuls ses adultes référents sont effacés (la fiche et
--     ses avis restent, pour la vue « Ratés »).
-- « Effacé » : la ligne ne garde que son identifiant et la marque de suppression (pour que les
-- appareils l'effacent aussi à la synchronisation) ; noms, coordonnées et notes disparaissent, y
-- compris du journal d'activité. Une ligne de journal anonyme indique combien de fiches ont expiré.
--
-- Lancée chaque nuit par le serveur (pg_cron) si l'extension est disponible ; sinon l'appli d'un
-- administrateur la lance une fois par jour. Elle ne fait rien s'il n'y a rien d'expiré.

create or replace function public.hb_purge_expired(p_months int default 12) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_limit timestamptz := now() - make_interval(months => p_months);
  v_now bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
  v_players text[];
  v_refused text[];
  v_rows text[];
  v_refs text[];
begin
  -- Appel depuis l'appli : administrateurs uniquement (le serveur, lui, l'appelle sans compte).
  if v_uid is not null and (select role from public.hb_profiles where user_id = v_uid) is distinct from 'admin' then
    raise exception 'Réservé aux administrateurs';
  end if;

  -- Fiches proposées jamais traitées depuis le délai.
  select coalesce(array_agg(id), '{}') into v_players from public.hb_players
   where not deleted and data ->> 'review' = 'pending'
     and coalesce((data ->> 'createdAtServer')::timestamptz, server_updated_at) < v_limit;
  -- Fiches hors cadre depuis le délai (on n'efface que leurs référents).
  select coalesce(array_agg(id), '{}') into v_refused from public.hb_players
   where not deleted and data ->> 'review' = 'refused'
     and coalesce((data ->> 'reviewedAt')::timestamptz, server_updated_at) < v_limit;

  if cardinality(v_players) = 0 and cardinality(v_refused) = 0 then
    return jsonb_build_object('fiches', 0, 'referents', 0);
  end if;

  -- Avis et mesures des fiches expirées.
  select coalesce(array_agg(id), '{}') into v_rows from (
    select id from public.hb_evaluations where not deleted and data ->> 'playerId' = any (v_players)
    union all
    select id from public.hb_measurements where not deleted and data ->> 'playerId' = any (v_players)) x;
  update public.hb_evaluations
     set data = jsonb_build_object('id', id, 'playerId', data -> 'playerId', 'deleted', true, 'purged', true, 'updatedAt', v_now, 'scores', '{}'::jsonb),
         deleted = true, updated_at_client = v_now
   where not deleted and data ->> 'playerId' = any (v_players);
  update public.hb_measurements
     set data = jsonb_build_object('id', id, 'playerId', data -> 'playerId', 'deleted', true, 'purged', true, 'updatedAt', v_now),
         deleted = true, updated_at_client = v_now
   where not deleted and data ->> 'playerId' = any (v_players);

  -- Référents : ceux des fiches expirées et ceux des fiches hors cadre depuis le délai.
  select coalesce(array_agg(id), '{}') into v_refs from public.hb_referents
   where not deleted and data ->> 'playerId' = any (v_players || v_refused);
  update public.hb_referents
     set data = jsonb_build_object('id', id, 'playerId', data -> 'playerId', 'deleted', true, 'purged', true, 'updatedAt', v_now),
         deleted = true, updated_at_client = v_now
   where id = any (v_refs);

  -- Listes de joueurs des événements.
  update public.hb_events e
     set data = e.data || jsonb_build_object('updatedAt', v_now, 'playerIds', (
           select coalesce(jsonb_agg(a.v order by a.o), '[]'::jsonb)
             from jsonb_array_elements_text(e.data -> 'playerIds') with ordinality a(v, o)
            where a.v <> all (v_players))),
         updated_at_client = v_now
   where exists (select 1 from jsonb_array_elements_text(e.data -> 'playerIds') x(v) where x.v = any (v_players));

  -- Les fiches elles-mêmes.
  update public.hb_players
     set data = jsonb_build_object('id', id, 'firstName', '', 'lastName', '', 'deleted', true, 'purged', true, 'updatedAt', v_now),
         deleted = true, updated_at_client = v_now
   where id = any (v_players);

  -- Journal : plus aucune donnée personnelle sur ces lignes, puis une ligne anonyme de bilan.
  update public.hb_audit
     set summary = '(données expirées)', changes = null
   where (table_name = 'players' and row_id = any (v_players))
      or (table_name in ('evaluations', 'measurements') and row_id = any (v_rows))
      or (table_name = 'referents' and row_id = any (v_refs));
  insert into public.hb_audit (user_id, user_name, user_role, table_name, row_id, action, summary)
  values (v_uid, case when v_uid is null then 'Serveur (tâche de nuit)' else (select coalesce(full_name, email) from public.hb_profiles where user_id = v_uid) end,
          'admin', 'players', '-', 'expiration RGPD',
          format('%s fiche(s) proposée(s) jamais traitée(s) effacée(s) ; référents effacés : %s', cardinality(v_players), cardinality(v_refs)));

  return jsonb_build_object('fiches', cardinality(v_players), 'referents', cardinality(v_refs));
end $$;

revoke all on function public.hb_purge_expired(int) from public, anon;
grant execute on function public.hb_purge_expired(int) to authenticated;

-- Tâche de nuit (3 h 17) si pg_cron est disponible (Supabase : Database > Extensions > pg_cron).
-- Sinon, rien de grave : l'appli d'un administrateur lance l'expiration une fois par jour.
do $$
begin
  create extension if not exists pg_cron;
  perform cron.unschedule('handbase-expiration') where exists (select 1 from cron.job where jobname = 'handbase-expiration');
  perform cron.schedule('handbase-expiration', '17 3 * * *', 'select public.hb_purge_expired()');
  raise notice 'Tâche de nuit programmée (pg_cron).';
exception when others then
  raise notice 'pg_cron indisponible (%), l''expiration sera lancée par l''appli d''un administrateur.', sqlerrm;
end $$;

-- Vérification : ce qui expirerait aujourd'hui (rien n'est effacé par cette requête).
select
  (select count(*) from public.hb_players where not deleted and data ->> 'review' = 'pending'
     and coalesce((data ->> 'createdAtServer')::timestamptz, server_updated_at) < now() - interval '12 months') as fiches_a_expirer,
  (select count(*) from public.hb_referents r join public.hb_players p on p.id = r.data ->> 'playerId'
    where not r.deleted and not p.deleted and p.data ->> 'review' = 'refused'
      and coalesce((p.data ->> 'reviewedAt')::timestamptz, p.server_updated_at) < now() - interval '12 months') as referents_hors_cadre_a_effacer;
