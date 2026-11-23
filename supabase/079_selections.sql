-- HandBase / Nextar : sélections comité, ligue, équipe de France (src/selections.ts) — DÉMO (base hand de la maison, joueurs
-- FICTIFS). Plan décidé avec Geoffroy et Stef le 23/11/2026 (~/Documents/HandBase_a_faire.md, « Groupes permanents de sélection
-- + stages »).
--
-- CÔTÉ SERVEUR : RIEN À CHANGER (vérifié le 23/11) :
--  - les périodes de sélection vivent dans data.selections de la fiche (jsonb), comme data.poles : hb_upsert garde data tel
--    quel ; mêmes droits que le reste de la fiche (encadrant de son périmètre, administrateur) ; un joueur n'écrit jamais sa
--    fiche (051, hb_player_guard) ; il la lit dans son espace comme ses pôles ;
--  - les groupes de sélection sont des lignes de hb_groups ordinaires (data.selection, playerIds vide, membres calculés sur
--    l'appareil) : mêmes règles de lecture et d'écriture que les autres groupes ; identifiants fixes (« sel-comite-<unité>-m »,
--    « sel-france-u17-f ») : l'appli et ce script écrivent les mêmes lignes ;
--  - les stages sont des événements (types stage_comite, stage_ligue, stage_national) : data.type est libre pour hb_upsert.
--  Limites connues, laissées telles quelles : le wellness d'un groupe (073, hb_wl_contient) ne lit que playerIds et les groupes
--  Pôle (l'appli ne le propose pas sur un groupe de sélection) ; l'auto-évaluation des jeunes (064) reste limitée aux matchs,
--  tournois et entraînements (pas les stages).
--
-- DÉMO SEULEMENT (ce qui suit) : à passer avec outils/appliquer-sql.sh (serveur maison, pile hand ; il ajoute begin / commit).
-- Rejouable sans dégâts : un second passage ne change rien. Ne touche QUE :
--  - les fiches créées par l'import SQL de la démo (data.createdByName = 'Administration Supabase (SQL)') qui n'ont PAS encore de
--    data.selections (une fiche qui en a, saisies dans l'appli ou par un passage précédent, n'est jamais réécrite) ;
--  - des lignes nouvelles marquées data.demoSeed = 'selections-079' (groupes de sélection, stages) ; une ligne de ce jeu modifiée
--    ou supprimée depuis par un vrai compte, ou un groupe déjà créé par l'appli (même identifiant), n'est jamais réécrit.
-- Déclencheurs coupés (ni journal, ni notification), comme 078 ; l'heure serveur avance pour que les appareils reçoivent les
-- lignes ; colonnes de périmètre des événements écrites avec les fonctions du serveur. Aucun nom de joueur, aucune donnée
-- fédérale.
--
-- a) Groupes de sélection : chaque comité et chaque ligue de la structure en masculin et féminin (« Comité de l'Ain masculin »,
--    « Ligue Occitanie féminin »), et les 6 groupes « Équipe de France U17 / U19 / U21 » masculin et féminin (mêmes noms et
--    identifiants que src/selections.ts, selectionGroupSpecs).
-- b) Périodes de sélection (comité et ligue du club de la fiche, comme 078) ; âge = année de début de saison − année de naissance :
--    - comité : la saison de ses 13 ans (13–14 ans), du 1er septembre au 30 juin ; 80 % des fiches qui ont un pôle, 10 % des
--      autres ;
--    - ligue : la saison de ses 14 ans (14–15 ans) ; 70 % des sélectionnés du comité qui ont un pôle, 40 % des autres ;
--    - équipe de France U17 : les saisons de ses 15 et 16 ans, à partir du 1er octobre ; 18 % des sélectionnés de ligue qui ont
--      un pôle, 2 % des autres ; U19 : saisons de ses 17 et 18 ans, 60 % des U17 ; U21 : 19 et 20 ans, 60 % des U19 (aucune
--      fiche de la démo n'a encore l'âge) ;
--    une saison en cours laisse la période ouverte ; une saison passée la ferme au 30 juin, motif « fin de saison » (« catégorie
--    au-dessus » quand la catégorie France suivante prend la suite). Tirage fixe (hashtext de l'identifiant) : même résultat à
--    chaque passage.
-- c) Stages (événements, pas des groupes) : « Stage de sélection » de comité (saison en cours, comités qui ont au moins 3
--    sélectionnés), « Stage de ligue » (saison passée et en cours, au moins 3 sélectionnés), « Stage national U17 / U19 / U21 »
--    (saison passée et en cours) ; liste = sélectionnés du groupe à la date du stage ; saison passée : archivé (il compte
--    toujours dans le parcours).
-- d) Contrôle en fin de fichier : 0 partout, sauf les lignes « (info) ».
--
-- Retour arrière : retirer data.selections des fiches écrites ici (celles dont les périodes sont exactement celles du calcul) ;
-- supprimer logiquement les lignes demoSeed = 'selections-079' de hb_groups et hb_events.

