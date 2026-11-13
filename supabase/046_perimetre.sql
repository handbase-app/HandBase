-- HandBase : périmètre de chaque compte (filtrage des joueurs par la structure, CÔTÉ SERVEUR).
-- À exécuter une fois dans Supabase > SQL Editor, APRÈS 045_departement_outre_mer.sql (base de test d'abord, puis la réelle).
-- Peut être relancé sans risque (idempotent : add column if not exists, create or replace, drop … if exists).
--
-- Avant ce script, tout compte avec un rôle recevait TOUS les joueurs (règle staff_read = hb_has_role()) ; le « secteur »
-- (hb_profiles.departments, 010) ne filtrait que l'affichage et les validations. Désormais, la structure (044) décide.
--
-- 1) RÈGLE (la même que l'appli, src/perimeter.ts) :
--    - Périmètre d'un compte = chaque unité où il est affecté (hb_assignments) + toutes ses sous-unités (hb_units, parentId).
--    - Administrateur (rôle admin du profil) ou compte affecté à une unité de niveau Fédération (niveau « niveau-federation »
--      ou dont le nom commence par « Fédération ») : tout.
--    - Unité qui porte un n° de club (clubNumber) : seulement les joueurs de ce club (n° de club du joueur, à défaut les 7
--      premiers chiffres de sa licence). Ses éventuelles sous-unités : leurs clubs aussi.
--    - Autre unité (ligue, comité, pôle…) : les joueurs dont le département (hb_player_dept, 045, outre-mer compris) est un
--      département couvert : ceux de l'unité et de ses sous-unités (departments), plus le département tiré du n° de club
--      de chaque club en dessous (ligues 64 à 70 → 971, 973, 972, 988, 974, 976).
--    - Compte avec un rôle mais SANS affectation : AUCUN joueur (hors administrateurs). hb_profiles.departments n'est pas
--      touché : il ne sert plus qu'aux validations (hb_can_review) et aux filtres par défaut de l'appli.
--    - Chacun voit toujours les lignes qu'il a créées lui-même (data.createdBy, posé par hb_stamp) : une fiche proposée en
--      tournoi ne disparaît pas de l'appareil de son auteur, même si elle est hors de son périmètre.
-- 2) TABLES CONCERNÉES : hb_players et tout ce qui est rattaché à un joueur : hb_measurements, hb_evaluations, hb_seen,
--    hb_rewatch (playerId), hb_videos (targetKind = player), hb_follows (kind = player ; lecture déjà réservée à son
--    auteur, seule l'écriture est contrôlée). hb_referents n'est plus lisible depuis 018. Événements, groupes, équipes,
--    listes, critères, configuration et structure restent visibles par tout le staff, comme avant (un événement ou un
--    groupe peut citer un joueur hors périmètre : l'appli l'affiche « hors de ton périmètre », sans son nom).
-- 3) PERFORMANCE (40 000 joueurs) :
--    - Deux colonnes posées sur chaque ligne (dénormalisation) : scope_dept (département du joueur) et scope_club (son
--      club). Calculées par un déclencheur AVANT écriture (hb_scope) : depuis la fiche pour un joueur, depuis la fiche du
--      joueur visé (lecture par clé primaire) pour une ligne rattachée. La règle de lecture ne fait donc AUCUNE
--      sous-requête par ligne : une comparaison de colonnes.
--    - Le périmètre du compte (tableaux de départements et de clubs) est calculé UNE fois par requête : fonctions STABLE,
--      SECURITY DEFINER, appelées dans les règles sous la forme (select …) (Postgres les évalue une fois, « initplan »),
--      et gardé pour la transaction (réglage local hb.scope_cache) : un envoi de 400 lignes ne le recalcule pas 400 fois.
--    - Un joueur qui change de département ou de club (mutation, correction) : ses lignes rattachées suivent
--      (hb_scope_cascade) ; elles changent donc d'heure serveur et arrivent chez ceux qui les voient désormais
--      (synchronisation par curseur). Signature (hb_stamp) et journal (hb_log) inchangés : rien de réel n'a changé.
--    - Index : département et club des joueurs, joueur des mesures et des avis (suivi des lignes rattachées), parent des
--      unités et compte des affectations (calcul du périmètre).
-- 4) ÉCRITURES : depuis 040, aucun compte n'écrit directement dans les tables (lecture seule) : tout passe par hb_upsert
--    (security definer, qui contourne les règles RLS). Le contrôle est donc fait par le même déclencheur hb_scope, qui
--    s'applique à tout écrivain : pour un compte connecté qui n'a pas « tout », une ligne hors périmètre n'est pas écrite
--    (le déclencheur l'écarte ; hb_upsert la renvoie comme refusée, l'appareil reprend la version du serveur) :
--    - joueur : créer une fiche dans son périmètre ; modifier une fiche de son périmètre (ou qu'il a créée) sans la sortir
--      du périmètre (changer de département pour un autre de son périmètre : permis). Fiche SANS club ni licence (joueur
--      repéré en tournoi, fiche proposée) : acceptée si son département est couvert (départements de ses clubs compris :
--      un compte de club propose dans son département) ; département inconnu aussi : acceptée si le compte a un
--      périmètre, et s'il ne couvre qu'un seul département, celui-ci est posé sur la fiche (champ department) pour que les
--      encadrants du comité la voient et la valident ; sinon, seuls son auteur et les comptes qui voient tout la voient.
--    - ligne rattachée (avis, mesure, vu, à revoir, vidéo, suivi) : seulement sur un joueur qu'il voit ; sa propre ligne
--      reste modifiable (et supprimable) même si le joueur est sorti de son périmètre depuis.
--    - Compte sans affectation : aucune écriture sur les joueurs et leurs lignes.
--    - Écritures du serveur (tâches de nuit, fusions, cascades d'un déclencheur) : pas de contrôle.
-- 5) NOTIFICATIONS : une notification qui cite un joueur (fiche proposée, suivi : lien /joueurs/…) ne part qu'à un compte
--    qui voit ce joueur ; les encadrants « du secteur » prévenus (hb_sector_staff) sont aussi limités à leur périmètre.
-- 6) DIFFUSION EN DIRECT (Realtime, postgres_changes) : elle applique les règles de lecture pour chaque compte abonné ;
--    aucun déclencheur HandBase ne diffuse de ligne lui-même. Rien d'autre à faire. Au passage du script, le remplissage
--    des colonnes produit une rafale de changements (sans effet : l'appli relit, ne trouve rien de nouveau).
-- 7) L'appli (même version) : lit son périmètre (hb_my_perimeter) ; quand il change, efface de l'appareil les lignes
--    qu'elle ne voit plus et relit depuis le début les tables concernées (les lignes devenues visibles ont une ancienne
--    heure serveur : un curseur ne les ramènerait pas). Voir src/sync.ts et src/perimeter.ts.
-- Annulation : section « RETOUR ARRIÈRE » à la fin (commentée).

