// Maturité (src/maturity.ts, src/maturitySnapshot.ts) : Mirwald 2002, Moore 2015, Fransen 2018,
// moyenne des modèles, appariement taille / taille assise / poids. Cas de référence recalculés à la main à partir des
// équations originales (Mirwald, Moore : Kozieł & Malina 2018, PMC5752743 ; Fransen : manuscrit des auteurs, dépôt UTS,
// et Salter et al. 2021, annexe 1). Joueurs entièrement fictifs.
//
//   npx jiti tools/test-maturity.ts
import assert from 'node:assert/strict'
import { decimalAge, fransen, fransenRatio, meanOffset, mirwald, moore, offsetReliable, phase, remainingGrowth, sherarAdultHeight, sherarCategory, sittingPlausible, timing } from '../src/maturity'
import { adultNoParents, snapshots } from '../src/maturitySnapshot'
import type { Measurement, Player } from '../src/db'

const near = (got: number | null, want: number, msg: string, tol = 0.005) => {
  assert.ok(got !== null && Math.abs(got - want) <= tol, `${msg} : ${got} au lieu de ${want}`)
}

// ---------- Garçon 13,0 ans, 155 cm, assis 80 cm, 45 kg ----------
const boy = { sex: 'M' as const, age: 13, height: 155, sitting: 80, weight: 45 }
near(mirwald(boy), -1.063, 'Mirwald garçon')
near(moore(boy), -0.813, 'Moore garçon (taille assise)')
near(moore({ ...boy, sitting: undefined }), -0.721, 'Moore garçon (taille debout)')
near(fransenRatio(boy), 0.92988, 'Fransen ratio', 0.00005)
near(boy.age / fransenRatio(boy)!, 13.98, 'Fransen âge au pic')
near(fransen(boy), -0.98, 'Fransen décalage')

// Recalcul littéral des équations (indépendant du code) sur un second garçon.
{
  const a = 13.5, h = 160, s = 82, w = 48, l = h - s
  near(mirwald({ sex: 'M', age: a, height: h, sitting: s, weight: w }), -9.236 + 0.0002708 * l * s - 0.001663 * a * l + 0.007216 * a * s + 0.02292 * ((w / h) * 100), 'Mirwald garçon 2', 1e-9)
  near(moore({ sex: 'M', age: a, height: h, sitting: s }), -8.128741 + 0.0070346 * a * s, 'Moore garçon 2', 1e-9)
  near(fransen({ sex: 'M', age: a, height: h, sitting: s, weight: w }), -0.4631, 'Fransen garçon 2 (âge au pic 13,96)', 0.0005)
}

// L'arrondi du coefficient taille³ à 0,000002 (vu dans un document) fausse complètement le ratio.
{
  const rounded = fransenRatio(boy)! - 0.000001656585 * boy.height ** 3 + 0.000002 * boy.height ** 3
  assert.ok(Math.abs(rounded - fransenRatio(boy)!) > 1, 'taille³ arrondi : écart > 1 sur le ratio')
}

// ---------- Fille 12,0 ans, 150 cm, assise 78 cm, 40 kg ----------
const girl = { sex: 'F' as const, age: 12, height: 150, sitting: 78, weight: 40 }
near(mirwald(girl), -0.175, 'Mirwald fille')
near(moore(girl), -0.107, 'Moore fille')
assert.equal(moore(girl), moore({ ...girl, sitting: undefined }), 'Moore fille : taille debout seulement')
assert.equal(fransen(girl), null, 'Fransen : non applicable aux filles')
{
  const a = 12, h = 150, s = 78, w = 40, l = h - s
  near(mirwald(girl), -9.376 + 0.0001882 * l * s + 0.0022 * a * l + 0.005841 * a * s - 0.002658 * a * w + 0.07693 * ((w / h) * 100), 'Mirwald fille littéral', 1e-9)
}

// ---------- Données manquantes ----------
assert.equal(mirwald({ ...boy, sitting: undefined }), null)
assert.equal(mirwald({ ...boy, weight: undefined }), null)
assert.equal(fransen({ ...boy, weight: undefined }), null)
assert.equal(fransen({ ...boy, sitting: undefined }), null)
assert.equal(fransen({ ...boy, sitting: 160 }), null, 'jambes négatives')

// ---------- Moyenne ----------
assert.deepEqual(meanOffset([null, -0.5, null]), { offset: -0.5, n: 1 })
assert.deepEqual(meanOffset([]), null)
near(meanOffset([-1.063, -0.813, -0.98])!.offset, -0.952, 'moyenne garçon')
assert.equal(meanOffset([mirwald(boy), moore(boy), fransen(boy)])!.n, 3)
assert.equal(meanOffset([mirwald(girl), moore(girl), fransen(girl)])!.n, 2)