set local session_replication_role = replica;
set local statement_timeout = 0;
set local client_min_messages = warning;
drop table if exists t079_stamp, t079_dept, t079_groupes, t079_joueurs, t079_per, t079_plan, t079_ecrits, t079_ok, t079_ev;
create temp table t079_stamp on commit drop as
  select (extract(epoch from now()) * 1000)::bigint as ms, now() as at, current_date as today,
         extract(year from current_date)::int - case when extract(month from current_date) < 9 then 1 else 0 end as saison,
         'selections-079'::text as marque;

-- Département précédé de son article (même table que src/selections.ts, DEPT_DE ; tools/test-selections.ts les compare).
create temp table t079_dept (code text primary key, de text not null) on commit drop;
insert into t079_dept (code, de) values
  ('01', 'de l''Ain'), ('02', 'de l''Aisne'), ('03', 'de l''Allier'), ('04', 'des Alpes-de-Haute-Provence'),
  ('05', 'des Hautes-Alpes'), ('06', 'des Alpes-Maritimes'), ('07', 'de l''Ardèche'), ('08', 'des Ardennes'),
  ('09', 'de l''Ariège'), ('10', 'de l''Aube'), ('11', 'de l''Aude'), ('12', 'de l''Aveyron'),
  ('13', 'des Bouches-du-Rhône'), ('14', 'du Calvados'), ('15', 'du Cantal'), ('16', 'de la Charente'),
  ('17', 'de la Charente-Maritime'), ('18', 'du Cher'), ('19', 'de la Corrèze'), ('2A', 'de la Corse-du-Sud'),
  ('2B', 'de la Haute-Corse'), ('21', 'de la Côte-d''Or'), ('22', 'des Côtes-d''Armor'), ('23', 'de la Creuse'),
  ('24', 'de la Dordogne'), ('25', 'du Doubs'), ('26', 'de la Drôme'), ('27', 'de l''Eure'),
  ('28', 'd''Eure-et-Loir'), ('29', 'du Finistère'), ('30', 'du Gard'), ('31', 'de la Haute-Garonne'),
  ('32', 'du Gers'), ('33', 'de la Gironde'), ('34', 'de l''Hérault'), ('35', 'd''Ille-et-Vilaine'),
  ('36', 'de l''Indre'), ('37', 'd''Indre-et-Loire'), ('38', 'de l''Isère'), ('39', 'du Jura'), ('40', 'des Landes'),
  ('41', 'de Loir-et-Cher'), ('42', 'de la Loire'), ('43', 'de la Haute-Loire'), ('44', 'de Loire-Atlantique'),
  ('45', 'du Loiret'), ('46', 'du Lot'), ('47', 'de Lot-et-Garonne'), ('48', 'de la Lozère'),
  ('49', 'de Maine-et-Loire'), ('50', 'de la Manche'), ('51', 'de la Marne'), ('52', 'de la Haute-Marne'),
  ('53', 'de la Mayenne'), ('54', 'de Meurthe-et-Moselle'), ('55', 'de la Meuse'), ('56', 'du Morbihan'),
  ('57', 'de la Moselle'), ('58', 'de la Nièvre'), ('59', 'du Nord'), ('60', 'de l''Oise'), ('61', 'de l''Orne'),
  ('62', 'du Pas-de-Calais'), ('63', 'du Puy-de-Dôme'), ('64', 'des Pyrénées-Atlantiques'),
  ('65', 'des Hautes-Pyrénées'), ('66', 'des Pyrénées-Orientales'), ('67', 'du Bas-Rhin'), ('68', 'du Haut-Rhin'),
  ('69', 'du Rhône'), ('70', 'de la Haute-Saône'), ('71', 'de Saône-et-Loire'), ('72', 'de la Sarthe'),
  ('73', 'de la Savoie'), ('74', 'de la Haute-Savoie'), ('75', 'de Paris'), ('76', 'de la Seine-Maritime'),
  ('77', 'de Seine-et-Marne'), ('78', 'des Yvelines'), ('79', 'des Deux-Sèvres'), ('80', 'de la Somme'),
  ('81', 'du Tarn'), ('82', 'de Tarn-et-Garonne'), ('83', 'du Var'), ('84', 'de Vaucluse'), ('85', 'de la Vendée'),
  ('86', 'de la Vienne'), ('87', 'de la Haute-Vienne'), ('88', 'des Vosges'), ('89', 'de l''Yonne'),
  ('90', 'du Territoire de Belfort'), ('91', 'de l''Essonne'), ('92', 'des Hauts-de-Seine'),
  ('93', 'de la Seine-Saint-Denis'), ('94', 'du Val-de-Marne'), ('95', 'du Val-d''Oise'),
  ('971', 'de la Guadeloupe'), ('972', 'de la Martinique'), ('973', 'de la Guyane'), ('974', 'de La Réunion'),
  ('976', 'de Mayotte'), ('988', 'de Nouvelle-Calédonie');

