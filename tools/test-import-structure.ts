// Test de « Importer une structure (CSV) » (src/structureImport.ts) sur un fichier FICTIF : lecture (BOM, « ; » ou « , »),
// correspondance des colonnes, aperçu (créations, mises à jour, inchangées, anomalies), idempotence, mise à jour d'un nom,
// rattachements, anti-cycle, unités saisies à la main gardées, annulation, performance (3 000 unités fictives).
// Aucune donnée réelle : ligues, comités et clubs inventés.
//
//   npx jiti tools/test-import-structure.ts
import assert from 'node:assert/strict'
import {
  cleanDept,
  DEFAULT_OPTIONS,
  findUnits,
  groupAnomalies,
  guessMapping,
  planImport,
  planUndo,
  readStructureCsv,
  type ImportOptions,
  type ImportRecord,
  type Mapping,
} from '../src/structureImport'
import { buildTree, flatten, HANDBALL_LEVELS, subtreeCounts, wouldCycle, type LevelRow, type UnitRow } from '../src/structureTree'

let failed = 0
function t(name: string, fn: () => void) {
  try {
    fn()
    console.log(`ok   ${name}`)
  } catch (e) {
    failed++
    console.log(`FAIL ${name}\n     ${(e as Error).message}`)
  }
}

// ---------- Fichier fictif : 3 ligues, 5 comités, 20 clubs + lignes à anomalies ----------

const HEAD = 'code_ligue;ligue;departement;comite;numero_club;club;code_postal;ville;latitude;longitude'
const lines: string[] = []
const LIGUES = [
  ['91', 'Ligue Alpha', [['A1', 'Comité Alpha Nord'], ['A2', 'Comité Alpha Sud']]],
  ['92', 'Ligue Bêta', [['B1', 'Comité Bêta Est'], ['B2', 'Comité Bêta Ouest']]],
  ['93', 'Ligue Gamma', [['C1', 'Comité Gamma']]],
] as const
// Départements fictifs : codes numériques inventés (le serveur n'accepte que 2-3 chiffres, 2A, 2B).
const DEPT: Record<string, string> = { A1: '901', A2: '902', B1: '903', B2: '904', C1: '905' }
let n = 0
for (const [code, ligue, comites] of LIGUES)
  for (const [c, name] of comites)
    for (let k = 0; k < 4; k++) {
      n++
      lines.push(`${code};${ligue};${DEPT[c]};${name};99${String(n).padStart(5, '0')};CLUB FICTIF ${n};${DEPT[c]}10;VILLE ${n};4${n % 10}.5;${n % 7},25`)
    }
const CLEAN = lines.length // 20 clubs
// Anomalies :
lines.push(';;906;;;CLUB SANS LIGUE;90600;ILE FICTIVE;-10.5;170.1') // sans ligue, comité sans nom, club sans numéro
lines.push('93;Ligue Gamma;00;;9900099;GROUPEMENT FICTIF;93000;VILLE G;;') // département 00 : sous la ligue
lines.push('92;Ligue Bêta;907;;9900100;CLUB COMITE SANS NOM;90700;VILLE B;;') // comité sans nom → « Comité 907 »
lines.push('91;Ligue Alpha;901;Comité Alpha Nord;9900001;CLUB FICTIF 1 BIS;90110;VILLE 1;;') // doublon de numéro
lines.push('91;Ligue Alpha;901;Comité Alpha Nord;;;;;;') // ligne sans club
lines.push('92;Ligue Bêta;903;Comité Bêta Est;;CLUB SANS NUMERO;90310;VILLE X;;') // club sans numéro
const CSV = '﻿' + [HEAD, ...lines].join('\r\n') + '\r\n'

const LEVELS: LevelRow[] = HANDBALL_LEVELS.map((l) => ({ ...l }))
let idn = 0
const newId = () => `u${++idn}`
type U = UnitRow & { updatedAt?: number }

/** Applique un plan comme le ferait l'appli (saveMany) : renvoie les unités après écriture et la trace d'annulation. */
function apply(units: U[], plan: ReturnType<typeof planImport>, at: number): { units: U[]; record: ImportRecord } {
  const map = new Map(units.map((u) => [u.id, u]))
  for (const w of plan.writes) map.set(w.row.id, { ...w.row, updatedAt: at })
  return {
    units: [...map.values()],
    record: { at, file: 'fictif.csv', items: plan.writes.map((w) => ({ id: w.row.id, kind: w.kind, ...(w.before ? { before: w.before } : {}), after: at })) },
  }
}
const run = (units: U[], csv = CSV, options: ImportOptions = DEFAULT_OPTIONS, mapping?: Mapping) => {
  const table = readStructureCsv(csv)
  return planImport({ table, mapping: mapping ?? guessMapping(table.headers), units, levels: LEVELS, options, newId })
}

