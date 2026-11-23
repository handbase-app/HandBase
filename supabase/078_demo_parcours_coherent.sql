-- HandBase / Nextar : DÉMO UNIQUEMENT (base hand de la maison, joueurs FICTIFS) — parcours cohérent sur les fiches.
-- Demandé par Geoffroy le 23/11/2026 : le parcours sous le nom (src/parcours.ts, src/components/Parcours.tsx) se lisait
-- « Repéré 2026 … Pôle 2024 » : les périodes de pôle de la démo commençaient avant toute observation (toutes de septembre à
-- novembre 2026), avec quelques dates impossibles (entrée à moins de 13 ans ou à plus de 18 ans, sortie avant l'entrée).
--
-- À passer avec outils/appliquer-sql.sh (serveur maison, pile hand ; il ajoute begin / commit). Rejouable sans dégâts : un
-- second passage ne change rien (même calcul, lignes déjà à jour laissées telles quelles). Ne touche QUE la démo :
--  - fiches : celles créées par l'import SQL de la démo (data.createdByName = 'Administration Supabase (SQL)'), et seulement
--    data.poles (et data.birthDate pour quelques fiches, voir b) ;
--  - lignes nouvelles marquées data.demoSeed = 'parcours-078' (événements et « vu ») ; une ligne de ce jeu modifiée ou
--    supprimée depuis par un vrai compte n'est jamais réécrite.
-- Déclencheurs coupés (ni journal, ni notification), comme supabase/maintenance/demo_*.sql et tools/seed-*.ts ; l'heure
-- serveur avance pour que les appareils reçoivent les lignes ; colonnes de périmètre écrites ici avec les fonctions du
-- serveur. Aucun nom de joueur, aucune donnée fédérale.
--
-- a) Périodes impossibles (fiches de la démo) :
--    - entrée hors 13–17 ans (âge exact à la date d'entrée), ou à plus d'un an dans le futur : entrée au 1er septembre de
--      l'année des 14 ans ; sortie : vide si le joueur est au pôle aujourd'hui (il y reste, jusqu'à la fin de sa Tle au plus
--      tard), sinon au 30 juin, 2 ou 3 saisons après l'entrée (passée, et avant la période suivante s'il y en a une) ;
--    - sortie avant l'entrée : si la sortie tient (une autre période commence juste après), c'est l'entrée qui est remise
--      (1er septembre de l'année des 14 ans) ; sinon, la sortie est recalculée comme ci-dessus ;
--    - jamais de chevauchement entre deux périodes du même joueur.
--    Les arrivées de la saison prochaine (changement de saison de l'appli, entrée au 1er juillet 2027) restent : moins d'un
--    an dans le futur, à un âge plausible, c'est une vraie fonction de l'appli (vue « Saison prochaine » du groupe Pôle).
-- b) Naissance :
--    - joueur 00e7cb1a-4227-4400-a7e2-cb0b9dd0db97 (U18 national, groupe Équipe de France) : né en 2009 (même jour et mois)
--      et une seule période de pôle, depuis le 1er septembre 2023 (année de ses 14 ans), en cours ;
--    - fiche trop jeune pour avoir un pôle (l'année de ses 14 ans est à plus d'un an d'ici) : naissance avancée pour que son
--      entrée tombe l'année de ses 14 ans (même jour et mois).
-- c) Saisons d'avant Nextar, pour chaque fiche de la démo qui a un pôle, toujours AVANT sa première entrée au pôle et datées
--    de 2021 à 2026 :
--    - Interligues (organisées par la ligue du club : palier « Ligue »), au printemps de l'année des 14 ans (13–14 ans) ;
--    - Intercomités (organisés par le comité du club : palier « Comité »), le printemps d'avant (12–13 ans) ;
--    - un tournoi des jeunes du département en janvier de la même saison (sans organisateur : palier « Repéré ») ;
--    un événement par comité ou ligue, saison et catégorie (garçons, filles), joueurs sur la liste, archivé (saisons
--    passées : rangé dans « Archivés », il compte toujours dans le parcours), et un « vu » par joueur, posé par l'équipe
--    technique de l'organisateur. Le parcours se lit alors Repéré → Comité → Ligue → Pôle, dans l'ordre des dates.
-- d) Contrôle en fin de fichier : tout à 0 (sauf les lignes « info »).
--
-- Sauvegarde des fiches avant changement : hors du dépôt (nextar-serveur/demenagement/sauvegardes/078_avant.jsonl).
-- Retour arrière : remettre data.poles / data.birthDate de la sauvegarde ; supprimer logiquement les lignes demoSeed =
-- 'parcours-078' de hb_events et hb_seen.

