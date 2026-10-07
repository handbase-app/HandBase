import { useEffect, useReducer } from 'react'
import { alive, contextLabel, db, localDay, remove, save, type Criterion, type Follow, type HBEvent, type PlayerGroup } from './db'
import { fmtValue } from './components/ui'
import { sharedQuery, useShared } from './live'
import { can, currentUserId, useRole } from './roles'
import { supabase } from './sync'

/*
 * « Mes suivis » (supabase/032_suivis.sql) : joueurs et groupes suivis, à la façon d'un réseau social.
 *  - suivi personnel : une ligne de la table follows, privée (son créateur seul la voit, sur tous ses appareils) ;
 *  - suivi d'équipe : groupe « Suivi par l'équipe » (teamFollow), suivi par son créateur et ses participants.
 * Suivre un groupe = suivre tous ses joueurs, y compris ceux ajoutés plus tard (calculé à chaque fois).
 * Nouveautés d'un joueur suivi : ses nouvelles mesures et ses nouveaux avis (rien d'autre).
 */

export type FollowKind = Follow['kind']

/** Propriétaire des suivis : le compte connecté ; sans serveur (mode local), l'unique utilisateur. */
const owner = () => currentUserId() ?? (supabase ? null : 'local')
const followId = (me: string, kind: FollowKind, targetId: string) => `${me}:${kind}:${targetId}`

/** Peut-on suivre (compte connu) ? */
export const canFollow = () => !!owner()

/** Groupe suivi par l'équipe, pour ce compte : il en est le créateur ou un participant (jamais un groupe privé). */
export function teamFollowed(g: PlayerGroup, uid = currentUserId()) {
  if (!g.teamFollow || g.private) return false
  // Sans créateur connu : groupe créé sur cet appareil, pas encore envoyé (donc le mien).
  return !g.createdBy || (!!uid && (g.createdBy === uid || !!g.editors?.includes(uid)))
}

export interface FollowedGroup {
  group: PlayerGroup
  /** Suivi personnel (ligne follows). */
  personal: boolean
  /** Suivi par l'équipe (teamFollow, et je suis créateur ou participant). */
  team: boolean
}

export interface FollowsResult {
  /** Joueurs suivis directement. */
  players: Set<string>
  /** Groupes suivis (personnellement ou par l'équipe), visibles, non supprimés. */
  groups: FollowedGroup[]
  /** Tous les joueurs suivis (directement ou par un groupe). */
  followed: Set<string>
  /** Pour chaque joueur suivi par un groupe : les noms de ces groupes. */
  via: Map<string, string[]>
}

/** Mes suivis (lus dans follows et groups : quelques centaines de lignes au plus). */
export async function computeFollows(): Promise<FollowsResult> {
  const me = owner()
  const [rows, groups] = await Promise.all([db.follows.toArray(), db.groups.toArray()])
  const mine = me ? alive(rows).filter((f) => f.id.startsWith(`${me}:`)) : []
  const players = new Set(mine.filter((f) => f.kind === 'player').map((f) => f.targetId))
  const groupIds = new Set(mine.filter((f) => f.kind === 'group').map((f) => f.targetId))
  const uid = currentUserId()
  const followedGroups: FollowedGroup[] = alive(groups)
    .filter(can.seeGroup)
    .map((group) => ({ group, personal: groupIds.has(group.id), team: teamFollowed(group, uid) }))
    .filter((g) => g.personal || g.team)
    .sort((a, b) => a.group.name.localeCompare(b.group.name, 'fr'))
  const followed = new Set(players)
  const via = new Map<string, string[]>()
  for (const { group } of followedGroups)
    for (const pid of group.playerIds) {
      followed.add(pid)
      const v = via.get(pid)
      if (v) v.push(group.name)
      else via.set(pid, [group.name])
    }
  return { players, groups: followedGroups, followed, via }
}

let computedFor: string | null | undefined
const followsStore = sharedQuery(
  ['follows', 'groups'],
  () => {
    computedFor = currentUserId()
    return computeFollows()
  },
  300,
)

/** Mes suivis, calculés une fois pour toute l'appli (undefined pendant le premier calcul). */
export function useFollows(): FollowsResult | undefined {
  useRole()
  const uid = currentUserId()
  useEffect(() => {
    if (computedFor !== undefined && uid !== computedFor) {
      followsStore.refresh()
      newsStore.refresh()
    }
  }, [uid])
  return useShared(followsStore)
}

/** Suivre (on = true) ou arrêter de suivre un joueur ou un groupe. */
export async function setFollow(kind: FollowKind, targetId: string, on: boolean) {
  const me = owner()
  if (!me) return
  const id = followId(me, kind, targetId)
  const cur = await db.follows.get(id)
  if (on) await save<Follow>('follows', { ...cur, id, kind, targetId, deleted: undefined })
  else if (cur && !cur.deleted) await remove('follows', id)
  followsStore.refresh()
  newsStore.refresh()
}

// ---------- Nouveautés des joueurs suivis ----------

export interface FollowNews {
  key: string
  kind: 'measurement' | 'evaluation'
  playerId: string
  /** Moment de l'ajout (ms). */
  time: number
  /** Jour de l'ajout, AAAA-MM-JJ (heure locale). */
  day: string
  author?: string
  mine: boolean
  /** « Détente verticale : 45 cm », « Tournoi de Noël »… */
  text: string
  detail?: string
  pending?: boolean
  /** Mesure : date du test (AAAA-MM-JJ). */
  testDate?: string
}