-- ---------- 1. Colonnes de périmètre et index ----------

do $$
declare t text;
begin
  foreach t in array array['players', 'measurements', 'evaluations', 'seen', 'rewatch', 'videos', 'follows'] loop
    execute format('alter table public.hb_%1$s add column if not exists scope_dept text, add column if not exists scope_club text', t);
  end loop;
end $$;

create index if not exists hb_players_scope_dept on public.hb_players (scope_dept);
create index if not exists hb_players_scope_club on public.hb_players (scope_club);
create index if not exists hb_measurements_player on public.hb_measurements ((data ->> 'playerId'));
create index if not exists hb_evaluations_player on public.hb_evaluations ((data ->> 'playerId'));
create index if not exists hb_units_parent on public.hb_units ((data ->> 'parentId'));
create index if not exists hb_assignments_user on public.hb_assignments ((data ->> 'userId'));

-- ---------- 2. Club d'un joueur ----------

-- N° de club saisi (Gest'Hand), à défaut les 7 premiers chiffres de la licence (13 chiffres). Même règle que l'appli
-- (src/perimeter.ts, playerClub).
create or replace function public.hb_player_club(p jsonb) returns text
language sql immutable as $$
  select case
    when coalesce(btrim(p ->> 'clubCode'), '') <> '' then btrim(p ->> 'clubCode')
    when coalesce(p ->> 'license', '') ~ '^\d{13}$' then left(p ->> 'license', 7)
  end
$$;

-- ---------- 3. Périmètre d'un compte ----------

-- { tout ?, départements, clubs } d'un compte, lu dans l'arbre (unités où il est affecté + sous-unités). Une boucle dans
-- l'arbre (impossible en principe : hb_structure_ok l'interdit) ne fait pas tourner le calcul sans fin (chemin parcouru).
create or replace function public.hb_scope_of(p_uid uuid)
returns table (all_ boolean, depts text[], clubs text[])
language sql stable security definer set search_path = public as $$
  with recursive
  mine as (
    select u.id, u.data
      from public.hb_assignments a
      join public.hb_units u on u.id = a.data ->> 'unitId' and not u.deleted
     where not a.deleted and a.data ->> 'userId' = p_uid::text
  ),
  tree (id, data, club_root, path) as (
    select m.id, m.data, coalesce(btrim(m.data ->> 'clubNumber'), '') <> '', array[m.id] from mine m
    union all
    select c.id, c.data, t.club_root, t.path || c.id
      from tree t
      join public.hb_units c on c.data ->> 'parentId' = t.id and not c.deleted
     where c.id <> all (t.path) and cardinality(t.path) < 50
  ),
  d as (
    select x.d
      from tree t cross join lateral jsonb_array_elements_text(public.hb_arr(t.data -> 'departments')) x(d)
     where not t.club_root
    union
    select public.hb_player_dept(jsonb_build_object('clubCode', btrim(t.data ->> 'clubNumber')))
      from tree t
     where not t.club_root and coalesce(btrim(t.data ->> 'clubNumber'), '') <> ''
  ),
  c as (
    select distinct btrim(t.data ->> 'clubNumber') as c
      from tree t
     where t.club_root and coalesce(btrim(t.data ->> 'clubNumber'), '') <> ''
  )
  select
    exists (select 1 from public.hb_profiles where user_id = p_uid and role = 'admin')
      or exists (select 1 from mine m left join public.hb_levels l on l.id = m.data ->> 'levelId'
                  where m.data ->> 'levelId' = 'niveau-federation'
                     or translate(lower(coalesce(l.data ->> 'name', '')), 'éèêÉ', 'eeee') like 'federation%'),
    coalesce((select array_agg(distinct d.d order by d.d) from d where coalesce(d.d, '') <> ''), '{}'::text[]),
    coalesce((select array_agg(c.c order by c.c) from c), '{}'::text[])
