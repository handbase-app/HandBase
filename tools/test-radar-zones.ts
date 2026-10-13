// Test du radar par zones (src/radarZones.ts) sur des critères fictifs : zones et couleurs déduites du nom des
// catégories, réglages posés sur les critères, angles dans le bon secteur, catégories inconnues, secteurs vides,
// disposition des gardiens.
//
//   npx jiti tools/test-radar-zones.ts
import assert from 'node:assert/strict'
import { categoryKey, categoryList, resolveCategory } from '../src/criteriaFormat'
import { categoryKind, categoryStyles, defaultColor, defaultZone, largestGapMiddle, layoutRadar, NEUTRAL, wrapLabel, type RadarZone } from '../src/radarZones'

let n = 0
const ok = (name: string, fn: () => void) => {
  fn()
  n++
  console.log('ok -', name)
}
const mod = (a: number) => ((a % 360) + 360) % 360
const dist = (a: number, b: number) => Math.abs(mod(b - a + 180) - 180)

type C = { id: string; label: string; category: string; order: number; radarZone?: RadarZone; radarColor?: string; deleted?: boolean }
const make = (spec: [string, number][], extra: Partial<Record<string, Partial<C>>> = {}): C[] => {
  const out: C[] = []
  let o = 0
  for (const [cat, k] of spec) for (let i = 0; i < k; i++) out.push({ id: `${cat}-${i}`, label: `Critère ${o}`, category: cat, order: o++, ...extra[cat] })
  return out
}
const run = (cs: C[]) => layoutRadar(cs, categoryStyles(cs))
const sectorOf = (r: ReturnType<typeof run>, cat: string) => r.sectors.find((s) => s.category === cat)!
const center = (s: { start: number; end: number }) => mod((s.start + s.end) / 2)
const inside = (s: { start: number; end: number }, a: number) => {
  const x = mod(a - s.start)
  return x > 0 && x < s.end - s.start
}

ok('zones et couleurs déduites du nom (sans accents ni majuscules)', () => {
  assert.equal(defaultZone('Mental & attitude'), 'haut')
  assert.equal(defaultZone('ATTITUDE'), 'haut')
  assert.equal(defaultZone('Intelligence de jeu'), 'haut-droite')
  assert.equal(defaultZone('Tactique'), 'haut-droite')
  assert.equal(defaultZone('Lecture du jeu'), 'haut-droite')
  assert.equal(defaultZone('Attaque'), 'droite')
  assert.equal(defaultZone('Jeu offensif'), 'droite')
  assert.equal(defaultZone('Défense'), 'gauche')
  assert.equal(defaultZone('DEFENSE'), 'gauche')
  for (const p of ['Physique', 'Critères physiologiques', 'Motricité', 'Vitesse & endurance', 'Puissance & détente', 'Gabarit', 'Qualités athlétiques'])
    assert.equal(defaultZone(p), 'bas', p)
  assert.equal(defaultZone('Divers'), null)
  assert.equal(defaultColor('Mental & attitude'), '#7F77DD')
  assert.equal(defaultColor('Intelligence de jeu'), '#639922')
  assert.equal(defaultColor('Attaque'), '#378ADD')
  assert.equal(defaultColor('Physique'), '#BA7517')
  assert.equal(defaultColor('Défense'), '#E24B4A')
  assert.equal(defaultColor('Divers'), NEUTRAL)
})

ok('gardiens : spécifique à gauche, arrêts par zone à droite', () => {
  assert.equal(categoryKind('Spécifique gardien'), 'gardien')
  assert.equal(categoryKind('Gardien — arrêts par zone'), 'gardien-arrets')
  assert.equal(defaultZone('Spécifique gardien'), 'gauche')
  assert.equal(defaultZone('Gardien — arrêts par zone'), 'droite')
  assert.notEqual(defaultColor('Spécifique gardien'), defaultColor('Défense'))
})