/** Moment de création, comme dans le fil « Quoi de neuf » (feed.ts). */
const created = (r: { createdAtServer?: string; updatedAtServer?: string; updatedAt: number }) => {
  const t = r.createdAtServer ? Date.parse(r.createdAtServer) : NaN
  if (!isNaN(t)) return t
  return r.updatedAtServer ? 0 : r.updatedAt
}

/** Tables lues par les nouveautés (pour les relancer quand elles changent). */
export const NEWS_TABLES = ['follows', 'groups', 'measurements', 'evaluations', 'players', 'criteria', 'events']

/**
 * Nouvelles mesures et nouveaux avis des joueurs suivis, sur les `days` derniers jours, les plus récents d'abord.
 * Seulement ce qui est sur l'appareil (chacun n'y a que ce qu'il a le droit de voir) ; lu par l'index playerId,
 * sans parcourir toutes les mesures. Avis hors cadre écartés (ils ne comptent pas).
 */
export async function buildFollowNews(days: number, f?: FollowsResult): Promise<FollowNews[]> {
  const follows = f ?? (await computeFollows())
  const players = await db.players.bulkGet([...follows.followed])
  const ids = players.filter((p) => p && !p.deleted && !p.mergedInto).map((p) => p!.id)
  if (!ids.length) return []
  const since = Date.now() - days * 24 * 3600 * 1000
  const me = currentUserId()
  const [ms, es, criteria] = await Promise.all([
    db.measurements.where('playerId').anyOf(ids).toArray(),
    db.evaluations.where('playerId').anyOf(ids).toArray(),
    db.criteria.toArray(),
  ])
  const crit = new Map<string, Criterion>(criteria.map((c) => [c.id, c]))
  const recentEs = es.filter((e) => !e.deleted && e.review !== 'refused' && created(e) >= since)
  const events = new Map<string, HBEvent>(
    (await db.events.bulkGet([...new Set(recentEs.map((e) => e.eventId).filter((x): x is string => !!x))])).filter((e): e is HBEvent => !!e).map((e) => [e.id, e]),
  )
  const out: FollowNews[] = []
  for (const m of ms) {
    if (m.deleted) continue
    const time = created(m)
    if (time < since) continue
    const c = crit.get(m.criterionId)
    out.push({
      key: `m|${m.id}`,
      kind: 'measurement',
      playerId: m.playerId,
      time,
      day: localDay(time),
      author: m.createdByName ?? m.author,
      mine: !!me && m.createdBy === me,
      text: `${c?.label ?? m.criterionId} : ${fmtValue(c, m.value)}`,
      detail: [`test du ${new Date(m.date + 'T00:00:00').toLocaleDateString('fr-FR')}`, m.note].filter(Boolean).join(' · '),
      testDate: m.date,
    })
  }
  for (const e of recentEs) {
    const time = created(e)
    const ev = e.eventId ? events.get(e.eventId) : undefined
    const noted = Object.values(e.scores ?? {}).filter((v) => v !== '' && v !== undefined).length
    out.push({
      key: `e|${e.id}`,
      kind: 'evaluation',
      playerId: e.playerId,
      time,
      day: localDay(time),
      author: e.createdByName ?? e.observer,
      mine: !!me && (e.createdBy ?? e.observerId) === me,
      text: ev ? ev.name : contextLabel(e),
      detail: typeof e.overall === 'number' ? `note globale ${e.overall}/5` : noted ? `${noted} critère${noted > 1 ? 's' : ''} noté${noted > 1 ? 's' : ''}` : undefined,
      pending: e.review === 'pending',
    })
  }
  return out.sort((a, b) => b.time - a.time)
}

/** Nouveautés des 30 derniers jours, partagées par la pastille de l'en-tête et l'accueil. */
const NEWS_DAYS = 30
const newsStore = sharedQuery(NEWS_TABLES, () => buildFollowNews(NEWS_DAYS))

// ---------- Dernière visite de « Mes suivis » (par compte, sur l'appareil) ----------

const seenKey = () => `handbase.follows.seen.${owner() ?? ''}`
const seenListeners = new Set<() => void>()

/** Dernière visite de « Mes suivis » ; la première fois, les 3 derniers jours comptent comme nouveaux. */
export function followsSeen() {
  try {
    return Number(localStorage.getItem(seenKey()) ?? Date.now() - 3 * 24 * 3600 * 1000)
  } catch {
    return Date.now()
  }
}
export function markFollowsSeen() {
  try {
    localStorage.setItem(seenKey(), String(Date.now()))
  } catch {
    /* stockage indisponible */
  }
  seenListeners.forEach((l) => l())
}

/** Nombre de nouveautés pas encore vues (hors mes propres saisies) : pastille de l'étoile. */
export function useFollowNewsCount() {
  useRole()
  const news = useShared(newsStore)
  // Visite de « Mes suivis » : la pastille se remet à zéro (ce n'est pas dans la base).
  const [, force] = useReducer((n: number) => n + 1, 0)
  useEffect(() => {
    const l = () => force()
    seenListeners.add(l)
    return () => {
      seenListeners.delete(l)
    }
  }, [])
  const seen = followsSeen()
  return news?.filter((n) => n.time > seen && !n.mine).length ?? 0
}
