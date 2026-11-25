-- Essais de supabase/074_lampe.sql (lancer.sh) : comptes, fiches et groupes FICTIFS (mêmes que tools/essai-sql-073). Toute
-- erreur arrête. Lampe fermée (wellness ou réglage « lampe ») / ouverte ; qui est concerné ; cahier du hand et cahier de match
-- (SA fiche, jours permis, champs nettoyés, une note par jour, privée tant qu'elle n'est pas partagée) ; masques par jour ;
-- tableau du staff du groupe seulement (jamais un texte) ; points des encadrants qui ne baissent pas (administrateur : corrige) ;
-- vœux du catalogue ; règles de lecture de hb_lampe ; limite des 200 notes qui n'efface jamais un cahier ; note retirée avec
-- ses champs ; fusion et effacement.
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
  d2 text := '00000000-0000-0000-0000-0000000000d2';
  e1 text := '00000000-0000-0000-0000-0000000000e1';
  e2 text := '00000000-0000-0000-0000-0000000000e2';
  e3 text := '00000000-0000-0000-0000-0000000000e3';
  e9 text := '00000000-0000-0000-0000-0000000000e9';
  cahier text := 'select public.hb_cahier_enregistrer(%L, %L, %L::jsonb)::text';
  coach text := 'select public.hb_lampe_coach(%L, %L::jsonb)::text';
  voeux text := 'select public.hb_lampe_voeux(%L::jsonb)::text';
  auj date := (select j.auj from jours j);
  d text := to_char((select j.auj from jours j), 'YYYY-MM-DD');
  hier text := to_char((select j.auj from jours j) - 1, 'YYYY-MM-DD');
  v text;
  nid text;
  i int;
