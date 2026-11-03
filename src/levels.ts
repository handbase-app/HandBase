import type { GroupScope } from './db'

/*
 * Niveaux d'un joueur (anneau autour de la photo dans toutes les listes, components/LevelRing.tsx), calculés seuls, sans
 * réglage : France (dans un groupe « Fédération »), Pôle (au Pôle cette saison, même règle que l'étiquette « Pôle » de la
 * ligne : poleStatus de src/db.ts), Ligue, Comité (groupes de ce niveau). Groupes en cours, non archivés, visibles (comme
 * la page Groupes) ; les groupes Pôle ne comptent pas ici. Deux au plus, les plus importants. Fichier pur, testé par
 * tools/test-niveaux.ts (contraste 3:1 de l'anneau sur toutes les cartes claires et sombres).
 */

export type Level = 'france' | 'pole' | 'ligue' | 'comite'

/** Ordre d'importance. */
export const LEVELS: readonly Level[] = ['france', 'pole', 'ligue', 'comite']
export const MAX_LEVELS = 2

/** Nom lu (bulle, lecteur d'écran) et teinte en thème clair / sombre (palette de Tailwind). */
export const LEVEL_TONES: Record<Level, { label: string; light: string; dark: string }> = {
  france: { label: 'France', light: '#1d4ed8', dark: '#60a5fa' },
  pole: { label: 'Pôle', light: '#15803d', dark: '#4ade80' },
  ligue: { label: 'Ligue', light: '#b91c1c', dark: '#ef4444' },
  comite: { label: 'Comité', light: '#a37a00', dark: '#facc15' },
}

const SCOPE_LEVEL: Record<GroupScope, Level> = { federation: 'france', ligue: 'ligue', comite: 'comite' }

/** Joueur → niveaux venus des groupes (France, Ligue, Comité). `groups` : groupes en cours et visibles. */
export function scopeLevelMap(groups: readonly { scope?: string; archived?: boolean; poleUnitId?: string; playerIds?: readonly string[] }[]) {
  const map = new Map<string, Set<Level>>()
  for (const g of groups) {
    const l = g.scope && !g.archived && !g.poleUnitId ? SCOPE_LEVEL[g.scope as GroupScope] : undefined
    if (!l) continue
    for (const pid of g.playerIds ?? []) {
      const cur = map.get(pid)
      if (cur) cur.add(l)
      else map.set(pid, new Set([l]))
    }
  }
  return map
}

/** Niveaux montrés, du plus important au moins important, deux au plus. */
export const playerLevels = (scopes: ReadonlySet<Level> | undefined, atPole: boolean): Level[] =>
  LEVELS.filter((l) => (l === 'pole' ? atPole : !!scopes?.has(l))).slice(0, MAX_LEVELS)

/** Variables CSS d'un thème (posées sur <html> par src/theme.ts). */
export function levelVars(light: boolean): Record<string, string> {
  return Object.fromEntries(LEVELS.map((l) => [`--niv-${l}`, LEVEL_TONES[l][light ? 'light' : 'dark']]))
}

export const levelCss = (l: Level) => `var(--niv-${l})`

/** Épaisseur de l'anneau (px) selon la taille de la photo, et écart avec elle. */
export const ringWidth = (size: number) => (size >= 36 ? 3 : 2.5)
export const RING_GAP = 1.5

/**
 * Fond de l'anneau : un niveau, sa couleur ; deux, coupé à la verticale : moitié GAUCHE le plus important, moitié droite
 * l'autre, un petit vide (≈ 1,5 px) en haut et en bas entre les deux. Même paire, même dessin.
 */
export function levelRingBackground(levels: readonly Level[], size: number): string {
  if (levels.length <= 1) return levels[0] ? levelCss(levels[0]) : 'transparent'
  const [left, right] = levels
  const w = ringWidth(size)
  const mid = size / 2 + RING_GAP + w / 2
  const g = Math.round(((0.75 / mid) * 180 * 100) / Math.PI) / 100
  const d = (x: number) => `${Math.round(x * 100) / 100}deg`
  return `conic-gradient(transparent 0deg ${d(g)}, ${levelCss(right)} ${d(g)} ${d(180 - g)}, transparent ${d(180 - g)} ${d(180 + g)}, ${levelCss(left)} ${d(180 + g)} ${d(360 - g)}, transparent ${d(360 - g)})`
}

/** « Niveaux : France, Pôle » (lecteur d'écran, bulle de la photo). */
export const levelLabel = (ls: readonly Level[]) => (ls.length ? `${ls.length > 1 ? 'Niveaux' : 'Niveau'} : ${ls.map((l) => LEVEL_TONES[l].label).join(', ')}` : '')
