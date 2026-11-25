-- HandBase : lecture par périmètre INDEXÉE (joueurs, mesures, avis, « vu ») pour les comptes qui ne voient pas tout.
-- À exécuter une fois dans Supabase > SQL Editor, APRÈS 057_synchro_legere.sql (base de test d'abord, puis la réelle).
-- Peut être relancé sans risque (add column if not exists, create index if not exists, create or replace).
--
-- POURQUOI (essai de charge du 29/10, série 6 : 5 000 appareils tiennent, 10 000 cassent, processeur plein) : les requêtes
-- les plus coûteuses sont les lectures par pages de hb_measurements, hb_seen et hb_players. La règle de lecture de ces
-- tables (046, staff_read) est « rôle du staff ET (tout OU département couvert OU club couvert OU auteur) » : un OU entre
-- quatre conditions, dont l'auteur lu dans le JSON (data ->> 'createdBy'). Postgres ne peut s'en servir pour choisir un
-- index : il parcourt la table dans l'ordre de server_updated_at (index hb_<table>_sua) et écarte une à une les lignes hors
-- périmètre. Un compte de club, qui voit 0,1 % des joueurs d'une base nationale (500 000 licenciés), lit donc presque toute
-- la table pour remplir une page de 1 000 lignes, à chaque page et à chaque appareil.
--
-- 1) COLONNE created_by (copie de data ->> 'createdBy', colonne générée, comme hb_assignments.user_id en 057) sur hb_players,
--    hb_measurements, hb_evaluations et hb_seen. Rien ne change pour les écritures : elle se calcule seule (après les
--    déclencheurs BEFORE : hb_stamp pose createdBy, la colonne suit). Ajouter une colonne générée RÉÉCRIT la table (verrou
--    exclusif le temps de la réécriture : quelques secondes pour 500 000 joueurs, plus pour des millions de mesures ; à
--    passer hors des heures d'usage). L'heure serveur des lignes ne bouge pas (aucun déclencheur ne tourne) : les appareils
--    ne retéléchargent rien.
-- 2) INDEX (partiels : seulement les lignes qui ont la valeur) sur ces quatre tables :
--      (scope_club, server_updated_at, id)   lignes d'un club
--      (scope_dept, server_updated_at, id)   lignes d'un département
--      (created_by, server_updated_at, id)   lignes d'un auteur
--    Chacun rend directement, dans l'ordre de la synchronisation, les lignes d'une valeur depuis un curseur.
-- 3) hb_lire_perimetre(p_table, p_curseur, p_limite) : une page (au plus p_limite lignes, 1 000 au plus, server_updated_at >=
--    p_curseur, triées par server_updated_at puis id), EXACTEMENT celle que rendrait la lecture directe
--      select id, data, server_updated_at from hb_<table> where server_updated_at >= p_curseur
--       order by server_updated_at, id limit p_limite
--    mais lue par les index : pour chaque club du périmètre, chaque département, puis l'auteur (et, pour hb_players, la
--    fiche d'un compte joueur), les p_limite premières lignes depuis le curseur, réunies puis triées ; les p_limite
--    premières de l'ensemble sont la page. Comptes qui voient tout (administrateur, niveau Fédération) : la lecture directe,
--    inchangée (rien à gagner, tout est visible).
--    SÉCURITÉ, par construction :
--     - SECURITY INVOKER : la fonction lit avec les droits ET LES RÈGLES DE LECTURE du compte connecté (staff_read de 046,
--       player_self_read de 051, et toute règle future) ; elle ne peut rien rendre que la lecture directe ne rendrait pas.
--       Les conditions d'index ne font que RESTREINDRE ce que les règles laissent passer (pour choisir les index) ;
--     - périmètre : celui des règles, calculé par les MÊMES fonctions (hb_scope_all, hb_scope_clubs, hb_scope_depts → hb_my_scope
--       → hb_scope_of, 046/047), jamais un paramètre venu de l'appareil (seuls la table, le curseur et la taille de la page) ;
--     - rôle : vérifié par les règles elles-mêmes (hb_has_role, 029/051) ; un compte joueur ou sans rôle ne reçoit que ce
--       qu'il recevrait déjà (sa fiche, ou rien) ;
--     - liste blanche des tables (players, measurements, evaluations, seen) ; search_path fixé (public, pg_temp) ; nom de
--       table passé par format(%I) ;
--     - complétude : pour un compte qui ne voit pas tout, staff_read = département OU club OU auteur, et chaque branche lit
--       une de ces conditions : l'union des branches couvre tout ce que la règle laisse lire. Vérifié ligne pour ligne par
--       tools/essai-sql-058 (8 comptes, toutes les tailles de page, égalités d'heure), avec un contre-essai qui montre que
--       l'essai attrape une fuite et un oubli.
--    « À revoir » (hb_rewatch) : règle plus étroite (041, staff de l'auteur) : pas concerné, lecture inchangée. Vidéos,
--    suivis : inchangés.
-- 4) PAGES SUIVANTES (appli, src/sync.ts et src/syncLive.ts, readScopedPages) : l'appareil redemande « server_updated_at >=
--    heure de la dernière ligne reçue » (et non plus « > heure, ou = heure et id > dernier id », qui n'est pas lisible par un
--    index sur trois colonnes avec un OU) et écarte lui-même les lignes de cette heure déjà reçues. Une page PLEINE dont
--    toutes les lignes ont la même heure (import de masse) : l'appareil repasse, pour la page suivante, à l'ancien filtre
--    (lecture directe de la table), sinon il redemanderait la même page sans fin.
-- 5) L'appli (même version) : nouvelle lecture pour les comptes qui ne voient pas tout (périmètre connu sur l'appareil, ou
--    pas encore connu), ancienne lecture pour les autres ; fonction absente (script pas passé) : ancienne lecture, on réessaie
--    une heure plus tard. Les règles de lecture, les écritures, les signaux en direct et « quoi de neuf ? » ne changent pas.
-- MESURE (tools/essai-sql-058/lancer.sh --mesure, Postgres 16 jetable, données fictives : 500 000 joueurs, 3 M de mesures,
-- 1 M de « vu » ; une page de 1 000 lignes, sous les règles de lecture, cache chaud) :
--      compte de club, 1re page de mesures   2 176 ms, 3 010 057 blocs  →  0,6 ms, 493 blocs
--      compte de club, 1re page de joueurs     281 ms,   501 827 blocs  →  0,4 ms,  89 blocs
--      compte de club, 1re page de « vu »      573 ms, 1 003 611 blocs  →  0,4 ms, 162 blocs
--      comité (1 département), mesures, page suivante  105 ms → 0,8 ms ; ligue (6 départements) 16 ms → 3,7 ms
--      administrateur : inchangé (0,4 ms, lecture directe). Passage du script sur ce jeu : 27 s.
-- Dépend de : 046/047 (colonnes scope_dept / scope_club, hb_scope_*), 051 (hb_my_player_id), 057 (aucune dépendance stricte).
-- Annulation : section « RETOUR ARRIÈRE » à la fin (commentée).

