/*
 * Structure de l'installation (supabase/044_structure.sql) : niveaux (Fédération, Ligue, Comité, Pôle, Club…), arbre des
 * unités (une ligue, un comité, un pôle…) et affectations (un compte, une unité, un rôle ; plusieurs par personne).
 *
 * Fichier pur (ni Dexie ni React) : calculs de l'arbre, contrôle anti-cycle (le même que celui du serveur, hb_structure_ok),
 * pré-remplissage des comités. Les écrans : src/components/Structure.tsx.
 *
 * ÉTAPE 1 : la structure est saisie et synchronisée, mais elle NE CHANGE ENCORE RIEN à qui voit quoi. Le secteur d'un
 * encadrant reste la liste de départements de son profil (hb_profiles.departments, src/roles.ts myDepartments) ; plus
 * tard, ce secteur sera lu dans l'arbre : départements des unités où il est affecté et de leurs descendantes
 * (unitDepartments ci-dessous).
 */

/** Rôles d'une affectation : les mêmes valeurs que les rôles actuels (src/roles.ts). */
export type AssignmentRole = 'admin' | 'preparateur' | 'observateur'
export const ASSIGNMENT_ROLES: AssignmentRole[] = ['admin', 'preparateur', 'observateur']

export interface LevelFields {
  name: string
  order: number
}
export interface UnitFields {
  levelId: string
  name: string
  /** Unité parente (vide : unité de tête). Un pôle peut être rattaché directement à la ligue. */
  parentId?: string
  /** Territoire : numéros de départements (83, 2A…), facultatif. */
  departments?: string[]
  /** Clubs (noms ou numéros), facultatif. */
  clubs?: string[]
}
export interface AssignmentFields {
  userId: string
  unitId: string
  role: AssignmentRole
  /** Nom du compte (posé par le serveur), pour l'affichage hors ligne. */
  userName?: string
}

type Row = { id: string; deleted?: boolean }
export type LevelRow = Row & LevelFields
export type UnitRow = Row & UnitFields
export type AssignmentRow = Row & AssignmentFields

const live = <T extends Row>(rows: readonly T[]) => rows.filter((r) => !r.deleted)

/** Niveaux proposés pour le handball (les mêmes que ceux posés par supabase/044_structure.sql). */
export const HANDBALL_LEVELS: (LevelFields & { id: string })[] = [
  { id: 'niveau-federation', name: 'Fédération', order: 1 },
  { id: 'niveau-ligue', name: 'Ligue', order: 2 },
  { id: 'niveau-comite', name: 'Comité', order: 3 },
  { id: 'niveau-pole', name: 'Pôle', order: 4 },
  { id: 'niveau-club', name: 'Club', order: 5 },
]

export const sortLevels = <T extends LevelRow>(levels: readonly T[]) =>
  live(levels).sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, 'fr'))

/** Chaîne des parents d'une unité (du parent direct à la tête), arrêtée net sur un cycle ou un parent absent. */
export function ancestors(units: readonly UnitRow[], id: string): UnitRow[] {
  const byId = new Map(live(units).map((u) => [u.id, u]))
  const out: UnitRow[] = []
  const seen = new Set([id])
  let cur = byId.get(id)?.parentId
  while (cur && !seen.has(cur)) {
    const u = byId.get(cur)
    if (!u) break
    out.push(u)
    seen.add(cur)
    cur = u.parentId
  }
  return out
}

/** Toutes les unités sous une unité (enfants, petits-enfants…), sans elle-même. */
export function descendants(units: readonly UnitRow[], id: string): UnitRow[] {
  const all = live(units)
  const out: UnitRow[] = []
  const seen = new Set([id])
  const queue = [id]
  while (queue.length) {
    const p = queue.shift()!
    for (const u of all) {
      if (u.parentId === p && !seen.has(u.id)) {
        seen.add(u.id)
        out.push(u)
        queue.push(u.id)
      }
    }
  }
  return out
}

/**
 * Rattacher `id` sous `parentId` créerait-il un cycle ? (Parent = elle-même ou une de ses descendantes.)
 * Même règle que le serveur (hb_structure_ok) : on remonte depuis le futur parent ; si on retombe sur l'unité, refus.
 */
export function wouldCycle(units: readonly UnitRow[], id: string, parentId?: string | null): boolean {
  if (!parentId) return false
  if (parentId === id) return true
  const byId = new Map(live(units).map((u) => [u.id, u]))
  const seen = new Set<string>()
  let cur: string | undefined = parentId
  while (cur) {
    if (cur === id) return true
    if (seen.has(cur)) return true // cycle déjà présent (écritures concurrentes) : refus, par prudence
    seen.add(cur)
    cur = byId.get(cur)?.parentId
  }
  return false
}

/** Parents possibles pour une unité : toutes les autres sauf ses descendantes (aucun cycle possible). */
export function parentChoices(units: readonly UnitRow[], id?: string): UnitRow[] {
  const all = live(units)
  if (!id) return all
  const banned = new Set([id, ...descendants(all, id).map((u) => u.id)])
  return all.filter((u) => !banned.has(u.id))
}