$$;

-- Périmètre du compte connecté, gardé pour la transaction (une requête, un envoi hb_upsert = une transaction).
-- Le réglage local (hb.scope_cache) n'est pas modifiable depuis l'appli : PostgREST n'expose que les fonctions de public.
create or replace function public.hb_my_scope() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_cache text;
  v jsonb;
begin
  if v_uid is null then
    return jsonb_build_object('all', false, 'depts', '[]'::jsonb, 'clubs', '[]'::jsonb);
  end if;
  v_cache := current_setting('hb.scope_cache', true);
  if coalesce(v_cache, '') <> '' then
    v := v_cache::jsonb;
    if v ->> 'uid' = v_uid::text then return v; end if;
  end if;
  select jsonb_build_object('uid', v_uid, 'all', s.all_, 'depts', to_jsonb(s.depts), 'clubs', to_jsonb(s.clubs))
    into v from public.hb_scope_of(v_uid) s;
  perform set_config('hb.scope_cache', v::text, true);
  return v;
end $$;

-- Pour les règles de lecture, toujours appelées sous la forme (select …) : une seule évaluation par requête.
create or replace function public.hb_scope_all() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((public.hb_my_scope() ->> 'all')::boolean, false)
$$;
create or replace function public.hb_scope_depts() returns text[]
language sql stable security definer set search_path = public as $$
  select coalesce(array(select jsonb_array_elements_text(public.hb_my_scope() -> 'depts')), '{}'::text[])
$$;
create or replace function public.hb_scope_clubs() returns text[]
language sql stable security definer set search_path = public as $$
  select coalesce(array(select jsonb_array_elements_text(public.hb_my_scope() -> 'clubs')), '{}'::text[])
$$;

