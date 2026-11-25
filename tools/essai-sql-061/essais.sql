-- Essais de supabase/061_registre_changements.sql (lancer.sh), sur le jeu fictif de tools/essai-sql-058/essais.sql (8 comptes :
-- administrateur a1, niveau Fédération b1, ligue b2, comité c1, club d1, observateur sans affectation d2, joueur e1, sans rôle
-- f1 ; 700 joueurs, 3 000 mesures, 1 500 avis, 1 000 « vu »). Données fictives seulement. Toute erreur d'assertion arrête.
-- A. DROITS DU DIRECT : pour chaque compte, les canaux gardés = hb_mes_canaux() et le droit d'émettre = hb_has_role() ; les
--    règles de realtime.messages (vraies règles, comme Realtime : sujet posé, lecture puis écriture d'un message) autorisent
--    EXACTEMENT les canaux qu'autorisaient les règles de 057, pour 30 sujets candidats ; puis après chaque changement (rôle,
--    affectation, unité déplacée, n° de club, niveau renommé « Fédération », fiche du joueur, compte supprimé), canaux gardés
--    remplis AVANT le changement : toujours égaux. Contre-essai : une ligne gardée falsifiée est bien détectée.
-- B. REGISTRE : curseur de chaque compte, écritures réelles (hb_upsert comme les comptes, SQL direct, suppression, mutation
--    d'un joueur hors du club, groupe rendu privé, événement) ; puis, pour chaque compte, un « appareil » qui avait les lignes
--    visibles d'avant applique la réponse (relecture par identifiant, sous ses règles, des lignes citées) : il tient EXACTEMENT
--    les lignes visibles maintenant (19 tables) ; empreintes = formule de 059 ; garde-fous (curseur absent, illisible, du
--    futur, purgé ; anon ; table fermée).
\set ON_ERROR_STOP 1
create schema if not exists essai;

-- Appel comme un compte (role authenticated, test.uid).
create or replace function essai.comme(p_uid text, p_sql text) returns jsonb
language plpgsql as $$
declare r jsonb;
begin
  perform set_config('test.uid', p_uid, true);
  set local role authenticated;
  execute p_sql into r;
  reset role;
  return r;
end $$;

-- Droits réels sur un sujet, par les règles de realtime.messages (comme Realtime : sujet dans realtime.topic, un message
-- « broadcast » inséré par le serveur puis lu par le compte ; puis un essai d'insertion par le compte). Rend 'L', 'LE' ou ''.
create or replace function essai.droits_direct(p_uid text, p_topic text) returns text
language plpgsql as $$
declare
  v_id bigint;
  lit boolean;
  emet boolean := false;
begin
  insert into realtime.messages (topic, extension, payload, event, private) values (p_topic, 'broadcast', '{}', 'essai', true) returning id into v_id;
  perform set_config('test.uid', p_uid, true);
  perform set_config('realtime.topic', p_topic, true);
  set local role authenticated;
  lit := exists (select 1 from realtime.messages where id = v_id);
  begin
    insert into realtime.messages (topic, extension, payload, event, private) values (p_topic, 'broadcast', '{}', 'essai', true);
    emet := true;
  exception when insufficient_privilege then emet := false;
  end;
  reset role;
  delete from realtime.messages where id = v_id or event = 'essai';
  return case when lit then 'L' else '' end || case when emet then 'E' else '' end;
end $$;

-- Droits attendus d'après les règles de 057 (référence : hb_mes_canaux, hb_has_role, calculés maintenant).
create or replace function essai.droits_057(p_uid text, p_topic text) returns text
language plpgsql as $$
declare
  lit boolean;
  emet boolean;
begin
  perform set_config('test.uid', p_uid, true);
  lit := p_topic = any (public.hb_mes_canaux());
  emet := lit and public.hb_has_role();
  return case when lit then 'L' else '' end || case when emet then 'E' else '' end;
end $$;

create table essai.comptes (uid text primary key, nom text);
insert into essai.comptes values
  ('00000000-0000-0000-0000-0000000000a1', 'administrateur'), ('00000000-0000-0000-0000-0000000000b1', 'Fédération'),
  ('00000000-0000-0000-0000-0000000000b2', 'ligue'), ('00000000-0000-0000-0000-0000000000c1', 'comité'),
  ('00000000-0000-0000-0000-0000000000d1', 'club'), ('00000000-0000-0000-0000-0000000000d2', 'observateur'),
  ('00000000-0000-0000-0000-0000000000e1', 'joueur'), ('00000000-0000-0000-0000-0000000000f1', 'sans rôle'),
  ('00000000-0000-0000-0000-0000000000ff', 'inconnu');

-- Vérifie, pour tous les comptes : canaux rapides = hb_mes_canaux, émetteur = hb_has_role, et les droits réels de 30
-- sujets = ceux de 057 ; d'abord avec les lignes gardées telles quelles (remplies avant le dernier changement : une ligne
-- périmée utilisée se verrait ici), puis, si p_memo, après les avoir remplies de nouveau (hb_mes_canaux_memo).
create or replace function essai.verifier_droits(p_etape text, p_memo boolean) returns void
language plpgsql as $$
declare
  c record;
  t text;
  sujets text[] := array['hb:tout', 'hb:staff', 'hb:commun', 'hb:dept:83', 'hb:dept:13', 'hb:dept:06', 'hb:dept:75', 'hb:club:6383015',
                         'hb:club:6306002', 'hb:club:9999999', 'hb:joueur:j-0007', 'hb:joueur:j-0001', 'hb:compte:x'];
  a text;
  b text;
  n integer := 0;
  passe integer;
begin
  for c in select * from essai.comptes loop
    sujets := sujets || ('hb:compte:' || c.uid);
    perform set_config('test.uid', c.uid, true);
    sujets := sujets || public.hb_mes_canaux();
  end loop;
  select array_agg(distinct x order by x) into sujets from unnest(sujets) x;
  for passe in 1 .. case when p_memo then 2 else 1 end loop
    for c in select * from essai.comptes loop
      if passe = 2 then perform essai.comme(c.uid, 'select to_jsonb(public.hb_mes_canaux_memo())'); end if;
      a := essai.comme(c.uid, 'select to_jsonb(public.hb_canaux_rapides())')::text;
      perform set_config('test.uid', c.uid, true);
      b := to_jsonb(public.hb_mes_canaux())::text;
      if a is distinct from b then raise exception 'ÉCHEC % : canaux rapides de % = %, attendu %', p_etape, c.nom, a, b; end if;
      if essai.comme(c.uid, 'select to_jsonb(public.hb_emetteur_rapide())')::boolean is distinct from public.hb_has_role() then
        raise exception 'ÉCHEC % : émetteur de %', p_etape, c.nom;
      end if;
      foreach t in array sujets loop
        a := essai.droits_direct(c.uid, t);
        b := essai.droits_057(c.uid, t);
        if a is distinct from b then raise exception 'ÉCHEC % : % sur % : règles 061 « % », règles 057 « % »', p_etape, c.nom, t, a, b; end if;
        n := n + 1;
      end loop;
    end loop;
  end loop;
  raise notice 'droits du direct, % : % (compte, sujet) identiques aux règles de 057 (9 comptes, % sujets)', rpad(p_etape, 34), n, cardinality(sujets);
end $$;

-- ---------- A. Droits du direct ----------
select essai.verifier_droits('sans ligne gardée', false);
select essai.verifier_droits('lignes gardées', true);
do $$
begin
  if (select count(*) from public.hb_canaux_cache) < 8 then raise exception 'ÉCHEC : lignes gardées absentes'; end if;
  raise notice 'lignes gardées : % comptes', (select count(*) from public.hb_canaux_cache);
end $$;
-- Changements (lignes gardées remplies avant chacun : une ligne périmée utilisée se verrait).
update public.hb_profiles set role = null where user_id = '00000000-0000-0000-0000-0000000000d1';
select essai.verifier_droits('club sans rôle', false);
select essai.verifier_droits('club sans rôle (regardé)', true);
update public.hb_profiles set role = 'observateur' where user_id = '00000000-0000-0000-0000-0000000000d1';
select essai.verifier_droits('club de nouveau observateur', true);
update public.hb_assignments set data = jsonb_set(data, '{unitId}', '"club-1"') where id = 'aff-c';
select essai.verifier_droits('comité affecté au club', true);
update public.hb_assignments set data = jsonb_set(data, '{unitId}', '"unite-83"') where id = 'aff-c';
insert into public.hb_assignments (id, data) values ('aff-d2', '{"id":"aff-d2","userId":"00000000-0000-0000-0000-0000000000d2","unitId":"ligue-sud"}');
select essai.verifier_droits('observateur affecté à la ligue', true);
delete from public.hb_assignments where id = 'aff-d2';
select essai.verifier_droits('affectation retirée', true);
update public.hb_units set data = jsonb_set(data, '{clubNumber}', '"6306002"') where id = 'club-1';
select essai.verifier_droits('n° de club changé', true);
update public.hb_units set data = jsonb_set(data, '{clubNumber}', '"6383015"') where id = 'club-1';
update public.hb_units set data = jsonb_set(data, '{parentId}', '"fede"') where id = 'unite-83';
select essai.verifier_droits('comité déplacé sous la Fédération', true);
update public.hb_units set data = jsonb_set(data, '{parentId}', '"ligue-sud"') where id = 'unite-83';
insert into public.hb_levels (id, data) values ('niveau-ligue', '{"id":"niveau-ligue","name":"Fédération régionale"}')
  on conflict (id) do update set data = excluded.data;
select essai.verifier_droits('niveau renommé « Fédération… »', true);
delete from public.hb_levels where id = 'niveau-ligue';
update public.hb_profiles set player_id = 'j-0001' where user_id = '00000000-0000-0000-0000-0000000000e1';
select essai.verifier_droits('fiche du joueur changée', true);
update public.hb_profiles set player_id = 'j-0007' where user_id = '00000000-0000-0000-0000-0000000000e1';
do $$
declare v0 bigint := (select v from public.hb_droits_compte where user_id = '00000000-0000-0000-0000-0000000000c1');
begin
  -- Une colonne sans effet sur les droits (nom) : la version du compte ne bouge pas.
  update public.hb_profiles set full_name = 'Nom changé' where user_id = '00000000-0000-0000-0000-0000000000c1';
  if (select v from public.hb_droits_compte where user_id = '00000000-0000-0000-0000-0000000000c1') is distinct from v0 then
    raise exception 'ÉCHEC : le nom changé a invalidé les droits du comité';
  end if;
  raise notice 'nom changé : droits du comité toujours gardés (pas de recalcul inutile)';
end $$;
select essai.verifier_droits('après le nom changé', true);
-- Contre-essai : ligne gardée falsifiée (hb:tout pour le club, versions actuelles) : l'essai DOIT le voir.
do $$
declare ok boolean := false;
begin
  update public.hb_canaux_cache set canaux = canaux || 'hb:tout'::text where user_id = '00000000-0000-0000-0000-0000000000d1';
  begin
    perform essai.verifier_droits('contre-essai', false);
  exception when others then
    ok := sqlerrm like 'ÉCHEC contre-essai%';
  end;
  if not ok then raise exception 'ÉCHEC : la ligne gardée falsifiée n''a pas été détectée'; end if;
  raise notice 'contre-essai : ligne gardée falsifiée détectée';
  raise exception 'annuler' using errcode = 'P0099';
exception when sqlstate 'P0099' then null;
end $$;
-- Compte supprimé (jeton encore valide) : plus rien que le commun et son canal, comme avant.
delete from auth.users where id = '00000000-0000-0000-0000-0000000000f1';
select essai.verifier_droits('compte supprimé', false);

-- ---------- B. Registre ----------
-- Ce que chaque compte voit avant (19 tables) et son curseur.
create table essai.vus (uid text, tbl text, id text, sua timestamptz, primary key (uid, tbl, id));
create table essai.curseurs (uid text primary key, c text, premier jsonb);
create or replace function essai.visibles(p_uid text) returns table (tbl text, id text, sua timestamptz)
language plpgsql as $$
declare t text;
begin
  perform set_config('test.uid', p_uid, true);
  set local role authenticated;
  foreach t in array array['players', 'criteria', 'measurements', 'teams', 'events', 'evaluations', 'groups', 'lists', 'alerts',
                           'follows', 'videos', 'seen', 'rewatch', 'config', 'levels', 'units', 'assignments', 'question_log',
                           'saved_questions'] loop
    return query execute format('select %L::text, x.id, x.server_updated_at from public.%I x', t, 'hb_' || t);
  end loop;
  reset role;
end $$;
insert into essai.vus select c.uid, v.* from essai.comptes c cross join lateral essai.visibles(c.uid) v where c.nom not in ('sans rôle', 'inconnu');
insert into essai.curseurs select uid, null, essai.comme(uid, 'select public.hb_registre_depuis(null)') from essai.comptes where nom not in ('sans rôle', 'inconnu');
update essai.curseurs set c = premier ->> 'c';
do $$
begin
  if exists (select 1 from essai.curseurs where (premier ->> 'complet')::boolean or premier ? 'e') then raise exception 'ÉCHEC : premier appel complet'; end if;
  raise notice 'premier appel : pas complet, curseur rendu (%)', (select string_agg(distinct premier ->> 'complet', ',') from essai.curseurs);
end $$;

-- Écritures (chacune sa transaction, comme les appareils) : hb_upsert comme le compte ; aucune ne doit être refusée.
create or replace function essai.ecrire(p_uid text, p_table text, p_data jsonb) returns void
language plpgsql as $$
declare r jsonb;
begin
  r := essai.comme(p_uid, format('select public.hb_upsert(%L, %L::jsonb)', p_table,
         jsonb_build_array(jsonb_build_object('id', p_data ->> 'id', 'data', p_data, 'updated_at_client', (p_data ->> 'updatedAt')::bigint))));
  if jsonb_array_length(coalesce(r, '[]')) > 0 then raise exception 'ÉCHEC : écriture refusée (%, %) : %', p_table, p_data ->> 'id', r; end if;
end $$;
-- Le comité note une mesure sur un joueur du club ; l'observateur du club le marque « vu ».
select essai.ecrire('00000000-0000-0000-0000-0000000000c1', 'measurements',
  '{"id":"m-reg-1","playerId":"j-0009","value":42,"createdBy":"00000000-0000-0000-0000-0000000000c1","updatedAt":1000}');
-- Le comité modifie une mesure existante d'un joueur du club.
select essai.ecrire('00000000-0000-0000-0000-0000000000c1', 'measurements',
  (select data || '{"value": 777, "updatedAt": 1700000000000}'::jsonb from public.hb_measurements where data ->> 'playerId' = 'j-0009' and id <> 'm-reg-1' order by id limit 1));
-- L'administrateur MUTE un joueur du club (6383015 → 6306002, hors du club et du 83) : le club et le comité le perdent, avec
-- ses mesures, avis, « vu » (hb_scope_cascade).
select essai.ecrire('00000000-0000-0000-0000-0000000000a1', 'players',
  (select data || '{"clubCode": "6306002", "updatedAt": 1700000000000}'::jsonb from public.hb_players where id = 'j-0018'));
-- L'administrateur crée un événement, puis un groupe partagé qu'il rend ensuite privé.
select essai.ecrire('00000000-0000-0000-0000-0000000000a1', 'events',
  '{"id":"ev-reg","name":"Détection fictive","date":"2026-11-02","createdBy":"00000000-0000-0000-0000-0000000000a1","updatedAt":1000}');
select essai.ecrire('00000000-0000-0000-0000-0000000000d1', 'seen',
  '{"id":"00000000-0000-0000-0000-0000000000d1:ev-reg:j-0009","playerId":"j-0009","eventId":"ev-reg","createdBy":"00000000-0000-0000-0000-0000000000d1","updatedAt":1000}');
select essai.ecrire('00000000-0000-0000-0000-0000000000a1', 'groups',
  '{"id":"g-reg","name":"Groupe fictif","playerIds":[],"createdBy":"00000000-0000-0000-0000-0000000000a1","updatedAt":1000}');
-- Ce groupe partagé est vu de tous : on note qui le tient AVANT qu'il devienne privé (les « appareils » l'ont reçu).
insert into essai.vus select c.uid, v.* from essai.comptes c cross join lateral essai.visibles(c.uid) v
 where c.nom not in ('sans rôle', 'inconnu') and v.tbl = 'groups' and v.id = 'g-reg' on conflict do nothing;
