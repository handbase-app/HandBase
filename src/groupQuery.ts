// Liste Groupes = ÉDITEUR DE RECETTE (même expérience que les listes Joueurs et Événements, moteur commun src/listQuery.ts).
// Recette « groupes » : visibilité (privé / mon staff / tout le staff), niveau (fédération, ligue, comité), garçons / filles
// / mixte, ligue, comité, année d'âge, créés par moi / où je suis participant / suivis, créés par…, nombre de joueurs ; tris
// (nom, joueurs, dernière modification) ; calculs sur la sélection (combien, par visibilité, par comité, par année…).
// Fonctions pures (tools/test-filtres-recette-pages.ts). Rien de ce qui part au modèle ne contient de données : noms de
// groupes, de lieux et de personnes sont recopiés tels que dits et retrouvés ICI.

import {
  asList,
  cleanNum,
  cleanStrings,
  numOk,
  numText,
  parseNumCond,
  parseSort,
  type ListCalc,
  type ListIncoming,
  type ListQuery,
  type ListSpec,
  type NumCond,
} from './listQuery'
import { asText, bestMatch, isTrue, matchDept, matchRegion, normalize, parseSex, quote, readName, type Places } from './voiceFilters'

/** Ce qu'il faut d'un groupe (src/db.ts PlayerGroup). */
export type QGroup = {
  id: string
  name: string
  description?: string
  playerIds: string[]
  private?: boolean
  team?: boolean
  sex?: 'M' | 'F' | 'mixte'
  department?: string
  regionId?: string
  scope?: 'federation' | 'ligue' | 'comite'
  years?: string[]
  createdBy?: string
  createdByName?: string
  editors?: string[]
  teams?: string[]
  updatedAt?: number
  archived?: boolean
}

export type GroupVis = 'private' | 'team' | 'staff'

export type GroupFilters = {
  vis?: GroupVis[]
  scope?: 'federation' | 'ligue' | 'comite'
  sex?: 'M' | 'F' | 'mixte'
  regions?: string[]
  depts?: string[]
  /** Années d'âge (au moins une en commun). */
  years?: string[]
  /** mine : créés par moi ou où je suis participant ; created ; participant. */
  who?: 'mine' | 'created' | 'participant'
  followed?: true
  creators?: string[]
  players?: NumCond
}

export type GroupsQuery = ListQuery<GroupFilters>

export type GroupCtx = {
  me?: string
  isParticipant: (g: QGroup) => boolean
  /** Groupes suivis (personnellement ou par le staff). */
  followed: Set<string>
  deptName: (code: string) => string
  regionName: (id: string) => string | undefined
  regionOf: (code: string) => string | undefined
}

export const VIS_LIST: { value: GroupVis; label: string }[] = [
  { value: 'private', label: 'Moi seul' },
  { value: 'team', label: 'Mon staff' },
  { value: 'staff', label: 'Tout le staff' },
]
export const SCOPE_LIST = [
  { value: 'federation' as const, label: 'Fédération' },
  { value: 'ligue' as const, label: 'Ligue' },
  { value: 'comite' as const, label: 'Comité' },
]
export const SEX_LIST = [
  { value: 'M' as const, label: 'Garçons' },
  { value: 'F' as const, label: 'Filles' },
  { value: 'mixte' as const, label: 'Mixte' },
]
const visOf = (g: QGroup): GroupVis => (g.private ? 'private' : g.team ? 'team' : 'staff')
const VIS_ALIASES: Record<GroupVis, string[]> = {
  private: ['prive', 'privés', 'moi seul', 'perso', 'personnel'],
  team: ['mon staff', 'mon_staff', 'equipe', 'staff restreint'],
  staff: ['tout le staff', 'tout_le_staff', 'public', 'partage', 'partagés', 'du staff'],
}
const SCOPE_ALIASES: Record<string, string[]> = { federation: ['FFHB', 'national', 'nationaux', 'France'], ligue: ['ligues', 'régional', 'régionaux'], comite: ['comités', 'départemental', 'départementaux'] }

/** Ligue d'un groupe : la sienne, sinon celle de son comité. */
const regionOfGroup = (g: QGroup, ctx: Pick<GroupCtx, 'regionOf'>) => g.regionId ?? (g.department ? ctx.regionOf(g.department) : undefined)

