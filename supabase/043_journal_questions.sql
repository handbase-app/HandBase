-- HandBase : journal des questions (« Poser une question » au bilan de détection).
-- À exécuter une fois dans Supabase > SQL Editor, APRÈS 042_quota_transcription.sql (base de test d'abord, puis la réelle).
-- Peut être relancé sans risque (idempotent : create if not exists, create or replace, drop … if exists).
--
-- Principe : CHAQUE question posée au bilan laisse une entrée (phase de développement), pour écrire ensuite de nouvelles
-- recettes : la FORME de la question, ce qu'en a fait la recette (complète, partielle, pas comprise) et, si le mode avancé
-- a été lancé, son résultat. L'appli anonymise tout AVANT l'envoi (src/questionLogCore.ts) : prénoms et noms des fiches
-- deviennent [prénom] / [nom], les numéros de licence [licence]. Aucun résultat, aucune donnée de joueur n'est envoyé.
-- L'écran « Poser une question » le dit (« Phase de développement : vos questions peuvent être enregistrées… ») et la page
-- Confidentialité l'explique (quoi, pourquoi, qui, combien de temps).
--
-- 1) Table hb_question_log, sur le modèle des autres tables hb_* (id, data, updated_at_client, deleted,
--    server_updated_at ; horodatage hb_touch, signature hb_stamp) :
--    { at, authorId, authorName, phrase, recipe (complete | partielle | pas_comprise), recipeMissing?, how? (auto | button),
--      status? (ok | erreur | refus | delai | reseau | annule), modelMissing?, sql?, sqlRetry?, detail?, rows?, display?,
--      recipeDone? }.
-- 2) DROITS
--    - ÉCRITURE : tout compte qui peut poser une question (administrateur, encadrant), via hb_upsert seulement : il CRÉE ses
--      propres lignes ; l'auteur (authorId, authorName) est posé par le serveur, jamais lu de l'appareil. Un encadrant ne
--      modifie ni ne supprime aucune ligne (pas même la sienne) ; le renvoi d'une ligne déjà reçue (réponse perdue) est sans
--      effet. Observateur, compte sans rôle : rien.
--    - LECTURE : administrateurs seulement (règle de lecture, hb_is_admin). Un encadrant ne relit JAMAIS le journal, pas même
--      ses lignes (l'appli ne synchronise d'ailleurs pas cette table vers son appareil : envoi seulement, src/sync.ts).
--    - Case « transformée en recette » (recipeDone) et « Vider le journal » (suppression) : administrateurs seulement ; le
--      contenu d'une entrée ne change plus après sa création.
--    - Aucun droit direct sur la table (ni insert, ni update, ni delete) : tout passe par hb_upsert.
-- 3) CONSERVATION : 12 mois. La tâche de nuit (hb_purge_deleted, 028) efface les entrées de plus de 12 mois (date de
--    création sur le serveur) ; « Vider le journal » (administrateur) les supprime tout de suite, effacées au bout de
--    30 jours comme le reste. Effacer = ne garder que l'identifiant (les appareils des administrateurs l'oublient aussi).
-- 4) Pas de ligne dans l'historique (hb_audit) ni de diffusion en direct pour cette table : le journal est lui-même un
--    relevé (et l'historique garderait les phrases au-delà de 12 mois).
-- 5) hb_upsert et hb_purge_deleted : reprises de 041 avec la nouvelle table ; droits des fonctions : reprise de 041 avec
--    hb_is_admin (appelée par la règle de lecture).
-- Tant que ce script n'est pas passé, l'appli garde les entrées dans sa file d'envoi et les envoie ensuite.

-- ---------- Table ----------

create table if not exists public.hb_question_log (
  id text primary key,
  data jsonb not null,
  updated_at_client bigint not null default 0,
  deleted boolean not null default false,
  server_updated_at timestamptz not null default clock_timestamp()
);
create index if not exists hb_question_log_sua on public.hb_question_log (server_updated_at);
alter table public.hb_question_log enable row level security;

-- ---------- Lecture : administrateurs seulement ----------

-- Le compte connecté est-il administrateur ?
create or replace function public.hb_is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.hb_profiles where user_id = auth.uid() and role = 'admin')
$$;

drop policy if exists "admin_read" on public.hb_question_log;
create policy "admin_read" on public.hb_question_log for select to authenticated using ((select public.hb_is_admin()));
-- Ni insertion, ni modification, ni suppression directes : seulement hb_upsert (security definer).
revoke all on public.hb_question_log from public, anon, authenticated;
grant select on public.hb_question_log to authenticated;

