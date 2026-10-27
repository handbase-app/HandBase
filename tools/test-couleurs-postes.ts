// Couleurs des postes des listes de joueurs (src/positionColors.ts) : chaque poste du handball et du volley a sa teinte,
// les deux côtés d'un même poste la partagent, un code inconnu ou l'absence de poste reste neutre, et chaque couleur se lit
// (WCAG AA, 4,5:1) : initiales sur leur rond, « ● DC » sur toutes les cartes des thèmes et des styles, clairs et sombres.
//
//   npx jiti tools/test-couleurs-postes.ts
import assert from 'node:assert/strict'
import { HANDBALL, LIBERO, VOLLEYBALL } from '../src/sportConfig'
import { POS_HUES, POS_TONES, positionHue, positionVars, hueBg, hueText } from '../src/positionColors'
import { THEMES } from '../src/theme'
import { contrast, STYLES } from '../src/uiStyle'

// Chaque poste a une teinte, dans les deux sports.
for (const p of HANDBALL.positions) assert.ok(positionHue(p.code, 'handball'), `handball ${p.code} sans teinte`)
for (const p of [...VOLLEYBALL.positions, LIBERO]) assert.ok(positionHue(p.code, 'volley'), `volley ${p.code} sans teinte`)

// Côtés d'un même poste : même teinte ; postes différents : teintes différentes.
assert.equal(positionHue('AG', 'handball'), positionHue('AD', 'handball'))
assert.equal(positionHue('ARG', 'handball'), positionHue('ARD', 'handball'))
const hb = ['GB', 'AG', 'ARG', 'DC', 'PIV'].map((c) => positionHue(c, 'handball'))
assert.equal(new Set(hb).size, hb.length, 'handball : une teinte par poste')
const vb = ['P', 'R4', 'C', 'PT', 'L'].map((c) => positionHue(c, 'volley'))
assert.equal(new Set(vb).size, vb.length, 'volley : une teinte par poste')

// Même couleur que les pastilles des postes : le gardien en rose, le demi-centre en vert, le pivot en bleu…
assert.equal(positionHue('GB', 'handball'), 'rose')
assert.equal(positionHue('DC', 'handball'), 'emerald')
assert.equal(positionHue('PIV', 'handball'), 'sky')
// Le « P » du volley (passeur) n'est pas le pivot du handball.
assert.equal(positionHue('P', 'volley'), 'emerald')
assert.equal(positionHue('P', 'handball'), null)

// Sans poste, code inconnu : neutre (aucun style posé).
assert.equal(positionHue(undefined, 'handball'), null)
assert.equal(positionHue('', 'handball'), null)
assert.equal(positionHue('XYZ', 'handball'), null)
assert.equal(hueBg(null), undefined)
assert.equal(hueText(null), undefined)
// Sport inconnu : les teintes du handball.
assert.equal(positionHue('DC', 'rugby'), 'emerald')

// Variables CSS : une paire par teinte, valeurs du thème demandé.
const vl = positionVars(true)
const vd = positionVars(false)
assert.equal(Object.keys(vl).length, POS_HUES.length * 2)
assert.equal(vl['--pos-emerald-bg'], POS_TONES.emerald.light.bg)
assert.equal(vd['--pos-emerald-fg'], POS_TONES.emerald.dark.fg)
assert.deepEqual(hueBg('sky'), { backgroundColor: 'var(--pos-sky-bg)', color: 'var(--pos-sky-fg)' })

// Contraste AA : initiales sur leur rond ; « ● DC » sur chaque carte (fond des lignes) claire ou sombre.
const AA = 4.5
const lightPanels = [...THEMES.filter((t) => t.light).map((t) => [t.id, t.colors.panel] as const), ...STYLES.flatMap((s) => (s.light ? [[`${s.id} clair`, s.light.panel] as const] : []))]
const darkPanels = [...THEMES.filter((t) => !t.light).map((t) => [t.id, t.colors.panel] as const), ...STYLES.flatMap((s) => (s.dark ? [[`${s.id} sombre`, s.dark.panel] as const] : []))]
assert.ok(lightPanels.length >= 3 && darkPanels.length >= 3)
for (const h of POS_HUES) {
  for (const mode of ['light', 'dark'] as const) {
    const t = POS_TONES[h][mode]
    const c = contrast(t.fg, t.bg)
    assert.ok(c >= AA, `${h} ${mode} : initiales ${c.toFixed(2)}:1`)
    for (const [name, panel] of mode === 'light' ? lightPanels : darkPanels) {
      const k = contrast(t.fg, panel)
      assert.ok(k >= AA, `${h} ${mode} : « ● code » sur la carte ${name} ${k.toFixed(2)}:1`)
    }
  }
}

console.log('test-couleurs-postes : OK')
