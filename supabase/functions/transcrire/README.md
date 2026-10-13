# Fonction « transcrire » (Voxtral, Mistral AI)

Dictée en ligne pour la page d'essai `/essai-dictee/` (moteur « Voxtral (Mistral, en ligne) ») et pour l'appli (micro à
côté des commentaires), plus la **recherche de joueurs en langage naturel** (`POST ?mode=filtres`, voir plus bas). La clé Mistral reste
dans les secrets de la fonction, jamais dans la page ni dans le dépôt. Réservée aux administrateurs connectés.
Aucun son ni texte n'est enregistré ou journalisé ; seuls des nombres d'appels sont comptés (`042_quota_transcription.sql`).

Pour l'essai : **base de test seulement** (site de démo). Offre gratuite Mistral : les données envoyées peuvent servir à
l'entraînement de leurs modèles, donc phrases d'essai seulement, sans nom de joueur.

## 1. Clé Mistral (une fois)

1. Ouvrir https://console.mistral.ai et créer un compte (ou se connecter).
2. Choisir l'offre gratuite (« Experiment ») dans la partie facturation (*Admin* → *Billing* ou *Plans*) ; Mistral demande
   en général de vérifier un numéro de téléphone.
3. *API Keys* → *Create new key* : nom `handbase-test`, expiration si proposée. Copier la clé tout de suite (elle n'est
   montrée qu'une fois). Ne la coller nulle part ailleurs que dans le secret Supabase de l'étape 3.
4. Plafond de dépense : dans *Admin* → *Billing* (ou *Limits* / *Usage limits*), **vérifier que l'option existe** de fixer
   une limite mensuelle de dépense ou d'usage, et la régler au plus bas utile (par exemple 5 €). L'emplacement et le nom
   de cette option peuvent changer ; avec l'offre gratuite il n'y a pas de facture, la limite servira au passage en payant.
   Les plafonds de la fonction (étape 3) s'ajoutent à celui-ci.

## 2. Compteurs (base de test)

Supabase (projet de **test**) → *SQL Editor* → coller `supabase/042_quota_transcription.sql` → *Run*.

## 3. Secrets (base de test)

Supabase (projet de test) → *Edge Functions* → *Secrets* → *Add new secret* :

- `MISTRAL_API_KEY` : la clé de l'étape 1 ;
- facultatifs : `TRANSCRIRE_QUOTA_MOIS` (appels par mois civil pour tous, 2000 par défaut),
  `TRANSCRIRE_QUOTA_JOUR` (appels par jour et par compte, 200 par défaut),
  `MISTRAL_MODELE` (`voxtral-mini-latest` par défaut),
  `MISTRAL_MODELE_FILTRES` (`mistral-small-latest` par défaut, recherche de joueurs).

## 4. Déploiement

En ligne de commande, depuis la racine du dépôt (`<ref-test>` : identifiant du projet de test, visible dans son adresse
`https://<ref-test>.supabase.co`) :

```sh
npx supabase login
npx supabase functions deploy transcrire --project-ref <ref-test>
```

Garder la vérification JWT (ne pas ajouter `--no-verify-jwt`). Sans la ligne de commande : *Edge Functions* →
*Deploy a new function* → *Via Editor*, nom `transcrire`, coller `index.ts`, laisser *Verify JWT* activé, *Deploy*.

## 5. Vérification

1. Ouvrir le site de démo, se connecter avec un compte administrateur.
2. Ouvrir `https://handbase-demo.github.io/essai-dictee/` : sous « Moteur », la ligne Voxtral doit dire « prêt » avec
   le nombre de dictées restantes.
3. Choisir « Voxtral (Mistral, en ligne) », dicter une phrase d'essai.

Réponses d'erreur (JSON `error`) : `non_connecte` (401), `pas_admin` (403), `quota_atteint` / `quota_jour_atteint` (429,
avec `restant_mois` et `restant_jour`), `trop_long` / `trop_gros` (413, 60 s ou 2 Mo au plus), `cle_absente` (503),
`mistral_limite` / `mistral_cle` / `mistral_erreur` (502). Un appel refusé par Mistral compte quand même dans les plafonds.
Les mots de contexte (`context_bias`, 100 au plus, expressions reliées par « _ ») sont envoyés seulement si
« Utiliser le vocabulaire du hand » est coché ; si Mistral les refuse, la fonction refait l'appel sans eux.

