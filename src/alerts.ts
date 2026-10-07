import { useEffect, useState } from 'react'
import { snapshots } from './components/MaturityCard'
import { department } from './components/PlayerFilter'
import { birthQuarter } from './components/ui'
import { alive, counts, db, positionLabel, type AlertRules, type Criterion, type Evaluation, type Measurement, type Player, type PlayerAlert } from './db'
import { zoneSummary } from './lists'
import { sharedQuery, useShared } from './live'
import { latestByPlayer } from './pages/Players'
import { can, currentUserId, useRole } from './roles'

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

/** Moyenne des avis validés d'un joueur sur un critère (undefined : aucun avis). */
function avisMean(p: Player, criterionId: string, ctx: AlertContext) {
  const vs = (ctx.avis.get(p.id) ?? []).map((e) => num(e.scores[criterionId])).filter((v): v is number => v !== undefined)
  return vs.length ? vs.reduce((x, y) => x + y, 0) / vs.length : undefined
}

/**
 * Valeurs chiffrées d'une alerte pour ce joueur : pour chaque condition, la valeur (ou undefined si elle
 * n'est pas connue), le seuil est-il respecté, et garde-t-on le joueur quand la valeur manque.
 */
function numericChecks(p: Player, r: AlertRules, ctx: AlertContext, criteria?: Criterion[]) {
  const latest = ctx.latest.get(p.id)
  const label = (id: string) => criteria?.find((c) => c.id === id)?.label ?? id
  const checks: { label: string; value?: number; ok: boolean; keepMissing: boolean }[] = []
  if (r.minHeight) {
    const v = num(latest?.get('taille')?.value)
    checks.push({ label: 'taille', value: v, ok: v !== undefined && v >= r.minHeight, keepMissing: !!r.keepMissingHeight })
  }
  for (const t of r.tests ?? []) {
    const v = num(latest?.get(t.criterionId)?.value)
    checks.push({ label: label(t.criterionId), value: v, ok: v !== undefined && (t.op === 'min' ? v >= t.value : v <= t.value), keepMissing: !!t.keepMissing })
  }
  for (const a of r.avis ?? []) {
    const v = avisMean(p, a.criterionId, ctx)
    checks.push({ label: `avis ${label(a.criterionId)}`, value: v, ok: v !== undefined && v >= a.min, keepMissing: !!a.keepMissing })
  }
  // Taille prédite en dernier : son calcul est le plus coûteux.
  if (r.minPredicted) {
    const v = predictedHeight(p, ctx)
    checks.push({ label: 'prédite', value: v, ok: v !== undefined && v >= r.minPredicted, keepMissing: !r.dropMissingPredicted })
  }
  return checks
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
  // Valeur sous le seuil : exclu ; valeur inconnue : gardé seulement si la condition le prévoit.
  return numericChecks(p, r, ctx).every((c) => c.ok || (c.value === undefined && c.keepMissing))
}

/** Conditions gardées faute de valeur (« prédite ? », « CMJ hauteur ? ») : à vérifier sur ce joueur. */
export function missingFor(p: Player, r: AlertRules, ctx: AlertContext, criteria: Criterion[]) {
  return numericChecks(p, r, ctx, criteria)
    .filter((c) => c.value === undefined)
    .map((c) => c.label)
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
    r.departments?.length ? zoneSummary(r.departments) : '',
    r.minHeight ? `taille ≥ ${r.minHeight} cm${r.keepMissingHeight ? ' (ou inconnue)' : ''}` : '',
    r.minPredicted ? `taille adulte prédite ≥ ${r.minPredicted} cm${r.dropMissingPredicted ? '' : ' (ou inconnue)'}` : '',
    ...(r.tests ?? []).map((t) => {
      const c = label(t.criterionId)
      return `${c?.label ?? t.criterionId} ${t.op === 'min' ? '≥' : '≤'} ${t.value.toLocaleString('fr-FR')}${c?.unit ? ` ${c.unit}` : ''}${t.keepMissing ? ' (ou non testé)' : ''}`
    }),
    ...(r.avis ?? []).map((a) => `avis « ${label(a.criterionId)?.label ?? a.criterionId} » ≥ ${a.min.toLocaleString('fr-FR')}${a.keepMissing ? ' (ou sans avis)' : ''}`),
  ]
    .filter(Boolean)
    .join(' · ') || 'Aucune condition : tous les joueurs'
}

