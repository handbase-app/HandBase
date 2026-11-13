-- HandBase / Nextar : LECTURE EXACTE de nextar_lire dans la base, et JOURNAL DES APPELS du serveur MCP.
-- À exécuter dans Supabase > SQL Editor, APRÈS 071_provenance.sql (dépend de 029 hb_has_role, 043 hb_is_admin, 046 colonnes
-- scope_dept) : base de TEST d'abord (vérifier avec la requête de contrôle en fin de fichier), puis les autres. Peut être
-- relancé sans risque (create or replace, create … if not exists, drop policy if exists).
-- ADDITIF : ni colonne, ni index, ni déclencheur, ni UPDATE sur les tables synchronisées ; hb_upsert, hb_stamp, hb_log,
-- hb_touch et la synchronisation ne sont pas touchés (tools/essai-sql-072 compare l'empreinte de leur texte avant et après).
-- Le serveur MCP marche AVANT ce script : nextar_lire calcule alors côté serveur MCP sur 5 000 joueurs au plus et dit
-- « résultat approximatif tant que 072 n'est pas appliqué » au-delà ; les appels ne sont pas journalisés.
--
-- POURQUOI DANS LA BASE. Sous les règles de lecture (RLS), un filtre sur une clé de « data » (data->>'playerId') ne peut PAS
-- utiliser l'index hb_measurements_player : l'opérateur jsonb ->> n'est pas « leakproof », Postgres l'évalue donc APRÈS les
-- règles, sur toute la table. Chaque requête « mesures de ces 150 joueurs » du serveur MCP lisait ainsi les 145 000 mesures
-- (1 à 5 s chacune sur l'offre gratuite) ; une année de 5 000 joueurs en faisait 34 à la suite, la première a dépassé la
-- limite de 8 s du rôle authenticated (« canceling statement due to statement timeout », journal de la fonction du 07/11 à
-- 07:28 UTC : c'était l'« Erreur du serveur Nextar »). Ici : UNE lecture des mesures des tests utiles, jointe en mémoire
-- (hash), triée et limitée dans la base (ORDER BY … LIMIT), puis les détails des seules lignes rendues ; mesures, avis et
-- « vus » d'une page sont lus par l'index de scope_dept (colonne simple, utilisable sous RLS ; égale au département du
-- joueur, 046 la tient à jour sur chaque ligne).
--
-- 1) hb_mcp_num(jsonb) → numeric : valeur d'une mesure ou d'une note (nombre, ou texte « 31,5 » / « 1.86 ») ; sinon null.
-- 2) hb_mcp_lire(filtre jsonb) → jsonb, SECURITY INVOKER (les règles de lecture du compte s'appliquent : périmètre du coach,
--    tout pour un administrateur), STABLE, bornée. Filtres de nextar_lire (années, trimestres de naissance, nés entre deux
--    trimestres, sexe, postes, départements, joueurs d'un événement ou d'un groupe, mesures min / max, vus au moins, moyenne
--    d'avis au moins, moyenne par critère au moins), tri (année, vus, avis, test ; égalités départagées par l'identifiant),
--    limite (200 au plus). Rend { total, lignes: [{ id, annee, trimestre, sexe, poste, dept, vus, avis_nb, avis_moy, mesures:
--    { test: { v, d } }, criteres: { critere: moyenne } }] } : identifiant technique (le serveur MCP le change en code J-…),
--    JAMAIS un nom, un club, un commentaire ni la date de naissance (seulement l'année et le trimestre, calculés ici).
--    Mesure : dernière valeur du test par date (à date égale : identifiant le plus grand). Moyenne d'avis : notes des critères
--    score5 que donne le serveur MCP (nextar_contexte). Joueurs vivants : ni supprimés, ni fondus, ni hors cadre.
-- 3) Table hb_mcp_appels : un appel d'outil du serveur MCP par ligne (heure du serveur, compte, outil, durée, succès, nombre
--    de lignes rendues, filtres STRUCTURÉS seulement : années, trimestres, postes, identifiants de tests ou d'événements… ;
--    jamais les paramètres bruts, qui peuvent porter des noms). Écrite par le compte lui-même avec son jeton (règle : pour
--    soi, à l'heure du serveur) ; lue par les administrateurs seulement ; ni modification ni suppression ; un seul index
--    (heure). Purge : hb_mcp_appels_purger(90) efface les appels de plus de 90 jours ; tâche quotidienne dans « ACTIVATION »
--    (non lancée). Le serveur MCP écrit sans attendre ; une écriture refusée ou une table absente ne fait jamais échouer
--    l'outil.
-- Retour arrière : section « RETOUR ARRIÈRE » à la fin (commentée).

-- ---------- 0. Prérequis ----------
do $$
begin
  if to_regprocedure('public.hb_is_admin()') is null or to_regprocedure('public.hb_has_role()') is null
     or not exists (select 1 from pg_attribute where attrelid = 'public.hb_measurements'::regclass and attname = 'scope_dept' and not attisdropped) then
    raise exception '072 demande 029, 043 et 046 (hb_has_role, hb_is_admin, colonnes scope_dept) : passer d''abord les scripts d''avant.';
  end if;
end $$;

-- ---------- 1. Valeur numérique d'une mesure ou d'une note ----------
create or replace function public.hb_mcp_num(p_v jsonb) returns numeric
language sql immutable parallel safe set search_path = public, pg_temp as $$
  select case when jsonb_typeof(p_v) = 'number' then (p_v #>> '{}')::numeric
              when jsonb_typeof(p_v) = 'string' and btrim(p_v #>> '{}') ~ '^-?\d{1,12}([.,]\d{1,12})?$'
                then replace(btrim(p_v #>> '{}'), ',', '.')::numeric end
$$;
revoke all on function public.hb_mcp_num(jsonb) from public, anon;
grant execute on function public.hb_mcp_num(jsonb) to authenticated;

-- ---------- 2. nextar_lire dans la base ----------
create or replace function public.hb_mcp_lire(p_filtre jsonb) returns jsonb
language plpgsql stable security invoker
set search_path = public, pg_temp
-- Les règles de lecture font estimer 1 ligne à chaque table : sans ce réglage, Postgres choisit des boucles imbriquées
-- (5 000 × 34 000 comparaisons). Jointures par hachage ici seulement.
set enable_nestloop = off
as $$
declare
  f jsonb := coalesce(p_filtre, '{}'::jsonb);
  v_annees int[]; v_trims int[]; v_nes_de int; v_nes_a int; v_sexe text; v_postes text[]; v_depts text[]; v_depts_m text[];
  v_ids text[]; v_mes jsonb; v_vus_min int; v_avis_min numeric; v_avis_crit jsonb; v_score5 text[];
  v_tri text; v_tri_test text; v_desc boolean; v_limite int; v_sortie text[]; v_avec_crit boolean;
  v_tests_avant text[]; v_vus_avant boolean; v_avis_avant boolean;
  v_page text[]; v_total bigint; v_depts_page text[]; v_sans_dept boolean; v_lignes jsonb;
begin
  if jsonb_typeof(f) <> 'object' then
    raise exception 'hb_mcp_lire : filtre invalide (objet attendu)' using errcode = '22023';
  end if;
  begin
    v_annees := case when f ? 'annees' then array(select x::int from jsonb_array_elements_text(f -> 'annees') x) end;
    v_trims := case when f ? 'trimestres' then array(select x::int from jsonb_array_elements_text(f -> 'trimestres') x) end;
    v_nes_de := (f ->> 'nes_de')::int;
    v_nes_a := (f ->> 'nes_a')::int;
    v_sexe := f ->> 'sexe';
    v_postes := case when f ? 'postes' then array(select jsonb_array_elements_text(f -> 'postes')) end;
    v_depts := case when f ? 'depts' then array(select upper(x) from jsonb_array_elements_text(f -> 'depts') x) end;
    v_ids := case when f ? 'ids' then array(select jsonb_array_elements_text(f -> 'ids')) end;
    v_mes := case when jsonb_typeof(f -> 'mesures') = 'array' and jsonb_array_length(f -> 'mesures') > 0 then f -> 'mesures' end;
    v_vus_min := (f ->> 'vus_min')::int;
    v_avis_min := (f ->> 'avis_min')::numeric;
    v_avis_crit := case when jsonb_typeof(f -> 'avis_criteres') = 'array' and jsonb_array_length(f -> 'avis_criteres') > 0 then f -> 'avis_criteres' end;
    v_score5 := coalesce(array(select jsonb_array_elements_text(f -> 'score5')), '{}');
    v_tri := f #>> '{tri,par}';
    v_tri_test := f #>> '{tri,test}';
    v_desc := coalesce(f #>> '{tri,ordre}', case when v_tri = 'annee' then 'asc' else 'desc' end) = 'desc';
    v_limite := coalesce((f ->> 'limite')::int, 50);
    v_sortie := coalesce(array(select jsonb_array_elements_text(f -> 'sortie')), '{}');
    v_avec_crit := coalesce((f ->> 'avec_criteres')::boolean, false);
  exception when others then
    raise exception 'hb_mcp_lire : filtre invalide' using errcode = '22023';
  end;
  if v_limite not between 1 and 200 or coalesce(cardinality(v_annees), 0) > 20 or coalesce(cardinality(v_postes), 0) > 20
     or coalesce(cardinality(v_depts), 0) > 30 or coalesce(cardinality(v_ids), 0) > 20000 or cardinality(v_sortie) > 40
     or coalesce(jsonb_array_length(v_mes), 0) > 10 or coalesce(jsonb_array_length(v_avis_crit), 0) > 10 or cardinality(v_score5) > 200
     or (v_tri is not null and v_tri not in ('annee', 'vus', 'avis', 'test')) or (v_tri = 'test' and v_tri_test is null)
     or (v_sexe is not null and v_sexe not in ('M', 'F')) or exists (select 1 from unnest(v_trims) t where t not between 1 and 4) then
    raise exception 'hb_mcp_lire : filtre hors bornes' using errcode = '22023';
  end if;
  -- Ce qui doit être lu AVANT le tri : mesures des filtres et du tri, « vus », avis.
  v_tests_avant := array(select distinct x from (select e ->> 'test' as x from jsonb_array_elements(coalesce(v_mes, '[]')) e
                                                  union all select v_tri_test where v_tri = 'test') y where x is not null);
  v_vus_avant := v_vus_min is not null or v_tri = 'vus';
  v_avis_avant := v_avis_min is not null or v_avis_crit is not null or v_tri = 'avis';
  -- Départements tels qu'écrits sur les lignes (« 2A » ou « 2a ») : lecture des mesures par l'index de scope_dept.
  v_depts_m := case when v_depts is not null then v_depts || array(select lower(x) from unnest(v_depts) x) end;

  -- 1) Joueurs retenus, triés et limités DANS LA BASE.
  with pl as (
    select p.id,
           case when p.data ->> 'birthDate' ~ '^\d{4}' then left(p.data ->> 'birthDate', 4)::int end as annee,
           case when p.data ->> 'birthDate' ~ '^\d{4}-(0[1-9]|1[0-2])' then (substr(p.data ->> 'birthDate', 6, 2)::int + 2) / 3 end as trim,
           case when p.data ->> 'sex' in ('M', 'F') then p.data ->> 'sex' end as sexe,
           nullif(p.data ->> 'position', '') as poste,
           nullif(p.scope_dept, '') as dept
      from public.hb_players p
     where not p.deleted and coalesce(p.data ->> 'mergedInto', '') = '' and coalesce(p.data ->> 'review', '') <> 'refused'
       and (v_ids is null or p.id = any (v_ids))
       and (v_depts is null or upper(p.scope_dept) = any (v_depts))
  ), c as (
    select pl.* from pl
     where (v_annees is null or pl.annee = any (v_annees))
       and (v_trims is null or pl.trim = any (v_trims))
       and (v_nes_de is null or pl.annee * 10 + pl.trim >= v_nes_de)
       and (v_nes_a is null or pl.annee * 10 + pl.trim <= v_nes_a)
       and (v_sexe is null or pl.sexe = v_sexe)
       and (v_postes is null or pl.poste = any (v_postes))
  ), ms as (
    select distinct on (m.data ->> 'playerId', m.data ->> 'criterionId')
           m.data ->> 'playerId' as pid, m.data ->> 'criterionId' as cid, m.data -> 'value' as v, m.data ->> 'date' as d
      from public.hb_measurements m
     where cardinality(v_tests_avant) > 0 and not m.deleted and m.data ->> 'criterionId' = any (v_tests_avant)
       and (v_depts_m is null or m.scope_dept = any (v_depts_m))
       and coalesce(m.data ->> 'playerId', '') <> '' and coalesce(m.data ->> 'date', '') <> ''
       and jsonb_typeof(m.data -> 'value') in ('number', 'string')
     order by m.data ->> 'playerId', m.data ->> 'criterionId', m.data ->> 'date' desc, m.id desc
  ), mp as (
    select ms.pid, jsonb_object_agg(ms.cid, ms.v) as mj from ms group by ms.pid
  ), vu as (
    select s.data ->> 'playerId' as pid, count(distinct s.data ->> 'eventId') as n
      from public.hb_seen s
     where v_vus_avant and not s.deleted and (v_depts_m is null or s.scope_dept = any (v_depts_m))
       and coalesce(s.data ->> 'playerId', '') <> '' and coalesce(s.data ->> 'eventId', '') <> ''
     group by 1
  ), ev as (
    select e.data ->> 'playerId' as pid, case when jsonb_typeof(e.data -> 'scores') = 'object' then e.data -> 'scores' else '{}'::jsonb end as s
      from public.hb_evaluations e
     where v_avis_avant and not e.deleted and (v_depts_m is null or e.scope_dept = any (v_depts_m))
       and coalesce(e.data ->> 'review', '') <> 'refused' and coalesce(e.data ->> 'playerId', '') <> ''
  ), evs as (
    select ev.pid, k.key as cid, public.hb_mcp_num(k.value) as n from ev, jsonb_each(ev.s) k
  ), evm as (
    select evs.pid, round(avg(evs.n), 2) as moy from evs where evs.n is not null and evs.cid = any (v_score5) group by 1
  ), evc as (
    select z.pid, jsonb_object_agg(z.cid, z.m) as cj
      from (select evs.pid, evs.cid, round(avg(evs.n), 2) as m from evs where evs.n is not null group by 1, 2) z group by 1
  ), k as (
    select c.id, c.annee, mp.mj, coalesce(vu.n, 0) as vus, evm.moy, evc.cj
      from c left join mp on mp.pid = c.id left join vu on vu.pid = c.id left join evm on evm.pid = c.id left join evc on evc.pid = c.id
     where (v_mes is null or not exists (
              select 1 from jsonb_array_elements(v_mes) x
               where public.hb_mcp_num(mp.mj -> (x ->> 'test')) is null
                  or (x ? 'min' and public.hb_mcp_num(mp.mj -> (x ->> 'test')) < (x ->> 'min')::numeric)
                  or (x ? 'max' and public.hb_mcp_num(mp.mj -> (x ->> 'test')) > (x ->> 'max')::numeric)))
       and (v_vus_min is null or coalesce(vu.n, 0) >= v_vus_min)
       and (v_avis_min is null or evm.moy >= v_avis_min)
       and (v_avis_crit is null or not exists (
              select 1 from jsonb_array_elements(v_avis_crit) x
               where not coalesce((evc.cj ->> (x ->> 'critere'))::numeric >= (x ->> 'min')::numeric, false)))
  ), o as (
    select k.id,
           row_number() over (order by
             case when v_desc then case v_tri when 'annee' then k.annee::numeric when 'vus' then k.vus::numeric when 'avis' then k.moy
                                               when 'test' then public.hb_mcp_num(k.mj -> v_tri_test) end end desc nulls last,
             case when not v_desc then case v_tri when 'annee' then k.annee::numeric when 'vus' then k.vus::numeric when 'avis' then k.moy
                                                   when 'test' then public.hb_mcp_num(k.mj -> v_tri_test) end end asc nulls last,
             k.id collate "C") as rn,
           count(*) over () as total
      from k
  )
  select coalesce(array_agg(o.id order by o.rn) filter (where o.rn <= v_limite), '{}'::text[]), coalesce(max(o.total), 0)
    into v_page, v_total
    from o;

  if cardinality(v_page) = 0 then
    return jsonb_build_object('total', v_total, 'lignes', '[]'::jsonb);
  end if;

  -- 2) Détails des seules lignes rendues (200 au plus) : mesures demandées, « vus », avis ; par l'index de scope_dept.
  select array_agg(distinct p.scope_dept) filter (where coalesce(p.scope_dept, '') <> ''), bool_or(coalesce(p.scope_dept, '') = '')
    into v_depts_page, v_sans_dept
    from public.hb_players p where p.id = any (v_page);
  if coalesce(v_sans_dept, true) then v_depts_page := null; end if;

  with pg as (
    select p.id,
           case when p.data ->> 'birthDate' ~ '^\d{4}' then left(p.data ->> 'birthDate', 4)::int end as annee,
           case when p.data ->> 'birthDate' ~ '^\d{4}-(0[1-9]|1[0-2])' then (substr(p.data ->> 'birthDate', 6, 2)::int + 2) / 3 end as trim,
           case when p.data ->> 'sex' in ('M', 'F') then p.data ->> 'sex' end as sexe,
           nullif(p.data ->> 'position', '') as poste,
           nullif(p.scope_dept, '') as dept
      from public.hb_players p where p.id = any (v_page)
  ), ms as (
    select distinct on (m.data ->> 'playerId', m.data ->> 'criterionId')
           m.data ->> 'playerId' as pid, m.data ->> 'criterionId' as cid, m.data -> 'value' as v, m.data ->> 'date' as d
      from public.hb_measurements m
     where cardinality(v_sortie) > 0 and not m.deleted and m.data ->> 'criterionId' = any (v_sortie)
       and (v_depts_page is null or m.scope_dept = any (v_depts_page)) and m.data ->> 'playerId' = any (v_page)
       and coalesce(m.data ->> 'date', '') <> '' and jsonb_typeof(m.data -> 'value') in ('number', 'string')
     order by m.data ->> 'playerId', m.data ->> 'criterionId', m.data ->> 'date' desc, m.id desc
  ), mp as (
    select ms.pid, jsonb_object_agg(ms.cid, jsonb_build_object('v', ms.v, 'd', ms.d)) as mj from ms group by ms.pid
  ), vu as (
    select s.data ->> 'playerId' as pid, count(distinct s.data ->> 'eventId') as n
      from public.hb_seen s
     where not s.deleted and (v_depts_page is null or s.scope_dept = any (v_depts_page)) and s.data ->> 'playerId' = any (v_page)
       and coalesce(s.data ->> 'eventId', '') <> ''
     group by 1
  ), ev as (
    select e.data ->> 'playerId' as pid, case when jsonb_typeof(e.data -> 'scores') = 'object' then e.data -> 'scores' else '{}'::jsonb end as s
      from public.hb_evaluations e
     where not e.deleted and (v_depts_page is null or e.scope_dept = any (v_depts_page)) and e.data ->> 'playerId' = any (v_page)
       and coalesce(e.data ->> 'review', '') <> 'refused'
  ), evn as (
    select ev.pid, count(*) as nb from ev group by 1
  ), evs as (
    select ev.pid, k.key as cid, public.hb_mcp_num(k.value) as n from ev, jsonb_each(ev.s) k
  ), evm as (
    select evs.pid, round(avg(evs.n), 2) as moy from evs where evs.n is not null and evs.cid = any (v_score5) group by 1
  ), evc as (
    select z.pid, jsonb_object_agg(z.cid, z.m) as cj
      from (select evs.pid, evs.cid, round(avg(evs.n), 2) as m from evs where evs.n is not null group by 1, 2) z group by 1
  )
  select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
           'id', pg.id, 'annee', pg.annee, 'trimestre', pg.trim, 'sexe', pg.sexe, 'poste', pg.poste, 'dept', pg.dept,
           'vus', coalesce(vu.n, 0), 'avis_nb', coalesce(evn.nb, 0), 'avis_moy', evm.moy, 'mesures', mp.mj,
           'criteres', case when v_avec_crit then evc.cj end))
         order by array_position(v_page, pg.id))
    into v_lignes
    from pg left join mp on mp.pid = pg.id left join vu on vu.pid = pg.id left join evn on evn.pid = pg.id
            left join evm on evm.pid = pg.id left join evc on evc.pid = pg.id;

  return jsonb_build_object('total', v_total, 'lignes', coalesce(v_lignes, '[]'::jsonb));
end $$;
revoke all on function public.hb_mcp_lire(jsonb) from public, anon;
grant execute on function public.hb_mcp_lire(jsonb) to authenticated;

-- ---------- 3. Journal des appels du serveur MCP ----------
create table if not exists public.hb_mcp_appels (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  user_id uuid not null default auth.uid(),
  outil text not null check (outil ~ '^nextar_[a-z_]{1,40}$'),
  duree_ms integer check (duree_ms between 0 and 600000),
  ok boolean not null,
  nb_lignes integer check (nb_lignes between 0 and 1000000),
  filtres jsonb check (filtres is null or (jsonb_typeof(filtres) = 'object' and pg_column_size(filtres) <= 2048))
);
create index if not exists hb_mcp_appels_at on public.hb_mcp_appels (at);
alter table public.hb_mcp_appels enable row level security;
drop policy if exists "pour_soi" on public.hb_mcp_appels;
drop policy if exists "admin_lit" on public.hb_mcp_appels;
-- Écrire : pour soi seulement, à l'heure du serveur (pas d'appel antidaté ou daté du futur).
create policy "pour_soi" on public.hb_mcp_appels for insert to authenticated
  with check (user_id = (select auth.uid()) and at between now() - interval '1 minute' and now() + interval '1 minute');
