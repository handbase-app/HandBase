-- Mesure de 061 (lancer.sh --mesure) sur le jeu de volume (mesure-jeu.sql). Données fictives.
--  1. Une MATINÉE de détection écrite déclencheurs actifs (comme les appareils : registre rempli) : 20 000 mesures et 5 000
--     « vu » (paquets de 100), puis curseurs du registre de 4 comptes, puis les 5 DERNIÈRES MINUTES au rythme du jour réaliste
--     à 10 000 personnes (~11 écritures/s : 3 300 mesures, 1 000 « vu », 30 fiches de joueurs).
--  2. « Quoi de neuf ? » toutes les 5 min : hb_filet (059 ; 19 curseurs : mesures et « vu » il y a 5 min, le reste hier)
--     contre hb_registre_depuis (061 ; le curseur pris il y a « 5 minutes »), comptes de club (2 clubs), comité, ligue,
--     administrateur ; EXPLAIN ANALYZE, médiane de 5, cache chaud.
--  3. Contrôle d'un abonnement au direct (règle de realtime.messages, comme Realtime : sujet posé, lecture d'un message) :
--     règles de 057 (hb_mes_canaux à chaque contrôle) contre règles de 061 (ligne gardée).
--  4. Coût d'une écriture (hb_upsert_lignes d'une mesure, comme l'appli) avec et sans les déclencheurs du registre.
--  5. Taille du registre.
\set ON_ERROR_STOP 1

create or replace function pg_temp.mesure(p_quoi text, p_uid text, p_sql text, p_topic text default null) returns numeric
language plpgsql as $$
declare
  j jsonb;
  t numeric[] := '{}';
  i integer;
begin
  perform set_config('test.uid', p_uid, true);
  if p_topic is not null then perform set_config('realtime.topic', p_topic, true); end if;
  set local role authenticated;
  for i in 1 .. 5 loop
    execute 'explain (analyze, buffers, format json) ' || p_sql into j;
    t := t || (j -> 0 ->> 'Execution Time')::numeric;
  end loop;
  reset role;
  select array_agg(x order by x) into t from unnest(t) x;
  raise notice '%  médiane % ms (min %, max %)  blocs %', rpad(p_quoi, 70), round(t[3], 2), round(t[1], 2), round(t[5], 2),
    (j -> 0 -> 'Plan' ->> 'Shared Hit Blocks')::bigint + (j -> 0 -> 'Plan' ->> 'Shared Read Blocks')::bigint;
  return t[3];
end $$;

create or replace function pg_temp.comme(p_uid text, p_sql text) returns jsonb
language plpgsql as $$
declare r jsonb;
begin
  perform set_config('test.uid', p_uid, true);
  set local role authenticated;
  execute p_sql into r;
  reset role;
  return r;
end $$;

-- Comptes mesurés : club (compte 301 : deux clubs), comité (compte 150), ligue (compte 50 : deux ligues), administrateur (1).
create temporary table mes_comptes (nom text, uid text, c text);
insert into mes_comptes values
  ('club (2 clubs)', '00000000-0000-0000-0001-' || lpad(to_hex(301), 12, '0'), null),
  ('comité (1 dép. + 1 club)', '00000000-0000-0000-0001-' || lpad(to_hex(150), 12, '0'), null),
  ('ligue (2 ligues, ~14 dép.)', '00000000-0000-0000-0001-' || lpad(to_hex(50), 12, '0'), null),
  ('administrateur', '00000000-0000-0000-0001-' || lpad(to_hex(1), 12, '0'), null);

-- 1. Matinée (déclencheurs actifs ; écrite par le serveur : pas de contrôle de périmètre, mêmes colonnes et même registre).
\echo '--- matinée : 20 000 mesures et 5 000 « vu » (déclencheurs actifs, paquets de 100) ---'
\timing on
do $$
declare b integer;
begin
  for b in 0 .. 199 loop
    insert into public.hb_measurements (id, data, updated_at_client)
    select 'mm' || g, jsonb_build_object('id', 'mm' || g, 'playerId', 'p' || (1 + (hashint4(g + 5) & 2147483647) % 100000), 'testId', 't' || (g % 12),
                                         'value', g % 97, 'date', '2026-11-01', 'createdBy', '00000000-0000-0000-0001-' || lpad(to_hex(1 + g % 10000), 12, '0'), 'updatedAt', g), g
      from generate_series(b * 100 + 1, b * 100 + 100) g;
  end loop;
  for b in 0 .. 49 loop
    insert into public.hb_seen (id, data, updated_at_client)
    select 'sm' || g, jsonb_build_object('id', 'sm' || g, 'playerId', 'p' || (1 + (hashint4(g + 55) & 2147483647) % 100000), 'eventId', 'ev' || (g % 300),
                                         'createdBy', '00000000-0000-0000-0001-' || lpad(to_hex(1 + g % 10000), 12, '0'), 'updatedAt', g), g
      from generate_series(b * 100 + 1, b * 100 + 100) g;
  end loop;
