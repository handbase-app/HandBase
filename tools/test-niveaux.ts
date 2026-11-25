// Niveaux d'un joueur (src/levels.ts) : France, Ligue, Comité tirés des groupes (en cours, non archivés, hors groupes
// Pôle), Pôle tiré de la fiche (poleStatus, comme l'étiquette « Pôle ») ; ordre d'importance France > Pôle > Ligue >
// Comité, deux au plus ; fond de l'anneau pour 1 et 2 niveaux (moitié gauche le plus important) ; libellé lu ; couleurs
// lisibles (3:1, élément graphique WCAG 1.4.11) sur toutes les cartes claires et sombres.
//
//   npx jiti tools/test-niveaux.ts
import assert from 'node:assert/strict'
import { poleStatus } from '../src/db'
import { LEVEL_TONES, levelCss, levelLabel, levelRingBackground, LEVELS, levelVars, MAX_LEVELS, playerLevels, scopeLevelMap, type Level } from '../src/levels'
import { THEMES } from '../src/theme'
import { contrast, STYLES } from '../src/uiStyle'

// ---------- Niveaux venus des groupes ----------
const map = scopeLevelMap([
  { scope: 'federation', playerIds: ['a', 'b'] },
  { scope: 'ligue', playerIds: ['b', 'c', 'c'] },
  { scope: 'comite', playerIds: ['c', 'd'] },
  { scope: 'comite', archived: true, playerIds: ['e'] },
  { scope: 'federation', poleUnitId: 'u1', playerIds: ['f'] },
  { playerIds: ['g'] },
  { scope: 'club', playerIds: ['h'] },
  { scope: 'ligue' },
])
assert.deepEqual([...map.get('a')!], ['france'])
assert.deepEqual([...map.get('b')!].sort(), ['france', 'ligue'])
assert.deepEqual([...map.get('c')!].sort(), ['comite', 'ligue'])
for (const id of ['e', 'f', 'g', 'h']) assert.equal(map.get(id), undefined, `${id} sans niveau`)

// ---------- Ordre d'importance, deux au plus ----------
assert.deepEqual(LEVELS, ['france', 'pole', 'ligue', 'comite'])
assert.equal(MAX_LEVELS, 2)
const S = (...l: Level[]) => new Set(l)
assert.deepEqual(playerLevels(undefined, false), [])
assert.deepEqual(playerLevels(undefined, true), ['pole'])
assert.deepEqual(playerLevels(S('france'), true), ['france', 'pole'])
assert.deepEqual(playerLevels(S('ligue'), true), ['pole', 'ligue'])
assert.deepEqual(playerLevels(S('comite', 'ligue'), false), ['ligue', 'comite'])
assert.deepEqual(playerLevels(S('comite', 'ligue', 'france'), true), ['france', 'pole'])
assert.deepEqual(playerLevels(S('comite', 'ligue', 'france'), false), ['france', 'ligue'])
assert.deepEqual(playerLevels(map.get('c'), false), ['ligue', 'comite'])

// Pôle : même règle que l'étiquette « Pôle » de la ligne (période en cours aujourd'hui).
const today = '2026-11-03'
assert.equal(poleStatus({ poles: [{ regionId: 'r', from: '2026-07-01', to: '2027-06-30' }] }, today), 'current')
assert.equal(poleStatus({ poles: [{ regionId: 'r', from: '2024-07-01', to: '2026-06-30' }] }, today), 'past')
assert.equal(poleStatus({}, today), undefined)

// ---------- Fond de l'anneau ----------
assert.equal(levelRingBackground([], 38), 'transparent')
assert.equal(levelRingBackground(['ligue'], 38), 'var(--niv-ligue)')
const two = levelRingBackground(['france', 'pole'], 38)
assert.ok(two.startsWith('conic-gradient(transparent 0deg'), two)
// Moitié droite (0 → 180°) : le moins important ; moitié gauche (180 → 360°) : le plus important ; vides en haut et en bas.
const m = two.match(/^conic-gradient\(transparent 0deg ([\d.]+)deg, var\(--niv-pole\) \1deg ([\d.]+)deg, transparent \2deg ([\d.]+)deg, var\(--niv-france\) \3deg ([\d.]+)deg, transparent \4deg\)$/)
assert.ok(m, two)
const gap = Number(m[1])
assert.ok(gap > 0.5 && gap < 3, `vide de ${gap}°`)
assert.equal(Number(m[2]), Math.round((180 - gap) * 100) / 100)
assert.equal(Number(m[3]), Math.round((180 + gap) * 100) / 100)
assert.equal(Number(m[4]), Math.round((360 - gap) * 100) / 100)
// Même paire, même dessin ; autre paire, autres couleurs ; plus petite photo : vide un peu plus large en degrés.
assert.equal(levelRingBackground(['france', 'pole'], 38), two)
assert.ok(levelRingBackground(['ligue', 'comite'], 38).includes('var(--niv-comite) ') && levelRingBackground(['ligue', 'comite'], 38).indexOf('--niv-comite') < levelRingBackground(['ligue', 'comite'], 38).indexOf('--niv-ligue'))
assert.ok(Number(levelRingBackground(['france', 'pole'], 30).match(/0deg ([\d.]+)deg/)![1]) > gap)

// ---------- Libellé lu ----------
assert.equal(levelLabel([]), '')
assert.equal(levelLabel(['comite']), 'Niveau : Comité')
assert.equal(levelLabel(['france', 'pole']), 'Niveaux : France, Pôle')

// ---------- Couleurs ----------
assert.equal(levelCss('france'), 'var(--niv-france)')
assert.deepEqual(Object.keys(levelVars(true)), ['--niv-france', '--niv-pole', '--niv-ligue', '--niv-comite'])
assert.equal(levelVars(true)['--niv-ligue'], LEVEL_TONES.ligue.light)
assert.equal(levelVars(false)['--niv-ligue'], LEVEL_TONES.ligue.dark)
for (const l of LEVELS) assert.ok(LEVEL_TONES[l].label && /^#[0-9a-f]{6}$/.test(LEVEL_TONES[l].light) && /^#[0-9a-f]{6}$/.test(LEVEL_TONES[l].dark), l)

// Anneau lisible : 3:1 sur chaque carte (fond des listes) et carte 2, claire ou sombre, de chaque thème et style.
const GRAPHIC = 3
const panels = (light: boolean) => [
  ...THEMES.filter((t) => t.light === light).flatMap((t) => [[`${t.id}`, t.colors.panel], [`${t.id} carte 2`, t.colors.panel2]] as const),
  ...STYLES.flatMap((s) => {
    const p = light ? s.light : s.dark
    return p ? ([[`${s.id}`, p.panel], [`${s.id} carte 2`, p.panel2]] as const) : []
  }),
]
assert.ok(panels(true).length >= 6 && panels(false).length >= 6)
for (const l of LEVELS)
  for (const mode of ['light', 'dark'] as const)
    for (const [name, bg] of panels(mode === 'light')) {
      const k = contrast(LEVEL_TONES[l][mode], bg)
      assert.ok(k >= GRAPHIC, `${l} ${mode} sur ${name} : ${k.toFixed(2)}:1`)
    }

// Deux niveaux côte à côte se distinguent (écart de luminance ou de teinte net) : pas deux fois le même ton.
assert.equal(new Set(LEVELS.map((l) => LEVEL_TONES[l].light)).size, 4)
assert.equal(new Set(LEVELS.map((l) => LEVEL_TONES[l].dark)).size, 4)

console.log('test-niveaux : OK')
