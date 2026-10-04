-- HandBase : téléphone des membres et mot de passe provisoire à changer.
-- À exécuter une fois dans Supabase > SQL Editor, APRÈS 014_gestion_membres.sql.
--
--  - les membres ont un numéro de téléphone (pour leur envoyer leur accès par SMS / WhatsApp) ;
--  - un compte créé par un administrateur, ou dont il a changé le mot de passe, reçoit un mot de passe
--    provisoire : l'appli demande d'en choisir un nouveau à la connexion suivante.

alter table public.hb_profiles add column if not exists phone text;

-- ---------- Créer un membre ----------

drop function if exists public.hb_create_member(text, text, text, text, text[]);
create or replace function public.hb_create_member(
  p_email text, p_password text, p_full_name text, p_role text, p_departments text[] default '{}', p_phone text default null
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
    -- Mot de passe provisoire : l'appli demandera d'en choisir un à la première connexion.
    jsonb_build_object('full_name', v_name, 'must_change_password', true), now(), now(),
    '', '', '', '', '', '', '', ''
  );
  insert into auth.identities (id, provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (gen_random_uuid(), v_id::text, v_id,
          jsonb_build_object('sub', v_id::text, 'email', v_email, 'email_verified', true),
          'email', null, now(), now());

  -- Le profil est créé par le déclencheur de 002_roles.sql ; on y met le rôle et le secteur.
  update public.hb_profiles
     set role = p_role, full_name = v_name, email = v_email, phone = nullif(trim(p_phone), ''),
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

drop function if exists public.hb_update_member(uuid, text, text, text, text[], text);
create or replace function public.hb_update_member(
  p_user uuid, p_email text default null, p_full_name text default null, p_role text default null,
  p_departments text[] default null, p_password text default null, p_phone text default null
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
  select p.full_name, p.email, p.role, p.phone into v_old from public.hb_profiles p where p.user_id = p_user;
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

  -- Téléphone : '' l'efface, NULL ne change rien.
  if p_phone is not null and nullif(trim(p_phone), '') is distinct from v_old.phone then
    update public.hb_profiles set phone = nullif(trim(p_phone), '') where user_id = p_user;
    v_changes := v_changes || jsonb_build_object('phone', jsonb_build_array(v_old.phone, nullif(trim(p_phone), '')));
  end if;

  if p_password is not null then
    -- Nouveau mot de passe provisoire : à changer à la prochaine connexion.
    update auth.users
       set encrypted_password = crypt(p_password, gen_salt('bf')), updated_at = now(),
           raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb) || jsonb_build_object('must_change_password', true)
     where id = p_user;
    v_changes := v_changes || jsonb_build_object('password', jsonb_build_array(null, '(nouveau mot de passe)'));
  end if;

  if v_changes <> '{}'::jsonb then
    perform public.hb_member_log(p_user, 'modification', coalesce(v_name, v_old.full_name, v_old.email), v_changes);
  end if;
end $$;

revoke all on function public.hb_create_member(text, text, text, text, text[], text) from public, anon;
revoke all on function public.hb_update_member(uuid, text, text, text, text[], text, text) from public, anon;
grant execute on function public.hb_create_member(text, text, text, text, text[], text) to authenticated;
grant execute on function public.hb_update_member(uuid, text, text, text, text[], text, text) to authenticated;

-- Vérification : le staff.
select coalesce(full_name, email) as membre, email, phone as telephone, role from public.hb_profiles order by role, 1;
