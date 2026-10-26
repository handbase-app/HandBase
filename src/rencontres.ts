import { playerClub } from './perimeter'
import type { YouthCategory } from './sportContent'

/*
 * « Autour de moi » (onglet de la page Événements) : les rencontres officielles prévues des championnats de jeunes, autour
 * d'un lieu (Où), sur une période (Quand), et les jeunes de la liste (Qui) qui devraient y jouer. Rencontres lues à la
 * demande sur le serveur (supabase/056_rencontres.sql, hb_rencontres_autour ; accès : src/rencontresApi.ts), jamais
 * copiées sur l'appareil. Et « Mon équipe » d'un joueur (clé usualTeam de la fiche : équipe 1, 2 ou 3, niveau, catégorie
 * jouée en cas de surclassement), tenue par le staff (formulaire de la fiche) ou par le jeune (sa page, hb_player_set_team).
 *
 * Fichier pur (ni React ni Dexie) : testé par tools/test-rencontres.ts. Ici :
 *  - les types (rencontre, équipe d'un joueur, statut « devrait jouer » / « joue (confirmé) » : le second viendra à
 *    l'étape 2, quand le jeune ou le staff confirmera) et la lecture des lignes du serveur ;
 *  - distance (haversine), boîte autour d'un point, rayon ;
 *  - périodes : « Ce week-end » (samedi-dimanche qui viennent, ou celui en cours le samedi et le dimanche), « 7 jours »,
 *    « 30 jours » ;
 *  - catégorie de saison d'un joueur (âge atteint dans l'année où finit la saison, catégories du sport : src/sportContent.ts),
 *    ou celle où il joue (surclassement) ;
 *  - jeunes de chaque rencontre : même club (n° de club, à défaut début de la licence), même sexe (rencontre mixte : les
 *    deux), même catégorie ; équipe connue des deux côtés : la même ; sinon niveau déclaré : le même ;
 *  - comptes, tris, salles de la carte, textes des cartes, lien « Itinéraire » (OpenStreetMap, coordonnées seules) ;
 *  - choix gardés sur l'appareil (Où, rayon, Quand), relus sans rien croire.
 * Uniquement des formulations positives ou neutres sur les jeunes (« devrait jouer », « N jeunes »).
 */

// ---------- Rencontres ----------

export type Level = 'departemental' | 'regional' | 'national'
export const LEVELS: readonly { value: Level; label: string }[] = [
  { value: 'departemental', label: 'Départemental' },
  { value: 'regional', label: 'Régional' },
  { value: 'national', label: 'National' },
]
const LEVEL_SET = new Set<string>(LEVELS.map((l) => l.value))
export const isLevel = (v: unknown): v is Level => typeof v === 'string' && LEVEL_SET.has(v)
/** « Régional » ; '' si inconnu. */
export const levelLabel = (l?: string | null) => LEVELS.find((x) => x.value === l)?.label ?? ''

/** Sexe d'une rencontre : M, F ; X = mixte. */
export type FixtureSex = 'M' | 'F' | 'X'
/** Origine : jeu fictif des démonstrations, import Gest'Hand (à venir), saisie. */
export type FixtureSource = 'demo' | 'gesthand' | 'manuel'

export interface FixtureSide {
  /** Unité de la structure (club), quand elle est connue. */
  unitId?: string
  /** N° de club (7 chiffres) : c'est lui qui relie les joueurs à la rencontre. */
  club?: string
  /** Numéro de l'équipe du club dans la catégorie (1, 2, 3…), s'il est connu. */
  team?: number
  name: string
}

export interface Rencontre {
  id: string
  /** Début (ISO, avec fuseau). */
  startsAt: string
  lat: number
  lng: number
  category: string
  sex: FixtureSex
  level: Level
  competition?: string
  home: FixtureSide
  away: FixtureSide
  venue?: string
  city?: string
  /** Lien de diffusion (étape 2) : « Regarder » seulement s'il est là (http ou https). */
  liveUrl?: string
  source: FixtureSource
  /** Distance au centre de la recherche (km), rendue par le serveur. */
  distanceKm?: number
}

const str = (v: unknown, max = 200): string | undefined => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined)
const num = (v: unknown): number | undefined => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN
  return Number.isFinite(n) ? n : undefined
}

