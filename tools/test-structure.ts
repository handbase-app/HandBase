// Test de la configuration de l'installation (src/sportConfig.ts) et de la structure (src/structureTree.ts) :
// valeurs par défaut handball identiques aux anciennes constantes (mêmes libellés, même ordre), configuration personnalisée
// (postes de volley fictifs), arbre des unités (parents, descendants, anti-cycle, déplacement, suppression d'une unité vide),
// affectations multiples, pré-remplissage des comités. Données fictives seulement.
//
//   npx jiti tools/test-structure.ts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  applySportConfig,
  cleanPositions,
  currentSport,
  HANDBALL,
  isKeeper,
  positionCodes,
  positionFull,
  positionLabel,
  POSITIONS,
  resolveSportConfig,
  type ConfigRow,
} from '../src/sportConfig'
import {
  ancestors,
  assignmentsIn,
  assignmentsOf,
  buildTree,
  comitesToCreate,
  deleteBlocker,
  descendants,
  flatten,
  HANDBALL_LEVELS,
  levelInUse,
  moveUnit,
  parentChoices,
  sortLevels,
  unitDepartments,
  wouldCycle,
  type AssignmentRow,
  type UnitRow,
} from '../src/structureTree'

let n = 0
const t = (name: string, f: () => void) => {
  f()
  n++
  console.log(`ok ${n} - ${name}`)
}

// ---------- 1. Valeurs par défaut : identiques aux anciennes constantes ----------

// Anciennes constantes du code (src/db.ts POSITIONS, src/groupExport.ts POSTE / POSTE_ORDER), recopiées telles quelles.
const OLD_POSITIONS = [
  { id: 'GB', label: 'Gardien', short: 'Gardien' },
  { id: 'AG', label: 'Ailier gauche', short: 'Ailier G.' },
  { id: 'ARG', label: 'Arrière gauche', short: 'Arrière G.' },
  { id: 'DC', label: 'Demi-centre', short: 'Demi-centre' },
  { id: 'ARD', label: 'Arrière droit', short: 'Arrière D.' },
  { id: 'AD', label: 'Ailier droit', short: 'Ailier D.' },
  { id: 'PIV', label: 'Pivot', short: 'Pivot' },
]
const OLD_EXPORT: Record<string, string> = {
  GB: 'Gardien de but', AG: 'Ailier gauche', AD: 'Ailier droit', ARG: 'Arrière gauche', ARD: 'Arrière droit', DC: 'Demi-centre', PIV: 'Pivot',
}
const OLD_ORDER = ['GB', 'AG', 'ARG', 'DC', 'ARD', 'AD', 'PIV']

t('POSITIONS par défaut = anciennes constantes (libellés, libellés courts, ordre)', () => {
  assert.deepEqual(POSITIONS, OLD_POSITIONS)
  assert.deepEqual(positionCodes(), OLD_ORDER)
})
t('table vide ou absente : handball', () => {
  assert.deepEqual(resolveSportConfig([]), HANDBALL)
  assert.deepEqual(resolveSportConfig(), HANDBALL)
  assert.equal(currentSport().sport, 'handball')
})
t('libellé court, toutes lettres (exports), gardien : comme avant', () => {
  for (const p of OLD_POSITIONS) assert.equal(positionLabel(p.id), p.short)
  for (const [c, full] of Object.entries(OLD_EXPORT)) assert.equal(positionFull(c), full)
  assert.equal(positionLabel(undefined), '—')
  assert.equal(positionFull(undefined), '')
  assert.equal(isKeeper('GB'), true)
  for (const c of OLD_ORDER.slice(1)) assert.equal(isKeeper(c), false)
})
t('lignes illisibles ou supprimées : valeurs par défaut gardées', () => {
  const rows: ConfigRow[] = [
    { id: 'postes', key: 'postes', value: 'pas un tableau' },
    { id: 'sport', key: 'sport', value: 42 },
  ]
  assert.deepEqual(resolveSportConfig(rows), HANDBALL)
  assert.deepEqual(resolveSportConfig([{ id: 'postes', key: 'postes', value: [{ code: 'X', label: 'X' }], deleted: true }]), HANDBALL)
  assert.equal(cleanPositions([{ code: 'mauvais code !', label: 'A' }, { code: 'B', label: '' }]), null)
})
t('libellés renommés (handball) : mêmes codes, nouveaux libellés partout', () => {
  const value = HANDBALL.positions.map((p) => (p.code === 'PIV' ? { ...p, label: 'Pivot (6 m)', short: 'Pivot 6m' } : p))
  assert.ok(applySportConfig(resolveSportConfig([{ id: 'postes', key: 'postes', value }])))
  assert.equal(positionLabel('PIV'), 'Pivot 6m')
  assert.equal(POSITIONS.find((p) => p.id === 'PIV')!.label, 'Pivot (6 m)')
  assert.deepEqual(positionCodes(), OLD_ORDER)
  assert.equal(applySportConfig(resolveSportConfig([{ id: 'postes', key: 'postes', value }])), false, 'même configuration : rien ne change')
})

