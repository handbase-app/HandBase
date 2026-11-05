# Fonction « mcp » : serveur MCP Nextar

Le coach branche Nextar dans Claude (*Réglages → Connecteurs → Ajouter un connecteur personnalisé*, adresse
`https://<projet>.supabase.co/functions/v1/mcp`) et se connecte avec son compte Nextar (serveur OAuth 2.1 de Supabase Auth ;
page d'autorisation de l'appli : `/oauth/consent`). Claude peut alors lire en codes, proposer des mesures à valider et garder
des rapports en codes, **avec les droits du coach** (RLS, périmètre, rôle).

**Règle : Nextar n'envoie jamais de données de joueur à une IA.** Les réponses ne contiennent que des codes (`J-7K3Q2MX`),
postes, années, sexe, département, mesures, moyennes d'avis et nombres de « vus » (liste blanche : `outils.ts`,
`verifierSortie` ; essais : `tools/test-mcp.ts`, `tools/essai-mcp/lancer.sh`).

Seule exception, **pour les administrateurs** : `nextar_connexions` rend le nom affiché et le rôle des **comptes du staff**
connectés récemment (jamais d'adresse mail, de téléphone, d'identifiant brut, d'adresse IP ni de donnée de joueur ; liste
blanche à part, où « nom_affiche » est la seule clé de nom permise, et aucun texte avec « @ » ou une adresse IP). Un compte qui
n'est pas administrateur reçoit un refus, sans rien lire. Aucun SQL nouveau : `hb_is_admin()` (043), `hb_connections` (030,
lecture administrateurs), `hb_profiles` (colonnes publiques de 029), affectations et unités (044).

| Outil | Entrée | Sortie |
|---|---|---|
| `nextar_contexte` | `archives?` | tests et unités, critères d'avis par poste, postes, événements et groupes (id, nom, date, type, nombre de joueurs) |
| `nextar_proposer` | `tableau` (texte) ou `lignes` (+ `colonnes`), `evenement` / `groupe` (id ou nom), `date`, `titre` | id de la proposition, lien vers la boîte, par ligne : « trouvé » + code, « à vérifier », « plusieurs possibles » (nombre), « introuvable » |
| `nextar_suivi` | `id?` | état (en attente, validée, validée en partie, rejetée) ; sans id : les 20 dernières |
| `nextar_lire` | années, sexe, postes, départements, événement, groupe, mesures min/max, vus min, avis min, tri, limite ≤ 200 | lignes en codes |
| `nextar_rapport` | `markdown` (avec les codes), `titre?` | lien `/rapport/<id>` (gardé 30 jours, auteur seul), codes mal recopiés |
| `nextar_connexions` (administrateurs) | `minutes?` (défaut 10, de 1 à 10 080), `limite?` (défaut 50, ≤ 200) | par compte, du plus récent : code `C-…`, nom affiché, rôle, périmètre, dernière activité (ISO + « il y a N min »), appareil (téléphone / tablette / ordinateur), ouvertures de l'appli sur la période ; total |

Fichiers : `index.ts` (entrée), `serveur.ts` (SDK MCP `@modelcontextprotocol/server` 2.4.0, `@supabase/server` 1.9.2,
`@supabase/middleware` 1.0.0, zod 4.6.7), `outils.ts` (les outils, purs), `source.ts` (requêtes aux droits du coach),
`partage/` (copies **générées** de modules purs de `src/` : `npx jiti tools/generer-partage-mcp.ts` après un changement de
`src/importMesures.ts`, `src/nameMatch.ts`, `src/codesJoueurs.ts` ou `src/sportConfig.ts`), `deno.json`.

## Mise en ligne (base de test d'abord)

1. **SQL** (SQL Editor, dans l'ordre) : `supabase/067_propositions.sql`, puis `supabase/068_rapports.sql` ; vérifier les
   requêtes de contrôle en fin de fichier. Plus tard, sections « ACTIVATION » (purges pg_cron, notification de 067).
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

- `npx jiti tools/test-mcp.ts` : outils sur un jeu fictif (aucun nom dans les réponses, codes, rapprochement, rapport).
- `bash tools/essai-mcp/lancer.sh` : la pile réelle dans le runtime des fonctions Supabase (Docker
  `public.ecr.aws/supabase/edge-runtime`), clés ES256 et jetons fictifs : découverte OAuth, 401, CORS, les six outils
  (`nextar_connexions` : refus pour le coach, liste pour un administrateur fictif).
- `bash tools/essai-sql-068/lancer.sh` : `068_rapports.sql` sur un Postgres jetable.
