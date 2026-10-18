import { sortYearStrings } from './birthYears'

/*
 * Vues de « Mes suivis » (src/pages/Follows.tsx) : Tout · Par groupe · Par année, pastilles d'une section (filtre) et
 * origine de chaque suivi (« via U17 France », « via 2 groupes », « suivi direct »). Fonctions pures, sans React ni
 * base : tools/test-suivis.ts.
 *  - Par groupe : une section par groupe suivi (ordre de computeFollows : alphabétique), puis « Suivis directement »
 *    pour les joueurs suivis un par un qui ne sont dans aucun groupe suivi. Un joueur de deux groupes est dans les deux.
 *  - Par année : une section par année de naissance, la plus récente d'abord (comme les choix d'années de l'appli,
 *    sortYearStrings), « Année inconnue » à la fin.
 */

export type FollowView = 'tout' | 'groupe' | 'annee'

/** Vue lue dans l'adresse (?vue=groupe|annee) ; Tout par défaut. */
export const parseFollowView = (v: string | null | undefined): FollowView => (v === 'groupe' || v === 'annee' ? v : 'tout')

/** Groupe suivi, réduit à ce qui sert ici. `team` : groupe de travail (suivi par ses participants). */
export interface FollowGroupLite {
  id: string
  name: string
  playerIds: string[]
  team?: boolean
}

/** D'où vient le suivi d'un joueur : suivi un par un (★) et/ou groupes suivis (dans l'ordre des groupes). */
export interface FollowOrigin {
  direct: boolean
  groups: { id: string; name: string }[]
}

/** Origine de chaque joueur suivi (directement ou par un groupe). */
export function followOrigins(direct: Iterable<string>, groups: FollowGroupLite[]): Map<string, FollowOrigin> {
  const out = new Map<string, FollowOrigin>()
  const get = (id: string) => {
    let o = out.get(id)
    if (!o) out.set(id, (o = { direct: false, groups: [] }))
    return o
  }
  for (const id of direct) get(id).direct = true
  for (const g of groups)
    for (const id of new Set(g.playerIds)) {
      const o = get(id)
      if (!o.groups.some((x) => x.id === g.id)) o.groups.push({ id: g.id, name: g.name })
    }
  return out
}

/**
 * Texte court de l'origine (« suivi direct », « via U17 France », « via 2 groupes », « suivi direct · via U17 France »)
 * et son détail (survol / appui : tous les noms). `except` : section affichée (groupe), retirée du texte — on écrit
 * alors « aussi via … » ; rien à dire (null) si le joueur n'est suivi que par ce groupe.
 */
export function originText(o: FollowOrigin | undefined, except?: string): { text: string; detail: string } | null {
  if (!o) return null
  const groups = o.groups.filter((g) => g.id !== except)
  const direct = o.direct && except !== DIRECT_KEY
  const parts: string[] = []
  if (direct) parts.push('suivi direct')
  if (groups.length) parts.push(`${except ? 'aussi ' : ''}via ${groups.length === 1 ? groups[0].name : `${groups.length} groupes`}`)
  if (!parts.length) return null
  const detail = [direct && 'Suivi directement (★)', ...groups.map((g) => `Groupe « ${g.name} »`)].filter(Boolean).join('\n')
  return { text: parts.join(' · '), detail }
}

/** Section d'une vue : clé (adresse, &filtre=), titre, joueurs (ids, sans doublon). */
export interface FollowSection {
  key: string
  label: string
  playerIds: string[]
  /** Section d'un groupe : son id (lien, « Ne plus suivre »). */
  groupId?: string
  team?: boolean
}

export const DIRECT_KEY = 'direct'
export const UNKNOWN_YEAR_KEY = 'inconnue'

/**
 * Par groupe. `known` : joueurs affichables (vivants, non fusionnés) ; les autres ne comptent pas. Sections vides
 * écartées.
 */
export function groupSections(direct: Iterable<string>, groups: FollowGroupLite[], known?: (id: string) => boolean): FollowSection[] {
  const ok = known ?? (() => true)
  const inGroup = new Set<string>()
  const out: FollowSection[] = []
  for (const g of groups) {
    const ids = [...new Set(g.playerIds)].filter(ok)
    ids.forEach((id) => inGroup.add(id))
    if (ids.length) out.push({ key: g.id, label: g.name, playerIds: ids, groupId: g.id, team: g.team })
  }
  const alone = [...new Set(direct)].filter((id) => ok(id) && !inGroup.has(id))
  if (alone.length) out.push({ key: DIRECT_KEY, label: 'Suivis directement', playerIds: alone })
  return out
}

/** Année de naissance (texte), '' si inconnue. */
export const birthYearOf = (p: { birthDate?: string }) => (p.birthDate && /^\d{4}/.test(p.birthDate) ? p.birthDate.slice(0, 4) : '')

/** Par année de naissance : la plus récente d'abord, « Année inconnue » à la fin. */
export function yearSections(players: { id: string; birthDate?: string }[]): FollowSection[] {
  const by = new Map<string, string[]>()
  for (const p of players) {
    const y = birthYearOf(p)
    const l = by.get(y)
    if (!l) by.set(y, [p.id])
    else if (!l.includes(p.id)) l.push(p.id)
  }
  return sortYearStrings(by.keys()).map((y) => ({ key: y || UNKNOWN_YEAR_KEY, label: y || 'Année inconnue', playerIds: by.get(y)! }))
}

/** Section choisie par &filtre= (null : aucune, ou plus là — groupe plus suivi…). */
export const pickSection = (sections: FollowSection[], key: string | null | undefined) => (key ? (sections.find((s) => s.key === key) ?? null) : null)

/** Joueurs distincts d'un ensemble de sections. */
export const sectionPlayers = (sections: FollowSection[]) => new Set(sections.flatMap((s) => s.playerIds))

/**
 * Répartit des éléments (nouveautés) par section : chaque élément va dans toutes les sections de son joueur, dans
 * l'ordre des sections ; sections sans élément gardées (liste vide).
 */
export function splitBySection<T extends { playerId: string }>(items: T[], sections: FollowSection[]) {
  return sections.map((s) => {
    const ids = new Set(s.playerIds)
    return { section: s, items: items.filter((n) => ids.has(n.playerId)) }
  })
}

/** Libellé d'une pastille : « U17 France (14) ». */
export const sectionChip = (s: FollowSection) => `${s.label} (${s.playerIds.length})`