function cleanGroupFilters(v: unknown): GroupFilters {
  const o = v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
  const f: GroupFilters = {}
  const vis = cleanStrings(o.vis)?.filter((x): x is GroupVis => VIS_LIST.some((y) => y.value === x))
  if (vis?.length) f.vis = vis
  if (SCOPE_LIST.some((x) => x.value === o.scope)) f.scope = o.scope as GroupFilters['scope']
  if (o.sex === 'M' || o.sex === 'F' || o.sex === 'mixte') f.sex = o.sex
  const regions = cleanStrings(o.regions)
  if (regions) f.regions = regions
  const depts = cleanStrings(o.depts)?.filter((d) => /^[0-9AB]{2,3}$/i.test(d))
  if (depts?.length) f.depts = depts
  const years = cleanStrings(o.years)?.filter((y) => /^\d{4}$/.test(y))
  if (years?.length) f.years = years
  if (o.who === 'mine' || o.who === 'created' || o.who === 'participant') f.who = o.who
  if (o.followed === true) f.followed = true
  const creators = cleanStrings(o.creators)
  if (creators) f.creators = creators
  const players = cleanNum(o.players)
  if (players) f.players = players
  return f
}

const hasWords = (hay: string | undefined, q: string) => {
  const h = normalize(hay ?? '')
  return normalize(q)
    .split(' ')
    .filter(Boolean)
    .every((w) => h.includes(w))
}

export const GROUP_SORTS = [
  { value: 'name', label: 'Nom', dir: 'asc' as const, aliases: ['nom', 'alphabetique'] },
  { value: 'players', label: 'Nombre de joueurs', dir: 'desc' as const, aliases: ['joueurs', 'nombre de joueurs', 'nbjoueurs', 'taille'] },
  { value: 'updated', label: 'Dernière modification', dir: 'desc' as const, aliases: ['recent', 'recents', 'modification', 'date', 'mise a jour'] },
]

export const GROUP_GROUPINGS = [
  { value: 'vis', label: 'Par visibilité' },
  { value: 'scope', label: 'Par niveau' },
  { value: 'sex', label: 'Par garçons / filles' },
  { value: 'region', label: 'Par ligue' },
  { value: 'dept', label: 'Par comité' },
  { value: 'year', label: 'Par année d’âge' },
  { value: 'creator', label: 'Par créateur' },
] as const

