// « Repérer des groupes » (src/groupColors.ts, src/groupRings.ts) : palette de 10 couleurs bien distinctes, ni rouge (accent)
// ni menthe (« Pôle »), anneau lisible (3:1, élément graphique WCAG 1.4.11) sur toutes les cartes claires et sombres ;
// couleur proposée (la moins prise), couleur tirée de l'identifiant (toujours la même) ; groupes relus (3 au plus, sans
// doublon), bascule, table joueur → groupes, « N ici », fond de l'anneau pour 1, 2 et 3 groupes, libellé lu.
//
//   npx jiti tools/test-reperer-groupes.ts
import assert from 'node:assert/strict'
import { autoGroupColor, fallbackGroupColor, GROUP_COLORS, GROUP_TONES, groupColorOf, groupColorVars, isGroupColor } from '../src/groupColors'
import { countHere, MAX_REPERES, parseGroupes, resolveRingColors, parseGroupesRaw, ringLabel, ringMembership, sameIds, toggleGroupe, UUID_RE } from '../src/groupRings'
import { THEMES } from '../src/theme'
import { contrast, STYLES } from '../src/uiStyle'

// ---------- Palette ----------
assert.equal(GROUP_COLORS.length, 10)
assert.equal(new Set(GROUP_COLORS).size, 10)
for (const c of GROUP_COLORS) assert.ok(GROUP_TONES[c].label && /^#[0-9a-f]{6}$/.test(GROUP_TONES[c].light) && /^#[0-9a-f]{6}$/.test(GROUP_TONES[c].dark), c)
const vars = groupColorVars(true)
assert.equal(Object.keys(vars).length, 10)
assert.equal(vars['--grp-bleu'], GROUP_TONES.bleu.light)
assert.equal(groupColorVars(false)['--grp-bleu'], GROUP_TONES.bleu.dark)

// Lab (CIE76) : écart entre deux couleurs, et teinte (pour écarter rouge / rose et menthe).
const lin = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
function lab(hex: string) {
  const [r, g, b] = lin(hex)
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116)
  const x = f((r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047)
  const y = f(r * 0.2126 + g * 0.7152 + b * 0.0722)
  const z = f((r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883)
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)]
}
const dE = (a: string, b: string) => {
  const [p, q] = [lab(a), lab(b)]
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2])
}
// Bien distinctes deux à deux, en clair comme en sombre.
for (const mode of ['light', 'dark'] as const)
  for (const a of GROUP_COLORS)
    for (const b of GROUP_COLORS) if (a < b) assert.ok(dE(GROUP_TONES[a][mode], GROUP_TONES[b][mode]) >= 20, `${a} / ${b} (${mode}) trop proches : ${dE(GROUP_TONES[a][mode], GROUP_TONES[b][mode]).toFixed(0)}`)
// Loin des accents rouges / roses des thèmes et de la menthe « Pôle » (teal-300 sur sombre, teal-700 sur clair).
// Accents rouges ou roses seulement (teinte Lab sous 40°) : l'orange brûlé de « Sable » n'est pas un rouge.
const reddish = (h: string) => {
  const [, a, b] = lab(h)
  return a > 40 && (Math.atan2(b, a) * 180) / Math.PI < 40
}
const accents = [...THEMES.map((t) => t.colors.accent).filter(reddish), '#f43f5e', '#e11d48', '#ef4444']
assert.ok(accents.length >= 5 && !accents.includes('#c2410c'))
const mint = { light: '#0f766e', dark: '#5eead4' }
for (const c of GROUP_COLORS)
  for (const mode of ['light', 'dark'] as const) {
    for (const a of accents) assert.ok(dE(GROUP_TONES[c][mode], a) >= 20, `${c} (${mode}) trop proche de l'accent ${a}`)
    assert.ok(dE(GROUP_TONES[c][mode], mint[mode]) >= 20, `${c} (${mode}) trop proche de la menthe « Pôle »`)
  }

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
for (const c of GROUP_COLORS)
  for (const mode of ['light', 'dark'] as const)
    for (const [name, bg] of panels(mode === 'light')) {
      const k = contrast(GROUP_TONES[c][mode], bg)
      assert.ok(k >= GRAPHIC, `${c} ${mode} sur ${name} : ${k.toFixed(2)}:1`)
    }