set local session_replication_role = replica;
set local statement_timeout = 0;
set local client_min_messages = warning;
-- Tables de travail (temporaires, effacées à la fin de la transaction) ; rejouable dans la même session.
drop table if exists t078_stamp, t078_joueurs, t078_base, t078_ev, t078_ev_data, t078_vus;
create temp table t078_stamp on commit drop as
  select (extract(epoch from now()) * 1000)::bigint as ms, now() as at, current_date as today, 'parcours-078'::text as marque;

-- ---------- a) et b) : périodes de pôle et naissances ----------

-- Âge exact (années révolues) à une date.
create or replace function pg_temp.p078_age(d date, naissance date) returns int language sql immutable as
$$ select extract(year from age(d, naissance))::int $$;

-- Même jour et mois, autre année (29 février → 28 février).
create or replace function pg_temp.p078_annee(d date, annee int) returns date language sql immutable as
$$ select make_date(annee, extract(month from d)::int,
                    least(extract(day from d)::int, case when extract(month from d) = 2 and not (annee % 4 = 0 and (annee % 100 <> 0 or annee % 400 = 0)) then 28 else 31 end)) $$;

-- Entrée à corriger : hors 13–17 ans, ou à plus d'un an dans le futur.
create or replace function pg_temp.p078_entree_ko(du date, naissance date, today date) returns boolean language sql immutable as
$$ select pg_temp.p078_age(du, naissance) < 13 or pg_temp.p078_age(du, naissance) >= 18 or du > today + interval '1 year' $$;

-- Naissance (b) : fiche trop jeune pour une entrée corrigée à 14 ans d'ici un an : naissance avancée (même jour et mois).
create or replace function pg_temp.p078_naissance(naissance date, poles jsonb, today date) returns date language plpgsql immutable as $f$
declare
  premier date;
begin
  select min((v ->> 'from')::date) into premier
    from jsonb_array_elements(poles) v
   where coalesce(v ->> 'from', '') ~ '^\d{4}-\d\d-\d\d$' and pg_temp.p078_entree_ko((v ->> 'from')::date, naissance, today);
  if premier is null or make_date(extract(year from naissance)::int + 14, 9, 1) <= today + interval '1 year' then return naissance; end if;
  return pg_temp.p078_annee(naissance, extract(year from premier)::int - 14);
end $f$;

-- Périodes (a) : seules les périodes impossibles changent, à leur place dans la liste ; les autres restent telles quelles.
create or replace function pg_temp.p078_poles(naissance date, poles jsonb, cle text, today date) returns jsonb language plpgsql immutable as $f$
declare
  r record;
  v jsonb;
  du date;
  au date;
  suivant date;
  fin_prec date := null;
  entree date;
  refaire_sortie boolean;
  touche boolean;
  saison int;
  k int;
  sortie date;
  out_v jsonb[] := array[]::jsonb[];
  n int := jsonb_array_length(poles);
  i int;
