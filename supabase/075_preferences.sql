-- HandBase : préférences gardées sur le COMPTE (tous ses appareils) : le thème de couleurs (Auto, Nuit, Océan, Charbon,
-- Clair, Sable, Ciel), le style choisi pour soi (ou celui de l'installation) et le filtre Garçons / Filles des listes de
-- joueurs (src/preferences.ts, src/preferencesCore.ts). Demandé par Geoffroy le 09/11/2026 : « lie les couleurs et le
-- filtre garçons / filles ». Même mécanisme que l'affichage des listes (063_affichage.sql).
-- À passer APRÈS 063_affichage.sql, avec outils/appliquer-sql.sh (serveur maison) : base hand d'abord (vérifier avec la
-- requête de contrôle en fin de fichier), puis volley. Peut être relancé sans risque (add column if not exists, create or
-- replace).
-- Additif : une colonne et une fonction nouvelles ; rien d'autre n'est modifié (ni hb_upsert, ni la synchronisation, ni
-- hb_set_affichage, ni les droits des autres fonctions).
-- L'appli marche AVANT ce script : tant que la colonne n'existe pas, chaque appareil garde ses choix pour lui (localStorage,
-- comme avant) ; dès qu'elle existe, elle est lue avec le rôle à la connexion (même requête, src/roles.ts). Valeur
-- présente : elle gagne ; absente : celle de l'appareil y est envoyée une fois.
--
-- 1) Colonne hb_profiles.preferences (jsonb, nulle = jamais choisi) : { "theme": "auto", "style": null, "sexe": "all" }.
-- 2) Fonction hb_set_preferences(p jsonb) : le compte connecté écrit SA ligne seulement (auth.uid()), jamais celle d'un
--    autre ; p nul : retour au défaut. Forme vérifiée : un objet aux clés connues seulement (theme, style, sexe) ;
--    theme : texte court en minuscules (a-z, 0-9, tiret, 30 au plus) ; style : nul ou texte de même forme ; sexe : all, M
--    ou F ; sinon erreur (rien n'est écrit). Les noms exacts des thèmes et des styles sont vérifiés par l'appli à la
--    lecture (un thème retiré plus tard redevient « Auto » sans rien casser).
-- 3) Droits : écriture par la fonction seulement, comptes connectés (pas anon) ; lecture de la colonne comme les autres
--    colonnes du profil (comme affichage). L'appli appelle la fonction 1,5 s après le dernier changement, en ligne ; jamais
--    pendant « Voir comme… ».
-- Retour arrière : drop function if exists public.hb_set_preferences(jsonb); alter table public.hb_profiles drop column if exists preferences;
-- (les appareils gardent leur copie).
-- Note : relancer 029 ou 046 retirerait le droit d'exécution de hb_set_preferences : relancer 075 après eux.

-- ---------- Colonne ----------

alter table public.hb_profiles add column if not exists preferences jsonb;
grant select (preferences) on public.hb_profiles to authenticated;

-- ---------- Écriture ----------

create or replace function public.hb_set_preferences(p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_id constant text := '^[a-z0-9-]{1,30}$';
begin
  if auth.uid() is null then
    raise exception 'Non connecté' using errcode = '42501';
  end if;
  if p is not null then
    if jsonb_typeof(p) <> 'object'
       or exists (select 1 from jsonb_object_keys(p) k where k not in ('theme', 'style', 'sexe')) then
      raise exception 'Préférences : objet { theme, style, sexe } attendu' using errcode = '22023';
    end if;
    if p ? 'theme' and (jsonb_typeof(p -> 'theme') <> 'string' or (p ->> 'theme') !~ v_id) then
      raise exception 'Préférences : thème invalide' using errcode = '22023';
    end if;
    if p ? 'style' and jsonb_typeof(p -> 'style') <> 'null' and (jsonb_typeof(p -> 'style') <> 'string' or (p ->> 'style') !~ v_id) then
      raise exception 'Préférences : style invalide' using errcode = '22023';
    end if;
    if p ? 'sexe' and (jsonb_typeof(p -> 'sexe') <> 'string' or (p ->> 'sexe') not in ('all', 'M', 'F')) then
      raise exception 'Préférences : filtre Garçons / Filles invalide' using errcode = '22023';
    end if;
  end if;
  update public.hb_profiles set preferences = p where user_id = auth.uid();
end $$;

revoke all on function public.hb_set_preferences(jsonb) from public, anon;
grant execute on function public.hb_set_preferences(jsonb) to authenticated;

-- ---------- Vérification ----------
-- Colonne présente et lisible, fonction appelable par un compte connecté, pas par anon ; aucune préférence au départ.
select (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'hb_profiles' and column_name = 'preferences') as colonne_1,
       has_column_privilege('authenticated', 'public.hb_profiles', 'preferences', 'select') as appli_peut_lire,
       has_function_privilege('authenticated', 'public.hb_set_preferences(jsonb)', 'execute') as appli_peut_ecrire,
       has_function_privilege('anon', 'public.hb_set_preferences(jsonb)', 'execute') as anon_peut_ecrire,
       (select count(*) from public.hb_profiles where preferences is not null) as comptes_avec_preferences;
