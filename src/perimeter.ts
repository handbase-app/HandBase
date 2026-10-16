/*
 * Périmètre d'un compte (supabase/046_perimetre.sql) : les joueurs qu'il reçoit du serveur, et ce qui leur est rattaché
 * (avis, mesures, « vu », « à revoir », vidéos d'un joueur). Le serveur filtre (règles de lecture) ; l'appli affiche le
 * périmètre (« Ton périmètre : Comité du Var (83) »), ouvre le bilan dessus et grise ce qui est en dehors.
 *
 * MÊME RÈGLE que le serveur (hb_scope_of) :
 *  - périmètre = chaque unité où le compte est affecté + toutes ses sous-unités ;
 *  - administrateur, ou affecté à une unité de niveau Fédération : tout ;
 *  - unité qui porte un n° de club (et ses sous-unités) : les joueurs de ce club (n° de club, à défaut début de la licence) ;
 *  - autre unité (ligue, comité, pôle…) : les départements de l'unité et de ses sous-unités, plus le département tiré du
 *    n° de chaque club en dessous (outre-mer : ligues 64 à 70 → 971, 973, 972, 988, 974, 976) ;
 *  - sans affectation : rien (hors administrateurs) ;
 *  - ses propres fiches (créées par lui) restent visibles.
 *
 * Fichier pur (ni Dexie ni React) : testé par tools/test-perimetre.ts. Aussi : le plan de la synchronisation quand le
 * périmètre change (src/sync.ts) : quelles tables relire depuis le début, quelles lignes oublier.
 */
import type { AssignmentRow, LevelRow, UnitRow } from './structureTree'

// ---------- Département et club d'un joueur ----------

/** Ligues ultramarines : un seul territoire, son n° de département (le n° de club donne « 01 » après la ligue). */
export const OUTRE_MER_LIGUE: Record<string, string> = { '64': '971', '65': '973', '66': '972', '67': '988', '69': '974', '70': '976' }

type DeptFields = { clubCode?: string; license?: string; department?: string }

/**
 * Département du club, lu dans le numéro FFHB : 63 = ligue, 83 = département…
 * (N° club 6383015, licence 6383015xxxxxx). Ligues ultramarines (64 à 70) : le territoire (6401xxx → 971).
 * Le n° de club est prioritaire : il est toujours renseigné. Joueur sans licence (fiche proposée) : département saisi à la main.
 * Même règle côté serveur : hb_player_dept (supabase/010_secteurs.sql, 045_departement_outre_mer.sql).
 */
export function playerDepartment(p: DeptFields): string | undefined {
  const code = /^\d{7}$/.test(p.clubCode ?? '') ? p.clubCode : /^\d{13}$/.test(p.license ?? '') ? p.license : undefined
  if (!code) return p.department?.trim() || undefined
  return OUTRE_MER_LIGUE[code.slice(0, 2)] ?? code.slice(2, 4)
}

/** Club d'un joueur : n° de club saisi, à défaut les 7 premiers chiffres de la licence (serveur : hb_player_club). */
export function playerClub(p: { clubCode?: string; license?: string }): string | undefined {
  const c = p.clubCode?.trim()
  if (c) return c
  return /^\d{13}$/.test(p.license ?? '') ? p.license!.slice(0, 7) : undefined
}

/** Département d'un n° de club (undefined si ce n'est pas un n° FFHB à 7 chiffres). */
export const clubDepartment = (n: string) => (/^\d{7}$/.test(n) ? playerDepartment({ clubCode: n }) : undefined)

// ---------- Périmètre ----------

/** Unité où le compte est affecté, pour l'affichage. */
export interface PerimeterUnit {
  id: string
  name: string
  /** Départements couverts par l'unité (vide pour un club). */
  depts: string[]
  /** N° du club (unité de club). */
  club?: string
}

export interface Perimeter {
  /** Tout (administrateur, ou niveau Fédération). */
  all: boolean
  /** Départements couverts. */
  depts: string[]
  /** Clubs couverts (n° de club). */
  clubs: string[]
  /** Unités d'affectation (sans leurs sous-unités), triées par nom. */
  units: PerimeterUnit[]
  /** Administrateur (tout, quelles que soient ses affectations). */
  admin: boolean
}

const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()

/** Niveau Fédération : l'identifiant posé par supabase/044, ou un nom qui commence par « Fédération ». */
export function isFederationLevel(levelId: string, levels: readonly LevelRow[]) {
  if (levelId === 'niveau-federation') return true
  const l = levels.find((x) => x.id === levelId && !x.deleted)
  return !!l && fold(l.name).startsWith('federation')
}

const clubOf = (u: UnitRow) => u.clubNumber?.trim() || undefined

