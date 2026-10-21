import { currentSport } from './sportConfig'

/*
 * Places des postes sur le demi-terrain de la fiche (src/components/CourtPicker.tsx), rangées par sport : fichier pur
 * (testé par tools/test-sport-volley.ts). Repère : viewBox 300 × 200 du terrain dessiné.
 */

/** Place d'un poste sur le terrain ; `special` : rond en pointillés (libéro : maillot différent). */
export type Spot = { x: number; y: number; tag: string; special?: boolean }

export const SPOTS: Record<string, Partial<Record<string, Spot>>> = {
  // Handball : positions en attaque, vues de derrière l'attaque (but en haut) : la gauche du joueur est à gauche.
  // Terrain à l'échelle : 1 m = 15 px, ligne de but à y = 14, poteaux à x = 127,5 et 172,5.
  handball: {
    GB: { x: 150, y: 24, tag: 'G' },
    AG: { x: 20, y: 34, tag: 'ALG' },
    AD: { x: 280, y: 34, tag: 'ALD' },
    ARG: { x: 42, y: 140, tag: 'ARG' },
    DC: { x: 150, y: 172, tag: 'DC' },
    ARD: { x: 258, y: 140, tag: 'ARD' },
    // Pivot : sur la ligne des 6 m, au niveau du point de jet de 7 m.
    PIV: { x: 150, y: 117, tag: 'P' },
  },
  // Volley : demi-terrain de 9 × 9 m vu de derrière (filet en haut), 1 m = 20 px : x de 60 à 240, filet à y = 14, ligne
  // d'attaque (3 m) à y = 74. Zones 4 3 2 devant, 5 6 1 derrière. Étiquette = le code.
  volley: {
    R4: { x: 90, y: 44, tag: 'R4' },
    C: { x: 150, y: 44, tag: 'C' },
    PT: { x: 210, y: 44, tag: 'PT' },
    // Passeur : zone 1 (arrière droit), remonté vers la ligne d'attaque (il pénètre au filet).
    P: { x: 210, y: 112, tag: 'P' },
    // Libéro, s'il est ajouté par l'installation : zone 5 (arrière gauche).
    L: { x: 90, y: 150, tag: 'L', special: true },
  },
}

/** Places du sport en cours ; un sport sans terrain dessiné : celles du handball (comme avant le multisport). */
export const spotsOf = (sport = currentSport().sport) => SPOTS[sport] ?? SPOTS.handball

/** Étiquette d'un poste sur le terrain (handball : G, ALG, ARG, DC, ARD, ALD, P ; volley : le code) ; le code tel quel pour un poste sans place. */
export const courtTag = (id: string, sport?: string) => spotsOf(sport)[id]?.tag ?? id
