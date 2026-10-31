/*
 * Parcours d'un joueur (fiche, src/components/Parcours.tsx) : une ligne par palier atteint, dans un ordre fixe
 * Repéré → Comité → Ligue → Pôle → France ; un palier non atteint n'apparaît pas. Rien à saisir : tout est déduit de ce que
 * l'appli sait déjà (décidé avec Geoffroy et Stef le 31/10, « 1 · Par palier »).
 *
 * Étapes : les événements où le joueur a été vu (« vu » ou avis, comme l'ancienne carte « Repérage »), avec le nombre
 * d'observateurs distincts, plus ceux où il a passé une séance de mesures. Une séance n'a pas de lien direct avec un
 * événement : elle y est rattachée quand elle a eu lieu le jour même d'un événement où il était (liste de l'événement, vu
 * ou avis). Les « à revoir » et les tests physiques sans événement ne sont pas des étapes (ils restent dans leurs onglets).
 *
 * Palier d'un événement (palierOf), dans cet ordre :
 *  1. un match : toujours « Repéré ». Son organisateur est l'unité de l'observateur (un comité qui suit un match de club,
 *     src/eventOrganizer.ts) et son nom dit le niveau du championnat (« Championnat de France ») : ni l'un ni l'autre ne
 *     dit où en est le joueur ;
 *  2. l'unité organisatrice (HBEvent.organizerUnitId → hb_units, son niveau) : club → Repéré, comité → Comité, ligue → Ligue,
 *     pôle → Ligue (unité de la ligue), fédération → France. Unité absente de l'appareil : le nom gardé sur l'événement
 *     (organizerName) est lu comme ci-dessous ;
 *  3. les mots du nom, sans accents ni majuscules : « intercomité(s) » → Comité (même organisés par la ligue), « interligues »
 *     → Ligue, puis France / fédéral / FFHB / FFVB / EDF → France (pas « national » : un « Tournoi national » de club
 *     n'est pas l'équipe de France, 31/10), ligue / régional / CRE → Ligue,
 *     comité / CD / départemental → Comité ;
 *  4. sinon (tournoi, entraînement, observation sans indice) : au palier du club, « Repéré ».
 *
 * Pôle : depuis les périodes de pôle de la fiche (Player.poles, les mêmes que la carte « Pôle Espoirs » et les groupes Pôle),
 * jamais depuis les événements.
 *
 * Fichier pur (ni Dexie ni React) : testé par tools/test-parcours.ts.
 */
import type { EventType, PolePeriod } from './db'
import { accord } from './gender'
import { SPORT_CONTENT, type SportContent } from './sportContent'
import type { LevelRow, UnitRow } from './structureTree'

export type PalierId = 'repere' | 'comite' | 'ligue' | 'pole' | 'france'
/** Ordre fixe des paliers, du premier repérage à l'équipe de France. */
export const PALIER_ORDER: readonly PalierId[] = ['repere', 'comite', 'ligue', 'pole', 'france']

export interface ParcoursEvent {
  id: string
  name: string
  type: EventType | string
  date: string
  organizerUnitId?: string
  organizerName?: string
  playerIds?: string[]
  /** Supprimé depuis : l'étape reste (elle a eu lieu), sans lien. */
  deleted?: boolean
}
export interface ParcoursSeen {
  id: string
  eventId: string
  createdBy?: string
}
export interface ParcoursEval {
  eventId?: string
  observer: string
  observerId?: string
  createdBy?: string
}

export interface ParcoursInput {
  playerId: string
  /** Événements connus (y compris supprimés : leurs avis gardent le nom). */
  events: readonly ParcoursEvent[]
  seen: readonly ParcoursSeen[]
  evaluations: readonly ParcoursEval[]
  /** Dates des mesures du joueur (une séance = une date). */
  measurements: readonly { date: string }[]
  units: readonly UnitRow[]
  levels: readonly LevelRow[]
  poles?: readonly PolePeriod[]
  /** Jour de référence (AAAA-MM-JJ) : pôle « en cours ». */
  today: string
  sex?: string | null
  /** Sport de l'installation (libellés : src/sportContent.ts) ; défaut handball. */
  sport?: string
  /** Nom d'une période de pôle (src/db.ts, poleName) ; défaut « Pôle Espoirs ». */
  poleName?: (p: PolePeriod) => string
}