/** Unité et toutes ses sous-unités (non supprimées), sans boucle même si l'arbre en avait une. */
function subtree(byParent: Map<string, UnitRow[]>, root: UnitRow): UnitRow[] {
  const out = [root]
  const seen = new Set([root.id])
  for (let i = 0; i < out.length; i++) {
    for (const c of byParent.get(out[i].id) ?? []) {
      if (seen.has(c.id)) continue
      seen.add(c.id)
      out.push(c)
    }
  }
  return out
}

export function perimeterOf(input: {
  userId: string | null | undefined
  admin: boolean
  units: readonly UnitRow[]
  levels: readonly LevelRow[]
  assignments: readonly AssignmentRow[]
}): Perimeter {
  const units = input.units.filter((u) => !u.deleted)
  const byId = new Map(units.map((u) => [u.id, u]))
  const byParent = new Map<string, UnitRow[]>()
  for (const u of units) if (u.parentId) byParent.set(u.parentId, [...(byParent.get(u.parentId) ?? []), u])
  const mine = [
    ...new Set(input.assignments.filter((a) => !a.deleted && !!input.userId && a.userId === input.userId).map((a) => a.unitId)),
  ]
    .map((id) => byId.get(id))
    .filter((u): u is UnitRow => !!u)
  const depts = new Set<string>()
  const clubs = new Set<string>()
  const shown: PerimeterUnit[] = []
  // Unité sans territoire (ni département ni club en dessous : un Pôle Espoirs) : celui de son parent le plus proche qui en a
  // un (le Pôle Aix → la Ligue Région Sud). Même règle que hb_scope_of (supabase/047_perimetre_poles.sql).
  const empty = (u: UnitRow) => subtree(byParent, u).every((x) => !clubOf(x) && !(x.departments ?? []).some(Boolean))
  const effective = (u: UnitRow) => {
    const seen = new Set([u.id])
    let cur = u
    while (empty(cur) && cur.parentId && !seen.has(cur.parentId) && byId.has(cur.parentId)) {
      seen.add(cur.parentId)
      cur = byId.get(cur.parentId)!
    }
    return cur
  }
  for (const assigned of mine) {
    const root = effective(assigned)
    const clubRoot = !!clubOf(root)
    const own = new Set<string>()
    for (const u of subtree(byParent, root)) {
      const n = clubOf(u)
      if (clubRoot) {
        if (n) clubs.add(n)
        continue
      }
      for (const d of u.departments ?? []) if (d) (depts.add(d), own.add(d))
      const d = n && clubDepartment(n)
      if (d) (depts.add(d), own.add(d))
    }
    shown.push({ id: assigned.id, name: assigned.name, depts: [...own].sort(), ...(clubRoot ? { club: clubOf(root) } : {}) })
  }
  const all = input.admin || mine.some((u) => isFederationLevel(u.levelId, input.levels))
  return {
    all,
    admin: input.admin,
    depts: [...depts].sort(),
    clubs: [...clubs].sort(),
    units: shown.sort((a, b) => a.name.localeCompare(b.name, 'fr')),
  }
}

/** Le compte a-t-il un périmètre (tout, ou au moins un département ou un club) ? */
export const hasPerimeter = (per: Perimeter) => per.all || per.depts.length > 0 || per.clubs.length > 0

/** Ce joueur est-il dans le périmètre (ou créé par ce compte) ? Même règle que les règles de lecture de 046. */
export function inPerimeter(per: Perimeter, p: DeptFields & { createdBy?: string }, userId?: string | null): boolean {
  if (per.all) return true
  if (userId && p.createdBy === userId) return true
  const d = playerDepartment(p)
  if (d && per.depts.includes(d)) return true
  const c = playerClub(p)
  return !!c && per.clubs.includes(c)
}

/** Départements où le compte voit des joueurs (ceux de ses clubs compris) : pour la carte du bilan. */
export function perimeterDepts(per: Perimeter): string[] {
  const out = new Set(per.depts)
  for (const c of per.clubs) {
    const d = clubDepartment(c)
    if (d) out.add(d)
  }
  return [...out].sort()
}

/** Le département est-il (au moins en partie) dans le périmètre ? Toujours vrai pour « tout ». */
export const deptInPerimeter = (per: Perimeter, dept: string) => per.all || perimeterDepts(per).includes(dept)

/**
 * Texte du périmètre : « Toute la base », « Comité du Var (83) », « Ligue Sud (04, 05, 06, 13, 83, 84) », « Club A (n° 6383001) » ;
 * plusieurs affectations séparées par « ; ». Sans affectation : null (à l'écran : un message dédié).
 */
export function perimeterText(per: Perimeter): string | null {
  if (per.all) return per.admin ? 'Toute la base (administrateur)' : 'Toute la base'
  if (!per.units.length) return null
  return per.units
    .map((u) => {
      if (u.club) return `${u.name} (n° ${u.club})`
      if (!u.depts.length) return u.name
      // Le nom porte déjà le seul département ? « Comité du Var (83) » : on ne le répète pas s'il y est déjà entre parenthèses.
      const list = u.depts.length > 8 ? `${u.depts.length} départements` : u.depts.join(', ')
      return u.name.includes(`(${list})`) ? u.name : `${u.name} (${list})`
    })
    .join(' ; ')
}

