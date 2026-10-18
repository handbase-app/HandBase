import { alive, db, newId, remove, save, type Evaluation, type HBEvent, type Rewatch, type Seen, type Team, type Tournament } from './db'
import { getMe } from './components/ui'
import type { MatchSheet } from './matchSheet'
import { teamsFromSheet as sheetTeams } from './sheetTeams'
import { currentUserId, participants } from './roles'
import { loadTeams } from './teams'
import { supabase } from './sync'

/*
 * Repérage en tournoi (supabase/041_reperage_tournoi.sql) : « vu », « à revoir », répartition des équipes.
 * Principe : uniquement des marques positives ou neutres. Il n'existe aucun « vu, pas retenu » : un joueur vu sans autre
 * marque n'a simplement rien de plus.
 *  - « Vu » : une ligne par (observateur, événement, joueur), table seen. Un avis sur le joueur dans l'événement le compte
 *    comme vu aussi (rien à écrire : les avis sont lus avec les « vu »). La couverture est celle de l'équipe d'observateurs.
 *  - « À revoir » : table rewatch, une ligne par auteur ; un même joueur signalé par plusieurs s'affiche sur une seule
 *    ligne avec les noms et commentaires de chacun. « Revu » : automatique dans un événement visé (vu ou noté),
 *    à la main pour les groupes et la liste générale.
 *  - Répartition d'un tournoi : champ tournament de l'événement (équipes, joueurs, observateurs).
 */

/** Nom sans accents ni majuscules (rapprocher un avis d'un « vu » du même observateur). */
const fold = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()

/** Compte de l'observateur : le compte connecté ; sans serveur (mode local), l'unique utilisateur. */
export const scoutId = () => currentUserId() ?? (supabase ? null : 'local')

export const seenId = (uid: string, eventId: string, playerId: string) => `${uid}:${eventId}:${playerId}`

/** Marquer (on) ou retirer (erreur de toucher) mon « vu » sur un joueur de l'événement. */
export async function setSeen(eventId: string, playerId: string, on: boolean) {
  const me = scoutId()
  if (!me) return
  const id = seenId(me, eventId, playerId)
  const cur = await db.seen.get(id)
  if (on) {
    if (cur && !cur.deleted) return
    await save<Seen>('seen', { ...cur, id, eventId, playerId, at: new Date().toISOString(), deleted: undefined })
  } else if (cur && !cur.deleted) await remove('seen', id)
}

/** Marquer « vu » par moi dans l'événement plusieurs joueurs d'un coup ; renvoie le nombre de nouveaux « vu ». */
export async function markSeenMany(eventId: string, playerIds: readonly string[]): Promise<number> {
  const me = scoutId()
  if (!me) return 0
  let n = 0
  for (const playerId of new Set(playerIds)) {
    const id = seenId(me, eventId, playerId)
    const cur = await db.seen.get(id)
    if (cur && !cur.deleted) continue
    await save<Seen>('seen', { ...cur, id, eventId, playerId, at: new Date().toISOString(), deleted: undefined })
    n++
  }
  return n
}

/** Un observateur qui a vu un joueur dans l'événement : marque « vu » (marked) et / ou avis (noted). */
export interface Sighting {
  key: string
  name: string
  mine: boolean
  marked: boolean
  noted: boolean
  /** Moment le plus ancien connu (ISO) : « vu » ou avis. */
  at?: string
}

/** Pour chaque joueur : les observateurs qui l'ont vu (« vu » ou avis), moi d'abord puis par nom. */
export function sightings(seen: Seen[], evals: Evaluation[]): Map<string, Sighting[]> {
  const me = scoutId()
  const meName = getMe()
  const by = new Map<string, Map<string, Sighting>>()
  const of = (pid: string) => {
    let m = by.get(pid)
    if (!m) by.set(pid, (m = new Map()))
    return m
  }
  for (const s of seen) {
    if (s.deleted) continue
    const uid = s.createdBy ?? s.id.slice(0, s.id.indexOf(':'))
    const mine = !!me && uid === me
    of(s.playerId).set(uid, { key: uid, name: s.createdByName ?? (mine ? meName || 'moi' : '?'), mine, marked: true, noted: false, at: s.at ?? s.createdAtServer })
  }
  for (const e of evals) {
    if (e.deleted) continue
    const m = of(e.playerId)
    const uid = e.observerId ?? e.createdBy
    // Avis sans compte (mode local, démonstration) : rapproché d'un « vu » du même nom.
    const key = uid ?? [...m.values()].find((x) => fold(x.name) === fold(e.observer))?.key ?? `nom:${fold(e.observer)}`
    const mine = uid ? uid === me : !!meName && e.observer === meName
    const cur = m.get(key)
    const at = e.createdAtServer ?? e.date
    if (cur) {
      cur.noted = true
      if (!cur.at || at < cur.at) cur.at = at
    } else m.set(key, { key, name: e.observer, mine, marked: false, noted: true, at })
  }
  const out = new Map<string, Sighting[]>()
  for (const [pid, m] of by) out.set(pid, [...m.values()].sort((a, b) => Number(b.mine) - Number(a.mine) || a.name.localeCompare(b.name, 'fr')))
  return out
}