/** Une étape : un événement (ou une période de pôle). */
export interface ParcoursStep {
  key: string
  eventId?: string
  name: string
  /** AAAA-MM-JJ (période de pôle : son entrée). */
  date: string
  type?: string
  /** Événement supprimé depuis (pas de lien). */
  gone?: boolean
  avis: number
  mesures: number
  observers: number
  /** Période de pôle : sortie (AAAA-MM-JJ), si elle est passée. */
  end?: string
  /** Période de pôle en cours. */
  current?: boolean
  /** Sur la liste de l'événement (convoqué), sans y avoir été vu, noté ni mesuré. */
  listed?: boolean
}

export interface Palier {
  id: PalierId
  /** « Stages de ligue », « Repéré en tournoi », « Pôle Espoirs »… (accordé au nombre et au sexe). */
  label: string
  /** Nom court de la frise : Repéré, Comité, Ligue, Pôle, France. */
  short: string
  /** Étapes, de la plus ancienne à la plus récente. */
  steps: ParcoursStep[]
  avis: number
  mesures: number
  /** Observateurs distincts sur l'ensemble du palier. */
  observers: number
  /** Années de la première et de la dernière étape. */
  from: string
  to: string
  /** Pôle : en cours aujourd'hui. */
  current?: boolean
}

/** Minuscules, sans accents, ponctuation en espaces : « Inter-Comités 83 » → « inter comites 83 ». */
export const foldName = (s: string) =>
  ` ${s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()} `

/** Mots du nom, du plus précis au plus général (voir l'en-tête). */
const KEYWORDS: [RegExp, PalierId][] = [
  [/ inter ?comites? /, 'comite'],
  [/ inter ?ligues? /, 'ligue'],
  [/ (france|federal|federale|federaux|ffhb|ffvb|edf) /, 'france'],
  [/ (ligues?|regional|regionale|regionaux|cre) /, 'ligue'],
  [/ (comites?|cd\d*|departemental|departementale|departementaux) /, 'comite'],
]

/** Palier d'après des mots (nom d'événement ou d'unité) ; rien si aucun indice. */
export function palierFromWords(name: string | undefined): PalierId | undefined {
  if (!name) return undefined
  const f = foldName(name)
  return KEYWORDS.find(([re]) => re.test(f))?.[1]
}

/** Niveau de la structure → palier, par l'identifiant (niveau-ligue…) ou le début du nom (Ligue, Comité…). */
const LEVEL_PALIER: [string, PalierId][] = [
  ['federation', 'france'],
  ['ligue', 'ligue'],
  ['comite', 'comite'],
  ['pole', 'ligue'],
  ['club', 'repere'],
]
function palierOfUnit(unitId: string, units: readonly UnitRow[], levels: readonly LevelRow[]): PalierId | undefined {
  const u = units.find((x) => x.id === unitId)
  if (!u) return undefined
  const lv = levels.find((l) => l.id === u.levelId)
  const keys = [u.levelId.replace(/^niveau-/, ''), lv ? foldName(lv.name).trim() : '']
  for (const k of keys) {
    const hit = LEVEL_PALIER.find(([p]) => k.startsWith(p))
    if (hit) return hit[1]
  }
  // Niveau inconnu (structure maison) : le nom de l'unité.
  return palierFromWords(u.name)
}