-- Noms (src/selections.ts, comiteName et ligueName).
create or replace function pg_temp.p079_nu(nom text) returns text language sql immutable as
$$ select btrim(regexp_replace(coalesce(nom, ''), '\s*\(\s*[0-9AB]+\s*\)\s*$', '', 'i')) $$;
create or replace function pg_temp.p079_comite(nom text, depts jsonb) returns text language sql stable as $$
  select case
    when pg_temp.p079_nu(nom) ~* '^comit[ée]s?(\s|$)' then regexp_replace(pg_temp.p079_nu(nom), '^comit[ée]s?', 'Comité', 'i')
    when jsonb_typeof(depts) = 'array' and jsonb_array_length(depts) = 1 and exists (select 1 from t079_dept d where d.code = depts ->> 0)
      then 'Comité ' || (select d.de from t079_dept d where d.code = depts ->> 0)
    else 'Comité ' || pg_temp.p079_nu(nom) end $$;
create or replace function pg_temp.p079_ligue(nom text) returns text language sql immutable as $$
  select case when n ~* '^ligues?(\s|$)' then regexp_replace(n, '^ligues?', 'Ligue', 'i') else 'Ligue ' || n end
    from (select btrim(regexp_replace(coalesce(nom, ''), '\s+de\s+(hand(ball)?|volley([- ]?ball)?)\s*$', '', 'i')) as n) x $$;
-- Samedi suivant (ou le jour même).
create or replace function pg_temp.p079_samedi(d date) returns date language sql immutable as
$$ select d + ((6 - extract(isodow from d)::int + 7) % 7) $$;

-- ---------- a) Groupes de sélection ----------

