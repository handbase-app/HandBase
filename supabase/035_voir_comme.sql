-- HandBase : « Voir comme… » (outil administrateur) tracé dans le journal d'activité.
-- À exécuter une fois dans Supabase > SQL Editor, APRÈS 034_equipes_encadrants.sql.
-- Peut être relancé sans risque.
--
-- « Voir comme… » est une simulation sur l'appareil de l'administrateur (rôle, secteur, groupes visibles d'un
-- autre membre), en lecture seule ; elle ne donne accès à aucune donnée de plus (les groupes privés, « Mon
-- staff », staffs et suivis des autres restent invisibles). Par transparence, chaque simulation est notée
-- dans le journal : qui a regardé l'appli comme qui, et quand.

create or replace function public.hb_log_view_as(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  a record;
  v_target text;
begin
  if (select role from public.hb_profiles where user_id = auth.uid()) is distinct from 'admin' then
    raise exception 'Réservé aux administrateurs';
  end if;
  select coalesce(full_name, email) into v_target from public.hb_profiles where user_id = p_user;
  if v_target is null then raise exception 'Membre introuvable'; end if;
  select * into a from public.hb_actor();
  insert into public.hb_audit (user_id, user_name, user_role, table_name, row_id, action, summary)
  values (a.uid, a.name, a.role, 'profiles', p_user::text, 'voir comme', v_target);
end $$;

revoke all on function public.hb_log_view_as(uuid) from public, anon;
grant execute on function public.hb_log_view_as(uuid) to authenticated;

-- Vérification : la fonction existe.
select proname as fonction from pg_proc where proname = 'hb_log_view_as';