-- Lire : administrateurs seulement. Ni modification ni suppression (aucune règle, aucun droit).
create policy "admin_lit" on public.hb_mcp_appels for select to authenticated using ((select public.hb_is_admin()));
revoke all on public.hb_mcp_appels from public, anon, authenticated;
grant select, insert on public.hb_mcp_appels to authenticated;

create or replace function public.hb_mcp_appels_purger(p_jours int default 90) returns bigint
language plpgsql security definer set search_path = public, pg_temp as $$
declare n bigint;
begin
  if p_jours is null or p_jours < 7 then
    raise exception 'hb_mcp_appels_purger : 7 jours au moins' using errcode = '22023';
  end if;
  delete from public.hb_mcp_appels where at < now() - make_interval(days => p_jours);
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.hb_mcp_appels_purger(int) from public, anon, authenticated;

-- ---------- Vérification ----------
-- Attendu : fonctions_3 = 3, lire_invoker = t, purge_definer = t, anon_0 = 0, appels_rls = t, regles_2 = 2,
-- ecriture_directe_0 = 0 (ni update ni delete pour authenticated), index_appels_1 = 1, colonnes_ajoutees_0 = 0,
-- index_ajoutes_0 = 0 ; puis le top 10 par taille des joueurs nés en 2013 calculé par hb_mcp_lire (lecture complète des
-- mesures de taille, quelques secondes), à comparer avec le calcul direct qui suit (mêmes 10 identifiants, même ordre).
select (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname in ('hb_mcp_num', 'hb_mcp_lire', 'hb_mcp_appels_purger')) as fonctions_3,
       (select not prosecdef from pg_proc where oid = 'public.hb_mcp_lire(jsonb)'::regprocedure) as lire_invoker,
       (select prosecdef from pg_proc where oid = 'public.hb_mcp_appels_purger(int)'::regprocedure) as purge_definer,
       (select count(*) from pg_proc p where pronamespace = 'public'::regnamespace and proname in ('hb_mcp_num', 'hb_mcp_lire', 'hb_mcp_appels_purger')
          and has_function_privilege('anon', p.oid, 'execute')) as anon_0,
       (select relrowsecurity from pg_class where oid = 'public.hb_mcp_appels'::regclass) as appels_rls,
       (select count(*) from pg_policies where tablename = 'hb_mcp_appels') as regles_2,
       (select count(*) from information_schema.role_table_grants where table_name = 'hb_mcp_appels' and grantee in ('authenticated', 'anon')
          and privilege_type in ('UPDATE', 'DELETE', 'TRUNCATE')) as ecriture_directe_0,
       (select count(*) from pg_indexes where tablename = 'hb_mcp_appels' and indexname <> 'hb_mcp_appels_pkey') as index_appels_1,
       (select count(*) from information_schema.columns where table_schema = 'public'
          and table_name in ('hb_measurements', 'hb_evaluations', 'hb_seen', 'hb_players', 'hb_events')
          and column_name in ('trimestre', 'annee', 'derniere_valeur')) as colonnes_ajoutees_0,
       (select count(*) from pg_indexes where schemaname = 'public'
          and tablename in ('hb_measurements', 'hb_evaluations', 'hb_seen', 'hb_players', 'hb_events')
          and indexdef ~ 'hb_mcp') as index_ajoutes_0;
