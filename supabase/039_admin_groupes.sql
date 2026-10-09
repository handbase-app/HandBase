-- HandBase : un administrateur peut voir tous les groupes (interrupteur « Voir tous les groupes »), de façon transparente.
-- À exécuter une fois dans Supabase > SQL Editor, APRÈS 038_reattribuer_groupe.sql.
-- Peut être relancé sans risque.
--
-- La règle de lecture de hb_groups (staff_read, 031/034) NE change PAS : les groupes privés et « Mon staff » des autres
-- ne sont jamais synchronisés chez un administrateur (ni sur son appareil, ni dans son fil, ses suivis, ses filtres).
-- Il les lit en direct, à la demande, par les fonctions ci-dessous, et chaque lecture laisse une trace dans le journal
-- d'activité (hb_audit), sans le contenu du groupe :
--
-- hb_admin_groups() : liste des groupes privés et « Mon staff » des autres comptes que l'administrateur ne voit pas
--   normalement (non supprimés) : identifiant, nom, description, portée, sexe, années, archivé, propriétaire, nombre de
--   joueurs. Journal : une ligne « consultation » « groupes privés et « Mon staff » des autres (liste) », au plus une
--   toutes les 10 minutes par administrateur (l'appli la demande à chaque activation de l'interrupteur).
-- hb_admin_group(p_id) : détail d'un de ces groupes, en lecture seule : nom, description, portée, sexe, années,
--   participants choisis un par un (noms), nombre de staffs choisis (les staffs restent privés : ni leur nom ni leurs
--   membres), joueurs (identifiants, « ajouté par »). Journal : « consultation » « groupe privé de Y » ou
--   « groupe « Mon staff » de Y » (sans son nom ni son contenu) ; pas de doublon dans les 2 minutes (réouverture).
-- hb_admin_delete_group(p_id) : suppression logique, comme une suppression normale (deleted = vrai, synchronisée vers
--   le propriétaire et ses participants, qui ne peuvent plus la modifier ; un administrateur peut la restaurer comme
--   aujourd'hui). Journal : la ligne « suppression » habituelle (hb_log : « (privé) »). Notification au propriétaire
--   (préférence « participant ») : « X a supprimé ton groupe « Y » ».
-- hb_transfer_group (038) étendu : un administrateur réattribue n'importe quel groupe non supprimé, y compris privé ou
--   « Mon staff » d'un autre ; les autres règles restent (un observateur ne reçoit qu'un groupe privé, etc.).
--
-- Restent privés (aucune fonction ici n'y touche) : suivis personnels (hb_follows), staffs (hb_teams).
-- Toutes ces fonctions : administrateurs seulement (refus clair sinon), comptes connectés seulement (anon : aucun droit).

-- ---------- Outils ----------

-- Le groupe est-il visible normalement par ce compte ? Même règle que staff_read (031/034).
create or replace function public.hb_group_visible(p_data jsonb, p_uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select p_uid is not null and (p_data ->> 'createdBy' = p_uid::text
    or (not coalesce((p_data ->> 'private')::boolean, false)
        and (not coalesce((p_data ->> 'team')::boolean, false) or public.hb_participant_of(p_data, p_uid))))
$$;

-- « groupe privé de Y » / « groupe « Mon staff » de Y » (journal, confirmations) : jamais le nom du groupe.
create or replace function public.hb_group_owner_label(p_data jsonb)
returns text language sql stable security definer set search_path = public as $$
  select case when coalesce((p_data ->> 'private')::boolean, false) then 'groupe privé de ' else 'groupe « Mon staff » de ' end
    || coalesce((select coalesce(nullif(btrim(full_name), ''), email) from public.hb_profiles
                  where user_id::text = p_data ->> 'createdBy'),
                nullif(p_data ->> 'createdByName', ''), '?')
$$;

-- Appelant administrateur, sinon refus. Renvoie son identifiant.
create or replace function public.hb_admin_only()
returns uuid language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'Connexion requise'; end if;
  if (select role from public.hb_profiles where user_id = v_uid) is distinct from 'admin' then
    raise exception 'Réservé aux administrateurs';
  end if;
  return v_uid;
end $$;

-- ---------- Liste ----------

create or replace function public.hb_admin_groups()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.hb_admin_only();
  a record;
  v_list jsonb;
begin
  select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
           'id', g.id,
           'name', g.data -> 'name',
           'description', g.data -> 'description',
           'private', coalesce((g.data ->> 'private')::boolean, false),
           'team', case when coalesce((g.data ->> 'private')::boolean, false) then false
                        else coalesce((g.data ->> 'team')::boolean, false) end,
           'scope', g.data -> 'scope', 'sex', g.data -> 'sex', 'department', g.data -> 'department',
           'regionId', g.data -> 'regionId', 'years', g.data -> 'years', 'archived', g.data -> 'archived',
           'createdBy', g.data -> 'createdBy',
           'ownerName', coalesce(nullif(btrim(p.full_name), ''), p.email, g.data ->> 'createdByName'),
           'ownerRole', p.role,
           'playerCount', jsonb_array_length(public.hb_arr(g.data -> 'playerIds')),
           'updatedAt', g.data -> 'updatedAt'))
         order by lower(coalesce(p.full_name, p.email, '')), lower(g.data ->> 'name')), '[]'::jsonb)
    into v_list
    from public.hb_groups g
    left join public.hb_profiles p on p.user_id::text = g.data ->> 'createdBy'
   where not g.deleted and not coalesce((g.data ->> 'purged')::boolean, false)
     and (coalesce((g.data ->> 'private')::boolean, false) or coalesce((g.data ->> 'team')::boolean, false))
     and not public.hb_group_visible(g.data, v_uid);

  -- Journal : une ligne par activation (pas plus d'une toutes les 10 minutes).
  if not exists (select 1 from public.hb_audit
                  where user_id = v_uid and table_name = 'groups' and row_id = '-' and action = 'consultation'
                    and at > now() - interval '10 minutes') then
    select * into a from public.hb_actor();
    insert into public.hb_audit (user_id, user_name, user_role, table_name, row_id, action, summary)
    values (a.uid, a.name, a.role, 'groups', '-', 'consultation', 'groupes privés et « Mon staff » des autres (liste)');
  end if;
  return v_list;
end $$;

-- ---------- Détail (lecture seule) ----------

create or replace function public.hb_admin_group(p_id text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.hb_admin_only();
  a record;
  v_g jsonb;
  v_deleted boolean;
  v_label text;
  v_names jsonb;
begin
  select data, deleted into v_g, v_deleted from public.hb_groups where id = p_id;
  if v_g is null or v_deleted or coalesce((v_g ->> 'purged')::boolean, false) then
    raise exception 'Groupe introuvable (supprimé ?)';
  end if;
  if public.hb_group_visible(v_g, v_uid) then
    raise exception 'Ce groupe t’est déjà visible : ouvre-le normalement';
  end if;
  if not (coalesce((v_g ->> 'private')::boolean, false) or coalesce((v_g ->> 'team')::boolean, false)) then
    raise exception 'Groupe introuvable';
  end if;

  v_label := public.hb_group_owner_label(v_g);
  -- Noms : participants choisis un par un et auteurs des ajouts (comptes du staff, déjà connus de l'administrateur).
  v_names := coalesce(v_g -> 'names', '{}'::jsonb) - (select coalesce(array_agg(k), '{}') from jsonb_object_keys(coalesce(v_g -> 'names', '{}'::jsonb)) k
               where not (public.hb_arr(v_g -> 'editors') ? k or k = v_g ->> 'createdBy'
                          or exists (select 1 from jsonb_each_text(coalesce(v_g -> 'addedBy', '{}'::jsonb)) x where x.value = k)));

  -- Journal : pas de doublon pour une réouverture rapprochée.
  if not exists (select 1 from public.hb_audit
                  where user_id = v_uid and table_name = 'groups' and row_id = p_id and action = 'consultation'
                    and at > now() - interval '2 minutes') then
    select * into a from public.hb_actor();
    insert into public.hb_audit (user_id, user_name, user_role, table_name, row_id, action, summary)
    values (a.uid, a.name, a.role, 'groups', p_id, 'consultation', v_label);
  end if;

  return jsonb_strip_nulls(jsonb_build_object(
    'id', p_id,
    'name', v_g -> 'name', 'description', v_g -> 'description',
    'private', coalesce((v_g ->> 'private')::boolean, false),
    'team', case when coalesce((v_g ->> 'private')::boolean, false) then false else coalesce((v_g ->> 'team')::boolean, false) end,
    'teamFollow', v_g -> 'teamFollow',
    'scope', v_g -> 'scope', 'sex', v_g -> 'sex', 'department', v_g -> 'department', 'regionId', v_g -> 'regionId',
    'years', v_g -> 'years', 'archived', v_g -> 'archived',
    'playerIds', public.hb_arr(v_g -> 'playerIds'), 'addedBy', v_g -> 'addedBy',
    'editors', public.hb_arr(v_g -> 'editors'), 'names', v_names,
    'teamsCount', jsonb_array_length(public.hb_arr(v_g -> 'teams')),
    'createdBy', v_g -> 'createdBy', 'createdByName', v_g -> 'createdByName', 'createdAtServer', v_g -> 'createdAtServer',
    'updatedByName', v_g -> 'updatedByName', 'updatedAtServer', v_g -> 'updatedAtServer', 'updatedAt', v_g -> 'updatedAt',
    'ownerLabel', v_label));
end $$;

-- ---------- Suppression ----------

create or replace function public.hb_admin_delete_group(p_id text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.hb_admin_only();
  v_name text;
  v_g jsonb;
  v_deleted boolean;
  v_ts bigint;
  v_now bigint;
  v_owner uuid;
begin
  select coalesce(nullif(btrim(full_name), ''), email) into v_name from public.hb_profiles where user_id = v_uid;
  select data, deleted, updated_at_client into v_g, v_deleted, v_ts from public.hb_groups where id = p_id for update;
  if v_g is null or v_deleted or coalesce((v_g ->> 'purged')::boolean, false) then
    raise exception 'Groupe introuvable (déjà supprimé ?)';
  end if;

  -- Comme une suppression depuis l'appli (remove : deleted à vrai, date de modification) ; hb_stamp signe, hb_log
  -- note « suppression » (« (privé) » pour un groupe privé ou « Mon staff »), hb_touch le fait redescendre à tous.
  v_now := greatest((extract(epoch from clock_timestamp()) * 1000)::bigint, coalesce(v_ts, 0) + 1);
  update public.hb_groups
     set data = v_g || jsonb_build_object('deleted', true, 'updatedAt', v_now), deleted = true, updated_at_client = v_now
   where id = p_id;

  v_owner := case when v_g ->> 'createdBy' ~ '^[0-9a-f-]{36}$' then (v_g ->> 'createdBy')::uuid end;
  if v_owner is not null and v_owner <> v_uid then
    perform public.hb_notify(v_owner, 'participant', 'admin-delete:' || p_id, 'Groupe supprimé',
      coalesce(v_name, 'Un administrateur') || ' a supprimé ton groupe « ' || coalesce(v_g ->> 'name', '?') || ' »', null, '/groupes');
  end if;
  return jsonb_build_object('name', v_g ->> 'name');
end $$;

-- ---------- Réattribution (038) : tout groupe non supprimé ----------

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
  -- 039 : tout groupe non supprimé, y compris privé ou « Mon staff » d'un autre (« Voir tous les groupes »).
  if v_g is null or v_deleted or coalesce((v_g ->> 'purged')::boolean, false) then
    raise exception 'Groupe introuvable (supprimé ?)';
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

-- ---------- Droits des fonctions (reprise de 038, avec les fonctions administrateur de 039) ----------
-- Appelées par l'appli (supabase.rpc) ou par les règles de lecture : comptes connectés seulement.
-- Toutes les autres fonctions hb_* (déclencheurs, outils internes) : personne, sauf le serveur.
do $$
declare
  f record;
  v_app text[] := array['hb_upsert', 'hb_merge_players', 'hb_create_member', 'hb_update_member', 'hb_delete_member',
                        'hb_members', 'hb_set_role', 'hb_set_departments', 'hb_purge_expired', 'hb_purge_deleted',
                        'hb_push_subscribe', 'hb_push_unsubscribe', 'hb_set_notif_prefs', 'hb_notif_test', 'hb_has_role',
                        'hb_ping', 'hb_last_seen', 'hb_is_participant', 'hb_log_view_as', 'hb_transfer_group',
                        'hb_admin_groups', 'hb_admin_group', 'hb_admin_delete_group'];
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

-- Vérification : les fonctions sont en place.
select count(*) filter (where proname in ('hb_admin_groups', 'hb_admin_group', 'hb_admin_delete_group')) = 3 as fonctions_ok,
       exists (select 1 from pg_proc where proname = 'hb_transfer_group') as reattribution_ok
  from pg_proc where pronamespace = 'public'::regnamespace;
