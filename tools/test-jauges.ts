// Test des mots des jauges du « tableau de bord de jeu » de Ma page (src/wellness.ts : LEVEL_WORDS, levelWord, RPE_LEVELS,
// rpeLevel, levelBand, isTopLevel ; écran : src/components/Wellness.tsx, HudGauge) : 5 tranches (1-2, 3-4, 5-6, 7-8, 9-10)
// par note, les mots et émojis de la maquette du 09/11, toujours positifs ou neutres, « top » à 9 et 10, hors échelle : rien.
//
//   npx jiti tools/test-jauges.ts
import assert from 'node:assert/strict'
import { isTopLevel, LEVEL_INVITE, LEVEL_WORDS, levelBand, levelWord, RPE_LEVELS, RPE_QUESTION, rpeLevel, WELLNESS_ITEMS, WELLNESS_KEYS } from '../src/wellness'

let n = 0
const t = (name: string, f: () => void) => {
  f()
  n++
  console.log(`ok ${n} - ${name}`)
}

const words = (f: (v: number) => { word: string } | null) => Array.from({ length: 10 }, (_, i) => f(i + 1)!.word)
const emojis = (f: (v: number) => { emoji: string } | null) => Array.from({ length: 10 }, (_, i) => f(i + 1)!.emoji)

t('tranches de 2 : 1-2, 3-4, 5-6, 7-8, 9-10 ; hors échelle : -1', () => {
  assert.deepEqual(
    Array.from({ length: 10 }, (_, i) => levelBand(i + 1)),
    [0, 0, 1, 1, 2, 2, 3, 3, 4, 4],
  )
  for (const v of [0, 11, -1, 2.5, NaN, undefined, null]) assert.equal(levelBand(v as number), -1)
})

t('une question et 5 niveaux pour chacune des 4 notes du matin', () => {
  assert.deepEqual(Object.keys(LEVEL_WORDS).sort(), [...WELLNESS_KEYS].sort())
  for (const it of WELLNESS_ITEMS) {
    assert.equal(LEVEL_WORDS[it.key].levels.length, 5)
    assert.match(LEVEL_WORDS[it.key].question, /\?$/)
  }
  assert.equal(LEVEL_WORDS.energie.question, 'Ta batterie ce matin ?')
  assert.equal(LEVEL_WORDS.fraicheur.question, 'Tes jambes, elles disent quoi ?')
  assert.equal(LEVEL_WORDS.humeur.question, 'Ton mood du jour ?')
  assert.equal(LEVEL_WORDS.sommeil.question, 'Ta nuit, c’était comment ?')
})

t('mots de la maquette, par tranche', () => {
  const uniq = (k: keyof typeof LEVEL_WORDS) => [...new Set(words((v) => levelWord(k, v)))]
  assert.deepEqual(uniq('energie'), ['À recharger', 'En charge', 'Batterie OK', 'Bien chargé', 'Full charge'])
  assert.deepEqual(uniq('fraicheur'), ['Jambes à reposer', 'Ça tourne doucement', 'Jambes OK', 'Jambes légères', 'Jambes de feu'])
  assert.deepEqual(uniq('humeur'), ['Mood tranquille', 'Ça va', 'Good vibes', 'Grosse vibe', 'Au max'])
  assert.deepEqual(uniq('sommeil'), ['Nuit courte', 'Nuit moyenne', 'Bonne nuit', 'Grosse nuit', 'Nuit de champion'])
  assert.equal(levelWord('energie', 7)!.word, 'Bien chargé')
  assert.equal(levelWord('sommeil', 9)!.word, 'Nuit de champion')
  assert.equal(levelWord('humeur', 1)!.word, 'Mood tranquille')
})

t('émojis de la maquette', () => {
  assert.deepEqual([...new Set(emojis((v) => levelWord('energie', v)))], ['🪫', '🔋', '⚡'])
  assert.equal(levelWord('fraicheur', 1)!.emoji, '🦵')
  assert.equal(levelWord('fraicheur', 10)!.emoji, '🔥')
  assert.deepEqual(emojis((v) => levelWord('humeur', v)).filter((_, i) => i % 2 === 0), ['😐', '🙂', '😄', '😁', '🤩'])
  assert.deepEqual(emojis((v) => levelWord('sommeil', v)).filter((_, i) => i % 2 === 0), ['🌙', '🌙', '😴', '😴', '👑'])
})

t('séance : question et mots de l’intensité ressentie', () => {
  assert.equal(RPE_QUESTION, 'Ta séance, ça a chauffé comment ?')
  assert.equal(RPE_LEVELS.length, 5)
  assert.deepEqual([...new Set(words(rpeLevel))], ['Chill', 'Tranquille', 'Ça chauffe', 'Grosse séance', 'Hardcore'])
  assert.deepEqual(emojis(rpeLevel).filter((_, i) => i % 2 === 0), ['🛋️', '🚶', '🏃', '🔥', '⚡'])
})

t('pas de note, ou hors échelle : rien (la jauge invite)', () => {
  for (const v of [undefined, null, 0, 11, 3.5]) {
    assert.equal(levelWord('energie', v as number), null)
    assert.equal(rpeLevel(v as number), null)
  }
  assert.equal(LEVEL_INVITE.word, 'Touche ta jauge')
})

t('« top » (menthe) à 9 et 10 seulement', () => {
  assert.deepEqual(
    Array.from({ length: 10 }, (_, i) => isTopLevel(i + 1)),
    [false, false, false, false, false, false, false, false, true, true],
  )
  assert.equal(isTopLevel(undefined), false)
})

t('mots toujours positifs ou neutres (jamais d’étiquette négative sur un jeune)', () => {
  const all = [...WELLNESS_KEYS.flatMap((k) => LEVEL_WORDS[k].levels.map((l) => l.word)), ...RPE_LEVELS.map((l) => l.word), LEVEL_INVITE.word]
  for (const x of all) assert.doesNotMatch(x, /mauvais|nul|faible|mal\b|échec|pas retenu|fatigu|crevé|naze|épuis|vide|triste|horrible/i)
  for (const k of WELLNESS_KEYS) for (const l of LEVEL_WORDS[k].levels) assert.ok(l.emoji && l.word.length <= 20, `${k} : ${l.word}`)
})

console.log(`\n${n} essais réussis`)
