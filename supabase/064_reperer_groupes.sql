-- HandBase : « Repérer des groupes » gardé sur le COMPTE avec l'affichage des listes (063) : jusqu'à 3 groupes choisis dans
-- « Filtres » → « Repérer des groupes » de n'importe quelle liste de joueurs ; leurs joueurs ont un anneau de la couleur du
-- groupe autour de la photo, dans toutes les listes (src/groupRings.ts, src/affichage.ts).
-- À exécuter dans Supabase > SQL Editor, APRÈS 063_affichage.sql : base de TEST d'abord (vérifier avec la requête de contrôle
-- en fin de fichier), puis les autres. Peut être relancé sans risque (create or replace).
-- Seule hb_set_affichage change ; rien d'autre (ni la colonne, ni hb_upsert, ni la synchronisation, ni les autres droits).
-- La couleur d'un groupe (PlayerGroup.color) ne demande AUCUN script : elle voyage dans data des groupes comme le reste.
-- L'appli marche AVANT ce script : le serveur refuse la clé « groupes » (22023), l'appli renvoie alors la valeur sans elle
-- et garde ses groupes repérés sur l'appareil (localStorage) ; dès qu'il est passé, ils suivent le compte.
--
-- hb_set_affichage(p jsonb) accepte maintenant DEUX formes (sinon erreur 22023, rien n'est écrit) :
--   { "pictos": [...], "sousNom": [...] }                   (063, inchangée)
--   { "pictos": [...], "sousNom": [...], "groupes": [...] }  groupes : 3 identifiants au plus, sans doublon, au format uuid.
-- Mêmes contrôles qu'en 063 pour pictos et sousNom ; le compte connecté écrit SA ligne seulement ; p nul : retour au défaut.
-- Les identifiants ne sont pas cherchés dans hb_groups (un groupe supprimé ou plus visible est simplement ignoré par l'appli).
-- Retour arrière : relancer 063_affichage.sql (la fonction reprend la forme à deux clés ; une valeur à trois clés déjà
-- enregistrée reste lisible par l'appli).

create or replace function public.hb_set_affichage(p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_pictos constant text[] := array['suivi', 'vu', 'revoir', 'videos', 'avis', 'mesures', 'pole', 'groupes'];
  v_sous constant text[] := array['annee', 'age', 'trimestre', 'club', 'departement', 'taille', 'poids', 'lateralite', 'categorie', 'envergure'];
  k text;
  v_keys text[];
  v_known text[];
  v_vals text[];
begin
  if auth.uid() is null then
    raise exception 'Non connecté' using errcode = '42501';
  end if;
  if p is not null then
    if jsonb_typeof(p) = 'object' then
      select array_agg(key order by key) into v_keys from jsonb_object_keys(p) key;
    end if;
    if jsonb_typeof(p) <> 'object' or v_keys is null
       or not (v_keys = array['pictos', 'sousNom'] or v_keys = array['groupes', 'pictos', 'sousNom']) then
      raise exception 'Affichage : objet { pictos, sousNom } ou { pictos, sousNom, groupes } attendu' using errcode = '22023';
    end if;
    foreach k in array array['pictos', 'sousNom'] loop
      v_known := case k when 'pictos' then v_pictos else v_sous end;
      if jsonb_typeof(p -> k) <> 'array' or jsonb_array_length(p -> k) > cardinality(v_known) then
        raise exception 'Affichage : % doit être un tableau de % clés au plus', k, cardinality(v_known) using errcode = '22023';
      end if;
      select array_agg(case when jsonb_typeof(x) = 'string' then x #>> '{}' end) into v_vals from jsonb_array_elements(p -> k) t(x);
      if exists (select 1 from unnest(coalesce(v_vals, '{}')) v where v is null or not (v = any (v_known)))
         or (select count(distinct v) from unnest(coalesce(v_vals, '{}')) v) <> coalesce(cardinality(v_vals), 0) then
        raise exception 'Affichage : clé inconnue ou en double dans %', k using errcode = '22023';
      end if;
    end loop;
    -- Groupes repérés : 3 identifiants au plus, au format uuid, sans doublon (majuscules et minuscules confondues).
    if p ? 'groupes' then
      if jsonb_typeof(p -> 'groupes') <> 'array' or jsonb_array_length(p -> 'groupes') > 3 then
        raise exception 'Affichage : groupes doit être un tableau de 3 identifiants au plus' using errcode = '22023';
      end if;
      select array_agg(case when jsonb_typeof(x) = 'string' then lower(x #>> '{}') end) into v_vals from jsonb_array_elements(p -> 'groupes') t(x);
      if exists (select 1 from unnest(coalesce(v_vals, '{}')) v
                  where v is null or v !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
         or (select count(distinct v) from unnest(coalesce(v_vals, '{}')) v) <> coalesce(cardinality(v_vals), 0) then
        raise exception 'Affichage : identifiant de groupe invalide ou en double' using errcode = '22023';
      end if;
    end if;
  end if;
  update public.hb_profiles set affichage = p where user_id = auth.uid();
end $$;

revoke all on function public.hb_set_affichage(jsonb) from public, anon;
grant execute on function public.hb_set_affichage(jsonb) to authenticated;

-- ---------- Vérification ----------
-- Fonction appelable par un compte connecté, pas par anon ; elle connaît la clé « groupes » ; comptes qui en ont.
select has_function_privilege('authenticated', 'public.hb_set_affichage(jsonb)', 'execute') as appli_peut_ecrire,
       has_function_privilege('anon', 'public.hb_set_affichage(jsonb)', 'execute') as anon_peut_ecrire,
       (select prosrc like '%identifiant de groupe%' from pg_proc where oid = 'public.hb_set_affichage(jsonb)'::regprocedure) as connait_groupes,
       (select count(*) from public.hb_profiles where affichage ? 'groupes') as comptes_avec_groupes;
