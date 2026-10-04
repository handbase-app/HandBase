-- HandBase : listes modifiables (pour commencer : les régions).
-- À exécuter une fois dans Supabase > SQL Editor, APRÈS 018_suppression_referents.sql.
--
-- Les noms des régions ne sont plus écrits dans l'appli : ils sont dans la table hb_lists, et un
-- administrateur les modifie dans Réglages → Régions. Chaque groupe garde l'identifiant de sa région
-- (data.regionId) : renommer une région renomme automatiquement celle de tous les groupes.

-- ---------- Table ----------

create table if not exists public.hb_lists (
  id text primary key,
  data jsonb not null,
  updated_at_client bigint not null default 0,
  deleted boolean not null default false,
  server_updated_at timestamptz not null default clock_timestamp()
);
create index if not exists hb_lists_sua on public.hb_lists (server_updated_at);
alter table public.hb_lists enable row level security;
drop policy if exists "staff_read" on public.hb_lists;
create policy "staff_read" on public.hb_lists for select to authenticated using (true);

drop trigger if exists hb_touch on public.hb_lists;
create trigger hb_touch before insert or update on public.hb_lists
  for each row execute function public.hb_touch();
drop trigger if exists hb_stamp on public.hb_lists;
create trigger hb_stamp before insert or update on public.hb_lists
  for each row execute function public.hb_stamp();
drop trigger if exists hb_log on public.hb_lists;
create trigger hb_log after insert or update or delete on public.hb_lists
  for each row execute function public.hb_log();

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'hb_lists'
  ) then
    alter publication supabase_realtime add table public.hb_lists;
  end if;
end $$;

