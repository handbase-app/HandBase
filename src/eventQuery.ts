// Liste Événements = ÉDITEUR DE RECETTE (même expérience que la liste Joueurs, moteur commun src/listQuery.ts).
// Recette « événements » : type, période (à venir, passés, ce mois, cette saison, une année, entre deux dates), lieu,
// département, région, « mes événements » (créés par moi ou où je suis participant), créés par…, avec feuille de match,
// avec vidéo, nombre de joueurs, nombre d'avis, avec joueurs « à revoir », génération des joueurs ; tris (date, joueurs,
// avis, nom) ; calculs sur la sélection (combien, par type, par mois, par année, par lieu…).
// Fonctions pures (tools/test-filtres-recette-pages.ts). Rien de ce qui part au modèle ne contient de données : le schéma
// décrit les clés ; noms d'événements, lieux et personnes sont recopiés tels que dits et retrouvés ICI.

import { seasonOf } from './coverage'
import { contiguous, parseSaidYears, spanYears, uniqYears } from './birthYears'
import {
  asList,
  cleanNum,
  cleanStrings,
  numOk,
  numText,
  parseNumCond,
  parseSort,
  type ListCalc,
  matchPerson,
  type ListIncoming,
  type NameConfirm,
  type ListQuery,
  type ListSpec,
  type NumCond,
} from './listQuery'
import { asText, bestMatch, isTrue, matchDept, matchRegion, normalize, quote, readName, type Places } from './voiceFilters'

/** Ce qu'il faut d'un événement (src/db.ts HBEvent). */
export type QEvent = {
  id: string
  name: string
  type: string
  date: string
  place?: string
  createdBy?: string
  createdByName?: string
  editors?: string[]
  teams?: string[]
  playerIds?: string[]
  archived?: boolean
  matchSheet?: unknown
}

/** Période : à venir, passés, ce mois (ou un mois), cette saison (ou une autre), une année, entre deux dates. */
export type EventPeriod =
  | { kind: 'upcoming' }
  | { kind: 'past' }
  | { kind: 'month'; ym?: string }
  | { kind: 'season'; start?: number }
  | { kind: 'year'; year: number }
  | { kind: 'between'; from: string; to: string }

export type EventFilters = {
  types?: string[]
  period?: EventPeriod
  /** Lieux (mots du lieu, tels que retrouvés parmi les lieux des événements). */
  places?: string[]
  depts?: string[]
  regions?: string[]
  /** mine : créés par moi ou où je suis participant ; created : créés par moi ; participant : où je suis participant. */
  who?: 'mine' | 'created' | 'participant'
  /** Créateurs (noms retrouvés parmi ceux des événements). */
  creators?: string[]
  sheet?: true
  video?: true
  players?: NumCond
  avis?: NumCond
  rewatch?: true
  /**
   * Générations des joueurs : une ou plusieurs années de naissance (triées ; src/birthYears.ts). Remplace `years`
   * ([première, dernière]) d'avant, encore lu dans la session.
   */
  gens?: number[]
}

export type EventsQuery = ListQuery<EventFilters>

/** Données de la page pour tester les filtres (rien ne part). */
export type EventCtx = {
  today: string
  me?: string
  isParticipant: (ev: QEvent) => boolean
  /** Avis de chaque événement : nombre, joueurs notés. */
  stats: Map<string, { avis: number; players: Set<string> }>
  /** Événements avec une vidéo. */
  videos: Set<string>
  /** Événements avec des joueurs « à revoir » (repérés ici ou visés). */
  rewatch: Set<string>
  /** Lieu et génération de chaque événement (lus seulement au besoin : src/pages/Events.tsx). */
  info?: Map<string, { depts: string[]; years: number[] }>
  deptName: (code: string) => string
  regionName: (id: string) => string | undefined
  regionOf: (code: string) => string | undefined
}

