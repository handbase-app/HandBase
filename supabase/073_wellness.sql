-- HandBase / Nextar : ESPACE JOUEUR, WELLNESS DU MATIN ET « MA SÉANCE » (08/11, champs donnés par le responsable du pôle).
-- À exécuter dans Supabase > SQL Editor, APRÈS 072_mcp_lecture_appels.sql (il s'appuie sur 029 hb_has_role, 034
-- hb_participant_of / hb_arr, 043 hb_is_admin, 046 hb_scope_has, 051 hb_player_guard, 052 hb_player_self_id / hb_self_iso) :
-- base de TEST d'abord (vérifier avec la requête de contrôle en fin de fichier), puis les autres. Peut être relancé sans
-- risque (create table if not exists, create or replace, drop … if exists).
-- ADDITIF : deux tables, des fonctions, deux déclencheurs de garde et un déclencheur sur hb_players (fiche effacée ou fondue,
-- comme 064). Ni hb_upsert, ni hb_stamp / hb_log / hb_touch, ni la synchronisation, ni aucune colonne, index ou règle des
-- tables synchronisées ne sont touchés (tools/essai-sql-073 compare l'empreinte de hb_upsert avant et après).
-- L'appli marche AVANT ce script : rien n'est demandé aux jeunes, la section « Wellness » d'un groupe dit « pas encore en
-- place sur ce serveur » (fonction absente : PGRST202, repli silencieux) ; rien d'autre ne change.
--
-- DONNÉES DE SANTÉ DE MINEURS (RGPD, article 9). Le wellness est FERMÉ par défaut à l'échelle de l'installation : réglage
-- hb_config « wellness » : { "actif": true } posé à la main, après la décision juridique (consentement des familles,
-- hébergement agréé pour des données de santé). Tant qu'il est fermé (réglage absent, ou actif différent de true), les
-- fonctions d'écriture du jeune refusent (« wellness_ferme ») et l'appli ne demande rien ; seul le mode essai (données
-- fictives, sur l'appareil) le montre. Jamais envoyé à une IA (ni le serveur MCP, ni « Demander » : ces tables ne sont lues
-- par aucun des deux), jamais dans un export du staff (pas synchronisé sur les appareils), dans la copie RGPD du jeune.
--   Ouvrir (plus tard, décision prise) :
--     insert into public.hb_config (id, data) values ('wellness', '{"id":"wellness","key":"wellness","value":{"actif":true}}')
--       on conflict (id) do update set data = excluded.data, deleted = false;
--   Base de DÉMONSTRATION aux données fictives seulement (jeunes sans compte joueur, wellness posé par
--   tools/seed-activite-poles.ts) : { "actif": true, "demo": true } : dans le tableau du staff (hb_wellness_groupe), une fiche
--   du groupe qui a des réponses ou des séances dans la période compte comme reliée, même sans compte joueur (sinon il
--   faudrait créer un compte par jeune fictif). Jamais sur une installation réelle : sans « demo », rien ne change.
--
-- PRINCIPE
--  - Activé PAR GROUPE : clé « wellness » (true) de hb_groups.data, écrite comme le reste du groupe (hb_upsert, inchangé :
--    son créateur ou un administrateur ; un participant ne la change pas) ; « wellnessSince » (AAAA-MM-JJ) noté par l'appli.
--    Un groupe compte s'il n'est ni supprimé ni archivé, si son créateur est ENCORE encadrant ou administrateur (jamais un
--    groupe privé d'observateur) et si la fiche est dans le périmètre de ce créateur (un encadrant ne fait pas remplir le
--    questionnaire à un jeune d'un autre territoire en l'ajoutant à son groupe). Membres : playerIds ; groupe Pôle
--    (poleUnitId, 047 / src/poleSeason.ts) : les fiches dont une période de pôle couvre aujourd'hui sur le site de l'unité
--    (site sans accents ni majuscules ; ancien nom libre qui le cite) et du même sexe que l'unité s'il est fixé — la ligue
--    n'est pas comparée ici (l'appli, elle, la compare pour la liste qu'elle montre ; deux pôles d'un même nom de ville dans
--    deux ligues : à signaler).
--  - Demandé au jeune : réglage d'installation ouvert, compte joueur relié à sa fiche, fiche dans au moins un groupe qui compte.
--    Le questionnaire est proposé du lundi au vendredi le matin (l'appli) ; le serveur accepte aussi un autre jour (rien n'est
--    exigé : seuls les jours de semaine comptent dans un taux, src/wellness.ts).
--  - LECTURE : le jeune lit les siennes ; le staff du groupe (créateur, participants directs ou par un staff choisi : 034) s'il
--    est encadrant ET lit la fiche (046 : périmètre) ; les administrateurs. Jamais un autre coach, jamais un observateur.
--  - ÉCRITURE : jamais directe (aucun droit insert / update / delete, hb_player_guard posé aussi) ; le staff n'y écrit jamais ;
--    le jeune passe par les fonctions ci-dessous, toujours pour SA fiche.
--
-- 1) Table hb_wellness : une ligne par jeune et par jour (clé player_id + jour). scores = { energie, fraicheur, humeur,
--    sommeil } : entiers de 1 à 10 (au moins un, ou une douleur) ; douleur (oui / non) ; si oui : douleurs, UNE LIGNE PAR
--    ENDROIT (1 à 8) : [{ zone, cote, type, texte?, intensite }] — zone : endroit anatomique en liste fermée (mêmes
--    identifiants que BODY_AREAS de src/wellness.ts : quadriceps, ischios, adducteurs…) ; cote : « g » / « d » (côté du
--    jeune) obligatoire pour un endroit pair (hb_wl_zones_cotes), absent sinon ; type : courbatures, gene, douleur,
--    contracture, coup, autre (hb_wl_types) ; intensite : entier 1 à 10 ; texte : précision d'une ligne (80 caractères),
--    obligatoire pour la zone « autre » (endroit écrit par le jeune) ; un endroit (et côté) une seule fois ; forme vérifiée
--    par la table (hb_wl_douleurs) ; user_id = le compte qui a écrit ; created_at, updated_at (heure du serveur). Jour = date
--    de Paris.
-- 2) Table hb_wellness_seances : « Ma séance », plusieurs par jour (6 au plus) : rpe (intensité ressentie, 1 à 10) et duree
--    (minutes, 1 à 600, OBLIGATOIRE : le pôle note l'intensité et la durée ; charge = rpe × durée, côté appli).
-- 3) hb_wellness_moi(p_jours) → { actif, demande, jours: [...], seances: [...] } : les siennes des p_jours derniers jours
--    (1 à 400 ; 400 pour sa copie « Télécharger mes données »).
-- 4) hb_wellness_enregistrer(p_valeurs) → la ligne du JOUR (aujourd'hui seulement, heure de Paris ; modifiable toute la
--    journée, jamais un autre jour). p_valeurs = { scores, pain, pains: [...] }. Refus : wellness_ferme, pas_demande, valeurs
--    (rien de valable), douleurs (douleur sans ligne, ou une ligne abîmée : jamais une douleur à moitié gardée), trop_long,
--    pas_joueur, sans_fiche.
-- 5) hb_wellness_seance(p_jour, p_rpe, p_duree, p_id) → une séance d'AUJOURD'HUI ou d'HIER (séance du soir notée le
--    lendemain matin) ; p_duree obligatoire ; p_id : modifier une des siennes de ces deux jours. Refus : wellness_ferme,
--    pas_demande, jour_ferme, valeurs (RPE ou durée absents ou hors bornes), trop (6 par jour), seance_inconnue. hb_wellness_seance_retirer(p_id) : retirer une des siennes de ces deux jours
--    (permis même fermé : on retire toujours ses propres données).
-- 6) hb_wellness_groupe(p_group_id, p_jours) → pour le staff du groupe : { actif, wellness, comptes: [fiches de joueurs du
--    groupe qui ont un compte joueur relié ; base de démonstration { demo: true } : aussi celles qui ont des réponses ou des
--    séances dans la période], jours, seances } des p_jours derniers jours (1 à 120). Refus : groupe_inconnu
--    (inconnu, supprimé, ou le compte n'en est pas le staff : même refus).
-- 7) Conservation : la saison (1er septembre → 31 août : hb_wellness_mois_saison(), même constante que SEASON_START_MONTH de
--    src/wellness.ts) et un mois de grâce (hb_wellness_garde_jours()) ; hb_wellness_purger() efface ce qui est plus ancien ;
--    tâche quotidienne dans « ACTIVATION » (non lancée). Fiche effacée (RGPD) ou supprimée : tout part avec elle ; fiche
--    fondue : le wellness suit la fiche gardée (celui de la fiche gardée prime pour un même jour), les séances aussi.
-- Retour arrière : section « RETOUR ARRIÈRE » à la fin (commentée).

