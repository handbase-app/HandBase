-- HandBase : liens vidéo sur les joueurs et les événements (détection à distance).
-- À exécuter une fois dans Supabase > SQL Editor, APRÈS 035_voir_comme.sql.
-- Peut être relancé sans risque.
--
-- Quelqu'un repère un joueur dans une vidéo (Rematch, YouTube, Handball TV, Facebook…) et la signale sans se
-- déplacer ; les encadrants la regardent avant de décider d'aller le voir. On ne stocke que des liens : aucune vidéo
-- n'est téléchargée ni hébergée.
--
-- Table hb_videos, synchronisée comme les autres (id, data, updated_at_client, deleted). Une ligne = un lien :
--   { targetKind: 'player' | 'event', targetId, url, title?, at? (moment, en secondes) } + signature du serveur
--   (createdBy, createdByName, createdAtServer…, posée par hb_stamp). Table à part plutôt qu'un champ des fiches :
--   un observateur ajoute un lien sans avoir le droit de modifier la fiche ou l'événement.
--   - Qui le voit : tout compte avec un rôle (comme les joueurs et les événements, visibles de tous).
--   - Qui l'ajoute : tout compte avec un rôle, sur un joueur ou un événement existant (non supprimé, fiche non fondue).
--   - Qui le modifie : son auteur seul (titre, lien, moment ; la cible ne change pas).
--   - Qui le supprime : son auteur, un administrateur, ou un encadrant (lien sur un joueur : dans son secteur,
--     comme les validations ; sur un événement : tout encadrant).
--   - Lien : http ou https seulement (javascript:, data:… refusés), 2 000 caractères au plus, sans espace ni
--     identifiant dans l'adresse (user@…). Titre : 200 caractères. Moment : entier de 0 à 99:59:59.
-- Fiche fondue (hb_merge_players) : ses liens passent sur la fiche gardée. Joueur ou événement effacé (purge,
-- expiration RGPD) : ses liens sont effacés avec lui. Liens supprimés : effacés au bout de 30 jours
-- (hb_purge_deleted, tâche de nuit), comme le reste.
-- Journal : création, modification, suppression, avec « Vidéo « titre » → joueur ou événement ».

-- ---------- Table ----------

create table if not exists public.hb_videos (
  id text primary key,
  data jsonb not null,
  updated_at_client bigint not null default 0,
  deleted boolean not null default false,
  server_updated_at timestamptz not null default clock_timestamp()
);
create index if not exists hb_videos_sua on public.hb_videos (server_updated_at);
create index if not exists hb_videos_target on public.hb_videos ((data ->> 'targetId'));
alter table public.hb_videos enable row level security;

-- Lecture : tout compte avec un rôle. Écriture : uniquement via hb_upsert.
drop policy if exists "staff_read" on public.hb_videos;
create policy "staff_read" on public.hb_videos for select to authenticated using ((select public.hb_has_role()));
revoke all on public.hb_videos from public, anon, authenticated;
grant select on public.hb_videos to authenticated;

drop trigger if exists hb_touch on public.hb_videos;
create trigger hb_touch before insert or update on public.hb_videos
  for each row execute function public.hb_touch();
drop trigger if exists hb_stamp on public.hb_videos;
create trigger hb_stamp before insert or update on public.hb_videos
  for each row execute function public.hb_stamp();
drop trigger if exists hb_log on public.hb_videos;
create trigger hb_log after insert or update or delete on public.hb_videos
  for each row execute function public.hb_log();

-- Diffusion en direct possible (les règles de lecture s'appliquent).
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables
                      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'hb_videos') then
    alter publication supabase_realtime add table public.hb_videos;
  end if;
end $$;

-- ---------- Lien accepté ----------

-- http(s)://hôte[:port][/chemin][?…][#…], sans espace, caractère de contrôle ni identifiant (user@hôte).
-- L'appli envoie l'adresse telle que le navigateur la normalise (nom de domaine accentué en punycode).
create or replace function public.hb_video_url_ok(p_url text) returns boolean
language sql immutable set search_path = public as $$
  select coalesce(length(p_url) <= 2000
    and p_url ~* '^https?://[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*(:[0-9]{1,5})?([/?#][^[:space:][:cntrl:]]*)?$', false)
