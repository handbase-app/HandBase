// Test du périmètre d'un compte (src/perimeter.ts, même règle que supabase/046_perimetre.sql) : département et club d'un
// joueur (outre-mer compris), périmètre d'un compte (ligue, comité, club, fédération, administrateur, sans affectation,
// sous-unités, boucle dans l'arbre, unités et affectations supprimées), texte affiché, lieu d'ouverture du bilan ; plan de la
// synchronisation quand le périmètre change (curseurs à effacer, lignes à oublier). Données fictives seulement.
//
//   npx jiti tools/test-perimetre.ts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  clubDepartment,
  deptInPerimeter,
  FULL_FORGET_EVERY_MS,
  hasPerimeter,
  hiddenCount,
  inPerimeter,
  isFederationLevel,
  orphanIds,
  perimeterDepts,
  perimeterOf,
  perimeterPlace,
  perimeterText,
  planScopeChange,
  playerClub,
  playerDepartment,
  SCOPED_TABLES,
  scopeSignature,
} from '../src/perimeter'
import type { AssignmentRow, LevelRow, UnitRow } from '../src/structureTree'

let n = 0
const t = (name: string, f: () => void) => {
  f()
  n++
  console.log(`ok ${n} - ${name}`)
}

// ---------- Département et club d'un joueur ----------

t('département : n° de club, sinon licence, sinon département saisi', () => {
  assert.equal(playerDepartment({ clubCode: '6383015' }), '83')
  assert.equal(playerDepartment({ license: '6313005123456' }), '13')
  assert.equal(playerDepartment({ clubCode: '6383015', license: '6313005123456' }), '83')
  assert.equal(playerDepartment({ department: ' 2A ' }), '2A')
  assert.equal(playerDepartment({}), undefined)
  assert.equal(playerDepartment({ clubCode: 'ABC', department: '06' }), '06')
})
t('département : ligues ultramarines 64 à 70 → territoire', () => {
  const om: Record<string, string> = { '64': '971', '65': '973', '66': '972', '67': '988', '69': '974', '70': '976' }
  for (const [ligue, dept] of Object.entries(om)) assert.equal(playerDepartment({ clubCode: `${ligue}01001` }), dept)
  assert.equal(clubDepartment('6401001'), '971')
  assert.equal(clubDepartment('club sans numéro'), undefined)
})
t('club : n° saisi, sinon 7 premiers chiffres de la licence', () => {
  assert.equal(playerClub({ clubCode: ' 6383015 ' }), '6383015')
  assert.equal(playerClub({ license: '6383015123456' }), '6383015')
  assert.equal(playerClub({ license: '123' }), undefined)
  assert.equal(playerClub({}), undefined)
})
t('même règle que le serveur : 045 (outre-mer) et 046 (club) écrits comme ici', () => {
  const sql045 = readFileSync(new URL('../supabase/045_departement_outre_mer.sql', import.meta.url), 'utf8')
  for (const pair of ["'64' then '971'", "'65' then '973'", "'66' then '972'", "'67' then '988'", "'69' then '974'", "'70' then '976'"]) assert.ok(sql045.includes(pair), pair)
  const sql046 = readFileSync(new URL('../supabase/046_perimetre.sql', import.meta.url), 'utf8')
  assert.ok(sql046.includes("left(p ->> 'license', 7)"))
  assert.ok(sql046.includes("'niveau-federation'"))
  // Les règles de lecture comparent des colonnes (pas de sous-requête par ligne) et évaluent le périmètre une fois.
  assert.ok(sql046.includes('scope_dept = any ((select public.hb_scope_depts())::text[])'))
})

// ---------- Arbre fictif ----------