select essai.ecrire('00000000-0000-0000-0000-0000000000a1', 'groups',
  '{"id":"g-reg","name":"Groupe fictif","playerIds":[],"private":true,"createdBy":"00000000-0000-0000-0000-0000000000a1","updatedAt":2000}');
-- Écriture par SQL direct (tâche serveur, déclencheurs actifs) : un avis sur un joueur du club.
select set_config('test.uid', '00000000-0000-0000-0000-0000000000a1', false);
insert into public.hb_evaluations (id, data) values ('ev-reg-sql', '{"id":"ev-reg-sql","playerId":"j-0027","scores":{},"createdBy":"00000000-0000-0000-0000-0000000000a1","updatedAt":5}');
-- Suppression définitive d'un « vu » du club (purge serveur).
delete from public.hb_seen where id = (select id from public.hb_seen where scope_club = '6383015' and id like 's-%' order by id limit 1);
select set_config('test.uid', '', false);

-- Réponse du registre pour chaque compte ; « appareil » : lignes visibles d'avant, puis chaque ligne citée relue par
-- identifiant (trouvée : gardée avec son heure ; absente : retirée), comme src/sync.ts. Doit égaler les lignes visibles
-- maintenant.
create table essai.reponses (uid text primary key, r jsonb);
insert into essai.reponses select uid, essai.comme(uid, format('select public.hb_registre_depuis(%L)', c)) from essai.curseurs;
create or replace function essai.relire(p_uid text, p_tbl text, p_ids text[]) returns table (id text, sua timestamptz)
language plpgsql as $$
begin
  perform set_config('test.uid', p_uid, true);
  set local role authenticated;
  return query execute format('select x.id, x.server_updated_at from public.%I x where x.id = any ($1)', 'hb_' || p_tbl) using p_ids;
  reset role;