$$;

-- ---------- Journal : de quoi parle une ligne (reprise de 025) ----------

create or replace function public.hb_summary(p_table text, p_data jsonb) returns text
language plpgsql stable security definer set search_path = public as $$
begin
  return case p_table
    when 'players' then trim(upper(coalesce(p_data ->> 'lastName', '')) || ' ' || coalesce(p_data ->> 'firstName', ''))
    when 'events' then p_data ->> 'name'
    when 'criteria' then p_data ->> 'label'
    when 'measurements' then coalesce(public.hb_player_name(p_data ->> 'playerId'), '?') || ' — '
      || coalesce(p_data ->> 'criterionId', '?') || ' = ' || coalesce(p_data ->> 'value', '?') || ' (' || coalesce(p_data ->> 'date', '') || ')'
    when 'evaluations' then coalesce(p_data ->> 'observer', '?') || ' → '
      || coalesce(public.hb_player_name(p_data ->> 'playerId'), '?')
    when 'groups' then p_data ->> 'name'
    when 'lists' then p_data ->> 'name'
    when 'alerts' then p_data ->> 'name'
    when 'referents' then trim(coalesce(p_data ->> 'firstName', '') || ' ' || coalesce(p_data ->> 'lastName', '')) || ' → '
      || coalesce(public.hb_player_name(p_data ->> 'playerId'), '?')
    -- 036 : « Vidéo « J3 contre Nîmes » → DUPONT Jean ».
    when 'videos' then 'Vidéo' || coalesce(' « ' || (p_data ->> 'title') || ' »', '') || ' → '
      || coalesce(case p_data ->> 'targetKind'
           when 'player' then public.hb_player_name(p_data ->> 'targetId')
           when 'event' then (select e.data ->> 'name' from public.hb_events e where e.id = p_data ->> 'targetId') end, '?')
    else null
  end;
end $$;

-- ---------- Écritures (reprise de 034) ----------

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
  v_teams jsonb;
  v_members jsonb;
  v_names jsonb;
  v_kind text;
  v_target text;
  v_url text;
