-- HandBase : synchronisation allégée (une requête « quoi de neuf ? », diffusion en direct par périmètre, annonce des versions).
-- À exécuter une fois dans Supabase > SQL Editor, APRÈS 056_rencontres.sql (base de test d'abord, puis la réelle).
-- Peut être relancé sans risque (create or replace, drop … if exists).
--
-- POURQUOI (essai de charge du 27/10, données fictives, serveur 16 cœurs) : chaque appareil connecté relisait les 19 tables
-- toutes les minutes (19 requêtes, même quand rien n'a changé : ~317 requêtes par seconde pour 1 000 appareils), et chaque
-- changement reçu en direct (postgres_changes) relançait cette relecture complète chez tous ceux qui voient la ligne.
-- Realtime vérifiait de plus les règles de lecture pour chaque abonné à chaque changement (une seule file) : à 1 000
-- appareils qui écrivent, 7 à 21 s de retard et la plupart des changements perdus ; PostgREST saturé vers 2 000 à 3 000
-- appareils. Objectif : 20 000 appareils sur le même serveur, prévenus en direct.
--
-- 1) hb_quoi_de_neuf(curseurs) : UNE requête dit, pour chaque table, s'il y a quelque chose à recevoir depuis le curseur de
--    l'appareil (SECURITY INVOKER : les règles de lecture s'appliquent, on ne regarde que ce que le compte verrait). Même
--    prudence que la lecture par curseur de l'appli (src/sync.ts, pullTable) : server_updated_at est l'heure d'écriture, une
--    ligne validée un peu plus tard peut porter une heure antérieure au curseur. Curseur récent (moins de 5 minutes) : on
--    regarde depuis curseur − 60 s (donc « oui » dans les 5 minutes qui suivent une réception : l'appli relit une minute,
--    sans effet ; c'est le prix de la sûreté) ; curseur plus ancien : strictement après le curseur. Table inconnue du
--    serveur (script pas encore passé) : null ; clé sans curseur : true ; clé inconnue : ignorée.
--    Rien de changé : une synchronisation = cette seule requête. L'appli relit ensuite les seules tables à true.
-- 2) DIFFUSION EN DIRECT par canaux privés (realtime.send, Realtime ≥ 2.33) au lieu de postgres_changes : un déclencheur
--    APRÈS écriture envoie un SIGNAL ({t: table, id, v: heure serveur} : ni nom ni contenu) sur les canaux de ceux qui
--    peuvent lire la ligne, calculés depuis la ligne elle-même (mêmes règles que les règles de lecture, hb_canaux_ligne) :
--      hb:dept:<département>, hb:club:<n° de club>  joueurs et lignes rattachées (colonnes scope_dept / scope_club de 046),
--                                                   événements (territoire et joueurs inscrits, 048)
--      hb:tout                                      comptes qui voient tout (administrateurs, niveau Fédération) ; journal des
--                                                   questions
--      hb:compte:<identifiant du compte>            ses propres lignes (fiches créées hors périmètre, suivis, questions
--                                                   enregistrées, staffs : créateur et membres, groupes et alertes privés,
--                                                   participants d'un groupe d'équipe ou d'un événement)
--      hb:joueur:<identifiant de fiche>             la fiche d'un jeune qui a un compte (espace joueur, 051)
--      hb:staff                                     ce que tout le staff lit : critères, niveaux, unités, affectations, groupes
--                                                   et alertes partagés, événements sans organisateur, vidéos d'un événement
--      hb:commun                                    tous les comptes, joueurs compris : configuration, listes, annonces de version
--    Les noms des canaux ne portent aucune donnée personnelle (codes, n° de club, identifiants techniques). Realtime vérifie
--    le droit d'écoute UNE fois, à l'abonnement (règle hb_recevoir sur realtime.messages : seulement les canaux rendus par
--    hb_mes_canaux()), puis diffuse sans relire les règles. Aucun compte ne peut envoyer sur ces canaux (pas de règle
--    d'insertion). Un seul signal par table et par canal dans une transaction (un envoi de 400 lignes = quelques messages).
--    Configuration, critères, niveaux (rien de personnel, lus par tout le staff) : la ligne entière part (événement
--    « ligne »), pour que des milliers d'appareils n'aient pas à la relire en même temps ; l'appli l'applique comme une
--    ligne reçue (jamais par-dessus une version plus récente) sans avancer son curseur : la relecture reste la référence.
--    Un envoi qui échoue n'empêche JAMAIS l'écriture (bloc protégé) ; sans realtime.send (Postgres nu, pile ancienne) :
--    rien n'est diffusé, l'appli relit par le filet de sécurité (5 minutes quand le direct est abonné, 1 minute sinon).
-- 3) hb_mes_canaux() : les canaux du compte connecté (même règle que hb_scope_of : tout, ou ses départements et ses clubs ;
--    compte joueur : sa fiche). L'appli les lit à la connexion et quand son périmètre change, puis s'abonne (canaux
--    privés, jeton de session). Sans la fonction (ce script pas passé), elle garde postgres_changes.
-- 4) hb_annoncer_version(v) : annonce une nouvelle version de l'appli sur hb:commun (événement « version ») ; chaque appareil
--    vérifie la mise à jour dans les 30 secondes qui suivent (le bandeau « Nouvelle version » apparaît), au lieu de toutes
--    les 5 minutes. Administrateur connecté, ou SQL direct (SQL Editor, connecteur).
--    PUBLICATION : après la mise en ligne de l'appli, passer dans le SQL Editor (ou par le connecteur, execute_sql) :
--      select public.hb_annoncer_version('2026-10-28T12:00:00.000Z');   -- l'heure de construction affichée dans Réglages
--    (n'importe quel texte non vide convient ; un appareil qui a déjà cette version n'en tient pas compte).
-- 5) postgres_changes : la publication supabase_realtime n'est pas touchée : les appareils encore sur l'ancienne version
--    (ou une base sans ce script) continuent de l'utiliser. Une fois tout le monde à jour, les tables pourront en être
--    retirées (voir RETOUR ARRIÈRE, dernière ligne).
-- Dépend de : 046/047 (colonnes scope_*, hb_scope_of), 048 (territoire des événements), 051 (comptes joueur), 034
-- (hb_participants, hb_arr). Realtime ≥ 2.33 : realtime.send et canaux privés (realtime.messages, realtime.topic()).
-- La règle sur realtime.messages demande d'être propriétaire de la table : si le script affiche l'avertissement « Règle
-- hb_recevoir non posée », repasser le seul bloc « 5. Droit d'écoute » en super-utilisateur (supabase_admin).
-- Appli : src/sync.ts, src/syncLive.ts (règles pures, testées par tools/test-synchro-legere.ts), src/pwa.ts.
-- Annulation : section « RETOUR ARRIÈRE » à la fin (commentée).