begin
  -- ---------- Fermée ----------
  perform essai.attendu('sans réglage : lampe fermée', (select public.hb_lp_actif()::text), 'false');
  insert into public.hb_config (id, data) values ('wellness', '{"id":"wellness","key":"wellness","value":{"actif":true}}');
  perform essai.attendu('wellness ouvert, réglage « lampe » absent : toujours fermée', (select public.hb_lp_actif()::text), 'false');
  perform essai.attendu('fermée : vœux refusés', essai.vu(e1, format(voeux, '["ballon"]')), 'ERR P0001 lampe_fermee');
  perform essai.attendu('fermée : points des encadrants refusés', essai.vu(c1, format(coach, 'j-1', '{"attitude":1}')), 'ERR P0001 lampe_fermee');
  perform essai.attendu('fermée : rien n''est demandé', essai.vu(e1, 'select public.hb_lampe_moi() ->> ''demande'''), 'false');
  insert into public.hb_config (id, data) values ('lampe', '{"id":"lampe","key":"lampe","value":{"actif":true}}');
  perform essai.attendu('réglage posé : ouverte', (select public.hb_lp_actif()::text), 'true');

  -- ---------- Qui ----------
  perform essai.attendu('jeune 1 (groupe du wellness) : demandée', essai.vu(e1, 'select public.hb_lampe_moi() ->> ''demande'''), 'true');
  perform essai.attendu('jeune 3 (hors périmètre du créateur) : pas demandée', essai.vu(e3, 'select public.hb_lampe_moi() ->> ''demande'''), 'false');
  perform essai.attendu('saison = année de la rentrée', essai.vu(e1, 'select public.hb_lampe_moi() ->> ''saison'''), public.hb_lp_saison(auj)::text);
  perform essai.attendu('compte sans fiche : refusé', essai.vu(e9, 'select public.hb_lampe_moi()::text'), 'ERR P0001 sans_fiche');
  perform essai.attendu('staff : pas pour lui', essai.vu(c1, 'select public.hb_lampe_moi()::text'), 'ERR P0001 pas_joueur');
  perform essai.attendu('anon : refusé', essai.vu(null, 'select public.hb_lampe_moi()::text'), 'ERR 42501 permission denied for function hb_lampe_moi');

  -- ---------- Cahier du hand ----------
  v := essai.vu(e1, format(cahier, 'cahier', d, '{"travail":"  Tirs en appui\u0007, bonnes jambes  ","difficile":"Enchaîner","objectif":"Garder ma précision","playerId":"j-2","bidule":"x"}'));
  perform essai.attendu('jeune 1 : cahier du jour (champs nettoyés, sorte, jour)',
    (v::jsonb ->> 'kind') || ' ' || (v::jsonb ->> 'day') || ' ' || (v::jsonb -> 'parts')::text || ' ' || (v::jsonb ->> 'shared'),
    'cahier ' || d || ' {"travail": "Tirs en appui, bonnes jambes", "objectif": "Garder ma précision", "difficile": "Enchaîner"} false');
  perform essai.attendu('… texte lisible pour le journal',
    v::jsonb ->> 'text', E'📒 Cahier du hand\nCe que j’ai travaillé / mes sensations : Tirs en appui, bonnes jambes\nCe qui était difficile : Enchaîner\nMon objectif sur le même thème : Garder ma précision');
  nid := v::jsonb ->> 'id';
  perform essai.attendu('… sur SA fiche, compte noté', (select string_agg(player_id || ' ' || (user_id::text = e1)::text, ';') from public.hb_player_journal where kind is not null), 'j-1 true');
  perform essai.attendu('réécrit le même jour : une seule note (même identifiant)',
    essai.vu(e1, format(cahier, 'cahier', d, '{"travail":"Tirs","difficile":"Enchaîner"}'))::jsonb ->> 'id', nid);
  perform essai.attendu('… une note, deux champs', (select count(*) || ' ' || max(parts::text) from public.hb_player_journal where kind = 'cahier' and not deleted), '1 {"travail": "Tirs", "difficile": "Enchaîner"}');
  perform essai.attendu('hier : permis', essai.comme(e1, format(cahier, 'cahier', hier, '{"travail":"Vitesse","difficile":"Fin de séance","objectif":"Récupérer"}')), '1');
  perform essai.attendu('avant-hier : refusé', essai.vu(e1, format(cahier, 'cahier', to_char(auj - 2, 'YYYY-MM-DD'), '{"travail":"x"}')), 'ERR P0001 jour_ferme');
  perform essai.attendu('demain : refusé', essai.vu(e1, format(cahier, 'cahier', to_char(auj + 1, 'YYYY-MM-DD'), '{"travail":"x"}')), 'ERR P0001 jour_ferme');
  perform essai.attendu('jour illisible : refusé', essai.vu(e1, format(cahier, 'cahier', '2026-02-31', '{"travail":"x"}')), 'ERR P0001 jour_ferme');
  perform essai.attendu('sorte inconnue : refusée', essai.vu(e1, format(cahier, 'note', d, '{"travail":"x"}')), 'ERR P0001 sorte');
  perform essai.attendu('trop long : refusé', essai.vu(e1, format(cahier, 'cahier', d, json_build_object('travail', repeat('x', 9000))::text)), 'ERR P0001 trop_long');
  perform essai.attendu('staff : ne l''écrit pas', essai.vu(c1, format(cahier, 'cahier', d, '{"travail":"x"}')), 'ERR P0001 pas_joueur');
  perform essai.attendu('pas d''écriture directe', essai.vu(e1, $q$insert into public.hb_player_journal (id, player_id, text, kind, jour, parts) values ('x1', 'j-1', 'x', 'cahier', current_date, '{}')$q$), 'ERR 42501 permission denied for table hb_player_journal');
  perform essai.attendu('un cahier ne se corrige pas par hb_player_journal_edit', essai.vu(e1, format('select public.hb_player_journal_edit(%L, %L)::text', nid, 'autre texte')), 'ERR P0001 note_introuvable');

  -- Privé tant qu'il n'est pas partagé (règles de 052 inchangées).
  perform essai.attendu('staff du groupe : cahier privé invisible', essai.vu(c1, 'select count(*)::text from public.hb_player_journal where kind is not null'), '0');
  perform essai.attendu('jeune 2 : ne lit pas le cahier du jeune 1', essai.vu(e2, 'select count(*)::text from public.hb_player_journal where kind is not null'), '0');
  perform essai.comme(e1, format('select public.hb_player_journal_share(%L, true)', nid));
  perform essai.attendu('partagé : le staff du groupe le lit (avec ses champs)', essai.vu(c1, 'select string_agg(parts ->> ''travail'', '','') from public.hb_player_journal where kind is not null'), 'Tirs');

  -- ---------- Cahier de match ----------
  v := essai.vu(e1, format(cahier, 'match', to_char(auj - 3, 'YYYY-MM-DD'),
    '{"adversaire":"  Club   fictif ","nous":25,"eux":20,"resultat":"defaite","sensation":"pas bien","mt1":24,"mt2":45,"bienAtt":"Mes courses","amelDef":"Mes replis"}'));
  perform essai.attendu('cahier de match 3 jours après : permis ; résultat tiré du score, sensation inconnue ignorée, mi-temps > 40 ignorée',
    (v::jsonb -> 'parts')::text, '{"eux": 20, "mt1": 24, "nous": 25, "amelDef": "Mes replis", "bienAtt": "Mes courses", "resultat": "victoire", "adversaire": "Club fictif"}');
  perform essai.attendu('… sans sensation : ne compte pas encore pour la lampe', (select public.hb_lp_ok('match', v::jsonb -> 'parts', 3)::text), 'false');
  perform essai.attendu('4 jours après : refusé', essai.vu(e1, format(cahier, 'match', to_char(auj - 4, 'YYYY-MM-DD'), '{"sensation":"super"}')), 'ERR P0001 jour_ferme');
  v := essai.vu(e1, format(cahier, 'match', to_char(auj - 3, 'YYYY-MM-DD'), '{"adversaire":"Club fictif","nous":20,"eux":20,"sensation":"complique","mt1":20,"mt2":15,"bienAtt":"Mes courses"}'));
  perform essai.attendu('… complété : il compte, texte lisible (temps cumulé)', (select public.hb_lp_ok('match', v::jsonb -> 'parts', 3)::text) || ' / ' || (v::jsonb ->> 'text'),
    E'true / 🏟️ Cahier de match contre Club fictif\nRésultat : Nul 20 – 20\nSensation : Compliqué\nTemps de jeu : 20 + 15 = 35 min\nCe que j’ai bien fait en attaque : Mes courses');

  -- ---------- Masques par jour ----------
  insert into public.hb_wellness (player_id, jour, scores) values ('j-1', auj, '{"energie":7}'), ('j-1', auj - 1, '{"energie":6}'), ('j-2', auj, '{"humeur":8}');
  insert into public.hb_wellness_seances (player_id, jour, rpe, duree) values ('j-1', auj, 6, 90), ('j-1', auj - 1, 5, 60), ('j-1', auj - 1, 7, 30);
  perform essai.attendu('aujourd''hui : wellness + séance, cahier à 2 questions → 3 (le cahier ne compte pas encore)',
    essai.vu(e1, format('select public.hb_lampe_moi() -> ''jours'' ->> %L', d)), '3');
  perform essai.comme(e1, format(cahier, 'cahier', d, '{"travail":"Tirs","difficile":"Enchaîner","objectif":"Précision"}'));
  perform essai.attendu('… 3 questions remplies → 7 (journée allumée)', essai.vu(e1, format('select public.hb_lampe_moi() -> ''jours'' ->> %L', d)), '7');
  perform essai.attendu('hier : 7 aussi ; le match → 8', essai.vu(e1, format('select (public.hb_lampe_moi() -> ''jours'' ->> %L) || '','' || (public.hb_lampe_moi() -> ''jours'' ->> %L)', hier, to_char(auj - 3, 'YYYY-MM-DD'))), '7,8');
  update public.hb_config set data = jsonb_set(data, '{value,regles}', '{"cahierMinFields":2}') where id = 'lampe';
  perform essai.attendu('réglage cahierMinFields = 2 : appliqué par le serveur', (select public.hb_lp_min_champs()::text), '2');
  update public.hb_config set data = '{"id":"lampe","key":"lampe","value":{"actif":true}}' where id = 'lampe';

  -- ---------- Tableau du staff ----------
  v := essai.vu(c1, 'select public.hb_lampe_groupe(''g1'')::text');
  perform essai.attendu('staff du groupe : fiches avec un compte (j-3 hors périmètre absente)', (select string_agg(x, ',' order by x) from jsonb_array_elements_text(v::jsonb -> 'comptes') x), 'j-1,j-2');
  perform essai.attendu('… masques de j-1 aujourd''hui et de j-2', (v::jsonb -> 'joueurs' -> 'j-1' -> 'jours' ->> d) || ',' || (v::jsonb -> 'joueurs' -> 'j-2' -> 'jours' ->> d), '7,1');
  perform essai.attendu('… jamais le texte d''un cahier', (position('Tirs' in v) = 0)::text, 'true');
  perform essai.attendu('participant du groupe : lit aussi', essai.vu(c2, 'select jsonb_array_length(public.hb_lampe_groupe(''g1'') -> ''comptes'')::text'), '2');
  perform essai.attendu('autre coach : refusé', essai.vu(c3, 'select public.hb_lampe_groupe(''g1'')::text'), 'ERR P0001 groupe_inconnu');
  perform essai.attendu('observateur : refusé', essai.vu(d2, 'select public.hb_lampe_groupe(''g1'')::text'), 'ERR P0001 groupe_inconnu');
  perform essai.attendu('jeune : refusé', essai.vu(e1, 'select public.hb_lampe_groupe(''g1'')::text'), 'ERR P0001 groupe_inconnu');
  perform essai.attendu('groupe Pôle : son jeune (période en cours)', essai.vu(c1, 'select (public.hb_lampe_groupe(''gp'') -> ''comptes'')::text'), '["j-4"]');

  -- ---------- Points des encadrants ----------
  perform essai.attendu('staff du groupe : points (clés connues, 2 au plus, 0 retiré)',
    essai.vu(c1, format(coach, 'j-1', '{"entrainabilite":2,"attitude":1,"humeur":5,"remise":0,"bidule":2}')), '{"humeur": 2, "attitude": 1, "entrainabilite": 2}');
  perform essai.attendu('participant : ajoute un point', essai.vu(c2, format(coach, 'j-1', '{"entrainabilite":2,"attitude":2,"humeur":2}')), '{"humeur": 2, "attitude": 2, "entrainabilite": 2}');
  perform essai.attendu('encadrant : ne baisse jamais un point', essai.vu(c2, format(coach, 'j-1', '{"entrainabilite":2,"attitude":1,"humeur":2}')), 'ERR P0001 baisse');
  perform essai.attendu('administrateur : corrige une erreur', essai.vu(a1, format(coach, 'j-1', '{"entrainabilite":2,"attitude":1,"humeur":2}')), '{"humeur": 2, "attitude": 1, "entrainabilite": 2}');
  perform essai.attendu('autre coach : refusé', essai.vu(c3, format(coach, 'j-1', '{"attitude":2}')), 'ERR P0001 joueur_inconnu');
  perform essai.attendu('observateur : refusé', essai.vu(d2, format(coach, 'j-1', '{"attitude":2}')), 'ERR P0001 joueur_inconnu');
  perform essai.attendu('jeune : refusé', essai.vu(e1, format(coach, 'j-1', '{"attitude":2}')), 'ERR P0001 joueur_inconnu');
  perform essai.attendu('fiche hors périmètre du groupe : refusé', essai.vu(c1, format(coach, 'j-3', '{"attitude":2}')), 'ERR P0001 joueur_inconnu');
  perform essai.attendu('le jeune voit ses points', essai.vu(e1, 'select (public.hb_lampe_moi() -> ''coach'')::text'), '{"humeur": 2, "attitude": 1, "entrainabilite": 2}');
  perform essai.attendu('le staff aussi, dans le tableau', essai.vu(c1, 'select (public.hb_lampe_groupe(''g1'') -> ''joueurs'' -> ''j-1'' -> ''coach'')::text'), '{"humeur": 2, "attitude": 1, "entrainabilite": 2}');

  -- ---------- Vœux ----------
  perform essai.attendu('vœux : catalogue par défaut, sans doublon, 3 au plus, dans l''ordre',
    essai.vu(e1, format(voeux, '["ballon","inconnu","ballon","maillot","pro","centre"]')), '["ballon", "maillot", "pro"]');
  perform essai.attendu('changés', essai.vu(e1, format(voeux, '["centre"]')), '["centre"]');
  perform essai.attendu('jeune hors lampe : refusé', essai.vu(e3, format(voeux, '["ballon"]')), 'ERR P0001 pas_demande');
  perform essai.attendu('staff : refusé', essai.vu(c1, format(voeux, '["ballon"]')), 'ERR P0001 pas_joueur');
  update public.hb_config set data = '{"id":"lampe","key":"lampe","value":{"actif":true,"catalogue":[{"id":"stage-ete","label":"Un stage d''été"},{"id":"maillot","label":"Un maillot"}]}}' where id = 'lampe';
  perform essai.attendu('catalogue de l''installation : seuls ses vœux', essai.vu(e1, format(voeux, '["ballon","stage-ete","maillot"]')), '["stage-ete", "maillot"]');
  perform essai.attendu('le staff voit les vœux du groupe', essai.vu(c1, 'select (public.hb_lampe_groupe(''g1'') -> ''joueurs'' -> ''j-1'' -> ''voeux'')::text'), '["stage-ete", "maillot"]');

  -- ---------- Règles de lecture de hb_lampe ----------
  perform essai.attendu('jeune 1 : sa ligne', essai.vu(e1, 'select count(*)::text from public.hb_lampe'), '1');
  perform essai.attendu('jeune 2 : rien', essai.vu(e2, 'select count(*)::text from public.hb_lampe'), '0');
  perform essai.attendu('staff du groupe : la ligne de j-1', essai.vu(c1, 'select count(*)::text from public.hb_lampe'), '1');
  perform essai.attendu('autre coach : rien', essai.vu(c3, 'select count(*)::text from public.hb_lampe'), '0');
  perform essai.attendu('anon : rien', essai.vu(null, 'select count(*)::text from public.hb_lampe'), 'ERR 42501 permission denied for table hb_lampe');
  perform essai.attendu('pas d''écriture directe', essai.vu(e1, $q$update public.hb_lampe set coach = '{"attitude":2}'$q$), 'ERR 42501 permission denied for table hb_lampe');

  -- ---------- Limite des 200 notes : jamais un cahier ----------
  for i in 1 .. 205 loop
    perform essai.vu(e1, format('select public.hb_player_journal_add(%L)::text', 'Note ' || i));
  end loop;
  perform essai.attendu('205 notes simples : 200 gardées, les 3 cahiers aussi',
    (select count(*) filter (where kind is null) || ' ' || count(*) filter (where kind is not null) from public.hb_player_journal where player_id = 'j-1' and not deleted), '200 3');

  -- ---------- Retirer ----------
  perform essai.attendu('cahier vidé : retiré (null)', coalesce(essai.vu(e1, format(cahier, 'cahier', hier, '{"travail":"   "}')), 'null'), 'null');
  perform essai.attendu('… ses champs effacés', (select count(*) || ' ' || bool_and(parts is null and kind is null)::text from public.hb_player_journal where player_id = 'j-1' and deleted and text = ''), '1 true');
  perform essai.comme(e1, format('select public.hb_player_journal_delete(%L)', nid));
  perform essai.attendu('note retirée par hb_player_journal_delete (052) : champs effacés aussi', (select coalesce(parts::text, 'aucun') || ' ' || coalesce(kind, 'aucune') from public.hb_player_journal where id = nid), 'aucun aucune');
  perform essai.attendu('… et la journée n''a plus de cahier', essai.vu(e1, format('select public.hb_lampe_moi() -> ''jours'' ->> %L', d)), '3');

  -- ---------- Fusion, effacement ----------
  perform essai.attendu('fusion j-1 → j-2 (administrateur)', essai.comme(a1, $q$select public.hb_merge_players('j-1', 'j-2')$q$), '1');
  perform essai.attendu('… sa ligne de la lampe suit la fiche gardée', (select string_agg(player_id, ',') from public.hb_lampe), 'j-2');
  perform essai.attendu('… ses cahiers aussi', (select count(*)::text from public.hb_player_journal where player_id = 'j-2' and kind is not null and not deleted), '1');
  update public.hb_players set data = data || '{"purged":true}' where id = 'j-2';
  perform essai.attendu('effacement RGPD : tout part', (select count(*) from public.hb_lampe)::text || ' ' || (select count(*) from public.hb_player_journal where player_id = 'j-2')::text, '0 0');
end $$;

