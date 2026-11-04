-- HandBase : ESPACE JOUEUR, « MES OBJECTIFS » EN LISTE À COCHER AVEC DES ÉTAPES (04/11). Le jeune ajoute ses propres
-- objectifs (« à moi ») avec leurs étapes et leurs liens vidéo, et coche les étapes, y compris celles des objectifs du staff ;
-- le staff voit tout sur la fiche.
-- À exécuter dans Supabase > SQL Editor, APRÈS 064_auto_evaluation.sql (il s'appuie sur 051 et 052 : hb_my_player_id,
-- hb_player_self_id, hb_staff_reads_player, hb_player_guard, hb_self_iso) : base de TEST d'abord (vérifier avec la requête de
-- contrôle en fin de fichier), puis les autres. Peut être relancé sans risque (create table if not exists, create or replace,
-- drop … if exists). Additif : une table, onze fonctions (une appelée par l'appli), deux déclencheurs ; rien d'autre n'est
-- modifié (ni hb_upsert, ni hb_merge_players, ni les règles de lecture des autres tables, ni la synchronisation).
-- L'appli marche AVANT ce script : sur la page du jeune, « Mes objectifs » reste en lecture (ceux du staff, avec leurs étapes
-- et les coches du staff ; ni « + Ajouter », ni cases à cocher) ; sur la fiche, le staff garde tout (fonction ou table absente :
-- PGRST202 / PGRST205, repli silencieux).
--
-- LES OBJECTIFS DU STAFF et leurs étapes n'ont PAS besoin de ce script : ils restent dans la fiche (clé `objectives` de
-- hb_players.data, chaque objectif avec `steps` : [{ id, text, video?, done? }], src/objectives.ts), écrits comme elle
-- (hb_upsert, périmètre : hb_scope_row), lus par le jeune avec sa fiche (051). Les objectifs enregistrés avant les étapes
-- (sans `steps`) sont lus tels quels.
--
-- PRINCIPE (décidé) : le jeune n'écrit JAMAIS dans la fiche pour ses objectifs. Ce qui est à lui est dans une table à part,
-- écrite seulement par sa fonction : ses objectifs, et ses coches sur les étapes du staff. Il ne peut donc ni modifier ni
-- retirer le texte d'un objectif ou d'une étape du staff, ni cocher un objectif du staff « atteint » (choix par défaut : le
-- staff le coche) ; il coche les étapes du staff. Ce qu'il écrit ne part jamais vers une IA (l'appli : clavier seulement).
--
-- CE QUE LE SCRIPT FAIT
-- 1) Table hb_player_goals : UNE ligne par jeune (clé player_id).
--    own = ses objectifs : tableau de 12 au plus, 5 « en cours » au plus : { id, text (120 car.), status (en_cours | atteint),
--    date?, doneAt?, video?, steps?, from?, due? } ; steps : 8 au plus, { id, text (100 car.), video?, done? } ; video : lien
--    http(s) seulement, 500 caractères au plus ; jours au format AAAA-MM-JJ. Période (src/period.ts) : date = jour où il a été
--    fixé, from = début repoussé (« à partir du … »), due = fin (comprise), tous deux facultatifs et gardés tels quels (jours
--    valables seulement ; l'ordre début / fin est contrôlé par l'appli, la période ne change pas les limites). checks = ses coches sur les étapes du staff :
--    { identifiant d'étape → jour } ; user_id = le compte qui a écrit ; created_at, updated_at. La table vérifie la forme
--    (contrainte hb_player_goals_forme : une valeur toujours nettoyée).
--    - LECTURE (règles RLS) : le jeune lit SA ligne (player_id = hb_my_player_id()) ; le staff (hb_has_role()) lit celle des
--      fiches dont il lit la fiche (hb_staff_reads_player, 052 : périmètre, ou créateur de la fiche). Personne d'autre (anon :
--      aucun droit).
--    - ÉCRITURE : jamais directe (aucun droit insert / update / delete ; hb_player_guard posé aussi) ; le staff n'y écrit
--      jamais ; le jeune passe par hb_player_goals_save.
-- 2) hb_player_goals_save(p_own, p_checks) → ce qui est gardé : { own, checks, at }. Pour le compte joueur relié à une fiche
--    (pas_joueur, sans_fiche sinon), TOUJOURS sa fiche (il ne choisit pas de player_id). p_own : tous ses objectifs (la liste
--    remplace la précédente) ; p_checks : les identifiants des étapes du staff qu'il a cochées. Contrôles : entrée raisonnable
--    (trop_long, format) ; 12 objectifs au plus (trop_d_objectifs) ; 5 en cours au plus (max_en_cours) ; 8 étapes au plus par
--    objectif (trop_d_etapes) ; liens http(s) seulement (lien) ; fiche présente (fiche_introuvable). Textes nettoyés
--    (caractères de contrôle et espaces repliés, longueur coupée), identifiants en double écartés. Coches : seulement des
--    étapes présentes dans les objectifs de SA fiche (le reste est ignoré : jamais un objectif, jamais l'étape d'un autre) ;
--    le jour est posé ici pour une nouvelle coche (heure de Paris), gardé pour une coche déjà là. Tout vide : la ligne est
--    retirée.
-- 3) Fiche effacée (RGPD, « purged ») ou supprimée définitivement : sa ligne part avec elle. Fiche fondue dans une autre
--    (hb_merge_players : mergedInto posé) : elle suit la fiche gardée ; si la fiche gardée a déjà la sienne, les deux se
--    rejoignent (coches réunies ; objectifs de la fiche gardée d'abord, puis ceux de l'autre tant qu'il y a de la place :
--    12 en tout, 5 en cours). Déclencheur hb_player_goals_forget sur hb_players : hb_merge_players n'est pas réécrit.
--
-- Retour arrière : drop trigger if exists hb_player_goals_forget on public.hb_players; drop function if exists
-- public.hb_player_goals_json(public.hb_player_goals); drop table if exists public.hb_player_goals; drop function if exists
-- public.hb_player_goals_save(jsonb, jsonb), public.hb_player_goals_forget(), public.hb_go_clean_own(jsonb),
-- public.hb_go_clean_steps(jsonb), public.hb_go_clean_checks(jsonb), public.hb_go_active(jsonb), public.hb_go_bad_url(jsonb),
-- public.hb_go_url(text), public.hb_go_text(text, int), public.hb_go_str(jsonb, text), public.hb_go_day(text). Les objectifs
-- « à moi » et les coches du jeune partent avec la table.