// ---------- « Déjà vus » (sur l'appareil) ----------

const SEEN_KEY = 'handbase.alerts.seen'
type Seen = Record<string, string[]>
// Lu une seule fois (les listes peuvent être longues) ; relu si un autre onglet les change.
let seenCache: Seen | null = null
const seenSets = new Map<string, Set<string>>()
function readSeen(): Seen {
  if (!seenCache) {
    try {
      seenCache = JSON.parse(localStorage.getItem(SEEN_KEY) ?? '{}') as Seen
    } catch {
      seenCache = {}
    }
  }
  return seenCache
}
if (typeof window !== 'undefined')
  window.addEventListener('storage', (e) => {
    if (e.key !== SEEN_KEY && e.key !== null) return
    seenCache = null
    seenSets.clear()
    alertsStore.refresh()
  })
// Les « déjà vus » ne sont pas dans la base : on prévient nous-mêmes la cloche et le fil quand ils changent.
let seenVersion = 0
const seenListeners = new Set<() => void>()
function writeSeen(s: Seen) {
  seenCache = s
  seenSets.clear()
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify(s))
  } catch {
    /* stockage indisponible */
  }
  seenVersion++
  seenListeners.forEach((l) => l())
  alertsStore.refresh()
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
  if (!s[alertId]) writeSeen({ ...s, [alertId]: current })
  let set = seenSets.get(alertId)
  if (!set) seenSets.set(alertId, (set = new Set(readSeen()[alertId])))
  // Copie : l'appelant peut la modifier sans toucher au cache.
  return new Set(set)
}

export function resetSeen(alertId: string, ids: string[]) {
  writeSeen({ ...readSeen(), [alertId]: ids })
}

export function markSeen(alertId: string, ids: string[]) {
  const s = readSeen()
  writeSeen({ ...s, [alertId]: [...new Set([...(s[alertId] ?? []), ...ids])] })
}

const EMPTY_CONTEXT: AlertContext = { players: [], measurements: [], latest: new Map(), byPlayer: new Map(), avis: new Map(), criteria: [], lastActivity: new Map() }

/** Alertes visibles avec leurs joueurs et les nouveaux (entrés depuis la dernière visite). */
export async function computeAlerts() {
  const alerts = await db.alerts.toArray().then((as) => alive(as).filter(can.seeGroup))
  // Aucune alerte : inutile de lire toute la base.
  const ctx = alerts.length ? await loadAlertContext() : EMPTY_CONTEXT
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

/**
 * Calcul partagé par la cloche, la pastille de l'icône et le fil : un seul pour toute l'appli,
 * relancé au plus toutes les 1,5 s après un changement (pas à chaque paquet de la synchro).
 */
let computedFor: string | null | undefined
const alertsStore = sharedQuery(['players', 'measurements', 'evaluations', 'criteria', 'alerts'], () => {
  computedFor = currentUserId()
  return computeAlerts()
})

export type AlertsResult = Awaited<ReturnType<typeof computeAlerts>>

/** Mes alertes, calculées une fois pour toute l'appli (undefined pendant le premier calcul). */
export function useAlerts(): AlertsResult | undefined {
  // Autre compte : les alertes privées visibles changent.
  useRole()
  const uid = currentUserId()
  useEffect(() => {
    if (computedFor !== undefined && uid !== computedFor) alertsStore.refresh()
  }, [uid])
  return useShared(alertsStore)
}

/** Nombre total de nouveaux joueurs dans mes alertes (cloche de l'en-tête). */
export function useAlertCount() {
  return useAlerts()?.alerts.reduce((n, a) => n + a.fresh.length, 0) ?? 0
}