create temp table t079_groupes on commit drop as
with u as (
  select id, data ->> 'name' as nom, data -> 'departments' as depts, case data ->> 'levelId' when 'niveau-comite' then 'comite' else 'ligue' end as niveau
    from public.hb_units where not deleted and data ->> 'levelId' in ('niveau-comite', 'niveau-ligue')
), s(sexe) as (values ('M'), ('F')), c(cat) as (values ('U17'), ('U19'), ('U21'))
select 'sel-' || u.niveau || '-' || lower(u.id) || '-' || lower(s.sexe) as id, u.niveau, u.id as unite, null::text as cat, s.sexe,
       (case u.niveau when 'comite' then pg_temp.p079_comite(u.nom, u.depts) else pg_temp.p079_ligue(u.nom) end)
         || case s.sexe when 'F' then ' féminin' else ' masculin' end as nom,
       case when u.niveau = 'comite' and jsonb_typeof(u.depts) = 'array' then u.depts ->> 0 end as dept
  from u cross join s
union all
select 'sel-france-' || lower(c.cat) || '-' || lower(s.sexe), 'france', null, c.cat, s.sexe,
       'Équipe de France ' || c.cat || case s.sexe when 'F' then ' féminin' else ' masculin' end, null
  from c cross join s;

insert into public.hb_groups as g (id, data, updated_at_client, deleted, server_updated_at)
select x.id,
       jsonb_strip_nulls(jsonb_build_object(
         'id', x.id, 'name', x.nom, 'playerIds', '[]'::jsonb,
         'selection', jsonb_strip_nulls(jsonb_build_object('level', x.niveau, 'unitId', x.unite, 'category', x.cat, 'sex', x.sexe)),
         'private', false, 'sex', x.sexe, 'scope', case x.niveau when 'france' then 'federation' else x.niveau end, 'department', x.dept,
         'createdByName', 'Administration Supabase (SQL)', 'updatedByName', 'Administration Supabase (SQL)',
         'createdAtServer', s.at, 'updatedAtServer', s.at, 'updatedAt', s.ms, 'demoSeed', s.marque)),
       s.ms, false, clock_timestamp()
  from t079_groupes x cross join t079_stamp s
on conflict (id) do update
   set data = excluded.data, updated_at_client = excluded.updated_at_client, server_updated_at = excluded.server_updated_at
 where g.data ->> 'demoSeed' = 'selections-079' and not g.deleted and not (g.data ? 'updatedBy')
   and g.data - 'updatedAt' - 'updatedAtServer' - 'createdAtServer' is distinct from excluded.data - 'updatedAt' - 'updatedAtServer' - 'createdAtServer';

-- ---------- b) Périodes de sélection ----------

