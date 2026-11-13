// Clubs nommés dans une réponse de « Poser une question » (src/answerClubs.ts, src/clubMap.ts placedClubs) : colonne de
// clubs d'un résultat SQL (noms ou n° de club), club de chaque ligne, position (structure importée), cadre de la carte.
// Clubs, joueurs et unités entièrement fictifs.
//
//   npx jiti tools/test-answer-clubs.ts
import assert from 'node:assert/strict'
import { clubsFrame, clubsInRows, knownClubs, locateClubs } from '../src/answerClubs'
import { placedClubs } from '../src/clubMap'

const deptOf = (n: string) => n.slice(2, 4)
const REGIONS: Record<string, string> = { '83': 'region-sud', '06': 'region-sud', '75': 'region-idf' }
const regionOf = (d: string) => REGIONS[d]

// Joueurs de l'appareil (fictifs) : club tel qu'écrit, n° de club, département.
const players = [
  { club: 'HBC Exemple', clubCode: '6283001', dept: '83' },
  { club: 'HBC Exemple ', clubCode: '6283001', dept: '83' },
  { club: 'hbc exemple', clubCode: '6283001', dept: '83' },
  { club: 'AS Fictive', dept: '83' },
  { club: 'Handball Club Imaginaire 75', clubCode: '5875001', dept: '75' },
  { club: 'Club Sans Position', clubCode: '6206009', dept: '06' },
  { club: '', dept: '83' },
  { club: undefined, dept: '83' },
]
const U = (id: string, name: string, clubNumber: string | undefined, lat?: number, lng?: number, extra = {}) => ({
  id,
  levelId: 'niveau-club',
  name,
  ...(clubNumber ? { clubNumber } : {}),
  ...(lat !== undefined ? { lat, lng } : {}),
  ...extra,
})
const units = [
  U('u1', 'HBC EXEMPLE', '6283001', 43.12, 5.93, { city: 'Villefictive' }),
  U('u2', 'AS Fictive', undefined, 43.4, 6.3, { departments: ['83'] }),
  U('u3', 'Handball Club Imaginaire 75', '5875001', 48.85, 2.35),
  U('u4', 'Club Sans Position', '6206009'),
  U('u5', 'Club Sans Joueur', '6283077', 43.3, 6.6),
]

// ---------- Clubs des joueurs ----------
const known = knownClubs(players)
assert.deepEqual([...known.keys()].sort(), ['as fictive', 'club sans position', 'handball club imaginaire 75', 'hbc exemple'], 'club non renseigné : écarté')
assert.equal(known.get('hbc exemple')!.name, 'HBC Exemple', 'nom le plus écrit')
assert.equal(known.get('hbc exemple')!.dept, '83')

// ---------- Placement (plusieurs départements) ----------
const located = locateClubs(['handball club imaginaire 75', 'hbc exemple', 'as fictive', 'club sans position', 'inconnu'], known, units, deptOf)
assert.deepEqual([...located.keys()], ['handball club imaginaire 75', 'hbc exemple', 'as fictive', 'club sans position'], 'ordre gardé, club inconnu écarté')
assert.deepEqual(located.get('hbc exemple'), { key: 'hbc exemple', name: 'HBC Exemple', dept: '83', lat: 43.12, lng: 5.93, number: '6283001', city: 'Villefictive' }, 'par n° de club')
assert.deepEqual(located.get('as fictive'), { key: 'as fictive', name: 'AS Fictive', dept: '83', lat: 43.4, lng: 6.3 }, 'sans n° : nom replié unique du département')
assert.deepEqual(located.get('club sans position'), { key: 'club sans position', name: 'Club Sans Position', dept: '06' }, 'sans coordonnées : département seulement')
const pc = placedClubs([...known.values()], units, deptOf)
assert.deepEqual(pc.dots.map((d) => d.id).sort(), ['as fictive', 'handball club imaginaire 75', 'hbc exemple'], 'pas de point neutre')
assert.deepEqual(pc.unplaced.map((c) => c.key), ['club sans position'])
assert.deepEqual(placedClubs([...known.values()], [], deptOf).dots, [], 'sans structure importée : aucun point')

