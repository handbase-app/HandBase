-- DÉMO UNIQUEMENT (HandBase-test, données fictives) : les joueurs fictifs passent dans les VRAIS clubs de la structure.
-- À lancer APRÈS « Importer une structure (CSV) » (Réglages → Structure et sport) : les clubs sont lus dans hb_units
-- (niveau Club, n° d'affiliation), rien de la FFHB n'est écrit dans ce fichier.
--
-- Chaque club fictif (n° à 7 chiffres des joueurs) devient un vrai club du MÊME département (chiffres 3-4 du n°) :
-- tous ses joueurs le suivent (nom du club, n° de club, et les 7 premiers chiffres de la licence ; le reste de la licence
-- est gardé). Clubs fictifs « 97 » (outre-mer non précisé) : répartis dans les clubs ultramarins (ligues 64 à 70).
-- Plus de clubs fictifs que de vrais dans un département (Paris) : le surplus va dans un club de la même ligue pas encore pris.
-- Noms et prénoms, avis, mesures, pôles : inchangés. Déclencheurs coupés (ni journal ni notification) ; la date serveur
-- avance pour que les appareils reçoivent les changements. Refuse de tourner sur une base sans structure importée, et
-- s'arrête si deux joueurs se retrouvaient avec la même licence.
begin;
set local session_replication_role = replica;

-- Département d'un n° de club FFHB : chiffres 3-4 ; clubs ultramarins (n° de ligue 64 à 70) : le département du territoire.
create temp table vrai on commit drop as
select data->>'clubNumber' num, data->>'name' nom, left(data->>'clubNumber', 2) ligue,
       case left(data->>'clubNumber', 2)
         when '64' then '971' when '65' then '973' when '66' then '972' when '67' then '988' when '69' then '974' when '70' then '976'
         else substr(data->>'clubNumber', 3, 2)
       end dep
  from public.hb_units
 where not deleted and data->>'levelId' = 'niveau-club' and data->>'clubNumber' ~ '^\d{7}$'
   and substr(data->>'clubNumber', 3, 2) <> '00'                                  -- groupements d'employeurs, structures de ligue
   and not (data->>'name' ilike any (array['%selection%', '%sélection%', '%groupement%', '%comite %', '%comité%', 'ligue %']));

do $$ begin
  if (select count(*) from vrai) < 1000 then
    raise exception 'Structure pas importée (% clubs) : importer d''abord le fichier dans Réglages → Structure et sport.', (select count(*) from vrai);
  end if;
end $$;

-- Groupe de tirage : le département ; « OM » pour tout l'outre-mer.
create temp table v on commit drop as
select *, case when length(dep) = 3 then 'OM' else dep end grp,
       row_number() over (partition by case when length(dep) = 3 then 'OM' else dep end order by md5(num)) rn,
       count(*) over (partition by case when length(dep) = 3 then 'OM' else dep end) nb
  from vrai;

create temp table faux on commit drop as
select code, n, grp, row_number() over (partition by grp order by n desc, code) rn
  from (select data->>'clubCode' code, count(*) n,
               case when substr(data->>'clubCode', 3, 2) = '97' then 'OM' else substr(data->>'clubCode', 3, 2) end grp
          from public.hb_players
         where not deleted and data->>'clubCode' ~ '^\d{7}$'
           and not exists (select 1 from vrai where vrai.num = hb_players.data->>'clubCode')   -- déjà dans un vrai club : on n'y touche pas
         group by 1, 3) x;

-- 1) Un vrai club du même département, différent pour chaque club fictif.
create temp table corresp on commit drop as
select f.code, v.num, v.nom
  from faux f join v on v.grp = f.grp and v.rn = f.rn;

-- 2) Surplus (plus de clubs fictifs que de vrais dans le département) : un club libre de la même ligue.
insert into corresp
select s.code, l.num, l.nom
  from (select f.code, (select v.ligue from v where v.grp = f.grp limit 1) ligue,
               row_number() over (partition by (select v.ligue from v where v.grp = f.grp limit 1) order by f.n desc, f.code) k
          from faux f where not exists (select 1 from corresp c where c.code = f.code)) s
  join (select v.num, v.nom, v.ligue, row_number() over (partition by v.ligue order by md5(v.num)) k
          from v where not exists (select 1 from corresp c where c.num = v.num)) l
    on l.ligue = s.ligue and l.k = s.k;

do $$
declare reste int; doublons int;
begin
  select count(*) into reste from faux f where not exists (select 1 from corresp c where c.code = f.code);
  if reste > 0 then raise exception '% club(s) fictif(s) sans vrai club correspondant : rien n''est modifié.', reste; end if;
  select count(*) into doublons from (
    select c.num || right(p.data->>'license', 6)
      from public.hb_players p join corresp c on c.code = p.data->>'clubCode'
     where not p.deleted
     group by 1 having count(*) > 1) d;
  if doublons > 0 then raise exception '% licence(s) en double après le changement : rien n''est modifié.', doublons; end if;
end $$;

update public.hb_players p
   set data = p.data || jsonb_build_object(
         'club', c.nom,
         'clubCode', c.num,
         'license', c.num || right(p.data->>'license', 6),
         'updatedAt', (extract(epoch from clock_timestamp()) * 1000)::bigint),
       updated_at_client = (extract(epoch from clock_timestamp()) * 1000)::bigint,
       server_updated_at = clock_timestamp()
  from corresp c
 where not p.deleted and p.data->>'clubCode' = c.code and p.data->>'license' ~ '^\d{13}$';

select (select count(*) from corresp) clubs_fictifs_remplaces,
       (select count(distinct num) from corresp) vrais_clubs_utilises,
       (select count(*) from public.hb_players p join vrai on vrai.num = p.data->>'clubCode' where not p.deleted) joueurs_dans_un_vrai_club,
       (select count(*) from public.hb_players where not deleted) joueurs;
commit;
