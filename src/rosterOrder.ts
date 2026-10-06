import { useState } from 'react'
import { getMe } from './components/ui'
import { POSITIONS, type Evaluation, type Player } from './db'
import { currentUserId } from './roles'

/*
 * Ordre de la liste des joueurs d'un événement, choisi sur l'appareil pour chaque événement.
 * La notation (flèches, glisser, « joueur suivant à noter ») suit le même ordre que la page de l'événement.
 */

export type RosterSort = 'nom' | 'poste' | 'anoter' | 'naissance' | 'club' | 'ajout'

export const ROSTER_SORTS: { value: RosterSort; label: string }[] = [
  { value: 'nom', label: 'Nom' },
  { value: 'poste', label: 'Poste' },
  { value: 'anoter', label: 'À noter d’abord' },
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

/** Trie la liste de l'événement. `notedByMe` : joueurs que j'ai déjà notés sur cet événement. */
export function sortRoster(roster: Player[], sort: RosterSort, notedByMe: Set<string>): Player[] {
  const list = [...roster]
  switch (sort) {
    case 'ajout':
      return list
    case 'poste':
      return list.sort((a, b) => positionRank(a) - positionRank(b) || byName(a, b))
    case 'anoter':
      return list.sort((a, b) => Number(notedByMe.has(a.id)) - Number(notedByMe.has(b.id)) || byName(a, b))
    case 'naissance':
      // Les plus âgés d'abord ; date inconnue à la fin.
      return list.sort((a, b) => (a.birthDate ?? '9999').localeCompare(b.birthDate ?? '9999') || byName(a, b))
    case 'club':
      return list.sort((a, b) => (a.club ?? '￿').localeCompare(b.club ?? '￿', 'fr', { sensitivity: 'base' }) || byName(a, b))
    default:
      return list.sort(byName)
  }
}
