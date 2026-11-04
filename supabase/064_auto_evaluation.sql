-- HandBase : ESPACE JOUEUR, AUTO-ÉVALUATION APRÈS UN ÉVÉNEMENT (« Comment ça s'est passé ? » ; idée reprise de « Génération
-- Bleue », vague 2, 04/11). Le jeune dit lui-même comment s'est passé un match, un tournoi ou un stage où il était sur la
-- liste ; le staff lit « Son regard » sur la fiche, à part des avis des observateurs.
-- À exécuter dans Supabase > SQL Editor, APRÈS 063_affichage.sql (il s'appuie sur 051 et 052 : hb_my_player_id,
-- hb_player_self_id, hb_staff_reads_player, hb_player_guard, hb_self_iso) : base de TEST d'abord (vérifier avec la requête de
-- contrôle en fin de fichier), puis les autres. Peut être relancé sans risque (create table if not exists, create or replace,
-- drop … if exists). Additif : une table, sept fonctions (deux appelées par l'appli), deux déclencheurs ; rien d'autre
-- n'est modifié (ni hb_upsert, ni les règles de lecture des autres tables, ni la synchronisation).
-- L'appli marche AVANT ce script : la section « Comment ça s'est passé ? » de la page du jeune et « Son regard » sur la fiche
-- ne s'affichent pas (fonction ou table absente : PGRST202 / PGRST205, repli silencieux) ; rien d'autre ne change.
--
-- LES OBJECTIFS DE TRAVAIL (même vague) n'ont PAS besoin de ce script : ils sont rangés dans la fiche (clé `objectives` de
-- hb_players.data, src/objectives.ts), s'écrivent comme elle (hb_upsert, périmètre : hb_scope_row) et le jeune les lit avec
-- sa fiche (051 : sa ligne, et elle seule ; jamais celle d'un autre).
--
-- PRINCIPE (décidé) : l'auto-évaluation est À LUI. Ce n'est pas un avis : elle n'est pas dans hb_evaluations, ne voyage pas
-- avec la synchronisation du staff, et n'entre jamais dans les moyennes, radars, classements ni exports d'avis. Le jeune ne
-- voit toujours ni les avis des observateurs, ni les événements eux-mêmes : seulement les siens, par la fonction ci-dessous,
-- avec leur nom, leur type, leur date et leur lieu. Une « observation » (type observation) n'est jamais proposée : un jeune
-- observé ne le sait pas forcément.
--
-- CE QUE LE SCRIPT FAIT
-- 1) Table hb_player_selfeval : une ligne par jeune et par événement (clé player_id + event_id : une seule auto-évaluation par
--    événement). scores = { engagement, plaisir, concentration, collectif, progres } : entiers de 1 à 5 (l'appli les montre en
--    mots positifs ou neutres : Un peu, Assez, Bien, Très bien, À fond) ; good (« Ce que j'ai bien réussi ») et work (« Ce
--    que je veux travailler ») : 300 caractères chacun ; event_type, event_date, event_name recopiés à l'enregistrement
--    (l'événement peut changer de nom ou disparaître) ; user_id = le compte qui a écrit ; created_at, updated_at.
--    - LECTURE (règles RLS) : le jeune lit SES lignes (player_id = hb_my_player_id()) ; le staff (hb_has_role()) lit celles des
--      joueurs dont il lit la fiche (hb_staff_reads_player, 052 : périmètre, ou créateur de la fiche). Personne d'autre (anon :
--      aucun droit).
--    - ÉCRITURE : jamais directe (aucun droit insert / update / delete ; hb_player_guard posé aussi) ; le staff n'y écrit
--      jamais ; le jeune passe par hb_player_selfeval_save.
-- 2) hb_player_selfeval_events() → pour le compte joueur relié à une fiche (pas_joueur, sans_fiche sinon) : ses événements
--    (match, tournoi, entrainement ; pas supprimés ; sa fiche dans la liste ; déjà commencés, des 60 derniers jours), plus ceux
--    qu'il a déjà évalués (même plus anciens, ou dont il n'est plus sur la liste : lecture seule), le plus récent en premier,
--    30 au plus : [{ eventId, type, name, date, place, until, open, mine }]. until = dernier jour pour remplir (date + 14) ;
--    open = remplissable aujourd'hui (sur la liste, événement présent, du jour de l'événement à 14 jours après, heure de
--    Paris) ; mine = son auto-évaluation (absente : pas encore). Jamais la liste des autres joueurs, ni les participants du
--    staff, ni aucun avis.
-- 3) hb_player_selfeval_save(p_event_id, p_scores, p_good, p_work) → l'auto-évaluation enregistrée (null : tout était vide, elle
--    est retirée). Contrôles : compte joueur relié (pas_joueur, sans_fiche) ; événement présent, d'un type concerné, sa fiche
--    dans la liste (sinon evenement_inconnu, le même refus dans tous les cas : rien n'est dit d'un événement qui ne le
--    concerne pas) ; pas avant le jour de l'événement (pas_encore) ; pas plus de 14 jours après (fenetre_fermee) ; entrée
--    raisonnable (trop_long). Notes : clés connues, entiers 1 à 5, le reste ignoré ; textes nettoyés (caractères de contrôle
--    retirés, 300 caractères). Toujours SA fiche (jamais un autre player_id : il n'en choisit pas).
-- 4) Fiche effacée (RGPD, « purged ») ou supprimée définitivement : ses auto-évaluations partent avec elle. Fiche fondue dans
--    une autre (hb_merge_players : mergedInto posé) : elles suivent la fiche gardée (celle de la fiche gardée prime pour un
--    même événement). Déclencheur hb_player_selfeval_forget sur hb_players : hb_merge_players n'est pas réécrit.
--
-- Retour arrière : drop trigger if exists hb_player_selfeval_forget on public.hb_players; drop table if exists
-- public.hb_player_selfeval; drop function if exists public.hb_player_selfeval_events(), public.hb_player_selfeval_save(text,
-- jsonb, text, text), public.hb_player_selfeval_forget(), public.hb_selfeval_json(public.hb_player_selfeval) (avant la table),
-- public.hb_se_scores(jsonb), public.hb_se_text(text), public.hb_se_day(text). Les auto-évaluations partent avec la table.

