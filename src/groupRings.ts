import { fallbackGroupColor, GROUP_COLORS, isGroupColor, type GroupColor } from './groupColors'

/*
 * « Repérer des groupes » (Filtres → bas de la fenêtre, components/GroupRings.tsx) : jusqu'à 3 groupes choisis par chacun
 * (gardés sur le compte avec l'affichage, src/affichage.ts) ; leurs joueurs ont un liseré de la couleur du groupe à
 * gauche de la ligne, dans toutes les listes (components/PlayerRow.tsx ; choix du 03/11, à la place d'un anneau). Partie pure, testée par tools/test-reperer-groupes.ts.
 */

export const MAX_REPERES = 3

/** Identifiant envoyé au serveur (supabase/064_reperer_groupes.sql n'accepte que cette forme). */
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Liste relue (appareil ou compte) : textes non vides, sans doublon, 3 au plus ; pas un tableau : null. */
export function parseGroupes(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null
  const out: string[] = []
  for (const x of v) if (typeof x === 'string' && x && !out.includes(x) && out.length < MAX_REPERES) out.push(x)
  return out
}

/** Texte JSON du stockage de l'appareil : absent ou illisible → aucun. */
export function parseGroupesRaw(raw: string | null | undefined): string[] {
  if (!raw) return []
  try {
    return parseGroupes(JSON.parse(raw)) ?? []
  } catch {
    return []
  }
}

export const sameIds = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x, i) => x === b[i])

/** Bascule d'un groupe ; déjà 3 : rien n'est ajouté. */
export function toggleGroupe(on: readonly string[], id: string): string[] {
  if (on.includes(id)) return on.filter((x) => x !== id)
  return on.length >= MAX_REPERES ? [...on] : [...on, id]
}

/** Groupe repéré, tel que le liseré le montre. */
export type RingGroup = { id: string; name: string; color: GroupColor }

/**
 * Couleurs des groupes repérés (dans l'ordre du choix) : la leur ; un groupe SANS couleur enregistrée prend celle tirée de
 * son identifiant, sauf si un autre groupe repéré l'a déjà : alors la suivante libre de la palette (deux liserés ne se
 * confondent pas). Même choix, mêmes couleurs, pour tout le monde.
 */
export function resolveRingColors(gs: readonly { id: string; color?: string }[]): GroupColor[] {
  const taken = new Set<GroupColor>(gs.flatMap((g) => (isGroupColor(g.color) ? [g.color] : [])))
  return gs.map((g) => {
    if (isGroupColor(g.color)) return g.color
    const start = GROUP_COLORS.indexOf(fallbackGroupColor(g.id))
    const free = [...GROUP_COLORS.slice(start), ...GROUP_COLORS.slice(0, start)].find((c) => !taken.has(c)) ?? GROUP_COLORS[start]
    taken.add(free)
    return free
  })
}

/**
 * Joueur → groupes repérés dont il fait partie (dans l'ordre du choix), calculé une fois pour toute l'appli. Les groupes
 * absents de `groups` (supprimés, plus visibles) sont sautés.
 */
export function ringMembership(ids: readonly string[], groups: readonly { id: string; name: string; color?: string; playerIds: readonly string[] }[]) {
  const byId = new Map(groups.map((g) => [g.id, g]))
  const found = ids.flatMap((id) => byId.get(id) ?? [])
  const colors = resolveRingColors(found)
  const shown: RingGroup[] = []
  const map = new Map<string, RingGroup[]>()
  for (const [i, g] of found.entries()) {
    const r: RingGroup = { id: g.id, name: g.name, color: colors[i] }
    shown.push(r)
    for (const pid of new Set(g.playerIds)) {
      const cur = map.get(pid)
      if (cur) cur.push(r)
      else map.set(pid, [r])
    }
  }
  return { groups: shown, map }
}

/** Joueurs du groupe présents dans la liste (« 4 ici »), sans compter deux fois un même joueur. */
export function countHere(playerIds: readonly string[], here: ReadonlySet<string>): number {
  let n = 0
  for (const id of new Set(playerIds)) if (here.has(id)) n++
  return n
}

/** « Groupes repérés : Comité 83, Interligue » (lecteur d'écran, bulle de la photo). */
export const ringLabel = (gs: readonly { name: string }[]) => (gs.length ? `${gs.length > 1 ? 'Groupes repérés' : 'Groupe repéré'} : ${gs.map((g) => g.name).join(', ')}` : '')