ok('réglage porté par les critères : le premier dans l’ordre, sinon le nom', () => {
  const cs = make([['Attaque', 3], ['Divers', 2]], { Divers: { radarZone: 'bas-droite', radarColor: '#1D9E75' } })
  cs[1].radarZone = 'haut-gauche'
  const st = categoryStyles(cs)
  assert.deepEqual(st.get('Attaque'), { zone: 'haut-gauche', color: '#378ADD', setZone: true, setColor: false })
  assert.deepEqual(st.get('Divers'), { zone: 'bas-droite', color: '#1D9E75', setZone: true, setColor: true })
  // Valeurs invalides ou critères supprimés ignorés.
  const bad = make([['Attaque', 2]], { Attaque: { radarZone: 'nulle-part' as RadarZone, radarColor: 'rouge' } })
  assert.deepEqual(categoryStyles(bad).get('Attaque'), { zone: 'droite', color: '#378ADD', setZone: false, setColor: false })
  const del = make([['Attaque', 2]], { Attaque: { radarZone: 'bas', deleted: true } })
  assert.equal(categoryStyles(del).size, 0)
})

const FIELD: [string, number][] = [
  ['Intelligence de jeu', 4],
  ['Attaque', 4],
  ['Défense', 4],
  ['Mental & attitude', 5],
  ['Physique', 3],
]

ok('joueur de champ : chaque catégorie au plus près de sa zone, branches dans leur secteur', () => {
  const r = run(make(FIELD))
  assert.equal(r.axes.length, 20)
  assert.equal(r.sectors.length, 5)
  const want: Record<string, number> = { 'Mental & attitude': 0, 'Intelligence de jeu': 45, Attaque: 90, Physique: 180, 'Défense': 270 }
  for (const [cat, a] of Object.entries(want)) assert.ok(dist(center(sectorOf(r, cat)), a) <= 25, `${cat} : ${center(sectorOf(r, cat))}`)
  // Le secteur couvre sa zone.
  for (const [cat, a] of Object.entries(want)) assert.ok(inside(sectorOf(r, cat), a), `${cat} couvre ${a}`)
  // Chaque branche dans le secteur de sa catégorie, régulières dans le secteur, ordre des critères gardé.
  r.sectors.forEach((s, i) => {
    const ax = r.axes.filter((a) => a.sector === i)
    assert.ok(ax.every((a) => a.category === s.category && inside(s, a.angle)))
    const w = (s.end - s.start) / s.count
    ax.forEach((a, j) => assert.ok(dist(a.angle, s.start + (j + 0.5) * w) < 1e-6))
    assert.deepEqual(
      ax.map((a) => a.id),
      ax.map((a) => a.id).sort((x, y) => Number(x.split('-').pop()) - Number(y.split('-').pop())),
    )
  })
  // Pas de trou : les secteurs se suivent et font le tour.
  const total = r.sectors.reduce((t, s) => t + (s.end - s.start), 0)
  assert.ok(Math.abs(total - 360) < 1e-6)
  r.sectors.forEach((s, i) => {
    const next = r.sectors[(i + 1) % r.sectors.length]
    assert.ok(dist(s.end, next.start) < 1e-6)
  })
  // Branches assez écartées pour les libellés.
  for (const s of r.sectors) assert.ok((s.end - s.start) / s.count >= 0.6 * (360 / 20) - 1e-6)
})

ok('secteur vide : pas affiché, les voisins prennent la place', () => {
  const r = run(make(FIELD.filter(([c]) => c !== 'Physique')))
  assert.equal(r.sectors.length, 4)
  assert.ok(!r.sectors.some((s) => s.category === 'Physique'))
  const total = r.sectors.reduce((t, s) => t + (s.end - s.start), 0)
  assert.ok(Math.abs(total - 360) < 1e-6)
  assert.ok(dist(center(sectorOf(r, 'Mental & attitude')), 0) <= 30)
  // Attaque reste à droite, Défense à gauche.
  assert.ok(center(sectorOf(r, 'Attaque')) > 60 && center(sectorOf(r, 'Attaque')) < 160)
  assert.ok(center(sectorOf(r, 'Défense')) > 200 && center(sectorOf(r, 'Défense')) < 300)
})

ok('nouvelles catégories physiques : en bas sans réglage', () => {
  const r = run(make([...FIELD.filter(([c]) => c !== 'Physique'), ['Motricité', 3], ['Vitesse & endurance', 2]]))
  for (const c of ['Motricité', 'Vitesse & endurance']) assert.ok(dist(center(sectorOf(r, c)), 180) <= 40, c)
})