-- ---------- 1. Outils (internes : jamais appelés directement par l'appli) ----------

-- Jour AAAA-MM-JJ → date ; illisible → null (jamais d'erreur).
create or replace function public.hb_se_day(p text) returns date
language plpgsql immutable as $$
begin
  if coalesce(p, '') !~ '^\d{4}-\d{2}-\d{2}$' then return null; end if;
  return p::date;
exception when others then
  return null;
end $$;

-- Notes gardées : les 5 clés connues (mêmes que SELF_EVAL_CRITERIA, src/selfEval.ts), entiers de 1 à 5 ; le reste est ignoré.
create or replace function public.hb_se_scores(p jsonb) returns jsonb
language sql immutable as $$
  select coalesce(jsonb_object_agg(k, (p ->> k)::int), '{}'::jsonb)
    from unnest(array['engagement', 'plaisir', 'concentration', 'collectif', 'progres']) k
   where jsonb_typeof(p) = 'object' and jsonb_typeof(p -> k) = 'number' and (p ->> k) ~ '^[1-5]$'
$$;

-- Texte libre : caractères de contrôle retirés (sauf retours à la ligne et tabulations), bords coupés (espaces, retours à la
-- ligne, tabulations), 300 caractères ; vide → null.
create or replace function public.hb_se_text(p text) returns text
language sql immutable as $$
  select nullif(rtrim(left(btrim(regexp_replace(replace(replace(coalesce(p, ''), E'\r\n', E'\n'), E'\r', E'\n'),
                                               E'[\\x01-\\x08\\x0B\\x0C\\x0E-\\x1F\\x7F]', '', 'g'), E' \t\n'), 300), E' \t\n'), '')
$$;

-- ---------- 2. Table ----------

create table if not exists public.hb_player_selfeval (
  player_id text not null,
  event_id text not null,
  user_id uuid,
  event_type text not null,
  event_date date not null,
  event_name text,
  scores jsonb not null default '{}'::jsonb,
  good text,
  work text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (player_id, event_id)
);
alter table public.hb_player_selfeval drop constraint if exists hb_player_selfeval_forme;
alter table public.hb_player_selfeval add constraint hb_player_selfeval_forme check (
  jsonb_typeof(scores) = 'object' and scores = public.hb_se_scores(scores)
  and event_type in ('match', 'tournoi', 'entrainement')
  and coalesce(length(good), 0) <= 300 and coalesce(length(work), 0) <= 300 and coalesce(length(event_name), 0) <= 120);
create index if not exists hb_player_selfeval_recent on public.hb_player_selfeval (player_id, event_date desc);
alter table public.hb_player_selfeval enable row level security;
-- Lecture seulement (les règles ci-dessous trient) ; aucune écriture directe : seule la fonction du joueur y écrit.
revoke all on public.hb_player_selfeval from public, anon, authenticated;
grant select on public.hb_player_selfeval to authenticated;

-- Le jeune : SES auto-évaluations.
drop policy if exists "player_read" on public.hb_player_selfeval;
create policy "player_read" on public.hb_player_selfeval for select to authenticated
  using (player_id = (select public.hb_my_player_id()));
-- Le staff : celles des joueurs dont il lit la fiche (périmètre, ou fiche créée par lui ; 052).
drop policy if exists "staff_read" on public.hb_player_selfeval;
create policy "staff_read" on public.hb_player_selfeval for select to authenticated
  using (public.hb_staff_reads_player(player_id));

-- Ceinture : aucun compte joueur n'écrit hors de la fonction (comme les autres tables, 051).
drop trigger if exists hb_a_player_guard on public.hb_player_selfeval;
create trigger hb_a_player_guard before insert or update or delete on public.hb_player_selfeval
  for each row execute function public.hb_player_guard();

-- Une auto-évaluation telle que l'appli la reçoit.
create or replace function public.hb_selfeval_json(r public.hb_player_selfeval) returns jsonb
language sql immutable as $$
  select jsonb_strip_nulls(jsonb_build_object('eventId', r.event_id, 'eventType', r.event_type,
           'eventDate', to_char(r.event_date, 'YYYY-MM-DD'), 'eventName', r.event_name, 'scores', r.scores,
           'good', r.good, 'work', r.work, 'at', public.hb_self_iso(r.updated_at)))
$$;

-- ---------- 3. Ses événements (page du jeune) ----------

create or replace function public.hb_player_selfeval_events() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_pid text := public.hb_player_self_id();
  v_day date := (now() at time zone 'Europe/Paris')::date;
begin
  return coalesce((
    select jsonb_agg(x.j order by x.d desc, x.id)
      from (select u.id, u.d, u.j
              from (
                -- Ses événements (sur la liste), déjà commencés : des 60 derniers jours, ou déjà évalués.
                select ev.id, ev.d,
                       jsonb_strip_nulls(jsonb_build_object(
                         'eventId', ev.id, 'type', ev.type, 'name', ev.name, 'date', to_char(ev.d, 'YYYY-MM-DD'), 'place', ev.place,
                         'until', to_char(ev.d + 14, 'YYYY-MM-DD'), 'open', v_day between ev.d and ev.d + 14,
                         'mine', case when m.player_id is not null then public.hb_selfeval_json(m) end)) as j
                  from (select e.id, public.hb_se_day(e.data ->> 'date') as d, e.data ->> 'type' as type,
                               left(coalesce(nullif(btrim(e.data ->> 'name'), ''), 'Événement'), 120) as name,
                               left(nullif(btrim(e.data ->> 'place'), ''), 120) as place
                          from public.hb_events e
                         where not e.deleted and e.data ->> 'type' in ('match', 'tournoi', 'entrainement')
                           and jsonb_typeof(e.data -> 'playerIds') = 'array' and e.data -> 'playerIds' ? v_pid) ev
                  left join public.hb_player_selfeval m on m.player_id = v_pid and m.event_id = ev.id
                 where ev.d is not null and ev.d <= v_day and (ev.d >= v_day - 60 or m.player_id is not null)
                union all
                -- Déjà évalués, mais l'événement n'est plus là pour lui (supprimé, retiré de la liste…) : lecture seule.
                select m.event_id, m.event_date,
                       jsonb_strip_nulls(jsonb_build_object(
                         'eventId', m.event_id, 'type', m.event_type, 'name', coalesce(m.event_name, 'Événement'),
                         'date', to_char(m.event_date, 'YYYY-MM-DD'), 'until', to_char(m.event_date + 14, 'YYYY-MM-DD'),
                         'open', false, 'mine', public.hb_selfeval_json(m)))
                  from public.hb_player_selfeval m
                 where m.player_id = v_pid
                   and not exists (select 1 from public.hb_events e
                                    where e.id = m.event_id and not e.deleted and e.data ->> 'type' in ('match', 'tournoi', 'entrainement')
                                      and jsonb_typeof(e.data -> 'playerIds') = 'array' and e.data -> 'playerIds' ? v_pid
                                      and public.hb_se_day(e.data ->> 'date') <= v_day)
              ) u
             order by u.d desc, u.id
             limit 30) x), '[]'::jsonb);
end $$;

-- ---------- 4. Enregistrer (ou retirer) son auto-évaluation ----------

create or replace function public.hb_player_selfeval_save(p_event_id text, p_scores jsonb, p_good text, p_work text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_pid text := public.hb_player_self_id();
  v_day date := (now() at time zone 'Europe/Paris')::date;
  v_data jsonb;
  v_d date;
  v_scores jsonb;
  v_good text;
  v_work text;
  r public.hb_player_selfeval;
begin
  if length(coalesce(p_scores::text, '')) > 2000 or length(coalesce(p_good, '')) > 4000 or length(coalesce(p_work, '')) > 4000 then
    raise exception 'trop_long';
  end if;
  -- L'événement : présent, d'un type concerné, SA fiche dans la liste. Sinon, le même refus (rien n'est dit de plus).
  select data into v_data from public.hb_events where id = p_event_id and not deleted;
  if v_data is null or coalesce(v_data ->> 'type', '') not in ('match', 'tournoi', 'entrainement')
     or jsonb_typeof(v_data -> 'playerIds') is distinct from 'array' or not (v_data -> 'playerIds' ? v_pid) then
    raise exception 'evenement_inconnu';
  end if;
  v_d := public.hb_se_day(v_data ->> 'date');
  if v_d is null then raise exception 'evenement_inconnu'; end if;
  -- Du jour de l'événement à 14 jours après (heure de Paris).
  if v_day < v_d then raise exception 'pas_encore'; end if;
  if v_day > v_d + 14 then raise exception 'fenetre_fermee'; end if;

  v_scores := public.hb_se_scores(p_scores);
  v_good := public.hb_se_text(p_good);
  v_work := public.hb_se_text(p_work);
  perform set_config('hb.player_self', '1', true);
  -- Tout vide : elle est retirée.
  if v_scores = '{}'::jsonb and v_good is null and v_work is null then
    delete from public.hb_player_selfeval where player_id = v_pid and event_id = p_event_id;
    perform set_config('hb.player_self', '0', true);
    return null;
  end if;
  insert into public.hb_player_selfeval (player_id, event_id, user_id, event_type, event_date, event_name, scores, good, work)
  values (v_pid, p_event_id, auth.uid(), v_data ->> 'type', v_d, left(coalesce(nullif(btrim(v_data ->> 'name'), ''), 'Événement'), 120),
          v_scores, v_good, v_work)
  on conflict (player_id, event_id) do update
     set user_id = excluded.user_id, event_type = excluded.event_type, event_date = excluded.event_date,
         event_name = excluded.event_name, scores = excluded.scores, good = excluded.good, work = excluded.work, updated_at = now()
  returning * into r;
  perform set_config('hb.player_self', '0', true);
  return public.hb_selfeval_json(r);
end $$;

-- ---------- 5. Fiche effacée, supprimée ou fondue ----------

create or replace function public.hb_player_selfeval_forget() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_into text;
begin
  if tg_op = 'DELETE' then
    delete from public.hb_player_selfeval where player_id = old.id;
  elsif coalesce((new.data ->> 'purged')::boolean, false) then
    delete from public.hb_player_selfeval where player_id = new.id;
  elsif coalesce(new.data ->> 'mergedInto', '') <> '' and coalesce(old.data ->> 'mergedInto', '') = '' then
    -- Fusion (hb_merge_players) : elles suivent la fiche gardée ; pour un même événement, celle de la fiche gardée prime.
    v_into := new.data ->> 'mergedInto';
    update public.hb_player_selfeval s set player_id = v_into, updated_at = now()
     where s.player_id = new.id
       and not exists (select 1 from public.hb_player_selfeval t where t.player_id = v_into and t.event_id = s.event_id);
    delete from public.hb_player_selfeval where player_id = new.id;
  end if;
  return null;
end $$;
drop trigger if exists hb_player_selfeval_forget on public.hb_players;
create trigger hb_player_selfeval_forget after update or delete on public.hb_players
  for each row execute function public.hb_player_selfeval_forget();

-- ---------- 6. Droits des fonctions ----------

revoke all on function public.hb_se_day(text) from public, anon, authenticated;
revoke all on function public.hb_se_scores(jsonb) from public, anon, authenticated;
revoke all on function public.hb_se_text(text) from public, anon, authenticated;
revoke all on function public.hb_selfeval_json(public.hb_player_selfeval) from public, anon, authenticated;
revoke all on function public.hb_player_selfeval_forget() from public, anon, authenticated;
revoke all on function public.hb_player_selfeval_events() from public, anon;
revoke all on function public.hb_player_selfeval_save(text, jsonb, text, text) from public, anon;
grant execute on function public.hb_player_selfeval_events() to authenticated;
grant execute on function public.hb_player_selfeval_save(text, jsonb, text, text) to authenticated;

-- ---------- Vérification ----------
-- Table et ses 2 règles, 2 fonctions de l'appli (appelables par un compte connecté, pas par anon), 2 déclencheurs ;
-- auto-évaluations enregistrées (0 au départ).
select to_regclass('public.hb_player_selfeval') is not null as table_ok,
       (select count(*) from pg_policies where schemaname = 'public' and tablename = 'hb_player_selfeval') as regles_sur_2,
       has_function_privilege('authenticated', 'public.hb_player_selfeval_events()', 'execute')
         and has_function_privilege('authenticated', 'public.hb_player_selfeval_save(text, jsonb, text, text)', 'execute') as appli_ok,
       has_function_privilege('anon', 'public.hb_player_selfeval_save(text, jsonb, text, text)', 'execute') as anon_peut_ecrire,
       (select count(*) from pg_trigger where tgname in ('hb_player_selfeval_forget')
           or (tgname = 'hb_a_player_guard' and tgrelid = 'public.hb_player_selfeval'::regclass)) as declencheurs_sur_2,
       (select count(*) from public.hb_player_selfeval) as auto_evaluations;