-- ---------- 1 et 2. Colonne created_by et index ----------

do $$
declare t text;
begin
  foreach t in array array['players', 'measurements', 'evaluations', 'seen'] loop
    if to_regclass('public.hb_' || t) is null then continue; end if; -- table absente (041 pas passé pour « vu »)
    execute format('alter table public.hb_%1$s add column if not exists created_by text generated always as (data ->> %2$L) stored',
                   t, 'createdBy');
    execute format('create index if not exists hb_%1$s_club_sua on public.hb_%1$s (scope_club, server_updated_at, id) where scope_club is not null', t);
    execute format('create index if not exists hb_%1$s_dept_sua on public.hb_%1$s (scope_dept, server_updated_at, id) where scope_dept is not null', t);
    execute format('create index if not exists hb_%1$s_auteur_sua on public.hb_%1$s (created_by, server_updated_at, id) where created_by is not null', t);
    execute format('analyze public.hb_%1$s', t);
  end loop;
end $$;

-- ---------- 3. Lecture par périmètre ----------

-- Voir le point 3 de l'en-tête. Appelée par l'appli : supabase.rpc('hb_lire_perimetre', { p_table, p_curseur, p_limite }).
-- Chaque branche est une lecture d'index ordonnée et limitée (unnest + lateral : une lecture par club ou département) ; les
-- règles de lecture s'appliquent dans chaque branche AVANT sa limite (ce sont des conditions de la table) : chaque branche
-- rend donc ses p_limite premières lignes VISIBLES, et les p_limite premières de leur union sont celles de la lecture directe.
-- enable_bitmapscan = off (pour les seules requêtes de la fonction) : Postgres ne sait pas estimer la part des lignes que
-- laissent passer les règles de lecture (paramètres inconnus au moment du plan) ; pour un département de ~5 000 joueurs, il
-- préférait lire TOUTES ses lignes (index de 046 sur scope_dept seul) puis trier, au lieu de lire dans l'ordre les 1 000
-- premières (index ci-dessus) : 5 fois plus de blocs à l'essai (tools/essai-sql-058, mesure). Sans effet sur le résultat.
create or replace function public.hb_lire_perimetre(p_table text, p_curseur timestamptz, p_limite integer default 1000)
returns table (id text, data jsonb, server_updated_at timestamptz)
language plpgsql stable security invoker set search_path = public, pg_temp set enable_bitmapscan = off as $$
declare
  v_lim integer := least(greatest(coalesce(p_limite, 1000), 1), 1000);
  v_cur timestamptz := coalesce(p_curseur, '-infinity'::timestamptz);
  v_rel text;