end $$;
do $$
declare
  c record;
  t text;
  l jsonb;
  ids text[];
  ecart integer;
  cites integer;
  pertes integer;
  manquees integer;
  total_cites integer := 0;
begin
  for c in select r.uid, r.r, k.nom from essai.reponses r join essai.comptes k using (uid) loop
    if not (c.r ->> 'complet')::boolean then raise exception 'ÉCHEC : réponse pas complète pour %', c.nom; end if;
    create temporary table appareil on commit drop as select tbl, id, sua from essai.vus where uid = c.uid;
    cites := 0;
    pertes := 0;
    for t, l in select * from jsonb_each(c.r -> 'e') loop
      if jsonb_typeof(l) <> 'array' then raise exception 'ÉCHEC : table « trop » inattendue (%, %)', c.nom, t; end if;
      ids := array(select x ->> 0 from jsonb_array_elements(l) x);
      cites := cites + cardinality(ids);
      pertes := pertes + (select count(*) from jsonb_array_elements(l) x where (x ->> 3)::int = 1);
      delete from appareil a where a.tbl = t and a.id = any (ids);
      insert into appareil select t, r.id, r.sua from essai.relire(c.uid, t, ids) r;
    end loop;
    -- Comparaison avec les lignes visibles maintenant (identifiant et heure serveur).
    select count(*) into ecart from (
      (select tbl, id, sua from appareil except select tbl, id, sua from essai.visibles(c.uid))
      union all
      (select tbl, id, sua from essai.visibles(c.uid) except select tbl, id, sua from appareil)) d;
    if ecart > 0 then
      raise exception 'ÉCHEC registre : % lignes d''écart pour % (ex. %)', ecart, c.nom,
        (select string_agg(tbl || ':' || id, ' ') from (select tbl, id, sua from essai.visibles(c.uid) except select tbl, id, sua from appareil limit 5) s);
    end if;
    -- Pertes d'accès citées « perte » (le joueur muté pour le club et le comité, le groupe devenu privé pour les autres).
    select count(*) into manquees from essai.vus v
     where v.uid = c.uid and not exists (select 1 from essai.visibles(c.uid) x where x.tbl = v.tbl and x.id = v.id)
       and not exists (select 1 from jsonb_array_elements(c.r -> 'e' -> v.tbl) x where x ->> 0 = v.id and (x ->> 3)::int = 1);
    if manquees > 0 then
      raise exception 'ÉCHEC : % pertes d''accès non citées « perte » pour % (%)', manquees, c.nom,
        (select string_agg(v.tbl || ':' || v.id || '=' || coalesce((select x::text from jsonb_array_elements(c.r -> 'e' -> v.tbl) x where x ->> 0 = v.id), 'absent'), ' ')
           from essai.vus v
          where v.uid = c.uid and not exists (select 1 from essai.visibles(c.uid) x where x.tbl = v.tbl and x.id = v.id)
            and not exists (select 1 from jsonb_array_elements(c.r -> 'e' -> v.tbl) x where x ->> 0 = v.id and (x ->> 3)::int = 1));
    end if;
    raise notice 'registre, % : % lignes citées (dont % pertes), appareil = lignes visibles maintenant', rpad(c.nom, 14), cites, pertes;
    total_cites := total_cites + cites;
    drop table appareil;
  end loop;
