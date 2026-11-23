-- HandBase / Nextar : ALERTES WELLNESS SUR « MES SUIVIS » (23/11, choix validés par Geoffroy).
-- À exécuter APRÈS 073_wellness.sql (hb_wellness, hb_wellness_actif, hb_wl_auj, hb_wl_json, hb_wl_contient,
-- hb_wl_groupe_compte, hb_wl_staff_de), 032 (hb_follows), 026 / 027 / 033 / 067 (hb_notifications, hb_notify,
-- hb_set_notif_prefs) et 034 / 046 (hb_participant_of, hb_scope_has). Base de TEST d'abord (requête de contrôle en fin de
-- fichier). Peut être relancé sans risque (create table if not exists, create or replace, drop … if exists).
-- ADDITIF : une table personnelle, des fonctions, une tâche programmée ; hb_set_notif_prefs reprise (préférence
-- « wellness » en plus). Ni hb_upsert, ni la synchronisation, ni les tables du wellness, ni hb_wellness_staff_lit ne
-- changent. L'appli marche AVANT ce script : la fonction absente (PGRST202), l'encart de « Mes suivis » se tait.
--
-- PRINCIPE
--  - Chaque compte du staff (administrateur, encadrant) règle PLUSIEURS alertes sur les joueurs qu'il suit : un nom,
--    allumée ou non, une cible (tous mes suivis, ou un groupe suivi) et une règle (src/wellnessAlerts.ts, même règle) :
--      seuil   { type, note, max, jours }    note (moyenne, energie, fraicheur, humeur, sommeil) à max (1 à 9) ou moins ;
--      douleur { type, jours }               douleur signalée ;
--      chute   { type, note, baisse, jours } note à baisse (1 à 9) points au moins sous la moyenne du jeune sur les 14 jours
--                                            (calendrier) qui précèdent le premier jour de la série, 3 réponses au moins
--                                            (série : les k derniers jours demandés, k le plus grand possible) ;
--      silence { type, jours }               pas de réponse un jour demandé (fiche reliée à un espace joueur ; jamais avant
--                                            que le wellness lui soit demandé : wellnessSince du groupe, lien du compte) ;
--    chacune pendant jours (1 à 10) jours DEMANDÉS de suite. Jours demandés : lundi → vendredi, sans les jours fériés ni,
--    quand la zone de l'installation est réglée (hb_config « lampe » : zone, pont), les vacances scolaires (mêmes dates que
--    SCHOOL_HOLIDAYS de src/lamp.ts : tools/test-alertes-wellness.ts compare). Série : aujourd'hui pas encore répondu →
--    elle s'arrête à hier ; jour non demandé sauté ; jour demandé sans réponse : la coupe (sauf « silence », qui le compte).
--  - Les RÉGLAGES (nom, règle, cible) ne sont pas des données de santé : table hb_wellness_alertes, PERSONNELLE (chacun
--    lit, crée, modifie, supprime les siennes ; personne d'autre, pas même un administrateur), écriture directe.
--  - Le CALCUL est fait ici, jamais sur l'appareil : hb_wla_calcul(compte) ne regarde que les suivis dont CE compte lit déjà
--    le wellness (même règle que hb_wellness_staff_lit de 073 : administrateur, ou encadrant du staff d'un groupe où le
--    wellness est activé, qui compte pour la fiche, et qui lit la fiche) et ne rend que « quelle alerte, quel suivi, depuis
--    combien de jours » : jamais une note, jamais une douleur.
--  - Suivis (comme « Mes suivis », src/follows.ts, et 033) : suivi direct ; groupe suivi personnellement et encore visible ;
--    groupe « suivi par le staff » (teamFollow) dont le compte est le créateur ou un participant. Membres d'un groupe Pôle :
--    hb_wl_contient (période de pôle en cours). Seules les fiches reliées à un espace joueur peuvent avoir du wellness.
--  - Notification : chaque jour demandé vers 8 h (heure de Paris), UN résumé par compte qui a au moins une alerte en cours,
--    sans nom ni note : « 2 alertes wellness sur tes suivis », lien vers « Mes suivis » ; préférence « wellness »
--    (Réglages → Notifications) ; « ne pas déranger » : la fonction « notify » le garde jusqu'à la fin du créneau. Un résumé
--    d'un autre jour jamais parti est retiré (jamais envoyé en retard).
-- Aucune donnée n'est envoyée à une IA. Retour arrière : section « RETOUR ARRIÈRE » à la fin (commentée).

-- ---------- 0. Prérequis ----------
do $$
begin
  if to_regprocedure('public.hb_wl_groupe_compte(jsonb, boolean, public.hb_players, date)') is null
     or to_regprocedure('public.hb_wl_staff_de(jsonb, uuid)') is null or to_regprocedure('public.hb_wl_json(public.hb_wellness)') is null
     or to_regclass('public.hb_follows') is null
     or to_regprocedure('public.hb_notify(uuid, text, text, text, text, text, text)') is null then
    raise exception '080 demande 026, 032 et 073 (hb_notify, hb_follows, hb_wellness) : passer d''abord les scripts d''avant.';
  end if;
end $$;

-- ---------- 1. Constantes (mêmes valeurs que src/wellnessAlerts.ts) ----------

create or replace function public.hb_wla_types() returns text[] language sql immutable as $$
  select array['seuil', 'douleur', 'chute', 'silence'] $$;
create or replace function public.hb_wla_notes() returns text[] language sql immutable as $$
  select array['moyenne', 'energie', 'fraicheur', 'humeur', 'sommeil'] $$;
-- Jours demandés de suite : 1 à RULE_DAYS_MAX (10).
create or replace function public.hb_wla_jours_max() returns int language sql immutable as $$ select 10 $$;
-- Seuil et baisse : 1 à 9 (RULE_MAX_MAX, RULE_DROP_MAX).
create or replace function public.hb_wla_points_max() returns int language sql immutable as $$ select 9 $$;
-- Chute : moyenne de référence sur 14 jours (DROP_BASE_DAYS), 3 réponses au moins (DROP_BASE_MIN).
create or replace function public.hb_wla_base_jours() returns int language sql immutable as $$ select 14 $$;
create or replace function public.hb_wla_base_min() returns int language sql immutable as $$ select 3 $$;
-- Une série regarde 30 jours au plus en arrière (LOOKBACK_DAYS) ; réponses lues : 50 derniers jours.
create or replace function public.hb_wla_recul() returns int language sql immutable as $$ select 30 $$;
create or replace function public.hb_wla_fenetre() returns int language sql immutable as $$ select 50 $$;
-- Alertes au plus par compte (RULES_PER_ACCOUNT) ; nom : 40 caractères (RULE_NAME_MAX).
create or replace function public.hb_wla_max_regles() returns int language sql immutable as $$ select 20 $$;

-- ---------- 2. Réglages relus (même règle que cleanRule et cleanRuleName, src/wellnessAlerts.ts) ----------

-- Règle valable, réduite à ses clés ; illisible : null.
create or replace function public.hb_wla_regle(p jsonb) returns jsonb
language sql immutable as $$
  select case
    when jsonb_typeof(p) is distinct from 'object' or jsonb_typeof(p -> 'jours') is distinct from 'number'
         or (p ->> 'jours') !~ '^[0-9]+$' or (p ->> 'jours')::int not between 1 and public.hb_wla_jours_max() then null
    when p ->> 'type' = 'seuil' and jsonb_typeof(p -> 'note') = 'string' and p ->> 'note' = any (public.hb_wla_notes())
         and jsonb_typeof(p -> 'max') = 'number' and (p ->> 'max') ~ '^[0-9]+$' and (p ->> 'max')::int between 1 and public.hb_wla_points_max()
      then jsonb_build_object('type', 'seuil', 'note', p ->> 'note', 'max', (p ->> 'max')::int, 'jours', (p ->> 'jours')::int)
    when p ->> 'type' = 'chute' and jsonb_typeof(p -> 'note') = 'string' and p ->> 'note' = any (public.hb_wla_notes())
         and jsonb_typeof(p -> 'baisse') = 'number' and (p ->> 'baisse') ~ '^[0-9]+$' and (p ->> 'baisse')::int between 1 and public.hb_wla_points_max()
      then jsonb_build_object('type', 'chute', 'note', p ->> 'note', 'baisse', (p ->> 'baisse')::int, 'jours', (p ->> 'jours')::int)
    when p ->> 'type' in ('douleur', 'silence') then jsonb_build_object('type', p ->> 'type', 'jours', (p ->> 'jours')::int)
  end
$$;

-- Nom : caractères de contrôle et espaces répétés → une espace, 40 caractères, bords coupés.
create or replace function public.hb_wla_nom(p text) returns text
language sql immutable as $$
  select btrim(left(btrim(regexp_replace(coalesce(p, ''), '[[:cntrl:][:space:]]+', ' ', 'g')), 40))
$$;

-- Compte du staff (administrateur ou encadrant) : seul à régler des alertes (un observateur ne lit jamais le wellness).
create or replace function public.hb_wla_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.hb_profiles where user_id = auth.uid() and role in ('admin', 'preparateur'))
$$;