-- ---------- 0. Prérequis ----------
do $$
begin
  if to_regprocedure('public.hb_player_self_id()') is null or to_regprocedure('public.hb_player_guard()') is null
     or to_regprocedure('public.hb_participant_of(jsonb, uuid)') is null or to_regprocedure('public.hb_is_admin()') is null
     or to_regprocedure('public.hb_scope_has(uuid, text, text, text)') is null or to_regprocedure('public.hb_self_iso(timestamptz)') is null then
    raise exception '073 demande 034, 043, 046, 051 et 052 (hb_participant_of, hb_is_admin, hb_scope_has, hb_player_guard, hb_player_self_id) : passer d''abord les scripts d''avant.';
  end if;
end $$;

-- ---------- 1. Constantes et outils (internes) ----------

-- Mois du début de saison (9 = septembre) : même valeur que SEASON_START_MONTH (src/wellness.ts).
create or replace function public.hb_wellness_mois_saison() returns int language sql immutable as $$ select 9 $$;
-- Jours gardés après la fin d'une saison avant la purge : même valeur que WELLNESS_GRACE_DAYS (src/wellness.ts).
create or replace function public.hb_wellness_garde_jours() returns int language sql immutable as $$ select 30 $$;

-- Jour de Paris.
create or replace function public.hb_wl_auj() returns date language sql stable as $$
  select (now() at time zone 'Europe/Paris')::date
$$;

-- Réglage de l'installation (hb_config « wellness » : { actif }) : fermé par défaut.
create or replace function public.hb_wellness_actif() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select data -> 'value' -> 'actif' = 'true'::jsonb from public.hb_config where id = 'wellness' and not deleted), false)
$$;

