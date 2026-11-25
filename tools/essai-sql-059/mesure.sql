-- Mesure de hb_filet (lancer.sh --mesure) sur le jeu de tools/essai-sql-058/mesure-jeu.sql (500 000 joueurs, 3 M de mesures,
-- 600 000 avis, 1 M de « vu ») plus une MATINÉE DE DÉTECTION : 30 000 mesures et 10 000 « vu » écrits dans les 4 dernières
-- minutes sur des joueurs de tout le pays, dont 60 mesures et 20 « vu » du club 6383015. Pour chaque compte (club, comité,
-- ligue, administrateur) : hb_filet et hb_quoi_de_neuf avec les curseurs des 19 tables (mesures et « vu » : il y a 2 minutes,
-- fenêtre de 3 minutes, puis il y a 20 s ; les 17 autres : hier, rien de neuf depuis), et les relectures que l'ancien filet
-- faisait derrière ses « oui » ; EXPLAIN (ANALYZE, BUFFERS) 5 fois, médiane. Données fictives.
\set ON_ERROR_STOP 1
set session_replication_role = replica;
insert into public.hb_measurements (id, data, updated_at_client, server_updated_at, scope_dept, scope_club)
select 'mj' || g, jsonb_build_object('id', 'mj' || g, 'playerId', p.id, 'testId', 't' || (g % 12), 'value', g % 97, 'date', '2026-10-30',
                                     'createdBy', '00000000-0000-0000-0000-' || lpad(to_hex(1 + g % 2000), 12, '0'), 'updatedAt', g),
       g, now() - random() * interval '4 minutes', p.scope_dept, p.scope_club
  from generate_series(1, 30000) g
  join public.hb_players p on p.id = 'p' || (1 + (hashint4(g + 99) & 2147483647) % 500000);
insert into public.hb_seen (id, data, updated_at_client, server_updated_at, scope_dept, scope_club)
select 'sj' || g, jsonb_build_object('id', 'sj' || g, 'playerId', p.id, 'eventId', 'ev-jour',
                                     'createdBy', '00000000-0000-0000-0000-' || lpad(to_hex(1 + g % 2000), 12, '0'), 'updatedAt', g),
       g, now() - random() * interval '4 minutes', p.scope_dept, p.scope_club
  from generate_series(1, 10000) g
  join public.hb_players p on p.id = 'p' || (1 + (hashint4(g + 7777) & 2147483647) % 500000);
-- Le club observe ses joueurs : 60 mesures, 20 « vu ».
insert into public.hb_measurements (id, data, updated_at_client, server_updated_at, scope_dept, scope_club)
select 'mc' || g, jsonb_build_object('id', 'mc' || g, 'playerId', p.id, 'testId', 't1', 'value', g, 'date', '2026-10-30',
                                     'createdBy', '00000000-0000-0000-0000-00000000aaa4', 'updatedAt', g),
       g, now() - random() * interval '4 minutes', p.scope_dept, p.scope_club
  from generate_series(1, 60) g
  join lateral (select id, scope_dept, scope_club from public.hb_players where scope_club = '6383015' order by id offset g % 50 limit 1) p on true;
insert into public.hb_seen (id, data, updated_at_client, server_updated_at, scope_dept, scope_club)
select 'sc' || g, jsonb_build_object('id', 'sc' || g, 'playerId', p.id, 'eventId', 'ev-jour', 'createdBy', '00000000-0000-0000-0000-00000000aaa4', 'updatedAt', g),
       g, now() - random() * interval '4 minutes', p.scope_dept, p.scope_club
  from generate_series(1, 20) g
  join lateral (select id, scope_dept, scope_club from public.hb_players where scope_club = '6383015' order by id offset g % 50 limit 1) p on true;
set session_replication_role = default;
analyze public.hb_measurements;
analyze public.hb_seen;

create or replace function pg_temp.mesure(p_quoi text, p_uid text, p_sql text) returns void
language plpgsql as $$
declare
  j jsonb;
  t numeric[] := '{}';
  i integer;
begin
  perform set_config('test.uid', p_uid, true);
  set local role authenticated;
  for i in 1 .. 5 loop
    execute 'explain (analyze, buffers, format json) ' || p_sql into j;
    t := t || (j -> 0 ->> 'Execution Time')::numeric;
  end loop;
  reset role;
  select array_agg(x order by x) into t from unnest(t) x;
  raise notice '%  médiane % ms (min %, max %)  blocs %', rpad(p_quoi, 62), round(t[3], 1), round(t[1], 1), round(t[5], 1),
    (j -> 0 -> 'Plan' ->> 'Shared Hit Blocks')::bigint + (j -> 0 -> 'Plan' ->> 'Shared Read Blocks')::bigint;
end $$;

