import { POLE_EXITS, type PoleExit, type PolePeriod, type PoleProgramme, type Player } from './db'
import { seasonOf } from './coverage'
import { isFederationLevel } from './perimeter'
import { POLE_SITES } from './poles'
import { ancestors, assignmentsOf, unitDepartments, type AssignmentRole, type AssignmentRow, type LevelRow, type UnitRow } from './structureTree'

/*
 * Groupe « Pôle » d'une unité de la structure et changement de saison : partie pure (ni Dexie ni React), testée par
 * tools/test-saison-pole.ts. Les écrans : src/pages/Groups.tsx (groupe Pôle), src/pages/PoleSeason.tsx (changement de
 * saison), src/components/PoleGroup.tsx (lectures, écritures, fenêtres).
 *
 * Modèle : un pôle Espoirs est une unité de niveau Pôle (src/structureTree.ts : poleSex, poleSite, poleLevels ; sa ligue
 * est son parent le plus proche de niveau Ligue). Un groupe peut être LE groupe « Pôle » de cette unité (PlayerGroup.poleUnitId,
 * src/db.ts) : permanent, un seul par unité, et ses membres ne sont pas dans playerIds : ils sont CALCULÉS depuis les fiches,
 * ce sont les joueurs qui ont une période de pôle (Player.poles) correspondant à l'unité et couvrant une date de référence.
 * Deux vues : « Saison en cours » (périodes couvrant aujourd'hui) et « Saison prochaine » (périodes couvrant le 1er septembre
 * de la saison suivante). On n'écrit jamais un « statut » : on écrit des dates. « Au pôle », « reconduit », « nouveau »,
 * « sorti » sont calculés. Une arrivée pas encore commencée s'annule en retirant sa période (cancelArrival).
 *
 * TODO (plus tard) : cas « pressenti » (dossier en attente, pas encore de période) — non traité ici.
 */

// ---------- Constantes à confirmer avec le CTF ----------

/** Jour de sortie des sortants, en fin de saison en cours : 30 juin (« MM-JJ »). */
export const POLE_EXIT_DAY = '06-30'
/** Jour d'entrée des nouveaux, au début de la saison prochaine : 1er juillet (« MM-JJ »). */
export const POLE_ENTRY_DAY = '07-01'
/** Au-delà, l'enregistrement d'un changement de saison demande confirmation (même seuil que la sélection multiple). */
export const SEASON_CONFIRM = 20

/**
 * Âge « scolaire » = année civile du début de la saison (1er septembre) − année de naissance. Classe habituelle de chaque
 * âge : 3e → 14, 2de → 15, 1re → 16, Tle → 17 (un jeune né en 2012 est en 3e pendant la saison 2026-2027). Règle simple,
 * modifiable ici seulement ; un redoublement ou une année d'avance n'est pas connu de l'appli : ce n'est qu'une proposition.
 */
export const PROGRAMME_AGES: Record<PoleProgramme, [min: number, max: number]> = {
  /** Accession territoriale : 3e-2de. */
  accession_territoriale: [14, 15],
  /** Accession nationale : 1re-Tle. */
  accession_nationale: [16, 17],
  /** Site d'excellence (filles) : 16-17 ans. */
  excellence: [16, 17],
  /** « Accession » sans précision (premières saisies, ligue qui ne distingue pas) : 3e-Tle. */
  accession: [14, 17],
}
/** Ordre des programmes du plus jeune au plus âgé (proposition quand plusieurs conviennent : le premier). */
const PROGRAMME_ORDER: PoleProgramme[] = ['accession_territoriale', 'accession_nationale', 'excellence', 'accession']

export const schoolAge = (birthYear: number, seasonStartYear: number) => seasonStartYear - birthYear

// ---------- Saisons et vues ----------

/** Vues du groupe Pôle (segment « Saison en cours | Saison prochaine », ?saison=prochaine dans l'adresse). */
export const POLE_VIEWS = ['courante', 'prochaine'] as const
export type PoleView = (typeof POLE_VIEWS)[number]
export const POLE_VIEW_DEFAULT: PoleView = 'courante'

export interface Seasons {
  /** Saison en cours (bornes 1er septembre → 31 août, libellé « 2026-2027 »). */
  current: ReturnType<typeof seasonOf>
  /** Saison prochaine. */
  next: ReturnType<typeof seasonOf>
  /** Date de référence de la vue « en cours » (aujourd'hui) et de la vue « prochaine » (1er septembre suivant). */
  refCurrent: string
  refNext: string
  /** Dates par défaut du changement de saison : sortie (30 juin) et entrée (1er juillet) de l'été entre les deux. */
  exit: string
  entry: string
}

