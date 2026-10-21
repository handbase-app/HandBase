import type { Criterion } from './db'

/*
 * Radar « par zones » : la forme du profil a un sens. Chaque catégorie de critères occupe une zone du cadran
 * (Mental & attitude en haut, Intelligence de jeu en haut à droite, Attaque à droite, Physique en bas, Défense à
 * gauche ; pour les gardiens : spécifique gardien à gauche, arrêts par zone à droite) avec sa couleur.
 *
 * Réglage par catégorie (Réglages → Critères) : champs facultatifs radarZone / radarColor posés sur chaque critère
 * de la catégorie (synchronisés avec le reste du critère, sans changement de la base). Sans réglage, zone et couleur
 * sont déduites du nom de la catégorie ; une catégorie inconnue va dans le plus grand espace libre, en gris.
 *
 * Angles en degrés « boussole » : 0 = en haut, 90 = à droite, sens des aiguilles d'une montre.
 * Fonctions pures (test : npx jiti tools/test-radar-zones.ts).
 */

export type RadarZone = 'haut' | 'haut-droite' | 'droite' | 'bas-droite' | 'bas' | 'bas-gauche' | 'gauche' | 'haut-gauche'

export const RADAR_ZONES: { id: RadarZone; label: string; angle: number }[] = [
  { id: 'haut', label: 'En haut', angle: 0 },
  { id: 'haut-droite', label: 'En haut à droite', angle: 45 },
  { id: 'droite', label: 'À droite', angle: 90 },
  { id: 'bas-droite', label: 'En bas à droite', angle: 135 },
  { id: 'bas', label: 'En bas', angle: 180 },
  { id: 'bas-gauche', label: 'En bas à gauche', angle: 225 },
  { id: 'gauche', label: 'À gauche', angle: 270 },
  { id: 'haut-gauche', label: 'En haut à gauche', angle: 315 },
]
export const zoneAngle = (z: RadarZone) => RADAR_ZONES.find((x) => x.id === z)!.angle
export const isRadarZone = (z: unknown): z is RadarZone => RADAR_ZONES.some((x) => x.id === z)

/** Palette des catégories : teintes moyennes, lisibles sur les thèmes sombres comme clairs. */
export const RADAR_PALETTE: { color: string; label: string }[] = [
  { color: '#7F77DD', label: 'Violet' },
  { color: '#639922', label: 'Vert' },
  { color: '#378ADD', label: 'Bleu' },
  { color: '#BA7517', label: 'Ocre' },
  { color: '#E24B4A', label: 'Rouge' },
  { color: '#1D9E75', label: 'Turquoise' },
  { color: '#D4537E', label: 'Rose' },
  { color: '#888780', label: 'Gris' },
]
export const NEUTRAL = '#888780'
const isColor = (c: unknown): c is string => typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c)

export type CategoryKind = 'mental' | 'intelligence' | 'attaque' | 'defense' | 'physique' | 'gardien' | 'gardien-arrets' | 'autre'

const KIND_STYLE: Record<CategoryKind, { zone: RadarZone | null; color: string }> = {
  mental: { zone: 'haut', color: '#7F77DD' },
  intelligence: { zone: 'haut-droite', color: '#639922' },
  attaque: { zone: 'droite', color: '#378ADD' },
  physique: { zone: 'bas', color: '#BA7517' },
  defense: { zone: 'gauche', color: '#E24B4A' },
  gardien: { zone: 'gauche', color: '#1D9E75' },
  'gardien-arrets': { zone: 'droite', color: '#D4537E' },
  autre: { zone: null, color: NEUTRAL },
}

/** Sans accents ni majuscules. */
export const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()

/**
 * Famille d'une catégorie d'après son nom (« Mental & attitude » → mental, « Vitesse & endurance » → physique…). Volley :
 * « Libéro », le poste à part, dans la famille du gardien (zone et couleur du spécifique gardien).
 */
export function categoryKind(name: string): CategoryKind {
  const n = fold(name)
  if (/gardien|\bgb\b/.test(n)) return /arret|zone|\btirs?\b/.test(n) ? 'gardien-arrets' : 'gardien'
  if (/\bliberos?\b/.test(n)) return 'gardien'
  if (/mental|attitude|comportement|psych|caract/.test(n)) return 'mental'
  if (/intelligence|tactique|lecture|cognit/.test(n)) return 'intelligence'
  if (/defens/.test(n)) return 'defense'
  if (/attaqu|offens/.test(n)) return 'attaque'
  if (/physi|motricit|vitesse|puissance|gabarit|athlet|endurance|force|detente|saut|mobilit|stabilit|gainage|mensuration|coordination|explosiv/.test(n)) return 'physique'
  return 'autre'
}

