-- Essais de supabase/073_wellness.sql (lancer.sh) : comptes, fiches et groupes FICTIFS. Toute erreur arrête.
-- Réglage d'installation fermé : rien ne s'écrit ; ouvert : le jeune d'un groupe activé écrit SON wellness du jour (jamais
-- pour une autre fiche, jamais directement ; douleurs : une ligne par endroit, 1 à 8, toutes valables), ses séances
-- (aujourd'hui ou hier, durée obligatoire, 6 par jour) ; un jeune hors groupe activé,
-- hors périmètre du créateur, d'un groupe archivé ou d'un groupe privé d'observateur : refusé ; groupe Pôle : membres par la
-- période de pôle. Lecture : le jeune les siennes ; le staff du groupe (créateur, participant) s'il lit la fiche ;
-- administrateurs ; jamais un autre coach, un observateur ou anon. hb_upsert garde la clé « wellness » (créateur seul).
-- Fusion, effacement RGPD, suppression, purge de fin de saison.
\set ON_ERROR_STOP 1
create schema if not exists essai;

-- ---------- Comptes ----------
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'admin@exemple.test'),
  ('00000000-0000-0000-0000-0000000000c1', 'coach-groupe@exemple.test'),
  ('00000000-0000-0000-0000-0000000000c2', 'participant@exemple.test'),
  ('00000000-0000-0000-0000-0000000000c3', 'coach13@exemple.test'),
  ('00000000-0000-0000-0000-0000000000c4', 'autre-coach83@exemple.test'),
  ('00000000-0000-0000-0000-0000000000d2', 'observateur@exemple.test'),
  ('00000000-0000-0000-0000-0000000000e1', 'jeune1@exemple.test'),
  ('00000000-0000-0000-0000-0000000000e2', 'jeune2@exemple.test'),
  ('00000000-0000-0000-0000-0000000000e3', 'jeune3@exemple.test'),
  ('00000000-0000-0000-0000-0000000000e4', 'jeune4@exemple.test'),
  ('00000000-0000-0000-0000-0000000000e5', 'jeune5@exemple.test'),
  ('00000000-0000-0000-0000-0000000000e6', 'jeune6@exemple.test'),
  ('00000000-0000-0000-0000-0000000000e9', 'sans-fiche@exemple.test')
on conflict do nothing;
insert into public.hb_profiles (user_id, email, role) values
  ('00000000-0000-0000-0000-0000000000a1', 'admin@exemple.test', 'admin'),
  ('00000000-0000-0000-0000-0000000000c1', 'coach-groupe@exemple.test', 'preparateur'),
  ('00000000-0000-0000-0000-0000000000c2', 'participant@exemple.test', 'preparateur'),
  ('00000000-0000-0000-0000-0000000000c3', 'coach13@exemple.test', 'preparateur'),
  ('00000000-0000-0000-0000-0000000000c4', 'autre-coach83@exemple.test', 'preparateur'),
  ('00000000-0000-0000-0000-0000000000d2', 'observateur@exemple.test', 'observateur'),
  ('00000000-0000-0000-0000-0000000000e1', 'jeune1@exemple.test', 'joueur'),
  ('00000000-0000-0000-0000-0000000000e2', 'jeune2@exemple.test', 'joueur'),
  ('00000000-0000-0000-0000-0000000000e3', 'jeune3@exemple.test', 'joueur'),
  ('00000000-0000-0000-0000-0000000000e4', 'jeune4@exemple.test', 'joueur'),
  ('00000000-0000-0000-0000-0000000000e5', 'jeune5@exemple.test', 'joueur'),
  ('00000000-0000-0000-0000-0000000000e6', 'jeune6@exemple.test', 'joueur'),
  ('00000000-0000-0000-0000-0000000000e9', 'sans-fiche@exemple.test', 'joueur')
on conflict (user_id) do update set role = excluded.role;
update public.hb_profiles set player_id = 'j-' || right(user_id::text, 1)
 where user_id::text in ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000e3',
                         '00000000-0000-0000-0000-0000000000e4', '00000000-0000-0000-0000-0000000000e5', '00000000-0000-0000-0000-0000000000e6');

-- Structure fictive : ligue (13, 83) → comité du 83, comité du 13, pôle fictif (sans territoire : celui de la ligue, 047).
insert into public.hb_units (id, data) values
  ('ligue-sud', '{"id":"ligue-sud","levelId":"niveau-ligue","name":"Ligue fictive","departments":["13","83"]}'),
  ('unite-83', '{"id":"unite-83","levelId":"niveau-comite","name":"Comité fictif 83","parentId":"ligue-sud","departments":["83"]}'),
  ('unite-13', '{"id":"unite-13","levelId":"niveau-comite","name":"Comité fictif 13","parentId":"ligue-sud","departments":["13"]}'),
  ('pole-x', '{"id":"pole-x","levelId":"niveau-pole","name":"Pôle Fictif-sur-Mer (garçons)","parentId":"ligue-sud","poleSite":"Fictif-sur-Mer","poleSex":"M"}');
insert into public.hb_assignments (id, data) values
  ('aff-c1', '{"id":"aff-c1","userId":"00000000-0000-0000-0000-0000000000c1","unitId":"unite-83","role":"preparateur"}'),
  ('aff-c2', '{"id":"aff-c2","userId":"00000000-0000-0000-0000-0000000000c2","unitId":"unite-83","role":"preparateur"}'),
  ('aff-c3', '{"id":"aff-c3","userId":"00000000-0000-0000-0000-0000000000c3","unitId":"unite-13","role":"preparateur"}'),
  ('aff-c4', '{"id":"aff-c4","userId":"00000000-0000-0000-0000-0000000000c4","unitId":"unite-83","role":"preparateur"}'),
  ('aff-d2', '{"id":"aff-d2","userId":"00000000-0000-0000-0000-0000000000d2","unitId":"unite-83","role":"observateur"}');

