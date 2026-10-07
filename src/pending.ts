import { useEffect } from 'react'
import { department } from './components/PlayerFilter'
import { db } from './db'
import { sharedQuery, useShared } from './live'
import { can, currentUserId, myDepartments, useRole, type Role } from './roles'
import { loadTeams } from './teams'

// Compteur partagé (barre du bas et accueil) : un seul calcul pour toute l'appli.
let pendingFor: { role: Role; key: string } | null = null
const pendingStore = sharedQuery(
  ['evaluations', 'players', 'events', 'teams'],
  async () => {
    const role = pendingFor?.role
    if (!role || !can.review(role)) return 0
    // Staffs : leurs membres co-organisent les événements qui les citent (supabase/034).
    await loadTeams()
    const me = currentUserId()
    const avis = (await db.evaluations.where('review').equals('pending').toArray()).filter((e) => !e.deleted && !(me && e.observerId === me))
    const players = await db.players.bulkGet([...new Set(avis.map((e) => e.playerId))])
    const dept = new Map(players.filter((p) => !!p).map((p) => [p!.id, department(p!)]))
    const fiches = (await db.players.where('review').equals('pending').toArray()).filter((p) => !p.deleted && !(me && p.createdBy === me))
    const events = new Map((await db.events.bulkGet([...new Set(avis.map((e) => e.eventId).filter((id): id is string => !!id))])).filter((e) => !!e).map((e) => [e!.id, e!]))
    return avis.filter((e) => can.reviewAvis(role, dept.get(e.playerId), e.eventId ? events.get(e.eventId) : undefined)).length + fiches.filter((p) => can.reviewDept(role, department(p))).length
  },
  300,
)

/** Nombre de propositions (avis spontanés et fiches) qui attendent ma validation (0 pour un observateur). */
export function usePendingCount() {
  const role = useRole()
  const key = `${role}|${currentUserId()}|${myDepartments().join()}`
  useEffect(() => {
    if (pendingFor?.key === key) return
    pendingFor = { role, key }
    pendingStore.refresh()
  }, [role, key])
  return useShared(pendingStore) ?? 0
}
