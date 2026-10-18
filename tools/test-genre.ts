// Accord au genre (src/gender.ts) : formes de w(), accord d'un mot ou d'un groupe de mots, pluriel accordé,
// genre d'un ensemble (tout F → F, tout M → M, sinon mixte), genre déclaré d'un groupe / événement, latéralité.
//
//   npx jiti tools/test-genre.ts
import assert from 'node:assert/strict'
import { accord, genderOf, isFem, lateralityPlural, listGender, pluralG, setGender, SEX_CHOICES, SEX_LABEL_ONE, SEX_LABELS, SEX_SHORT, sexLabel, w } from '../src/gender'
import { parseSex } from '../src/voiceFilters'
import { keysOfWord, isNameQuery } from '../src/playerQuery'
import { groupsSpec, SEX_LIST } from '../src/groupQuery'
import { filterLine } from '../src/bilanReport'
import { recipeText } from '../src/recipe'
import { lateralityLabel } from '../src/db'
import { sectionTitles } from '../src/groupExport'
import { originText } from '../src/followViews'

// ---------- w() ----------
assert.equal(w('F').joueurs, 'joueuses')
assert.equal(w('F').AucunJoueur, 'Aucune joueuse')
assert.equal(w('F').tousLesJoueurs, 'toutes les joueuses')
assert.equal(w('F').nouveauJoueur, 'nouvelle joueuse')
assert.equal(w('F').leJoueur, 'la joueuse')
assert.equal(w('F').duJoueur, 'de la joueuse')
assert.equal(w('F').vu, 'vue')
assert.equal(w('F').licencie, 'licenciée')
assert.equal(w('M').joueurs, 'joueurs')
assert.equal(w('mixte').joueurs, 'joueurs', 'mixte : masculin générique')
assert.equal(w(undefined).CeJoueur, 'Ce joueur')
assert.equal(w(null).il, 'il')
// Mêmes clés des deux côtés, formes non vides (sauf l'accord vide « e » au masculin).
assert.deepEqual(Object.keys(w('F')).sort(), Object.keys(w('M')).sort())
assert.ok(isFem('F') && !isFem('M') && !isFem('mixte') && !isFem(undefined))

// ---------- accord ----------
assert.equal(accord('vu', 'F'), 'vue')
assert.equal(accord('vu', 'F', 2), 'vues')
assert.equal(accord('vu', 'M', 2), 'vus')
assert.equal(accord('Noté', 'F'), 'Notée')
assert.equal(accord('droitier', 'F'), 'droitière')
assert.equal(accord('Gaucher', 'F', 3), 'Gauchères')
assert.equal(accord('joueur', 'F', 3), 'joueuses')
assert.equal(accord('nouveau', 'F'), 'nouvelle')
assert.equal(accord('nouveau', 'M', 2), 'nouveaux')
assert.equal(accord('nouveau', 'F', 2), 'nouvelles')
assert.equal(accord('inscrit', 'F'), 'inscrite')
assert.equal(accord('sélectionné', 'F', 2), 'sélectionnées')
assert.equal(accord('Pas encore vu', 'F', 2), 'Pas encore vues')
assert.equal(accord('Joueur suivi', 'F'), 'Joueuse suivie')
assert.equal(accord('aucun joueur', 'F'), 'aucune joueuse')
assert.equal(accord('ambidextre', 'F'), 'ambidextre')
assert.equal(accord('vu', 'mixte'), 'vu')

// ---------- pluralG ----------
assert.equal(pluralG(14, 'F'), '14 joueuses')
assert.equal(pluralG(1, 'F'), '1 joueuse')
assert.equal(pluralG(0, 'F'), '0 joueuse')
assert.equal(pluralG(14, 'M'), '14 joueurs')
assert.equal(pluralG(14, 'mixte'), '14 joueurs')
assert.equal(pluralG(2, 'F', 'joueur suivi'), '2 joueuses suivies')
assert.equal(pluralG(1, 'F', 'nouveau joueur'), '1 nouvelle joueuse')
assert.equal(pluralG(1500, 'F').replace(/\s/g, ' '), '1 500 joueuses')

// ---------- genderOf / setGender ----------
const F = { sex: 'F' }
const M = { sex: 'M' }
const X = {}
assert.equal(genderOf([F, F]), 'F')
assert.equal(genderOf([M]), 'M')
assert.equal(genderOf([F, M]), 'mixte')
assert.equal(genderOf([F, X]), 'mixte', 'un sexe inconnu : pas sûr → mixte')
assert.equal(genderOf([]), undefined)
assert.equal(genderOf([undefined, F]), 'F', 'joueurs absents ignorés')
assert.equal(setGender('mixte', [F, F]), 'mixte', 'sexe déclaré prioritaire')
assert.equal(setGender('F', [M]), 'F')
assert.equal(setGender(undefined, [F, F]), 'F')
assert.equal(setGender('', [M, F]), 'mixte')

