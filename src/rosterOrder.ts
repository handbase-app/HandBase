import { useState } from 'react'
import { useSessionState } from './components/PlayerFilter'
import { getMe } from './components/ui'
import type { Evaluation, HBEvent, Player, Position } from './db'
import { byNumber, myTournamentTeams, teamOf, tournamentTeams } from './scouting'
import { currentUserId } from './roles'
import { positionRank, rosterSections, ROSTER_SORTS, type RosterSection, type RosterSort } from './positionOrder'

// Tri et découpage par poste (fonctions pures, testées par tools/test-tri-poste.ts).
export * from './positionOrder'

/*
 * Ordre de la liste des joueurs d'un événement : toujours regroupée par poste (ordre du terrain), et dans
 * chaque poste l'ordre choisi sur l'appareil pour cet événement (alphabétique par défaut).
 * Même rangement pour la page d'un groupe de joueurs et sa colonne de contexte (clé `groupe.<id>`, groupRosterKey).
 * Événement réparti en équipes : d'abord par équipe (voir RosterGroup plus bas).
 * La notation (flèches, glisser, « joueur suivant à noter ») suit le même ordre que la page de l'événement.
 */

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

/**
 * Filtres de la liste d'un événement (un poste, masquer ceux que j'ai notés), gardés pendant la session
 * pour cet événement : la notation ne passe que par les joueurs affichés sur la page de l'événement.
 */
export function useRosterFilter(eventId?: string) {
  const k = (name: string) => `handbase.rosterFilter.${eventId ?? '-'}.${name}`
  const [pos, setPos] = useSessionState<Position | ''>(k('pos'), '')
  const [hideNoted, setHideNoted] = useSessionState(k('hide'), false)
  return { pos, setPos, hideNoted, setHideNoted, active: !!pos || hideNoted }
}

/**
 * Événement réparti en équipes (tournoi, match importé d'une feuille) : liste par équipe et poste (par défaut), par
 * équipe et numéro, ou par poste seulement. Gardé pendant la session pour cet événement, repris par la notation.
 */
export type RosterGroup = 'equipe-poste' | 'equipe' | 'poste'

export const ROSTER_GROUPS: { value: RosterGroup; label: string }[] = [
  { value: 'equipe-poste', label: 'Par équipe et poste' },
  { value: 'equipe', label: 'Par équipe et numéro' },
  { value: 'poste', label: 'Par poste' },
]

export function useRosterGroup(eventId?: string) {
  const [v, set] = useSessionState<RosterGroup>(`handbase.tournoi.${eventId ?? '-'}.par`, 'equipe-poste')
  return [ROSTER_GROUPS.some((g) => g.value === v) ? v : 'equipe-poste', set] as const
}

/**
 * Équipes dans l'ordre d'affichage : mes équipes d'abord, puis les autres, puis « Sans équipe » (id vide), chacune
 * avec ses joueurs : par poste (ordre du terrain) puis numéro, ou par numéro seulement. Équipes vides omises.
 */
export function teamGroups(list: Player[], ev: Pick<HBEvent, 'tournament'>, byPosition: boolean) {
  const mine = myTournamentTeams(ev)
  const teams = [...tournamentTeams(ev)].sort((a, b) => Number(mine.has(b.id)) - Number(mine.has(a.id)))
  const known = new Set(teams.map((t) => t.id))
  const num = byNumber(ev)
  const order = byPosition ? (a: Player, b: Player) => positionRank(a) - positionRank(b) || num(a, b) : num
  return [...teams, { id: '', name: 'Sans équipe' }]
    .map((team) => ({
      team,
      mine: mine.has(team.id),
      players: list.filter((p) => (team.id ? teamOf(ev, p.id) === team.id : !known.has(teamOf(ev, p.id) ?? ''))).sort(order),
    }))
    .filter((g) => g.players.length)
}

/** Liste dans l'ordre affiché sur la page de l'événement (`list` déjà triée par sortRoster). */
export function groupRoster(list: Player[], ev: Pick<HBEvent, 'tournament'> | undefined, group: RosterGroup) {
  if (!ev || group === 'poste' || !tournamentTeams(ev).length) return list
  return teamGroups(list, ev, group === 'equipe-poste').flatMap((g) => g.players)
}

/**
 * Liste d'un événement découpée comme sur sa page, sans les compteurs : par équipe (mes équipes d'abord, sous-titres
 * de poste en « Par équipe et poste »), sinon par poste. `list` : déjà triée par sortRoster. Reprise par la fiche
 * ouverte depuis l'événement (colonne de gauche, joueur précédent / suivant).
 */
export function eventSections(list: Player[], ev: Pick<HBEvent, 'tournament'>, group: RosterGroup): RosterSection[] {
  if (!tournamentTeams(ev).length || group === 'poste') return rosterSections(list, list.some((p) => p.position))
  const byPosition = group === 'equipe-poste'
  const out: RosterSection[] = []
  let start = 0
  for (const { team, mine, players } of teamGroups(list, ev, byPosition)) {
    if (byPosition)
      rosterSections(players, true).forEach((s, k) =>
        out.push({ heading: k === 0 ? team.name : null, mine: k === 0 && mine, sub: s.heading ?? undefined, start: start + s.start, players: s.players }),
      )
    else out.push({ heading: team.name, mine, start, players })
    start += players.length
  }
  return out
}