begin
  for i in 1 .. n loop out_v := out_v || (poles -> (i - 1)); end loop;
  for r in
    select x.v, x.ord::int as ord,
           lead(case when coalesce(x.v ->> 'from', '') ~ '^\d{4}-\d\d-\d\d$' then (x.v ->> 'from')::date end)
             over (order by (case when coalesce(x.v ->> 'from', '') ~ '^\d{4}-\d\d-\d\d$' then (x.v ->> 'from')::date end) nulls last, x.ord) as suivant
      from jsonb_array_elements(poles) with ordinality x(v, ord)
     where coalesce(x.v ->> 'from', '') ~ '^\d{4}-\d\d-\d\d$'
     order by (x.v ->> 'from')::date, x.ord
  loop
    v := r.v;
    du := (v ->> 'from')::date;
    au := case when coalesce(v ->> 'to', '') ~ '^\d{4}-\d\d-\d\d$' then (v ->> 'to')::date end;
    suivant := r.suivant;
    entree := make_date(extract(year from naissance)::int + 14, 9, 1);
    touche := false;
    refaire_sortie := false;
    if pg_temp.p078_entree_ko(du, naissance, today) then
      du := entree;
      touche := true;
      refaire_sortie := true;
    end if;
    if au is not null and au < du then
      if not touche and suivant is not null and suivant between au and au + 7 then
        -- La sortie tient (la période suivante commence juste après) : c'est l'entrée qui était fausse.
        du := case when entree < au then entree else make_date(extract(year from au)::int - 2, 9, 1) end;
        touche := true;
      else
        refaire_sortie := true;
      end if;
    end if;
    if fin_prec is not null and du <= fin_prec then
      du := fin_prec + 1;
      touche := true;
    end if;
    if refaire_sortie then
      saison := extract(year from du)::int - case when extract(month from du) < 7 then 1 else 0 end;
      k := 2 + abs(hashtext(cle || ':' || r.ord)) % 2;
      sortie := make_date(least(saison + k, extract(year from naissance)::int + 18), 6, 30);
      if sortie <= du then sortie := make_date(saison + 1, 6, 30); end if;
      if suivant is not null and suivant > du and sortie >= suivant then sortie := suivant - 1; end if;
      if suivant is not null and suivant > du then
        null;  -- une autre période suit : sortie juste avant elle (au plus tard)
      elsif au is null or au >= today then
        -- Au pôle aujourd'hui (ou arrivée prévue) : y reste, jusqu'à la fin de sa Tle au plus tard.
        if make_date(extract(year from naissance)::int + 18, 6, 30) >= today then sortie := null; end if;
      else
        -- Sorti avant aujourd'hui : sortie passée (le dernier 30 juin au plus tard), après l'entrée.
        if sortie >= today then sortie := make_date(extract(year from today)::int - case when extract(month from today) < 7 then 1 else 0 end, 6, 30); end if;
        if sortie <= du then sortie := case when au > du then au else du + 30 end; end if;
      end if;
      if sortie is null then
        v := v - 'to' - 'exitReason';
      else
        v := v || jsonb_build_object('to', to_char(sortie, 'YYYY-MM-DD'),
                                     'exitReason', case when au is not null and v ? 'exitReason' then v ->> 'exitReason' else 'fin_cursus' end);
      end if;
      au := sortie;
      touche := true;
    end if;
    if touche then
      v := v || jsonb_build_object('from', to_char(du, 'YYYY-MM-DD'));
      out_v[r.ord] := v;
    end if;
    fin_prec := coalesce(au, 'infinity'::date);
  end loop;
  return to_jsonb(out_v);
end $f$;

