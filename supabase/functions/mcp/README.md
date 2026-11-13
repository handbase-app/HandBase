# Fonction « mcp » : serveur MCP Nextar

Le coach branche Nextar dans Claude (*Réglages → Connecteurs → Ajouter un connecteur personnalisé*, adresse
`https://<projet>.supabase.co/functions/v1/mcp`) et se connecte avec son compte Nextar (serveur OAuth 2.1 de Supabase Auth ;
page d'autorisation de l'appli : `/oauth/consent`). Claude peut alors lire en codes, proposer des mesures, des avis, des
joueurs vus ou à revoir à valider, et garder des rapports en codes, **avec les droits du coach** (RLS, périmètre, rôle).

**Règle : Nextar n'envoie jamais de données de joueur à une IA.** Les réponses ne contiennent que des codes (`J-7K3Q2MX`),
postes, années et trimestres de naissance (jamais la date complète), sexe, département, mesures, moyennes d'avis et nombres
de « vus » (liste blanche : `outils.ts`, `verifierSortie` ; essais : `tools/test-mcp.ts`, `tools/essai-mcp/lancer.sh`).

**Lecture exacte et historique d'un joueur** (`supabase/072_mcp_lecture_appels.sql`, `joueur.ts`) :
- `nextar_lire` rend le **trimestre** de naissance (1 : janvier-mars … 4 : octobre-décembre, calculé côté serveur, la date
  ne sort jamais) et accepte `trimestres: [1..4]` (combinable avec `annees`) et `nes_entre: { de: "2012-T4", a: "2013-T4" }`
  (une seule requête pour « nés entre fin 2012 et 2013 »). Avec **072**, filtres, tri et limite sont faits **dans la base**
  (`hb_mcp_lire`, SECURITY INVOKER : règles de lecture du compte ; ORDER BY … LIMIT avant toute coupe) : un top 10 par
  taille sur une année de plus de 5 000 joueurs est exact (`calcul: "dans la base…"`). Sans 072 : calcul côté serveur MCP
  sur 5 000 joueurs au plus ; au-delà, `approximatif: true` et un avertissement « résultat APPROXIMATIF tant que
  supabase/072_mcp_lecture_appels.sql n'est pas appliqué » (jamais un top faux présenté comme exact). Égalités départagées
  par l'identifiant, des deux côtés.
- **Cause de l'« Erreur du serveur Nextar »** (07/11, `annees: [2013]` + tri par taille, sans sexe) : journal de la fonction
  « nextar_lire : canceling statement due to statement timeout », requête `hb_measurements?data->>playerId=in.(150 ids)` en
  500. Sous RLS, un filtre sur `data->>'playerId'` n'utilise pas l'index (l'opérateur jsonb `->>` n'est pas « leakproof ») :
  chaque paquet relisait les 145 000 mesures (1 à 5 s) et 5 087 joueurs en faisaient 34 ; un paquet a dépassé les 8 s du rôle
  `authenticated`. Corrigé : 072 (une lecture, dans la base) ; sans 072, mesures, avis et « vus » sont lus **par
  département** (`scope_dept`, colonne simple, index utilisable sous RLS, tenue égale au département du joueur par 046),
  seulement ce qu'il faut avant le tri, et un dépassement de délai rend un message clair au lieu d'une erreur du serveur.
- `nextar_joueur` (`code` J-… requis, `tests` ids / libellés ou « toutes », `depuis` / `jusqu_a`) : profil (sexe, année +
  trimestre, département, poste), mesures par test en série datée `[{ valeur, date, evenement }]` (événement du même jour
  où le joueur est inscrit) avec `evolution` (première → dernière valeur, écart, nombre de points), `vus` (événements :
  libellé, date, type), `avis` (moyenne par événement — hors événement : par jour — et par critère ; jamais un commentaire ni
  un auteur). Même périmètre que `nextar_lire` (RLS), tout pour un administrateur. Code inconnu, mal recopié ou hors
  périmètre : la même réponse « introuvable dans ton périmètre » ; code partagé par deux fiches : refus ; fiche fondue ou hors
  cadre : dit comme tel. Aucun SQL nécessaire (lectures par département).