-- ---------- 1. Outils (internes : jamais appelés directement par l'appli) ----------

-- Valeur d'une clé si c'est un texte JSON (un nombre, un objet : null).
create or replace function public.hb_go_str(p jsonb, k text) returns text
language sql immutable as $$
  select case when jsonb_typeof(p) = 'object' and jsonb_typeof(p -> k) = 'string' then p ->> k end
$$;

-- Jour AAAA-MM-JJ valable → le même texte ; sinon null (jamais d'erreur).
create or replace function public.hb_go_day(p text) returns text
language plpgsql immutable as $$
begin
  if coalesce(p, '') !~ '^\d{4}-\d{2}-\d{2}$' then return null; end if;
  perform p::date;
  return p;
exception when others then
  return null;
end $$;

-- Texte court : caractères de contrôle et espaces repliés en un espace, bords coupés, n caractères au plus (re-coupé après) ;
-- vide → null. Même règle que l'appli (cleanShortText, src/objectives.ts).
create or replace function public.hb_go_text(p text, n int) returns text
language sql immutable as $$
  select nullif(btrim(left(btrim(regexp_replace(coalesce(p, ''), '[\s\x01-\x1f\x7f]+', ' ', 'g')), n)), '')
$$;

-- Lien vidéo : http ou https seulement, sans espace ni guillemet, 500 caractères au plus ; sinon null.
create or replace function public.hb_go_url(p text) returns text
language sql immutable as $$
  select case when length(btrim(coalesce(p, ''))) between 1 and 500
               and btrim(p) ~* '^https?://[^\s<>"''\\/][^\s<>"''\\]*$' then btrim(p) end
$$;

-- Un lien est-il refusé ? (absent ou vide : non.)
create or replace function public.hb_go_bad_url(p jsonb) returns boolean
language sql immutable as $$
  select p is not null and jsonb_typeof(p) <> 'null'
     and (jsonb_typeof(p) <> 'string' or (btrim(p #>> '{}') <> '' and public.hb_go_url(p #>> '{}') is null))
$$;

-- Étapes : objets { id, text, video?, done? } ; identifiants courts et sans doublon ; texte obligatoire ; 8 au plus.
create or replace function public.hb_go_clean_steps(p jsonb) returns jsonb
language plpgsql immutable as $$
declare
  r jsonb := '[]'::jsonb;
  s jsonb;
  v_id text;
  v_text text;
  v_seen text[] := '{}';
begin
  if jsonb_typeof(p) is distinct from 'array' then return '[]'::jsonb; end if;
  for s in select e.value from jsonb_array_elements(p) with ordinality e(value, n) order by e.n loop
    exit when jsonb_array_length(r) >= 8;
    v_id := public.hb_go_str(s, 'id');
    v_text := public.hb_go_text(public.hb_go_str(s, 'text'), 100);
    continue when v_id is null or v_id !~ '^[A-Za-z0-9_-]{1,40}$' or v_text is null or v_id = any (v_seen);
    v_seen := v_seen || v_id;
    r := r || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
           'id', v_id, 'text', v_text, 'video', public.hb_go_url(public.hb_go_str(s, 'video')),
           'done', public.hb_go_day(public.hb_go_str(s, 'done')))));
  end loop;
  return r;
end $$;

-- Ses objectifs : 12 au plus, 5 en cours au plus (les suivants écartés), identifiants sans doublon, texte obligatoire ;
-- doneAt seulement s'il est atteint ; étapes nettoyées (clé absente s'il n'y en a pas) ; période (from, due) : jours
-- valables seulement. Même règle que l'appli (cleanMyGoals, src/myGoals.ts ; cleanPeriod, src/period.ts).
create or replace function public.hb_go_clean_own(p jsonb) returns jsonb
language plpgsql immutable as $$
declare
  r jsonb := '[]'::jsonb;
  o jsonb;
  v_id text;
  v_text text;
  v_status text;
  v_steps jsonb;
  v_seen text[] := '{}';
  v_active int := 0;
begin
  if jsonb_typeof(p) is distinct from 'array' then return '[]'::jsonb; end if;
  for o in select e.value from jsonb_array_elements(p) with ordinality e(value, n) order by e.n loop
    exit when jsonb_array_length(r) >= 12;
    v_id := public.hb_go_str(o, 'id');
    v_text := public.hb_go_text(public.hb_go_str(o, 'text'), 120);
    continue when v_id is null or v_id !~ '^[A-Za-z0-9_-]{1,40}$' or v_text is null or v_id = any (v_seen);
    v_status := case when public.hb_go_str(o, 'status') = 'atteint' then 'atteint' else 'en_cours' end;
    if v_status = 'en_cours' then
      continue when v_active >= 5;
      v_active := v_active + 1;
    end if;
    v_seen := v_seen || v_id;
    v_steps := public.hb_go_clean_steps(o -> 'steps');
    r := r || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
           'id', v_id, 'text', v_text, 'status', v_status,
           'date', public.hb_go_day(public.hb_go_str(o, 'date')),
           'doneAt', case when v_status = 'atteint' then public.hb_go_day(public.hb_go_str(o, 'doneAt')) end,
           'video', public.hb_go_url(public.hb_go_str(o, 'video')),
           'steps', case when jsonb_array_length(v_steps) > 0 then v_steps end,
           'from', public.hb_go_day(public.hb_go_str(o, 'from')),
           'due', public.hb_go_day(public.hb_go_str(o, 'due')))));
  end loop;
  return r;