/** Saisons et dates de référence vues depuis `today` (AAAA-MM-JJ). */
export function seasons(today: string): Seasons {
  const current = seasonOf(today)
  const y = Number(current.from.slice(0, 4)) + 1
  const next = seasonOf(`${y}-09-01`)
  return { current, next, refCurrent: today, refNext: next.from, exit: `${y}-${POLE_EXIT_DAY}`, entry: `${y}-${POLE_ENTRY_DAY}` }
}

/** Date de référence d'une vue. */
export const refDate = (view: PoleView, s: Seasons) => (view === 'prochaine' ? s.refNext : s.refCurrent)

/** Libellé d'une vue : « Saison en cours (2026-2027) ». */
export const viewLabel = (view: PoleView, s: Seasons) => (view === 'prochaine' ? `Saison prochaine (${s.next.label})` : `Saison en cours (${s.current.label})`)

// ---------- Unité Pôle ↔ période ----------

/** Identifiant du niveau « Pôle » des niveaux proposés pour le handball (src/structureTree.ts, HANDBALL_LEVELS). */
export const POLE_LEVEL_ID = 'niveau-pole'

const fold = (s = '') =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

/** Unité de niveau Pôle : le niveau proposé du handball, ou un niveau nommé « Pôle » (installation qui a refait ses niveaux). */
export function isPoleUnit(u: Pick<UnitRow, 'levelId'>, levels: readonly LevelRow[] = []): boolean {
  if (u.levelId === POLE_LEVEL_ID) return true
  const l = levels.find((x) => x.id === u.levelId && !x.deleted)
  return !!l && /^poles?( |$)/.test(fold(l.name))
}

/** Ce qu'il faut d'une unité Pôle pour reconnaître ses périodes et en écrire. */
export interface PoleRef {
  unitId: string
  /** Ligue qui porte le pôle (identifiant de région : « region-sud »), si on a su la retrouver. */
  regionId?: string
  /** Ville du site (poleSite ; à défaut le nom de l'unité). */
  site: string
  sex?: 'M' | 'F'
  levels: PoleProgramme[]
  name: string
  psqsRef?: string
}

/** Régions voisines d'un même site (Corse ↔ Région Sud, Mayotte ↔ Réunion… : src/poles.ts). */
const sameRegionFamily = (a: string, b: string, site: string) =>
  a === b || POLE_SITES.some((s) => fold(s.site) === fold(site) && s.regions.includes(a) && s.regions.includes(b))

/**
 * Ligue (identifiant de région) d'une unité : elle-même ou son parent le plus proche, reconnu par ses départements
 * (`regionOfDept`, découpage officiel ou liste des Réglages) ou par son nom (« Ligue Région Sud » ↔ « Région Sud ») ; on
 * s'arrête avant la Fédération (toutes les régions sous elle).
 */
export function unitRegionId(
  units: readonly UnitRow[],
  unitId: string,
  opts: { levels: readonly LevelRow[]; regionOfDept: (dept: string) => string | undefined; regions: readonly { id: string; name: string }[] },
): string | undefined {
  const self = units.find((u) => u.id === unitId && !u.deleted)
  if (!self) return undefined
  const chain = [self, ...ancestors(units, unitId)].filter((u) => !isFederationLevel(u.levelId, opts.levels))
  const byName = (name: string) => {
    const n = fold(name)
    return opts.regions.find((r) => {
      const rn = fold(r.name)
      return !!rn && (n === rn || n.endsWith(` ${rn}`) || n.includes(` ${rn} `))
    })?.id
  }
  for (const u of chain) {
    // Départements saisis sur l'unité et ses sous-unités : la région la plus représentée.
    const count = new Map<string, number>()
    for (const d of unitDepartments(units, u.id)) {
      const r = opts.regionOfDept(d)
      if (r) count.set(r, (count.get(r) ?? 0) + 1)
    }
    const best = [...count].sort((a, b) => b[1] - a[1])[0]?.[0]
    if (best) return best
    const named = byName(u.name)
    if (named) return named
  }
  return undefined
}

