// Test du rapport de la vue du bilan (src/bilanReport.ts) : adresse ↔ état de la vue et choix, en-tête, étage, noms.
//
//   npx jiti tools/test-rapport-vue.ts
import assert from 'node:assert/strict'
import {
  bilanPart,
  cellText,
  countBy,
  defaultChoices,
  filterLine,
  leftOf,
  metaLine,
  namesAllowed,
  parseReportChoices,
  reportSearch,
  reportTitle,
  seasonShort,
  STAGE_COLUMN,
  stageOf,
  topTests,
  whereToGo,
} from '../src/bilanReport'
import { ONGLETS } from '../src/coverage'

const ALL = [...ONGLETS]
const france = { region: '', dept: '', club: null }
const sud = { region: '93', dept: '', club: null }
const varDept = { region: '93', dept: '83', club: null }
const club = { region: '93', dept: '83', club: 'hbc exemple' }

// ---------- Étage → type de tableau ----------
assert.equal(stageOf(france), 'regions')
assert.equal(stageOf(sud), 'depts')
assert.equal(stageOf(varDept), 'clubs')
assert.equal(stageOf(club), 'club')
assert.equal(stageOf({ region: '', dept: '?', club: null }), 'clubs') // département non renseigné : ses clubs
assert.equal(stageOf({ region: '93', dept: '83', club: '' }), 'club') // club non renseigné : un club quand même
assert.equal(STAGE_COLUMN.regions, 'Région')
assert.equal(STAGE_COLUMN.club, 'Génération')

// ---------- Noms permis ou non ----------
assert.equal(namesAllowed(france).ok, false)
assert.equal(namesAllowed(sud).ok, false)
const why = namesAllowed(sud)
assert.ok(!why.ok && /département ou un club/.test(why.reason))
assert.equal(namesAllowed(varDept).ok, true)
assert.equal(namesAllowed(club).ok, true)

// ---------- Adresse du rapport ↔ état de la vue + choix ----------
const bilan = 'onglet=mesures&s=F&p=saison&v=carte&a=2011%2C2010&r=93&d=83&f=abc&t=Dupont'
const s1 = reportSearch(bilan, { tabs: ['reperes', 'vus', 'vus'], names: true, map: false })
assert.ok(s1.startsWith('?'))
const q1 = new URLSearchParams(s1.slice(1))
// Les paramètres du bilan passent tels quels…
for (const [k, v] of new URLSearchParams(bilan)) assert.equal(q1.get(k), v, k)
// … et les choix s'ajoutent : chiffres dans l'ordre des onglets, sans doublon.
assert.equal(q1.get('ch'), 'vus,reperes')
assert.equal(q1.get('noms'), '1')
assert.equal(q1.get('carte'), '0')
// Retour : l'état du bilan seul (sans les choix), relu à l'identique.
assert.equal(bilanPart(q1).toString(), new URLSearchParams(bilan).toString())
assert.deepEqual(parseReportChoices(q1, ALL, 'mesures', varDept), { tabs: ['vus', 'reperes'], names: true, map: false })
// Choix par défaut : l'onglet affiché, sans noms, avec la carte ; rien de plus dans l'adresse.
const s2 = reportSearch('onglet=licencies&s=all', defaultChoices('licencies'))
assert.equal(s2, '?onglet=licencies&s=all&ch=licencies')
assert.deepEqual(parseReportChoices(new URLSearchParams(s2.slice(1)), ALL, 'licencies', france), { tabs: ['licencies'], names: false, map: true })
// Choix d'avant remplacés (pas de paramètre en double).
const s3 = reportSearch('ch=vus&noms=1&carte=0&s=M', { tabs: ['licencies'], names: false, map: true })
assert.equal(s3, '?s=M&ch=licencies')
// Noms demandés là où ils ne sont pas permis (adresse modifiée à la main) : refusés.
assert.equal(parseReportChoices(new URLSearchParams('noms=1'), ALL, 'vus', sud).names, false)
// Chiffres inconnus ou non permis à ce rôle (encadrant : « Vus » seulement) : l'onglet de la vue, sinon le premier permis.
assert.deepEqual(parseReportChoices(new URLSearchParams('ch=licencies,zzz'), ['vus'], 'vus', france).tabs, ['vus'])
assert.deepEqual(parseReportChoices(new URLSearchParams('ch='), ALL, 'mesures', france).tabs, ['mesures'])
assert.deepEqual(parseReportChoices(new URLSearchParams(''), ['vus'], 'mesures', france).tabs, ['vus'])
// Rapport complet : les 4 chiffres.
assert.deepEqual(parseReportChoices(new URLSearchParams('ch=reperes,mesures,licencies,vus'), ALL, 'vus', france).tabs, ALL)

