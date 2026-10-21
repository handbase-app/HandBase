// Test du profil volley (phase 1) : choix du sport (ligne « sport » de hb_config, sinon VITE_SPORT, sinon handball),
// postes du volley (4 par défaut, libéro ajouté par l'installation), étiquettes du terrain (courtTag), fonctions propres au
// handball (sportHas), familles de postes, vocabulaire de dictée, points d'accroche de la phase 2. Données fictives seulement.
//
//   npx jiti tools/test-sport-volley.ts
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { courtTag, SPOTS } from '../src/courtSpots'
import { positionsHelp, parseRows, rowsFromJson } from '../src/criteriaFormat'
import { correct } from '../src/dictation/clean'
import { dictationVocabulary } from '../src/dictation/vocabulary'
import { suggestionsFor } from '../src/demander'
import { isNameQuery } from '../src/playerQuery'
import { questionHint } from '../src/recipe'
import { pillLabel } from '../src/seqPills'
import {
  applySportConfig,
  currentSport,
  defaultSportId,
  familyLabel,
  familySkips,
  HANDBALL,
  isHandball,
  isKeeper,
  knownSport,
  LIBERO,
  positionCodes,
  positionFull,
  positionLabel,
  POSITIONS,
  resolveSportConfig,
  sportHas,
  sportProfile,
  VOLLEYBALL,
  type ConfigRow,
} from '../src/sportConfig'
import { SPORT_CONTENT, sportContent } from '../src/sportContent'

let n = 0
const t = (name: string, f: () => void) => {
  f()
  n++
  console.log(`ok ${n} - ${name}`)
}

const sportRow = (sport: string): ConfigRow => ({ id: 'sport', key: 'sport', value: { sport } })
const postesRow = (value: unknown): ConfigRow => ({ id: 'postes', key: 'postes', value })

// ---------- 1. Choix du sport ----------

t('VITE_SPORT : volley reconnu sous plusieurs formes, sinon handball', () => {
  assert.equal(defaultSportId(undefined), 'handball')
  assert.equal(defaultSportId(''), 'handball')
  assert.equal(defaultSportId('volley'), 'volley')
  assert.equal(defaultSportId('Volley-ball'), 'volley')
  assert.equal(defaultSportId('volleyball'), 'volley')
  assert.equal(defaultSportId('basket'), 'handball', 'sport inconnu dans la variable : handball')
  assert.equal(knownSport(42), undefined)
})
t('VITE_SPORT lu dans l’environnement (sous jiti : process.env)', () => {
  const before = process.env.VITE_SPORT
  process.env.VITE_SPORT = 'volley'
  assert.equal(defaultSportId(), 'volley')
  assert.deepEqual(resolveSportConfig([]), VOLLEYBALL)
  delete process.env.VITE_SPORT
  assert.equal(defaultSportId(), 'handball')
  assert.deepEqual(resolveSportConfig([]), HANDBALL)
  if (before !== undefined) process.env.VITE_SPORT = before
})
t('sans hb_config : le sport par défaut (variable) décide', () => {
  assert.deepEqual(resolveSportConfig([], 'handball'), HANDBALL)
  assert.deepEqual(resolveSportConfig([], 'volley'), VOLLEYBALL)
})
t('hb_config décide quand la ligne « sport » existe, quelle que soit la variable', () => {
  assert.deepEqual(resolveSportConfig([sportRow('handball')], 'volley'), HANDBALL)
  assert.deepEqual(resolveSportConfig([sportRow('volley')], 'handball'), VOLLEYBALL)
  assert.equal(resolveSportConfig([sportRow('Volley-Ball')], 'handball').sport, 'volley')
  // Ligne supprimée : ignorée.
  assert.deepEqual(resolveSportConfig([{ ...sportRow('handball'), deleted: true }], 'volley'), VOLLEYBALL)
  // Sport inconnu : postes du handball (à régler), nom = l'identifiant.
  const other = resolveSportConfig([sportRow('basket')], 'volley')
  assert.equal(other.sport, 'basket')
  assert.equal(other.sportName, 'basket')
  assert.deepEqual(other.positions, HANDBALL.positions)
})
t('ligne « postes » : remplace les postes du sport', () => {
  const cfg = resolveSportConfig([postesRow([...VOLLEYBALL.positions, LIBERO])], 'volley')
  assert.deepEqual(cfg.positions.map((p) => p.code), ['P', 'R4', 'C', 'PT', 'L'])
})

// ---------- 2. Postes du volley ----------

