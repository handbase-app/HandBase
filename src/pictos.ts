import type { Evaluation, Measurement, PlayerGroup, Video } from './db'

/*
 * Pictogrammes au bout des lignes de joueurs (barre « Afficher » au-dessus de chaque liste, src/components/Pictos.tsx),
 * comme les « Restriction Toggles » de Blender : chacun s'affiche ou se masque sur toutes les lignes. Un seul réglage
 * pour toutes les listes, gardé sur l'appareil (localStorage « handbase.pictos »). Partie pure : testée par
 * tools/test-pictos.ts. Uniquement des marques positives ou neutres (gris = non, couleur = oui).
 */

export const PICTO_KINDS = ['suivi', 'vu', 'revoir', 'videos', 'avis', 'mesures', 'pole', 'groupes'] as const
export type PictoKind = (typeof PICTO_KINDS)[number]

/** Mesures « récentes » : prises dans les 90 derniers jours. */
export const RECENT_DAYS = 90

export const PICTO_LABELS: Record<PictoKind, string> = {
  suivi: 'Suivi',
  vu: 'Vu (par toi ou quelqu’un)',
  revoir: 'À revoir',
  videos: 'Vidéos',
  avis: 'Avis',
  mesures: `Mesures récentes (${RECENT_DAYS} jours)`,
  pole: 'Pôle / structure',
  groupes: 'Dans un de mes groupes',
}

/** Par défaut : ce que les lignes montraient déjà (suivi, vu, à revoir). */
export const DEFAULT_PICTOS: readonly PictoKind[] = ['suivi', 'vu', 'revoir']
export const PICTOS_KEY = 'handbase.pictos'

const isKind = (x: unknown): x is PictoKind => typeof x === 'string' && (PICTO_KINDS as readonly string[]).includes(x)

/** Réglage relu (texte JSON du stockage) : absent ou illisible → défaut ; inconnus ignorés ; ordre de la barre. */
export function parsePictos(raw: string | null | undefined): PictoKind[] {
  if (raw == null) return [...DEFAULT_PICTOS]
  try {
    const v: unknown = JSON.parse(raw)
    if (!Array.isArray(v)) return [...DEFAULT_PICTOS]
    return PICTO_KINDS.filter((k) => v.some((x) => x === k && isKind(x)))
  } catch {
    return [...DEFAULT_PICTOS]
  }
}

export const serializePictos = (on: readonly PictoKind[]) => JSON.stringify(PICTO_KINDS.filter((k) => on.includes(k)))

/** Afficher / masquer un pictogramme ; l'ordre reste celui de la barre. */
export const togglePicto = (on: readonly PictoKind[], k: PictoKind): PictoKind[] => PICTO_KINDS.filter((x) => (x === k ? !on.includes(k) : on.includes(x)))

export const isDefaultPictos = (on: readonly PictoKind[]) => serializePictos(on) === serializePictos(DEFAULT_PICTOS)

/**
 * Largeurs du nom d'une ligne (px) : `full` sa largeur entière, `on` la place qu'il a avec les pictogrammes sur sa
 * ligne, `off` celle qu'il aurait sans eux.
 */
export interface NameFit {
  full: number
  on: number
  off: number
}

/**
 * Règle de place : une ligne (pictogrammes à côté du nom) tant qu'aucun nom de la liste n'est coupé à cause d'eux ;
 * sinon deux (toute la liste passe les pictogrammes sur leur propre ligne, sous le nom). Un nom déjà trop long sans
 * pictogrammes ne compte que pour ce que les pictogrammes lui prennent en plus. 1 px de tolérance (arrondis).
 */
export function pictoLines(rows: readonly NameFit[]): 1 | 2 {
  return rows.some((r) => r.full > r.on + 1 && r.on < Math.min(r.off, r.full) - 1) ? 2 : 1
}

/** Premier jour compté comme « récent » (AAAA-MM-JJ) : `today` moins `days` jours. */
export function recentSince(today: string, days = RECENT_DAYS): string {
  const d = new Date(`${today}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() - days)
  return d.toISOString().slice(0, 10)
}

/** Ce que les pictogrammes disent d'un joueur (hors suivi, vu et à revoir, rendus par leurs propres boutons). */
export interface PictoFacts {
  videos: number
  avis: number
  /** Mesures des 90 derniers jours, et la date de la dernière. */
  recent: number
  lastMeasure?: string
  /** Noms de mes groupes où il est. */
  groups: string[]
}

export const NO_FACTS: PictoFacts = { videos: 0, avis: 0, recent: 0, groups: [] }

/**
 * Faits de chaque joueur de `ids`, calculés en une passe sur les lignes déjà lues (une requête par table pour toute
 * la liste). Lignes supprimées ignorées ; vidéos des joueurs seulement ; mesures depuis `since` (recentSince).
 */
export function buildFacts(
  ids: readonly string[],
  {
    videos = [],
    evals = [],
    measurements = [],
    groups = [],
    since = '',
    isMine = () => false,
  }: {
    videos?: readonly Video[]
    evals?: readonly Evaluation[]
    measurements?: readonly Measurement[]
    groups?: readonly PlayerGroup[]
    since?: string
    isMine?: (g: PlayerGroup) => boolean
  },
): Map<string, PictoFacts> {
  const out = new Map<string, PictoFacts>()
  for (const id of ids) out.set(id, { videos: 0, avis: 0, recent: 0, groups: [] })
  for (const v of videos) if (!v.deleted && v.targetKind === 'player') out.get(v.targetId) && out.get(v.targetId)!.videos++
  for (const e of evals) if (!e.deleted) out.get(e.playerId) && out.get(e.playerId)!.avis++
  for (const m of measurements) {
    const f = out.get(m.playerId)
    if (!f || m.deleted || !m.date || m.date < since) continue
    f.recent++
    if (!f.lastMeasure || m.date > f.lastMeasure) f.lastMeasure = m.date
  }
  for (const g of groups) {
    if (g.deleted || g.archived || !isMine(g)) continue
    for (const pid of g.playerIds) out.get(pid)?.groups.push(g.name)
  }
  return out
}

/** Fiche sur un onglet : `to` (adresse de la fiche, avec ses paramètres) avec `key=tab`, ou sans pour l'onglet par défaut. */
export function ficheOnTab(to: string, tab: string, key: string, def = 'profil', hash = ''): string {
  const [path, rest = ''] = to.split('#')[0].split('?')
  const q = new URLSearchParams(rest)
  q.delete(key)
  if (tab !== def) q.set(key, tab)
  const s = q.toString()
  return `${path}${s ? `?${s}` : ''}${hash}`
}