end $$;

-- Objectifs en cours dans une liste déjà propre.
create or replace function public.hb_go_active(p jsonb) returns int
language sql immutable as $$
  select count(*)::int from jsonb_array_elements(case when jsonb_typeof(p) = 'array' then p else '[]'::jsonb end) o
   where o ->> 'status' = 'en_cours'
$$;

-- Coches : { identifiant d'étape → jour } valables seulement, 200 au plus (par identifiant).
create or replace function public.hb_go_clean_checks(p jsonb) returns jsonb
language sql immutable as $$
  select coalesce(jsonb_object_agg(k, v), '{}'::jsonb)
    from (select e.key as k, e.value #>> '{}' as v
            from jsonb_each(case when jsonb_typeof(p) = 'object' then p else '{}'::jsonb end) e
           where e.key ~ '^[A-Za-z0-9_-]{1,40}$' and jsonb_typeof(e.value) = 'string' and public.hb_go_day(e.value #>> '{}') is not null
           order by e.key
           limit 200) x
$$;

-- ---------- 2. Table ----------

create table if not exists public.hb_player_goals (
  player_id text primary key,
  user_id uuid,
  own jsonb not null default '[]'::jsonb,
  checks jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.hb_player_goals drop constraint if exists hb_player_goals_forme;
alter table public.hb_player_goals add constraint hb_player_goals_forme check (
  jsonb_typeof(own) = 'array' and own = public.hb_go_clean_own(own) and length(own::text) <= 80000
  and jsonb_typeof(checks) = 'object' and checks = public.hb_go_clean_checks(checks));
alter table public.hb_player_goals enable row level security;
-- Lecture seulement (les règles ci-dessous trient) ; aucune écriture directe : seule la fonction du joueur y écrit.
revoke all on public.hb_player_goals from public, anon, authenticated;
grant select on public.hb_player_goals to authenticated;

-- Le jeune : SA ligne.
drop policy if exists "player_read" on public.hb_player_goals;
create policy "player_read" on public.hb_player_goals for select to authenticated
  using (player_id = (select public.hb_my_player_id()));
-- Le staff : celle des joueurs dont il lit la fiche (périmètre, ou fiche créée par lui ; 052).
drop policy if exists "staff_read" on public.hb_player_goals;
create policy "staff_read" on public.hb_player_goals for select to authenticated
  using (public.hb_staff_reads_player(player_id));

-- Ceinture : aucun compte joueur n'écrit hors de la fonction (comme les autres tables, 051).
drop trigger if exists hb_a_player_guard on public.hb_player_goals;
create trigger hb_a_player_guard before insert or update or delete on public.hb_player_goals
  for each row execute function public.hb_player_guard();

-- Une ligne telle que l'appli la reçoit.
create or replace function public.hb_player_goals_json(r public.hb_player_goals) returns jsonb
language sql immutable as $$
  select jsonb_build_object('own', coalesce(r.own, '[]'::jsonb), 'checks', coalesce(r.checks, '{}'::jsonb),
                            'at', public.hb_self_iso(r.updated_at))
$$;

-- ---------- 3. Enregistrer ses objectifs et ses coches (page du jeune) ----------

create or replace function public.hb_player_goals_save(p_own jsonb, p_checks jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_pid text := public.hb_player_self_id();
  v_day text := to_char((now() at time zone 'Europe/Paris')::date, 'YYYY-MM-DD');
  v_in jsonb := coalesce(p_own, '[]'::jsonb);
  v_own jsonb;
  v_staff text[];
  v_old jsonb;
  v_checks jsonb := '{}'::jsonb;
  k text;
  r public.hb_player_goals;
begin
  if length(coalesce(p_own::text, '')) > 80000 or length(coalesce(p_checks::text, '')) > 20000 then raise exception 'trop_long'; end if;
  if jsonb_typeof(v_in) <> 'array' or (p_checks is not null and jsonb_typeof(p_checks) not in ('array', 'null')) then raise exception 'format'; end if;
  if jsonb_array_length(v_in) > 12 then raise exception 'trop_d_objectifs'; end if;
  -- Refus en clair plutôt qu'un objectif écarté sans rien dire.
  if (select count(*) from jsonb_array_elements(v_in) o
       where public.hb_go_text(public.hb_go_str(o, 'text'), 120) is not null and public.hb_go_str(o, 'status') is distinct from 'atteint') > 5 then
    raise exception 'max_en_cours';
  end if;
  if exists (select 1 from jsonb_array_elements(v_in) o
              where jsonb_typeof(o -> 'steps') = 'array'
                and (select count(*) from jsonb_array_elements(o -> 'steps') s where public.hb_go_text(public.hb_go_str(s, 'text'), 100) is not null) > 8) then
    raise exception 'trop_d_etapes';
  end if;
  if exists (select 1 from jsonb_array_elements(v_in) o
              where jsonb_typeof(o) = 'object'
                and (public.hb_go_bad_url(o -> 'video')
                     or exists (select 1 from jsonb_array_elements(case when jsonb_typeof(o -> 'steps') = 'array' then o -> 'steps' else '[]'::jsonb end) s
                                 where jsonb_typeof(s) = 'object' and public.hb_go_bad_url(s -> 'video')))) then
    raise exception 'lien';
  end if;
  if not exists (select 1 from public.hb_players where id = v_pid and not deleted) then raise exception 'fiche_introuvable'; end if;

  v_own := public.hb_go_clean_own(v_in);
  -- Étapes des objectifs du staff sur SA fiche : les seules qu'il peut cocher.
  select coalesce(array_agg(distinct s ->> 'id'), '{}') into v_staff
    from public.hb_players p
   cross join lateral jsonb_array_elements(case when jsonb_typeof(p.data -> 'objectives') = 'array' then p.data -> 'objectives' else '[]'::jsonb end) o
   cross join lateral jsonb_array_elements(case when jsonb_typeof(o -> 'steps') = 'array' then o -> 'steps' else '[]'::jsonb end) s
   where p.id = v_pid and not p.deleted and jsonb_typeof(s -> 'id') = 'string';
  select checks into v_old from public.hb_player_goals where player_id = v_pid;
  if jsonb_typeof(p_checks) = 'array' then
    for k in select distinct e #>> '{}' from jsonb_array_elements(p_checks) e where jsonb_typeof(e) = 'string' loop
      continue when not (k = any (v_staff));
      v_checks := v_checks || jsonb_build_object(k, coalesce(public.hb_go_day(v_old ->> k), v_day));
    end loop;
  end if;
  v_checks := public.hb_go_clean_checks(v_checks);

  perform set_config('hb.player_self', '1', true);
  -- Tout vide : la ligne est retirée.
  if jsonb_array_length(v_own) = 0 and v_checks = '{}'::jsonb then
    delete from public.hb_player_goals where player_id = v_pid;
    perform set_config('hb.player_self', '0', true);
    return jsonb_build_object('own', '[]'::jsonb, 'checks', '{}'::jsonb);
  end if;
  insert into public.hb_player_goals (player_id, user_id, own, checks)
  values (v_pid, auth.uid(), v_own, v_checks)
  on conflict (player_id) do update set user_id = excluded.user_id, own = excluded.own, checks = excluded.checks, updated_at = now()
  returning * into r;
  perform set_config('hb.player_self', '0', true);
  return public.hb_player_goals_json(r);
end $$;

-- ---------- 4. Fiche effacée, supprimée ou fondue ----------

create or replace function public.hb_player_goals_forget() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_into text;
  a public.hb_player_goals;
  b public.hb_player_goals;
  v_own jsonb;
  v_active int;
  o jsonb;
begin
  if tg_op = 'DELETE' then
    delete from public.hb_player_goals where player_id = old.id;
  elsif coalesce((new.data ->> 'purged')::boolean, false) then
    delete from public.hb_player_goals where player_id = new.id;
  elsif coalesce(new.data ->> 'mergedInto', '') <> '' and coalesce(old.data ->> 'mergedInto', '') = '' then
    -- Fusion (hb_merge_players) : elle suit la fiche gardée.
    v_into := new.data ->> 'mergedInto';
    select * into a from public.hb_player_goals where player_id = new.id;
    if not found then return null; end if;
    select * into b from public.hb_player_goals where player_id = v_into;
    if not found then
      update public.hb_player_goals set player_id = v_into, updated_at = now() where player_id = new.id;
      return null;
    end if;
    -- Les deux ont la leur : celle de la fiche gardée d'abord, puis l'autre tant qu'il y a de la place (12, dont 5 en cours).
    v_own := b.own;
    v_active := public.hb_go_active(b.own);
    for o in select e.value from jsonb_array_elements(a.own) with ordinality e(value, n) order by e.n loop
      exit when jsonb_array_length(v_own) >= 12;
      continue when exists (select 1 from jsonb_array_elements(v_own) x where x ->> 'id' = o ->> 'id');
      if o ->> 'status' = 'en_cours' then
        continue when v_active >= 5;
        v_active := v_active + 1;
      end if;
      v_own := v_own || jsonb_build_array(o);
    end loop;
    update public.hb_player_goals
       set own = public.hb_go_clean_own(v_own), checks = public.hb_go_clean_checks(a.checks || b.checks), updated_at = now()
     where player_id = v_into;
    delete from public.hb_player_goals where player_id = new.id;
  end if;
  return null;
end $$;
drop trigger if exists hb_player_goals_forget on public.hb_players;
create trigger hb_player_goals_forget after update or delete on public.hb_players
  for each row execute function public.hb_player_goals_forget();

-- ---------- 5. Droits des fonctions ----------

revoke all on function public.hb_go_str(jsonb, text) from public, anon, authenticated;
revoke all on function public.hb_go_day(text) from public, anon, authenticated;
revoke all on function public.hb_go_text(text, int) from public, anon, authenticated;
revoke all on function public.hb_go_url(text) from public, anon, authenticated;
revoke all on function public.hb_go_bad_url(jsonb) from public, anon, authenticated;
revoke all on function public.hb_go_clean_steps(jsonb) from public, anon, authenticated;
revoke all on function public.hb_go_clean_own(jsonb) from public, anon, authenticated;
revoke all on function public.hb_go_active(jsonb) from public, anon, authenticated;
revoke all on function public.hb_go_clean_checks(jsonb) from public, anon, authenticated;
revoke all on function public.hb_player_goals_json(public.hb_player_goals) from public, anon, authenticated;
revoke all on function public.hb_player_goals_forget() from public, anon, authenticated;
revoke all on function public.hb_player_goals_save(jsonb, jsonb) from public, anon;
grant execute on function public.hb_player_goals_save(jsonb, jsonb) to authenticated;

-- ---------- Vérification ----------
-- Attendu : t 2 t f 2 0 (table et ses 2 règles, la fonction de l'appli appelable par un compte connecté mais pas par anon,
-- 2 déclencheurs, aucune ligne au départ).
select to_regclass('public.hb_player_goals') is not null as table_ok,
       (select count(*) from pg_policies where schemaname = 'public' and tablename = 'hb_player_goals') as regles_sur_2,
       has_function_privilege('authenticated', 'public.hb_player_goals_save(jsonb, jsonb)', 'execute') as appli_ok,
       has_function_privilege('anon', 'public.hb_player_goals_save(jsonb, jsonb)', 'execute') as anon_peut_ecrire,
       (select count(*) from pg_trigger where tgname = 'hb_player_goals_forget'
           or (tgname = 'hb_a_player_guard' and tgrelid = 'public.hb_player_goals'::regclass)) as declencheurs_sur_2,
       (select count(*) from public.hb_player_goals) as lignes;
