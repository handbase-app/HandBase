// Nextar, serveur MCP : TITRES, DESCRIPTIONS et SCHÉMAS D'ENTRÉE des outils (un par outil), séparés de serveur.ts pour être
// lus par les essais : tools/test-mcp.ts les construit avec un faux « z » qui note les clés déclarées, et les compare aux
// paramètres lus par le code de chaque outil (un paramètre lu mais absent du schéma : Claude ne peut pas le deviner).
// `z` est zod (npm:zod@4.6.7 dans serveur.ts) ; aucun import npm ici, pour rester lisible par Node.

import { BORNES } from './outils.ts'
import { ECHELLES_TEXTE } from './proposerJoueurs.ts'
import { JOUEURS_LIMITES, TYPES_CONTEXTE } from './partage/propositionsJoueursCore.ts'

/** Définition d'un outil pour McpServer.registerTool : titre, description, schéma d'entrée (zod), annotations. */
// deno-lint-ignore no-explicit-any
export type DefOutil = { title: string; description: string; inputSchema: any; annotations: Record<string, boolean> }

/** Les outils, par nom (l'ordre est celui de tools/list). */
// deno-lint-ignore no-explicit-any
export function schemasOutils(z: any): Record<string, DefOutil> {
  const d: Record<string, DefOutil> = {}
  const lecture = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  const depot = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
  const valeur = z.union([z.string().max(BORNES.cellule), z.number(), z.null()])

  d.nextar_contexte = {
      title: 'Contexte Nextar',
      description:
        'Décrit l’installation Nextar du coach : tests et unités (critères de mesure), critères d’avis par poste, postes, événements et ' +
        'groupes (identifiant, nom, date, type, nombre de joueurs). Aucune donnée de joueur. À appeler en premier.',
      inputSchema: z.object({ archives: z.boolean().optional().describe('Inclure les événements et groupes archivés.') }),
      annotations: lecture,
    }

  d.nextar_proposer = {
      title: 'Proposer des mesures à valider',
      description:
        'Dépose des résultats de tests (lus sur une feuille, une photo, une dictée) dans la boîte « À valider » de Nextar. Nextar ' +
        'rapproche lui-même les joueurs et ne renvoie, par ligne, que « trouvé » + code, « à vérifier », « plusieurs possibles » ' +
        '(un nombre) ou « introuvable », avec l’identifiant de la proposition. Rien n’est écrit dans les fiches avant la validation ' +
        'du coach dans l’appli. Donne `tableau` (texte : tableau Markdown, tabulations, CSV) OU `lignes` (listes de cellules avec ' +
        '`colonnes`, ou objets { nom, prenom, numero, annee, valeurs: { <id de test>: valeur } }). Utilise les identifiants de ' +
        'tests de nextar_contexte comme clés ou en-têtes. Précise l’événement ou le groupe (nom ou identifiant) pour un meilleur ' +
        'rapprochement, et la date des tests (AAAA-MM-JJ).',
      inputSchema: z.object({
        titre: z.string().max(BORNES.titreProposition).optional().describe('Titre court (« Tests du 05/11 · Pôle U15 »).'),
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('Date des tests (AAAA-MM-JJ) ; une colonne Date l’emporte.'),
        evenement: z.string().max(200).optional().describe('Événement (identifiant ou nom) où chercher les joueurs.'),
        groupe: z.string().max(200).optional().describe('Groupe (identifiant ou nom) où chercher les joueurs.'),
        tableau: z.string().max(BORNES.octets).optional().describe('Le tableau tel quel (Markdown, tabulations, CSV, lignes simples).'),
        colonnes: z.array(z.string().max(BORNES.cellule)).max(BORNES.colonnes).optional().describe('En-têtes, si `lignes` sont des listes de cellules.'),
        lignes: z
          .array(
            z.union([
              z.array(valeur).max(BORNES.colonnes),
              z.object({
                joueur: valeur.optional(),
                nom: valeur.optional(),
                prenom: valeur.optional(),
                numero: valeur.optional(),
                annee: valeur.optional(),
                date: valeur.optional(),
                valeurs: z.record(z.string().max(120), valeur).optional(),
              }),
            ]),
          )
          .max(BORNES.lignes)
          .optional(),
      }),
      annotations: depot,
    }

  // ---------- Propositions sur des joueurs : avis, vus, à revoir (proposerJoueurs.ts) ----------

  const ligneJoueur = {
    joueur: z.string().max(JOUEURS_LIMITES.nom).optional().describe('Nom tel qu’écrit sur la feuille (« MARTIN Lucas », « Lucas M. »), ou code « J-… » de nextar_lire.'),
    nom: z.string().max(60).optional().describe('Nom de famille, si séparé du prénom.'),
    prenom: z.string().max(60).optional().describe('Prénom, si séparé du nom.'),
    numero: z.union([z.string().max(6), z.number().int()]).optional().describe('N° de maillot lu (aide au rapprochement dans un événement).'),
    annee: z.union([z.string().max(4), z.number().int()]).optional().describe('Année de naissance lue.'),
  }
  const commun = 'Nextar rapproche lui-même les joueurs et ne renvoie, par ligne, que « trouvé » + code, « à vérifier », « plusieurs possibles » ' +
    '(un nombre), « introuvable » ou « refusée » avec la raison, et l’identifiant de la proposition ; jamais un nom ni un texte. Rien ' +
    'n’est écrit dans les fiches avant que le coach valide dans l’appli (boîte « À valider », joueur modifiable).'

  d.nextar_proposer_avis = {
      title: 'Proposer des avis à valider',
      description:
        '« Voici mes notes du match, mets les avis. » Dépose des avis (notes par critère d’avis) dans la boîte « À valider ». ' + commun +
        ' Une ligne par joueur : `notes` { <id de critère d’avis de nextar_contexte (criteres_avis)>: note } dans l’échelle du critère ' +
        `(${ECHELLES_TEXTE} ; choice : une des options) ; un critère inconnu, hors échelle ou pas pour le poste du joueur est refusé ` +
        `(raison par note). Facultatif : \`points_forts\` et \`axes_de_progression\`, textes courts du coach (${JOUEURS_LIMITES.texte} signes ` +
        'au plus, formulations positives ou neutres ; gardés tels quels, jamais renvoyés), `date` de la ligne. Précise l’événement ' +
        '(identifiant ou nom) quand les avis portent sur un match ou un tournoi de nextar_contexte ; sans événement, avis hors ' +
        `événement (\`contexte\` : ${TYPES_CONTEXTE.join(', ')} ; défaut match), avec un groupe pour mieux rapprocher. ${JOUEURS_LIMITES.lignes.avis} joueurs au plus.`,
      inputSchema: z.object({
        titre: z.string().max(BORNES.titreProposition).optional().describe('Titre court (« Avis U15 · match du 12/10 »).'),
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('Date des avis (AAAA-MM-JJ) ; défaut : date de l’événement, sinon aujourd’hui.'),
        evenement: z.string().max(200).optional().describe('Événement (identifiant ou nom) des avis ; joueurs cherchés parmi les siens.'),
        groupe: z.string().max(200).optional().describe('Sans événement : groupe (identifiant ou nom) où chercher les joueurs.'),
        contexte: z.enum(TYPES_CONTEXTE).optional().describe('Sans événement : contexte de l’avis (défaut match).'),
        lieu: z.string().max(JOUEURS_LIMITES.lieu).optional().describe('Sans événement : lieu (« Gymnase de Hyères »).'),
        lignes: z
          .array(
            z.object({
              ...ligneJoueur,
              notes: z.record(z.string().max(120), z.union([z.number(), z.string().max(60)])).optional().describe('{ <id de critère d’avis>: note }.'),
              date: z.string().max(10).optional().describe('Date de cet avis (AAAA-MM-JJ), si différente.'),
              points_forts: z.string().max(2000).optional().describe(`Points forts, texte court du coach (${JOUEURS_LIMITES.texte} signes au plus).`),
              axes_de_progression: z.string().max(2000).optional().describe(`Axes de progression, texte court du coach (${JOUEURS_LIMITES.texte} signes au plus).`),
            }),
          )
          .max(BORNES.lignes),
      }),
      annotations: depot,
    }

  d.nextar_proposer_vus = {
      title: 'Proposer des joueurs vus à valider',
      description:
        '« Marque vus les joueurs de cette feuille. » Dépose dans la boîte « À valider » les joueurs vus par le coach à un événement ' +
        '(`evenement` obligatoire : identifiant ou nom de nextar_contexte ; joueurs cherchés parmi les siens, ou dans toute la base ' +
        `s’il n’en a encore aucun). ${commun} Marque neutre : « vu ». ${JOUEURS_LIMITES.lignes.vus} joueurs au plus.`,
      inputSchema: z.object({
        titre: z.string().max(BORNES.titreProposition).optional(),
        evenement: z.string().min(1).max(200).describe('Événement (identifiant ou nom de nextar_contexte).'),
        lignes: z.array(z.object(ligneJoueur)).max(BORNES.lignes),
      }),
      annotations: depot,
    }

  d.nextar_proposer_a_revoir = {
      title: 'Proposer des joueurs à revoir',
      description:
        '« Mets à revoir ces joueurs. » Dépose dans la boîte « À valider » des joueurs à mettre « à revoir » pour le coach (marque ' +
        `neutre de l’appli), avec une \`raison\` courte facultative (${JOUEURS_LIMITES.raison} signes au plus, formulation positive ou ` +
        'neutre ; gardée telle quelle, jamais renvoyée). Précise l’événement où ils ont été repérés, ou un groupe, pour un meilleur ' +
        `rapprochement (sinon toute la base). ${commun} ${JOUEURS_LIMITES.lignes.a_revoir} joueurs au plus.`,
      inputSchema: z.object({
        titre: z.string().max(BORNES.titreProposition).optional(),
        evenement: z.string().max(200).optional().describe('Événement (identifiant ou nom) où ils ont été repérés.'),
        groupe: z.string().max(200).optional().describe('Groupe (identifiant ou nom) où chercher les joueurs.'),
        lignes: z.array(z.object({ ...ligneJoueur, raison: z.string().max(1000).optional().describe('Raison courte (« à revoir en défense »).') })).max(BORNES.lignes),
      }),
      annotations: depot,
    }

  d.nextar_suivi = {
      title: 'Suivi d’une proposition',
      description: 'État d’une proposition déposée (en attente, validée, validée en partie, rejetée). Sans identifiant : les 20 dernières.',
      inputSchema: z.object({ id: z.string().uuid().optional().describe('Identifiant rendu par nextar_proposer.') }),
      annotations: lecture,
    }

  d.nextar_lire = {
      title: 'Lire les joueurs (en codes)',
      description:
        'Interroge les joueurs du périmètre du coach et rend des lignes EN CODES : code, poste, année et trimestre de naissance ' +
        '(1 : janvier-mars … 4 : octobre-décembre), sexe, département, nombre de « vus », dernières mesures des tests demandés, ' +
        'moyenne des avis (critères de 1 à 5). Jamais de nom, de club, de commentaire ni de date de naissance complète. Filtres : ' +
        'années, trimestres (combinables : annees [2013] + trimestres [1, 2]), nes_entre { de: "2012-T4", a: "2013-T4" } (en une ' +
        'seule requête), sexe, postes, départements, événement ou groupe, mesures min / max, vus au moins, moyenne d’avis au moins ; ' +
        'tri (année, vus, avis ou test : « les 10 plus grands » = tri { par: "test", test: "taille", ordre: "desc" }, limite 10) ; ' +
        'limite (200 au plus). Avec supabase/072, filtres, tri et limite sont faits dans la base (exacts) ; sans, au-delà de 5 000 ' +
        'joueurs, la réponse porte « approximatif: true » : ne présente pas ce classement comme exact. Historique d’un joueur : ' +
        'nextar_joueur.',
      inputSchema: z.object({
        annees: z.array(z.number().int().min(1950).max(2100)).max(20).optional().describe('Années de naissance.'),
        trimestres: z.array(z.number().int().min(1).max(4)).max(4).optional().describe('Trimestres de naissance (1 : janvier-mars, 2 : avril-juin, 3 : juillet-septembre, 4 : octobre-décembre).'),
        nes_entre: z
          .object({
            de: z.string().max(12).optional().describe('Début compris : « 2012-T4 » (ou une année « 2012 » = depuis T1).'),
            a: z.string().max(12).optional().describe('Fin comprise : « 2013-T4 » (ou une année « 2013 » = jusqu’à T4).'),
          })
          .optional()
          .describe('Nés entre deux trimestres, bornes comprises (« nés entre fin 2012 et 2013 » : { de: "2012-T4", a: "2013-T4" }).'),
        sexe: z.enum(['M', 'F']).optional(),
        postes: z.array(z.string().max(10)).max(20).optional().describe('Codes de postes (nextar_contexte).'),
        departements: z.array(z.string().max(4)).max(30).optional().describe('Numéros de département (« 13 », « 2A », « 971 »).'),
        evenement: z.string().max(200).optional(),
        groupe: z.string().max(200).optional(),
        mesures: z.array(z.object({ test: z.string().max(200), min: z.number().optional(), max: z.number().optional() })).max(10).optional(),
        vus_min: z.number().int().min(0).optional(),
        avis_min: z.number().min(0).max(5).optional(),
        avis_criteres: z.array(z.object({ critere: z.string().max(200), min: z.number() })).max(10).optional(),
        avec_mesures: z.union([z.array(z.string().max(200)).max(40), z.literal('toutes')]).optional().describe('Tests à rendre (« toutes » : tous).'),
        avec_avis_criteres: z.boolean().optional().describe('Moyenne par critère d’avis.'),
        tri: z.object({ par: z.enum(['annee', 'vus', 'avis', 'test']), test: z.string().max(200).optional(), ordre: z.enum(['asc', 'desc']).optional() }).optional().describe('Tri ; égalités départagées par l’identifiant.'),
        limite: z.number().int().min(1).max(BORNES.lireMax).optional().describe(`Lignes rendues (défaut ${BORNES.lireDefaut}, ${BORNES.lireMax} au plus).`),
      }),
      annotations: lecture,
    }

  d.nextar_joueur = {
      title: 'Historique d’un joueur (en code)',
      description:
        '« Montre la progression de taille de J-… » : historique d’UN joueur désigné par son code (J-…, rendu par nextar_lire), ' +
        'dans le périmètre du compte (tout pour un administrateur). Rend, en codes : profil (sexe, année et trimestre de naissance, ' +
        'département, poste), mesures par test en série datée [{ valeur, date, evenement }] avec l’évolution (première → dernière ' +
        'valeur, écart, nombre de points), joueur « vu » (événements : libellé, date, type), avis dans le temps (moyenne par événement ' +
        'et par critère ; notes chiffrées seulement). Jamais de nom, de club, de commentaire, d’auteur ni de date de naissance ' +
        'complète. Code inconnu ou hors périmètre : « introuvable » ; code partagé par deux fiches : refus.',
      inputSchema: z.object({
        code: z.string().min(3).max(20).describe('Code du joueur (« J- » puis 7 signes).'),
        tests: z.union([z.array(z.string().max(200)).max(40), z.literal('toutes')]).optional().describe('Tests à rendre (identifiants ou libellés de nextar_contexte) ; défaut « toutes ».'),
        depuis: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('Début de la période (AAAA-MM-JJ, compris).'),
        jusqu_a: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('Fin de la période (AAAA-MM-JJ, comprise).'),
      }),
      annotations: lecture,
    }

  d.nextar_rapport = {
      title: 'Garder un rapport (en codes)',
      description:
        'Garde 30 jours, pour le coach seul, un rapport rédigé en Markdown AVEC LES CODES des joueurs (jamais de noms), et rend un ' +
        'lien vers l’appli Nextar : en l’ouvrant, l’appareil du coach remplace chaque code par le nom et propose « Imprimer / PDF ». ' +
        'Signale les codes mal recopiés.',
      inputSchema: z.object({
        titre: z.string().max(BORNES.titreRapport).optional(),
        markdown: z.string().min(1).max(BORNES.rapport).describe('Le rapport, en Markdown (titres, listes, tableaux), avec les codes.'),
      }),
      annotations: depot,
    }

  d.nextar_connexions = {
      title: 'Qui s’est connecté (administrateurs)',
      description:
        'Réservé aux administrateurs ; noms et rôles des comptes, jamais d’adresse mail. Répond à « qui s’est connecté dans les N ' +
        'dernières minutes ? » / « qui est connecté maintenant ? » : pour chaque compte du staff actif sur la période — appli ouverte ' +
        'OU appels d’outils par Claude (serveur MCP) —, du plus récent au plus ancien, le nom affiché, le rôle, le périmètre (unités ' +
        'd’affectation ou secteur), le canal (« appli », « mcp » ou « appli et mcp »), la dernière activité (heure ISO et « il y a N ' +
        'min »), le type d’appareil (téléphone, tablette, ordinateur), le nombre d’ouvertures de l’appli, le nombre d’appels MCP et ' +
        'le dernier ; plus le total et le nombre par canal. Jamais d’adresse ' +
        'mail, de téléphone, d’identifiant, d’adresse IP ni de donnée de joueur. Un compte qui n’est pas administrateur reçoit un refus.',
      inputSchema: z.object({
        minutes: z.number().int().min(1).max(BORNES.connexionsMinutesMax).optional().describe(`Fenêtre en minutes (défaut ${BORNES.connexionsMinutes}, 7 jours au plus).`),
        limite: z.number().int().min(1).max(BORNES.connexionsMax).optional().describe(`Comptes rendus au plus (défaut ${BORNES.connexionsDefaut}, ${BORNES.connexionsMax} au plus).`),
      }),
      annotations: lecture,
    }

  // ---------- Administration, lecture seule (admin.ts) ----------

  const jours = (quoi: string) =>
    z.number().int().min(1).max(BORNES.joursMax).optional().describe(`${quoi} (défaut ${BORNES.joursDefaut}, ${BORNES.joursMax} au plus).`)

  d.nextar_admin_a_faire = {
      title: 'Ce qui m’attend (administrateurs)',
      description:
        'Réservé aux administrateurs ; lecture seule. Répond à « qu’est-ce qui m’attend ? » : comptes en attente de rôle (depuis ' +
        'quand), fiches joueur proposées et avis spontanés à valider (joueurs en codes, auteur par nom affiché), doublons ' +
        'probables à fondre (paires de codes et raison), propositions « À valider » de ce compte encore en attente, questions du ' +
        'journal à traiter ; nombres et quelques éléments de chaque file, liens vers les écrans de l’appli. Jamais de nom de ' +
        'joueur ni d’adresse mail. Un compte qui n’est pas administrateur reçoit un refus.',
      inputSchema: z.object({
        limite: z.number().int().min(1).max(BORNES.aFaireMax).optional().describe(`Éléments rendus par file (défaut ${BORNES.aFaireDefaut}, ${BORNES.aFaireMax} au plus).`),
      }),
      annotations: lecture,
    }

  d.nextar_admin_sante = {
      title: 'État de l’installation (administrateurs)',
      description:
        'Réservé aux administrateurs ; lecture seule. État de l’installation Nextar : nombre de lignes des tables principales, ' +
        'comptes du staff par rôle, comptes connectés sur 24 h / 7 j / 30 j et types d’appareils, dernière écriture, erreurs du ' +
        'mode avancé sur 7 jours ; avec le script 069 : taille de la base et des tables, registre des changements, charge ' +
        'annoncée, abonnements aux notifications (des nombres), rappels de la veille, notifications en attente, tâches ' +
        'programmées (échecs). Ce qui manque est marqué « indisponible ». Aucun compte, aucun jeton, aucune donnée de joueur.',
      inputSchema: z.object({}),
      annotations: lecture,
    }

  d.nextar_admin_activite = {
      title: 'Activité des comptes du staff (administrateurs)',
      description:
        'Réservé aux administrateurs ; lecture seule. Par compte du staff (code C-…, nom affiché, rôle), sur les N derniers jours ' +
        'ou une période calendaire (depuis / jusqu_a) : avis donnés, mesures saisies, événements créés, joueurs vus (joueur × ' +
        'événement), fiches créées, ventilés par provenance (saisie dans l’appli, import d’un fichier, proposition validée), ' +
        'canal (« appli », « mcp » = Claude par le serveur MCP, les deux, ou « aucun »), appels MCP (nombre, erreurs, dernier, ' +
        'outils), dernière activité ; classés du plus actif au moins actif ; par: "jour" ou "heure" ajoute un histogramme par compte (heure ' +
        'de Paris). Génération (démos, jeux d’essai) exclue sauf inclure_generation: true (ligne « Générateur démo », avec les ' +
        'comptes sous lesquels ses lignes ont été posées). Plus les comptes inactifs depuis plus de M jours (ou jamais vus). ' +
        'Jamais d’adresse mail ni de donnée de joueur.',
      inputSchema: z.object({
        jours: jours('Période en jours (sans depuis / jusqu_a)'),
        depuis: z.string().max(40).optional().describe('Début : AAAA-MM-JJ (minuit à Paris) ou heure ISO. « Ce mois-ci » : le 1er du mois.'),
        jusqu_a: z.string().max(40).optional().describe('Fin (exclue) : AAAA-MM-JJ ou heure ISO ; défaut : maintenant.'),
        par: z.enum(['total', 'jour', 'heure']).optional().describe('total (défaut), jour ou heure : histogramme par compte.'),
        inclure_generation: z.boolean().optional().describe('Compter aussi la génération (démos, jeux d’essai) ; défaut : non.'),
        inactifs_jours: jours('Inactif : aucune activité depuis ce nombre de jours'),
        limite: z.number().int().min(1).max(BORNES.activiteMax).optional().describe(`Comptes rendus (défaut ${BORNES.activiteDefaut}, ${BORNES.activiteMax} au plus).`),
      }),
      annotations: lecture,
    }

  d.nextar_admin_questions = {
      title: 'Questions que les coachs n’arrivent pas à faire aboutir (administrateurs)',
      description:
        'Réservé aux administrateurs ; lecture seule. Questions « Demander » / « Poser une question » du journal sur les N derniers ' +
        'jours : par défaut celles à traiter (pas comprises en entier, sauvées par le mode avancé, ou jugées « mauvaise réponse » / ' +
        '« pas de réponse »), regroupées par formulation proche, avec le nombre, le nombre de comptes distincts, l’issue, ce que la ' +
        'recette n’a pas appliqué et ce que les coachs voulaient. Les noms de joueurs sont remplacés par [joueur] côté serveur.',
      inputSchema: z.object({
        jours: jours('Période en jours'),
        filtre: z.enum(['a_traiter', 'toutes']).optional().describe('« a_traiter » (défaut) ou « toutes ».'),
        limite: z.number().int().min(1).max(BORNES.questionsMax).optional().describe(`Groupes rendus (défaut ${BORNES.questionsDefaut}, ${BORNES.questionsMax} au plus).`),
      }),
      annotations: lecture,
    }

  // ---------- Administration, traçabilité de l'activité du staff (adminTraces.ts), lecture seule ----------

  const periode = {
    depuis: z.string().max(40).optional().describe('Début : AAAA-MM-JJ (minuit à Paris) ou heure ISO (« 2026-11-05T08:00:00Z »).'),
    jusqu_a: z.string().max(40).optional().describe('Fin (exclue) : AAAA-MM-JJ ou heure ISO ; défaut : maintenant.'),
  }
  const compte = (quoi: string) => z.string().max(20).optional().describe(`${quoi} : code « C-… » (nextar_admin_activite, nextar_connexions) ; « générateur » pour la génération.`)
  const generationOpt = z.boolean().optional().describe('Montrer aussi la génération (démos, jeux d’essai), sous « Générateur démo » ; défaut : non.')

  d.nextar_admin_journal = {
      title: 'Journal des actions du staff (administrateurs)',
      description:
        'Réservé aux administrateurs ; lecture seule. Journal horodaté des actions du staff sur une période (défaut : 24 h, 31 ' +
        'jours au plus) : créations, modifications et suppressions de mesures, avis, événements, « vus » et fiches (historique ' +
        'des écritures), ouvertures de l’appli, appels d’outils par Claude (type « mcp » : outil, durée, succès, lignes rendues, ' +
        'filtres structurés ; jamais les paramètres bruts). Par défaut regroupé en SESSIONS (actions d’un même compte à moins de ' +
        '15 min) : compte, début, fin, appareil, canal, nombre par type, événements et tests touchés, outils MCP, joueurs distincts, provenance ; ' +
        'regrouper: false : une ligne par action (heure exacte, compte, action, type, objet en code J-…, test, événement, ' +
        'provenance, lot). Répond à « décris les actions de <compte> ce matin ». Heures en ISO UTC et à l’heure de Paris. ' +
        'Jamais de nom de joueur ni d’adresse mail.',
      inputSchema: z.object({
        compte: compte('Un seul compte'),
        ...periode,
        types: z.array(z.enum(['mesure', 'avis', 'evenement', 'vu', 'fiche', 'connexion', 'mcp'])).max(7).optional().describe('Types d’actions (défaut : tous ; « mcp » : appels d’outils par Claude).'),
        regrouper: z.boolean().optional().describe('Sessions (défaut) ou une ligne par action (false).'),
        inclure_generation: generationOpt,
        limite: z.number().int().min(1).max(BORNES.journalLimiteMax).optional().describe(`Sessions ou lignes rendues, les plus récentes (défaut ${BORNES.journalDefaut}, ${BORNES.journalLimiteMax} au plus).`),
      }),
      annotations: lecture,
    }

  d.nextar_admin_saisies = {
      title: 'Ce qu’un compte a saisi (administrateurs)',
      description:
        'Réservé aux administrateurs ; lecture seule. Contenu créé par un compte du staff sur une période (défaut : 30 jours) : ' +
        'mesures PAR TEST (nombre, joueurs, min, max, moyenne, événements, première et dernière heure de saisie, provenance) et ' +
        'avis PAR CRITÈRE (nombre de notes, joueurs, moyenne ; jamais un commentaire) ; filtres test, événement, provenance ; ' +
        'detail: true ajoute les lignes (code J-…, test, valeur, heure, provenance, lot). Répond à « quelles mesures a-t-il ' +
        'saisies ? ». Jamais de nom de joueur ni d’adresse mail.',
      inputSchema: z.object({
        auteur: compte('Auteur (défaut : tous les comptes du staff)'),
        ...periode,
        test: z.string().max(200).optional().describe('Test ou critère (identifiant ou libellé de nextar_contexte).'),
        evenement: z.string().max(200).optional().describe('Événement (identifiant ou nom).'),
        source: z.enum(['saisie_appli', 'import_fichier', 'proposition_validee', 'generation']).optional().describe('Provenance.'),
        detail: z.boolean().optional().describe('Ajouter les lignes une à une (défaut : non).'),
        inclure_generation: generationOpt,
        limite: z.number().int().min(1).max(BORNES.saisiesMax).optional().describe(`Lignes de détail par sorte (défaut ${BORNES.saisiesDefaut}, ${BORNES.saisiesMax} au plus).`),
      }),
      annotations: lecture,
    }

  d.nextar_admin_lots = {
      title: 'Créations en masse (administrateurs)',
      description:
        'Réservé aux administrateurs ; lecture seule. Lots de créations en masse sur une période (défaut : 365 jours) : collage ' +
        'd’un tableau, proposition validée, génération (démos, jeux d’essai) ; pour chacun : identifiant, provenance, ' +
        'description, auteur (génération : « Générateur démo » et comptes porteurs), première et dernière écriture (heure ' +
        'réelle du serveur), durée, volumes par type, dates déclarées dans les lignes (antidatage). Répond à « ces lignes ont-' +
        'elles été créées le même jour, à la même heure ? ». Aucune donnée de joueur.',
      inputSchema: z.object({
        ...periode,
        limite: z.number().int().min(1).max(BORNES.lotsMax).optional().describe(`Lots rendus, les plus récents (défaut ${BORNES.lotsDefaut}, ${BORNES.lotsMax} au plus).`),
      }),
      annotations: lecture,
    }

  // ---------- Administration : préparer des actions à valider (adminProposer.ts) ----------

  d.nextar_admin_proposer = {
      title: 'Préparer des actions d’administration à valider (administrateurs)',
      description:
        'Réservé aux administrateurs ; N’APPLIQUE RIEN : prépare des actions d’administration et les dépose dans la boîte ' +
        '« À valider » de l’administrateur, qui les coche puis « Appliquer » dans l’appli (mêmes écrans, mêmes droits). Une ' +
        'sorte par proposition, 50 actions au plus : « role » (actions { compte: "C-…", role: observateur | encadrant | joueur } ; ' +
        'jamais administrateur, jamais un administrateur ni ton propre compte ; « joueur » seulement pour un compte en attente), ' +
        '« perimetre » ({ compte, unite: id ou nom, role_unite? } pour affecter à une unité, ou { compte, secteur: ["83", "2A"] }), ' +
        '« archiver » ({ evenement: id } ou { groupe: id }, identifiants de nextar_contexte avec archives ; ou ' +
        '`evenements_avant: AAAA-MM-JJ` pour tous les événements non archivés datés avant ce jour, fin de saison), « fusion » ' +
        '({ garder: "J-…", fondre: "J-…" }, codes de nextar_admin_a_faire ; l’administrateur peut inverser). Codes des comptes : ' +
        'nextar_connexions, nextar_admin_a_faire, nextar_admin_activite. Rend, par action, « prête » ou « refusée » avec la ' +
        'raison, et l’identifiant de la proposition. Joueurs en codes, comptes par nom affiché et rôle, jamais d’adresse mail. ' +
        'Un compte qui n’est pas administrateur reçoit un refus.',
      inputSchema: z.object({
        sorte: z.enum(['role', 'perimetre', 'archiver', 'fusion']).describe('Une sorte par proposition.'),
        titre: z.string().max(BORNES.titreProposition).optional().describe('Titre court (« Fin de saison 2025-26 »).'),
        actions: z
          .array(
            z.object({
              compte: z.string().max(20).optional().describe('role, perimetre : code du compte (« C-… »).'),
              role: z.string().max(30).optional().describe('role : observateur, encadrant ou joueur.'),
              unite: z.string().max(200).optional().describe('perimetre : unité de la structure (identifiant ou nom).'),
              role_unite: z.string().max(30).optional().describe('perimetre (unité) : encadrant, observateur ou administrateur ; défaut : son rôle.'),
              secteur: z.array(z.string().max(4)).max(30).optional().describe('perimetre : départements du secteur ([] : aucun).'),
              evenement: z.string().max(200).optional().describe('archiver : identifiant de l’événement.'),
              groupe: z.string().max(200).optional().describe('archiver : identifiant du groupe.'),
              garder: z.string().max(20).optional().describe('fusion : code « J-… » de la fiche à garder.'),
              fondre: z.string().max(20).optional().describe('fusion : code « J-… » de la fiche à fondre dans l’autre.'),
            }),
          )
          .max(BORNES.adminActions)
          .optional(),
        evenements_avant: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('archiver : tous les événements non archivés datés avant ce jour.'),
      }),
      annotations: depot,
    }
  return d
}
