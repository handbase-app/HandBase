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
  `MISTRAL_MODELE_FILTRES` (`mistral-small-latest` par défaut, recherche de joueurs),
  `MISTRAL_MODELE_AVIS` et `MISTRAL_MODELE_QUESTION` (`mistral-small-latest` par défaut : avis vocal, « Poser une question »),
  `MISTRAL_MODELE_SQL` (`codestral-latest` par défaut : mode avancé de « Poser une question »).

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
- Le GET renvoie `modes` (`dictee`, `filtres`, …) : l'appli n'affiche la recherche que si la fonction déployée la connaît.

Redéploiement après cette mise à jour (base de test, depuis la racine du dépôt ; aucun secret ni SQL en plus) :

```sh
npx supabase functions deploy transcrire --project-ref ieatjtylxjoxiuewecuh
```

Puis, dans l'appli (site de démo, compte administrateur) : se déconnecter et se reconnecter, ou ouvrir un nouvel onglet
(l'accès est gardé pour la session), ouvrir Joueurs : le micro et « ✨ » apparaissent à côté de « Rechercher… ».
Depuis que les filtres de la liste Joueurs sont une recette (section 10), la liste Joueurs passe par `?mode=question` ;
les consignes « filtres » de la liste Joueurs restent pour les versions plus anciennes de l'appli.

### Autres pages : vue nationale, bilan de détection, Événements, Groupes (champ `page`)

Le même bouton « micro ✨ » est sur chaque page qui a des filtres. Chaque page envoie **son** schéma (clés et valeurs
permises, construits par l'appli : `src/voiceSearch.ts` pour les listes de joueurs, `src/voicePages.ts` pour les autres) ;
les noms d'événements, de groupes et de clubs ne sont **jamais** listés : le modèle recopie ce qui est dit, l'appli le
retrouve parmi ses données et revérifie chaque valeur.

- Requête : la même (`POST ?mode=filtres`), avec en plus `page` (`bilan`, `evenements` ou `groupes`) hors liste Joueurs.
  La fonction prend alors les consignes et les exemples de cette page (`CONSIGNES_PAGES` dans `index.ts`, ≈ 2 000
  caractères avec le schéma) ; `page` absente ou inconnue : consignes de la liste Joueurs, comme avant. Une version
  plus ancienne de la fonction ignore `page`.
- Le GET annonce en plus `filtres_bilan`, `filtres_evenements` et `filtres_groupes` dans `modes`.
- **Vue nationale** (filtres de joueurs, sans département : la carte le choisit) et **bilan de détection** (sexe,
  génération, période « Cette saison / Depuis toujours », région, département, club, vue carte / générations) : marchent
  aussi avec la version déjà déployée (consignes de la liste Joueurs, mêmes clés) ; la nouvelle version a des exemples
  propres au bilan.
- **Événements** (type, année, « mes événements », nom ou lieu) et **Groupes** (portée, garçons / filles / mixte, ligue,
  comité, année d'âge, nom) : le bouton n'apparaît **qu'après le redéploiement** (l'appli attend `filtres_evenements` /
  `filtres_groupes` dans `modes`).
- Test (sans appel réseau) : `npx jiti tools/test-recherche-vocale-pages.ts` (chaque exemple des consignes de chaque
  page est accepté par l'appli et a l'effet attendu ; rien d'autre que la phrase, le schéma et les filtres actifs n'est envoyé).

Redéploiement nécessaire pour Événements et Groupes (base de test, depuis la racine du dépôt ; aucun secret ni SQL en plus) :

```sh
npx supabase functions deploy transcrire --project-ref ieatjtylxjoxiuewecuh
```

Puis se déconnecter et se reconnecter (ou nouvel onglet) : le bouton apparaît dans Événements et Groupes.

## 7. Avis vocal (`?mode=avis`)

Sur l'écran de notation, « ✨ Avis vocal » : le coach parle librement du joueur ; l'appli dicte (POST habituel), puis
envoie le texte à `POST ?mode=avis` (JSON) : `{ texte, criteres: [{ id, label, description?, echelle: { min, max, libelles? } }] }`
→ `{ notes: [{ id, valeur, extrait, confiance }], pointsForts, axes, ambigus, ms, restant_mois, restant_jour }`.

- Seuls le texte (2 000 caractères au plus) et les critères notés sur une échelle qui s'appliquent au poste du joueur sont
  envoyés, sous des identifiants courts (`c1`, `c2`…) ; aucune donnée de joueur, aucun nom. La fonction recopie les
  critères champ par champ avant de les transmettre.
- Modèle : `mistral-small-latest` (secret facultatif `MISTRAL_MODELE_AVIS` pour en changer), température 0, réponse JSON ;
  consignes courtes en français avec deux exemples (`CONSIGNES_AVIS` dans `index.ts`).
- Même compte et mêmes plafonds : un appel compté par avis (deux avec la dictée). Relance sur 429 comme les autres modes.
  Ni le texte ni la réponse ne sont journalisés.
- L'appli revérifie tout (`src/dictation/avis.ts`, test : `npx jiti tools/test-avis-vocal.ts`) et n'affiche que des
  propositions : le coach accepte, change ou écarte chaque note, puis enregistre comme d'habitude.
- Le GET renvoie `modes: ['dictee', 'filtres', 'avis']` : le bouton n'apparaît qu'avec une fonction qui connaît `avis`.

## 8. « Poser une question » au bilan de détection (`?mode=question`)

Dans le bilan de détection, « micro ✨ Poser une question » (ou la question tapée) : « les joueuses 2011 vues une seule fois
cette saison, par département », « combien de gardiens 2009 mesurent plus de 1 m 85 », « les clubs du Var où on n'a vu
personne depuis septembre »… La **réponse est calculée sur l'appareil** (données locales), jamais par le serveur.

- Requête : `POST ?mode=question`, JSON `{ phrase, schema }` : la phrase (300 caractères au plus) et la **description de la
  recette** construite par l'appli (`src/recipe.ts`, `buildQuestionSchema` : clés, opérateurs, postes, catégories et
  critères d'avis, mesures, zones du radar, date du jour). **Aucune donnée de joueur**, aucun nom de club, de région, de
  département, de groupe ou d'événement : le modèle recopie ce qui est dit et l'appli le retrouve dans ses listes.
- Réponse : `{ recette, nonGere, ms, model, restant_mois, restant_jour }`. La recette est un petit JSON (population, condition
  « vu » par événement ou par personne avec une période, moyennes d'avis, nombre d'avis, mesures, sortie nombre / liste /
  tableau / carte). L'appli revérifie **chaque champ** (inconnu : ignoré et signalé), borne les nombres, ne fait que lire.
  `nonGere` (ce que le modèle n'a pas su traduire) est sorti de la recette s'il y a été mis, et accepté en texte seul.
- Ce que la recette sait dire, en plus des filtres : tableau **par personne du staff** (joueurs vus distincts, avis écrits ;
  noms lus sur l'appareil, jamais envoyés), **score combiné** de plusieurs critères ou catégories (« Vitesse + Intelligence
  de jeu »), tri par **progression** (dernier avis moins le précédent, au moins deux avis), tri **« à voir en priorité »**
  (vus une fois et déjà bien notés ≥ 3,5 « à confirmer », puis pas encore vus des plus âgés aux plus jeunes, puis les autres
  vus une fois ; règle affichée), tableaux triés par **part vue** (« le plus en retard » : croissante). Les moyennes d'une
  catégorie ou d'une zone ne comptent que les critères qui concernent le poste du joueur.
- **Moyennes de mesures et âge moyen** (`valeur: moyenne_mesure` + `mesure`, `valeur: age_moyen`) : colonne d'un tableau
  (moyenne, plus petite et plus grande valeur, nombre de mesurés) ou valeur sous un nombre ; tableau **par événement**
  (`par: evenement` : les joueurs vus à chaque événement, le plus récent d'abord) ; **notes une par une** (`calcul: max`
  « jamais plus de 3 en défense », `calcul: min` « toujours au moins 3 »).
- **Pas de substitution** : les consignes interdisent de remplacer une grandeur demandée (taille, âge, poids, mesure) par une
  moyenne d'avis (sinon `nonGere`) ; l'appli le revérifie sur la phrase (`checkQuantities` dans `src/recipe.ts`) : grandeur
  dite mais pas calculée, « jamais plus de / toujours au moins » rendu en moyenne → « Pas pris en compte ».
- Côté écran : une période n'est ajoutée que pour « vu » (saison en cours par défaut, toujours affichée) ; la recette n'est
  la réponse principale que si elle a **tout** appliqué. Sinon (« Non appliqué », « Pas pris en compte », approximation, pas
  comprise), **bascule automatique en mode avancé** (section 9) ; sans mode avancé, réponse partielle et bandeau, ou « Je ne
  sais pas encore répondre à … » avec des exemples, jamais une liste par défaut.
- Modèle : `mistral-small-latest` (secret facultatif `MISTRAL_MODELE_QUESTION`), température 0, réponse JSON ; consignes
  courtes en français avec 30 exemples (`CONSIGNES_QUESTION` dans `index.ts`, ≈ 13 200 caractères avec la description).
- Recherche par prénom ou nom (« combien de joueurs s'appellent Lucas » → `population.noms`, cherché sans accents, mots
  entiers du prénom ou du nom) ; tri des tableaux par nombre (« quel club a le plus de pivots gauchers » → `tri: compte`).
- Mêmes garde-fous : administrateur connecté, JWT, un appel compté (`hb_transcription_compter`), relance sur 429, ni la
  phrase ni la réponse journalisées par la fonction. Erreurs en plus : `phrase_absente`, `phrase_trop_longue`,
  `schema_invalide`, `reponse_illisible` ; `mode_inconnu` (400) pour un `?mode=` que la version déployée ne connaît pas.
- Le GET annonce `question` dans `modes` : le bouton n'apparaît qu'avec une fonction qui le connaît (et pour les
  administrateurs, réglage de dictée activé). L'appli **relit les modes toutes les 10 minutes**, au retour sur l'onglet
  s'ils datent de plus de 10 minutes, et tout de suite après un `mode_inconnu` : après un redéploiement, plus besoin de se
  reconnecter. Les questions enregistrées (« Mes questions ») se relancent sans appel.
- Journal des questions (appli, pas la fonction) : chaque question est notée **anonymisée sur l'appareil** (phrase, ce
  qu'a fait la recette, résultat du mode avancé, jamais la réponse) dans `hb_question_log` (`supabase/043_journal_questions.sql` :
  écriture par tout compte qui peut poser une question, lecture par les administrateurs seulement, effacement après 12 mois).
- Test (sans appel réseau) : `npx jiti tools/test-questions.ts` (chaque exemple des consignes accepté par l'appli avec
  l'effet attendu, recettes piégées écartées, aucune donnée de joueur envoyée, 40 000 joueurs en moins de 300 ms, liste
  triée sur toute la base comprise).

Redéploiement (base de test, depuis la racine du dépôt ; aucun secret ni SQL en plus) :

```sh
npx supabase functions deploy transcrire --project-ref ieatjtylxjoxiuewecuh
```

« Poser une question » apparaît dans le bilan de détection au plus tard 10 minutes après (ou en revenant sur l'onglet).

## 9. « Poser une question », mode avancé (`?mode=sql`)

Dès que la recette n'a pas tout appliqué (« Non appliqué », « Pas pris en compte », approximation signalée) ou ne comprend
pas, l'appli bascule **automatiquement** en mode avancé (un appel de plus) : sa réponse devient la réponse principale, avec
un lien discret « Voir la réponse simplifiée » (la recette partielle). En cas d'échec, la réponse partielle et un bouton
« Réessayer en mode avancé ». Le modèle écrit une **requête SQLite**, que l'appli exécute **uniquement dans le navigateur**, sur une
**copie jetable** de ses données locales. **Jamais de SQL sur la base Supabase** ; IndexedDB n'est jamais modifiée.

- Requête : `POST ?mode=sql`, JSON `{ phrase, schema, precedent? }` : la phrase (300 caractères au plus) et la
  **description des tables** de la copie (`src/sqlMirror.ts`, `buildSqlSchema` : colonnes, postes, catégories et critères
  des réglages, types d'événements, date du jour). **Aucune donnée, aucun nom** de joueur, de club, de lieu, de groupe,
  d'événement ou de personne. `precedent` `{ sql, erreur }` : **une seule** correction après une erreur de SQLite (la
  requête et le message d'erreur, jamais de lignes de résultat).
- Réponse : `{ sql, explication, affichage, nonGere, ms, model, restant_mois, restant_jour }` ; `affichage` : `nombre`,
  `liste`, `tableau` ou `carte`. La fonction ne garde que la forme (une requête qui commence par SELECT ou WITH, 4 000
  caractères au plus) ; `sql` vide et `nonGere` si les tables ne permettent pas de répondre.
- Modèle : `codestral-latest` (secret facultatif `MISTRAL_MODELE_SQL`), température 0, réponse JSON ; consignes en français
  avec 13 exemples (`CONSIGNES_SQL` dans `index.ts`, ≈ 9 800 caractères avec la description) : SQLite seulement, une seule
  instruction SELECT / WITH, LIMIT 500 au plus, colonne `joueur_id` quand on liste des joueurs, comparaison des noms par
  `sans_accents(…)`, explication courte positive ou neutre.
- Dans l'appli : la requête est **recontrôlée** (`src/sqlGuard.ts` : une seule instruction, commence par SELECT ou WITH,
  refus d'ATTACH, PRAGMA, INSERT, UPDATE, DELETE, CREATE, DROP, ALTER, REPLACE, VACUUM, des fonctions de chargement et des
  tables internes, LIMIT 500 ajouté ou ramené), puis exécutée dans un **Web Worker** (sql.js, SQLite WASM ≈ 330 Ko
  compressé, chargé seulement au premier usage) sur la copie **en lecture seule** (`PRAGMA query_only`), coupée au-delà de
  3 secondes. Copie construite à la première requête (≈ 0,6 s pour 40 000 joueurs), gardée tant qu'on reste dans le bilan,
  refaite quand les données changent. Pas de commentaires ni de textes libres des coachs dans la copie.
- Écran : « Réponse en mode avancé », « Ce que j'ai calculé : … », résultat (nombre, joueurs cliquables vers leur fiche avec
  Retour exact, ou tableau), « Voir la requête » ; « Enregistrer cette question » : relancée ensuite sans appel.
- Mêmes garde-fous : administrateur connecté, JWT, un appel compté par requête (correction comprise,
  `hb_transcription_compter`), relance sur 429, rien journalisé par la fonction. Le GET annonce `sql` dans `modes` : sans
  lui, l'appli garde la réponse partielle et son bandeau, ou « Je ne sais pas encore répondre » (rétrocompatible).
- Test (sans appel réseau) : `npx jiti tools/test-sql.ts` (copie construite depuis un jeu fictif, contrôle des requêtes,
  chaque exemple des consignes exécuté avec le résultat attendu, 40 000 joueurs, aucune donnée dans ce qui part).

Redéploiement (base de test, depuis la racine du dépôt ; aucun secret ni SQL en plus) :

```sh
npx supabase functions deploy transcrire --project-ref ieatjtylxjoxiuewecuh
```

Le mode avancé est proposé dans « Poser une question » au plus tard 10 minutes après (ou en revenant sur l'onglet).

## 10. Liste Joueurs : les filtres sont une recette (`?mode=question`, contexte `joueurs`)

Sur la liste Joueurs, un seul champ « Filtrer ou poser une question… » et un micro ✨ (à la place du micro « Filtrer ») :
un simple nom (« Martin », une licence) reste une recherche locale, **sans appel** ; une phrase part au mode `question`,
comme au bilan, et la recette rendue **filtre ou trie la liste sur place** (`src/playerQuery.ts`,
`src/components/PlayersQuery.tsx`). Les filtres s'affichent en pastilles ; le bouton « Filtres » construit la même recette
à la main (filtres rapides, « + Ajouter une condition », « Trier par »).

- Requête : `POST ?mode=question`, JSON `{ phrase, schema, contexte: "joueurs", actuels }` : `actuels` = les **noms** des
  filtres posés (`sexe`, `annee`, `taille`, `recherche`…, 40 au plus), **jamais leurs valeurs ni un nom de joueur** (le nom
  cherché : sa présence seulement, `recherche`). La fonction ajoute alors ses consignes « liste Joueurs »
  (`CONSIGNES_JOUEURS` dans `index.ts`, 8 exemples) et le message devient `Actuels [...] ; « phrase »`.
- Réponse : `{ recette, nonGere, action, retirer, ms, model, restant_mois, restant_jour }` ; `action` : `ajouter` (par
  défaut), `retirer` (clés dans `retirer`) ou `effacer` ; sans `contexte`, la réponse est la même qu'avant (bilan).
- **Règle de combinaison** (appliquée par l'appli, `mergeQuery`) : une nouvelle phrase **ajoute** à la sélection (filtres
  posés à la main ou par une phrase d'avant) ; une clé redite prend la nouvelle valeur (« seulement les filles ») ; on
  n'efface que si c'est dit (« efface tout et… », « recommence ») — l'appli le vérifie dans la phrase et ne laisse jamais le
  modèle remplacer les filtres sans ce mot ; « enlève la taille », « peu importe le poste » : retrait (sans appel quand
  c'est évident). Question de calcul (« quelle est la taille moyenne ? », « combien par club ? ») : calculée **sur la
  sélection**, affichée au-dessus de la liste, qui reste filtrée. « Annuler » remet les filtres d'avant.
- Recette incomplète : bascule automatique en **mode avancé** (`?mode=sql`, section 9) ; la liste devient les joueurs du
  résultat s'il a une colonne `joueur_id`, sinon le résultat s'affiche en tête. Journal des questions comme au bilan.
- Le GET annonce `question_joueurs` dans `modes`. **Rétrocompatible** : une fonction déployée plus ancienne ignore
  `contexte` et `actuels` ; l'appli décide alors l'action elle-même d'après la phrase (ajout par défaut).
- Test (sans appel réseau) : `npx jiti tools/test-filtres-recette.ts` (fusion, calcul sur la sélection, exemples des
  consignes « joueurs », mêmes joueurs retenus que les anciens filtres rapides, 40 000 fiches en moins de 150 ms).

Redéploiement (base de test, depuis la racine du dépôt ; aucun secret ni SQL en plus) :

```sh
npx supabase functions deploy transcrire --project-ref ieatjtylxjoxiuewecuh
```
