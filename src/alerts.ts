import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useState } from 'react'
import { snapshots } from './components/MaturityCard'
import { department } from './components/PlayerFilter'
import { birthQuarter } from './components/ui'
import { alive, counts, db, positionLabel, type AlertRules, type Criterion, type Evaluation, type Measurement, type Player, type PlayerAlert } from './db'
import { departmentLabel } from './lists'
import { latestByPlayer } from './pages/Players'
import { can } from './roles'

/*
 * Alertes (supabase/022_alertes.sql) : chaque appareil calcule quels joueurs correspondent aux conditions
 * d'une alerte et signale ceux qui viennent d'y entrer. « Déjà vus » : gardé sur l'appareil, par alerte ;
 * à la première ouverture d'une alerte, ses joueurs du moment forment la liste de départ (pas d'avalanche).
 */

/** Données nécessaires au calcul, lues une fois pour toutes les alertes. */
export interface AlertContext {
  players: Player[]
  measurements: Measurement[]
  latest: Map<string, Map<string, Measurement>>
  byPlayer: Map<string, Measurement[]>
  avis: Map<string, Evaluation[]>
  criteria: Criterion[]
  /** Dernière activité de chaque joueur (fiche, mesure, avis), pour dater une alerte. */
  lastActivity: Map<string, number>
}

const created = (r: { createdAtServer?: string; updatedAt: number }) => {
  const t = r.createdAtServer ? Date.parse(r.createdAtServer) : NaN
  return isNaN(t) ? r.updatedAt : t
}

export async function loadAlertContext(): Promise<AlertContext> {
  const [players, measurements, evaluations, criteria] = await Promise.all([
    db.players.toArray().then((ps) => alive(ps).filter((p) => !p.mergedInto && p.review !== 'refused')),
    db.measurements.toArray().then(alive),
    db.evaluations.toArray().then((es) => alive(es)),
    db.criteria.toArray().then(alive),
  ])
  const byPlayer = new Map<string, Measurement[]>()
  const lastActivity = new Map<string, number>()
  const touch = (id: string, t: number) => lastActivity.set(id, Math.max(lastActivity.get(id) ?? 0, t))
  for (const p of players) touch(p.id, created(p))
  for (const m of measurements) {
    const list = byPlayer.get(m.playerId)
    if (list) list.push(m)
    else byPlayer.set(m.playerId, [m])
    touch(m.playerId, created(m))
  }
  const avis = new Map<string, Evaluation[]>()
  for (const e of evaluations) {
    touch(e.playerId, created(e))
    if (!counts(e)) continue
    const list = avis.get(e.playerId)
    if (list) list.push(e)
    else avis.set(e.playerId, [e])
  }
  return { players, measurements, latest: latestByPlayer(measurements), byPlayer, avis, criteria, lastActivity }
}

const num = (v: unknown) => (typeof v === 'number' ? v : undefined)

/** Taille adulte prédite (Khamis-Roche) à la dernière mesure, si elle est calculable. */
export function predictedHeight(p: Player, ctx: AlertContext) {
  return snapshots(p, ctx.byPlayer.get(p.id) ?? []).at(-1)?.kr?.predicted ?? undefined
}

export function matches(p: Player, r: AlertRules, ctx: AlertContext): boolean {
  if (r.sex && p.sex !== r.sex) return false
  if (r.years?.length && !r.years.includes(p.birthDate?.slice(0, 4) ?? '')) return false
  if (r.quarters?.length && !r.quarters.includes(birthQuarter(p.birthDate) ?? 0)) return false
  if (r.laterality && p.laterality !== r.laterality) return false
  if (r.positions?.length) {
    const own = [p.position, ...(r.withSecondary ? (p.secondaryPositions ?? []) : [])]
    if (!r.positions.some((x) => own.includes(x))) return false
  }
  if (r.departments?.length && !r.departments.includes(department(p) ?? '')) return false
  const latest = ctx.latest.get(p.id)
  if (r.minHeight) {
    const h = num(latest?.get('taille')?.value)
    if (h === undefined || h < r.minHeight) return false
  }
  for (const t of r.tests ?? []) {
    const v = num(latest?.get(t.criterionId)?.value)
    if (v === undefined || (t.op === 'min' ? v < t.value : v > t.value)) return false
  }
  for (const a of r.avis ?? []) {
    const vs = (ctx.avis.get(p.id) ?? []).map((e) => num(e.scores[a.criterionId])).filter((v): v is number => v !== undefined)
    if (!vs.length || vs.reduce((x, y) => x + y, 0) / vs.length < a.min) return false
  }
  if (r.minPredicted) {
    const ph = predictedHeight(p, ctx)
    if (ph === undefined || ph < r.minPredicted) return false
  }
  return true
}