export const EVENT_TYPE_LIST: { value: string; label: string }[] = [
  { value: 'match', label: 'Match' },
  { value: 'tournoi', label: 'Tournoi' },
  { value: 'entrainement', label: 'Entraînement' },
  { value: 'observation', label: 'Observation' },
]
const TYPE_ALIASES: Record<string, string[]> = {
  match: ['matchs', 'rencontre', 'rencontres'],
  tournoi: ['tournois', 'plateau', 'plateaux'],
  entrainement: ['entrainements', 'stage', 'stages', 'seance', 'seances'],
  observation: ['observations', 'detection', 'detections', 'journee de selection', 'selection'],
}
const typeLabel = (t: string) => EVENT_TYPE_LIST.find((x) => x.value === t)?.label ?? t

const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre']
const fmtDay = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`
const monthText = (ym: string) => `${MONTHS[Number(ym.slice(5, 7)) - 1] ?? ym.slice(5, 7)} ${ym.slice(0, 4)}`
const DAY = /^\d{4}-\d{2}-\d{2}$/
const YM = /^\d{4}-\d{2}$/

/** Bornes d'une période (jours inclus). */
export function periodRange(p: EventPeriod, today: string): { from?: string; to?: string } {
  switch (p.kind) {
    case 'upcoming':
      return { from: today }
    case 'past':
      return { to: prevDay(today) }
    case 'month': {
      const ym = p.ym ?? today.slice(0, 7)
      return { from: `${ym}-01`, to: `${ym}-31` }
    }
    case 'season': {
      const s = p.start !== undefined ? { from: `${p.start}-09-01`, to: `${p.start + 1}-08-31` } : seasonOf(today)
      return { from: s.from, to: s.to }
    }
    case 'year':
      return { from: `${p.year}-01-01`, to: `${p.year}-12-31` }
    case 'between':
      return { from: p.from, to: p.to }
  }
}
function prevDay(d: string) {
  const t = new Date(d + 'T12:00:00Z')
  t.setUTCDate(t.getUTCDate() - 1)
  return t.toISOString().slice(0, 10)
}

export function periodText(p: EventPeriod, today: string): string {
  switch (p.kind) {
    case 'upcoming':
      return 'à venir'
    case 'past':
      return 'passés'
    case 'month':
      return p.ym && p.ym !== today.slice(0, 7) ? monthText(p.ym) : 'ce mois-ci'
    case 'season': {
      const cur = Number(seasonOf(today).from.slice(0, 4))
      const s = p.start ?? cur
      return s === cur ? `cette saison (${s}-${s + 1})` : `saison ${s}-${s + 1}`
    }
    case 'year':
      return `en ${p.year}`
    case 'between':
      return `du ${fmtDay(p.from)} au ${fmtDay(p.to)}`
  }
}

function cleanPeriod(v: unknown): EventPeriod | undefined {
  if (!v || typeof v !== 'object') return undefined
  const o = v as Record<string, unknown>
  if (o.kind === 'upcoming' || o.kind === 'past') return { kind: o.kind }
  if (o.kind === 'month') return typeof o.ym === 'string' && YM.test(o.ym) ? { kind: 'month', ym: o.ym } : { kind: 'month' }
  if (o.kind === 'season') return Number.isInteger(o.start) && (o.start as number) > 1990 && (o.start as number) < 2100 ? { kind: 'season', start: o.start as number } : { kind: 'season' }
  if (o.kind === 'year' && Number.isInteger(o.year) && (o.year as number) > 1990 && (o.year as number) < 2100) return { kind: 'year', year: o.year as number }
  if (o.kind === 'between' && typeof o.from === 'string' && typeof o.to === 'string' && DAY.test(o.from) && DAY.test(o.to))
    return o.from <= o.to ? { kind: 'between', from: o.from, to: o.to } : { kind: 'between', from: o.to, to: o.from }
  return undefined
}

function cleanEventFilters(v: unknown): EventFilters {
  const o = v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
  const f: EventFilters = {}
  const types = cleanStrings(o.types)?.filter((t) => EVENT_TYPE_LIST.some((x) => x.value === t))
  if (types?.length) f.types = types
  const period = cleanPeriod(o.period)
  if (period) f.period = period
  const places = cleanStrings(o.places)
  if (places) f.places = places
  const depts = cleanStrings(o.depts)?.filter((d) => /^[0-9AB]{2,3}$/i.test(d))
  if (depts?.length) f.depts = depts
  const regions = cleanStrings(o.regions)
  if (regions) f.regions = regions
  if (o.who === 'mine' || o.who === 'created' || o.who === 'participant') f.who = o.who
  const creators = cleanStrings(o.creators)
  if (creators) f.creators = creators
  if (o.sheet === true) f.sheet = true
  if (o.video === true) f.video = true
  const players = cleanNum(o.players)
  if (players) f.players = players
  const avis = cleanNum(o.avis)
  if (avis) f.avis = avis
  if (o.rewatch === true) f.rewatch = true
  const gens = Array.isArray(o.gens) ? uniqYears(o.gens, [1951, 2099]) : []
  if (gens.length) f.gens = gens
  else if (Array.isArray(o.years) && o.years.length === 2 && o.years.every((y) => Number.isInteger(y) && y > 1950 && y < 2100))
    f.gens = spanYears(o.years[0], o.years[1])
  return f
}

/** Joueurs d'un événement : sa liste et les joueurs notés (avis), comptés une fois. */
export function eventPlayerCount(ev: QEvent, ctx: Pick<EventCtx, 'stats'>): number {
  const s = ctx.stats.get(ev.id)
  if (!s?.players.size) return ev.playerIds?.length ?? 0
  const all = new Set(ev.playerIds ?? [])
  for (const p of s.players) all.add(p)
  return all.size
}

/**
 * Département(s) et génération(s) d'un événement : le département écrit dans le lieu (« Toulon (83) », « 83000 Toulon »),
 * sinon le plus fréquent parmi ses joueurs ; générations : les années de naissance d'au moins un quart de ses joueurs.
 */
export function eventInfo(place: string | undefined, players: { dept?: string; year?: number }[]): { depts: string[]; years: number[] } {
  const fromPlace = placeDept(place)
  const count = <K>(xs: (K | undefined)[]) => {
    const m = new Map<K, number>()
    for (const x of xs) if (x !== undefined) m.set(x, (m.get(x) ?? 0) + 1)
    return m
  }
  const d = count(players.map((p) => p.dept))
  const top = Math.max(0, ...d.values())
  const depts = fromPlace ? [fromPlace] : top ? [...d].filter(([, n]) => n === top).map(([k]) => k) : []
  const y = count(players.map((p) => p.year))
  const years = [...y].filter(([, n]) => n * 4 >= players.length && n > 0).map(([k]) => k).sort()
  return { depts, years }
}

/** Département lu dans un lieu : « (83) », code postal « 83000 », « 2A » ; undefined sinon. */
export function placeDept(place?: string): string | undefined {
  if (!place) return undefined
  const paren = /\((\d{2,3}|2[AB])\)/i.exec(place)
  if (paren) return paren[1].toUpperCase()
  const cp = /\b(\d{5})\b/.exec(place)
  if (cp) return cp[1].startsWith('97') ? cp[1].slice(0, 3) : cp[1].startsWith('20') ? undefined : cp[1].slice(0, 2)
  return undefined
}

const hasWords = (hay: string | undefined, q: string) => {
  const h = normalize(hay ?? '')
  return normalize(q)
    .split(' ')
    .filter(Boolean)
    .every((w) => h.includes(w))
}

export const EVENT_SORTS = [
  { value: 'date', label: 'Date', dir: 'desc' as const, aliases: ['date', 'recent', 'recents', 'chronologique'] },
  { value: 'players', label: 'Nombre de joueurs', dir: 'desc' as const, aliases: ['joueurs', 'nombre de joueurs', 'nbjoueurs'] },
  { value: 'avis', label: 'Nombre d’avis', dir: 'desc' as const, aliases: ['avis', 'nombre d avis', 'nbavis'] },
  { value: 'name', label: 'Nom', dir: 'asc' as const, aliases: ['nom', 'alphabetique', 'nom de l evenement'] },
]

export const EVENT_GROUPINGS = [
  { value: 'type', label: 'Par type' },
  { value: 'month', label: 'Par mois' },
  { value: 'year', label: 'Par année' },
  { value: 'season', label: 'Par saison' },
  { value: 'place', label: 'Par lieu' },
  { value: 'dept', label: 'Par département' },
  { value: 'region', label: 'Par région' },
  { value: 'creator', label: 'Par créateur' },
] as const

export const eventsSpec: ListSpec<EventFilters, QEvent, EventCtx> = {
  id: 'evenements',
  keys: ['types', 'period', 'places', 'depts', 'regions', 'who', 'creators', 'sheet', 'video', 'players', 'avis', 'rewatch', 'gens'],
  modelKey: {
    types: 'types',
    period: 'periode',
    places: 'lieux',
    depts: 'departements',
    regions: 'regions',
    who: 'mes',
    creators: 'createurs',
    sheet: 'feuilleDeMatch',
    video: 'video',
    players: 'joueurs',
    avis: 'avis',
    rewatch: 'aRevoir',
    gens: 'generation',
    sort: 'tri',
    q: 'recherche',
  },
  keyLabel: {
    types: 'type',
    period: 'date',
    places: 'lieu',
    depts: 'département',
    regions: 'région',
    who: 'mes événements',
    creators: 'créateur',
    sheet: 'feuille de match',
    video: 'vidéo',
    players: 'nombre de joueurs',
    avis: 'nombre d’avis',
    rewatch: 'à revoir',
    gens: 'génération',
    sort: 'tri',
    q: 'recherche',
  },
  words: {
    type: ['types'], types: ['types'], genre: ['types'], match: ['types'], matchs: ['types'], tournoi: ['types'], tournois: ['types'],
    entrainement: ['types'], entrainements: ['types'], stage: ['types'], stages: ['types'], observation: ['types'], observations: ['types'],
    date: ['period'], dates: ['period'], periode: ['period'], annee: ['period'], mois: ['period'], saison: ['period'], quand: ['period'], avenir: ['period'], passes: ['period'],
    lieu: ['places'], lieux: ['places'], ville: ['places'], salle: ['places'], endroit: ['places'],
    departement: ['depts'], departements: ['depts'], dept: ['depts'], comite: ['depts'],
    region: ['regions'], regions: ['regions'], ligue: ['regions'],
    mesevenements: ['who'], miens: ['who'], evenements: ['who'], participant: ['who'], participants: ['who'], moi: ['who'],
    createur: ['creators'], createurs: ['creators'], auteur: ['creators'],
    feuille: ['sheet'], feuilledematch: ['sheet'], feuilles: ['sheet'],
    video: ['video'], videos: ['video'],
    joueurs: ['players'], nombredejoueurs: ['players'], convoques: ['players'],
    avis: ['avis'], nombredavis: ['avis'], notes: ['avis'],
    arevoir: ['rewatch'], revoir: ['rewatch'],
    generation: ['gens'], generations: ['gens'], naissance: ['gens'],
    tri: ['sort'], ordre: ['sort'], classement: ['sort'],
    nom: ['q'], noms: ['q'], recherche: ['q'], texte: ['q'],
  },
  clean: cleanEventFilters,
  chip(k, f, ctx) {
    switch (k) {
      case 'types':
        return f.types!.map(typeLabel).join(' ou ')
      case 'period':
        return periodText(f.period!, ctx.today)
      case 'places':
        return `lieu : ${f.places!.join(' ou ')}`
      case 'depts':
        return f.depts!.map(ctx.deptName).join(' ou ')
      case 'regions':
        return f.regions!.map((r) => ctx.regionName(r) ?? r).join(' ou ')
      case 'who':
        return f.who === 'created' ? 'créés par moi' : f.who === 'participant' ? 'où je suis participant' : 'mes événements'
      case 'creators':
        return `créés par ${f.creators!.join(' ou ')}`
      case 'sheet':
        return 'avec feuille de match'
      case 'video':
        return 'avec vidéo'
      case 'players':
        return numText(f.players!, 'joueur')
      case 'avis':
        return numText(f.avis!, 'avis', 'avis')
      case 'rewatch':
        return 'avec joueurs à revoir'
      case 'gens': {
        const ys = f.gens!
        if (ys.length === 1) return `génération ${ys[0]}`
        if (contiguous(ys)) return `générations ${ys[0]} à ${ys[ys.length - 1]}`
        return ys.length > 4 ? `${ys.length} générations, de ${ys[0]} à ${ys[ys.length - 1]}` : `générations ${ys.slice(0, -1).join(', ')} et ${ys[ys.length - 1]}`
      }
    }
    return k
  },
  test(k, f, ev, ctx) {
    switch (k) {
      case 'types':
        return f.types!.includes(ev.type)
      case 'period': {
        const r = periodRange(f.period!, ctx.today)
        return (!r.from || ev.date >= r.from) && (!r.to || ev.date <= r.to)
      }
      case 'places':
        return f.places!.some((p) => hasWords(ev.place, p))
      case 'depts': {
        const d = ctx.info?.get(ev.id)?.depts ?? (placeDept(ev.place) ? [placeDept(ev.place)!] : [])
        return d.some((x) => f.depts!.includes(x))
      }
      case 'regions': {
        const d = ctx.info?.get(ev.id)?.depts ?? (placeDept(ev.place) ? [placeDept(ev.place)!] : [])
        return d.some((x) => f.regions!.includes(ctx.regionOf(x) ?? ''))
      }
      case 'who': {
        const mine = !!ev.createdBy && ev.createdBy === ctx.me
        return f.who === 'created' ? mine : f.who === 'participant' ? ctx.isParticipant(ev) : mine || ctx.isParticipant(ev)
      }
      case 'creators':
        return f.creators!.some((c) => hasWords(ev.createdByName, c))
      case 'sheet':
        return !!ev.matchSheet
      case 'video':
        return ctx.videos.has(ev.id)
      case 'players':
        return numOk(f.players!, eventPlayerCount(ev, ctx))
      case 'avis':
        return numOk(f.avis!, ctx.stats.get(ev.id)?.avis ?? 0)
      case 'rewatch':
        return ctx.rewatch.has(ev.id)
      case 'gens': {
        const ys = ctx.info?.get(ev.id)?.years ?? []
        return ys.some((y) => f.gens!.includes(y))
      }
    }
    return true
  },
  // Comme la recherche d'avant : nom, lieu, créateur.
  hay: (ev) => `${ev.name} ${ev.place ?? ''} ${ev.createdByName ?? ''}`,
  sorts: [
    { ...EVENT_SORTS[0], get: (ev) => ev.date },
    { ...EVENT_SORTS[1], get: (ev, ctx) => eventPlayerCount(ev, ctx) },
    { ...EVENT_SORTS[2], get: (ev, ctx) => ctx.stats.get(ev.id)?.avis ?? 0 },
    { ...EVENT_SORTS[3], get: (ev) => ev.name },
  ],
  groupings: [
    { ...EVENT_GROUPINGS[0], keys: (ev) => [ev.type], name: (k) => typeLabel(k) },
    { ...EVENT_GROUPINGS[1], keys: (ev) => [ev.date.slice(0, 7)], name: (k) => monthText(k) },
    { ...EVENT_GROUPINGS[2], keys: (ev) => [ev.date.slice(0, 4)] },
    { ...EVENT_GROUPINGS[3], keys: (ev) => [seasonOf(ev.date).label], name: (k) => `saison ${k}` },
    { ...EVENT_GROUPINGS[4], keys: (ev) => (ev.place?.trim() ? [ev.place.trim()] : []) },
    { ...EVENT_GROUPINGS[5], keys: (ev, ctx) => ctx.info?.get(ev.id)?.depts ?? [], name: (k, ctx) => ctx.deptName(k) },
    { ...EVENT_GROUPINGS[6], keys: (ev, ctx) => (ctx.info?.get(ev.id)?.depts ?? []).map((d) => ctx.regionOf(d) ?? '').filter(Boolean), name: (k, ctx) => ctx.regionName(k) ?? k },
    { ...EVENT_GROUPINGS[7], keys: (ev) => (ev.createdByName ? [ev.createdByName] : []) },
  ],
  fix(f, added, regionOf) {
    // Un département dit écarte une région d'ailleurs, et inversement (comme la liste Joueurs).
    if (added.has('depts') && f.regions && !added.has('regions') && !f.depts!.some((d) => f.regions!.includes(regionOf(d) ?? ''))) delete f.regions
    if (added.has('regions') && f.depts && !added.has('depts') && !f.depts.every((d) => f.regions!.includes(regionOf(d) ?? ''))) delete f.depts
  },
}

/** Le tri, le lieu ou la génération demandent les joueurs des événements (lus seulement alors). */
export function eventsNeedInfo(qy: EventsQuery): boolean {
  return !!(qy.f.depts || qy.f.regions || qy.f.gens || (qy.calc?.type === 'table' && ['dept', 'region'].includes(qy.calc.by)))
}

// ---------- Ce qui part au modèle ----------

/** Description de la recette « événements » (clés et valeurs permises) : aucune donnée, aucun nom. */
export function buildEventsSchema(today: string): Record<string, string> {
  const s = seasonOf(today)
  return {
    aujourdhui: `${today} (saison ${s.label} : du 1er septembre au 31 août)`,
    types: EVENT_TYPE_LIST.map((t) => `${t.value} (${t.label.toLowerCase()})`).join(', ') + ' : liste',
    periode:
      'a_venir | passes | ce_mois | cette_saison | saison_derniere | {"annee": entier} | {"mois": "AAAA-MM"} | {"saison": année de début} | {"du": "AAAA-MM-JJ", "au": "AAAA-MM-JJ"}',
    lieux: 'liste de lieux (ville, salle) tels que dits',
    departements: 'liste de départements (numéros ou noms) tels que dits',
    regions: 'liste de régions (ligues) telles que dites',
    mes: 'les_miens (créés par moi ou où je suis participant) | crees (créés par moi) | participant (où je suis participant)',
    createurs: 'liste de noms de personnes (créateur de l’événement) tels que dits',
    feuilleDeMatch: 'true : avec une feuille de match importée',
    video: 'true : avec une vidéo',
    joueurs: '{op (>= | <= | =), n} nombre de joueurs',
    avis: '{op (>= | <= | =), n} nombre d’avis',
    aRevoir: 'true : avec des joueurs « à revoir »',
    generation: 'année de naissance des joueurs : entier, liste d’entiers (plusieurs générations : [2010, 2012]) ou {de, a} (plage)',
    noms: 'liste de noms d’événements tels que dits (recherche dans le nom)',
    sortie:
      'objet : type (liste | nombre | tableau) ; liste : tri (date | joueurs | avis | nom), ordre (croissant | decroissant) ; tableau : par (type | mois | annee | saison | lieu | departement | region | createur)',
  }
}

// ---------- Lecture de la réponse du modèle ----------

export type EventsReadCtx = {
  today: string
  /** Noms, lieux et créateurs des événements de l'appareil (retrouvés ici, jamais envoyés). */
  names: string[]
  places: string[]
  creators: string[]
  geo: Places
}

const KNOWN = new Set(['types', 'type', 'periode', 'lieux', 'lieu', 'departements', 'departement', 'regions', 'region', 'mes', 'createurs', 'createur', 'feuilleDeMatch', 'video', 'joueurs', 'avis', 'aRevoir', 'generation', 'noms', 'nom', 'recherche', 'sortie'])

function readPeriod(v: unknown, today: string): EventPeriod | undefined {
  const cur = Number(seasonOf(today).from.slice(0, 4))
  if (typeof v === 'string' || typeof v === 'number') {
    const s = normalize(String(v)).replace(/ /g, '_')
    if (/^(a_venir|avenir|futur|futurs|prochains?|upcoming)$/.test(s)) return { kind: 'upcoming' }
    if (/^(passes?|passe|anciens|termines|past)$/.test(s)) return { kind: 'past' }
    if (/^(ce_mois|ce_mois_ci|mois_en_cours)$/.test(s)) return { kind: 'month' }
    if (/^(cette_saison|saison|saison_en_cours)$/.test(s)) return { kind: 'season' }
    if (/^(saison_derniere|saison_passee|derniere_saison)$/.test(s)) return { kind: 'season', start: cur - 1 }
    if (/^\d{4}$/.test(s)) return { kind: 'year', year: Number(s) }
    if (/^\d{4}_\d{2}$/.test(s)) return { kind: 'month', ym: s.replace('_', '-') }
    return undefined
  }
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined
  const o = v as Record<string, unknown>
  const y = Number(o.annee)
  if (Number.isInteger(y) && y > 1990 && y < 2100 && o.mois === undefined) return { kind: 'year', year: y }
  if (typeof o.mois === 'string' && YM.test(o.mois)) return { kind: 'month', ym: o.mois }
  const sy = Number(o.saison)
  if (Number.isInteger(sy) && sy > 1990 && sy < 2100) return { kind: 'season', start: sy }
  const from = asText(o.du)
  const to = asText(o.au)
  if (DAY.test(from) || DAY.test(to)) return cleanPeriod({ kind: 'between', from: DAY.test(from) ? from : '1990-01-01', to: DAY.test(to) ? to : '2099-12-31' })
  return undefined
}

/**
 * Lit la recette rendue par le modèle pour la liste Événements : chaque valeur est revérifiée (type connu, date lisible,
 * lieu, département, région ou créateur retrouvé parmi ceux de l'appareil) ; le reste est dit (« Non appliqué », « Pas
 * pris en compte »).
 */
export function readEventsRecipe(raw: unknown, nonGere: string[], ctx: EventsReadCtx): ListIncoming<EventFilters> {
  const r = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
  const f: Partial<EventFilters> = {}
  const notes: string[] = []
  const unsupported = nonGere.map((x) => x.slice(0, 80))
  const thisYear = Number(ctx.today.slice(0, 4))
  for (const k of Object.keys(r)) if (!KNOWN.has(k)) unsupported.push(`« ${k} »`)
  // Types
  for (const t of asList(r.types ?? r.type)) {
    const s = asText(t)
    const exact = EVENT_TYPE_LIST.find((x) => x.value === normalize(s))
    const m = exact ? { found: exact } : bestMatch(s, EVENT_TYPE_LIST, (x) => [x.label, x.value, ...(TYPE_ALIASES[x.value] ?? [])])
    if ('found' in m) f.types = [...new Set([...(f.types ?? []), m.found.value])]
    else notes.push(`type ${quote(s)} (valeur inconnue)`)
  }
  // Période
  if (r.periode !== undefined) {
    const p = readPeriod(r.periode, ctx.today)
    if (p) f.period = p
    else notes.push(`période ${quote(typeof r.periode === 'object' ? JSON.stringify(r.periode) : r.periode)} (pas une date)`)
  }
  // Lieux : parmi les lieux des événements ; sinon un département ou une région dits comme un lieu.
  for (const l of asList(r.lieux ?? r.lieu)) {
    const s = asText(l)
    if (!s) continue
    const n = readName(s, ctx.places)
    if ('q' in n) f.places = [...new Set([...(f.places ?? []), n.q])]
    else {
      const d = matchDept(s, ctx.geo)
      const g = 'found' in d ? undefined : matchRegion(s, ctx.geo)
      if ('found' in d) f.depts = [...new Set([...(f.depts ?? []), d.found.code])]
      else if (g && 'found' in g) f.regions = [...new Set([...(f.regions ?? []), g.found.id])]
      else notes.push(`lieu ${quote(s)} (aucun événement à ce lieu)`)
    }
  }
  for (const d of asList(r.departements ?? r.departement)) {
    const m = matchDept(d, ctx.geo)
    if ('found' in m) f.depts = [...new Set([...(f.depts ?? []), m.found.code])]
    else notes.push(`département ${quote(d)} (pas trouvé)`)
  }
  for (const x of asList(r.regions ?? r.region)) {
    const m = matchRegion(x, ctx.geo)
    if ('found' in m) f.regions = [...new Set([...(f.regions ?? []), m.found.id])]
    else notes.push(`région ${quote(x)} (pas trouvée)`)
  }
  if (r.mes !== undefined && r.mes !== false) {
    const s = normalize(asText(r.mes))
    if (r.mes === true || /^(les miens|miens|mes|mine|tous|oui|true)$/.test(s)) f.who = 'mine'
    else if (/^(crees|createur|cree|crees par moi)$/.test(s)) f.who = 'created'
    else if (/^(participant|participe|participants)$/.test(s)) f.who = 'participant'
    else notes.push(`mes événements ${quote(r.mes)} (valeur inconnue)`)
  }
  // Nom approchant (« Steve Bacher » pour « Stef bascher ») : à confirmer par l'entraîneur avant d'appliquer le filtre.
  const confirm: NameConfirm[] = []
  for (const c of asList(r.createurs ?? r.createur)) {
    const s = asText(c)
    const m = matchPerson(s, ctx.creators)
    if ('found' in m) f.creators = [...new Set([...(f.creators ?? []), m.found])]
    else if ('words' in m) f.creators = [...new Set([...(f.creators ?? []), m.words])]
    else if ('confirm' in m) confirm.push({ key: 'creators', said: s, choices: m.confirm })
    else notes.push(`créateur ${quote(s)} (aucun événement créé par cette personne)`)
  }
  if (r.feuilleDeMatch !== undefined && isTrue(r.feuilleDeMatch)) f.sheet = true
  if (r.video !== undefined && isTrue(r.video)) f.video = true
  if (r.aRevoir !== undefined && isTrue(r.aRevoir)) f.rewatch = true
  if (r.joueurs !== undefined) {
    const c = parseNumCond(r.joueurs)
    if (c) f.players = c
    else notes.push(`nombre de joueurs ${quote(JSON.stringify(r.joueurs))} (illisible)`)
  }
  if (r.avis !== undefined) {
    const c = parseNumCond(r.avis)
    if (c) f.avis = c
    else notes.push(`nombre d’avis ${quote(JSON.stringify(r.avis))} (illisible)`)
  }
  if (r.generation !== undefined) {
    const g = r.generation
    // Une génération, plusieurs ([2010, 2012], « 2010 et 2012 ») ou une plage ({de, a}) : src/birthYears.ts.
    const ys = parseSaidYears(g, thisYear, 1951)
    if (ys?.length) f.gens = ys
    else notes.push(`génération ${quote(JSON.stringify(g))} (pas une année de naissance)`)
  }
  let q: string | undefined
  for (const n of asList(r.noms ?? r.nom ?? r.recherche)) {
    const m = readName(n, ctx.names)
    if ('q' in m) q = m.q
    else if (m.none) notes.push(`événement ${quote(m.none)} (aucun événement de ce nom)`)
  }
  // Sortie : tri de la liste ou calcul sur la sélection.
  let sort: EventsQuery['sort']
  let calc: ListCalc | undefined
  const out = r.sortie && typeof r.sortie === 'object' && !Array.isArray(r.sortie) ? (r.sortie as Record<string, unknown>) : undefined
  if (out) {
    const type = normalize(asText(out.type))
    if (type === 'nombre' || type === 'compte') calc = { type: 'count' }
    else if (type === 'tableau' || type === 'carte') {
      const by = normalize(asText(out.par))
      const map: Record<string, string> = { type: 'type', types: 'type', mois: 'month', annee: 'year', saison: 'season', lieu: 'place', lieux: 'place', departement: 'dept', region: 'region', createur: 'creator' }
      if (map[by]) calc = { type: 'table', by: map[by] }
      else if (type === 'carte') calc = { type: 'table', by: 'dept' }
      else notes.push(`tableau par ${quote(out.par)} (regroupement inconnu)`)
    } else if (type === 'liste' || out.tri) {
      sort = parseSort(out, EVENT_SORTS)
      if (out.tri && !sort) notes.push(`tri ${quote(out.tri)} (inconnu)`)
    }
  }
  return { f, ...(q ? { q } : {}), ...(sort ? { sort } : {}), ...(calc ? { calc } : {}), notes, unsupported, ...(confirm.length ? { confirm } : {}) }
}

/** La lecture n'a rien donné d'utile (rien à appliquer). */
export const readsNothing = (it: ListIncoming<object>) => !Object.keys(it.f).length && !it.q && !it.sort && !it.calc

// ---------- Anciens filtres (avant la recette) ----------

/** Anciens filtres de la liste Événements ({ q, type, year, mine }) en requête : mêmes événements retenus. */
export function legacyEventsToQuery(v: { q: string; type: string; year: string; mine: boolean }): EventsQuery {
  const f: EventFilters = {}
  if (v.type) f.types = [v.type]
  if (/^\d{4}$/.test(v.year)) f.period = { kind: 'year', year: Number(v.year) }
  if (v.mine) f.who = 'created'
  return { f, q: v.q }
}
