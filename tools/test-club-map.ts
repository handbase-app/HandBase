// Test des clubs sur la carte du bilan (src/clubMap.ts), sur des clubs et des joueurs fictifs.
//
//   npx jiti tools/test-club-map.ts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { clubDots, dotRadius, focusProjection, hasPlacedClubs, isPlacedClub, spreadDots } from '../src/clubMap'

// Département d'un n° de club, comme department() (src/components/PlayerFilter.tsx, pas lisible ici : JSX) : ligues 64 à 70 = outre-mer.
const OM: Record<string, string> = { '64': '971', '65': '973', '66': '972', '67': '988', '69': '974', '70': '976' }
const deptOf = (n: string) => OM[n.slice(0, 2)] ?? n.slice(2, 4)

// Unités de la structure (fictives) : clubs placés, club sans coordonnées, comité, club supprimé, club d'outre-mer.
const U = (id: string, name: string, clubNumber: string | undefined, lat?: number, lng?: number, extra = {}) => ({
  id,
  levelId: 'niveau-club',
  name,
  ...(clubNumber ? { clubNumber } : {}),
  ...(lat !== undefined ? { lat, lng } : {}),
  ...extra,
})
const units = [
  U('u1', 'HBC Exemple', '6283001', 43.2, 6.0, { city: 'Villefictive' }),
  U('u2', 'AS Fictive', '6283002', 43.4, 6.3),
  U('u3', 'Club Sans Joueur', '6283003', 43.3, 6.6),
  U('u4', 'Club Sans Position', '6283004'),
  U('u5', 'Club Voisin', '6206001', 43.7, 7.2), // autre département (06)
  U('u6', 'Club Supprimé', '6283005', 43.3, 6.1, { deleted: true }),
  { id: 'c1', levelId: 'niveau-comite', name: 'Comité fictif', lat: 43.3, lng: 6.2 },
  U('u7', 'Club Sans Numéro', undefined, 43.25, 6.4, { departments: ['83'] }),
  U('u8', 'Club Îlien', '7001001', -12.8, 45.15), // ligue 70 : Mayotte (976)
]

// Unités placées : niveau club (ou n° de club) et coordonnées.
assert.equal(isPlacedClub(units[0]), true)
assert.equal(isPlacedClub(units[3]), false, 'sans coordonnées')
assert.equal(isPlacedClub(units[5]), false, 'supprimé')
assert.equal(isPlacedClub(units[6]), false, 'comité')
assert.equal(isPlacedClub({ id: 'x', levelId: 'niveau-club', name: 'x', lat: 200, lng: 0 }), false, 'coordonnées impossibles')
assert.equal(hasPlacedClubs(units), true)
assert.equal(hasPlacedClubs([units[3], units[6]]), false, 'pas de structure placée : carte comme avant')

// Clubs du bilan : clé = nom replié, joueurs avec leur n° de club.
const C = (key: string, name: string, codes: (string | undefined)[], total = codes.length, seen = 0) => ({
  key,
  name,
  total,
  seen,
  toSee: codes.map((clubCode) => ({ clubCode })),
  seenPlayers: [] as { clubCode?: string }[],
})
const clubs = [
  C('hbc exemple', 'HBC Exemple', ['6283001', '6283001', '6283009']), // n° majoritaire → u1
  C('as fictive', 'AS Fictive', [undefined]), // pas de n° : nom → u2
  C('club inconnu', 'Club Inconnu', ['6283077']), // aucune unité : seulement dans la liste
  C('club sans position', 'Club Sans Position', ['6283004']), // unité sans coordonnées : liste
  C('', '', [undefined]), // club non renseigné : jamais sur la carte
]
const { dots, unplaced } = clubDots(clubs, units, '83', deptOf)
assert.deepEqual(
  dots.map((d) => [d.id, d.number, !!d.club]),
  [
    ['hbc exemple', '6283001', true],
    ['as fictive', '6283002', true],
    ['unit:u3', '6283003', false], // club de la structure sans joueur : point neutre
    ['unit:u7', undefined, false], // sans numéro : département de l'unité
  ],
)
assert.equal(dots[0].city, 'Villefictive')
assert.equal(dots[0].name, 'HBC Exemple')
assert.deepEqual(
  unplaced.map((c) => c.key),
  ['club inconnu', 'club sans position'],
)
// Nom en double dans le département : pas de rattachement par le nom.
const twice = [...units, U('u9', 'AS Fictive', '6283010', 43.1, 6.2)]
const r2 = clubDots([clubs[1]], twice, '83', deptOf)
assert.deepEqual(r2.unplaced.map((c) => c.key), ['as fictive'])
// Outre-mer : n° de la ligue 70 → Mayotte.
assert.deepEqual(
  clubDots([], units, '976', deptOf).dots.map((d) => d.id),
  ['unit:u8'],
)
assert.deepEqual(clubDots([], [], '83', deptOf), { dots: [], unplaced: [] })

