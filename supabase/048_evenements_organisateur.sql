-- HandBase : unité organisatrice d'un événement et visibilité des événements par territoire (CÔTÉ SERVEUR).
-- À exécuter dans Supabase > SQL Editor, APRÈS 047_perimetre_poles.sql : base de TEST d'abord (vérifier avec la requête
-- de contrôle et l'essai en fin de fichier), puis la réelle. Peut être relancé sans risque (add column if not exists,
-- create or replace, drop … if exists ; le remplissage ne réécrit que ce qui diffère).
-- L'appli (même version ou plus récente) peut être publiée avant ou après : le champ organizerUnitId est dans data (jsonb),
-- gardé tel quel par hb_upsert ; ce script le lit.
--
-- DÉCISION (option A) : un événement est rattaché à UNE unité de la structure (hb_units), « Organisé par : Comité du Var »,
-- choisie à la création (par défaut l'unité du créateur : src/eventOrganizer.ts). Champ data.organizerUnitId, facultatif
-- (data.organizerName : copie du nom pour l'affichage hors ligne).
--
-- 1) CE QUI CHANGE
--    - Deux colonnes sur hb_events, tenues par un déclencheur (hb_scope, AVANT écriture) : scope_dept et scope_club, des
--      TABLEAUX (text[]) : le territoire de l'unité organisatrice, calculé comme le périmètre d'un compte affecté à cette
--      unité (hb_scope_of, 046/047) : ses départements (ceux de ses sous-unités et des clubs en dessous compris) ; unité de
--      club : ses clubs (scope_club) et leurs départements (scope_dept) ; pôle sans territoire : celui de son parent (047).
--      NULL = pas d'organisateur (événements d'avant ce script) ou unité inconnue / supprimée.
--    - Recalcul en cascade quand la structure change (unité ajoutée, déplacée, départements ou n° de club changés,
--      supprimée) : déclencheur DIFFÉRÉ à la fin de la transaction (un import de structure de milliers d'unités ne recalcule
--      qu'une fois), qui ne réécrit que les événements dont le territoire a changé. Ces événements changent alors d'heure
--      serveur : ils arrivent chez ceux qui les voient désormais (synchronisation par curseur).
--    - RÈGLE DE LECTURE de hb_events (staff_read) : un compte avec un rôle voit un événement si
--        (a) il voit tout : administrateur, ou affecté à une unité de niveau Fédération (hb_scope_all) ;
--        (b) l'événement n'a pas d'organisateur (compatibilité : TOUS les événements existants restent visibles par tout
--            le staff, comme avant) ;
--        (c) le territoire de l'organisateur est ENTIÈREMENT dans son périmètre (unités au-dessus incluses) : la Ligue voit
--            les événements de ses comités, pôles et clubs ; un comité voit ceux de ses clubs ; un comité ne voit PAS ceux
--            de la Ligue (son territoire n'en couvre qu'une partie), ni un club ceux de son comité ; une unité sans aucun
--            territoire (ni département ni club, même en remontant) : seulement (a), (d) et (e) ;
--        (d) AU MOINS UN DE SES JOUEURS y est inscrit (data.playerIds) : un joueur de son périmètre (046 : département ou
--            club du joueur). Un club voit le stage du comité où sont deux de ses joueurs ; un comité, le stage de Ligue
--            où sont ses jeunes ; un club, le rassemblement Équipe de France de son joueur. En LECTURE seule : il y voit
--            l'événement, et comme partout seulement ses joueurs et les avis sur eux (filtrés par le joueur depuis 046) ;
--            les autres joueurs de la liste restent comptés sans nom dans l'appli (« + n joueurs hors de ton périmètre »).
--            Joueurs supprimés (ou effacés) : ne comptent pas. Un pôle sans territoire (047) : celui de son parent, comme
--            pour ses joueurs ;
--        (e) il en est le créateur, ou participant (editors, ou membre d'un staff choisi : hb_is_participant, 034).
--      Pour (d), deux autres colonnes sur hb_events : players_dept et players_club (text[]) = l'union des départements
--      et des clubs (scope_dept / scope_club de hb_players, 046) des joueurs NON supprimés de data.playerIds ; '{}' si
--      aucun. Tenues par le même déclencheur hb_scope (à la création, ou quand data.playerIds change), et recalculées
--      quand un joueur change de département ou de club, est supprimé, restauré ou créé (fiche arrivée après
--      l'événement) : les joueurs touchés sont notés pendant la transaction, et les événements qui les contiennent
--      (index GIN sur data -> 'playerIds') recalculés UNE fois, à la fin de la transaction (déclencheur différé). Un
--      joueur inscrit à aucun événement (presque toute fiche importée) n'est pas noté ; au-delà de 500 joueurs notés
--      dans la même transaction, tous les événements sont recalculés en une requête. Seuls les événements dont la valeur change sont réécrits ; ils changent alors d'heure serveur et
--      arrivent chez ceux qui les voient désormais (synchronisation par curseur).
--      Le périmètre du compte vient des fonctions « initplan » de 046 (hb_scope_all / hb_scope_depts / hb_scope_clubs,
--      appelées sous la forme (select …) : une évaluation par requête) ; la règle compare des colonnes (<@ et && sur des
--      tableaux), sans sous-requête par ligne sauf hb_is_participant (seulement si rien d'autre n'a répondu).
--    - Même règle dans l'appli : filtre « Mes territoires » de la liste des événements (src/eventOrganizer.ts,
--      inMyTerritories, avec les joueurs présents sur l'appareil) ; sur la page d'un événement vu seulement grâce à ses
--      joueurs : « Tu vois cet événement parce que N de tes joueurs y sont inscrits ». La synchronisation (src/sync.ts)
--      retire de l'appareil, toutes les 10 minutes et après un changement de périmètre, les événements que le serveur ne
--      montre plus, et relit les événements depuis le début quand le périmètre ou mes staffs changent (ceux devenus
--      visibles n'ont pas changé d'heure serveur). Un joueur de mon périmètre ajouté à un événement : l'événement est
--      réécrit (nouvelle heure serveur), il arrive par le curseur.
--
-- 2) CE QUI NE CHANGE PAS
--    - QUI MODIFIE un événement (hb_upsert, hb_event_manager : créateur, administrateurs, participants pour la liste et les
--      avis hors liste) : rien ne change. Un participant ne peut pas changer l'organisateur (hb_upsert ne lui laisse que la
--      liste et la répartition). Un compte qui voit l'événement par ses joueurs (d) n'en est ni créateur ni participant :
--      aucune modification de l'événement (comme tout compte qui le voyait avant ce script) ; il y donne des avis sur ses
--      joueurs comme avant (règles des avis inchangées).
--    - Lignes rattachées à un événement, déjà filtrées PAR LE JOUEUR depuis 046 et inchangées ici : avis (hb_evaluations,
--      eventId), « vu » (hb_seen), « à revoir » (hb_rewatch) : un observateur participant d'un événement hors de son
--      périmètre voit l'événement (e), et comme avant les avis, « vu » et « à revoir » des seuls joueurs de son périmètre
--      (et ses propres lignes). Aucun accès perdu. Pareil pour celui qui le voit par ses joueurs (d).
--    - Répartition d'un tournoi (data.tournament), feuille de match (data.matchSheet), liste des joueurs : dans la ligne
--      de l'événement, elles suivent sa visibilité. Celui qui le voit par ses joueurs (d) reçoit donc la ligne entière :
--      les identifiants de tous les joueurs de la liste (sans leur fiche : nom, club… restent filtrés par 046), la
--      répartition et la feuille de match s'il y en a une.
--    - Vidéos d'un événement (hb_videos, targetKind = event) : toujours visibles par tout le staff (règle de 046). À
--      trancher plus tard (les lier à la visibilité de l'événement).
--    - Groupes, staffs, listes, structure : inchangés.
--    - Notifications : celles des participants (hb_notify_participant) vont à des comptes qui voient l'événement (e).
--      Un suivi d'événement (hb_follows, kind = event) d'un compte qui ne le voit plus peut encore le notifier (lien vers
--      un événement « introuvable » chez lui) : rare, sans contenu.
--
-- 3) À PASSER : base de test → contrôler (requête de fin) → essayer la lecture d'un compte (bloc commenté « ESSAI ») →
--    base réelle. Rien n'est caché tant qu'aucun événement n'a d'organisateur : le script ne change rien de visible au
--    moment où on le passe.
-- Annulation : section « RETOUR ARRIÈRE » à la fin (commentée).