## 6. Recherche de joueurs en langage naturel (`?mode=filtres`)

Liste Joueurs de l'appli : micro à côté de « Rechercher… », ou phrase tapée puis « ✨ ». Exemple : « tous les joueurs nés
en 2010 qui mesurent plus d'1 m 80 » → filtres « année 2010 » et « taille ≥ 180 cm ».

- Requête : `POST /functions/v1/transcrire?mode=filtres`, JSON `{ phrase, schema, actuels }` (phrase de 300 caractères au
  plus ; schéma compact construit par l'appli dans `src/voiceSearch.ts` : une ligne par clé, valeurs possibles, noms des
  groupes et des profils recherchés du compte ; régions, départements et clubs ne sont pas listés : le modèle recopie ce
  qui est dit et l'appli le retrouve ; `actuels` : filtres actifs, avec les clés du schéma). **Jamais de données de joueurs.**
- Opérations : le modèle rend une `action` : `remplacer` (nouvelle recherche), `ajouter` (garder les filtres actuels et
  ajouter ou changer des critères : « ajoute le Var », « seulement les gauchères »), `retirer` (clés dans `retirer` :
  « enlève la taille », « peu importe le poste ») ou `effacer` (« efface la sélection »). Les commandes évidentes pour tout
  effacer (« efface tout », « réinitialise », « remets à zéro »…) sont reconnues par l'appli sans appel.
- Noms : « trouve Lucas Martin », « le joueur Dupont », « les Martin nés en 2010 », « ajoute Martin » → clé `recherche`,
  nom recopié tel quel ; licence dite par morceaux recollée ; « enlève le nom » → `retirer: ["recherche"]`. Le nom cherché
  n'est pas renvoyé au modèle dans `actuels` (seulement `"recherche": "(nom)"`). La liste cherche sans accents ni
  majuscules, puis, si personne, des noms approchants (« Dupond » → « Dupont » : « Résultats approchants pour … »).
- Consignes (`CONSIGNES` dans `index.ts`) : courtes, avec 14 exemples, pensées pour les petits modèles (ministral-8b) ;
  environ 5 200 caractères avec le schéma (≈ 1 500 jetons) ; `tools/test-recherche-vocale.ts` vérifie que chaque exemple est
  accepté par l'appli.
- Mistral : `chat/completions`, modèle `mistral-small-latest` (secret `MISTRAL_MODELE_FILTRES` pour en changer),
  température 0, `response_format: json_object`. Consignes : n'utiliser que les clés et valeurs du schéma, ne rien
  inventer, mettre ce qui n'est pas géré dans `nonGere`.
- Réponse : `{ action, filtres, retirer, nonGere, ms, model, restant_mois, restant_jour }`. L'appli revérifie chaque valeur.
  Avec une version de la fonction sans `action`, l'appli remplace les filtres (comportement d'avant).
- Mêmes règles que la dictée : administrateur connecté, mêmes plafonds (un appel compté par phrase ; avec le micro, deux :
  la transcription puis la recherche), mêmes origines (CORS), rien de la phrase n'est journalisé. Erreurs en plus :
  `phrase_absente` (400), `phrase_trop_longue` (413), `schema_invalide` (400), `reponse_illisible` (502).
- Le GET renvoie `modes: ['dictee', 'filtres']` : l'appli n'affiche la recherche que si la fonction déployée la connaît.

Redéploiement après cette mise à jour (base de test, depuis la racine du dépôt ; aucun secret ni SQL en plus) :

```sh
npx supabase functions deploy transcrire --project-ref ieatjtylxjoxiuewecuh
```

Puis, dans l'appli (site de démo, compte administrateur) : se déconnecter et se reconnecter, ou ouvrir un nouvel onglet
(l'accès est gardé pour la session), ouvrir Joueurs : le micro et « ✨ » apparaissent à côté de « Rechercher… ».