-- Fiches de la démo (sexe et naissance connus) : pôle ou non, comité et ligue de leur club (même règle que 078).
create temp table t079_joueurs on commit drop as
select p.id, p.data ->> 'sex' as sexe, extract(year from (p.data ->> 'birthDate')::date)::int as an, (p.data ? 'selections') as deja,
       coalesce(jsonb_typeof(p.data -> 'poles') = 'array'
                and exists (select 1 from jsonb_array_elements(p.data -> 'poles') v where coalesce(v ->> 'from', '') ~ '^\d{4}-\d\d-\d\d$'), false) as pole,
       -- Nom gardé sur la période : celui du collectif sans le sexe (« Comité de l'Ain », « Ligue Occitanie »), comme l'appli.
       c.id as comite, pg_temp.p079_comite(c.data ->> 'name', c.data -> 'departments') as comite_nom, l.id as ligue, pg_temp.p079_ligue(l.data ->> 'name') as ligue_nom
  from public.hb_players p
  left join lateral (select u.id, u.data from public.hb_units u
                      where not u.deleted and u.data ->> 'levelId' = 'niveau-comite' and u.data -> 'departments' ? p.scope_dept
                        and exists (select 1 from public.hb_units l where l.id = u.data ->> 'parentId' and not l.deleted and l.data ->> 'levelId' = 'niveau-ligue')
                      order by u.id limit 1) c on true
  left join public.hb_units l on l.id = c.data ->> 'parentId'
 where not p.deleted and p.data ->> 'createdByName' = 'Administration Supabase (SQL)'
   and p.data ->> 'sex' in ('M', 'F') and coalesce(p.data ->> 'birthDate', '') ~ '^\d{4}-\d\d-\d\d$';

create temp table t079_per on commit drop as
with h as (
  select j.*, s.saison,
         abs(hashtext(j.id || ':079:cd')) % 100 as hc, abs(hashtext(j.id || ':079:lig')) % 100 as hl,
         abs(hashtext(j.id || ':079:u17')) % 100 as h17, abs(hashtext(j.id || ':079:u19')) % 100 as h19, abs(hashtext(j.id || ':079:u21')) % 100 as h21
    from t079_joueurs j cross join t079_stamp s
), f as (
  select h.*, h.comite is not null and h.an + 13 <= h.saison and h.hc < case when h.pole then 80 else 10 end as cd from h
), g as (
  select f.*, f.cd and f.ligue is not null and f.an + 14 <= f.saison and f.hl < case when f.pole then 70 else 40 end as lig from f
), k as (
  select g.*, g.lig and g.an + 15 <= g.saison and g.h17 < case when g.pole then 18 else 2 end as u17 from g
), m as (
  select k.*, k.u17 and k.an + 17 <= k.saison and k.h19 < 60 as u19 from k
), n as (
  select m.*, m.u19 and m.an + 19 <= m.saison and m.h21 < 60 as u21 from m
), x as (
  -- (niveau, unité, catégorie, saison de début, saison de fin, jour d'entrée, suite en France)
  select n.id, n.sexe, n.deja, n.saison, 1 as ordre, 'comite' as niveau, n.comite as unite, n.comite_nom as unite_nom, null::text as cat,
         n.an + 13 as s1, n.an + 13 as s2, 9 as mois, false as suite from n where n.cd
  union all select n.id, n.sexe, n.deja, n.saison, 2, 'ligue', n.ligue, n.ligue_nom, null, n.an + 14, n.an + 14, 9, false from n where n.lig
  union all select n.id, n.sexe, n.deja, n.saison, 3, 'france', null, null, 'U17', n.an + 15, n.an + 16, 10, n.u19 from n where n.u17
  union all select n.id, n.sexe, n.deja, n.saison, 4, 'france', null, null, 'U19', n.an + 17, n.an + 18, 10, n.u21 from n where n.u19
  union all select n.id, n.sexe, n.deja, n.saison, 5, 'france', null, null, 'U21', n.an + 19, n.an + 20, 10, false from n where n.u21
)
select x.id, x.sexe, x.deja, x.ordre, x.niveau, x.unite, x.unite_nom, x.cat,
       make_date(x.s1, x.mois, 1) as du,
       case when x.s2 >= x.saison then null else make_date(x.s2 + 1, 6, 30) end as au,
       case when x.s2 >= x.saison then null when x.suite then 'categorie_superieure' else 'fin_saison' end as motif
  from x;

-- Périodes de chaque fiche, dans l'ordre (comité, ligue, U17, U19, U21).
create temp table t079_plan on commit drop as
select r.id, bool_or(r.deja) as deja,
       jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
         'level', r.niveau, 'unitId', r.unite, 'unitName', r.unite_nom, 'category', r.cat, 'sex', r.sexe,
         'from', to_char(r.du, 'YYYY-MM-DD'), 'to', to_char(r.au, 'YYYY-MM-DD'), 'exitReason', r.motif)) order by r.ordre) as selections
  from t079_per r group by r.id;

-- Fiches écrites : seulement celles qui n'ont pas encore de périodes de sélection (même règle que le serveur pour updatedBy).
create temp table t079_ecrits on commit drop as
with up as (
  update public.hb_players p
     set data = p.data || jsonb_build_object('selections', pl.selections, 'updatedAt', s.ms, 'updatedByName', 'Administration Supabase (SQL)', 'updatedAtServer', s.at),
         updated_at_client = s.ms, server_updated_at = clock_timestamp()
    from t079_plan pl, t079_stamp s
   where p.id = pl.id and not pl.deja and not (p.data ? 'selections')
  returning p.id
) select id from up;