/** Référence d'une unité Pôle (null si l'unité n'est pas un pôle ou n'existe plus). */
export function poleRefOf(
  units: readonly UnitRow[],
  levels: readonly LevelRow[],
  unitId: string,
  opts: Omit<Parameters<typeof unitRegionId>[2], 'levels'>,
): PoleRef | null {
  const u = units.find((x) => x.id === unitId && !x.deleted)
  if (!u || !isPoleUnit(u, levels)) return null
  return {
    unitId: u.id,
    regionId: unitRegionId(units, u.id, { ...opts, levels }),
    site: u.poleSite || u.name,
    sex: u.poleSex,
    levels: u.poleLevels ?? [],
    name: u.name,
    psqsRef: u.psqsRef,
  }
}

const filled = (x: PolePeriod) => !!(x.from || x.to || x.name || x.regionId || x.site)
/** Période en cours à cette date (même règle que poleStatus, src/db.ts). */
export const isCurrentAt = (x: PolePeriod, day: string) => filled(x) && (!x.from || x.from <= day) && (!x.to || x.to >= day)

/**
 * La période est-elle celle de cette unité ? Même site (sans accents ni majuscules ; ancien champ libre `name` qui cite
 * le site : « Pôle Espoirs Saint-Raphaël ») et, quand les deux sont connues, même ligue (ou ligues voisines d'un même site).
 */
export function periodMatches(x: PolePeriod, ref: Pick<PoleRef, 'regionId' | 'site'>): boolean {
  const site = fold(ref.site)
  if (!site) return false
  const xs = fold(x.site)
  const named = !xs && !!x.name && (fold(x.name).includes(site) || (site.length >= 4 && fold(x.name).includes(site.split(' ')[0])))
  if (xs ? xs !== site : !named) return false
  if (ref.regionId && x.regionId && !sameRegionFamily(ref.regionId, x.regionId, ref.site)) return false
  return true
}

/** Joueur vu par les calculs de pôle : ses périodes et, s'il est connu, son sexe. */
type PolePlayer = Pick<Player, 'poles'> & { sex?: Player['sex'] }
/** Pôle reconnu par son site et sa ligue ; son sexe (poleSex), s'il est fixé, départage les pôles filles et garçons d'un même site. */
type PoleMatchRef = Pick<PoleRef, 'regionId' | 'site'> & { sex?: PoleRef['sex'] }

/** Un pôle filles ne compte pas un garçon, ni l'inverse (sexe du pôle ou du joueur inconnu : pas de tri). */
const sexMatches = (p: PolePlayer, ref: PoleMatchRef) => !ref.sex || !p.sex || p.sex === ref.sex

/** Indice de la période de ce pôle en cours à cette date (−1 : aucune). */
export function periodIndexAt(p: PolePlayer, ref: PoleMatchRef, day: string): number {
  if (!sexMatches(p, ref)) return -1
  return (p.poles ?? []).findIndex((x) => periodMatches(x, ref) && isCurrentAt(x, day))
}

/** Membre du pôle à cette date ? */
export const isMemberAt = (p: PolePlayer, ref: PoleMatchRef, day: string) => periodIndexAt(p, ref, day) >= 0

/** Membres calculés d'une unité à une date (ordre d'entrée conservé). */
export function membersAt<P extends PolePlayer>(players: readonly P[], ref: PoleMatchRef, day: string): P[] {
  return players.filter((p) => isMemberAt(p, ref, day))
}

/** Références de toutes les unités Pôle (identifiant de l'unité → référence ; les unités qui ne sont pas des pôles sont écartées). */
export function poleRefsOf(units: readonly UnitRow[], levels: readonly LevelRow[], opts: Omit<Parameters<typeof unitRegionId>[2], 'levels'>): Map<string, PoleRef> {
  const m = new Map<string, PoleRef>()
  for (const u of units) {
    const r = poleRefOf(units, levels, u.id, opts)
    if (r) m.set(u.id, r)
  }
  return m
}

/**
 * Groupes « matérialisés » pour la LECTURE (filtres, recettes, questions, suivis, pictogrammes…) : un groupe Pôle dont
 * l'unité est encore un pôle reçoit une COPIE dont `playerIds` = ses membres calculés à `day` (la vue « Saison en cours » :
 * s.refCurrent), dans l'ordre de `players` ; les autres groupes (et un groupe Pôle dont l'unité a disparu) sont rendus
 * tels quels. Ces copies ne s'enregistrent JAMAIS (les membres d'un groupe Pôle vivent dans les périodes des fiches) :
 * src/poleMembers.ts les lit pour les écrans, aucun de ceux-là n'écrit de groupe.
 */