-- ---------- 3. Table des alertes réglées ----------

create table if not exists public.hb_wellness_alertes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  nom text not null,
  actif boolean not null default true,
  regle jsonb not null,
  -- null : tous mes suivis ; sinon l'identifiant d'un groupe (sans lien : un groupe supprimé ne casse rien).
  cible text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.hb_wellness_alertes drop constraint if exists hb_wellness_alertes_forme;
alter table public.hb_wellness_alertes add constraint hb_wellness_alertes_forme check (
  nom <> '' and nom = public.hb_wla_nom(nom)
  and public.hb_wla_regle(regle) is not distinct from regle and regle is not null
  and (cible is null or cible ~ '^[A-Za-z0-9_.:-]{1,100}$'));
create index if not exists hb_wellness_alertes_compte on public.hb_wellness_alertes (user_id);
alter table public.hb_wellness_alertes enable row level security;

-- PERSONNEL : les siennes seulement, avec un rôle du staff.
drop policy if exists "own_select" on public.hb_wellness_alertes;
create policy "own_select" on public.hb_wellness_alertes for select to authenticated
  using (user_id = (select auth.uid()) and (select public.hb_wla_staff()));
drop policy if exists "own_insert" on public.hb_wellness_alertes;
create policy "own_insert" on public.hb_wellness_alertes for insert to authenticated
  with check (user_id = (select auth.uid()) and (select public.hb_wla_staff()));