// Rayon : racine du nombre de joueurs.
assert.equal(dotRadius(0, 10), 5)
assert.equal(dotRadius(10, 10), 12)
assert.ok(Math.abs(dotRadius(25, 100) - 8.5) < 1e-9)
assert.equal(dotRadius(3, 0), 12, 'maximum nul : pas de division par zéro')

// Écartement : plus aucun chevauchement, points confondus séparés, origine intacte, résultat stable.
const pts = [
  { id: 'a', x: 100, y: 100, r: 5 },
  { id: 'b', x: 100, y: 100, r: 5 },
  { id: 'c', x: 103, y: 101, r: 5 },
  { id: 'd', x: 300, y: 300, r: 5 },
]
const spread = spreadDots(pts, 2)
for (let i = 0; i < spread.length; i++)
  for (let j = i + 1; j < spread.length; j++) {
    const a = spread[i]
    const b = spread[j]
    assert.ok(Math.hypot(a.x - b.x, a.y - b.y) >= a.r + b.r + 2 - 0.01, `${a.id}/${b.id} encore superposés`)
  }
assert.deepEqual(spread[3], pts[3], 'un point isolé ne bouge pas')
assert.equal(pts[0].x, 100, 'positions d’origine intactes')
assert.deepEqual(spreadDots(pts, 2), spread, 'toujours le même résultat')
assert.ok(Math.hypot(spread[0].x - 100, spread[0].y - 100) < 15, 'les points restent près de leur place')

// Projection : le département (fictif, un carré) remplit le cadre ; un club à l'intérieur tombe dans le cadre.
const square = {
  type: 'FeatureCollection' as const,
  features: [
    {
      type: 'Feature' as const,
      properties: {},
      geometry: {
        type: 'Polygon' as const,
        coordinates: [
          [
            [6, 43],
            [6, 44],
            [7, 44],
            [7, 43],
            [6, 43],
          ],
        ],
      },
    },
  ],
}
for (const overseas of [false, true]) {
  const p = focusProjection(square, 600, 500, 12, overseas)
  const [x, y] = p([6.5, 43.5])!
  assert.ok(x > 12 && x < 588 && y > 12 && y < 488, 'centre dans le cadre')
  const corners = [p([6, 43])!, p([7, 44])!]
  const xs = corners.map((c) => c[0])
  const ys = corners.map((c) => c[1])
  // Le carré touche le cadre d'un côté au moins (recalage plein cadre).
  assert.ok(Math.max(...xs) - Math.min(...xs) > 400 || Math.max(...ys) - Math.min(...ys) > 400)
}

// Territoires ultramarins (contours de l'appli) : chacun se recale dans le cadre.
const om = JSON.parse(readFileSync(new URL('../src/assets/outre-mer.json', import.meta.url), 'utf8'))
for (const f of om.features) {
  const p = focusProjection({ type: 'FeatureCollection', features: [f] }, 600, 500, 12, true)
  // Tous les sommets du territoire sont projetés dans le cadre.
  for (const v of (f.geometry.coordinates as number[][][][]).flat(2)) {
    const [vx, vy] = p(v as [number, number])!
    assert.ok(vx >= 11.5 && vx <= 588.5 && vy >= 11.5 && vy <= 488.5, `${f.properties.code} : sommet hors cadre`)
  }
}

console.log('test-club-map : OK')
