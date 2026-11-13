-- Essais de supabase/072_mcp_lecture_appels.sql (lancer.sh), sur la base fictive d'avant.sql. Toute erreur arrête.
-- hb_mcp_lire comparé à un calcul DIRECT écrit autrement (sous-requête « dernière mesure » par joueur, sans les règles de
-- lecture, filtres réécrits) : top 10 par taille sur une année de plus de 5 000 joueurs, ordre croissant, nés entre deux
-- trimestres, périmètre d'un encadrant, filtres (mesures, vus, avis, événement), bornes, refus ; aucune donnée personnelle
-- dans la réponse ; journal des appels (écrire pour soi seulement, à l'heure du serveur ; lire : administrateurs ; ni
-- modification ni suppression ; purge réservée).
\set ON_ERROR_STOP 1
create schema if not exists essai;

create or replace function essai.comme(p_uid text, p_sql text) returns text
language plpgsql as $$
declare n bigint;
begin
  perform set_config('test.uid', coalesce(p_uid, ''), true);
  if p_uid is null then set local role anon; else set local role authenticated; end if;
  begin
    execute p_sql;
    get diagnostics n = row_count;
  exception when others then
    reset role;
    return 'ERR ' || sqlstate;
  end;
  reset role;
  return n::text;
end $$;

create or replace function essai.val(p_uid text, p_sql text) returns text
language plpgsql as $$
declare r text;
begin
  perform set_config('test.uid', coalesce(p_uid, ''), true);
  set local role authenticated;
  execute p_sql into r;
  reset role;
  return r;
end $$;

-- hb_mcp_lire comme le compte p_uid.
create or replace function essai.lire(p_uid text, p_filtre jsonb) returns jsonb
language plpgsql as $$
declare r jsonb;
begin
  perform set_config('test.uid', coalesce(p_uid, ''), true);
  set local role authenticated;
  r := public.hb_mcp_lire(p_filtre);
  reset role;
  return r;
end $$;

create or replace function essai.ids(p jsonb) returns text language sql as $$
  select coalesce(string_agg(x ->> 'id', ',' order by n), '') from jsonb_array_elements(p -> 'lignes') with ordinality t(x, n)
$$;

create or replace function essai.attendu(p_quoi text, p_vu text, p_attendu text) returns void
language plpgsql as $$
begin
  if p_vu is distinct from p_attendu then raise exception 'ÉCHEC % : % au lieu de %', p_quoi, left(p_vu, 400), left(p_attendu, 400); end if;
  raise notice 'ok : %', p_quoi;
end $$;

-- Calcul DIRECT (sans règles de lecture ; p_depts : périmètre simulé) : joueurs vivants filtrés, dernière mesure du test par
-- sous-requête corrélée, tri, départage par identifiant (octets).
create or replace function essai.direct(p_test text, p_desc boolean, p_n int, p_annees int[] default null, p_de int default null,
                                        p_a int default null, p_depts text[] default null) returns text
language sql as $$
  with j as (
    select p.id, left(p.data ->> 'birthDate', 4)::int as annee,
           case when p.data ->> 'birthDate' ~ '^\d{4}-\d{2}' then ceil(substr(p.data ->> 'birthDate', 6, 2)::int / 3.0)::int end as trim
      from public.hb_players p
     where not p.deleted and coalesce(p.data ->> 'mergedInto', '') = '' and coalesce(p.data ->> 'review', '') <> 'refused'
       and (p_depts is null or p.scope_dept = any (p_depts))
  ), v as (
    select j.id, (select public.hb_mcp_num(m.data -> 'value') from public.hb_measurements m
                   where m.data ->> 'playerId' = j.id and m.data ->> 'criterionId' = p_test and not m.deleted
                     and jsonb_typeof(m.data -> 'value') in ('number', 'string') and coalesce(m.data ->> 'date', '') <> ''
                   order by m.data ->> 'date' desc, m.id desc limit 1) as t
      from j
     where (p_annees is null or j.annee = any (p_annees))
       and (p_de is null or j.annee * 10 + j.trim >= p_de) and (p_a is null or j.annee * 10 + j.trim <= p_a)
  )
  select string_agg(id, ',' order by rk) from (
    select id, row_number() over (order by case when p_desc then t end desc, case when not p_desc then t end asc, id collate "C") as rk
      from v where t is not null) z where rk <= p_n
$$;

do $$
declare
  a1 text := '00000000-0000-0000-0000-0000000000a1';
  d1 text := '00000000-0000-0000-0000-0000000000d1';
  e1 text := '00000000-0000-0000-0000-0000000000e1';
  r jsonb;
  t0 timestamptz;
  n2013 int;