// ---------- latéralité ----------
assert.equal(lateralityPlural('droitier', 'F'), 'Droitières')
assert.equal(lateralityPlural('gaucher', 'M'), 'Gauchers')
assert.equal(lateralityPlural('ambidextre', 'F'), 'Ambidextres')
assert.equal(lateralityPlural(undefined, 'F'), '')
assert.equal(lateralityLabel('gaucher', 'F'), 'Gauchère')

// ---------- Export de groupe : titres des parties ----------
assert.equal(sectionTitles([F, F]).all, 'Liste des joueuses', 'toutes des filles, sans sexe déclaré')
assert.equal(sectionTitles([F, F], 'mixte').all, 'Liste des joueurs', 'groupe déclaré mixte : masculin')
assert.equal(sectionTitles([F, M], 'F').arrivals, 'Nouvelles arrivantes', 'groupe déclaré Filles')
assert.equal(sectionTitles([]).all, 'Liste des joueurs')

// ---------- Mes suivis : origine ----------
const o = { direct: true, groups: [] }
assert.equal(originText(o, undefined, 'F')?.detail, 'Suivie directement (★)')
assert.equal(originText(o)?.detail, 'Suivi directement (★)')
assert.equal(originText(o, undefined, 'F')?.text, 'suivi direct', 'le nom « suivi » ne change pas')

// ---------- Étape 2 : listes filtrées ----------
assert.equal(listGender('F'), 'F', 'filtre Féminin')
assert.equal(listGender('F', []), 'F', 'filtre Féminin, liste vide')
assert.equal(listGender('M', [F, F]), undefined, 'filtre Masculin : masculin')
assert.equal(listGender(undefined, [F, F]), 'F', 'sans filtre, que des filles')
assert.equal(listGender(undefined, [F, M]), undefined, 'mixte : masculin générique')
assert.equal(listGender(undefined, [F, X]), undefined, 'sexe inconnu : masculin générique')
assert.equal(listGender(undefined, []), undefined)
assert.equal(listGender('all'), undefined)

// ---------- « Masculin / Féminin / Mixte » (jamais Garçons / Filles, jamais Hommes / Femmes) ----------
assert.deepEqual(SEX_LABELS, { M: 'Masculin', F: 'Féminin', mixte: 'Mixte' })
assert.deepEqual(SEX_LABEL_ONE, { M: 'Masculin', F: 'Féminin' })
assert.deepEqual(SEX_SHORT, { M: 'Masc.', F: 'Fém.', mixte: 'Mixte' })
assert.deepEqual(SEX_CHOICES.map((c) => c.label), ['Masculin', 'Féminin', 'Mixte'])
assert.deepEqual(SEX_CHOICES.map((c) => c.value), ['M', 'F', 'mixte'], 'valeurs stockées inchangées')
assert.deepEqual(SEX_LIST.map((c) => [c.value, c.label]), [['M', 'Masculin'], ['F', 'Féminin'], ['mixte', 'Mixte']])
assert.equal(sexLabel('F'), 'Féminin')
assert.equal(sexLabel('M', true), 'Masc.')
assert.equal(sexLabel(null), '')
assert.equal(sexLabel('x'), '')
for (const t of [...Object.values(SEX_LABELS), ...Object.values(SEX_SHORT)]) assert.ok(!/gar[çc]on|fille|homme|femme/i.test(t), t)
assert.equal(filterLine({ what: ['Vues'], sex: 'F' }), 'Vues · Féminin')
const names = { position: (x: string) => x, region: (x: string) => x, dept: (x: string) => x, club: (x: string) => x, group: (x: string) => x, event: (x: string) => x, criterion: (x: string) => x, profile: (x: string) => x, today: '2026-10-18' } as never
assert.ok(recipeText({ pop: { sex: 'F' }, avis: [], measures: [], out: { type: 'count' } } as never, names).startsWith('Féminin'))
assert.ok(recipeText({ pop: { sex: 'M', hand: 'gaucher' }, avis: [], measures: [], out: { type: 'count' } } as never, names).startsWith('Masculin'))
assert.ok(recipeText({ pop: { sex: 'F', hand: 'gaucher' }, avis: [], measures: [], out: { type: 'count' } } as never, names).includes('gauchères'))

// ---------- La voix comprend toujours filles / garçons, et aussi féminin / masculin ----------
for (const s of ['filles', 'fille', 'féminines', 'féminine', 'féminin', 'féminins', 'F', 'joueuses']) assert.equal(parseSex(s), 'F', s)
for (const s of ['garçons', 'garçon', 'masculins', 'masculin', 'masculine', 'M']) assert.equal(parseSex(s), 'M', s)
for (const s of ['filles', 'garçons', 'féminin', 'masculin', 'féminines', 'masculins', 'sexe']) assert.deepEqual(keysOfWord(s), ['sex'], s)
for (const s of ['filles', 'garcons', 'feminin', 'masculin', 'feminines', 'masculins', 'mixtes']) assert.deepEqual(groupsSpec.words[s], ['sex'], s)
for (const s of ['les féminines de 2011', 'masculins nés en 2010', 'les filles du Var']) assert.ok(!isNameQuery(s), `phrase : ${s}`)

console.log('test-genre : OK')
