/*
 * Couleur d'un groupe de joueurs (PlayerGroup.color) : repère des groupes choisis dans « Filtres » → « Repérer des groupes »,
 * anneau autour de la photo dans toutes les listes (src/groupRings.ts, components/PlayerRow.tsx). Elle appartient au groupe :
 * tout le monde voit la même. Fichier pur (testé par tools/test-reperer-groupes.ts : 10 couleurs bien distinctes, anneau
 * lisible (3:1) sur toutes les cartes claires et sombres).
 *
 * Ni rouge ni rose (l'accent), ni menthe (« Pôle ») : pas de confusion. Version claire ou sombre selon le thème, posée en
 * variables CSS (--grp-<clé>) par src/theme.ts, comme les couleurs des postes. Valeurs : palette de Tailwind.
 */

export type GroupColor = 'bleu' | 'violet' | 'fuchsia' | 'orange' | 'jaune' | 'vert' | 'olive' | 'brun' | 'ardoise' | 'encre'

export const GROUP_COLORS: readonly GroupColor[] = ['bleu', 'violet', 'fuchsia', 'orange', 'jaune', 'vert', 'olive', 'brun', 'ardoise', 'encre']

/** Nom lu (bulle, lecteur d'écran) et teinte en thème clair / sombre. */
export const GROUP_TONES: Record<GroupColor, { label: string; light: string; dark: string }> = {
  bleu: { label: 'Bleu', light: '#2563eb', dark: '#60a5fa' },
  violet: { label: 'Violet', light: '#7c3aed', dark: '#a78bfa' },
  fuchsia: { label: 'Fuchsia', light: '#c026d3', dark: '#e879f9' },
  orange: { label: 'Orange', light: '#c2410c', dark: '#fb923c' },
  jaune: { label: 'Jaune', light: '#a16207', dark: '#facc15' },
  vert: { label: 'Vert', light: '#15803d', dark: '#4ade80' },
  olive: { label: 'Olive', light: '#4d7c0f', dark: '#bef264' },
  brun: { label: 'Brun', light: '#7c4a1e', dark: '#d6a77a' },
  ardoise: { label: 'Ardoise', light: '#64748b', dark: '#94a3b8' },
  encre: { label: 'Encre', light: '#111827', dark: '#f9fafb' },
}

export const isGroupColor = (v: unknown): v is GroupColor => typeof v === 'string' && (GROUP_COLORS as readonly string[]).includes(v)

/** Couleur sans choix enregistré : toujours la même pour un même groupe (tirée de son identifiant). */
export function fallbackGroupColor(id: string): GroupColor {
  let h = 2166136261
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619)
  return GROUP_COLORS[(h >>> 0) % GROUP_COLORS.length]
}

/** Couleur d'un groupe : la sienne, sinon celle tirée de son identifiant. */
export const groupColorOf = (g: { id: string; color?: string }): GroupColor => (isGroupColor(g.color) ? g.color : fallbackGroupColor(g.id))

/** Nouveau groupe : la couleur la moins prise parmi les groupes existants (à égalité, la première de la palette). */
export function autoGroupColor(groups: readonly { id: string; color?: string }[]): GroupColor {
  const n = new Map<GroupColor, number>(GROUP_COLORS.map((c) => [c, 0]))
  for (const g of groups) {
    const c = groupColorOf(g)
    n.set(c, n.get(c)! + 1)
  }
  return GROUP_COLORS.reduce((best, c) => (n.get(c)! < n.get(best)! ? c : best), GROUP_COLORS[0])
}

/** Variables CSS d'un thème (posées sur <html> par src/theme.ts). */
export function groupColorVars(light: boolean): Record<string, string> {
  return Object.fromEntries(GROUP_COLORS.map((c) => [`--grp-${c}`, GROUP_TONES[c][light ? 'light' : 'dark']]))
}

export const groupColorCss = (c: GroupColor) => `var(--grp-${c})`