// ---------- Lecture et correspondance ----------

t('lecture : BOM, « ; », lignes vides', () => {
  const tb = readStructureCsv(CSV + '\r\n;;;\r\n')
  assert.equal(tb.headers[0], 'code_ligue')
  assert.equal(tb.rows.length, lines.length)
  assert.equal(tb.rows[0][1], 'Ligue Alpha')
})

t('lecture : séparateur « , » et guillemets', () => {
  const tb = readStructureCsv('Code ligue,Nom ligue,Dept,Comité,N° club,Nom du club,CP,Commune,Lat,Lon\n91,"Ligue, Alpha",901,Comité A,123,"Club ""Le Fictif""",90100,V,1,2\n')
  assert.equal(tb.rows[0][1], 'Ligue, Alpha')
  assert.equal(tb.rows[0][5], 'Club "Le Fictif"')
  const m = guessMapping(tb.headers)
  assert.deepEqual(m, { code_ligue: 0, ligue: 1, departement: 2, comite: 3, numero_club: 4, club: 5, code_postal: 6, ville: 7, latitude: 8, longitude: 9 })
})

t('correspondance proposée sur les noms officiels', () => {
  const m = guessMapping(readStructureCsv(CSV).headers)
  assert.equal(Object.keys(m).length, 10)
  assert.equal(m.numero_club, 4)
  assert.equal(m.club, 5)
})

t('départements nettoyés', () => {
  assert.equal(cleanDept('1'), '01')
  assert.equal(cleanDept('2a'), '2A')
  assert.equal(cleanDept('974'), '974')
  assert.equal(cleanDept('00'), '')
  assert.equal(cleanDept('X'), '')
})

// ---------- Aperçu et premier import ----------

let units: U[] = []
let first: ReturnType<typeof planImport>
t('aperçu : comptes et anomalies', () => {
  first = run([])
  assert.equal(first.blocker, undefined)
  assert.deepEqual(first.counts.root, { create: 1, update: 0, same: 0 })
  assert.deepEqual(first.counts.ligue, { create: 3, update: 0, same: 0 })
  // 5 comités nommés + « Comité 906 » (sans ligue) + « Comité 907 »
  assert.deepEqual(first.counts.comite, { create: 7, update: 0, same: 0 })
  // 20 + sans ligue + groupement + comité sans nom + sans numéro (doublon et ligne vide écartés)
  assert.deepEqual(first.counts.club, { create: CLEAN + 4, update: 0, same: 0 })
  const g = Object.fromEntries(groupAnomalies(first.anomalies).map((x) => [x.type, x.items.length]))
  assert.equal(g.sansLigue, 1)
  assert.equal(g.comiteSansNom, 2)
  assert.equal(g.sansDepartement, 1)
  assert.equal(g.clubSansNumero, 2)
  assert.equal(g.doublon, 1)
  assert.equal(g.ligneIgnoree, 1)
  assert.equal(first.levelsToCreate.length, 0)
  // Parents toujours écrits avant leurs enfants.
  const pos = new Map(first.writes.map((w, i) => [w.row.id, i]))
  for (const w of first.writes) if (w.row.parentId) assert.ok(pos.get(w.row.parentId)! < pos.get(w.row.id)!, `${w.row.name} avant son parent`)
  units = apply([], first, 1000).units
})

const byCode = (code: string) => units.find((u) => u.code === code)!
t('rattachements corrects', () => {
  const root = byCode('federation')
  assert.equal(root.name, 'Fédération française de handball')
  assert.equal(root.parentId, undefined)
  assert.equal(byCode('ligue:91').parentId, root.id)
  const ca = byCode('comite:91:901')
  assert.equal(ca.parentId, byCode('ligue:91').id)
  assert.deepEqual(ca.departments, ['901'])
  const c1 = byCode('club:9900001')
  assert.equal(c1.name, 'CLUB FICTIF 1')
  assert.equal(c1.parentId, ca.id)
  assert.equal(c1.clubNumber, '9900001')
  assert.equal(c1.postalCode, '90110')
  assert.equal(c1.city, 'VILLE 1')
  assert.equal(c1.lat, 41.5)
  assert.equal(c1.lng, 1.25)
  // Sans ligue : sous la fédération (comité 906 sans nom) ; département 00 : sous la ligue.
  const orphan = units.find((u) => u.name === 'CLUB SANS LIGUE')!
  assert.equal(byCode('comite::906').name, 'Comité 906')
  assert.equal(orphan.parentId, byCode('comite::906').id)
  assert.equal(byCode('comite::906').parentId, root.id)
  assert.equal(units.find((u) => u.name === 'GROUPEMENT FICTIF')!.parentId, byCode('ligue:93').id)
  assert.equal(byCode('comite:92:907').name, 'Comité 907')
  assert.ok(units.some((u) => u.code === 'club:club sans numero|90310'))
  // Niveaux.
  assert.equal(byCode('ligue:92').levelId, 'niveau-ligue')
  assert.equal(c1.levelId, 'niveau-club')
})