drop policy if exists "own_update" on public.hb_wellness_alertes;
create policy "own_update" on public.hb_wellness_alertes for update to authenticated
  using (user_id = (select auth.uid()) and (select public.hb_wla_staff()))
  with check (user_id = (select auth.uid()) and (select public.hb_wla_staff()));
drop policy if exists "own_delete" on public.hb_wellness_alertes;
create policy "own_delete" on public.hb_wellness_alertes for delete to authenticated
  using (user_id = (select auth.uid()) and (select public.hb_wla_staff()));
revoke all on public.hb_wellness_alertes from public, anon, authenticated;
grant select, insert, update, delete on public.hb_wellness_alertes to authenticated;

-- Garde : nom et règle nettoyés (refus « nom » / « regle »), compte et création jamais changés, horloge du serveur,
-- 20 alertes au plus par compte (« trop_d_alertes »).
create or replace function public.hb_wellness_alertes_garde() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.nom := public.hb_wla_nom(new.nom);
  if new.nom = '' then raise exception 'nom'; end if;
  new.regle := public.hb_wla_regle(new.regle);
  if new.regle is null then raise exception 'regle'; end if;
  new.cible := nullif(btrim(coalesce(new.cible, '')), '');
  if tg_op = 'INSERT' then
    new.user_id := coalesce(auth.uid(), new.user_id);
    new.created_at := now();
    if (select count(*) from public.hb_wellness_alertes where user_id = new.user_id) >= public.hb_wla_max_regles() then
      raise exception 'trop_d_alertes';
    end if;
  else
    new.user_id := old.user_id;
    new.created_at := old.created_at;
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists hb_wellness_alertes_garde on public.hb_wellness_alertes;
create trigger hb_wellness_alertes_garde before insert or update on public.hb_wellness_alertes
  for each row execute function public.hb_wellness_alertes_garde();

-- ---------- 4. Jours demandés (même règle que isRequestedDay, src/lamp.ts) ----------

-- Dimanche de Pâques (Meeus / Butcher, comme easter() de src/lamp.ts).
create or replace function public.hb_wla_paques(y int) returns date
language plpgsql immutable as $$
declare
  a int := y % 19; b int := y / 100; c int := y % 100; d int := b / 4; e int := b % 4; f int := (b + 8) / 25;
  g int := (b - f + 1) / 3; h int := (19 * a + b - d - g + 15) % 30; i int := c / 4; k int := c % 4;
  l int := (32 + 2 * e + 2 * i - h - k) % 7; m int := (a + 11 * h + 22 * l) / 451;
begin
  return make_date(y, (h + l - 7 * m + 114) / 31, ((h + l - 7 * m + 114) % 31) + 1);
end $$;

-- Jours fériés de la métropole (comme publicHolidays() de src/lamp.ts).
create or replace function public.hb_wla_feries(y int) returns date[]
language sql immutable as $$
  select array[make_date(y, 1, 1), make_date(y, 5, 1), make_date(y, 5, 8), make_date(y, 7, 14), make_date(y, 8, 15),
               make_date(y, 11, 1), make_date(y, 11, 11), make_date(y, 12, 25),
               public.hb_wla_paques(y) + 1, public.hb_wla_paques(y) + 39, public.hb_wla_paques(y) + 50]
$$;