end $$;
-- Cas attendus nommément.
do $$
declare
  club jsonb := (select r -> 'e' from essai.reponses where uid = '00000000-0000-0000-0000-0000000000d1');
  obs jsonb := (select r -> 'e' from essai.reponses where uid = '00000000-0000-0000-0000-0000000000d2');
  joueur jsonb := (select r -> 'e' from essai.reponses where uid = '00000000-0000-0000-0000-0000000000e1');
begin
  if not exists (select 1 from jsonb_array_elements(club -> 'players') x where x ->> 0 = 'j-0018' and (x ->> 3)::int = 1) then
    raise exception 'ÉCHEC : la mutation du joueur j-0018 n''est pas une perte pour le club';
  end if;
  if not exists (select 1 from jsonb_array_elements(club -> 'measurements') x where x ->> 0 = 'm-reg-1' and (x ->> 3)::int = 0 and x ->> 2 is not null) then
    raise exception 'ÉCHEC : la mesure du club n''est pas citée avec son empreinte';
  end if;
  if not exists (select 1 from jsonb_array_elements(obs -> 'groups') x where x ->> 0 = 'g-reg' and (x ->> 3)::int = 1) then
    raise exception 'ÉCHEC : le groupe rendu privé n''est pas une perte pour l''observateur';
  end if;
  if not exists (select 1 from jsonb_array_elements(club -> 'evaluations') x where x ->> 0 = 'ev-reg-sql') then
    raise exception 'ÉCHEC : l''écriture SQL directe n''est pas citée';
  end if;
  if not exists (select 1 from jsonb_array_elements(club -> 'seen') x where (x ->> 3)::int = 1) then
    raise exception 'ÉCHEC : la suppression définitive n''est pas une perte';
  end if;
  if joueur ? 'measurements' or joueur ? 'groups' then raise exception 'ÉCHEC : le compte joueur voit des lignes du staff : %', joueur; end if;
  -- Empreintes : la formule de 059, sur la ligne enregistrée.
  if exists (select 1 from essai.reponses r, jsonb_each(r.r -> 'e') e(t, l), jsonb_array_elements(l) x
              where jsonb_typeof(l) = 'array' and x ->> 2 is not null
                and x ->> 2 is distinct from (select left(encode(sha256(convert_to(m.id || E'\n' || ((extract(epoch from m.server_updated_at) * 1000000)::bigint)::text || E'\n' || m.data::text, 'UTF8')), 'hex'), 16)
                                                from (select id, data, server_updated_at from public.hb_measurements where e.t = 'measurements'
                                                      union all select id, data, server_updated_at from public.hb_players where e.t = 'players'
                                                      union all select id, data, server_updated_at from public.hb_evaluations where e.t = 'evaluations'
                                                      union all select id, data, server_updated_at from public.hb_seen where e.t = 'seen') m
                                               where m.id = x ->> 0 and (extract(epoch from m.server_updated_at) * 1000000)::bigint = (x ->> 1)::bigint)) then
    raise exception 'ÉCHEC : empreinte différente de la formule de 059 (%)', (select string_agg(distinct e.t || ':' || x::text || ' / ' || coalesce(
                (select ((extract(epoch from m.server_updated_at) * 1000000)::bigint)::text || ' ' || left(encode(sha256(convert_to(m.id || E'\n' || ((extract(epoch from m.server_updated_at) * 1000000)::bigint)::text || E'\n' || m.data::text, 'UTF8')), 'hex'), 16)
                   from (select id, data, server_updated_at from public.hb_measurements where e.t = 'measurements'
                         union all select id, data, server_updated_at from public.hb_players where e.t = 'players'
                         union all select id, data, server_updated_at from public.hb_evaluations where e.t = 'evaluations'
                         union all select id, data, server_updated_at from public.hb_seen where e.t = 'seen') m where m.id = x ->> 0), 'absente'), ' ; ')
              from essai.reponses r, jsonb_each(r.r -> 'e') e(t, l), jsonb_array_elements(l) x
              where jsonb_typeof(l) = 'array' and x ->> 2 is not null);
  end if;
  if exists (select 1 from essai.reponses r, jsonb_each(r.r -> 'e') e(t, l), jsonb_array_elements(l) x
              where jsonb_typeof(l) = 'array' and x ->> 2 is not null and e.t not in ('players', 'measurements', 'evaluations', 'seen')) then
    raise exception 'ÉCHEC : empreinte donnée hors des 4 tables de contenu';
  end if;
  raise notice 'cas nommés : mutation = perte pour le club, mesure avec empreinte (= 059), groupe rendu privé = perte, SQL direct cité, suppression = perte, joueur isolé';
