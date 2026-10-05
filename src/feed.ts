import { alive, contextLabel, db, fmtDate, type HBEvent, type Player } from './db'
import { department } from './components/PlayerFilter'
import { currentUserId, myDepartments } from './roles'
import type { IconName } from './components/ui'
import { computeAlerts } from './alerts'

/*
 * Fil « Quoi de neuf » : les ajouts récents de tout le staff, jour par jour, construit avec les
 * données déjà sur l'appareil (chacun ne voit que ce qu'il a le droit de voir, même hors ligne).
 * Seulement les ajouts et les validations, pas les modifications. Regroupé par auteur, jour et sujet.
 */

export type FeedKind = 'alerts' | 'players' | 'measurements' | 'evaluations' | 'events' | 'groups' | 'reviews'

export const FEED_KINDS: { value: FeedKind; label: string; icon: IconName }[] = [
  { value: 'alerts', label: 'Alertes', icon: 'bell' },
  { value: 'measurements', label: 'Mesures', icon: 'ruler' },
  { value: 'evaluations', label: 'Avis', icon: 'star' },
  { value: 'players', label: 'Joueurs', icon: 'userPlus' },
  { value: 'events', label: 'Événements', icon: 'calendar' },
  { value: 'groups', label: 'Groupes', icon: 'users' },
  { value: 'reviews', label: 'Validations', icon: 'check' },
]

export interface FeedItem {
  key: string
  kind: FeedKind
  /** Moment de l'ajout (ms) ; le plus récent du regroupement. */
  time: number
  /** Jour de l'ajout, AAAA-MM-JJ (heure locale). */
  day: string
  /** Auteur (inconnu pour les données anciennes ou importées). */
  author?: string
  mine: boolean
  text: string
  detail?: string
  /** Page à ouvrir. */
  to?: string
}

/** Moment de création : posé par le serveur ; à défaut (pas encore synchronisé, démo), dernière modification. */
const created = (r: { createdAtServer?: string; updatedAt: number }) => {
  const t = r.createdAtServer ? Date.parse(r.createdAtServer) : NaN
  return isNaN(t) ? r.updatedAt : t
}
export const localDay = (t: number) => new Date(t).toLocaleDateString('sv')
const plural = (n: number, one: string, many = one + 's') => `${n.toLocaleString('fr-FR')} ${n > 1 ? many : one}`
const nameOf = (p?: Player) => (p ? `${p.lastName.toUpperCase()} ${p.firstName}` : 'joueur supprimé')
const listNames = (ps: (Player | undefined)[]) => (ps.length <= 3 ? ps.map(nameOf).join(', ') : `${ps.slice(0, 2).map(nameOf).join(', ')} et ${ps.length - 2} autres`)
const dateRange = (dates: string[]) => {
  const s = [...new Set(dates)].sort()
  return s.length === 1 ? `du ${fmtDate(s[0])}` : `du ${fmtDate(s[0])} au ${fmtDate(s.at(-1))}`
}

/** Regroupe des lignes par clé. */
function bucket<T>(rows: T[], key: (r: T) => string) {
  const m = new Map<string, T[]>()
  for (const r of rows) {
    const k = key(r)
    const a = m.get(k)
    if (a) a.push(r)
    else m.set(k, [r])
  }
  return m
}