-- Vacances scolaires (MÊMES LIGNES que SCHOOL_HOLIDAYS de src/lamp.ts, une par vacances : tools/test-alertes-wellness.ts
-- les compare ; à compléter chaque année aux deux endroits). zone null : toutes les zones ; facultatif : le pont.
create or replace function public.hb_wla_vacances() returns table (nom text, zone text, debut date, fin date, facultatif boolean)
language sql immutable as $$
  select x.nom, x.zone, x.debut::date, x.fin::date, x.facultatif from (values
    ('toussaint', null, '2026-10-17', '2026-11-01', false),
    ('noel', null, '2026-12-19', '2027-01-03', false),
    ('hiver', 'A', '2027-02-13', '2027-02-28', false),
    ('hiver', 'B', '2027-02-20', '2027-03-07', false),
    ('hiver', 'C', '2027-02-06', '2027-02-21', false),
    ('printemps', 'A', '2027-04-10', '2027-04-25', false),
    ('printemps', 'B', '2027-04-17', '2027-05-02', false),
    ('printemps', 'C', '2027-04-03', '2027-04-18', false),
    ('ascension', null, '2027-05-06', '2027-05-09', true),
    ('ete', null, '2027-07-03', '2027-08-31', false)
  ) as x(nom, zone, debut, fin, facultatif)
$$;

-- Jour demandé : lundi → vendredi, pas férié ; zone connue (A, B, C) : pas en vacances (le pont : si p_pont).
create or replace function public.hb_wla_demande(p_jour date, p_zone text, p_pont boolean) returns boolean
language sql immutable as $$
  select extract(isodow from p_jour) between 1 and 5
     and not (p_jour = any (public.hb_wla_feries(extract(year from p_jour)::int)))
     and not (coalesce(p_zone, '') in ('A', 'B', 'C') and exists (
           select 1 from public.hb_wla_vacances() v
            where (v.zone is null or v.zone = p_zone) and (not v.facultatif or coalesce(p_pont, true))
              and p_jour between v.debut and v.fin))
$$;

-- Zone et pont de l'installation (réglage « lampe », 074 ; absent : zone inconnue, pont compté).
create or replace function public.hb_wla_zone() returns text
language sql stable security definer set search_path = public as $$
  select z from (select data -> 'value' ->> 'zone' as z from public.hb_config where id = 'lampe' and not deleted) x where z in ('A', 'B', 'C')
$$;
create or replace function public.hb_wla_pont() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select data -> 'value' -> 'pont' is distinct from 'false'::jsonb from public.hb_config where id = 'lampe' and not deleted), true)
$$;

-- Jours demandés de p_de à p_a (compris), dans l'ordre.
create or replace function public.hb_wla_jours_demandes(p_de date, p_a date) returns date[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(d::date order by d), '{}')
    from generate_series(p_de, p_a, interval '1 day') d
   where public.hb_wla_demande(d::date, public.hb_wla_zone(), public.hb_wla_pont())
$$;

-- ---------- 5. Le calcul (même règle que ruleStreak, src/wellnessAlerts.ts, et streakBack, src/wellnessAlert.ts) ----------

-- Valeur d'un jour : une note, ou la moyenne des notes données ce jour-là (null : pas de valeur).
create or replace function public.hb_wla_valeur(e jsonb, p_note text) returns numeric
language sql immutable as $$
  select case
    when e is null or jsonb_typeof(e -> 'scores') is distinct from 'object' then null
    when p_note = 'moyenne' then (select avg((e -> 'scores' ->> k)::numeric) from unnest(array['energie', 'fraicheur', 'humeur', 'sommeil']) k
                                   where jsonb_typeof(e -> 'scores' -> k) = 'number')
    when jsonb_typeof(e -> 'scores' -> p_note) = 'number' then (e -> 'scores' ->> p_note)::numeric
  end
$$;

-- Jours de la série en cours pour une règle (nombre). p_jours : réponses [{ day, scores, pain }] (hb_wl_json) ; p_demandes :
-- jours demandés de la fenêtre ; p_compte : fiche reliée à un espace joueur ; p_debut : premier jour où le wellness lui est
-- demandé (null : inconnu). Pure : tools/essai-sql-080 la compare à ruleStreak sur les mêmes cas.
create or replace function public.hb_wla_serie(p_regle jsonb, p_jours jsonb, p_auj date, p_demandes date[], p_compte boolean, p_debut date)
returns int
language plpgsql immutable as $$
declare
  v_type text := p_regle ->> 'type';
  v_note text := coalesce(p_regle ->> 'note', 'moyenne');
  v_par jsonb;
  v_d date;
  v_e jsonb;
  v_v numeric;
  v_n int := 0;
  v_jours date[] := '{}';
  v_vals numeric[] := '{}';
  v_base numeric;
  v_ok boolean;
  k int;
  j int;