/** Palier d'un événement (règles : en-tête du fichier). Jamais « pole ». */
export function palierOf(ev: ParcoursEvent, units: readonly UnitRow[], levels: readonly LevelRow[]): Exclude<PalierId, 'pole'> {
  if (ev.type === 'match') return 'repere'
  const byUnit = ev.organizerUnitId ? (palierOfUnit(ev.organizerUnitId, units, levels) ?? palierFromWords(ev.organizerName)) : undefined
  const p = byUnit ?? palierFromWords(ev.name) ?? 'repere'
  return p === 'pole' ? 'ligue' : p
}

const year = (d: string) => d.slice(0, 4)
const MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.']
/** « oct. 2024 » ; année seule si le mois manque. */
export function monthYear(d: string): string {
  const m = Number(d.slice(5, 7))
  return m >= 1 && m <= 12 ? `${MONTHS[m - 1]} ${year(d)}` : year(d)
}

/** Libellé d'un palier, accordé au nombre d'étapes (et au sexe pour « Repéré »). */
function labelOf(id: PalierId, steps: ParcoursStep[], sex: string | null | undefined, content: SportContent): { label: string; short: string } {
  const L = content.parcours
  const n = steps.length
  if (id === 'repere') {
    const r = accord('Repéré', sex)
    const types = new Set(steps.map((s) => s.type))
    const where = types.size === 1 && types.has('tournoi') ? ' en tournoi' : types.size === 1 && types.has('match') ? ' en match' : ''
    return { label: r + where, short: r }
  }
  if (id === 'pole') return { label: L.pole, short: 'Pôle' }
  const [one, many] = L[id]
  return { label: n > 1 ? many : one, short: id === 'comite' ? 'Comité' : id === 'ligue' ? 'Ligue' : 'France' }
}

/** Parcours par palier, dans l'ordre fixe ; vide si le joueur n'a aucune étape. */
export function parcours(input: ParcoursInput): Palier[] {
  const content = SPORT_CONTENT[input.sport ?? 'handball'] ?? SPORT_CONTENT.handball
  const byId = new Map(input.events.map((e) => [e.id, e]))
  // Observateurs distincts et avis, par événement (même clé d'observateur que l'ancienne carte « Repérage »).
  const obs = new Map<string, Set<string>>()
  const avis = new Map<string, number>()
  const add = (eid: string, who: string) => obs.set(eid, (obs.get(eid) ?? new Set()).add(who))
  for (const s of input.seen) add(s.eventId, s.createdBy ?? s.id.split(':')[0])
  for (const e of input.evaluations) {
    if (!e.eventId) continue
    add(e.eventId, e.observerId ?? e.createdBy ?? e.observer)
    avis.set(e.eventId, (avis.get(e.eventId) ?? 0) + 1)
  }
  // Séances de mesures rattachées : le jour même d'un événement où il était.
  const sessions = new Set(input.measurements.map((m) => m.date))
  const mesures = new Map<string, number>()
  for (const ev of input.events) {
    if (ev.deleted || !sessions.has(ev.date)) continue
    if (obs.has(ev.id) || ev.playerIds?.includes(input.playerId)) mesures.set(ev.id, 1)
  }

  const steps = new Map<PalierId, ParcoursStep[]>()
  const push = (p: PalierId, s: ParcoursStep) => steps.set(p, [...(steps.get(p) ?? []), s])
  // Convocations (31/10) : un événement passé, hors match, où il était sur la liste compte aussi, même sans avis ni mesures
  // (sept stages de ligue convoqué, c'est déjà le parcours). Pas les matchs : leur liste, ce sont les jeunes qui devraient y
  // jouer (src/rencontreEvent.ts), pas une convocation.
  const listed = input.events.filter((ev) => !ev.deleted && ev.type !== 'match' && ev.date <= input.today && ev.playerIds?.includes(input.playerId)).map((ev) => ev.id)
  const eventIds = new Set([...obs.keys(), ...mesures.keys(), ...listed])
  const observersOf = new Map<PalierId, Set<string>>()
  for (const eid of eventIds) {
    const ev = byId.get(eid)
    if (!ev) continue
    const p = palierOf(ev, input.units, input.levels)
    const who = obs.get(eid) ?? new Set<string>()
    observersOf.set(p, new Set([...(observersOf.get(p) ?? []), ...who]))
    push(p, { key: `e${eid}`, eventId: eid, name: ev.name, date: ev.date, type: ev.type, gone: ev.deleted || undefined, avis: avis.get(eid) ?? 0, mesures: mesures.get(eid) ?? 0, observers: who.size, listed: (!who.size && !mesures.has(eid)) || undefined })
  }
  // Pôle : une étape par période renseignée.
  for (const [i, x] of (input.poles ?? []).entries()) {
    if (!(x.from || x.to || x.name || x.regionId || x.site)) continue
    const current = (!x.from || x.from <= input.today) && (!x.to || x.to >= input.today)
    push('pole', { key: `p${i}`, name: input.poleName?.(x) ?? 'Pôle Espoirs', date: x.from ?? x.to ?? '', end: x.to, avis: 0, mesures: 0, observers: 0, current })
  }

  const out: Palier[] = []
  for (const id of PALIER_ORDER) {
    const list = steps.get(id)
    if (!list?.length) continue
    list.sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name, 'fr'))
    const dated = list.filter((s) => s.date)
    // Dernière année : la plus tardive des étapes (sortie du pôle comprise).
    const last = dated.reduce((m, s) => ((s.end ?? s.date) > m ? (s.end ?? s.date) : m), '')
    out.push({
      id,
      ...labelOf(id, list, input.sex, content),
      steps: list,
      avis: list.reduce((n, s) => n + s.avis, 0),
      mesures: list.reduce((n, s) => n + s.mesures, 0),
      observers: observersOf.get(id)?.size ?? 0,
      from: dated.length ? year(dated[0].date) : '',
      to: year(last),
      current: id === 'pole' ? list.some((s) => s.current) : undefined,
    })
  }
  return out
}

