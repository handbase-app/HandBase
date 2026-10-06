-- HandBase : effacement définitif de ce qui a été supprimé (RGPD).
-- À exécuter une fois dans Supabase > SQL Editor, APRÈS 027_notifications_nuit.sql.
--
-- Une suppression dans l'appli ne fait que cacher la ligne (marque « supprimé »), le temps que tous les
-- appareils la reçoivent et qu'on puisse revenir en arrière. hb_purge_deleted() efface ensuite pour de bon
-- ce qui est supprimé depuis plus de 30 jours :
--   - joueurs : la fiche, ses mesures, ses avis et ses adultes référents ; le joueur est retiré des
--     événements et des groupes ;
--   - mesures, avis, événements, groupes, référents et alertes supprimés à la main.
-- « Effacé » : la ligne ne garde que son identifiant et la marque de suppression (les appareils effacent
-- aussi leur copie à la synchronisation) ; tout le reste disparaît, y compris du journal d'activité
-- (« (données effacées) »). Une ligne de journal anonyme donne le bilan.
--
-- Chaque nuit à 3 h 27 (pg_cron). À la fin de ce script : les joueurs déjà supprimés sont effacés tout de suite.

create or replace function public.hb_purge_deleted(p_days int default 30, p_tables text[] default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_limit timestamptz := now() - make_interval(days => p_days);
  v_now bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
  v_all text[] := array['players', 'measurements', 'evaluations', 'events', 'groups', 'referents', 'alerts'];
  v_players text[];
  v_ids text[];
  v_t text;
  v_total jsonb := '{}'::jsonb;
begin
  -- Appel depuis l'appli : administrateurs uniquement (le serveur, lui, l'appelle sans compte).
  if v_uid is not null and (select role from public.hb_profiles where user_id = v_uid) is distinct from 'admin' then
    raise exception 'Réservé aux administrateurs';
  end if;

  -- Joueurs supprimés depuis le délai (pas encore effacés).
  if p_tables is null or 'players' = any (p_tables) then
    select coalesce(array_agg(id), '{}') into v_players from public.hb_players
     where deleted and server_updated_at < v_limit and not coalesce((data ->> 'purged')::boolean, false);
  else
    v_players := '{}';
  end if;

  if cardinality(v_players) > 0 then
    -- Leurs mesures, avis et référents (même non supprimés) partent avec eux.
    foreach v_t in array array['measurements', 'evaluations', 'referents'] loop
      execute format('update public.hb_%1$s
                         set data = jsonb_build_object(''id'', id, ''playerId'', data -> ''playerId'', ''deleted'', true, ''purged'', true, ''updatedAt'', $1)
                             || case when %1$L = ''evaluations'' then jsonb_build_object(''scores'', ''{}''::jsonb) else ''{}''::jsonb end,
                             deleted = true, updated_at_client = $1
                       where data ->> ''playerId'' = any ($2) and not coalesce((data ->> ''purged'')::boolean, false)
', v_t)
        using v_now, v_players;
      update public.hb_audit set summary = '(données effacées)', changes = null
       where table_name = v_t and row_id in (select id from public.hb_measurements where v_t = 'measurements' and data ->> 'playerId' = any (v_players)
                                             union all select id from public.hb_evaluations where v_t = 'evaluations' and data ->> 'playerId' = any (v_players)
                                             union all select id from public.hb_referents where v_t = 'referents' and data ->> 'playerId' = any (v_players));
    end loop;

    -- Retirés des événements et des groupes (et de « ajouté par »).
    update public.hb_events e
       set data = e.data || jsonb_build_object('updatedAt', v_now,
             'addedBy', coalesce(e.data -> 'addedBy', '{}'::jsonb) - v_players,
             'playerIds', (select coalesce(jsonb_agg(a.v order by a.o), '[]'::jsonb)
                             from jsonb_array_elements_text(e.data -> 'playerIds') with ordinality a(v, o)
                            where a.v <> all (v_players))),
           updated_at_client = v_now
     where e.data -> 'playerIds' ?| v_players;
    update public.hb_groups g
       set data = g.data || jsonb_build_object('updatedAt', v_now,
             'addedBy', coalesce(g.data -> 'addedBy', '{}'::jsonb) - v_players,
             'playerIds', (select coalesce(jsonb_agg(a.v order by a.o), '[]'::jsonb)
                             from jsonb_array_elements_text(g.data -> 'playerIds') with ordinality a(v, o)
                            where a.v <> all (v_players))),
           updated_at_client = v_now
     where g.data -> 'playerIds' ?| v_players;
  end if;

  -- Toutes les lignes supprimées depuis le délai (dont les joueurs ci-dessus).
  foreach v_t in array v_all loop
    continue when p_tables is not null and not (v_t = any (p_tables));
    execute format('select coalesce(array_agg(id), ''{}'') from public.hb_%1$s
                     where deleted and server_updated_at < $1 and not coalesce((data ->> ''purged'')::boolean, false)', v_t)
      into v_ids using v_limit;
    if v_t = 'players' then v_ids := v_players; end if;
    continue when cardinality(v_ids) = 0;
    execute format('update public.hb_%1$s
                       set data = jsonb_build_object(''id'', id, ''deleted'', true, ''purged'', true, ''updatedAt'', $1)
                           || case when %1$L = ''players'' then jsonb_build_object(''firstName'', '''', ''lastName'', '''')
                                   when %1$L in (''measurements'', ''evaluations'', ''referents'') then jsonb_build_object(''playerId'', data -> ''playerId'')
                                   else ''{}''::jsonb end
                           || case when %1$L = ''evaluations'' then jsonb_build_object(''scores'', ''{}''::jsonb) else ''{}''::jsonb end,
                           updated_at_client = $1
                     where id = any ($2)', v_t)
      using v_now, v_ids;
    update public.hb_audit set summary = '(données effacées)', changes = null where table_name = v_t and row_id = any (v_ids);
    v_total := v_total || jsonb_build_object(v_t, cardinality(v_ids));
  end loop;

  if v_total <> '{}'::jsonb then
    insert into public.hb_audit (user_id, user_name, user_role, table_name, row_id, action, summary)
    values (v_uid, case when v_uid is null then 'Serveur (tâche de nuit)' else (select coalesce(full_name, email) from public.hb_profiles where user_id = v_uid) end,
            'admin', 'players', '-', 'suppression définitive',
            'Effacement des suppressions de plus de ' || p_days || ' jours : '
              || (select string_agg(value || ' ' || case key when 'players' then 'joueur(s)' when 'measurements' then 'mesure(s)'
                     when 'evaluations' then 'avis' when 'events' then 'événement(s)' when 'groups' then 'groupe(s)'
                     when 'referents' then 'référent(s)' else 'alerte(s)' end, ', ') from jsonb_each_text(v_total)));
  end if;
  return v_total;
end $$;

revoke all on function public.hb_purge_deleted(int, text[]) from public, anon;
grant execute on function public.hb_purge_deleted(int, text[]) to authenticated;

-- Tâche de nuit (3 h 27), après l'expiration RGPD (3 h 17).
do $$
begin
  perform cron.unschedule('handbase-purge') where exists (select 1 from cron.job where jobname = 'handbase-purge');
  perform cron.schedule('handbase-purge', '27 3 * * *', 'select public.hb_purge_deleted()');
exception when others then
  raise notice 'pg_cron indisponible (%) : effacement à lancer à la main.', sqlerrm;
end $$;

-- Tout de suite : les joueurs déjà supprimés (avec leurs mesures et avis).
select public.hb_purge_deleted(0, array['players']) as efface;
