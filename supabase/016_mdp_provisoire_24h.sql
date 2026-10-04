-- HandBase : le mot de passe provisoire expire au bout de 24 h.
-- À exécuter une fois dans Supabase > SQL Editor, APRÈS 015_telephone_mdp_provisoire.sql.
--
-- Quand un administrateur crée un compte ou donne un nouveau mot de passe (provisoire), la personne a
-- 24 h pour se connecter et choisir le sien. Passé ce délai, le mot de passe provisoire est refusé
-- (même par quelqu'un qui aurait le message) : l'administrateur en redonne un depuis l'appli.
-- Le contrôle est fait par la base elle-même, à chaque connexion.

create or replace function public.hb_temp_password() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_temp boolean := coalesce((new.raw_user_meta_data ->> 'must_change_password')::boolean, false);
  v_exp timestamptz := (new.raw_app_meta_data ->> 'temp_password_expires_at')::timestamptz;
begin
  if tg_op = 'INSERT' then
    if v_temp then
      new.raw_app_meta_data := coalesce(new.raw_app_meta_data, '{}'::jsonb)
        || jsonb_build_object('temp_password_expires_at', now() + interval '24 hours');
    end if;
    return new;
  end if;

  -- Connexion avec un mot de passe provisoire expiré : refusée.
  if new.last_sign_in_at is distinct from old.last_sign_in_at and v_temp and v_exp is not null and v_exp < now() then
    raise exception 'temp_password_expired' using hint = 'Mot de passe provisoire expiré : demander un nouvel accès à un administrateur';
  end if;

  if new.encrypted_password is distinct from old.encrypted_password and v_temp then
    -- Nouveau mot de passe provisoire (donné par un administrateur) : 24 h à partir de maintenant.
    new.raw_app_meta_data := coalesce(new.raw_app_meta_data, '{}'::jsonb)
      || jsonb_build_object('temp_password_expires_at', now() + interval '24 hours');
  elsif not v_temp and new.raw_app_meta_data ? 'temp_password_expires_at' then
    -- La personne a choisi son mot de passe : plus de délai.
    new.raw_app_meta_data := new.raw_app_meta_data - 'temp_password_expires_at';
  end if;
  return new;
end $$;

drop trigger if exists hb_temp_password on auth.users;
create trigger hb_temp_password before insert or update on auth.users
  for each row execute function public.hb_temp_password();

revoke all on function public.hb_temp_password() from public, anon, authenticated;

-- Vérification : comptes avec un mot de passe provisoire en cours.
select coalesce(p.full_name, u.email) as membre,
       (u.raw_app_meta_data ->> 'temp_password_expires_at')::timestamptz as provisoire_jusqu_au
  from auth.users u left join public.hb_profiles p on p.user_id = u.id
 where coalesce((u.raw_user_meta_data ->> 'must_change_password')::boolean, false);