create temp table t078_joueurs on commit drop as
with demo as (
  select p.id, p.data as avant, (p.data ->> 'birthDate')::date as naissance, p.data -> 'poles' as poles
    from public.hb_players p
   where not p.deleted and p.data ->> 'createdByName' = 'Administration Supabase (SQL)'
     and jsonb_typeof(p.data -> 'poles') = 'array' and coalesce(p.data ->> 'birthDate', '') ~ '^\d{4}-\d\d-\d\d$'
), nais as (
  select d.*, case when d.id = '00e7cb1a-4227-4400-a7e2-cb0b9dd0db97' then pg_temp.p078_annee(d.naissance, 2009)
                   else pg_temp.p078_naissance(d.naissance, d.poles, s.today) end as naissance2, s.today
    from demo d, t078_stamp s
), calc as (
  select n.id, n.avant, n.naissance2,
         case when n.id = '00e7cb1a-4227-4400-a7e2-cb0b9dd0db97'
              -- b) une seule période, depuis l'année de ses 14 ans, en cours (même site et même ligue qu'avant).
              then jsonb_build_array(jsonb_strip_nulls(jsonb_build_object('regionId', n.poles -> 0 ->> 'regionId', 'site', n.poles -> 0 ->> 'site', 'from', '2023-09-01')))
              else pg_temp.p078_poles(n.naissance2, n.poles, n.id, n.today) end as poles2
    from nais n
)
select c.id, c.avant,
       c.avant || jsonb_build_object('birthDate', to_char(c.naissance2, 'YYYY-MM-DD'), 'poles', c.poles2) as apres
  from calc c
 where c.avant -> 'poles' is distinct from c.poles2 or c.avant ->> 'birthDate' is distinct from to_char(c.naissance2, 'YYYY-MM-DD');

-- Fiches changées : même règle que le serveur (hb_stamp) pour un passage en SQL : updatedBy gardé, updatedByName de l'import.
update public.hb_players p
   set data = j.apres || jsonb_build_object('updatedAt', s.ms, 'updatedByName', 'Administration Supabase (SQL)', 'updatedAtServer', s.at),
       updated_at_client = s.ms, server_updated_at = clock_timestamp()
  from t078_joueurs j, t078_stamp s
 where p.id = j.id and p.data = j.avant;

select 'fiches corrigées' as quoi, count(*) as n from t078_joueurs
union all select '  dont naissance changée', count(*) from t078_joueurs where avant ->> 'birthDate' <> apres ->> 'birthDate';

-- ---------- c) Saisons d'avant Nextar ----------

-- Une ligne par fiche de la démo qui a un pôle : première entrée, comité et ligue de son club, années des événements.
create temp table t078_base on commit drop as
with demo as (
  select p.id, p.scope_dept, coalesce(nullif(p.data ->> 'sex', ''), 'mixte') as sexe, (p.data ->> 'birthDate')::date as naissance,
         (select min((v ->> 'from')::date) from jsonb_array_elements(p.data -> 'poles') v where coalesce(v ->> 'from', '') ~ '^\d{4}-\d\d-\d\d$') as entree
    from public.hb_players p
   where not p.deleted and p.data ->> 'createdByName' = 'Administration Supabase (SQL)'
     and jsonb_typeof(p.data -> 'poles') = 'array' and coalesce(p.data ->> 'birthDate', '') ~ '^\d{4}-\d\d-\d\d$'
), avec as (
  select d.*, c.id as comite_id, l.id as ligue_id, l.data ->> 'name' as ligue_nom,
         -- Nom du département seul (« Comité Corse (20) » → « Corse ») : aucun mot qui changerait le palier du tournoi.
         btrim(regexp_replace(c.data ->> 'name', '^\s*comit[ée]s?\s+|\s*\([0-9]+\)\s*$', '', 'gi')) as comite_nom,
         -- Interligues : printemps de l'année des 14 ans, sinon le dernier printemps (31 mai) avant l'entrée ; jamais après 2026.
         least(case when make_date(extract(year from d.naissance)::int + 14, 5, 31) < d.entree then extract(year from d.naissance)::int + 14
                    when make_date(extract(year from d.entree)::int, 5, 31) < d.entree then extract(year from d.entree)::int
                    else extract(year from d.entree)::int - 1 end,
               2026) as an_ligue
    from demo d
    join lateral (select u.id, u.data from public.hb_units u
                   where not u.deleted and u.data ->> 'levelId' = 'niveau-comite' and u.data -> 'departments' ? d.scope_dept
                     and exists (select 1 from public.hb_units l where l.id = u.data ->> 'parentId' and not l.deleted and l.data ->> 'levelId' = 'niveau-ligue')
                   order by u.id limit 1) c on true
    join public.hb_units l on l.id = c.data ->> 'parentId'
   where d.entree is not null and d.sexe in ('M', 'F')
)
select a.*, a.an_ligue - 1 as an_comite from avec a where a.an_ligue >= 2021 and make_date(a.an_ligue, 5, 31) < a.entree;

