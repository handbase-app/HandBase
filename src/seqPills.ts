import type { ActionKind, Side } from './matchSheet'

/*
 * Pastilles de la frise défilante du séquençage (calcul pur ; l'écran : src/components/Sequencer.tsx et SeqPill.tsx).
 *
 * Chaque pastille dit en un coup d'œil QUOI (libellé court en texte + pictogramme : « BUT », « 7 M », « 2' », carton
 * jaune…) et QUI (couleur franche de l'équipe, abréviation de l'équipe, numéro du joueur). Les couleurs d'équipe sont
 * propres au séquençage (la frise est posée sur la vidéo, claire ou sombre, quel que soit le style de l'installation) :
 * bleu pour l'équipe qui reçoit, orange brûlé pour les visiteurs, bien distinctes entre elles (y compris pour les
 * daltoniens : opposition bleu / orange), du vert « calée » et du jaune de la cible ; texte blanc lisible (≥ 4,5:1).
 */

/**
 * Type montré sur une pastille : ceux de la feuille de match, plus la perte de balle et la passe décisive, qui ne viennent
 * pas de la feuille (elles viendront d'une saisie pendant la vidéo, « + Action », pas encore faite).
 *
 * « tir » (et « tir7 ») est toujours un TIR RATÉ : un tir réussi est un but (« but », « but7 »). Il n'y a pas de type
 * « tir réussi ». Sur la pastille : « TIR » ; dans l'annonce : « Tir raté ».
 */
export type PillKind = ActionKind | 'perte' | 'passe'

/** Pictogramme simple (dessiné en SVG par SeqPill.tsx, aucun émoji). */
export type Glyph = 'ball' | 'miss' | 'save' | 'shot' | 'pass' | 'turnover' | 'clock' | 'card' | 'pause' | 'dot'

export interface PillLabel {
  /** Sur la pastille, en capitales : « BUT », « 7 M », « 2' ». */
  short: string
  /** Dans l'annonce et les bulles d'aide : « But sur 7 m ». */
  long: string
  glyph: Glyph
  /** Couleur du carton (pictogramme « card »). */
  card?: string
}

export const CARD = { jaune: '#facc15', rouge: '#dc2626', bleu: '#2563eb' }

const PILL: Record<PillKind, PillLabel> = {
  but: { short: 'BUT', long: 'But', glyph: 'ball' },
  but7: { short: '7 M', long: 'But sur 7 m', glyph: 'ball' },
  /** Tir raté (un tir réussi est un but). */
  tir: { short: 'TIR', long: 'Tir raté', glyph: 'shot' },
  /** 7 m raté (tir sur 7 m non marqué). */
  tir7: { short: '7 M ✕', long: '7 m raté', glyph: 'miss' },
  arret: { short: 'ARRÊT', long: 'Arrêt', glyph: 'save' },
  arret7: { short: 'ARRÊT 7 M', long: 'Arrêt sur 7 m', glyph: 'save' },
  '2mn': { short: '2′', long: '2 minutes', glyph: 'clock' },
  avert: { short: 'JAUNE', long: 'Carton jaune', glyph: 'card', card: CARD.jaune },
  disq: { short: 'ROUGE', long: 'Carton rouge', glyph: 'card', card: CARD.rouge },
  bleu: { short: 'BLEU', long: 'Carton bleu', glyph: 'card', card: CARD.bleu },
  tm: { short: 'TM', long: 'Temps mort', glyph: 'pause' },
  perte: { short: 'PERTE', long: 'Perte de balle', glyph: 'turnover' },
  passe: { short: 'PASSE', long: 'Passe décisive', glyph: 'pass' },
  autre: { short: 'ACTION', long: 'Action', glyph: 'dot' },
}

/** Libellés d'une action ; « autre » prend le libellé lu sur la feuille (« Commotion » → « COMMOTION »). */
export function pillLabel(k: PillKind, l?: string): PillLabel {
  const p = PILL[k] ?? PILL.autre
  if (k !== 'autre' || !l?.trim()) return p
  const long = l.trim()
  const word = long.split(/\s+/)[0].toUpperCase()
  return { ...p, long, short: word.length > 9 ? `${word.slice(0, 8)}.` : word }
}

// ---------- Équipes ----------