ok('catégorie inconnue : dans le plus grand espace libre, en gris', () => {
  assert.equal(largestGapMiddle([0, 90]), 225)
  assert.equal(largestGapMiddle([]), 0)
  assert.equal(largestGapMiddle([90]), 270)
  const r = run(make([['Mental & attitude', 3], ['Attaque', 3], ['Défense', 3], ['Divers', 3]]))
  const d = sectorOf(r, 'Divers')
  assert.equal(d.color, NEUTRAL)
  assert.ok(dist(d.anchor, 180) < 1e-6) // espace libre : le bas
  assert.ok(dist(center(d), 180) <= 30)
  // Deux inconnues : chacune son espace.
  const r2 = run(make([['Mental & attitude', 3], ['Attaque', 3], ['Divers', 2], ['Autre chose', 2]]))
  assert.notEqual(sectorOf(r2, 'Divers').anchor, sectorOf(r2, 'Autre chose').anchor)
})

ok('zone réglée à la main l’emporte sur le nom', () => {
  const cs = make(FIELD, { Attaque: { radarZone: 'bas-gauche' } })
  const r = run(cs)
  assert.ok(dist(center(sectorOf(r, 'Attaque')), 225) <= 40)
})

ok('gardien : mental en haut, spécifique à gauche, arrêts à droite', () => {
  const r = run(
    make([
      ['Intelligence de jeu', 2],
      ['Mental & attitude', 5],
      ['Spécifique gardien', 8],
      ['Gardien — arrêts par zone', 5],
    ]),
  )
  assert.ok(dist(center(sectorOf(r, 'Mental & attitude')), 0) <= 25)
  const g = center(sectorOf(r, 'Spécifique gardien'))
  const a = center(sectorOf(r, 'Gardien — arrêts par zone'))
  assert.ok(g > 180 && g < 315, `gardien ${g}`)
  assert.ok(a > 45 && a < 180, `arrêts ${a}`)
})

ok('cas limites : une seule catégorie, aucune branche', () => {
  const r = run(make([['Attaque', 4]]))
  assert.equal(r.sectors.length, 1)
  assert.ok(Math.abs(r.sectors[0].end - r.sectors[0].start - 360) < 1e-6)
  assert.ok(r.axes.some((a) => dist(a.angle, 90) < 46))
  assert.deepEqual(run([]), { axes: [], sectors: [] })
  const two = run(make([['Mental & attitude', 2], ['Défense', 1]]))
  assert.equal(two.axes.length, 3)
  assert.ok(two.axes.every((a) => a.angle >= 0 && a.angle < 360))
})

ok('libellés coupés sur deux lignes au plus', () => {
  assert.deepEqual(wrapLabel('Vision du jeu', 20), ['Vision du jeu'])
  assert.deepEqual(wrapLabel('Placement / replacement', 12), ['Placement /', 'replacement'])
  const w = wrapLabel('Contre-attaques / 1 contre 1 très longues', 10)
  assert.ok(w.length === 2 && w.every((l) => l.length <= 10))
  assert.ok(w[1].endsWith('…'))
})

ok('liste des catégories (Réglages → Critères) : ordre d’affichage, sans doublon', () => {
  const cs = [
    { category: 'Attaque', order: 3, kind: 'subjective' as const },
    { category: 'Mental & attitude', order: 1, kind: 'subjective' as const },
    { category: '  attaque ', order: 4, kind: 'subjective' as const },
    { category: 'Gabarit', order: 0, kind: 'factual' as const },
    { category: 'Vieille', order: 2, kind: 'subjective' as const, deleted: true },
    { category: '   ', order: 5, kind: 'subjective' as const },
  ]
  assert.deepEqual(categoryList(cs), ['Gabarit', 'Mental & attitude', 'Attaque'])
  assert.deepEqual(categoryList(cs, 'subjective'), ['Mental & attitude', 'Attaque', 'Gabarit'])
  assert.deepEqual(categoryList([]), [])
  assert.equal(categoryKey('  Mental   &  ATTITUDE '), 'mental & attitude')
  const list = categoryList(cs, 'subjective')
  assert.equal(resolveCategory(' mental &   attitude', list), 'Mental & attitude')
  assert.equal(resolveCategory('  Motricité   fine ', list), 'Motricité fine')
  assert.equal(defaultZone(resolveCategory('Motricité fine', list)), 'bas')
})

console.log(`\n${n} tests réussis`)