-- Fiches : j-1, j-2, j-4, j-5, j-6 dans le 83 ; j-3 dans le 13. j-4 : au pôle fictif depuis la rentrée (site écrit autrement).
insert into public.hb_players (id, data) values
  ('j-1', '{"id":"j-1","firstName":"Prénom","lastName":"Fictif Un","clubCode":"6383015","sex":"M"}'),
  ('j-2', '{"id":"j-2","firstName":"Prénom","lastName":"Fictif Deux","clubCode":"6383015","sex":"F"}'),
  ('j-3', '{"id":"j-3","firstName":"Prénom","lastName":"Fictif Trois","clubCode":"6313001","sex":"M"}'),
  ('j-5', '{"id":"j-5","firstName":"Prénom","lastName":"Fictif Cinq","clubCode":"6383020","sex":"M"}'),
  ('j-6', '{"id":"j-6","firstName":"Prénom","lastName":"Fictif Six","clubCode":"6383020","sex":"M"}');
insert into public.hb_players (id, data)
select 'j-4', jsonb_build_object('id', 'j-4', 'firstName', 'Prénom', 'lastName', 'Fictif Quatre', 'clubCode', '6383020', 'sex', 'M',
         'poles', jsonb_build_array(jsonb_build_object('site', 'FICTIF SUR MER', 'regionId', 'region-fictive', 'from', to_char((now() at time zone 'Europe/Paris')::date - 60, 'YYYY-MM-DD'))));