/** « toi, Sophie, Paul » : noms des observateurs (moi en premier). */
export const sightingNames = (list: Sighting[]) => list.map((s) => (s.mine ? 'toi' : s.name)).join(', ')

// ---------- À revoir ----------

/** Joueur vu ou noté dans un événement : clés « événement|joueur ». */
export async function revisitedKeys(eventIds: string[]): Promise<Set<string>> {
  const ids = [...new Set(eventIds)]
  const keys = new Set<string>()
  if (!ids.length) return keys
  const [seen, evals] = await Promise.all([db.seen.where('eventId').anyOf(ids).toArray(), db.evaluations.where('eventId').anyOf(ids).toArray()])
  for (const s of seen) if (!s.deleted) keys.add(`${s.eventId}|${s.playerId}`)
  for (const e of evals) if (!e.deleted && e.eventId) keys.add(`${e.eventId}|${e.playerId}`)
  return keys
}

/** Événement visé où il a été revu (vu ou noté), s'il y en a un. */
export const revisitedAt = (r: Rewatch, keys: Set<string>) => (r.events ?? []).find((e) => keys.has(`${e}|${r.playerId}`))

/** « Revu » : coché à la main, ou vu / noté dans un des événements visés. */
export const isRevisited = (r: Rewatch, keys: Set<string>) => !!r.done || !!revisitedAt(r, keys)

/** Mon « à revoir » sur ce joueur, encore ouvert (pas revu à la main) : on le complète au lieu d'en créer un autre. */
export async function myOpenRewatch(playerId: string) {
  const me = scoutId()
  const rows = alive(await db.rewatch.where('playerId').equals(playerId).toArray())
  return rows.find((r) => !r.done && (r.createdBy ? r.createdBy === me : !r.createdAtServer))
}

/** Écrit mon « à revoir » (nouveau ou complété). */
export function saveRewatch(row: Omit<Rewatch, 'updatedAt' | 'id'> & { id?: string }) {
  return save<Rewatch>('rewatch', { ...row, id: row.id ?? newId() })
}

/** « Revu » à la main (on) ou annulé, sur un ou plusieurs « à revoir » du joueur (le serveur signe qui et quand). */
export async function setRevisited(rows: Rewatch[], on: boolean) {
  const me = scoutId() ?? undefined
  for (const r of rows) {
    const cur = (await db.rewatch.get(r.id)) ?? r
    if (cur.deleted || !!cur.done === on) continue
    await save<Rewatch>('rewatch', { ...cur, done: on ? { at: new Date().toISOString(), by: me, byName: getMe() || undefined } : undefined })
  }
}

/** Mon « à revoir » : l'auteur, ou une ligne créée ici et pas encore envoyée. */
export const isMyRewatch = (r: Rewatch) => (r.createdBy ? r.createdBy === scoutId() : !r.createdAtServer)

/**
 * Mon staff : moi et les membres (et créateurs) des staffs dont je fais partie. null : tout le monde (mode local, un seul
 * utilisateur). Sert à « Mes à revoir » : un administrateur reçoit aussi ceux des autres staffs.
 */
export async function staffMates(): Promise<Set<string> | null> {
  if (!supabase) return null
  const me = currentUserId()
  const mates = new Set<string>(me ? [me] : [])
  for (const t of await loadTeams()) {
    if (!me || !(t.createdBy === me || t.members.includes(me))) continue
    t.members.forEach((u) => mates.add(u))
    if (t.createdBy) mates.add(t.createdBy)
  }
  return mates
}

export const fromMyStaff = (r: Rewatch, mates: Set<string> | null) => !mates || !r.createdBy || mates.has(r.createdBy)

/** Un joueur à revoir : tous les « à revoir » visibles (une seule ligne, avec chaque auteur). */
export interface RewatchEntry {
  playerId: string
  rows: Rewatch[]
  /** Pas encore revus. */
  open: Rewatch[]
}

/** « À revoir » regroupés par joueur ; `mine` : seulement ceux de mon staff. */
export async function loadRewatchEntries({ mine = true } = {}) {
  const rows = alive(await db.rewatch.toArray())
  const mates = mine ? await staffMates() : null
  const shown = rows.filter((r) => fromMyStaff(r, mates))
  const keys = await revisitedKeys(shown.flatMap((r) => r.events ?? []))
  const by = new Map<string, RewatchEntry>()
  for (const r of shown.sort((a, b) => stamp(a) - stamp(b))) {
    let e = by.get(r.playerId)
    if (!e) by.set(r.playerId, (e = { playerId: r.playerId, rows: [], open: [] }))
    e.rows.push(r)
    if (!isRevisited(r, keys)) e.open.push(r)
  }
  return { entries: [...by.values()], keys, all: rows.length !== shown.length }
}

/** Moment de création (ms) : signature du serveur, sinon heure de l'appareil. */
export const stamp = (r: { createdAtServer?: string; updatedAt: number }) => (r.createdAtServer ? Date.parse(r.createdAtServer) : r.updatedAt)