t('idempotence : deuxième import = aucun changement', () => {
  const again = run(units)
  assert.equal(again.writes.length, 0)
  assert.equal(again.counts.club.same, CLEAN + 4)
  assert.equal(again.counts.ligue.same, 3)
  assert.equal(again.counts.comite.same, 7)
  assert.equal(again.counts.root.same, 1)
})

t('mise à jour d’un nom, sans doublon', () => {
  const renamed = CSV.replace('CLUB FICTIF 3;', 'CLUB FICTIF TROIS;').replace(/Ligue Gamma/g, 'Ligue Gamma Nouvelle')
  const p = run(units, renamed)
  assert.equal(p.counts.club.update, 1)
  assert.equal(p.counts.club.create, 0)
  assert.equal(p.counts.ligue.update, 1)
  assert.equal(p.writes.length, 2)
  const club = p.writes.find((w) => w.kind === 'club')!
  assert.equal(club.row.id, byCode('club:9900003').id)
  assert.equal(club.row.name, 'CLUB FICTIF TROIS')
  assert.equal(club.before!.name, 'CLUB FICTIF 3')
})

t('unités saisies à la main : pôle gardé, club rangé sous le pôle garde sa place', () => {
  const pole: U = { id: 'pole', levelId: 'niveau-pole', name: 'Pôle fictif', parentId: byCode('comite:91:901').id, updatedAt: 5 }
  const c2 = byCode('club:9900002')
  const moved = units.map((u) => (u.id === c2.id ? { ...u, parentId: 'pole' } : u))
  const p = run([...moved, pole])
  assert.equal(p.writes.length, 0)
  assert.ok(p.anomalies.some((a) => a.type === 'garde' && a.detail === 'CLUB FICTIF 2'))
  assert.ok(!p.writes.some((w) => w.row.id === 'pole'))
})

t('unités déjà saisies à la main reprises (pas de doublon)', () => {
  const manual: U[] = [
    { id: 'm-ligue', levelId: 'niveau-ligue', name: 'LIGUE ALPHA' },
    { id: 'm-comite', levelId: 'niveau-comite', name: 'Comité du 902', departments: ['902'], parentId: 'm-ligue' },
    { id: 'm-pole', levelId: 'niveau-pole', name: 'Pôle', parentId: 'm-comite' },
  ]
  const p = run(manual)
  assert.equal(p.counts.ligue.update, 1)
  assert.equal(p.counts.ligue.create, 2)
  assert.equal(p.counts.comite.update, 1)
  const l = p.writes.find((w) => w.row.id === 'm-ligue')!
  assert.equal(l.row.code, 'ligue:91')
  assert.equal(l.row.name, 'Ligue Alpha')
  assert.ok(!p.writes.some((w) => w.row.id === 'm-pole'))
})

t('options : clubs non importés, sans fédération', () => {
  const p = run([], CSV, { ...DEFAULT_OPTIONS, clubs: false, root: false })
  assert.equal(p.counts.club.create, 0)
  assert.equal(p.counts.root.create, 0)
  assert.ok(p.writes.every((w) => w.kind !== 'club'))
  // Sans fédération : les ligues sont en tête, les lignes sans ligue aussi (à ranger).
  assert.ok(p.writes.filter((w) => w.kind === 'ligue').every((w) => !w.row.parentId))
  assert.ok(!p.writes.find((w) => w.row.code === 'comite::906')!.row.parentId)
})

t('options : comités seulement, rangés sous les ligues déjà importées', () => {
  const p = run(units, CSV.replace('Comité Gamma', 'Comité Gamma bis'), { ...DEFAULT_OPTIONS, ligues: false, clubs: false })
  assert.equal(p.writes.length, 1)
  assert.equal(p.writes[0].row.parentId, byCode('ligue:93').id)
})

t('colonne indispensable absente : import bloqué, en clair', () => {
  const tb = readStructureCsv(CSV)
  const m = guessMapping(tb.headers)
  delete m.club
  const p = planImport({ table: tb, mapping: m, units: [], levels: LEVELS, options: DEFAULT_OPTIONS, newId })
  assert.match(p.blocker!, /Nom du club/)
  assert.equal(p.writes.length, 0)
})

t('niveaux absents : créés', () => {
  const tb = readStructureCsv(CSV)
  const p = planImport({ table: tb, mapping: guessMapping(tb.headers), units: [], levels: [], options: DEFAULT_OPTIONS, newId })
  assert.deepEqual(p.levelsToCreate.map((l) => l.name), ['Fédération', 'Ligue', 'Comité', 'Club'])
})