-- ---------- Régions de départ (modifiables ensuite dans l'appli) ----------

insert into public.hb_lists (id, data, updated_at_client)
select r.id, jsonb_build_object('id', r.id, 'kind', 'region', 'name', r.name, 'order', r.ord, 'updatedAt', 1), 1
  from (values
    ('region-ara', 'Auvergne-Rhône-Alpes', 1), ('region-bfc', 'Bourgogne-Franche-Comté', 2), ('region-bre', 'Bretagne', 3),
    ('region-cvl', 'Centre-Val de Loire', 4), ('region-cor', 'Corse', 5), ('region-ges', 'Grand Est', 6),
    ('region-hdf', 'Hauts-de-France', 7), ('region-idf', 'Île-de-France', 8), ('region-nor', 'Normandie', 9),
    ('region-naq', 'Nouvelle-Aquitaine', 10), ('region-occ', 'Occitanie', 11), ('region-pdl', 'Pays de la Loire', 12),
    ('region-sud', 'Région Sud', 13), ('region-om', 'Outre-mer', 14)
  ) as r(id, name, ord)
on conflict (id) do nothing;

-- ---------- Groupes : la région devient un identifiant ----------
-- (« Provence-Alpes-Côte d'Azur », quelle que soit son écriture, devient la Région Sud.)

update public.hb_groups g
   set data = (g.data - 'region') || jsonb_build_object(
         'regionId', coalesce(
           (select l.id from public.hb_lists l
             where l.data ->> 'kind' = 'region' and lower(l.data ->> 'name') = lower(g.data ->> 'region')),
           case when g.data ->> 'region' ilike 'provence%azur%' then 'region-sud' end),
         'updatedAt', (extract(epoch from clock_timestamp()) * 1000)::bigint),
       updated_at_client = (extract(epoch from clock_timestamp()) * 1000)::bigint
 where g.data ? 'region';

-- ---------- Journal : nom de la liste en clair ----------

create or replace function public.hb_summary(p_table text, p_data jsonb) returns text
language plpgsql stable security definer set search_path = public as $$
begin
  return case p_table
    when 'players' then trim(coalesce(p_data ->> 'firstName', '') || ' ' || coalesce(p_data ->> 'lastName', ''))
    when 'events' then p_data ->> 'name'
    when 'criteria' then p_data ->> 'label'
    when 'measurements' then coalesce(public.hb_player_name(p_data ->> 'playerId'), '?') || ' — '
      || coalesce(p_data ->> 'criterionId', '?') || ' = ' || coalesce(p_data ->> 'value', '?') || ' (' || coalesce(p_data ->> 'date', '') || ')'
    when 'evaluations' then coalesce(p_data ->> 'observer', '?') || ' → '
      || coalesce(public.hb_player_name(p_data ->> 'playerId'), '?')
    when 'groups' then p_data ->> 'name'
    when 'lists' then p_data ->> 'name'
    when 'referents' then trim(coalesce(p_data ->> 'firstName', '') || ' ' || coalesce(p_data ->> 'lastName', '')) || ' → '
      || coalesce(public.hb_player_name(p_data ->> 'playerId'), '?')
    else null
  end;
end $$;
revoke all on function public.hb_summary(text, jsonb) from public, anon;

-- ---------- Écritures (listes : administrateurs uniquement) ----------

-- Écrit les lignes autorisées (la plus récente gagne) et renvoie les identifiants refusés.
drop function if exists public.hb_upsert(text, jsonb);
create function public.hb_upsert(p_table text, p_rows jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_role text;
  v_name text;
  v_rejected jsonb := '[]'::jsonb;
  r jsonb;
  v_data jsonb;
  v_existing jsonb;
  v_existing_deleted boolean;
  v_deleting boolean;
  v_ok boolean;
  v_author boolean;
  v_reviewing boolean;
  v_decision boolean;
  v_review_keys text[] := array['review', 'reviewNote', 'reviewedBy', 'reviewedByName', 'reviewedAt'];
begin
  if v_uid is null then raise exception 'Connexion requise'; end if;
  if p_table not in ('players','criteria','measurements','events','evaluations','referents','groups','lists') then
    raise exception 'Table inconnue : %', p_table;
  end if;
  select role, coalesce(full_name, email) into v_role, v_name from public.hb_profiles where user_id = v_uid;
  v_role := coalesce(v_role, 'observateur');

  for r in select * from jsonb_array_elements(p_rows) loop
    v_data := r -> 'data';
    v_deleting := coalesce((r ->> 'deleted')::boolean, false);
    execute format('select data, deleted from public.hb_%1$s where id = $1', p_table)
      into v_existing, v_existing_deleted using r ->> 'id';
    -- L'auteur d'un avis : celui qui l'a écrit (ou qui l'écrit, pour un nouvel avis).
    v_author := coalesce(p_table = 'evaluations'
      and v_data ->> 'observerId' = v_uid::text
      and (v_existing is null or v_existing ->> 'observerId' = v_uid::text), false);
    -- Décision sur l'avis spontané d'un autre : l'avis enregistré fait foi, seule la décision change.
    v_reviewing := p_table = 'evaluations' and not v_author and not v_deleting and coalesce(v_existing ? 'review', false);
    -- Décision sur une fiche (proposée, validée ou hors cadre) par un encadrant ou un administrateur.
    v_decision := p_table = 'players' and not v_deleting and v_role in ('admin', 'preparateur')
      and coalesce(v_data ->> 'review', '') is distinct from coalesce(v_existing ->> 'review', '');

    v_ok := case
      -- Tout avis est rattaché à un événement ou à un contexte libre (sauf pour le supprimer).
      when p_table = 'evaluations' and not v_deleting and not v_reviewing
        and coalesce(v_data ->> 'eventId', '') = '' and coalesce(v_data ->> 'contextType', '') = '' then false
      -- Décisions : seulement dans son secteur (département du joueur).
      when v_reviewing then public.hb_can_review(v_uid,
        (select public.hb_player_dept(data) from public.hb_players where id = v_existing ->> 'playerId'))
      when v_decision then public.hb_can_review(v_uid, public.hb_player_dept(coalesce(v_existing, v_data)))
      -- Groupe privé : seul son créateur y touche (administrateur compris : il ne le voit même pas).
      when p_table = 'groups' and coalesce((v_existing ->> 'private')::boolean, false)
        and v_existing ->> 'createdBy' is distinct from v_uid::text then false
      when v_role = 'admin' then true
      -- Fiches : l'encadrant crée et modifie ; l'observateur propose une fiche et la modifie
      -- tant qu'elle n'est pas traitée. Personne d'autre que l'administrateur ne supprime.
      when p_table = 'players' then not v_deleting and (
        v_role = 'preparateur'
        or v_existing is null
        or (v_existing ->> 'createdBy' = v_uid::text and v_existing ->> 'review' = 'pending'))
      when p_table = 'measurements' then v_role = 'preparateur'
      -- Un encadrant ne modifie / supprime que ses propres événements
      -- (ou ceux sans créateur connu, créés avant le journal d'activité).
      when p_table = 'events' then v_role = 'preparateur'
        and (v_existing is null or coalesce(v_existing ->> 'createdBy', '') in ('', v_uid::text))
      when p_table = 'evaluations' then v_author
      -- Groupes : un encadrant crée les siens et ne modifie / supprime que ceux-là.
      -- Groupes : chacun gère les siens ; l'observateur seulement des groupes privés.
      when p_table = 'groups' then (v_existing is null or coalesce(v_existing ->> 'createdBy', '') in ('', v_uid::text))
        and (v_role = 'preparateur' or coalesce((v_data ->> 'private')::boolean, false))
      -- Référents : l'encadrant gère tout ; l'observateur seulement ceux qu'il a saisis.
      when p_table = 'referents' then v_role = 'preparateur'
        or v_existing is null or v_existing ->> 'createdBy' = v_uid::text
      else false -- critères et listes (régions…) : administrateurs uniquement
    end;

    -- Pas de décision sur un avis supprimé entre-temps (on le ferait réapparaître).
    if v_reviewing and v_existing_deleted then
      v_ok := false;
    end if;

    if not coalesce(v_ok, false) then
      v_rejected := v_rejected || to_jsonb(r ->> 'id');
      continue;
    end if;

    if p_table = 'evaluations' and not v_deleting then
      if v_reviewing then
        -- Décision d'un validateur : seuls la décision et son commentaire changent.
        v_data := (v_existing - v_review_keys - 'updatedAt') || jsonb_strip_nulls(jsonb_build_object(
          'updatedAt', v_data -> 'updatedAt',
          'review', case when v_data ->> 'review' in ('pending', 'validated', 'refused') then v_data ->> 'review' else v_existing ->> 'review' end,
          'reviewNote', nullif(trim(v_data ->> 'reviewNote'), ''),
          'reviewedBy', v_uid, 'reviewedByName', v_name, 'reviewedAt', now()));
      else
        -- Un avis est toujours signé du nom du compte qui l'écrit.
        if v_role <> 'admin' and v_name is not null then
          v_data := jsonb_set(v_data, '{observer}', to_jsonb(v_name));
        end if;
        if coalesce(v_data ->> 'eventId', '') <> '' then
          -- Avis sur un événement : pas de validation.
          v_data := v_data - v_review_keys;
        elsif v_existing is not null and v_existing ? 'review'
          and public.hb_eval_content(v_existing) = public.hb_eval_content(v_data)
          and (v_role = 'observateur' or v_existing ->> 'review' = 'validated') then
          -- Avis inchangé (simple renvoi) : la décision reste.
          v_data := (v_data - v_review_keys)
            || (select coalesce(jsonb_object_agg(key, value), '{}'::jsonb) from jsonb_each(v_existing) where key = any (v_review_keys));
        elsif v_role in ('admin', 'preparateur') then
          -- Avis spontané d'un encadrant ou d'un administrateur : validé d'office.
          v_data := (v_data - v_review_keys) || jsonb_build_object(
            'review', 'validated', 'reviewedBy', v_uid, 'reviewedByName', v_name, 'reviewedAt', now());
        else
          -- Avis spontané d'un observateur, nouveau ou modifié : en attente de validation.
          v_data := (v_data - v_review_keys) || jsonb_build_object('review', 'pending');
        end if;
      end if;
    end if;

    if p_table = 'players' and not v_deleting then
      if v_role = 'observateur' then
        -- Fiche proposée par un observateur : reste « proposée » jusqu'à la décision d'un encadrant.
        v_data := (v_data - v_review_keys) || jsonb_build_object('review', 'pending');
      elsif v_decision then
        -- Décision d'un encadrant ou d'un administrateur : signée par le serveur.
        v_data := (v_data - v_review_keys) || jsonb_strip_nulls(jsonb_build_object(
          'review', case when v_data ->> 'review' in ('pending', 'validated', 'refused') then v_data ->> 'review' end,
          'reviewNote', nullif(trim(v_data ->> 'reviewNote'), ''),
          'reviewedBy', v_uid, 'reviewedByName', v_name, 'reviewedAt', now()));
      else
        -- Pas de nouvelle décision : celle d'origine reste, quoi qu'envoie l'appareil.
        v_data := (v_data - v_review_keys)
          || (select coalesce(jsonb_object_agg(key, value), '{}'::jsonb) from jsonb_each(coalesce(v_existing, '{}'::jsonb)) where key = any (v_review_keys));
      end if;
    end if;

    execute format($f$
      insert into public.hb_%1$s (id, data, updated_at_client, deleted)
      values ($1, $2, $3, $4)
      on conflict (id) do update
        set data = excluded.data,
            updated_at_client = excluded.updated_at_client,
            deleted = excluded.deleted
        where public.hb_%1$s.updated_at_client <= excluded.updated_at_client
    $f$, p_table)
    using r ->> 'id', v_data, (r ->> 'updated_at_client')::bigint, v_deleting;
  end loop;

  return v_rejected;
end $$;

revoke all on function public.hb_upsert(text, jsonb) from public, anon;
grant execute on function public.hb_upsert(text, jsonb) to authenticated;

-- Vérification : les régions, et combien de groupes les utilisent.
select l.data ->> 'name' as region,
       (select count(*) from public.hb_groups g where not g.deleted and g.data ->> 'regionId' = l.id) as groupes
  from public.hb_lists l where l.data ->> 'kind' = 'region' and not l.deleted
 order by (l.data ->> 'order')::int;
