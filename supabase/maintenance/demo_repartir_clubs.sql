-- DÉMO UNIQUEMENT (HandBase-test, données fictives) : répartit les joueurs fictifs dans TOUS les vrais clubs de leur
-- département (après demo_vrais_clubs.sql, qui ne remplissait qu'un vrai club par club fictif : 10 clubs sur 28 dans le Var).
-- Chaque joueur reçoit un club de son département tiré au hasard (tirage fixe, lié à son identifiant) ; nom du club, n° de
-- club et licence suivent (n° du club + rang du joueur dans le club). Le département ne change pas.
-- Clubs lus dans la structure importée (hb_units), rien de la FFHB dans ce fichier. Déclencheurs coupés (ni journal ni
-- notification) ; la date serveur avance pour que les appareils reçoivent les changements. S'arrête sans rien modifier
-- si deux joueurs se retrouvaient avec la même licence.
begin;
set local session_replication_role = replica;

create temp table vrai on commit drop as
select data->>'clubNumber' num, data->>'name' nom,
       case left(data->>'clubNumber', 2)
         when '64' then '971' when '65' then '973' when '66' then '972' when '67' then '988' when '69' then '974' when '70' then '976'
         else substr(data->>'clubNumber', 3, 2)
       end dep
  from public.hb_units
 where not deleted and data->>'levelId' = 'niveau-club' and data->>'clubNumber' ~ '^\d{7}$'
   and substr(data->>'clubNumber', 3, 2) <> '00'
   and not (data->>'name' ilike any (array['%selection%', '%sélection%', '%groupement%', '%comite %', '%comité%', 'ligue %']));

create temp table v on commit drop as
select *, row_number() over (partition by dep order by num) - 1 k, count(*) over (partition by dep) nb from vrai;

-- Joueurs dont le club est un vrai club : nouveau club du même département, tiré par leur identifiant.
create temp table tirage on commit drop as
select p.id, d.dep, abs(hashtext(p.id || ':club')) % d.nb k, p.data->>'license' lic
  from public.hb_players p
  join vrai cur on cur.num = p.data->>'clubCode'
  join (select dep, max(nb) nb from v group by dep) d on d.dep = cur.dep
 where not p.deleted and p.data->>'license' ~ '^\d{13}$';

-- Licence : n° du nouveau club + un rang à 6 chiffres dans ce club (unique : des joueurs venus de clubs différents
-- pouvaient avoir la même fin de licence).
create temp table nouveau on commit drop as
select t.id, v.num, v.nom, v.num || lpad((row_number() over (partition by v.num order by t.lic))::text, 6, '0') lic
  from tirage t join v on v.dep = t.dep and v.k = t.k;

do $$
declare doublons int;
begin
  if (select count(*) from vrai) < 1000 then raise exception 'Structure pas importée.'; end if;
  select count(*) into doublons from (
    select lic from (select lic from nouveau
                     union all
                     select data->>'license' from public.hb_players p where not deleted and not exists (select 1 from nouveau n where n.id = p.id)) l
     group by lic having count(*) > 1) d;
  if doublons > 0 then raise exception '% licence(s) en double après le changement : rien n''est modifié.', doublons; end if;
end $$;

update public.hb_players p
   set data = p.data || jsonb_build_object('club', n.nom, 'clubCode', n.num, 'license', n.lic,
                                           'updatedAt', (extract(epoch from clock_timestamp()) * 1000)::bigint),
       updated_at_client = (extract(epoch from clock_timestamp()) * 1000)::bigint,
       server_updated_at = clock_timestamp()
  from nouveau n
 where n.id = p.id and p.data->>'clubCode' is distinct from n.num;
commit;

select count(distinct data->>'clubCode') clubs_avec_joueurs, count(*) joueurs from public.hb_players where not deleted;
