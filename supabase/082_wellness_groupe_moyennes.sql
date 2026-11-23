-- HandBase / Nextar : WELLNESS DU GROUPE DANS LE TEMPS (23/11) — un jour passé du tableau du staff, et les moyennes du groupe
-- sur une période (repère « même période l'an dernier » des jauges, src/pages/GroupWellness.tsx).
-- À exécuter dans Supabase > SQL Editor, APRÈS 073_wellness.sql (il s'appuie sur hb_wl_staff_de, hb_wl_contient, hb_wl_auj,
-- hb_wl_json, hb_wl_seance_json, hb_wellness_actif, hb_scope_of) : base de TEST d'abord (requête de contrôle en fin de
-- fichier), puis les autres. Peut être relancé sans risque (create or replace).
-- ADDITIF : trois fonctions. Ni hb_upsert, ni hb_wellness_groupe, ni aucune table, colonne, règle ou donnée ne sont touchés
-- (tools/essai-sql-082 compare leurs empreintes avant et après).
-- L'appli marche AVANT ce script : le jour présent se lit comme avant (hb_wellness_groupe) ; un jour passé de moins de 120
-- jours aussi (hb_wellness_groupe sur une fenêtre plus longue, filtrée par l'appli) ; au-delà, l'appli dit « jour trop ancien » ;
-- le repère « l'an dernier » des jauges se tait (fonction absente : PGRST202).
--
-- DONNÉES DE SANTÉ DE MINEURS : mêmes règles que 073. Lu à la demande par le staff du groupe (créateur, participants
-- encadrants) et les administrateurs, jamais gardé sur l'appareil, jamais vers une IA ni dans un export.
--
-- 1) hb_wl_groupe_fiches(p_g, p_uid, p_jour) (interne) : les fiches du groupe qui ont un compte joueur relié, que le groupe
--    compte (wellness activé, pas archivé, créateur encore encadrant ou administrateur, fiche dans son périmètre) et que le
--    compte p_uid lit (administrateur : toutes) ; membres du groupe À CE JOUR (groupe Pôle : période de pôle qui couvre ce
--    jour). Même calcul que le corps de hb_wellness_groupe (073), qui n'est pas modifié : l'essai vérifie qu'ils rendent les
--    mêmes fiches aujourd'hui.
-- 2) hb_wellness_groupe_au(p_group_id, p_jusqu_au, p_jours) → même forme que hb_wellness_groupe ({ actif, wellness, comptes,
--    jours, seances }), mais la fenêtre de p_jours (1 à 120) finit le jour p_jusqu_au (AAAA-MM-JJ, au plus aujourd'hui, au plus
--    800 jours en arrière) au lieu d'aujourd'hui. Fiches : les membres d'AUJOURD'HUI (ceux que le tableau montre). Refus :
--    groupe_inconnu (inconnu, supprimé, ou le compte n'en est pas le staff : même refus que hb_wellness_groupe), periode.
-- 3) hb_wellness_groupe_moyennes(p_group_id, p_periodes) → { actif, periodes: [{ cle, du, au, reponses, joueurs, energie,
--    fraicheur, humeur, sommeil, forme }] } : MOYENNES DU GROUPE seulement, aucune donnée individuelle. p_periodes : tableau
--    de 1 à 6 { cle (texte court), du, au } (AAAA-MM-JJ, du ≤ au, 400 jours au plus, au plus aujourd'hui, au plus 800 jours en
--    arrière). Fiches : membres du groupe le dernier jour de la période (« le groupe d'alors » pour un groupe Pôle). Moyenne
--    de toutes les réponses de la période (deux décimales ; null : aucune) ; forme = moyenne des formes du jour (moyenne des
--    notes données, moins un quart de la gêne la plus forte, bornée à 1 … 10, arrondie au dixième : formeDuJour de
--    src/wellness.ts, mêmes chiffres : tools/essai-sql-082/parite.ts). Refus : groupe_inconnu, periode.
--    À SAVOIR : la purge de fin de saison (073, hb_wellness_purger, tâche pas encore lancée) efface les réponses d'avant la
--    saison en cours un mois après la rentrée ; une fois lancée, « l'an dernier » n'a plus de réponses (le repère se tait).
-- Retour arrière : section « RETOUR ARRIÈRE » à la fin (commentée).

-- ---------- 0. Prérequis ----------
do $$
begin
  if to_regprocedure('public.hb_wellness_groupe(text, int)') is null or to_regprocedure('public.hb_wl_staff_de(jsonb, uuid)') is null
     or to_regprocedure('public.hb_wl_contient(jsonb, text, jsonb, date)') is null or to_regprocedure('public.hb_scope_of(uuid)') is null then
    raise exception '082 demande 073 (hb_wellness_groupe, hb_wl_staff_de, hb_wl_contient) : passer d''abord les scripts d''avant.';
  end if;
end $$;

-- ---------- 1. Les fiches du groupe lues par ce compte, à un jour donné (interne) ----------

create or replace function public.hb_wl_groupe_fiches(p_g jsonb, p_uid uuid, p_jour date) returns text[]
language plpgsql stable security definer set search_path = public as $$
declare
  v_admin boolean := exists (select 1 from public.hb_profiles where user_id = p_uid and role = 'admin');
  v_ids text[];
  v_compte boolean;
  v_cre uuid;
  v_cre_admin boolean;
  c_all boolean;
  c_depts text[];
  c_clubs text[];
  u_all boolean;
  u_depts text[];
  u_clubs text[];
begin
  -- Mêmes étapes que hb_wellness_groupe (073) : le groupe compte-t-il, périmètres du créateur et du lecteur calculés une fois.
  v_compte := coalesce(p_g -> 'wellness' = 'true'::jsonb, false) and not coalesce((p_g ->> 'archived')::boolean, false);
  select pr.user_id, pr.role = 'admin' into v_cre, v_cre_admin
    from public.hb_profiles pr where pr.user_id::text = p_g ->> 'createdBy' and pr.role in ('admin', 'preparateur');
  v_compte := v_compte and v_cre is not null;
  if not v_compte then return '{}'; end if;
  if not v_cre_admin then select s.all_, s.depts, s.clubs into c_all, c_depts, c_clubs from public.hb_scope_of(v_cre) s; end if;
  if not v_admin then select s.all_, s.depts, s.clubs into u_all, u_depts, u_clubs from public.hb_scope_of(p_uid) s; end if;
  with cand as materialized (
    select p as r
      from (select distinct pr.player_id as id from public.hb_profiles pr where pr.role = 'joueur' and pr.player_id is not null) x
      join public.hb_players p on p.id = x.id and not p.deleted),
  c as materialized (select cand.r from cand where public.hb_wl_contient(p_g, (cand.r).id, (cand.r).data, p_jour))
  select coalesce(array_agg(distinct (c.r).id), '{}') into v_ids
    from c
   where (v_cre_admin or coalesce(c_all or (c.r).scope_dept = any (c_depts) or (c.r).scope_club = any (c_clubs)
                                  or (c.r).data ->> 'createdBy' = v_cre::text, false))
     and (v_admin or coalesce(u_all or (c.r).scope_dept = any (u_depts) or (c.r).scope_club = any (u_clubs)
                              or (c.r).data ->> 'createdBy' = p_uid::text, false));
  return v_ids;
end $$;

-- Un jour « AAAA-MM-JJ » lisible : au plus aujourd'hui (Paris), au plus 800 jours en arrière ; sinon null.
create or replace function public.hb_wl_jour_lu(p text) returns date
language plpgsql stable as $$
declare
  v date;
begin
  if coalesce(p, '') !~ '^\d{4}-\d{2}-\d{2}$' then return null; end if;
  begin
    v := p::date;
  exception when others then
    return null;
  end;
  if v > public.hb_wl_auj() or v < public.hb_wl_auj() - 800 then return null; end if;
  return v;
end $$;

-- ---------- 2. Le tableau du staff, un jour passé ----------

create or replace function public.hb_wellness_groupe_au(p_group_id text, p_jusqu_au text, p_jours int default 35) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_g jsonb;
  v_del boolean;
  v_au date;
  v_depuis date;
  v_ids text[];
begin
  select data, deleted into v_g, v_del from public.hb_groups where id = p_group_id;
  if v_g is null or v_del or not public.hb_wl_staff_de(v_g, v_uid) then raise exception 'groupe_inconnu'; end if;
  v_au := public.hb_wl_jour_lu(p_jusqu_au);
  if v_au is null then raise exception 'periode'; end if;
  v_depuis := v_au - (greatest(1, least(coalesce(p_jours, 35), 120)) - 1);
  -- Les fiches d'aujourd'hui : celles que le tableau montre.
  v_ids := public.hb_wl_groupe_fiches(v_g, v_uid, public.hb_wl_auj());
  return jsonb_build_object(
    'actif', public.hb_wellness_actif(),
    'wellness', coalesce(v_g -> 'wellness' = 'true'::jsonb, false),
    'comptes', to_jsonb(v_ids),
    'jours', coalesce((select jsonb_agg(public.hb_wl_json(w) order by w.player_id, w.jour desc) from public.hb_wellness w
                        where w.player_id = any (v_ids) and w.jour between v_depuis and v_au), '[]'::jsonb),
    'seances', coalesce((select jsonb_agg(public.hb_wl_seance_json(s) order by s.player_id, s.jour desc, s.created_at desc)
                           from public.hb_wellness_seances s where s.player_id = any (v_ids) and s.jour between v_depuis and v_au), '[]'::jsonb));
end $$;

-- ---------- 3. Moyennes du groupe sur des périodes ----------

-- Forme du jour d'une réponse (formeDuJour, src/wellness.ts) : moyenne des notes données, moins un quart de la gêne la plus
-- forte, bornée à 1 … 10, au dixième ; aucune note : null.
create or replace function public.hb_wl_forme(p_scores jsonb, p_douleur boolean, p_douleurs jsonb) returns numeric
language sql immutable as $$
  select case when n.c = 0 then null else
    round(greatest(1, least(10, n.s / n.c - case when p_douleur and jsonb_array_length(p_douleurs) > 0
      then 0.25 * (select max((d ->> 'intensite')::int) from jsonb_array_elements(p_douleurs) d) else 0 end)), 1) end
    from (select count(*)::numeric as c, coalesce(sum((p_scores ->> k)::numeric), 0) as s
            from unnest(array['energie', 'fraicheur', 'humeur', 'sommeil']) k where jsonb_typeof(p_scores -> k) = 'number') n
$$;

create or replace function public.hb_wellness_groupe_moyennes(p_group_id text, p_periodes jsonb) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_g jsonb;
  v_del boolean;
  e jsonb;
  v_cle text;
  v_du date;
  v_au date;
  v_ids text[];
  v_out jsonb := '[]'::jsonb;
  r record;
begin
  select data, deleted into v_g, v_del from public.hb_groups where id = p_group_id;
  if v_g is null or v_del or not public.hb_wl_staff_de(v_g, v_uid) then raise exception 'groupe_inconnu'; end if;
  if jsonb_typeof(p_periodes) is distinct from 'array' or jsonb_array_length(p_periodes) not between 1 and 6 then raise exception 'periode'; end if;
  for e in select x from jsonb_array_elements(p_periodes) x loop
    if jsonb_typeof(e) is distinct from 'object' or jsonb_typeof(e -> 'cle') is distinct from 'string' then raise exception 'periode'; end if;
    v_cle := left(e ->> 'cle', 20);
    v_du := public.hb_wl_jour_lu(e ->> 'du');
    v_au := public.hb_wl_jour_lu(e ->> 'au');
    if v_du is null or v_au is null or v_du > v_au or v_au - v_du > 400 then raise exception 'periode'; end if;
    -- Le groupe d'alors : membres le dernier jour de la période.
    v_ids := public.hb_wl_groupe_fiches(v_g, v_uid, v_au);
    select count(*) as reponses, count(distinct w.player_id) as joueurs,
           round(avg((w.scores ->> 'energie')::numeric), 2) as energie,
           round(avg((w.scores ->> 'fraicheur')::numeric), 2) as fraicheur,
           round(avg((w.scores ->> 'humeur')::numeric), 2) as humeur,
           round(avg((w.scores ->> 'sommeil')::numeric), 2) as sommeil,
           round(avg(public.hb_wl_forme(w.scores, w.douleur, w.douleurs)), 2) as forme
      into r
      from public.hb_wellness w
     where w.player_id = any (v_ids) and w.jour between v_du and v_au;
    v_out := v_out || jsonb_build_array(jsonb_build_object('cle', v_cle, 'du', to_char(v_du, 'YYYY-MM-DD'), 'au', to_char(v_au, 'YYYY-MM-DD'),
               'reponses', r.reponses, 'joueurs', r.joueurs, 'energie', r.energie, 'fraicheur', r.fraicheur, 'humeur', r.humeur,
               'sommeil', r.sommeil, 'forme', r.forme));
  end loop;
  return jsonb_build_object('actif', public.hb_wellness_actif(), 'periodes', v_out);
end $$;

-- ---------- 4. Droits des fonctions ----------

do $$
declare f text;
begin
  -- Internes : jamais appelées par l'appli.
  foreach f in array array['public.hb_wl_groupe_fiches(jsonb, uuid, date)', 'public.hb_wl_jour_lu(text)', 'public.hb_wl_forme(jsonb, boolean, jsonb)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
  -- Appelées par l'appli (compte connecté), jamais par anon.
  foreach f in array array['public.hb_wellness_groupe_au(text, text, int)', 'public.hb_wellness_groupe_moyennes(text, jsonb)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

-- ---------- Vérification ----------
-- Deux fonctions de l'appli (appelables par un compte connecté, pas par anon), trois internes fermées, forme d'essai (8, 7, 9, 6
-- avec une gêne 8/10 : 7,5 − 2 = 5,5), une période illisible refusée.
select has_function_privilege('authenticated', 'public.hb_wellness_groupe_au(text, text, int)', 'execute')
         and has_function_privilege('authenticated', 'public.hb_wellness_groupe_moyennes(text, jsonb)', 'execute') as appli_ok,
       has_function_privilege('anon', 'public.hb_wellness_groupe_moyennes(text, jsonb)', 'execute')
         or has_function_privilege('anon', 'public.hb_wellness_groupe_au(text, text, int)', 'execute') as anon_peut_lire,
       has_function_privilege('authenticated', 'public.hb_wl_groupe_fiches(jsonb, uuid, date)', 'execute')
         or has_function_privilege('authenticated', 'public.hb_wl_forme(jsonb, boolean, jsonb)', 'execute')
         or has_function_privilege('authenticated', 'public.hb_wl_jour_lu(text)', 'execute') as internes_ouvertes,
       public.hb_wl_forme('{"energie":8,"fraicheur":7,"humeur":9,"sommeil":6}', true, '[{"zone":"tete","type":"gene","intensite":8}]') as forme_essai,
       public.hb_wl_jour_lu('2020-13-01') is null and public.hb_wl_jour_lu(to_char(public.hb_wl_auj() + 1, 'YYYY-MM-DD')) is null as periode_refusee;

-- ---------- RETOUR ARRIÈRE (à lancer seulement pour annuler ce script) ----------
-- Rien d'autre à défaire : aucune table, aucune donnée.
-- drop function if exists public.hb_wellness_groupe_moyennes(text, jsonb);
-- drop function if exists public.hb_wellness_groupe_au(text, text, int);
-- drop function if exists public.hb_wl_forme(jsonb, boolean, jsonb);
-- drop function if exists public.hb_wl_jour_lu(text);
-- drop function if exists public.hb_wl_groupe_fiches(jsonb, uuid, date);