do $$
declare t text := 'question_log';
begin
  execute format('drop trigger if exists hb_touch on public.hb_%1$s;
    create trigger hb_touch before insert or update on public.hb_%1$s for each row execute function public.hb_touch();
    drop trigger if exists hb_stamp on public.hb_%1$s;
    create trigger hb_stamp before insert or update on public.hb_%1$s for each row execute function public.hb_stamp();
    drop trigger if exists hb_log on public.hb_%1$s;', t);
  -- Pas de diffusion en direct (version précédente de ce script) : retirée si elle avait été posée.
  if exists (select 1 from pg_publication_tables
              where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'hb_' || t) then
    execute format('alter publication supabase_realtime drop table public.hb_%1$s', t);
  end if;
end $$;

-- ---------- Écritures (reprise de 041) ----------

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
  v_moments jsonb;
  v_rw_author boolean;
  v_done jsonb;
  v_tournament jsonb;
begin
  if v_uid is null then raise exception 'Connexion requise'; end if;
  if p_table not in ('players','criteria','measurements','events','evaluations','referents','groups','lists','alerts','follows','teams','videos','seen','rewatch','question_log') then
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

    -- 043 : journal des questions : un compte qui n'est pas administrateur ne fait que CRÉER ses lignes. Renvoi d'une de ses
    -- lignes déjà reçue (réponse perdue) : sans effet et pas refusée (il ne pourrait pas relire la version du serveur) ;
    -- modification, suppression, ligne d'un autre : refusées.
    if p_table = 'question_log' and v_role <> 'admin' and v_existing is not null then
      if not v_deleting and v_existing ->> 'authorId' = v_uid::text then
        continue;
      end if;
      v_rejected := v_rejected || to_jsonb(r ->> 'id');
      continue;
    end if;

    -- Ligne supprimée ou effacée sur le serveur.
    if v_existing is not null and (v_existing_deleted or coalesce((v_existing ->> 'purged')::boolean, false)) then
      if v_deleting then
        continue; -- suppression renvoyée : déjà faite, rien à changer
      elsif coalesce((v_existing ->> 'purged')::boolean, false)
        or (v_role <> 'admin' and not (p_table in ('follows', 'seen') and v_existing ->> 'createdBy' = v_uid::text)) then
        -- Effacée : intouchable. Supprimée : seul un administrateur la restaure
        -- (032 : un suivi arrêté, son propriétaire le reprend quand il veut ; 041 : de même pour un « vu » retiré).
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
    -- 037 : liste de moments (moments) : 20 au plus (les premiers dans la vidéo), chacun { at (entier 0..359999),
    -- dur? (entier 1..600 s, sinon retirée), note? (texte nettoyé, 120 caractères) }, triés par at ; un moment sans at
    -- valable est retiré. S'il en reste, at (racine) = début du premier moment (anciennes versions de l'appli).
    -- Suppression : le contenu enregistré reste tel quel (celui qui supprime le lien d'un autre ne le modifie pas).
    if p_table = 'videos' then
      v_kind := coalesce(v_existing ->> 'targetKind', v_data ->> 'targetKind');
      v_target := coalesce(v_existing ->> 'targetId', nullif(btrim(v_data ->> 'targetId'), ''));
      if v_deleting and v_existing is not null then
        v_data := (v_existing - 'deleted') || jsonb_build_object('updatedAt', v_data -> 'updatedAt', 'deleted', true);
      else
        v_url := btrim(v_data ->> 'url');
        select coalesce(jsonb_agg(s.m order by s.t, s.ord), '[]'::jsonb) into v_moments
          from (select floor((e ->> 'at')::numeric)::int as t, x.ord,
                       jsonb_strip_nulls(jsonb_build_object(
                         'at', floor((e ->> 'at')::numeric)::int,
                         'dur', case when jsonb_typeof(e -> 'dur') = 'number' and (e ->> 'dur')::numeric >= 1
                                      and (e ->> 'dur')::numeric < 601 then floor((e ->> 'dur')::numeric)::int end,
                         'note', case when jsonb_typeof(e -> 'note') = 'string' then
                                   left(nullif(btrim(regexp_replace(e ->> 'note', '[[:cntrl:]]+', ' ', 'g')), ''), 120) end)) as m
                  from jsonb_array_elements(case when jsonb_typeof(v_data -> 'moments') = 'array'
                                                 then v_data -> 'moments' else '[]'::jsonb end) with ordinality x(e, ord)
                 where jsonb_typeof(e) = 'object' and jsonb_typeof(e -> 'at') = 'number'
                   and (e ->> 'at')::numeric >= 0 and (e ->> 'at')::numeric < 360000
                 order by 1, 2
                 limit 20) s;
        v_data := jsonb_strip_nulls(jsonb_build_object(
          'id', r ->> 'id', 'targetKind', v_kind, 'targetId', v_target,
          'url', case when public.hb_video_url_ok(v_url) then v_url end,
          'title', left(nullif(btrim(regexp_replace(v_data ->> 'title', '[[:cntrl:]]+', ' ', 'g')), ''), 200),
          'at', case when jsonb_array_length(v_moments) > 0 then v_moments -> 0 -> 'at'
                     when jsonb_typeof(v_data -> 'at') = 'number' and (v_data ->> 'at')::numeric >= 0
                      and (v_data ->> 'at')::numeric < 360000 then to_jsonb(floor((v_data ->> 'at')::numeric)::int) end,
          'moments', case when jsonb_array_length(v_moments) > 0 then v_moments end,
          'updatedAt', v_data -> 'updatedAt', 'deleted', case when v_deleting then true end));
      end if;
    end if;

    -- 041 : « vu ». Événement et joueur fixés à la création (ils ne suivent ensuite que les fusions de fiches, faites
    -- par le serveur). at : moment où il a été marqué vu (posé par le serveur à la création et quand on le remet).
    if p_table = 'seen' then
      v_data := jsonb_strip_nulls(jsonb_build_object(
        'id', r ->> 'id',
        'eventId', coalesce(v_existing ->> 'eventId', nullif(btrim(v_data ->> 'eventId'), '')),
        'playerId', coalesce(v_existing ->> 'playerId', nullif(btrim(v_data ->> 'playerId'), '')),
        'at', case when v_existing is null or (v_existing_deleted and not v_deleting) then to_jsonb(now()) else v_existing -> 'at' end,
        'updatedAt', v_data -> 'updatedAt', 'deleted', case when v_deleting then true end));
    end if;

    -- 041 : « à revoir ». Son auteur (ou le créateur d'une nouvelle ligne) écrit tout : joueur (fixé à la création),
    -- origine (fixée à la création), événements et groupes visés (existants, non supprimés ; groupes visibles par lui ;
    -- 20 au plus chacun), commentaire (500 caractères). Un autre compte qui le voit ne change que « revu » (done).
    -- done : { at, by, byName } posé par le serveur (gardé tel quel s'il l'était déjà) ; absent = pas encore revu.
    -- Suppression : le contenu enregistré reste tel quel.
    if p_table = 'rewatch' then
      v_rw_author := v_existing is null or v_existing ->> 'createdBy' = v_uid::text;
      if v_deleting and v_existing is not null then
        v_data := (v_existing - 'deleted') || jsonb_build_object('updatedAt', v_data -> 'updatedAt', 'deleted', true);
      elsif not v_deleting then
        v_done := case when jsonb_typeof(v_data -> 'done') = 'object' then
          case when jsonb_typeof(v_existing -> 'done') = 'object' then v_existing -> 'done'
               else jsonb_build_object('at', now(), 'by', v_uid, 'byName', v_name) end end;
        if v_rw_author then
          v_data := jsonb_strip_nulls(jsonb_build_object(
            'id', r ->> 'id',
            'playerId', coalesce(v_existing ->> 'playerId', nullif(btrim(v_data ->> 'playerId'), '')),
            'originEventId', case when v_existing is not null then v_existing ->> 'originEventId'
                                  else (select e.id from public.hb_events e where e.id = v_data ->> 'originEventId' and not e.deleted) end,
            'events', (select jsonb_agg(s.id order by s.o) from (
                         select distinct on (x.id) x.id, x.o from jsonb_array_elements_text(public.hb_arr(v_data -> 'events')) with ordinality x(id, o)
                           join public.hb_events e on e.id = x.id and not e.deleted
                          order by x.id, x.o limit 20) s),
            'groups', (select jsonb_agg(s.id order by s.o) from (
                         select distinct on (x.id) x.id, x.o from jsonb_array_elements_text(public.hb_arr(v_data -> 'groups')) with ordinality x(id, o)
                           join public.hb_groups g on g.id = x.id and not g.deleted and public.hb_group_visible(g.data, v_uid)
                          order by x.id, x.o limit 20) s),
            'note', left(nullif(btrim(regexp_replace(v_data ->> 'note', '[[:cntrl:]]+', ' ', 'g')), ''), 500),
            'done', v_done,
            'updatedAt', v_data -> 'updatedAt'));
        else
          v_data := (v_existing - 'done' - 'updatedAt' - 'deleted')
            || jsonb_strip_nulls(jsonb_build_object('done', v_done, 'updatedAt', v_data -> 'updatedAt'));
        end if;
      end if;
    end if;

    -- 043 : journal des questions. Une NOUVELLE entrée ne garde que : moment (at, envoyé par l'appareil s'il est valable,
    -- sinon l'heure du serveur), auteur (compte et nom du profil, posés par le serveur), phrase (300 caractères), recipe
    -- (complete | partielle | pas_comprise), recipeMissing et modelMissing (10 textes de 200 caractères au plus), how
    -- (auto | button) et status (ok | erreur | refus | delai | reseau | annule) du mode avancé, sql et sqlRetry (4 200
    -- caractères, sans caractère de contrôle hors retours à la ligne et tabulations), detail (300), rows (entier 0 à
    -- 100 000), display (20), recipeDone (true ou absent ; administrateur seulement). L'appli anonymise phrase, textes et
    -- requêtes avant l'envoi ; aucun résultat n'est jamais envoyé.
    -- Entrée EXISTANTE (administrateur) : seule la case « transformée en recette » change, le reste est celui enregistré.
    -- Suppression (« Vider le journal ») : le contenu enregistré reste tel quel jusqu'à l'effacement (hb_purge_deleted).
    if p_table = 'question_log' then
      if v_deleting and v_existing is not null then
        v_data := (v_existing - 'deleted') || jsonb_build_object('updatedAt', v_data -> 'updatedAt', 'deleted', true);
      elsif v_existing is not null then
        v_data := (v_existing - 'recipeDone' - 'updatedAt' - 'deleted')
          || jsonb_strip_nulls(jsonb_build_object(
               'recipeDone', case when v_data -> 'recipeDone' = 'true'::jsonb then true end,
               'updatedAt', v_data -> 'updatedAt'));
      else
        v_data := jsonb_strip_nulls(jsonb_build_object(
          'id', r ->> 'id',
          'at', coalesce(case when v_data ->> 'at' ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})$'
                              then v_data -> 'at' end,
                         to_jsonb(now())),
          'authorId', to_jsonb(v_uid),
          'authorName', to_jsonb(v_name),
          'phrase', left(nullif(btrim(regexp_replace(v_data ->> 'phrase', '[[:cntrl:]]+', ' ', 'g')), ''), 300),
          'recipe', case when v_data ->> 'recipe' in ('complete', 'partielle', 'pas_comprise') then v_data ->> 'recipe' end,
          'recipeMissing', (select jsonb_agg(s.t order by s.o) from (
                              select left(nullif(btrim(regexp_replace(x.v, '[[:cntrl:]]+', ' ', 'g')), ''), 200) as t, x.o
                                from jsonb_array_elements_text(public.hb_arr(v_data -> 'recipeMissing')) with ordinality x(v, o)
                               order by x.o limit 10) s where s.t is not null),
          'how', case when v_data ->> 'how' in ('auto', 'button')
                       and v_data ->> 'status' in ('ok', 'erreur', 'refus', 'delai', 'reseau', 'annule') then v_data ->> 'how' end,
          'status', case when v_data ->> 'status' in ('ok', 'erreur', 'refus', 'delai', 'reseau', 'annule')
                         then v_data ->> 'status' end,
          'modelMissing', (select jsonb_agg(s.t order by s.o) from (
                              select left(nullif(btrim(regexp_replace(x.v, '[[:cntrl:]]+', ' ', 'g')), ''), 200) as t, x.o
                                from jsonb_array_elements_text(public.hb_arr(v_data -> 'modelMissing')) with ordinality x(v, o)
                               order by x.o limit 10) s where s.t is not null),
          'sql', left(nullif(btrim(regexp_replace(v_data ->> 'sql', '[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]+', '', 'g')), ''), 4200),
          'sqlRetry', left(nullif(btrim(regexp_replace(v_data ->> 'sqlRetry', '[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]+', '', 'g')), ''), 4200),
          'detail', left(nullif(btrim(regexp_replace(v_data ->> 'detail', '[[:cntrl:]]+', ' ', 'g')), ''), 300),
          'rows', case when jsonb_typeof(v_data -> 'rows') = 'number' and (v_data ->> 'rows')::numeric between 0 and 100000
                       then to_jsonb(floor((v_data ->> 'rows')::numeric)::int) end,
          'display', left(nullif(btrim(regexp_replace(v_data ->> 'display', '[[:cntrl:]]+', ' ', 'g')), ''), 20),
          'recipeDone', case when v_role = 'admin' and v_data -> 'recipeDone' = 'true'::jsonb then true end,
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
      -- 041 : sur un événement, il déclare aussi les équipes d'un tournoi, y rattache les joueurs et répartit les
      -- observateurs (champ tournament, nettoyé plus bas).
      v_tournament := case when p_table = 'events' then v_data -> 'tournament' end;
      v_data := (v_existing - case when p_table = 'events' then 'tournament' else '' end)
        || jsonb_build_object('playerIds', v_new_ids, 'editors', v_editors, 'updatedAt', v_data -> 'updatedAt')
        || case when jsonb_typeof(v_tournament) = 'object' then jsonb_build_object('tournament', v_tournament) else '{}'::jsonb end;
    end if;

    v_ok := case
      when v_participant then true
      -- 043 : journal des questions : un administrateur crée, coche « transformée en recette » et supprime ; un encadrant
      -- crée seulement (ses lignes existantes : traitées plus haut). Une entrée a toujours une phrase et un statut de
      -- recette connu (sauf pour la supprimer). Observateur : rien (il ne pose pas de question).
      when p_table = 'question_log' then case
        when v_role = 'admin' then v_deleting or (v_data ? 'phrase' and v_data ? 'recipe')
        when v_role = 'preparateur' then v_existing is null and not v_deleting and v_data ? 'phrase' and v_data ? 'recipe'
        else false end
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
      -- 041 : « vu » : chacun les siens, tout compte avec un rôle ; à la création, identifiant « <compte>:<événement>:<joueur> »
      -- sur un événement et un joueur existants (non supprimés, fiche non fondue).
      when p_table = 'seen' and v_existing is not null then v_existing ->> 'createdBy' = v_uid::text
      when p_table = 'seen' then not v_deleting
        and r ->> 'id' = v_uid::text || ':' || coalesce(v_data ->> 'eventId', '') || ':' || coalesce(v_data ->> 'playerId', '')
        and exists (select 1 from public.hb_events where id = v_data ->> 'eventId' and not deleted)
        and exists (select 1 from public.hb_players where id = v_data ->> 'playerId' and not deleted
                                                     and coalesce(data ->> 'mergedInto', '') = '')
      -- 041 : « à revoir » : supprimer, son auteur ou un administrateur ; créer, tout compte avec un rôle sur un joueur
      -- existant ; modifier, son auteur (tout) ou un compte qui le voit (« revu » seulement, voir plus haut).
      when p_table = 'rewatch' and v_deleting then v_existing is null
        or v_existing ->> 'createdBy' = v_uid::text or v_role = 'admin'
      when p_table = 'rewatch' then case when v_existing is null then
          exists (select 1 from public.hb_players where id = v_data ->> 'playerId' and not deleted
                                                     and coalesce(data ->> 'mergedInto', '') = '')
        else v_existing ->> 'createdBy' = v_uid::text or public.hb_rewatch_visible(v_existing, v_uid) end
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

    -- 041 : répartition d'un tournoi (équipes, joueurs, observateurs) : nettoyée, retirée s'il ne reste aucune équipe.
    if p_table = 'events' and not v_deleting then
      v_tournament := public.hb_clean_tournament(v_data -> 'tournament', v_data -> 'playerIds');
      v_data := (v_data - 'tournament')
        || case when v_tournament is null then '{}'::jsonb else jsonb_build_object('tournament', v_tournament) end;
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

-- ---------- Effacement définitif des suppressions (reprise de 041, journal des questions compris : 12 mois) ----------

create or replace function public.hb_purge_deleted(p_days int default 30, p_tables text[] default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_limit timestamptz := now() - make_interval(days => p_days);
  v_now bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
  v_all text[] := array['players', 'measurements', 'evaluations', 'events', 'groups', 'referents', 'alerts', 'videos', 'seen', 'rewatch', 'question_log'];
  v_players text[];
  v_ids text[];
  v_t text;
  v_total jsonb := '{}'::jsonb;
  v_notifs integer;
  v_expired integer;
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
    -- (Leurs liens vidéo, « vu » et « à revoir » : déclencheurs de 036 et 041, quand la fiche est effacée ci-dessous.)
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

  -- 043 : journal des questions : chaque entrée est effacée au bout de 12 mois (date de création sur le serveur, posée
  -- par hb_stamp ; à défaut, dernière écriture). Effacée = l'identifiant seul (les appareils l'oublient aussi).
  if p_tables is null or 'question_log' = any (p_tables) then
    update public.hb_question_log
       set data = jsonb_build_object('id', id, 'deleted', true, 'purged', true, 'updatedAt', v_now),
           deleted = true, updated_at_client = v_now
     where not coalesce((data ->> 'purged')::boolean, false)
       and coalesce((data ->> 'createdAtServer')::timestamptz, server_updated_at) < now() - interval '12 months';
    get diagnostics v_expired = row_count;
    if v_expired > 0 then
      v_total := v_total || jsonb_build_object('question_log_12_mois', v_expired);
    end if;
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
                                   when %1$L in (''measurements'', ''evaluations'', ''referents'', ''seen'', ''rewatch'') then jsonb_build_object(''playerId'', data -> ''playerId'')
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
            'Effacement des suppressions de plus de ' || p_days || ' jours (journal des questions : plus de 12 mois) : '
              || (select string_agg(value || ' ' || case key when 'players' then 'joueur(s)' when 'measurements' then 'mesure(s)'
                     when 'evaluations' then 'avis' when 'events' then 'événement(s)' when 'groups' then 'groupe(s)'
                     when 'referents' then 'référent(s)' when 'videos' then 'vidéo(s)' when 'seen' then '« vu »'
                     when 'rewatch' then '« à revoir »' when 'question_log' then 'question(s) du journal (vidé)'
                     when 'question_log_12_mois' then 'question(s) du journal de plus de 12 mois'
                     else 'alerte(s)' end, ', ') from jsonb_each_text(v_total)));
  end if;
  return v_total;
end $$;

-- ---------- Droits des fonctions (reprise de 041, avec hb_is_admin pour la règle de lecture) ----------
-- Appelées par l'appli (supabase.rpc) ou par les règles de lecture : comptes connectés seulement.
-- Toutes les autres fonctions hb_* (déclencheurs, outils internes) : personne, sauf le serveur.
do $$
declare
  f record;
  v_app text[] := array['hb_upsert', 'hb_merge_players', 'hb_create_member', 'hb_update_member', 'hb_delete_member',
                        'hb_members', 'hb_set_role', 'hb_set_departments', 'hb_purge_expired', 'hb_purge_deleted',
                        'hb_push_subscribe', 'hb_push_unsubscribe', 'hb_set_notif_prefs', 'hb_notif_test', 'hb_has_role',
                        'hb_ping', 'hb_last_seen', 'hb_is_participant', 'hb_log_view_as', 'hb_transfer_group',
                        'hb_admin_groups', 'hb_admin_group', 'hb_admin_delete_group', 'hb_rewatch_readable',
                        'hb_is_admin'];
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

-- Vérification : table en place (nombre de lignes), hb_upsert et hb_purge_deleted la connaissent, déclencheurs (hb_touch,
-- hb_stamp ; pas hb_log) et règle de lecture (admin_read, select) posés, aucun droit d'écriture direct.
select (select count(*) from public.hb_question_log) as questions,
       (select position('question_log' in prosrc) > 0 from pg_proc where proname = 'hb_upsert') as hb_upsert_ok,
       (select position('12 months' in prosrc) > 0 from pg_proc where proname = 'hb_purge_deleted') as purge_12_mois_ok,
       (select string_agg(privilege_type, ', ' order by privilege_type) from information_schema.role_table_grants
         where table_schema = 'public' and table_name = 'hb_question_log' and grantee = 'authenticated') as droits_authenticated;
select tgname as declencheur from pg_trigger where tgrelid = 'public.hb_question_log'::regclass and not tgisinternal order by 1;
select policyname, cmd, roles from pg_policies where tablename = 'hb_question_log';
