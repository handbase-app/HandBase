import type { Player, Position } from './db'
import { POSITIONS } from './sportConfig'

/*
 * Rangement par poste d'une liste de joueurs (page d'un événement, page d'un groupe, colonne de contexte de la fiche) :
 * par poste dans l'ordre du terrain (gardien, ailiers et arrières de gauche à droite, pivot, puis sans poste) et, dans
 * chaque poste, l'ordre choisi (src/rosterOrder.ts le garde sur l'appareil). Fonctions pures, sans React ni base :
 * tools/test-tri-poste.ts.
 */

/** Ordre à l'intérieur de chaque poste. */
export type RosterSort = 'nom' | 'naissance' | 'club' | 'ajout'

export const ROSTER_SORTS: { value: RosterSort; label: string }[] = [
  { value: 'nom', label: 'Nom' },
  { value: 'naissance', label: 'Naissance' },
  { value: 'club', label: 'Club' },
  { value: 'ajout', label: 'Ordre d’ajout' },
]

/** Clé de la liste d'un groupe de joueurs pour useRosterSort / useRosterFilter (un événement : son id). */
export const groupRosterKey = (groupId: string) => `groupe.${groupId}`

/** Rang du poste sur le terrain : gardien, ailiers et arrières de gauche à droite, pivot, puis sans poste. */
export const positionRank = (p: Pick<Player, 'position'>) => {
  const i = POSITIONS.findIndex((x) => x.id === p.position)
  return i < 0 ? POSITIONS.length : i
}

const byName = (a: Player, b: Player) =>
  a.lastName.localeCompare(b.lastName, 'fr', { sensitivity: 'base' }) || a.firstName.localeCompare(b.firstName, 'fr', { sensitivity: 'base' })

/** Valeur absente : toujours en fin de poste. */
const last = (v: string | undefined) => (v ? `0${v}` : '1')

/** Ordre à l'intérieur d'un poste. `added` : rang dans la liste enregistrée (ordre d'ajout). */
function within(sort: RosterSort, added: Map<string, number>) {
  switch (sort) {
    case 'ajout':
      return (a: Player, b: Player) => (added.get(a.id) ?? 0) - (added.get(b.id) ?? 0)
    case 'naissance':
      // Les plus âgés d'abord ; date inconnue à la fin.
      return (a: Player, b: Player) => last(a.birthDate).localeCompare(last(b.birthDate)) || byName(a, b)
    case 'club':
      return (a: Player, b: Player) => last(a.club).localeCompare(last(b.club), 'fr', { sensitivity: 'base' }) || byName(a, b)
    default:
      return byName
  }
}

/** Trie la liste de l'événement : par poste (ordre du terrain), puis dans chaque poste selon `sort`. */
export function sortRoster(roster: Player[], sort: RosterSort): Player[] {
  const added = new Map(roster.map((p, i) => [p.id, i]))
  const inPost = within(sort, added)
  return [...roster].sort((a, b) => positionRank(a) - positionRank(b) || inPost(a, b))
}

/** Postes présents dans la liste, dans l'ordre du terrain, avec leur nombre de joueurs (pastilles « Gardien (1) »). */
export function rosterPositions(roster: Pick<Player, 'position'>[]) {
  return POSITIONS.map((x) => ({ ...x, n: roster.filter((p) => p.position === x.id).length })).filter((x) => x.n > 0)
}

/**
 * Liste d'un ensemble de joueurs rangée comme celle d'un événement (sans équipes ni notes) : par poste, `sort` dans
 * chaque poste, filtre d'un poste. `players` dans l'ordre enregistré (pour « Ordre d'ajout »). `roster` : tous, triés
 * (colonne de contexte, export) ; `sections` : ceux affichés, avec leurs titres de poste et une numérotation continue.
 */
export function positionRosterView(players: Player[], sort: RosterSort, pos: Position | '' = '') {
  const roster = sortRoster(players, sort)
  const shown = filterRoster(roster, { pos, hideNoted: false }, new Set())
  return { roster, shown, positions: rosterPositions(roster), sections: rosterSections(shown, roster.some((p) => p.position)) }
}

/**
 * Joueurs affichés après les filtres. `keep` : joueur en cours de notation, gardé même s'il vient d'être
 * noté (sinon il disparaîtrait de la liste au moment de passer au suivant).
 */
export function filterRoster(roster: Player[], f: { pos: Position | ''; hideNoted: boolean }, notedByMe: Set<string>, keep?: string) {
  return roster.filter((p) => p.id === keep || ((!f.hideNoted || !notedByMe.has(p.id)) && (!f.pos || p.position === f.pos)))
}

/**
 * Morceau de la liste d'un événement : titre (poste ou équipe), rang de son premier joueur, joueurs.
 * `sub` : poste à l'intérieur d'une équipe (liste « Par équipe et poste »).
 */
export type RosterSection = { heading: string | null; start: number; players: Player[]; info?: string; mine?: boolean; sub?: string }

/** Liste d'un événement découpée par poste (titres) : chaque morceau garde le rang de son premier joueur. */
export function rosterSections(list: Player[], withHeadings: boolean) {
  const out: RosterSection[] = []
  list.forEach((p, i) => {
    if (i === 0 || (withHeadings && list[i - 1].position !== p.position))
      out.push({ heading: withHeadings ? (POSITIONS.find((x) => x.id === p.position)?.label ?? 'Sans poste') : null, start: i, players: [] })
    out[out.length - 1].players.push(p)
  })
  return out
}