export function materializePoleGroups<G extends { poleUnitId?: string; playerIds: string[] }>(
  groups: readonly G[],
  refs: ReadonlyMap<string, Pick<PoleRef, 'regionId' | 'site'>>,
  players: readonly Pick<Player, 'id' | 'poles'>[],
  day: string,
): G[] {
  return groups.map((g) => {
    const ref = g.poleUnitId ? refs.get(g.poleUnitId) : undefined
    return ref ? { ...g, playerIds: membersAt(players, ref, day).map((p) => p.id) } : g
  })
}

/** Période en cours à cette date dans un AUTRE pôle (« déjà au pôle de X ») ; undefined sinon. */
export function otherPoleAt(p: Pick<Player, 'poles'>, ref: Pick<PoleRef, 'regionId' | 'site'>, day: string): PolePeriod | undefined {
  return (p.poles ?? []).find((x) => isCurrentAt(x, day) && !periodMatches(x, ref))
}

// ---------- Propositions ----------

export const birthYearOf = (p: Pick<Player, 'birthDate'>) => (/^\d{4}/.test(p.birthDate ?? '') ? Number(p.birthDate!.slice(0, 4)) : undefined)

/**
 * « Fin de cursus probable » : la saison prochaine, l'année de naissance sort du programme de sa période (âge scolaire
 * au-delà du maximum). Programme inconnu : celui de l'unité s'il n'y en a qu'un, sinon « accession » (3e-Tle).
 * Jamais imposé : seulement une proposition. Date de naissance inconnue : pas de proposition.
 */
export function likelyEnd(p: Pick<Player, 'birthDate'>, period: Pick<PolePeriod, 'programme'>, levels: readonly PoleProgramme[], nextSeasonStartYear: number): boolean {
  const y = birthYearOf(p)
  if (y === undefined) return false
  const prog = period.programme ?? (levels.length === 1 ? levels[0] : 'accession')
  return schoolAge(y, nextSeasonStartYear) > PROGRAMME_AGES[prog][1]
}

/**
 * Programme déduit de l'âge (et du sexe : l'excellence n'est proposée qu'aux filles) parmi ceux de l'unité : le premier
 * dont la tranche contient l'âge scolaire de la saison visée ; aucun ne convient : undefined (à choisir à la main).
 */
export function suggestProgramme(levels: readonly PoleProgramme[], p: Pick<Player, 'birthDate' | 'sex'>, seasonStartYear: number): PoleProgramme | undefined {
  const y = birthYearOf(p)
  if (y === undefined) return levels.length === 1 ? levels[0] : undefined
  const age = schoolAge(y, seasonStartYear)
  return PROGRAMME_ORDER.filter((l) => levels.includes(l))
    .filter((l) => l !== 'excellence' || p.sex !== 'M')
    .find((l) => age >= PROGRAMME_AGES[l][0] && age <= PROGRAMME_AGES[l][1])
}

// ---------- Écritures (fonctions pures : renvoient le nouveau tableau de périodes) ----------

/** Ferme une période : sortie et motif. */
export function closePeriod(poles: readonly PolePeriod[], index: number, to: string, exitReason: PoleExit): PolePeriod[] {
  return poles.map((x, i) => (i === index ? { ...x, to, exitReason } : x))
}

/** « Rétablir » : efface la sortie (et son motif) d'une période. */
export function reopenPeriod(poles: readonly PolePeriod[], index: number): PolePeriod[] {
  return poles.map((x, i) => {
    if (i !== index) return x
    const { to: _to, exitReason: _why, ...rest } = x
    return rest
  })
}

/** Sortant : ferme sa période de ce pôle en cours à `day` (rien si elle n'existe pas). */
export function leavePole(p: Pick<Player, 'poles'>, ref: Pick<PoleRef, 'regionId' | 'site'>, day: string, to: string, exitReason: PoleExit): PolePeriod[] | null {
  const i = periodIndexAt(p, ref, day)
  return i < 0 ? null : closePeriod(p.poles ?? [], i, to, exitReason)
}

/**
 * Arrivée à venir dans ce pôle : indice de la période de ce pôle qui n'a pas encore commencé (`from` après `today`). Avec
 * `day` : celle qui couvre ce jour (la vue « Saison prochaine »), sinon la première à venir. −1 : aucune (une période déjà
 * commencée ne s'annule pas : elle se ferme, « Retirer du pôle… »).
 */
export function upcomingIndex(p: Pick<Player, 'poles'>, ref: Pick<PoleRef, 'regionId' | 'site'>, today: string, day?: string): number {
  return (p.poles ?? []).findIndex((x) => periodMatches(x, ref) && !!x.from && x.from > today && (!day || isCurrentAt(x, day)))
}

