// Test de « Voir comme… » limité au périmètre du membre simulé : règle des lignes visibles (src/viewAsScope.ts : joueurs,
// lignes rattachées, vidéos, fiches créées par lui, pôle → ligue, sans affectation, fédération) et intergiciel Dexie
// (src/viewAsFilter.ts : get, getMany, query limitée ou sur les clés, count, curseur, transactions en écriture laissées
// telles quelles), sur une table factice. Données fictives seulement.
//
//   npx jiti tools/test-voir-comme.ts
import assert from 'node:assert/strict'
import type { DBCore, DBCoreCursor, DBCoreTable, DBCoreTransaction } from 'dexie'
import { perimeterOf } from '../src/perimeter'
import type { AssignmentRow, LevelRow, UnitRow } from '../src/structureTree'
import { setViewAsScope, viewAsMiddleware, viewAsScope } from '../src/viewAsFilter'
import { isScopedTable, previewText, rowVisible, visibleRows, type ViewAsScope } from '../src/viewAsScope'

let n = 0
const t = async (name: string, f: () => void | Promise<void>) => {
  await f()
  n++
  console.log(`ok ${n} - ${name}`)
}

// ---------- Structure fictive ----------
const L = (id: string, name: string, order: number): LevelRow => ({ id, name, order, updatedAt: 1 })
const levels = [L('niveau-federation', 'Fédération', 1), L('niveau-ligue', 'Ligue', 2), L('niveau-comite', 'Comité', 3), L('niveau-pole', 'Pôle', 4), L('niveau-club', 'Club', 5)]
const U = (id: string, levelId: string, name: string, parentId?: string, departments?: string[], clubNumber?: string): UnitRow => ({
  id,
  levelId,
  name,
  parentId,
  departments,
  clubNumber,
  updatedAt: 1,
})
const units = [
  U('fed', 'niveau-federation', 'Fédération Test'),
  U('ligue', 'niveau-ligue', 'Ligue Imaginaire', 'fed'),
  U('cA', 'niveau-comite', 'Comité Alpha (91)', 'ligue', ['91']),
  U('cB', 'niveau-comite', 'Comité Bêta (92)', 'ligue', ['92']),
  U('pole', 'niveau-pole', 'Pôle Espoirs Imaginaire', 'ligue'),
  U('club', 'niveau-club', 'Club Fictif', 'cA', [], '6391001'),
]
const A = (userId: string, unitId: string): AssignmentRow => ({ id: `${userId}-${unitId}`, userId, unitId, role: 'observateur', updatedAt: 1 })
const assignments = [A('u-comite', 'cA'), A('u-pole', 'pole'), A('u-fed', 'fed'), A('u-club', 'club')]
const per = (uid: string, admin = false) => perimeterOf({ userId: uid, admin, units, levels, assignments })

const players = [
  { id: 'p91', clubCode: '6391001' },
  { id: 'p91b', clubCode: '6391002' },
  { id: 'p92', clubCode: '6392001' },
  { id: 'p75', clubCode: '6375001' },
  { id: 'pMine', clubCode: '6375002', createdBy: 'u-comite' },
]
const scopeOf = (uid: string, admin = false): ViewAsScope => {
  const p = per(uid, admin)
  const s: ViewAsScope = { per: p, uid, players: new Set() }
  return { ...s, players: new Set(players.filter((x) => rowVisible('players', x, s)).map((x) => x.id)) }
}
const ids = (rows: { id: string }[]) => rows.map((r) => r.id)

// ---------- Règle ----------