**Journal des appels** (`journalMcp.ts`, table `hb_mcp_appels` de 072) : chaque appel d'outil est noté par le compte
lui-même (son jeton ; règle : pour soi, à l'heure du serveur ; lecture : administrateurs ; ni modification ni suppression ;
purge à 90 jours, tâche pg_cron dans la section ACTIVATION) : heure, compte, outil, durée, succès / erreur, nombre de lignes
rendues et **filtres structurés** seulement (années, trimestres, postes, départements, identifiants de tests ou
d'événements, tri, limite, codes J-… / C-…, nombre de lignes reçues) — **jamais les paramètres bruts** (lignes d'une
proposition, textes d'avis, titres, noms d'événements tapés). L'écriture part sans être attendue (`EdgeRuntime.waitUntil`) et
son échec, ou l'absence de 072, ne change rien à la réponse. Canal **`mcp`** : `nextar_connexions` distingue « appli »,
« mcp » et « appli et mcp » (`appels_mcp`, `dernier_appel_mcp`, `par_canal` ; l'appel en cours compte : un administrateur qui
n'utilise que Claude apparaît dans « qui est connecté maintenant ? ») ; `nextar_admin_activite` ajoute `canal`, `appels_mcp`,
`appels_mcp_erreurs`, `dernier_appel_mcp`, `outils` ; `nextar_admin_journal` a le type **`mcp`** (sessions : canal, outils ;
lignes : outil, durée, succès, lignes, filtres en texte court).

**Schémas publiés = paramètres lus** : titres, descriptions et schémas d'entrée sont dans `schemas.ts` (construits avec zod par
`serveur.ts`) ; `tools/test-mcp.ts` les construit avec un faux `z` qui note les clés déclarées et les compare, pour chaque
outil, aux paramètres lus par son code (accès notés sur l'entrée et `input.x` du code) : un paramètre lu mais non publié (ou
publié mais jamais lu) fait échouer l'essai. Le 07/11, le schéma « sans par / depuis / jusqu_a / inclure_generation » vu par
Claude pour `nextar_admin_activite` était celui d'une liste d'outils gardée en cache par le connecteur : la v6 en ligne les
publie (vérifié dans le code déployé) ; reconnecter le connecteur relit la liste (version du serveur passée à 1.1.0).

Seule exception, **pour les administrateurs** : `nextar_connexions` rend le nom affiché et le rôle des **comptes du staff**
connectés récemment (jamais d'adresse mail, de téléphone, d'identifiant brut, d'adresse IP ni de donnée de joueur ; liste
blanche à part, où « nom_affiche » est la seule clé de nom permise, et aucun texte avec « @ » ou une adresse IP). Un compte qui
n'est pas administrateur reçoit un refus, sans rien lire. Aucun SQL nouveau : `hb_is_admin()` (043), `hb_connections` (030,
lecture administrateurs), `hb_profiles` (colonnes publiques de 029), affectations et unités (044).