begin
  -- Réponses par jour (jusqu'à aujourd'hui).
  select coalesce(jsonb_object_agg(x ->> 'day', x), '{}'::jsonb) into v_par
    from jsonb_array_elements(case when jsonb_typeof(p_jours) = 'array' then p_jours else '[]'::jsonb end) x
   where jsonb_typeof(x) = 'object' and (x ->> 'day') ~ '^\d{4}-\d{2}-\d{2}$' and (x ->> 'day')::date <= p_auj;
  if v_type = 'silence' and not coalesce(p_compte, false) then return 0; end if;
  -- Départ : aujourd'hui s'il a répondu ; aujourd'hui demandé sans réponse encore : hier.
  v_d := p_auj;
  if p_auj = any (p_demandes) and not (v_par ? to_char(p_auj, 'YYYY-MM-DD')) then v_d := p_auj - 1; end if;
  for i in 0 .. public.hb_wla_recul() - 1 loop
    if v_d = any (p_demandes) then
      v_e := v_par -> to_char(v_d, 'YYYY-MM-DD');
      if v_type = 'seuil' then
        v_v := public.hb_wla_valeur(v_e, v_note);
        exit when v_v is null or v_v > (p_regle ->> 'max')::numeric + 1e-9;
      elsif v_type = 'douleur' then
        exit when v_e is null or v_e -> 'pain' is distinct from 'true'::jsonb;
      elsif v_type = 'silence' then
        exit when v_e is not null or (p_debut is not null and v_d < p_debut);
      elsif v_type = 'chute' then
        v_v := public.hb_wla_valeur(v_e, v_note);
        exit when v_v is null;
        v_jours := v_jours || v_d;
        v_vals := v_vals || v_v;
      else
        return 0;
      end if;
      v_n := v_n + 1;
    end if;
    v_d := v_d - 1;
  end loop;
  if v_type <> 'chute' then return v_n; end if;
  -- Chute : la PLUS LONGUE série (les k derniers jours demandés) dont chaque jour est à « baisse » points au moins sous la
  -- moyenne des 14 jours (calendrier) qui précèdent son premier jour, 3 réponses au moins ; une plus courte qui échoue (sa
  -- référence contient les premiers jours bas) n'arrête pas la recherche.
  v_n := 0;
  for k in 1 .. coalesce(array_length(v_jours, 1), 0) loop
    v_base := null;
    select avg(v) into v_base from (
      select public.hb_wla_valeur(e.value, v_note) as v
        from jsonb_each(v_par) e
       where e.key::date between v_jours[k] - public.hb_wla_base_jours() and v_jours[k] - 1) x
     where v is not null
    having count(*) >= public.hb_wla_base_min();
    continue when v_base is null;
    v_ok := true;
    for j in 1 .. k loop
      if v_vals[j] > v_base - (p_regle ->> 'baisse')::numeric + 1e-9 then v_ok := false; end if;
    end loop;
    if v_ok then v_n := k; end if;
  end loop;
  return v_n;
end $$;

