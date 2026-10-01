-- HandBase : rôles du staff (administrateur, encadrant, observateur).
-- À exécuter une fois dans Supabase > SQL Editor, APRÈS schema.sql.
--
--  admin        : tout, y compris les critères, les suppressions de joueurs et les rôles.
--  preparateur  : (affiché « Encadrant » dans l'appli) joueurs (sans les supprimer), mesures, événements, ses propres avis.
--  observateur  : lecture de tout, ses propres avis, création d'événements.
--
-- Les droits sont vérifiés ici, côté serveur : l'appli ne fait que masquer les boutons.

-- ---------- Profils ----------

create table if not exists public.hb_profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  email text,
  full_name text,
  role text not null default 'observateur' check (role in ('admin', 'preparateur', 'observateur')),
  created_at timestamptz not null default now()
);
alter table public.hb_profiles enable row level security;
drop policy if exists "staff_read" on public.hb_profiles;
create policy "staff_read" on public.hb_profiles for select to authenticated using (true);
-- Aucune politique d'écriture : les rôles ne changent que via hb_set_role().

-- Profil créé automatiquement pour chaque nouveau compte (observateur par défaut).
create or replace function public.hb_on_user_created() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.hb_profiles (user_id, email, full_name)
  values (new.id, new.email, new.raw_user_meta_data ->> 'full_name')
  on conflict (user_id) do nothing;
  return new;
end $$;
drop trigger if exists hb_on_user_created on auth.users;
create trigger hb_on_user_created after insert on auth.users
  for each row execute function public.hb_on_user_created();

-- Nom et e-mail tenus à jour quand le compte change.
create or replace function public.hb_on_user_updated() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.hb_profiles
     set email = new.email, full_name = new.raw_user_meta_data ->> 'full_name'
   where user_id = new.id;
  return new;
end $$;
drop trigger if exists hb_on_user_updated on auth.users;
create trigger hb_on_user_updated after update of email, raw_user_meta_data on auth.users
  for each row execute function public.hb_on_user_updated();

-- Comptes existants : un profil chacun ; le plus ancien compte devient administrateur.
insert into public.hb_profiles (user_id, email, full_name, created_at)
select id, email, raw_user_meta_data ->> 'full_name', created_at from auth.users
on conflict (user_id) do nothing;
update public.hb_profiles set role = 'admin'
 where user_id = (select id from auth.users order by created_at limit 1)
   and not exists (select 1 from public.hb_profiles where role = 'admin');

-- ---------- Changement de rôle (administrateurs uniquement) ----------

create or replace function public.hb_set_role(p_user uuid, p_role text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if (select role from public.hb_profiles where user_id = auth.uid()) is distinct from 'admin' then
    raise exception 'Réservé aux administrateurs';
  end if;
  if p_role not in ('admin', 'preparateur', 'observateur') then
    raise exception 'Rôle inconnu : %', p_role;
  end if;
  if p_role <> 'admin'
     and (select role from public.hb_profiles where user_id = p_user) = 'admin'
     and (select count(*) from public.hb_profiles where role = 'admin') <= 1 then
    raise exception 'Il doit rester au moins un administrateur';
  end if;
  update public.hb_profiles set role = p_role where user_id = p_user;
end $$;

-- ---------- Données : lecture pour tous, écriture via hb_upsert uniquement ----------

do $$
declare t text;
begin
  foreach t in array array['players','criteria','measurements','events','evaluations'] loop
    execute format('drop policy if exists "staff_all" on public.hb_%1$s;
      drop policy if exists "staff_read" on public.hb_%1$s;
      create policy "staff_read" on public.hb_%1$s for select to authenticated using (true);', t);
  end loop;
end $$;

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
  v_deleting boolean;
  v_ok boolean;
begin
  if v_uid is null then raise exception 'Connexion requise'; end if;
  if p_table not in ('players','criteria','measurements','events','evaluations') then
    raise exception 'Table inconnue : %', p_table;
  end if;
  select role, full_name into v_role, v_name from public.hb_profiles where user_id = v_uid;
  v_role := coalesce(v_role, 'observateur');

  for r in select * from jsonb_array_elements(p_rows) loop
    v_data := r -> 'data';
    v_deleting := coalesce((r ->> 'deleted')::boolean, false);
    execute format('select data from public.hb_%1$s where id = $1', p_table) into v_existing using r ->> 'id';

    v_ok := case
      when v_role = 'admin' then true
      when p_table = 'players' then v_role = 'preparateur' and not v_deleting
      when p_table = 'measurements' then v_role = 'preparateur'
      when p_table = 'events' then v_role = 'preparateur' or v_existing is null
      when p_table = 'evaluations' then
        v_data ->> 'observerId' = v_uid::text
        and (v_existing is null or v_existing ->> 'observerId' = v_uid::text)
      else false -- critères : administrateurs uniquement
    end;

    if not v_ok then
      v_rejected := v_rejected || to_jsonb(r ->> 'id');
      continue;
    end if;

    -- Un avis est toujours signé du nom du compte qui l'écrit.
    if p_table = 'evaluations' and v_role <> 'admin' and v_name is not null then
      v_data := jsonb_set(v_data, '{observer}', to_jsonb(v_name));
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
revoke all on function public.hb_set_role(uuid, text) from public, anon;
grant execute on function public.hb_upsert(text, jsonb) to authenticated;
grant execute on function public.hb_set_role(uuid, text) to authenticated;

-- Vérification : la liste des comptes et leur rôle.
select email, full_name, role from public.hb_profiles order by created_at;
