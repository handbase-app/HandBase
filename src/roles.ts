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
  preparateur: 'Fiches joueurs, tests physiques, événements (création et listes de joueurs), ses propres avis ; valide les avis spontanés et fiches proposées de son secteur.',
  observateur: 'Consulte tout et donne ses propres avis ; propose des fiches joueur. Ses avis spontanés et ses fiches sont soumis à validation.',
}

const ROLE_KEY = 'handbase.role'
const UID_KEY = 'handbase.uid'
const DEPTS_KEY = 'handbase.departments'

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
/** Départements de mon secteur (supabase/010_secteurs.sql) ; vide = tous. */
let departments: string[] = (() => {
  try {
    return JSON.parse(read(DEPTS_KEY) ?? '[]') as string[]
  } catch {
    return []
  }
})()
const listeners = new Set<() => void>()

function set(r: Role, uid: string | null, depts: string[] = []) {
  role = r
  userId = uid
  departments = depts
  write(ROLE_KEY, r)
  write(UID_KEY, uid)
  write(DEPTS_KEY, JSON.stringify(depts))
  listeners.forEach((l) => l())
}

export const currentUserId = () => userId
export const myDepartments = () => departments

/** Recharge le rôle depuis le serveur (si connecté et en ligne). */
export async function refreshRole() {
  if (!supabase) return
  const { data: s } = await supabase.auth.getSession()
  const uid = s.session?.user.id ?? null
  if (!uid) return
  if (uid !== userId) set('observateur', uid) // autre compte : on repart du rôle minimal
  const { data, error } = await supabase.from('hb_profiles').select('role, departments').eq('user_id', uid).maybeSingle()
  if (!error && data?.role) set(data.role as Role, uid, (data.departments as string[] | null) ?? [])
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

/** Visibilité d'un groupe : « Moi seul », « Équipe » (créateur et participants) ou « Tout le staff ». */
export type GroupVisibility = 'private' | 'team' | 'staff'
export const groupVisibility = (g: { private?: boolean; team?: boolean }): GroupVisibility => (g.private ? 'private' : g.team ? 'team' : 'staff')
/** Mention après le nom d'un groupe dans les menus déroulants (qui n'affichent que du texte) : « (privé) », « (équipe) ». */
export const groupTag = (g: { private?: boolean; team?: boolean }) => ({ private: ' (privé)', team: ' (équipe)', staff: '' })[groupVisibility(g)]

/** Ce que chaque rôle peut faire (miroir des règles du serveur). */
export const can = {
  editPlayers: (r: Role) => r !== 'observateur',
  /**
   * Modifier cette fiche : l'encadrant toutes, l'observateur la fiche qu'il a proposée, tant qu'elle n'est pas traitée
   * (le serveur exige createdBy = son compte : une fiche venue du serveur sans auteur ne lui est pas ouverte ;
   * seule sa propre proposition pas encore envoyée, sans signature du serveur, l'est).
   */
  editPlayer: (r: Role, p: { review?: string; createdBy?: string; createdAtServer?: string }) =>
    r !== 'observateur' || (p.review === 'pending' && (p.createdBy ? p.createdBy === userId : !p.createdAtServer)),
  deletePlayers: (r: Role) => r === 'admin',
  editMeasurements: (r: Role) => r !== 'observateur',
  manageEvents: (r: Role) => r !== 'observateur',
  /** Modifier / supprimer un événement : l'admin tous, l'encadrant les siens (ou ceux sans créateur connu, antérieurs au journal). */
  editEvent: (r: Role, ev: { createdBy?: string }) => r === 'admin' || (r === 'preparateur' && (!ev.createdBy || ev.createdBy === userId)),
  /** Créer des groupes : tout le monde (l'observateur seulement des groupes privés). */
  manageGroups: (_r: Role) => true,
  /** Groupes « Tout le staff » ou « Équipe » (et profils recherchés partagés) : pas l'observateur. */
  publicGroups: (r: Role) => r !== 'observateur',
  /**
   * Voir un groupe : le sien, ou un groupe du staff, ou un groupe d'équipe dont on est participant
   * (supabase/017_groupes_prives.sql, 031_groupes_equipe.sql). Sert aussi aux profils recherchés (sans « team »).
   */
  seeGroup: (g: { createdBy?: string; private?: boolean; team?: boolean; editors?: string[] }) =>
    !g.createdBy || g.createdBy === userId || (!g.private && (!g.team || (!!userId && !!g.editors?.includes(userId)))),
  /** Modifier / supprimer un groupe : privé ou d'équipe, son créateur seul ; du staff, l'admin tous et l'encadrant les siens. */
  editGroup: (r: Role, g: { createdBy?: string; private?: boolean; team?: boolean }) =>
    g.private || g.team ? !g.createdBy || g.createdBy === userId : r === 'admin' || (r === 'preparateur' && (!g.createdBy || g.createdBy === userId)),
  /** Participant d'un groupe du staff ou d'équipe (supabase/023, 031) : encadrant désigné par le créateur. */
  contributeGroup: (r: Role, g: { private?: boolean; editors?: string[] }) => r === 'preparateur' && !g.private && !!userId && !!g.editors?.includes(userId),
  /** Retirer ce joueur du groupe : créateur ou admin (tous), participant (seulement ceux qu'il a ajoutés). */
  removeFromGroup: (r: Role, g: { private?: boolean; editors?: string[]; createdBy?: string; addedBy?: Record<string, string> }, playerId: string) =>
    can.editGroup(r, g) || (can.contributeGroup(r, g) && (g.addedBy?.[playerId] ?? g.createdBy) === userId),
  /** Participant d'un événement (supabase/024_participants_evenements.sql) : co-organisateur pour la liste et les avis hors liste. */
  contributeEvent: (r: Role, ev: { editors?: string[] }) => r === 'preparateur' && !!userId && !!ev.editors?.includes(userId),
  /** Retirer ce joueur de la liste : organisateur ou admin (tous), participant (seulement ceux qu'il a ajoutés). */
  removeFromEvent: (r: Role, ev: { editors?: string[]; createdBy?: string; addedBy?: Record<string, string> }, playerId: string) =>
    can.editEvent(r, ev) || (can.contributeEvent(r, ev) && (ev.addedBy?.[playerId] ?? ev.createdBy) === userId),
  /** Valider ou mettre hors cadre les avis spontanés des observateurs (les siens sont validés d'office). */
  review: (r: Role) => r !== 'observateur',
  /**
   * Valider ce qui concerne un joueur de ce département : l'admin partout ; l'encadrant dans son secteur,
   * ou partout s'il n'a pas de département attribué. Joueur sans département : admin ou encadrant sans secteur.
   */
  reviewDept: (r: Role, dept?: string) =>
    r === 'admin' || (r === 'preparateur' && (departments.length === 0 || (!!dept && departments.includes(dept)))),
  /**
   * Décider d'un avis en attente : l'encadrant du secteur du joueur, ou, pour un avis hors liste sur un
   * événement, aussi l'organisateur de l'événement (supabase/021_avis_hors_liste.sql).
   */
  reviewAvis: (r: Role, dept: string | undefined, ev?: { createdBy?: string; editors?: string[] }) =>
    can.reviewDept(r, dept) || (!!ev && r === 'preparateur' && (!ev.createdBy || ev.createdBy === userId || !!ev.editors?.includes(userId ?? ''))),
  editCriteria: (r: Role) => r === 'admin',
  manageRoles: (r: Role) => r === 'admin',
  loadDemo: (r: Role) => r === 'admin',
  /** Vue nationale (carte des départements) : administrateurs. */
  nationalView: (r: Role) => r === 'admin',
  /** Sauvegarde complète de la base (JSON) : administrateurs seulement. */
  exportAll: (r: Role) => r === 'admin',
  /** Copie de toutes les données d'un joueur (demande d'accès RGPD d'une famille) : admin et encadrants. */
  exportPlayer: (r: Role) => r !== 'observateur',
}
