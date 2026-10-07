import { liveQuery } from 'dexie'
import { useLiveQuery } from 'dexie-react-hooks'
import { alive, db, type Team } from './db'
import { currentUserId, participants, setTeamCache, teamMembersOf, useRole } from './roles'

/*
 * Staffs (équipes d'encadrants enregistrées, supabase/034_equipes_encadrants.sql).
 * Les droits qui dépendent des participants d'un groupe ou d'un événement (roles.ts : seeGroup, contributeGroup,
 * contributeEvent…) comptent aussi les membres des staffs choisis : roles.ts garde pour cela les membres des staffs
 * présents sur l'appareil, tenus à jour ici.
 */

/** À appeler une fois au démarrage : suit la table des staffs pour les droits calculés par roles.ts. */
export function startTeamCache() {
  liveQuery(() => db.teams.toArray()).subscribe({ next: setTeamCache, error: (e) => console.error(e) })
}

/**
 * Relit les staffs et met roles.ts à jour : à appeler au début d'une requête useLiveQuery qui filtre avec
 * can.seeGroup / contributeGroup… pour qu'elle soit relancée quand un staff change (entrée ou sortie d'un membre).
 */
export async function loadTeams(): Promise<Team[]> {
  const teams = await db.teams.toArray()
  setTeamCache(teams)
  return alive(teams)
}

/** Ordre d'affichage : par nom. */
const byName = (a: Team, b: Team) => a.name.localeCompare(b.name, 'fr')

/** Mes staffs (créés par moi ou dont je suis membre), par nom ; undefined pendant la lecture. */
export function useTeams(): Team[] | undefined {
  useRole()
  return useLiveQuery(() => loadTeams().then((ts) => ts.sort(byName)))
}

/** Suis-je membre de ce staff ? */
export const isMember = (t: Team, uid = currentUserId()) => !!uid && t.members.includes(uid)

/** Résumé des participants d'un groupe ou d'un événement : staffs visibles (avec leurs membres), staffs invisibles, autres participants. */
export interface ParticipantSummary {
  teams: Team[]
  hidden: number
  /** Participants choisis un par un qui ne sont dans aucun staff affiché. */
  others: string[]
  /** Tous les participants effectifs (supabase/034 : hb_participants), parmi ce que voit l'appareil. */
  all: string[]
}

export function participantSummary(x: { editors?: string[]; teams?: string[] }, teams: Team[] = []): ParticipantSummary {
  const known = new Map(teams.map((t) => [t.id, t]))
  const shown = (x.teams ?? []).map((id) => known.get(id)).filter((t): t is Team => !!t && !t.deleted && !!teamMembersOf(t.id))
  const inTeams = new Set(shown.flatMap((t) => t.members))
  return {
    teams: shown.sort(byName),
    hidden: (x.teams ?? []).length - shown.length,
    others: (x.editors ?? []).filter((u) => !inTeams.has(u)),
    all: participants(x),
  }
}
