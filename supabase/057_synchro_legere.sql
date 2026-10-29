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
--    Clé « mes_affectations » (appli du 29/10 et après) : les seules affectations du compte connecté (hb_assignments,
--    data.userId). POURQUOI (essai de charge du 29/10, 5 000 appareils neufs en 5 minutes) : chaque appareil relisait les
--    20 000 affectations (~5 900 s de base sur le palier ; coût en N² avec le nombre de membres du staff). Un compte qui
--    n'est pas administrateur ne reçoit plus que les siennes (src/syncLive.ts, assignmentScope ; l'écran Structure lit la
--    liste complète à la demande) ; sous la clé « assignments », son curseur (heure de SA dernière affectation) paraîtrait
--    en retard dès qu'une affectation d'un autre change, et l'appareil relirait pour rien à chaque synchronisation.
--    Rien ne change des droits de lecture (staff_read de 051).
--    COLONNE user_id (copie de data.userId, colonne générée) et son index (user_id, server_updated_at, id) : sous les règles
--    de lecture, Postgres n'utilise un index que pour des opérateurs « leakproof » ; « data ->> 'userId' » ne l'est pas (l'index
--    hb_assignments_user de 046 ne sert donc qu'aux fonctions SECURITY DEFINER) et chaque appareil parcourrait toute la table.
--    Sur user_id (égalité de textes, leakproof), la lecture de ses affectations et la clé « mes_affectations » sont des
--    lectures d'index. Les écritures (hb_upsert) ne changent pas : la colonne se calcule seule. L'appli filtre sur user_id et,
--    sur un serveur qui ne l'a pas encore, sur data->>userId (même résultat, sans index).
-- 2) DIFFUSION EN DIRECT par canaux privés (Realtime, broadcast) au lieu de postgres_changes : après chaque envoi réussi,
--    L'APPAREIL QUI ÉCRIT envoie un SIGNAL ({t: table, id, v} : ni nom ni contenu) sur ceux de SES canaux qui lisent les
--    lignes envoyées (src/sync.ts, signalWrites ; canaux d'une ligne : src/syncLive.ts, rowChannels, miroir de
--    hb_canaux_ligne ci-dessous) :
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
--    les droits UNE fois, à l'abonnement (règles sur realtime.messages, section 5) : écoute (hb_recevoir) et envoi
--    (hb_emettre) seulement sur les canaux rendus par hb_mes_canaux() ; puis il diffuse sans relire les règles. Un compte
--    ne prévient donc que les canaux qu'il écoute lui-même : une fiche modifiée par un club prévient ce club, pas le comité
--    ni les comptes qui voient tout (ceux-là la reçoivent par le filet de sécurité, dans les 5 minutes).
--    Un seul signal par table et par canal pour un envoi (un envoi de 400 lignes = quelques messages).
--    Configuration, critères, niveaux (rien de personnel, lus par tout le staff) : la ligne entière part (événement
--    « ligne »), pour que des milliers d'appareils n'aient pas à la relire en même temps ; l'appli l'applique comme une
--    ligne reçue (jamais par-dessus une version plus récente) sans avancer son curseur : la relecture reste la référence.
--    Ce qui ne vient pas d'un téléphone (SQL, imports côté serveur, tâches de nuit) ne prévient personne : le filet de
--    sécurité le rattrape (« quoi de neuf ? » toutes les 5 minutes quand le direct est abonné, toutes les minutes sinon).
--    LIGNE DANS LE SIGNAL (essai de charge du 29/10, série 5 : à 3 500 appareils, chaque écriture était reçue par ~18
--    appareils qui relisaient la table depuis leur curseur moins 60 s ; ces relectures de hb_measurements et hb_seen
--    faisaient 80 % du temps de la base) : joueurs, mesures, avis et « vu » partent par hb_upsert_lignes (section 7), qui
--    renvoie les lignes TELLES QU'ENREGISTRÉES (relues avec les règles de lecture de celui qui écrit) ; l'appareil les met
--    dans son signal (champ « lignes ») seulement sur les canaux dont TOUS les abonnés peuvent les lire par la
--    synchronisation normale : hb:tout, hb:dept:<scope_dept de la ligne>, hb:club:<scope_club de la ligne>, son propre
--    hb:compte:… ; la règle de lecture de ces quatre tables (046, staff_read) est exactement « rôle du staff et (tout, ou
--    département couvert, ou club couvert, ou auteur) », et hb_mes_canaux donne ces canaux avec le même périmètre
--    (hb_scope_of). Ailleurs, et pour les autres tables : les seuls identifiants (champ « ids »), relus par identifiant
--    avec les règles de lecture du destinataire. Ceux qui reçoivent appliquent la ligne sans rien relire (jamais par-dessus
--    une version plus récente ni un envoi en attente) ; le filet de sécurité ne change pas et confirme ces lignes.
--    ENVOI réservé aux comptes du staff (règle hb_emettre, section 5) : un compte joueur ou sans rôle n'écrit jamais, il
--    n'a rien à signaler (et ne peut donc pas diffuser de fausse configuration sur hb:commun).
--    POURQUOI pas la base (première version de ce script : déclencheur hb_diffuser → realtime.send) : à l'essai de charge
--    (Realtime auto-hébergé 2.143.3), les messages envoyés par la base n'arrivaient jamais aux abonnés, alors qu'un message
--    envoyé par un client sur le même canal l'était ; et ces envois, dans chaque transaction d'écriture, chargeaient la
--    base (saturée vers 10 000 utilisateurs). Ce script RETIRE donc ces déclencheurs s'ils ont été posés (section 4).
-- 3) hb_mes_canaux() : les canaux du compte connecté (même règle que hb_scope_of : tout, ou ses départements et ses clubs ;
--    compte joueur : sa fiche). L'appli les lit à la connexion et quand son périmètre change, puis s'abonne (canaux
--    privés, jeton de session). Sans la fonction (ce script pas passé), elle garde postgres_changes.
-- 4) hb_annoncer_version(v) : annonce une nouvelle version de l'appli sur hb:commun (événement « version ») ; chaque appareil
--    vérifie la mise à jour dans les 30 secondes qui suivent (le bandeau « Nouvelle version » apparaît), au lieu de toutes
--    les 5 minutes. Administrateur connecté, ou SQL direct (SQL Editor, connecteur).
--    (Envoi par la base, realtime.send : voir la remarque du point 2 ; sans réception, les appareils trouvent la nouvelle
--    version d'eux-mêmes, toutes les 5 minutes.)
--    PUBLICATION : après la mise en ligne de l'appli, passer dans le SQL Editor (ou par le connecteur, execute_sql) :
--      select public.hb_annoncer_version('2026-10-28T12:00:00.000Z');   -- l'heure de construction affichée dans Réglages
--    (n'importe quel texte non vide convient ; un appareil qui a déjà cette version n'en tient pas compte).
-- 5) postgres_changes : la publication supabase_realtime n'est pas touchée : les appareils encore sur l'ancienne version
--    (ou une base sans ce script) continuent de l'utiliser. Une fois tout le monde à jour, les tables pourront en être
--    retirées (voir RETOUR ARRIÈRE, dernière ligne).
-- Dépend de : 046/047 (colonnes scope_*, hb_scope_of), 048 (territoire des événements), 051 (comptes joueur), 034
-- (hb_participants, hb_arr). Realtime ≥ 2.33 : realtime.send et canaux privés (realtime.messages, realtime.topic()).
-- Les règles sur realtime.messages demandent d'être propriétaire de la table : si le script affiche l'avertissement « Règles
-- hb_recevoir / hb_emettre non posées », repasser le seul bloc « 5. Droits d'écoute et d'envoi » en super-utilisateur
-- (supabase_admin).
-- Appli : src/sync.ts, src/syncLive.ts (règles pures, testées par tools/test-synchro-legere.ts), src/pwa.ts.
-- Annulation : section « RETOUR ARRIÈRE » à la fin (commentée).

