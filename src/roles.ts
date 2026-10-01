import { useEffect, useState } from 'react'
import { supabase } from './sync'

/*
 * Rôles du staff. Les droits sont vérifiés par le serveur (supabase/002_roles.sql) ;
 * ici on ne fait qu'adapter l'interface. Le rôle est gardé sur l'appareil pour
 * fonctionner hors ligne.
 */

// La valeur technique « preparateur » est conservée côté serveur ; seul le libellé affiché change.
export type Role = 'admin' | 'preparateur' | 'observateur'

export const ROLE_LABEL: Record<Role, string> = {
  admin: 'Administrateur',
  preparateur: 'Encadrant',
  observateur: 'Observateur',
}

export const ROLE_HELP: Record<Role, string> = {
  admin: 'Tout, y compris les critères, la suppression de joueurs et les rôles.',
  preparateur: 'Fiches joueurs, tests physiques, événements et ses propres avis.',
  observateur: 'Consulte tout, donne ses propres avis, crée des événements.',
}

const ROLE_KEY = 'handbase.role'
const UID_KEY = 'handbase.uid'

const read = (k: string) => {
  try {
    return localStorage.getItem(k)
  } catch {
    return null
  }
}
const write = (k: string, v: string | null) => {
  try {
    if (v === null) localStorage.removeItem(k)
    else localStorage.setItem(k, v)
  } catch {
    /* stockage indisponible */
  }
}

// Sans serveur (mode local), l'unique utilisateur a tous les droits.
let role: Role = supabase ? ((read(ROLE_KEY) as Role | null) ?? 'observateur') : 'admin'
let userId: string | null = read(UID_KEY)
const listeners = new Set<() => void>()

function set(r: Role, uid: string | null) {
  role = r
  userId = uid
  write(ROLE_KEY, r)
  write(UID_KEY, uid)
  listeners.forEach((l) => l())
}

export const currentUserId = () => userId

/** Recharge le rôle depuis le serveur (si connecté et en ligne). */
export async function refreshRole() {
  if (!supabase) return
  const { data: s } = await supabase.auth.getSession()
  const uid = s.session?.user.id ?? null
  if (!uid) return
  if (uid !== userId) set('observateur', uid) // autre compte : on repart du rôle minimal
  const { data, error } = await supabase.from('hb_profiles').select('role').eq('user_id', uid).maybeSingle()
  if (!error && data?.role) set(data.role as Role, uid)
}

export function clearRole() {
  set('observateur', null)
}

export function useRole(): Role {
  const [, force] = useState(0)
  useEffect(() => {
    const l = () => force((n) => n + 1)
    listeners.add(l)
    return () => {
      listeners.delete(l)
    }
  }, [])
  return role
}

/** Ce que chaque rôle peut faire (miroir des règles du serveur). */
export const can = {
  editPlayers: (r: Role) => r !== 'observateur',
  deletePlayers: (r: Role) => r === 'admin',
  editMeasurements: (r: Role) => r !== 'observateur',
  manageEvents: (r: Role) => r !== 'observateur',
  editCriteria: (r: Role) => r === 'admin',
  manageRoles: (r: Role) => r === 'admin',
  loadDemo: (r: Role) => r === 'admin',
}