t('volley par défaut : 4 postes P, R4, C, PT (pas de libéro), libellés courts et complets', () => {
  assert.equal(VOLLEYBALL.sportName, 'Volley')
  assert.deepEqual(VOLLEYBALL.positions.map((p) => p.code), ['P', 'R4', 'C', 'PT'])
  assert.deepEqual(VOLLEYBALL.positions.map((p) => p.label), ['Passeur', 'Réceptionneur-attaquant', 'Central', 'Pointu'])
  assert.ok(VOLLEYBALL.positions.every((p) => p.family === 'champ'))
  assert.equal(LIBERO.code, 'L')
  assert.equal(LIBERO.family, 'gardien', 'le libéro : poste à part, comme le gardien')
  assert.deepEqual(sportProfile('volley').extraPositions, [LIBERO])
})
t('volley appliqué : POSITIONS, libellés, exports ; ancienne fiche de handball sans erreur', () => {
  assert.ok(applySportConfig(resolveSportConfig([], 'volley')))
  assert.deepEqual(positionCodes(), ['P', 'R4', 'C', 'PT'])
  assert.deepEqual(POSITIONS.map((p) => p.short), ['Passeur', 'R4', 'Central', 'Pointu'])
  assert.equal(positionLabel('R4'), 'R4')
  assert.equal(positionFull('R4'), 'Réceptionneur-attaquant')
  assert.equal(positionFull('PT'), 'Pointu (opposé)')
  assert.equal(positionLabel('GB'), 'GB')
  assert.equal(isKeeper('GB'), false)
  assert.ok(!positionCodes().some(isKeeper))
  assert.equal(isHandball(), false)
})
t('libéro ajouté par l’installation : famille « Libéro », règle des moyennes du volley', () => {
  applySportConfig(resolveSportConfig([sportRow('volley'), postesRow([...VOLLEYBALL.positions, LIBERO])]))
  assert.deepEqual(positionCodes(), ['P', 'R4', 'C', 'PT', 'L'])
  assert.equal(positionLabel('L'), 'Libéro')
  assert.equal(isKeeper('L'), true)
  assert.equal(familyLabel('gardien'), 'Libéro')
  assert.equal(familyLabel('champ'), 'Autre poste')
  // Le libéro défend mais n'attaque pas ; les autres postes sont classés partout.
  assert.equal(familySkips('L', 'attaque'), true)
  assert.equal(familySkips('L', 'defense'), false)
  assert.equal(familySkips('C', 'defense'), false)
  assert.equal(familySkips('C', undefined), false)
})

// ---------- 3. Terrain ----------

t('courtTag : les codes eux-mêmes en volley, G / ALG… en handball', () => {
  applySportConfig(resolveSportConfig([], 'volley'))
  for (const c of ['P', 'R4', 'C', 'PT', 'L']) assert.equal(courtTag(c), c)
  assert.equal(courtTag('GB'), 'GB', 'code sans place : tel quel')
  assert.equal(courtTag('GB', 'handball'), 'G')
  applySportConfig(resolveSportConfig([], 'handball'))
  assert.equal(courtTag('GB'), 'G')
  assert.equal(courtTag('AG'), 'ALG')
  assert.equal(courtTag('R4'), 'R4')
})
t('places du volley : R4 zone 4, C zone 3, PT zone 2 (devant), P zone 1, L zone 5 en pointillés', () => {
  const v = SPOTS.volley
  for (const c of [...VOLLEYBALL.positions.map((p) => p.code), 'L']) assert.ok(v[c], c)
  const ATTACK = 74 // ligne des 3 m
  assert.ok(v.R4!.x < v.C!.x && v.C!.x < v.PT!.x, 'devant : 4, 3, 2 de gauche à droite')
  for (const c of ['R4', 'C', 'PT']) assert.ok(v[c]!.y < ATTACK, `${c} devant`)
  assert.ok(v.P!.x > 180 && v.P!.y > ATTACK, 'passeur : arrière droit')
  assert.ok(v.L!.x < 120 && v.L!.y > ATTACK, 'libéro : arrière gauche')
  assert.equal(v.L!.special, true)
  assert.ok(!['P', 'R4', 'C', 'PT'].some((c) => v[c]!.special))
  // Handball inchangé : aucun rond en pointillés.
  assert.ok(Object.values(SPOTS.handball).every((s) => !s!.special))
})

// ---------- 4. Fonctions propres au handball ----------

