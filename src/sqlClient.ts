// « Poser une question », mode avancé : côté écran du Web Worker SQLite (src/sqlWorker.ts).
//  - la copie locale (src/sqlMirror.ts) est construite à la première requête, gardée en mémoire tant qu'on reste dans le
//    bilan (/bilan…), refaite quand les données de l'appareil ont changé (signature), jetée en quittant le bilan ;
//  - chaque requête est recontrôlée (src/sqlGuard.ts) puis exécutée dans le worker ; au-delà de SQL_TIMEOUT_MS, le worker
//    est arrêté (la requête est coupée, la copie sera refaite à la prochaine) ;
//  - résultats gardés en mémoire pour la même copie (retour d'une fiche joueur : même réponse, tout de suite).
import { guardSql } from './sqlGuard'
import { buildMirrorTables, mirrorSignature, type Cell, type MirrorInput } from './sqlMirror'

export const SQL_TIMEOUT_MS = 3000
const BUILD_TIMEOUT_MS = 30_000

export type SqlResult = { columns: string[]; rows: Cell[][]; ms: number }

export class SqlRunError extends Error {
  /** invalide : refusée avant exécution ; sql : erreur SQLite ; delai : trop longue ; moteur : SQLite indisponible. */
  kind: 'invalide' | 'sql' | 'delai' | 'moteur'
  constructor(kind: SqlRunError['kind'], message: string) {
    super(message)
    this.kind = kind
  }
}

type Pending = { resolve: (v: Record<string, unknown>) => void; reject: (e: Error) => void; timer: number }
let worker: Worker | null = null
let builtSig: string | null = null
let building: { sig: string; p: Promise<number> } | null = null
let seq = 0
const pending = new Map<number, Pending>()
const cache = new Map<string, SqlResult>()

function stop(reason: SqlRunError) {
  worker?.terminate()
  worker = null
  builtSig = null
  building = null
  cache.clear()
  for (const [id, p] of pending) {
    window.clearTimeout(p.timer)
    p.reject(reason)
    pending.delete(id)
  }
}

function getWorker(): Worker {
  if (worker) return worker
  const w = new Worker(new URL('./sqlWorker.ts', import.meta.url), { type: 'module' })
  w.onmessage = (e: MessageEvent<Record<string, unknown>>) => {
    const p = pending.get(e.data.id as number)
    if (!p) return
    pending.delete(e.data.id as number)
    window.clearTimeout(p.timer)
    if (e.data.ok) p.resolve(e.data)
    else p.reject(new SqlRunError('sql', String(e.data.error ?? 'erreur SQLite')))
  }
  w.onerror = () => stop(new SqlRunError('moteur', 'Moteur de calcul indisponible sur cet appareil.'))
  worker = w
  return w
}

function call(msg: Record<string, unknown>, timeout: number): Promise<Record<string, unknown>> {
  const w = getWorker()
  const id = ++seq
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => stop(new SqlRunError('delai', `Calcul trop long : arrêté au bout de ${Math.round(timeout / 1000)} secondes.`)), timeout)
    pending.set(id, { resolve, reject, timer })
    w.postMessage({ id, ...msg })
  })
}

/** Copie à jour (construite ou refaite si les données ont changé) ; renvoie la durée de construction (0 : déjà prête). */
export async function ensureMirror(input: () => MirrorInput): Promise<number> {
  const data = input()
  const sig = mirrorSignature(data)
  if (worker && builtSig === sig) return 0
  if (building?.sig === sig) return building.p
  const t0 = performance.now()
  const p = (async () => {
    const tables = buildMirrorTables(data)
    await call({ type: 'build', tables }, BUILD_TIMEOUT_MS)
    builtSig = sig
    cache.clear()
    return Math.round(performance.now() - t0)
  })()
  building = { sig, p }
  try {
    return await p
  } finally {
    if (building?.p === p) building = null
  }
}

/** Contrôle puis exécute une requête sur la copie à jour. */
export async function runSql(sql: string, input: () => MirrorInput): Promise<SqlResult> {
  const g = guardSql(sql)
  if (!g.ok) throw new SqlRunError('invalide', g.error)
  await ensureMirror(input)
  const key = `${builtSig}\n${g.sql}`
  const hit = cache.get(key)
  if (hit) return hit
  const r = await call({ type: 'exec', sql: g.sql }, SQL_TIMEOUT_MS)
  const out: SqlResult = { columns: r.columns as string[], rows: r.rows as Cell[][], ms: r.ms as number }
  if (cache.size > 30) cache.clear()
  cache.set(key, out)
  return out
}

/** Résultat déjà calculé pour cette requête (copie actuelle), sans attendre. */
export function cachedSql(sql: string): SqlResult | undefined {
  const g = guardSql(sql)
  return g.ok && builtSig ? cache.get(`${builtSig}\n${g.sql}`) : undefined
}

// ---------- Durée de vie : tant qu'on reste dans le bilan ----------

let users = 0
let watch: number | undefined
const inBilan = () => typeof window !== 'undefined' && /\/bilan(\/|$)/.test(window.location.pathname)

/** Écran qui se sert de la copie : à appeler au montage ; renvoie la fonction à appeler au démontage. */
export function holdMirror(): () => void {
  users++
  if (watch !== undefined) {
    window.clearInterval(watch)
    watch = undefined
  }
  return () => {
    users--
    if (users > 0 || watch !== undefined) return
    // Plus personne : la copie est gardée tant que l'adresse reste dans le bilan, jetée dès qu'on en sort.
    watch = window.setInterval(() => {
      if (users > 0) {
        window.clearInterval(watch)
        watch = undefined
      } else if (!inBilan()) {
        window.clearInterval(watch)
        watch = undefined
        stop(new SqlRunError('moteur', 'Copie fermée.'))
      }
    }, 2000)
  }
}