end $$;

-- Second passage avec le nouveau curseur : rien de neuf (au plus des lignes citées deux fois, déjà sur l'appareil).
do $$
declare
  c record;
  r jsonb;
  n integer;
begin
  for c in select r.uid, r.r ->> 'c' as cur, k.nom from essai.reponses r join essai.comptes k using (uid) loop
    r := essai.comme(c.uid, format('select public.hb_registre_depuis(%L)', c.cur));
    select coalesce(sum(jsonb_array_length(l)), 0) into n from jsonb_each(r -> 'e') e(t, l) where jsonb_typeof(l) = 'array';
    if not (r ->> 'complet')::boolean or n > 0 then raise exception 'ÉCHEC : second passage de % : %', c.nom, r; end if;
  end loop;
  raise notice 'second passage : complet, rien de neuf, pour chaque compte';
end $$;

-- Changement de droits : les canaux de la réponse changent (l'appareil revoit alors son périmètre et ses canaux).
do $$
declare
  avant jsonb := (select r -> 'canaux' from essai.reponses where uid = '00000000-0000-0000-0000-0000000000d1');
  apres jsonb;
begin
  update public.hb_assignments set data = jsonb_set(data, '{unitId}', '"unite-83"') where id = 'aff-d';
  apres := essai.comme('00000000-0000-0000-0000-0000000000d1', format('select public.hb_registre_depuis(%L)',
             (select r ->> 'c' from essai.reponses where uid = '00000000-0000-0000-0000-0000000000d1'))) -> 'canaux';
  if avant = apres or not apres ? 'hb:dept:83' then raise exception 'ÉCHEC : canaux inchangés après la nouvelle affectation (% → %)', avant, apres; end if;
  raise notice 'affectation changée : canaux de la réponse % → %', avant, apres;
  raise exception 'annuler' using errcode = 'P0099';
exception when sqlstate 'P0099' then null;
end $$;

-- Garde-fous.
do $$
declare
  r jsonb;
  ok boolean;
  club text := '00000000-0000-0000-0000-0000000000d1';
begin
  r := essai.comme(club, $q$select public.hb_registre_depuis('pas un nombre')$q$);
  if (r ->> 'complet')::boolean then raise exception 'ÉCHEC : curseur illisible complet'; end if;
  r := essai.comme(club, $q$select public.hb_registre_depuis('999999999999')$q$);
  if (r ->> 'complet')::boolean then raise exception 'ÉCHEC : curseur du futur complet'; end if;
  r := essai.comme(club, $q$select public.hb_registre_depuis('1')$q$);
  if (r ->> 'complet')::boolean then raise exception 'ÉCHEC : curseur d''avant le registre complet'; end if;
  -- anon : rien.
  ok := false;
  begin
    perform set_config('test.uid', '', true);
    set local role anon;
    perform public.hb_registre_depuis(null);
  exception when insufficient_privilege then ok := true;
  end;
  reset role;
  if not ok then raise exception 'ÉCHEC : anon peut appeler hb_registre_depuis'; end if;
  -- Table du registre et lignes gardées fermées à la lecture directe.
  ok := false;
  begin
    perform set_config('test.uid', club, true);
    set local role authenticated;
    perform count(*) from public.hb_registre;
  exception when insufficient_privilege then ok := true;
  end;
  reset role;
  if not ok then raise exception 'ÉCHEC : hb_registre lisible directement'; end if;
  ok := false;
  begin
    perform set_config('test.uid', club, true);
    set local role authenticated;
    perform public.hb_registre_purger();
  exception when insufficient_privilege then ok := true;
  end;
  reset role;
  if not ok then raise exception 'ÉCHEC : un compte peut purger le registre'; end if;
  -- Sans connexion : refus.
  ok := false;
  begin
    perform set_config('test.uid', '', true);
    set local role authenticated;
    perform public.hb_registre_depuis(null);
  exception when others then ok := sqlerrm like 'Connexion requise%';
  end;
  reset role;
  if not ok then raise exception 'ÉCHEC : appel sans compte accepté'; end if;
  raise notice 'garde-fous : curseur illisible, du futur, d''avant le registre → pas complet ; anon, lecture directe, purge, sans compte → refusés';
end $$;

-- Signe de vie dans le même appel (comme hb_ping) : session créée pour un compte du staff, jamais pour le joueur.
do $$
begin
  perform essai.comme('00000000-0000-0000-0000-0000000000d1', $q$select public.hb_registre_depuis(null, '11111111-1111-1111-1111-111111111111', 'Android')$q$);
  perform essai.comme('00000000-0000-0000-0000-0000000000e1', $q$select public.hb_registre_depuis(null, '22222222-2222-2222-2222-222222222222', 'iPhone')$q$);
  if not exists (select 1 from public.hb_connections where session_id = '11111111-1111-1111-1111-111111111111' and device = 'Android') then
    raise exception 'ÉCHEC : signe de vie absent';
  end if;
  if exists (select 1 from public.hb_connections where session_id = '22222222-2222-2222-2222-222222222222') then
    raise exception 'ÉCHEC : signe de vie d''un compte joueur';
  end if;
  -- Une session d'un autre compte n'est jamais prolongée.
  perform essai.comme('00000000-0000-0000-0000-0000000000c1', $q$select public.hb_registre_depuis(null, '11111111-1111-1111-1111-111111111111', 'Pirate')$q$);
  if (select device from public.hb_connections where session_id = '11111111-1111-1111-1111-111111111111') <> 'Android' then
    raise exception 'ÉCHEC : session d''un autre compte modifiée';
  end if;
  raise notice 'signe de vie : session notée (staff), rien pour un joueur, jamais la session d''un autre';
end $$;

-- Purge : lignes vieillies, purge, l'ancien curseur n'est plus complet ; un curseur pris après l'est.
do $$
declare
  -- Curseur pris AVANT les écritures (leurs lignes du registre vont être effacées).
  vieux text := (select c from essai.curseurs where uid = '00000000-0000-0000-0000-0000000000d1');
  n integer;
  r jsonb;
begin
  update public.hb_registre set at = now() - interval '3 days';
  n := public.hb_registre_purger(interval '2 days', 1000000);
  if n = 0 or exists (select 1 from public.hb_registre where at < now() - interval '2 days') then raise exception 'ÉCHEC : purge incomplète'; end if;
  r := essai.comme('00000000-0000-0000-0000-0000000000d1', format('select public.hb_registre_depuis(%L)', vieux));
  if (r ->> 'complet')::boolean then raise exception 'ÉCHEC : curseur purgé encore complet'; end if;
  r := essai.comme('00000000-0000-0000-0000-0000000000d1', format('select public.hb_registre_depuis(%L)', r ->> 'c'));
  if not (r ->> 'complet')::boolean then raise exception 'ÉCHEC : curseur pris après la purge pas complet'; end if;
  raise notice 'purge : % lignes effacées, curseur antérieur → pas complet, curseur suivant → complet', n;
end $$;

-- Charge : annonce, lue dans la réponse ; échue : plus rien ; surveillance sans activité : calme.
do $$
declare r jsonb;
begin
  perform public.hb_annoncer_charge('sature', 120);
  r := essai.comme('00000000-0000-0000-0000-0000000000d1', 'select public.hb_registre_depuis(null)');
  if r -> 'k' ->> 'niveau' is distinct from 'sature' or (r -> 'k' ->> 'ttl')::int not between 100 and 120 then raise exception 'ÉCHEC : annonce absente : %', r; end if;
  if not exists (select 1 from realtime.messages where topic = 'hb:commun' and event = 'charge') then raise exception 'ÉCHEC : message « charge » pas envoyé'; end if;
  perform set_config('test.uid', '', true);
  perform public.hb_annoncer_charge('calme', 1);
  r := essai.comme('00000000-0000-0000-0000-0000000000d1', 'select public.hb_registre_depuis(null)');
  if r ? 'k' then raise exception 'ÉCHEC : annonce calme encore dans la réponse'; end if;
  perform set_config('test.uid', '', true);
  if public.hb_surveiller_charge() <> 'calme' then raise exception 'ÉCHEC : surveillance au repos pas calme'; end if;
  if public.hb_surveiller_charge(0, 0) <> 'sature' then raise exception 'ÉCHEC : surveillance à seuil nul pas saturée'; end if;
  -- Retour lent : sous le seuil, le niveau reste tant que p_retour_s n'est pas écoulé.
  if public.hb_surveiller_charge(0.99, 0.99, 3600) <> 'sature' then raise exception 'ÉCHEC : retour trop rapide'; end if;
  if public.hb_surveiller_charge(0.99, 0.99, 0) <> 'charge' then raise exception 'ÉCHEC : pas de retour d''un cran'; end if;
  perform public.hb_annoncer_charge('calme', 1);
  raise notice 'charge : annonce dans la réponse et sur hb:commun, calme la retire, surveillance (seuils, retour d''un cran) ok';
end $$;