-- ---------- 1. « Quoi de neuf ? » : une requête au lieu de 19 ----------

-- Affectations du compte (clé « mes_affectations », relecture filtrée de l'appli) : colonne user_id = data.userId, et un index
-- utilisable sous les règles de lecture (point 1 de l'en-tête). Une table de 20 000 lignes est réécrite une fois (verrou de
-- quelques secondes au plus) ; relancé : rien à faire.
do $$
begin
  if to_regclass('public.hb_assignments') is null then return; end if; -- 044 pas passé
  alter table public.hb_assignments add column if not exists user_id text generated always as (data ->> 'userId') stored;
  create index if not exists hb_assignments_mine on public.hb_assignments (user_id, server_updated_at, id);
end $$;

-- curseurs : { players: '2026-10-28T10:00:00.123456+00:00', criteria: …, … } (src/sync.ts, PULL_KEY). Renvoie, pour chaque
-- table synchronisée (src/db.ts, SYNC_TABLES) citée : true (à relire), false (rien de nouveau pour ce compte), null (table
-- inconnue du serveur). SECURITY INVOKER : chaque « exists » passe par les règles de lecture du compte, et le périmètre n'est
-- calculé qu'une fois (hb_my_scope, gardé pour la transaction) ; l'index sur server_updated_at arrête chaque lecture à la
-- première ligne. Clé « mes_affectations » : voir le point 1 de l'en-tête (réponse sous la même clé).
create or replace function public.hb_quoi_de_neuf(curseurs jsonb) returns jsonb
language plpgsql stable security invoker set search_path = public as $$
declare
  v_tables text[] := array['players', 'criteria', 'measurements', 'teams', 'events', 'evaluations', 'groups', 'lists', 'alerts',
                           'follows', 'videos', 'seen', 'rewatch', 'config', 'levels', 'units', 'assignments', 'question_log',
                           'saved_questions'];
  t text;
  v_rel text;
  v_mine text;
  v_cur timestamptz;
  v_new boolean;
  v_out jsonb := '{}'::jsonb;
begin
  if auth.uid() is null then raise exception 'Connexion requise'; end if;
  if jsonb_typeof(curseurs) is distinct from 'object' then raise exception 'curseurs : objet { table: heure } attendu'; end if;
  for t in select jsonb_object_keys(curseurs) loop
    -- « mes_affectations » : hb_assignments, lignes du compte seulement ($2 ; colonne user_id, index hb_assignments_mine) ;
    -- sinon une table de la liste blanche.
    if t = 'mes_affectations' then
      v_rel := 'assignments';
      v_mine := ' and user_id = $2';
    elsif t = any (v_tables) then
      v_rel := t;
      v_mine := '';
    else
      continue;
    end if;
    if to_regclass('public.hb_' || v_rel) is null then
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
      execute format('select exists (select 1 from public.hb_%I where server_updated_at >= $1%s)', v_rel, v_mine)
        into v_new using v_cur - interval '60 seconds', auth.uid()::text;
    else
      execute format('select exists (select 1 from public.hb_%I where server_updated_at > $1%s)', v_rel, v_mine)
        into v_new using v_cur, auth.uid()::text;
    end if;
    v_out := v_out || jsonb_build_object(t, v_new);
  end loop;
  return v_out;
end $$;
revoke all on function public.hb_quoi_de_neuf(jsonb) from public, anon;
grant execute on function public.hb_quoi_de_neuf(jsonb) to authenticated;

-- ---------- 2. Canaux d'une ligne (mêmes règles que les règles de lecture) ----------

-- Référence des canaux d'une ligne : l'appli en a le miroir (src/syncLive.ts, rowChannels) pour choisir où envoyer ses
-- signaux ; gardée ici pour les essais et les contrôles (aucun déclencheur ne l'appelle plus).
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
        v_out := array_append(v_out, 'hb:joueur:' || (p_row ->> 'id'));
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
    if coalesce(v_pid, '') <> '' then v_out := array_append(v_out, 'hb:joueur:' || v_pid); end if;
  elsif v_role in ('admin', 'preparateur', 'observateur') then
    v_out := array_append(v_out, 'hb:staff');
    select * into s from public.hb_scope_of(v_uid);
    if s.all_ then
      v_out := array_append(v_out, 'hb:tout');
    else
      v_out := v_out || array(select 'hb:dept:' || x from unnest(s.depts) x where coalesce(x, '') <> '')
                     || array(select 'hb:club:' || x from unnest(s.clubs) x where coalesce(x, '') <> '');
    end if;
  end if;
  return v_out;
end $$;
revoke all on function public.hb_mes_canaux() from public, anon;
grant execute on function public.hb_mes_canaux() to authenticated;

-- ---------- 4. Plus de diffusion par la base ----------

-- Première version de ce script : un déclencheur hb_diffuser après chaque écriture, sur les 19 tables. Retiré (voir le
-- point 2 de l'en-tête) : c'est l'appareil qui écrit qui prévient. Sans effet si ce script n'avait jamais été passé.
do $$
declare t text;
begin
  foreach t in array array['players', 'criteria', 'measurements', 'teams', 'events', 'evaluations', 'groups', 'lists', 'alerts',
                           'follows', 'videos', 'seen', 'rewatch', 'config', 'levels', 'units', 'assignments', 'question_log',
                           'saved_questions'] loop
    if to_regclass('public.hb_' || t) is null then continue; end if;
    execute format('drop trigger if exists hb_diffuser on public.hb_%1$s', t);
  end loop;
end $$;
drop function if exists public.hb_diffuser();

-- ---------- 5. Droits d'écoute et d'envoi : canaux privés ----------

-- Realtime vérifie à l'abonnement, avec le jeton du compte, qu'une ligne de realtime.messages portant le canal demandé
-- serait lisible (écoute : hb_recevoir) et pourrait être insérée (envoi : hb_emettre) : dans les deux cas, seulement les
-- canaux de hb_mes_canaux(), et seulement les messages « broadcast ». Un compte ne peut donc rien envoyer sur un canal
-- qu'il n'a pas le droit d'écouter (le département d'un autre comité, hb:tout pour un club…). Envoi : en plus, seulement un
-- compte du staff (hb_has_role : administrateur, encadrant, observateur) ; un compte joueur ou sans rôle écoute seulement.
do $$
begin
  if to_regclass('realtime.messages') is null or to_regprocedure('realtime.topic()') is null then
    raise notice 'realtime.messages ou realtime.topic() absent : pas de canaux privés sur cette base (Postgres nu, ou Realtime trop ancien).';
    return;
  end if;
  begin
    execute 'drop policy if exists "hb_recevoir" on realtime.messages';
    execute 'drop policy if exists "hb_emettre" on realtime.messages';
    -- (select …)::text[] : la liste est calculée une fois par requête, comme les règles de 046.
    execute $p$create policy "hb_recevoir" on realtime.messages for select to authenticated
      using (realtime.messages.extension = 'broadcast' and realtime.topic() = any ((select public.hb_mes_canaux())::text[]))$p$;
    execute $p$create policy "hb_emettre" on realtime.messages for insert to authenticated
      with check (realtime.messages.extension = 'broadcast' and realtime.topic() = any ((select public.hb_mes_canaux())::text[]) and (select public.hb_has_role()))$p$;
  exception when others then
    raise warning 'Règles hb_recevoir / hb_emettre non posées sur realtime.messages (%) : repasser ce bloc en super-utilisateur.', sqlerrm;
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

-- ---------- 7. Écrire et renvoyer les lignes enregistrées (ligne dans le signal) ----------

-- Voir « LIGNE DANS LE SIGNAL » au point 2 de l'en-tête. hb_upsert_lignes fait EXACTEMENT hb_upsert (mêmes contrôles, même
-- liste blanche de tables, mêmes refus), puis relit les lignes acceptées DANS LA MÊME TRANSACTION, par clé primaire :
--   { "refusees": [identifiants refusés, comme hb_upsert],
--     "lignes": [{ id, data, deleted, server_updated_at, scope_dept, scope_club }] ou null }
--  - SECURITY INVOKER : la relecture passe par les règles de lecture de celui qui écrit (une ligne qu'il ne pourrait pas
--    relire n'est pas renvoyée : journal des questions d'un compte qui n'est pas administrateur, par exemple) ;
--  - scope_dept / scope_club (046, tables qui les ont) : le périmètre de la ligne pour le serveur ; l'appli choisit d'après
--    eux les canaux où la ligne peut voyager (src/syncLive.ts, serverRowChannels et rowFitsTopic) ;
--  - seulement si le paquet a au plus p_max lignes acceptées (l'appli : 20 ; au-delà, un import : null, l'appli n'envoie
--    que des identifiants), et seulement les lignes dont data pèse au plus p_octets (taille stockée ; l'appli : 6 000) ;
--  - coût : une lecture par clé primaire par ligne, dans la transaction de l'écriture (périmètre du compte déjà en cache,
--    hb.scope_cache), sans aller-retour de plus ; rien à côté des ~18 relectures par écriture qu'elle évite.
-- Serveur sans cette fonction : l'appli garde hb_upsert et n'envoie que des identifiants.
create or replace function public.hb_upsert_lignes(p_table text, p_rows jsonb, p_max integer default 20, p_octets integer default 6000)
returns jsonb
language plpgsql security invoker set search_path = public as $$
declare
  v_refus jsonb;
  v_ids text[];
  v_scope boolean;
  v_lignes jsonb;
begin
  -- Tous les contrôles d'écriture (et l'erreur « Table inconnue » pour une table hors liste blanche) : ceux de hb_upsert.
  v_refus := coalesce(public.hb_upsert(p_table, p_rows), '[]'::jsonb);
  select array_agg(distinct x ->> 'id') into v_ids
    from jsonb_array_elements(case when jsonb_typeof(p_rows) = 'array' then p_rows else '[]'::jsonb end) x
   where coalesce(x ->> 'id', '') <> '' and not (v_refus ? (x ->> 'id'));
  if coalesce(cardinality(v_ids), 0) = 0 or cardinality(v_ids) > least(greatest(coalesce(p_max, 0), 0), 200) then
    return jsonb_build_object('refusees', v_refus, 'lignes', null);
  end if;
  v_scope := exists (select 1 from pg_attribute
                      where attrelid = to_regclass('public.hb_' || p_table) and attname = 'scope_dept' and not attisdropped);
  -- id = any($1) : égalité de textes (leakproof), la clé primaire sert sous les règles de lecture.
  execute format($f$
    select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'data', t.data, 'deleted', t.deleted,
                                                 'server_updated_at', t.server_updated_at)%s), '[]'::jsonb)
      from public.%I t
     where t.id = any ($1) and pg_column_size(t.data) <= $2
  $f$, case when v_scope then ' || jsonb_build_object(''scope_dept'', t.scope_dept, ''scope_club'', t.scope_club)' else '' end,
       'hb_' || p_table)
    into v_lignes using v_ids, greatest(coalesce(p_octets, 0), 0);
  return jsonb_build_object('refusees', v_refus, 'lignes', v_lignes);
