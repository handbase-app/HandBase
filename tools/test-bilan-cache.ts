// Test des parties pures du bilan gardé en mémoire (src/keptMemo.ts, src/coverageCache.ts, src/coverage.ts clubKey) :
// un calcul gardé est rendu tel quel pour les mêmes entrées et refait pour d'autres ; les fiches supprimées, que l'ancienne
// lecture (`db.players.toArray()`) gardait et que la lecture partagée (src/playersCache.ts, `alive`) écarte, ne changent
// aucun chiffre du bilan ; la clé d'un club, retenue par écriture, est celle d'avant. (Chiffres affichés comparés aussi dans
// un vrai navigateur, avant / après, sur 40 000 fiches fictives : tools/bench-page-bilan.mjs --fingerprint / --compare.)
//
//   npx jiti tools/test-bilan-cache.ts
import assert from 'node:assert/strict'
import { alive } from '../src/db'
import { keptMemo } from '../src/keptMemo'
import { clubKey, coverageByClub, coverageByPlace, coverageByYear, fedReport, filterPlayers, lastSights, livePlayers, sortClubs, staffMeasured, tallest, toSights, type PlaceOf } from '../src/coverage'

// ---------- Calculs gardés ----------
{
  const kept = keptMemo(2)
  let runs = 0
  const calc = (deps: unknown[]) => kept('x', deps, () => (runs++, { deps }))
  const a = [1]
  const r1 = calc([a, 'M'])
  assert.equal(calc([a, 'M']), r1, 'mêmes entrées : même résultat, sans recalcul')
  assert.equal(runs, 1)
  assert.notEqual(calc([[1], 'M']), r1, 'autre objet (même contenu) : recalculé (comparaison par identité)')
  assert.equal(runs, 2)
  assert.equal(calc([a, 'M']), r1, 'deux résultats gardés : le premier est encore là')
  calc([a, 'F'])
  calc([a, 'all'])
  assert.equal(runs, 4)
  calc([a, 'M'])
  assert.equal(runs, 5, 'au-delà de `size` : le plus ancien est oublié')
  assert.equal(kept('x', [NaN], () => 'nan'), 'nan')
  assert.equal(kept('x', [NaN], () => 'autre'), 'nan', 'NaN = NaN (Object.is)')
  assert.equal(kept('y', [a, 'M'], () => 'y'), 'y', 'chaque nom a ses propres résultats')
  assert.equal(kept('x', [a], () => 'court'), 'court', 'nombre d’entrées différent : autre calcul')
  kept.clear()
  assert.equal(kept('y', [a, 'M'], () => 'neuf'), 'neuf', 'clear() oublie tout')
  // Le plus récemment servi reste : servi à nouveau, il passe devant.
  const k = keptMemo(2)
  k('z', [1], () => 1)
  k('z', [2], () => 2)
  k('z', [1], () => -1)
  k('z', [3], () => 3)
  assert.equal(k('z', [1], () => -1), 1, 'servi récemment : gardé')
  assert.equal(k('z', [2], () => -2), -2, 'le moins récemment servi est oublié')
}

// ---------- Clé d'un club (retenue par écriture) ----------
{
  const ref = (club?: string) =>
    (club ?? '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim()
  for (const c of [undefined, '', ' ', 'HBC Fictif', 'hbc  fictif ', 'Élan Sportif', 'ELAN sportif', '  AS\tFictive\n', 'Ølsen HB', 'Saint-Étienne HB'])
    for (let i = 0; i < 2; i++) assert.equal(clubKey(c), ref(c), `clé de « ${c} »`)
}

// ---------- Fiches supprimées : aucun chiffre ne bouge ----------
{
  // Tirage fixe (32 bits) : 3 000 joueurs fictifs, dont des supprimés, fondus, hors cadre, sans club, sans année.
  let s = 11
  const rnd = () => {
    s = (s + 0x6d2b79f5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const depts = ['13', '83', '06', '75', '2A', '974', '']
  const players = Array.from({ length: 3000 }, (_, i) => ({
    id: `p${i}`,
    birthDate: rnd() < 0.05 ? undefined : `${2008 + Math.floor(rnd() * 6)}-0${1 + Math.floor(rnd() * 9)}-15`,
    sex: rnd() < 0.5 ? ('M' as const) : rnd() < 0.95 ? ('F' as const) : undefined,
    club: rnd() < 0.05 ? undefined : `HBC Fictif ${Math.floor(rnd() * 40)}`,
    department: depts[Math.floor(rnd() * depts.length)] || undefined,
    deleted: rnd() < 0.08 ? true : undefined,
    mergedInto: rnd() < 0.02 ? 'p1' : undefined,
    review: rnd() < 0.03 ? ('refused' as const) : undefined,
  }))
  const kept = alive(players)
  assert.ok(kept.length < players.length && kept.length > 2000)
  const seen = players.filter(() => rnd() < 0.3).map((p, i) => ({ eventId: `ev${i % 7}`, playerId: p.id, at: `2026-${rnd() < 0.5 ? '10' : '03'}-1${i % 9}T10:00:00Z`, updatedAt: 0 }))
  const last = lastSights(toSights(seen, [], { deadEvents: new Set(['ev3']) }), { from: '2026-09-01', to: '2027-08-31' })
  const regionOf = (d: string) => (d === '13' || d === '83' || d === '06' ? 'sud' : d === '75' ? 'idf' : d === '2A' ? 'corse' : undefined)
  const place: PlaceOf<(typeof players)[number]> = { deptOf: (p) => p.department, regionOf }
  const ms = players.flatMap((p, i) => (i % 3 ? [{ playerId: p.id, criterionId: 'taille', value: 150 + (i % 40), date: '2026-03-10', updatedAt: i, author: i % 5 ? 'Staff Fictif' : 'Licence FFHB (déclarée)' }] : []))
  const { height } = staffMeasured(ms)
  const view = (rows: typeof players) => {
    const out: unknown[] = []
    for (const f of [{ sex: 'all' as const }, { sex: 'F' as const, years: ['2010', '2011'] }, { region: 'sud' }, { dept: '83' }, { dept: '?' }]) {
      const pop = filterPlayers(rows, f, place)
      out.push(pop.map((p) => p.id), coverageByPlace(pop, last, place), coverageByYear(pop, last), sortClubs('licencies', coverageByClub(pop, last)), fedReport(pop, last, place))
    }
    out.push([...tallest(livePlayers(rows), height)], fedReport(rows, last, place))
    return out
  }
  assert.deepEqual(view(kept), view(players), 'mêmes chiffres avec ou sans les fiches supprimées')
}

console.log('test-bilan-cache : ok')
