import { currentSport } from './sportConfig'

/*
 * Contenus propres à chaque sport, choisis d'après le sport de l'installation (src/sportConfig.ts). Handball : les données
 * d'aujourd'hui. Volley : critères, tests et repères de l'échelle des usages de la détection en volley (filière fédérale).
 *
 * Où vit quoi :
 *  - grille d'évaluation (critères subjectifs) ET définitions des tests / mesures (critères factuels : unité, échelle) :
 *    un fichier de critères au format « handbase-criteres » (src/criteriaFormat.ts), sous public/ (demoCriteria). Il est lu
 *    par loadDemoCriteria (src/criteriaImport.ts) ; une installation réelle importe le sien (Réglages → Critères) ;
 *  - sens des tests (plus petit / plus grand = meilleur, src/compare.ts) : lowerIsBetter / higherIsBetter, en plus des
 *    tests communs déjà connus (sprints, sauts, charges…) ;
 *  - catégories du « Profil physique » du formulaire de la fiche (src/pages/PlayerForm.tsx) : profileCategories ;
 *  - repères de l'échelle de notation 1 à 5 (légende de l'écran de notation, avis vocal) : scoreLabels ;
 *  - actions du séquenceur (pastilles de la frise) : src/seqPills.ts (PILLS_BY_SPORT), volley dans src/volleyActions.ts.
 *
 * Volley (public/demo/criteres-volley.json) : 3 grilles notées de 1 à 5 (« Joueur de champ » pour R4, C et PT ;
 * « Passeur » pour P ; « Libéro » pour L, poste facultatif), le bloc « Mental et comportement » pour tous, et 10 tests
 * (taille, poids, taille assise, envergure, atteinte debout, hauteurs d'attaque et de contre, détente CMJ, T-test, lancer de
 * médecine-ball). Taille, poids et taille assise gardent les identifiants du calcul de la maturité (taille, poids,
 * taille_assise : src/maturitySnapshot.ts, MaturityCard.tsx).
 */

export interface SportContent {
  /** Fichier de critères de la démonstration (chemin sous public/, sans « / » au début). */
  demoCriteria: string
  /** Identifiants de tests propres au sport où plus petit est meilleur (temps…). */
  lowerIsBetter: readonly string[]
  /** Identifiants de tests propres au sport où plus grand est meilleur (sauts, charges…). */
  higherIsBetter: readonly string[]
  /** Formulaire de la fiche, « Profil physique » : catégories de critères saisies d'emblée (src/pages/PlayerForm.tsx). */
  profileCategories: readonly string[]
  /** Résumé de ce bloc replié ; absent : les libellés des critères affichés. */
  profileSummary?: string
  /**
   * Repères de l'échelle de notation 1 à 5 (score5), par note : légende de l'écran de notation (src/pages/Evaluate.tsx) et
   * libellés envoyés à l'avis vocal (src/dictation/avis.ts). L'échelle elle-même (1 à 5, des chiffres) est la même partout.
   */
  scoreLabels: Readonly<Record<string, string>>
  /** Exemples de textes à l'écran : groupes de joueurs (nom), groupe de travail (nom), catégorie d'une fiche. */
  examples: { groupName: string; workGroupName: string; category: string }
  /**
   * Catégories des championnats de jeunes (rencontres « Autour de moi », « Mon équipe » : src/rencontres.ts), de la plus
   * jeune à la plus âgée. `ages` : âges de saison, c'est-à-dire l'âge atteint dans l'année civile où finit la saison
   * (saison 2026-2027 : 2027 − année de naissance). Handball (FFHB) : U13 = 12-13 ans, U15 = 14-15, U18 = 16-18 ; volley
   * (FFvolley) : M13, M15, M18, mêmes âges (comme src/demoVolley.ts, CAT_YEARS), puis M21 = 19-21 ans.
   */
  youthCategories: readonly YouthCategory[]
}

/** Une catégorie de jeunes : code affiché et stocké (« U15 »), âges de saison couverts. */
export interface YouthCategory {
  code: string
  ages: readonly number[]
}

export const SPORT_CONTENT: Record<string, SportContent> = {
  handball: {
    demoCriteria: 'demo/criteres-demo.json',
    lowerIsBetter: [],
    higherIsBetter: [],
    profileCategories: ['Gabarit', 'Critères physiologiques'],
    profileSummary: 'Taille, poids, explosivité, puissance, vitesse, détente, tir',
    scoreLabels: { '1': 'très insuffisant', '3': 'niveau attendu', '5': 'remarquable' },
    examples: {
      groupName: 'Ex. Intercomités 83 – 2010, Pôle Espoirs masculin…',
      workGroupName: 'Ex. ETD Var, Pôles Région Sud, Intercomités 83…',
      category: '-18 nat',
    },
    youthCategories: [
      { code: 'U13', ages: [12, 13] },
      { code: 'U15', ages: [14, 15] },
      { code: 'U18', ages: [16, 17, 18] },
    ],
  },
  volley: {
    demoCriteria: 'demo/criteres-volley.json',
    // T-test : déjà connu comme test commun (src/compare.ts) ; redit ici pour que la liste du volley soit complète.
    lowerIsBetter: ['t_test'],
    // Détente CMJ : identifiant commun cmj_hauteur (déjà « plus grand = meilleur »). Taille, envergure et atteinte debout
    // décrivent le gabarit : pas de « meilleur », comme la taille au handball.
    higherIsBetter: ['hauteur_attaque', 'hauteur_contre', 'medecine_ball'],
    profileCategories: ['Gabarit', 'Mensurations', 'Détente'],
    profileSummary: 'Taille, poids, taille assise, envergure, atteinte, hauteurs d’attaque et de contre, CMJ',
    // Échelle 1 à 5 des grilles du volley, uniquement positive.
    scoreLabels: { '1': 'En découverte', '2': 'En construction', '3': 'Acquis', '4': 'Point fort', '5': 'Remarquable' },
    examples: {
      groupName: 'Ex. Sélection départementale 69 – 2014, Pôle Espoirs féminin…',
      workGroupName: 'Ex. ETD Var, Pôles Région Sud, staff du CRE…',
      category: 'M15',
    },
    youthCategories: [
      { code: 'M13', ages: [12, 13] },
      { code: 'M15', ages: [14, 15] },
      { code: 'M18', ages: [16, 17, 18] },
      { code: 'M21', ages: [19, 20, 21] },
    ],
  },
}

/** Contenus du sport en cours ; un sport sans contenus propres : ceux du handball. */
export const sportContent = (sport: string = currentSport().sport): SportContent => SPORT_CONTENT[sport] ?? SPORT_CONTENT.handball

/** Légende de l'écran de notation : « 1 = très insuffisant · 3 = niveau attendu · 5 = remarquable ». */
export const scoreLegend = (sport?: string) =>
  Object.entries(sportContent(sport).scoreLabels)
    .map(([n, l]) => `${n} = ${l}`)
    .join(' · ')