/** Couleurs du séquençage (fond opaque des pastilles, texte blanc). */
export const TEAM_COLOR: Record<Side, string> = { home: '#1d4ed8', away: '#c2410c' }
/** Action sans équipe (rare : ligne « autre » de la feuille). */
export const NO_TEAM = '#3f3f46'
/** Calée (coche, contour) et cible (action annoncée), pour vérifier que les équipes s'en distinguent. */
export const FIXED_COLOR = '#10b981'
export const AIM_COLOR = '#fde047'

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase()
/** Mots qui ne disent pas de quelle équipe il s'agit : forme du club, articles, catégorie d'âge. */
const NOISE = new Set(
  'HBC HB HAND HANDBALL BALL CLUB AS ASL US USM CS ES AL SC SA FC JS RC OC ENTENTE ENT ASSOCIATION SPORTIVE SPORTING UNION OLYMPIQUE STADE DE DU DES LA LE LES L D ET SUR EN AUX AU ANS MOINS MASC FEM MASCULIN MASCULINS FEMININ FEMININES SG SF SM U'.split(' '),
)
/** Mots significatifs d'un nom d'équipe (« HBC Rhône-Sud -15 M » → RHONE, SUD). */
const words = (name: string) =>
  fold(name)
    .split(/[^A-Z0-9]+/)
    .filter((w) => w && !NOISE.has(w) && !/\d/.test(w) && !/^[MF]$/.test(w))

/** Abréviation d'un nom (3 lettres, comme sur un tableau d'affichage) : un mot → ses 3 premières lettres ; plusieurs → 2 + 1. */
function abbr(name: string): string {
  const w = words(name)
  if (!w.length) return ''
  if (w.length === 1) return w[0].slice(0, 3)
  if (w.length === 2) return (w[0].slice(0, 2) + w[1][0]).slice(0, 3)
  return w
    .slice(0, 3)
    .map((x) => x[0])
    .join('')
}
const digits = (name: string) => name.match(/\d+/g)?.join('') ?? ''

/**
 * Noms courts des deux équipes, toujours différents : « Rhône Sud » → RHS, « Handball Collines » → COL. Deux équipes du même
 * club (« Valence 1 », « Valence 2 ») : le chiffre qui les distingue est ajouté (VAL1, VAL2) ; sinon, ou sans nom : LOC / VIS.
 */
export function teamAbbr(home: string, away: string): Record<Side, string> {
  let h = abbr(home)
  let a = abbr(away)
  if (h && a && h === a) {
    const [dh, da] = [digits(home), digits(away)]
    if (dh !== da) [h, a] = [h + dh, a + da]
    else [h, a] = ['', '']
  }
  return { home: h || 'LOC', away: a || 'VIS' }
}

// ---------- Contraste (WCAG) ----------

const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
export function luminance(hex: string) {
  const n = parseInt(hex.replace('#', ''), 16)
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((x) => lin(x / 255))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
/** Rapport de contraste entre deux couleurs (1 à 21). */
export function contrast(a: string, b: string) {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p)
  return (x + 0.05) / (y + 0.05)
}
/** Teinte (degrés), pour vérifier que deux couleurs ne se confondent pas. */
export function hue(hex: string) {
  const n = parseInt(hex.replace('#', ''), 16)
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((x) => x / 255)
  const mx = Math.max(r, g, b)
  const d = mx - Math.min(r, g, b)
  if (!d) return 0
  const h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4
  return (h * 60 + 360) % 360
}
export const hueGap = (a: string, b: string) => {
  const d = Math.abs(hue(a) - hue(b)) % 360
  return Math.min(d, 360 - d)
}

// ---------- Empilement ----------

/** Une pastille sur la frise : centre et largeur (px) ; block : l'action annoncée, haute, occupe toutes les rangées. */
export interface LaneBox {
  x: number
  w: number
  block?: boolean
}

/**
 * Rangée de chaque pastille (0 : haut, 1 : bas ; -1 : l'action annoncée, au milieu sur toute la hauteur), pour que des
 * actions proches s'empilent au lieu de se recouvrir. Dans l'ordre de x : la première rangée libre (bord droit de la
 * précédente + gap ≤ bord gauche), sinon la moins chargée. Calculé sur toute la file, pas seulement la partie visible :
 * les écarts entre actions ne changent pas en défilant, une pastille garde donc sa rangée en traversant l'écran.
 */
export function stackLanes(boxes: LaneBox[], lanes = 2, gap = 6): number[] {
  const order = boxes.map((_, i) => i).sort((i, j) => boxes[i].x - boxes[j].x)
  const end = Array<number>(lanes).fill(-Infinity)
  const out = Array<number>(boxes.length).fill(0)
  for (const i of order) {
    const b = boxes[i]
    const left = b.x - b.w / 2
    const right = b.x + b.w / 2
    if (b.block) {
      out[i] = -1
      for (let l = 0; l < lanes; l++) end[l] = Math.max(end[l], right)
      continue
    }
    let lane = end.findIndex((e) => e + gap <= left)
    if (lane < 0) lane = end.indexOf(Math.min(...end))
    out[i] = lane
    end[lane] = Math.max(end[lane], right)
  }
  return out
}

/** Largeur estimée d'une pastille (px), d'après le nombre de signes de ses lignes : sert seulement à l'empilement. */
export const pillWidth = (lines: string[], px: number, pad: number) => Math.max(...lines.map((s) => s.length)) * px * 0.68 + pad