select x ->> 'id' as id, x -> 'mesures' -> 'taille' ->> 'v' as taille
  from jsonb_array_elements(public.hb_mcp_lire('{"annees":[2013],"tri":{"par":"test","test":"taille","ordre":"desc"},"limite":10,"sortie":["taille"]}') -> 'lignes') x;
select id, taille from (
  select distinct on (m.data ->> 'playerId') m.data ->> 'playerId' as id, public.hb_mcp_num(m.data -> 'value') as taille
    from public.hb_measurements m join public.hb_players p on p.id = m.data ->> 'playerId'
   where not m.deleted and m.data ->> 'criterionId' = 'taille' and jsonb_typeof(m.data -> 'value') in ('number', 'string')
     and coalesce(m.data ->> 'date', '') <> '' and not p.deleted and p.data ->> 'birthDate' like '2013%'
     and coalesce(p.data ->> 'mergedInto', '') = '' and coalesce(p.data ->> 'review', '') <> 'refused'
   order by m.data ->> 'playerId', m.data ->> 'date' desc, m.id desc) z
 where taille is not null order by taille desc, id collate "C" limit 10;

-- ---------- RETOUR ARRIÈRE (à lancer seulement pour annuler ce script) ----------
-- Rien n'a été écrit dans les tables de données : retirer les fonctions et la table du journal suffit (tâche programmée
-- d'abord si elle a été lancée : select cron.unschedule('hb-mcp-appels-purge');).
-- drop function if exists public.hb_mcp_appels_purger(int);
-- drop function if exists public.hb_mcp_lire(jsonb);
-- drop function if exists public.hb_mcp_num(jsonb);
-- drop table if exists public.hb_mcp_appels;

-- ---------- ACTIVATION (plus tard, à la main) ----------
-- Purge quotidienne du journal des appels (90 jours gardés), à 03:17 UTC :
-- select cron.schedule('hb-mcp-appels-purge', '17 3 * * *', $$select public.hb_mcp_appels_purger(90)$$);