// ---------- Causes d'écart fréquentes (sensibilité) ----------
{
  // Taille assise mesurée banc compris (banc de 40 cm) : résultat aberrant, repéré par sittingPlausible.
  const bench = mirwald({ ...boy, sitting: 120 })!
  assert.ok(Math.abs(bench - mirwald(boy)!) > 1, `banc compté : ${bench}`)
  assert.equal(sittingPlausible(155, 80), true)
  assert.equal(sittingPlausible(155, 120), false)
  // Poids/taille sans ×100 : environ 0,64 an d'écart pour ce garçon.
  const noX100 = mirwald(boy)! - 0.02292 * ((45 / 155) * 100) + 0.02292 * (45 / 155)
  assert.ok(Math.abs(noX100 - mirwald(boy)!) > 0.5, 'poids/taille sans ×100')
  // Âge entier (13) au lieu de l'âge décimal (13,9) : Moore bouge de plus d'un demi-an.
  assert.ok(Math.abs(moore({ ...boy, age: 13.9 }) - moore(boy)) > 0.5, 'âge décimal')
}

// ---------- Repères ----------
assert.equal(phase(-0.952), 'autour')
assert.equal(phase(-1.5), 'avant')
assert.equal(timing('M', 13.98), 'norme')
assert.equal(timing('M', 12.5), 'precoce')
assert.equal(offsetReliable(13, -0.95), true)
assert.equal(offsetReliable(17, 0.5), false)
near(decimalAge('2012-01-01', '2025-01-01'), 13.0, 'âge décimal', 0.01)

// ---------- snapshots : appariement des mesures et moyenne ----------
let n = 0
const m = (criterionId: string, date: string, value: number): Measurement => ({ id: `m${n++}`, playerId: 'p1', criterionId, date, value }) as Measurement
const player = { id: 'p1', firstName: 'Test', lastName: 'Fictif', sex: 'M', birthDate: '2012-01-01' } as Player
{
  // Mesures du même jour : trois modèles.
  const [s] = snapshots(player, [m('taille', '2025-01-01', 155), m('taille_assise', '2025-01-01', 80), m('poids', '2025-01-01', 45)])
  assert.equal(s.mean.n, 3)
  near(s.fransen, fransen({ ...boy, age: s.age }) ?? NaN, 'snapshot Fransen', 1e-9)
  near(s.mean.offset, (s.mirwald! + s.moore + s.fransen!) / 3, 'snapshot moyenne', 1e-9)
}
{
  // Poids pris 10 jours après la taille : pas retenu (même jour seulement) → Mirwald et Fransen impossibles, Moore seul.
  const [s] = snapshots(player, [m('taille', '2025-01-01', 155), m('taille_assise', '2025-01-01', 80), m('poids', '2025-01-11', 45)])
  assert.equal(s.weight, undefined)
  assert.equal(s.mirwald, null)
  assert.equal(s.mean.n, 1)
}
{
  // Taille assise d'un an plus tôt : pas mélangée avec la taille d'aujourd'hui → Moore (taille debout) seul.
  const [, s] = snapshots(player, [m('taille', '2024-01-01', 148), m('taille_assise', '2024-01-01', 77), m('poids', '2024-01-01', 40), m('taille', '2025-01-01', 155)])
  assert.equal(s.sitting, undefined)
  assert.equal(s.weight, undefined)
  assert.equal(s.mirwald, null)
  assert.equal(s.fransen, null)
  assert.equal(s.mean.n, 1)
  near(s.moore, moore({ sex: 'M', age: s.age, height: 155 }), 'Moore debout seul', 1e-9)
}
{
  // Fille : Fransen absent, moyenne sur deux modèles.
  const f = { ...player, sex: 'F' } as Player
  const [s] = snapshots(f, [m('taille', '2024-01-01', 150), m('taille_assise', '2024-01-01', 78), m('poids', '2024-01-01', 40)])
  assert.equal(s.fransen, null)
  assert.equal(s.mean.n, 2)
}

