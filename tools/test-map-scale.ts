// Départ de l'échelle de la carte du bilan (src/mapScale.ts, --scale-floor posé par src/theme.ts) : dans chaque style,
// clair et sombre, la zone la moins vue se détache nettement de « aucun joueur » ; les thèmes clairs d'Actuel gardent
// leur départ d'origine (8 %).
//
//   npx jiti tools/test-map-scale.ts
import assert from 'node:assert/strict'
import { BASE_FLOOR, DEFAULT_SCALE, deltaE, MIN_DE_DARK, MIN_DE_LIGHT, mix, scaleFloor } from '../src/mapScale'
import { computeLook, THEMES } from '../src/theme'
import { STYLES } from '../src/uiStyle'

const rgb = (h: string) => [0, 2, 4].map((i) => parseInt(h.slice(1 + i, 3 + i), 16) / 255) as unknown as readonly [number, number, number]
const gap = (scale: string, panel: string, noPlayer: string, f: number) => deltaE(mix(rgb(scale), f, rgb(panel)), noPlayer)

assert.equal(scaleFloor('#14b8a6', '#ffffff', '#eceef5'), BASE_FLOOR, 'Actuel Clair : départ inchangé')
for (const t of THEMES) {
  const f = computeLook('actuel', t.id).scaleFloor
  if (t.light) assert.equal(f, BASE_FLOOR, `Actuel ${t.id} : départ inchangé`)
  assert.ok(gap(DEFAULT_SCALE, t.colors.panel, t.colors.panel2, f) >= (t.light ? MIN_DE_LIGHT : MIN_DE_DARK), `Actuel ${t.id} : écart visible`)
}
for (const s of STYLES)
  for (const light of [true, false]) {
    const p = light ? s.light : s.dark
    if (!p) continue
    const m = p.map ?? p
    const f = computeLook(s.id, light ? 'clair' : 'nuit').scaleFloor
    assert.ok(f >= BASE_FLOOR && f <= 60, `${s.id} ${light ? 'clair' : 'sombre'} : départ ${f}`)
    assert.ok(gap(p.scale, m.panel, m.panel2, f) >= MIN_DE_LIGHT, `${s.id} ${light ? 'clair' : 'sombre'} : écart visible`)
  }
// Officiel sombre et Salle sombre (recette) : le départ monte au-dessus de 8 %.
assert.ok(computeLook('officiel', 'nuit').scaleFloor > BASE_FLOOR)
assert.ok(computeLook('sombre', 'nuit').scaleFloor > BASE_FLOOR)
console.log('test-map-scale : OK')
