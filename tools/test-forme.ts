// Test de la « forme du jour » du tableau wellness du groupe (src/wellness.ts : formeDuJour, formeBand, formeWord,
// formeTitle, groupDay, WELLNESS_PICTO ; écran : src/pages/GroupWellness.tsx) : moyenne des notes du matin, moins un quart
// de la gêne la plus forte, bornée à 1 … 10, une décimale ; mots positifs ou neutres. Données fictives.
//
//   npx jiti tools/test-forme.ts
import assert from 'node:assert/strict'
import { formeBand, formeDuJour, formeTitle, formeWord, FORME_HOW, groupDay, LEVEL_WORDS, WELLNESS_KEYS, WELLNESS_PICTO, type WellnessEntry } from '../src/wellness'

const day = '2026-11-23'
const entry = (scores: WellnessEntry['scores'], pains?: { intensite: number }[]): WellnessEntry =>
  ({ day, scores, pain: !!pains?.length, ...(pains?.length ? { pains: pains.map((p, i) => ({ zone: `z${i}`, type: 'gene', intensite: p.intensite })) } : {}) }) as WellnessEntry

// Pas de réponse, ou une gêne sans note : pas de forme.
assert.equal(formeDuJour(null), null)
assert.equal(formeDuJour(undefined), null)
assert.equal(formeDuJour(entry({}, [{ intensite: 4 }])), null)

// Sans gêne : la moyenne des notes.
let f = formeDuJour(entry({ energie: 8, fraicheur: 7, humeur: 9, sommeil: 6 }))!
assert.equal(f.value, 7.5)
assert.equal(f.notes, 7.5)
assert.equal(f.count, 4)
assert.equal(f.pain, null)
assert.equal(f.minus, 0)

// Notes partielles : la moyenne de celles données.
f = formeDuJour(entry({ energie: 6, sommeil: 9 }))!
assert.equal(f.value, 7.5)
assert.equal(f.count, 2)

// Gêne : un quart de la plus forte retiré (8/10 : −2 ; 3/10 : −0,75).
f = formeDuJour(entry({ energie: 8, fraicheur: 8, humeur: 8, sommeil: 8 }, [{ intensite: 3 }, { intensite: 8 }]))!
assert.equal(f.pain, 8)
assert.equal(f.minus, 2)
assert.equal(f.value, 6)
f = formeDuJour(entry({ energie: 7, fraicheur: 7, humeur: 7, sommeil: 7 }, [{ intensite: 3 }]))!
assert.equal(f.value, 6.3)

// Une gêne ne fait jamais monter la forme ; plus elle est forte, plus elle pèse.
const base = formeDuJour(entry({ energie: 6, fraicheur: 6, humeur: 6, sommeil: 6 }))!.value
let prev = base
for (let i = 1; i <= 10; i++) {
  const v = formeDuJour(entry({ energie: 6, fraicheur: 6, humeur: 6, sommeil: 6 }, [{ intensite: i }]))!.value
  assert.ok(v < prev || (v === 1 && prev === 1), `gêne ${i}`)
  prev = v
}

// Bornes : jamais sous 1 ni au-dessus de 10.
assert.equal(formeDuJour(entry({ energie: 1, fraicheur: 1, humeur: 1, sommeil: 1 }, [{ intensite: 10 }]))!.value, 1)
assert.equal(formeDuJour(entry({ energie: 10, fraicheur: 10, humeur: 10, sommeil: 10 }))!.value, 10)

// Tranches : mêmes bornes que les jauges (1-2, 3-4, 5-6, 7-8, 9-10), décimales comprises.
assert.deepEqual([1, 2.9, 3, 4.9, 5, 6.9, 7, 8.9, 9, 10].map(formeBand), [0, 0, 1, 1, 2, 2, 3, 3, 4, 4])
// Mots : ceux de la jauge « énergie » du jeune, jamais une étiquette négative.
assert.equal(formeWord(9.5), LEVEL_WORDS.energie.levels[4])
assert.equal(formeWord(1), LEVEL_WORDS.energie.levels[0])
for (const v of [1, 3, 5, 7, 9]) assert.ok(!/mauvais|nul|faible|pas en forme|raté|échec/i.test(formeWord(v).word), formeWord(v).word)

// Title : la valeur, le mot, le détail et le calcul.
f = formeDuJour(entry({ energie: 8, fraicheur: 7 }, [{ intensite: 3 }]))!
const title = formeTitle(f)
assert.ok(title.startsWith('Forme du jour 6,8/10 · '), title)
assert.ok(title.includes('notes 7,5 de moyenne (2 sur 4)'), title)
assert.ok(title.includes('gêne 3/10 : −0,8'), title)
assert.ok(title.endsWith(FORME_HOW), title)

// Le groupe : réponses, forme moyenne, moyenne de chaque note.
const g = groupDay([
  entry({ energie: 8, fraicheur: 6, humeur: 7, sommeil: 9 }),
  null,
  entry({ energie: 6, fraicheur: 6, humeur: 7, sommeil: 5 }, [{ intensite: 4 }]),
  entry({}, [{ intensite: 2 }]),
])
assert.equal(g.answered, 3)
assert.equal(g.forme, 6.3) // (7,5 + 5) / 2 = 6,25 → 6,3
assert.deepEqual(g.avg, { energie: 7, fraicheur: 6, humeur: 7, sommeil: 7 })
const empty = groupDay([null, undefined])
assert.equal(empty.answered, 0)
assert.equal(empty.forme, null)
assert.deepEqual(empty.avg, { energie: null, fraicheur: null, humeur: null, sommeil: null })

// Un picto par note.
for (const k of WELLNESS_KEYS) assert.ok(WELLNESS_PICTO[k], k)

console.log('test-forme : OK')