-- Pour l'appli (supabase.rpc) : son périmètre, tel que le serveur l'applique. Sans rôle : rien.
create or replace function public.hb_my_perimeter() returns jsonb
language sql stable security definer set search_path = public as $$
  select case when public.hb_has_role() then public.hb_my_scope() - 'uid'
              else jsonb_build_object('all', false, 'depts', '[]'::jsonb, 'clubs', '[]'::jsonb) end
$$;

-- Ce compte voit-il un joueur (département, club, auteur de la fiche) ? Pour les notifications.
create or replace function public.hb_scope_has(p_uid uuid, p_dept text, p_club text, p_created_by text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select s.all_ or p_dept = any (s.depts) or p_club = any (s.clubs) or p_created_by = p_uid::text
                     from public.hb_scope_of(p_uid) s), false)
$$;

-- ---------- 4. Colonnes tenues à jour et contrôle des écritures ----------

create or replace function public.hb_scope_row() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_scope jsonb;
  v_depts text[];
  v_clubs text[];
  v_pid text;
  v_owner text;
  v_in_new boolean;
  v_in_old boolean;
  v_only text[];
  v_exists boolean;
begin
  -- a) Département et club de la ligne.
  if tg_table_name = 'hb_players' then
    if tg_op = 'UPDATE' and coalesce((new.data ->> 'purged')::boolean, false) then
      -- Fiche effacée (il ne reste que l'identifiant) : elle garde son périmètre, l'effacement arrive aux bons appareils.
      new.scope_dept := old.scope_dept;
      new.scope_club := old.scope_club;
    else
      new.scope_dept := public.hb_player_dept(new.data);
      new.scope_club := public.hb_player_club(new.data);
    end if;
  else
    v_pid := case tg_table_name
      when 'hb_videos' then case when new.data ->> 'targetKind' = 'player' then new.data ->> 'targetId' end
      when 'hb_follows' then case when new.data ->> 'kind' = 'player' then new.data ->> 'targetId' end
      else new.data ->> 'playerId' end;
    new.scope_dept := null;
    new.scope_club := null;
    if v_pid is not null then
      select p.scope_dept, p.scope_club, p.data ->> 'createdBy' into new.scope_dept, new.scope_club, v_owner
        from public.hb_players p where p.id = v_pid;
    end if;
  end if;

  -- b) Contrôle : seulement un compte connecté, et pas les cascades d'un autre déclencheur (fusion, suivi d'un joueur…).
  if v_uid is null or pg_trigger_depth() > 1 then return new; end if;
  v_scope := public.hb_my_scope();
  if coalesce((v_scope ->> 'all')::boolean, false) then return new; end if;
  v_depts := array(select jsonb_array_elements_text(v_scope -> 'depts'));
  v_clubs := array(select jsonb_array_elements_text(v_scope -> 'clubs'));
  v_in_new := coalesce(new.scope_dept = any (v_depts), false) or coalesce(new.scope_club = any (v_clubs), false);
  -- hb_upsert écrit par « insert … on conflict do update » : pour une ligne qui existe déjà, c'est le passage « update »
  -- (anciennes valeurs connues) qui décide ; ici, rien n'est changé ni refusé.
  if tg_op = 'INSERT' then
    execute format('select exists (select 1 from public.%I where id = $1)', tg_table_name) into v_exists using new.id;
    if v_exists then return new; end if;
  end if;

  if tg_table_name = 'hb_players' then
    if tg_op = 'INSERT' then
      if v_in_new then return new; end if;
      -- Fiche SANS club ni licence (joueur repéré en tournoi, fiche proposée) : acceptée si son département est couvert par
      -- le périmètre (départements de ses clubs compris : un compte de club propose dans son département). Département
      -- inconnu aussi : alors, s'il n'y a qu'un département couvert, il est posé sur la fiche.
      if new.scope_club is null and cardinality(v_depts) + cardinality(v_clubs) > 0 then
        select array_agg(distinct x) into v_only
          from (select unnest(v_depts) as x
                union select public.hb_player_dept(jsonb_build_object('clubCode', c)) from unnest(v_clubs) c) s
         where coalesce(x, '') <> '';
        if new.scope_dept is null then
          if cardinality(v_only) = 1 then
            new.data := new.data || jsonb_build_object('department', v_only[1]);
            new.scope_dept := v_only[1];
          end if;
          return new;
        end if;
        if new.scope_dept = any (v_only) then return new; end if;
      end if;
      return null;
    end if;
    -- Modification : fiche de son périmètre (ou créée par lui), qui y reste (ou dont le périmètre ne change pas).
    v_in_old := coalesce(old.scope_dept = any (v_depts), false) or coalesce(old.scope_club = any (v_clubs), false);
    if not (v_in_old or coalesce(old.data ->> 'createdBy' = v_uid::text, false)) then return null; end if;
    if v_in_new then return new; end if;
    if new.scope_dept is not distinct from old.scope_dept and new.scope_club is not distinct from old.scope_club then return new; end if;
    return null;
  end if;

  -- Ligne rattachée : sans joueur visé (vidéo d'un événement, suivi d'un groupe) : pas de contrôle de périmètre.
  if v_pid is null then return new; end if;
  -- Joueur visible (périmètre, ou fiche créée par lui).
  if v_in_new or v_owner = v_uid::text then return new; end if;
  -- Sa propre ligne, même si le joueur est sorti de son périmètre depuis.
  if tg_op = 'UPDATE' and old.data ->> 'createdBy' = v_uid::text then return new; end if;
  return null;