t('Gest’Hand et feuille de match FFHB : handball seulement', () => {
  assert.equal(sportHas('licencesGestHand', 'handball'), true)
  assert.equal(sportHas('feuilleMatchFFHB', 'handball'), true)
  assert.equal(sportHas('licencesGestHand', 'volley'), false)
  assert.equal(sportHas('feuilleMatchFFHB', 'volley'), false)
  assert.equal(sportHas('feuilleMatchFFHB', 'basket'), false)
  applySportConfig(resolveSportConfig([], 'handball'))
  assert.equal(isHandball(), true)
  assert.equal(sportHas('feuilleMatchFFHB'), true)
  applySportConfig(resolveSportConfig([], 'volley'))
  assert.equal(sportHas('feuilleMatchFFHB'), false)
})
t('handball : familles et règle des moyennes comme avant', () => {
  applySportConfig(resolveSportConfig([], 'handball'))
  assert.equal(familyLabel('gardien'), 'Gardien')
  assert.equal(familySkips('GB', 'defense'), true)
  assert.equal(familySkips('GB', 'attaque'), true)
  assert.equal(familySkips('GB', 'gardien'), false)
  assert.equal(familySkips('AG', 'gardien'), true)
  assert.equal(familySkips('AG', 'gardien-arrets'), true)
  assert.equal(familySkips('AG', 'defense'), false)
})
t('mots du sport : « le hand », « le volley » ; fédération', () => {
  assert.equal(sportProfile('handball').word, 'hand')
  assert.equal(sportProfile('volley').word, 'volley')
  assert.equal(sportProfile('volley').federation, 'Fédération française de volley')
})

// ---------- 5. Dictée ----------

t('dictée : aucun terme du handball injecté en volley', () => {
  assert.ok(dictationVocabulary('handball').mots.length > 0)
  assert.ok(dictationVocabulary('handball').corrections.length > 0)
  assert.deepEqual(dictationVocabulary('volley'), { mots: [], corrections: [] })
  assert.deepEqual(dictationVocabulary('basket'), { mots: [], corrections: [] })
  assert.equal(correct('une roue coulette', 'handball').texte, 'une roucoulette')
  assert.equal(correct('une roue coulette', 'volley').texte, 'une roue coulette')
})

// ---------- 6. Points d'accroche de la phase 2 ----------

t('critères et tests : un fichier par sport ; volley encore vide', () => {
  assert.equal(sportContent('handball').demoCriteria, 'demo/criteres-demo.json')
  assert.equal(sportContent('basket'), SPORT_CONTENT.handball)
  const file = (f: string) => readFileSync(new URL(`../public/${f}`, import.meta.url), 'utf8')
  assert.ok(existsSync(new URL(`../public/${sportContent('volley').demoCriteria}`, import.meta.url)))
  assert.equal(parseRows(rowsFromJson(file(sportContent('volley').demoCriteria))).rows.length, 0)
  assert.ok(parseRows(rowsFromJson(file(sportContent('handball').demoCriteria))).rows.length > 0)
})
t('aide « postes » du classeur de critères : codes du sport en cours', () => {
  applySportConfig(resolveSportConfig([], 'volley'))
  assert.match(positionsHelp(), /\(volley : P, R4, C, PT\)/)
  applySportConfig(resolveSportConfig([], 'handball'))
  assert.match(positionsHelp(), /\(handball : GB, AG, ARG, DC, ARD, AD, PIV\)/)
})
t('séquenceur : table de pastilles par sport (volley vide : libellés de la feuille gardés)', () => {
  applySportConfig(resolveSportConfig([], 'volley'))
  assert.equal(pillLabel('but').short, 'BUT')
  applySportConfig(resolveSportConfig([], 'handball'))
  assert.equal(pillLabel('but').short, 'BUT')
  assert.equal(currentSport().sport, 'handball')
})

t('✦ en volley : suggestions et exemple sans poste du handball ; « passeurs » est une phrase, pas un nom', () => {
  applySportConfig(resolveSportConfig([], 'volley'))
  const s = suggestionsFor('joueurs', { today: '2026-10-19' })
  assert.equal(s[0], 'Les passeurs pas encore vus cette saison')
  assert.ok(!/gardien/.test(questionHint()))
  assert.equal(isNameQuery('passeurs'), false)
  assert.equal(isNameQuery('centraux'), false)
  assert.equal(isNameQuery('Martin'), true)
  applySportConfig(resolveSportConfig([], 'handball'))
  assert.equal(suggestionsFor('joueurs', { today: '2026-10-19' })[0], 'Les gardiens pas encore vus cette saison')
  assert.match(questionHint(), /combien de gardiens 2009/)
  // Handball inchangé : « pointu » reste un nom possible.
  assert.equal(isNameQuery('Pointu'), true)
})

console.log(`\n${n} tests OK`)
