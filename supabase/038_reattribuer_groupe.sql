-- HandBase : un administrateur réattribue un groupe à un autre compte (encadrant, observateur ou administrateur).
-- À exécuter une fois dans Supabase > SQL Editor, APRÈS 037_moments_video.sql.
-- Peut être relancé sans risque.
--
-- « Réattribuer, c'est comme si lui l'avait créé » : après réattribution, le groupe est celui du destinataire
-- (createdBy, createdByName), avec tous les droits du créateur (modifier, supprimer, participants, « Suivi par le
-- staff »). Rien dans l'appli ne dit qu'il a été réattribué : seul le journal d'activité des administrateurs garde
-- la trace ancien → nouveau propriétaire.
--
-- hb_transfer_group(p_group, p_to, p_keep_old) : comptes connectés ; refus clair sinon.
--   - l'appelant est administrateur ;
--   - le groupe existe, n'est pas supprimé et est visible par cet administrateur (un groupe privé ou « Mon staff »
--     d'un autre dont il ne fait pas partie ne lui est pas visible : il ne peut pas le réattribuer, c'est voulu) ;
--   - le destinataire a un rôle ; un observateur ne reçoit qu'un groupe privé (il ne possède jamais de groupe
--     « Mon staff » ou « Tout le staff ») ;
--   - le destinataire sort des participants (editors) s'il y était ; les joueurs ajoutés par l'ancien propriétaire
--     sont désormais « ajoutés par » le destinataire ;
--   - p_keep_old (faux par défaut) : l'ancien propriétaire devient participant (groupe non privé, et seulement s'il est
--     encadrant : les participants sont toujours des encadrants, voir hb_upsert) ; il garde alors ses joueurs ajoutés ;
--   - « modifié par » : si la dernière modification venait de l'ancien propriétaire, elle passe au destinataire ;
--     sinon elle reste ; la date de dernière modification affichée ne change pas (la réattribution n'apparaît pas) ;
--   - journal : une ligne « réattribution » (ancien → nouveau propriétaire ; groupe privé ou « Mon staff » : sans son
--     nom ni son contenu, comme hb_log) ;
--   - notification au destinataire (préférence « participant ») : « X t'a confié le groupe « Y » ».
-- Renvoie { name, visible } : visible = le groupe reste visible par l'administrateur (sinon l'appli l'efface de l'appareil).
--
-- Signature (hb_stamp) : elle garde toujours le créateur d'origine. Pour cette seule écriture, hb_transfer_group pose
-- une consigne locale à la transaction (hb.transfer) que lit un second déclencheur, hb_stamp_transfer, exécuté juste
-- après hb_stamp (ordre alphabétique) ; la consigne est retirée aussitôt. Toutes les autres écritures sont signées
-- comme avant (l'appli ne peut pas poser cette consigne : seules les fonctions du serveur le font).

-- ---------- Signature : réattribution ----------

create or replace function public.hb_stamp_transfer() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v jsonb;
begin
  v := nullif(current_setting('hb.transfer', true), '')::jsonb;
  if v is null or v ->> 'id' is distinct from new.id then return new; end if;
  new.data := (new.data - 'createdBy' - 'createdByName' - 'updatedBy' - 'updatedByName' - 'updatedAtServer')
    || jsonb_strip_nulls(jsonb_build_object(
         'createdBy', v -> 'createdBy', 'createdByName', v -> 'createdByName',
         'updatedBy', v -> 'updatedBy', 'updatedByName', v -> 'updatedByName', 'updatedAtServer', v -> 'updatedAtServer'));
  return new;
end $$;

-- Déclencheurs avant écriture : hb_stamp, puis hb_stamp_transfer, puis hb_touch (ordre des noms).
drop trigger if exists hb_stamp_transfer on public.hb_groups;
create trigger hb_stamp_transfer before update on public.hb_groups
  for each row execute function public.hb_stamp_transfer();

-- ---------- Réattribution ----------

create or replace function public.hb_transfer_group(p_group text, p_to uuid, p_keep_old boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_role text;
  v_name text;
  v_to_role text;
  v_to_name text;
  v_g jsonb;
  v_deleted boolean;
  v_ts bigint;
  v_old text;
  v_old_name text;
  v_old_role text;
  v_private boolean;
  v_team boolean;
  v_keep boolean := false;
  v_editors jsonb;
  v_added jsonb;
  v_names jsonb;
  v_data jsonb;
  v_now bigint;
  v_last bigint;
  v_visible boolean;
begin
  if v_uid is null then raise exception 'Connexion requise'; end if;
  select role, coalesce(full_name, email) into v_role, v_name from public.hb_profiles where user_id = v_uid;
  if v_role is distinct from 'admin' then
    raise exception 'Réservé aux administrateurs : seul un administrateur réattribue un groupe';
  end if;

  select data, deleted, updated_at_client into v_g, v_deleted, v_ts from public.hb_groups where id = p_group for update;
  v_private := coalesce((v_g ->> 'private')::boolean, false);
  v_team := coalesce((v_g ->> 'team')::boolean, false);
  -- Même règle que la lecture (staff_read, 031/034) : un groupe qu'il ne voit pas est pour lui introuvable.
  if v_g is null or v_deleted or coalesce((v_g ->> 'purged')::boolean, false)
     or not (v_g ->> 'createdBy' = v_uid::text
             or (not v_private and (not v_team or public.hb_participant_of(v_g, v_uid)))) then
    raise exception 'Groupe introuvable (supprimé, ou privé / « Mon staff » d’un autre compte)';
  end if;

  select role, coalesce(nullif(btrim(full_name), ''), email) into v_to_role, v_to_name from public.hb_profiles where user_id = p_to;
  if v_to_role is null or v_to_role not in ('admin', 'preparateur', 'observateur') then
    raise exception 'Ce compte n’a pas de rôle : un groupe ne peut être confié qu’à un administrateur, un encadrant ou un observateur';
  end if;
  if v_to_role = 'observateur' and not v_private then
    raise exception 'Un observateur ne peut recevoir qu’un groupe privé (« Moi seul »)';
  end if;

  v_old := nullif(v_g ->> 'createdBy', '');
  if v_old = p_to::text then
    raise exception 'Ce groupe est déjà à %', v_to_name;
  end if;
  select role, coalesce(nullif(btrim(full_name), ''), email) into v_old_role, v_old_name from public.hb_profiles where user_id::text = v_old;
  v_old_name := coalesce(v_old_name, v_g ->> 'createdByName', '?');

  -- Participants : jamais le propriétaire ; l'ancien seulement sur demande (groupe partagé, encadrant).
  v_editors := public.hb_arr(v_g -> 'editors') - p_to::text;
  v_keep := coalesce(p_keep_old, false) and v_old is not null and not v_private and v_old_role = 'preparateur';
  if v_keep and not (v_editors ? v_old) then v_editors := v_editors || to_jsonb(v_old); end if;
  if v_private then v_editors := '[]'::jsonb; end if;

  -- « Ajouté par » : l'ancien propriétaire s'efface derrière le nouveau, sauf s'il reste participant.
  v_added := coalesce(v_g -> 'addedBy', '{}'::jsonb);
  if not v_keep and v_old is not null then
    select coalesce(jsonb_object_agg(key, case when value = to_jsonb(v_old) then to_jsonb(p_to::text) else value end), '{}'::jsonb)
      into v_added from jsonb_each(v_added);
  end if;
  v_names := coalesce(v_g -> 'names', '{}'::jsonb) || jsonb_build_object(p_to::text, v_to_name);
  if not v_keep and v_old is not null then v_names := v_names - v_old; end if;

  v_now := greatest((extract(epoch from clock_timestamp()) * 1000)::bigint, coalesce(v_ts, 0) + 1);
  v_data := v_g || jsonb_build_object('editors', v_editors, 'addedBy', v_added, 'names', v_names, 'updatedAt', v_now);

  -- Consigne pour hb_stamp_transfer (cette écriture seulement).
  perform set_config('hb.transfer', jsonb_build_object(
    'id', p_group, 'createdBy', p_to::text, 'createdByName', v_to_name,
    'updatedBy', case when v_g ->> 'updatedBy' is null or v_g ->> 'updatedBy' = v_old then to_jsonb(p_to::text) else v_g -> 'updatedBy' end,
    'updatedByName', case when v_g ->> 'updatedBy' is null or v_g ->> 'updatedBy' = v_old then to_jsonb(v_to_name) else v_g -> 'updatedByName' end,
    'updatedAtServer', v_g -> 'updatedAtServer')::text, true);
  select coalesce(max(id), 0) into v_last from public.hb_audit;
  update public.hb_groups set data = v_data, updated_at_client = v_now where id = p_group;
  perform set_config('hb.transfer', '', true);

  -- Journal : la ligne « modification » de hb_log (participants, noms…) est remplacée par une seule « réattribution ».
  delete from public.hb_audit where id > v_last and table_name = 'groups' and row_id = p_group;
  insert into public.hb_audit (user_id, user_name, user_role, table_name, row_id, action, summary, changes)
  values (v_uid, v_name, v_role, 'groups', p_group, 'réattribution',
          case when v_private or v_team then '(privé)' else v_g ->> 'name' end,
          jsonb_build_object('createdByName', jsonb_build_array(v_old_name, v_to_name))
            || case when v_keep then jsonb_build_object('oldOwnerKept', jsonb_build_array(false, true)) else '{}'::jsonb end);

  perform public.hb_notify(p_to, 'participant', 'transfer:' || p_group, 'Groupe confié',
    coalesce(v_name, 'Un administrateur') || ' t’a confié le groupe « ' || coalesce(v_g ->> 'name', '?') || ' »', null,
    '/groupes/' || p_group);

  v_visible := p_to = v_uid or (not v_private and (not v_team or public.hb_participant_of(v_data, v_uid)));
  return jsonb_build_object('name', v_g ->> 'name', 'visible', v_visible, 'keptOld', v_keep);
end $$;

-- ---------- Droits des fonctions (reprise de 037, avec hb_transfer_group) ----------
-- Appelées par l'appli (supabase.rpc) ou par les règles de lecture : comptes connectés seulement.
-- Toutes les autres fonctions hb_* (déclencheurs, outils internes) : personne, sauf le serveur.
do $$
declare
  f record;
  v_app text[] := array['hb_upsert', 'hb_merge_players', 'hb_create_member', 'hb_update_member', 'hb_delete_member',
                        'hb_members', 'hb_set_role', 'hb_set_departments', 'hb_purge_expired', 'hb_purge_deleted',
                        'hb_push_subscribe', 'hb_push_unsubscribe', 'hb_set_notif_prefs', 'hb_notif_test', 'hb_has_role',
                        'hb_ping', 'hb_last_seen', 'hb_is_participant', 'hb_log_view_as', 'hb_transfer_group'];
begin
  for f in
    select p.oid::regprocedure as sig, p.proname
      from pg_proc p
     where p.pronamespace = 'public'::regnamespace and p.proname like 'hb\_%'
  loop
    execute format('revoke all on function %s from public, anon', f.sig);
    if f.proname = any (v_app) then
      execute format('grant execute on function %s to authenticated', f.sig);
    else
      execute format('revoke all on function %s from authenticated', f.sig);
    end if;
  end loop;
end $$;

-- Vérification : la fonction et le déclencheur sont en place.
select exists (select 1 from pg_proc where proname = 'hb_transfer_group') as fonction_ok,
       exists (select 1 from pg_trigger where tgname = 'hb_stamp_transfer' and tgrelid = 'public.hb_groups'::regclass) as declencheur_ok;