/** Déplace une unité (nouveau parent, vide = tête). Erreur en clair si refusé. */
export function moveUnit<T extends UnitRow>(units: readonly T[], id: string, parentId?: string | null): T {
  const u = units.find((x) => x.id === id && !x.deleted)
  if (!u) throw new Error('Unité introuvable.')
  if (parentId && !units.some((x) => x.id === parentId && !x.deleted)) throw new Error('Unité parente introuvable.')
  if (wouldCycle(units, id, parentId)) throw new Error('Impossible : une unité ne peut pas être rangée sous elle-même ni sous une de ses sous-unités.')
  const { parentId: _old, ...rest } = u
  return (parentId ? { ...rest, parentId } : rest) as T
}

export interface TreeNode<T extends UnitRow = UnitRow> {
  unit: T
  depth: number
  children: TreeNode<T>[]
}

/**
 * Arbre des unités, trié par niveau puis par nom. Une unité dont le parent manque (supprimé, pas encore reçu) ou prise
 * dans un cycle est montrée en tête : rien n'est jamais caché.
 */
export function buildTree<T extends UnitRow>(units: readonly T[], levels: readonly LevelRow[] = []): TreeNode<T>[] {
  const all = live(units)
  const ids = new Set(all.map((u) => u.id))
  const rank = new Map(sortLevels(levels).map((l, i) => [l.id, i]))
  const cmp = (a: T, b: T) => (rank.get(a.levelId) ?? 99) - (rank.get(b.levelId) ?? 99) || a.name.localeCompare(b.name, 'fr')
  const isRoot = (u: T) => !u.parentId || !ids.has(u.parentId) || wouldCycle(all, u.id, u.parentId)
  const placed = new Set<string>()
  const node = (u: T, depth: number): TreeNode<T> => {
    placed.add(u.id)
    const children = all.filter((c) => c.parentId === u.id && !placed.has(c.id) && !isRoot(c)).sort(cmp)
    return { unit: u, depth, children: children.map((c) => node(c, depth + 1)) }
  }
  const roots = all.filter(isRoot).sort(cmp).map((u) => node(u, 0))
  // Restes (cycle entier sans entrée) : en tête aussi.
  for (const u of all.filter((x) => !placed.has(x.id)).sort(cmp)) roots.push(node(u, 0))
  return roots
}

/** L'arbre à plat (ordre d'affichage), avec la profondeur. */
export function flatten<T extends UnitRow>(tree: TreeNode<T>[]): { unit: T; depth: number }[] {
  const out: { unit: T; depth: number }[] = []
  const walk = (ns: TreeNode<T>[]) => ns.forEach((n) => (out.push({ unit: n.unit, depth: n.depth }), walk(n.children)))
  walk(tree)
  return out
}

/** Une unité peut-elle être supprimée ? Seulement vide : ni sous-unité ni affectation. Sinon, la raison. */
export function deleteBlocker(units: readonly UnitRow[], assignments: readonly AssignmentRow[], id: string): string | null {
  const kids = live(units).filter((u) => u.parentId === id).length
  const people = live(assignments).filter((a) => a.unitId === id).length
  if (!kids && !people) return null
  return [kids && `${kids} sous-unité${kids > 1 ? 's' : ''}`, people && `${people} affectation${people > 1 ? 's' : ''}`].filter(Boolean).join(' et ')
}

/** Un niveau peut-il être supprimé ? Seulement si aucune unité ne l'utilise. */
export const levelInUse = (units: readonly UnitRow[], levelId: string) => live(units).filter((u) => u.levelId === levelId).length

/** Affectations d'un compte (plusieurs possibles), et d'une unité. */
export const assignmentsOf = <T extends AssignmentRow>(assignments: readonly T[], userId: string) => live(assignments).filter((a) => a.userId === userId)
export const assignmentsIn = <T extends AssignmentRow>(assignments: readonly T[], unitId: string) => live(assignments).filter((a) => a.unitId === unitId)

/**
 * Départements couverts par une unité : les siens et ceux de ses descendantes. Préparé pour l'étape suivante (secteur lu
 * dans l'arbre) : PAS encore utilisé pour les droits.
 */
export function unitDepartments(units: readonly UnitRow[], id: string): string[] {
  const self = live(units).find((u) => u.id === id)
  const all = [self, ...descendants(units, id)].flatMap((u) => u?.departments ?? [])
  return [...new Set(all)].sort()
}

/**
 * « Pré-remplir les comités » : un comité par département où il y a des joueurs et qui n'a pas encore d'unité de ce niveau
 * couvrant ce département. Renvoie les unités à créer (sans identifiant), rangées sous la ligue de la région quand une
 * unité de ce nom existe (sinon, en tête).
 */
export function comitesToCreate(input: {
  playerDepartments: readonly (string | undefined)[]
  units: readonly UnitRow[]
  levelId: string
  deptName: (code: string) => string
  /** Unité parente proposée pour un département (ligue de sa région), ou rien. */
  parentFor?: (code: string) => string | undefined
}): UnitFields[] {
  const taken = new Set(live(input.units).filter((u) => u.levelId === input.levelId).flatMap((u) => u.departments ?? []))
  const codes = [...new Set(input.playerDepartments.filter((d): d is string => !!d))].filter((d) => !taken.has(d)).sort()
  return codes.map((code) => {
    const parentId = input.parentFor?.(code)
    return { levelId: input.levelId, name: input.deptName(code), departments: [code], ...(parentId ? { parentId } : {}) }
  })
}
