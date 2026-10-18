// Test des pictogrammes au bout des lignes de joueurs (src/pictos.ts) : réglage par défaut et relu, bascule, règle de
// place (une ou deux lignes), mesures récentes, faits calculés en lot, lien vers l'onglet de la fiche.
//
//   npx jiti tools/test-pictos.ts
import assert from 'node:assert/strict'
import type { Evaluation, Measurement, PlayerGroup, Video } from '../src/db'
import {
  buildFacts,
  DEFAULT_PICTOS,
  ficheOnTab,
  isDefaultPictos,
  parsePictos,
  PICTO_KINDS,
  pictoLines,
  recentSince,
  serializePictos,
  togglePicto,
} from '../src/pictos'

// ---------- Réglage ----------
assert.equal(PICTO_KINDS.length, 8)
assert.deepEqual(DEFAULT_PICTOS, ['suivi', 'vu', 'revoir'])
// Rien de stocké, illisible, pas un tableau : défaut.
assert.deepEqual(parsePictos(null), ['suivi', 'vu', 'revoir'])
assert.deepEqual(parsePictos(undefined), ['suivi', 'vu', 'revoir'])
assert.deepEqual(parsePictos('{pas du json'), ['suivi', 'vu', 'revoir'])
assert.deepEqual(parsePictos('{"a":1}'), ['suivi', 'vu', 'revoir'])
// Inconnus ignorés, doublons retirés, ordre de la barre.
assert.deepEqual(parsePictos('["groupes","avis","inconnu","suivi","avis",3]'), ['suivi', 'avis', 'groupes'])
// Tout masqué : gardé tel quel (pas de retour au défaut).
assert.deepEqual(parsePictos('[]'), [])
// Aller-retour.
const all = [...PICTO_KINDS]
assert.deepEqual(parsePictos(serializePictos(all)), all)
assert.deepEqual(parsePictos(serializePictos(['pole', 'suivi'])), ['suivi', 'pole'])
// Bascule : ajoute ou retire, ordre de la barre.
assert.deepEqual(togglePicto(DEFAULT_PICTOS, 'videos'), ['suivi', 'vu', 'revoir', 'videos'])
assert.deepEqual(togglePicto(['suivi', 'vu', 'revoir', 'videos'], 'vu'), ['suivi', 'revoir', 'videos'])
assert.deepEqual(togglePicto([], 'groupes'), ['groupes'])
assert.ok(isDefaultPictos(['revoir', 'suivi', 'vu']))
assert.ok(!isDefaultPictos(['suivi', 'vu']))

// ---------- Règle de place ----------
// Tous les noms tiennent avec les pictogrammes : une ligne.
assert.equal(pictoLines([{ full: 120, on: 120, off: 120 }, { full: 90, on: 90, off: 90 }]), 1)
// Liste vide : une ligne.
assert.equal(pictoLines([]), 1)
// Un seul nom coupé à cause des pictogrammes : toute la liste sur deux lignes.
assert.equal(pictoLines([{ full: 120, on: 120, off: 300 }, { full: 200, on: 150, off: 300 }]), 2)
// Nom déjà trop long sans pictogrammes, et pas plus coupé avec : ne compte pas.
assert.equal(pictoLines([{ full: 400, on: 300, off: 300 }]), 1)
// Nom déjà trop long, mais les pictogrammes lui prennent encore de la place : deux lignes.
assert.equal(pictoLines([{ full: 400, on: 200, off: 300 }]), 2)
// Arrondis d'un pixel : tolérés.
assert.equal(pictoLines([{ full: 151, on: 150, off: 300 }]), 1)
assert.equal(pictoLines([{ full: 153, on: 150, off: 151 }]), 1)
// Ligne masquée (largeurs nulles) : ne compte pas.
assert.equal(pictoLines([{ full: 0, on: 0, off: 0 }]), 1)

// ---------- Mesures récentes (90 jours) ----------
assert.equal(recentSince('2026-10-18'), '2026-07-20')
assert.equal(recentSince('2026-03-01', 1), '2026-02-28')
assert.equal(recentSince('2024-03-01', 1), '2024-02-29')

// ---------- Faits en lot ----------
const v = (id: string, targetId: string, extra: Partial<Video> = {}) => ({ id, targetKind: 'player', targetId, url: 'https://exemple.test', updatedAt: 0, ...extra }) as Video
const e = (id: string, playerId: string, extra: Partial<Evaluation> = {}) => ({ id, playerId, observer: 'Obs', date: '2026-09-01', scores: {}, updatedAt: 0, ...extra }) as Evaluation
const m = (id: string, playerId: string, date: string, extra: Partial<Measurement> = {}) => ({ id, playerId, criterionId: 'taille', value: 180, date, updatedAt: 0, ...extra }) as Measurement
const g = (id: string, name: string, playerIds: string[], extra: Partial<PlayerGroup> = {}) => ({ id, name, playerIds, updatedAt: 0, ...extra }) as PlayerGroup
const facts = buildFacts(['a', 'b'], {
  videos: [v('v1', 'a'), v('v2', 'a'), v('v3', 'a', { deleted: true }), v('v4', 'b', { targetKind: 'event' }), v('v5', 'z')],
  evals: [e('e1', 'a'), e('e2', 'b'), e('e3', 'b'), e('e4', 'b', { deleted: true }), e('e5', 'z')],
  measurements: [m('m1', 'a', '2026-09-10'), m('m2', 'a', '2026-08-01'), m('m3', 'a', '2026-06-01'), m('m4', 'b', '2026-10-01', { deleted: true })],
  groups: [g('g1', 'U15 Ligue', ['a', 'b']), g('g2', 'Autre staff', ['a']), g('g3', 'Ancien', ['a'], { archived: true }), g('g4', 'Mon staff', ['b'], { deleted: true })],
  since: '2026-07-20',
  isMine: (x) => x.id !== 'g2',
})
assert.deepEqual(facts.get('a'), { videos: 2, avis: 1, recent: 2, lastMeasure: '2026-09-10', groups: ['U15 Ligue'] })
assert.deepEqual(facts.get('b'), { videos: 0, avis: 2, recent: 0, groups: ['U15 Ligue'] })
assert.equal(facts.has('z'), false)

// ---------- Lien vers l'onglet de la fiche ----------
assert.equal(ficheOnTab('/joueurs/a', 'avis', 'onglet'), '/joueurs/a?onglet=avis')
assert.equal(ficheOnTab('/joueurs/a?onglet=croissance', 'tests', 'onglet'), '/joueurs/a?onglet=tests')
// Onglet par défaut : sans paramètre ; ancre gardée.
assert.equal(ficheOnTab('/joueurs/a?onglet=croissance', 'profil', 'onglet', 'profil', '#videos'), '/joueurs/a#videos')
// Bilan : l'onglet de la fiche est « fiche », celui du bilan reste.
assert.equal(ficheOnTab('/bilan/joueurs/a?onglet=vus&club=x', 'avis', 'fiche'), '/bilan/joueurs/a?onglet=vus&club=x&fiche=avis')

console.log('test-pictos : OK')