begin
  if auth.uid() is null then raise exception 'Connexion requise'; end if;
  if p_table is null or p_table not in ('players', 'measurements', 'evaluations', 'seen') then
    raise exception 'hb_lire_perimetre : table non prise en charge (%)', coalesce(p_table, 'null');
  end if;
  v_rel := 'hb_' || p_table;
  -- Tout est visible (administrateur, niveau Fédération) : la lecture directe, celle d'avant (index hb_<table>_sua).
  if public.hb_scope_all() then
    return query execute format(
      'select t.id, t.data, t.server_updated_at from public.%I t
        where t.server_updated_at >= $1 order by t.server_updated_at, t.id limit $2', v_rel)
      using v_cur, v_lim;
    return;
  end if;
  -- Sinon : clubs, départements, auteur (et fiche du compte joueur), chacun par son index ; les règles de lecture filtrent
  -- chaque branche. $3 / $4 / $5 / $6 : le périmètre et l'identité du compte connecté, calculés ici, jamais par l'appareil.
  return query execute format($f$
    select u.id, u.data, u.server_updated_at
      from (
        select distinct on (x.server_updated_at, x.id) x.id, x.data, x.server_updated_at
          from (
            select c.id, c.data, c.server_updated_at
              from unnest($3::text[]) k(v)
              cross join lateral (
                select t.id, t.data, t.server_updated_at from public.%1$I t
                 where t.scope_club = k.v and t.server_updated_at >= $1
                 order by t.server_updated_at, t.id limit $2) c
            union all
            select d.id, d.data, d.server_updated_at
              from unnest($4::text[]) k(v)
              cross join lateral (
                select t.id, t.data, t.server_updated_at from public.%1$I t
                 where t.scope_dept = k.v and t.server_updated_at >= $1
                 order by t.server_updated_at, t.id limit $2) d
            union all
            (select t.id, t.data, t.server_updated_at from public.%1$I t
              where t.created_by = $5 and t.server_updated_at >= $1
              order by t.server_updated_at, t.id limit $2)
            %2$s
          ) x
         order by x.server_updated_at, x.id
      ) u
     order by u.server_updated_at, u.id
     limit $2
  $f$, v_rel,
    -- Compte joueur (051) : sa fiche (règle player_self_read) ; pour les autres comptes, $6 est null : rien.
    case when p_table = 'players' then
      'union all (select t.id, t.data, t.server_updated_at from public.hb_players t where t.id = $6 and t.server_updated_at >= $1)'
    else '' end)
    using v_cur, v_lim, public.hb_scope_clubs(), public.hb_scope_depts(), auth.uid()::text, public.hb_my_player_id();
end $$;
revoke all on function public.hb_lire_perimetre(text, timestamptz, integer) from public, anon;
grant execute on function public.hb_lire_perimetre(text, timestamptz, integer) to authenticated;

-- ---------- Vérification (lecture seule) ----------
-- Attendu : colonnes_4 = 4, index_12 = 12, fonction = t, invoker = t, search_path = t.
select (select count(*) from pg_attribute
         where attrelid in (to_regclass('public.hb_players'), to_regclass('public.hb_measurements'),
                            to_regclass('public.hb_evaluations'), to_regclass('public.hb_seen'))
           and attname = 'created_by' and attgenerated = 's' and not attisdropped) as colonnes_4,
       (select count(*) from pg_indexes
         where schemaname = 'public' and indexname ~ '^hb_(players|measurements|evaluations|seen)_(club|dept|auteur)_sua$') as index_12,
       to_regprocedure('public.hb_lire_perimetre(text, timestamptz, integer)') is not null as fonction,
       (select not prosecdef from pg_proc where oid = to_regprocedure('public.hb_lire_perimetre(text, timestamptz, integer)')) as invoker,
       (select proconfig @> array['search_path=public, pg_temp'] from pg_proc
         where oid = to_regprocedure('public.hb_lire_perimetre(text, timestamptz, integer)')) as search_path;

-- Ce que lit un compte (remplacer <uuid> ; tout est annulé à la fin) : les deux lectures doivent rendre les mêmes lignes.
-- begin;
--   select set_config('request.jwt.claims', json_build_object('sub', '<uuid>', 'role', 'authenticated')::text, true);
--   set local role authenticated;
--   explain analyze select * from public.hb_lire_perimetre('measurements', '-infinity', 1000);
--   explain analyze select id, data, server_updated_at from public.hb_measurements
--     where server_updated_at >= '-infinity' order by server_updated_at, id limit 1000;
-- rollback;

-- ---------- RETOUR ARRIÈRE (à lancer seulement pour annuler ce script ; l'appli repasse d'elle-même à l'ancienne lecture) ----------
-- drop function if exists public.hb_lire_perimetre(text, timestamptz, integer);
-- do $$
-- declare t text;
-- begin
--   foreach t in array array['players', 'measurements', 'evaluations', 'seen'] loop
--     if to_regclass('public.hb_' || t) is null then continue; end if;
--     execute format('drop index if exists public.hb_%1$s_club_sua, public.hb_%1$s_dept_sua, public.hb_%1$s_auteur_sua', t);
--     execute format('alter table public.hb_%1$s drop column if exists created_by', t);
--   end loop;
-- end $$;