const levels: LevelRow[] = [
  { id: 'niveau-federation', name: 'Fédération', order: 1 },
  { id: 'niveau-ligue', name: 'Ligue', order: 2 },
  { id: 'niveau-comite', name: 'Comité', order: 3 },
  { id: 'niveau-pole', name: 'Pôle', order: 4 },
  { id: 'niveau-club', name: 'Club', order: 5 },
  { id: 'lv-fede-bis', name: 'FÉDÉRATION (tête)', order: 0 },
]
const units: UnitRow[] = [
  { id: 'fed', levelId: 'niveau-federation', name: 'Fédération fictive' },
  { id: 'sud', levelId: 'niveau-ligue', name: 'Ligue Sud fictive', parentId: 'fed' },
  { id: 'c83', levelId: 'niveau-comite', name: 'Comité du Var', parentId: 'sud', departments: ['83'] },
  { id: 'c13', levelId: 'niveau-comite', name: 'Comité 13 fictif', parentId: 'sud', departments: ['13'] },
  { id: 'clA', levelId: 'niveau-club', name: 'Club A', parentId: 'c83', clubNumber: '6383001' },
  { id: 'clB', levelId: 'niveau-club', name: 'Club B', parentId: 'sud', clubNumber: '6306002' }, // rangé sous la ligue : le 06 vient de son n°
  { id: 'pole', levelId: 'niveau-pole', name: 'Pôle fictif', parentId: 'sud' },
  { id: 'gp', levelId: 'niveau-ligue', name: 'Ligue GP fictive', parentId: 'fed' },
  { id: 'clGP', levelId: 'niveau-club', name: 'Club GP', parentId: 'gp', clubNumber: '6475001' },
  { id: 'old', levelId: 'niveau-comite', name: 'Comité supprimé', parentId: 'sud', departments: ['84'], deleted: true },
  // Boucle (impossible en principe, refusée par le serveur et l'appli) : le calcul doit s'arrêter.
  { id: 'loopA', levelId: 'niveau-comite', name: 'Boucle A', parentId: 'loopB', departments: ['99'] },
  { id: 'loopB', levelId: 'niveau-comite', name: 'Boucle B', parentId: 'loopA' },
  { id: 'tete', levelId: 'lv-fede-bis', name: 'Tête renommée' },
]
const as = (userId: string, ...unitIds: string[]): AssignmentRow[] => unitIds.map((unitId, i) => ({ id: `${userId}-${i}`, userId, unitId, role: 'observateur' }))
const per = (userId: string, assignments: AssignmentRow[], admin = false) => perimeterOf({ userId, admin, units, levels, assignments })

// ---------- Périmètre d'un compte ----------