export const matchAlert = (a: PlayerAlert, ctx: AlertContext) => ctx.players.filter((p) => matches(p, a.rules, ctx))

/** Résumé lisible des conditions : « Garçons · 2010, 2011 · gauchers · taille prédite ≥ 190 cm ». */
export function rulesSummary(r: AlertRules, criteria: Criterion[]) {
  const label = (id: string) => criteria.find((c) => c.id === id)
  return [
    r.sex === 'M' ? 'Garçons' : r.sex === 'F' ? 'Filles' : '',
    r.years?.length ? r.years.join(', ') : '',
    r.quarters?.length ? r.quarters.map((q) => `Q${q}`).join(', ') : '',
    r.laterality ? { droitier: 'droitiers', gaucher: 'gauchers', ambidextre: 'ambidextres' }[r.laterality] : '',
    r.positions?.length ? r.positions.map((x) => positionLabel(x)).join(', ') + (r.withSecondary ? ' (+ secondaires)' : '') : '',
    r.departments?.length ? r.departments.map(departmentLabel).join(', ') : '',
    r.minHeight ? `taille ≥ ${r.minHeight} cm` : '',
    r.minPredicted ? `taille adulte prédite ≥ ${r.minPredicted} cm` : '',
    ...(r.tests ?? []).map((t) => {
      const c = label(t.criterionId)
      return `${c?.label ?? t.criterionId} ${t.op === 'min' ? '≥' : '≤'} ${t.value.toLocaleString('fr-FR')}${c?.unit ? ` ${c.unit}` : ''}`
    }),
    ...(r.avis ?? []).map((a) => `avis « ${label(a.criterionId)?.label ?? a.criterionId} » ≥ ${a.min.toLocaleString('fr-FR')}`),
  ]
    .filter(Boolean)
    .join(' · ') || 'Aucune condition : tous les joueurs'
}

// ---------- « Déjà vus » (sur l'appareil) ----------

const SEEN_KEY = 'handbase.alerts.seen'
type Seen = Record<string, string[]>
function readSeen(): Seen {
  try {
    return JSON.parse(localStorage.getItem(SEEN_KEY) ?? '{}') as Seen
  } catch {
    return {}
  }
}
// Les « déjà vus » ne sont pas dans la base : on prévient nous-mêmes la cloche et le fil quand ils changent.
let seenVersion = 0
const seenListeners = new Set<() => void>()
function writeSeen(s: Seen) {
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify(s))
  } catch {
    /* stockage indisponible */
  }
  seenVersion++
  seenListeners.forEach((l) => l())
}

/** Change quand des joueurs d'alerte sont marqués comme vus (à mettre dans les dépendances d'un useLiveQuery). */
export function useSeenVersion() {
  const [v, setV] = useState(seenVersion)
  useEffect(() => {
    const l = () => setV(seenVersion)
    seenListeners.add(l)
    return () => {
      seenListeners.delete(l)
    }
  }, [])
  return v
}

/** Joueurs déjà vus pour cette alerte ; la première fois, ceux du moment (liste de départ). */
export function seenFor(alertId: string, current: string[]): Set<string> {
  const s = readSeen()
  if (!s[alertId]) {
    s[alertId] = current
    writeSeen(s)
  }
  return new Set(s[alertId])
}

export function resetSeen(alertId: string, ids: string[]) {
  const s = readSeen()
  s[alertId] = ids
  writeSeen(s)
}

export function markSeen(alertId: string, ids: string[]) {
  const s = readSeen()
  s[alertId] = [...new Set([...(s[alertId] ?? []), ...ids])]
  writeSeen(s)
}

/** Alertes visibles avec leurs joueurs et les nouveaux (entrés depuis la dernière visite). */
export async function computeAlerts() {
  const [alerts, ctx] = await Promise.all([db.alerts.toArray().then((as) => alive(as).filter(can.seeGroup)), loadAlertContext()])
  return {
    ctx,
    alerts: alerts
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((alert) => {
        const players = matchAlert(alert, ctx)
        const seen = seenFor(alert.id, players.map((p) => p.id))
        return { alert, players, fresh: players.filter((p) => !seen.has(p.id)) }
      }),
  }
}

/** Nombre total de nouveaux joueurs dans mes alertes (cloche de l'en-tête). */
export function useAlertCount() {
  const v = useSeenVersion()
  return useLiveQuery(async () => (await computeAlerts()).alerts.reduce((n, a) => n + a.fresh.length, 0), [v], 0)
}
