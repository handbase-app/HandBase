-- HandBase : journal d'activité (qui a fait quoi, quand) et signature des lignes.
-- À exécuter une fois dans Supabase > SQL Editor, APRÈS 003_events_staff.sql.
--
-- Tout est fait par des déclencheurs de la base : chaque écriture est tracée, qu'elle vienne de
-- l'appli, d'un import ou d'un script lancé dans le SQL Editor. Le journal n'est lisible que par
-- les administrateurs et ne peut pas être modifié depuis l'appli.

-- ---------- Journal ----------

create table if not exists public.hb_audit (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  user_id uuid,
  user_name text,
  user_role text,
  table_name text not null,
  row_id text not null,
  action text not null,        -- création, modification, suppression, restauration, suppression définitive, rôle
  summary text,                -- de quoi il s'agit (nom du joueur, de l'événement…)
  changes jsonb                -- { champ: [ancienne valeur, nouvelle valeur] }
);
create index if not exists hb_audit_at on public.hb_audit (at desc);
create index if not exists hb_audit_row on public.hb_audit (table_name, row_id);
create index if not exists hb_audit_user on public.hb_audit (user_id);

alter table public.hb_audit enable row level security;
drop policy if exists "admin_read" on public.hb_audit;
create policy "admin_read" on public.hb_audit for select to authenticated
  using (exists (select 1 from public.hb_profiles where user_id = auth.uid() and role = 'admin'));
-- Aucune politique d'écriture : seul le serveur (déclencheurs) écrit dans le journal.

-- Qui agit : le compte connecté, sinon une personne travaillant directement dans Supabase.
create or replace function public.hb_actor(out uid uuid, out name text, out role text)
language plpgsql stable security definer set search_path = public as $$
begin
  uid := auth.uid();
  if uid is null then
    name := 'Administration Supabase (SQL)';
    role := 'admin';
  else
    select p.full_name, p.role into name, role from public.hb_profiles p where p.user_id = uid;
  end if;
end $$;

-- Nom lisible d'un joueur.
create or replace function public.hb_player_name(p_id text) returns text
language sql stable security definer set search_path = public as $$
  select trim(coalesce(data ->> 'firstName', '') || ' ' || coalesce(data ->> 'lastName', ''))
    from public.hb_players where id = p_id
$$;

-- De quoi parle une ligne, en clair.
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
    else null
  end;
end $$;

-- ---------- Signature des lignes (créé par / modifié par) ----------

create or replace function public.hb_stamp() returns trigger
language plpgsql security definer set search_path = public as $$
declare a record;
begin
  select * into a from public.hb_actor();
  if tg_op = 'INSERT' then
    new.data := new.data || jsonb_strip_nulls(jsonb_build_object(
      'createdBy', a.uid, 'createdByName', a.name, 'createdAtServer', now()));
  else
    -- La création reste celle d'origine, quoi qu'envoie l'appareil.
    new.data := (new.data - 'createdBy' - 'createdByName' - 'createdAtServer') || jsonb_strip_nulls(jsonb_build_object(
      'createdBy', old.data -> 'createdBy', 'createdByName', old.data -> 'createdByName', 'createdAtServer', old.data -> 'createdAtServer'));
  end if;
  new.data := new.data || jsonb_strip_nulls(jsonb_build_object(
    'updatedBy', a.uid, 'updatedByName', a.name, 'updatedAtServer', now()));
  return new;
end $$;

-- ---------- Journal des écritures ----------

create or replace function public.hb_log() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  a record;
  v_table text := substr(tg_table_name, 4); -- hb_players -> players
  v_action text;
  v_changes jsonb;
  v_meta text[] := array['updatedAt', 'updatedBy', 'updatedByName', 'updatedAtServer', 'createdBy', 'createdByName', 'createdAtServer'];
begin
  select * into a from public.hb_actor();
  if tg_op = 'INSERT' then
    v_action := case when new.deleted then 'suppression' else 'création' end;
  elsif tg_op = 'DELETE' then
    v_action := 'suppression définitive';
  elsif new.deleted and not old.deleted then
    v_action := 'suppression';
  elsif old.deleted and not new.deleted then
    v_action := 'restauration';
  else
    v_action := 'modification';
  end if;

  if tg_op = 'UPDATE' then
    select jsonb_object_agg(k, jsonb_build_array(
             case when k = 'photo' then to_jsonb('(photo)'::text) else old.data -> k end,
             case when k = 'photo' then to_jsonb('(photo)'::text) else new.data -> k end))
      into v_changes
      from (select jsonb_object_keys(old.data || new.data) as k) keys
     where old.data -> k is distinct from new.data -> k
       and not (k = any (v_meta));
    -- Rien de réel n'a changé (resynchronisation) : pas de ligne de journal.
    if v_changes is null and v_action = 'modification' then return null; end if;
  end if;

  insert into public.hb_audit (user_id, user_name, user_role, table_name, row_id, action, summary, changes)
  values (a.uid, a.name, a.role, v_table, coalesce(new.id, old.id), v_action,
          public.hb_summary(v_table, coalesce(new.data, old.data)), v_changes);
  return null;
end $$;

do $$
declare t text;
begin
  foreach t in array array['players','criteria','measurements','events','evaluations'] loop
    execute format('drop trigger if exists hb_stamp on public.hb_%1$s;
      create trigger hb_stamp before insert or update on public.hb_%1$s
      for each row execute function public.hb_stamp();
      drop trigger if exists hb_log on public.hb_%1$s;
      create trigger hb_log after insert or update or delete on public.hb_%1$s
      for each row execute function public.hb_log();', t);
  end loop;
end $$;

-- ---------- Changements de rôle ----------

create or replace function public.hb_log_role() returns trigger
language plpgsql security definer set search_path = public as $$
declare a record;
begin
  if new.role is distinct from old.role then
    select * into a from public.hb_actor();
    insert into public.hb_audit (user_id, user_name, user_role, table_name, row_id, action, summary, changes)
    values (a.uid, a.name, a.role, 'profiles', new.user_id::text, 'rôle',
            coalesce(new.full_name, new.email), jsonb_build_object('role', jsonb_build_array(old.role, new.role)));
  end if;
  return null;
end $$;
drop trigger if exists hb_log_role on public.hb_profiles;
create trigger hb_log_role after update on public.hb_profiles
  for each row execute function public.hb_log_role();

revoke all on function public.hb_actor() from public, anon;
revoke all on function public.hb_player_name(text) from public, anon;
revoke all on function public.hb_summary(text, jsonb) from public, anon;

-- Vérification : le journal existe (vide au départ).
select count(*) as lignes_journal from public.hb_audit;
