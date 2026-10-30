-- Essais de supabase/058_lecture_perimetre.sql sur un jeu fictif (lancer.sh). Données fictives seulement.
-- PREUVE DE SÉCURITÉ : pour 8 comptes (administrateur, niveau Fédération, ligue, comité, club, observateur sans affectation,
-- joueur, sans rôle), hb_lire_perimetre rend, ligne pour ligne et dans le même ordre, ce que rend la lecture directe sous les
-- règles de lecture (RLS), pour les 4 tables, plusieurs curseurs (dont des heures partagées par beaucoup de lignes) et
-- plusieurs tailles de page ; puis un parcours complet page par page avec le protocole de l'appli (>= curseur, égalités
-- écartées, ancien filtre si une page pleine n'a qu'une heure) rend exactement toutes les lignes visibles.
-- CONTRE-ESSAI : deux variantes fautives tirées du texte même de la fonction (SECURITY DEFINER : elle ne passe plus par les
-- règles ; sans la branche « auteur » : elle oublie des lignes) : l'essai DOIT trouver des écarts pour chacune.
-- Toute erreur d'assertion arrête le script.
\set ON_ERROR_STOP 1

-- ---------- Comptes ----------
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'admin@exemple.test'),
  ('00000000-0000-0000-0000-0000000000b1', 'national@exemple.test'),
  ('00000000-0000-0000-0000-0000000000b2', 'ligue@exemple.test'),
  ('00000000-0000-0000-0000-0000000000c1', 'comite@exemple.test'),
  ('00000000-0000-0000-0000-0000000000d1', 'club@exemple.test'),
  ('00000000-0000-0000-0000-0000000000d2', 'observateur@exemple.test'),
  ('00000000-0000-0000-0000-0000000000e1', 'jeune@exemple.test'),
  ('00000000-0000-0000-0000-0000000000f1', 'sansrole@exemple.test')
on conflict do nothing;
insert into public.hb_profiles (user_id, email, role) values
  ('00000000-0000-0000-0000-0000000000a1', 'admin@exemple.test', 'admin'),
  ('00000000-0000-0000-0000-0000000000b1', 'national@exemple.test', 'preparateur'),
  ('00000000-0000-0000-0000-0000000000b2', 'ligue@exemple.test', 'preparateur'),
  ('00000000-0000-0000-0000-0000000000c1', 'comite@exemple.test', 'preparateur'),
  ('00000000-0000-0000-0000-0000000000d1', 'club@exemple.test', 'observateur'),
  ('00000000-0000-0000-0000-0000000000d2', 'observateur@exemple.test', 'observateur'),
  ('00000000-0000-0000-0000-0000000000e1', 'jeune@exemple.test', 'joueur'),
  ('00000000-0000-0000-0000-0000000000f1', 'sansrole@exemple.test', null)
on conflict (user_id) do update set role = excluded.role;
update public.hb_profiles set player_id = 'j-0007' where user_id = '00000000-0000-0000-0000-0000000000e1';

-- Structure fictive : Fédération ; ligue (13, 83, 06) → comité du 83 → club 6383015.
insert into public.hb_units (id, data) values
  ('fede', '{"id":"fede","levelId":"niveau-federation","name":"Fédération fictive"}'),
  ('ligue-sud', '{"id":"ligue-sud","levelId":"niveau-ligue","name":"Ligue fictive","departments":["13","83","06"]}'),
  ('unite-83', '{"id":"unite-83","levelId":"niveau-comite","name":"Comité fictif","parentId":"ligue-sud","departments":["83"]}'),
  ('club-1', '{"id":"club-1","levelId":"niveau-club","name":"Club fictif","parentId":"unite-83","clubNumber":"6383015"}');
