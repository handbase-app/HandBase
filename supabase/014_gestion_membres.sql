-- HandBase : gestion des membres du staff depuis l'appli (administrateurs).
-- À exécuter une fois dans Supabase > SQL Editor, APRÈS 013_groupes.sql.
--
-- Un administrateur peut, depuis l'appli (téléphone compris) :
--   - créer le compte d'un observateur ou d'un encadrant (e-mail + mot de passe provisoire) ;
--   - modifier son nom, son e-mail, son rôle (observateur / encadrant), son secteur, son mot de passe ;
--   - supprimer son compte (ses avis et mesures restent, signés de son nom).
-- Par sécurité, l'appli ne peut JAMAIS créer, nommer, modifier ou supprimer un administrateur :
-- si un compte administrateur était piraté, il ne pourrait pas s'en fabriquer d'autres.
-- Nommer un administrateur se fait uniquement ici, dans le SQL Editor (voir en bas du fichier).

-- ---------- Rôles : plus jamais « administrateur » depuis l'appli ----------

create or replace function public.hb_set_role(p_user uuid, p_role text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if (select role from public.hb_profiles where user_id = auth.uid()) is distinct from 'admin' then
    raise exception 'Réservé aux administrateurs';
  end if;
  if p_role not in ('preparateur', 'observateur') then
    raise exception 'Un administrateur se nomme uniquement depuis Supabase (SQL Editor)';
  end if;
  if (select role from public.hb_profiles where user_id = p_user) = 'admin' then
    raise exception 'Le rôle d’un administrateur se change uniquement depuis Supabase (SQL Editor)';
  end if;
  update public.hb_profiles set role = p_role where user_id = p_user;
end $$;

-- ---------- Outils ----------

-- Vérifie que l'appelant est administrateur, et que la cible n'en est pas un.
create or replace function public.hb_member_guard(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if (select role from public.hb_profiles where user_id = auth.uid()) is distinct from 'admin' then
    raise exception 'Réservé aux administrateurs';
  end if;
  if p_user is not null and (select role from public.hb_profiles where user_id = p_user) = 'admin' then
    raise exception 'Un compte administrateur se gère uniquement depuis Supabase (SQL Editor)';
  end if;
end $$;

create or replace function public.hb_member_check(p_email text, p_password text, p_full_name text) returns void
language plpgsql immutable as $$
begin
  if p_email is not null and p_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Adresse e-mail invalide';
  end if;
  if p_password is not null and length(p_password) < 8 then
    raise exception 'Mot de passe trop court (8 caractères minimum)';
  end if;
  if p_full_name is not null and trim(p_full_name) = '' then
    raise exception 'Le nom est obligatoire';
  end if;
end $$;

create or replace function public.hb_member_log(p_user uuid, p_action text, p_summary text, p_changes jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare a record;
begin
  select * into a from public.hb_actor();
  insert into public.hb_audit (user_id, user_name, user_role, table_name, row_id, action, summary, changes)
  values (a.uid, a.name, a.role, 'profiles', p_user::text, p_action, p_summary, p_changes);
end $$;

-- ---------- Créer un membre ----------

create or replace function public.hb_create_member(
  p_email text, p_password text, p_full_name text, p_role text, p_departments text[] default '{}'
) returns uuid
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_id uuid := gen_random_uuid();
  v_email text := lower(trim(p_email));
  v_name text := trim(p_full_name);
begin
  perform public.hb_member_guard(null);
  if p_role not in ('preparateur', 'observateur') then
    raise exception 'Depuis l’appli, on crée seulement des observateurs et des encadrants';
  end if;
  perform public.hb_member_check(v_email, p_password, v_name);
  if exists (select 1 from auth.users where lower(email) = v_email) then
    raise exception 'Un compte existe déjà avec cette adresse e-mail';
  end if;

  -- Compte confirmé d'office (pas d'e-mail de confirmation) : il peut se connecter tout de suite.
  -- Les jetons vides (et non NULL) sont attendus par le service de connexion de Supabase.
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change,
    email_change_token_current, phone_change, phone_change_token, reauthentication_token
  ) values (
    '00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated', v_email,
    crypt(p_password, gen_salt('bf')), now(),
    jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')),
    jsonb_build_object('full_name', v_name), now(), now(),
    '', '', '', '', '', '', '', ''
  );
  insert into auth.identities (id, provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (gen_random_uuid(), v_id::text, v_id,
          jsonb_build_object('sub', v_id::text, 'email', v_email, 'email_verified', true),
          'email', null, now(), now());

  -- Le profil est créé par le déclencheur de 002_roles.sql ; on y met le rôle et le secteur.
  update public.hb_profiles
     set role = p_role, full_name = v_name, email = v_email,
         departments = coalesce((select array_agg(distinct upper(trim(d)) order by upper(trim(d)))
                                   from unnest(p_departments) d where trim(d) <> ''), '{}')
   where user_id = v_id;

  perform public.hb_member_log(v_id, 'création', v_name,
    jsonb_build_object('email', jsonb_build_array(null, v_email), 'role', jsonb_build_array(null, p_role)));
  return v_id;
end $$;

-- ---------- Modifier un membre ----------
-- Les paramètres laissés à NULL ne changent pas. Un nouveau nom est aussi reporté sur ses avis
-- et ses mesures (sinon ses anciens avis apparaîtraient sous un autre observateur).

create or replace function public.hb_update_member(
  p_user uuid, p_email text default null, p_full_name text default null, p_role text default null,
  p_departments text[] default null, p_password text default null
) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_old record;
  v_email text := lower(trim(p_email));
  v_name text := trim(p_full_name);
  v_now bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
  v_changes jsonb := '{}'::jsonb;
begin
  perform public.hb_member_guard(p_user);
  select p.full_name, p.email, p.role into v_old from public.hb_profiles p where p.user_id = p_user;
  if not found then raise exception 'Membre introuvable'; end if;
  perform public.hb_member_check(v_email, p_password, v_name);

  if v_email is not null and v_email is distinct from lower(v_old.email) then
    if exists (select 1 from auth.users where lower(email) = v_email and id <> p_user) then
      raise exception 'Un compte existe déjà avec cette adresse e-mail';
    end if;
    update auth.users set email = v_email, updated_at = now() where id = p_user;
    update auth.identities set identity_data = identity_data || jsonb_build_object('email', v_email), updated_at = now()
     where user_id = p_user and provider = 'email';
    v_changes := v_changes || jsonb_build_object('email', jsonb_build_array(v_old.email, v_email));
  end if;

  if v_name is not null and v_name is distinct from v_old.full_name then
    update auth.users set raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb) || jsonb_build_object('full_name', v_name),
                          updated_at = now()
     where id = p_user;
    update public.hb_profiles set full_name = v_name where user_id = p_user;
    -- Ses avis et ses mesures suivent le nouveau nom.
    if v_old.full_name is not null then
      update public.hb_evaluations
         set data = data || jsonb_build_object('observer', v_name, 'updatedAt', v_now), updated_at_client = v_now
       where data ->> 'observerId' = p_user::text and data ->> 'observer' = v_old.full_name;
      update public.hb_measurements
         set data = data || jsonb_build_object('author', v_name, 'updatedAt', v_now), updated_at_client = v_now
       where data ->> 'createdBy' = p_user::text and data ->> 'author' = v_old.full_name;
    end if;
    v_changes := v_changes || jsonb_build_object('full_name', jsonb_build_array(v_old.full_name, v_name));
  end if;

  if p_role is not null and p_role is distinct from v_old.role then
    perform public.hb_set_role(p_user, p_role); -- journalisé par hb_log_role
  end if;
  if p_departments is not null then
    perform public.hb_set_departments(p_user, p_departments); -- journalisé par hb_log_role
  end if;

  if p_password is not null then
    update auth.users set encrypted_password = crypt(p_password, gen_salt('bf')), updated_at = now() where id = p_user;
    v_changes := v_changes || jsonb_build_object('password', jsonb_build_array(null, '(nouveau mot de passe)'));
  end if;

  if v_changes <> '{}'::jsonb then
    perform public.hb_member_log(p_user, 'modification', coalesce(v_name, v_old.full_name, v_old.email), v_changes);
  end if;
end $$;

-- ---------- Supprimer un membre ----------
-- Le compte disparaît (il ne peut plus se connecter) ; ses avis et mesures restent, signés de son nom.

create or replace function public.hb_delete_member(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_old record;
begin
  perform public.hb_member_guard(p_user);
  if p_user = auth.uid() then raise exception 'Impossible de supprimer son propre compte'; end if;
  select full_name, email, role into v_old from public.hb_profiles where user_id = p_user;
  if not found then raise exception 'Membre introuvable'; end if;
  delete from auth.users where id = p_user; -- profil supprimé en cascade
  perform public.hb_member_log(p_user, 'suppression', coalesce(v_old.full_name, v_old.email),
    jsonb_build_object('email', jsonb_build_array(v_old.email, null), 'role', jsonb_build_array(v_old.role, null)));
end $$;

-- ---------- Droits ----------

revoke all on function public.hb_member_guard(uuid) from public, anon, authenticated;
revoke all on function public.hb_member_log(uuid, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.hb_create_member(text, text, text, text, text[]) from public, anon;
revoke all on function public.hb_update_member(uuid, text, text, text, text[], text) from public, anon;
revoke all on function public.hb_delete_member(uuid) from public, anon;
grant execute on function public.hb_create_member(text, text, text, text, text[]) to authenticated;
grant execute on function public.hb_update_member(uuid, text, text, text, text[], text) to authenticated;
grant execute on function public.hb_delete_member(uuid) to authenticated;

-- ---------- Nommer un administrateur (à faire ici seulement) ----------
-- update public.hb_profiles set role = 'admin' where email = 'adresse@exemple.fr';

-- Vérification : le staff.
select coalesce(full_name, email) as membre, email, role from public.hb_profiles order by role, 1;