// ---------- 2. Configuration personnalisée : volley fictif ----------

const VOLLEY: ConfigRow[] = [
  { id: 'sport', key: 'sport', value: { sport: 'volley', sportName: 'Volley' } },
  {
    id: 'postes',
    key: 'postes',
    value: [
      { code: 'LIB', label: 'Libéro', short: 'Libéro', family: 'gardien', order: 4 },
      { code: 'PAS', label: 'Passeur', short: 'Passeur', family: 'champ', order: 1 },
      { code: 'R4', label: 'Réceptionneur-attaquant', short: 'R4', order: 2 },
      { code: 'CEN', label: 'Central', order: 3 },
      { code: 'PAS', label: 'Doublon ignoré' },
    ],
  },
]
t('postes de volley : ordre, libellé court par défaut, doublon écarté, famille', () => {
  const cfg = resolveSportConfig(VOLLEY)
  assert.equal(cfg.sport, 'volley')
  assert.equal(cfg.sportName, 'Volley')
  assert.deepEqual(cfg.positions.map((p) => p.code), ['PAS', 'R4', 'CEN', 'LIB'])
  assert.equal(cfg.positions.find((p) => p.code === 'CEN')!.short, 'Central')
  assert.equal(cfg.positions.find((p) => p.code === 'R4')!.family, 'champ')
  applySportConfig(cfg)
  assert.deepEqual(POSITIONS.map((p) => p.id), ['PAS', 'R4', 'CEN', 'LIB'])
  assert.equal(positionLabel('LIB'), 'Libéro')
  assert.equal(isKeeper('LIB'), true)
  assert.equal(isKeeper('GB'), false)
  // Ancienne fiche de handball dans une installation de volley : le code s'affiche tel quel, jamais d'erreur.
  assert.equal(positionLabel('GB'), 'GB')
  assert.equal(positionFull('PAS'), 'Passeur')
})
t('retour aux valeurs par défaut', () => {
  applySportConfig(resolveSportConfig([]))
  assert.deepEqual(POSITIONS, OLD_POSITIONS)
})

// ---------- 3. Arbre des unités ----------

const U = (id: string, levelId: string, parentId?: string, departments?: string[]): UnitRow => ({ id, levelId, name: id, ...(parentId ? { parentId } : {}), ...(departments ? { departments } : {}) })
const units: UnitRow[] = [
  U('fede', 'niveau-federation'),
  U('ligue', 'niveau-ligue', 'fede'),
  U('comite83', 'niveau-comite', 'ligue', ['83']),
  U('comite06', 'niveau-comite', 'ligue', ['06']),
  U('pole', 'niveau-pole', 'comite83'),
  U('club', 'niveau-club', 'comite83', ['83']),
  { ...U('vieux', 'niveau-club', 'ligue'), deleted: true },
]

