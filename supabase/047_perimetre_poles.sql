-- HandBase : périmètre d'un Pôle (complément de 046_perimetre.sql).
-- À exécuter une fois dans Supabase > SQL Editor, APRÈS 046 (base de test d'abord, puis la réelle). Peut être relancé.
--
-- Avec 046, un compte affecté à une unité SANS territoire (ni département ni club en dessous : un Pôle Espoirs, rangé sous
-- sa ligue) ne voyait aucun joueur. Désormais une telle unité prend le territoire de son parent le plus proche qui en a
-- un : le Pôle Aix-en-Provence → la Ligue Région Sud (ses départements). Même règle que l'appli (src/perimeter.ts,
-- perimeterOf). Le niveau « Fédération » reste lu sur l'unité où le compte est affecté (pas sur le parent atteint).
-- Rien d'autre ne change (règles de lecture, déclencheurs, colonnes : ceux de 046).

-- Une unité est-elle sans territoire (ni département ni n° de club dans son sous-arbre) ?
create or replace function public.hb_unit_empty(p_id text) returns boolean
language sql stable security definer set search_path = public as $$
  with recursive t (id, data, path) as (
    select u.id, u.data, array[u.id] from public.hb_units u where u.id = p_id and not u.deleted
    union all
    select c.id, c.data, t.path || c.id
      from t join public.hb_units c on c.data ->> 'parentId' = t.id and not c.deleted
     where c.id <> all (t.path) and cardinality(t.path) < 50
  )
  select not exists (
    select 1 from t
     where coalesce(btrim(t.data ->> 'clubNumber'), '') <> ''
        or exists (select 1 from jsonb_array_elements_text(public.hb_arr(t.data -> 'departments')) d(v) where btrim(d.v) <> '')
  )
$$;
revoke all on function public.hb_unit_empty(text) from public, anon, authenticated;

create or replace function public.hb_scope_of(p_uid uuid)
returns table (all_ boolean, depts text[], clubs text[])
language sql stable security definer set search_path = public as $$
  with recursive
  assigned as (
    select u.id, u.data
      from public.hb_assignments a
      join public.hb_units u on u.id = a.data ->> 'unitId' and not u.deleted
     where not a.deleted and a.data ->> 'userId' = p_uid::text
  ),
  -- Unité sans territoire (pôle) : on remonte vers le parent le plus proche qui en a un.
  up (start_id, id, data, depth) as (
    select x.id, x.id, x.data, 0 from assigned x
    union all
    select up.start_id, p.id, p.data, up.depth + 1
      from up
      join public.hb_units p on p.id = up.data ->> 'parentId' and not p.deleted
     where up.depth < 20 and public.hb_unit_empty(up.id)
  ),
  mine as (
    select distinct on (start_id) id, data from up order by start_id, depth desc
  ),
  tree (id, data, club_root, path) as (
    select m.id, m.data, coalesce(btrim(m.data ->> 'clubNumber'), '') <> '', array[m.id] from mine m
    union all
    select c.id, c.data, t.club_root, t.path || c.id
      from tree t
      join public.hb_units c on c.data ->> 'parentId' = t.id and not c.deleted
     where c.id <> all (t.path) and cardinality(t.path) < 50
  ),
  d as (
    select x.d
      from tree t cross join lateral jsonb_array_elements_text(public.hb_arr(t.data -> 'departments')) x(d)
     where not t.club_root
    union
    select public.hb_player_dept(jsonb_build_object('clubCode', btrim(t.data ->> 'clubNumber')))
      from tree t
     where not t.club_root and coalesce(btrim(t.data ->> 'clubNumber'), '') <> ''
  ),
  c as (
    select distinct btrim(t.data ->> 'clubNumber') as c
      from tree t
     where t.club_root and coalesce(btrim(t.data ->> 'clubNumber'), '') <> ''
  )
  select
    exists (select 1 from public.hb_profiles where user_id = p_uid and role = 'admin')
      or exists (select 1 from assigned m left join public.hb_levels l on l.id = m.data ->> 'levelId'
                  where m.data ->> 'levelId' = 'niveau-federation'
                     or translate(lower(coalesce(l.data ->> 'name', '')), 'éèêÉ', 'eeee') like 'federation%'),
    coalesce((select array_agg(distinct d.d order by d.d) from d where coalesce(d.d, '') <> ''), '{}'::text[]),
    coalesce((select array_agg(c.c order by c.c) from c), '{}'::text[])
$$;

-- Contrôle : périmètre de chaque compte affecté (départements, clubs).
select a.data ->> 'userId' as compte, u.data ->> 'name' as unite,
       (select cardinality(s.depts) from public.hb_scope_of((a.data ->> 'userId')::uuid) s) as departements,
       (select s.all_ from public.hb_scope_of((a.data ->> 'userId')::uuid) s) as tout
  from public.hb_assignments a join public.hb_units u on u.id = a.data ->> 'unitId'
 where not a.deleted;