-- ---------- 1. Colonnes ----------

alter table public.hb_events add column if not exists scope_dept text[], add column if not exists scope_club text[];
create index if not exists hb_events_organizer on public.hb_events ((data ->> 'organizerUnitId'));
-- Départements et clubs des joueurs inscrits (règle (d)).
alter table public.hb_events add column if not exists players_dept text[], add column if not exists players_club text[];
-- Événements qui contiennent un joueur : data -> 'playerIds' ?| array[…] (recalcul quand un joueur change).
create index if not exists hb_events_player_ids on public.hb_events using gin ((data -> 'playerIds'));

-- ---------- 2. Territoire d'une unité ----------

-- { départements, clubs } d'une unité : même calcul que hb_scope_of (046, 047) pour un compte qui n'y serait affecté qu'à
-- elle (sans le niveau Fédération : « tout » ne vient que des comptes). Unité absente ou supprimée : aucune ligne.
create or replace function public.hb_unit_territory(p_unit text)
returns table (depts text[], clubs text[])
language sql stable security definer set search_path = public as $$
  with recursive
  start as (
    select u.id, u.data from public.hb_units u where u.id = p_unit and not u.deleted
  ),
  -- Unité sans territoire (pôle) : on remonte vers le parent le plus proche qui en a un (047).
  up (id, data, depth) as (
    select s.id, s.data, 0 from start s
    union all
    select p.id, p.data, up.depth + 1
      from up
      join public.hb_units p on p.id = up.data ->> 'parentId' and not p.deleted
     where up.depth < 20 and public.hb_unit_empty(up.id)
  ),
  root as (
    select id, data from up order by depth desc limit 1
  ),
  tree (id, data, club_root, path) as (
    select r.id, r.data, coalesce(btrim(r.data ->> 'clubNumber'), '') <> '', array[r.id] from root r
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
    -- Département de chaque club en dessous (unité de club comprise : son département).
    select public.hb_player_dept(jsonb_build_object('clubCode', btrim(t.data ->> 'clubNumber')))
      from tree t
     where coalesce(btrim(t.data ->> 'clubNumber'), '') <> ''
  ),
  c as (
    select distinct btrim(t.data ->> 'clubNumber') as c
      from tree t
     where t.club_root and coalesce(btrim(t.data ->> 'clubNumber'), '') <> ''
  )
  select
    coalesce((select array_agg(distinct d.d order by d.d) from d where coalesce(d.d, '') <> ''), '{}'::text[]),
    coalesce((select array_agg(c.c order by c.c) from c), '{}'::text[])
   where exists (select 1 from start)