end $$;
revoke all on function public.hb_upsert_lignes(text, jsonb, integer, integer) from public, anon;
grant execute on function public.hb_upsert_lignes(text, jsonb, integer, integer) to authenticated;

-- ---------- Vérification (lecture seule) ----------
-- Attendu : 5 fonctions ; aucun déclencheur hb_diffuser (0) ; realtime_send, regle_ecoute et regle_envoi vrais sur
-- Supabase (faux sur un Postgres nu) ; essai_canaux = {hb:club:6383015,hb:compte:u1,hb:dept:83,hb:tout} ;
-- affectations_user_id vrai (colonne et index hb_assignments_mine) ; ecriture_invoker vrai (hb_upsert_lignes relit avec les
-- règles de lecture de celui qui écrit).
select (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname in ('hb_quoi_de_neuf', 'hb_mes_canaux', 'hb_canaux_ligne', 'hb_annoncer_version',
                                                      'hb_upsert_lignes')) as fonctions_5,
       (select count(*) from pg_trigger where tgname = 'hb_diffuser' and not tgisinternal) as declencheurs_0,
       to_regprocedure('realtime.send(jsonb, text, text, boolean)') is not null as realtime_send,
       exists (select 1 from pg_policies where schemaname = 'realtime' and tablename = 'messages' and policyname = 'hb_recevoir') as regle_ecoute,
       exists (select 1 from pg_policies where schemaname = 'realtime' and tablename = 'messages' and policyname = 'hb_emettre') as regle_envoi,
       public.hb_canaux_ligne('hb_players', '{"id": "x", "scope_dept": "83", "scope_club": "6383015", "data": {"createdBy": "u1"}}'::jsonb) as essai_canaux,
       exists (select 1 from pg_attribute where attrelid = to_regclass('public.hb_assignments') and attname = 'user_id' and not attisdropped)
         and to_regclass('public.hb_assignments_mine') is not null as affectations_user_id,
       (select not prosecdef from pg_proc where oid = to_regprocedure('public.hb_upsert_lignes(text, jsonb, integer, integer)')) as ecriture_invoker;

-- ---------- RETOUR ARRIÈRE (à lancer seulement pour annuler ce script ; l'appli repasse d'elle-même à postgres_changes) ----------
-- do $$
-- begin
--   if to_regclass('realtime.messages') is not null then
--     execute 'drop policy if exists "hb_recevoir" on realtime.messages';
--     execute 'drop policy if exists "hb_emettre" on realtime.messages';
--   end if;
-- end $$;
-- drop function if exists public.hb_canaux_ligne(text, jsonb);
-- drop function if exists public.hb_mes_canaux();
-- drop function if exists public.hb_quoi_de_neuf(jsonb);
-- drop function if exists public.hb_annoncer_version(text);
-- drop function if exists public.hb_upsert_lignes(text, jsonb, integer, integer);   -- l'appli repasse d'elle-même à hb_upsert
-- drop index if exists public.hb_assignments_mine;
-- alter table public.hb_assignments drop column if exists user_id;   -- seulement si plus aucune appli ne filtre dessus
-- Plus tard, quand tous les appareils sont sur la nouvelle version (plus personne sur postgres_changes) :
-- alter publication supabase_realtime drop table public.hb_players, public.hb_criteria, …  (les tables de pg_publication_tables)