-- Alertes en cours d'un compte : { lus: [fiches suivies dont il lit le wellness], alertes: [{ alerte, joueur, jours }] }.
-- Rien pour un compte sans rôle du staff ou quand le wellness est fermé. Lecture : même règle que hb_wellness_staff_lit
-- (073) pour ce compte, groupes du staff et périmètre calculés une fois.
create or replace function public.hb_wla_calcul(p_uid uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_auj date := public.hb_wl_auj();
  v_role text;
  v_sg jsonb[];
  v_demandes date[];
  v_silence boolean;
  v_lus jsonb := '[]'::jsonb;
  v_alertes jsonb := '[]'::jsonb;
  v_regles jsonb;
  v_jours jsonb;
  v_debut date;
  v_n int;
  c record;
  r jsonb;
begin
  select role into v_role from public.hb_profiles where user_id = p_uid;
  if p_uid is null or coalesce(v_role, '') not in ('admin', 'preparateur') or not public.hb_wellness_actif() then
    return jsonb_build_object('lus', '[]'::jsonb, 'alertes', '[]'::jsonb);
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'regle', a.regle, 'cible', a.cible) order by a.created_at, a.id), '[]'::jsonb)
    into v_regles from public.hb_wellness_alertes a where a.user_id = p_uid and a.actif;
  v_silence := exists (select 1 from jsonb_array_elements(v_regles) x where x -> 'regle' ->> 'type' = 'silence');
  -- Groupes où ce compte est du staff et où le wellness est activé (administrateur : sans objet).
  if v_role <> 'admin' then
    select coalesce(array_agg(g.data), '{}') into v_sg from public.hb_groups g
     where not g.deleted and g.data -> 'wellness' = 'true'::jsonb and public.hb_wl_staff_de(g.data, p_uid);
  end if;
  v_demandes := public.hb_wla_jours_demandes(v_auj - public.hb_wla_fenetre(), v_auj);
  for c in
    with fg as materialized (
      -- Groupes suivis : personnellement (encore visibles), ou par le staff (créateur ou participant).
      select g.id, g.data from public.hb_groups g
       where not g.deleted
         and ((exists (select 1 from public.hb_follows f
                        where not f.deleted and f.data ->> 'kind' = 'group' and f.data ->> 'createdBy' = p_uid::text
                          and f.data ->> 'targetId' = g.id)
               and (g.data ->> 'createdBy' = p_uid::text
                    or (not coalesce((g.data ->> 'private')::boolean, false)
                        and (not coalesce((g.data ->> 'team')::boolean, false) or public.hb_participant_of(g.data, p_uid)))))
              or (g.data -> 'teamFollow' = 'true'::jsonb and not coalesce((g.data ->> 'private')::boolean, false)
                  and (g.data ->> 'createdBy' = p_uid::text or public.hb_participant_of(g.data, p_uid))))),
    dp as materialized (
      select distinct f.data ->> 'targetId' as pid from public.hb_follows f
       where not f.deleted and f.data ->> 'kind' = 'player' and f.data ->> 'createdBy' = p_uid::text),
    cand as materialized (
      -- Fiches reliées à un espace joueur (elles seules ont du wellness), et le premier lien.
      select pr.player_id as id, min(pr.player_linked_at) as lie from public.hb_profiles pr
       where pr.role = 'joueur' and pr.player_id is not null group by pr.player_id),
    s as materialized (
      select p as pl, x.lie,
             coalesce((select array_agg(fg.id order by fg.id) from fg where public.hb_wl_contient(fg.data, p.id, p.data, v_auj)), '{}') as groupes,
             exists (select 1 from dp where dp.pid = p.id) as direct
        from cand x join public.hb_players p on p.id = x.id and not p.deleted and coalesce(p.data ->> 'mergedInto', '') = '')
    select (s.pl).id as id, s.pl, s.lie, s.groupes from s where s.direct or cardinality(s.groupes) > 0 order by (s.pl).id
  loop
    -- Lit-il le wellness de cette fiche ? (hb_wellness_staff_lit, pour ce compte.)
    if v_role <> 'admin' and not (
         cardinality(v_sg) > 0
         and public.hb_scope_has(p_uid, (c.pl).scope_dept, (c.pl).scope_club, (c.pl).data ->> 'createdBy')
         and exists (select 1 from unnest(v_sg) d where public.hb_wl_groupe_compte(d, false, c.pl, v_auj))) then
      continue;
    end if;
    v_lus := v_lus || to_jsonb(c.id);
    continue when jsonb_array_length(v_regles) = 0;
    select coalesce(jsonb_agg(public.hb_wl_json(w)), '[]'::jsonb) into v_jours from public.hb_wellness w
     where w.player_id = c.id and w.jour between v_auj - public.hb_wla_fenetre() and v_auj;
    v_debut := null;
    if v_silence then
      -- Premier jour où le wellness lui est demandé : le plus ancien « wellnessSince » des groupes activés qui le
      -- contiennent, et pas avant le lien de son espace joueur.
      select min((g.data ->> 'wellnessSince')::date) into v_debut from public.hb_groups g
       where not g.deleted and g.data -> 'wellness' = 'true'::jsonb and not coalesce((g.data ->> 'archived')::boolean, false)
         and (g.data ->> 'wellnessSince') ~ '^\d{4}-\d{2}-\d{2}$' and public.hb_wl_contient(g.data, c.id, (c.pl).data, v_auj);
      v_debut := greatest(v_debut, (c.lie at time zone 'Europe/Paris')::date);
    end if;
    for r in select x from jsonb_array_elements(v_regles) x loop
      continue when r ->> 'cible' is not null and not ((r ->> 'cible') = any (c.groupes));
      v_n := public.hb_wla_serie(r -> 'regle', v_jours, v_auj, v_demandes, true, v_debut);
      if v_n >= (r -> 'regle' ->> 'jours')::int then
        v_alertes := v_alertes || jsonb_build_array(jsonb_build_object('alerte', r ->> 'id', 'joueur', c.id, 'jours', v_n));
      end if;
    end loop;
  end loop;
  return jsonb_build_object('lus', v_lus, 'alertes', v_alertes);
end $$;

-- ---------- 6. Pour l'appli : les alertes du compte connecté ----------

create or replace function public.hb_wellness_alertes_moi() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('actif', public.hb_wellness_actif(), 'jour', to_char(public.hb_wl_auj(), 'YYYY-MM-DD'))
         || public.hb_wla_calcul(auth.uid())
$$;

-- ---------- 7. Le résumé du matin (pg_cron) ----------

-- Un résumé par compte (alertes allumées, téléphone abonné, préférence « wellness » non coupée, pas déjà fait ce jour) :
-- « N alertes wellness sur tes suivis », jamais un nom ni une note. Seulement un jour demandé, à 8 h (heure de Paris) ;
-- p_force : n'importe quand (essai à la main). Rend le nombre de résumés mis en file.
create or replace function public.hb_wellness_alertes_quotidien(p_force boolean default false) returns int
language plpgsql security definer set search_path = public as $$
declare
  v_auj date := public.hb_wl_auj();
  v_cle text := 'wellness:' || to_char(public.hb_wl_auj(), 'YYYY-MM-DD');
  u uuid;
  n int;
  k int := 0;