-- Fiches dont les périodes sont exactement celles du calcul (écrites maintenant ou par un passage précédent) : les stages ne
-- listent qu'elles.
create temp table t079_ok on commit drop as
select pl.id from t079_plan pl join public.hb_players p on p.id = pl.id where not p.deleted and p.data -> 'selections' = pl.selections;

select 'fiches écrites' as quoi, count(*) as n from t079_ecrits
union all select 'fiches avec le calcul (ce passage et les précédents)', count(*) from t079_ok
union all select 'fiches qui avaient déjà des périodes de sélection, laissées telles quelles (info)', count(*) from t079_plan where deja;

-- ---------- c) Stages ----------

create temp table t079_ev on commit drop as
with p as (select r.* from t079_per r join t079_ok o on o.id = r.id),
st as (select * from t079_stamp),
-- Comités : saison en cours ; ligues : saison passée et en cours ; France : saison passée et en cours, par catégorie.
cle as (
  select 'cd:' || p.unite || ':' || st.saison || ':' || p.sexe as cle, 'stage_comite' as type, p.niveau, p.unite, p.unite_nom, null::text as cat, p.sexe, st.saison as an
    from p, st where p.niveau = 'comite' and p.du <= make_date(st.saison, 9, 1) and p.au is null
  union
  select 'lig:' || p.unite || ':' || y.an || ':' || p.sexe, 'stage_ligue', p.niveau, p.unite, p.unite_nom, null, p.sexe, y.an
    from p, st cross join lateral (values (st.saison - 1), (st.saison)) y(an)
   where p.niveau = 'ligue' and p.du <= make_date(y.an + 1, 6, 30) and coalesce(p.au, 'infinity'::date) >= make_date(y.an, 9, 1)
  union
  select 'fr:' || p.cat || ':' || y.an || ':' || p.sexe, 'stage_national', p.niveau, null, null, p.cat, p.sexe, y.an
    from p, st cross join lateral (values (st.saison - 1), (st.saison)) y(an)
   where p.niveau = 'france' and p.du <= make_date(y.an + 1, 6, 30) and coalesce(p.au, 'infinity'::date) >= make_date(y.an, 9, 1)
), jour as (
  select c.*, st.today, st.saison,
         greatest(case when c.type = 'stage_national' then make_date(c.an, 10, 1) else make_date(c.an, 9, 1) end,
                  least(st.today - 1,
                        case
                          when c.an < st.saison then pg_temp.p079_samedi(make_date(c.an + 1, case c.type when 'stage_national' then 2 else 2 end, case c.type when 'stage_national' then 14 else 7 end) + 7 * (abs(hashtext(c.cle)) % 3))
                          when c.type = 'stage_comite' then pg_temp.p079_samedi(make_date(c.an, 10, 17) + 7 * (abs(hashtext(c.cle)) % 4))
                          when c.type = 'stage_ligue' then pg_temp.p079_samedi(make_date(c.an, 10, 24) + 7 * (abs(hashtext(c.cle)) % 3))
                          else pg_temp.p079_samedi(make_date(c.an, 10, 24)) end)) as jour
    from cle c cross join st
), liste as (
  select j.cle, jsonb_agg(p.id order by p.id) as pids, count(*) as n
    from jour j join p on p.sexe = j.sexe and p.niveau = j.niveau and p.unite is not distinct from j.unite and p.cat is not distinct from j.cat
                      and p.du <= j.jour and coalesce(p.au, 'infinity'::date) >= j.jour
   group by j.cle
)
select md5('nextar-079/stage/' || j.cle)::uuid::text as id, j.*, l.pids, l.n,
       case j.type
         when 'stage_comite' then 'Stage de sélection ' || j.an || '-' || (j.an + 1) || ' ' || case j.sexe when 'F' then 'filles' else 'garçons' end
                                  || ' – ' || j.unite_nom
         when 'stage_ligue' then 'Stage de ligue ' || j.an || '-' || (j.an + 1) || ' ' || case j.sexe when 'F' then 'filles' else 'garçons' end || ' – ' || j.unite_nom
         else 'Stage national ' || j.cat || ' ' || case j.sexe when 'F' then 'filles' else 'garçons' end || ' ' || j.an || '-' || (j.an + 1) end as nom,
       case j.type when 'stage_national' then (select u.id from public.hb_units u where not u.deleted and u.data ->> 'levelId' = 'niveau-federation' order by u.id limit 1) else j.unite end as org
  from jour j join liste l on l.cle = j.cle
 where l.n >= case j.type when 'stage_national' then 1 else 3 end;