-- Groupes : G1 (c1, participant c2, wellness) avec j-1, j-2, j-3 (j-3 hors du périmètre de c1) ; G2 (c1, sans wellness)
-- avec j-5 ; G3 (archivé, wellness) avec j-5 ; GD (privé d'un observateur, wellness) avec j-6 ; GP (groupe Pôle, c1, wellness).
insert into public.hb_groups (id, data) values
  ('g1', '{"id":"g1","name":"Groupe fictif","createdBy":"00000000-0000-0000-0000-0000000000c1","editors":["00000000-0000-0000-0000-0000000000c2"],"playerIds":["j-1","j-2","j-3"],"wellness":true}'),
  ('g2', '{"id":"g2","name":"Groupe sans wellness","createdBy":"00000000-0000-0000-0000-0000000000c1","playerIds":["j-5"]}'),
  ('g3', '{"id":"g3","name":"Groupe archivé","createdBy":"00000000-0000-0000-0000-0000000000c1","playerIds":["j-5"],"wellness":true,"archived":true}'),
  ('gd', '{"id":"gd","name":"Groupe privé d''un observateur","createdBy":"00000000-0000-0000-0000-0000000000d2","private":true,"playerIds":["j-6"],"wellness":true}'),
  ('gp', '{"id":"gp","name":"Pôle fictif","createdBy":"00000000-0000-0000-0000-0000000000c1","playerIds":[],"poleUnitId":"pole-x","wellness":true}');

create temporary table jours as select (now() at time zone 'Europe/Paris')::date as auj;
grant select on jours to authenticated;

-- Exécute p_sql comme le compte p_uid (rôle authenticated ; null : anon) ; rend le nombre de lignes, ou « ERR code message ».
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
    perform set_config('test.uid', '', true);
    return 'ERR ' || sqlstate || ' ' || sqlerrm;
  end;
  reset role;
  -- Les écritures directes qui suivent (propriétaire) ne sont plus faites « comme » ce compte.
  perform set_config('test.uid', '', true);
  return n::text;
end $$;

-- Valeur d'une expression calculée comme le compte p_uid (texte ; « ERR code message » si refus).
create or replace function essai.vu(p_uid text, p_sql text) returns text
language plpgsql as $$
declare v text;
begin
  perform set_config('test.uid', coalesce(p_uid, ''), true);
  if p_uid is null then set local role anon; else set local role authenticated; end if;
  begin
    execute p_sql into v;
  exception when others then
    reset role;
    perform set_config('test.uid', '', true);
    return 'ERR ' || sqlstate || ' ' || sqlerrm;
  end;
  reset role;
  -- Les écritures directes qui suivent (propriétaire) ne sont plus faites « comme » ce compte.
  perform set_config('test.uid', '', true);
  return v;
end $$;
grant usage on schema essai to anon, authenticated;
grant execute on all functions in schema essai to anon, authenticated;

create or replace function essai.attendu(p_quoi text, p_vu text, p_attendu text) returns void
language plpgsql as $$
begin
  if p_vu is distinct from p_attendu then raise exception 'ÉCHEC % : % au lieu de %', p_quoi, p_vu, p_attendu; end if;
  raise notice 'ok : %', p_quoi;
end $$;

do $$
declare
  a1 text := '00000000-0000-0000-0000-0000000000a1';
  c1 text := '00000000-0000-0000-0000-0000000000c1';
  c2 text := '00000000-0000-0000-0000-0000000000c2';
  c3 text := '00000000-0000-0000-0000-0000000000c3';
  c4 text := '00000000-0000-0000-0000-0000000000c4';
  d2 text := '00000000-0000-0000-0000-0000000000d2';
  e1 text := '00000000-0000-0000-0000-0000000000e1';
  e2 text := '00000000-0000-0000-0000-0000000000e2';
  e3 text := '00000000-0000-0000-0000-0000000000e3';
  e4 text := '00000000-0000-0000-0000-0000000000e4';
  e5 text := '00000000-0000-0000-0000-0000000000e5';
  e6 text := '00000000-0000-0000-0000-0000000000e6';
  e9 text := '00000000-0000-0000-0000-0000000000e9';
  ecrire text := 'select public.hb_wellness_enregistrer(%L::jsonb)::text';
  seance text := 'select public.hb_wellness_seance(%L, %s, %s, %L)::text';
  moi text := 'select public.hb_wellness_moi(28)::text';
  auj date := (select j.auj from jours j);
  sid text;
  sid2 text;
  -- Horodatage des écritures hb_upsert : après tout ce qui est déjà en base (hb_touch date les lignes à l'horloge du serveur).
  t0 bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
begin
  -- ---------- Installation fermée ----------
  perform essai.attendu('réglage d''installation absent : fermé', (select public.hb_wellness_actif()::text), 'false');
  perform essai.attendu('fermé : le jeune ne peut pas écrire', essai.vu(e1, format(ecrire, '{"scores":{"energie":7}}')), 'ERR P0001 wellness_ferme');
  perform essai.attendu('fermé : ni une séance', essai.vu(e1, format(seance, auj, 6, 60, '')), 'ERR P0001 wellness_ferme');
  perform essai.attendu('fermé : rien n''est demandé', essai.vu(e1, 'select public.hb_wellness_moi(28) ->> ''demande'''), 'false');
  -- Réglage posé mais pas à true : toujours fermé.
  insert into public.hb_config (id, data) values ('wellness', '{"id":"wellness","key":"wellness","value":{"actif":"oui"}}');
  perform essai.attendu('actif = « oui » : fermé (true seulement)', (select public.hb_wellness_actif()::text), 'false');
  update public.hb_config set data = '{"id":"wellness","key":"wellness","value":{"actif":true}}' where id = 'wellness';
  perform essai.attendu('ouvert à la main', (select public.hb_wellness_actif()::text), 'true');

  -- ---------- Qui est concerné ----------
  perform essai.attendu('jeune 1 (groupe activé) : demandé', essai.vu(e1, 'select public.hb_wellness_moi(28) ->> ''demande'''), 'true');
  perform essai.attendu('jeune 3 (groupe activé, mais hors du périmètre de son créateur) : pas demandé', essai.vu(e3, 'select public.hb_wellness_moi(28) ->> ''demande'''), 'false');
  perform essai.attendu('jeune 5 (groupe sans wellness, groupe archivé) : pas demandé', essai.vu(e5, 'select public.hb_wellness_moi(28) ->> ''demande'''), 'false');
  perform essai.attendu('jeune 6 (groupe privé d''un observateur) : pas demandé', essai.vu(e6, 'select public.hb_wellness_moi(28) ->> ''demande'''), 'false');
  perform essai.attendu('jeune 4 (groupe Pôle : période en cours, site écrit autrement) : demandé', essai.vu(e4, 'select public.hb_wellness_moi(28) ->> ''demande'''), 'true');
  perform essai.attendu('compte joueur sans fiche : refusé', essai.vu(e9, moi), 'ERR P0001 sans_fiche');
  perform essai.attendu('staff : pas une fonction pour lui', essai.vu(c1, moi), 'ERR P0001 pas_joueur');
  perform essai.attendu('anon : refusé', essai.vu(null, moi), 'ERR 42501 permission denied for function hb_wellness_moi');

  -- ---------- Le jeune écrit SON wellness du jour ----------
  perform essai.attendu('jeune 1 : son wellness du jour (valeurs nettoyées)',
    essai.vu(e1, format(ecrire, '{"playerId":"j-2","scores":{"energie":7,"fraicheur":11,"humeur":"8","sommeil":6,"bidule":3},"pain":true,"pains":[{"zone":"quadriceps","cote":"d","type":"courbatures","intensite":3,"bidule":1},{"zone":"ischios","cote":"d","type":"contracture","texte":"  en\u0007 sprint  ","intensite":6},{"zone":"lombaires","cote":null,"type":"gene","intensite":2}]}')),
    (select jsonb_build_object('playerId', 'j-1', 'day', to_char(auj, 'YYYY-MM-DD'), 'scores', '{"energie":7,"sommeil":6}'::jsonb, 'pain', true,
                               'pains', '[{"zone":"quadriceps","cote":"d","type":"courbatures","intensite":3},{"zone":"ischios","cote":"d","type":"contracture","texte":"en sprint","intensite":6},{"zone":"lombaires","type":"gene","intensite":2}]'::jsonb,
                               'at', public.hb_self_iso(now()))::text));
  perform essai.attendu('… une ligne, sur SA fiche (le playerId envoyé est ignoré), compte noté',
    (select string_agg(player_id || ' ' || (user_id::text = e1)::text, ';') from public.hb_wellness), 'j-1 true');
  perform essai.attendu('modifiable le jour même (une seule ligne par jour), sans douleur : lignes envoyées ignorées',
    essai.comme(e1, format(ecrire, '{"scores":{"energie":8,"fraicheur":7,"humeur":9,"sommeil":7},"pain":false,"pains":[{"zone":"genou","cote":"g","type":"gene","intensite":3}]}')), '1');
  perform essai.attendu('… toujours une ligne, nouvelle version',
    (select count(*) || ' ' || max(scores::text) || ' ' || bool_or(douleur)::text || ' ' || max(douleurs::text) from public.hb_wellness),
    '1 {"humeur": 9, "energie": 8, "sommeil": 7, "fraicheur": 7} false []');
  perform essai.attendu('rien de valable : refusé', essai.vu(e1, format(ecrire, '{"scores":{"energie":0,"bidule":5}}')), 'ERR P0001 valeurs');
  -- Douleurs : la moindre ligne abîmée refuse tout (jamais une douleur à moitié gardée).
  perform essai.attendu('douleur sans ligne : refusée', essai.vu(e1, format(ecrire, '{"scores":{"energie":5},"pain":true}')), 'ERR P0001 douleurs');
  perform essai.attendu('douleur, lignes vides : refusée', essai.vu(e1, format(ecrire, '{"scores":{"energie":5},"pain":true,"pains":[]}')), 'ERR P0001 douleurs');
  perform essai.attendu('endroit inconnu : refusé', essai.vu(e1, format(ecrire, '{"pain":true,"pains":[{"zone":"f-genou-g","type":"gene","intensite":3}]}')), 'ERR P0001 douleurs');
  perform essai.attendu('endroit pair sans côté : refusé', essai.vu(e1, format(ecrire, '{"pain":true,"pains":[{"zone":"ischios","type":"gene","intensite":3}]}')), 'ERR P0001 douleurs');
  perform essai.attendu('côté inconnu : refusé', essai.vu(e1, format(ecrire, '{"pain":true,"pains":[{"zone":"ischios","cote":"droite","type":"gene","intensite":3}]}')), 'ERR P0001 douleurs');
  perform essai.attendu('côté sur un endroit sans côté : refusé', essai.vu(e1, format(ecrire, '{"pain":true,"pains":[{"zone":"lombaires","cote":"g","type":"gene","intensite":3}]}')), 'ERR P0001 douleurs');
  perform essai.attendu('type inconnu : refusé', essai.vu(e1, format(ecrire, '{"pain":true,"pains":[{"zone":"tete","type":"blessure","intensite":3}]}')), 'ERR P0001 douleurs');
  perform essai.attendu('type absent : refusé', essai.vu(e1, format(ecrire, '{"pain":true,"pains":[{"zone":"tete","intensite":3}]}')), 'ERR P0001 douleurs');
  perform essai.attendu('intensité 11 : refusée', essai.vu(e1, format(ecrire, '{"pain":true,"pains":[{"zone":"tete","type":"coup","intensite":11}]}')), 'ERR P0001 douleurs');
  perform essai.attendu('intensité en texte : refusée', essai.vu(e1, format(ecrire, '{"pain":true,"pains":[{"zone":"tete","type":"coup","intensite":"5"}]}')), 'ERR P0001 douleurs');
  perform essai.attendu('intensité absente : refusée', essai.vu(e1, format(ecrire, '{"pain":true,"pains":[{"zone":"tete","type":"coup"}]}')), 'ERR P0001 douleurs');
  perform essai.attendu('même endroit et côté deux fois : refusé', essai.vu(e1, format(ecrire, '{"pain":true,"pains":[{"zone":"genou","cote":"g","type":"gene","intensite":3},{"zone":"genou","cote":"g","type":"douleur","intensite":5}]}')), 'ERR P0001 douleurs');
  perform essai.attendu('autre endroit sans texte : refusé', essai.vu(e1, format(ecrire, '{"pain":true,"pains":[{"zone":"autre","type":"gene","intensite":3,"texte":"   "}]}')), 'ERR P0001 douleurs');
  perform essai.attendu('texte qui n''est pas du texte : refusé', essai.vu(e1, format(ecrire, '{"pain":true,"pains":[{"zone":"tete","type":"coup","intensite":3,"texte":12}]}')), 'ERR P0001 douleurs');
  perform essai.attendu('pas un tableau : refusé', essai.vu(e1, format(ecrire, '{"pain":true,"pains":{"zone":"tete","type":"coup","intensite":3}}')), 'ERR P0001 douleurs');
  perform essai.attendu('9 endroits : refusé (8 au plus)', essai.vu(e1, format(ecrire, json_build_object('pain', true, 'pains',
    (select json_agg(json_build_object('zone', z, 'cote', 'g', 'type', 'gene', 'intensite', 2)) from unnest(array['epaule', 'bras', 'coude', 'poignet', 'main', 'hanche', 'aine', 'fessiers', 'quadriceps']) z)))), 'ERR P0001 douleurs');
  perform essai.attendu('8 endroits : accepté', essai.comme(e2, format(ecrire, json_build_object('pain', true, 'pains',
    (select json_agg(json_build_object('zone', z, 'cote', 'g', 'type', 'gene', 'intensite', 2)) from unnest(array['epaule', 'bras', 'coude', 'poignet', 'main', 'hanche', 'aine', 'fessiers']) z)))), '1');
  perform essai.attendu('les deux côtés d''un même endroit : deux lignes', essai.comme(e2, format(ecrire, '{"pain":true,"pains":[{"zone":"quadriceps","cote":"d","type":"courbatures","intensite":3},{"zone":"quadriceps","cote":"g","type":"courbatures","intensite":3}]}')), '1');
  perform essai.attendu('… gardées dans l''ordre', (select jsonb_path_query_array(douleurs, '$[*].cote')::text from public.hb_wellness where player_id = 'j-2'), '["d", "g"]');
  perform essai.attendu('douleur seule (autre endroit écrit) : acceptée', essai.comme(e2, format(ecrire, '{"pain":true,"pains":[{"zone":"autre","type":"gene","texte":"Côtes à droite","intensite":2}]}')), '1');
  perform essai.attendu('entrée trop longue : refusée', essai.vu(e1, format(ecrire, json_build_object('scores', json_build_object('energie', 5), 'pains', json_build_array(json_build_object('zone', 'autre', 'texte', repeat('x', 5000)))))), 'ERR P0001 trop_long');
  perform essai.attendu('texte coupé à 80', essai.comme(e2, format(ecrire, json_build_object('pain', true, 'pains', json_build_array(json_build_object('zone', 'autre', 'type', 'autre', 'intensite', 4, 'texte', repeat('é', 300)))))), '1');
  perform essai.attendu('… 80', (select length(douleurs -> 0 ->> 'texte')::text from public.hb_wellness where player_id = 'j-2'), '80');
  perform essai.attendu('jeune 3 (pas demandé) : refusé', essai.vu(e3, format(ecrire, '{"scores":{"energie":5}}')), 'ERR P0001 pas_demande');
  perform essai.attendu('jeune 6 (groupe privé d''observateur) : refusé', essai.vu(e6, format(ecrire, '{"scores":{"energie":5}}')), 'ERR P0001 pas_demande');
  perform essai.attendu('jeune 4 (groupe Pôle) : accepté', essai.comme(e4, format(ecrire, '{"scores":{"energie":6,"humeur":7}}')), '1');
  perform essai.attendu('staff : refusé (il n''en écrit jamais)', essai.vu(c1, format(ecrire, '{"scores":{"energie":5}}')), 'ERR P0001 pas_joueur');
  perform essai.attendu('administrateur : refusé aussi', essai.vu(a1, format(ecrire, '{"scores":{"energie":5}}')), 'ERR P0001 pas_joueur');
  perform essai.attendu('anon : refusé', essai.vu(null, format(ecrire, '{"scores":{"energie":5}}')), 'ERR 42501 permission denied for function hb_wellness_enregistrer');

  -- ---------- Aucune écriture directe (jamais pour une autre fiche) ----------
  perform essai.attendu('jeune : insertion directe pour une autre fiche refusée',
    essai.comme(e1, $q$insert into public.hb_wellness (player_id, jour, scores) values ('j-2', current_date - 1, '{"energie":5}')$q$), 'ERR 42501 permission denied for table hb_wellness');
  perform essai.attendu('jeune : modification directe refusée', essai.comme(e1, $q$update public.hb_wellness set scores = '{"energie":1}'$q$), 'ERR 42501 permission denied for table hb_wellness');
  perform essai.attendu('jeune : suppression directe refusée', essai.comme(e1, $q$delete from public.hb_wellness$q$), 'ERR 42501 permission denied for table hb_wellness');
  perform essai.attendu('jeune : séance directe refusée', essai.comme(e1, $q$insert into public.hb_wellness_seances (player_id, jour, rpe) values ('j-2', current_date, 5)$q$), 'ERR 42501 permission denied for table hb_wellness_seances');
  perform essai.attendu('staff : modification directe refusée', essai.comme(c1, $q$update public.hb_wellness set scores = '{"energie":1}'$q$), 'ERR 42501 permission denied for table hb_wellness');
  perform essai.attendu('administrateur : insertion directe refusée', essai.comme(a1, $q$insert into public.hb_wellness (player_id, jour, scores) values ('j-1', current_date - 3, '{"energie":5}')$q$), 'ERR 42501 permission denied for table hb_wellness');

  -- ---------- « Ma séance » ----------
  sid := essai.vu(e1, format('select public.hb_wellness_seance(%L, 7, 90, null) ->> ''id''', auj));
  perform essai.attendu('séance d''aujourd''hui (RPE 7, 90 min)', (select rpe || ' ' || duree || ' ' || player_id from public.hb_wellness_seances where id::text = sid), '7 90 j-1');
  perform essai.attendu('séance sans durée : refusée (durée obligatoire)', essai.vu(e1, format(seance, auj - 1, 5, 'null', '')), 'ERR P0001 valeurs');
  perform essai.attendu('séance sans le paramètre de durée : fonction inconnue', essai.vu(e1, format('select public.hb_wellness_seance(%L, 5)::text', auj - 1)), 'ERR 42883 function public.hb_wellness_seance(unknown, integer) does not exist');
  perform essai.attendu('séance d''hier (60 min)', essai.comme(e1, format('select public.hb_wellness_seance(%L, 5, 60, null)', auj - 1)), '1');
  perform essai.attendu('il y a deux jours : fermé', essai.vu(e1, format(seance, auj - 2, 5, 'null', '')), 'ERR P0001 jour_ferme');
  perform essai.attendu('demain : fermé', essai.vu(e1, format(seance, auj + 1, 5, 'null', '')), 'ERR P0001 jour_ferme');
  perform essai.attendu('jour illisible : fermé', essai.vu(e1, format(seance, '2026-02-31', 5, 'null', '')), 'ERR P0001 jour_ferme');
  perform essai.attendu('RPE 11 : refusé', essai.vu(e1, format(seance, auj, 11, 60, '')), 'ERR P0001 valeurs');
  perform essai.attendu('durée 0 : refusée', essai.vu(e1, format(seance, auj, 5, 0, '')), 'ERR P0001 valeurs');
  perform essai.attendu('durée 601 : refusée', essai.vu(e1, format(seance, auj, 5, 601, '')), 'ERR P0001 valeurs');
  perform essai.attendu('modifier la sienne par son identifiant', essai.comme(e1, format('select public.hb_wellness_seance(%L, 8, 75, %L)', auj, sid)), '1');
  perform essai.attendu('… une seule ligne modifiée', (select count(*) || ' ' || max(rpe) || ' ' || max(duree) from public.hb_wellness_seances where id::text = sid), '1 8 75');
  perform essai.attendu('modifier sans durée : refusé', essai.vu(e1, format(seance, auj, 8, 'null', sid)), 'ERR P0001 valeurs');
  perform essai.attendu('jeune 2 : modifier celle du jeune 1 : inconnue', essai.vu(e2, format(seance, auj, 3, 60, sid)), 'ERR P0001 seance_inconnue');
  perform essai.attendu('… celle du jeune 1 intacte', (select rpe::text from public.hb_wellness_seances where id::text = sid), '8');
  perform essai.attendu('plusieurs séances le même jour (jusqu''à 6)',
    essai.vu(e1, format('select count(public.hb_wellness_seance(%L, 4, 30, null)) from generate_series(1, 5)', auj)), '5');
  perform essai.attendu('7e séance du jour : refusée', essai.vu(e1, format(seance, auj, 4, 30, '')), 'ERR P0001 trop');
  perform essai.attendu('jeune 2 : retirer celle du jeune 1 : inconnue', essai.vu(e2, format('select public.hb_wellness_seance_retirer(%L)::text', sid)), 'ERR P0001 seance_inconnue');
  perform essai.attendu('jeune 1 : retirer la sienne', essai.vu(e1, format('select public.hb_wellness_seance_retirer(%L)::text', sid)), 'true');
  perform essai.attendu('… séances du jeune 1 (aujourd''hui 5, hier 1)', (select string_agg(jour - auj || '=' || n, ',' order by jour) from (select jour, count(*) n from public.hb_wellness_seances group by jour) s), '-1=1,0=5');
  perform essai.attendu('jeune 2 : une séance', essai.comme(e2, format('select public.hb_wellness_seance(%L, 6, 60, null)', auj)), '1');
  -- Une séance d'il y a trois jours (écrite par le propriétaire) : ni modifiable ni retirable par le jeune.
  insert into public.hb_wellness_seances (player_id, jour, rpe, duree) values ('j-1', auj - 3, 5, 45) returning id::text into sid2;
  perform essai.attendu('séance d''il y a trois jours : plus modifiable', essai.vu(e1, format(seance, auj, 5, 45, sid2)), 'ERR P0001 seance_inconnue');
  perform essai.attendu('… ni retirable', essai.vu(e1, format('select public.hb_wellness_seance_retirer(%L)::text', sid2)), 'ERR P0001 jour_ferme');

  -- ---------- Lecture ----------
  perform essai.attendu('jeune 1 : lit les siennes', essai.comme(e1, 'select * from public.hb_wellness'), '1');
  perform essai.attendu('jeune 1 : pas celles du jeune 2', essai.comme(e1, $q$select * from public.hb_wellness where player_id = 'j-2'$q$), '0');
  perform essai.attendu('jeune 1 : ses séances seulement', essai.comme(e1, 'select * from public.hb_wellness_seances'), '7');
  perform essai.attendu('jeune 1 : hb_wellness_moi (1 jour, 6 séances des 28 derniers jours… et celle d''il y a 3 jours : 7)',
    essai.vu(e1, 'select jsonb_array_length(x -> ''jours'') || '' '' || jsonb_array_length(x -> ''seances'') from public.hb_wellness_moi(28) x'), '1 7');
  perform essai.attendu('administrateur : tout', essai.comme(a1, 'select * from public.hb_wellness'), '3');
  perform essai.attendu('créateur du groupe (encadrant, 83) : j-1, j-2 et j-4 (groupe Pôle)', essai.vu(c1, 'select string_agg(player_id, '','' order by player_id) from public.hb_wellness'), 'j-1,j-2,j-4');
  perform essai.attendu('participant du groupe (encadrant, 83) : j-1 et j-2', essai.vu(c2, 'select string_agg(player_id, '','' order by player_id) from public.hb_wellness'), 'j-1,j-2');
  perform essai.attendu('participant : leurs séances', essai.comme(c2, 'select * from public.hb_wellness_seances'), '8');
  perform essai.attendu('autre coach du même comité (pas du staff du groupe) : rien', essai.comme(c4, 'select * from public.hb_wellness'), '0');
  perform essai.attendu('… ni les séances', essai.comme(c4, 'select * from public.hb_wellness_seances'), '0');
  perform essai.attendu('coach d''un autre comité : rien', essai.comme(c3, 'select * from public.hb_wellness'), '0');
  perform essai.attendu('observateur (même comité) : rien', essai.comme(d2, 'select * from public.hb_wellness'), '0');
  perform essai.attendu('anon : refusé', essai.comme(null, 'select * from public.hb_wellness'), 'ERR 42501 permission denied for table hb_wellness');

  -- ---------- Tableau du staff (hb_wellness_groupe) ----------
  perform essai.attendu('créateur : groupe G1 (comptes j-1, j-2 ; j-3 hors de son périmètre)',
    essai.vu(c1, 'select (x -> ''comptes'')::text || '' '' || jsonb_array_length(x -> ''jours'') || '' '' || jsonb_array_length(x -> ''seances'') || '' '' || (x ->> ''wellness'') from public.hb_wellness_groupe(''g1'', 35) x'),
    '["j-1", "j-2"] 2 8 true');
  perform essai.attendu('participant : même tableau', essai.vu(c2, 'select (x -> ''comptes'')::text from public.hb_wellness_groupe(''g1'', 35) x'), '["j-1", "j-2"]');
  perform essai.attendu('administrateur : même tableau', essai.vu(a1, 'select (x -> ''comptes'')::text from public.hb_wellness_groupe(''g1'', 35) x'), '["j-1", "j-2"]');
  perform essai.attendu('créateur : groupe Pôle (j-4 par sa période de pôle)', essai.vu(c1, 'select (x -> ''comptes'')::text || '' '' || jsonb_array_length(x -> ''jours'') from public.hb_wellness_groupe(''gp'', 35) x'), '["j-4"] 1');
  perform essai.attendu('autre coach : refusé (sans rien dire du groupe)', essai.vu(c4, 'select public.hb_wellness_groupe(''g1'', 35)::text'), 'ERR P0001 groupe_inconnu');
  perform essai.attendu('observateur : refusé', essai.vu(d2, 'select public.hb_wellness_groupe(''g1'', 35)::text'), 'ERR P0001 groupe_inconnu');
  perform essai.attendu('jeune : refusé', essai.vu(e1, 'select public.hb_wellness_groupe(''g1'', 35)::text'), 'ERR P0001 groupe_inconnu');
  perform essai.attendu('groupe inconnu : refusé', essai.vu(c1, 'select public.hb_wellness_groupe(''nimporte'', 35)::text'), 'ERR P0001 groupe_inconnu');
  perform essai.attendu('groupe sans wellness : vide', essai.vu(c1, 'select (x -> ''comptes'')::text || '' '' || (x ->> ''wellness'') from public.hb_wellness_groupe(''g2'', 35) x'), '[] false');
  perform essai.attendu('anon : refusé', essai.vu(null, 'select public.hb_wellness_groupe(''g1'', 35)::text'), 'ERR 42501 permission denied for function hb_wellness_groupe');
  perform essai.attendu('rien de personnel dans le tableau (ni nom, ni club)', essai.vu(c1, 'select public.hb_wellness_groupe(''g1'', 35)::text ~* ''fictif|6383|prénom'''), 'false');

  -- ---------- Le groupe désactivé : plus demandé, plus lu par son staff (l'administrateur garde l'accès) ----------
  update public.hb_groups set data = data || '{"wellness":false}' where id = 'g1';
  perform essai.attendu('groupe désactivé : jeune 1 plus demandé', essai.vu(e1, format(ecrire, '{"scores":{"energie":5}}')), 'ERR P0001 pas_demande');
  perform essai.attendu('… mais il lit toujours les siennes', essai.comme(e1, 'select * from public.hb_wellness'), '1');
  perform essai.attendu('… son staff ne les lit plus', essai.comme(c2, 'select * from public.hb_wellness'), '0');
  update public.hb_groups set data = data || '{"wellness":true}' where id = 'g1';
  -- Le créateur perd son rôle d'encadrant : le groupe ne compte plus.
  update public.hb_profiles set role = 'observateur' where user_id::text = c1;
  perform essai.attendu('créateur devenu observateur : le groupe ne compte plus', essai.vu(e2, format(ecrire, '{"scores":{"energie":5}}')), 'ERR P0001 pas_demande');
  update public.hb_profiles set role = 'preparateur' where user_id::text = c1;

  -- ---------- hb_upsert (inchangé) garde la clé « wellness » : créateur seul ----------
  perform essai.attendu('participant : désactiver par hb_upsert est ignoré', essai.vu(c2, format($q$select public.hb_upsert('groups', '[{"id":"g1","data":{"id":"g1","name":"Groupe fictif","createdBy":"00000000-0000-0000-0000-0000000000c1","editors":["00000000-0000-0000-0000-0000000000c2"],"playerIds":["j-1","j-2","j-3"],"wellness":false,"updatedAt":%s},"updated_at_client":%s,"deleted":false}]'::jsonb)::text$q$, t0 + 9, t0 + 9)), '[]');
  perform essai.attendu('… clé du groupe ensuite', ((select data -> 'wellness' from public.hb_groups where id = 'g1') = 'true'::jsonb)::text, 'true');
  perform essai.attendu('autre coach : refusé par hb_upsert, la clé reste', essai.vu(c4, format($q$select public.hb_upsert('groups', '[{"id":"g1","data":{"id":"g1","name":"Groupe fictif","createdBy":"00000000-0000-0000-0000-0000000000c1","playerIds":["j-1"],"updatedAt":%s},"updated_at_client":%s,"deleted":false}]'::jsonb)::text$q$, t0 + 10, t0 + 10)), '["g1"]');
  perform essai.attendu('… clé du groupe ensuite', ((select data -> 'wellness' from public.hb_groups where id = 'g1') = 'true'::jsonb)::text, 'true');
  perform essai.attendu('créateur : désactive par hb_upsert', essai.vu(c1, format($q$select public.hb_upsert('groups', '[{"id":"g1","data":{"id":"g1","name":"Groupe fictif","createdBy":"00000000-0000-0000-0000-0000000000c1","editors":["00000000-0000-0000-0000-0000000000c2"],"playerIds":["j-1","j-2","j-3"],"wellness":false,"updatedAt":%s},"updated_at_client":%s,"deleted":false}]'::jsonb)::text$q$, t0 + 11, t0 + 11)), '[]');
  perform essai.attendu('… clé du groupe ensuite', ((select data -> 'wellness' from public.hb_groups where id = 'g1') = 'false'::jsonb)::text, 'true');
  perform essai.attendu('créateur : réactive par hb_upsert (avec la date)', essai.vu(c1, format($q$select public.hb_upsert('groups', '[{"id":"g1","data":{"id":"g1","name":"Groupe fictif","createdBy":"00000000-0000-0000-0000-0000000000c1","editors":["00000000-0000-0000-0000-0000000000c2"],"playerIds":["j-1","j-2","j-3"],"wellness":true,"wellnessSince":"2026-11-02","updatedAt":%s},"updated_at_client":%s,"deleted":false}]'::jsonb)::text$q$, t0 + 12, t0 + 12)), '[]');
  perform essai.attendu('… clé du groupe ensuite', ((select data ->> 'wellnessSince' from public.hb_groups where id = 'g1') = '2026-11-02')::text, 'true');

  -- ---------- Installation refermée : plus d'écriture, la lecture reste ----------
  update public.hb_config set data = '{"id":"wellness","key":"wellness","value":{"actif":false}}' where id = 'wellness';
  perform essai.attendu('refermé : écriture refusée', essai.vu(e1, format(ecrire, '{"scores":{"energie":5}}')), 'ERR P0001 wellness_ferme');
  perform essai.attendu('refermé : retirer une séance reste permis', essai.vu(e2, format('select public.hb_wellness_seance_retirer((select id::text from public.hb_wellness_seances where player_id = %L limit 1))::text', 'j-2')), 'true');
  perform essai.attendu('refermé : le staff lit encore (actif = false rendu)', essai.vu(c1, 'select (x ->> ''actif'') || '' '' || jsonb_array_length(x -> ''jours'') from public.hb_wellness_groupe(''g1'', 35) x'), 'false 2');
  update public.hb_config set data = '{"id":"wellness","key":"wellness","value":{"actif":true}}' where id = 'wellness';

  -- ---------- Fusion : le wellness suit la fiche gardée (celui de la fiche gardée prime pour un même jour) ----------
  insert into public.hb_wellness (player_id, jour, scores) values ('j-2', auj - 5, '{"energie":4}');
  perform essai.attendu('fusion j-2 → j-1 (administrateur)', essai.comme(a1, $q$select public.hb_merge_players('j-2', 'j-1')$q$), '1');
  perform essai.attendu('… jours de j-1 après fusion (aujourd''hui gardé, il y a 5 jours repris)',
    (select string_agg((jour - auj)::text || ':' || (scores ->> 'energie'), ',' order by jour) from public.hb_wellness where player_id = 'j-1'), '-5:4,0:8');
  perform essai.attendu('… plus rien sur j-2', (select count(*)::text from public.hb_wellness where player_id = 'j-2'), '0');

  -- ---------- Purge de fin de saison ----------
  insert into public.hb_wellness (player_id, jour, scores) values ('j-1', auj - 500, '{"energie":5}');
  insert into public.hb_wellness_seances (player_id, jour, rpe, duree) values ('j-1', auj - 500, 5, 60);
  perform essai.attendu('purge : seulement les saisons passées', (select public.hb_wellness_purger()::text), '2');
  perform essai.attendu('… la saison en cours reste', (select count(*)::text from public.hb_wellness where player_id = 'j-1'), '2');
  perform essai.attendu('purge : pas pour un compte connecté', essai.vu(a1, 'select public.hb_wellness_purger()::text'), 'ERR 42501 permission denied for function hb_wellness_purger');

  -- ---------- Effacement RGPD, suppression définitive ----------
  update public.hb_players set data = data || '{"purged":true}' where id = 'j-1';
  perform essai.attendu('fiche effacée (RGPD) : son wellness et ses séances partent',
    (select (select count(*) from public.hb_wellness where player_id = 'j-1') + (select count(*) from public.hb_wellness_seances where player_id = 'j-1'))::text, '0');
  perform essai.attendu('… pas ceux des autres', (select count(*)::text from public.hb_wellness where player_id = 'j-4'), '1');
  delete from public.hb_players where id = 'j-4';
  perform essai.attendu('fiche supprimée définitivement : son wellness part', (select count(*)::text from public.hb_wellness), '0');
end $$;

-- La table refuse une forme abîmée, même écrite par le propriétaire.
do $$
begin
  begin
    insert into public.hb_wellness (player_id, jour, scores) values ('j-9', current_date, '{"energie":11}');
    raise exception 'ÉCHEC : note 11 acceptée';
  exception when check_violation then
    raise notice 'ok : note hors échelle refusée par la table';
  end;
  begin
    insert into public.hb_wellness (player_id, jour, scores, douleur, douleurs) values ('j-9', current_date, '{"energie":5}', false, '[{"zone":"genou","cote":"g","type":"gene","intensite":3}]');
    raise exception 'ÉCHEC : ligne de douleur sans douleur acceptée';
  exception when check_violation then
    raise notice 'ok : ligne de douleur sans douleur refusée par la table';
  end;
  begin
    insert into public.hb_wellness (player_id, jour, scores, douleur, douleurs) values ('j-9', current_date, '{"energie":5}', true, '[]');
    raise exception 'ÉCHEC : douleur sans ligne acceptée';
  exception when check_violation then
    raise notice 'ok : douleur sans ligne refusée par la table';
  end;
  begin
    insert into public.hb_wellness (player_id, jour, scores, douleur, douleurs) values ('j-9', current_date, '{}', true, '[{"zone":"ischios","type":"gene","intensite":3}]');
    raise exception 'ÉCHEC : endroit pair sans côté accepté';
  exception when check_violation then
    raise notice 'ok : endroit pair sans côté refusé par la table';
  end;
  begin
    insert into public.hb_wellness (player_id, jour, scores, douleur, douleurs) values ('j-9', current_date, '{}', true, '[{"zone":"autre","type":"gene","intensite":3,"texte":"  pas nettoyé  "}]');
    raise exception 'ÉCHEC : texte pas nettoyé accepté';
  exception when check_violation then
    raise notice 'ok : ligne pas nettoyée refusée par la table';
  end;
  insert into public.hb_wellness (player_id, jour, scores, douleur, douleurs) values ('j-9', current_date, '{}', true, '[{"zone":"ischios","cote":"d","type":"contracture","intensite":6}]');
  raise notice 'ok : ligne propre acceptée par la table';
  delete from public.hb_wellness where player_id = 'j-9';
  begin
    insert into public.hb_wellness (player_id, jour) values ('j-9', current_date);
    raise exception 'ÉCHEC : ligne vide acceptée';
  exception when check_violation then
    raise notice 'ok : ligne vide refusée par la table';
  end;
  begin
    insert into public.hb_wellness_seances (player_id, jour, rpe, duree) values ('j-9', current_date, 5, 900);
    raise exception 'ÉCHEC : séance de 900 min acceptée';
  exception when check_violation then
    raise notice 'ok : durée hors bornes refusée par la table';
  end;
  begin
    insert into public.hb_wellness_seances (player_id, jour, rpe) values ('j-9', current_date, 5);
    raise exception 'ÉCHEC : séance sans durée acceptée';
  exception when not_null_violation then
    raise notice 'ok : séance sans durée refusée par la table';
  end;
end $$;