**Quatre outils d'administration, en lecture seule** (`admin.ts` ; plus trois de traçabilité, `adminTraces.ts`, ci-dessous), même régime : refus sans rien lire pour un compte qui
n'est pas administrateur, toujours le jeton du compte (jamais la clé de service), une liste blanche par outil
(`outils.ts`, `CLES_ADMIN`) et le contrôle des textes ; joueurs en codes `J-…` seulement, comptes du staff en code `C-…`,
nom affiché et rôle ; aucune écriture.
- `nextar_admin_a_faire` : comptes sans rôle (depuis quand), fiches proposées et avis spontanés à valider (codes, auteur),
  doublons probables (paires de codes et raison : même règle que `src/merge.ts` et l'écran « Propositions »), propositions
  « À valider » du compte (titre masqué comme les questions), questions du journal à traiter (règle de Réglages › Journal).
- `nextar_admin_sante` : lignes vivantes des tables principales (comptages sans transfert de lignes), comptes par rôle,
  comptes connectés sur 24 h / 7 j / 30 j et types d'appareils, dernière écriture (hb_audit, la date seule), erreurs du mode
  avancé sur 7 jours. La version de l'appli n'est enregistrée nulle part (`hb_connections.device` ne porte que le type
  d'appareil) : « indisponible ». Avec **`supabase/069_admin_sante.sql`** (fonction `hb_admin_sante()`, SECURITY DEFINER
  réservée aux administrateurs) : taille de la base et des tables, registre des changements (061), charge annoncée,
  abonnements aux notifications (des nombres), rappels de la veille, notifications en attente, tâches pg_cron (état et
  échecs, ni commande ni message), quota de transcription. Sans 069 : ces lignes disent « indisponible tant que
  supabase/069_admin_sante.sql n'est pas appliqué », le reste répond.
- `nextar_admin_activite` (`jours` défaut 30, de 1 à 365, ou période calendaire `depuis` / `jusqu_a` ; `par` total, jour ou
  heure ; `inclure_generation` ; `inactifs_jours` ; `limite` ≤ 200) : par compte du staff, classé du plus actif au moins
  actif, lignes créées sur la période (avis, mesures, « vus » : colonne `created_by` de 058 ; événements :
  `data->>createdBy` ; fiches), ventilées par provenance, histogramme par jour ou par heure (heure de Paris), dernière
  activité (dernière ouverture `hb_last_seen` ou dernière écriture), comptes inactifs ou jamais vus. Génération exclue par
  défaut ; avec `inclure_generation`, une ligne « Générateur démo » (aucun compte) et les comptes sous lesquels ses lignes
  ont été posées.

**Traçabilité de l'activité du staff** (`adminTraces.ts`, lecture seule, même régime) : qui a fait quoi, quand, avec quelle
**provenance** — `saisie_appli`, `import_fichier` (collage d'un tableau), `proposition_validee` (boîte « À valider ») ou
`generation` (démos, jeux d'essai, lignes écrites par SQL sans compte ; exclue par défaut). La provenance, le lot et l'heure
de création posée par le serveur sont **déduits des lignes sans les réécrire** (`data.source`, `data.lotId` posés par
l'appli depuis cette version ; sinon identifiants `demo-…` / `demo:…`, `data.source` « demo » / « demo-progression »,
`data.demoBilan`, signature « Administration Supabase (SQL) », `data.imported`) ; une ligne générée est datée par son
écriture réelle (`server_updated_at`), car les générateurs antidatent `createdAtServer`. Les outils marchent **avant**
**`supabase/071_provenance.sql`** (lignes lues par pages, au plus 20 000 par type, agrégées par le serveur MCP, « tronque »
au-delà) et **mieux après** : `hb_admin_creations` et `hb_admin_saisies` (SECURITY INVOKER, `hb_is_admin()` d'abord) font les
agrégats dans la base, et la table `hb_lots` décrit les lots (ceux de la démo y sont enregistrés). 071 n'ajoute ni colonne,
ni index, ni déclencheur aux tables synchronisées et ne touche pas `hb_upsert` (une colonne générée réécrirait la table).
- `nextar_admin_journal` (`compte?` C-…, `depuis` / `jusqu_a` défaut 24 h, 31 jours au plus, `types?`, `regrouper` défaut
  oui, `inclure_generation`, `limite` défaut 100, ≤ 500) : créations, modifications, suppressions (historique `hb_audit` :
  heure, compte, table, ligne, action — jamais le résumé, qui porte le nom du joueur, ni les changements) et ouvertures de
  l'appli (`hb_connections`). Regroupé : sessions (actions d'un compte à moins de 15 min) avec début, fin, appareil, nombres
  par type et par action, événements et tests touchés, joueurs distincts, provenances, lots ; sinon une ligne par action
  (heure exacte, compte, action, type, objet en code `J-…`, test, valeur, événement, provenance, lot). La génération (écrite
  déclencheurs coupés, absente de l'historique) est lue dans les tables, `historique: false`.
- `nextar_admin_saisies` (`auteur?` C-… ou « générateur », période défaut 30 jours, `test?`, `evenement?`, `source?`,
  `detail?`, `limite` ≤ 500) : mesures par test (nombre, joueurs, min, max, moyenne, événements — même jour, joueur inscrit —,
  première et dernière heure, provenances), avis par critère (nombre de notes, joueurs, moyenne ; jamais un commentaire) ;
  `detail` : les lignes en codes.
- `nextar_admin_lots` (période défaut 365 jours, `limite` ≤ 200) : lots (collage, proposition validée = identifiant de la
  proposition, génération) avec description, auteur (génération : « Générateur démo » et comptes porteurs), première et
  dernière écriture réelles, durée, volumes par type, dates déclarées dans les lignes (antidatage), enregistré ou non dans
  `hb_lots`.
Toutes les heures : ISO UTC et un champ lisible à l'heure de Paris (`…_paris`).
- `nextar_admin_questions` (`jours`, `filtre` « a_traiter » ou « toutes », `limite` ≤ 100) : questions du journal (043, 049)
  regroupées par phrase semblable (`src/questionLogCore.ts`), nombre, comptes distincts, issue, recette, avis des
  entraîneurs, ce que la recette n'a pas appliqué, ce qu'ils voulaient. **Masquage côté serveur** : chaque mot (ou partie de
  mot composé) égal, sans accents ni majuscules, à un prénom ou un nom d'une fiche du périmètre devient `[joueur]` ; un mot
  propre inconnu (majuscule hors début de phrase, absent du vocabulaire : tests, événements, groupes) devient `[nom]` ;
  licences `[licence]`, coordonnées retirées. La liste des noms ne sort jamais. Plus de 100 000 fiches : aucune formulation,
  seulement les nombres et les pages. Limite connue : un nom mal orthographié en minuscules n'est pas reconnu. Ni requête
  SQL, ni détail d'erreur, ni nom d'auteur ne sont lus.

**Trois outils qui proposent sur des joueurs** (`proposerJoueurs.ts`), comme `nextar_proposer` pour les mesures : ils
DÉPOSENT dans la boîte « À valider » du coach (`hb_propositions`, sortes `avis`, `vus`, `a_revoir`, déjà prévues par
`supabase/067_propositions.sql` : **aucun SQL**), et rien n'est écrit dans les fiches avant que le coach valide dans l'appli.
Trois outils plutôt qu'un paramètre « sorte » : un schéma par geste, plus clair pour un modèle ; `nextar_proposer` reste
l'outil des mesures. Rapprochement côté serveur (nom lu sur la feuille, n° de maillot, année, ou code `J-…`), dans
l'événement, le groupe ou toute la base ; par ligne : « trouvé » + code, « à vérifier », « plusieurs possibles » (nombre),
« introuvable », ou « refusée » + raison ; jamais un nom, ni le texte du coach (liste blanche `CLES`).
- `nextar_proposer_avis` (≤ 100 joueurs) : `notes` { id de critère d'avis de `nextar_contexte` : note } contrôlées sur
  l'échelle du critère (score5 : 1 à 5, score3 : 0 à 3, score2 : 0 à 2, notes entières ; choice : une des options ; texte
  libre refusé) et sur le poste du joueur trouvé ; critère inconnu, hors échelle ou pas pour ce poste : refus par note
  (`notes_refusees`), ligne refusée si rien de valable. `date` (défaut : celle de l'événement), `evenement` facultatif ; sans
  événement, avis hors événement (`contexte` unss, club, match, selection, video, autre ; défaut match ; `lieu`).
  `points_forts`, `axes_de_progression` : texte court du coach (300 signes au plus), gardé tel quel, jamais renvoyé.
- `nextar_proposer_vus` (≤ 200) : `evenement` obligatoire ; joueurs cherchés parmi les siens (toute la base s'il n'en a
  aucun).
- `nextar_proposer_a_revoir` (≤ 100) : `raison` courte facultative (120 signes au plus, gardée comme commentaire du « à
  revoir », jamais renvoyée).
Format des lignes : `src/propositionsJoueursCore.ts` (copie dans `partage/`). Dans l'appli (`src/propositionsJoueurs.ts`,
écran `src/components/PropositionsJoueurs.tsx`) : noms remis sur l'appareil, rapprochement refait sur ses fiches, joueur
modifiable (possibles puis recherche, « Ne pas importer cette ligne »), cases, « Enregistrer N avis » (`saveEvaluation`,
`src/avisSave.ts`, sorti de l'écran d'avis ; trace « importé, validé par … », champ `imported`), « Marquer N vus »
(`markSeenMany`), « Mettre N à revoir » (`addRewatchMany`), « Défaire » 10 s (retire ce qui vient d'être créé, remet un avis
complété comme avant), « Garder pour plus tard », « Rejeter ».

**Un outil d'administration qui prépare, sans rien appliquer** (`adminProposer.ts`) : `nextar_admin_proposer`. « Claude
prépare, l'admin valide d'un toucher » : l'outil vérifie chaque action demandée et dépose celles qui sont prêtes dans la
boîte « À valider » de l'administrateur (`hb_propositions`, sorte `admin`, **`supabase/070_propositions_admin.sql`**) ; rien ne
s'applique avant que l'administrateur coche et touche « Appliquer » dans l'appli, qui passe par les mêmes chemins que ses
écrans (`src/propositionsAdmin.ts` : `hb_update_member` comme Réglages › Membres, affectation enregistrée comme Structure,
`archived: true` comme les menus Archiver, `hb_merge_players` comme l'écran « Propositions »), donc avec les mêmes contrôles de
droits. Même régime que les autres outils d'administration (refus sans rien lire ni écrire pour un compte qui n'est pas
administrateur, jeton du compte, liste blanche `CLES_ADMIN.nextar_admin_proposer`), une sorte par proposition, 50 actions au
plus :
- `role` (`{ compte: "C-…", role }`) : Observateur, Encadrant, Joueur (compte en attente seulement) ; jamais administrateur,
  jamais un compte administrateur (le dernier : « dernier administrateur »), jamais son propre compte, pas un rôle déjà là ;
- `perimetre` (`{ compte, unite, role_unite? }` ou `{ compte, secteur: [...] }`) : unité par identifiant ou nom (nom ambigu :
  refusé), secteur (départements vérifiés) ;
- `archiver` (`{ evenement }` / `{ groupe }`, ou `evenements_avant: "AAAA-MM-JJ"` pour une fin de saison) : déjà archivé,
  groupe Pôle (changement de saison) refusés ;
- `fusion` (`{ garder: "J-…", fondre: "J-…" }`) : codes résolus sur les seuls identifiants des fiches ; fiche fondue, code
  faux ou partagé refusés ; l'administrateur peut inverser dans l'appli.
Réponse : par action « prête » ou « refusée » avec la raison, l'identifiant de la proposition et le lien vers la boîte ;
comptes par code, nom affiché et rôle, joueurs en codes. Sans 070 : « Boîte admin indisponible tant que
supabase/070_propositions_admin.sql n'est pas appliqué », rien n'est déposé. Dans l'appli, « Défaire » remet un rôle (si le
compte en avait un), un secteur, une affectation et un archivage ; une fusion ne se défait pas.

| Outil | Entrée | Sortie |
|---|---|---|
| `nextar_contexte` | `archives?` | tests et unités, critères d'avis par poste, postes, événements et groupes (id, nom, date, type, nombre de joueurs) |
| `nextar_proposer` | `tableau` (texte) ou `lignes` (+ `colonnes`), `evenement` / `groupe` (id ou nom), `date`, `titre` | id de la proposition, lien vers la boîte, par ligne : « trouvé » + code, « à vérifier », « plusieurs possibles » (nombre), « introuvable » |
| `nextar_proposer_avis` | `lignes` (`joueur` / `nom` + `prenom`, `numero?`, `annee?`, `notes`, `date?`, `points_forts?`, `axes_de_progression?`), `evenement?` / `groupe?`, `date?`, `contexte?`, `lieu?`, `titre?` | id, lien, par ligne : état + code si trouvé, `nb_notes`, `avec_texte`, `notes_refusees` (critère, raison) ; ou « refusée » + raison |
| `nextar_proposer_vus` | `evenement`, `lignes` (`joueur`, `numero?`, `annee?`), `titre?` | id, lien, par ligne : état + code si trouvé |
| `nextar_proposer_a_revoir` | `lignes` (`joueur`, `numero?`, `annee?`, `raison?`), `evenement?` / `groupe?`, `titre?` | id, lien, par ligne : état + code si trouvé, `avec_raison` ; ou « refusée » + raison |
| `nextar_suivi` | `id?` | état (en attente, validée, validée en partie, rejetée) ; sans id : les 20 dernières |
| `nextar_lire` | années, trimestres, `nes_entre`, sexe, postes, départements, événement, groupe, mesures min/max, vus min, avis min, tri, limite ≤ 200 | lignes en codes (trimestre de naissance) ; `calcul` ; `approximatif` sans 072 au-delà de 5 000 joueurs |
| `nextar_joueur` | `code` (J-…), `tests?`, `depuis?` / `jusqu_a?` | profil, séries datées par test + évolution, vus, avis par événement et critère |
| `nextar_rapport` | `markdown` (avec les codes), `titre?` | lien `/rapport/<id>` (gardé 30 jours, auteur seul), codes mal recopiés |
| `nextar_connexions` (administrateurs) | `minutes?` (défaut 10, de 1 à 10 080), `limite?` (défaut 50, ≤ 200) | par compte, du plus récent : code `C-…`, nom affiché, rôle, périmètre, canal (appli / mcp / les deux), dernière activité (ISO + « il y a N min »), appareil (téléphone / tablette / ordinateur), ouvertures de l'appli, appels MCP et le dernier ; total, nombre par canal |
| `nextar_admin_a_faire` (administrateurs) | `limite?` (par file, défaut 10, ≤ 50) | résumé (nombres), comptes sans rôle, fiches et avis à valider, doublons, propositions en attente, questions à traiter, liens |
| `nextar_admin_sante` (administrateurs) | — | volumes, comptes par rôle, connexions, dernière écriture, version (indisponible), erreurs du mode avancé ; avec 069 : base, tables, registre, charge, abonnements, veille, notifications, tâches, transcription |
| `nextar_admin_activite` (administrateurs) | `jours?` ou `depuis?` / `jusqu_a?`, `par?` (total, jour, heure), `inclure_generation?`, `inactifs_jours?` (défaut 30, 1 à 365), `limite?` (≤ 200) | par compte, du plus actif : avis, mesures, événements, vus, fiches, par provenance, histogramme, dernière activité ; « Générateur démo » et comptes porteurs ; totaux ; inactifs |
| `nextar_admin_journal` (administrateurs) | `compte?`, `depuis?` / `jusqu_a?` (défaut 24 h, ≤ 31 j), `types?`, `regrouper?`, `inclure_generation?`, `limite?` (défaut 100, ≤ 500) | sessions (début, fin, appareil, nombres par type et action, événements, tests, joueurs, provenances, lots) ou une ligne par action (heure, compte, action, type, objet en code, provenance, lot) |
| `nextar_admin_saisies` (administrateurs) | `auteur?`, `depuis?` / `jusqu_a?` (défaut 30 j), `test?`, `evenement?`, `source?`, `detail?`, `inclure_generation?`, `limite?` (≤ 500) | mesures par test (nombre, joueurs, min, max, moyenne, événements, heures, provenances), avis par critère (notes chiffrées), détail en codes |
| `nextar_admin_lots` (administrateurs) | `depuis?` / `jusqu_a?` (défaut 365 j), `limite?` (≤ 200) | lots : provenance, description, auteur et porteurs, première / dernière écriture, durée, volumes, dates déclarées |
| `nextar_admin_questions` (administrateurs) | `jours?` (défaut 30, 1 à 365), `filtre?`, `limite?` (défaut 20, ≤ 100) | résumé, pages, groupes de formulations masquées (nombre, comptes distincts, issue, avis, manques) |
| `nextar_admin_proposer` (administrateurs) | `sorte` (role, perimetre, archiver, fusion), `actions` (≤ 50), `evenements_avant?`, `titre?` | par action « prête » / « refusée » + raison, id de la proposition « À valider », lien ; rien n'est appliqué |

Fichiers : `index.ts` (entrée), `serveur.ts` (SDK MCP `@modelcontextprotocol/server` 2.4.0, `@supabase/server` 1.9.2,
`@supabase/middleware` 1.0.0, zod 4.6.7), `schemas.ts` (titres, descriptions, schémas d'entrée), `journalMcp.ts` (journal des
appels, purs), `joueur.ts` (`nextar_joueur`, pur), `outils.ts` (les outils, purs), `proposerJoueurs.ts` (avis, vus, à revoir, purs), `admin.ts` (les outils d'administration en
lecture, purs), `adminTraces.ts` (traçabilité : journal, saisies, lots, agrégats de l'activité, purs), `adminProposer.ts` (`nextar_admin_proposer`, pur),
`source.ts` (requêtes aux droits du coach), `partage/` (copies **générées** de modules purs de `src/` :
`npx jiti tools/generer-partage-mcp.ts` après un changement de `src/importMesures.ts`, `src/nameMatch.ts`,
`src/codesJoueurs.ts`, `src/sportConfig.ts`, `src/gender.ts`, `src/askAction.ts`, `src/questionLogCore.ts`,
`src/propositionsAdminCore.ts` ou `src/propositionsJoueursCore.ts`), `deno.json`.

## Mise en ligne (base de test d'abord)

1. **SQL** (SQL Editor, dans l'ordre) : `supabase/067_propositions.sql`, puis `supabase/068_rapports.sql`, puis (facultatif,
   pour `nextar_admin_sante`) `supabase/069_admin_sante.sql`, puis (facultatif, pour `nextar_admin_proposer`)
   `supabase/070_propositions_admin.sql`, puis (facultatif, agrégats de la traçabilité dans la base)
   `supabase/071_provenance.sql`, puis (facultatif, lecture exacte de `nextar_lire` et journal des appels)
   `supabase/072_mcp_lecture_appels.sql` ; vérifier les requêtes de contrôle en fin de fichier. Plus
   tard, sections « ACTIVATION » (purges pg_cron, notification de 067).
2. **Clés de signature JWT asymétriques** (*Project Settings → JWT Keys*) : `@supabase/server` refuse les jetons HS256
   (ancien secret partagé). Passer aux clés de signature (ECC P-256 recommandé), faire tourner la clé une fois les appareils
   reconnectés ; les jetons déjà émis restent valides jusqu'à leur expiration.
3. **Clés d'API nouvelles** (*Project Settings → API Keys*) : une clé `sb_publishable_…` doit exister (la fonction s'en sert
   pour créer le client aux droits du coach ; Supabase la fournit à la fonction dans `SUPABASE_PUBLISHABLE_KEYS`).
4. **Serveur OAuth** (*Authentication → OAuth Server*) : activer le serveur OAuth 2.1 ; activer **l'enregistrement
   dynamique des clients** (Claude s'enregistre seul) ; **Authorization path** : `/oauth/consent` (chemin ajouté à l'adresse
   du site ; *Authentication → URL Configuration → Site URL* doit être l'adresse de l'appli, base comprise, par exemple
   `https://handbase-demo.github.io` pour la démo ou `https://handbase-app.github.io/HandBase` pour l'appli).
5. **Secrets de la fonction** (*Edge Functions → Secrets*) : `NEXTAR_APP_URL` = adresse de l'appli sans « / » final (liens
   vers la boîte et les rapports) ; facultatif `NEXTAR_SPORT=volley` (installation de volley sans ligne « sport ») ;
   `MCP_AUTH_ISSUER` seulement avec un domaine personnalisé.
6. **Déployer sans la vérification JWT de la passerelle** (la découverte OAuth passe sans jeton ; le jeton est vérifié par
   la fonction) : `supabase functions deploy mcp --no-verify-jwt` (CLI 2.117 ou plus).
7. **Publier l'appli** (routes `/oauth/consent`, `/rapport/:id`, Réglages → Applications connectées).
8. **Essai** : Claude → *Ajouter un connecteur personnalisé* → l'adresse de Réglages → Applications connectées → se connecter
   → Autoriser ; puis « décris mon installation Nextar » (nextar_contexte).

## Essais sans projet Supabase

- `npx jiti tools/test-mcp.ts` : outils sur un jeu fictif (aucun nom dans les réponses, codes, rapprochement, rapport ;
  avis, vus, à revoir : rapprochement, refus, textes du coach jamais rendus ; outils d'administration : refus sans lecture,
  listes blanches, masquage des noms, bornes). `npx jiti tools/test-propositions.ts` : la boîte dans l'appli (application
  par de faux chemins, « Défaire »).
- `bash tools/essai-mcp/lancer.sh` : la pile réelle dans le runtime des fonctions Supabase (Docker
  `public.ecr.aws/supabase/edge-runtime`), clés ES256 et jetons fictifs : découverte OAuth, 401, CORS, les dix-huit outils
  (`nextar_connexions` et les huit `nextar_admin_*` : refus pour le coach, réponse pour un administrateur fictif ; schémas
  publiés de `nextar_admin_activite`, `nextar_lire`, `nextar_joueur` ; canal « mcp », type « mcp » du journal).
- `bash tools/essai-sql-068/lancer.sh` : `068_rapports.sql` sur un Postgres jetable.
- `bash tools/essai-sql-069/lancer.sh` : `069_admin_sante.sql` sur un Postgres jetable (refus des autres comptes, forme de la
  réponse, rien de personnel, tables facultatives absentes).
- `bash tools/essai-sql-070/lancer.sh` : `070_propositions_admin.sql` sur un Postgres jetable (propositions d'avant 070
  gardées, sorte « admin » réservée aux administrateurs en création et en modification, forme, 50 actions, essais de 067
  rejoués après 070).
- `bash tools/essai-sql-071/lancer.sh` : `071_provenance.sql` sur un Postgres jetable (lignes fictives de chaque provenance
  écrites avant 071, 071 deux fois, provenance, lots, agrégats, refus 42501 pour les autres comptes, droits de `hb_lots`,
  empreintes de `hb_upsert` / `hb_stamp` / `hb_log` et des lignes de données inchangées, rencontres fictives marquées,
  retour arrière).
- `bash tools/essai-sql-072/lancer.sh` : `072_mcp_lecture_appels.sql` sur un Postgres jetable (6 500 joueurs fictifs nés en
  2013 : `hb_mcp_lire` comparé à un calcul direct écrit autrement — top 10 par taille, 200 premiers croissants, nés entre deux
  trimestres, périmètre d'un encadrant, filtres, bornes, refus, rien de personnel — ; journal des appels : pour soi, à l'heure
  du serveur, lecture administrateurs, ni modification ni suppression, purge réservée ; empreintes de `hb_upsert` / `hb_stamp`
  / `hb_log` / `hb_touch`, des lignes et de la structure des tables inchangées ; retour arrière).