-- Événements : un par organisateur, saison et catégorie. Date d'après la clé (un samedi) : Interligues en mai, Intercomités
-- en mars-avril, tournoi des jeunes en janvier ; toujours avant l'entrée de chaque joueur de la liste (voir t078_base).
create or replace function pg_temp.p078_samedi(d date) returns date language sql immutable as
$$ select d + ((6 - extract(isodow from d)::int + 7) % 7) $$;

create temp table t078_ev on commit drop as
with g as (
  select 'il:' || ligue_id || ':' || an_ligue || ':' || sexe as cle, 'Interligues' as quoi, ligue_id as unite, ligue_nom as unite_nom, an_ligue as an, sexe, id as pid
    from t078_base
  union all
  select 'ic:' || comite_id || ':' || an_comite || ':' || sexe, 'Intercomités', comite_id, comite_nom, an_comite, sexe, id
    from t078_base where an_comite >= 2021
  union all
  select 'tj:' || comite_id || ':' || an_comite || ':' || sexe, 'Tournoi des jeunes', comite_id, comite_nom, an_comite, sexe, id
    from t078_base where an_comite >= 2021
), e as (
  select g.cle, g.quoi, g.unite, g.unite_nom, g.an, g.sexe, jsonb_agg(g.pid order by g.pid) as pids
    from g group by 1, 2, 3, 4, 5, 6
)
select md5('nextar-078/evenement/' || e.cle)::uuid::text as id, e.*,
       pg_temp.p078_samedi(case e.quoi when 'Interligues' then make_date(e.an, 5, 1) when 'Intercomités' then make_date(e.an, 3, 1) else make_date(e.an, 1, 3) end
                           + 7 * (abs(hashtext(e.cle)) % case e.quoi when 'Intercomités' then 7 else 4 end)) as jour,
       md5('nextar-078/observateur/' || e.unite)::uuid::text as obs,
       case when e.quoi = 'Interligues' then 'Équipe technique de la ligue – ' else 'Équipe technique du comité – ' end || e.unite_nom as obs_nom
  from e;

create temp table t078_ev_data on commit drop as
select v.id, v.unite, v.pids,
       jsonb_build_object(
         'id', v.id,
         'name', v.quoi || ' ' || (v.an - 1) || '-' || v.an || ' ' || case v.sexe when 'F' then 'filles' else 'garçons' end || ' – ' || v.unite_nom,
         'type', 'tournoi', 'date', to_char(v.jour, 'YYYY-MM-DD'), 'time', '10:00', 'place', v.unite_nom, 'sex', v.sexe,
         'playerIds', v.pids, 'archived', true,
         'createdByName', 'Administration Supabase (SQL)', 'createdAtServer', to_char(v.jour - 21, 'YYYY-MM-DD') || 'T10:00:00+00:00',
         'updatedByName', 'Administration Supabase (SQL)', 'demoSeed', s.marque)
       || case when v.quoi = 'Tournoi des jeunes' then '{}'::jsonb else jsonb_build_object('organizerUnitId', v.unite, 'organizerName', v.unite_nom) end as data
  from t078_ev v, t078_stamp s;