insert into public.hb_events as e (id, data, updated_at_client, deleted, server_updated_at, scope_dept, scope_club, players_dept, players_club)
select v.id,
       jsonb_strip_nulls(jsonb_build_object(
         'id', v.id, 'name', v.nom, 'type', v.type, 'date', to_char(v.jour, 'YYYY-MM-DD'), 'time', '10:00',
         'place', case v.type when 'stage_national' then 'Centre national' else coalesce(o.data ->> 'name', '') end,
         'sex', v.sexe, 'playerIds', v.pids, 'archived', case when v.an < v.saison then true end,
         'organizerUnitId', v.org, 'organizerName', o.data ->> 'name',
         'createdByName', 'Administration Supabase (SQL)', 'createdAtServer', to_char(v.jour - 21, 'YYYY-MM-DD') || 'T10:00:00+00:00',
         'updatedByName', 'Administration Supabase (SQL)', 'updatedAt', s.ms, 'updatedAtServer', s.at, 'demoSeed', s.marque)),
       s.ms, false, clock_timestamp(), t.depts, t.clubs, ps.depts, ps.clubs
  from t079_ev v cross join t079_stamp s
  left join public.hb_units o on o.id = v.org
  left join lateral public.hb_unit_territory(v.org) t on v.org is not null
  cross join lateral public.hb_event_players_scope(v.pids) ps
on conflict (id) do update
   set data = excluded.data, updated_at_client = excluded.updated_at_client, server_updated_at = excluded.server_updated_at,
       scope_dept = excluded.scope_dept, scope_club = excluded.scope_club, players_dept = excluded.players_dept, players_club = excluded.players_club
 where e.data ->> 'demoSeed' = 'selections-079' and not e.deleted and not (e.data ? 'updatedBy')
   and (e.data - 'updatedAt' - 'updatedAtServer' is distinct from excluded.data - 'updatedAt' - 'updatedAtServer'
        or e.scope_dept is distinct from excluded.scope_dept or e.players_dept is distinct from excluded.players_dept
        or e.players_club is distinct from excluded.players_club);

