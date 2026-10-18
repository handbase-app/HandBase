// Accord au genre (src/gender.ts) : formes de w(), accord d'un mot ou d'un groupe de mots, pluriel accordé,
// genre d'un ensemble (tout F → F, tout M → M, sinon mixte), genre déclaré d'un groupe / événement, latéralité.
//
//   npx jiti tools/test-genre.ts
import assert from 'node:assert/strict'
import { accord, genderOf, isFem, lateralityPlural, pluralG, setGender, w } from '../src/gender'
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

console.log('test-genre : OK')