/**
 * « Annuler l'arrivée » : retire seulement la période à venir de ce pôle (upcomingIndex) ; les autres périodes restent
 * telles quelles (une période d'un autre pôle fermée par ce transfert n'est pas rouverte). null : rien à annuler.
 */
export function cancelArrival(p: Pick<Player, 'poles'>, ref: Pick<PoleRef, 'regionId' | 'site'>, today: string, day?: string): PolePeriod[] | null {
  const i = upcomingIndex(p, ref, today, day)
  return i < 0 ? null : (p.poles ?? []).filter((_, j) => j !== i)
}

export interface JoinResult {
  poles: PolePeriod[]
  /** Période fermée dans un autre pôle (transfert), s'il y en avait une. */
  transferredFrom?: PolePeriod
}

/**
 * Nouveau : ouvre une période de ce pôle (région et site de l'unité, programme donné) à partir de `entry`. Une période en
 * cours à `day` dans un AUTRE pôle est fermée à `exit` avec le motif « autre » (transfert). Déjà membre à `day` : rien.
 */
export function joinPole(
  p: Pick<Player, 'poles'>,
  ref: Pick<PoleRef, 'regionId' | 'site'>,
  o: { day: string; entry: string; exit: string; programme?: PoleProgramme },
): JoinResult | null {
  if (isMemberAt(p, ref, o.day)) return null
  let poles = [...(p.poles ?? [])]
  let transferredFrom: PolePeriod | undefined
  const other = poles.findIndex((x) => isCurrentAt(x, o.day) && !periodMatches(x, ref))
  if (other >= 0) {
    transferredFrom = poles[other]
    poles = closePeriod(poles, other, o.exit, 'autre')
  }
  const period: PolePeriod = { ...(ref.regionId && { regionId: ref.regionId }), site: ref.site, ...(o.programme && { programme: o.programme }), from: o.entry }
  return { poles: [...poles, period], transferredFrom }
}

// ---------- Lot du changement de saison ----------

export interface SeasonBatch {
  /** Membres de la vue courante reconduits : rien n'est écrit. */
  keep: string[]
  /** Sortants : motif choisi. */
  leave: { id: string; reason: PoleExit }[]
  /** Nouveaux : programme choisi (ou déduit). */
  add: { id: string; programme?: PoleProgramme }[]
}

export interface SeasonWrite {
  id: string
  poles: PolePeriod[]
  kind: 'sortant' | 'nouveau'
  transferredFrom?: PolePeriod
}

/**
 * Applique le lot aux fiches : sortants → sortie + motif sur leur période en cours ; nouveaux → nouvelle période (et
 * fermeture d'une période dans un autre pôle) ; reconduits → RIEN. Renvoie seulement les fiches qui changent.
 */
export function applySeason<P extends Pick<Player, 'id' | 'poles'>>(
  players: readonly P[],
  ref: Pick<PoleRef, 'regionId' | 'site'>,
  batch: SeasonBatch,
  dates: { day: string; exit: string; entry: string },
): SeasonWrite[] {
  const byId = new Map(players.map((p) => [p.id, p]))
  const out: SeasonWrite[] = []
  for (const l of batch.leave) {
    const p = byId.get(l.id)
    const poles = p && leavePole(p, ref, dates.day, dates.exit, l.reason)
    if (poles) out.push({ id: l.id, poles, kind: 'sortant' })
  }
  for (const a of batch.add) {
    const p = byId.get(a.id)
    // Un nouveau est « nouveau » pour la saison prochaine : déjà membre à l'entrée, rien à faire.
    const r = p && joinPole(p, ref, { day: dates.entry, entry: dates.entry, exit: dates.exit, programme: a.programme })
    if (r) out.push({ id: a.id, poles: r.poles, kind: 'nouveau', ...(r.transferredFrom && { transferredFrom: r.transferredFrom }) })
  }
  return out
}