-- Base de démonstration aux données fictives (hb_config « wellness » : { demo: true }) : voir l'en-tête. Faux par défaut.
create or replace function public.hb_wellness_demo() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select data -> 'value' -> 'demo' = 'true'::jsonb from public.hb_config where id = 'wellness' and not deleted), false)
$$;

-- Clés des notes (mêmes que WELLNESS_ITEMS, src/wellness.ts) : entiers de 1 à 10 ; le reste est ignoré.
create or replace function public.hb_wl_scores(p jsonb) returns jsonb
language sql immutable as $$
  select coalesce(jsonb_object_agg(k, (p ->> k)::int), '{}'::jsonb)
    from unnest(array['energie', 'fraicheur', 'humeur', 'sommeil']) k
   where jsonb_typeof(p) = 'object' and jsonb_typeof(p -> k) = 'number' and (p ->> k) ~ '^([1-9]|10)$'
$$;

-- Endroits d'une douleur (mêmes identifiants, dans le même ordre, que BODY_AREAS de src/wellness.ts) : noms anatomiques
-- (devant de la cuisse = quadriceps, arrière = ischios, intérieur = adducteurs…) ; « autre » : endroit écrit par le jeune.
create or replace function public.hb_wl_zones_connues() returns text[]
language sql immutable as $$
  select array['tete', 'nuque', 'epaule', 'bras', 'coude', 'poignet', 'main', 'poitrine', 'dos-haut', 'abdos', 'lombaires',
               'hanche', 'aine', 'fessiers', 'quadriceps', 'ischios', 'adducteurs', 'genou', 'tibia', 'mollet', 'achille',
               'cheville', 'pied', 'autre']
$$;
-- Endroits pairs : le côté (g / d, côté du jeune) y est obligatoire ; ailleurs, interdit.
create or replace function public.hb_wl_zones_cotes() returns text[]
language sql immutable as $$
  select array['epaule', 'bras', 'coude', 'poignet', 'main', 'hanche', 'aine', 'fessiers', 'quadriceps', 'ischios',
               'adducteurs', 'genou', 'tibia', 'mollet', 'achille', 'cheville', 'pied']
$$;
-- Ce que c'est (mêmes identifiants que PAIN_TYPES, src/wellness.ts).
create or replace function public.hb_wl_types() returns text[]
language sql immutable as $$
  select array['courbatures', 'gene', 'douleur', 'contracture', 'coup', 'autre']
$$;

-- Texte libre (une ligne) : caractères de contrôle, retours à la ligne et espaces répétés → une espace, bords coupés,
-- 80 caractères ; vide → null (même règle que cleanPainText, src/wellness.ts).
create or replace function public.hb_wl_text(p text) returns text
language sql immutable as $$
  select nullif(btrim(left(btrim(regexp_replace(coalesce(p, ''), '[[:cntrl:][:space:]]+', ' ', 'g')), 80)), '')
$$;

-- Douleurs d'un jour (même règle que cleanPains, src/wellness.ts) : tableau de 1 à 8 lignes { zone, cote, type, texte?,
-- intensite }, toutes valables (zone connue ; côté g / d pour un endroit pair, absent sinon ; type connu ; intensité entière
-- 1 à 10 ; texte facultatif nettoyé, obligatoire pour « autre ») et un endroit (et côté) une seule fois ; les autres clés
-- sont ignorées. Rend les lignes nettoyées, dans l'ordre reçu ; la moindre ligne abîmée : null (refus entier).
create or replace function public.hb_wl_douleurs(p jsonb) returns jsonb
language plpgsql immutable as $$
declare
  e jsonb;
  v_out jsonb := '[]'::jsonb;
  v_vus text[] := '{}';
  v_zone text;
  v_cote text;
  v_type text;
  v_texte text;
begin
  if jsonb_typeof(p) is distinct from 'array' or jsonb_array_length(p) not between 1 and 8 then return null; end if;
  for e in select x from jsonb_array_elements(p) x loop
    if jsonb_typeof(e) is distinct from 'object' then return null; end if;
    v_zone := case when jsonb_typeof(e -> 'zone') = 'string' then e ->> 'zone' end;
    if v_zone is null or not (v_zone = any (public.hb_wl_zones_connues())) then return null; end if;
    if v_zone = any (public.hb_wl_zones_cotes()) then
      v_cote := case when jsonb_typeof(e -> 'cote') = 'string' then e ->> 'cote' end;
      if v_cote is null or v_cote not in ('g', 'd') then return null; end if;
    elsif coalesce(jsonb_typeof(e -> 'cote'), 'null') <> 'null' then
      return null;
    else
      v_cote := null;
    end if;
    v_type := case when jsonb_typeof(e -> 'type') = 'string' then e ->> 'type' end;
    if v_type is null or not (v_type = any (public.hb_wl_types())) then return null; end if;
    if jsonb_typeof(e -> 'intensite') is distinct from 'number' or (e ->> 'intensite') !~ '^([1-9]|10)$' then return null; end if;
    if coalesce(jsonb_typeof(e -> 'texte'), 'null') not in ('null', 'string') then return null; end if;
    v_texte := public.hb_wl_text(e ->> 'texte');
    if v_zone = 'autre' and v_texte is null then return null; end if;
    if (v_zone || ':' || coalesce(v_cote, '')) = any (v_vus) then return null; end if;
    v_vus := v_vus || (v_zone || ':' || coalesce(v_cote, ''));
    v_out := v_out || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object('zone', v_zone, 'cote', v_cote, 'type', v_type,
               'texte', v_texte, 'intensite', (e ->> 'intensite')::int)));
  end loop;
  return v_out;
