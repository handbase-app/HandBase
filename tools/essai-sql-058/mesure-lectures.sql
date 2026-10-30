-- Mesure d'une page (1 000 lignes) par compte, sous les règles de lecture (lancer.sh --mesure, avant puis après 058).
-- Pour chaque lecture : EXPLAIN (ANALYZE, BUFFERS) 5 fois, médiane du temps d'exécution, blocs lus (cache + disque) et
-- lignes rendues au dernier passage. Après 058, le plan interne de hb_lire_perimetre pour le club (auto_explain).
\set ON_ERROR_STOP 1
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
  raise notice '%  %  médiane % ms (min %)  blocs % lignes %', rpad(p_quoi, 58), right(p_uid, 4), round(t[3], 1), round(t[1], 1),
    (j -> 0 -> 'Plan' ->> 'Shared Hit Blocks')::bigint + (j -> 0 -> 'Plan' ->> 'Shared Read Blocks')::bigint,
    j -> 0 -> 'Plan' ->> 'Actual Rows';
end $$;

-- Heure et identifiant de la 1 000e ligne visible (début de la 2e page) pour un compte.
create or replace function pg_temp.repere(p_uid text, p_table text) returns text[]
language plpgsql as $$
declare r text[];
begin
  perform set_config('test.uid', p_uid, true);
  set local role authenticated;
  execute format('select array[server_updated_at::text, id] from (select id, server_updated_at from public.hb_%I
                   order by server_updated_at, id limit 1000) x order by server_updated_at desc, id desc limit 1', p_table) into r;
  reset role;
  return r;
end $$;

do $$
declare
  comptes text[][] := array[array['00000000-0000-0000-0000-00000000aaa4', 'club'], array['00000000-0000-0000-0000-00000000aaa3', 'comité 83'],
                            array['00000000-0000-0000-0000-00000000aaa2', 'ligue (6 dép.)'], array['00000000-0000-0000-0000-00000000aaa1', 'administrateur']];
  apres boolean := to_regprocedure('public.hb_lire_perimetre(text, timestamptz, integer)') is not null;
  t text;
  i integer;
  u text;
  r text[];
begin
  raise notice '% (% joueurs, % mesures)', case when apres then 'APRÈS 058' else 'AVANT 058' end,
    (select count(*) from public.hb_players), (select count(*) from public.hb_measurements);
  foreach t in array array['measurements', 'players', 'seen'] loop
    for i in 1 .. array_length(comptes, 1) loop
      u := comptes[i][1];
      -- Administrateur : seulement les mesures (il garde la lecture directe).
      if comptes[i][2] = 'administrateur' and t <> 'measurements' then continue; end if;
      perform pg_temp.mesure(format('%s, %s, 1re page, lecture directe', t, comptes[i][2]), u,
        format('select id, data, server_updated_at from public.hb_%I where server_updated_at >= %L order by server_updated_at, id limit 1000', t, '-infinity'));
      r := pg_temp.repere(u, t);
      if r is not null then
        perform pg_temp.mesure(format('%s, %s, page suivante, lecture directe (or)', t, comptes[i][2]), u,
          format('select id, data, server_updated_at from public.hb_%I where server_updated_at > %L or (server_updated_at = %L and id > %L)
                   order by server_updated_at, id limit 1000', t, r[1], r[1], r[2]));
      end if;
      if apres then
        perform pg_temp.mesure(format('%s, %s, 1re page, hb_lire_perimetre', t, comptes[i][2]), u,
          format('select * from public.hb_lire_perimetre(%L, %L, 1000)', t, '-infinity'));
        if r is not null then
          perform pg_temp.mesure(format('%s, %s, page suivante, hb_lire_perimetre (>=)', t, comptes[i][2]), u,
            format('select * from public.hb_lire_perimetre(%L, %L, 1000)', t, r[1]));
        end if;
      end if;
    end loop;
  end loop;
end $$;

-- Plan interne de la fonction pour le club et pour la ligue (une fois chacun) : lectures d'index par club / département.
select to_regprocedure('public.hb_lire_perimetre(text, timestamptz, integer)') is not null as apres \gset
\if :apres
load 'auto_explain';
set auto_explain.log_min_duration = 0;
set auto_explain.log_analyze = on;
set auto_explain.log_buffers = on;
set auto_explain.log_nested_statements = on;
set auto_explain.log_level = notice;
begin;
select set_config('test.uid', '00000000-0000-0000-0000-00000000aaa4', true);
set local role authenticated;
select count(*) as club_mesures_1re_page from public.hb_lire_perimetre('measurements', '-infinity', 1000);
rollback;
begin;
select set_config('test.uid', '00000000-0000-0000-0000-00000000aaa2', true);
set local role authenticated;
select count(*) as ligue_mesures_1re_page from public.hb_lire_perimetre('measurements', '-infinity', 1000);
rollback;
\endif