t('anti-cycle respecté', () => {
  // Données abîmées à la main : la ligue Alpha rangée sous un de ses propres clubs.
  const c1 = byCode('club:9900001')
  const broken = units.map((u) => (u.code === 'federation' ? { ...u, parentId: c1.id } : u))
  const p = run(broken)
  for (const w of p.writes) assert.ok(!wouldCycle([...broken.filter((u) => !p.writes.some((x) => x.row.id === u.id)), ...p.writes.map((x) => x.row)], w.row.id, w.row.parentId), `cycle sur ${w.row.name}`)
  // Toute l'arborescence finale reste un arbre (chaque unité placée une fois).
  const final = new Map(broken.map((u) => [u.id, u]))
  for (const w of p.writes) final.set(w.row.id, w.row)
  assert.equal(flatten(buildTree([...final.values()], LEVELS)).length, final.size)
})

t('annuler l’import : retrait des créées, sous-unités d’abord ; refus si quelque chose a changé', () => {
  const base: U[] = [{ id: 'm-ligue', levelId: 'niveau-ligue', name: 'LIGUE ALPHA', updatedAt: 1 }]
  const p = run(base)
  const { units: after, record } = apply(base, p, 2000)
  const u = planUndo(record, after, [])
  assert.ok(u.ok)
  assert.equal(u.restore.length, 1)
  assert.equal(u.restore[0].name, 'LIGUE ALPHA')
  assert.equal(u.restore[0].code, undefined)
  assert.equal(u.remove.length, p.writes.length - 1)
  assert.ok(u.remove.every((r) => r.deleted))
  const pos = new Map(u.remove.map((r, i) => [r.id, i]))
  for (const r of u.remove) if (r.parentId && pos.has(r.parentId)) assert.ok(pos.get(r.parentId)! > pos.get(r.id)!, 'parent retiré avant son enfant')
  // Quelque chose a changé depuis : refus.
  const club = after.find((x) => x.code === 'club:9900005')!
  const changed = after.map((x) => (x.id === club.id ? { ...x, name: 'Autre', updatedAt: 3000 } : x))
  const no = planUndo(record, changed, [])
  assert.equal(no.ok, false)
  assert.match(no.reason!, /changé/)
  // Une affectation sur une unité importée : refus.
  assert.equal(planUndo(record, after, [{ unitId: club.id }]).ok, false)
  // Une unité rangée à la main sous une unité importée : refus.
  assert.equal(planUndo(record, [...after, { id: 'x', levelId: 'niveau-pole', name: 'Pôle', parentId: club.id }], []).ok, false)
})

t('trouver une unité', () => {
  assert.equal(findUnits(units, 'ville 7')[0].name, 'CLUB FICTIF 7')
  assert.equal(findUnits(units, '9900012')[0].name, 'CLUB FICTIF 12')
  assert.ok(findUnits(units, 'comite beta').length >= 2)
  assert.equal(findUnits(units, '').length, 0)
})

t('performance : 3 000 unités fictives (aperçu, import, réimport, arbre)', () => {
  const big = [HEAD]
  let k = 0
  for (let l = 0; l < 19; l++)
    for (let c = 0; c < 6; c++)
      for (let j = 0; j < 26; j++) {
        k++
        big.push(`${10 + l};Ligue fictive ${l};${100 + l * 6 + c};Comité fictif ${l}-${c};88${String(k).padStart(5, '0')};CLUB FICTIF ${k};${String(10000 + k)};VILLE ${k};45.${k};5.${k}`)
      }
  const csv = big.join('\n')
  let t0 = performance.now()
  const p = run([], csv)
  const tPlan = performance.now() - t0
  const total = p.writes.length
  assert.ok(total >= 3000, `${total} unités`)
  const { units: all } = apply([], p, 10)
  t0 = performance.now()
  const again = run(all, csv)
  const tReplan = performance.now() - t0
  assert.equal(again.writes.length, 0)
  t0 = performance.now()
  const tree = buildTree(all, LEVELS)
  const counts = subtreeCounts(tree)
  const tTree = performance.now() - t0
  assert.equal(counts.get(all.find((u) => u.code === 'federation')!.id), total - 1)
  assert.equal(flatten(tree).length, total)
  console.log(`     ${total} unités : aperçu ${tPlan.toFixed(0)} ms, réimport ${tReplan.toFixed(0)} ms, arbre ${tTree.toFixed(0)} ms`)
  assert.ok(tPlan < 1500 && tReplan < 1500 && tTree < 1500, 'trop lent')
})

if (failed) {
  console.log(`\n${failed} test(s) en échec`)
  process.exit(1)
}
console.log('\nTous les tests passent.')