$$;

-- { départements, clubs } des joueurs d'une liste (data.playerIds d'un événement) : colonnes scope_dept / scope_club de
-- hb_players (046), joueurs supprimés exclus (une fiche effacée l'est aussi), identifiants inconnus ignorés. Toujours une
-- ligne ; '{}' quand aucun joueur ne compte.
create or replace function public.hb_event_players_scope(p_ids jsonb)
returns table (depts text[], clubs text[])
language sql stable security definer set search_path = public as $$
  select
    coalesce(array_agg(distinct pl.scope_dept order by pl.scope_dept) filter (where coalesce(pl.scope_dept, '') <> ''), '{}'::text[]),
    coalesce(array_agg(distinct pl.scope_club order by pl.scope_club) filter (where coalesce(pl.scope_club, '') <> ''), '{}'::text[])
    from public.hb_players pl
   where pl.id in (select jsonb_array_elements_text(public.hb_arr(p_ids))) and not pl.deleted
$$;

-- ---------- 3. Colonnes tenues à jour ----------

-- Avant écriture d'un événement :
--  - territoire de son organisateur, seulement à la création ou quand l'organisateur change ;
--  - départements et clubs de ses joueurs, seulement à la création ou quand data.playerIds change.
-- Une écriture qui ne touche ni à l'un ni à l'autre garde les colonnes (y compris celles posées par les recalculs en
-- cascade, qui les écrivent directement). Aucun contrôle d'écriture : les droits de modification restent ceux de hb_upsert.
create or replace function public.hb_event_scope_row() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_unit text := nullif(btrim(coalesce(new.data ->> 'organizerUnitId', '')), '');
begin
  if tg_op = 'INSERT' or v_unit is distinct from nullif(btrim(coalesce(old.data ->> 'organizerUnitId', '')), '') then
    new.scope_dept := null;
    new.scope_club := null;
    if v_unit is not null then
      select t.depts, t.clubs into new.scope_dept, new.scope_club from public.hb_unit_territory(v_unit) t;
    end if;
  end if;
  if tg_op = 'INSERT' or new.data -> 'playerIds' is distinct from old.data -> 'playerIds' then
    select s.depts, s.clubs into new.players_dept, new.players_club from public.hb_event_players_scope(new.data -> 'playerIds') s;
  end if;
  return new;
end $$;

-- Recalcul de tous les événements qui ont un organisateur (un calcul par unité organisatrice, pas par événement) ;
-- seulement ceux dont le territoire a changé sont réécrits. Appelé par le déclencheur différé ci-dessous et par le
-- remplissage initial.
create or replace function public.hb_events_rescope() returns integer
language plpgsql security definer set search_path = public as $$
declare v_n integer;
begin
  with o as (
    select distinct nullif(btrim(data ->> 'organizerUnitId'), '') as uid
      from public.hb_events
     where coalesce(btrim(data ->> 'organizerUnitId'), '') <> ''
  ),
  t as (
    select o.uid, x.depts, x.clubs from o left join lateral public.hb_unit_territory(o.uid) x on true
  )
  update public.hb_events e
     set scope_dept = t.depts, scope_club = t.clubs
    from t
   where nullif(btrim(e.data ->> 'organizerUnitId'), '') = t.uid
     and (e.scope_dept is distinct from t.depts or e.scope_club is distinct from t.clubs);
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- Structure changée : recalcul UNE fois, à la fin de la transaction (déclencheur de contrainte différé ; les suivants de la
-- même transaction ne refont rien). Rien à faire si aucun événement n'a d'organisateur.
create or replace function public.hb_events_rescope_deferred() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if current_setting('hb.events_rescoped', true) = txid_current()::text then return null; end if;
  perform set_config('hb.events_rescoped', txid_current()::text, true);
  if exists (select 1 from public.hb_events where coalesce(btrim(data ->> 'organizerUnitId'), '') <> '') then
    perform public.hb_events_rescope();
  end if;
  return null;
end $$;

-- Recalcul de players_dept / players_club : des événements qui contiennent l'un des joueurs p_ids (index GIN), ou de TOUS
-- les événements (p_ids null). Seulement ceux dont la valeur change sont réécrits (nouvelle heure serveur : ils arrivent
-- chez ceux qui les voient désormais ; hb_stamp et hb_log ne notent rien, data ne change pas).
create or replace function public.hb_events_players_rescope(p_ids text[]) returns integer
language plpgsql security definer set search_path = public as $$
declare v_n integer;
begin
  if p_ids is null then
    update public.hb_events e
       set players_dept = x.depts, players_club = x.clubs
      from (select ev.id, s.depts, s.clubs
              from public.hb_events ev cross join lateral public.hb_event_players_scope(ev.data -> 'playerIds') s) x
     where e.id = x.id
       and (e.players_dept is distinct from x.depts or e.players_club is distinct from x.clubs);
  else
    if cardinality(p_ids) = 0 then return 0; end if;
    update public.hb_events e
       set players_dept = x.depts, players_club = x.clubs
      from (select ev.id, s.depts, s.clubs
              from public.hb_events ev cross join lateral public.hb_event_players_scope(ev.data -> 'playerIds') s
             where (ev.data -> 'playerIds') ?| p_ids) x
     where e.id = x.id
       and (e.players_dept is distinct from x.depts or e.players_club is distinct from x.clubs);
  end if;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- Un joueur créé, supprimé / restauré, ou qui change de département ou de club : noté pour la fin de la transaction
-- (réglage local « hb.events_players » : liste JSON des identifiants ; au-delà de 500, « * » = tout recalculer). Rien
-- n'est recalculé ici : un import de milliers de joueurs (une transaction par envoi) ne fait qu'un recalcul, à la fin.
create or replace function public.hb_events_players_mark() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v text := coalesce(current_setting('hb.events_players', true), '');
  v_ids jsonb;
begin
  if v = '*' then return null; end if;
  v_ids := case when v = '' then '[]'::jsonb else v::jsonb end;
  if v_ids ? new.id then return null; end if;
  -- Joueur inscrit à aucun événement (le cas de presque toute fiche importée) : rien à noter (index GIN). Un événement
  -- écrit plus tard dans la même transaction calcule ses colonnes lui-même (hb_event_scope_row).
  if not exists (select 1 from public.hb_events where (data -> 'playerIds') ? new.id) then return null; end if;
  if jsonb_array_length(v_ids) >= 500 then
    perform set_config('hb.events_players', '*', true);
  else
    perform set_config('hb.events_players', (v_ids || to_jsonb(new.id))::text, true);
  end if;
  return null;
end $$;

-- Fin de transaction (déclencheur de contrainte différé) : le premier appel recalcule les événements des joueurs notés et
-- vide la liste ; les suivants (une ligne de déclencheur par joueur touché) la trouvent vide et ne font rien.
create or replace function public.hb_events_players_deferred() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v text := coalesce(current_setting('hb.events_players', true), '');
begin
  if v = '' then return null; end if;
  perform set_config('hb.events_players', '', true);
  if v = '*' then
    perform public.hb_events_players_rescope(null);
  else
    perform public.hb_events_players_rescope(array(select jsonb_array_elements_text(v::jsonb)));
  end if;
  return null;
end $$;

revoke all on function public.hb_unit_territory(text) from public, anon, authenticated;
revoke all on function public.hb_event_players_scope(jsonb) from public, anon, authenticated;
revoke all on function public.hb_events_players_rescope(text[]) from public, anon, authenticated;
revoke all on function public.hb_events_players_mark() from public, anon, authenticated;
revoke all on function public.hb_events_players_deferred() from public, anon, authenticated;
revoke all on function public.hb_event_scope_row() from public, anon, authenticated;
revoke all on function public.hb_events_rescope() from public, anon, authenticated;
revoke all on function public.hb_events_rescope_deferred() from public, anon, authenticated;

-- ---------- 4. Remplissage (une fois ; relancé : seulement ce qui diffère) ----------
-- Déclencheurs de hb_events suspendus le temps du remplissage (dans ce seul bloc : une erreur annule tout) : l'heure serveur
-- ne bouge pas (pas de retéléchargement), rien n'est signé ni journalisé. Les appareils ont déjà tous les événements ;
-- ceux qui n'en voient plus certains les retirent eux-mêmes (src/sync.ts, forgetHidden).

do $$
begin
  alter table public.hb_events disable trigger user;
  -- Organisateur retiré ou absent : colonnes vidées.
  update public.hb_events set scope_dept = null, scope_club = null
   where coalesce(btrim(data ->> 'organizerUnitId'), '') = '' and (scope_dept is not null or scope_club is not null);
  perform public.hb_events_rescope();
  -- Départements et clubs des joueurs inscrits (tous les événements ; relancé : seulement ce qui diffère).
  perform public.hb_events_players_rescope(null);
  alter table public.hb_events enable trigger user;
end $$;

-- ---------- 5. Déclencheurs ----------
-- « hb_scope » passe AVANT hb_stamp et hb_touch (ordre alphabétique des déclencheurs d'un même moment), comme en 046.

drop trigger if exists hb_scope on public.hb_events;
create trigger hb_scope before insert or update on public.hb_events
  for each row execute function public.hb_event_scope_row();

-- Unités : ce qui change un territoire (parent, départements, n° de club, suppression) ; nouvelle unité ; effacement.
drop trigger if exists hb_events_rescope_ins on public.hb_units;
create constraint trigger hb_events_rescope_ins after insert or delete on public.hb_units
  deferrable initially deferred
  for each row execute function public.hb_events_rescope_deferred();
drop trigger if exists hb_events_rescope_upd on public.hb_units;
create constraint trigger hb_events_rescope_upd after update on public.hb_units
  deferrable initially deferred
  for each row
  when (old.deleted is distinct from new.deleted
        or old.data -> 'parentId' is distinct from new.data -> 'parentId'
        or old.data -> 'departments' is distinct from new.data -> 'departments'
        or old.data -> 'clubNumber' is distinct from new.data -> 'clubNumber')
  execute function public.hb_events_rescope_deferred();

-- Joueurs : ce qui change la règle (d) (département, club, suppression ou restauration ; fiche créée). Noté tout de suite
-- (hb_events_players_mark_*), recalculé une fois à la fin de la transaction (hb_events_players_ins / _upd).
-- (hb_scope de hb_players, AVANT écriture, a déjà posé scope_dept / scope_club : ces déclencheurs, APRÈS, les lisent.)
drop trigger if exists hb_events_players_mark_ins on public.hb_players;
create trigger hb_events_players_mark_ins after insert on public.hb_players
  for each row execute function public.hb_events_players_mark();
drop trigger if exists hb_events_players_mark_upd on public.hb_players;
create trigger hb_events_players_mark_upd after update on public.hb_players
  for each row
  when (old.deleted is distinct from new.deleted
        or old.scope_dept is distinct from new.scope_dept
        or old.scope_club is distinct from new.scope_club)
  execute function public.hb_events_players_mark();
drop trigger if exists hb_events_players_ins on public.hb_players;
create constraint trigger hb_events_players_ins after insert on public.hb_players
  deferrable initially deferred
  for each row execute function public.hb_events_players_deferred();
drop trigger if exists hb_events_players_upd on public.hb_players;
create constraint trigger hb_events_players_upd after update on public.hb_players
  deferrable initially deferred
  for each row
  when (old.deleted is distinct from new.deleted
        or old.scope_dept is distinct from new.scope_dept
        or old.scope_club is distinct from new.scope_club)
  execute function public.hb_events_players_deferred();

-- ---------- 6. Règle de lecture ----------

drop policy if exists "staff_read" on public.hb_events;
create policy "staff_read" on public.hb_events for select to authenticated using (
  (select public.hb_has_role())
  and ((select public.hb_scope_all())
       or scope_dept is null
       or (cardinality(scope_dept) > 0 and scope_dept <@ (select public.hb_scope_depts())::text[])
       or (cardinality(scope_club) > 0 and scope_club <@ (select public.hb_scope_clubs())::text[])
       or players_dept && (select public.hb_scope_depts())::text[]
       or players_club && (select public.hb_scope_clubs())::text[]
       or data ->> 'createdBy' = (select auth.uid())::text
       or public.hb_is_participant(data)));

-- Ceinture : toujours aucune écriture directe (040) ; lecture par la règle ci-dessus.
revoke insert, update, delete, truncate, references, trigger on public.hb_events from public, anon, authenticated;
grant select on public.hb_events to authenticated;

-- ---------- Vérification (lecture seule) ----------
-- Événements avec organisateur, territoire calculé, organisateur inconnu (unité supprimée : visible par tous) ; joueurs
-- inscrits : événements avec au moins un joueur compté, colonnes non calculées (attendu 0), écarts entre les colonnes et
-- un nouveau calcul (attendu 0) ; déclencheurs (7) et règle posés.
select (select count(*) from public.hb_events where not deleted) as evenements,
       (select count(*) from public.hb_events where not deleted and coalesce(data ->> 'organizerUnitId', '') <> '') as avec_organisateur,
       (select count(*) from public.hb_events where not deleted and scope_dept is not null) as avec_territoire,
       (select count(*) from public.hb_events where not deleted and coalesce(data ->> 'organizerUnitId', '') <> '' and scope_dept is null) as organisateur_inconnu,
       (select count(*) from public.hb_events where not deleted and cardinality(scope_dept) = 0 and cardinality(scope_club) = 0) as territoire_vide,
       (select count(*) from public.hb_events where not deleted and (cardinality(players_dept) > 0 or cardinality(players_club) > 0)) as avec_joueurs_comptes,
       (select count(*) from public.hb_events where players_dept is null or players_club is null) as joueurs_non_calcules_0,
       (select count(*) from public.hb_events e cross join lateral public.hb_event_players_scope(e.data -> 'playerIds') s
         where e.players_dept is distinct from s.depts or e.players_club is distinct from s.clubs) as ecarts_joueurs_0,
       (select count(*) from pg_trigger where tgname in ('hb_scope', 'hb_events_rescope_ins', 'hb_events_rescope_upd',
                                                         'hb_events_players_mark_ins', 'hb_events_players_mark_upd',
                                                         'hb_events_players_ins', 'hb_events_players_upd')
                                         and tgrelid in ('public.hb_events'::regclass, 'public.hb_units'::regclass,
                                                         'public.hb_players'::regclass)) as declencheurs_7,
       (select qual from pg_policies where tablename = 'hb_events' and policyname = 'staff_read') as regle_lecture;

-- Organisateurs et leur territoire (à lire, pas à diffuser) :
-- select u.data ->> 'name' as unite, e.scope_dept, e.scope_club, count(*) as evenements
--   from public.hb_events e left join public.hb_units u on u.id = e.data ->> 'organizerUnitId'
--  where not e.deleted and coalesce(e.data ->> 'organizerUnitId', '') <> '' group by 1, 2, 3 order by 1;
-- Départements et clubs des joueurs inscrits, par événement (à lire, pas à diffuser) :
-- select data ->> 'name' as nom, jsonb_array_length(public.hb_arr(data -> 'playerIds')) as joueurs, players_dept, players_club
--   from public.hb_events where not deleted order by server_updated_at desc limit 50;
--
-- ---------- ESSAI : ce que voit un compte (remplacer <uuid> par son identifiant ; TOUT est annulé à la fin) ----------
-- À lancer d'un bloc dans le SQL Editor, base de test. Rien n'est écrit (rollback). Pour essayer sans rien garder, on peut
-- aussi, dans le même bloc AVANT « set local role » :
--   - poser un organisateur sur un événement :
--     update public.hb_events set data = data || jsonb_build_object('organizerUnitId', '<id d''unité>') where id = '<id>';
--   - inscrire un joueur à un événement (le club de ce joueur voit alors l'événement) :
--     update public.hb_events set data = jsonb_set(data, '{playerIds}', public.hb_arr(data -> 'playerIds') || to_jsonb('<id joueur>'::text))
--      where id = '<id>';
--   - faire muter un joueur (ses événements suivent, à la fin de la transaction : « set constraints all immediate; » pour
--     voir le recalcul tout de suite dans le bloc) :
--     update public.hb_players set data = data || jsonb_build_object('clubCode', '<n° de club>') where id = '<id joueur>';
--     set constraints all immediate;
-- begin;
--   select set_config('request.jwt.claims', json_build_object('sub', '<uuid>', 'role', 'authenticated')::text, true);
--   set local role authenticated;
--   select public.hb_my_perimeter();
--   select count(*) as evenements_vus, count(*) filter (where scope_dept is null) as sans_organisateur,
--          count(*) filter (where scope_dept is not null
--                             and (players_dept && public.hb_scope_depts() or players_club && public.hb_scope_clubs())) as par_mes_joueurs
--     from public.hb_events;
--   select data ->> 'name' as nom, scope_dept, scope_club, players_dept, players_club from public.hb_events where scope_dept is not null limit 50;
--   explain analyze select id, data, server_updated_at from public.hb_events
--     where server_updated_at >= '1970-01-01' order by server_updated_at, id limit 1000;
-- rollback;

-- ---------- RETOUR ARRIÈRE (à lancer seulement pour annuler ce script ; tout le staff revoit tous les événements) ----------
-- drop policy if exists "staff_read" on public.hb_events;
-- create policy "staff_read" on public.hb_events for select to authenticated using ((select public.hb_has_role()));
-- drop trigger if exists hb_scope on public.hb_events;
-- drop trigger if exists hb_events_rescope_ins on public.hb_units;
-- drop trigger if exists hb_events_rescope_upd on public.hb_units;
-- drop trigger if exists hb_events_players_mark_ins on public.hb_players;
-- drop trigger if exists hb_events_players_mark_upd on public.hb_players;
-- drop trigger if exists hb_events_players_ins on public.hb_players;
-- drop trigger if exists hb_events_players_upd on public.hb_players;
-- (Colonnes, index et fonctions : peuvent rester, sans effet. Pour les retirer aussi :
--  alter table public.hb_events drop column if exists scope_dept, drop column if exists scope_club,
--    drop column if exists players_dept, drop column if exists players_club;
--  drop index if exists public.hb_events_player_ids;)
-- Les événements redevenus visibles n'ont pas changé d'heure serveur : pour que les appareils les reçoivent, l'appli doit
-- relire les événements depuis le début (« Synchroniser maintenant » ne suffit pas) ; le plus simple : toucher leur heure
-- serveur, sans rien changer d'autre (hb_stamp et hb_log ne notent rien quand data ne change pas) :
-- update public.hb_events set data = data where scope_dept is not null;