/** Période d'un palier : « 2024 → 2026 », « 2024 » ; pôle en cours : « depuis sept. 2025 ». */
export function periodLabel(p: Palier): string {
  if (p.id === 'pole' && p.current) {
    const first = p.steps.find((s) => s.date)
    return first ? `depuis ${monthYear(first.date)}` : 'en cours'
  }
  if (!p.from) return ''
  return p.from === p.to ? p.from : `${p.from} → ${p.to}`
}

/** Ce qui s'est passé dans le palier : « 9 avis · mesures ×3 · 4 obs. » (rien de ce qui manque). */
export function palierFacts(p: Palier): string[] {
  const out: string[] = []
  if (p.mesures) out.push(p.mesures > 1 ? `mesures ×${p.mesures}` : 'mesures')
  if (p.avis) out.push(`${p.avis} avis`)
  if (p.observers) out.push(`${p.observers} obs.`)
  return out
}

/** Petite étiquette de la frise : année d'entrée (Repéré, Pôle, palier d'une seule étape), sinon « ×7 ». */
export function stripTag(p: Palier): string {
  if (p.id === 'repere' || p.id === 'pole' || p.steps.length < 2) return p.from
  return `×${p.steps.length}`
}

/** Petits points d'un palier : un par étape, `max` au plus, puis « +N ». */
export function dotCount(n: number, max = 10): { dots: number; more: number } {
  return { dots: Math.min(n, max), more: Math.max(0, n - max) }
}

/**
 * Étapes repliées : jusqu'à `keep` + 1 étapes, toutes ; au-delà, la 1re, la 2e, « ⋯ N autres », la dernière.
 * `{ more: N }` marque la place du repli.
 */
export function foldSteps<T>(steps: readonly T[], keep = 3): (T | { more: number })[] {
  if (steps.length <= keep + 1) return [...steps]
  return [steps[0], steps[1], { more: steps.length - 3 }, steps[steps.length - 1]]
}
