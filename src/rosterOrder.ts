import { useState } from 'react'
import { getMe } from './components/ui'
import { POSITIONS, type Evaluation, type Player } from './db'
import { currentUserId } from './roles'

/*
 * Ordre de la liste des joueurs d'un événement : toujours regroupée par poste (ordre du terrain), et dans
 * chaque poste l'ordre choisi sur l'appareil pour cet événement (alphabétique par défaut).
 * La notation (flèches, glisser, « joueur suivant à noter ») suit le même ordre que la page de l'événement.
 */

/** Ordre à l'intérieur de chaque poste. */
export type RosterSort = 'nom' | 'naissance' | 'club' | 'ajout'

export const ROSTER_SORTS: { value: RosterSort; label: string }[] = [
  { value: 'nom', label: 'Nom' },
  { value: 'naissance', label: 'Naissance' },
  { value: 'club', label: 'Club' },
  { value: 'ajout', label: 'Ordre d’ajout' },
]

const key = (eventId: string) => `handbase.rosterSort.${eventId}`

export function readRosterSort(eventId?: string): RosterSort {
  if (!eventId) return 'nom'
  try {
    const v = localStorage.getItem(key(eventId)) as RosterSort | null
    return v && ROSTER_SORTS.some((s) => s.value === v) ? v : 'nom'
  } catch {
    return 'nom'
  }
}

/** Ordre choisi pour cet événement (« Nom » par défaut), gardé sur l'appareil. */
export function useRosterSort(eventId?: string): [RosterSort, (s: RosterSort) => void] {
  const [sort, setSort] = useState(() => readRosterSort(eventId))
  const [forEvent, setForEvent] = useState(eventId)
  // Autre événement affiché par le même écran : on reprend son ordre à lui.
  if (eventId !== forEvent) {
    setForEvent(eventId)
    setSort(readRosterSort(eventId))
  }
  const set = (s: RosterSort) => {
    setSort(s)
    try {
      if (eventId) localStorage.setItem(key(eventId), s)
    } catch {
      /* stockage indisponible */
    }
  }
  return [sort, set]
}

/** Mon avis, quel que soit le moyen de m'identifier (compte, ou nom en mode local). */
export function isMine(e: Pick<Evaluation, 'observerId' | 'observer'>) {
  const uid = currentUserId()
  return uid ? e.observerId === uid : e.observer === getMe()
}

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
