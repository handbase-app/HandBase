-- =====================================================================================================================
-- 081 — Le résumé du matin des alertes wellness ouvre la page « Alertes wellness » (/alertes-wellness, depuis 6d44edc),
-- et non plus « Mes suivis » (les alertes ont quitté cette page). Seul changement : le lien de hb_notify. Le reste de la
-- fonction est celui de 080, à l'identique (create or replace : les droits posés par 080 restent).
-- =====================================================================================================================

create or replace function public.hb_wellness_alertes_quotidien(p_force boolean default false) returns int
language plpgsql security definer set search_path = public as $$
declare
  v_auj date := public.hb_wl_auj();
  v_cle text := 'wellness:' || to_char(public.hb_wl_auj(), 'YYYY-MM-DD');
  u uuid;
  n int;
  k int := 0;
begin
  -- Un résumé d'un autre jour jamais parti (envoi coupé) : retiré, jamais envoyé en retard.
  delete from public.hb_notifications where kind = 'wellness' and sent_at is null and group_key <> v_cle;
  if not public.hb_wellness_actif() then return 0; end if;
  if not coalesce(p_force, false)
     and (extract(hour from now() at time zone 'Europe/Paris') <> 8 or not public.hb_wla_demande(v_auj, public.hb_wla_zone(), public.hb_wla_pont())) then
    return 0;
  end if;
  for u in
    select distinct a.user_id from public.hb_wellness_alertes a
      join public.hb_profiles pr on pr.user_id = a.user_id and pr.role in ('admin', 'preparateur')
     where a.actif and coalesce((pr.notif ->> 'wellness')::boolean, true)
       and exists (select 1 from public.hb_push_subs s where s.user_id = a.user_id)
       and not exists (select 1 from public.hb_notifications x where x.user_id = a.user_id and x.group_key = v_cle)
  loop
    n := jsonb_array_length(public.hb_wla_calcul(u) -> 'alertes');
    if n > 0 then
      perform public.hb_notify(u, 'wellness', v_cle, 'Alertes wellness',
        n || case when n > 1 then ' alertes wellness sur tes suivis' else ' alerte wellness sur tes suivis' end, null, '/alertes-wellness');
      k := k + 1;
    end if;
  end loop;
  return k;
end $$;
