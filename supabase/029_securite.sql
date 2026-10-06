-- HandBase : renforcement de la sécurité (suite à l'audit).
-- À exécuter une fois dans Supabase > SQL Editor, APRÈS 028_purge_suppressions.sql.
-- Peut être relancé sans risque.
--
--  1. Fusion de fiches (hb_merge_players) : administrateurs uniquement. Au passage, correctif de 023 :
--     le déclencheur hb_groups_follow_merge faisait échouer toute fusion.
--  2. Écritures : un horodatage d'appareil dans le futur est ramené à « maintenant + 5 minutes » ;
--     une ligne non écrite parce que le serveur a plus récent est renvoyée comme refusée (l'appareil
--     reprend la version du serveur). Un simple renvoi (même horodatage) reste accepté.
--  3. Ligne supprimée : seul un administrateur peut la restaurer ; ligne effacée (purged) : intouchable.
--  4. Traces de fusion (mergedInto, mergedFrom) : posées par le serveur seulement.
--  5. Changer le département d'un joueur (n° de club, licence, département) : administrateur, ou
--     encadrant qui valide à la fois l'ancien et le nouveau département.
--  6. Avis mis hors cadre : il le reste quand son auteur le renvoie sans le modifier.
--  7. E-mail et téléphone des membres : lisibles par les administrateurs (et par soi-même) seulement,
--     via hb_members(). Les autres colonnes (nom, rôle, secteur) restent lisibles par le staff.
--  8. Le nom d'un membre n'est plus repris de son compte (sauf s'il n'en a pas encore) : seul
--     un administrateur le change (hb_update_member).
--  9. Notifications : effacées 30 jours après leur envoi, et tout de suite quand le joueur cité est effacé.
-- 10. Expiration des fiches proposées : le délai part de la dernière décision (remise en attente) s'il y en a une.
-- 11. Journal : rien du contenu des groupes et alertes privés (seulement l'action, « (privé) »).
-- 12. Fonctions internes (déclencheurs, outils) : plus appelables depuis l'appli ; search_path fixé.
-- 13. Nouveau compte : aucun rôle, donc aucun accès aux données, tant qu'un administrateur ne lui en a
--     pas donné un (les comptes créés depuis l'appli reçoivent leur rôle tout de suite, comme avant).

-- ---------- 13. Compte sans rôle = aucun accès ----------

alter table public.hb_profiles alter column role drop not null;
alter table public.hb_profiles alter column role set default null;

-- Le compte connecté a-t-il un rôle attribué ?
create or replace function public.hb_has_role() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.hb_profiles
                  where user_id = auth.uid() and role in ('admin', 'preparateur', 'observateur'))
$$;

-- Lecture des données : seulement avec un rôle (les règles des groupes et alertes privés restent).
do $$
declare t text;
begin
  foreach t in array array['players', 'criteria', 'measurements', 'events', 'evaluations', 'lists'] loop
    execute format('drop policy if exists "staff_read" on public.hb_%1$s;
      create policy "staff_read" on public.hb_%1$s for select to authenticated using ((select public.hb_has_role()));', t);
  end loop;
  foreach t in array array['groups', 'alerts'] loop
    execute format('drop policy if exists "staff_read" on public.hb_%1$s;
      create policy "staff_read" on public.hb_%1$s for select to authenticated using (
        (select public.hb_has_role())
        and (not coalesce((data ->> ''private'')::boolean, false) or data ->> ''createdBy'' = auth.uid()::text));', t);
  end loop;
end $$;

-- Profils : le staff voit le staff ; un compte sans rôle ne voit que le sien.
drop policy if exists "staff_read" on public.hb_profiles;
create policy "staff_read" on public.hb_profiles for select to authenticated
  using (user_id = auth.uid() or (select public.hb_has_role()));

-- ---------- 7. E-mail et téléphone des membres ----------

-- Colonnes lisibles par le staff (sans e-mail ni téléphone).
revoke all on public.hb_profiles from anon;
revoke select on public.hb_profiles from authenticated;
grant select (user_id, full_name, role, departments, created_at, notif) on public.hb_profiles to authenticated;

-- Liste complète (avec e-mail et téléphone) : tous les membres pour un administrateur, sinon soi-même.
create or replace function public.hb_members()
returns table (user_id uuid, email text, full_name text, role text, departments text[], phone text)
language sql stable security definer set search_path = public as $$
  select p.user_id, p.email, p.full_name, p.role, p.departments, p.phone
    from public.hb_profiles p
   where p.user_id = auth.uid()
      or exists (select 1 from public.hb_profiles a where a.user_id = auth.uid() and a.role = 'admin')
   order by p.full_name
$$;

-- ---------- 8. Nom et e-mail tenus à jour quand le compte change ----------
-- L'e-mail suit le compte. Le nom n'est repris que si le profil n'en a pas encore (premier lancement,
-- « Ton nom ») : ensuite, seul un administrateur le change (hb_update_member).

create or replace function public.hb_on_user_updated() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.hb_profiles
     set email = new.email,
         full_name = case when coalesce(trim(full_name), '') = ''
                          then nullif(trim(new.raw_user_meta_data ->> 'full_name'), '') else full_name end
   where user_id = new.id;
  return new;
end $$;

-- ---------- 1. Fusion de fiches : administrateurs uniquement ----------

create or replace function public.hb_merge_players(p_source text, p_target text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_role text;
  v_name text;
  s jsonb;
  t jsonb;
  m jsonb;
  k text;
  v jsonb;
  -- Horodatage « appareil » plus récent que toute version existante : la fusion l'emporte partout.
  v_now bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
  v_keep text[] := array['id', 'updatedAt', 'deleted', 'createdBy', 'createdByName', 'createdAtServer', 'updatedBy',
                         'updatedByName', 'updatedAtServer', 'review', 'reviewNote', 'reviewedBy', 'reviewedByName',
                         'reviewedAt', 'mergedFrom', 'mergedInto', 'notes', 'previousLicenses', 'purged'];
begin
  select role, coalesce(full_name, email) into v_role, v_name from public.hb_profiles where user_id = v_uid;
  if v_role is distinct from 'admin' then
    raise exception 'Réservé aux administrateurs';
  end if;
  if p_source = p_target then raise exception 'Choisir deux fiches différentes'; end if;
  select data into s from public.hb_players where id = p_source and not deleted for update;
  select data into t from public.hb_players where id = p_target and not deleted for update;
  if s is null or t is null then raise exception 'Fiche introuvable (déjà supprimée ou fusionnée ?)'; end if;

  -- Avis, mesures et référents : rattachés à la cible.
  update public.hb_evaluations set data = data || jsonb_build_object('playerId', p_target, 'updatedAt', v_now), updated_at_client = v_now
   where data ->> 'playerId' = p_source;
  update public.hb_measurements set data = data || jsonb_build_object('playerId', p_target, 'updatedAt', v_now), updated_at_client = v_now
   where data ->> 'playerId' = p_source;
  update public.hb_referents set data = data || jsonb_build_object('playerId', p_target, 'updatedAt', v_now), updated_at_client = v_now
   where data ->> 'playerId' = p_source;

  -- Listes de joueurs des événements : la source remplacée par la cible, à sa place, sans doublon.
  update public.hb_events e
     set data = e.data || jsonb_build_object('updatedAt', v_now, 'playerIds', (
           select coalesce(jsonb_agg(x order by o), '[]'::jsonb)
             from (select distinct on (x) x, o
                     from (select case when a.v = p_source then p_target else a.v end as x, a.o
                             from jsonb_array_elements_text(e.data -> 'playerIds') with ordinality a(v, o)) z
                    order by x, o) y)),
         updated_at_client = v_now
   where e.data -> 'playerIds' ? p_source;

  -- Cible complétée par ce que la source savait de plus.
  m := t;
  for k, v in select key, value from jsonb_each(s) loop
    continue when k = any (v_keep) or v = 'null'::jsonb or v = '""'::jsonb;
    if not (m ? k) or m -> k = 'null'::jsonb or m -> k = '""'::jsonb then
      m := m || jsonb_build_object(k, v);
    end if;
  end loop;
  -- Deux licences différentes : celle de la source rejoint les anciennes licences de la cible.
  if coalesce(s ->> 'license', '') <> '' and coalesce(t ->> 'license', '') <> '' and s ->> 'license' <> t ->> 'license'
     or jsonb_array_length(coalesce(s -> 'previousLicenses', '[]'::jsonb)) > 0 then
    m := m || jsonb_build_object('previousLicenses', (
      select coalesce(jsonb_agg(distinct l), '[]'::jsonb)
        from jsonb_array_elements_text(coalesce(t -> 'previousLicenses', '[]'::jsonb) || coalesce(s -> 'previousLicenses', '[]'::jsonb)
             || case when coalesce(s ->> 'license', '') not in ('', coalesce(t ->> 'license', '')) then jsonb_build_array(s ->> 'license') else '[]'::jsonb end) l
       where l <> coalesce(m ->> 'license', '')));
  end if;
  -- Notes : mises bout à bout.
  if coalesce(s ->> 'notes', '') <> '' and coalesce(s ->> 'notes', '') <> coalesce(t ->> 'notes', '') then
    m := m || jsonb_build_object('notes', concat_ws(E'\n', nullif(t ->> 'notes', ''), s ->> 'notes'));
  end if;
  -- Trace de la fusion (et de l'histoire de la fiche source).
  m := m || jsonb_build_object('updatedAt', v_now, 'mergedFrom', coalesce(t -> 'mergedFrom', '[]'::jsonb)
         || coalesce(s -> 'mergedFrom', '[]'::jsonb)
         || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
              'id', p_source,
              'name', trim(coalesce(s ->> 'firstName', '') || ' ' || coalesce(s ->> 'lastName', '')),
              'license', s -> 'license', 'club', s -> 'club',
              'review', s -> 'review', 'reviewNote', s -> 'reviewNote',
              'reviewedByName', s -> 'reviewedByName', 'reviewedAt', s -> 'reviewedAt',
              'createdByName', s -> 'createdByName', 'createdAtServer', s -> 'createdAtServer',
              'mergedAt', now(), 'mergedByName', v_name))));
  update public.hb_players set data = m, updated_at_client = v_now where id = p_target;

  -- La source disparaît, en gardant l'adresse de la cible.
  update public.hb_players set data = s || jsonb_build_object('mergedInto', p_target, 'updatedAt', v_now, 'deleted', true),
                               deleted = true, updated_at_client = v_now
   where id = p_source;
end $$;

-- Correctif de 023 : « g.data -> 'addedBy' - new.id » se lisait g.data -> ('addedBy' - new.id) et faisait
-- échouer TOUTE fusion (erreur « invalid input syntax for type json »). Parenthèses ajoutées.
create or replace function public.hb_groups_follow_merge() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_target text := new.data ->> 'mergedInto';
  v_now bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
begin
  if v_target is null or old.data ->> 'mergedInto' is not distinct from v_target then return null; end if;
  update public.hb_groups g
     set data = g.data || jsonb_build_object('updatedAt', v_now,
           -- La fiche gardée hérite de « ajouté par » de la fiche fondue (si elle n'en avait pas).
           'addedBy', case when (g.data -> 'addedBy') ? new.id
             then ((g.data -> 'addedBy') - new.id) || jsonb_build_object(v_target, coalesce(g.data -> 'addedBy' -> v_target, g.data -> 'addedBy' -> new.id))
             else coalesce(g.data -> 'addedBy', '{}'::jsonb) end,
           'playerIds', (
           select coalesce(jsonb_agg(x order by o), '[]'::jsonb)
             from (select distinct on (x) x, o
                     from (select case when a.v = new.id then v_target else a.v end as x, a.o
                             from jsonb_array_elements_text(g.data -> 'playerIds') with ordinality a(v, o)) z
                    order by x, o) y)),
         updated_at_client = v_now
   where g.data -> 'playerIds' ? new.id;
  return null;
end $$;

-- ---------- 2 à 6. Écritures ----------

-- Écrit les lignes autorisées (la plus récente gagne) et renvoie les identifiants refusés.
create or replace function public.hb_upsert(p_table text, p_rows jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_role text;
  v_name text;
  v_rejected jsonb := '[]'::jsonb;
  r jsonb;
  v_data jsonb;
  v_existing jsonb;
  v_existing_deleted boolean;
  v_existing_ts bigint;
  v_ts bigint;
  -- Horodatage le plus avancé accepté : l'heure du serveur + 5 minutes (en ms).
  v_max bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint + 5 * 60 * 1000;
  v_count int;
  v_deleting boolean;
  v_ok boolean;
  v_author boolean;
  v_reviewing boolean;
  v_decision boolean;
  v_review_keys text[] := array['review', 'reviewNote', 'reviewedBy', 'reviewedByName', 'reviewedAt'];
  v_event_id text;
  v_now bigint;
  v_participant boolean := false;
  v_old_ids jsonb;
  v_new_ids jsonb;
  v_added_by jsonb;
  v_editors jsonb;
  v_old_dept text;
  v_new_dept text;
begin
  if v_uid is null then raise exception 'Connexion requise'; end if;
  if p_table not in ('players','criteria','measurements','events','evaluations','referents','groups','lists','alerts') then
    raise exception 'Table inconnue : %', p_table;
  end if;
  select role, coalesce(full_name, email) into v_role, v_name from public.hb_profiles where user_id = v_uid;
  -- Compte sans rôle (nouveau compte pas encore accepté par un administrateur) : aucune écriture.
  if v_role is null or v_role not in ('admin', 'preparateur', 'observateur') then
    raise exception 'Compte en attente : un administrateur doit d’abord t’attribuer un rôle';
  end if;

  for r in select * from jsonb_array_elements(p_rows) loop
    v_data := r -> 'data';
    v_deleting := coalesce((r ->> 'deleted')::boolean, false);
    -- Horloge de l'appareil en avance : on ne la suit pas au-delà de 5 minutes.
    v_ts := least(coalesce((r ->> 'updated_at_client')::bigint, 0), v_max);
    if jsonb_typeof(v_data -> 'updatedAt') = 'number' and (v_data ->> 'updatedAt')::numeric > v_max then
      v_data := jsonb_set(v_data, '{updatedAt}', to_jsonb(v_max));
    end if;
    execute format('select data, deleted, updated_at_client from public.hb_%1$s where id = $1', p_table)
      into v_existing, v_existing_deleted, v_existing_ts using r ->> 'id';

    -- Ligne supprimée ou effacée sur le serveur.
    if v_existing is not null and (v_existing_deleted or coalesce((v_existing ->> 'purged')::boolean, false)) then
      if v_deleting then
        continue; -- suppression renvoyée : déjà faite, rien à changer
      elsif coalesce((v_existing ->> 'purged')::boolean, false) or v_role <> 'admin' then
        -- Effacée : intouchable. Supprimée : seul un administrateur la restaure.
        v_rejected := v_rejected || to_jsonb(r ->> 'id');
        continue;
      end if;
    end if;

    -- Le serveur a une version plus récente : refusée, l'appareil reprend celle du serveur.
    -- (Même horodatage : simple renvoi, accepté.)
    if v_existing is not null and v_existing_ts > v_ts then
      v_rejected := v_rejected || to_jsonb(r ->> 'id');
      continue;
    end if;

    -- Traces de fusion : seul hb_merge_players les pose ; celles déjà enregistrées restent.
    if p_table = 'players' then
      v_data := (v_data - 'mergedInto' - 'mergedFrom')
        || (select coalesce(jsonb_object_agg(key, value), '{}'::jsonb) from jsonb_each(coalesce(v_existing, '{}'::jsonb))
             where key in ('mergedInto', 'mergedFrom'));
    end if;

    -- L'auteur d'un avis : celui qui l'a écrit (ou qui l'écrit, pour un nouvel avis).
    v_author := coalesce(p_table = 'evaluations'
      and v_data ->> 'observerId' = v_uid::text
      and (v_existing is null or v_existing ->> 'observerId' = v_uid::text), false);
    -- Décision sur l'avis spontané d'un autre : l'avis enregistré fait foi, seule la décision change.
    v_reviewing := p_table = 'evaluations' and not v_author and not v_deleting and coalesce(v_existing ? 'review', false);
    -- Décision sur une fiche (proposée, validée ou hors cadre) par un encadrant ou un administrateur.
    v_decision := p_table = 'players' and not v_deleting and v_role in ('admin', 'preparateur')
      and coalesce(v_data ->> 'review', '') is distinct from coalesce(v_existing ->> 'review', '');

    -- Participant d'un groupe partagé (023) ou d'un événement (024) : encadrant désigné par le créateur. Il ajoute des joueurs,
    -- retire seulement ceux qu'il a ajoutés et peut se retirer lui-même ; le reste du groupe ne bouge pas.
    v_participant := p_table in ('groups', 'events') and v_role = 'preparateur' and not v_deleting and v_existing is not null
      and not coalesce((v_existing ->> 'private')::boolean, false)
      and coalesce(v_existing ->> 'createdBy', '') not in ('', v_uid::text)
      and coalesce(v_existing -> 'editors', '[]'::jsonb) ? v_uid::text;
    if v_participant then
      v_old_ids := coalesce(v_existing -> 'playerIds', '[]'::jsonb);
      v_new_ids := coalesce(v_data -> 'playerIds', '[]'::jsonb);
      -- Joueurs retirés : chacun doit avoir été ajouté par ce participant.
      if exists (
        select 1 from jsonb_array_elements_text(v_old_ids) o(id)
         where not (v_new_ids ? o.id)
           and coalesce(v_existing -> 'addedBy' ->> o.id, v_existing ->> 'createdBy') is distinct from v_uid::text
      ) then
        v_rejected := v_rejected || to_jsonb(r ->> 'id');
        continue;
      end if;
      -- Le groupe garde tout le reste ; seuls la liste et, s'il se retire, ses participants changent.
      v_editors := coalesce(v_existing -> 'editors', '[]'::jsonb);
      if not (coalesce(v_data -> 'editors', '[]'::jsonb) ? v_uid::text) then
        v_editors := v_editors - v_uid::text;
      end if;
      v_data := v_existing || jsonb_build_object('playerIds', v_new_ids, 'editors', v_editors, 'updatedAt', v_data -> 'updatedAt');
    end if;

    v_ok := case
      when v_participant then true
      -- Tout avis est rattaché à un événement ou à un contexte libre (sauf pour le supprimer).
      when p_table = 'evaluations' and not v_deleting and not v_reviewing
        and coalesce(v_data ->> 'eventId', '') = '' and coalesce(v_data ->> 'contextType', '') = '' then false
      -- Décisions : seulement dans son secteur (département du joueur).
      -- … ou, pour un avis hors liste sur un événement, l'organisateur de l'événement (021).
      when v_reviewing then public.hb_can_review(v_uid,
          (select public.hb_player_dept(data) from public.hb_players where id = v_existing ->> 'playerId'))
        or public.hb_event_manager(v_uid, v_existing ->> 'eventId')
      when v_decision then public.hb_can_review(v_uid, public.hb_player_dept(coalesce(v_existing, v_data)))
      -- Groupe privé : seul son créateur y touche (administrateur compris : il ne le voit même pas).
      when p_table in ('groups', 'alerts') and coalesce((v_existing ->> 'private')::boolean, false)
        and v_existing ->> 'createdBy' is distinct from v_uid::text then false
      when v_role = 'admin' then true
      -- Fiches : l'encadrant crée et modifie ; l'observateur propose une fiche et la modifie
      -- tant qu'elle n'est pas traitée. Personne d'autre que l'administrateur ne supprime.
      when p_table = 'players' then not v_deleting and (
        v_role = 'preparateur'
        or v_existing is null
        or (v_existing ->> 'createdBy' = v_uid::text and v_existing ->> 'review' = 'pending'))
      when p_table = 'measurements' then v_role = 'preparateur'
      -- Un encadrant ne modifie / supprime que ses propres événements
      -- (ou ceux sans créateur connu, créés avant le journal d'activité).
      when p_table = 'events' then v_role = 'preparateur'
        and (v_existing is null or coalesce(v_existing ->> 'createdBy', '') in ('', v_uid::text))
      when p_table = 'evaluations' then v_author
      -- Groupes : chacun gère les siens ; l'observateur seulement des groupes privés.
      when p_table in ('groups', 'alerts') then (v_existing is null or coalesce(v_existing ->> 'createdBy', '') in ('', v_uid::text))
        and (v_role = 'preparateur' or coalesce((v_data ->> 'private')::boolean, false))
      -- Référents : l'encadrant gère tout ; l'observateur seulement ceux qu'il a saisis.
      when p_table = 'referents' then v_role = 'preparateur'
        or v_existing is null or v_existing ->> 'createdBy' = v_uid::text
      else false -- critères et listes (régions…) : administrateurs uniquement
    end;

    -- Pas de décision sur un avis supprimé entre-temps (on le ferait réapparaître).
    if v_reviewing and v_existing_deleted then
      v_ok := false;
    end if;

    -- Changer le département d'un joueur (n° de club, licence ou département saisi) le fait changer de secteur :
    -- un encadrant doit valider à la fois l'ancien et le nouveau département (département inconnu : pas de contrôle de ce côté).
    if coalesce(v_ok, false) and p_table = 'players' and v_role = 'preparateur' and v_existing is not null and not v_deleting then
      v_old_dept := public.hb_player_dept(v_existing);
      v_new_dept := public.hb_player_dept(v_data);
      if v_old_dept is distinct from v_new_dept then
        v_ok := (v_old_dept is null or public.hb_can_review(v_uid, v_old_dept))
            and (v_new_dept is null or public.hb_can_review(v_uid, v_new_dept));
      end if;
    end if;

    if not coalesce(v_ok, false) then
      v_rejected := v_rejected || to_jsonb(r ->> 'id');
      continue;
    end if;

    if p_table = 'evaluations' and not v_deleting then
      if v_reviewing then
        -- Décision d'un validateur : seuls la décision et son commentaire changent.
        v_data := (v_existing - v_review_keys - 'updatedAt') || jsonb_strip_nulls(jsonb_build_object(
          'updatedAt', v_data -> 'updatedAt',
          'review', case when v_data ->> 'review' in ('pending', 'validated', 'refused') then v_data ->> 'review' else v_existing ->> 'review' end,
          'reviewNote', nullif(trim(v_data ->> 'reviewNote'), ''),
          'reviewedBy', v_uid, 'reviewedByName', v_name, 'reviewedAt', now()));
      else
        -- Un avis est toujours signé du nom du compte qui l'écrit.
        if v_role <> 'admin' and v_name is not null then
          v_data := jsonb_set(v_data, '{observer}', to_jsonb(v_name));
        end if;
        if v_existing is not null and v_existing ->> 'review' = 'refused'
          and public.hb_eval_content(v_existing) = public.hb_eval_content(v_data) then
          -- Avis hors cadre renvoyé sans changement (quel que soit le rôle) : il reste hors cadre.
          v_data := (v_data - v_review_keys)
            || (select coalesce(jsonb_object_agg(key, value), '{}'::jsonb) from jsonb_each(v_existing) where key = any (v_review_keys));
        elsif coalesce(v_data ->> 'eventId', '') <> '' then
          if public.hb_event_manager(v_uid, v_data ->> 'eventId')
            or coalesce((select e.data -> 'playerIds' from public.hb_events e where e.id = v_data ->> 'eventId'), '[]'::jsonb) ? (v_data ->> 'playerId') then
            -- Avis sur un joueur de la liste (ou écrit par l'organisateur) : pas de validation.
            v_data := v_data - v_review_keys;
          elsif v_existing is not null and public.hb_eval_content(v_existing) = public.hb_eval_content(v_data) then
            -- Avis inchangé (simple renvoi) : son état reste.
            v_data := (v_data - v_review_keys)
              || (select coalesce(jsonb_object_agg(key, value), '{}'::jsonb) from jsonb_each(v_existing) where key = any (v_review_keys));
          else
            -- Joueur hors liste, nouvel avis ou avis modifié : en attente de validation (021).
            v_data := (v_data - v_review_keys) || jsonb_build_object('review', 'pending');
          end if;
        elsif v_existing is not null and v_existing ? 'review'
          and public.hb_eval_content(v_existing) = public.hb_eval_content(v_data)
          and (v_role = 'observateur' or v_existing ->> 'review' = 'validated') then
          -- Avis inchangé (simple renvoi) : la décision reste.
          v_data := (v_data - v_review_keys)
            || (select coalesce(jsonb_object_agg(key, value), '{}'::jsonb) from jsonb_each(v_existing) where key = any (v_review_keys));
        elsif v_role in ('admin', 'preparateur') then
          -- Avis spontané d'un encadrant ou d'un administrateur : validé d'office.
          v_data := (v_data - v_review_keys) || jsonb_build_object(
            'review', 'validated', 'reviewedBy', v_uid, 'reviewedByName', v_name, 'reviewedAt', now());
        else
          -- Avis spontané d'un observateur, nouveau ou modifié : en attente de validation.
          v_data := (v_data - v_review_keys) || jsonb_build_object('review', 'pending');
        end if;
      end if;
    end if;

    if p_table = 'players' and not v_deleting then
      if v_role = 'observateur' then
        -- Fiche proposée par un observateur : reste « proposée » jusqu'à la décision d'un encadrant.
        -- (Une remise en attente garde qui l'a décidée et quand : le délai d'expiration part de là.)
        v_data := (v_data - v_review_keys)
          || (select coalesce(jsonb_object_agg(key, value), '{}'::jsonb) from jsonb_each(coalesce(v_existing, '{}'::jsonb))
               where key = any (v_review_keys) and key <> 'review')
          || jsonb_build_object('review', 'pending');
      elsif v_decision then
        -- Décision d'un encadrant ou d'un administrateur : signée par le serveur.
        v_data := (v_data - v_review_keys) || jsonb_strip_nulls(jsonb_build_object(
          'review', case when v_data ->> 'review' in ('pending', 'validated', 'refused') then v_data ->> 'review' end,
          'reviewNote', nullif(trim(v_data ->> 'reviewNote'), ''),
          'reviewedBy', v_uid, 'reviewedByName', v_name, 'reviewedAt', now()));
      else
        -- Pas de nouvelle décision : celle d'origine reste, quoi qu'envoie l'appareil.
        v_data := (v_data - v_review_keys)
          || (select coalesce(jsonb_object_agg(key, value), '{}'::jsonb) from jsonb_each(coalesce(v_existing, '{}'::jsonb)) where key = any (v_review_keys));
      end if;
    end if;

    if p_table in ('groups', 'events') and not v_deleting then
      -- Qui a ajouté chaque joueur (023, 024) : gardé pour les joueurs déjà là, ce compte pour les nouveaux.
      -- Événement créé ou complété par son organisateur depuis un groupe : un joueur peut garder celui qui
      -- l'avait ajouté au groupe (un encadrant), tel qu'envoyé par l'appli.
      v_old_ids := coalesce(v_existing -> 'playerIds', '[]'::jsonb);
      select coalesce(jsonb_object_agg(x.id, case
               when v_old_ids ? x.id then coalesce(v_existing -> 'addedBy' ->> x.id, v_existing ->> 'createdBy', v_uid::text)
               when p_table = 'events' and not v_participant and exists (
                 select 1 from public.hb_profiles pr
                  where pr.user_id::text = v_data -> 'addedBy' ->> x.id and pr.role in ('preparateur', 'admin'))
                 then v_data -> 'addedBy' ->> x.id
               else v_uid::text end), '{}'::jsonb)
        into v_added_by
        from jsonb_array_elements_text(coalesce(v_data -> 'playerIds', '[]'::jsonb)) x(id);
      -- Participants : seulement des encadrants, et jamais sur un groupe privé.
      if p_table = 'groups' and coalesce((v_data ->> 'private')::boolean, false) then
        v_editors := '[]'::jsonb;
      else
        select coalesce(jsonb_agg(distinct e.id), '[]'::jsonb) into v_editors
          from jsonb_array_elements_text(coalesce(v_data -> 'editors', '[]'::jsonb)) e(id)
          join public.hb_profiles pr on pr.user_id::text = e.id and pr.role = 'preparateur';
      end if;
      v_data := v_data || jsonb_build_object('addedBy', v_added_by, 'editors', v_editors,
        -- Noms des personnes citées (affichage « ajouté par … ») : on complète, on n'efface pas.
        'names', coalesce(v_existing -> 'names', '{}'::jsonb) || coalesce(v_data -> 'names', '{}'::jsonb)
                 || jsonb_build_object(v_uid::text, v_name));
    end if;

    -- Avis hors liste validé : le joueur rejoint la liste de l'événement (021). Fait par le serveur :
    -- le validateur (encadrant du secteur) n'a pas forcément le droit de modifier l'événement.
    if v_reviewing and v_data ->> 'review' = 'validated' and coalesce(v_existing ->> 'review', '') <> 'validated' then
      v_event_id := v_existing ->> 'eventId';
      if coalesce(v_event_id, '') <> '' then
        v_now := (extract(epoch from clock_timestamp()) * 1000)::bigint;
        update public.hb_events
           set data = jsonb_set(data, '{playerIds}', coalesce(data -> 'playerIds', '[]'::jsonb) || to_jsonb(v_existing ->> 'playerId'))
                      || jsonb_build_object('updatedAt', v_now),
               updated_at_client = v_now
         where id = v_event_id and not deleted
           and not (coalesce(data -> 'playerIds', '[]'::jsonb) ? (v_existing ->> 'playerId'));
      end if;
    end if;

    execute format($f$
      insert into public.hb_%1$s (id, data, updated_at_client, deleted)
      values ($1, $2, $3, $4)
      on conflict (id) do update
        set data = excluded.data,
            updated_at_client = excluded.updated_at_client,
            deleted = excluded.deleted
        where public.hb_%1$s.updated_at_client <= excluded.updated_at_client
    $f$, p_table)
    using r ->> 'id', v_data, v_ts, v_deleting;
    -- Écriture concurrente plus récente arrivée entre-temps : refusée aussi.
    get diagnostics v_count = row_count;
    if v_count = 0 then
      v_rejected := v_rejected || to_jsonb(r ->> 'id');
    end if;
  end loop;

  return v_rejected;
end $$;

-- ---------- 11. Journal : groupes et alertes privés ----------

create or replace function public.hb_log() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  a record;
  v_table text := substr(tg_table_name, 4); -- hb_players -> players
  v_action text;
  v_changes jsonb;
  v_meta text[] := array['updatedAt', 'updatedBy', 'updatedByName', 'updatedAtServer', 'createdBy', 'createdByName', 'createdAtServer'];
  -- Groupe ou alerte privé (avant ou après) : seule l'action est notée, rien de son contenu.
  v_private boolean := tg_table_name in ('hb_groups', 'hb_alerts')
    and (coalesce((new.data ->> 'private')::boolean, false) or coalesce((old.data ->> 'private')::boolean, false));
begin
  select * into a from public.hb_actor();
  if tg_op = 'INSERT' then
    v_action := case when new.deleted then 'suppression' else 'création' end;
  elsif tg_op = 'DELETE' then
    v_action := 'suppression définitive';
  elsif new.deleted and not old.deleted then
    v_action := 'suppression';
  elsif old.deleted and not new.deleted then
    v_action := 'restauration';
  else
    v_action := 'modification';
  end if;

  if tg_op = 'UPDATE' then
    select jsonb_object_agg(k, jsonb_build_array(
             case when k = 'photo' then to_jsonb('(photo)'::text) else old.data -> k end,
             case when k = 'photo' then to_jsonb('(photo)'::text) else new.data -> k end))
      into v_changes
      from (select jsonb_object_keys(old.data || new.data) as k) keys
     where old.data -> k is distinct from new.data -> k
       and not (k = any (v_meta));
    -- Rien de réel n'a changé (resynchronisation) : pas de ligne de journal.
    if v_changes is null and v_action = 'modification' then return null; end if;
  end if;

  insert into public.hb_audit (user_id, user_name, user_role, table_name, row_id, action, summary, changes)
  values (a.uid, a.name, a.role, v_table, coalesce(new.id, old.id), v_action,
          case when v_private then '(privé)' else public.hb_summary(v_table, coalesce(new.data, old.data)) end,
          case when v_private then null else v_changes end);
  return null;
end $$;

-- Lignes déjà écrites sur des groupes et alertes privés : même règle.
update public.hb_audit a
   set summary = '(privé)', changes = null
 where a.table_name in ('groups', 'alerts')
   and (a.summary is distinct from '(privé)' or a.changes is not null)
   and (exists (select 1 from public.hb_groups g where a.table_name = 'groups' and g.id = a.row_id
                  and coalesce((g.data ->> 'private')::boolean, false))
        or exists (select 1 from public.hb_alerts l where a.table_name = 'alerts' and l.id = a.row_id
                  and coalesce((l.data ->> 'private')::boolean, false)));

-- ---------- 9. Notifications ----------

-- Efface les notifications qui citent ces joueurs (lien vers la fiche, ou nom dans le texte).
-- À appeler AVANT d'effacer les fiches (le nom sert à les retrouver).
create or replace function public.hb_forget_notifications(p_players text[]) returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_names text[];
  n integer;
begin
  if coalesce(cardinality(p_players), 0) = 0 then return 0; end if;
  select coalesce(array_agg(nm), '{}') into v_names
    from (select public.hb_player_name(x) as nm from unnest(p_players) x) y
   where length(coalesce(nm, '')) >= 3;
  delete from public.hb_notifications nt
   where nt.url = any (select '/joueurs/' || x from unnest(p_players) x)
      or exists (select 1 from unnest(v_names) nm where position(nm in coalesce(nt.body, '')) > 0);
  get diagnostics n = row_count;
  return n;
end $$;

-- ---------- 9 et 10. Expiration RGPD (reprise de 012) ----------
-- Fiche proposée : le délai part de la création, ou de la dernière décision (remise en attente).

create or replace function public.hb_purge_expired(p_months int default 12) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_limit timestamptz := now() - make_interval(months => p_months);
  v_now bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
  v_players text[];
  v_refused text[];
  v_rows text[];
  v_refs text[];
begin
  -- Appel depuis l'appli : administrateurs uniquement (le serveur, lui, l'appelle sans compte).
  if v_uid is not null and (select role from public.hb_profiles where user_id = v_uid) is distinct from 'admin' then
    raise exception 'Réservé aux administrateurs';
  end if;

  -- Fiches proposées jamais traitées depuis le délai (création ou remise en attente).
  select coalesce(array_agg(id), '{}') into v_players from public.hb_players
   where not deleted and data ->> 'review' = 'pending'
     and coalesce(greatest((data ->> 'createdAtServer')::timestamptz, (data ->> 'reviewedAt')::timestamptz), server_updated_at) < v_limit;
  -- Fiches hors cadre depuis le délai (on n'efface que leurs référents).
  select coalesce(array_agg(id), '{}') into v_refused from public.hb_players
   where not deleted and data ->> 'review' = 'refused'
     and coalesce((data ->> 'reviewedAt')::timestamptz, server_updated_at) < v_limit;

  if cardinality(v_players) = 0 and cardinality(v_refused) = 0 then
    return jsonb_build_object('fiches', 0, 'referents', 0);
  end if;

  -- Notifications qui citent les fiches expirées (avant d'effacer leur nom).
  perform public.hb_forget_notifications(v_players);

  -- Avis et mesures des fiches expirées.
  select coalesce(array_agg(id), '{}') into v_rows from (
    select id from public.hb_evaluations where not deleted and data ->> 'playerId' = any (v_players)
    union all
    select id from public.hb_measurements where not deleted and data ->> 'playerId' = any (v_players)) x;
  update public.hb_evaluations
     set data = jsonb_build_object('id', id, 'playerId', data -> 'playerId', 'deleted', true, 'purged', true, 'updatedAt', v_now, 'scores', '{}'::jsonb),
         deleted = true, updated_at_client = v_now
   where not deleted and data ->> 'playerId' = any (v_players);
  update public.hb_measurements
     set data = jsonb_build_object('id', id, 'playerId', data -> 'playerId', 'deleted', true, 'purged', true, 'updatedAt', v_now),
         deleted = true, updated_at_client = v_now
   where not deleted and data ->> 'playerId' = any (v_players);

  -- Référents : ceux des fiches expirées et ceux des fiches hors cadre depuis le délai.
  select coalesce(array_agg(id), '{}') into v_refs from public.hb_referents
   where not deleted and data ->> 'playerId' = any (v_players || v_refused);
  update public.hb_referents
     set data = jsonb_build_object('id', id, 'playerId', data -> 'playerId', 'deleted', true, 'purged', true, 'updatedAt', v_now),
         deleted = true, updated_at_client = v_now
   where id = any (v_refs);

  -- Listes de joueurs des événements.
  update public.hb_events e
     set data = e.data || jsonb_build_object('updatedAt', v_now, 'playerIds', (
           select coalesce(jsonb_agg(a.v order by a.o), '[]'::jsonb)
             from jsonb_array_elements_text(e.data -> 'playerIds') with ordinality a(v, o)
            where a.v <> all (v_players))),
         updated_at_client = v_now
   where exists (select 1 from jsonb_array_elements_text(e.data -> 'playerIds') x(v) where x.v = any (v_players));

  -- Les fiches elles-mêmes.
  update public.hb_players
     set data = jsonb_build_object('id', id, 'firstName', '', 'lastName', '', 'deleted', true, 'purged', true, 'updatedAt', v_now),
         deleted = true, updated_at_client = v_now
   where id = any (v_players);

  -- Journal : plus aucune donnée personnelle sur ces lignes, puis une ligne anonyme de bilan.
  update public.hb_audit
     set summary = '(données expirées)', changes = null
   where (table_name = 'players' and row_id = any (v_players))
      or (table_name in ('evaluations', 'measurements') and row_id = any (v_rows))
      or (table_name = 'referents' and row_id = any (v_refs));
  insert into public.hb_audit (user_id, user_name, user_role, table_name, row_id, action, summary)
  values (v_uid, case when v_uid is null then 'Serveur (tâche de nuit)' else (select coalesce(full_name, email) from public.hb_profiles where user_id = v_uid) end,
          'admin', 'players', '-', 'expiration RGPD',
          format('%s fiche(s) proposée(s) jamais traitée(s) effacée(s) ; référents effacés : %s', cardinality(v_players), cardinality(v_refs)));

  return jsonb_build_object('fiches', cardinality(v_players), 'referents', cardinality(v_refs));
end $$;

-- ---------- 9. Effacement définitif des suppressions (reprise de 028) + notifications ----------

create or replace function public.hb_purge_deleted(p_days int default 30, p_tables text[] default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_limit timestamptz := now() - make_interval(days => p_days);
  v_now bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
  v_all text[] := array['players', 'measurements', 'evaluations', 'events', 'groups', 'referents', 'alerts'];
  v_players text[];
  v_ids text[];
  v_t text;
  v_total jsonb := '{}'::jsonb;
  v_notifs integer;
begin
  -- Appel depuis l'appli : administrateurs uniquement (le serveur, lui, l'appelle sans compte).
  if v_uid is not null and (select role from public.hb_profiles where user_id = v_uid) is distinct from 'admin' then
    raise exception 'Réservé aux administrateurs';
  end if;

  -- Joueurs supprimés depuis le délai (pas encore effacés).
  if p_tables is null or 'players' = any (p_tables) then
    select coalesce(array_agg(id), '{}') into v_players from public.hb_players
     where deleted and server_updated_at < v_limit and not coalesce((data ->> 'purged')::boolean, false);
  else
    v_players := '{}';
  end if;

  if cardinality(v_players) > 0 then
    -- Notifications qui les citent (avant d'effacer leur nom).
    perform public.hb_forget_notifications(v_players);

    -- Leurs mesures, avis et référents (même non supprimés) partent avec eux.
    foreach v_t in array array['measurements', 'evaluations', 'referents'] loop
      execute format('update public.hb_%1$s
                         set data = jsonb_build_object(''id'', id, ''playerId'', data -> ''playerId'', ''deleted'', true, ''purged'', true, ''updatedAt'', $1)
                             || case when %1$L = ''evaluations'' then jsonb_build_object(''scores'', ''{}''::jsonb) else ''{}''::jsonb end,
                             deleted = true, updated_at_client = $1
                       where data ->> ''playerId'' = any ($2) and not coalesce((data ->> ''purged'')::boolean, false)
', v_t)
        using v_now, v_players;
      update public.hb_audit set summary = '(données effacées)', changes = null
       where table_name = v_t and row_id in (select id from public.hb_measurements where v_t = 'measurements' and data ->> 'playerId' = any (v_players)
                                             union all select id from public.hb_evaluations where v_t = 'evaluations' and data ->> 'playerId' = any (v_players)
                                             union all select id from public.hb_referents where v_t = 'referents' and data ->> 'playerId' = any (v_players));
    end loop;

    -- Retirés des événements et des groupes (et de « ajouté par »).
    update public.hb_events e
       set data = e.data || jsonb_build_object('updatedAt', v_now,
             'addedBy', coalesce(e.data -> 'addedBy', '{}'::jsonb) - v_players,
             'playerIds', (select coalesce(jsonb_agg(a.v order by a.o), '[]'::jsonb)
                             from jsonb_array_elements_text(e.data -> 'playerIds') with ordinality a(v, o)
                            where a.v <> all (v_players))),
           updated_at_client = v_now
     where e.data -> 'playerIds' ?| v_players;
    update public.hb_groups g
       set data = g.data || jsonb_build_object('updatedAt', v_now,
             'addedBy', coalesce(g.data -> 'addedBy', '{}'::jsonb) - v_players,
             'playerIds', (select coalesce(jsonb_agg(a.v order by a.o), '[]'::jsonb)
                             from jsonb_array_elements_text(g.data -> 'playerIds') with ordinality a(v, o)
                            where a.v <> all (v_players))),
           updated_at_client = v_now
     where g.data -> 'playerIds' ?| v_players;
  end if;

  -- Toutes les lignes supprimées depuis le délai (dont les joueurs ci-dessus).
  foreach v_t in array v_all loop
    continue when p_tables is not null and not (v_t = any (p_tables));
    execute format('select coalesce(array_agg(id), ''{}'') from public.hb_%1$s
                     where deleted and server_updated_at < $1 and not coalesce((data ->> ''purged'')::boolean, false)', v_t)
      into v_ids using v_limit;
    if v_t = 'players' then v_ids := v_players; end if;
    continue when cardinality(v_ids) = 0;
    execute format('update public.hb_%1$s
                       set data = jsonb_build_object(''id'', id, ''deleted'', true, ''purged'', true, ''updatedAt'', $1)
                           || case when %1$L = ''players'' then jsonb_build_object(''firstName'', '''', ''lastName'', '''')
                                   when %1$L in (''measurements'', ''evaluations'', ''referents'') then jsonb_build_object(''playerId'', data -> ''playerId'')
                                   else ''{}''::jsonb end
                           || case when %1$L = ''evaluations'' then jsonb_build_object(''scores'', ''{}''::jsonb) else ''{}''::jsonb end,
                           updated_at_client = $1
                     where id = any ($2)', v_t)
      using v_now, v_ids;
    update public.hb_audit set summary = '(données effacées)', changes = null where table_name = v_t and row_id = any (v_ids);
    v_total := v_total || jsonb_build_object(v_t, cardinality(v_ids));
  end loop;

  -- Notifications envoyées (ou en attente) depuis plus de 30 jours : effacées.
  delete from public.hb_notifications where coalesce(sent_at, created_at) < now() - interval '30 days';
  get diagnostics v_notifs = row_count;

  if v_total <> '{}'::jsonb then
    insert into public.hb_audit (user_id, user_name, user_role, table_name, row_id, action, summary)
    values (v_uid, case when v_uid is null then 'Serveur (tâche de nuit)' else (select coalesce(full_name, email) from public.hb_profiles where user_id = v_uid) end,
            'admin', 'players', '-', 'suppression définitive',
            'Effacement des suppressions de plus de ' || p_days || ' jours : '
              || (select string_agg(value || ' ' || case key when 'players' then 'joueur(s)' when 'measurements' then 'mesure(s)'
                     when 'evaluations' then 'avis' when 'events' then 'événement(s)' when 'groups' then 'groupe(s)'
                     when 'referents' then 'référent(s)' else 'alerte(s)' end, ', ') from jsonb_each_text(v_total)));
  end if;
  return v_total;
end $$;

-- Tout de suite : les vieilles notifications (la tâche de nuit 'handbase-purge' de 028 s'en charge ensuite).
delete from public.hb_notifications where coalesce(sent_at, created_at) < now() - interval '30 days';

-- La tâche de nuit de 028 lance hb_purge_deleted() : on la reprogramme au cas où (sans pg_cron : rien de grave).
do $$
begin
  perform cron.unschedule('handbase-purge') where exists (select 1 from cron.job where jobname = 'handbase-purge');
  perform cron.schedule('handbase-purge', '27 3 * * *', 'select public.hb_purge_deleted()');
exception when others then
  raise notice 'pg_cron indisponible (%) : effacement à lancer à la main.', sqlerrm;
end $$;

-- ---------- 12. Fonctions internes : plus appelables depuis l'appli ----------

alter function public.hb_touch() set search_path = public;
alter function public.hb_eval_content(jsonb) set search_path = public;
alter function public.hb_player_dept(jsonb) set search_path = public;
alter function public.hb_member_check(text, text, text) set search_path = public;
alter function public.hb_referents_closed() set search_path = public;

-- Appelées par l'appli (supabase.rpc) ou par les règles de lecture : comptes connectés seulement.
-- Toutes les autres fonctions hb_* (déclencheurs, outils internes) : personne, sauf le serveur.
do $$
declare
  f record;
  v_app text[] := array['hb_upsert', 'hb_merge_players', 'hb_create_member', 'hb_update_member', 'hb_delete_member',
                        'hb_members', 'hb_set_role', 'hb_set_departments', 'hb_purge_expired', 'hb_purge_deleted',
                        'hb_push_subscribe', 'hb_push_unsubscribe', 'hb_set_notif_prefs', 'hb_notif_test', 'hb_has_role'];
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

-- Vérification : comptes sans rôle (à accepter dans Réglages → Équipe) et droits des fonctions.
select coalesce(full_name, '(sans nom)') as compte_sans_role from public.hb_profiles where role is null;
select p.proname as fonction, has_function_privilege('authenticated', p.oid, 'execute') as appli
  from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'hb\_%'
 order by 2 desc, 1;