end $$;

-- Un joueur change de département ou de club : ses lignes rattachées suivent (nouvelle heure serveur : elles arrivent chez
-- ceux qui les voient désormais).
create or replace function public.hb_scope_cascade() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.hb_measurements set scope_dept = new.scope_dept, scope_club = new.scope_club where data ->> 'playerId' = new.id;
  update public.hb_evaluations set scope_dept = new.scope_dept, scope_club = new.scope_club where data ->> 'playerId' = new.id;
  update public.hb_seen set scope_dept = new.scope_dept, scope_club = new.scope_club where data ->> 'playerId' = new.id;
  update public.hb_rewatch set scope_dept = new.scope_dept, scope_club = new.scope_club where data ->> 'playerId' = new.id;
  update public.hb_videos set scope_dept = new.scope_dept, scope_club = new.scope_club
   where data ->> 'targetKind' = 'player' and data ->> 'targetId' = new.id;
  update public.hb_follows set scope_dept = new.scope_dept, scope_club = new.scope_club
   where data ->> 'kind' = 'player' and data ->> 'targetId' = new.id;
  return null;
end $$;

-- Signature (reprise de 004) : une ligne réécrite SANS changement de contenu (colonnes de périmètre seulement) garde sa
-- signature (modifiée par, à quelle heure) : « modifié par » ne doit pas désigner celui qui a fait muter le joueur.
create or replace function public.hb_stamp() returns trigger
language plpgsql security definer set search_path = public as $$
declare a record;
begin
  if tg_op = 'UPDATE' and new.data is not distinct from old.data then return new; end if;
  select * into a from public.hb_actor();
  if tg_op = 'INSERT' then
    new.data := new.data || jsonb_strip_nulls(jsonb_build_object(
      'createdBy', a.uid, 'createdByName', a.name, 'createdAtServer', now()));
  else
    -- La création reste celle d'origine, quoi qu'envoie l'appareil.
    new.data := (new.data - 'createdBy' - 'createdByName' - 'createdAtServer') || jsonb_strip_nulls(jsonb_build_object(
      'createdBy', old.data -> 'createdBy', 'createdByName', old.data -> 'createdByName', 'createdAtServer', old.data -> 'createdAtServer'));
  end if;
  new.data := new.data || jsonb_strip_nulls(jsonb_build_object(
    'updatedBy', a.uid, 'updatedByName', a.name, 'updatedAtServer', now()));
  return new;
end $$;

-- ---------- 5. Remplissage des colonnes (une fois ; relancé : seulement ce qui diffère) ----------
-- Déclencheurs suspendus le temps du remplissage (dans ce seul bloc : une erreur annule tout, déclencheurs compris) :
-- l'heure serveur des lignes ne bouge pas (pas de retéléchargement par les appareils), rien n'est signé ni journalisé.

