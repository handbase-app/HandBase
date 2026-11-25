-- HandBase / Nextar : PROVENANCE des lignes créées (mesures, avis, événements, « vus », fiches) et LOTS de créations en
-- masse, pour tracer l'activité du staff (serveur MCP : nextar_admin_journal, _saisies, _activite, _lots).
-- À exécuter dans Supabase > SQL Editor, APRÈS 070_propositions_admin.sql (dépend de 029 hb_has_role, 043 hb_is_admin, 058
-- colonnes created_by) : base de TEST d'abord (vérifier avec la requête de contrôle en fin de fichier), puis les autres. Peut
-- être relancé sans risque (create or replace, create … if not exists, insert … on conflict).
-- ADDITIF, ET AUCUNE LIGNE RÉÉCRITE : ni colonne ajoutée aux tables synchronisées, ni déclencheur, ni index sur elles, ni
-- UPDATE ; hb_upsert, hb_stamp, hb_log, le registre (061) et la synchronisation ne sont pas touchés (tools/essai-sql-071 compare
-- l'empreinte de leur texte avant et après).
-- Le serveur MCP marche AVANT ce script : il déduit la provenance par les mêmes règles, côté serveur MCP, sur des lignes lues
-- par pages (bornées) ; avec 071, les agrégats (activité par jour / heure, saisies par test, volumes des lots) sont calculés
-- dans la base, sans transférer les lignes.
--
-- POURQUOI PAS DES COLONNES GÉNÉRÉES (comme created_by en 058) : sous Postgres 17, une colonne générée est STOCKÉE, et
-- l'ajouter RÉÉCRIT la table (verrou exclusif ; la table existe deux fois le temps de la réécriture). Sur la base de test
-- (offre gratuite, 500 Mo), hb_measurements pèse 172 Mo index compris et la base 419 Mo : la réécriture dépasserait la place.
-- La provenance est donc une EXPRESSION (fonctions ci-dessous), évaluée à la lecture ; rien n'est stocké en plus dans les
-- tables synchronisées. Pas d'index nouveau : les lectures passent par les index de 058 (created_by, server_updated_at, id) et
-- hb_<table>_sua (server_updated_at), car une ligne est toujours créée AVANT sa dernière écriture (voir hb_cree_le).
--
-- 1) hb_provenance(id, data) → 'saisie_appli' | 'import_fichier' | 'proposition_validee' | 'generation' :
--      - data.source déjà parmi ces quatre valeurs (posée par l'appli depuis cette version : collage d'un tableau =
--        import_fichier ; validation d'une proposition de la boîte « À valider » = proposition_validee ; générateurs de démo =
--        generation) : elle ;
--      - sinon GÉNÉRATION reconnue sans réécrire : identifiant « demo-… » (démo de l'appli, src/demoProgress.ts : « demo-prog- » ;
--        générateur hors dépôt seed-pole : « demo-prog-e/a/m- ») ou « demo:… » (rencontres fictives), data.source « demo » ou
--        « demo-progression », data.demoBilan (supabase/maintenance/demo_bilan_reperage.sql), ou ligne écrite par SQL sans
--        compte (pas de createdBy et createdByName = « Administration Supabase (SQL) », signature de hb_stamp, 004) ;
--      - sinon data.imported (trace posée par l'appli avant cette version) : avis → proposition_validee (seul chemin qui la
--        pose sur un avis, src/propositionsJoueurs.ts) ; autre ligne → import_fichier (collage, ou proposition de mesures :
--        indiscernables avant cette version) ;
--      - sinon saisie_appli (y compris les toutes premières lignes, d'avant 004, sans auteur).
--    hb_lot_de(id, data) → identifiant du lot : data.lotId (posé par l'appli : identifiant de la proposition validée, ou d'un
--    collage) ; sinon lots de démo reconnus : 'demo-progression', 'demo-bilan', 'demo-rencontres', 'demo-appli',
--    'sql-sans-compte' ; sinon null.
--    hb_cree_le(id, data, server_updated_at) → heure de création POSÉE PAR LE SERVEUR : data.createdAtServer (hb_stamp, 004 :
--    now() à l'insertion, jamais l'heure de l'appareil, gardée telle quelle aux modifications), bornée par server_updated_at ;
--    pour une ligne de GÉNÉRATION, server_updated_at (hb_touch : heure réelle d'écriture), car les générateurs écrivent
--    déclencheurs coupés et ANTIDATENT createdAtServer (seed-pole : dates réparties de septembre 2025 à novembre 2026, lignes
--    écrites le 04/11 vers 23 h 40). Toujours <= server_updated_at : « server_updated_at >= début » filtre par index sans rien
--    perdre.
--    Les règles sont recopiées dans le serveur MCP (supabase/functions/mcp/adminTraces.ts : provenance, lotDe, creeLe) pour
--    marcher avant ce script ; tools/test-mcp.ts vérifie que les deux textes gardent les mêmes cas.
-- 2) TABLE hb_lots (id, created_at, created_by, source, description, nb_lignes par type) : un lot = une création en masse
--    (import, génération). Lecture : administrateurs (tous) et chacun les siens ; ajout : compte du staff, à son nom ; ni
--    modification ni suppression depuis l'appli. Ce script y enregistre les lots de démo déjà en base (quelques INSERT,
--    volumes comptés à l'instant ; relancé : volumes remis à jour). Les volumes vivants sont recalculés par le serveur MCP
--    (hb_admin_creations, par = 'lot'), même pour un lot absent de la table (data.lotId seul).
-- 3) hb_admin_creations(depuis, jusqua, auteur, types, generation, par) : lignes créées sur la période, comptées DANS LA BASE,
--    par type, auteur (created_by), provenance et, selon « par » : total, jour ou heure (Europe/Paris), ou lot (avec les dates
--    déclarées min / max de createdAtServer, pour voir un antidatage). 400 jours au plus.
--    hb_admin_saisies(depuis, jusqua, auteur, test, evenement, source, generation) : mesures par test (nombre, joueurs, min,
--    max, moyenne, première et dernière heure, provenances, événements : même jour et joueur inscrit) et avis par critère
--    (notes chiffrées : nombre, joueurs, moyenne ; JAMAIS de commentaire).
--    SÉCURITÉ : SECURITY INVOKER (lecture avec les droits ET les règles de lecture du compte : elles ne voient rien de plus que
--    la lecture directe) ; PREMIÈRE instruction : hb_is_admin() (043), sinon erreur 42501 sans rien lire ; search_path fixé ;
--    tables fixes (aucun nom de table venu de l'extérieur) ; ne rendent que des nombres, des dates, des identifiants de
--    tests, critères, événements, lots et comptes (le serveur MCP les change en codes « C-… » et en libellés) ; exécution :
--    authenticated seulement.
-- Taille : une table de quelques lignes (~24 Ko avec son index) et cinq fonctions ; aucune donnée ajoutée aux tables.
-- Essai : bash tools/essai-sql-071/lancer.sh (Postgres jetable, Docker : 002 → 070, lignes fictives de chaque provenance, 071
-- deux fois, contrôle, essais de droits et de résultats, empreintes de hb_upsert / hb_stamp / hb_log inchangées).
-- Retour arrière : section « RETOUR ARRIÈRE » à la fin (commentée).

-- ---------- 0. Prérequis ----------
do $$
begin
  if to_regprocedure('public.hb_is_admin()') is null or to_regprocedure('public.hb_has_role()') is null
     or not exists (select 1 from pg_attribute where attrelid = 'public.hb_measurements'::regclass and attname = 'created_by' and not attisdropped) then
    raise exception '071 demande 029, 043 et 058 (hb_has_role, hb_is_admin, colonnes created_by) : passer d''abord les scripts d''avant.';
  end if;
end $$;

-- ---------- 1. Provenance, lot, heure de création (expressions) ----------

-- Fonctions SQL simples, sans table ni réglage : Postgres les recopie dans la requête qui les appelle (pas d'appel par ligne).
create or replace function public.hb_provenance(p_id text, p_data jsonb) returns text
language sql immutable parallel safe as $$
  select case
    when p_data ->> 'source' in ('saisie_appli', 'import_fichier', 'proposition_validee', 'generation') then p_data ->> 'source'
    when p_id like 'demo-%' or p_id like 'demo:%' or p_data ->> 'source' in ('demo', 'demo-progression') or p_data ? 'demoBilan'
      or (coalesce(p_data ->> 'createdBy', '') = '' and p_data ->> 'createdByName' = 'Administration Supabase (SQL)') then 'generation'
    when p_data ? 'imported' then case when p_data ? 'scores' then 'proposition_validee' else 'import_fichier' end
    else 'saisie_appli'
  end
$$;

create or replace function public.hb_lot_de(p_id text, p_data jsonb) returns text
language sql immutable parallel safe as $$
  select coalesce(
    case when coalesce(p_data ->> 'lotId', '') ~ '^[A-Za-z0-9_.:-]{1,80}$' then p_data ->> 'lotId' end,
    case
      when p_id like 'demo-prog-%' or p_data ->> 'source' = 'demo-progression' then 'demo-progression'
      when p_data ? 'demoBilan' then 'demo-bilan'
      when p_id like 'demo:%' then 'demo-rencontres'
      when p_id like 'demo-%' then 'demo-appli'
      when coalesce(p_data ->> 'createdBy', '') = '' and p_data ->> 'createdByName' = 'Administration Supabase (SQL)' then 'sql-sans-compte'
    end)
$$;

-- STABLE (et non IMMUTABLE) : le texte de createdAtServer est lu en timestamptz.
create or replace function public.hb_cree_le(p_id text, p_data jsonb, p_sua timestamptz) returns timestamptz
language sql stable parallel safe as $$
  select case
    when public.hb_provenance(p_id, p_data) = 'generation' then p_sua
    when coalesce(p_data ->> 'createdAtServer', '') ~ '^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}' then least((p_data ->> 'createdAtServer')::timestamptz, p_sua)
    else p_sua
  end
$$;

revoke all on function public.hb_provenance(text, jsonb) from public, anon;
revoke all on function public.hb_lot_de(text, jsonb) from public, anon;
revoke all on function public.hb_cree_le(text, jsonb, timestamptz) from public, anon;
grant execute on function public.hb_provenance(text, jsonb) to authenticated;
grant execute on function public.hb_lot_de(text, jsonb) to authenticated;
grant execute on function public.hb_cree_le(text, jsonb, timestamptz) to authenticated;

-- ---------- 2. Lots ----------

create table if not exists public.hb_lots (
  id text primary key check (id ~ '^[A-Za-z0-9_.:-]{1,80}$'),
  created_at timestamptz not null default now(),
  created_by text default (auth.uid())::text,
  source text not null check (source in ('saisie_appli', 'import_fichier', 'proposition_validee', 'generation')),
  description text check (description is null or char_length(description) <= 300),
  nb_lignes jsonb not null default '{}'::jsonb check (jsonb_typeof(nb_lignes) = 'object')
);
alter table public.hb_lots enable row level security;
drop policy if exists "lots_lecture" on public.hb_lots;
create policy "lots_lecture" on public.hb_lots for select to authenticated
  using ((select public.hb_is_admin()) or created_by = (select auth.uid())::text);
drop policy if exists "lots_ajout" on public.hb_lots;
create policy "lots_ajout" on public.hb_lots for insert to authenticated
  with check ((select public.hb_has_role()) and created_by = (select auth.uid())::text);
revoke all on public.hb_lots from public, anon, authenticated;
grant select, insert on public.hb_lots to authenticated;

-- Lots de démo déjà en base : une ligne chacun s'il a des lignes (volumes de l'instant ; relancé : remis à jour).
-- Écrits par le script (aucun compte : created_by null). Rien n'est modifié dans les tables de données.
insert into public.hb_lots as l (id, created_at, created_by, source, description, nb_lignes)
select v.id, coalesce(v.premier, now()), null, 'generation', v.description, v.nb
  from (
    select 'demo-progression' as id,
           'Progression fictive des groupes Pôle (générateur hors dépôt seed-pole) : identifiants demo-prog-…, data.source demo-progression ; createdAtServer antidaté.' as description,
           (select min(server_updated_at) from (
              select server_updated_at from public.hb_measurements where id like 'demo-prog-%' or data ->> 'source' = 'demo-progression'
              union all select server_updated_at from public.hb_evaluations where id like 'demo-prog-%' or data ->> 'source' = 'demo-progression'
              union all select server_updated_at from public.hb_events where id like 'demo-prog-%' or data ->> 'source' = 'demo-progression') x) as premier,
           jsonb_strip_nulls(jsonb_build_object(
             'mesure', nullif((select count(*) from public.hb_measurements where not deleted and (id like 'demo-prog-%' or data ->> 'source' = 'demo-progression')), 0),
             'avis', nullif((select count(*) from public.hb_evaluations where not deleted and (id like 'demo-prog-%' or data ->> 'source' = 'demo-progression')), 0),
             'evenement', nullif((select count(*) from public.hb_events where not deleted and (id like 'demo-prog-%' or data ->> 'source' = 'demo-progression')), 0))) as nb
    union all
    select 'demo-bilan',
           '« Vus » fictifs du Bilan de détection (supabase/maintenance/demo_bilan_reperage.sql) : data.demoBilan.',
           (select min(server_updated_at) from public.hb_seen where data ? 'demoBilan'),
           jsonb_strip_nulls(jsonb_build_object('vu', nullif((select count(*) from public.hb_seen where not deleted and data ? 'demoBilan'), 0)))
    union all
    select 'sql-sans-compte',
           'Lignes écrites par SQL sans compte (signature « Administration Supabase (SQL) ») : jeux d’essai, imports techniques.',
           (select min(server_updated_at) from (
              select server_updated_at from public.hb_measurements where coalesce(data ->> 'createdBy', '') = '' and data ->> 'createdByName' = 'Administration Supabase (SQL)'
              union all select server_updated_at from public.hb_players where coalesce(data ->> 'createdBy', '') = '' and data ->> 'createdByName' = 'Administration Supabase (SQL)'
              union all select server_updated_at from public.hb_evaluations where coalesce(data ->> 'createdBy', '') = '' and data ->> 'createdByName' = 'Administration Supabase (SQL)'
              union all select server_updated_at from public.hb_events where coalesce(data ->> 'createdBy', '') = '' and data ->> 'createdByName' = 'Administration Supabase (SQL)'
              union all select server_updated_at from public.hb_seen where coalesce(data ->> 'createdBy', '') = '' and data ->> 'createdByName' = 'Administration Supabase (SQL)') x),
           jsonb_strip_nulls(jsonb_build_object(
             'mesure', nullif((select count(*) from public.hb_measurements where not deleted and coalesce(data ->> 'createdBy', '') = '' and data ->> 'createdByName' = 'Administration Supabase (SQL)'), 0),
             'fiche', nullif((select count(*) from public.hb_players where not deleted and coalesce(data ->> 'createdBy', '') = '' and data ->> 'createdByName' = 'Administration Supabase (SQL)'), 0),
             'avis', nullif((select count(*) from public.hb_evaluations where not deleted and coalesce(data ->> 'createdBy', '') = '' and data ->> 'createdByName' = 'Administration Supabase (SQL)'), 0),
             'evenement', nullif((select count(*) from public.hb_events where not deleted and coalesce(data ->> 'createdBy', '') = '' and data ->> 'createdByName' = 'Administration Supabase (SQL)'), 0),
             'vu', nullif((select count(*) from public.hb_seen where not deleted and coalesce(data ->> 'createdBy', '') = '' and data ->> 'createdByName' = 'Administration Supabase (SQL)'), 0)))
  ) v
 where v.nb <> '{}'::jsonb
on conflict (id) do update set nb_lignes = excluded.nb_lignes, created_at = least(l.created_at, excluded.created_at);

-- Rencontres fictives (056, tools/seed-rencontres.ts : colonne source = 'demo') : table facultative, lue par EXECUTE.
do $$
declare v_nb bigint; v_premier timestamptz;
begin
  if to_regclass('public.hb_rencontres') is null then return; end if;
  execute $q$select count(*) filter (where not deleted), min(created_at) from public.hb_rencontres where source = 'demo' or id like 'demo:%'$q$ into v_nb, v_premier;
  if coalesce(v_nb, 0) = 0 then return; end if;
  insert into public.hb_lots as l (id, created_at, created_by, source, description, nb_lignes)
  values ('demo-rencontres', coalesce(v_premier, now()), null, 'generation',
          'Rencontres fictives d’« Autour de moi » (tools/seed-rencontres.ts) : source demo, identifiants demo:….',
          jsonb_build_object('rencontre', v_nb))
  on conflict (id) do update set nb_lignes = excluded.nb_lignes, created_at = least(l.created_at, excluded.created_at);
end $$;

-- ---------- 3. Agrégats pour les administrateurs (serveur MCP) ----------

create or replace function public.hb_admin_creations(
  p_depuis timestamptz,
  p_jusqua timestamptz default null,
  p_auteur text default null,
  p_types text[] default null,
  p_generation boolean default false,
  p_par text default 'total')
returns table (type text, auteur text, source text, lot_id text, tranche timestamptz, nb bigint, joueurs bigint,
               premier timestamptz, dernier timestamptz, declare_min text, declare_max text)
language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare
  v_jusqua timestamptz := coalesce(p_jusqua, now());
  v_types text[] := coalesce(p_types, array['mesure', 'avis', 'evenement', 'vu', 'fiche']);
begin
  -- Le rôle d'abord : rien n'est lu pour un autre compte.
  if not coalesce(public.hb_is_admin(), false) then
    raise exception 'Réservé aux administrateurs' using errcode = '42501';
  end if;
  if p_depuis is null or v_jusqua <= p_depuis or v_jusqua - p_depuis > interval '400 days' then
    raise exception 'hb_admin_creations : période invalide (début avant fin, 400 jours au plus)' using errcode = '22023';
  end if;
  if coalesce(p_par, '') not in ('total', 'jour', 'heure', 'lot') then
    raise exception 'hb_admin_creations : par = total, jour, heure ou lot' using errcode = '22023';
  end if;
  return query
  with l as (
    select 'mesure'::text as t, x.id, x.data, x.server_updated_at as sua, x.created_by as cb, x.data ->> 'playerId' as j
      from public.hb_measurements x
     where 'mesure' = any (v_types) and not x.deleted and x.server_updated_at >= p_depuis and (p_auteur is null or x.created_by = p_auteur)
    union all
    select 'avis', x.id, x.data, x.server_updated_at, x.created_by, x.data ->> 'playerId'
      from public.hb_evaluations x
     where 'avis' = any (v_types) and not x.deleted and x.server_updated_at >= p_depuis and (p_auteur is null or x.created_by = p_auteur)
    union all
    select 'vu', x.id, x.data, x.server_updated_at, x.created_by, x.data ->> 'playerId'
      from public.hb_seen x
     where 'vu' = any (v_types) and not x.deleted and x.server_updated_at >= p_depuis and (p_auteur is null or x.created_by = p_auteur)
    union all
    select 'fiche', x.id, x.data, x.server_updated_at, x.created_by, x.id
      from public.hb_players x
     where 'fiche' = any (v_types) and not x.deleted and x.server_updated_at >= p_depuis and (p_auteur is null or x.created_by = p_auteur)
    union all
    select 'evenement', x.id, x.data, x.server_updated_at, x.data ->> 'createdBy', null::text
      from public.hb_events x
     where 'evenement' = any (v_types) and not x.deleted and x.server_updated_at >= p_depuis and (p_auteur is null or x.data ->> 'createdBy' = p_auteur)
  ), c as (
    select l.t, l.cb, public.hb_provenance(l.id, l.data) as s, public.hb_lot_de(l.id, l.data) as lot,
           public.hb_cree_le(l.id, l.data, l.sua) as at, l.j, l.data ->> 'createdAtServer' as dcl
      from l
  )
  select c.t, c.cb, c.s,
         case when p_par = 'lot' then c.lot end,
         case p_par when 'jour' then date_trunc('day', c.at, 'Europe/Paris') when 'heure' then date_trunc('hour', c.at, 'Europe/Paris') end,
         count(*), count(distinct c.j), min(c.at), max(c.at),
         case when p_par = 'lot' then min(c.dcl) end,
         case when p_par = 'lot' then max(c.dcl) end
    from c
   where c.at >= p_depuis and c.at < v_jusqua and (p_generation or c.s <> 'generation')
   group by 1, 2, 3, 4, 5;
end $$;

create or replace function public.hb_admin_saisies(
  p_depuis timestamptz,
  p_jusqua timestamptz default null,
  p_auteur text default null,
  p_test text default null,
  p_evenement text default null,
  p_source text default null,
  p_generation boolean default false)
returns table (type text, cle text, nb bigint, joueurs bigint, mini numeric, maxi numeric, moyenne numeric,
               premier timestamptz, dernier timestamptz, sources text[], evenements text[], valeurs_texte bigint)
language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare
  v_jusqua timestamptz := coalesce(p_jusqua, now());
begin
  if not coalesce(public.hb_is_admin(), false) then
    raise exception 'Réservé aux administrateurs' using errcode = '42501';
  end if;
  if p_depuis is null or v_jusqua <= p_depuis or v_jusqua - p_depuis > interval '400 days' then
    raise exception 'hb_admin_saisies : période invalide (début avant fin, 400 jours au plus)' using errcode = '22023';
  end if;
  return query
  with m as (
    select x.id, x.data ->> 'criterionId' as c, x.data ->> 'playerId' as p, x.data ->> 'date' as d,
           case when jsonb_typeof(x.data -> 'value') = 'number' then (x.data ->> 'value')::numeric
                when x.data ->> 'value' ~ '^\s*-?\d+([.,]\d+)?\s*$' then replace(btrim(x.data ->> 'value'), ',', '.')::numeric end as v,
           public.hb_provenance(x.id, x.data) as s, public.hb_cree_le(x.id, x.data, x.server_updated_at) as at
      from public.hb_measurements x
     where not x.deleted and x.server_updated_at >= p_depuis and (p_auteur is null or x.created_by = p_auteur)
       and (p_test is null or x.data ->> 'criterionId' = p_test)
  ), mf as (
    select m.* from m
     where m.at >= p_depuis and m.at < v_jusqua and (p_generation or m.s <> 'generation') and (p_source is null or m.s = p_source)
  ), ev as (
    -- Événement d'une mesure : même jour, joueur inscrit (une mesure n'a pas d'événement à elle).
    select e.id, e.data ->> 'date' as d, e.data -> 'playerIds' as ps
      from public.hb_events e
     where not e.deleted and e.data ->> 'date' in (select distinct mf.d from mf) and (p_evenement is null or e.id = p_evenement)
  ), mx as (
    select mf.id, mf.c, mf.p, mf.v, mf.s, mf.at, array_remove(array_agg(ev.id), null) as es
      from mf left join ev on ev.d = mf.d and ev.ps ? mf.p
     group by mf.id, mf.c, mf.p, mf.v, mf.s, mf.at
  ), mxf as (
    select mx.* from mx where p_evenement is null or p_evenement = any (mx.es)
  ), mev as (
    select mxf.c, array_agg(distinct e) as es from mxf cross join unnest(mxf.es) e group by mxf.c
  ), a as (
    select x.id, x.data ->> 'playerId' as p, x.data ->> 'eventId' as e, x.data -> 'scores' as sc,
           public.hb_provenance(x.id, x.data) as s, public.hb_cree_le(x.id, x.data, x.server_updated_at) as at
      from public.hb_evaluations x
     where p_test is null and not x.deleted and x.server_updated_at >= p_depuis and (p_auteur is null or x.created_by = p_auteur)
       and (p_evenement is null or x.data ->> 'eventId' = p_evenement) and jsonb_typeof(x.data -> 'scores') = 'object'
  ), af as (
    select a.* from a
     where a.at >= p_depuis and a.at < v_jusqua and (p_generation or a.s <> 'generation') and (p_source is null or a.s = p_source)
  )
  select 'mesure'::text, mxf.c, count(*), count(distinct mxf.p), min(mxf.v), max(mxf.v), round(avg(mxf.v), 3),
         min(mxf.at), max(mxf.at), array_agg(distinct mxf.s), coalesce(max(mev.es), '{}'::text[]), count(*) filter (where mxf.v is null)
    from mxf left join mev on mev.c = mxf.c
   group by mxf.c
  union all
  -- Avis : notes chiffrées par critère, jamais un commentaire (points forts, axes, portrait ne sont pas lus).
  select 'avis', k.key, count(*), count(distinct af.p), min((k.value)::text::numeric), max((k.value)::text::numeric),
         round(avg((k.value)::text::numeric), 3), min(af.at), max(af.at), array_agg(distinct af.s),
         coalesce(array_remove(array_agg(distinct af.e), null), '{}'::text[]), 0::bigint
    from af cross join lateral jsonb_each(af.sc) k
   where jsonb_typeof(k.value) = 'number'
   group by k.key;
end $$;

revoke all on function public.hb_admin_creations(timestamptz, timestamptz, text, text[], boolean, text) from public, anon;
revoke all on function public.hb_admin_saisies(timestamptz, timestamptz, text, text, text, text, boolean) from public, anon;
grant execute on function public.hb_admin_creations(timestamptz, timestamptz, text, text[], boolean, text) to authenticated;
grant execute on function public.hb_admin_saisies(timestamptz, timestamptz, text, text, text, text, boolean) to authenticated;

-- ---------- Vérification ----------
-- Attendu : fonctions_5 = 5, invoker_2 = 2 (les deux agrégats en SECURITY INVOKER), anon_0 = 0, lots_rls = t,
-- regles_lots_2 = 2, lots (nombre de lots de démo enregistrés : 3 sur la base de test, demo-progression, demo-bilan,
-- sql-sans-compte, plus demo-rencontres si les rencontres fictives sont là), colonnes_ajoutees_0 = 0 (aucune colonne ajoutée
-- aux tables de données), index_ajoutes_0 = 0, puis la provenance par type (lecture complète des cinq tables, quelques
-- secondes) : sur la base de test au 06/11 (calculé par SELECT avec les mêmes règles), avis generation 6 385 / saisie_appli
-- 34 ; evenements generation 611 / saisie_appli 8 ; fiches generation 40 001 ; mesures generation 145 379 (76 080 demo-prog
-- + 69 299 SQL sans compte) / import_fichier 35 / saisie_appli 57 ; vus generation 16 794 / saisie_appli 12.
select (select count(*) from pg_proc where pronamespace = 'public'::regnamespace
          and proname in ('hb_provenance', 'hb_lot_de', 'hb_cree_le', 'hb_admin_creations', 'hb_admin_saisies')) as fonctions_5,
       (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname in ('hb_admin_creations', 'hb_admin_saisies') and not prosecdef) as invoker_2,
       (select count(*) from pg_proc p where pronamespace = 'public'::regnamespace and proname in ('hb_provenance', 'hb_lot_de', 'hb_cree_le', 'hb_admin_creations', 'hb_admin_saisies')
          and has_function_privilege('anon', p.oid, 'execute')) as anon_0,
       (select relrowsecurity from pg_class where oid = 'public.hb_lots'::regclass) as lots_rls,
       (select count(*) from pg_policies where tablename = 'hb_lots') as regles_lots_2,
       (select count(*) from public.hb_lots) as lots,
       (select count(*) from information_schema.columns where table_schema = 'public'
          and table_name in ('hb_measurements', 'hb_evaluations', 'hb_seen', 'hb_players', 'hb_events')
          and column_name in ('source', 'lot_id', 'provenance', 'cree_le')) as colonnes_ajoutees_0,
       (select count(*) from pg_indexes where schemaname = 'public'
          and tablename in ('hb_measurements', 'hb_evaluations', 'hb_seen', 'hb_players', 'hb_events')
          and indexdef ~ 'hb_provenance|hb_lot_de|hb_cree_le') as index_ajoutes_0;
select t as table_, public.hb_provenance(id, data) as provenance, count(*) as lignes
  from (select 'mesures' as t, id, data from public.hb_measurements
        union all select 'avis', id, data from public.hb_evaluations
        union all select 'vus', id, data from public.hb_seen
        union all select 'fiches', id, data from public.hb_players
        union all select 'evenements', id, data from public.hb_events) x
 group by 1, 2 order by 1, 2;

-- ---------- RETOUR ARRIÈRE (à lancer seulement pour annuler ce script) ----------
-- Rien n'a été écrit dans les tables de données : retirer les fonctions et la table des lots suffit.
-- drop function if exists public.hb_admin_saisies(timestamptz, timestamptz, text, text, text, text, boolean);
-- drop function if exists public.hb_admin_creations(timestamptz, timestamptz, text, text[], boolean, text);
-- drop function if exists public.hb_cree_le(text, jsonb, timestamptz);
-- drop function if exists public.hb_lot_de(text, jsonb);
-- drop function if exists public.hb_provenance(text, jsonb);
-- drop table if exists public.hb_lots;