-- Stages de ce jeu qui ne sont plus à faire (passage précédent) : supprimés logiquement (jamais ceux d'un vrai compte).
update public.hb_events e set deleted = true, data = e.data || jsonb_build_object('deleted', true, 'updatedAt', s.ms),
       updated_at_client = s.ms, server_updated_at = clock_timestamp()
  from t079_stamp s
 where e.data ->> 'demoSeed' = 'selections-079' and not e.deleted and not (e.data ? 'updatedBy')
   and not exists (select 1 from t079_ev v where v.id = e.id);

select 'groupes de sélection (selections-079)' as quoi, count(*) as n from public.hb_groups where data ->> 'demoSeed' = 'selections-079' and not deleted
union all select '  dont déjà créés par l''appli (laissés tels quels) (info)', count(*) from t079_groupes x join public.hb_groups g on g.id = x.id where coalesce(g.data ->> 'demoSeed', '') <> 'selections-079'
union all select 'stages (selections-079)', count(*) from public.hb_events where data ->> 'demoSeed' = 'selections-079' and not deleted
union all select '  stages comité', count(*) from t079_ev where type = 'stage_comite'
union all select '  stages ligue', count(*) from t079_ev where type = 'stage_ligue'
union all select '  stages nationaux', count(*) from t079_ev where type = 'stage_national';

-- ---------- d) Contrôle ----------
-- Membres du jour par groupe (info), puis 0 attendu partout ailleurs.
with per as (
  select p.id, (p.data ->> 'birthDate')::date as naissance, coalesce(x.v ->> 'sex', p.data ->> 'sex') as sexe, x.n,
         x.v ->> 'level' as niveau, x.v ->> 'unitId' as unite, x.v ->> 'category' as cat,
         (x.v ->> 'from')::date as du, case when coalesce(x.v ->> 'to', '') ~ '^\d{4}-\d\d-\d\d$' then (x.v ->> 'to')::date end as au, x.v ->> 'exitReason' as motif
    from public.hb_players p cross join lateral jsonb_array_elements(case when jsonb_typeof(p.data -> 'selections') = 'array' then p.data -> 'selections' else '[]' end) with ordinality x(v, n)
   where not p.deleted and p.data ->> 'createdByName' = 'Administration Supabase (SQL)' and coalesce(x.v ->> 'from', '') ~ '^\d{4}-\d\d-\d\d$'
), age as (
  select per.*, extract(year from du)::int - case when extract(month from du) < 9 then 1 else 0 end - extract(year from naissance)::int as a from per
), stage as (
  select e.id, e.data ->> 'type' as t, (e.data ->> 'date')::date as d, e.data -> 'playerIds' as pids from public.hb_events e
   where not e.deleted and e.data ->> 'demoSeed' = 'selections-079'
)
select 'membres aujourd''hui ' || coalesce(cat, niveau) || ' ' || sexe || ' (info)' as controle, count(distinct id) as n
  from per where du <= current_date and coalesce(au, 'infinity') >= current_date group by niveau, cat, sexe
union all select 'periodes (info)', count(*) from per
union all select 'sortie_avant_entree', count(*) from per where au < du
union all select 'chevauchements_meme_groupe', count(*) from per a join per b on a.id = b.id and a.n < b.n and a.niveau = b.niveau
           and a.unite is not distinct from b.unite and a.cat is not distinct from b.cat and a.sexe = b.sexe and a.du <= coalesce(b.au, 'infinity') and b.du <= coalesce(a.au, 'infinity')
union all select 'entree_a_plus_d_un_an', count(*) from per where du > current_date + interval '1 year'
union all select 'comite_hors_13_ans', count(*) from age where niveau = 'comite' and a <> 13
union all select 'ligue_hors_14_ans', count(*) from age where niveau = 'ligue' and a <> 14
union all select 'france_hors_age', count(*) from age where niveau = 'france' and not (cat = 'U17' and a between 15 and 16 or cat = 'U19' and a between 17 and 18 or cat = 'U21' and a between 19 and 20)
union all select 'motif_non_neutre', count(*) from per where au is not null and coalesce(motif, '') not in ('fin_saison', 'categorie_superieure', 'blessure', 'autre')
union all select 'comite_ou_ligue_sans_unite', count(*) from per where niveau in ('comite', 'ligue') and not exists (select 1 from public.hb_units u where u.id = per.unite and not u.deleted)
union all select 'periode_sans_groupe', count(*) from per where not exists (select 1 from public.hb_groups g where not g.deleted
           and g.id = 'sel-' || per.niveau || '-' || lower(case per.niveau when 'france' then per.cat else per.unite end) || '-' || lower(per.sexe))
union all select 'stages_a_venir', count(*) from stage where d > current_date
union all select 'stage_avec_joueur_non_selectionne_ce_jour', count(*) from stage s cross join lateral jsonb_array_elements_text(s.pids) x(pid)
           where not exists (select 1 from per where per.id = x.pid and per.du <= s.d and coalesce(per.au, 'infinity') >= s.d
                               and per.niveau = case s.t when 'stage_comite' then 'comite' when 'stage_ligue' then 'ligue' else 'france' end)
union all select 'groupes_attendus_absents', count(*) from t079_groupes x where not exists (select 1 from public.hb_groups g where g.id = x.id and not g.deleted);
