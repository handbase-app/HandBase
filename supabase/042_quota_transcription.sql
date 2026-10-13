-- HandBase : compteurs de la fonction « transcrire » (dictée Voxtral, Mistral AI), pour plafonner la dépense.
-- À exécuter une fois dans Supabase > SQL Editor, APRÈS 041_reperage_tournoi.sql, sur la base qui reçoit la
-- fonction (base de test d'abord). Peut être relancé sans risque.
--
-- Principe : on compte des appels, rien d'autre. Ni son, ni texte, ni durée : une ligne par période et par compte
-- avec un nombre.
--  - Mois (Europe/Paris, « 2026-10 ») : un compteur commun à tous (user_id = 00000000-0000-0000-0000-000000000000).
--  - Jour (Europe/Paris, « 2026-10-13 ») : un compteur par compte.
-- Aucun accès depuis l'appli ni depuis le navigateur : RLS sans politique, droits retirés à anon et authenticated.
-- Seule la fonction (clé service_role) appelle hb_transcription_compter.

create table if not exists public.hb_transcription_quota (
  periode text not null,
  user_id uuid not null,
  n integer not null default 0,
  primary key (periode, user_id)
);

alter table public.hb_transcription_quota enable row level security;
revoke all on table public.hb_transcription_quota from public, anon, authenticated;
grant select, insert, update, delete on table public.hb_transcription_quota to service_role;

-- Vérifie les deux plafonds puis compte l'appel, en une fois (verrou : pas de dépassement par appels simultanés).
-- Renvoie { ok, raison?, restant_mois, restant_jour }. raison : « quota_atteint » (mois) ou « quota_jour_atteint ».
create or replace function public.hb_transcription_compter(p_user uuid, p_max_mois integer, p_max_jour integer)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_tous constant uuid := '00000000-0000-0000-0000-000000000000';
  v_mois text := to_char(now() at time zone 'Europe/Paris', 'YYYY-MM');
  v_jour text := to_char(now() at time zone 'Europe/Paris', 'YYYY-MM-DD');
  v_n_mois integer;
  v_n_jour integer;
begin
  perform pg_advisory_xact_lock(hashtext('hb_transcription_quota'));

  select n into v_n_mois from hb_transcription_quota where periode = v_mois and user_id = v_tous;
  select n into v_n_jour from hb_transcription_quota where periode = v_jour and user_id = p_user;
  v_n_mois := coalesce(v_n_mois, 0);
  v_n_jour := coalesce(v_n_jour, 0);

  if v_n_mois >= p_max_mois then
    return jsonb_build_object('ok', false, 'raison', 'quota_atteint', 'restant_mois', 0,
      'restant_jour', greatest(p_max_jour - v_n_jour, 0));
  end if;
  if v_n_jour >= p_max_jour then
    return jsonb_build_object('ok', false, 'raison', 'quota_jour_atteint',
      'restant_mois', greatest(p_max_mois - v_n_mois, 0), 'restant_jour', 0);
  end if;

  insert into hb_transcription_quota (periode, user_id, n) values (v_mois, v_tous, 1)
    on conflict (periode, user_id) do update set n = hb_transcription_quota.n + 1;
  insert into hb_transcription_quota (periode, user_id, n) values (v_jour, p_user, 1)
    on conflict (periode, user_id) do update set n = hb_transcription_quota.n + 1;

  -- Ménage : compteurs de jour de plus de 40 jours, de mois de plus d'un an.
  delete from hb_transcription_quota
   where (length(periode) = 10 and periode < to_char((now() at time zone 'Europe/Paris') - interval '40 days', 'YYYY-MM-DD'))
      or (length(periode) = 7 and periode < to_char((now() at time zone 'Europe/Paris') - interval '12 months', 'YYYY-MM'));

  return jsonb_build_object('ok', true, 'restant_mois', p_max_mois - v_n_mois - 1, 'restant_jour', p_max_jour - v_n_jour - 1);
end;
$$;

revoke all on function public.hb_transcription_compter(uuid, integer, integer) from public, anon, authenticated;
grant execute on function public.hb_transcription_compter(uuid, integer, integer) to service_role;