-- Écriture : nouvelles lignes, ou lignes de ce jeu à remettre à jour (jamais une ligne modifiée ou supprimée par un vrai compte).
insert into public.hb_events as e (id, data, updated_at_client, deleted, server_updated_at, scope_dept, scope_club, players_dept, players_club)
select d.id, d.data || jsonb_build_object('updatedAt', s.ms, 'updatedAtServer', s.at), s.ms, false, clock_timestamp(),
       t.depts, t.clubs, ps.depts, ps.clubs
  from t078_ev_data d cross join t078_stamp s
  left join lateral public.hb_unit_territory(d.data ->> 'organizerUnitId') t on d.data ? 'organizerUnitId'
  cross join lateral public.hb_event_players_scope(d.pids) ps
on conflict (id) do update
   set data = excluded.data, updated_at_client = excluded.updated_at_client, server_updated_at = excluded.server_updated_at,
       scope_dept = excluded.scope_dept, scope_club = excluded.scope_club, players_dept = excluded.players_dept, players_club = excluded.players_club
 where e.data ->> 'demoSeed' = 'parcours-078' and not e.deleted and not (e.data ? 'updatedBy')
   and (e.data - 'updatedAt' - 'updatedAtServer' is distinct from excluded.data - 'updatedAt' - 'updatedAtServer'
        or e.scope_dept is distinct from excluded.scope_dept or e.players_dept is distinct from excluded.players_dept
        or e.players_club is distinct from excluded.players_club);

-- « Vu » : un par joueur et par événement, par l'équipe technique de l'organisateur, le jour de l'événement.
create temp table t078_vus on commit drop as
select v.obs || ':' || v.id || ':' || x.pid as id, v.id as eid, x.pid, v.obs, v.obs_nom,
       to_char(v.jour, 'YYYY-MM-DD') || 'T' || lpad((9 + abs(hashtext(v.id || x.pid)) % 7)::text, 2, '0') || ':' || lpad((abs(hashtext(x.pid || v.id)) % 60)::text, 2, '0') || ':00+00:00' as at
  from t078_ev v cross join lateral jsonb_array_elements_text(v.pids) x(pid);

insert into public.hb_seen as t (id, data, updated_at_client, deleted, server_updated_at, scope_dept, scope_club)
select w.id,
       jsonb_build_object('id', w.id, 'eventId', w.eid, 'playerId', w.pid, 'at', w.at,
                          'createdBy', w.obs, 'createdByName', w.obs_nom, 'createdAtServer', w.at,
                          'updatedBy', w.obs, 'updatedByName', w.obs_nom, 'updatedAtServer', w.at,
                          'updatedAt', (extract(epoch from w.at::timestamptz) * 1000)::bigint, 'demoSeed', s.marque),
       (extract(epoch from w.at::timestamptz) * 1000)::bigint, false, clock_timestamp(), p.scope_dept, p.scope_club
  from t078_vus w cross join t078_stamp s join public.hb_players p on p.id = w.pid
on conflict (id) do update
   set data = excluded.data, updated_at_client = excluded.updated_at_client, server_updated_at = excluded.server_updated_at,
       scope_dept = excluded.scope_dept, scope_club = excluded.scope_club
 where t.data ->> 'demoSeed' = 'parcours-078' and not t.deleted
   and (t.data is distinct from excluded.data or t.scope_dept is distinct from excluded.scope_dept or t.scope_club is distinct from excluded.scope_club);

-- Lignes de ce jeu qui ne sont plus à faire (passage précédent, fiche changée depuis) : supprimées logiquement.
update public.hb_seen t set deleted = true, data = t.data || jsonb_build_object('deleted', true, 'updatedAt', s.ms),
       updated_at_client = s.ms, server_updated_at = clock_timestamp()
  from t078_stamp s
 where t.data ->> 'demoSeed' = 'parcours-078' and not t.deleted and not exists (select 1 from t078_vus w where w.id = t.id);