/** Fil des `days` derniers jours ; `sector` : seulement les joueurs de mon secteur. */
export async function buildFeed({ days, sector = false }: { days: number; sector?: boolean }): Promise<FeedItem[]> {
  const since = Date.now() - days * 24 * 3600 * 1000
  const me = currentUserId()
  const [players, measurements, evaluations, events, groups, criteria] = await Promise.all([
    db.players.toArray(),
    db.measurements.toArray().then(alive),
    db.evaluations.toArray().then(alive),
    db.events.toArray(),
    db.groups.toArray().then(alive),
    db.criteria.toArray(),
  ])
  const byId = new Map(players.map((p) => [p.id, p]))
  const evById = new Map<string, HBEvent>(events.map((e) => [e.id, e]))
  const crit = new Map(criteria.map((c) => [c.id, c.label]))
  const depts = myDepartments()
  const inSector = (playerId: string) => {
    if (!sector || !depts.length) return true
    const p = byId.get(playerId)
    const d = p && department(p)
    return !!d && depts.includes(d)
  }
  const recent = <T extends { createdAtServer?: string; updatedAt: number }>(r: T) => created(r) >= since
  const out: FeedItem[] = []
  const push = (it: Omit<FeedItem, 'day' | 'mine'> & { authorId?: string }) => {
    const { authorId, ...rest } = it
    out.push({ ...rest, day: localDay(it.time), mine: !!me && authorId === me })
  }
  const latest = <T extends { createdAtServer?: string; updatedAt: number }>(rs: T[]) => rs.reduce((t, r) => Math.max(t, created(r)), 0)

  // Mesures : par auteur et par jour de saisie.
  const ms = measurements.filter((m) => recent(m) && inSector(m.playerId))
  for (const [k, rs] of bucket(ms, (m) => `${m.createdBy ?? m.author ?? ''}|${localDay(created(m))}`)) {
    const pids = [...new Set(rs.map((m) => m.playerId))]
    const tests = [...new Set(rs.map((m) => crit.get(m.criterionId) ?? m.criterionId))]
    push({
      key: `m|${k}`,
      kind: 'measurements',
      time: latest(rs),
      author: rs[0].createdByName ?? rs[0].author,
      authorId: rs[0].createdBy,
      text: `${plural(rs.length, 'mesure')} sur ${pids.length === 1 ? nameOf(byId.get(pids[0])) : plural(pids.length, 'joueur')}`,
      detail: `${tests.length <= 3 ? tests.join(', ') : plural(tests.length, 'test')} · tests ${dateRange(rs.map((m) => m.date))}`,
      to: pids.length === 1 ? `/joueurs/${pids[0]}` : undefined,
    })
  }

  // Avis : par jour et par événement (ou avis spontanés), tous observateurs ensemble.
  const es = evaluations.filter((e) => recent(e) && inSector(e.playerId))
  for (const [k, rs] of bucket(es, (e) => `${localDay(created(e))}|${e.eventId ?? ''}`)) {
    const ev = rs[0].eventId ? evById.get(rs[0].eventId) : undefined
    const pids = [...new Set(rs.map((e) => e.playerId))]
    const who = [...new Map(rs.map((e) => [e.createdBy ?? e.observerId ?? e.observer, e.createdByName ?? e.observer])).entries()]
    const pending = rs.filter((e) => e.review === 'pending').length
    push({
      key: `e|${k}`,
      kind: 'evaluations',
      time: latest(rs),
      author: who.length <= 3 ? who.map(([, n]) => n).join(', ') : `${who.length} observateurs`,
      authorId: who.length === 1 ? who[0][0] : undefined,
      text: `${plural(rs.length, 'avis', 'avis')} · ${ev ? ev.name : rs.length === 1 ? contextLabel(rs[0]) : 'avis spontanés'}`,
      detail: [`${plural(pids.length, 'joueur')} : ${listNames(pids.map((id) => byId.get(id)))}`, pending && `${pending} à valider`].filter(Boolean).join(' · '),
      to: ev && !ev.deleted ? `/evenements/${ev.id}` : pids.length === 1 ? `/joueurs/${pids[0]}` : undefined,
    })
  }

  // Joueurs : nouvelles fiches, par auteur et par jour (un import Gest'Hand = une ligne).
  const ps = players.filter((p) => !p.deleted && !p.mergedInto && recent(p) && inSector(p.id))
  for (const [k, rs] of bucket(ps, (p) => `${p.createdBy ?? ''}|${localDay(created(p))}`)) {
    const pending = rs.filter((p) => p.review === 'pending').length
    push({
      key: `p|${k}`,
      kind: 'players',
      time: latest(rs),
      author: rs[0].createdByName,
      authorId: rs[0].createdBy,
      text: rs.length === 1 ? `Nouvelle fiche : ${nameOf(rs[0])}` : `${plural(rs.length, 'nouvelle fiche', 'nouvelles fiches')}`,
      detail: [rs.length > 1 && listNames(rs), rs.length === 1 && [rs[0].birthDate?.slice(0, 4), rs[0].club].filter(Boolean).join(', '), pending && `${pending > 1 ? `${pending} ` : ''}à valider`]
        .filter(Boolean)
        .join(' · '),
      to: rs.length === 1 ? `/joueurs/${rs[0].id}` : undefined,
    })
  }

  // Événements : un par un, avec leur date.
  for (const e of events.filter((e) => !e.deleted && recent(e))) {
    push({
      key: `ev|${e.id}`,
      kind: 'events',
      time: created(e),
      author: e.createdByName,
      authorId: e.createdBy,
      text: `nouvel événement : ${e.name}`,
      detail: [`${new Date(e.date + 'T00:00:00').toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}`, e.place].filter(Boolean).join(', '),
      to: `/evenements/${e.id}`,
    })
  }

  // Groupes : un par un (les groupes privés des autres ne sont jamais sur l'appareil).
  for (const g of groups.filter((g) => recent(g))) {
    push({
      key: `g|${g.id}`,
      kind: 'groups',
      time: created(g),
      author: g.createdByName,
      authorId: g.createdBy,
      text: `nouveau groupe : ${g.name}${g.private ? ' (privé)' : ''}`,
      detail: plural(g.playerIds.length, 'joueur'),
      to: `/groupes/${g.id}`,
    })
  }

  // Validations d'avis spontanés et de fiches proposées : par validateur et par jour.
  const reviewed = [
    ...evaluations.map((e) => ({ r: e, what: 'avis' as const, pid: e.playerId })),
    ...players.filter((p) => !p.deleted).map((p) => ({ r: p, what: 'fiche' as const, pid: p.id })),
  ].filter(({ r, pid }) => r.reviewedAt && r.review !== 'pending' && Date.parse(r.reviewedAt) >= since && inSector(pid))
  for (const [k, rs] of bucket(reviewed, ({ r }) => `${r.reviewedBy ?? r.reviewedByName}|${localDay(Date.parse(r.reviewedAt!))}`)) {
    const count = (what: 'avis' | 'fiche', state: string) => rs.filter((x) => x.what === what && x.r.review === state).length
    const parts = [
      count('avis', 'validated') && `${plural(count('avis', 'validated'), 'avis', 'avis')} validé${count('avis', 'validated') > 1 ? 's' : ''}`,
      count('fiche', 'validated') && `${plural(count('fiche', 'validated'), 'fiche')} validée${count('fiche', 'validated') > 1 ? 's' : ''}`,
      count('avis', 'refused') + count('fiche', 'refused') && `${count('avis', 'refused') + count('fiche', 'refused')} hors cadre`,
    ].filter(Boolean)
    push({
      key: `r|${k}`,
      kind: 'reviews',
      time: Math.max(...rs.map(({ r }) => Date.parse(r.reviewedAt!))),
      author: rs[0].r.reviewedByName,
      authorId: rs[0].r.reviewedBy,
      text: parts.join(', '),
      detail: listNames([...new Set(rs.map((x) => x.pid))].map((id) => byId.get(id))),
      to: '/avis-spontanes',
    })
  }

  // Alertes : joueurs qui viennent d'entrer dans une de mes alertes (pas encore vus), datés de leur dernière activité.
  const { alerts, ctx } = await computeAlerts()
  for (const { alert, fresh } of alerts) {
    if (!fresh.length) continue
    const time = fresh.reduce((t, p) => Math.max(t, ctx.lastActivity.get(p.id) ?? 0), 0) || Date.now()
    push({
      key: `a|${alert.id}`,
      kind: 'alerts',
      time,
      text: `Alerte « ${alert.name} » : ${listNames(fresh)}`,
      detail: `${plural(fresh.length, 'nouveau joueur', 'nouveaux joueurs')} correspond${fresh.length > 1 ? 'ent' : ''}`,
      to: `/alertes/${alert.id}`,
    })
  }

  return out.sort((a, b) => b.time - a.time)
}

/** Prochains événements (aujourd'hui compris). */
export async function upcomingEvents(n: number) {
  const today = localDay(Date.now())
  return (await db.events.toArray()).filter((e) => !e.deleted && !e.archived && e.date >= today).sort((a, b) => a.date.localeCompare(b.date)).slice(0, n)
}

/** Dernière visite du fil (sur cet appareil), pour la pastille des nouveautés. */
const SEEN_KEY = 'handbase.feedSeen'
export function feedSeen() {
  try {
    // Première visite : les 3 derniers jours comptent comme nouveaux (pas tout l'historique).
    return Number(localStorage.getItem(SEEN_KEY) ?? Date.now() - 3 * 24 * 3600 * 1000)
  } catch {
    return Date.now()
  }
}
export function markFeedSeen() {
  try {
    localStorage.setItem(SEEN_KEY, String(Date.now()))
  } catch {
    /* stockage indisponible */
  }
}
