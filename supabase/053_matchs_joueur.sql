-- HandBase : ESPACE JOUEUR, MES MATCHS : le jeune importe la feuille de match d'un de SES matchs, y ajoute la vidéo, et le staff
-- garde la main sur ce qu'il propose.
-- À exécuter dans Supabase > SQL Editor, APRÈS 051_espace_joueur.sql (et 052 s'il est passé : rien de commun) : base de TEST
-- d'abord (vérifier avec la requête de contrôle en fin de fichier), puis la réelle. Peut être relancé sans risque (create table
-- if not exists, create or replace).
-- L'appli qui affiche « Mes matchs » (src/components/PlayerMatches.tsx) doit être publiée APRÈS ce script : avant, la section
-- dit « pas encore ouvert sur ce serveur » et rien ne change pour le staff.
--
-- PRINCIPE : un compte joueur n'écrit toujours JAMAIS dans les tables partagées (hb_player_guard, 051). Il passe par des
-- fonctions du serveur, qui vérifient tout et posent elles-mêmes ce qui est écrit :
-- 1) hb_player_import_sheet(p_sheet, p_me, p_meta) → { event_id, created, attached, already } : la feuille est lue sur
--    l'appareil (comme pour le staff, src/matchSheet.ts) ; le serveur reçoit la feuille SANS noms ni licences (même forme que
--    celle enregistrée par le staff : numéros, équipes, déroulé), plus la seule ligne du jeune (p_me : rang, nom, prénom,
--    licence) pour vérifier qu'il y figure, et p_meta (date, salle, n° des deux clubs). Contrôles :
--    - appelant = compte joueur relié à une fiche (pas_joueur, sans_fiche, fiche_introuvable) ;
--    - le jeune figure sur la feuille (absent_feuille) : sa licence (actuelle ou ancienne) ; sinon prénom + nom (ou nom de
--      naissance) ET n° de club de son équipe sur la feuille = son club (n° de club de sa fiche, à défaut les 7 premiers
--      chiffres de sa licence). Club inconnu d'un côté : le nom suffit seulement s'il n'y a pas deux licences différentes ;
--    - feuille bien formée (feuille_invalide) : 80 joueurs, 600 actions au plus, textes coupés, tout autre champ ignoré ;
--      date valable (date_invalide) ; 200 000 caractères au plus (trop_long) ;
--    - MÊME MATCH déjà dans l'appli (événement non supprimé avec une feuille) : même code rencontre quand les deux feuilles en
--      ont un, sinon même date et mêmes équipes (n° des deux clubs, ou noms des deux équipes) ; celui du staff d'abord. Alors
--      RIEN n'est créé ni modifié : le jeune est seulement rattaché au match (table hb_player_match_links ; already = il l'était
--      déjà, par sa fiche reliée sur la feuille ou un rattachement) ;
--    - sinon l'événement est CRÉÉ comme par un import du staff : type match, nom « compétition – équipe A / équipe B », date,
--      heure, salle, liste = le jeune seul, feuille avec SA seule fiche reliée (matchSheet.source = 'joueur'), organisateur =
--      l'unité de la structure qui porte le n° de club du jeune s'il y en a une (sinon aucun : comme les événements d'avant
--      048), et data.proposedBy = { kind: 'joueur', playerId, at } : « proposé par le joueur » côté staff ;
--    - 10 matchs créés au plus par jour et par jeune (trop_de_matchs).
-- 2) hb_player_add_video(p_event_id, p_url, p_title) → { video_id, created } : lien vidéo sur un de SES matchs (match_inconnu
--    sinon) ; lien http(s) comme 036 (lien_invalide) ; s'il y a DÉJÀ une vidéo sur ce match, rien n'est créé : on rend la
--    première (created = false) ; 10 liens au plus par jour (trop_de_videos). Lien créé avec data.proposedBy.
-- 3) hb_player_matches() → ses matchs, du plus récent au plus ancien : seulement ce que dit la feuille (date, heure,
--    compétition, équipes, score, son équipe et son numéro) et les vidéos du match (adresse ; titre seulement d'un lien proposé
--    par un jeune ; « à moi » / « proposé »). Jamais le nom donné par le staff à l'événement, ni ses participants, ni les
--    avis, ni les moments notés par le staff. Un match = une feuille où sa fiche est reliée, ou un rattachement.
-- 4) Côté STAFF : hb_player_proposal(p_table, p_id, p_action) sur un événement ou un lien vidéo proposé par un jeune :
--    'adopt' = « Reprendre à mon compte » (le compte du staff en devient l'auteur : il le modifie et le supprime ensuite comme
--    le sien ; proposedBy retiré) ; 'remove' = le retirer (suppression comme dans l'appli). Administrateur, ou encadrant qui
--    a le droit de modifier la fiche du jeune (hb_can_invite, 051). Ce que le staff a saisi n'est jamais touché par le jeune :
--    il n'a aucune autre écriture, et un match existant n'est jamais modifié par son import.
--    hb_stamp est repris À L'IDENTIQUE de 046 avec une branche de plus : pendant « Reprendre », le nouvel auteur posé par la
--    fonction reste (réglage local hb.adopt = le compte qui reprend, pour sa seule transaction).
-- 5) SÉQUENCEUR SIMPLIFIÉ du jeune (SES actions de la feuille, calées sur la vidéo du match) :
--    - hb_player_match_seq(p_event_id) → { halfMin, actions, staff, mine } : le déroulé (sans aucun joueur : seulement « à
--      moi » et l'équipe de chaque action), le calage du staff (vidéo, bornes, actions calées) et le sien ;
--    - hb_player_set_marks(p_event_id, p_video_id, p_marks, p_fix) → ce qui a été gardé : ses bornes (s1 coup d'envoi, e1, s2,
--      e2, prolongations) et SES actions calées (clé de l'action, même règle que actionKeys), rangées À PART dans
--      hb_player_match_marks (une ligne par jeune et par match), jamais dans la feuille du staff ; ce que le staff a déjà posé
--      sur cette vidéo n'est pas pris (il prime) ; vidéo du match obligatoire (repere_invalide) ; tout vide = ligne retirée ;
--    - hb_event_player_marks(p_event_id) : pour le staff (administrateur, ou encadrant qui peut modifier la fiche du jeune),
--      les repères proposés, que l'appli reprend dans le calage du staff sur demande.
-- Les écritures du jeune passent hb_player_guard et hb_scope_row avec le réglage local hb.player_self (051), posé par la
-- fonction pour sa seule durée. Signature (créé par = le compte du jeune) et journal d'activité : déclencheurs habituels ;
-- un rattachement est noté au journal (« rattachement (espace joueur) »).
-- CE QUI NE CHANGE PAS : hb_upsert, les règles de lecture (un joueur ne lit toujours ni hb_events ni hb_videos), le reste de
-- 051. Retour arrière : supprimer les fonctions hb_player_import_sheet, hb_player_add_video, hb_player_matches,
-- hb_player_proposal, hb_player_match_seq, hb_player_set_marks, hb_event_player_marks et leurs outils (hb_pm_*), drop table
-- hb_player_match_links et hb_player_match_marks ; relancer hb_stamp depuis 046. Les événements et liens déjà proposés
-- restent (champ proposedBy sans effet).

-- ---------- 1. Rattachements à un match existant ----------

create table if not exists public.hb_player_match_links (
  player_id text not null,
  event_id text not null,
  side text check (side in ('home', 'away')),
  num text,
  user_id uuid,
  created_at timestamptz not null default now(),
  primary key (player_id, event_id)
);
create index if not exists hb_player_match_links_event on public.hb_player_match_links (event_id);
alter table public.hb_player_match_links enable row level security;
-- Aucune règle de lecture ni d'écriture : seules les fonctions ci-dessous (security definer) y touchent.
revoke all on public.hb_player_match_links from public, anon, authenticated;

-- ---------- 2. Outils (internes) ----------

-- Clé de comparaison d'un nom : minuscules, sans accents (NFD), seulement a-z. Même règle que nameKey (src/matchSheet.ts).
create or replace function public.hb_pm_key(p text) returns text
language sql immutable as $$
  select regexp_replace(normalize(lower(coalesce(p, '')), NFD), '[^a-z]', '', 'g')
$$;

-- Texte : caractères de contrôle et espaces repliés, bords coupés, longueur limitée ; vide ou pas une chaîne → null.
create or replace function public.hb_pm_text(p jsonb, p_max int) returns text
language sql immutable as $$
  select case when jsonb_typeof(p) = 'string'
              then nullif(left(btrim(regexp_replace(p #>> '{}', '[[:space:][:cntrl:]]+', ' ', 'g')), p_max), '') end
$$;

-- Entier entre lo et hi ; sinon null (vérifié AVANT la conversion : pas d'erreur sur un texte).
create or replace function public.hb_pm_int(p jsonb, p_lo int, p_hi int) returns int
language sql immutable as $$
  select case when jsonb_typeof(p) = 'number' and (p #>> '{}') ~ '^\d{1,7}$' then
           case when (p #>> '{}')::int between p_lo and p_hi then (p #>> '{}')::int end end
$$;

-- Le joueur (data de sa fiche) est-il cette ligne de la feuille ? 'license', 'name' ou null. Même règle que findMeOnSheet
-- (src/playerMatches.ts). p_side_club : n° de club de son équipe sur la feuille.
create or replace function public.hb_pm_on_sheet(p_player jsonb, p_line jsonb, p_side_club text) returns text
language sql immutable set search_path = public as $$
  select case
    when coalesce(p_line ->> 'license', '') <> ''
     and (p_line ->> 'license' = p_player ->> 'license' or public.hb_arr(p_player -> 'previousLicenses') ? (p_line ->> 'license'))
      then 'license'
    when public.hb_pm_key(p_line ->> 'firstName') <> ''
     and public.hb_pm_key(p_line ->> 'firstName') = public.hb_pm_key(p_player ->> 'firstName')
     and public.hb_pm_key(p_player ->> 'lastName') <> ''
     and public.hb_pm_key(p_player ->> 'lastName') in (public.hb_pm_key(p_line ->> 'lastName'), public.hb_pm_key(p_line ->> 'birthName'))
     and case when coalesce(p_side_club, '') <> '' and public.hb_player_club(p_player) is not null
              then p_side_club = public.hb_player_club(p_player)
              else not (coalesce(p_player ->> 'license', '') <> '' and coalesce(p_line ->> 'license', '') <> '') end
      then 'name'
  end
$$;

-- Feuille envoyée par l'appareil → feuille enregistrée (liste blanche) ; null si mal formée. p_me : rang du jeune dans
-- players (sa seule fiche reliée) ; aucun autre playerId n'est gardé.
create or replace function public.hb_pm_clean_sheet(p jsonb, p_me int, p_pid text, p_home_club text, p_away_club text) returns jsonb
language plpgsql immutable set search_path = public as $$
declare
  v_players jsonb := '[]'::jsonb;
  v_actions jsonb := '[]'::jsonb;
  v_n int;
  e jsonb;
  i int := 0;
  v_t int;
  v_p int;
  v_s0 int;
  v_s1 int;
  v_k text;
  v_home text;
  v_away text;
begin
  if jsonb_typeof(p) is distinct from 'object' or jsonb_typeof(p -> 'players') is distinct from 'array'
     or jsonb_typeof(p -> 'actions') is distinct from 'array' then return null; end if;
  v_n := jsonb_array_length(p -> 'players');
  if v_n = 0 or v_n > 80 or jsonb_array_length(p -> 'actions') > 600 then return null; end if;
  if p_me is null or p_me < 0 or p_me >= v_n then return null; end if;
  v_home := public.hb_pm_text(p -> 'home', 80);
  v_away := public.hb_pm_text(p -> 'away', 80);
  if v_home is null or v_away is null then return null; end if;

  for e in select x from jsonb_array_elements(p -> 'players') x loop
    if jsonb_typeof(e) <> 'object' or coalesce(e ->> 'side', '') not in ('home', 'away') then return null; end if;
    v_players := v_players || jsonb_strip_nulls(jsonb_build_object(
      'side', e ->> 'side',
      'num', case when e ->> 'num' ~ '^\d{1,3}$' then e ->> 'num' end,
      'playerId', case when i = p_me then p_pid end,
      'gk', case when e -> 'gk' = 'true'::jsonb then true end));
    i := i + 1;
  end loop;

  for e in select x from jsonb_array_elements(p -> 'actions') x loop
    if jsonb_typeof(e) <> 'object' then continue; end if;
    v_t := public.hb_pm_int(e -> 't', 0, 7200);
    v_p := public.hb_pm_int(e -> 'p', 1, 6);
    v_s0 := public.hb_pm_int(e -> 's' -> 0, 0, 300);
    v_s1 := public.hb_pm_int(e -> 's' -> 1, 0, 300);
    v_k := e ->> 'k';
    if v_t is null or v_p is null or v_s0 is null or v_s1 is null
       or coalesce(v_k, '') not in ('but', 'but7', 'tir', 'tir7', 'arret', 'arret7', '2mn', 'avert', 'disq', 'bleu', 'tm', 'autre') then
      continue;
    end if;
    v_actions := v_actions || jsonb_strip_nulls(jsonb_build_object(
      't', v_t, 'p', v_p, 's', jsonb_build_array(v_s0, v_s1), 'k', v_k,
      'side', case when e ->> 'side' in ('home', 'away') then e ->> 'side' end,
      'pl', public.hb_pm_int(e -> 'pl', 0, v_n - 1),
      'l', case when v_k = 'autre' then public.hb_pm_text(e -> 'l', 40) end));
  end loop;

  return jsonb_strip_nulls(jsonb_build_object(
    'v', 1,
    'code', case when btrim(p ->> 'code') ~ '^[A-Za-z0-9 _./-]{1,30}$' then btrim(p ->> 'code') end,
    'competition', public.hb_pm_text(p -> 'competition', 120),
    'home', v_home,
    'away', v_away,
    'homeClub', p_home_club,
    'awayClub', p_away_club,
    'score', case when public.hb_pm_int(p -> 'score' -> 0, 0, 300) is not null and public.hb_pm_int(p -> 'score' -> 1, 0, 300) is not null
                  then jsonb_build_array(public.hb_pm_int(p -> 'score' -> 0, 0, 300), public.hb_pm_int(p -> 'score' -> 1, 0, 300)) end,
    'time', case when p ->> 'time' ~ '^\d{2}:\d{2}$' then p ->> 'time' end,
    'halfMin', coalesce(public.hb_pm_int(p -> 'halfMin', 10, 40), 30),
    'players', v_players,
    'actions', v_actions,
    'importedAt', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'source', 'joueur'));
end $$;

-- Le jeune (fiche p_pid) a-t-il ce match ? Son équipe et son numéro (feuille ou rattachement) ; aucune ligne sinon.
create or replace function public.hb_pm_my_line(p_pid text, p_event_id text) returns table (side text, num text)
language sql stable security definer set search_path = public as $$
  select coalesce(s.side, l.side), coalesce(s.num, l.num)
    from public.hb_events e
    left join lateral (select x ->> 'side' as side, x ->> 'num' as num
                         from jsonb_array_elements(public.hb_arr(e.data -> 'matchSheet' -> 'players')) x
                        where x ->> 'playerId' = p_pid limit 1) s on true
    left join public.hb_player_match_links l on l.player_id = p_pid and l.event_id = e.id
   where e.id = p_event_id and not e.deleted and jsonb_typeof(e.data -> 'matchSheet') = 'object'
     and (s.side is not null or l.player_id is not null)
$$;

-- Le compte connecté : compte joueur relié à une fiche existante. Rend la fiche (id, data) ; exception claire sinon.
create or replace function public.hb_pm_me(out pid text, out pdata jsonb)
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Connexion requise'; end if;
  select player_id into pid from public.hb_profiles where user_id = auth.uid() and role = 'joueur';
  if not found then raise exception 'pas_joueur'; end if;
  if pid is null then raise exception 'sans_fiche'; end if;
  select data into pdata from public.hb_players where id = pid and not deleted;
  if pdata is null then raise exception 'fiche_introuvable'; end if;
end $$;

-- Horodatage « la plus récente gagne » (ms) : maintenant, toujours après la version en place.
create or replace function public.hb_pm_now(p_prev bigint default 0) returns bigint
language sql volatile as $$
  select greatest((extract(epoch from clock_timestamp()) * 1000)::bigint, coalesce(p_prev, 0) + 1)
$$;

-- ---------- 3. Importer une feuille (jeune) ----------

create or replace function public.hb_player_import_sheet(p_sheet jsonb, p_me jsonb, p_meta jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_pid text;
  v_pdata jsonb;
  v_me int;
  v_side text;
  v_num text;
  v_hclub text := case when p_meta ->> 'homeClub' ~ '^\d{7}$' then p_meta ->> 'homeClub' end;
  v_aclub text := case when p_meta ->> 'awayClub' ~ '^\d{7}$' then p_meta ->> 'awayClub' end;
  v_sheet jsonb;
  v_date date;
  v_code text;
  v_event text;
  v_already boolean;
  v_ts bigint;
  v_unit record;
  v_name text;
begin
  select * into v_pid, v_pdata from public.hb_pm_me();
  if length(coalesce(p_sheet::text, '')) + length(coalesce(p_me::text, '')) + length(coalesce(p_meta::text, '')) > 200000 then
    raise exception 'trop_long';
  end if;
  v_me := public.hb_pm_int(p_me -> 'index', 0, 79);
  if v_me is null or jsonb_typeof(p_sheet -> 'players') is distinct from 'array' or v_me >= jsonb_array_length(p_sheet -> 'players') then
    raise exception 'feuille_invalide';
  end if;
  v_side := p_sheet -> 'players' -> v_me ->> 'side';
  v_num := case when p_sheet -> 'players' -> v_me ->> 'num' ~ '^\d{1,3}$' then p_sheet -> 'players' -> v_me ->> 'num' end;
  if coalesce(v_side, '') not in ('home', 'away') then raise exception 'feuille_invalide'; end if;

  -- Il figure sur la feuille : licence, ou nom + club de son équipe.
  if public.hb_pm_on_sheet(v_pdata, p_me, case when v_side = 'home' then v_hclub else v_aclub end) is null then
    raise exception 'absent_feuille';
  end if;

  v_sheet := public.hb_pm_clean_sheet(p_sheet, v_me, v_pid, v_hclub, v_aclub);
  if v_sheet is null then raise exception 'feuille_invalide'; end if;
  begin
    v_date := case when p_meta ->> 'date' ~ '^\d{4}-\d{2}-\d{2}$' then (p_meta ->> 'date')::date end;
  exception when others then
    v_date := null;
  end;
  if v_date is null or v_date < date '2000-01-01' or v_date > current_date + 1 then raise exception 'date_invalide'; end if;
  v_code := v_sheet ->> 'code';

  -- Un import à la fois (deux coéquipiers qui importent la même feuille en même temps : un seul événement).
  perform pg_advisory_xact_lock(hashtext('hb_player_import_sheet'));

  -- Même match déjà dans l'appli : celui du staff d'abord, puis le plus ancien.
  select e.id into v_event from public.hb_events e
   where not e.deleted and jsonb_typeof(e.data -> 'matchSheet') = 'object'
     and case when v_code is not null and coalesce(btrim(e.data -> 'matchSheet' ->> 'code'), '') <> ''
              then upper(btrim(e.data -> 'matchSheet' ->> 'code')) = upper(v_code)
              else e.data ->> 'date' = v_date::text
               and ((v_hclub is not null and v_aclub is not null
                     and e.data -> 'matchSheet' ->> 'homeClub' = v_hclub and e.data -> 'matchSheet' ->> 'awayClub' = v_aclub)
                    or (public.hb_pm_key(e.data -> 'matchSheet' ->> 'home') = public.hb_pm_key(v_sheet ->> 'home')
                        and public.hb_pm_key(e.data -> 'matchSheet' ->> 'away') = public.hb_pm_key(v_sheet ->> 'away'))) end
   order by (e.data ? 'proposedBy'), e.data ->> 'createdAtServer' nulls first, e.id
   limit 1;

  if v_event is not null then
    v_already := exists (select 1 from public.hb_pm_my_line(v_pid, v_event));
    if not v_already then
      insert into public.hb_player_match_links (player_id, event_id, side, num, user_id)
      values (v_pid, v_event, v_side, v_num, v_uid) on conflict do nothing;
      insert into public.hb_audit (user_id, user_name, user_role, table_name, row_id, action, summary)
      select a.uid, a.name, a.role, 'events', v_event, 'rattachement (espace joueur)',
             coalesce(public.hb_player_name(v_pid), '?') || ' → ' || coalesce((select data ->> 'name' from public.hb_events where id = v_event), '?')
        from public.hb_actor() a;
    end if;
    return jsonb_build_object('event_id', v_event, 'created', false, 'attached', not v_already, 'already', v_already);
  end if;

  -- Nouveau match : 10 par jour au plus.
  if (select count(*) from public.hb_events
       where data -> 'proposedBy' ->> 'playerId' = v_pid
         and (data ->> 'createdAtServer')::timestamptz > now() - interval '1 day') >= 10 then
    raise exception 'trop_de_matchs';
  end if;

  -- Organisateur : l'unité qui porte le n° de club du jeune, s'il y en a une.
  select u.id, u.data ->> 'name' as name into v_unit from public.hb_units u
   where not u.deleted and coalesce(btrim(u.data ->> 'clubNumber'), '') <> ''
     and btrim(u.data ->> 'clubNumber') = public.hb_player_club(v_pdata)
   order by u.id limit 1;
  select coalesce(full_name, email) into v_name from public.hb_profiles where user_id = v_uid;

  v_event := gen_random_uuid()::text;
  v_ts := public.hb_pm_now();
  perform set_config('hb.player_self', '1', true);
  insert into public.hb_events (id, data, updated_at_client, deleted)
  values (v_event, jsonb_strip_nulls(jsonb_build_object(
    'id', v_event,
    'name', left(concat_ws(' – ', v_sheet ->> 'competition', (v_sheet ->> 'home') || ' / ' || (v_sheet ->> 'away')), 200),
    'type', 'match',
    'date', v_date::text,
    'time', v_sheet ->> 'time',
    'place', public.hb_pm_text(p_meta -> 'place', 120),
    'playerIds', jsonb_build_array(v_pid),
    'addedBy', jsonb_build_object(v_pid, v_uid),
    'editors', '[]'::jsonb,
    'names', jsonb_build_object(v_uid::text, v_name),
    'organizerUnitId', v_unit.id,
    'organizerName', v_unit.name,
    'matchSheet', v_sheet,
    'proposedBy', jsonb_build_object('kind', 'joueur', 'playerId', v_pid, 'at', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')),
    'updatedAt', v_ts)), v_ts, false);
  perform set_config('hb.player_self', '0', true);
  return jsonb_build_object('event_id', v_event, 'created', true, 'attached', false, 'already', false);
end $$;

-- ---------- 4. Ajouter la vidéo d'un de ses matchs (jeune) ----------

create or replace function public.hb_player_add_video(p_event_id text, p_url text, p_title text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_pid text;
  v_pdata jsonb;
  v_url text := btrim(coalesce(p_url, ''));
  v_id text;
  v_ts bigint;
begin
  select * into v_pid, v_pdata from public.hb_pm_me();
  if not exists (select 1 from public.hb_pm_my_line(v_pid, p_event_id)) then raise exception 'match_inconnu'; end if;
  if not public.hb_video_url_ok(v_url) then raise exception 'lien_invalide'; end if;
  perform pg_advisory_xact_lock(hashtext('hb_player_add_video:' || p_event_id));
  -- Une vidéo est déjà liée à ce match : on la rend, rien n'est créé.
  select id into v_id from public.hb_videos
   where not deleted and data ->> 'targetKind' = 'event' and data ->> 'targetId' = p_event_id
   order by (data ? 'proposedBy'), data ->> 'createdAtServer' nulls first, id limit 1;
  if v_id is not null then return jsonb_build_object('video_id', v_id, 'created', false); end if;
  if (select count(*) from public.hb_videos
       where data -> 'proposedBy' ->> 'playerId' = v_pid
         and (data ->> 'createdAtServer')::timestamptz > now() - interval '1 day') >= 10 then
    raise exception 'trop_de_videos';
  end if;
  v_id := gen_random_uuid()::text;
  v_ts := public.hb_pm_now();
  perform set_config('hb.player_self', '1', true);
  insert into public.hb_videos (id, data, updated_at_client, deleted)
  values (v_id, jsonb_strip_nulls(jsonb_build_object(
    'id', v_id, 'targetKind', 'event', 'targetId', p_event_id, 'url', v_url,
    'title', left(nullif(btrim(regexp_replace(coalesce(p_title, ''), '[[:cntrl:]]+', ' ', 'g')), ''), 200),
    'proposedBy', jsonb_build_object('kind', 'joueur', 'playerId', v_pid, 'at', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')),
    'updatedAt', v_ts)), v_ts, false);
  perform set_config('hb.player_self', '0', true);
  return jsonb_build_object('video_id', v_id, 'created', true);
end $$;

-- ---------- 5. Mes matchs (jeune) ----------

create or replace function public.hb_player_matches() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_pid text;
  v_pdata jsonb;
begin
  select * into v_pid, v_pdata from public.hb_pm_me();
  return coalesce((
    select jsonb_agg(m.j order by m.d desc, m.id)
      from (select e.id, e.data ->> 'date' as d, jsonb_strip_nulls(jsonb_build_object(
                     'eventId', e.id,
                     'date', e.data ->> 'date',
                     'time', e.data -> 'matchSheet' ->> 'time',
                     'competition', e.data -> 'matchSheet' ->> 'competition',
                     'home', e.data -> 'matchSheet' ->> 'home',
                     'away', e.data -> 'matchSheet' ->> 'away',
                     'score', e.data -> 'matchSheet' -> 'score',
                     'side', ml.side,
                     'num', ml.num,
                     'mine', e.data ->> 'createdBy' = v_uid::text,
                     'proposed', e.data ? 'proposedBy',
                     'videos', coalesce((
                        select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
                                 'id', v.id,
                                 'url', v.data ->> 'url',
                                 'title', case when v.data ? 'proposedBy' then v.data ->> 'title' end,
                                 'mine', v.data ->> 'createdBy' = v_uid::text,
                                 'proposed', v.data ? 'proposedBy')) order by (v.data ? 'proposedBy'), v.data ->> 'createdAtServer', v.id)
                          from public.hb_videos v
                         where not v.deleted and v.data ->> 'targetKind' = 'event' and v.data ->> 'targetId' = e.id), '[]'::jsonb))) as j
              from public.hb_events e
              cross join lateral public.hb_pm_my_line(v_pid, e.id) ml
             where not e.deleted and jsonb_typeof(e.data -> 'matchSheet') = 'object'
               and (exists (select 1 from jsonb_array_elements(public.hb_arr(e.data -> 'matchSheet' -> 'players')) x where x ->> 'playerId' = v_pid)
                    or exists (select 1 from public.hb_player_match_links l where l.player_id = v_pid and l.event_id = e.id))) m), '[]'::jsonb);
end $$;

-- ---------- 5b. Séquenceur simplifié du jeune : SES actions de la feuille, calées sur la vidéo ----------
-- Le jeune pose les bornes des périodes (coup d'envoi, fins de mi-temps…) et, pour chacune de SES actions, « C'est ici » au
-- moment de la vidéo. Ses repères sont rangés À PART (hb_player_match_marks : une ligne par jeune et par match), jamais dans
-- la feuille du staff : ceux du staff (matchSheet.sync, sur la même vidéo) priment toujours, le jeune ne peut ni les modifier
-- ni les remplacer (ceux qu'il enverrait par-dessus sont ignorés). Le staff les lit (hb_event_player_marks) et peut les
-- reprendre dans son calage depuis l'appli.

create table if not exists public.hb_player_match_marks (
  player_id text not null,
  event_id text not null,
  video_id text not null,
  marks jsonb not null default '{}'::jsonb,
  fix jsonb not null default '{}'::jsonb,
  user_id uuid,
  updated_at timestamptz not null default now(),
  primary key (player_id, event_id)
);
create index if not exists hb_player_match_marks_event on public.hb_player_match_marks (event_id);
alter table public.hb_player_match_marks enable row level security;
revoke all on public.hb_player_match_marks from public, anon, authenticated;

-- Mes rangs dans la liste des joueurs de la feuille : ma fiche reliée, sinon l'équipe et le numéro de mon rattachement.
create or replace function public.hb_pm_my_indexes(p_pid text, p_event_id text) returns int[]
language sql stable security definer set search_path = public as $$
  select coalesce(
    nullif(array(select (x.o - 1)::int from jsonb_array_elements(public.hb_arr(e.data -> 'matchSheet' -> 'players')) with ordinality x(p, o)
                  where x.p ->> 'playerId' = p_pid), '{}'::int[]),
    array(select (x.o - 1)::int from jsonb_array_elements(public.hb_arr(e.data -> 'matchSheet' -> 'players')) with ordinality x(p, o)
           where l.side is not null and l.num is not null and x.p ->> 'side' = l.side and x.p ->> 'num' = l.num))
    from public.hb_events e
    left join public.hb_player_match_links l on l.player_id = p_pid and l.event_id = e.id
   where e.id = p_event_id
$$;

-- Déroulé d'une feuille, dans l'ordre, avec la clé de chaque action (même règle que actionKeys, src/matchSheet.ts :
-- « période:temps:score:type:rang parmi les identiques ») et « à moi » (rang du joueur de l'action dans p_mine).
create or replace function public.hb_pm_actions(p_sheet jsonb, p_mine int[]) returns table (ord bigint, key text, me boolean, a jsonb)
language sql immutable set search_path = public as $$
  select s.o, s.base || ':' || (row_number() over (partition by s.base order by s.o) - 1),
         coalesce(public.hb_pm_int(s.e -> 'pl', 0, 999) = any (p_mine), false), s.e
    from (select x.o, x.e, (x.e ->> 'p') || ':' || (x.e ->> 't') || ':' || (x.e -> 's' ->> 0) || '-' || (x.e -> 's' ->> 1) || ':' || (x.e ->> 'k') as base
            from jsonb_array_elements(public.hb_arr(p_sheet -> 'actions')) with ordinality x(e, o)) s
   order by s.o
$$;

-- Le calage du staff porte-t-il sur cette vidéo ? (identifiant, sinon adresse : même règle que l'appli, sheetMoments)
create or replace function public.hb_pm_staff_on(p_sync jsonb, p_video_id text, p_url text) returns boolean
language sql immutable as $$
  select jsonb_typeof(p_sync) = 'object'
     and case when coalesce(p_sync ->> 'videoId', '') <> '' then p_sync ->> 'videoId' = p_video_id else p_sync ->> 'url' = p_url end
$$;

-- Ce qu'il faut pour séquencer un de mes matchs : déroulé (aucun joueur : seulement « à moi » et l'équipe), mi-temps,
-- calage du staff (bornes et actions calées) et le mien.
create or replace function public.hb_player_match_seq(p_event_id text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_pid text;
  v_pdata jsonb;
  v_sheet jsonb;
  v_mine int[];
begin
  select * into v_pid, v_pdata from public.hb_pm_me();
  if not exists (select 1 from public.hb_pm_my_line(v_pid, p_event_id)) then raise exception 'match_inconnu'; end if;
  select data -> 'matchSheet' into v_sheet from public.hb_events where id = p_event_id;
  v_mine := public.hb_pm_my_indexes(v_pid, p_event_id);
  return jsonb_strip_nulls(jsonb_build_object(
    'halfMin', coalesce(public.hb_pm_int(v_sheet -> 'halfMin', 10, 40), 30),
    'actions', coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
                          't', x.a -> 't', 'p', x.a -> 'p', 's', x.a -> 's', 'k', x.a -> 'k',
                          'l', case when x.a ->> 'k' = 'autre' then x.a -> 'l' end,
                          'side', case when x.a ->> 'side' in ('home', 'away') then x.a -> 'side' end,
                          'me', case when x.me then true end)) order by x.ord)
                           from public.hb_pm_actions(v_sheet, v_mine) x), '[]'::jsonb),
    'staff', case when jsonb_typeof(v_sheet -> 'sync') = 'object' then jsonb_strip_nulls(jsonb_build_object(
               'videoId', v_sheet -> 'sync' -> 'videoId', 'url', v_sheet -> 'sync' -> 'url',
               'marks', coalesce(v_sheet -> 'sync' -> 'marks', '{}'::jsonb), 'fix', coalesce(v_sheet -> 'sync' -> 'fix', '{}'::jsonb))) end,
    'mine', (select jsonb_build_object('videoId', m.video_id, 'marks', m.marks, 'fix', m.fix)
               from public.hb_player_match_marks m where m.player_id = v_pid and m.event_id = p_event_id)));
end $$;

-- Temps vidéo (s) d'un repère : nombre entre 0 et 100 h, arrondi au dixième ; null sinon.
create or replace function public.hb_pm_secs(p jsonb) returns numeric
language sql immutable as $$
  select case when jsonb_typeof(p) = 'number' then
           case when (p #>> '{}')::numeric >= 0 and (p #>> '{}')::numeric < 360000 then round((p #>> '{}')::numeric, 1) end end
$$;

-- Mes repères sur la vidéo d'un de mes matchs. Bornes connues et MES actions seulement ; ce que le staff a posé sur cette
-- vidéo n'est pas pris (il prime). Tout vide : ma ligne est retirée. Rend ce qui a été gardé.
create or replace function public.hb_player_set_marks(p_event_id text, p_video_id text, p_marks jsonb, p_fix jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_pid text;
  v_pdata jsonb;
  v_sheet jsonb;
  v_url text;
  v_on boolean;
  v_marks jsonb := '{}'::jsonb;
  v_fix jsonb := '{}'::jsonb;
  k text;
  v numeric;
  r record;
begin
  select * into v_pid, v_pdata from public.hb_pm_me();
  if not exists (select 1 from public.hb_pm_my_line(v_pid, p_event_id)) then raise exception 'match_inconnu'; end if;
  if length(coalesce(p_marks::text, '')) + length(coalesce(p_fix::text, '')) > 50000 then raise exception 'trop_long'; end if;
  select data ->> 'url' into v_url from public.hb_videos
   where id = p_video_id and not deleted and data ->> 'targetKind' = 'event' and data ->> 'targetId' = p_event_id;
  if v_url is null then raise exception 'repere_invalide'; end if;
  select data -> 'matchSheet' into v_sheet from public.hb_events where id = p_event_id;
  v_on := public.hb_pm_staff_on(v_sheet -> 'sync', p_video_id, v_url);

  foreach k in array array['s1', 'e1', 's2', 'e2', 's3', 'e3', 's4', 'e4'] loop
    v := public.hb_pm_secs(p_marks -> k);
    if v is not null and not (v_on and coalesce(v_sheet -> 'sync' -> 'marks' ? k, false)) then
      v_marks := v_marks || jsonb_build_object(k, v);
    end if;
  end loop;
  if jsonb_typeof(p_fix) = 'object' then
    for r in select x.key from public.hb_pm_actions(v_sheet, public.hb_pm_my_indexes(v_pid, p_event_id)) x where x.me loop
      v := public.hb_pm_secs(p_fix -> r.key);
      if v is not null and not (v_on and coalesce(v_sheet -> 'sync' -> 'fix' ? r.key, false)) then
        v_fix := v_fix || jsonb_build_object(r.key, v);
      end if;
    end loop;
  end if;

  if v_marks = '{}'::jsonb and v_fix = '{}'::jsonb then
    delete from public.hb_player_match_marks where player_id = v_pid and event_id = p_event_id;
  else
    insert into public.hb_player_match_marks (player_id, event_id, video_id, marks, fix, user_id, updated_at)
    values (v_pid, p_event_id, p_video_id, v_marks, v_fix, auth.uid(), now())
    on conflict (player_id, event_id) do update
      set video_id = excluded.video_id, marks = excluded.marks, fix = excluded.fix, user_id = excluded.user_id, updated_at = now();
  end if;
  return jsonb_build_object('videoId', p_video_id, 'marks', v_marks, 'fix', v_fix);
end $$;

-- Pour le staff : repères proposés par les jeunes sur un match (administrateur, ou encadrant qui a le droit de modifier
-- la fiche du jeune : hb_can_invite). Nom du jeune, vidéo, bornes, actions calées, date.
create or replace function public.hb_event_player_marks(p_event_id text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_role text;
begin
  if auth.uid() is null then raise exception 'Connexion requise'; end if;
  select role into v_role from public.hb_profiles where user_id = auth.uid();
  if v_role is null or v_role not in ('admin', 'preparateur') then raise exception 'Réservé aux administrateurs et aux encadrants'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
                     'playerId', m.player_id, 'name', public.hb_player_name(m.player_id), 'videoId', m.video_id,
                     'marks', m.marks, 'fix', m.fix, 'updatedAt', m.updated_at) order by m.updated_at desc)
                     from public.hb_player_match_marks m
                    where m.event_id = p_event_id and (v_role = 'admin' or public.hb_can_invite(m.player_id))), '[]'::jsonb);
end $$;

-- ---------- 6. Le staff garde la main : reprendre ou retirer ce qu'un jeune a proposé ----------

-- Signature (reprise EXACTE de 046) + une branche : pendant « Reprendre » (hb.adopt = le compte qui reprend), le nouvel
-- auteur posé par hb_player_proposal reste.
create or replace function public.hb_stamp() returns trigger
language plpgsql security definer set search_path = public as $$
declare a record;
begin
  if tg_op = 'UPDATE' and new.data is not distinct from old.data then return new; end if;
  select * into a from public.hb_actor();
  if tg_op = 'INSERT' then
    new.data := new.data || jsonb_strip_nulls(jsonb_build_object(
      'createdBy', a.uid, 'createdByName', a.name, 'createdAtServer', now()));
  elsif a.uid is not null and current_setting('hb.adopt', true) = a.uid::text then
    -- 053 : reprise par le staff d'une proposition d'un jeune : le nouvel auteur (posé par la fonction) reste.
    null;
  else
    -- La création reste celle d'origine, quoi qu'envoie l'appareil.
    new.data := (new.data - 'createdBy' - 'createdByName' - 'createdAtServer') || jsonb_strip_nulls(jsonb_build_object(
      'createdBy', old.data -> 'createdBy', 'createdByName', old.data -> 'createdByName', 'createdAtServer', old.data -> 'createdAtServer'));
  end if;
  new.data := new.data || jsonb_strip_nulls(jsonb_build_object(
    'updatedBy', a.uid, 'updatedByName', a.name, 'updatedAtServer', now()));
  return new;
end $$;

create or replace function public.hb_player_proposal(p_table text, p_id text, p_action text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_role text;
  v_name text;
  v_data jsonb;
  v_deleted boolean;
  v_prev bigint;
  v_ts bigint;
begin
  if v_uid is null then raise exception 'Connexion requise'; end if;
  select role, coalesce(full_name, email) into v_role, v_name from public.hb_profiles where user_id = v_uid;
  if v_role is null or v_role not in ('admin', 'preparateur') then raise exception 'Réservé aux administrateurs et aux encadrants'; end if;
  if p_table not in ('events', 'videos') or p_action not in ('adopt', 'remove') then raise exception 'Demande inconnue'; end if;
  execute format('select data, deleted, updated_at_client from public.hb_%I where id = $1 for update', p_table)
    into v_data, v_deleted, v_prev using p_id;
  if v_data is null or v_deleted then raise exception 'introuvable'; end if;
  if jsonb_typeof(v_data -> 'proposedBy') is distinct from 'object' then raise exception 'pas_propose'; end if;
  if v_role = 'preparateur' and not public.hb_can_invite(v_data -> 'proposedBy' ->> 'playerId') then
    raise exception 'Réservé aux encadrants de ce joueur';
  end if;
  v_ts := public.hb_pm_now(v_prev);
  if p_action = 'adopt' then
    perform set_config('hb.adopt', v_uid::text, true);
    execute format('update public.hb_%I set data = (data - ''proposedBy'') || $2, updated_at_client = $3 where id = $1', p_table)
      using p_id, jsonb_build_object('createdBy', v_uid, 'createdByName', v_name, 'updatedAt', v_ts), v_ts;
    perform set_config('hb.adopt', '', true);
  else
    execute format('update public.hb_%I set data = data || $2, deleted = true, updated_at_client = $3 where id = $1', p_table)
      using p_id, jsonb_build_object('deleted', true, 'updatedAt', v_ts), v_ts;
  end if;
  return jsonb_build_object('id', p_id, 'action', p_action);
end $$;

-- ---------- 7. Droits des fonctions ----------

revoke all on function public.hb_pm_key(text) from public, anon, authenticated;
revoke all on function public.hb_pm_text(jsonb, int) from public, anon, authenticated;
revoke all on function public.hb_pm_int(jsonb, int, int) from public, anon, authenticated;
revoke all on function public.hb_pm_on_sheet(jsonb, jsonb, text) from public, anon, authenticated;
revoke all on function public.hb_pm_clean_sheet(jsonb, int, text, text, text) from public, anon, authenticated;
revoke all on function public.hb_pm_my_line(text, text) from public, anon, authenticated;
revoke all on function public.hb_pm_me() from public, anon, authenticated;
revoke all on function public.hb_pm_now(bigint) from public, anon, authenticated;
revoke all on function public.hb_pm_my_indexes(text, text) from public, anon, authenticated;
revoke all on function public.hb_pm_actions(jsonb, int[]) from public, anon, authenticated;
revoke all on function public.hb_pm_staff_on(jsonb, text, text) from public, anon, authenticated;
revoke all on function public.hb_pm_secs(jsonb) from public, anon, authenticated;
revoke all on function public.hb_player_match_seq(text) from public, anon;
revoke all on function public.hb_player_set_marks(text, text, jsonb, jsonb) from public, anon;
revoke all on function public.hb_event_player_marks(text) from public, anon;
grant execute on function public.hb_player_match_seq(text) to authenticated;
grant execute on function public.hb_player_set_marks(text, text, jsonb, jsonb) to authenticated;
grant execute on function public.hb_event_player_marks(text) to authenticated;
revoke all on function public.hb_player_import_sheet(jsonb, jsonb, jsonb) from public, anon;
revoke all on function public.hb_player_add_video(text, text, text) from public, anon;
revoke all on function public.hb_player_matches() from public, anon;
revoke all on function public.hb_player_proposal(text, text, text) from public, anon;
grant execute on function public.hb_player_import_sheet(jsonb, jsonb, jsonb) to authenticated;
grant execute on function public.hb_player_add_video(text, text, text) to authenticated;
grant execute on function public.hb_player_matches() to authenticated;
grant execute on function public.hb_player_proposal(text, text, text) to authenticated;
-- hb_stamp : droits inchangés (create or replace les garde).

-- Vérification : la table, les fonctions, la branche « Reprendre » de hb_stamp ; propositions déjà reçues.
select to_regclass('public.hb_player_match_links') is not null as table_rattachements,
       to_regclass('public.hb_player_match_marks') is not null as table_reperes,
       (select count(*) from pg_proc where proname in ('hb_player_import_sheet', 'hb_player_add_video', 'hb_player_matches', 'hb_player_proposal',
                                                       'hb_player_match_seq', 'hb_player_set_marks', 'hb_event_player_marks')) as fonctions_sur_7,
       (select position('hb.adopt' in prosrc) > 0 from pg_proc where proname = 'hb_stamp') as hb_stamp_reprise,
       (select count(*) from public.hb_events where not deleted and data ? 'proposedBy') as matchs_proposes,
       (select count(*) from public.hb_videos where not deleted and data ? 'proposedBy') as videos_proposees,
       (select count(*) from public.hb_player_match_links) as rattachements,
       (select count(*) from public.hb_player_match_marks) as reperes_proposes;
