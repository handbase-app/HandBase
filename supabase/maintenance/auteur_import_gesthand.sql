-- HandBase : signer les fiches de l'import Gest'Hand du 2 octobre 2026 (faites avant la signature des lignes,
-- supabase/004_audit.sql) : « créé par » = le compte qui a fait l'import, « créé le » = le 2 octobre au soir.
-- Concerne les fiches joueurs et les tailles « déclarées à la licence » qui n'ont pas encore d'auteur.
-- Les imports suivants sont signés automatiquement (compte connecté).
--
-- 1. Remplacer EMAIL_DU_COMPTE ci-dessous par l'e-mail du compte qui a fait l'import.
-- 2. Coller dans Supabase > SQL Editor, puis « Run ». Tout est fait d'un bloc : si une étape échoue, rien ne change.
-- Les fiches repartent vers les appareils à la synchronisation suivante (téléchargement un peu plus long une fois).

begin;

-- Pas de journal ni de notification par fiche (des milliers) ; hb_stamp garde sinon l'auteur d'origine (vide).
alter table public.hb_players disable trigger hb_log;
alter table public.hb_players disable trigger hb_stamp;
alter table public.hb_players disable trigger hb_notify_fiche;
alter table public.hb_measurements disable trigger hb_log;
alter table public.hb_measurements disable trigger hb_stamp;

do $$
declare
  v_email text := 'EMAIL_DU_COMPTE';
  v_uid uuid;
  v_name text;
  v_sign jsonb;
  v_p int;
  v_m int;
begin
  select user_id, full_name into v_uid, v_name from public.hb_profiles where lower(email) = lower(trim(v_email));
  if v_uid is null then
    raise exception 'Aucun compte avec l''e-mail « % » : vérifier l''e-mail en haut du script.', v_email;
  end if;
  v_sign := jsonb_strip_nulls(jsonb_build_object(
    'createdBy', v_uid, 'createdByName', v_name, 'createdAtServer', '2026-10-02T21:00:00+02:00'));

  -- updatedAt inchangé : les appareils prennent la version du serveur sans conflit.
  update public.hb_players set data = data || v_sign
   where not (data ? 'createdBy') and not (data ? 'createdAtServer');
  get diagnostics v_p = row_count;

  update public.hb_measurements set data = data || v_sign
   where not (data ? 'createdBy') and not (data ? 'createdAtServer');
  get diagnostics v_m = row_count;

  raise notice 'Signées au nom de % : % fiches joueurs, % mesures.', coalesce(v_name, v_email), v_p, v_m;
end $$;

alter table public.hb_players enable trigger hb_log;
alter table public.hb_players enable trigger hb_stamp;
alter table public.hb_players enable trigger hb_notify_fiche;
alter table public.hb_measurements enable trigger hb_log;
alter table public.hb_measurements enable trigger hb_stamp;

commit;

-- Vérification : il ne doit plus rester de fiche sans date de création.
select count(*) filter (where data ? 'createdAtServer') as avec_date,
       count(*) filter (where not data ? 'createdAtServer') as sans_date
  from public.hb_players where not deleted;