insert into public.hb_assignments (id, data) values
  ('aff-n', '{"id":"aff-n","userId":"00000000-0000-0000-0000-0000000000b1","unitId":"fede","role":"preparateur"}'),
  ('aff-l', '{"id":"aff-l","userId":"00000000-0000-0000-0000-0000000000b2","unitId":"ligue-sud","role":"preparateur"}'),
  ('aff-c', '{"id":"aff-c","userId":"00000000-0000-0000-0000-0000000000c1","unitId":"unite-83","role":"preparateur"}'),
  ('aff-d', '{"id":"aff-d","userId":"00000000-0000-0000-0000-0000000000d1","unitId":"club-1","role":"observateur"}'),
  -- Ancien membre du staff (rôle retiré) dont l'affectation est restée : la règle (rôle) doit le laisser dehors.
  ('aff-f', '{"id":"aff-f","userId":"00000000-0000-0000-0000-0000000000f1","unitId":"club-1","role":"observateur"}');

-- ---------- Jeu fictif ----------
-- 700 joueurs : clubs du 83 (dont celui du club), du 13, du 06, du 75 (hors ligue), département seul, rien du tout ;
-- auteurs variés (dont le club, l'observateur et l'ancien membre sans rôle, hors de leur périmètre parfois).
select setseed(0.58);
create temporary table auteurs (n int, uid text);
insert into auteurs values (0, '00000000-0000-0000-0000-0000000000d1'), (1, '00000000-0000-0000-0000-0000000000d2'),
  (2, '00000000-0000-0000-0000-0000000000f1'), (3, '00000000-0000-0000-0000-0000000000c1'),
  (4, '00000000-0000-0000-0000-0000000000b9'), (5, null), (6, '00000000-0000-0000-0000-0000000000b9'),
  (7, '00000000-0000-0000-0000-0000000000a1');
insert into public.hb_players (id, data)
select 'j-' || lpad(i::text, 4, '0'),
       jsonb_strip_nulls(jsonb_build_object('id', 'j-' || lpad(i::text, 4, '0'), 'firstName', 'Prénom', 'lastName', 'Fictif ' || i,
         'clubCode', case i % 9 when 0 then '6383015' when 1 then '6383020' when 2 then '6313001' when 3 then '6306002'
                                when 4 then '6375003' else null end,
         'department', case i % 9 when 5 then '83' when 6 then '13' when 7 then '75' else null end,
         'createdBy', (select uid from auteurs where n = (i * 7) % 8)))
  from generate_series(1, 700) i;
-- La fiche du compte joueur (j-0007) : département 75, hors de tout périmètre de la ligue.
-- Mesures, avis, « vu » sur ces joueurs (et quelques-uns sur un joueur inconnu : sans périmètre, visibles par leur auteur).
insert into public.hb_measurements (id, data)
select 'm-' || i, jsonb_strip_nulls(jsonb_build_object('id', 'm-' || i,
         'playerId', case when i % 37 = 0 then 'inconnu' else 'j-' || lpad((1 + (i * 13) % 700)::text, 4, '0') end,
         'value', i, 'createdBy', (select uid from auteurs where n = (i * 5) % 8)))
  from generate_series(1, 3000) i;
insert into public.hb_evaluations (id, data)
select 'ev-' || i, jsonb_strip_nulls(jsonb_build_object('id', 'ev-' || i,
         'playerId', case when i % 41 = 0 then 'inconnu' else 'j-' || lpad((1 + (i * 17) % 700)::text, 4, '0') end,
         'scores', '{}'::jsonb, 'createdBy', (select uid from auteurs where n = (i * 3) % 8)))
  from generate_series(1, 1500) i;
insert into public.hb_seen (id, data)
select 's-' || i, jsonb_strip_nulls(jsonb_build_object('id', 's-' || i,
         'playerId', case when i % 29 = 0 then 'inconnu' else 'j-' || lpad((1 + (i * 11) % 700)::text, 4, '0') end,
         'createdBy', (select uid from auteurs where n = (i * 11) % 8)))
  from generate_series(1, 1000) i;
-- Lignes supprimées (deleted) : la règle staff_read ne regarde pas « deleted », elles voyagent comme les autres.
update public.hb_measurements set deleted = true where right(id, 1) = '3';