end $$;
\timing off
-- Curseurs du registre (« il y a 5 minutes ») et lignes gardées des canaux (l'appli les remplit en s'abonnant).
update mes_comptes set c = pg_temp.comme(uid, 'select public.hb_registre_depuis(null)') ->> 'c';
select pg_temp.comme(uid, 'select to_jsonb(public.hb_mes_canaux_memo())') from mes_comptes \g /dev/null
create temporary table debut as select now() as t;
-- Les 5 dernières minutes (un paquet = un envoi d'appareil : 1 à 3 lignes ; ici 10 pour aller vite, même registre par ligne).
\echo '--- 5 dernières minutes : 3 300 mesures, 1 000 « vu », 30 fiches (déclencheurs actifs) ---'
do $$
declare b integer;
begin
  for b in 0 .. 329 loop
    insert into public.hb_measurements (id, data, updated_at_client)
    select 'm5-' || g, jsonb_build_object('id', 'm5-' || g, 'playerId', 'p' || (1 + (hashint4(g + 555) & 2147483647) % 100000), 'testId', 't1',
                                          'value', g % 97, 'date', '2026-11-01', 'createdBy', '00000000-0000-0000-0001-' || lpad(to_hex(1 + g % 10000), 12, '0'), 'updatedAt', g), g
      from generate_series(b * 10 + 1, b * 10 + 10) g;
  end loop;
  for b in 0 .. 99 loop
    insert into public.hb_seen (id, data, updated_at_client)
    select 's5-' || g, jsonb_build_object('id', 's5-' || g, 'playerId', 'p' || (1 + (hashint4(g + 5555) & 2147483647) % 100000), 'eventId', 'ev' || (g % 300),
                                          'createdBy', '00000000-0000-0000-0001-' || lpad(to_hex(1 + g % 10000), 12, '0'), 'updatedAt', g), g
      from generate_series(b * 10 + 1, b * 10 + 10) g;
  end loop;
  update public.hb_players set data = data || jsonb_build_object('note', 'vu ce matin', 'updatedAt', 2000000000000), updated_at_client = 2000000000000
   where id in (select 'p' || (1 + (hashint4(g) & 2147483647) % 100000) from generate_series(1, 30) g);
end $$;
analyze public.hb_measurements;
analyze public.hb_seen;
analyze public.hb_registre;

-- 2. « Quoi de neuf ? »
\echo '--- « quoi de neuf ? » toutes les 5 min : hb_filet (059) contre hb_registre_depuis (061) ---'
do $$
declare
  tables text[] := array['players', 'criteria', 'measurements', 'teams', 'events', 'evaluations', 'groups', 'lists', 'alerts',
                         'follows', 'videos', 'seen', 'rewatch', 'config', 'levels', 'units', 'assignments', 'question_log', 'saved_questions'];
  c record;
  k text;
  req jsonb;
  r jsonb;
  a numeric;
  b numeric;
begin
  for c in select * from mes_comptes loop
    req := '{}'::jsonb;
    foreach k in array tables loop
      req := req || jsonb_build_object(case when k = 'assignments' and c.nom <> 'administrateur' then 'mes_affectations' else k end,
                                       case when k in ('measurements', 'seen', 'players') then ((select t from debut) - interval '1 second')::text else (now() - interval '1 day')::text end);
    end loop;
    a := pg_temp.mesure(format('hb_filet            %s', c.nom), c.uid, format('select public.hb_filet(%L::jsonb)', req));
    b := pg_temp.mesure(format('hb_registre_depuis  %s', c.nom), c.uid, format('select public.hb_registre_depuis(%L)', c.c));
    r := pg_temp.comme(c.uid, format('select public.hb_registre_depuis(%L)', c.c));
    raise notice '   → % fois moins ; registre : complet %, lignes citées %, tables « trop » %', round(a / greatest(b, 0.001), 1), r ->> 'complet',
      (select coalesce(sum(jsonb_array_length(l)), 0) from jsonb_each(r -> 'e') e(t, l) where jsonb_typeof(l) = 'array'),
      (select coalesce(string_agg(t, ' '), '-') from jsonb_each(r -> 'e') e(t, l) where jsonb_typeof(l) = 'object');
  end loop;
end $$;

-- 3. Contrôle d'un abonnement (Realtime) : règles de 057 contre règles de 061.
\echo '--- contrôle d''un abonnement au direct (règle de realtime.messages) : 057 contre 061 ---'
insert into realtime.messages (topic, extension, payload, event, private) values ('hb:essai', 'broadcast', '{}', 'essai', true);
create temporary table msg as select max(id) as id from realtime.messages;
do $$
declare
  c record;
  sujet text;
  a numeric;
  b numeric;
  q text := format('select count(*) from realtime.messages where id = %s', (select id from msg));
begin
  for c in select * from mes_comptes loop
    sujet := (pg_temp.comme(c.uid, 'select to_jsonb(public.hb_mes_canaux())') ->> -1);
    -- Règle de 057.
    execute 'drop policy if exists "hb_recevoir" on realtime.messages';
    execute $p$create policy "hb_recevoir" on realtime.messages for select to authenticated
      using (realtime.messages.extension = 'broadcast' and realtime.topic() = any ((select public.hb_mes_canaux())::text[]))$p$;
    a := pg_temp.mesure(format('règle 057  %s, canal %s', c.nom, sujet), c.uid, q, sujet);
    -- Règle de 061.
    execute 'drop policy if exists "hb_recevoir" on realtime.messages';
    execute $p$create policy "hb_recevoir" on realtime.messages for select to authenticated
      using (realtime.messages.extension = 'broadcast' and realtime.topic() = any ((select public.hb_canaux_rapides())::text[]))$p$;
    b := pg_temp.mesure(format('règle 061  %s, canal %s', c.nom, sujet), c.uid, q, sujet);
    raise notice '   → % fois moins', round(a / greatest(b, 0.001), 1);
  end loop;
end $$;
-- Le calcul complet seul (ce que paie un appareil d'avant, ou après une écriture de structure) :
select pg_temp.mesure('hb_mes_canaux() seul, club', uid, 'select public.hb_mes_canaux()') from mes_comptes where nom like 'club%' \g /dev/null

-- 4. Coût d'une écriture.
\echo '--- écriture d''une mesure (hb_upsert_lignes, 300 envois d''une ligne, comité) : avec / sans les déclencheurs du registre ---'
create or replace function pg_temp.ecrire(p_n integer, p_tag text) returns numeric
language plpgsql as $$
declare
  t0 timestamptz;
  i integer;
  p text;
  uid text := '00000000-0000-0000-0001-' || lpad(to_hex(150), 12, '0');
begin
  perform set_config('test.uid', uid, true);
  set local role authenticated;
  t0 := clock_timestamp();
  for i in 1 .. p_n loop
    select id into p from public.hb_players where scope_dept = lpad((1 + 150 % 96)::text, 2, '0') order by id offset (i % 50) limit 1;
    perform public.hb_upsert_lignes('measurements', jsonb_build_array(jsonb_build_object('id', 'w-' || p_tag || '-' || i,
      'data', jsonb_build_object('id', 'w-' || p_tag || '-' || i, 'playerId', p, 'testId', 't1', 'value', i, 'createdBy', uid, 'updatedAt', 3000000000000 + i),
      'updated_at_client', 3000000000000 + i)));
  end loop;
  reset role;
  return extract(epoch from clock_timestamp() - t0) * 1000 / p_n;
end $$;
do $$
declare
  avec numeric[] := '{}';
  sans numeric[] := '{}';
  k integer;
begin
  perform pg_temp.ecrire(50, 'chauffe');
  for k in 1 .. 3 loop
    avec := avec || pg_temp.ecrire(300, 'a' || k);
    alter table public.hb_measurements disable trigger hb_registre_ins;
    alter table public.hb_measurements disable trigger hb_registre_upd;
    sans := sans || pg_temp.ecrire(300, 's' || k);
    alter table public.hb_measurements enable trigger hb_registre_ins;
    alter table public.hb_measurements enable trigger hb_registre_upd;
  end loop;
  raise notice 'écriture d''une mesure : % ms avec le registre, % ms sans (3 séries de 300, une transaction par série)',
    (select round(avg(x), 2) from unnest(avec) x), (select round(avg(x), 2) from unnest(sans) x);
end $$;

-- 5. Taille du registre.
select count(*) as lignes_registre, pg_size_pretty(pg_total_relation_size('public.hb_registre')) as taille_totale,
       round(pg_total_relation_size('public.hb_registre')::numeric / greatest(count(*), 1)) as octets_par_ligne,
       round(count(*)::numeric / (select count(*) from public.hb_measurements where id like 'mm%' or id like 'm5-%' or id like 'w-%'), 2) as lignes_par_mesure_env
  from public.hb_registre;
