/*
 * Unité organisatrice d'un événement (« Organisé par : Comité du Var ») et visibilité qui en découle
 * (supabase/048_evenements_organisateur.sql).
 *
 * Décision (option A) : un événement est rattaché à UNE unité de la structure (hb_units), choisie à la création et remplie
 * d'office le plus souvent possible. Facultatif : les événements d'avant n'en ont pas (« Organisateur non précisé ») et
 * restent visibles par tout le staff.
 *
 * Territoire de l'organisateur = celui qu'aurait un compte affecté à cette unité (src/perimeter.ts, perimeterOf ; serveur :
 * hb_unit_territory, même règle que hb_scope_of) : ses départements (ceux de ses sous-unités et des clubs en dessous
 * compris), ou ses clubs si c'est une unité de club ; un pôle sans territoire prend celui de son parent (047).
 *
 * Un compte voit l'événement (serveur, règle de lecture de 048 ; appli, filtre « Mes territoires ») si : il voit tout
 * (administrateur, niveau Fédération) ; l'événement n'a pas d'organisateur (ou une unité inconnue) ; le territoire de
 * l'organisateur est ENTIÈREMENT dans son périmètre (la Ligue voit les événements de ses comités ; un comité ne voit pas
 * ceux de la Ligue) ; au moins un de SES joueurs y est inscrit (un club voit le stage du comité où sont deux de ses joueurs,
 * un comité le stage de Ligue de ses jeunes : en lecture seule, il n'y voit que ses joueurs) ; ou il en est créateur ou
 * participant.
 *
 * Fichier pur (ni Dexie ni React) : testé par tools/test-evenement-organisateur.ts.
 */
import { clubDepartment, inPerimeter, perimeterOf, type Perimeter } from './perimeter'
import { type AssignmentRow, type LevelRow, type UnitRow } from './structureTree'

export interface StructureInput {
  units: readonly UnitRow[]
  levels: readonly LevelRow[]
  assignments: readonly AssignmentRow[]
}

const live = <T extends { deleted?: boolean }>(rows: readonly T[]) => rows.filter((r) => !r.deleted)

/** Territoire d'une unité : { départements, clubs }. Unité de club : ses clubs, et leurs départements. */
export function unitTerritory(units: readonly UnitRow[], unitId: string): { depts: string[]; clubs: string[] } {
  const per = perimeterOf({ userId: '_', admin: false, units, levels: [], assignments: [{ id: '_', userId: '_', unitId, role: 'observateur' }] })
  const depts = new Set(per.depts)
  for (const c of per.clubs) {
    const d = clubDepartment(c)
    if (d) depts.add(d)
  }
  return { depts: [...depts].sort(), clubs: per.clubs }
}

/**
 * Unités triées de la plus proche du terrain à la plus haute : profondeur dans l'arbre (0 = unité de tête), puis ordre du
 * niveau (Fédération 1 … Club 5), puis nom. Profondeurs calculées une fois (structure importée : des milliers d'unités).
 */
export function lowestFirst<T extends UnitRow>(list: readonly T[], all: readonly UnitRow[], levels: readonly LevelRow[]): T[] {
  const byId = new Map(live(all).map((u) => [u.id, u]))
  const depths = new Map<string, number>()
  const depth = (id: string): number => {
    const known = depths.get(id)
    if (known !== undefined) return known
    // Chaîne des parents, arrêtée net sur une boucle ou un parent absent.
    const chain: string[] = []
    const seen = new Set<string>()
    let cur: string | undefined = id
    let base = 0
    while (cur && byId.has(cur) && !seen.has(cur)) {
      const k = depths.get(cur)
      if (k !== undefined) {
        base = k + 1
        break
      }
      seen.add(cur)
      chain.push(cur)
      cur = byId.get(cur)!.parentId
    }
    // chain[0] = id … chain[last] = la plus haute connue ; base = profondeur de son parent + 1 (ou 0).
    if (!chain.length) return 0
    if (!(cur && depths.has(cur))) base = 0
    for (let i = chain.length - 1; i >= 0; i--) depths.set(chain[i], base + (chain.length - 1 - i))
    return depths.get(id) ?? 0
  }
  const order = new Map(levels.filter((l) => !l.deleted).map((l) => [l.id, l.order]))
  return [...list].sort(
    (a, b) => depth(b.id) - depth(a.id) || (order.get(b.levelId) ?? 0) - (order.get(a.levelId) ?? 0) || a.name.localeCompare(b.name, 'fr'),
  )
}