t('ligue : départements des comités + départements tirés des n° de clubs en dessous', () => {
  const p = per('u1', as('u1', 'sud'))
  assert.equal(p.all, false)
  assert.deepEqual(p.depts, ['06', '13', '83'])
  assert.deepEqual(p.clubs, [])
  assert.equal(hasPerimeter(p), true)
})
t('comité : son département seulement', () => {
  const p = per('u2', as('u2', 'c83'))
  assert.deepEqual(p.depts, ['83'])
  assert.equal(perimeterText(p), 'Comité du Var (83)')
})
t('club : seulement ce club (n° de club, ou licence du club si pas de n°)', () => {
  const p = per('u3', as('u3', 'clA'))
  assert.deepEqual(p.depts, [])
  assert.deepEqual(p.clubs, ['6383001'])
  assert.equal(inPerimeter(p, { clubCode: '6383001' }), true)
  assert.equal(inPerimeter(p, { license: '6383001999999' }), true)
  assert.equal(inPerimeter(p, { clubCode: '6383009' }), false) // même département, autre club
  assert.equal(perimeterText(p), 'Club A (n° 6383001)')
  assert.deepEqual(perimeterDepts(p), ['83'])
})
t('fédération (par son identifiant ou par le nom de son niveau) et administrateur : tout', () => {
  assert.equal(per('u4', as('u4', 'fed')).all, true)
  assert.equal(per('u5', as('u5', 'tete')).all, true)
  assert.equal(isFederationLevel('lv-fede-bis', levels), true)
  assert.equal(isFederationLevel('niveau-ligue', levels), false)
  const admin = per('u6', [], true)
  assert.equal(admin.all, true)
  assert.equal(perimeterText(admin), 'Toute la base (administrateur)')
  assert.equal(inPerimeter(admin, { clubCode: '6969001' }), true)
})
t('sans affectation : rien (texte absent, aucun joueur)', () => {
  const p = per('u7', as('autre', 'sud'))
  assert.equal(p.all, false)
  assert.equal(hasPerimeter(p), false)
  assert.equal(perimeterText(p), null)
  assert.equal(inPerimeter(p, { clubCode: '6383001' }), false)
  assert.equal(per(null as unknown as string, as('u7', 'sud')).depts.length, 0)
})
t('ses propres fiches restent visibles', () => {
  const p = per('u7', [])
  assert.equal(inPerimeter(p, { clubCode: '6313005', createdBy: 'u7' }, 'u7'), true)
  assert.equal(inPerimeter(p, { clubCode: '6313005', createdBy: 'u8' }, 'u7'), false)
})
t('outre-mer : club guadeloupéen sous une ligue → 971', () => {
  assert.deepEqual(per('u8', as('u8', 'gp')).depts, ['971'])
})
t('plusieurs affectations : union ; unités et affectations supprimées ignorées', () => {
  const p = per('u9', [...as('u9', 'c83', 'c13', 'old'), { id: 'x', userId: 'u9', unitId: 'gp', role: 'observateur', deleted: true }])
  assert.deepEqual(p.depts, ['13', '83'])
  assert.equal(p.units.length, 2)
  assert.equal(perimeterText(p), 'Comité 13 fictif (13) ; Comité du Var (83)')
})
t('boucle dans l’arbre : le calcul s’arrête', () => {
  assert.deepEqual(per('u10', as('u10', 'loopA')).depts, ['99'])
  assert.deepEqual(per('u10', as('u10', 'loopB')).depts, ['99'])
})
t('unité sans territoire (pôle sans département) : celui de sa ligue', () => {
  const p = per('u11', as('u11', 'pole'))
  assert.deepEqual(p.depts, ['06', '13', '83'])
  assert.equal(p.units[0].name, 'Pôle fictif')
})
t('unité sans territoire tout en haut : rien (pas de parent)', () => {
  const seul: UnitRow[] = [{ id: 'P', levelId: 'niveau-pole', name: 'Pôle seul' }]
  assert.deepEqual(perimeterOf({ userId: 'a', admin: false, units: seul, levels, assignments: as('a', 'P') }).depts, [])
})
t('ligue à beaucoup de départements : le nombre plutôt que la liste', () => {
  const many: UnitRow[] = [{ id: 'L', levelId: 'niveau-ligue', name: 'Grande ligue', departments: ['01', '02', '03', '04', '05', '06', '07', '08', '09'] }]
  assert.equal(perimeterText(perimeterOf({ userId: 'a', admin: false, units: many, levels, assignments: as('a', 'L') })), 'Grande ligue (9 départements)')
})
t('département dans le périmètre (carte du bilan)', () => {
  const ligue = per('u1', as('u1', 'sud'))
  assert.equal(deptInPerimeter(ligue, '06'), true)
  assert.equal(deptInPerimeter(ligue, '75'), false)
  assert.equal(deptInPerimeter(per('x', [], true), '75'), true)
})
t('bilan ouvert sur le périmètre : un département, une région, sinon la France', () => {
  const region = (d: string) => ({ '83': 'R-SUD', '13': 'R-SUD', '06': 'R-SUD', '971': 'R-GP', '99': undefined })[d]
  assert.deepEqual(perimeterPlace(per('u2', as('u2', 'c83')), region), { region: 'R-SUD', dept: '83' })
  assert.deepEqual(perimeterPlace(per('u3', as('u3', 'clA')), region), { region: 'R-SUD', dept: '83' })
  assert.deepEqual(perimeterPlace(per('u1', as('u1', 'sud')), region), { region: 'R-SUD', dept: '' })
  assert.equal(perimeterPlace(per('u9', as('u9', 'c83', 'gp')), region), null)
  assert.equal(perimeterPlace(per('x', [], true), region), null)
  assert.equal(perimeterPlace(per('u7', []), region), null)
})