/** Lien http(s) bien formé, sinon undefined (jamais javascript:, data:…). */
export function safeUrl(v: unknown): string | undefined {
  const s = str(v, 2000)
  if (!s || !/^https?:\/\//i.test(s)) return undefined
  try {
    const u = new URL(s)
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : undefined
  } catch {
    return undefined
  }
}

const side = (r: Record<string, unknown>, k: 'home' | 'away'): FixtureSide | null => {
  const name = str(r[`${k}_name`], 120)
  if (!name) return null
  const club = str(r[`${k}_club`], 20)
  const team = num(r[`${k}_team`])
  const unitId = str(r[`${k}_unit_id`], 120)
  return { name, ...(unitId ? { unitId } : {}), ...(club ? { club } : {}), ...(team && Number.isInteger(team) && team >= 1 && team <= 9 ? { team } : {}) }
}

/** Ligne de hb_rencontres_autour (supabase/056_rencontres.sql) → rencontre ; null si elle est inutilisable. */
export function fromRow(r: unknown): Rencontre | null {
  if (!r || typeof r !== 'object') return null
  const o = r as Record<string, unknown>
  const id = str(o.id, 200)
  const startsAt = str(o.starts_at, 40)
  const lat = num(o.lat)
  const lng = num(o.lng)
  const category = str(o.category, 12)
  const sex = o.sex === 'M' || o.sex === 'F' || o.sex === 'X' ? o.sex : undefined
  const level = isLevel(o.level) ? o.level : undefined
  const home = side(o, 'home')
  const away = side(o, 'away')
  if (!id || !startsAt || Number.isNaN(Date.parse(startsAt)) || lat === undefined || lng === undefined || !category || !sex || !level || !home || !away) return null
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null
  const source: FixtureSource = o.source === 'demo' || o.source === 'gesthand' ? o.source : 'manuel'
  const competition = str(o.competition, 160)
  const venue = str(o.venue, 120)
  const city = str(o.city, 80)
  const liveUrl = safeUrl(o.live_url)
  const distanceKm = num(o.distance_km)
  return {
    id,
    startsAt,
    lat,
    lng,
    category,
    sex,
    level,
    home,
    away,
    source,
    ...(competition ? { competition } : {}),
    ...(venue ? { venue } : {}),
    ...(city ? { city } : {}),
    ...(liveUrl ? { liveUrl } : {}),
    ...(distanceKm !== undefined && distanceKm >= 0 ? { distanceKm } : {}),
  }
}

// ---------- Distance ----------

export type LatLng = { lat: number; lng: number }
/** Rayon moyen de la Terre (km), comme le serveur. */
export const EARTH_KM = 6371.0088
const rad = (d: number) => (d * Math.PI) / 180

/** Distance à vol d'oiseau (km), formule de haversine. */
export function haversineKm(a: LatLng, b: LatLng): number {
  const dLat = rad(b.lat - a.lat)
  const dLng = rad(b.lng - a.lng)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_KM * Math.asin(Math.min(1, Math.sqrt(h)))
}

/** Boîte lat / lng qui contient le cercle (même calcul que le serveur : 1° ≈ 111,2 km, compté 110 pour un peu de marge). */
export function boxAround(c: LatLng, km: number) {
  const dLat = km / 110
  const dLng = km / (110 * Math.max(Math.cos(rad(c.lat)), 0.01))
  return { minLat: c.lat - dLat, maxLat: c.lat + dLat, minLng: c.lng - dLng, maxLng: c.lng + dLng }
}

/** Éléments à `km` au plus de `c`, avec leur distance (km, au dixième). */
export function withinRadius<T extends LatLng>(list: readonly T[], c: LatLng, km: number): (T & { distanceKm: number })[] {
  const out: (T & { distanceKm: number })[] = []
  for (const x of list) {
    const d = haversineKm(c, x)
    if (d <= km) out.push({ ...x, distanceKm: Math.round(d * 10) / 10 })
  }
  return out
}

/** Rayons proposés (km). */
export const RADII = [10, 25, 50, 100] as const
export type Radius = (typeof RADII)[number]

// ---------- Quand ----------

export type PeriodKey = 'weekend' | '7j' | '30j'
export const PERIODS: readonly { value: PeriodKey; label: string }[] = [
  { value: 'weekend', label: 'Ce week-end' },
  { value: '7j', label: '7 jours' },
  { value: '30j', label: '30 jours' },
]
const PERIOD_SET = new Set<string>(PERIODS.map((p) => p.value))

/**
 * Bornes d'une période, en heure locale de l'appareil : [from, to[. « Ce week-end » : du samedi 0 h au lundi 0 h, celui qui
 * vient (lundi à vendredi) ou celui en cours (samedi, dimanche). « 7 jours », « 30 jours » : d'aujourd'hui 0 h à 7 ou 30
 * jours plus tard (les rencontres déjà jouées aujourd'hui restent).
 */
export function periodRange(k: PeriodKey, now: Date): { from: Date; to: Date } {
  const y = now.getFullYear()
  const m = now.getMonth()
  const d = now.getDate()
  if (k === 'weekend') {
    const dow = now.getDay() // 0 dimanche … 6 samedi
    const sat = dow === 6 ? d : dow === 0 ? d - 1 : d + (6 - dow)
    return { from: new Date(y, m, sat), to: new Date(y, m, sat + 2) }
  }
  return { from: new Date(y, m, d), to: new Date(y, m, d + (k === '7j' ? 7 : 30)) }
}

/** Jour local (AAAA-MM-JJ) d'un horodatage ISO. */
export const localDay = (iso: string) => new Date(Date.parse(iso)).toLocaleDateString('sv')

// ---------- Catégories ----------

/** Année civile où finit la saison qui contient ce jour (1er septembre → 31 août). */
export function seasonEndYear(day: string): number {
  const y = Number(day.slice(0, 4))
  return Number(day.slice(5, 7)) >= 9 ? y + 1 : y
}

/** Catégorie d'un âge de saison ; undefined hors des catégories de jeunes. */
export const categoryForAge = (age: number, cats: readonly YouthCategory[]) => cats.find((c) => c.ages.includes(age))?.code

/** Catégorie de saison d'un joueur né à `birthDate`, le jour `day` ; undefined si l'année de naissance est inconnue. */
export function seasonCategory(birthDate: string | undefined, day: string, cats: readonly YouthCategory[]): string | undefined {
  const y = Number(birthDate?.slice(0, 4))
  if (!birthDate || !/^\d{4}/.test(birthDate) || !Number.isInteger(y)) return undefined
  return categoryForAge(seasonEndYear(day) - y, cats)
}

// ---------- Mon équipe ----------

/** Équipe habituelle d'un joueur (clé usualTeam de la fiche ; supabase/056 : nettoyée et datée par le serveur). */
export interface UsualTeam {
  /** Son équipe dans la catégorie : 1, 2 ou 3. */
  n?: 1 | 2 | 3
  level?: Level
  /** Catégorie où il joue quand ce n'est pas celle de son âge (surclassement). */
  playsIn?: string
  /** Quand (ISO) : la plus récente gagne sur le serveur. */
  at?: string
  /** Qui l'a posée : le joueur (sa page) ou le staff (la fiche). */
  src?: 'joueur' | 'staff'
}
export const TEAM_NUMBERS = [1, 2, 3] as const

/**
 * Champs d'une équipe saisie, nettoyés (sans at ni src) : n parmi 1 à 3, niveau connu, catégorie jouée parmi `codes`
 * (catégories du sport) ; {} si rien.
 */
export function cleanUsualTeam(v: unknown, codes: readonly string[]): Pick<UsualTeam, 'n' | 'level' | 'playsIn'> {
  if (!v || typeof v !== 'object') return {}
  const o = v as Record<string, unknown>
  const n = o.n === 1 || o.n === 2 || o.n === 3 ? o.n : undefined
  const level = isLevel(o.level) ? o.level : undefined
  const playsIn = typeof o.playsIn === 'string' && codes.includes(o.playsIn) ? o.playsIn : undefined
  return { ...(n ? { n } : {}), ...(level ? { level } : {}), ...(playsIn ? { playsIn } : {}) }
}

/** L'équipe dit-elle quelque chose (« effacée » : { at } seul) ? */
export const hasTeamInfo = (t?: UsualTeam | null) => !!(t && (t.n || t.level || t.playsIn))

/** Mêmes choix (sans regarder at ni src) ? */
export const sameTeam = (a?: UsualTeam | null, b?: UsualTeam | null) =>
  (a?.n ?? null) === (b?.n ?? null) && (a?.level ?? null) === (b?.level ?? null) && (a?.playsIn ?? null) === (b?.playsIn ?? null)

/**
 * Catégories proposées pour « Joue en » (surclassement) : celles AU-DESSUS de la catégorie de son âge (toutes si elle est
 * inconnue ou hors des catégories de jeunes), plus celle déjà choisie si elle n'y est plus (changement de saison).
 */
export function upperCategories(own: string | undefined, cats: readonly YouthCategory[], chosen?: string): YouthCategory[] {
  const i = own ? cats.findIndex((c) => c.code === own) : -1
  return cats.filter((c, j) => j > i || c.code === chosen)
}

/** Catégorie où le joueur joue ce jour-là : celle déclarée (surclassement, si c'est une catégorie du sport), sinon celle de son âge. */
export function playerCategory(p: { birthDate?: string; usualTeam?: UsualTeam }, day: string, cats: readonly YouthCategory[]): string | undefined {
  const plays = p.usualTeam?.playsIn
  if (plays && cats.some((c) => c.code === plays)) return plays
  return seasonCategory(p.birthDate, day, cats)
}

/**
 * Résumé compact : « U15 · Équipe 1 · Régional » ; catégorie jouée au-dessus de celle de l'âge : « U18 (surclassement) ».
 * '' si l'équipe ne dit rien.
 */
export function teamSummary(p: { birthDate?: string; usualTeam?: UsualTeam }, day: string, cats: readonly YouthCategory[]): string {
  const t = p.usualTeam
  if (!hasTeamInfo(t)) return ''
  const own = seasonCategory(p.birthDate, day, cats)
  const cat = playerCategory(p, day, cats)
  const catText = cat ? (t?.playsIn && own && t.playsIn !== own ? `${cat} (surclassement)` : cat) : ''
  return [catText, t?.n ? `Équipe ${t.n}` : '', levelLabel(t?.level)].filter(Boolean).join(' · ')
}

// ---------- Jeunes de chaque rencontre ----------

/**
 * « devrait jouer » : déduit (club, sexe, catégorie, équipe) ; « joue » : confirmé (étape 2 : le jeune ou le staff le
 * dira). Jamais de marque négative.
 */
export type PlayStatus = 'devrait_jouer' | 'joue'
export const STATUS_LABEL: Record<PlayStatus, string> = { devrait_jouer: 'devrait jouer', joue: 'joue (confirmé)' }

/** Ce qu'il faut d'un joueur pour le relier aux rencontres. */
export interface MatchPlayer {
  id: string
  sex?: string
  birthDate?: string
  clubCode?: string
  license?: string
  usualTeam?: UsualTeam
}

export interface FixtureMatch<P extends MatchPlayer = MatchPlayer> {
  player: P
  side: 'home' | 'away'
  status: PlayStatus
  /** Relié par son numéro d'équipe (sinon : club et catégorie, ou niveau). */
  byTeam: boolean
}

/** Joueurs rangés par « n° de club|sexe » (une fois par liste Qui). Sans club ni sexe connu : laissés de côté. */
export function indexPlayers<P extends MatchPlayer>(players: readonly P[]): Map<string, P[]> {
  const ix = new Map<string, P[]>()
  for (const p of players) {
    const club = playerClub(p)
    if (!club || (p.sex !== 'M' && p.sex !== 'F')) continue
    const k = `${club}|${p.sex}`
    const l = ix.get(k)
    if (l) l.push(p)
    else ix.set(k, [p])
  }
  return ix
}

/**
 * Jeunes de chaque rencontre (identifiant → jeunes, dans l'ordre de `players`). Un jeune y est s'il est du club d'une des
 * deux équipes, du sexe de la rencontre (mixte : les deux) et de sa catégorie (celle où il joue : surclassement déclaré,
 * sinon celle de son âge, saison de la rencontre). Puis : son numéro d'équipe et celui de l'équipe connus → le même ;
 * sinon, son niveau déclaré → le même. Même club des deux côtés (équipes 1 et 2 d'un même club) : une seule fois.
 * Aujourd'hui tous « devrait jouer » ; `confirmed` (étape 2) : identifiants « rencontre|joueur » confirmés → « joue ».
 */
export function matchPlayers<P extends MatchPlayer>(
  fixtures: readonly Rencontre[],
  players: readonly P[] | Map<string, P[]>,
  cats: readonly YouthCategory[],
  opts: { confirmed?: ReadonlySet<string> } = {},
): Map<string, FixtureMatch<P>[]> {
  const ix = players instanceof Map ? players : indexPlayers(players)
  const out = new Map<string, FixtureMatch<P>[]>()
  for (const f of fixtures) {
    const day = localDay(f.startsAt)
    const found = new Map<string, FixtureMatch<P>>()
    for (const s of ['home', 'away'] as const) {
      const team = f[s]
      if (!team.club) continue
      for (const sex of f.sex === 'X' ? ['M', 'F'] : [f.sex]) {
        for (const p of ix.get(`${team.club}|${sex}`) ?? []) {
          if (playerCategory(p, day, cats) !== f.category) continue
          const t = p.usualTeam
          let byTeam = false
          if (t?.n && team.team) {
            if (t.n !== team.team) continue
            byTeam = true
          } else if (t?.level && t.level !== f.level) continue
          const prev = found.get(p.id)
          if (prev && (prev.byTeam || !byTeam)) continue
          found.set(p.id, { player: p, side: s, status: opts.confirmed?.has(`${f.id}|${p.id}`) ? 'joue' : 'devrait_jouer', byTeam })
        }
      }
    }
    if (found.size) out.set(f.id, [...found.values()])
  }
  return out
}

/** Nombre de jeunes différents sur l'ensemble des rencontres. */
export function distinctYouths(matches: Map<string, FixtureMatch[]>, ids?: Iterable<string>): number {
  const seen = new Set<string>()
  for (const id of ids ?? matches.keys()) for (const m of matches.get(id) ?? []) seen.add(m.player.id)
  return seen.size
}

// ---------- Tri, salles ----------

export type FixtureSort = 'date' | 'distance' | 'jeunes'

/** Rencontres triées : par heure (puis distance), par distance (puis heure), ou par nombre de jeunes (puis heure). */
export function sortFixtures(list: readonly Rencontre[], matches: Map<string, FixtureMatch[]>, by: FixtureSort = 'date'): Rencontre[] {
  const t = (f: Rencontre) => Date.parse(f.startsAt)
  const d = (f: Rencontre) => f.distanceKm ?? Infinity
  const n = (f: Rencontre) => matches.get(f.id)?.length ?? 0
  return [...list].sort((a, b) => {
    const k = by === 'distance' ? d(a) - d(b) || t(a) - t(b) : by === 'jeunes' ? n(b) - n(a) || t(a) - t(b) : t(a) - t(b) || d(a) - d(b)
    return k || a.id.localeCompare(b.id)
  })
}

/** Une salle sur la carte : ses rencontres de la liste et le nombre de jeunes qui devraient y jouer. */
export interface Venue {
  key: string
  lat: number
  lng: number
  name?: string
  city?: string
  fixtures: Rencontre[]
  youths: number
}

/** Rencontres réunies par salle (mêmes coordonnées à ~10 m près), dans l'ordre des rencontres. */
export function venuesOf(list: readonly Rencontre[], matches: Map<string, FixtureMatch[]>): Venue[] {
  const by = new Map<string, Venue & { ids: Set<string> }>()
  for (const f of list) {
    const key = `${f.lat.toFixed(4)},${f.lng.toFixed(4)}`
    let v = by.get(key)
    if (!v) by.set(key, (v = { key, lat: f.lat, lng: f.lng, name: f.venue, city: f.city, fixtures: [], youths: 0, ids: new Set() }))
    v.fixtures.push(f)
    for (const m of matches.get(f.id) ?? []) v.ids.add(m.player.id)
    v.youths = v.ids.size
  }
  return [...by.values()].map(({ ids: _ids, ...v }) => v)
}

// ---------- Textes ----------

/** « 1 jeune », « 3 jeunes ». */
export const youthsText = (n: number) => `${n.toLocaleString('fr-FR')} jeune${n > 1 ? 's' : ''}`

/** Un ou deux noms, puis « +N » : « Léa DUPONT, Zoé MARTIN +3 ». */
export function namesLine(names: readonly string[], max = 2): string {
  const shown = names.slice(0, max).join(', ')
  return names.length > max ? `${shown} +${names.length - max}` : shown
}

/** « Club A (2) » ; sans numéro d'équipe : le nom seul. */
export const sideLabel = (s: FixtureSide) => (s.team ? `${s.name} (${s.team})` : s.name)
/** « Club A (2) – Club B (1) ». */
export const teamsLabel = (f: Pick<Rencontre, 'home' | 'away'>) => `${sideLabel(f.home)} – ${sideLabel(f.away)}`

/** « U15 · Régional · Championnat régional U15 masculin » (la compétition seulement si elle dit autre chose). */
export const fixtureHeading = (f: { category?: string; level?: string | null; competition?: string }) => [f.category, levelLabel(f.level), f.competition].filter(Boolean).join(' · ')

/** « sam. 31 oct. · 14:00 » (heure locale de l'appareil). */
export function fixtureWhen(iso: string): string {
  const d = new Date(Date.parse(iso))
  const day = d.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' })
  const time = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
  return `${day} · ${time}`
}

/** « 12 km », « 800 m », « 3,4 km ». */
export function distanceText(km?: number): string {
  if (km === undefined || !Number.isFinite(km)) return ''
  if (km < 1) return `${Math.max(100, Math.round(km * 10) * 100)} m`
  return `${km < 10 ? km.toLocaleString('fr-FR', { maximumFractionDigits: 1 }) : Math.round(km)} km`
}

/** Lien « Itinéraire » : OpenStreetMap, avec les SEULES coordonnées de la salle (destination ; départ laissé vide). */
export function itineraryUrl(lat: number, lng: number): string {
  const la = lat.toFixed(5)
  const ln = lng.toFixed(5)
  return `https://www.openstreetmap.org/directions?route=%3B${la}%2C${ln}#map=15/${la}/${ln}`
}

// ---------- Où : villes, département ----------

export const foldText = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

type PlacedUnit = { levelId?: string; clubNumber?: string; city?: string; lat?: number; lng?: number; deleted?: boolean; departments?: string[] }
const placed = (u: PlacedUnit) =>
  !u.deleted && (u.levelId === 'niveau-club' || !!u.clubNumber) && Number.isFinite(u.lat) && Number.isFinite(u.lng) && Math.abs(u.lat!) <= 90 && Math.abs(u.lng!) <= 180

/** Une ville où il y a des clubs placés (structure importée) : au milieu de ses clubs. */
export interface CityPlace {
  key: string
  name: string
  dept?: string
  lat: number
  lng: number
  clubs: number
}

/** Villes des clubs qui ont des coordonnées (une par nom de ville et département), de la plus fournie à la moins fournie. */
export function citiesOf(units: readonly PlacedUnit[], deptOf: (clubNumber: string) => string | undefined): CityPlace[] {
  const by = new Map<string, { name: string; dept?: string; lat: number; lng: number; clubs: number }>()
  for (const u of units) {
    if (!placed(u) || !u.city?.trim()) continue
    const dept = (u.clubNumber && deptOf(u.clubNumber)) || u.departments?.[0]
    const key = `${foldText(u.city)}|${dept ?? ''}`
    const c = by.get(key)
    if (c) {
      c.lat += u.lat!
      c.lng += u.lng!
      c.clubs++
    } else by.set(key, { name: u.city.trim(), dept, lat: u.lat!, lng: u.lng!, clubs: 1 })
  }
  return [...by.entries()]
    .map(([key, c]) => ({ key, name: c.name, ...(c.dept ? { dept: c.dept } : {}), lat: c.lat / c.clubs, lng: c.lng / c.clubs, clubs: c.clubs }))
    .sort((a, b) => b.clubs - a.clubs || a.name.localeCompare(b.name, 'fr'))
}

/** Villes qui répondent au texte : celles qui commencent par lui d'abord, puis celles qui le contiennent ; `max` au plus. */
export function searchCities(cities: readonly CityPlace[], text: string, max = 8): CityPlace[] {
  const q = foldText(text)
  if (!q) return []
  const starts: CityPlace[] = []
  const has: CityPlace[] = []
  for (const c of cities) {
    const f = foldText(c.name)
    if (f.startsWith(q)) starts.push(c)
    else if (f.includes(q) || c.dept === q) has.push(c)
  }
  return [...starts, ...has].slice(0, max)
}

/** Milieu des clubs placés d'un département ; undefined s'il n'y en a pas. */
export function deptCenter(units: readonly PlacedUnit[], dept: string, deptOf: (clubNumber: string) => string | undefined): LatLng | undefined {
  let lat = 0
  let lng = 0
  let n = 0
  for (const u of units) {
    if (!placed(u)) continue
    const d = (u.clubNumber && deptOf(u.clubNumber)) || u.departments?.[0]
    if (d !== dept) continue
    lat += u.lat!
    lng += u.lng!
    n++
  }
  return n ? { lat: lat / n, lng: lng / n } : undefined
}

// ---------- Choix gardés sur l'appareil ----------

export type PlaceKind = 'city' | 'club' | 'dept' | 'pos'
/** Centre de la recherche : une ville, mon club, mon département, ma position (demandée explicitement). */
export interface Place {
  kind: PlaceKind
  label: string
  lat: number
  lng: number
}
export interface AroundPrefs {
  place?: Place
  km: Radius
  period: PeriodKey
}
export const DEFAULT_PREFS: AroundPrefs = { km: 25, period: 'weekend' }

/** Choix relus (stockage de l'appareil) : seulement ce qui est bien formé ; le reste par défaut. */
export function parsePrefs(raw: unknown): AroundPrefs {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const km = (RADII as readonly number[]).includes(o.km as number) ? (o.km as Radius) : DEFAULT_PREFS.km
  const period = typeof o.period === 'string' && PERIOD_SET.has(o.period) ? (o.period as PeriodKey) : DEFAULT_PREFS.period
  const p = o.place && typeof o.place === 'object' ? (o.place as Record<string, unknown>) : null
  const kind = p && ['city', 'club', 'dept', 'pos'].includes(p.kind as string) ? (p.kind as PlaceKind) : undefined
  const lat = num(p?.lat)
  const lng = num(p?.lng)
  const label = str(p?.label, 80)
  const place = kind && label && lat !== undefined && lng !== undefined && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { kind, label, lat, lng } : undefined
  return { km, period, ...(place ? { place } : {}) }
}

// ---------- Demande au serveur ----------

export interface AroundRequest {
  lat: number
  lng: number
  km: number
  from: string
  to: string
  sex?: 'M' | 'F'
  /** N° de club des jeunes de la liste : seulement les rencontres de leurs clubs (absent : toutes). */
  clubs?: string[]
}

/** Au plus autant de clubs envoyés (au-delà : toutes les rencontres, le filtre ne sert plus à rien). */
export const MAX_CLUBS = 3000

/**
 * Demande pour un lieu, un rayon, une période et les jeunes de Qui. Coordonnées arrondies à 3 décimales (~100 m : assez
 * pour la recherche, et une même demande d'un écran à l'autre). `all` : toutes les rencontres (pas seulement celles des
 * clubs de ces jeunes).
 */
export function aroundRequest(place: LatLng, km: number, range: { from: Date; to: Date }, who: readonly MatchPlayer[], opts: { all?: boolean; sex?: 'M' | 'F' } = {}): AroundRequest {
  const r3 = (x: number) => Math.round(x * 1000) / 1000
  const req: AroundRequest = { lat: r3(place.lat), lng: r3(place.lng), km, from: range.from.toISOString(), to: range.to.toISOString() }
  if (opts.sex) req.sex = opts.sex
  if (!opts.all) {
    const clubs = new Set<string>()
    for (const p of who) {
      const c = playerClub(p)
      if (c) clubs.add(c)
    }
    if (clubs.size <= MAX_CLUBS) req.clubs = [...clubs].sort()
  }
  return req
}

/** Clé d'une demande (réponses gardées en mémoire). */
export const requestKey = (r: AroundRequest) => JSON.stringify([r.lat, r.lng, r.km, r.from, r.to, r.sex ?? '', r.clubs ?? null])

/** Le serveur rend 500 rencontres au plus : la liste est peut-être coupée. */
export const SERVER_CAP = 500
