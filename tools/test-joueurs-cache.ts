// Test des parties pures de la liste Joueurs gardée en mémoire (src/playersOrder.ts, src/playersCache.ts) : la liste lue
// par la clé primaire puis rangée ici a le même ordre que l'index « lastName » d'IndexedDB ; les premières fiches montrées
// avant que tout soit lu (fiches gardées par inPlainList, dans cet ordre) sont exactement le début de la liste que calcule
// la recette (src/playerQuery.ts selectPlayers), sans filtre ou avec le seul filtre « Masculin / Féminin » ; la dernière
// mesure retenue ne dépend pas de l'ordre de lecture. (Vérifié aussi dans un vrai navigateur, sur IndexedDB :
// tools/bench-page-joueurs.mjs, lignes « ordreIdentique », « premieresIdentiques ».)
//
//   npx jiti tools/test-joueurs-cache.ts
import assert from 'node:assert/strict'
import type { Measurement, Player } from '../src/db'
import { byLastName, cmpKey, inPlainList, latestByPlayer } from '../src/playersOrder'
import { buildPlayersIndex, cleanQuery, EMPTY_QUERY, selectPlayers } from '../src/playerQuery'
import { cleanRecipe } from '../src/recipe'

// ---------- Comparaison des clés (celle d'IndexedDB) ----------
assert.ok(cmpKey(5, 'a') < 0, 'un nombre avant un texte')
assert.ok(cmpKey('a', 5) > 0)
assert.ok(cmpKey('B', 'a') < 0, 'majuscules avant minuscules (unités de code)')
assert.ok(cmpKey('Zz', 'É') < 0, 'lettre accentuée après Z (unités de code, pas l’ordre français)')
assert.ok(cmpKey('', ' ') < 0, 'texte vide en premier')
assert.equal(cmpKey('Dupont', 'Dupont'), 0)

// ---------- Ordre de l'index ----------
const mk = (id: string, lastName: unknown, extra: Partial<Player> = {}) => ({ id, lastName, firstName: 'Test', updatedAt: 1, ...extra }) as unknown as Player
const rows = [
  mk('p9', 'Martin'),
  mk('p1', 'martin'),
  mk('p3', 'Martin'),
  mk('p4', 'Élise'),
  mk('p5', 'de la Tour'),
  mk('p6', 'De La Tour'),
  mk('p7', ''),
  mk('p8', undefined),
  mk('p2', 'Zz'),
  mk('p0', 42),
  mk('pa', null),
]
// Référence : tri par unités de code, à égalité par identifiant ; sans nom valable (ni texte ni nombre) : absente.
assert.deepEqual(
  byLastName(rows).map((p) => p.id),
  ['p0', 'p7', 'p6', 'p3', 'p9', 'p2', 'p5', 'p1', 'p4'],
)
assert.deepEqual(
  byLastName([...rows].reverse()).map((p) => p.id),
  byLastName(rows).map((p) => p.id),
  'même ordre quel que soit l’ordre de lecture',
)

// ---------- Premières fiches = début de la liste de la recette ----------
// Fiches fictives : noms tirés de syllabes, quelques supprimées, fondues, proposées, hors cadre, sans sexe.
let seed = 3
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31)
const SYL = ['ma', 'ri', 'lo', 'du', 'pon', 'Ber', 'é', 'le', 'De ', 'vre']
const players: Player[] = Array.from({ length: 3000 }, (_, i) =>
  mk(`id-${(i * 7919) % 3001}`, SYL[Math.floor(rnd() * SYL.length)] + SYL[Math.floor(rnd() * SYL.length)], {
    sex: i % 11 === 0 ? undefined : rnd() < 0.5 ? 'M' : 'F',
    birthDate: `20${10 + (i % 4)}-0${1 + (i % 9)}-15`,
    deleted: i % 97 === 0 || undefined,
    mergedInto: i % 89 === 1 ? 'id-1' : undefined,
    review: i % 53 === 0 ? 'refused' : i % 31 === 0 ? 'pending' : i % 17 === 0 ? 'validated' : undefined,
  }),
)
// Comme la page : fiches non supprimées par nom (src/playersCache.ts), puis la vue « Base » (hors cadre écartées).
const all = byLastName(players.filter((p) => !p.deleted))
const base = all.filter((p) => p.review !== 'refused')
const ix = buildPlayersIndex<Player>({ players: base, sights: [], evals: [], measures: [], criteria: [], groups: [], events: [], deptOf: () => undefined, regionOf: () => undefined, today: '2026-10-25' })
for (const sex of [undefined, 'M', 'F'] as const) {
  const qy = sex ? cleanQuery({ recipe: cleanRecipe({ pop: { sex } }), q: '' }) : EMPTY_QUERY
  const list = selectPlayers(ix, qy, () => '', () => []).list
  const preview = players.filter((p) => inPlainList(p, sex))
  const first = byLastName(preview).slice(0, 60)
  assert.equal(first.length, 60)
  assert.deepEqual(first.map((p) => p.id), list.slice(0, 60).map((p) => p.id), `premières fiches identiques (${sex ?? 'sans filtre'})`)
  assert.equal(byLastName(preview).length, list.length, `même nombre de fiches (${sex ?? 'sans filtre'})`)
}

// ---------- Dernière mesure : indépendante de l'ordre de lecture ----------
const m = (id: string, playerId: string, criterionId: string, value: number, date: string, updatedAt = 1) => ({ id, playerId, criterionId, value, date, updatedAt }) as Measurement
const ms = [
  m('m1', 'a', 'taille', 150, '2026-01-01'),
  m('m2', 'a', 'taille', 152, '2026-03-01'),
  m('m3', 'a', 'taille', 153, '2026-03-01'), // même jour, même date de modification : la première lue (m2) l'emporte
  m('m4', 'a', 'poids', 40, '2026-03-01', 2),
  m('m5', 'a', 'poids', 41, '2026-03-01', 3), // même jour, modifiée plus tard : l'emporte
  { ...m('m6', 'b', 'taille', 170, '2026-05-01'), deleted: true },
  m('m7', 'b', 'taille', 160, '2026-02-01'),
]
// Lecture complète : poids puis taille, par identifiant (index « criterionId ») ; premières fiches : par joueur, puis
// rangées de même (src/playersCache.ts readPlainPreview).
const full = [...ms].sort((x, y) => cmpKey(x.criterionId, y.criterionId) || cmpKey(x.id, y.id))
const byPlayer = [...ms].sort((x, y) => cmpKey(x.playerId, y.playerId) || cmpKey(x.id, y.id)).sort((x, y) => cmpKey(x.criterionId, y.criterionId) || cmpKey(x.id, y.id))
const pick = (l: ReturnType<typeof latestByPlayer>) => [...l].map(([p, c]) => `${p}:${[...c].map(([k, v]) => `${k}=${v.id}`).sort().join(',')}`).sort()
assert.deepEqual(pick(latestByPlayer(full)), ['a:poids=m5,taille=m2', 'b:taille=m7'])
assert.deepEqual(pick(latestByPlayer(byPlayer)), pick(latestByPlayer(full)))

console.log('test-joueurs-cache : OK')