// ---------- Résultat SQL : la question du terrain ----------
// « Quel club en France a le plus de licenciés ? » : SELECT club, COUNT(*) AS nb_joueurs … LIMIT 1.
let f = clubsInRows({ columns: ['club', 'nb_joueurs'], rows: [['Handball Club Imaginaire 75', 106]] }, known, units, deptOf)!
assert.equal(f.col, 0)
assert.equal(f.value, 1, 'valeur : la colonne chiffrée')
assert.deepEqual(f.rows, [{ key: 'handball club imaginaire 75', name: 'Handball Club Imaginaire 75', dept: '75', lat: 48.85, lng: 2.35, number: '5875001' }])

// Noms écrits autrement (majuscules, accents, espaces), ligne sans club, club inconnu.
f = clubsInRows(
  {
    columns: ['nom_du_club', 'moyenne_attaque', 'nb'],
    rows: [
      ['  hbc   EXEMPLE', 3.5, 4],
      ['AS Fictive', 3.25, 2],
      [null, 3, 1],
      ['Club Inventé', 2, 1],
    ],
  },
  known,
  units,
  deptOf,
)!
assert.equal(f.col, 0, 'nom de colonne avec « club »')
assert.equal(f.value, 1, '1re colonne chiffrée')
assert.deepEqual(f.rows.map((r) => r?.key ?? null), ['hbc exemple', 'as fictive', null, null])

// Colonne sans « club » dans le nom : reconnue si la plupart de ses lignes sont des clubs.
f = clubsInRows({ columns: ['equipe', 'n'], rows: [['HBC Exemple', 3], ['AS Fictive', 1], ['Autre', 1]] }, known, units, deptOf)!
assert.equal(f.col, 0)
assert.equal(clubsInRows({ columns: ['prenom', 'n'], rows: [['Lucas', 3], ['HBC Exemple', 1], ['Léa', 1]] }, known, units, deptOf), null, 'une seule sur trois : pas une colonne de clubs')

// N° de club : le club de ses joueurs, sinon l'unité de la structure.
f = clubsInRows({ columns: ['numero_club', 'nb'], rows: [['6283001', 3], [6283077, 1], ['9999999', 1]] }, known, units, deptOf)!
assert.equal(f.col, 0)
assert.equal(f.value, 1, 'la colonne de n° n’est pas la valeur')
assert.equal(f.rows[0]!.key, 'hbc exemple')
assert.deepEqual(f.rows[1], { key: 'club sans joueur', name: 'Club Sans Joueur', dept: '83', lat: 43.3, lng: 6.6, number: '6283077' })
assert.equal(f.rows[2], null)

// Pas de clubs : rien (page comme avant). Joueurs listés (joueur_id) : leur propre affichage.
assert.equal(clubsInRows({ columns: ['annee', 'nb'], rows: [[2010, 3], [2011, 4]] }, known, units, deptOf), null)
assert.equal(clubsInRows({ columns: ['joueur_id', 'club'], rows: [['x', 'HBC Exemple']] }, known, units, deptOf), null)
assert.equal(clubsInRows({ columns: ['club'], rows: [] }, known, units, deptOf), null)

// ---------- Cadre de la carte ----------
const A = located.get('hbc exemple')!
const B = located.get('as fictive')!
const C = located.get('handball club imaginaire 75')!
assert.deepEqual(clubsFrame([A], regionOf), { region: 'region-sud', dept: '83' }, 'un club : son département')
assert.deepEqual(clubsFrame([A, B], regionOf), { region: 'region-sud', dept: '83' })
assert.deepEqual(clubsFrame([A, { key: 'x', name: 'X', dept: '06', lat: 43.7, lng: 7.2 }], regionOf), { region: 'region-sud', dept: '' }, 'une région')
assert.deepEqual(clubsFrame([A, C], regionOf), { region: '', dept: '' }, 'deux régions : la France')

console.log('test-answer-clubs : OK')