// ---------- Couleur d'un groupe ----------
assert.ok(isGroupColor('bleu'))
assert.ok(!isGroupColor('rouge') && !isGroupColor(undefined) && !isGroupColor(3))
// Tirée de l'identifiant : toujours la même, dans la palette, et bien répartie.
const ids = Array.from({ length: 400 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`)
for (const id of ids.slice(0, 20)) assert.equal(fallbackGroupColor(id), fallbackGroupColor(id))
const spread = new Set(ids.map(fallbackGroupColor))
assert.equal(spread.size, 10, 'les 10 couleurs sont tirées')
assert.equal(groupColorOf({ id: ids[0], color: 'violet' }), 'violet')
assert.equal(groupColorOf({ id: ids[0] }), fallbackGroupColor(ids[0]))
assert.equal(groupColorOf({ id: ids[0], color: 'rouge' }), fallbackGroupColor(ids[0]), 'couleur inconnue : celle de l’identifiant')

// Proposée : la moins prise (à égalité, la première de la palette) ; les groupes sans couleur comptent la leur.
assert.equal(autoGroupColor([]), 'bleu')
assert.equal(autoGroupColor([{ id: 'a', color: 'bleu' }]), 'violet')
assert.equal(autoGroupColor([{ id: 'a', color: 'bleu' }, { id: 'b', color: 'violet' }, { id: 'c', color: 'bleu' }]), 'fuchsia')
const allButOrange = GROUP_COLORS.filter((c) => c !== 'orange').map((c, i) => ({ id: `g${i}`, color: c }))
assert.equal(autoGroupColor(allButOrange), 'orange')
assert.equal(autoGroupColor([...GROUP_COLORS.map((c, i) => ({ id: `x${i}`, color: c })), { id: 'y', color: 'bleu' }]), 'violet')
const noColor = { id: ids[7] }
assert.notEqual(autoGroupColor([noColor]), fallbackGroupColor(ids[7]))

// ---------- Groupes repérés relus ----------
const G1 = '11111111-1111-4111-8111-111111111111'
const G2 = '22222222-2222-4222-8222-222222222222'
const G3 = '33333333-3333-4333-8333-333333333333'
const G4 = '44444444-4444-4444-8444-444444444444'
assert.equal(parseGroupes(undefined), null)
assert.equal(parseGroupes('x'), null)
assert.deepEqual(parseGroupes([]), [])
assert.deepEqual(parseGroupes([G1, G1, 3, '', null, G2]), [G1, G2])
assert.deepEqual(parseGroupes([G1, G2, G3, G4]), [G1, G2, G3], '3 au plus')
assert.deepEqual(parseGroupesRaw(null), [])
assert.deepEqual(parseGroupesRaw('pas du json'), [])
assert.deepEqual(parseGroupesRaw('{"a":1}'), [])
assert.deepEqual(parseGroupesRaw(JSON.stringify([G2, G1])), [G2, G1], 'ordre du choix gardé')
assert.ok(UUID_RE.test(G1) && UUID_RE.test(G1.toUpperCase()) && !UUID_RE.test('id-abc') && !UUID_RE.test(G1 + '0'))
assert.ok(sameIds([G1, G2], [G1, G2]) && !sameIds([G1, G2], [G2, G1]) && !sameIds([G1], [G1, G2]))

// Bascule : ajout au bout, retrait, rien au-delà de 3.
assert.equal(MAX_REPERES, 3)
assert.deepEqual(toggleGroupe([], G1), [G1])
assert.deepEqual(toggleGroupe([G1, G2], G1), [G2])
assert.deepEqual(toggleGroupe([G1, G2, G3], G4), [G1, G2, G3])
assert.deepEqual(toggleGroupe([G1, G2, G3], G2), [G1, G3])

// ---------- Table joueur → groupes ----------
const groups = [
  { id: G1, name: 'Comité 83', color: 'bleu', playerIds: ['p1', 'p2', 'p2', 'p3'] },
  { id: G2, name: 'Interligue', playerIds: ['p2', 'p4'] },
  { id: G3, name: 'France U15', color: 'orange', playerIds: ['p2'] },
]
const m = ringMembership([G3, G1, G4, G2], groups)
assert.deepEqual(m.groups.map((g) => g.id), [G3, G1, G2], 'ordre du choix ; groupe absent sauté')
assert.equal(m.groups[2].color, fallbackGroupColor(G2))
assert.deepEqual(m.map.get('p2')?.map((g) => g.name), ['France U15', 'Comité 83', 'Interligue'], 'un joueur en double dans un groupe compte une fois')
assert.deepEqual(m.map.get('p1')?.map((g) => g.name), ['Comité 83'])
assert.equal(m.map.get('p9'), undefined)
assert.equal(ringMembership([], groups).map.size, 0)
// 40 000 joueurs dans trois groupes : la table se fait d'un coup.
const big = Array.from({ length: 40000 }, (_, i) => `p${i}`)
const t0 = performance.now()
const mb = ringMembership([G1, G2, G3], [
  { id: G1, name: 'A', playerIds: big },
  { id: G2, name: 'B', playerIds: big.slice(0, 20000) },
  { id: G3, name: 'C', playerIds: big.slice(10000, 12000) },
])
assert.equal(mb.map.size, 40000)
assert.equal(mb.map.get('p10500')?.length, 3)
assert.ok(performance.now() - t0 < 500, 'table de 40 000 joueurs en moins de 0,5 s')

// « N ici » : joueurs du groupe dans la liste, sans doublon.
assert.equal(countHere(['p1', 'p2', 'p2', 'p9'], new Set(['p1', 'p2', 'p3'])), 2)
assert.equal(countHere([], new Set(['p1'])), 0)

// Couleurs des anneaux : un groupe sans couleur dont la couleur tirée est déjà prise par un autre groupe repéré prend la
// suivante libre ; les couleurs enregistrées ne bougent jamais.
const fb = fallbackGroupColor(G2)
const next = GROUP_COLORS[(GROUP_COLORS.indexOf(fb) + 1) % GROUP_COLORS.length]
assert.deepEqual(resolveRingColors([{ id: G1, color: fb }, { id: G2 }]), [fb, next])
assert.deepEqual(resolveRingColors([{ id: G2 }, { id: G1, color: fb }]), [next, fb], 'la couleur enregistrée garde sa place, où qu’elle soit')
assert.deepEqual(resolveRingColors([{ id: G2 }]), [fb])
assert.deepEqual(resolveRingColors([{ id: G1, color: 'bleu' }, { id: G3, color: 'bleu' }]), ['bleu', 'bleu'], 'deux couleurs choisies identiques restent')
const twoFree = resolveRingColors([{ id: G2 }, { id: G2 + 'x' }, { id: G2 + 'y' }])
assert.equal(new Set(twoFree).size, 3, 'trois groupes sans couleur : trois couleurs')
const mc = ringMembership([G1, G2], [{ id: G1, name: 'A', color: fb, playerIds: ['p1'] }, { id: G2, name: 'B', playerIds: ['p1'] }])
assert.deepEqual(mc.map.get('p1')?.map((g) => g.color), [fb, next])

// ---------- Anneau ----------
assert.equal(ringLabel([]), '')
assert.equal(ringLabel([{ name: 'Comité 83' }]), 'Groupe repéré : Comité 83')
assert.equal(ringLabel([{ name: 'Comité 83' }, { name: 'Interligue' }]), 'Groupes repérés : Comité 83, Interligue')

console.log('test-reperer-groupes : OK')
