-- HandBase : renommer un membre du staff (y compris un administrateur, que l'appli ne peut pas modifier).
-- À coller dans Supabase > SQL Editor. Changer les deux noms ci-dessous si besoin, puis « Run ».
-- Le nom change sur le compte, dans la liste du staff, et sur ses avis et mesures déjà enregistrés
-- (sinon ses anciens avis apparaîtraient sous un autre observateur).

do $$
declare
  v_old text := 'Stefan Bascher';   -- nom actuel
  v_new text := 'Stef Bascher';     -- nouveau nom
  v_user uuid;
  v_n int;
  v_now bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
  v_evals int;
  v_meas int;
begin
  select count(*), min(user_id::text)::uuid into v_n, v_user from public.hb_profiles where full_name = v_old;
  if v_n = 0 then raise exception 'Aucun membre nommé « % »', v_old; end if;
  if v_n > 1 then raise exception 'Plusieurs membres nommés « % » : rien n''a été changé', v_old; end if;

  update auth.users
     set raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb) || jsonb_build_object('full_name', v_new), updated_at = now()
   where id = v_user;
  update public.hb_profiles set full_name = v_new where user_id = v_user;

  -- Ses avis et ses mesures suivent le nouveau nom (et se mettent à jour sur tous les appareils).
  update public.hb_evaluations
     set data = data || jsonb_build_object('observer', v_new, 'updatedAt', v_now), updated_at_client = v_now
   where data ->> 'observerId' = v_user::text and data ->> 'observer' = v_old;
  get diagnostics v_evals = row_count;
  update public.hb_measurements
     set data = data || jsonb_build_object('author', v_new, 'updatedAt', v_now), updated_at_client = v_now
   where data ->> 'createdBy' = v_user::text and data ->> 'author' = v_old;
  get diagnostics v_meas = row_count;

  raise notice '« % » devient « % » : % avis et % mesure(s) mis à jour.', v_old, v_new, v_evals, v_meas;
end $$;

-- Vérification : le staff.
select coalesce(full_name, email) as membre, email, role from public.hb_profiles order by role, 1;