await t('tables du périmètre seulement', () => {
  for (const x of ['players', 'measurements', 'evaluations', 'seen', 'rewatch', 'videos']) assert.ok(isScopedTable(x))
  for (const x of ['events', 'groups', 'criteria', 'units', 'outbox']) assert.ok(!isScopedTable(x))
})
await t('comité : son département, et ses propres fiches', () => {
  const s = scopeOf('u-comite')
  assert.deepEqual(ids(visibleRows('players', players, s)), ['p91', 'p91b', 'pMine'])
})
await t('pôle sans territoire : celui de sa ligue (91 et 92)', () => {
  assert.deepEqual(ids(visibleRows('players', players, scopeOf('u-pole'))), ['p91', 'p91b', 'p92'])
})
await t('club : ses joueurs seulement', () => {
  assert.deepEqual(ids(visibleRows('players', players, scopeOf('u-club'))), ['p91'])
})
await t('fédération ou administrateur : tout ; sans affectation : rien', () => {
  assert.equal(visibleRows('players', players, scopeOf('u-fed')).length, players.length)
  assert.equal(visibleRows('players', players, scopeOf('u-rien', true)).length, players.length)
  assert.deepEqual(visibleRows('players', players, scopeOf('u-rien')), [])
})
await t('lignes rattachées : suivent leur joueur, plus les siennes ; vidéos hors joueur visibles', () => {
  const s = scopeOf('u-comite')
  const evals = [
    { id: 'e1', playerId: 'p91' },
    { id: 'e2', playerId: 'p92' },
    { id: 'e3', playerId: 'p92', createdBy: 'u-comite' },
    { id: 'e4', playerId: 'inconnu' },
  ]
  assert.deepEqual(ids(visibleRows('evaluations', evals, s)), ['e1', 'e3'])
  const videos = [
    { id: 'v1', targetKind: 'player', targetId: 'p92' },
    { id: 'v2', targetKind: 'player', targetId: 'pMine' },
    { id: 'v3', targetKind: 'event', targetId: 'ev1' },
  ]
  assert.deepEqual(ids(visibleRows('videos', videos, s)), ['v2', 'v3'])
  // Autres tables : rien n'est filtré.
  assert.equal(visibleRows('events', [{ id: 'x' }], s).length, 1)
  assert.equal(visibleRows('players', players, null).length, players.length)
})
await t('bandeau : périmètre en clair, ou aucune affectation', () => {
  assert.deepEqual(previewText('Membre Test', per('u-comite')), { who: 'Membre Test', scope: 'Comité Alpha (91)' })
  assert.equal(previewText('Membre Test', per('u-rien')).scope, 'aucune affectation, aucun joueur')
  assert.equal(previewText('Membre Test', undefined).scope, '…')
})

// ---------- Intergiciel, sur une table factice ----------

type R = { id: string; clubCode?: string; createdBy?: string }
const ro = { mode: 'readonly' } as unknown as DBCoreTransaction
const rw = { mode: 'readwrite' } as unknown as DBCoreTransaction

function fakeCursor(rows: R[], values: boolean): DBCoreCursor | null {
  if (!rows.length) return null
  let i = 0
  let stopped = false
  let onNext: (() => void) | null = null
  let resolve: (v?: unknown) => void = () => {}
  const step = () => queueMicrotask(() => (stopped || i >= rows.length ? resolve() : onNext!()))
  const c: DBCoreCursor = {
    trans: ro,
    get key() {
      return rows[i]?.id
    },
    get primaryKey() {
      return rows[i]?.id
    },
    get value() {
      return values ? rows[i] : undefined
    },
    get done() {
      return i >= rows.length
    },
    continue: () => (i++, step()),
    continuePrimaryKey: () => (i++, step()),
    advance: (k: number) => ((i += k), step()),
    stop: () => ((stopped = true), resolve()),
    fail: () => ((stopped = true), resolve()),
    start: (f) => new Promise((r) => ((resolve = r), (onNext = f), step())),
    next: async () => c,
  }
  return c
}