begin
  -- Un résumé d'un autre jour jamais parti (envoi coupé) : retiré, jamais envoyé en retard.
  delete from public.hb_notifications where kind = 'wellness' and sent_at is null and group_key <> v_cle;
  if not public.hb_wellness_actif() then return 0; end if;
  if not coalesce(p_force, false)
     and (extract(hour from now() at time zone 'Europe/Paris') <> 8 or not public.hb_wla_demande(v_auj, public.hb_wla_zone(), public.hb_wla_pont())) then
    return 0;
  end if;
  for u in
    select distinct a.user_id from public.hb_wellness_alertes a
      join public.hb_profiles pr on pr.user_id = a.user_id and pr.role in ('admin', 'preparateur')
     where a.actif and coalesce((pr.notif ->> 'wellness')::boolean, true)
       and exists (select 1 from public.hb_push_subs s where s.user_id = a.user_id)
       and not exists (select 1 from public.hb_notifications x where x.user_id = a.user_id and x.group_key = v_cle)
  loop
    n := jsonb_array_length(public.hb_wla_calcul(u) -> 'alertes');
    if n > 0 then
      perform public.hb_notify(u, 'wellness', v_cle, 'Alertes wellness',
        n || case when n > 1 then ' alertes wellness sur tes suivis' else ' alerte wellness sur tes suivis' end, null, '/suivis');
      k := k + 1;
    end if;
  end loop;
  return k;
end $$;

-- ---------- 8. Préférence « wellness » (reprise de 067) ----------

