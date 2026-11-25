-- HandBase : « Affichage » des listes de joueurs gardé sur le COMPTE (tous ses appareils) : les pictogrammes au bout des
-- lignes (suivi, vu, à revoir…) et ce que chaque ligne montre sous le nom (année, âge, trimestre, club, taille…), choisis
-- dans « Filtres » → « Affichage » de n'importe quelle liste (src/affichage.ts, src/sousNom.ts).
-- À exécuter dans Supabase > SQL Editor, APRÈS 062_mes_expressions.sql : base de TEST d'abord (vérifier avec la requête de
-- contrôle en fin de fichier), puis les autres. Peut être relancé sans risque (add column if not exists, create or replace).
-- Additif : une colonne et une fonction nouvelles ; rien d'autre n'est modifié (ni hb_upsert, ni la synchronisation, ni les
-- droits des autres fonctions).
-- L'appli marche AVANT ce script : tant que la colonne n'existe pas, chaque appareil garde son affichage pour lui
-- (localStorage) ; dès qu'elle existe, elle est lue avec le rôle à la connexion (même requête, src/roles.ts). Valeur
-- présente : elle gagne ; absente : celle de l'appareil y est envoyée une fois.
--
-- 1) Colonne hb_profiles.affichage (jsonb, nulle = jamais choisi : affichage par défaut) :
--    { "pictos": [...], "sousNom": [...] }, deux tableaux de clés courtes connues, sans doublon.
-- 2) Fonction hb_set_affichage(p jsonb) : le compte connecté écrit SA ligne seulement (auth.uid()), jamais celle d'un autre ;
--    p nul : retour au défaut. Forme vérifiée : un objet avec exactement ces deux tableaux, des clés connues (pictogrammes :
--    suivi, vu, revoir, videos, avis, mesures, pole, groupes ; sous le nom : annee, age, trimestre, club, departement, taille,
--    poids, lateralite, categorie, envergure), 8 et 10 au plus, sans doublon ; sinon erreur (rien n'est écrit).
--    Une clé ajoutée plus tard dans l'appli demandera de relancer une version de ce script avec la liste à jour.
-- 3) Droits : écriture par la fonction seulement, comptes connectés (pas anon) ; lecture de la colonne comme les autres
--    colonnes du profil (comme notif : le compte lit la sienne, le staff voit le staff). L'appli appelle la fonction 1,5 s après la dernière bascule, en ligne ;
--    jamais pendant « Voir comme… ».
-- Retour arrière : drop function if exists public.hb_set_affichage(jsonb); alter table public.hb_profiles drop column if exists affichage;
-- (les appareils gardent leur copie).

-- ---------- Colonne ----------

alter table public.hb_profiles add column if not exists affichage jsonb;
-- Colonnes lisibles (029 : liste explicite, 051 : player_id) : l'appli la lit sur son propre profil, avec le rôle.
grant select (affichage) on public.hb_profiles to authenticated;

-- ---------- Écriture ----------

create or replace function public.hb_set_affichage(p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_pictos constant text[] := array['suivi', 'vu', 'revoir', 'videos', 'avis', 'mesures', 'pole', 'groupes'];
  v_sous constant text[] := array['annee', 'age', 'trimestre', 'club', 'departement', 'taille', 'poids', 'lateralite', 'categorie', 'envergure'];
  k text;
  v_known text[];
  v_vals text[];
begin
  if auth.uid() is null then
    raise exception 'Non connecté' using errcode = '42501';
  end if;
  if p is not null then
    if jsonb_typeof(p) <> 'object' or (select array_agg(key order by key) from jsonb_object_keys(p) key) is distinct from array['pictos', 'sousNom'] then
      raise exception 'Affichage : objet { pictos, sousNom } attendu' using errcode = '22023';
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
  end if;
  update public.hb_profiles set affichage = p where user_id = auth.uid();
end $$;

revoke all on function public.hb_set_affichage(jsonb) from public, anon;
grant execute on function public.hb_set_affichage(jsonb) to authenticated;

-- ---------- Vérification ----------
-- Colonne présente et lisible, fonction appelable par un compte connecté, pas par anon ; aucun affichage enregistré au départ.
select (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'hb_profiles' and column_name = 'affichage') as colonne_1,
       has_column_privilege('authenticated', 'public.hb_profiles', 'affichage', 'select') as appli_peut_lire,
       has_function_privilege('authenticated', 'public.hb_set_affichage(jsonb)', 'execute') as appli_peut_ecrire,
       has_function_privilege('anon', 'public.hb_set_affichage(jsonb)', 'execute') as anon_peut_ecrire,
       (select count(*) from public.hb_profiles where affichage is not null) as comptes_avec_affichage;