/** Unités où le compte est affecté (non supprimées). */
export function myUnits(input: StructureInput, userId: string | null | undefined): UnitRow[] {
  if (!userId) return []
  const ids = new Set(live(input.assignments).filter((a) => a.userId === userId).map((a) => a.unitId))
  return live(input.units).filter((u) => ids.has(u.id))
}

/**
 * Unité proposée d'office à la création, quel que soit le chemin (formulaire, depuis un groupe, feuille de match) :
 *  - compte affecté à une seule unité : celle-ci ; à plusieurs : la plus proche du terrain ;
 *  - sinon (sans affectation, administrateur sans affectation) : rien (champ vide, facultatif).
 * Les clubs d'une feuille de match n'entrent PAS en compte : l'événement HandBase, c'est l'observation de notre staff (un
 * encadrant du Var qui suit un match de championnat de France entre un club de Gironde et un club du Rhône), pas le match
 * du club qui reçoit. Les équipes de la feuille restent une simple information.
 */
export function defaultOrganizer(input: StructureInput & { userId: string | null | undefined }): string | undefined {
  const mine = myUnits(input, input.userId)
  return lowestFirst(mine, live(input.units), input.levels)[0]?.id
}

/**
 * Unités proposées dans « Organisé par » :
 *  - administrateur : toutes (le champ se cherche) ;
 *  - sinon : ses unités seulement ;
 *  - toujours, en plus : l'unité déjà choisie (modification d'un événement organisé par une autre unité : elle reste
 *    affichée et peut être gardée).
 * Ordre : de la plus proche du terrain à la plus haute.
 */
export function organizerChoices(input: StructureInput & { userId: string | null | undefined; admin: boolean; current?: string }): UnitRow[] {
  const alive = live(input.units)
  if (input.admin) return lowestFirst(alive, alive, input.levels)
  const out = new Map(myUnits(input, input.userId).map((u) => [u.id, u]))
  const cur = input.current ? alive.find((u) => u.id === input.current) : undefined
  if (cur) out.set(cur.id, cur)
  return lowestFirst([...out.values()], alive, input.levels)
}

/** Nom de l'organisateur à afficher : l'unité telle qu'elle est aujourd'hui, à défaut la copie gardée sur l'événement. */
export function organizerLabel(ev: { organizerUnitId?: string; organizerName?: string }, units: readonly UnitRow[]): string | undefined {
  if (!ev.organizerUnitId) return undefined
  const u = units.find((x) => x.id === ev.organizerUnitId && !x.deleted)
  return u?.name ?? ev.organizerName ?? undefined
}

// ---------- Filtre « Mes territoires » (même règle que la lecture de 048) ----------

export type TerritoryFilter = 'tous' | 'mes'

/**
 * Valeur par défaut du filtre de la liste des événements. « Tous » TANT QUE 048 n'est pas passé sur la base réelle : avant
 * lui, le serveur envoie tous les événements, et basculer d'office sur « Mes territoires » ferait disparaître de la liste,
 * sans prévenir, des événements que chacun voyait jusque-là. Une fois 048 passé, le serveur ne renvoie plus que ceux du
 * périmètre : le filtre ne change presque plus rien et « Mes territoires » pourra devenir le défaut.
 */
