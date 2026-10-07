-- HandBase : staffs (équipes d'encadrants enregistrées et réutilisables : « ETD Var », « Staff Pôle Sud »…).
-- À exécuter une fois dans Supabase > SQL Editor, APRÈS 033_notifications_suivis.sql.
-- Peut être relancé sans risque.
--
-- Un staff : un nom, une description facultative et des membres (encadrants, comme les participants d'un groupe
-- ou d'un événement). Table hb_teams, synchronisée comme les autres (id, data, updated_at_client, deleted).
--   - Qui le voit : son créateur et ses membres, personne d'autre (administrateurs compris, comme un groupe d'équipe).
--   - Qui le crée : encadrants et administrateurs (pas les observateurs).
--   - Qui le modifie (nom, membres) ou le supprime : son créateur seul.
--   - Membres : seulement des comptes encadrants ; leurs noms sont repris des profils par le serveur.
-- Utilisation : un groupe (du staff ou d'équipe) ou un événement peut citer des staffs (champ « teams », en plus
-- de « editors »). Ses participants sont alors editors + membres actuels de ces staffs, calculés à chaque fois :
-- entrer dans un staff donne accès à tous ses groupes et événements, en sortir le retire.
--   - lecture des groupes d'équipe (031), droits de participant (groupes et événements, 023/024), organisateur
--     d'un événement pour les avis hors liste (hb_event_manager), destinataires des avis à valider et des rappels
--     (hb_event_people), « Suivi par l'équipe » (teamFollow, 033) : tous passent par hb_participant_of / hb_participants ;
--   - un staff ajouté doit être visible par celui qui l'ajoute ; un staff supprimé ou inconnu est retiré à
--     l'écriture suivante et ignoré d'ici là ;
--   - un participant (direct ou par un staff) ne change pas les staffs choisis.
-- Notifications (préférence « participant ») : ajouté à un staff (« … t'a ajouté au staff X ») ; staff ajouté à un
-- groupe ou un événement (ses membres sont prévenus comme des participants ajoutés un par un).
-- Journal : seulement l'action, rien du contenu d'un staff (comme un groupe d'équipe).
-- Performance : les règles de lecture qui consultent les staffs ne portent que sur les groupes d'équipe qui en citent
-- (quelques-uns), jamais sur les joueurs ; index sur les membres et sur les staffs cités.

-- ---------- Table ----------

create table if not exists public.hb_teams (
  id text primary key,
  data jsonb not null,
  updated_at_client bigint not null default 0,
  deleted boolean not null default false,
  server_updated_at timestamptz not null default clock_timestamp()
);
create index if not exists hb_teams_sua on public.hb_teams (server_updated_at);
create index if not exists hb_teams_members on public.hb_teams using gin ((data -> 'members'));
-- Groupes et événements qui citent un staff (notification « ajouté au staff », recherche par staff).
create index if not exists hb_groups_teams on public.hb_groups using gin ((data -> 'teams'));
create index if not exists hb_events_teams on public.hb_events using gin ((data -> 'teams'));
alter table public.hb_teams enable row level security;

-- Lecture : son créateur et ses membres (avec un rôle). Écriture : uniquement via hb_upsert.
drop policy if exists "own_read" on public.hb_teams;
create policy "own_read" on public.hb_teams for select to authenticated using (
  (select public.hb_has_role())
  and (data ->> 'createdBy' = (select auth.uid())::text
       or coalesce(data -> 'members', '[]'::jsonb) ? (select auth.uid())::text)
);
revoke all on public.hb_teams from public, anon, authenticated;
grant select on public.hb_teams to authenticated;

drop trigger if exists hb_touch on public.hb_teams;
create trigger hb_touch before insert or update on public.hb_teams
  for each row execute function public.hb_touch();
drop trigger if exists hb_stamp on public.hb_teams;
create trigger hb_stamp before insert or update on public.hb_teams
  for each row execute function public.hb_stamp();
drop trigger if exists hb_log on public.hb_teams;
create trigger hb_log after insert or update or delete on public.hb_teams
  for each row execute function public.hb_log();

-- Synchronisation en direct (les règles de lecture s'appliquent : seuls créateur et membres sont prévenus).
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables
                      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'hb_teams') then
    alter publication supabase_realtime add table public.hb_teams;
  end if;
end $$;

-- ---------- Participants effectifs ----------

-- Tableau JSON ou, à défaut, tableau vide (donnée mal formée : ignorée plutôt qu'une erreur).
create or replace function public.hb_arr(p jsonb) returns jsonb
language sql immutable set search_path = public as $$
  select case when jsonb_typeof(p) = 'array' then p else '[]'::jsonb end
$$;

-- Membres actuels des staffs cités par un groupe ou un événement (staffs supprimés ou inconnus : ignorés).
create or replace function public.hb_team_members(p_data jsonb) returns setof text
language sql stable security definer set search_path = public as $$
  select distinct m.uid
    from public.hb_teams t
   cross join lateral jsonb_array_elements_text(public.hb_arr(t.data -> 'members')) m(uid)
   where t.id in (select jsonb_array_elements_text(public.hb_arr(p_data -> 'teams'))) and not t.deleted
$$;

-- Participants d'un groupe ou d'un événement : choisis un par un (editors) et membres des staffs choisis (teams).
create or replace function public.hb_participants(p_data jsonb) returns setof text
language sql stable security definer set search_path = public as $$
  select jsonb_array_elements_text(public.hb_arr(p_data -> 'editors'))
  union
  select public.hb_team_members(p_data)
$$;

-- Ce compte est-il participant (directement ou par un staff) ?
create or replace function public.hb_participant_of(p_data jsonb, p_uid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select p_uid is not null and (
    public.hb_arr(p_data -> 'editors') ? p_uid::text
    or (p_data ? 'teams' and exists (
      select 1 from public.hb_teams t
       where t.id in (select jsonb_array_elements_text(public.hb_arr(p_data -> 'teams')))
         and not t.deleted and public.hb_arr(t.data -> 'members') ? p_uid::text)))
$$;

-- Pour les règles de lecture : le compte connecté (rien d'autre à interroger depuis l'appli).
create or replace function public.hb_is_participant(p_data jsonb) returns boolean
language sql stable security definer set search_path = public as $$
  select public.hb_participant_of(p_data, auth.uid())
$$;

-- ---------- Lecture des groupes d'équipe (reprise de 031) ----------

drop policy if exists "staff_read" on public.hb_groups;
create policy "staff_read" on public.hb_groups for select to authenticated using (
  (select public.hb_has_role())
  and (data ->> 'createdBy' = (select auth.uid())::text
       or (not coalesce((data ->> 'private')::boolean, false)
           and (not coalesce((data ->> 'team')::boolean, false)
                or coalesce(data -> 'editors', '[]'::jsonb) ? (select auth.uid())::text
                -- 034 : membre d'un staff choisi (seulement les groupes d'équipe qui citent un staff).
                or (data ? 'teams' and public.hb_is_participant(data))))));

-- ---------- Organisateur d'un événement (reprise de 024) ----------

-- Administrateur, encadrant qui l'a créé, ou encadrant participant (directement ou par un staff, 034).
create or replace function public.hb_event_manager(p_uid uuid, p_event_id text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(p_event_id, '') <> '' and exists (
    select 1 from public.hb_profiles pr, public.hb_events e
     where pr.user_id = p_uid and e.id = p_event_id and not e.deleted
       and (pr.role = 'admin'
            or (pr.role = 'preparateur' and (coalesce(e.data ->> 'createdBy', '') in ('', p_uid::text)
                                             or public.hb_participant_of(e.data, p_uid)))))
$$;

-- Organisateur et participants d'un événement (reprise de 026 ; membres des staffs choisis compris).
create or replace function public.hb_event_people(p_event jsonb) returns setof uuid
language sql stable security definer set search_path = public as $$
  select pr.user_id from public.hb_profiles pr
   where pr.role in ('preparateur', 'admin')
     and (pr.user_id::text = p_event ->> 'createdBy'
          or pr.user_id::text in (select public.hb_participants(p_event)))
$$;

-- ---------- Écritures (reprise de 032) ----------

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
begin
  if v_uid is null then raise exception 'Connexion requise'; end if;
  if p_table not in ('players','criteria','measurements','events','evaluations','referents','groups','lists','alerts','follows','teams') then
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

-- ---------- Journal : staffs sans contenu (reprise de 032) ----------

create or replace function public.hb_log() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  a record;
  v_table text := substr(tg_table_name, 4); -- hb_players -> players
  v_action text;
  v_changes jsonb;
  v_meta text[] := array['updatedAt', 'updatedBy', 'updatedByName', 'updatedAtServer', 'createdBy', 'createdByName', 'createdAtServer'];
  -- Groupe ou alerte privé, ou groupe d'équipe (031), avant ou après : seule l'action est notée, rien de son contenu.
  -- Suivis (032) : toujours, et sans même l'identifiant de la ligne (il contient le joueur ou le groupe suivi).
  -- Staffs (034) : toujours (leur nom, leurs membres ne regardent qu'eux).
  v_follow boolean := tg_table_name = 'hb_follows';
  v_private boolean := v_follow or tg_table_name = 'hb_teams' or tg_table_name in ('hb_groups', 'hb_alerts')
    and (coalesce((new.data ->> 'private')::boolean, false) or coalesce((old.data ->> 'private')::boolean, false)
         or coalesce((new.data ->> 'team')::boolean, false) or coalesce((old.data ->> 'team')::boolean, false));
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
  values (a.uid, a.name, a.role, v_table, case when v_follow then '-' else coalesce(new.id, old.id) end, v_action,
          case when v_private then '(privé)' else public.hb_summary(v_table, coalesce(new.data, old.data)) end,
          case when v_private then null else v_changes end);
  return null;
end $$;

-- ---------- Notifications « participant » (reprise de 026) ----------

-- Nouveau participant d'un événement ou d'un groupe : choisi directement, ou membre d'un staff qui vient d'être ajouté.
create or replace function public.hb_notify_participant() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_u text;
  v_team text;
  v_what text := case tg_table_name when 'hb_events' then 'à l’événement' else 'au groupe' end;
  v_url text := case tg_table_name when 'hb_events' then '/evenements/' else '/groupes/' end || new.id;
  v_who text := coalesce(new.data ->> 'createdByName', 'Un encadrant');
  v_date text := case when tg_table_name = 'hb_events' and new.data ->> 'date' ~ '^\d{4}-\d{2}-\d{2}$' then ' (' || to_char((new.data ->> 'date')::date, 'DD/MM') || ')' else '' end;
begin
  if new.deleted then return null; end if;
  for v_u in
    select p from public.hb_participants(new.data) p
     where p is distinct from new.data ->> 'createdBy'
       and (tg_op = 'INSERT' or p not in (select public.hb_participants(old.data)))
  loop
    if public.hb_arr(new.data -> 'editors') ? v_u then
      perform public.hb_notify(v_u::uuid, 'participant', 'participant:' || new.id, 'Tu es participant',
        v_who || ' t’a ajouté ' || v_what || ' « ' || coalesce(new.data ->> 'name', '?') || ' »' || v_date, null, v_url);
    else
      -- Par un staff (034) : on cite le premier staff choisi dont il est membre.
      select t.data ->> 'name' into v_team from public.hb_teams t
       where t.id in (select jsonb_array_elements_text(public.hb_arr(new.data -> 'teams')))
         and not t.deleted and public.hb_arr(t.data -> 'members') ? v_u
       order by t.data ->> 'name' limit 1;
      perform public.hb_notify(v_u::uuid, 'participant', 'participant:' || new.id, 'Tu es participant',
        v_who || ' a ajouté le staff « ' || coalesce(v_team, '?') || ' » ' || v_what || ' « ' || coalesce(new.data ->> 'name', '?') || ' »' || v_date,
        null, v_url);
    end if;
  end loop;
  return null;
end $$;

-- Ajouté à un staff (034) : « … t'a ajouté au staff X », avec le nombre de groupes et d'événements ouverts.
create or replace function public.hb_notify_team() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_u text;
  v_groups int;
  v_events int;
  v_more text := '';
begin
  if new.deleted then return null; end if;
  if not exists (select 1 from jsonb_array_elements_text(public.hb_arr(new.data -> 'members')) m
                  where tg_op = 'INSERT' or old.deleted or not (public.hb_arr(old.data -> 'members') ? m)) then
    return null;
  end if;
  select count(*) into v_groups from public.hb_groups
   where not deleted and not coalesce((data ->> 'archived')::boolean, false) and data -> 'teams' ? new.id;
  select count(*) into v_events from public.hb_events
   where not deleted and not coalesce((data ->> 'archived')::boolean, false) and data -> 'teams' ? new.id;
  if v_groups + v_events > 0 then
    v_more := ' : ' || concat_ws(' et ',
      case when v_groups > 0 then v_groups || ' groupe' || case when v_groups > 1 then 's' else '' end end,
      case when v_events > 0 then v_events || ' événement' || case when v_events > 1 then 's' else '' end end);
  end if;
  for v_u in
    select m from jsonb_array_elements_text(public.hb_arr(new.data -> 'members')) m
     where m is distinct from new.data ->> 'createdBy'
       and (tg_op = 'INSERT' or old.deleted or not (public.hb_arr(old.data -> 'members') ? m))
  loop
    perform public.hb_notify(v_u::uuid, 'participant', 'staff:' || new.id, 'Nouveau staff',
      coalesce(new.data ->> 'createdByName', 'Un encadrant') || ' t’a ajouté au staff « ' || coalesce(new.data ->> 'name', '?') || ' »' || v_more,
      null, '/staffs');
  end loop;
  return null;
end $$;
drop trigger if exists hb_notify_team on public.hb_teams;
create trigger hb_notify_team after insert or update on public.hb_teams
  for each row execute function public.hb_notify_team();

-- ---------- Notifications « suivi » (reprise de 033) ----------

create or replace function public.hb_notify_suivi() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_rows jsonb;
  r record;
  v_name text;
  v_body text;
begin
  -- Cas le plus courant : personne ne suit rien.
  if not exists (select 1 from public.hb_follows where not deleted)
     and not exists (select 1 from public.hb_groups where not deleted and data -> 'teamFollow' = 'true'::jsonb) then
    return null;
  end if;

  -- Lignes à annoncer, et à qui : all (tout rôle), staff (encadrants et administrateurs), obs (observateurs).
  if tg_table_name = 'hb_measurements' and tg_op = 'INSERT' then
    select jsonb_agg(jsonb_build_object('id', n.id, 'pid', n.data ->> 'playerId', 'author', n.data ->> 'createdBy',
             'audience', 'all', 'data', n.data))
      into v_rows from new_rows n
     where not n.deleted and coalesce(n.data ->> 'playerId', '') <> '';
  elsif tg_table_name = 'hb_evaluations' and tg_op = 'INSERT' then
    select jsonb_agg(jsonb_build_object('id', n.id, 'pid', n.data ->> 'playerId', 'author', n.data ->> 'createdBy',
             'observer', n.data ->> 'observerId',
             'audience', case when n.data ->> 'review' = 'pending' then 'staff' else 'all' end, 'data', n.data))
      into v_rows from new_rows n
     where not n.deleted and coalesce(n.data ->> 'playerId', '') <> ''
       and n.data ->> 'review' is distinct from 'refused';
  elsif tg_table_name = 'hb_evaluations' and tg_op = 'UPDATE' then
    -- Avis en attente qui vient d'être validé : les observateurs le voient compter maintenant.
    select jsonb_agg(jsonb_build_object('id', n.id, 'pid', n.data ->> 'playerId', 'author', n.data ->> 'createdBy',
             'observer', n.data ->> 'observerId', 'audience', 'obs', 'data', n.data))
      into v_rows
      from new_rows n join old_rows o on o.id = n.id
     where not n.deleted and not o.deleted and o.data ->> 'review' = 'pending'
       and n.data ->> 'review' is distinct from 'pending' and n.data ->> 'review' is distinct from 'refused'
       and coalesce(n.data ->> 'playerId', '') <> '';
  end if;
  if v_rows is null then return null; end if;

  for r in
    with c as (
      select x.id, x.pid, x.author, x.observer, x.audience, x.data
        from jsonb_to_recordset(v_rows) as x(id text, pid text, author text, observer text, audience text, data jsonb)
    ),
    p as (select distinct c.pid from c),
    fol as (
      -- Suivi direct.
      select p.pid, f.data ->> 'createdBy' as uid
        from p join public.hb_follows f on f.data ->> 'targetId' = p.pid and not f.deleted
       where f.data ->> 'kind' = 'player'
      union
      -- Groupe suivi personnellement, encore visible par ce compte (participant direct ou par un staff, 034).
      select p.pid, f.data ->> 'createdBy'
        from public.hb_follows f
        join public.hb_groups g on g.id = f.data ->> 'targetId' and not g.deleted
        join p on g.data -> 'playerIds' ? p.pid
       where not f.deleted and f.data ->> 'kind' = 'group'
         and (g.data ->> 'createdBy' = f.data ->> 'createdBy'
              or (not coalesce((g.data ->> 'private')::boolean, false)
                  and (not coalesce((g.data ->> 'team')::boolean, false)
                       or public.hb_participant_of(g.data, (f.data ->> 'createdBy')::uuid))))
      union
      -- Groupe suivi par le staff : son créateur et ses participants du moment (membres des staffs choisis compris, 034).
      select p.pid, u.uid
        from public.hb_groups g
        cross join lateral (select g.data ->> 'createdBy'
                            union select public.hb_participants(g.data)) u(uid)
        join p on g.data -> 'playerIds' ? p.pid
       where not g.deleted and g.data -> 'teamFollow' = 'true'::jsonb
         and not coalesce((g.data ->> 'private')::boolean, false)
    )
    -- Un seul envoi par compte et par ligne.
    select distinct c.id, c.pid, c.data, pr.user_id
      from c
      join fol on fol.pid = c.pid
      join public.hb_profiles pr on pr.user_id::text = fol.uid and pr.role in ('admin', 'preparateur', 'observateur')
      join public.hb_players pl on pl.id = c.pid and not pl.deleted and coalesce(pl.data ->> 'mergedInto', '') = ''
     where fol.uid is distinct from c.author and fol.uid is distinct from c.observer
       and (c.audience = 'all'
            or (c.audience = 'staff' and pr.role in ('admin', 'preparateur'))
            or (c.audience = 'obs' and pr.role = 'observateur'))
     order by c.id, pr.user_id
  loop
    v_name := coalesce(nullif(public.hb_player_name(r.pid), ''), 'Joueur suivi');
    if tg_table_name = 'hb_measurements' then
      -- « Nouvelle mesure » : début du texte lu par la fonction d'envoi (résumé « n nouvelles mesures »).
      select 'Nouvelle mesure : ' || coalesce(c.data ->> 'label', r.data ->> 'criterionId', 'test')
             || coalesce(' ' || (r.data ->> 'value') || coalesce(' ' || nullif(c.data ->> 'unit', ''), ''), '')
        into v_body
        from (select 1) one left join public.hb_criteria c on c.id = r.data ->> 'criterionId';
      v_body := v_body || coalesce(' (par ' || coalesce(r.data ->> 'createdByName', r.data ->> 'author') || ')', '');
    else
      -- « Nouvel avis » : idem.
      v_body := 'Nouvel avis' || coalesce(' de ' || coalesce(r.data ->> 'observer', r.data ->> 'createdByName'), '') || ' : '
        || coalesce((select e.data ->> 'name' from public.hb_events e
                      where e.id = r.data ->> 'eventId' and not e.deleted), 'avis spontané');
    end if;
    perform public.hb_notify(r.user_id, 'suivi', 'suivi', v_name, v_body,
      'nouveautés sur tes joueurs suivis', '/joueurs/' || r.pid);
  end loop;
  return null;
end $$;

-- ---------- Droits des fonctions (comme 029, 032, 033) ----------
-- Appelées par l'appli (supabase.rpc) ou par les règles de lecture : comptes connectés seulement.
-- Toutes les autres fonctions hb_* (déclencheurs, outils internes) : personne, sauf le serveur.
do $$
declare
  f record;
  v_app text[] := array['hb_upsert', 'hb_merge_players', 'hb_create_member', 'hb_update_member', 'hb_delete_member',
                        'hb_members', 'hb_set_role', 'hb_set_departments', 'hb_purge_expired', 'hb_purge_deleted',
                        'hb_push_subscribe', 'hb_push_unsubscribe', 'hb_set_notif_prefs', 'hb_notif_test', 'hb_has_role',
                        'hb_ping', 'hb_last_seen', 'hb_is_participant'];
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

-- Vérification : la table existe (nombre de staffs, tous comptes confondus) et les déclencheurs sont en place.
select count(*) as staffs from public.hb_teams;
select tgname as declencheur from pg_trigger where tgrelid = 'public.hb_teams'::regclass and not tgisinternal order by 1;