-- Heures serveur : 40 heures distinctes seulement (déclencheurs coupés) : beaucoup de lignes partagent la même heure, et une
-- heure (la 7e) porte à elle seule plus de 100 lignes de chaque table (« import » : page pleine d'une seule heure).
set session_replication_role = replica;
do $$
declare t text;
begin
  foreach t in array array['players', 'measurements', 'evaluations', 'seen'] loop
    execute format($f$update public.hb_%1$s set server_updated_at = timestamptz '2026-10-01 12:00:00+00'
                        + (case when abs(hashtext(id)) %% 5 = 0 then 7 else abs(hashtext(id || 'h')) %% 40 end) * interval '1 second'$f$, t);
  end loop;
end $$;
set session_replication_role = default;
analyze public.hb_players; analyze public.hb_measurements; analyze public.hb_evaluations; analyze public.hb_seen;

-- ---------- Comparaison ----------
-- Écarts entre une fonction de lecture (p_fn) et la lecture directe sous RLS, pour un compte : 4 tables × curseurs × tailles.
-- Rend le nombre de (table, curseur, taille) différents ; les lignes visibles par table vont dans les avis (NOTICE).
create function pg_temp.ecarts(p_fn text, p_uid text, p_bavard boolean default false) returns integer
language plpgsql as $$
declare
  t text;
  c timestamptz;
  n integer;
  direct jsonb;
  par_fn jsonb;
  nb integer;
  ecarts integer := 0;
  vus text := '';
  curseurs timestamptz[];
begin
  foreach t in array array['players', 'measurements', 'evaluations', 'seen'] loop
    -- Curseurs : le début, la fin, et une heure sur quatre (dont la 7e seconde, la plus chargée).
    execute format('select array_agg(distinct server_updated_at) filter (where extract(second from server_updated_at)::int %% 4 = 3)
                      from public.hb_%I', t) into curseurs;
    curseurs := array['-infinity'::timestamptz, 'infinity'::timestamptz] || curseurs;
    perform set_config('test.uid', p_uid, true);
    set local role authenticated;
    execute format('select count(*) from public.hb_%I', t) into nb;
    vus := vus || format(' %s=%s', t, nb);
    foreach c in array curseurs loop
      foreach n in array array[1, 2, 7, 64, 1000] loop
        execute format('select coalesce(jsonb_agg(jsonb_build_array(id, server_updated_at, data) order by server_updated_at, id), ''[]'')
                          from (select id, data, server_updated_at from public.hb_%I where server_updated_at >= $1
                                 order by server_updated_at, id limit $2) x', t)
          into direct using c, n;
        execute format('select coalesce(jsonb_agg(jsonb_build_array(id, server_updated_at, data) order by o), ''[]'')
                          from (select id, data, server_updated_at, row_number() over () as o from %s($1, $2, $3)) x', p_fn)
          into par_fn using t, c, n;
        if direct is distinct from par_fn then
          ecarts := ecarts + 1;
          if p_bavard then
            raise notice '  écart % % curseur % taille % : direct % lignes, fonction % lignes', p_uid, t, c, n,
              jsonb_array_length(direct), jsonb_array_length(par_fn);
          end if;
        end if;
      end loop;
    end loop;
    reset role;
  end loop;
  if p_bavard then raise notice '  % : visibles%', p_uid, vus; end if;
  return ecarts;
end $$;

-- Parcours complet, page par page, avec le protocole de l'appli (src/syncLive.ts, readScopedPages) : « >= heure de la
-- dernière ligne reçue », lignes de cette heure déjà reçues écartées, et ancien filtre (heure > , ou = et id >) pour la page
-- suivante quand une page pleine n'a qu'une seule heure. Rend le nombre de lignes reçues en double, manquantes ou en trop
-- par rapport à la lecture directe complète (0 attendu), et le nombre de pages à l'ancien filtre (dans un avis).
create function pg_temp.parcours(p_uid text, p_table text, p_page integer) returns integer
language plpgsql as $$
declare
  attendu text[];
  recu text[] := '{}';
  page record;
  brut integer;
  premiere timestamptz;
  derniere timestamptz;
  der_id text;
  vu_heure text[] := '{}';
  colle boolean := false; -- page suivante à l'ancien filtre
  apres_at timestamptz := null;
  apres_id text := null;
  anciennes integer := 0;
  tours integer := 0;
  r record;
begin
  perform set_config('test.uid', p_uid, true);
  set local role authenticated;
  execute format('select coalesce(array_agg(id order by server_updated_at, id), ''{}'') from public.hb_%I', p_table) into attendu;
  loop
    tours := tours + 1;
    if tours > 10000 then raise exception 'parcours sans fin (% %)', p_uid, p_table; end if;
    brut := 0;
    premiere := null;
    for r in execute case when colle then
        format('select id, server_updated_at from public.hb_%I where server_updated_at > $1 or (server_updated_at = $1 and id > $2)
                 order by server_updated_at, id limit $3', p_table)
      else
        'select id, server_updated_at from public.hb_lire_perimetre($4, coalesce($1, ''-infinity''), $3)'
      end using apres_at, apres_id, p_page, p_table
    loop
      brut := brut + 1;
      if premiere is null then premiere := r.server_updated_at; end if;
      derniere := r.server_updated_at;
      der_id := r.id;
      -- Égalités déjà reçues (seulement en lecture « >= ») : écartées.
      if not colle and apres_at is not null and r.server_updated_at = apres_at and r.id = any (vu_heure) then continue; end if;
      recu := recu || r.id;
      if apres_at is distinct from r.server_updated_at then vu_heure := '{}'; end if;
      vu_heure := vu_heure || r.id;
      apres_at := r.server_updated_at;
      apres_id := r.id;
    end loop;
    if colle then anciennes := anciennes + 1; end if;
    exit when brut < p_page;
    colle := premiere = derniere; -- page pleine d'une seule heure : ancien filtre pour la suivante
  end loop;
  reset role;
  if anciennes > 0 then raise notice '  parcours % % (pages de %) : % page(s) à l''ancien filtre', p_uid, p_table, p_page, anciennes; end if;
  return (select count(*) from (select unnest(recu) except all select unnest(attendu)) a)
       + (select count(*) from (select unnest(attendu) except all select unnest(recu)) b);
end $$;

-- ---------- 1. Preuve : 8 comptes, aucun écart ----------
do $$
declare
  comptes text[][] := array[
    array['00000000-0000-0000-0000-0000000000a1', 'administrateur'],
    array['00000000-0000-0000-0000-0000000000b1', 'niveau Fédération'],
    array['00000000-0000-0000-0000-0000000000b2', 'ligue'],
    array['00000000-0000-0000-0000-0000000000c1', 'comité'],
    array['00000000-0000-0000-0000-0000000000d1', 'club'],
    array['00000000-0000-0000-0000-0000000000d2', 'observateur sans affectation'],
    array['00000000-0000-0000-0000-0000000000e1', 'joueur'],
    array['00000000-0000-0000-0000-0000000000f1', 'sans rôle']];
  i integer;
  e integer;
  essais integer := 0;
begin
  for i in 1 .. array_length(comptes, 1) loop
    e := pg_temp.ecarts('public.hb_lire_perimetre', comptes[i][1], true);
    assert e = 0, format('%s : %s écart(s) entre hb_lire_perimetre et la lecture directe', comptes[i][2], e);
    essais := essais + 1;
    raise notice 'lecture par périmètre, % : identique à la lecture directe (4 tables, tous curseurs et tailles)', comptes[i][2];
  end loop;
  raise notice 'lecture par périmètre : % comptes, 0 écart', essais;
end $$;

-- Les comptes ne voient pas la même chose (sinon l'essai ne prouverait rien) : quelques repères.
do $$
declare
  vus jsonb := '{}';
  u text;
  n integer;
begin
  foreach u in array array['00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b2',
                           '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000d1',
                           '00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000e1',
                           '00000000-0000-0000-0000-0000000000f1'] loop
    perform set_config('test.uid', u, true);
    set local role authenticated;
    select count(*) into n from public.hb_measurements;
    reset role;
    vus := vus || jsonb_build_object(right(u, 2), n);
  end loop;
  raise notice 'mesures visibles par compte (a1 admin, b2 ligue, c1 comité, d1 club, d2 observateur, e1 joueur, f1 sans rôle) : %', vus;
  assert (vus ->> 'a1')::int = 3000, 'administrateur : tout';
  assert (vus ->> 'b2')::int > (vus ->> 'c1')::int and (vus ->> 'c1')::int > (vus ->> 'd1')::int and (vus ->> 'd1')::int > (vus ->> 'd2')::int
     and (vus ->> 'd2')::int > 0, 'ligue > comité > club > observateur (ses lignes) > 0';
  assert (vus ->> 'e1')::int = 0 and (vus ->> 'f1')::int = 0, 'joueur et sans rôle : aucune mesure';
  perform set_config('test.uid', '00000000-0000-0000-0000-0000000000e1', true);
  set local role authenticated;
  select count(*) into n from public.hb_lire_perimetre('players', '-infinity', 1000);
  reset role;
  assert n = 1, 'joueur : sa fiche, par la fonction aussi';
  raise notice 'repères : ok (le joueur reçoit sa seule fiche, le compte sans rôle rien)';
end $$;

-- ---------- 2. Parcours complet avec le protocole de l'appli ----------
do $$
declare
  u text;
  t text;
  p integer;
  e integer;
  n integer := 0;
begin
  foreach u in array array['00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b2',
                           '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000d1',
                           '00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000f1'] loop
    foreach t in array array['players', 'measurements', 'evaluations', 'seen'] loop
      foreach p in array array[5, 37, 1000] loop
        e := pg_temp.parcours(u, t, p);
        assert e = 0, format('parcours %s %s pages de %s : %s ligne(s) en double, manquante(s) ou en trop', u, t, p, e);
        n := n + 1;
      end loop;
    end loop;
  end loop;
  raise notice 'parcours page par page (>= curseur, égalités écartées, ancien filtre si page pleine d''une heure) : % parcours exacts', n;
end $$;

-- ---------- 3. Contre-essai : l'essai attrape une fuite et un oubli ----------
-- Variantes tirées du texte de la vraie fonction (pg_get_functiondef) : (a) SECURITY DEFINER (lit en propriétaire, sans les
-- règles de lecture) ; (b) sans la branche « auteur ».
do $$
declare
  src text := pg_get_functiondef('public.hb_lire_perimetre(text, timestamptz, integer)'::regprocedure);
  fuite text;
  oubli text;
  e_fuite_sansrole integer;
  e_fuite_club integer;
  e_oubli integer;
begin
  fuite := replace(replace(src, 'public.hb_lire_perimetre(', 'public.hb_essai_fuite('), 'SECURITY INVOKER', 'SECURITY DEFINER');
  if fuite = replace(src, 'public.hb_lire_perimetre(', 'public.hb_essai_fuite(') then
    fuite := replace(fuite, 'LANGUAGE plpgsql', 'LANGUAGE plpgsql SECURITY DEFINER');
  end if;
  execute fuite;
  assert (select prosecdef from pg_proc where oid = 'public.hb_essai_fuite(text, timestamptz, integer)'::regprocedure), 'variante (a) en SECURITY DEFINER';
  grant execute on function public.hb_essai_fuite(text, timestamptz, integer) to authenticated;
  oubli := replace(src, 'public.hb_lire_perimetre(', 'public.hb_essai_oubli(');
  oubli := regexp_replace(oubli, 'where t\.created_by = \$5', 'where false and t.created_by = $5');
  assert oubli <> replace(src, 'public.hb_lire_perimetre(', 'public.hb_essai_oubli('), 'variante (b) modifiée';
  execute oubli;
  grant execute on function public.hb_essai_oubli(text, timestamptz, integer) to authenticated;

  -- (a) Sans les règles : l'ancien membre sans rôle (affecté au club) recevrait les lignes du club ; une fuite.
  e_fuite_sansrole := pg_temp.ecarts('public.hb_essai_fuite', '00000000-0000-0000-0000-0000000000f1');
  assert e_fuite_sansrole > 0, 'contre-essai (a) : la fuite vers le compte sans rôle DOIT être vue';
  -- (a) bis : pour le club, la variante sans règles rend ici les mêmes lignes (les branches sont exactes) : c'est bien la
  -- règle de lecture, appliquée par SECURITY INVOKER, qui protège le compte sans rôle.
  e_fuite_club := pg_temp.ecarts('public.hb_essai_fuite', '00000000-0000-0000-0000-0000000000d1');
  -- (b) Sans la branche auteur : le club ne reçoit plus les lignes qu'il a créées hors de son club ; un oubli.
  e_oubli := pg_temp.ecarts('public.hb_essai_oubli', '00000000-0000-0000-0000-0000000000d1');
  assert e_oubli > 0, 'contre-essai (b) : l''oubli des lignes de l''auteur DOIT être vu';
  raise notice 'contre-essai : variante sans règles → % écart(s) pour le compte sans rôle (fuite attrapée), % pour le club ; variante sans auteur → % écart(s) pour le club (oubli attrapé)',
    e_fuite_sansrole, e_fuite_club, e_oubli;
  drop function public.hb_essai_fuite(text, timestamptz, integer);
  drop function public.hb_essai_oubli(text, timestamptz, integer);
end $$;

-- ---------- 4. Garde-fous ----------
do $$
declare ok boolean;
begin
  -- Table hors liste blanche : refusée.
  perform set_config('test.uid', '00000000-0000-0000-0000-0000000000d1', true);
  set local role authenticated;
  begin
    perform public.hb_lire_perimetre('rewatch', '-infinity', 10);
    ok := false;
  exception when raise_exception then ok := true;
  end;
  assert ok, 'table hors liste refusée';
  begin
    perform public.hb_lire_perimetre('players; drop table x', '-infinity', 10);
    ok := false;
  exception when raise_exception then ok := true;
  end;
  assert ok, 'nom de table forgé refusé';
  -- Taille ramenée entre 1 et 1 000.
  assert (select count(*) from public.hb_lire_perimetre('measurements', '-infinity', 0)) = 1, 'taille 0 → 1';
  assert (select count(*) from public.hb_lire_perimetre('measurements', null, 5000)) <= 1000, 'taille plafonnée à 1 000';
  reset role;
  -- Sans compte : refusé.
  perform set_config('test.uid', '', true);
  set local role authenticated;
  begin
    perform public.hb_lire_perimetre('players', '-infinity', 10);
    ok := false;
  exception when raise_exception then ok := true;
  end;
  reset role;
  assert ok, 'sans compte : refusé';
  -- anon : pas le droit d'exécuter.
  set local role anon;
  begin
    perform public.hb_lire_perimetre('players', '-infinity', 10);
    ok := false;
  exception when insufficient_privilege then ok := true;
  end;
  reset role;
  assert ok, 'anon : refusé';
  -- Colonne générée : suit createdBy (écriture par hb_upsert, comme l'appli ; encadrant du comité, joueur du 83).
  perform set_config('test.uid', '00000000-0000-0000-0000-0000000000c1', true);
  set local role authenticated;
  perform public.hb_upsert('measurements', '[{"id":"m-neuve","data":{"id":"m-neuve","playerId":"j-0009","value":1,"updatedAt":5},"updated_at_client":5,"deleted":false}]'::jsonb);
  reset role;
  assert (select created_by from public.hb_measurements where id = 'm-neuve') = '00000000-0000-0000-0000-0000000000c1', 'created_by posé à l''écriture';
  raise notice 'garde-fous (liste blanche, taille, sans compte, anon, colonne générée à l''écriture) : ok';
end $$;
