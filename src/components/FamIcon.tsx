// Picto d'une famille de tests (Gabarit, Vitesse, Sauts…) dans un carré teinté de sa couleur : onglet Tests et « Mes tests »
// (src/components/AllTests.tsx), sections de « Nouvelle séance de tests » (src/pages/MeasureSession.tsx). Famille → clé :
// familyKey (src/allTests.ts) ; couleurs claires et sombres : --fam-* et .fam-ic de src/index.css.
import type { CSSProperties } from 'react'
import { familyKey, type FamilyKey } from '../allTests'
import { Icon, type IconName } from './ui'

/** Couleur de la famille (--fam, lue par .fam-ic, le dernier point des courbes) : --fam-* de src/index.css. */
export const famStyle = (family: string) => ({ '--fam': `var(--fam-${familyKey(family)})` }) as CSSProperties

const FAM_ICON: Record<FamilyKey, IconName> = {
  gabarit: 'famHeight',
  mensurations: 'famTape',
  vitesse: 'famBolt',
  puissance: 'famDumbbell',
  mobilite: 'famMobility',
  stabilite: 'famBalance',
  sauts: 'famJump',
  autre: 'ruler',
}

/** Picto d'une famille dans un carré teinté de sa couleur (28 px : en-tête d'un bloc, sections de « Nouvelle séance de tests » ; 34 px : plus beaux progrès). */
export function FamIcon({ family, size }: { family: string; size: 28 | 34 }) {
  return (
    <span aria-hidden className="fam-ic flex shrink-0 items-center justify-center rounded-lg" style={{ ...famStyle(family), width: size, height: size }}>
      <Icon name={FAM_ICON[familyKey(family)]} strokeWidth={2} className={size === 34 ? 'h-[19px] w-[19px]' : 'h-4 w-4'} />
    </span>
  )
}