begin
  select count(*) into n2013 from public.hb_players where data ->> 'birthDate' like '2013%' and not deleted;
  perform essai.attendu('plus de 5 000 joueurs nés en 2013', (n2013 > 5000)::text, 'true');

  -- Top 10 par taille sur une année > 5 000 joueurs : identique au calcul direct.
  t0 := clock_timestamp();
  r := essai.lire(a1, '{"annees":[2013],"tri":{"par":"test","test":"taille","ordre":"desc"},"limite":10,"sortie":["taille"]}');
  raise notice 'durée du top 10 (2013, % joueurs) : % ms', n2013, round(extract(epoch from clock_timestamp() - t0) * 1000);
  perform essai.attendu('top 10 taille 2013 = calcul direct', essai.ids(r), essai.direct('taille', true, 10, '{2013}'));
  perform essai.attendu('la vieille mesure plus grande (230) ne compte pas', (select bool_and((x -> 'mesures' -> 'taille' ->> 'v')::numeric < 230) from jsonb_array_elements(r -> 'lignes') x where x ->> 'id' <> 'j-annee-seule')::text, 'true');
  perform essai.attendu('total = joueurs vivants nés en 2013 (fondu, hors cadre, supprimé exclus ; année seule comprise)', (r ->> 'total'),
    (select count(*)::text from public.hb_players where data ->> 'birthDate' like '2013%' and not deleted and coalesce(data ->> 'mergedInto', '') = '' and coalesce(data ->> 'review', '') <> 'refused'));
  perform essai.attendu('200 premiers par taille croissante = calcul direct', essai.ids(essai.lire(a1, '{"annees":[2013],"tri":{"par":"test","test":"taille","ordre":"asc"},"limite":200}')),
    essai.direct('taille', false, 200, '{2013}'));
  perform essai.attendu('nés entre 2012-T4 et 2013-T4 : top 10 = calcul direct', essai.ids(essai.lire(a1, '{"nes_de":20124,"nes_a":20134,"tri":{"par":"test","test":"taille","ordre":"desc"},"limite":10}')),
    essai.direct('taille', true, 10, null, 20124, 20134));
  r := essai.lire(a1, '{"annees":[2012],"trimestres":[4],"limite":200}');
  perform essai.attendu('2012 au 4e trimestre : trimestre 4 partout', (select string_agg(distinct x ->> 'trimestre', ',') from jsonb_array_elements(r -> 'lignes') x), '4');
  perform essai.attendu('2012 au 4e trimestre : total', r ->> 'total',
    (select count(*)::text from public.hb_players where data ->> 'birthDate' ~ '^2012-(10|11|12)' and not deleted and coalesce(data ->> 'mergedInto', '') = '' and coalesce(data ->> 'review', '') <> 'refused'));
  perform essai.attendu('année seule : pas de trimestre, exclue d’un filtre de trimestre', (select count(*)::text from jsonb_array_elements(essai.lire(a1, '{"nes_de":20131,"nes_a":20134,"limite":200,"tri":{"par":"test","test":"taille"}}') -> 'lignes') x where x ->> 'id' = 'j-annee-seule'), '0');
  perform essai.attendu('année seule : comprise avec annees', (essai.lire(a1, '{"annees":[2013],"tri":{"par":"test","test":"taille","ordre":"desc"},"limite":1}') -> 'lignes' -> 0 ->> 'id'), 'j-annee-seule');

  -- Périmètre : l'encadrant (unité du 83) ne voit que le 83 ; même top que le calcul direct restreint au 83.
  perform essai.attendu('encadrant : top 10 dans son périmètre = calcul direct sur le 83', essai.ids(essai.lire(d1, '{"annees":[2013],"tri":{"par":"test","test":"taille","ordre":"desc"},"limite":10}')),
    essai.direct('taille', true, 10, '{2013}', null, null, '{83}'));
  perform essai.attendu('encadrant : départements rendus', (select string_agg(distinct x ->> 'dept', ',') from jsonb_array_elements(essai.lire(d1, '{"limite":200}') -> 'lignes') x), '83');
  perform essai.attendu('compte sans rôle : rien', essai.lire(e1, '{"limite":10}')::text, '{"total": 0, "lignes": []}');
  perform essai.attendu('départements (minuscules acceptées) : 2A', (select string_agg(distinct x ->> 'dept', ',') from jsonb_array_elements(essai.lire(a1, '{"depts":["2a"],"limite":50,"tri":{"par":"test","test":"taille"}}') -> 'lignes') x), '2A');

  -- Filtres sur les mesures (texte « 1,86 » lu comme un nombre), vus, avis, événement.
  r := essai.lire(a1, '{"annees":[2013],"mesures":[{"test":"taille","min":195}],"limite":200,"sortie":["taille"]}');
  perform essai.attendu('taille ≥ 195 : total = calcul direct', r ->> 'total',
    (select count(*)::text from (select distinct on (m.data ->> 'playerId') public.hb_mcp_num(m.data -> 'value') t from public.hb_measurements m join public.hb_players p on p.id = m.data ->> 'playerId'
       where m.data ->> 'criterionId' = 'taille' and not m.deleted and not p.deleted and p.data ->> 'birthDate' like '2013%' and coalesce(p.data ->> 'mergedInto', '') = '' and coalesce(p.data ->> 'review', '') <> 'refused'
       order by m.data ->> 'playerId', m.data ->> 'date' desc, m.id desc) z where t >= 195));
  perform essai.attendu('sprint en texte : plus rapide = 1,71', (essai.lire(a1, '{"tri":{"par":"test","test":"sprint_10","ordre":"asc"},"limite":1,"sortie":["sprint_10"]}') #>> '{lignes,0,mesures,sprint_10,v}'), '1,71');
  perform essai.attendu('vus ≥ 2 : total = calcul direct', essai.lire(a1, '{"vus_min":2,"limite":1}') ->> 'total',
    (select count(*)::text from (select data ->> 'playerId' p from public.hb_seen where not deleted group by 1 having count(distinct data ->> 'eventId') >= 2) z
       join public.hb_players p on p.id = z.p where not p.deleted and coalesce(p.data ->> 'mergedInto', '') = '' and coalesce(p.data ->> 'review', '') <> 'refused'));
  r := essai.lire(a1, '{"avis_min":3.5,"score5":["tir","defense"],"tri":{"par":"avis"},"limite":5,"avec_criteres":true}');
  perform essai.attendu('avis ≥ 3,5 : total = calcul direct', r ->> 'total',
    (select count(*)::text from (select e.data ->> 'playerId' p, avg(public.hb_mcp_num(s.value)) a from public.hb_evaluations e, jsonb_each(e.data -> 'scores') s
       where not e.deleted and s.key in ('tir', 'defense') group by 1) z join public.hb_players p on p.id = z.p
      where round(z.a, 2) >= 3.5 and not p.deleted and coalesce(p.data ->> 'mergedInto', '') = '' and coalesce(p.data ->> 'review', '') <> 'refused'));
  perform essai.attendu('avis : moyenne par critère, note en texte ignorée', (select bool_and(x -> 'criteres' ? 'tir' and not (x -> 'criteres' ? 'lateralite') and (x ->> 'avis_nb')::int = 2) from jsonb_array_elements(r -> 'lignes') x where x ->> 'id' <> 'j-annee-seule')::text, 'true');
  r := essai.lire(a1, jsonb_build_object('ids', (select data -> 'playerIds' from public.hb_events where id = 'ev-1'), 'tri', jsonb_build_object('par', 'vus'), 'limite', 200));
  perform essai.attendu('joueurs d’un événement : total', r ->> 'total',
    (select count(*)::text from public.hb_players p where p.id in (select jsonb_array_elements_text(data -> 'playerIds') from public.hb_events where id = 'ev-1') and not p.deleted and coalesce(p.data ->> 'mergedInto', '') = '' and coalesce(p.data ->> 'review', '') <> 'refused'));
  perform essai.attendu('tri par vus : le premier a 2 vus', (r #>> '{lignes,0,vus}'), '2');

  -- Rien de personnel dans la réponse : ni nom, ni club, ni commentaire, ni date de naissance complète ; clés connues.
  r := essai.lire(a1, '{"annees":[2013,2012],"tri":{"par":"test","test":"taille","ordre":"desc"},"limite":200,"sortie":["taille","sprint_10"],"avec_criteres":true,"score5":["tir"]}');
  perform essai.attendu('aucun nom, club, commentaire', (r::text ~ 'Fictif|Essai|Club|Commentaire|secret')::text, 'false');
  perform essai.attendu('aucune date de naissance complète', (select count(*)::text from jsonb_array_elements(r -> 'lignes') x join public.hb_players p on p.id = x ->> 'id' where p.data ->> 'birthDate' ~ '^\d{4}-\d{2}-\d{2}' and r::text like '%' || (p.data ->> 'birthDate') || '%'), '0');
  perform essai.attendu('clés des lignes', (select string_agg(distinct k, ',' order by k) from jsonb_array_elements(r -> 'lignes') x, jsonb_object_keys(x) k), 'annee,avis_moy,avis_nb,criteres,dept,id,mesures,poste,sexe,trimestre,vus');

  -- Bornes et refus.
  perform essai.attendu('limite 0 refusée', essai.comme(a1, 'select public.hb_mcp_lire(''{"limite":0}'')'), 'ERR 22023');
  perform essai.attendu('limite 201 refusée', essai.comme(a1, 'select public.hb_mcp_lire(''{"limite":201}'')'), 'ERR 22023');
  perform essai.attendu('tri inconnu refusé', essai.comme(a1, 'select public.hb_mcp_lire(''{"tri":{"par":"nom"}}'')'), 'ERR 22023');
  perform essai.attendu('tri par test sans test refusé', essai.comme(a1, 'select public.hb_mcp_lire(''{"tri":{"par":"test"}}'')'), 'ERR 22023');
  perform essai.attendu('filtre mal formé refusé', essai.comme(a1, 'select public.hb_mcp_lire(''{"annees":"2013"}'')'), 'ERR 22023');
  perform essai.attendu('trimestre 5 refusé', essai.comme(a1, 'select public.hb_mcp_lire(''{"trimestres":[5]}'')'), 'ERR 22023');
  perform essai.attendu('pas un objet refusé', essai.comme(a1, 'select public.hb_mcp_lire(''[1]'')'), 'ERR 22023');
  perform essai.attendu('anon : refus', essai.comme(null, 'select public.hb_mcp_lire(''{}'')'), 'ERR 42501');

  -- Journal des appels.
  perform essai.attendu('encadrant : écrit son appel', essai.comme(d1, 'insert into public.hb_mcp_appels (outil, duree_ms, ok, nb_lignes, filtres) values (''nextar_lire'', 120, true, 10, ''{"annees":[2013]}'')'), '1');
  perform essai.attendu('administrateur : écrit son appel', essai.comme(a1, 'insert into public.hb_mcp_appels (outil, duree_ms, ok, nb_lignes) values (''nextar_connexions'', 40, true, 2)'), '1');
  perform essai.attendu('pas pour un autre compte', essai.comme(d1, format('insert into public.hb_mcp_appels (user_id, outil, ok) values (%L, ''nextar_lire'', true)', a1)), 'ERR 42501');
  perform essai.attendu('pas antidaté', essai.comme(d1, 'insert into public.hb_mcp_appels (at, outil, ok) values (now() - interval ''1 day'', ''nextar_lire'', true)'), 'ERR 42501');
  perform essai.attendu('outil mal formé refusé', essai.comme(d1, 'insert into public.hb_mcp_appels (outil, ok) values (''drop table'', true)'), 'ERR 23514');
  perform essai.attendu('filtres trop gros refusés', essai.comme(d1, format('insert into public.hb_mcp_appels (outil, ok, filtres) values (''nextar_lire'', true, %L)', jsonb_build_object('x', repeat('a', 5000)))), 'ERR 23514');
  perform essai.attendu('encadrant : ne relit rien', essai.comme(d1, 'select * from public.hb_mcp_appels'), '0');
  perform essai.attendu('administrateur : lit tout', essai.comme(a1, 'select * from public.hb_mcp_appels'), '2');
  perform essai.attendu('ni modification', essai.comme(a1, 'update public.hb_mcp_appels set ok = false'), 'ERR 42501');
  perform essai.attendu('ni suppression', essai.comme(a1, 'delete from public.hb_mcp_appels'), 'ERR 42501');
  perform essai.attendu('anon : rien', essai.comme(null, 'select * from public.hb_mcp_appels'), 'ERR 42501');
  perform essai.attendu('anon : n’écrit pas', essai.comme(null, 'insert into public.hb_mcp_appels (outil, ok) values (''nextar_lire'', true)'), 'ERR 42501');
  perform essai.attendu('purge réservée (authenticated)', essai.comme(a1, 'select public.hb_mcp_appels_purger(90)'), 'ERR 42501');
  update public.hb_mcp_appels set at = now() - interval '100 days' where outil = 'nextar_lire';
  perform essai.attendu('purge : appels de plus de 90 jours effacés', public.hb_mcp_appels_purger(90)::text, '1');
  begin
    perform public.hb_mcp_appels_purger(1);
    raise exception 'ÉCHEC purge : 1 jour accepté';
  exception when sqlstate '22023' then raise notice 'ok : purge : 7 jours au moins';
  end;
  delete from public.hb_mcp_appels;
end $$;