end $$;

-- Nom de site comparable (comme fold, src/poleSeason.ts) : minuscules, sans accents, autres signes → espace.
create or replace function public.hb_wl_fold(p text) returns text
language sql immutable as $$
  select btrim(regexp_replace(translate(lower(coalesce(p, '')), 'àâäáãåçéèêëíìîïñóòôöõúùûüýÿ', 'aaaaaaceeeeiiiinooooouuuuyy'), '[^a-z0-9]+', ' ', 'g'))
$$;

-- La fiche (id, data) est-elle membre de ce groupe à ce jour ? playerIds, ou groupe Pôle : période de pôle en cours sur le site
-- de l'unité (et du sexe de l'unité, s'il est fixé).
create or replace function public.hb_wl_contient(p_g jsonb, p_pid text, p_p jsonb, p_jour date) returns boolean
language sql stable security definer set search_path = public as $$
  select case
    when coalesce(p_g ->> 'poleUnitId', '') <> '' then exists (
      select 1
        from public.hb_units u
        cross join lateral (select public.hb_wl_fold(coalesce(nullif(btrim(u.data ->> 'poleSite'), ''), u.data ->> 'name')) as site) s
        cross join lateral jsonb_array_elements(public.hb_arr(p_p -> 'poles')) x(per)
       where u.id = p_g ->> 'poleUnitId' and not u.deleted and s.site <> '' and jsonb_typeof(x.per) = 'object'
         and (coalesce(u.data ->> 'poleSex', '') = '' or coalesce(p_p ->> 'sex', '') = '' or u.data ->> 'poleSex' = p_p ->> 'sex')
         and case when public.hb_wl_fold(x.per ->> 'site') <> '' then public.hb_wl_fold(x.per ->> 'site') = s.site
                  else public.hb_wl_fold(x.per ->> 'name') like '%' || s.site || '%' end
         and (coalesce(x.per ->> 'from', '') = '' or x.per ->> 'from' <= to_char(p_jour, 'YYYY-MM-DD'))
         and (coalesce(x.per ->> 'to', '') = '' or x.per ->> 'to' >= to_char(p_jour, 'YYYY-MM-DD')))
    else public.hb_arr(p_g -> 'playerIds') ? p_pid end
$$;

-- Le groupe compte-t-il pour le wellness de cette fiche ? Activé, vivant, créateur encore encadrant ou administrateur, fiche dans
-- le périmètre de ce créateur, fiche membre.
create or replace function public.hb_wl_groupe_compte(p_g jsonb, p_deleted boolean, p_player public.hb_players, p_jour date) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(not p_deleted and p_g -> 'wellness' = 'true'::jsonb, false) and not coalesce((p_g ->> 'archived')::boolean, false)
     and exists (select 1 from public.hb_profiles pr
                  where pr.user_id::text = p_g ->> 'createdBy' and pr.role in ('admin', 'preparateur')
                    and (pr.role = 'admin' or public.hb_scope_has(pr.user_id, p_player.scope_dept, p_player.scope_club, p_player.data ->> 'createdBy')))
     and public.hb_wl_contient(p_g, p_player.id, p_player.data, p_jour)
$$;

-- Le wellness est-il demandé à cette fiche (au moins un groupe qui compte) ?
create or replace function public.hb_wl_demande(p_pid text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.hb_players p, public.hb_groups g
                  where p.id = p_pid and not p.deleted and g.data -> 'wellness' = 'true'::jsonb
                    and public.hb_wl_groupe_compte(g.data, g.deleted, p, public.hb_wl_auj()))
$$;