// ---------- Synchronisation : périmètre changé ----------

const comite = { all: false, depts: ['83'], clubs: [] }
const ligue = { all: false, depts: ['13', '06', '83'], clubs: [] }
const tout = { all: true, depts: [], clubs: [] }
const now = 1_000_000_000_000

t('signature : ordre des listes sans importance', () => {
  assert.equal(scopeSignature({ all: false, depts: ['83', '13'], clubs: ['b', 'a'] }), scopeSignature({ all: false, depts: ['13', '83'], clubs: ['a', 'b'] }))
  assert.notEqual(scopeSignature(comite), scopeSignature(ligue))
})
t('première lecture (appareil d’avant 046) : oublier, sans tout relire', () => {
  assert.deepEqual(planScopeChange(null, comite, 0, now), { resetCursors: false, forget: true })
})
t('périmètre élargi (comité → ligue) : relire depuis le début (lignes devenues visibles = anciennes) et oublier', () => {
  assert.deepEqual(planScopeChange(scopeSignature(comite), ligue, now, now), { resetCursors: true, forget: true })
})
t('périmètre réduit (ligue → comité) : oublier, et relire (sans effet sur les lignes identiques)', () => {
  assert.deepEqual(planScopeChange(scopeSignature(ligue), comite, now, now), { resetCursors: true, forget: true })
})
t('inchangé : seulement la vérification du jour', () => {
  assert.deepEqual(planScopeChange(scopeSignature(comite), comite, now - 1000, now), { resetCursors: false, forget: false })
  assert.deepEqual(planScopeChange(scopeSignature(comite), comite, now - FULL_FORGET_EVERY_MS, now), { resetCursors: false, forget: true })
})
t('« tout » : rien à oublier ; y passer : tout relire', () => {
  assert.deepEqual(planScopeChange(null, tout, 0, now), { resetCursors: false, forget: false })
  assert.deepEqual(planScopeChange(scopeSignature(tout), tout, 0, now), { resetCursors: false, forget: false })
  assert.deepEqual(planScopeChange(scopeSignature(comite), tout, now, now), { resetCursors: true, forget: false })
})
t('tables relues : joueurs et lignes rattachées (pas les suivis, lus seulement par leur auteur)', () => {
  assert.deepEqual([...SCOPED_TABLES], ['players', 'measurements', 'evaluations', 'seen', 'rewatch', 'videos'])
})
t('lignes rattachées à oublier : joueur absent, sauf les siennes et celles à envoyer ; vidéos d’événement gardées', () => {
  const players = new Set(['p1'])
  const rows = [
    { id: 'a', playerId: 'p1' },
    { id: 'b', playerId: 'p2' },
    { id: 'c', playerId: 'p2', createdBy: 'me' },
    { id: 'd', playerId: 'p3' },
    { id: 'e' },
  ]
  assert.deepEqual(orphanIds('evaluations', rows, players, new Set(['d']), 'me'), ['b'])
  const videos = [
    { id: 'v1', targetKind: 'event', targetId: 'ev1' },
    { id: 'v2', targetKind: 'player', targetId: 'p2' },
    { id: 'v3', targetKind: 'player', targetId: 'p1' },
  ]
  assert.deepEqual(orphanIds('videos', videos, players, new Set(), null), ['v2'])
})
t('joueurs d’une liste hors périmètre : comptés', () => {
  assert.equal(hiddenCount(['p1', 'p2', 'p3'], new Set(['p2'])), 2)
  assert.equal(hiddenCount([], new Set()), 0)
})

console.log(`\n${n} tests réussis.`)
