import { currentSport } from './sportConfig'

/*
 * Couleur de chaque poste dans les listes de joueurs (src/components/PlayerRow.tsx) : rond des initiales et « ● DC » du
 * nom, rien d'autre. Fichier pur (testé par tools/test-couleurs-postes.ts : chaque poste a sa teinte, contraste AA sur
 * toutes les cartes claires et sombres). Une teinte par poste ; les deux côtés d'un même poste (ailier gauche / droit,
 * arrière gauche / droit) gardent la même teinte, comme les pastilles des postes (components/ui.tsx). Sans poste (ou un
 * code inconnu) : gris neutre (couleurs de la carte).
 *
 * Les couleurs sont posées en variables CSS (--pos-<teinte>-bg / -fg) par src/theme.ts, version claire ou sombre selon le
 * thème : clair, fond pâle et texte foncé ; sombre, fond foncé et texte clair. Valeurs : palette de Tailwind.
 */

export type PosHue = 'rose' | 'amber' | 'violet' | 'emerald' | 'sky'

export const POS_HUES: readonly PosHue[] = ['rose', 'amber', 'violet', 'emerald', 'sky']

/** Teinte de chaque poste, par sport (codes des fiches). */
export const POSITION_HUES: Record<string, Partial<Record<string, PosHue>>> = {
  handball: { GB: 'rose', AG: 'amber', AD: 'amber', ARG: 'violet', ARD: 'violet', DC: 'emerald', PIV: 'sky' },
  // Volley : le passeur comme le demi-centre (le meneur), le libéro comme le gardien (poste à part).
  volley: { P: 'emerald', R4: 'amber', C: 'sky', PT: 'violet', L: 'rose' },
}

/** Fond et texte d'une teinte, en clair et en sombre. */
export const POS_TONES: Record<PosHue, { light: { bg: string; fg: string }; dark: { bg: string; fg: string } }> = {
  rose: { light: { bg: '#ffe4e6', fg: '#9f1239' }, dark: { bg: '#881337', fg: '#fda4af' } },
  amber: { light: { bg: '#fef3c7', fg: '#92400e' }, dark: { bg: '#78350f', fg: '#fcd34d' } },
  violet: { light: { bg: '#ede9fe', fg: '#5b21b6' }, dark: { bg: '#4c1d95', fg: '#c4b5fd' } },
  emerald: { light: { bg: '#d1fae5', fg: '#065f46' }, dark: { bg: '#064e3b', fg: '#6ee7b7' } },
  sky: { light: { bg: '#e0f2fe', fg: '#075985' }, dark: { bg: '#0c4a6e', fg: '#7dd3fc' } },
}

/** Teinte d'un poste du sport en cours ; sans poste ou code inconnu : null (gris neutre). */
export function positionHue(code?: string | null, sport = currentSport().sport): PosHue | null {
  if (!code) return null
  return (POSITION_HUES[sport] ?? POSITION_HUES.handball)[code] ?? null
}

/** Variables CSS d'un thème (posées sur <html> par src/theme.ts). */
export function positionVars(light: boolean): Record<string, string> {
  const out: Record<string, string> = {}
  for (const h of POS_HUES) {
    const t = POS_TONES[h][light ? 'light' : 'dark']
    out[`--pos-${h}-bg`] = t.bg
    out[`--pos-${h}-fg`] = t.fg
  }
  return out
}

/** Style du rond des initiales ; sans teinte : rien (le rond garde les couleurs neutres de la carte). */
export const hueBg = (h: PosHue | null) => (h ? { backgroundColor: `var(--pos-${h}-bg)`, color: `var(--pos-${h}-fg)` } : undefined)
/** Couleur du « ● DC » ; sans teinte : rien (texte gris de la ligne). */
export const hueText = (h: PosHue | null) => (h ? { color: `var(--pos-${h}-fg)` } : undefined)