update public.hb_events e set deleted = true, data = e.data || jsonb_build_object('deleted', true, 'updatedAt', s.ms),
       updated_at_client = s.ms, server_updated_at = clock_timestamp()
  from t078_stamp s
 where e.data ->> 'demoSeed' = 'parcours-078' and not e.deleted and not (e.data ? 'updatedBy')
   and not exists (select 1 from t078_ev v where v.id = e.id);

select 'événements (parcours-078)' as quoi, count(*) as n from public.hb_events where data ->> 'demoSeed' = 'parcours-078' and not deleted
union all select '  Interligues', count(*) from t078_ev where quoi = 'Interligues'
union all select '  Intercomités', count(*) from t078_ev where quoi = 'Intercomités'
union all select '  tournois des jeunes', count(*) from t078_ev where quoi = 'Tournoi des jeunes'
union all select '« vu » (parcours-078)', count(*) from public.hb_seen where data ->> 'demoSeed' = 'parcours-078' and not deleted
union all select 'fiches avec un pôle sans événement ajouté', (select count(*) from public.hb_players p
   where not p.deleted and p.data ->> 'createdByName' = 'Administration Supabase (SQL)' and jsonb_typeof(p.data -> 'poles') = 'array'
     and exists (select 1 from jsonb_array_elements(p.data -> 'poles') v where coalesce(v ->> 'from', '') ~ '^\d{4}-\d\d-\d\d$')
     and not exists (select 1 from t078_base b where b.id = p.id));