export const groupsSpec: ListSpec<GroupFilters, QGroup, GroupCtx> = {
  id: 'groupes',
  keys: ['vis', 'scope', 'sex', 'regions', 'depts', 'years', 'who', 'followed', 'creators', 'players'],
  modelKey: {
    vis: 'visibilite',
    scope: 'niveau',
    sex: 'sexe',
    regions: 'ligues',
    depts: 'comites',
    years: 'annees',
    who: 'mes',
    followed: 'suivis',
    creators: 'createurs',
    players: 'joueurs',
    sort: 'tri',
    q: 'recherche',
  },
  keyLabel: {
    vis: 'visibilité',
    scope: 'niveau',
    sex: 'garçons / filles',
    regions: 'ligue',
    depts: 'comité',
    years: 'année d’âge',
    who: 'mes groupes',
    followed: 'suivis',
    creators: 'créateur',
    players: 'nombre de joueurs',
    sort: 'tri',
    q: 'recherche',
  },
  words: {
    visibilite: ['vis'], portee: ['vis', 'scope'], prive: ['vis'], prives: ['vis'], staff: ['vis'],
    niveau: ['scope'], federation: ['scope'],
    sexe: ['sex'], genre: ['sex'], garcons: ['sex'], filles: ['sex'], mixte: ['sex'], mixtes: ['sex'],
    ligue: ['regions'], ligues: ['regions'], region: ['regions'], regions: ['regions'], territoire: ['regions', 'depts'],
    comite: ['depts'], comites: ['depts'], departement: ['depts'], departements: ['depts'], dept: ['depts'],
    annee: ['years'], annees: ['years'], age: ['years'], generation: ['years'], anneedage: ['years'],
    mesgroupes: ['who'], miens: ['who'], groupes: ['who'], participant: ['who'], moi: ['who'],
    suivis: ['followed'], suivi: ['followed'],
    createur: ['creators'], createurs: ['creators'], auteur: ['creators'],
    joueurs: ['players'], nombredejoueurs: ['players'],
    tri: ['sort'], ordre: ['sort'], classement: ['sort'],
    nom: ['q'], noms: ['q'], recherche: ['q'], texte: ['q'],
  },
  clean: cleanGroupFilters,
  chip(k, f, ctx) {
    switch (k) {
      case 'vis':
        return f.vis!.map((v) => VIS_LIST.find((x) => x.value === v)!.label).join(' ou ')
      case 'scope':
        return SCOPE_LIST.find((x) => x.value === f.scope)!.label
      case 'sex':
        return f.sex === 'mixte' ? 'mixtes' : f.sex === 'F' ? 'filles' : 'garçons'
      case 'regions':
        return f.regions!.map((r) => ctx.regionName(r) ?? r).join(' ou ')
      case 'depts':
        return f.depts!.map(ctx.deptName).join(' ou ')
      case 'years':
        return `année ${f.years!.join(' ou ')}`
      case 'who':
        return f.who === 'created' ? 'créés par moi' : f.who === 'participant' ? 'où je suis participant' : 'mes groupes'
      case 'followed':
        return 'suivis'
      case 'creators':
        return `créés par ${f.creators!.join(' ou ')}`
      case 'players':
        return numText(f.players!, 'joueur')
    }
    return k
  },
  test(k, f, g, ctx) {
    switch (k) {
      case 'vis':
        return f.vis!.includes(visOf(g))
      case 'scope':
        return g.scope === f.scope
      case 'sex':
        return g.sex === f.sex
      case 'regions':
        return f.regions!.includes(regionOfGroup(g, ctx) ?? '')
      case 'depts':
        return !!g.department && f.depts!.includes(g.department)
      case 'years':
        return !!g.years?.some((y) => f.years!.includes(y))
      case 'who': {
        const mine = !!g.createdBy && g.createdBy === ctx.me
        return f.who === 'created' ? mine : f.who === 'participant' ? ctx.isParticipant(g) : mine || ctx.isParticipant(g)
      }
      case 'followed':
        return ctx.followed.has(g.id)
      case 'creators':
        return f.creators!.some((c) => hasWords(g.createdByName, c))
      case 'players':
        return numOk(f.players!, g.playerIds.length)
    }
    return true
  },
  // Comme la recherche d'avant : nom, description, créateur.
  hay: (g) => `${g.name} ${g.description ?? ''} ${g.createdByName ?? ''}`,
  sorts: [
    { ...GROUP_SORTS[0], get: (g) => g.name },
    { ...GROUP_SORTS[1], get: (g) => g.playerIds.length },
    { ...GROUP_SORTS[2], get: (g) => g.updatedAt },
  ],
  groupings: [
    { ...GROUP_GROUPINGS[0], keys: (g) => [visOf(g)], name: (k) => VIS_LIST.find((x) => x.value === k)?.label ?? k },
    { ...GROUP_GROUPINGS[1], keys: (g) => (g.scope ? [g.scope] : []), name: (k) => SCOPE_LIST.find((x) => x.value === k)?.label ?? k },
    { ...GROUP_GROUPINGS[2], keys: (g) => (g.sex ? [g.sex] : []), name: (k) => SEX_LIST.find((x) => x.value === k)?.label ?? k },
    { ...GROUP_GROUPINGS[3], keys: (g, ctx) => (regionOfGroup(g, ctx) ? [regionOfGroup(g, ctx)!] : []), name: (k, ctx) => ctx.regionName(k) ?? k },
    { ...GROUP_GROUPINGS[4], keys: (g) => (g.department ? [g.department] : []), name: (k, ctx) => ctx.deptName(k) },
    { ...GROUP_GROUPINGS[5], keys: (g) => g.years ?? [] },
    { ...GROUP_GROUPINGS[6], keys: (g) => (g.createdByName ? [g.createdByName] : []) },
  ],
  fix(f, added, regionOf) {
    // Fédération : pas de territoire ; ligue : pas de comité (comme le panneau) ; un comité d'ailleurs écarte la ligue.
    if (added.has('scope') && f.scope === 'federation') {
      delete f.regions
      delete f.depts
    }
    if (added.has('scope') && f.scope === 'ligue') delete f.depts
    if (added.has('depts') && f.regions && !added.has('regions') && !f.depts!.some((d) => f.regions!.includes(regionOf(d) ?? ''))) delete f.regions
    if (added.has('regions') && f.depts && !added.has('depts') && !f.depts.every((d) => f.regions!.includes(regionOf(d) ?? ''))) delete f.depts
    if ((added.has('regions') || added.has('depts')) && f.scope === 'federation' && !added.has('scope')) delete f.scope
  },
}