/**
 * Lieu où ouvrir le bilan de détection : un seul département → ce département ; plusieurs, tous dans une même région → la
 * région ; sinon (ou « tout ») : null (la France).
 */
export function perimeterPlace(per: Perimeter, regionOf: (dept: string) => string | undefined): { region: string; dept: string } | null {
  if (per.all) return null
  const depts = perimeterDepts(per)
  if (!depts.length) return null
  if (depts.length === 1) return { region: regionOf(depts[0]) ?? '', dept: depts[0] }
  const regions = new Set(depts.map(regionOf))
  if (regions.size === 1) {
    const [r] = regions
    return r ? { region: r, dept: '' } : null
  }
  return null
}

// ---------- Synchronisation : périmètre changé ----------

/** Périmètre tel que le serveur l'applique (hb_my_perimeter). */
export interface ServerScope {
  all: boolean
  depts: string[]
  clubs: string[]
}

/** Tables filtrées par le périmètre côté serveur (les suivis ne sont lus que par leur auteur : rien ne change pour eux). */
export const SCOPED_TABLES = ['players', 'measurements', 'evaluations', 'seen', 'rewatch', 'videos'] as const
export type ScopedTable = (typeof SCOPED_TABLES)[number]

/** Signature stable d'un périmètre (ordre des listes sans importance). */
export function scopeSignature(s: ServerScope): string {
  return JSON.stringify({ all: !!s.all, depts: [...(s.depts ?? [])].sort(), clubs: [...(s.clubs ?? [])].sort() })
}

/** Vérification complète (« quels joueurs ne vois-je plus ? ») au plus une fois par jour, hors changement de périmètre. */
export const FULL_FORGET_EVERY_MS = 24 * 60 * 60_000

export interface ScopePlan {
  /** Relire depuis le début les tables du périmètre : les lignes devenues visibles ont une ANCIENNE heure serveur. */
  resetCursors: boolean
  /** Retirer de l'appareil les joueurs que le serveur ne montre plus (et ce qui leur est rattaché). */
  forget: boolean
}

/**
 * Que faire après avoir lu le périmètre du serveur ?
 *  - première lecture sur cet appareil (prev absent) : l'appareil peut garder des joueurs reçus avant 046 (tout le monde
 *    voyait tout) → on oublie ce qui n'est plus visible ; rien à relire (on avait déjà tout) ;
 *  - périmètre changé : on relit tout (les nouveaux joueurs visibles ne sont pas « récents » pour le serveur) et on oublie
 *    ce qui n'est plus visible ;
 *  - inchangé : seulement la vérification du jour (un joueur qui a muté hors du périmètre : le serveur ne prévient pas) ;
 *  - « tout » : rien à oublier.
 */
export function planScopeChange(prev: string | null, next: ServerScope, lastFullForget: number, now: number): ScopePlan {
  const sig = scopeSignature(next)
  const changed = prev !== null && prev !== sig
  if (next.all) return { resetCursors: changed, forget: false }
  if (prev === null) return { resetCursors: false, forget: true }
  if (changed) return { resetCursors: true, forget: true }
  return { resetCursors: false, forget: now - lastFullForget >= FULL_FORGET_EVERY_MS }
}

/** Ligne rattachée à un joueur, telle que gardée sur l'appareil. */
export interface ChildRow {
  id: string
  playerId?: string
  targetKind?: string
  targetId?: string
  createdBy?: string
}

/** Joueur visé par une ligne rattachée (vidéo : seulement si elle vise un joueur). */
export const childPlayer = (table: Exclude<ScopedTable, 'players'>, r: ChildRow) =>
  table === 'videos' ? (r.targetKind === 'player' ? r.targetId : undefined) : r.playerId

/**
 * Lignes rattachées à oublier, une fois les joueurs invisibles retirés : celles dont le joueur n'est plus sur l'appareil,
 * sauf les siennes (le serveur les lui montre toujours) et celles qui attendent d'être envoyées.
 */
export function orphanIds(table: Exclude<ScopedTable, 'players'>, rows: readonly ChildRow[], players: ReadonlySet<string>, pending: ReadonlySet<string>, userId: string | null): string[] {
  return rows
    .filter((r) => {
      const pid = childPlayer(table, r)
      return !!pid && !players.has(pid) && !pending.has(r.id) && !(userId && r.createdBy === userId)
    })
    .map((r) => r.id)
}

/** Joueurs d'une liste (événement, groupe) absents de l'appareil : hors du périmètre (le nom n'est pas connu). */
export const hiddenCount = (ids: readonly string[], known: ReadonlySet<string>) => ids.filter((id) => !known.has(id)).length