/** « 12 reconduits · 4 nouveaux · 5 sortants (3 fin de cursus, 1 blessure, 1 autre) » ; accord au féminin pour un pôle de filles. */
export function seasonSummary(batch: SeasonBatch, fem = false, transfers = 0): string {
  const e = fem ? 'e' : ''
  const n = (k: number, m: string) => `${k} ${m}${k > 1 ? 's' : ''}`
  const k = batch.add.length
  const nouveaux = `${k} ${fem ? (k > 1 ? 'nouvelles' : 'nouvelle') : k > 1 ? 'nouveaux' : 'nouveau'}`
  const why = POLE_EXITS.map((x) => [x, batch.leave.filter((l) => l.reason === x.value).length] as const)
    .filter(([, k]) => k > 0)
    .map(([x, k]) => `${k} ${x.label.toLowerCase()}`)
  const parts = [
    n(batch.keep.length, `reconduit${e}`),
    `${nouveaux}${transfers ? ` (dont ${n(transfers, 'transfert')} depuis un autre pôle)` : ''}`,
    `${n(batch.leave.length, `sortant${e}`)}${why.length ? ` (${why.join(', ')})` : ''}`,
  ]
  return parts.join(' · ')
}

/** Nombre de fiches touchées par le lot (confirmation au-delà de SEASON_CONFIRM). */
export const batchSize = (b: SeasonBatch) => b.leave.length + b.add.length

// ---------- Statut de saison (export) ----------

export type SeasonStatus = 'reconduit' | 'nouveau' | 'sorti' | ''

/**
 * Statut d'un joueur en comparant les deux vues : dans les deux → reconduit ; prochaine seulement → nouveau ; en cours
 * seulement → sorti (avec son motif) ; aucune → vide.
 */
export function seasonStatus(p: Pick<Player, 'poles'>, ref: Pick<PoleRef, 'regionId' | 'site'>, s: Seasons): { status: SeasonStatus; reason?: PoleExit } {
  const cur = periodIndexAt(p, ref, s.refCurrent)
  const next = periodIndexAt(p, ref, s.refNext)
  if (cur >= 0 && next >= 0) return { status: 'reconduit' }
  if (next >= 0) return { status: 'nouveau' }
  if (cur >= 0) return { status: 'sorti', reason: p.poles![cur].exitReason }
  return { status: '' }
}

/** « Reconduit », « Nouvelle », « Sorti (fin de cursus) »… accordé au sexe du joueur. */
export function seasonStatusLabel(x: ReturnType<typeof seasonStatus>, sex?: string | null): string {
  const f = sex === 'F'
  switch (x.status) {
    case 'reconduit':
      return f ? 'Reconduite' : 'Reconduit'
    case 'nouveau':
      return f ? 'Nouvelle' : 'Nouveau'
    case 'sorti': {
      const why = POLE_EXITS.find((e) => e.value === x.reason)?.label.toLowerCase()
      return `${f ? 'Sortie' : 'Sorti'}${why ? ` (${why})` : ''}`
    }
    default:
      return ''
  }
}

// ---------- Droits ----------

/** Rôles d'affectation qui font un « dirigeant du pôle ». */
const LEADER_ROLES: AssignmentRole[] = ['preparateur', 'admin']

/**
 * Dirigeant de CETTE unité Pôle : compte affecté dessus avec le rôle encadrant ou administrateur. Les administrateurs de
 * l'appli (rôle « admin », src/roles.ts) le sont partout : voir can.editPoles.
 */
export function isPoleLeader(assignments: readonly AssignmentRow[], userId: string | null | undefined, unitId: string): boolean {
  if (!userId) return false
  return assignmentsOf(assignments, userId).some((a) => a.unitId === unitId && LEADER_ROLES.includes(a.role))
}

/** Unités Pôle que ce compte dirige (toutes pour un administrateur de l'appli), triées par nom. */
export function myPoleUnits<T extends UnitRow>(units: readonly T[], levels: readonly LevelRow[], assignments: readonly AssignmentRow[], userId: string | null | undefined, admin: boolean): T[] {
  return units
    .filter((u) => !u.deleted && isPoleUnit(u, levels) && (admin || isPoleLeader(assignments, userId, u.id)))
    .sort((a, b) => a.name.localeCompare(b.name, 'fr'))
}

/** Nom par défaut du groupe Pôle d'une unité : « Pôle Saint-Raphaël ». */
export const defaultPoleGroupName = (u: Pick<UnitRow, 'name' | 'poleSite'>) => `Pôle ${u.poleSite || u.name.replace(/^p[oô]le\s+/i, '')}`

// ---------- Contrôle avant export ----------

/** Fiches incomplètes pour la liste officielle : licence, date de naissance complète, sexe. */
export function exportGaps(p: Pick<Player, 'license' | 'birthDate' | 'sex'>): string[] {
  return [
    !p.license?.trim() && 'licence',
    !/^\d{4}-\d{2}-\d{2}/.test(p.birthDate ?? '') && 'date de naissance complète',
    !p.sex && 'sexe',
  ].filter((x): x is string => !!x)
}