-- ---------- d) Contrôle ----------
-- Attendu : 0 partout, sauf les lignes « (info) ». Palier d'un événement : même règle que src/parcours.ts (palierOf).
with demo as (
  select p.id, (p.data ->> 'birthDate')::date as naissance, p.data -> 'poles' as poles
    from public.hb_players p
   where not p.deleted and p.data ->> 'createdByName' = 'Administration Supabase (SQL)'
     and jsonb_typeof(p.data -> 'poles') = 'array' and coalesce(p.data ->> 'birthDate', '') ~ '^\d{4}-\d\d-\d\d$'
), per as (
  select d.id, d.naissance, x.n, (x.v ->> 'from')::date as du, case when coalesce(x.v ->> 'to', '') ~ '^\d{4}-\d\d-\d\d$' then (x.v ->> 'to')::date end as au
    from demo d cross join lateral jsonb_array_elements(d.poles) with ordinality x(v, n)
   where coalesce(x.v ->> 'from', '') ~ '^\d{4}-\d\d-\d\d$'
), mots as (
  select e.id, e.data ->> 'date' as d, e.data ->> 'type' as t, e.data -> 'playerIds' as pids, e.deleted, e.data ->> 'demoSeed' as marque,
         ' ' || trim(regexp_replace(translate(lower(coalesce(e.data ->> 'name', '')), 'àâäáãéèêëíìîïóòôöõúùûüçñ', 'aaaaaeeeeiiiiooooouuuucn'), '[^a-z0-9]+', ' ', 'g')) || ' ' as nom,
         ' ' || trim(regexp_replace(translate(lower(coalesce(e.data ->> 'organizerName', '')), 'àâäáãéèêëíìîïóòôöõúùûüçñ', 'aaaaaeeeeiiiiooooouuuucn'), '[^a-z0-9]+', ' ', 'g')) || ' ' as org,
         u.data ->> 'levelId' as niveau, nullif(e.data ->> 'organizerUnitId', '') as unite
    from public.hb_events e left join public.hb_units u on u.id = e.data ->> 'organizerUnitId'
), pal as (
  select m.*, case
      when m.t = 'match' then 'repere'
      when m.niveau in ('niveau-ligue', 'niveau-pole') then 'ligue'
      when m.niveau = 'niveau-comite' then 'comite'
      when m.niveau = 'niveau-federation' then 'france'
      when m.niveau = 'niveau-club' then 'repere'
      else coalesce(
        case when m.unite is not null then case
          when m.org ~ ' inter ?comites? ' then 'comite' when m.org ~ ' inter ?ligues? ' then 'ligue'
          when m.org ~ ' (france|federal|federale|federaux|ffhb|ffvb|edf) ' then 'france'
          when m.org ~ ' (ligues?|regional|regionale|regionaux|cre) ' then 'ligue'
          when m.org ~ ' (comites?|cd[0-9]*|departemental|departementale|departementaux) ' then 'comite' end end,
        case
          when m.nom ~ ' inter ?comites? ' then 'comite' when m.nom ~ ' inter ?ligues? ' then 'ligue'
          when m.nom ~ ' (france|federal|federale|federaux|ffhb|ffvb|edf) ' then 'france'
          when m.nom ~ ' (ligues?|regional|regionale|regionaux|cre) ' then 'ligue'
          when m.nom ~ ' (comites?|cd[0-9]*|departemental|departementale|departementaux) ' then 'comite' end,
        'repere') end as palier
    from mots m
), lien as (  -- événements du joueur : « vu », avis, ou sur la liste (hors match), comme src/parcours.ts
  select s.data ->> 'playerId' as pid, s.data ->> 'eventId' as eid from public.hb_seen s where not s.deleted
  union select v.data ->> 'playerId', v.data ->> 'eventId' from public.hb_evaluations v where not v.deleted and v.data ? 'eventId'
  union select x.pid, p.id from pal p cross join lateral jsonb_array_elements_text(case when jsonb_typeof(p.pids) = 'array' then p.pids else '[]' end) x(pid)
         where not p.deleted and p.t <> 'match'
), ligue_avant as (
  select distinct r.id, r.n from per r
    join lien l on l.pid = r.id join pal p on p.id = l.eid
   where not p.deleted and p.palier = 'ligue' and p.d <= to_char(current_date, 'YYYY-MM-DD') and p.d < to_char(r.du, 'YYYY-MM-DD')
), ajout_apres as (  -- événements de ce jeu à la date de l'entrée au pôle ou après (doit être 0)
  select distinct l.pid, p.id from pal p join lien l on l.eid = p.id
    join (select id, min(du) as entree from per group by id) f on f.id = l.pid
   where p.marque = 'parcours-078' and not p.deleted and p.d >= to_char(f.entree, 'YYYY-MM-DD')
)
select 'entree_hors_12_18_ans' as controle, count(*) as n from per where age(du, naissance) < interval '12 years' or age(du, naissance) >= interval '18 years'
union all select 'sortie_avant_entree', count(*) from per where au < du
union all select 'chevauchements', count(*) from per a join per b on a.id = b.id and a.n < b.n
           and a.du <= coalesce(b.au, 'infinity') and b.du <= coalesce(a.au, 'infinity')
union all select 'entree_a_plus_d_un_an', count(*) from per where du > current_date + interval '1 year'
union all select 'pole_sans_ligue_avant', count(*) from per r where not exists (select 1 from ligue_avant l where l.id = r.id and l.n = r.n)
union all select 'evenements_078_apres_entree', count(*) from ajout_apres
union all select 'evenements_078_hors_2021_2026', count(*) from pal where marque = 'parcours-078' and not deleted and (d < '2021-01-01' or d > '2026-12-31' or d > to_char(current_date, 'YYYY-MM-DD'))
union all select 'evenements_078_mauvais_palier', count(*) from pal where marque = 'parcours-078' and not deleted
           and palier <> case when nom like ' interligues %' then 'ligue' when nom like ' intercomites %' then 'comite' else 'repere' end
union all select 'entree_hors_13_17_ans (info)', count(*) from per where age(du, naissance) < interval '13 years' or age(du, naissance) >= interval '18 years'
union all select 'entree_dans_le_futur (info)', count(*) from per where du > current_date
union all select 'periodes (info)', count(*) from per;