const base = (rows: R[]): DBCoreTable =>
  ({
    name: 'players',
    schema: { primaryKey: { extractKey: (v: R) => v.id } },
    get: async ({ key }: { key: string }) => rows.find((r) => r.id === key),
    getMany: async ({ keys }: { keys: string[] }) => keys.map((k) => rows.find((r) => r.id === k)),
    query: async (q: { values?: boolean; limit?: number }) => {
      const out = rows.slice(0, q.limit ?? Infinity)
      return { result: q.values ? out : out.map((r) => r.id) }
    },
    count: async () => rows.length,
    openCursor: async (q: { values?: boolean }) => fakeCursor(rows, !!q.values),
    mutate: async () => ({ numFailures: 0, failures: {}, lastResult: undefined }),
  }) as unknown as DBCoreTable

const core = (rows: R[]) => {
  const down = { stack: 'dbcore', table: () => base(rows) } as unknown as DBCore
  return viewAsMiddleware.create(down) as DBCore
}
const q = { index: {}, range: {} } as never

await t('intergiciel : rien de filtré sans périmètre posé', async () => {
  setViewAsScope(null)
  const tb = core(players).table('players')
  assert.equal((await tb.query({ trans: ro, values: true, query: q })).result.length, players.length)
  assert.equal(await tb.count({ trans: ro, query: q }), players.length)
})
await t('intergiciel : membre qui voit tout → aucun filtre posé', () => {
  setViewAsScope(scopeOf('u-fed'))
  assert.equal(viewAsScope(), null)
})
await t('intergiciel : get, getMany, query (limite, clés), count, curseur', async () => {
  setViewAsScope(scopeOf('u-comite'))
  const tb = core(players).table('players')
  assert.equal(await tb.get({ trans: ro, key: 'p92' }), undefined)
  assert.equal((await tb.get({ trans: ro, key: 'p91' }))?.id, 'p91')
  assert.deepEqual((await tb.getMany({ trans: ro, keys: ['p92', 'pMine'] })).map((r) => r?.id), [undefined, 'pMine'])
  assert.deepEqual(ids((await tb.query({ trans: ro, values: true, query: q })).result), ['p91', 'p91b', 'pMine'])
  // Limite appliquée après le filtre : les 2 premiers VISIBLES.
  assert.deepEqual(ids((await tb.query({ trans: ro, values: true, limit: 2, query: q })).result), ['p91', 'p91b'])
  // Clés seules : jugées sur les valeurs, rendues en clés.
  assert.deepEqual((await tb.query({ trans: ro, values: false, query: q })).result, ['p91', 'p91b', 'pMine'])
  assert.equal(await tb.count({ trans: ro, query: q }), 3)
  const seen: string[] = []
  const c = await tb.openCursor({ trans: ro, values: false, query: q })
  await c!.start(() => (seen.push(c!.primaryKey), c!.continue()))
  assert.deepEqual(seen, ['p91', 'p91b', 'pMine'])
})
await t('intergiciel : curseur dont aucune ligne n’est visible', async () => {
  setViewAsScope(scopeOf('u-rien'))
  const tb = core(players).table('players')
  const seen: string[] = []
  const c = await tb.openCursor({ trans: ro, values: true, query: q })
  await c!.start(() => (seen.push(c!.primaryKey), c!.continue()))
  assert.deepEqual(seen, [])
  assert.equal(await tb.count({ trans: ro, query: q }), 0)
})
await t('intergiciel : transactions en écriture (synchronisation) voient tout', async () => {
  setViewAsScope(scopeOf('u-comite'))
  const tb = core(players).table('players')
  assert.equal((await tb.get({ trans: rw, key: 'p92' }))?.id, 'p92')
  assert.equal((await tb.query({ trans: rw, values: true, query: q })).result.length, players.length)
  assert.equal(await tb.count({ trans: rw, query: q }), players.length)
})
await t('intergiciel : tables hors périmètre non enveloppées', async () => {
  setViewAsScope(scopeOf('u-rien'))
  const tb = core(players).table('events')
  assert.equal((await tb.query({ trans: ro, values: true, query: q })).result.length, players.length)
  setViewAsScope(null)
})

console.log(`\n${n} tests passés`)
