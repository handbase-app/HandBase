/*
 * « Voir comme… » : le filtre du périmètre du membre simulé, posé sous tous les écrans (intergiciel Dexie, niveau « dbcore »).
 * Branché par db.ts seulement pendant la simulation (spy.ts recharge l'appli en y entrant et en sortant) : hors simulation,
 * la base locale est lue telle quelle, sans détour.
 *
 * Toute LECTURE (transaction en lecture seule : listes, recherche, fiches, bilan, questions, exports…) des tables du
 * périmètre (joueurs, mesures, avis, « vu », « à revoir », vidéos) ne rend que les lignes visibles du membre
 * (src/viewAsScope.ts). Les transactions en écriture (synchronisation : comparaison des versions, lignes à oublier) voient
 * tout : la base de l'administrateur n'est jamais touchée par la simulation.
 *
 * get / getMany : ligne cachée → absente ; query : filtrée, puis limitée ; count : compte des visibles ; openCursor :
 * curseur qui saute les lignes cachées. Les requêtes sur les clés seules sont lues avec les valeurs (pour juger), puis
 * ramenées aux clés.
 */
import type { DBCore, DBCoreCursor, DBCoreTable, DBCoreTransaction, Middleware } from 'dexie'
import { isScopedTable, rowVisible, type ViewAsScope } from './viewAsScope'

let scope: ViewAsScope | null = null

/** Périmètre appliqué (null : rien n'est filtré, en attendant le premier calcul ou pour un membre qui voit tout). */
export const viewAsScope = () => scope
export function setViewAsScope(s: ViewAsScope | null) {
  scope = s && !s.per.all ? s : null
}

const readonly = (trans: DBCoreTransaction) => (trans as { mode?: string }).mode !== 'readwrite'

/** Curseur qui saute les lignes cachées (start, next) ; le reste est délégué. */
function filteredCursor(c: DBCoreCursor, hidden: (v: unknown) => boolean): DBCoreCursor {
  return {
    get trans() {
      return c.trans
    },
    get key() {
      return c.key
    },
    get primaryKey() {
      return c.primaryKey
    },
    get value() {
      return c.value
    },
    get done() {
      return c.done
    },
    continue: (k?: unknown) => c.continue(k),
    continuePrimaryKey: (k: unknown, pk: unknown) => c.continuePrimaryKey(k, pk),
    advance: (n: number) => c.advance(n),
    stop: (v?: unknown) => c.stop(v),
    fail: (e: Error) => c.fail(e),
    start(onNext: () => void) {
      return c.start(() => (!c.done && hidden(c.value) ? c.continue() : onNext()))
    },
    async next() {
      let n = await c.next()
      while (!n.done && hidden(n.value)) n = await c.next()
      return this
    },
  }
}

function filteredTable(t: DBCoreTable): DBCoreTable {
  const name = t.name
  const hidden = (v: unknown) => !!scope && v != null && !rowVisible(name, v, scope)
  const active = (trans: DBCoreTransaction) => !!scope && readonly(trans)
  const pk = (v: unknown) => t.schema.primaryKey.extractKey?.(v) ?? (v as { id?: unknown }).id
  return {
    ...t,
    async get(req) {
      const v = await t.get(req)
      return active(req.trans) && hidden(v) ? undefined : v
    },
    async getMany(req) {
      const vs = await t.getMany(req)
      return active(req.trans) ? vs.map((v) => (hidden(v) ? undefined : v)) : vs
    },
    async query(req) {
      if (!active(req.trans)) return t.query(req)
      const { result } = await t.query({ ...req, values: true, limit: undefined })
      const kept = result.filter((v) => !hidden(v))
      const limited = req.limit != null && req.limit < kept.length ? kept.slice(0, req.limit) : kept
      return { result: req.values ? limited : limited.map(pk) }
    },
    async count(req) {
      if (!active(req.trans)) return t.count(req)
      const { result } = await t.query({ trans: req.trans, query: req.query, values: true })
      return result.filter((v) => !hidden(v)).length
    },
    async openCursor(req) {
      if (!active(req.trans)) return t.openCursor(req)
      const c = await t.openCursor({ ...req, values: true })
      return c && filteredCursor(c, hidden)
    },
  }
}

export const viewAsMiddleware: Middleware<DBCore> = {
  stack: 'dbcore',
  name: 'VoirComme',
  create: (down) => ({
    ...down,
    table: (name: string) => (isScopedTable(name) ? filteredTable(down.table(name)) : down.table(name)),
  }),
}
