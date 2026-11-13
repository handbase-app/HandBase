-- Les lignes du jeu fictif, leurs canaux selon le serveur (hb_canaux_ligne), et ce que l'appareil connaît (joueurs,
-- unités, staffs), pour la comparaison avec src/syncLive.ts (rowChannels).
select jsonb_build_object(
  'lignes', (select jsonb_agg(jsonb_build_object('table', x.t, 'data', x.r -> 'data', 'canaux', to_jsonb(public.hb_canaux_ligne('hb_' || x.t, x.r))) order by x.t, x.r ->> 'id')
               from (select 'players' t, to_jsonb(p) r from public.hb_players p
                     union all select 'evaluations', to_jsonb(e) from public.hb_evaluations e
                     union all select 'measurements', to_jsonb(e) from public.hb_measurements e
                     union all select 'seen', to_jsonb(e) from public.hb_seen e
                     union all select 'rewatch', to_jsonb(e) from public.hb_rewatch e
                     union all select 'videos', to_jsonb(e) from public.hb_videos e
                     union all select 'follows', to_jsonb(e) from public.hb_follows e
                     union all select 'saved_questions', to_jsonb(e) from public.hb_saved_questions e
                     union all select 'teams', to_jsonb(e) from public.hb_teams e
                     union all select 'groups', to_jsonb(e) from public.hb_groups e
                     union all select 'alerts', to_jsonb(e) from public.hb_alerts e
                     union all select 'events', to_jsonb(e) from public.hb_events e
                     union all select 'criteria', to_jsonb(e) from public.hb_criteria e
                     union all select 'levels', to_jsonb(e) from public.hb_levels e
                     union all select 'units', to_jsonb(e) from public.hb_units e
                     union all select 'assignments', to_jsonb(e) from public.hb_assignments e
                     union all select 'config', to_jsonb(e) from public.hb_config e
                     union all select 'lists', to_jsonb(e) from public.hb_lists e
                     union all select 'question_log', to_jsonb(e) from public.hb_question_log e) x),
  'joueurs', (select jsonb_agg(data) from public.hb_players),
  'unites', (select jsonb_agg(data) from public.hb_units),
  'staffs', (select jsonb_agg(data) from public.hb_teams));
