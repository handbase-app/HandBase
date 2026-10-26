-- HandBase : RENCONTRES « AUTOUR DE MOI » (étape 1) : les rencontres officielles prévues des championnats de jeunes, autour
-- d'un lieu et sur une période, pour savoir où voir jouer les jeunes ; et « Mon équipe » sur la fiche (équipe 1, 2 ou 3,
-- niveau, catégorie jouée), tenue par le staff ou par le jeune lui-même depuis sa page.
-- À exécuter dans Supabase > SQL Editor, APRÈS 055_a_revoir_origine.sql sur la base de TEST (vérifier avec la requête de
-- contrôle en fin de fichier), puis sur les autres. Ne dépend que de 029 (hb_has_role), 046 (périmètre) et 051 (rôle
-- joueur, hb_player_guard, réglage hb.player_self) : passe aussi sur une base où 052 à 055 ne sont pas passés (volley).
-- Peut être relancé sans risque (create table / index if not exists, create or replace, drop … if exists).
-- L'appli marche AVANT ce script : l'onglet « Autour de moi » dit « Les rencontres ne sont pas encore ouvertes sur ce
-- serveur », la carte « Mon équipe » de la page du jeune aussi ; le staff renseigne déjà « Mon équipe » sur la fiche (clé
-- usualTeam de data, gardée telle quelle par hb_upsert ; le déclencheur ci-dessous la protège ensuite).
-- Jeu de rencontres FICTIVES pour les bases de démonstration : tools/seed-rencontres.ts (à passer APRÈS ce script).
--
-- 1) TABLE hb_rencontres : une rencontre prévue = date et heure de début, lieu (salle, ville, coordonnées), catégorie
--    (U13, U15, U18 au handball ; M13, M15, M18 au volley : src/sportContent.ts), sexe (M, F ; X = mixte), niveau
--    (departemental, regional, national), compétition (libellé), les deux équipes : unité de la structure quand elle est
--    connue, n° de club (7 chiffres), numéro d'équipe (1, 2, 3…) et nom affiché ; live_url (lien de diffusion : étape 2,
--    montré seulement s'il est là) ; source (demo = jeu fictif, gesthand = import à venir, manuel = saisie) ; data (jsonb)
--    pour le reste ; created_at, created_by, updated_at ; deleted (suppression logique).
--    Colonnes réelles pour ce que le serveur cherche (date, lat, lng, catégorie, sexe, niveau, clubs) ; index sur la date
--    et sur la boîte lat / lng.
--    Lecture : le staff (hb_has_role : administrateur, encadrant, observateur), lignes non supprimées ; un compte joueur ne
--    lit rien. Écriture : aucune écriture directe depuis l'appli (revoke all, comme la structure en 044) : le jeu fictif
--    s'écrit depuis le SQL Editor ; l'import Gest'Hand et la saisie passeront plus tard par des fonctions du serveur.
--    Pas de synchronisation sur les appareils : l'appli interroge le serveur à la demande (hb_rencontres_autour) et garde
--    la dernière réponse en mémoire.
-- 2) hb_rencontres_autour(p_lat, p_lng, p_km, p_from, p_to, p_categories, p_sex, p_clubs) : rencontres non supprimées qui
--    commencent dans [p_from, p_to[, à p_km au plus du point (boîte lat / lng d'abord, puis distance à vol d'oiseau par la
--    formule de haversine, sans PostGIS), avec leur distance (km, au dixième) ; 500 au plus, par heure de début, puis
--    distance. Rayon ramené entre 1 et 200 km, période coupée à 62 jours. Filtres facultatifs (null : tout) : catégories,
--    sexe (M ou F ; les rencontres mixtes restent), n° de club (rencontres où joue l'un de ces clubs, d'un côté ou de
--    l'autre). Droits de l'appelant (security invoker) : la règle de lecture s'applique (un joueur reçoit une liste vide).
-- 3) « MON ÉQUIPE » (clé usualTeam des fiches) : { n : 1, 2 ou 3 (son équipe dans la catégorie), level : departemental |
--    regional | national, playsIn : catégorie jouée quand ce n'est pas celle de son âge (surclassement), at : quand (ISO),
--    src : joueur | staff }. « Effacer » = { at, src } sans autre champ (la clé n'est jamais retirée).
--    - Le staff la modifie avec la fiche (formulaire de la fiche, hb_upsert) ;
--    - le jeune la modifie depuis sa page : hb_player_set_team(p_team) → ce qui a été gardé. Comme hb_player_self_update
--      (051), c'est une écriture du serveur, pas du jeune : SA fiche, la seule clé usualTeam, valeurs vérifiées, at posé
--      par le serveur, src = joueur ; fiche avancée (updatedAt, updated_at_client) pour que la synchronisation du staff la
--      reprenne. Refus en clair : pas_joueur, sans_fiche, format, trop_long, fiche_introuvable ;
--    - déclencheur hb_c_player_team_keep (avant insertion ou modification de hb_players ; « c » : après hb_a_player_guard
--      et hb_b_player_self_keep) : la plus récente gagne, POUR CETTE CLÉ : une fiche renvoyée par un appareil qui n'a pas
--      encore reçu le dernier choix (at plus ancien, ou clé absente) garde celle du serveur ; sinon la valeur est nettoyée
--      (champs connus seulement ; at ramené à l'heure du serveur s'il est dans le futur) et src = staff hors des fonctions
--      du joueur. Effacement RGPD de la fiche : rien n'est gardé.
-- CE QUI NE CHANGE PAS : hb_upsert, les règles de lecture des autres tables, le périmètre, l'espace joueur (051 à 053).
-- Retour arrière : drop trigger hb_c_player_team_keep on hb_players ; drop function hb_rencontres_autour,
-- hb_player_set_team, hb_player_team_keep, hb_usual_team_clean, hb_usual_team_at ; drop table hb_rencontres. La clé
-- usualTeam des fiches reste (lue par l'appli, sans effet ailleurs).

-- ---------- 1. Rencontres ----------

create table if not exists public.hb_rencontres (
  id text primary key,
  starts_at timestamptz not null,
  lat double precision not null check (lat between -90 and 90),
  lng double precision not null check (lng between -180 and 180),
  category text not null,
  sex text not null check (sex in ('M', 'F', 'X')),
  level text not null check (level in ('departemental', 'regional', 'national')),
  competition text,
  home_unit_id text,
  home_club text,
  home_team smallint check (home_team between 1 and 9),
  home_name text not null,
  away_unit_id text,
  away_club text,
  away_team smallint check (away_team between 1 and 9),
  away_name text not null,
  venue text,
  city text,
  -- Étape 2 (diffusion) : montré seulement s'il est là ; http(s) seulement.
  live_url text check (live_url is null or live_url ~ '^https?://'),
  source text not null default 'manuel' check (source in ('demo', 'gesthand', 'manuel')),
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  deleted boolean not null default false
);
-- Période (la recherche part toujours d'une période courte) et boîte autour du point.
create index if not exists hb_rencontres_when on public.hb_rencontres (starts_at) where not deleted;
create index if not exists hb_rencontres_box on public.hb_rencontres (lat, lng) where not deleted;
-- Jeu fictif remplacé d'un coup (tools/seed-rencontres.ts), import par source.
create index if not exists hb_rencontres_source on public.hb_rencontres (source);

alter table public.hb_rencontres enable row level security;
-- Ni insertion, ni modification, ni suppression directes depuis l'appli.
revoke all on public.hb_rencontres from public, anon, authenticated;
grant select on public.hb_rencontres to authenticated;
drop policy if exists "staff_read" on public.hb_rencontres;
create policy "staff_read" on public.hb_rencontres for select to authenticated
  using (not deleted and (select public.hb_has_role()));

-- ---------- 2. Autour d'un point ----------

create or replace function public.hb_rencontres_autour(
  p_lat double precision,
  p_lng double precision,
  p_km double precision,
  p_from timestamptz,
  p_to timestamptz,
  p_categories text[] default null,
  p_sex text default null,
  p_clubs text[] default null
) returns table (
  id text,
  starts_at timestamptz,
  lat double precision,
  lng double precision,
  category text,
  sex text,
  level text,
  competition text,
  home_unit_id text,
  home_club text,
  home_team smallint,
  home_name text,
  away_unit_id text,
  away_club text,
  away_team smallint,
  away_name text,
  venue text,
  city text,
  live_url text,
  source text,
  distance_km numeric
)
language sql stable security invoker set search_path = public as $$
  with q as (
    -- Paramètres ramenés à des valeurs raisonnables ; point ou période invalides : aucune ligne.
    select least(greatest(coalesce(p_km, 25), 1), 200) as r_km,
           p_from as t0,
           least(p_to, p_from + interval '62 days') as t1
     where p_lat between -90 and 90 and p_lng between -180 and 180 and p_from is not null and p_to is not null
  ), b as (
    -- Boîte autour du point : 1° de latitude ≈ 111,2 km (en longitude, selon la latitude) ; 110 : boîte un peu plus large
    -- que le cercle, la distance tranche ensuite.
    select q.r_km, q.t0, q.t1, q.r_km / 110.0 as dlat, q.r_km / (110.0 * greatest(cos(radians(p_lat)), 0.01)) as dlng from q
  )
  select r.id, r.starts_at, r.lat, r.lng, r.category, r.sex, r.level, r.competition,
         r.home_unit_id, r.home_club, r.home_team, r.home_name,
         r.away_unit_id, r.away_club, r.away_team, r.away_name,
         r.venue, r.city, r.live_url, r.source, round(d.km::numeric, 1)
    from b
    join public.hb_rencontres r
      on not r.deleted
     and r.starts_at >= b.t0 and r.starts_at < b.t1
     and r.lat between p_lat - b.dlat and p_lat + b.dlat
     and r.lng between p_lng - b.dlng and p_lng + b.dlng
    -- Distance à vol d'oiseau (haversine, rayon moyen de la Terre).
    cross join lateral (select 2 * 6371.0088 * asin(least(1, sqrt(power(sin(radians(r.lat - p_lat) / 2), 2)
                          + cos(radians(p_lat)) * cos(radians(r.lat)) * power(sin(radians(r.lng - p_lng) / 2), 2)))) as km) d
   where d.km <= b.r_km
     and (p_categories is null or r.category = any (p_categories))
     and (p_sex is null or p_sex not in ('M', 'F') or r.sex in (p_sex, 'X'))
     -- Clubs : « in (select unnest(…)) » (table de hachage) plutôt que « = any » : la liste peut compter des milliers de clubs.
     and (p_clubs is null or r.home_club in (select unnest(p_clubs)) or r.away_club in (select unnest(p_clubs)))
   order by r.starts_at, d.km, r.id
   limit 500
$$;

-- ---------- 3. « Mon équipe » (clé usualTeam des fiches) ----------

-- Quand (at) d'une valeur usualTeam : horodatage ISO avec fuseau ; sinon null.
create or replace function public.hb_usual_team_at(p jsonb) returns timestamptz
language plpgsql stable as $$
begin
  if coalesce(jsonb_typeof(p -> 'at'), '') <> 'string'
     or (p ->> 'at') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:?\d{2})$' then
    return null;
  end if;
  return (p ->> 'at')::timestamptz;
exception when others then
  return null;
end $$;

-- Valeur nettoyée : champs connus seulement ; at au format de l'appli (ms, UTC), jamais dans le futur, l'heure du serveur
-- s'il manque ; null si ce n'est pas un objet.
create or replace function public.hb_usual_team_clean(p jsonb) returns jsonb
language sql stable set search_path = public as $$
  select case when jsonb_typeof(p) is distinct from 'object' then null else jsonb_strip_nulls(jsonb_build_object(
    'n', case when jsonb_typeof(p -> 'n') = 'number' and (p ->> 'n') in ('1', '2', '3') then (p ->> 'n')::int end,
    'level', case when p ->> 'level' in ('departemental', 'regional', 'national') then p ->> 'level' end,
    'playsIn', case when jsonb_typeof(p -> 'playsIn') = 'string' and (p ->> 'playsIn') ~ '^[A-Za-z0-9+-]{1,8}$' then p ->> 'playsIn' end,
    'at', to_char(least(coalesce(public.hb_usual_team_at(p), now()), now()) at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'src', case when p ->> 'src' in ('joueur', 'staff') then p ->> 'src' end)) end
$$;

-- La plus récente gagne pour usualTeam (voir l'en-tête, point 3).
create or replace function public.hb_player_team_keep() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_new jsonb;
  v_old jsonb;
  v_new_at timestamptz;
  v_old_at timestamptz;
begin
  -- Effacement RGPD de la fiche : tout part.
  if tg_op = 'UPDATE' and coalesce((new.data ->> 'purged')::boolean, false) then return new; end if;
  v_new := case when new.data ? 'usualTeam' then new.data -> 'usualTeam' end;
  if tg_op = 'UPDATE' and old.data ? 'usualTeam' then v_old := old.data -> 'usualTeam'; end if;
  if v_new is null and v_old is null then return new; end if;
  v_new_at := least(public.hb_usual_team_at(v_new), now());
  v_old_at := public.hb_usual_team_at(v_old);
  -- Appareil pas encore à jour (clé absente, ou choix plus ancien que celui du serveur) : celui du serveur reste.
  if v_old is not null and (v_new is null or coalesce(v_new_at, '-infinity') < coalesce(v_old_at, '-infinity')) then
    new.data := (new.data - 'usualTeam') || jsonb_build_object('usualTeam', v_old);
    return new;
  end if;
  if v_new is not distinct from v_old then return new; end if;
  v_new := public.hb_usual_team_clean(v_new);
  -- Hors des fonctions du joueur (réglage hb.player_self, 051) : c'est le staff qui l'a posé.
  if v_new is not null and current_setting('hb.player_self', true) is distinct from '1' then
    v_new := v_new || '{"src": "staff"}'::jsonb;
  end if;
  new.data := (new.data - 'usualTeam') || case when v_new is null then '{}'::jsonb else jsonb_build_object('usualTeam', v_new) end;
  return new;
end $$;
-- « hb_c_… » : après hb_a_player_guard (051) et hb_b_player_self_keep (052), avant les autres (ordre alphabétique).
drop trigger if exists hb_c_player_team_keep on public.hb_players;
create trigger hb_c_player_team_keep before insert or update on public.hb_players
  for each row execute function public.hb_player_team_keep();

-- Le jeune choisit son équipe depuis sa page (seule écriture : la clé usualTeam de SA fiche). Rend ce qui a été gardé.
create or replace function public.hb_player_set_team(p_team jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_pid text;
  v_team jsonb;
  v_ts bigint;
begin
  if v_uid is null then raise exception 'Connexion requise'; end if;
  select player_id into v_pid from public.hb_profiles where user_id = v_uid and role = 'joueur';
  if not found then raise exception 'pas_joueur'; end if;
  if v_pid is null then raise exception 'sans_fiche'; end if;
  if p_team is not null and jsonb_typeof(p_team) <> 'object' then raise exception 'format'; end if;
  if length(coalesce(p_team::text, '')) > 1000 then raise exception 'trop_long'; end if;
  -- Champs connus seulement ; quand (maintenant) et qui (le joueur) : posés ici, jamais crus de l'appareil.
  v_team := public.hb_usual_team_clean(coalesce(p_team, '{}'::jsonb) - 'at' - 'src') || '{"src": "joueur"}'::jsonb;

  -- Fiche avancée (updatedAt, updated_at_client) : la synchronisation du staff la reprend.
  perform set_config('hb.player_self', '1', true);
  update public.hb_players
     set data = (data - 'usualTeam') || jsonb_build_object('usualTeam', v_team)
                || jsonb_build_object('updatedAt', greatest((extract(epoch from clock_timestamp()) * 1000)::bigint, updated_at_client + 1)),
         updated_at_client = greatest((extract(epoch from clock_timestamp()) * 1000)::bigint, updated_at_client + 1)
   where id = v_pid and not deleted
   returning updated_at_client into v_ts;
  perform set_config('hb.player_self', '0', true);
  if v_ts is null then raise exception 'fiche_introuvable'; end if;
  return v_team;
end $$;

-- ---------- 4. Droits des fonctions ----------

revoke all on function public.hb_rencontres_autour(double precision, double precision, double precision, timestamptz, timestamptz, text[], text, text[]) from public, anon;
grant execute on function public.hb_rencontres_autour(double precision, double precision, double precision, timestamptz, timestamptz, text[], text, text[]) to authenticated;
revoke all on function public.hb_usual_team_at(jsonb) from public, anon, authenticated;
revoke all on function public.hb_usual_team_clean(jsonb) from public, anon, authenticated;
revoke all on function public.hb_player_team_keep() from public, anon, authenticated;
revoke all on function public.hb_player_set_team(jsonb) from public, anon;
grant execute on function public.hb_player_set_team(jsonb) to authenticated;

-- Vérification : la table, sa règle de lecture, les fonctions, le déclencheur ; l'espace joueur (051) est bien là ;
-- rencontres déjà présentes (dont le jeu fictif) et fiches avec « Mon équipe ».
select to_regclass('public.hb_rencontres') is not null as table_rencontres,
       (select count(*) from pg_policies where schemaname = 'public' and tablename = 'hb_rencontres') as regles_sur_1,
       (select count(*) from pg_proc where proname in ('hb_rencontres_autour', 'hb_player_set_team', 'hb_player_team_keep',
                                                       'hb_usual_team_clean', 'hb_usual_team_at')) as fonctions_sur_5,
       (select count(*) from pg_trigger where tgname = 'hb_c_player_team_keep' and not tgisinternal) as declencheur_sur_1,
       (select count(*) from information_schema.columns
         where table_schema = 'public' and table_name = 'hb_profiles' and column_name = 'player_id') as espace_joueur_051,
       (select count(*) from public.hb_rencontres where not deleted) as rencontres,
       (select count(*) from public.hb_rencontres where not deleted and source = 'demo') as rencontres_demo,
       (select count(*) from public.hb_players where not deleted and data ? 'usualTeam') as fiches_avec_equipe;
