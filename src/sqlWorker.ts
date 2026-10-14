// « Poser une question », mode avancé : Web Worker qui tient la COPIE LOCALE jetable (src/sqlMirror.ts) dans SQLite WASM
// (sql.js, chargé ici à la demande seulement) et y exécute les requêtes déjà contrôlées (src/sqlGuard.ts). L'écran ne se
// bloque pas ; une requête trop longue est coupée en arrêtant ce worker (src/sqlClient.ts). Base en mémoire, en lecture
// seule après remplissage : IndexedDB et Supabase ne sont jamais touchés d'ici.
import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js'
import wasmUrl from 'sql.js/dist/sql-wasm-browser.wasm?url'
import { loadMirror, type MirrorTable } from './sqlMirror'
import { SQL_MAX_ROWS } from './sqlGuard'

type In = { id: number; type: 'build'; tables: MirrorTable[] } | { id: number; type: 'exec'; sql: string }

const scope = self as unknown as { postMessage(m: unknown): void; onmessage: ((e: MessageEvent<In>) => void) | null }
let engine: Promise<SqlJsStatic> | null = null
let base: Database | null = null

scope.onmessage = async (e) => {
  const m = e.data
  try {
    if (m.type === 'build') {
      const t0 = performance.now()
      engine ??= initSqlJs({ locateFile: () => wasmUrl })
      const SQL = await engine
      base?.close()
      base = null
      const db = new SQL.Database()
      loadMirror(db, m.tables)
      base = db
      scope.postMessage({ id: m.id, ok: true, ms: Math.round(performance.now() - t0) })
    } else {
      if (!base) throw new Error('copie absente')
      const t0 = performance.now()
      const res = base.exec(m.sql)
      const last = res[res.length - 1]
      // Valeurs binaires : jamais affichées.
      const rows = (last?.values ?? []).slice(0, SQL_MAX_ROWS).map((r) => r.map((v) => (v instanceof Uint8Array ? null : v)))
      scope.postMessage({ id: m.id, ok: true, columns: last?.columns ?? [], rows, ms: Math.round(performance.now() - t0) })
    }
  } catch (err) {
    scope.postMessage({ id: m.id, ok: false, error: String((err as Error)?.message ?? err).slice(0, 300) })
  }
}