// ---------- Texte d'en-tête ----------
assert.equal(reportTitle('Var (83)'), 'Bilan de détection — Var (83)')
assert.equal(reportTitle('France'), 'Bilan de détection — France')
assert.equal(seasonShort('2026-2027'), '2026-27')
assert.equal(seasonShort('Depuis toujours'), 'Depuis toujours')
assert.equal(filterLine({ what: ['Licenciés'], sex: 'M', years: 'nés en 2008', bar: ['Arrière gauche'] }), 'Licenciés · Garçons · nés en 2008 · Arrière gauche')
assert.equal(filterLine({ what: ['Vus', 'Mesurés par le staff'], sex: 'all' }), 'Vus · Mesurés par le staff')
assert.equal(filterLine({ what: ['Vus'], sex: 'F', years: '' }), 'Vus · Filles')
assert.equal(metaLine({ season: '2026-2027', edited: '18/10/2026', perimeter: 'Comité du Var (83)' }), 'Saison 2026-27 · édité le 18/10/2026 · périmètre : Comité du Var (83)')
assert.equal(metaLine({ season: '2026-2027', allTime: true, edited: '18/10/2026', perimeter: null }), 'Depuis toujours · édité le 18/10/2026')

// ---------- Cellules ----------
assert.equal(cellText('vus', { seen: 12, total: 30 }), '12/30 · 40 %')
assert.equal(cellText('mesures', { seen: 1, total: 3 }), '1/3 · 33 %')
assert.equal(cellText('licencies', { seen: 4, total: 1200 }), (1200).toLocaleString('fr-FR'))
assert.equal(cellText('reperes', { seen: 3, total: 30 }), '3 / 30')
assert.equal(cellText('vus', { seen: 0, total: 0 }), '–')
assert.equal(leftOf('vus', { seen: 12, total: 30 }), 18)
assert.equal(leftOf('licencies', { seen: 12, total: 30 }), null)

// ---------- Où aller (sans noms de joueurs) ----------
const clubs = [
  { key: 'a', name: 'AS Fictive', seen: 2, total: 10 },
  { key: 'b', name: 'HBC Exemple', seen: 0, total: 8 },
  { key: '', name: '', seen: 0, total: 50 }, // club non renseigné : pas une destination
  { key: 'c', name: 'Club Tout Vu', seen: 5, total: 5 }, // tous vus : rien à y faire
  { key: 'd', name: 'Bravo HB', seen: 0, total: 8 },
]
assert.deepEqual(whereToGo(clubs), [
  { name: 'AS Fictive', left: 8, total: 10 },
  { name: 'Bravo HB', left: 8, total: 8 },
  { name: 'HBC Exemple', left: 8, total: 8 },
])
assert.equal(whereToGo(clubs, 1).length, 1)
for (const r of whereToGo(clubs)) assert.deepEqual(Object.keys(r).sort(), ['left', 'name', 'total'])

// ---------- Tests les plus faits, par poste ----------
const meas = [
  { playerId: 'p1', criterionId: 'taille' },
  { playerId: 'p1', criterionId: 'taille' }, // même joueur : une fois
  { playerId: 'p2', criterionId: 'taille' },
  { playerId: 'p2', criterionId: 'detente' },
  { playerId: 'p3', criterionId: 'taille', author: 'Licence FFHB (déclarée)' }, // déclarée : pas une mesure du staff
  { playerId: 'p3', criterionId: 'vma', deleted: true },
  { playerId: 'hors', criterionId: 'vma' }, // hors du rapport
]
assert.deepEqual(topTests(meas, new Set(['p1', 'p2', 'p3']), 'Licence FFHB (déclarée)'), [
  ['taille', 2],
  ['detente', 1],
])
assert.deepEqual(
  countBy([{ pos: 'GB' }, { pos: 'ARG' }, { pos: 'GB' }, { pos: undefined }], (x) => x.pos),
  [
    ['GB', 2],
    ['ARG', 1],
  ],
)

console.log('rapport de la vue du bilan : OK')
