-- HandBase : « Ne pas déranger la nuit » réglable par chacun.
-- À exécuter une fois dans Supabase > SQL Editor, APRÈS 026_notifications.sql,
-- puis redéployer la fonction d'envoi (supabase/functions/notify/index.ts, nouvelle version).
--
-- Préférences (Réglages → Notifications), sur le compte : quiet (oui / non, oui par défaut),
-- quietFrom et quietTo (heures de 0 à 23, par défaut 21 et 8, heure de Paris). Pendant ce créneau, les
-- notifications attendent et partent à la fin du créneau (sauf la notification de test).

create or replace function public.hb_set_notif_prefs(p_prefs jsonb) returns void
language sql security definer set search_path = public as $$
  update public.hb_profiles
     set notif = (select coalesce(jsonb_object_agg(key, value), '{}'::jsonb) from jsonb_each(coalesce(p_prefs, '{}'::jsonb))
                   where (key in ('avis', 'fiche', 'participant', 'rappel', 'alerte', 'quiet') and jsonb_typeof(value) = 'boolean')
                      or (key in ('quietFrom', 'quietTo') and jsonb_typeof(value) = 'number'
                          and (value #>> '{}')::numeric between 0 and 23 and (value #>> '{}')::numeric = trunc((value #>> '{}')::numeric)))
   where user_id = auth.uid()
$$;
revoke all on function public.hb_set_notif_prefs(jsonb) from public, anon;

-- Vérification : préférences enregistrées par compte (vide = réglages par défaut).
select full_name, notif from public.hb_profiles order by full_name;