begin
  if v_uid is null then raise exception 'Connexion requise'; end if;
  if p_table not in ('players','criteria','measurements','events','evaluations','referents','groups','lists','alerts','follows','teams','videos') then
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
      elsif coalesce((v_existing ->> 'purged')::boolean, false)
        or (v_role <> 'admin' and not (p_table = 'follows' and v_existing ->> 'createdBy' = v_uid::text)) then
        -- Effacée : intouchable. Supprimée : seul un administrateur la restaure
        -- (032 : un suivi arrêté, son propriétaire le reprend quand il veut).
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

    -- 031 : groupe d'équipe = « team » à true sur un groupe non privé (privé l'emporte ; toute autre valeur est retirée).
    if p_table = 'groups' and not v_deleting then
      v_data := (v_data - 'team') || case when coalesce((v_data ->> 'team')::boolean, false)
        and not coalesce((v_data ->> 'private')::boolean, false) then '{"team": true}'::jsonb else '{}'::jsonb end;
    end if;

    -- 032 : « Suivi par l'équipe » (teamFollow) : sur un groupe d'équipe ou du staff, son créateur seul le change ;
    -- jamais sur un groupe privé. Toute autre valeur que true est retirée.
    if p_table = 'groups' and not v_deleting then
      v_data := (v_data - 'teamFollow') || case
        when coalesce((v_data ->> 'private')::boolean, false) then '{}'::jsonb
        when v_existing is not null and v_existing ->> 'createdBy' is distinct from v_uid::text then
          case when v_existing -> 'teamFollow' = 'true'::jsonb then '{"teamFollow": true}'::jsonb else '{}'::jsonb end
        when v_data -> 'teamFollow' = 'true'::jsonb then '{"teamFollow": true}'::jsonb
        else '{}'::jsonb end;
    end if;

    -- 032 : suivi d'un joueur ou d'un groupe : identifiant « <compte>:<player|group>:<cible> », rien d'autre n'est gardé.
    if p_table = 'follows' then
      v_data := jsonb_strip_nulls(jsonb_build_object(
        'id', r ->> 'id', 'kind', v_data ->> 'kind', 'targetId', v_data ->> 'targetId',
        'updatedAt', v_data -> 'updatedAt', 'deleted', case when v_deleting then true end));
    end if;

    -- 034 : staff (équipe d'encadrants enregistrée) : nom, description, membres (encadrants seulement, sans doublon)
    -- et leurs noms, repris des profils ; rien d'autre n'est gardé (créé par / modifié par : hb_stamp).
    if p_table = 'teams' then
      select coalesce(jsonb_agg(m.id order by m.id), '[]'::jsonb),
             coalesce(jsonb_object_agg(m.id, coalesce(m.full_name, '')), '{}'::jsonb)
        into v_members, v_names
        from (select distinct x.id, pr.full_name
                from jsonb_array_elements_text(public.hb_arr(v_data -> 'members')) x(id)
                join public.hb_profiles pr on pr.user_id::text = x.id and pr.role = 'preparateur') m;
      v_data := jsonb_strip_nulls(jsonb_build_object(
        'id', r ->> 'id', 'name', left(nullif(btrim(v_data ->> 'name'), ''), 80),
        'description', left(nullif(btrim(v_data ->> 'description'), ''), 300),
        'members', v_members, 'names', v_names,
        'updatedAt', v_data -> 'updatedAt', 'deleted', case when v_deleting then true end));
    end if;

    -- 036 : lien vidéo. La cible (joueur ou événement) est fixée à la création. Champs gardés : cible, lien (http/https
    -- seulement, sinon retiré : la ligne est alors refusée), titre (200 caractères), moment (secondes, moins de 100 h).
    -- Suppression : le contenu enregistré reste tel quel (celui qui supprime le lien d'un autre ne le modifie pas).
    if p_table = 'videos' then
      v_kind := coalesce(v_existing ->> 'targetKind', v_data ->> 'targetKind');
      v_target := coalesce(v_existing ->> 'targetId', nullif(btrim(v_data ->> 'targetId'), ''));
      if v_deleting and v_existing is not null then
        v_data := (v_existing - 'deleted') || jsonb_build_object('updatedAt', v_data -> 'updatedAt', 'deleted', true);
      else
        v_url := btrim(v_data ->> 'url');
        v_data := jsonb_strip_nulls(jsonb_build_object(
          'id', r ->> 'id', 'targetKind', v_kind, 'targetId', v_target,
          'url', case when public.hb_video_url_ok(v_url) then v_url end,
          'title', left(nullif(btrim(regexp_replace(v_data ->> 'title', '[[:cntrl:]]+', ' ', 'g')), ''), 200),
          'at', case when jsonb_typeof(v_data -> 'at') = 'number' and (v_data ->> 'at')::numeric >= 0
                      and (v_data ->> 'at')::numeric < 360000 then to_jsonb(floor((v_data ->> 'at')::numeric)::int) end,
          'updatedAt', v_data -> 'updatedAt', 'deleted', case when v_deleting then true end));
      end if;
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

    -- Participant d'un groupe du staff ou d'équipe (023, 031) ou d'un événement (024) : encadrant désigné par le créateur,
    -- directement (editors) ou comme membre d'un staff choisi (034, hb_participant_of). Il ajoute des joueurs,
    -- retire seulement ceux qu'il a ajoutés et peut se retirer lui-même (de editors) ; le reste du groupe ne bouge pas,
    -- staffs choisis compris.
    v_participant := p_table in ('groups', 'events') and v_role = 'preparateur' and not v_deleting and v_existing is not null
      and not coalesce((v_existing ->> 'private')::boolean, false)
      and coalesce(v_existing ->> 'createdBy', '') not in ('', v_uid::text)
      and public.hb_participant_of(v_existing, v_uid);
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
      -- 032 : suivis : chacun les siens, quel que soit son rôle (administrateur compris : il ne voit pas ceux des autres).
      when p_table = 'follows' then v_data ->> 'kind' in ('player', 'group')
        and coalesce(v_data ->> 'targetId', '') <> ''
        and r ->> 'id' = v_uid::text || ':' || (v_data ->> 'kind') || ':' || (v_data ->> 'targetId')
        and (v_existing is null or v_existing ->> 'createdBy' = v_uid::text)
      -- 034 : staffs : encadrants et administrateurs en créent ; seul son créateur le modifie ou le supprime
      -- (administrateur compris : il ne le voit même pas s'il n'en est pas membre). Un nom est obligatoire.
      when p_table = 'teams' then v_role in ('admin', 'preparateur')
        and (v_existing is null or v_existing ->> 'createdBy' = v_uid::text)
        and (v_deleting or v_data ? 'name')
      -- 036 : liens vidéo. Tout compte avec un rôle en ajoute sur un joueur ou un événement existant (non supprimé,
      -- fiche non fondue) ; seul son auteur le modifie. Supprimer : son auteur, un administrateur, ou un encadrant
      -- (lien sur un joueur : dans son secteur, comme les validations ; sur un événement : tout encadrant).
      when p_table = 'videos' and v_deleting then v_existing is null
        or v_existing ->> 'createdBy' = v_uid::text
        or v_role = 'admin'
        or (v_role = 'preparateur' and (v_kind = 'event'
            or public.hb_can_review(v_uid, (select public.hb_player_dept(data) from public.hb_players where id = v_target))))
      when p_table = 'videos' then (v_existing is null or v_existing ->> 'createdBy' = v_uid::text)
        and v_data ? 'url'
        and (v_existing is not null or case v_kind
          when 'player' then exists (select 1 from public.hb_players where id = v_target and not deleted
                                       and coalesce(data ->> 'mergedInto', '') = '')
          when 'event' then exists (select 1 from public.hb_events where id = v_target and not deleted)
          else false end)
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
      -- 031 : groupe d'équipe : hors participants (traités plus haut), seul son créateur y touche (administrateur compris).
      -- Passer un groupe existant en « Équipe » : son créateur seul aussi.
      when p_table = 'groups' and (coalesce((v_existing ->> 'team')::boolean, false)
          or (v_existing is not null and coalesce((v_data ->> 'team')::boolean, false)))
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
      -- 034 : staffs choisis : seulement des staffs existants, non supprimés ; un staff ajouté doit être visible par
      -- celui qui écrit (il l'a créé ou en est membre) ; ceux déjà là restent. Jamais sur un groupe privé.
      if p_table = 'groups' and coalesce((v_data ->> 'private')::boolean, false) then
        v_teams := '[]'::jsonb;
      else
        select coalesce(jsonb_agg(distinct t.id), '[]'::jsonb) into v_teams
          from jsonb_array_elements_text(public.hb_arr(v_data -> 'teams')) x(id)
          join public.hb_teams t on t.id = x.id and not t.deleted
         where public.hb_arr(v_existing -> 'teams') ? x.id
            or t.data ->> 'createdBy' = v_uid::text
            or public.hb_arr(t.data -> 'members') ? v_uid::text;
      end if;
      v_data := (v_data - 'teams') || case when v_teams = '[]'::jsonb then '{}'::jsonb else jsonb_build_object('teams', v_teams) end;
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

-- ---------- Liens d'une fiche fondue ou effacée ----------

-- Fiche fondue : ses liens passent sur la fiche gardée. Joueur ou événement effacé (purge des suppressions,
-- expiration RGPD) : ses liens sont effacés aussi, et le journal n'en garde plus rien.
create or replace function public.hb_videos_follow_target() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_kind text := case tg_table_name when 'hb_players' then 'player' else 'event' end;
  v_now bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
  v_ids text[];
begin
  if v_kind = 'player' and coalesce(new.data ->> 'mergedInto', '') <> ''
     and new.data ->> 'mergedInto' is distinct from old.data ->> 'mergedInto' then
    update public.hb_videos
       set data = data || jsonb_build_object('targetId', new.data ->> 'mergedInto', 'updatedAt', v_now),
           updated_at_client = v_now
     where data ->> 'targetKind' = 'player' and data ->> 'targetId' = new.id
       and not coalesce((data ->> 'purged')::boolean, false);
  end if;

  if coalesce((new.data ->> 'purged')::boolean, false) and not coalesce((old.data ->> 'purged')::boolean, false) then
    select coalesce(array_agg(id), '{}') into v_ids from public.hb_videos
     where data ->> 'targetKind' = v_kind and data ->> 'targetId' = new.id
       and not coalesce((data ->> 'purged')::boolean, false);
    if cardinality(v_ids) > 0 then
      update public.hb_videos
         set data = jsonb_build_object('id', id, 'targetKind', v_kind, 'targetId', new.id,
                                       'deleted', true, 'purged', true, 'updatedAt', v_now),
             deleted = true, updated_at_client = v_now
       where id = any (v_ids);
      update public.hb_audit set summary = '(données effacées)', changes = null
       where table_name = 'videos' and row_id = any (v_ids);
    end if;
  end if;
  return null;
end $$;

drop trigger if exists hb_videos_follow_target on public.hb_players;
create trigger hb_videos_follow_target after update on public.hb_players
  for each row
  when (new.data ->> 'mergedInto' is distinct from old.data ->> 'mergedInto'
        or new.data ->> 'purged' is distinct from old.data ->> 'purged')
  execute function public.hb_videos_follow_target();
drop trigger if exists hb_videos_follow_target on public.hb_events;
create trigger hb_videos_follow_target after update on public.hb_events
  for each row
  when (new.data ->> 'purged' is distinct from old.data ->> 'purged')
  execute function public.hb_videos_follow_target();

-- ---------- Effacement définitif des suppressions (reprise de 029, liens vidéo compris) ----------

create or replace function public.hb_purge_deleted(p_days int default 30, p_tables text[] default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_limit timestamptz := now() - make_interval(days => p_days);
  v_now bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
  v_all text[] := array['players', 'measurements', 'evaluations', 'events', 'groups', 'referents', 'alerts', 'videos'];
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
                     when 'referents' then 'référent(s)' when 'videos' then 'vidéo(s)' else 'alerte(s)' end, ', ') from jsonb_each_text(v_total)));
  end if;
  return v_total;
end $$;


-- ---------- Droits des fonctions (comme 029, 032, 033, 034) ----------
-- Appelées par l'appli (supabase.rpc) ou par les règles de lecture : comptes connectés seulement.
-- Toutes les autres fonctions hb_* (déclencheurs, outils internes) : personne, sauf le serveur.
-- (hb_log_view_as, de 035, est dans la liste : sinon ce passage la retirerait aux administrateurs.)
do $$
declare
  f record;
  v_app text[] := array['hb_upsert', 'hb_merge_players', 'hb_create_member', 'hb_update_member', 'hb_delete_member',
                        'hb_members', 'hb_set_role', 'hb_set_departments', 'hb_purge_expired', 'hb_purge_deleted',
                        'hb_push_subscribe', 'hb_push_unsubscribe', 'hb_set_notif_prefs', 'hb_notif_test', 'hb_has_role',
                        'hb_ping', 'hb_last_seen', 'hb_is_participant', 'hb_log_view_as'];
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

-- Vérification : la table existe (nombre de liens) et les déclencheurs sont en place.
select count(*) as videos from public.hb_videos;
select tgrelid::regclass as table_, tgname as declencheur from pg_trigger
 where tgname like 'hb_videos%' or (tgrelid = 'public.hb_videos'::regclass and not tgisinternal) order by 1, 2;