export const DEFAULT_TERRITORY_FILTER: TerritoryFilter = 'tous'

/** Joueur tel que le filtre le lit (fiche présente sur l'appareil). */
export interface TerritoryPlayer {
  clubCode?: string
  license?: string
  department?: string
  deleted?: boolean
}

export interface TerritoryContext {
  per: Perimeter
  userId: string | null | undefined
  units: readonly UnitRow[]
  /** Le compte est-il participant de cet événement (editors ou staff choisi) ? (src/roles.ts, isParticipant) */
  participant: (ev: { editors?: string[]; teams?: string[] }) => boolean
  /** Fiche d'un joueur présente sur l'appareil (règle « un de mes joueurs y est inscrit ») ; absent : règle ignorée. */
  player?: (id: string) => TerritoryPlayer | undefined
}

type TerritoryEvent = { organizerUnitId?: string; createdBy?: string; editors?: string[]; teams?: string[]; playerIds?: string[] }

/** Le territoire de l'organisateur est-il entièrement dans le périmètre ? */
export function territoryCovered(t: { depts: string[]; clubs: string[] }, per: Perimeter): boolean {
  if (per.all) return true
  if (t.depts.length && t.depts.every((d) => per.depts.includes(d))) return true
  return t.clubs.length > 0 && t.clubs.every((c) => per.clubs.includes(c))
}

/**
 * Joueurs de l'événement qui sont dans mon périmètre (fiches présentes sur l'appareil, non supprimées) : même règle que
 * players_dept / players_club de 048 (département ou club du joueur ; une fiche créée par moi hors de mon périmètre ne
 * compte pas, le serveur ne la compte pas non plus).
 */
export function myPlayersIn(ev: { playerIds?: string[] }, ctx: Pick<TerritoryContext, 'per' | 'player'>): number {
  if (!ctx.player || !ev.playerIds?.length) return 0
  let n = 0
  for (const id of new Set(ev.playerIds)) {
    const p = ctx.player(id)
    if (p && !p.deleted && inPerimeter(ctx.per, p)) n++
  }
  return n
}

/** Visible sans compter les joueurs : tout, sans organisateur, organisateur couvert, créateur ou participant. */
function visibleByOrganizer(ev: TerritoryEvent, ctx: TerritoryContext, cache?: Map<string, { depts: string[]; clubs: string[] }>): boolean {
  if (ctx.per.all) return true
  if (!ev.organizerUnitId) return true
  // Unité supprimée ou inconnue de l'appareil : comme sans organisateur (le serveur fait de même).
  if (!ctx.units.some((u) => u.id === ev.organizerUnitId && !u.deleted)) return true
  if (ctx.userId && ev.createdBy === ctx.userId) return true
  if (ctx.participant(ev)) return true
  let t = cache?.get(ev.organizerUnitId)
  if (!t) {
    t = unitTerritory(ctx.units, ev.organizerUnitId)
    cache?.set(ev.organizerUnitId, t)
  }
  return territoryCovered(t, ctx.per)
}

/** L'événement est-il dans « Mes territoires » ? (Aussi : au moins un de mes joueurs y est inscrit.) */
export function inMyTerritories(ev: TerritoryEvent, ctx: TerritoryContext, cache?: Map<string, { depts: string[]; clubs: string[] }>): boolean {
  return visibleByOrganizer(ev, ctx, cache) || myPlayersIn(ev, ctx) > 0
}

/**
 * Événement vu SEULEMENT grâce à mes joueurs (organisateur hors de mes territoires, ni créateur ni participant) : le
 * nombre de mes joueurs inscrits, pour la mention « Tu vois cet événement parce que… » ; 0 sinon.
 */
export function seenThroughMyPlayers(ev: TerritoryEvent, ctx: TerritoryContext): number {
  if (visibleByOrganizer(ev, ctx)) return 0
  return myPlayersIn(ev, ctx)
}
