import { accord, genderOf, w } from './gender'

/*
 * Page Groupes : sélection de plusieurs groupes (« ⋯ » → « Sélectionner… », puis Archiver / Supprimer en une fois) et
 * recherche dans les groupes de travail. Partie pure (tools/test-groupes-selection.ts) ; l'écran : src/pages/Groups.tsx
 * (groupes de joueurs, barre du bas) et src/pages/Teams.tsx (groupes de travail).
 * Mêmes droits que le menu d'un groupe : un groupe de joueurs se coche si on peut le modifier (can.editGroup, créateur ou
 * administrateur selon sa visibilité), un groupe de travail si on l'a créé (can.editTeam). Les groupes Pôle restent hors
 * sélection : jamais archivés (le menu d'un groupe Pôle ne le propose pas) ni supprimés en lot.
 */

export type PickKind = 'joueurs' | 'travail'
export type BulkAction = 'archive' | 'unarchive' | 'delete'

/** Raison courte (bulle, ligne sous le nom) pour laquelle ce groupe de joueurs ne se coche pas ; null : il se coche. */
export function groupPickBlock(g: { poleUnitId?: string; private?: boolean; team?: boolean }, canEdit: boolean): string | null {
  if (g.poleUnitId) return 'Groupe Pôle : permanent, il se gère depuis sa page'
  if (!canEdit) return g.private || g.team ? 'Géré par son créateur' : 'Géré par son créateur ou un administrateur'
  return null
}

/** Même chose pour un groupe de travail : seul son créateur le supprime. */
export const workGroupPickBlock = (canEdit: boolean): string | null => (canEdit ? null : 'Géré par son créateur')

/**
 * Groupes cochés sur lesquels l'action porte : encore affichés (filtre de la barre) et toujours cochables, dans l'ordre de
 * la liste. Un groupe coché puis caché par le filtre reste coché : il revient quand le filtre s'efface.
 */
export function pickedOf<T extends { id: string }>(ids: readonly string[], shown: readonly T[], block: (t: T) => string | null): T[] {
  const set = new Set(ids)
  return shown.filter((t) => set.has(t.id) && !block(t))
}

/** « Archiver », ou « Désarchiver » quand tous les groupes cochés le sont déjà (cochés dans « Archivés »). */
export const archiveMode = (gs: readonly { archived?: boolean }[]): 'archive' | 'unarchive' => (gs.length > 0 && gs.every((g) => g.archived) ? 'unarchive' : 'archive')

const noun = (kind: PickKind, n: number) => (kind === 'travail' ? (n > 1 ? 'groupes de travail' : 'groupe de travail') : n > 1 ? 'groupes' : 'groupe')

/** « 3 groupes sélectionnés », « 1 groupe de travail sélectionné », « Aucun groupe sélectionné ». */
export function pickedLabel(kind: PickKind, n: number): string {
  if (!n) return `Aucun ${noun(kind, 1)} sélectionné`
  return `${n.toLocaleString('fr-FR')} ${noun(kind, n)} ${n > 1 ? 'sélectionnés' : 'sélectionné'}`
}

/**
 * Confirmation d'une action sur la sélection (fenêtre ask de src/components/Confirm.tsx) : le message et le libellé du
 * bouton. Un seul groupe : son nom. Suppression d'un groupe de joueurs : les joueurs (accordés au genre des groupes)
 * gardent leur fiche ; groupe de travail : même texte que sa suppression seule (STAFF.confirmDelete).
 */
export function bulkConfirm(kind: PickKind, action: BulkAction, groups: readonly { name: string; sex?: string }[]): { message: string; ok: string } {
  const n = groups.length
  const one = n === 1
  const what = one ? `le ${noun(kind, 1)} « ${groups[0].name} »` : `${n.toLocaleString('fr-FR')} ${noun(kind, n)}`
  if (action === 'archive')
    return { message: `Archiver ${what} ? ${one ? 'Il reste consultable' : 'Ils restent consultables'} dans « Archivés ».`, ok: 'Archiver' }
  if (action === 'unarchive') return { message: `Désarchiver ${what} ? ${one ? 'Il revient' : 'Ils reviennent'} dans la liste.`, ok: 'Désarchiver' }
  if (kind === 'travail')
    return {
      message: `Supprimer ${what} ? ${one ? 'Ses membres perdent l’accès qu’il leur donnait' : 'Leurs membres perdent l’accès qu’ils leur donnaient'} aux groupes et événements (les participants choisis un par un le gardent).`,
      ok: 'Supprimer',
    }
  const g = genderOf(groups)
  return {
    message: `Supprimer ${what} ? Les ${w(g).joueurs} ne sont pas ${accord('supprimé', g, 2)} : ${g === 'F' ? 'elles' : 'ils'} gardent leur fiche ; les avis et les événements ne sont pas touchés.`,
    ok: 'Supprimer',
  }
}

/** Sans accents ni majuscules. */
const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()

/**
 * Recherche dans les groupes de travail (barre « Demander » de l'onglet, sur l'appareil, sans appel) : chaque mot tapé
 * doit se trouver dans le nom, la description, le nom du créateur ou le nom d'un membre ; accents et majuscules ignorés.
 */
export function workGroupMatches(t: { name: string; description?: string; createdByName?: string; names?: Record<string, string> }, q: string): boolean {
  const words = fold(q).split(/\s+/).filter(Boolean)
  if (!words.length) return true
  const hay = fold([t.name, t.description ?? '', t.createdByName ?? '', ...Object.values(t.names ?? {})].join(' '))
  return words.every((x) => hay.includes(x))
}