export const defaultZone = (category: string) => KIND_STYLE[categoryKind(category)].zone
export const defaultColor = (category: string) => KIND_STYLE[categoryKind(category)].color

export interface CategoryStyle {
  /** null : placée par le radar dans le plus grand espace libre. */
  zone: RadarZone | null
  color: string
  /** Zone / couleur choisies dans les réglages (sinon déduites du nom). */
  setZone: boolean
  setColor: boolean
}

type StyleSource = Pick<Criterion, 'category' | 'radarZone' | 'radarColor' | 'deleted' | 'order'>

/**
 * Zone et couleur de chaque catégorie : réglage porté par ses critères (le premier dans l'ordre qui en a un),
 * sinon valeurs déduites du nom.
 */
export function categoryStyles(criteria: StyleSource[]): Map<string, CategoryStyle> {
  const out = new Map<string, CategoryStyle>()
  const sorted = criteria.filter((c) => !c.deleted).sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
  for (const c of sorted) {
    const s = out.get(c.category) ?? { zone: defaultZone(c.category), color: defaultColor(c.category), setZone: false, setColor: false }
    if (!s.setZone && isRadarZone(c.radarZone)) Object.assign(s, { zone: c.radarZone, setZone: true })
    if (!s.setColor && isColor(c.radarColor)) Object.assign(s, { color: c.radarColor, setColor: true })
    out.set(c.category, s)
  }
  return out
}

export const styleOf = (styles: Map<string, CategoryStyle>, category: string): CategoryStyle =>
  styles.get(category) ?? { zone: defaultZone(category), color: defaultColor(category), setZone: false, setColor: false }

// ---------- Placement ----------

export interface RadarAxis {
  id: string
  label: string
  category: string
}
export interface PlacedAxis extends RadarAxis {
  /** Angle boussole, dans [0, 360). */
  angle: number
  /** Indice du secteur (dans `sectors`). */
  sector: number
}
export interface RadarSector {
  category: string
  color: string
  /** Angle d'ancrage visé (zone réglée, déduite, ou espace libre). */
  anchor: number
  /** Bornes du secteur (start < end, end - start ≤ 360 ; start peut être négatif). */
  start: number
  end: number
  count: number
}

const mod = (a: number) => ((a % 360) + 360) % 360
/** Écart signé b - a ramené dans [-180, 180). */
const diff = (a: number, b: number) => mod(b - a + 180) - 180

/** Milieu du plus grand écart entre des angles (0 s'il n'y en a pas). */
export function largestGapMiddle(angles: number[]): number {
  const s = [...new Set(angles.map(mod))].sort((a, b) => a - b)
  if (!s.length) return 0
  if (s.length === 1) return mod(s[0] + 180)
  let best = -1
  let mid = 0
  for (let i = 0; i < s.length; i++) {
    const a = s[i]
    const b = i + 1 < s.length ? s[i + 1] : s[0] + 360
    if (b - a > best + 1e-9) {
      best = b - a
      mid = mod((a + b) / 2)
    }
  }
  return mid
}

/**
 * Place les branches du radar : une branche par critère (dans l'ordre donné), regroupées par catégorie ; chaque
 * catégorie forme un secteur centré au plus près de sa zone ; seules les catégories présentes ont un secteur, qui
 * se partagent tout le tour (pas de trou). Écart entre branches à peu près régulier (compromis entre « chaque
 * secteur au plus près de sa zone » et « même place pour chaque branche »), régulier à l'intérieur d'un secteur.
 */