create or replace function public.hb_set_notif_prefs(p_prefs jsonb) returns void
language sql security definer set search_path = public as $$
  update public.hb_profiles
     set notif = (select coalesce(jsonb_object_agg(key, value), '{}'::jsonb) from jsonb_each(coalesce(p_prefs, '{}'::jsonb))
                   where (key in ('avis', 'fiche', 'participant', 'rappel', 'alerte', 'quiet', 'suivi', 'proposition', 'wellness') and jsonb_typeof(value) = 'boolean')
                      or (key in ('quietFrom', 'quietTo') and jsonb_typeof(value) = 'number'
                          and (value #>> '{}')::numeric between 0 and 23 and (value #>> '{}')::numeric = trunc((value #>> '{}')::numeric)))
   where user_id = auth.uid()
$$;

-- ---------- 9. Droits des fonctions ----------

do $$
declare f text;
begin
  -- Internes : jamais appelées par l'appli (le calcul pour un autre compte, le résumé, les outils).
  foreach f in array array['public.hb_wla_types()', 'public.hb_wla_base_jours()', 'public.hb_wla_base_min()', 'public.hb_wla_recul()',
      'public.hb_wla_fenetre()', 'public.hb_wla_max_regles()', 'public.hb_wla_paques(int)',
      'public.hb_wla_feries(int)', 'public.hb_wla_vacances()', 'public.hb_wla_demande(date, text, boolean)', 'public.hb_wla_zone()',
      'public.hb_wla_pont()', 'public.hb_wla_jours_demandes(date, date)', 'public.hb_wla_valeur(jsonb, text)',
      'public.hb_wla_serie(jsonb, jsonb, date, date[], boolean, date)', 'public.hb_wla_calcul(uuid)',
      'public.hb_wellness_alertes_quotidien(boolean)', 'public.hb_wellness_alertes_garde()'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
  -- Appelées par l'appli, par les règles ou par la contrainte de la table (compte connecté), jamais par anon. Les quatre
  -- dernières sont pures (forme d'une règle, d'un nom).
  foreach f in array array['public.hb_wellness_alertes_moi()', 'public.hb_wla_staff()', 'public.hb_set_notif_prefs(jsonb)',
      'public.hb_wla_regle(jsonb)', 'public.hb_wla_nom(text)', 'public.hb_wla_notes()', 'public.hb_wla_jours_max()',
      'public.hb_wla_points_max()'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

-- ---------- 10. Tâche programmée ----------
-- Chaque jour à 6 h 02 et 7 h 02 UTC : la fonction ne fait rien hors de 8 h heure de Paris (heure d'été et d'hiver
-- couvertes) ni un jour non demandé ; une seule fois par compte et par jour. L'envoi reste celui de la tâche
-- « handbase-notify » (026, toutes les 2 minutes, fonction « notify ») : voir « ACTIVATION ».
do $$
begin
  perform cron.unschedule('handbase-wellness-alertes') where exists (select 1 from cron.job where jobname = 'handbase-wellness-alertes');
  perform cron.schedule('handbase-wellness-alertes', '2 6,7 * * *', 'select public.hb_wellness_alertes_quotidien()');
  raise notice 'Tâche programmée : résumé des alertes wellness, chaque jour demandé vers 8 h (Paris).';
exception when others then
  raise notice 'Tâche non programmée (%) : activer pg_cron, puis relancer ce script.', sqlerrm;
end $$;

-- ---------- Vérification ----------
-- Attendu : table_ok t, regles_sur_4 4, garde_1 1, rls t, appli_ok t, anon_0 f, calcul_ferme f (le calcul pour un autre
-- compte n'est pas ouvert à l'appli), tache_1 1, alertes (0 au départ), paques_2027 2027-03-28, demande_lundi t, ferie_f f.
select to_regclass('public.hb_wellness_alertes') is not null as table_ok,
       (select count(*) from pg_policies where schemaname = 'public' and tablename = 'hb_wellness_alertes') as regles_sur_4,
       (select count(*) from pg_trigger where tgname = 'hb_wellness_alertes_garde') as garde_1,
       (select relrowsecurity from pg_class where oid = 'public.hb_wellness_alertes'::regclass) as rls,
       has_function_privilege('authenticated', 'public.hb_wellness_alertes_moi()', 'execute') as appli_ok,
       has_function_privilege('anon', 'public.hb_wellness_alertes_moi()', 'execute') as anon_0,
       has_function_privilege('authenticated', 'public.hb_wla_calcul(uuid)', 'execute')
         or has_function_privilege('authenticated', 'public.hb_wellness_alertes_quotidien(boolean)', 'execute') as calcul_ferme,
       (select count(*) from cron.job where jobname = 'handbase-wellness-alertes') as tache_1,
       (select count(*) from public.hb_wellness_alertes) as alertes,
       public.hb_wla_paques(2027) as paques_2027,
       public.hb_wla_demande('2026-11-23', null, true) as demande_lundi,
       public.hb_wla_demande('2026-11-11', null, true) as ferie_f;

-- ---------- RETOUR ARRIÈRE (à lancer seulement pour annuler ce script) ----------
-- select cron.unschedule('handbase-wellness-alertes') where exists (select 1 from cron.job where jobname = 'handbase-wellness-alertes');
-- delete from public.hb_notifications where kind = 'wellness';
-- drop table if exists public.hb_wellness_alertes;
-- drop function if exists public.hb_wellness_alertes_garde();
-- drop function if exists public.hb_wellness_alertes_quotidien(boolean);
-- drop function if exists public.hb_wellness_alertes_moi();
-- drop function if exists public.hb_wla_calcul(uuid);
-- drop function if exists public.hb_wla_serie(jsonb, jsonb, date, date[], boolean, date);
-- drop function if exists public.hb_wla_valeur(jsonb, text);
-- drop function if exists public.hb_wla_jours_demandes(date, date);
-- drop function if exists public.hb_wla_pont();
-- drop function if exists public.hb_wla_zone();
-- drop function if exists public.hb_wla_demande(date, text, boolean);
-- drop function if exists public.hb_wla_vacances();
-- drop function if exists public.hb_wla_feries(int);
-- drop function if exists public.hb_wla_paques(int);
-- drop function if exists public.hb_wla_staff();
-- drop function if exists public.hb_wla_nom(text);
-- drop function if exists public.hb_wla_regle(jsonb);
-- drop function if exists public.hb_wla_max_regles();
-- drop function if exists public.hb_wla_fenetre();
-- drop function if exists public.hb_wla_recul();
-- drop function if exists public.hb_wla_base_min();
-- drop function if exists public.hb_wla_base_jours();
-- drop function if exists public.hb_wla_points_max();
-- drop function if exists public.hb_wla_jours_max();
-- drop function if exists public.hb_wla_notes();
-- drop function if exists public.hb_wla_types();
-- hb_set_notif_prefs : la clé « wellness » peut rester (sans effet) ; la version de 067 la refuse à nouveau.

-- ---------- ACTIVATION DE L'ENVOI (à la main, après le « oui » de Geoffroy) ----------
-- Sur le serveur maison, la pile hand n'a PAS la tâche « handbase-notify » (026) ni le secret hb_notify_url : la file
-- hb_notifications n'y part pas (la veille de 060 envoie elle-même). Pour que le résumé parte (et, avec lui, les autres
-- notifications de la file : avis, fiches, participant, suivis) :
--   select vault.create_secret('http://kong:8000/functions/v1/notify', 'hb_notify_url');
--   select cron.schedule('handbase-notify', '*/2 * * * *', $job$
--     select net.http_post(
--       url := (select decrypted_secret from vault.decrypted_secrets where name = 'hb_notify_url'),
--       headers := jsonb_build_object('Content-Type', 'application/json',
--                    'x-hb-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'hb_notify_secret')),
--       body := '{}'::jsonb)
--     where exists (select 1 from public.hb_notifications where sent_at is null)
--   $job$);
-- Essai sans attendre 8 h (met en file le résumé du jour des comptes concernés) : select public.hb_wellness_alertes_quotidien(true);