t('niveaux handball : Fédération → Ligue → Comité → Pôle → Club', () => {
  assert.deepEqual(sortLevels([...HANDBALL_LEVELS].reverse()).map((l) => l.name), ['Fédération', 'Ligue', 'Comité', 'Pôle', 'Club'])
  // Mêmes identifiants que le script SQL (pas de doublon quand l'appli les propose hors ligne).
  const sql = readFileSync(new URL('../supabase/044_structure.sql', import.meta.url), 'utf8')
  for (const l of HANDBALL_LEVELS) assert.ok(sql.includes(`('${l.id}', '${l.name}', ${l.order})`), l.id)
})
t('parents et descendants', () => {
  assert.deepEqual(ancestors(units, 'pole').map((u) => u.id), ['comite83', 'ligue', 'fede'])
  assert.deepEqual(ancestors(units, 'fede'), [])
  assert.deepEqual(descendants(units, 'ligue').map((u) => u.id).sort(), ['club', 'comite06', 'comite83', 'pole'])
  assert.deepEqual(descendants(units, 'pole'), [])
  assert.deepEqual(unitDepartments(units, 'ligue'), ['06', '83'])
})
t('anti-cycle', () => {
  assert.equal(wouldCycle(units, 'ligue', 'ligue'), true, 'sous elle-même')
  assert.equal(wouldCycle(units, 'ligue', 'pole'), true, 'sous une petite-fille')
  assert.equal(wouldCycle(units, 'comite83', 'pole'), true, 'sous sa fille')
  assert.equal(wouldCycle(units, 'pole', 'ligue'), false)
  assert.equal(wouldCycle(units, 'pole', undefined), false, 'en tête')
  assert.deepEqual(parentChoices(units, 'comite83').map((u) => u.id).sort(), ['comite06', 'fede', 'ligue'])
})
t('déplacement : le pôle passe directement sous la ligue ; cycle refusé', () => {
  const moved = moveUnit(units, 'pole', 'ligue')
  assert.equal(moved.parentId, 'ligue')
  const after = units.map((u) => (u.id === 'pole' ? moved : u))
  assert.deepEqual(ancestors(after, 'pole').map((u) => u.id), ['ligue', 'fede'])
  assert.throws(() => moveUnit(units, 'ligue', 'club'), /sous-unités/)
  assert.throws(() => moveUnit(units, 'pole', 'inconnue'), /introuvable/)
  assert.equal(moveUnit(units, 'pole', undefined).parentId, undefined, 'mis en tête')
})
t('arbre affiché : ordre par niveau puis nom ; parent absent ou cycle : en tête, rien de caché', () => {
  const rows = flatten(buildTree(units, HANDBALL_LEVELS))
  assert.deepEqual(rows.map((r) => `${'.'.repeat(r.depth)}${r.unit.id}`), ['fede', '.ligue', '..comite06', '..comite83', '...pole', '...club'])
  const broken: UnitRow[] = [U('a', 'niveau-ligue', 'b'), U('b', 'niveau-ligue', 'a'), U('orphelin', 'niveau-club', 'disparu')]
  const flat = flatten(buildTree(broken, HANDBALL_LEVELS))
  assert.deepEqual(flat.map((r) => r.unit.id).sort(), ['a', 'b', 'orphelin'])
  assert.ok(flat.every((r) => r.depth === 0))
})

// ---------- 4. Affectations ----------

const assignments: AssignmentRow[] = [
  { id: 'a1', userId: 'compte-1', unitId: 'comite83', role: 'preparateur' },
  { id: 'a2', userId: 'compte-1', unitId: 'pole', role: 'observateur' },
  { id: 'a3', userId: 'compte-2', unitId: 'comite83', role: 'admin' },
  { id: 'a4', userId: 'compte-2', unitId: 'club', role: 'observateur', deleted: true },
]
t('affectations multiples d\'une personne, personnes d\'une unité', () => {
  assert.deepEqual(assignmentsOf(assignments, 'compte-1').map((a) => `${a.unitId}:${a.role}`), ['comite83:preparateur', 'pole:observateur'])
  assert.deepEqual(assignmentsOf(assignments, 'compte-2').map((a) => a.unitId), ['comite83'])
  assert.deepEqual(assignmentsIn(assignments, 'comite83').map((a) => a.userId), ['compte-1', 'compte-2'])
  assert.deepEqual(assignmentsIn(assignments, 'club'), [])
})
t('suppression : seulement une unité vide ; niveau seulement s\'il n\'est plus utilisé', () => {
  assert.equal(deleteBlocker(units, assignments, 'comite83'), '2 sous-unités et 2 affectations')
  assert.equal(deleteBlocker(units, assignments, 'pole'), '1 affectation')
  assert.equal(deleteBlocker(units, assignments, 'club'), null, 'affectation supprimée : ne bloque pas')
  assert.equal(levelInUse(units, 'niveau-comite'), 2)
  assert.equal(levelInUse(units, 'niveau-inconnu'), 0)
})

// ---------- 5. Pré-remplissage des comités ----------

t('un comité par département de joueurs qui n\'en a pas, rangé sous la ligue de sa région', () => {
  const todo = comitesToCreate({
    playerDepartments: ['83', '83', '06', '13', undefined, '84'],
    units,
    levelId: 'niveau-comite',
    deptName: (c) => `Comité ${c}`,
    parentFor: (c) => (c === '13' ? 'ligue' : undefined),
  })
  assert.deepEqual(todo, [
    { levelId: 'niveau-comite', name: 'Comité 13', departments: ['13'], parentId: 'ligue' },
    { levelId: 'niveau-comite', name: 'Comité 84', departments: ['84'] },
  ])
})

console.log(`\n${n} tests réussis.`)