do $$
declare t text;
begin
  alter table public.hb_players disable trigger user;
  update public.hb_players
     set scope_dept = public.hb_player_dept(data), scope_club = public.hb_player_club(data)
   where not coalesce((data ->> 'purged')::boolean, false)
     and (scope_dept is distinct from public.hb_player_dept(data) or scope_club is distinct from public.hb_player_club(data));
  alter table public.hb_players enable trigger user;

  foreach t in array array['measurements', 'evaluations', 'seen', 'rewatch'] loop
    execute format('alter table public.hb_%1$s disable trigger user', t);
    execute format('update public.hb_%1$s x set scope_dept = p.scope_dept, scope_club = p.scope_club
                      from public.hb_players p
                     where p.id = x.data ->> ''playerId''
                       and (x.scope_dept is distinct from p.scope_dept or x.scope_club is distinct from p.scope_club)', t);
    execute format('alter table public.hb_%1$s enable trigger user', t);
  end loop;

  alter table public.hb_videos disable trigger user;
  update public.hb_videos x set scope_dept = p.scope_dept, scope_club = p.scope_club
    from public.hb_players p
   where x.data ->> 'targetKind' = 'player' and p.id = x.data ->> 'targetId'
     and (x.scope_dept is distinct from p.scope_dept or x.scope_club is distinct from p.scope_club);
  alter table public.hb_videos enable trigger user;

  alter table public.hb_follows disable trigger user;
  update public.hb_follows x set scope_dept = p.scope_dept, scope_club = p.scope_club
    from public.hb_players p
   where x.data ->> 'kind' = 'player' and p.id = x.data ->> 'targetId'
     and (x.scope_dept is distinct from p.scope_dept or x.scope_club is distinct from p.scope_club);
  alter table public.hb_follows enable trigger user;
end $$;

-- ---------- 6. Déclencheurs ----------
-- « hb_scope » passe AVANT hb_stamp et hb_touch (ordre alphabétique des déclencheurs d'un même moment).

do $$
declare t text;
begin
  foreach t in array array['players', 'measurements', 'evaluations', 'seen', 'rewatch', 'videos', 'follows'] loop
    execute format('drop trigger if exists hb_scope on public.hb_%1$s;
      create trigger hb_scope before insert or update on public.hb_%1$s for each row execute function public.hb_scope_row();', t);
  end loop;
end $$;

drop trigger if exists hb_scope_cascade on public.hb_players;
create trigger hb_scope_cascade after update on public.hb_players
  for each row
  when (new.scope_dept is distinct from old.scope_dept or new.scope_club is distinct from old.scope_club)
  execute function public.hb_scope_cascade();

-- ---------- 7. Règles de lecture ----------
-- Toujours le rôle (comme avant), puis : tout, ou département couvert, ou club couvert, ou ligne créée par ce compte.

do $$
declare
  t text;
  v_scope text := '((select public.hb_scope_all())
        or scope_dept = any ((select public.hb_scope_depts())::text[])
        or scope_club = any ((select public.hb_scope_clubs())::text[])
        or data ->> ''createdBy'' = (select auth.uid())::text)';
begin
  foreach t in array array['players', 'measurements', 'evaluations', 'seen'] loop
    execute format('drop policy if exists "staff_read" on public.hb_%1$s;
      create policy "staff_read" on public.hb_%1$s for select to authenticated using (
        (select public.hb_has_role()) and %2$s);', t, v_scope);
  end loop;
  -- « À revoir » : en plus, la règle de 041 (son auteur, son staff, les administrateurs).
  execute format('drop policy if exists "staff_read" on public.hb_rewatch;
    create policy "staff_read" on public.hb_rewatch for select to authenticated using (
      (select public.hb_has_role()) and %1$s and public.hb_rewatch_readable(data));', v_scope);
  -- Vidéos : celles d''un événement restent visibles par tout le staff.
  execute format('drop policy if exists "staff_read" on public.hb_videos;
    create policy "staff_read" on public.hb_videos for select to authenticated using (
      (select public.hb_has_role()) and (data ->> ''targetKind'' is distinct from ''player'' or %1$s));', v_scope);
  -- Suivis : règle de 032 inchangée (chacun ne lit que les siens).
end $$;

-- Ceinture : toujours aucune écriture directe (040) sur ces tables.
do $$
declare t text;
begin
  foreach t in array array['players', 'measurements', 'evaluations', 'seen', 'rewatch', 'videos', 'follows'] loop
    execute format('revoke insert, update, delete, truncate, references, trigger on public.hb_%1$s from public, anon, authenticated', t);
    execute format('grant select on public.hb_%1$s to authenticated', t);
  end loop;
end $$;

-- ---------- 8. Notifications ----------

-- Encadrants qui valident pour ce département (sans département attribué : tous), parmi ceux qui le voient (reprise de 026).
create or replace function public.hb_sector_staff(p_dept text) returns setof uuid
language sql stable security definer set search_path = public as $$
  select p.user_id from public.hb_profiles p cross join lateral public.hb_scope_of(p.user_id) s
   where p.role = 'preparateur' and (cardinality(p.departments) = 0 or p_dept = any (p.departments))
     and (s.all_ or p_dept = any (s.depts))
$$;

-- Notification (reprise de 026) : celle qui mène à une fiche joueur ne part qu'à un compte qui voit ce joueur.
create or replace function public.hb_notify(p_user uuid, p_kind text, p_group text, p_title text, p_body text, p_plural text, p_url text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_user is null or p_user is not distinct from auth.uid() then return; end if;
  if not exists (select 1 from public.hb_push_subs where user_id = p_user) then return; end if;
  if (select coalesce((notif ->> p_kind)::boolean, true) from public.hb_profiles where user_id = p_user) is false then return; end if;
  if p_url like '/joueurs/%' and not exists (
    select 1 from public.hb_players pl
     where pl.id = substr(p_url, length('/joueurs/') + 1)
       and public.hb_scope_has(p_user, pl.scope_dept, pl.scope_club, pl.data ->> 'createdBy')) then
    return;
  end if;
  insert into public.hb_notifications (user_id, kind, group_key, title, body, plural, url)
  values (p_user, p_kind, p_group, p_title, p_body, p_plural, p_url);
end $$;

-- ---------- 9. Droits des fonctions (reprise de 044, avec les fonctions des règles de lecture et hb_my_perimeter) ----------
-- Appelées par l'appli (supabase.rpc) ou par les règles de lecture : comptes connectés seulement.
-- Toutes les autres fonctions hb_* (déclencheurs, outils internes, dont hb_scope_of et hb_my_scope) : personne, sauf le serveur.
-- (Un prochain script qui reprend cette liste doit garder hb_scope_all, hb_scope_depts, hb_scope_clubs et hb_my_perimeter.)
do $$
declare
  f record;
  v_app text[] := array['hb_upsert', 'hb_merge_players', 'hb_create_member', 'hb_update_member', 'hb_delete_member',
                        'hb_members', 'hb_set_role', 'hb_set_departments', 'hb_purge_expired', 'hb_purge_deleted',
                        'hb_push_subscribe', 'hb_push_unsubscribe', 'hb_set_notif_prefs', 'hb_notif_test', 'hb_has_role',
                        'hb_ping', 'hb_last_seen', 'hb_is_participant', 'hb_log_view_as', 'hb_transfer_group',
                        'hb_admin_groups', 'hb_admin_group', 'hb_admin_delete_group', 'hb_rewatch_readable',
                        'hb_is_admin', 'hb_scope_all', 'hb_scope_depts', 'hb_scope_clubs', 'hb_my_perimeter'];
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

-- ---------- Vérification ----------
-- Colonnes remplies (joueurs sans département ni club : fiches sans club ni licence ni département saisi, ou effacées),
-- déclencheurs et règles posés.
select (select count(*) from public.hb_players) as joueurs,
       (select count(*) from public.hb_players where scope_dept is not null) as joueurs_avec_departement,
       (select count(*) from public.hb_players where scope_dept is null and scope_club is null) as joueurs_sans_perimetre,
       (select count(*) from public.hb_evaluations where data ->> 'playerId' is not null and scope_dept is null and scope_club is null) as avis_sans_perimetre,
       (select count(*) from pg_trigger where tgname in ('hb_scope', 'hb_scope_cascade') and not tgisinternal) as declencheurs_7_plus_1;
select tablename, policyname, cmd from pg_policies
 where tablename in ('hb_players', 'hb_measurements', 'hb_evaluations', 'hb_seen', 'hb_rewatch', 'hb_videos', 'hb_follows')
 order by 1, 2;

-- Périmètre de chaque membre (à lire, pas à diffuser) :
-- select pr.full_name, pr.role, s.all_ as tout, s.depts as departements, cardinality(s.clubs) as clubs
--   from public.hb_profiles pr cross join lateral public.hb_scope_of(pr.user_id) s order by 1;
--
-- Ce que voit un compte (remplacer <uuid> par son identifiant ; tout est annulé à la fin) :
-- begin;
--   select set_config('request.jwt.claims', json_build_object('sub', '<uuid>', 'role', 'authenticated')::text, true);
--   set local role authenticated;
--   select public.hb_my_perimeter();
--   select count(*) as joueurs_vus, count(*) filter (where scope_dept is null and scope_club is null) as sans_perimetre from public.hb_players;
--   select scope_dept, count(*) from public.hb_players group by 1 order by 2 desc limit 20;
--   select count(*) as avis_vus from public.hb_evaluations;
--   explain analyze select id, data, server_updated_at from public.hb_players
--     where server_updated_at >= '1970-01-01' order by server_updated_at, id limit 1000;
-- rollback;

-- ---------- RETOUR ARRIÈRE (à lancer seulement pour annuler ce script ; tout le monde revoit tous les joueurs) ----------
-- do $$
-- declare t text;
-- begin
--   foreach t in array array['players', 'measurements', 'evaluations', 'seen'] loop
--     execute format('drop policy if exists "staff_read" on public.hb_%1$s;
--       create policy "staff_read" on public.hb_%1$s for select to authenticated using ((select public.hb_has_role()));', t);
--   end loop;
--   drop policy if exists "staff_read" on public.hb_rewatch;
--   create policy "staff_read" on public.hb_rewatch for select to authenticated using (
--     (select public.hb_has_role()) and public.hb_rewatch_readable(data));
--   drop policy if exists "staff_read" on public.hb_videos;
--   create policy "staff_read" on public.hb_videos for select to authenticated using ((select public.hb_has_role()));
--   foreach t in array array['players', 'measurements', 'evaluations', 'seen', 'rewatch', 'videos', 'follows'] loop
--     execute format('drop trigger if exists hb_scope on public.hb_%1$s', t);
--   end loop;
--   drop trigger if exists hb_scope_cascade on public.hb_players;
-- end $$;
-- create or replace function public.hb_sector_staff(p_dept text) returns setof uuid
-- language sql stable security definer set search_path = public as $$
--   select user_id from public.hb_profiles
--    where role = 'preparateur' and (cardinality(departments) = 0 or p_dept = any (departments))
-- $$;
-- create or replace function public.hb_notify(p_user uuid, p_kind text, p_group text, p_title text, p_body text, p_plural text, p_url text)
-- returns void language plpgsql security definer set search_path = public as $$
-- begin
--   if p_user is null or p_user is not distinct from auth.uid() then return; end if;
--   if not exists (select 1 from public.hb_push_subs where user_id = p_user) then return; end if;
--   if (select coalesce((notif ->> p_kind)::boolean, true) from public.hb_profiles where user_id = p_user) is false then return; end if;
--   insert into public.hb_notifications (user_id, kind, group_key, title, body, plural, url)
--   values (p_user, p_kind, p_group, p_title, p_body, p_plural, p_url);
-- end $$;
-- (Colonnes scope_dept / scope_club, index, hb_stamp et fonctions hb_scope_* : peuvent rester, sans effet sans les règles
-- et déclencheurs ci-dessus. Pour les retirer aussi : alter table public.hb_<table> drop column if exists scope_dept,
-- drop column if exists scope_club; pour chaque table de la liste.)
-- Indispensable : l'appli doit lire « tout » pour relire depuis le début les joueurs redevenus visibles (sinon son curseur
-- ne les ramène pas) :
-- create or replace function public.hb_my_perimeter() returns jsonb
-- language sql stable security definer set search_path = public as $$
--   select jsonb_build_object('all', true, 'depts', '[]'::jsonb, 'clubs', '[]'::jsonb)
-- $$;