export function layoutRadar(axes: RadarAxis[], styles: Map<string, CategoryStyle>): { axes: PlacedAxis[]; sectors: RadarSector[] } {
  // Catégories dans l'ordre d'apparition, branches dans l'ordre donné.
  const groups: { category: string; axes: RadarAxis[]; anchor: number | null; color: string; first: number }[] = []
  axes.forEach((a, i) => {
    let g = groups.find((x) => x.category === a.category)
    if (!g) {
      const st = styleOf(styles, a.category)
      g = { category: a.category, axes: [], anchor: st.zone ? zoneAngle(st.zone) : null, color: st.color, first: i }
      groups.push(g)
    }
    g.axes.push(a)
  })
  if (!groups.length) return { axes: [], sectors: [] }
  // Catégories sans zone : l'une après l'autre au milieu du plus grand espace libre.
  for (const g of groups) if (g.anchor === null) g.anchor = largestGapMiddle(groups.filter((x) => x.anchor !== null).map((x) => x.anchor!))
  // Ordre sur le cercle : par angle d'ancrage (à égalité, ordre d'apparition).
  const ord = [...groups].sort((a, b) => mod(a.anchor!) - mod(b.anchor!) || a.first - b.first)
  const k = ord.length
  const N = axes.length
  const step = 360 / N
  const n = ord.map((g) => g.axes.length)
  const anchor = ord.map((g) => mod(g.anchor!))

  // b[i] : début du secteur i (b[i + k] = b[i] + 360).
  let b: number[]
  if (k === 1) b = [anchor[0] - 180]
  else {
    // Départ : pas régulier, décalage = moyenne circulaire des écarts aux zones.
    const starts: number[] = []
    let acc = 0
    for (const x of n) {
      starts.push(acc * step)
      acc += x
    }
    let sx = 0
    let sy = 0
    ord.forEach((_, i) => {
      const d = (diff(starts[i] + (n[i] * step) / 2, anchor[i]) * Math.PI) / 180
      sx += Math.cos(d)
      sy += Math.sin(d)
    })
    const off = (Math.atan2(sy, sx) * 180) / Math.PI
    b = starts.map((s) => s + off)
    // Affinage (Gauss-Seidel) : coût = Σ (centre - zone)² + λ Σ n (largeur / n - pas)².
    const L = 1.5
    const B = (i: number) => b[((i % k) + k) % k] + 360 * Math.floor(i / k)
    for (let it = 0; it < 300; it++) {
      for (let g = 0; g < k; g++) {
        const p = (g - 1 + k) % k
        const prev = B(g - 1)
        const next = B(g + 1)
        // Zones ramenées près des centres actuels (le cercle n'a pas de début).
        const cP = (prev + b[g]) / 2
        const cG = (b[g] + next) / 2
        const aP = cP + diff(cP, anchor[p])
        const aG = cG + diff(cG, anchor[g])
        const coef = 0.5 + L / n[p] + L / n[g]
        const rhs = aP / 2 - prev / 4 + aG / 2 - next / 4 + (L / n[p]) * (prev + n[p] * step) + (L / n[g]) * (next - n[g] * step)
        let v = rhs / coef
        // Jamais moins de 60 % du pas régulier par branche.
        v = Math.max(v, prev + n[p] * step * 0.6)
        v = Math.min(v, next - n[g] * step * 0.6)
        b[g] = v
      }
    }
  }
  const sectors: RadarSector[] = ord.map((g, i) => {
    const start = b[i]
    const end = i + 1 < k ? b[i + 1] : b[0] + 360
    return { category: g.category, color: g.color, anchor: anchor[i], start, end, count: n[i] }
  })
  const placed: PlacedAxis[] = []
  sectors.forEach((s, i) => {
    const w = (s.end - s.start) / s.count
    ord[i].axes.forEach((a, j) => placed.push({ ...a, angle: mod(s.start + (j + 0.5) * w), sector: i }))
  })
  return { axes: placed, sectors }
}

/** Coordonnées (x, y) d'un point à l'angle boussole `deg` et au rayon `r` autour de (cx, cy). */
export const polar = (cx: number, cy: number, r: number, deg: number): [number, number] => {
  const t = (deg * Math.PI) / 180
  return [cx + r * Math.sin(t), cy - r * Math.cos(t)]
}

/** Coupe un libellé en deux lignes au plus de `max` caractères (« … » au-delà). */
export function wrapLabel(s: string, max: number): string[] {
  if (s.length <= max) return [s]
  // Coupure entre deux mots qui équilibre les deux lignes (pas de « m » tout seul sur la deuxième).
  const words = s.split(/\s+/)
  let best: string[] = [s]
  for (let i = 1; i < words.length; i++) {
    const cut = [words.slice(0, i).join(' '), words.slice(i).join(' ')]
    if (best.length === 1 || Math.max(...cut.map((l) => l.length)) < Math.max(...best.map((l) => l.length))) best = cut
  }
  return best.map((l) => (l.length > max ? l.slice(0, max - 1).trimEnd() + '…' : l))
}