/** Nombre de joueurs de mon staff encore à revoir (tuile de l'accueil). */
export async function countOpenRewatch() {
  const { entries } = await loadRewatchEntries()
  return entries.filter((e) => e.open.length).length
}

// ---------- Répartition d'un tournoi ----------

/** Équipes déclarées (vide : pas de répartition, tout le monde voit tout). */
export const tournamentTeams = (ev: Pick<HBEvent, 'tournament'>) => ev.tournament?.teams ?? []
export const teamOf = (ev: Pick<HBEvent, 'tournament'>, playerId: string) => ev.tournament?.players?.[playerId]?.team
export const numOf = (ev: Pick<HBEvent, 'tournament'>, playerId: string) => ev.tournament?.players?.[playerId]?.num
/** Équipes qui me sont confiées. */
export const myTournamentTeams = (ev: Pick<HBEvent, 'tournament'>) => new Set(ev.tournament?.assign?.[scoutId() ?? ''] ?? [])
/** Observateurs à qui une équipe est confiée. */
export const teamObservers = (ev: Pick<HBEvent, 'tournament'>, teamId: string) =>
  Object.entries(ev.tournament?.assign ?? {})
    .filter(([, ts]) => ts.includes(teamId))
    .map(([u]) => u)

/** Identifiant court d'une nouvelle équipe (propre à l'événement). */
export const newTeamId = () => 't' + Math.random().toString(36).slice(2, 8)

/**
 * Match importé d'une feuille FFHB : les deux équipes de la feuille (locaux, visiteurs), chaque joueur relié dans la
 * sienne avec son numéro ; jamais par-dessus une équipe choisie à la main (src/sheetTeams.ts).
 */
export const teamsFromSheet = (t: Tournament | undefined, ms: MatchSheet, playerIds: string[]): Tournament => sheetTeams(t, ms, playerIds, newTeamId)
export { sheetPlayersWithoutTeam } from './sheetTeams'

/** Ordre dans une équipe : numéro de maillot (numérique d'abord), puis nom. */
export function byNumber(ev: Pick<HBEvent, 'tournament'>) {
  const n = (id: string) => {
    const v = numOf(ev, id)
    return v === undefined ? Infinity : /^\d+$/.test(v) ? Number(v) : 1e6
  }
  return (a: { id: string; lastName: string; firstName: string }, b: { id: string; lastName: string; firstName: string }) =>
    n(a.id) - n(b.id) || a.lastName.localeCompare(b.lastName, 'fr', { sensitivity: 'base' }) || a.firstName.localeCompare(b.firstName, 'fr', { sensitivity: 'base' })
}

/**
 * Observateurs possibles de l'événement : son organisateur, ses participants (un par un et membres des staffs choisis),
 * et moi si je l'organise (mode local compris).
 */
export function eventPeople(ev: HBEvent, manage: boolean): string[] {
  const me = scoutId()
  const all = new Set<string>()
  if (ev.createdBy) all.add(ev.createdBy)
  participants(ev).forEach((u) => all.add(u))
  if (manage && me) all.add(me)
  return [...all]
}

/** Nom d'un compte cité par l'événement : noms gardés par l'événement, puis par les staffs ; moi : « toi ». */
export function personName(uid: string, ev: HBEvent, teams: Team[] = []) {
  if (uid === scoutId()) return 'toi'
  if (uid === 'local') return getMe() || 'moi'
  return ev.names?.[uid] || (uid === ev.createdBy ? ev.createdByName : undefined) || teams.map((t) => t.names?.[uid]).find(Boolean) || '?'
}

/** Enregistre la répartition (relue au moment d'écrire) ; noms des observateurs cités gardés avec l'événement. */
export async function saveTournament(ev: HBEvent, change: (t: Tournament) => Tournament, names: Record<string, string> = {}) {
  const cur = (await db.events.get(ev.id)) ?? ev
  const next = change(cur.tournament ?? { teams: [] })
  const tournament = next.teams.length ? next : undefined
  await save<HBEvent>('events', { ...cur, tournament, names: { ...cur.names, ...names } })
}

/**
 * « À revoir » pour plusieurs joueurs d'un coup (même geste que l'horloge d'une ligne) : dans un groupe, il vise ce
 * groupe ; dans un événement, il en part (originEventId). Mon « à revoir » encore ouvert sur un joueur est complété
 * (groupe ajouté) plutôt que doublé. Renvoie le nombre de joueurs changés.
 */
export async function addRewatchMany(playerIds: readonly string[], ctx: { originEventId?: string; groupId?: string } = {}): Promise<number> {
  if (!scoutId()) return 0
  let n = 0
  for (const playerId of new Set(playerIds)) {
    const open = await myOpenRewatch(playerId)
    if (open) {
      if (!ctx.groupId || open.groups?.includes(ctx.groupId)) continue
      await save<Rewatch>('rewatch', { ...open, groups: [...(open.groups ?? []), ctx.groupId] })
    } else await saveRewatch({ playerId, originEventId: ctx.originEventId, ...(ctx.groupId ? { groups: [ctx.groupId] } : {}) })
    n++
  }
  return n
}