-- Le compte p_uid est-il du staff de ce groupe (créateur ou participant, encadrant ; ou administrateur) ?
create or replace function public.hb_wl_staff_de(p_g jsonb, p_uid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select p_uid is not null and exists (
    select 1 from public.hb_profiles pr
     where pr.user_id = p_uid
       and (pr.role = 'admin'
            or (pr.role = 'preparateur' and (p_g ->> 'createdBy' = p_uid::text or public.hb_participant_of(p_g, p_uid)))))
$$;

-- Règle de lecture du staff : administrateur ; ou encadrant du staff d'un groupe qui compte pour cette fiche, et qui lit la fiche.
create or replace function public.hb_wellness_staff_lit(p_pid text) returns boolean
language sql stable security definer set search_path = public as $$
  select public.hb_is_admin() or exists (
    select 1 from public.hb_players p, public.hb_groups g
     where p.id = p_pid and not p.deleted and g.data -> 'wellness' = 'true'::jsonb
       and public.hb_wl_staff_de(g.data, auth.uid())
       and public.hb_scope_has(auth.uid(), p.scope_dept, p.scope_club, p.data ->> 'createdBy')
       and public.hb_wl_groupe_compte(g.data, g.deleted, p, public.hb_wl_auj()))
$$;

-- ---------- 2. Tables ----------

create table if not exists public.hb_wellness (
  player_id text not null,
  jour date not null,
  user_id uuid,
  scores jsonb not null default '{}'::jsonb,
  douleur boolean not null default false,
  douleurs jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (player_id, jour)
);
-- Forme : notes connues ; sans douleur, aucune ligne ; avec douleur, 1 à 8 lignes déjà nettoyées (hb_wl_douleurs les rend
-- telles quelles) ; au moins une note ou une douleur.
alter table public.hb_wellness drop constraint if exists hb_wellness_forme;
alter table public.hb_wellness add constraint hb_wellness_forme check (
  jsonb_typeof(scores) = 'object' and scores = public.hb_wl_scores(scores)
  and case when douleur then public.hb_wl_douleurs(douleurs) is not distinct from douleurs else douleurs = '[]'::jsonb end
  and (scores <> '{}'::jsonb or douleur));
alter table public.hb_wellness enable row level security;
revoke all on public.hb_wellness from public, anon, authenticated;
grant select on public.hb_wellness to authenticated;

create table if not exists public.hb_wellness_seances (
  id uuid primary key default gen_random_uuid(),
  player_id text not null,
  jour date not null,
  user_id uuid,
  rpe smallint not null,
  duree smallint not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.hb_wellness_seances drop constraint if exists hb_wellness_seances_forme;
alter table public.hb_wellness_seances add constraint hb_wellness_seances_forme check (
  rpe between 1 and 10 and duree between 1 and 600);
create index if not exists hb_wellness_seances_jour on public.hb_wellness_seances (player_id, jour);
alter table public.hb_wellness_seances enable row level security;
revoke all on public.hb_wellness_seances from public, anon, authenticated;
grant select on public.hb_wellness_seances to authenticated;

-- Le jeune : les siennes. Le staff : hb_wellness_staff_lit (ci-dessus).
drop policy if exists "player_read" on public.hb_wellness;
create policy "player_read" on public.hb_wellness for select to authenticated using (player_id = (select public.hb_my_player_id()));
drop policy if exists "staff_read" on public.hb_wellness;
create policy "staff_read" on public.hb_wellness for select to authenticated using (public.hb_wellness_staff_lit(player_id));
drop policy if exists "player_read" on public.hb_wellness_seances;
create policy "player_read" on public.hb_wellness_seances for select to authenticated using (player_id = (select public.hb_my_player_id()));
drop policy if exists "staff_read" on public.hb_wellness_seances;
create policy "staff_read" on public.hb_wellness_seances for select to authenticated using (public.hb_wellness_staff_lit(player_id));

-- Ceinture : aucun compte joueur n'écrit hors des fonctions (comme les autres tables, 051).
drop trigger if exists hb_a_player_guard on public.hb_wellness;
create trigger hb_a_player_guard before insert or update or delete on public.hb_wellness
  for each row execute function public.hb_player_guard();
drop trigger if exists hb_a_player_guard on public.hb_wellness_seances;
create trigger hb_a_player_guard before insert or update or delete on public.hb_wellness_seances
  for each row execute function public.hb_player_guard();

-- Telles que l'appli les reçoit.
create or replace function public.hb_wl_json(r public.hb_wellness) returns jsonb
language sql immutable as $$
  select jsonb_strip_nulls(jsonb_build_object('playerId', r.player_id, 'day', to_char(r.jour, 'YYYY-MM-DD'), 'scores', r.scores,
           'pain', r.douleur, 'pains', case when r.douleur then r.douleurs end, 'at', public.hb_self_iso(r.updated_at)))
$$;
create or replace function public.hb_wl_seance_json(r public.hb_wellness_seances) returns jsonb
language sql immutable as $$
  select jsonb_strip_nulls(jsonb_build_object('id', r.id::text, 'playerId', r.player_id, 'day', to_char(r.jour, 'YYYY-MM-DD'),
           'rpe', r.rpe, 'minutes', r.duree, 'at', public.hb_self_iso(r.updated_at)))
$$;

-- ---------- 3. Le jeune : lire les siennes ----------

create or replace function public.hb_wellness_moi(p_jours int default 28) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_pid text := public.hb_player_self_id();
  v_depuis date := public.hb_wl_auj() - (greatest(1, least(coalesce(p_jours, 28), 400)) - 1);
begin
  return jsonb_build_object(
    'actif', public.hb_wellness_actif(),
    'demande', public.hb_wellness_actif() and public.hb_wl_demande(v_pid),
    'jours', coalesce((select jsonb_agg(public.hb_wl_json(w) order by w.jour desc) from public.hb_wellness w
                        where w.player_id = v_pid and w.jour >= v_depuis), '[]'::jsonb),
    'seances', coalesce((select jsonb_agg(public.hb_wl_seance_json(s) order by s.jour desc, s.created_at desc) from public.hb_wellness_seances s
                          where s.player_id = v_pid and s.jour >= v_depuis), '[]'::jsonb));
end $$;

-- ---------- 4. Le jeune : son wellness du jour ----------

create or replace function public.hb_wellness_enregistrer(p_valeurs jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_pid text := public.hb_player_self_id();
  v_jour date := public.hb_wl_auj();
  v_scores jsonb;
  v_douleur boolean;
  v_douleurs jsonb;
  r public.hb_wellness;
begin
  if length(coalesce(p_valeurs::text, '')) > 4000 then raise exception 'trop_long'; end if;
  if not public.hb_wellness_actif() then raise exception 'wellness_ferme'; end if;
  if not public.hb_wl_demande(v_pid) then raise exception 'pas_demande'; end if;
  v_scores := public.hb_wl_scores(p_valeurs -> 'scores');
  v_douleur := coalesce(p_valeurs -> 'pain' = 'true'::jsonb, false);
  -- Douleur : une ligne par endroit, toutes valables (sinon refus entier) ; sans douleur, les lignes envoyées sont ignorées.
  v_douleurs := case when v_douleur then public.hb_wl_douleurs(p_valeurs -> 'pains') else '[]'::jsonb end;
  if v_douleurs is null then raise exception 'douleurs'; end if;
  if v_scores = '{}'::jsonb and not v_douleur then raise exception 'valeurs'; end if;
  perform set_config('hb.player_self', '1', true);
  insert into public.hb_wellness (player_id, jour, user_id, scores, douleur, douleurs)
  values (v_pid, v_jour, auth.uid(), v_scores, v_douleur, v_douleurs)
  on conflict (player_id, jour) do update
     set user_id = excluded.user_id, scores = excluded.scores, douleur = excluded.douleur, douleurs = excluded.douleurs,
         updated_at = now()
  returning * into r;
  perform set_config('hb.player_self', '0', true);
  return public.hb_wl_json(r);
end $$;

-- ---------- 5. Le jeune : « Ma séance » ----------

-- Durée obligatoire (plus de valeur par défaut) : une version d'essai avec « p_duree default null » est remplacée.
drop function if exists public.hb_wellness_seance(text, int, int, text);
create function public.hb_wellness_seance(p_jour text, p_rpe int, p_duree int, p_id text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_pid text := public.hb_player_self_id();
  v_auj date := public.hb_wl_auj();
  v_jour date;
  r public.hb_wellness_seances;
begin
  if not public.hb_wellness_actif() then raise exception 'wellness_ferme'; end if;
  if not public.hb_wl_demande(v_pid) then raise exception 'pas_demande'; end if;
  if coalesce(p_jour, '') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'jour_ferme'; end if;
  begin
    v_jour := p_jour::date;
  exception when others then
    raise exception 'jour_ferme';
  end;
  -- Aujourd'hui ou hier (séance du soir notée le lendemain matin), heure de Paris.
  if v_jour not in (v_auj, v_auj - 1) then raise exception 'jour_ferme'; end if;
  if p_rpe is null or p_rpe not between 1 and 10 or p_duree is null or p_duree not between 1 and 600 then
    raise exception 'valeurs';
  end if;
  perform set_config('hb.player_self', '1', true);
  if coalesce(p_id, '') <> '' then
    update public.hb_wellness_seances
       set jour = v_jour, rpe = p_rpe, duree = p_duree, user_id = auth.uid(), updated_at = now()
     where id::text = p_id and player_id = v_pid and jour in (v_auj, v_auj - 1)
     returning * into r;
    if r.id is null then
      perform set_config('hb.player_self', '0', true);
      raise exception 'seance_inconnue';
    end if;
  else
    if (select count(*) from public.hb_wellness_seances where player_id = v_pid and jour = v_jour) >= 6 then
      perform set_config('hb.player_self', '0', true);
      raise exception 'trop';
    end if;
    insert into public.hb_wellness_seances (player_id, jour, user_id, rpe, duree)
    values (v_pid, v_jour, auth.uid(), p_rpe, p_duree)
    returning * into r;
  end if;
  perform set_config('hb.player_self', '0', true);
  return public.hb_wl_seance_json(r);
end $$;

create or replace function public.hb_wellness_seance_retirer(p_id text) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_pid text := public.hb_player_self_id();
  v_auj date := public.hb_wl_auj();
  v_jour date;
begin
  select jour into v_jour from public.hb_wellness_seances where id::text = coalesce(p_id, '') and player_id = v_pid;
  if v_jour is null then raise exception 'seance_inconnue'; end if;
  if v_jour not in (v_auj, v_auj - 1) then raise exception 'jour_ferme'; end if;
  perform set_config('hb.player_self', '1', true);
  delete from public.hb_wellness_seances where id::text = p_id and player_id = v_pid;
  perform set_config('hb.player_self', '0', true);
  return true;
end $$;

-- ---------- 6. Le staff du groupe : tableau du wellness ----------

create or replace function public.hb_wellness_groupe(p_group_id text, p_jours int default 35) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_g jsonb;
  v_del boolean;
  v_admin boolean := public.hb_is_admin();
  v_auj date := public.hb_wl_auj();
  v_depuis date := public.hb_wl_auj() - (greatest(1, least(coalesce(p_jours, 35), 120)) - 1);
  v_demo boolean := public.hb_wellness_demo();
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
  select data, deleted into v_g, v_del from public.hb_groups where id = p_group_id;
  if v_g is null or v_del or not public.hb_wl_staff_de(v_g, v_uid) then raise exception 'groupe_inconnu'; end if;
  -- Le groupe compte-t-il, et les périmètres du créateur et du lecteur : calculés UNE fois (mêmes règles que
  -- hb_wl_groupe_compte et hb_scope_has, qui recalculeraient le périmètre, plusieurs dizaines de millisecondes, par fiche).
  v_compte := coalesce(v_g -> 'wellness' = 'true'::jsonb, false) and not coalesce((v_g ->> 'archived')::boolean, false);
  select pr.user_id, pr.role = 'admin' into v_cre, v_cre_admin
    from public.hb_profiles pr where pr.user_id::text = v_g ->> 'createdBy' and pr.role in ('admin', 'preparateur');
  v_compte := v_compte and v_cre is not null;
  if v_compte and not v_cre_admin then select s.all_, s.depts, s.clubs into c_all, c_depts, c_clubs from public.hb_scope_of(v_cre) s; end if;
  if not v_admin then select s.all_, s.depts, s.clubs into u_all, u_depts, u_clubs from public.hb_scope_of(v_uid) s; end if;
  -- Fiches du groupe qui ont un compte joueur relié, que le groupe compte et que ce compte lit (administrateur : toutes).
  -- Base de démonstration (hb_wellness_demo) : aussi les fiches qui ont des réponses ou des séances dans la période.
  -- Les candidats d'abord, puis leur appartenance au groupe (lecture de la fiche), puis les périmètres.
  with cand as materialized (
    select p as r
      from (select pr.player_id as id from public.hb_profiles pr where pr.role = 'joueur' and pr.player_id is not null
            union
            select w.player_id from public.hb_wellness w where v_demo and w.jour >= v_depuis
            union
            select s.player_id from public.hb_wellness_seances s where v_demo and s.jour >= v_depuis) x
      join public.hb_players p on p.id = x.id and not p.deleted
     where v_compte),
  c as materialized (select cand.r from cand where public.hb_wl_contient(v_g, (cand.r).id, (cand.r).data, v_auj))
  select coalesce(array_agg(distinct (c.r).id), '{}') into v_ids
    from c
   where (v_cre_admin or coalesce(c_all or (c.r).scope_dept = any (c_depts) or (c.r).scope_club = any (c_clubs)
                                  or (c.r).data ->> 'createdBy' = v_cre::text, false))
     and (v_admin or coalesce(u_all or (c.r).scope_dept = any (u_depts) or (c.r).scope_club = any (u_clubs)
                              or (c.r).data ->> 'createdBy' = v_uid::text, false));
  return jsonb_build_object(
    'actif', public.hb_wellness_actif(),
    'wellness', coalesce(v_g -> 'wellness' = 'true'::jsonb, false),
    'comptes', to_jsonb(v_ids),
    'jours', coalesce((select jsonb_agg(public.hb_wl_json(w) order by w.player_id, w.jour desc) from public.hb_wellness w
                        where w.player_id = any (v_ids) and w.jour >= v_depuis), '[]'::jsonb),
    'seances', coalesce((select jsonb_agg(public.hb_wl_seance_json(s) order by s.player_id, s.jour desc, s.created_at desc)
                           from public.hb_wellness_seances s where s.player_id = any (v_ids) and s.jour >= v_depuis), '[]'::jsonb));
end $$;

-- ---------- 7. Conservation, fiche effacée, supprimée ou fondue ----------

-- Efface ce qui est plus ancien que le début de la saison d'il y a « garde » jours (au 1er octobre : la saison passée part).
create or replace function public.hb_wellness_purger() returns int
language plpgsql security definer set search_path = public as $$
declare
  v_ref date := public.hb_wl_auj() - public.hb_wellness_garde_jours();
  v_m int := public.hb_wellness_mois_saison();
  v_debut date := make_date(extract(year from v_ref)::int - case when extract(month from v_ref)::int < v_m then 1 else 0 end, v_m, 1);
  n1 int;
  n2 int;
begin
  delete from public.hb_wellness where jour < v_debut;
  get diagnostics n1 = row_count;
  delete from public.hb_wellness_seances where jour < v_debut;
  get diagnostics n2 = row_count;
  return n1 + n2;
end $$;

create or replace function public.hb_wellness_forget() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_into text;
begin
  if tg_op = 'DELETE' then
    delete from public.hb_wellness where player_id = old.id;
    delete from public.hb_wellness_seances where player_id = old.id;
  elsif coalesce((new.data ->> 'purged')::boolean, false) then
    delete from public.hb_wellness where player_id = new.id;
    delete from public.hb_wellness_seances where player_id = new.id;
  elsif coalesce(new.data ->> 'mergedInto', '') <> '' and coalesce(old.data ->> 'mergedInto', '') = '' then
    v_into := new.data ->> 'mergedInto';
    update public.hb_wellness w set player_id = v_into, updated_at = now()
     where w.player_id = new.id
       and not exists (select 1 from public.hb_wellness t where t.player_id = v_into and t.jour = w.jour);
    delete from public.hb_wellness where player_id = new.id;
    update public.hb_wellness_seances set player_id = v_into, updated_at = now() where player_id = new.id;
  end if;
  return null;
end $$;
drop trigger if exists hb_wellness_forget on public.hb_players;
create trigger hb_wellness_forget after update or delete on public.hb_players
  for each row execute function public.hb_wellness_forget();

-- ---------- 8. Droits des fonctions ----------

do $$
declare f text;
begin
  -- Internes : jamais appelées par l'appli.
  foreach f in array array['public.hb_wellness_mois_saison()', 'public.hb_wellness_garde_jours()', 'public.hb_wl_auj()',
      'public.hb_wellness_actif()', 'public.hb_wellness_demo()', 'public.hb_wl_scores(jsonb)', 'public.hb_wl_zones_connues()', 'public.hb_wl_zones_cotes()',
      'public.hb_wl_types()', 'public.hb_wl_douleurs(jsonb)', 'public.hb_wl_text(text)', 'public.hb_wl_fold(text)', 'public.hb_wl_contient(jsonb, text, jsonb, date)',
      'public.hb_wl_groupe_compte(jsonb, boolean, public.hb_players, date)', 'public.hb_wl_demande(text)',
      'public.hb_wl_staff_de(jsonb, uuid)', 'public.hb_wl_json(public.hb_wellness)',
      'public.hb_wl_seance_json(public.hb_wellness_seances)', 'public.hb_wellness_purger()', 'public.hb_wellness_forget()'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
  -- Appelées par l'appli (compte connecté), jamais par anon.
  foreach f in array array['public.hb_wellness_staff_lit(text)', 'public.hb_wellness_moi(int)', 'public.hb_wellness_enregistrer(jsonb)',
      'public.hb_wellness_seance(text, int, int, text)', 'public.hb_wellness_seance_retirer(text)', 'public.hb_wellness_groupe(text, int)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

-- ---------- Vérification ----------
-- Tables et leurs 4 règles, 5 fonctions de l'appli (appelables par un compte connecté, pas par anon), 3 déclencheurs, réglage
-- de l'installation (fermé tant qu'il n'est pas ouvert à la main), lignes enregistrées (0 au départ).
select to_regclass('public.hb_wellness') is not null and to_regclass('public.hb_wellness_seances') is not null as tables_ok,
       (select count(*) from pg_policies where schemaname = 'public' and tablename in ('hb_wellness', 'hb_wellness_seances')) as regles_sur_4,
       has_function_privilege('authenticated', 'public.hb_wellness_moi(int)', 'execute')
         and has_function_privilege('authenticated', 'public.hb_wellness_enregistrer(jsonb)', 'execute')
         and has_function_privilege('authenticated', 'public.hb_wellness_seance(text, int, int, text)', 'execute')
         and has_function_privilege('authenticated', 'public.hb_wellness_seance_retirer(text)', 'execute')
         and has_function_privilege('authenticated', 'public.hb_wellness_groupe(text, int)', 'execute') as appli_ok,
       has_function_privilege('anon', 'public.hb_wellness_enregistrer(jsonb)', 'execute') as anon_peut_ecrire,
       has_function_privilege('authenticated', 'public.hb_wellness_purger()', 'execute') as purge_ouverte,
       (select count(*) from pg_trigger where tgname = 'hb_wellness_forget'
           or (tgname = 'hb_a_player_guard' and tgrelid in ('public.hb_wellness'::regclass, 'public.hb_wellness_seances'::regclass))) as declencheurs_sur_3,
       public.hb_wellness_actif() as wellness_ouvert,
       (select count(*) from public.hb_wellness) as wellness_lignes,
       (select count(*) from public.hb_wellness_seances) as seances_lignes;

-- ---------- RETOUR ARRIÈRE (à lancer seulement pour annuler ce script) ----------
-- Les clés « wellness » / « wellnessSince » des groupes et le réglage hb_config « wellness » peuvent rester (ignorés sans ce
-- script). Tâche programmée d'abord si elle a été lancée : select cron.unschedule('hb-wellness-purge');
-- drop trigger if exists hb_wellness_forget on public.hb_players;
-- drop function if exists public.hb_wellness_forget();
-- drop function if exists public.hb_wellness_purger();
-- drop function if exists public.hb_wellness_groupe(text, int);
-- drop function if exists public.hb_wellness_seance_retirer(text);
-- drop function if exists public.hb_wellness_seance(text, int, int, text);
-- drop function if exists public.hb_wellness_enregistrer(jsonb);
-- drop function if exists public.hb_wellness_moi(int);
-- drop function if exists public.hb_wl_json(public.hb_wellness);
-- drop function if exists public.hb_wl_seance_json(public.hb_wellness_seances);
-- drop table if exists public.hb_wellness;
-- drop table if exists public.hb_wellness_seances;
-- drop function if exists public.hb_wellness_staff_lit(text);
-- drop function if exists public.hb_wl_staff_de(jsonb, uuid);
-- drop function if exists public.hb_wl_demande(text);
-- drop function if exists public.hb_wl_groupe_compte(jsonb, boolean, public.hb_players, date);
-- drop function if exists public.hb_wl_contient(jsonb, text, jsonb, date);
-- drop function if exists public.hb_wl_fold(text);
-- drop function if exists public.hb_wl_douleurs(jsonb);
-- drop function if exists public.hb_wl_text(text);
-- drop function if exists public.hb_wl_types();
-- drop function if exists public.hb_wl_zones_cotes();
-- drop function if exists public.hb_wl_zones_connues();
-- drop function if exists public.hb_wl_scores(jsonb);
-- drop function if exists public.hb_wellness_demo();
-- drop function if exists public.hb_wellness_actif();
-- drop function if exists public.hb_wl_auj();
-- drop function if exists public.hb_wellness_garde_jours();
-- drop function if exists public.hb_wellness_mois_saison();

-- ---------- ACTIVATION (plus tard, à la main) ----------
-- Purge quotidienne (saison + 30 jours gardés), à 03:23 UTC :
-- select cron.schedule('hb-wellness-purge', '23 3 * * *', $$select public.hb_wellness_purger()$$);