// ---------- Taille adulte sans les parents (croissance restante, Sherar 2005, garçons) ----------
// Lecture exacte d'une ligne : décalage 0, maturité normale (âge au pic 14) → 16,16 cm.
near(remainingGrowth(0, 14), 16.16, 'ligne 0 normale', 1e-9)
near(remainingGrowth(0, 12), 19.04, 'ligne 0 avancée', 1e-9)
near(remainingGrowth(0, 16), 13.05, 'ligne 0 retardée', 1e-9)
near(remainingGrowth(-4, 14), 40.09, 'borne −4', 1e-9)
near(remainingGrowth(4, 14), 0, 'borne +4', 1e-9)
near(remainingGrowth(-1.2, 14), 25.63, 'ligne −1,2 (flottant)', 1e-9)
// Interpolation : −1,1 normale, entre 25,63 (−1,2) et 24,36 (−1,0), au milieu.
{
  const r = remainingGrowth(-1.1, 14)!
  assert.ok(r < 25.63 && r > 24.36, `−1,1 entre les deux lignes : ${r}`)
  near(r, (25.63 + 24.36) / 2, '−1,1 interpolé', 1e-9)
  // Fiche Excel (RECHERCHEV approchée) : ligne inférieure −1,2 → 25,63 ; écart 0,635 cm avec l'interpolation.
  near(remainingGrowth(-1.1, 14, 'ligne'), 25.63, '−1,1 ligne inférieure', 1e-9)
  near(remainingGrowth(-1.1, 14, 'ligne')! - r, 0.635, 'écart interpolation / fiche', 1e-9)
  near(remainingGrowth(-1.15, 14, 'ligne'), 25.63, '−1,15 ligne inférieure', 1e-9)
}
// Catégorie : < 13 avancée, < 15 normale, sinon retardée.
assert.equal(sherarCategory(12.9), 'avancee')
assert.equal(sherarCategory(13), 'normale')
assert.equal(sherarCategory(14.9), 'normale')
assert.equal(sherarCategory(15), 'retardee')
near(remainingGrowth(0, 12.9), 19.04, 'âge au pic 12,9 → avancée', 1e-9)
near(remainingGrowth(0, 13), 16.16, 'âge au pic 13 → normale', 1e-9)
near(remainingGrowth(0, 14.9), 16.16, 'âge au pic 14,9 → normale', 1e-9)
near(remainingGrowth(0, 15), 13.05, 'âge au pic 15 → retardée', 1e-9)
// Hors plage.
assert.equal(remainingGrowth(-4.01, 14), null)
assert.equal(remainingGrowth(4.01, 14), null)
assert.equal(sherarAdultHeight({ height: 150, offset: -4.5, aphv: 14, sex: 'M' }), null)
// Taille adulte = taille + reste ; fille : null (table filles non disponible).
near(sherarAdultHeight({ height: 160, offset: 0, aphv: 14, sex: 'M' }), 176.16, 'taille adulte garçon', 1e-9)
assert.equal(sherarAdultHeight({ height: 150, offset: 0, aphv: 12, sex: 'F' }), null)
// Par modèle avec SON âge au pic, puis moyenne des tailles disponibles.
{
  const a = adultNoParents('M', 13, 155, { mirwald: -1.2, moore: 0, fransen: null })
  near(a.mirwald, 155 + 25.63, 'Mirwald −1,2, âge au pic 14,2 → normale', 1e-9)
  near(a.moore, 155 + 16.16, 'Moore 0, âge au pic 13 → normale', 1e-9)
  assert.equal(a.fransen, null)
  assert.equal(a.mean?.n, 2)
  near(a.mean!.height, 155 + (25.63 + 16.16) / 2, 'moyenne des tailles', 1e-9)
  // Même décalage, âge au pic différent → autre colonne : âge 11,5, décalage −1,2 → pic à 12,7 → avancée.
  near(adultNoParents('M', 11.5, 150, { mirwald: -1.2, moore: 0, fransen: null }).mirwald, 150 + 28.98, 'catégorie du modèle', 1e-9)
  // Fille : tout à null.
  assert.deepEqual(adultNoParents('F', 12, 150, { mirwald: -0.5, moore: 0, fransen: null }), { mirwald: null, moore: null, fransen: null, mean: null })
}
{
  // Validation de la table : calculateur de taille adulte de l'université de la Saskatchewan (méthode Sherar), garçon
  // fictif 13,0 ans (né le 01/01/2013, mesuré le 01/01/2026), 155 cm, assis 80 cm, 45 kg : maturité « Average »
  // (normale), croissance restante 25 cm, taille adulte 180 cm, 86,1 % atteint (le site arrondit le décalage à −1,1 →
  // 25,0 cm). Ici : décalage Mirwald −1,063, interpolé → 24,76 cm → 179,8 cm.
  const p13 = { ...player, birthDate: '2013-01-01' } as Player
  const [s] = snapshots(p13, [m('taille', '2026-01-01', 155), m('taille_assise', '2026-01-01', 80), m('poids', '2026-01-01', 45)])
  near(s.mirwald, -1.063, 'validation : décalage Mirwald', 0.005)
  assert.equal(sherarCategory(s.age - s.mirwald!), 'normale')
  near(s.adult.mirwald, 180, 'validation Saskatchewan : taille adulte Mirwald', 0.5)
  near(155 / s.adult.mirwald!, 0.861, 'validation : % atteint', 0.002)
}
{
  // Snapshot garçon : colonne présente et cohérente.
  const [s] = snapshots(player, [m('taille', '2025-01-01', 155), m('taille_assise', '2025-01-01', 80), m('poids', '2025-01-01', 45)])
  near(s.adult.mirwald, sherarAdultHeight({ height: 155, offset: s.mirwald!, aphv: s.age - s.mirwald!, sex: 'M' }) ?? NaN, 'snapshot taille adulte Mirwald', 1e-9)
  assert.equal(s.adult.mean?.n, 3)
}
console.log('test-maturity : OK')
