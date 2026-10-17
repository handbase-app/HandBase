// Test des chiffres posés dans les zones de la carte du bilan (src/mapLabels.ts) : point intérieur, taille qui tient,
// couleur du texte selon le fond. Formes fictives.
//
//   npx jiti tools/test-carte-chiffres.ts
import assert from 'node:assert/strict'
import { contrast, fitFont, inkOn, inside, luminance, parseCssColor, poleOfInaccessibility, signedDist, textWidth, type Poly } from '../src/mapLabels'

const sq = (x: number, y: number, w: number, h = w): Poly => [
  [
    [x, y],
    [x + w, y],
    [x + w, y + h],
    [x, y + h],
    [x, y],
  ],
]

// Carré : le centre.
{
  const p = poleOfInaccessibility([sq(0, 0, 100)], undefined, 0.1)!
  assert.ok(Math.abs(p.x - 50) < 1 && Math.abs(p.y - 50) < 1, `centre du carré : ${p.x}, ${p.y}`)
  assert.ok(Math.abs(p.d - 50) < 1)
}

// Forme en L : le centroïde tombe dehors, le pôle reste dedans, dans la plus grosse partie.
{
  const L: Poly = [
    [
      [0, 0],
      [100, 0],
      [100, 20],
      [20, 20],
      [20, 100],
      [0, 100],
      [0, 0],
    ],
  ]
  assert.equal(inside(40, 40, [L]), false, 'le centre de la boîte est dehors')
  const p = poleOfInaccessibility([L], undefined, 0.1)!
  assert.ok(inside(p.x, p.y, [L]), 'pôle dedans')
  assert.ok(p.d > 9 && p.d < 15, `rayon ${p.d}`)
}

// Région de deux départements : la limite entre eux ne compte pas (bord = contour seul), pôle au milieu de l'ensemble.
{
  const a = sq(0, 0, 50, 50)
  const b = sq(50, 0, 50, 50)
  const edges = [
    [
      [0, 0],
      [100, 0],
      [100, 50],
      [0, 50],
      [0, 0],
    ] as [number, number][],
  ]
  const p = poleOfInaccessibility([a, b], edges, 0.1)!
  assert.ok(Math.abs(p.y - 25) < 1 && p.x > 24 && p.x < 76, `pôle de la région ${p.x}, ${p.y}`)
  assert.ok(Math.abs(p.d - 25) < 1)
  // Point sur la limite intérieure : dedans, loin du bord.
  assert.ok(signedDist(50, 25, [a, b], edges) > 24)
  // Île à part (polygone multiple) : une zone, le pôle va dans la plus grande partie.
  const q = poleOfInaccessibility([sq(0, 0, 10), sq(100, 100, 60)], undefined, 0.1)!
  assert.ok(q.x > 100 && q.y > 100)
}

// Trou : un point du trou est dehors.
{
  const ring: Poly = [sq(0, 0, 100)[0], sq(30, 30, 40)[0]]
  assert.equal(inside(50, 50, [ring]), false)
  assert.equal(inside(10, 10, [ring]), true)
  const p = poleOfInaccessibility([ring], undefined, 0.1)!
  assert.ok(!(p.x > 30 && p.x < 70 && p.y > 30 && p.y < 70), 'pôle hors du trou')
}

// Taille du texte : visée si elle tient, plus petite sinon, masquée sous le minimum.
{
  const big = [sq(0, 0, 200, 100)]
  assert.equal(fitFont('42 %', 100, 50, big, 20, 10), 20)
  const narrow = [sq(0, 0, 40, 100)]
  const f = fitFont('3 054', 20, 50, narrow, 20, 8)!
  assert.ok(f < 20 && f >= 8, `réduit : ${f}`)
  assert.ok(textWidth('3 054') * f <= 40)
  assert.equal(fitFont('3 054', 5, 5, [sq(0, 0, 10)], 20, 9), undefined, 'zone trop petite : pas de chiffre')
  // Espace fine plus étroite qu'une espace, « % » large.
  assert.ok(textWidth('3 054') < textWidth('3 054'))
  assert.ok(textWidth('42 %') > textWidth('42'))
}

// Couleurs calculées par le navigateur.
{
  assert.deepEqual(parseCssColor('rgb(255, 0, 0)'), [1, 0, 0])
  assert.deepEqual(parseCssColor('rgba(0, 255, 0, 0.5)'), [0, 1, 0])
  assert.deepEqual(parseCssColor('color(srgb 0.5 0.25 1)'), [0.5, 0.25, 1])
  assert.deepEqual(parseCssColor('color(srgb 1.2 -0.1 0.5 / 0.8)'), [1, 0, 0.5])
  assert.deepEqual(parseCssColor('#ffffff'), [1, 1, 1])
  assert.deepEqual(parseCssColor('#000'), [0, 0, 0])
  assert.equal(parseCssColor('oklch(0.5 0.1 200)'), null)
  assert.ok(Math.abs(luminance([1, 1, 1]) - 1) < 1e-9)
  assert.equal(luminance([0, 0, 0]), 0)
}

// Encre : foncée sur fond clair, claire sur fond foncé, toujours la plus contrastée.
{
  const hex = (h: string) => parseCssColor(h)!
  assert.equal(inkOn(hex('#ffffff')), 'dark')
  assert.equal(inkOn(hex('#e6f7f5')), 'dark') // sarcelle très claire (8 %)
  assert.equal(inkOn(hex('#14b8a6')), 'dark') // sarcelle pleine (Actuel) : le texte foncé contraste mieux
  assert.equal(inkOn(hex('#0b1530')), 'light') // fond nuit (Sport)
  assert.equal(inkOn(hex('#12285c')), 'light') // bleu soutenu
  assert.equal(inkOn(hex('#000000')), 'light')
  const dark = luminance(hex('#0f172a'))
  for (const h of ['#ffffff', '#e6f7f5', '#14b8a6', '#ff5a1f', '#f5c518', '#7aa2ff', '#12285c', '#0b1530', '#3a2a10', '#c28800']) {
    const l = luminance(hex(h))
    const best = inkOn(hex(h)) === 'dark' ? contrast(l, dark) : contrast(l, 1)
    assert.ok(best >= Math.max(contrast(l, dark), contrast(l, 1)) - 1e-9, h)
    assert.ok(best >= 4.5, `${h} : contraste ${best.toFixed(2)}`)
  }
}

console.log('carte-chiffres : OK')