-- ---------- 1. « Quoi de neuf ? » : une requête au lieu de 19 ----------

-- curseurs : { players: '2026-10-28T10:00:00.123456+00:00', criteria: …, … } (src/sync.ts, PULL_KEY). Renvoie, pour chaque
-- table synchronisée (src/db.ts, SYNC_TABLES) citée : true (à relire), false (rien de nouveau pour ce compte), null (table
-- inconnue du serveur). SECURITY INVOKER : chaque « exists » passe par les règles de lecture du compte, et le périmètre n'est
-- calculé qu'une fois (hb_my_scope, gardé pour la transaction) ; l'index sur server_updated_at arrête chaque lecture à la
-- première ligne.
create or replace function public.hb_quoi_de_neuf(curseurs jsonb) returns jsonb
language plpgsql stable security invoker set search_path = public as $$
declare
  v_tables text[] := array['players', 'criteria', 'measurements', 'teams', 'events', 'evaluations', 'groups', 'lists', 'alerts',
                           'follows', 'videos', 'seen', 'rewatch', 'config', 'levels', 'units', 'assignments', 'question_log',
                           'saved_questions'];
  t text;
  v_cur timestamptz;
  v_new boolean;
  v_out jsonb := '{}'::jsonb;
begin
  if auth.uid() is null then raise exception 'Connexion requise'; end if;
  if jsonb_typeof(curseurs) is distinct from 'object' then raise exception 'curseurs : objet { table: heure } attendu'; end if;
  for t in select jsonb_object_keys(curseurs) loop
    if not (t = any (v_tables)) then continue; end if;
    if to_regclass('public.hb_' || t) is null then
      v_out := v_out || jsonb_build_object(t, null);
      continue;
    end if;
    begin
      v_cur := nullif(curseurs ->> t, '')::timestamptz;
    exception when others then
      v_cur := null; -- curseur illisible : tout relire
    end;
    if v_cur is null then
      v_new := true;
    elsif clock_timestamp() - v_cur < interval '5 minutes' then
      -- Curseur récent : une ligne validée en retard peut porter une heure antérieure (recouvrement de 60 s, comme l'appli).
      execute format('select exists (select 1 from public.hb_%I where server_updated_at >= $1)', t)
        into v_new using v_cur - interval '60 seconds';
    else
      execute format('select exists (select 1 from public.hb_%I where server_updated_at > $1)', t) into v_new using v_cur;
    end if;
    v_out := v_out || jsonb_build_object(t, v_new);
  end loop;
  return v_out;
end $$;
revoke all on function public.hb_quoi_de_neuf(jsonb) from public, anon;
grant execute on function public.hb_quoi_de_neuf(jsonb) to authenticated;

-- ---------- 2. Canaux d'une ligne (mêmes règles que les règles de lecture) ----------

-- p_table : nom complet (hb_players…) ; p_row : la ligne entière en jsonb (to_jsonb(new) : id, data, deleted, scope_dept,
-- scope_club, players_dept, players_club quand la table les a). Un canal null (pas de département, pas d'auteur…) est retiré.
-- Trop prévenir est sans danger (l'appareil relit par sa règle de lecture et ne reçoit rien) ; trop peu ne doit pas arriver.
create or replace function public.hb_canaux_ligne(p_table text, p_row jsonb) returns text[]
language plpgsql stable security definer set search_path = public as $$
declare
  d jsonb := coalesce(p_row -> 'data', '{}'::jsonb);
  v_auteur text := 'hb:compte:' || nullif(d ->> 'createdBy', '');
  v_prive boolean := coalesce((d ->> 'private')::boolean, false);
  v_perimetre text[] := array['hb:tout', 'hb:dept:' || nullif(p_row ->> 'scope_dept', ''), 'hb:club:' || nullif(p_row ->> 'scope_club', ''), v_auteur];
  v_out text[];
begin
  case p_table
    -- Joueurs et lignes rattachées (046) : tout, département, club, auteur ; fiche d'un jeune qui a un compte (051) : lui aussi.
    when 'hb_players' then
      v_out := v_perimetre;
      if exists (select 1 from public.hb_profiles where role = 'joueur' and player_id = p_row ->> 'id') then
        v_out := v_out || ('hb:joueur:' || (p_row ->> 'id'));
      end if;
    when 'hb_measurements', 'hb_evaluations', 'hb_seen', 'hb_rewatch' then
      v_out := v_perimetre;
    -- Vidéo d'un joueur : son périmètre ; vidéo d'un événement : tout le staff (046).
    when 'hb_videos' then
      v_out := case when d ->> 'targetKind' = 'player' then v_perimetre else array['hb:staff'] end;
    -- Suivis (032) et questions enregistrées (054) : leur auteur seul.
    when 'hb_follows', 'hb_saved_questions' then
      v_out := array[v_auteur];
    -- Staffs (034) : créateur et membres.
    when 'hb_teams' then
      v_out := array[v_auteur] || array(select 'hb:compte:' || m from jsonb_array_elements_text(public.hb_arr(d -> 'members')) m);
    -- Groupes (031/034) : privé → son auteur ; d'équipe → auteur et participants (choisis un par un ou par un staff) ; sinon tout le staff.
    when 'hb_groups' then
      v_out := case
        when v_prive then array[v_auteur]
        when coalesce((d ->> 'team')::boolean, false) then array[v_auteur] || array(select 'hb:compte:' || u from public.hb_participants(d) u)
        else array['hb:staff', v_auteur] end;
    -- Alertes (022/029) : privée → son auteur ; partagée → tout le staff.
    when 'hb_alerts' then
      v_out := case when v_prive then array[v_auteur] else array['hb:staff'] end;
    -- Événements (048) : sans organisateur (ou avant 048) : tout le staff ; sinon tout, les départements et clubs de l'organisateur
    -- et des joueurs inscrits, l'auteur, les participants.
    when 'hb_events' then
      if jsonb_typeof(p_row -> 'scope_dept') is distinct from 'array' then
        v_out := array['hb:staff'];
      else
        v_out := array['hb:tout', v_auteur]
          || array(select distinct 'hb:dept:' || x from (select jsonb_array_elements_text(public.hb_arr(p_row -> 'scope_dept')) as x
                                                           union select jsonb_array_elements_text(public.hb_arr(p_row -> 'players_dept'))) s
                    where coalesce(x, '') <> '')
          || array(select distinct 'hb:club:' || x from (select jsonb_array_elements_text(public.hb_arr(p_row -> 'scope_club')) as x
                                                           union select jsonb_array_elements_text(public.hb_arr(p_row -> 'players_club'))) s
                    where coalesce(x, '') <> '')
          || array(select 'hb:compte:' || u from public.hb_participants(d) u);
      end if;
    -- Critères et structure (044, 051 : pas pour un joueur) : tout le staff.
    when 'hb_criteria', 'hb_levels', 'hb_units', 'hb_assignments' then
      v_out := array['hb:staff'];
    -- Configuration et listes : tous les comptes, joueurs compris.
    when 'hb_config', 'hb_lists' then
      v_out := array['hb:commun'];
    -- Journal des questions (043) : administrateurs.
    when 'hb_question_log' then
      v_out := array['hb:tout'];
    else
      v_out := '{}'::text[];
  end case;
  return array(select distinct x from unnest(v_out) x where x is not null order by x);
end $$;
revoke all on function public.hb_canaux_ligne(text, jsonb) from public, anon, authenticated;

-- ---------- 3. Mes canaux ----------

-- Les canaux que le compte connecté a le droit d'écouter (même règle que hb_scope_of, 046/047) : tout compte, le canal
-- commun et le sien ; compte joueur : sa fiche ; compte du staff (avec un rôle) : le canal du staff, puis « tout » ou ses
-- départements et ses clubs. Sans rôle : rien d'autre (il ne lit rien non plus).
create or replace function public.hb_mes_canaux() returns text[]
language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_role text;
  v_pid text;
  v_out text[];
  s record;
begin
  if v_uid is null then return '{}'::text[]; end if;
  select role, player_id into v_role, v_pid from public.hb_profiles where user_id = v_uid;
  v_out := array['hb:commun', 'hb:compte:' || v_uid::text];
  if v_role = 'joueur' then
    if coalesce(v_pid, '') <> '' then v_out := v_out || ('hb:joueur:' || v_pid); end if;
  elsif v_role in ('admin', 'preparateur', 'observateur') then
    v_out := v_out || 'hb:staff';
    select * into s from public.hb_scope_of(v_uid);
    if s.all_ then
      v_out := v_out || 'hb:tout';
    else
      v_out := v_out || array(select 'hb:dept:' || x from unnest(s.depts) x where coalesce(x, '') <> '')
                     || array(select 'hb:club:' || x from unnest(s.clubs) x where coalesce(x, '') <> '');
    end if;
  end if;
  return v_out;
end $$;
revoke all on function public.hb_mes_canaux() from public, anon;
grant execute on function public.hb_mes_canaux() to authenticated;

-- ---------- 4. Diffusion après écriture ----------

-- Déclencheur APRÈS insertion ou modification, ligne par ligne. Un seul signal par table et par canal dans la transaction
-- (clés déjà envoyées gardées dans le réglage local hb.diffuse) : id et v sont ceux de la première ligne ; l'appli ne s'en
-- sert que pour relire la table. Configuration, critères, niveaux : la ligne entière, à chaque fois (événement « ligne »).
-- Tout est dans un bloc protégé : une diffusion impossible n'annule jamais l'écriture (avertissement dans le journal du
-- serveur). Sans realtime.send : rien.
create or replace function public.hb_diffuser() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_table text := substr(tg_table_name, 4); -- hb_players -> players
  v_contenu boolean := tg_table_name in ('hb_config', 'hb_criteria', 'hb_levels');
  v_canaux text[];
  v_canal text;
  v_charge jsonb;
  v_faits text;
  v_cle text;
begin
  if to_regprocedure('realtime.send(jsonb, text, text, boolean)') is null then return null; end if;
  begin
    v_canaux := public.hb_canaux_ligne(tg_table_name, to_jsonb(new));
    v_charge := jsonb_build_object('t', v_table, 'id', new.id, 'v', new.server_updated_at);
    if v_contenu then
      v_charge := v_charge || jsonb_build_object('ligne', jsonb_build_object(
        'id', new.id, 'data', new.data, 'deleted', new.deleted, 'server_updated_at', new.server_updated_at));
    end if;
    v_faits := coalesce(current_setting('hb.diffuse', true), '');
    foreach v_canal in array v_canaux loop
      if not v_contenu then
        v_cle := '[' || tg_table_name || '>' || v_canal || ']';
        if position(v_cle in v_faits) > 0 then continue; end if;
        v_faits := v_faits || v_cle;
      end if;
      perform realtime.send(v_charge, case when v_contenu then 'ligne' else 'signal' end, v_canal, true);
    end loop;
    perform set_config('hb.diffuse', v_faits, true);
  exception when others then
    raise warning 'Diffusion en direct impossible (%, %) : %', tg_table_name, new.id, sqlerrm;
  end;
  return null;
end $$;
revoke all on function public.hb_diffuser() from public, anon, authenticated;

do $$
declare t text;
begin
  foreach t in array array['players', 'criteria', 'measurements', 'teams', 'events', 'evaluations', 'groups', 'lists', 'alerts',
                           'follows', 'videos', 'seen', 'rewatch', 'config', 'levels', 'units', 'assignments', 'question_log',
                           'saved_questions'] loop
    if to_regclass('public.hb_' || t) is null then continue; end if;
    execute format('drop trigger if exists hb_diffuser on public.hb_%1$s;
      create trigger hb_diffuser after insert or update on public.hb_%1$s for each row execute function public.hb_diffuser();', t);
  end loop;
end $$;

-- ---------- 5. Droit d'écoute : canaux privés ----------

-- Realtime vérifie à l'abonnement, avec le jeton du compte, qu'une ligne de realtime.messages portant le canal demandé
-- serait lisible : seulement les canaux de hb_mes_canaux(). Aucune règle d'insertion : personne n'envoie depuis l'appli.
do $$
begin
  if to_regclass('realtime.messages') is null or to_regprocedure('realtime.topic()') is null then
    raise notice 'realtime.messages ou realtime.topic() absent : pas de canaux privés sur cette base (Postgres nu, ou Realtime trop ancien).';
    return;
  end if;
  begin
    execute 'drop policy if exists "hb_recevoir" on realtime.messages';
    -- (select …)::text[] : la liste est calculée une fois par requête, comme les règles de 046.
    execute $p$create policy "hb_recevoir" on realtime.messages for select to authenticated
      using (realtime.messages.extension = 'broadcast' and realtime.topic() = any ((select public.hb_mes_canaux())::text[]))$p$;
  exception when others then
    raise warning 'Règle hb_recevoir non posée sur realtime.messages (%) : repasser ce bloc en super-utilisateur.', sqlerrm;
  end;
end $$;

-- ---------- 6. Annonce d'une nouvelle version de l'appli ----------

-- Administrateur connecté, ou SQL direct (auth.uid() null : SQL Editor, connecteur ; comme hb_actor). Envoie {v} sur
-- hb:commun (événement « version ») : chaque appareil vérifie la mise à jour dans les 30 s. Sans realtime.send : avis, et rien.
create or replace function public.hb_annoncer_version(v text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is not null and (select role from public.hb_profiles where user_id = v_uid) is distinct from 'admin' then
    raise exception 'Réservé aux administrateurs';
  end if;
  if coalesce(btrim(v), '') = '' then raise exception 'Version attendue (texte non vide)'; end if;
  if to_regprocedure('realtime.send(jsonb, text, text, boolean)') is null then
    raise notice 'realtime.send absent : pas d''annonce (les appareils vérifieront la mise à jour d''eux-mêmes).';
    return;
  end if;
  perform realtime.send(jsonb_build_object('v', left(btrim(v), 80)), 'version', 'hb:commun', true);
end $$;
revoke all on function public.hb_annoncer_version(text) from public, anon;
grant execute on function public.hb_annoncer_version(text) to authenticated;

-- ---------- Vérification (lecture seule) ----------
-- Attendu : 5 fonctions ; un déclencheur hb_diffuser par table présente (19 sur une base à jour) ; realtime_send et
-- regle_ecoute vrais sur Supabase (faux sur un Postgres nu) ; essai_canaux = {hb:club:6383015,hb:compte:u1,hb:dept:83,hb:tout}.
select (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname in ('hb_quoi_de_neuf', 'hb_mes_canaux', 'hb_canaux_ligne', 'hb_diffuser', 'hb_annoncer_version')) as fonctions_5,
       (select count(*) from pg_trigger where tgname = 'hb_diffuser' and not tgisinternal) as declencheurs,
       to_regprocedure('realtime.send(jsonb, text, text, boolean)') is not null as realtime_send,
       exists (select 1 from pg_policies where schemaname = 'realtime' and tablename = 'messages' and policyname = 'hb_recevoir') as regle_ecoute,
       public.hb_canaux_ligne('hb_players', '{"id": "x", "scope_dept": "83", "scope_club": "6383015", "data": {"createdBy": "u1"}}'::jsonb) as essai_canaux;

-- ---------- RETOUR ARRIÈRE (à lancer seulement pour annuler ce script ; l'appli repasse d'elle-même à postgres_changes) ----------
-- do $$
-- declare t text;
-- begin
--   foreach t in array array['players', 'criteria', 'measurements', 'teams', 'events', 'evaluations', 'groups', 'lists', 'alerts',
--                            'follows', 'videos', 'seen', 'rewatch', 'config', 'levels', 'units', 'assignments', 'question_log',
--                            'saved_questions'] loop
--     if to_regclass('public.hb_' || t) is not null then execute format('drop trigger if exists hb_diffuser on public.hb_%1$s', t); end if;
--   end loop;
--   if to_regclass('realtime.messages') is not null then execute 'drop policy if exists "hb_recevoir" on realtime.messages'; end if;
-- end $$;
-- drop function if exists public.hb_diffuser();
-- drop function if exists public.hb_canaux_ligne(text, jsonb);
-- drop function if exists public.hb_mes_canaux();
-- drop function if exists public.hb_quoi_de_neuf(jsonb);
-- drop function if exists public.hb_annoncer_version(text);
-- Plus tard, quand tous les appareils sont sur la nouvelle version (plus personne sur postgres_changes) :
-- alter publication supabase_realtime drop table public.hb_players, public.hb_criteria, …  (les tables de pg_publication_tables)