// ---------- Ce qui part au modèle ----------

/** Description de la recette « groupes » (clés et valeurs permises) : aucune donnée, aucun nom de groupe. */
export function buildGroupsSchema(today: string): Record<string, string> {
  return {
    aujourdhui: today,
    visibilite: 'liste : prive (moi seul) | mon_staff | tout_le_staff',
    niveau: 'federation | ligue | comite',
    sexe: 'M (garçons) | F (filles) | mixte',
    ligues: 'liste de ligues (régions) telles que dites',
    comites: 'liste de comités (départements : numéros ou noms) tels que dits',
    annees: 'liste d’années d’âge (années de naissance, entiers)',
    mes: 'les_miens (créés par moi ou où je suis participant) | crees (créés par moi) | participant',
    suivis: 'true : groupes que je suis',
    createurs: 'liste de noms de personnes (créateur du groupe) tels que dits',
    joueurs: '{op (>= | <= | =), n} nombre de joueurs',
    noms: 'liste de noms de groupes tels que dits (recherche dans le nom)',
    sortie:
      'objet : type (liste | nombre | tableau) ; liste : tri (nom | joueurs | recent), ordre (croissant | decroissant) ; tableau : par (visibilite | niveau | sexe | ligue | comite | annee | createur)',
  }
}

// ---------- Lecture de la réponse du modèle ----------

export type GroupsReadCtx = {
  today: string
  /** Noms des groupes et de leurs créateurs (retrouvés ici, jamais envoyés). */
  names: string[]
  creators: string[]
  geo: Places
}

const KNOWN = new Set(['visibilite', 'portee', 'niveau', 'sexe', 'ligues', 'ligue', 'regions', 'region', 'comites', 'comite', 'departements', 'departement', 'annees', 'annee', 'mes', 'suivis', 'createurs', 'createur', 'joueurs', 'noms', 'nom', 'recherche', 'sortie'])

