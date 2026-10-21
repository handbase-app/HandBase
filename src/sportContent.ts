import { currentSport } from './sportConfig'

/*
 * Contenus propres à chaque sport, choisis d'après le sport de l'installation (src/sportConfig.ts). Handball : les données
 * d'aujourd'hui. Volley : points d'accroche de la phase 2 (critères, tests et actions à venir), vides pour l'instant.
 *
 * Où vit quoi :
 *  - grille d'évaluation (critères subjectifs) ET définitions des tests / mesures (critères factuels : unité, échelle) :
 *    un fichier de critères au format « handbase-criteres » (src/criteriaFormat.ts), sous public/ (demoCriteria). Il est lu
 *    par loadDemoCriteria (src/criteriaImport.ts) ; une installation réelle importe le sien (Réglages → Critères) ;
 *  - sens des tests (plus petit / plus grand = meilleur, src/compare.ts) : lowerIsBetter / higherIsBetter, en plus des
 *    tests communs déjà connus (sprints, sauts, charges…) ;
 *  - catégories du « Profil physique » du formulaire de la fiche (src/pages/PlayerForm.tsx) : profileCategories ;
 *  - actions du séquenceur (pastilles de la frise) : src/seqPills.ts (PILLS_BY_SPORT), volley dans src/volleyActions.ts.
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
}

export const SPORT_CONTENT: Record<string, SportContent> = {
  handball: {
    demoCriteria: 'demo/criteres-demo.json',
    lowerIsBetter: [],
    higherIsBetter: [],
    profileCategories: ['Gabarit', 'Critères physiologiques'],
    profileSummary: 'Taille, poids, explosivité, puissance, vitesse, détente, tir',
  },
  // Phase 2 : critères et tests du volley dans public/demo/criteres-volley.json, sens de ses tests et catégories du
  // profil physique ici (en attendant : les mêmes noms de catégories que le handball).
  volley: { demoCriteria: 'demo/criteres-volley.json', lowerIsBetter: [], higherIsBetter: [], profileCategories: ['Gabarit', 'Critères physiologiques'] },
}

/** Contenus du sport en cours ; un sport sans contenus propres : ceux du handball. */
export const sportContent = (sport: string = currentSport().sport): SportContent => SPORT_CONTENT[sport] ?? SPORT_CONTENT.handball