create or replace function pg_temp.reponse(p_uid text, p_req jsonb) returns jsonb
language plpgsql as $$
declare r jsonb;
begin
  perform set_config('test.uid', p_uid, true);
  set local role authenticated;
  r := public.hb_filet(p_req);
  reset role;
  return r;
end $$;

create or replace function pg_temp.quoi(p_uid text, p_req jsonb) returns jsonb
language plpgsql as $$
declare r jsonb;
begin
  perform set_config('test.uid', p_uid, true);
  set local role authenticated;
  r := public.hb_quoi_de_neuf(p_req);
  reset role;
  return r;
end $$;

-- Requête qui fait les relectures (1re page) des tables à « oui » : joueurs, mesures, avis, « vu » par hb_lire_perimetre (058),
-- les autres en lecture directe ; une seule requête (somme) pour la mesurer d'un bloc.
create or replace function pg_temp.relectures(p_flags jsonb, p_debut text) returns text
language plpgsql as $$
declare
  k text;
  parts text[] := '{}';
begin
  for k in select x.key from jsonb_each(p_flags) x where x.value = 'true' loop
    if k = 'mes_affectations' then
      parts := parts || format('(select count(*) from (select id, data from public.hb_assignments where server_updated_at >= %L and user_id = current_setting(''test.uid'') order by server_updated_at, id limit 1000) x)', p_debut);
    elsif k in ('players', 'measurements', 'evaluations', 'seen') then
      parts := parts || format('(select count(*) from public.hb_lire_perimetre(%L, %L, 1000))', k, p_debut);
    else
      parts := parts || format('(select count(*) from (select id, data from public.%I where server_updated_at >= %L order by server_updated_at, id limit 1000) x)', 'hb_' || k, p_debut);
    end if;
  end loop;
  if cardinality(parts) = 0 then return 'select 0'; end if;
  return 'select ' || array_to_string(parts, ' + ');
end $$;

do $$
declare
  tables text[] := array['players', 'criteria', 'measurements', 'teams', 'events', 'evaluations', 'groups', 'lists', 'alerts',
                         'follows', 'videos', 'seen', 'rewatch', 'config', 'levels', 'units', 'assignments', 'question_log', 'saved_questions'];
  comptes text[][] := array[array['00000000-0000-0000-0000-00000000aaa4', 'club'], array['00000000-0000-0000-0000-00000000aaa3', 'comité 83'],
                            array['00000000-0000-0000-0000-00000000aaa2', 'ligue (6 dép.)'], array['00000000-0000-0000-0000-00000000aaa1', 'administrateur']];
  ages text[] := array['2 minutes', '20 seconds'];
  a text;
  i integer;
  k text;
  req jsonb;
  r jsonb;
begin
  raise notice 'jeu : % mesures (% dans les 4 dernières minutes), % « vu »', (select count(*) from public.hb_measurements),
    (select count(*) from public.hb_measurements where server_updated_at > now() - interval '5 minutes'), (select count(*) from public.hb_seen);
  foreach a in array ages loop
    for i in 1 .. array_length(comptes, 1) loop
      req := '{}'::jsonb;
      foreach k in array tables loop
        -- Affectations : les siennes (« mes_affectations ») hors administrateur, comme l'appli.
        -- Curseur récent pour les tables qui bougent ce matin (mesures, « vu ») ; hier pour les autres (rien reçu depuis), comme
        -- sur un vrai appareil.
        req := req || jsonb_build_object(case when k = 'assignments' and comptes[i][2] <> 'administrateur' then 'mes_affectations' else k end,
                                         case when k in ('measurements', 'seen') then (now() - a::interval)::text else (now() - interval '1 day')::text end);
      end loop;
      r := pg_temp.reponse(comptes[i][1], req);
      raise notice '% , curseur il y a % : mesures %, « vu » %, joueurs %', comptes[i][2], a,
        r -> 'measurements', r -> 'seen', r -> 'players';
      perform pg_temp.mesure(format('hb_filet        19 tables, %s, curseur -%s', comptes[i][2], a), comptes[i][1], format('select public.hb_filet(%L::jsonb)', req));
      perform pg_temp.mesure(format('hb_quoi_de_neuf 19 tables, %s, curseur -%s', comptes[i][2], a), comptes[i][1], format('select public.hb_quoi_de_neuf(%L::jsonb)', req));
      -- Ce que l'ancien filet faisait relire derrière (tables à « oui » : 1re page depuis curseur − 60 s, comme l'appli),
      -- évité quand l'empreinte est identique.
      perform pg_temp.mesure(format('  + relectures après ses « oui » (%s)', (select string_agg(x.key, ' ') from jsonb_each(pg_temp.quoi(comptes[i][1], req)) x where x.value = 'true')),
        comptes[i][1], pg_temp.relectures(pg_temp.quoi(comptes[i][1], req), (now() - a::interval - interval '60 seconds')::text));
    end loop;
  end loop;
end $$;