/** Lit la recette rendue par le modèle pour la liste Groupes (chaque valeur revérifiée ici). */
export function readGroupsRecipe(raw: unknown, nonGere: string[], ctx: GroupsReadCtx): ListIncoming<GroupFilters> {
  const r = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
  const f: Partial<GroupFilters> = {}
  const notes: string[] = []
  const unsupported = nonGere.map((x) => x.slice(0, 80))
  const thisYear = Number(ctx.today.slice(0, 4))
  for (const k of Object.keys(r)) if (!KNOWN.has(k)) unsupported.push(`« ${k} »`)
  for (const v of asList(r.visibilite ?? r.portee)) {
    const s = asText(v)
    const m = bestMatch(s, VIS_LIST, (x) => [x.label, x.value, ...VIS_ALIASES[x.value]])
    if ('found' in m) f.vis = [...new Set([...(f.vis ?? []), m.found.value])]
    else notes.push(`visibilité ${quote(s)} (valeur inconnue)`)
  }
  if (r.niveau !== undefined) {
    const s = asText(r.niveau)
    const exact = SCOPE_LIST.find((x) => x.value === normalize(s))
    const m = exact ? { found: exact } : bestMatch(s, SCOPE_LIST, (x) => [x.label, x.value, ...(SCOPE_ALIASES[x.value] ?? [])])
    if ('found' in m) f.scope = m.found.value
    else notes.push(`niveau ${quote(s)} (valeur inconnue)`)
  }
  if (r.sexe !== undefined) {
    const s = normalize(asText(r.sexe))
    const v = s.startsWith('mixte') ? 'mixte' : parseSex(r.sexe)
    if (v) f.sex = v
    else notes.push(`garçons / filles ${quote(r.sexe)} (valeur inconnue)`)
  }
  for (const x of asList(r.ligues ?? r.ligue ?? r.regions ?? r.region)) {
    const m = matchRegion(x, ctx.geo)
    if ('found' in m) f.regions = [...new Set([...(f.regions ?? []), m.found.id])]
    else notes.push(`ligue ${quote(x)} (pas trouvée)`)
  }
  for (const d of asList(r.comites ?? r.comite ?? r.departements ?? r.departement)) {
    const m = matchDept(d, ctx.geo)
    if ('found' in m) f.depts = [...new Set([...(f.depts ?? []), m.found.code])]
    else notes.push(`comité ${quote(d)} (pas trouvé)`)
  }
  for (const y of asList(r.annees ?? r.annee)) {
    const s = asText(y)
    if (/^\d{4}$/.test(s) && Number(s) > 1950 && Number(s) <= thisYear) f.years = [...new Set([...(f.years ?? []), s])]
    else notes.push(`année ${quote(s)} (pas une année de naissance)`)
  }
  if (r.mes !== undefined && r.mes !== false) {
    const s = normalize(asText(r.mes))
    if (r.mes === true || /^(les miens|miens|mes|mine|tous|oui|true)$/.test(s)) f.who = 'mine'
    else if (/^(crees|createur|cree|crees par moi)$/.test(s)) f.who = 'created'
    else if (/^(participant|participe|participants)$/.test(s)) f.who = 'participant'
    else notes.push(`mes groupes ${quote(r.mes)} (valeur inconnue)`)
  }
  if (r.suivis !== undefined && isTrue(r.suivis)) f.followed = true
  for (const c of asList(r.createurs ?? r.createur)) {
    const s = asText(c)
    const m = bestMatch(s, [...new Set(ctx.creators.filter(Boolean))], (x) => [x])
    if ('found' in m) f.creators = [...new Set([...(f.creators ?? []), m.found])]
    else if ('ambiguous' in m) f.creators = [...new Set([...(f.creators ?? []), s])]
    else notes.push(`créateur ${quote(s)} (aucun groupe créé par cette personne)`)
  }
  if (r.joueurs !== undefined) {
    const c = parseNumCond(r.joueurs)
    if (c) f.players = c
    else notes.push(`nombre de joueurs ${quote(JSON.stringify(r.joueurs))} (illisible)`)
  }
  let q: string | undefined
  for (const n of asList(r.noms ?? r.nom ?? r.recherche)) {
    const m = readName(n, ctx.names)
    if ('q' in m) q = m.q
    else if (m.none) notes.push(`groupe ${quote(m.none)} (aucun groupe de ce nom)`)
  }
  let sort: GroupsQuery['sort']
  let calc: ListCalc | undefined
  const out = r.sortie && typeof r.sortie === 'object' && !Array.isArray(r.sortie) ? (r.sortie as Record<string, unknown>) : undefined
  if (out) {
    const type = normalize(asText(out.type))
    if (type === 'nombre' || type === 'compte') calc = { type: 'count' }
    else if (type === 'tableau') {
      const by = normalize(asText(out.par))
      const map: Record<string, string> = { visibilite: 'vis', portee: 'vis', niveau: 'scope', sexe: 'sex', ligue: 'region', region: 'region', comite: 'dept', departement: 'dept', annee: 'year', createur: 'creator' }
      if (map[by]) calc = { type: 'table', by: map[by] }
      else notes.push(`tableau par ${quote(out.par)} (regroupement inconnu)`)
    } else if (type === 'liste' || out.tri) {
      sort = parseSort(out, GROUP_SORTS)
      if (out.tri && !sort) notes.push(`tri ${quote(out.tri)} (inconnu)`)
    }
  }
  return { f, ...(q ? { q } : {}), ...(sort ? { sort } : {}), ...(calc ? { calc } : {}), notes, unsupported }
}

// ---------- Anciens filtres (avant la recette) ----------

/** Anciens filtres de la liste Groupes ({ q, scope, sex, dept, region, year }) en requête : mêmes groupes retenus. */
export function legacyGroupsToQuery(v: { q: string; scope: string; sex: string; dept: string; region: string; year: string }): GroupsQuery {
  const f: GroupFilters = {}
  if (v.scope) f.scope = v.scope as GroupFilters['scope']
  if (v.sex) f.sex = v.sex as GroupFilters['sex']
  if (v.region) f.regions = [v.region]
  if (v.dept) f.depts = [v.dept]
  if (v.year) f.years = [v.year]
  return { f, q: v.q }
}
