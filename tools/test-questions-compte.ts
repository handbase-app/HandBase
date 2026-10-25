// « Mes questions » / « Mes filtres » gardés sur le compte (src/savedQuestionsCore.ts, supabase/054_questions_enregistrees.sql) :
// où elles vivent (appareil, versement, compte ; repli sur l'appareil quand la table manque), identifiants acceptés par le
// serveur, versement sans doublon (identifiant, contenu) ni dépassement du plafond, lecture des seules questions du compte,
// place faite aux nouvelles ; et, dans le code, la table facultative de la synchronisation et le script SQL (hb_upsert repris
// de 050 à l'identique, sauf les ajouts de 054). Données fictives.
//
//   npx jiti tools/test-questions-compte.ts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { cleanRecipe, type SavedQuestion } from '../src/recipe'
import { cleanSqlSpec } from '../src/sqlGuard'
import { accountId, cleanName, newLocalId, overflowIds, ownSaved, planMigration, QMAX, storeMode, toRow, type QRow } from '../src/savedQuestionsCore'

const UID = '11111111-2222-3333-4444-555555555555'
const OTHER = '99999999-8888-7777-6666-555555555555'
const r1 = cleanRecipe({ pop: { sex: 'F', years: [2011, 2011] } })
const r2 = cleanRecipe({ pop: { sex: 'M' } })
const q = (id: string, name: string, at: number, recipe = r1, extra: Partial<SavedQuestion> = {}): SavedQuestion => ({ id, name, recipe, vars: [], at, ...extra })

// ---------- Où vivent les questions (repli sur l'appareil) ----------
const base = { server: true, demo: false, uid: UID, migratedFor: null, serverHas: undefined } as const
assert.equal(storeMode({ ...base, server: false }), 'local', 'sans serveur (version d’essai sans base) : appareil')
assert.equal(storeMode({ ...base, demo: true, serverHas: true }), 'local', 'démonstration (comptes partagés) : appareil')
assert.equal(storeMode({ ...base, uid: null, serverHas: true }), 'local', 'compte pas encore connu : appareil')
assert.equal(storeMode(base), 'local', 'table pas encore lue : appareil')
assert.equal(storeMode({ ...base, serverHas: false }), 'local', 'table absente du serveur (054 pas passé) : appareil, sans erreur')
assert.equal(storeMode({ ...base, serverHas: true }), 'migrate', 'table trouvée : verser les questions de l’appareil')
assert.equal(storeMode({ ...base, migratedFor: UID }), 'synced', 'déjà versées : la table, même hors ligne au lancement')
assert.equal(storeMode({ ...base, migratedFor: UID, serverHas: false }), 'synced', 'déjà versées : on reste sur la table')
assert.equal(storeMode({ ...base, migratedFor: OTHER, serverHas: true }), 'migrate', 'versées pour un autre compte : on reverse')
assert.equal(storeMode({ ...base, migratedFor: OTHER }), 'local')

// ---------- Identifiants (format exigé par le serveur) ----------
const SERVER_ID = new RegExp(`^${UID}:[A-Za-z0-9_-]{1,64}$`)
assert.equal(accountId(UID, 'qabc12'), `${UID}:qabc12`)
assert.match(accountId(UID, 'q/../x é'), SERVER_ID)
assert.match(accountId(UID, ''), SERVER_ID)
assert.match(accountId(UID, 'x'.repeat(200)), SERVER_ID)
assert.match(accountId(UID, newLocalId()), SERVER_ID)
assert.match(newLocalId(0, 0.5), /^q[0-9a-z]+$/)
assert.equal(cleanName('  Mes   U15\n filles '), 'Mes U15 filles')
assert.equal(cleanName('   '), 'Ma question')
assert.equal(cleanName('a'.repeat(100)).length, 80)

// ---------- Ligne de la table ----------
const sql = cleanSqlSpec({ sql: 'SELECT id FROM joueurs', explanation: 'Les joueurs', display: 'tableau' })
assert.ok(sql, 'requête de test acceptée')
assert.deepEqual(toRow(q('qa', 'A', 5, r1, { phrase: 'les filles 2011', vars: ['sex'] }), 'X:qa'), { id: 'X:qa', name: 'A', recipe: r1, vars: ['sex'], phrase: 'les filles 2011', at: 5 })
const sqlRow = toRow(q('qs', 'Avancée', 6, cleanRecipe({}), { sql: sql! }))
assert.ok(!('recipe' in sqlRow) && sqlRow.sql, 'mode avancé : la requête, pas de recette')

// ---------- Lecture : seulement les miennes, non supprimées, revérifiées, récentes d'abord ----------
const rows: QRow[] = [
  { ...toRow(q('', 'Ancienne', 1)), id: `${UID}:q1`, updatedAt: 1 },
  { ...toRow(q('', 'Récente', 9, r2)), id: `${UID}:q2`, updatedAt: 1 },
  { ...toRow(q('', 'Avancée', 5, cleanRecipe({}), { sql: sql! })), id: `${UID}:q3`, updatedAt: 1 },
  { id: `${UID}:q4`, deleted: true, updatedAt: 2 },
  { ...toRow(q('', 'D’un autre compte', 7)), id: `${OTHER}:q5`, updatedAt: 1 },
  { id: `${UID}:q6`, name: '', recipe: r1, updatedAt: 1 },
  { id: `${UID}:q7`, name: 'Requête refusée', sql: { sql: 'DELETE FROM joueurs' }, updatedAt: 1 },
]
const mine = ownSaved(rows, UID)
assert.deepEqual(
  mine.map((s) => [s.id, s.name, !!s.sql]),
  [
    [`${UID}:q2`, 'Récente', false],
    [`${UID}:q3`, 'Avancée', true],
    [`${UID}:q1`, 'Ancienne', false],
  ],
)
assert.deepEqual(mine[0].recipe, r2, 'la recette revient telle quelle')

// ---------- Versement des questions de l'appareil ----------
const local = [q('qa', 'Filles 2011', 30), q('qb', 'Garçons', 20, r2), q('qc', 'Déjà versée', 10), q('qd', 'Supprimée ailleurs', 5)]
const existing: QRow[] = [
  { ...toRow(q('', 'Déjà versée', 10)), id: `${UID}:qc`, updatedAt: 1 },
  { id: `${UID}:qd`, deleted: true, updatedAt: 3 },
  // La même, enregistrée sur un autre appareil (autre identifiant) : pas de doublon.
  { ...toRow(q('', 'garçons ', 3, r2)), id: `${UID}:zz`, updatedAt: 1 },
]
const plan = planMigration(local, existing, UID)
assert.deepEqual(
  plan.map((r) => [r.id, r.name]),
  [[`${UID}:qa`, 'Filles 2011']],
  'sans doublon d’identifiant (déjà versée, même supprimée depuis) ni de contenu',
)
assert.deepEqual(planMigration(local, [], UID).map((r) => r.id), ['qa', 'qb', 'qc', 'qd'].map((id) => `${UID}:${id}`), 'compte vide : toutes, récentes d’abord')
// Verser deux fois (deux onglets, ou relance) : rien de plus.
const once = planMigration(local, [], UID).map((r) => ({ ...r, updatedAt: 1 }))
assert.deepEqual(planMigration(local, once, UID), [], 'versement idempotent')
// Même nom, recette différente : deux questions distinctes.
assert.equal(planMigration([q('qx', 'Filles 2011', 1, r2)], [{ ...toRow(q('', 'Filles 2011', 1)), id: `${UID}:o` }], UID).length, 1)
// Questions d'un autre compte présentes sur l'appareil (impossible d'ordinaire : l'appareil est effacé au changement de compte) :
// elles ne comptent ni comme doublon ni dans le plafond.
assert.equal(planMigration([q('qa', 'Filles 2011', 1)], [{ ...toRow(q('', 'Filles 2011', 1)), id: `${OTHER}:qa` }], UID).length, 1)
// Plafond : au plus QMAX en tout, les plus récentes de l'appareil gardées.
const many = Array.from({ length: 30 }, (_, i) => q(`l${i}`, `Locale ${i}`, i, cleanRecipe({ pop: { hMin: 150 + i } })))
const full: QRow[] = Array.from({ length: QMAX - 10 }, (_, i) => ({ ...toRow(q('', `Compte ${i}`, i, cleanRecipe({ pop: { hMax: 150 + i } }))), id: `${UID}:c${i}` }))
const capped = planMigration(many, full, UID)
assert.equal(capped.length, 10)
assert.deepEqual(capped.map((r) => r.name), Array.from({ length: 10 }, (_, i) => `Locale ${29 - i}`))
assert.deepEqual(planMigration(many, [...full, ...Array.from({ length: 20 }, (_, i) => ({ id: `${UID}:d${i}`, name: `D${i}`, recipe: r2 }))], UID), [], 'compte plein')

// ---------- Place pour une nouvelle question ----------
assert.deepEqual(overflowIds([q('a', 'A', 1)]), [])
const hundred = Array.from({ length: QMAX }, (_, i) => q(`h${i}`, `H${i}`, 1000 - i))
assert.deepEqual(overflowIds(hundred), ['h99'], 'la plus ancienne laisse sa place')
assert.deepEqual(overflowIds(hundred, 3), ['h99', 'h98', 'h97'])

// ---------- Synchronisation : table facultative (repli sans erreur quand elle manque) ----------
const syncTs = readFileSync(new URL('../src/sync.ts', import.meta.url), 'utf8')
const dbTs = readFileSync(new URL('../src/db.ts', import.meta.url), 'utf8')
assert.match(syncTs, /const OPTIONAL_TABLES: SyncTable\[\] = \[[^\]]*'saved_questions'/, 'table facultative : absente du serveur, ni erreur ni envoi perdu')
assert.match(syncTs, /missingTable\(error\)\) \{\s*knowTable\(table, false\)\s*return received/, 'table absente notée (repli sur l’appareil)')
assert.match(syncTs, /knowTable\(table, true\)\s*return received/, 'table lue notée (versement)')
assert.match(dbTs, /export const SYNC_TABLES = \[[^\]]*'saved_questions'\]/)
assert.match(dbTs, /db\.version\(17\)\.stores\(\{ saved_questions: 'id, updatedAt' \}\)/)

// ---------- Script SQL : hb_upsert repris de 050 à l'identique, plus les questions enregistrées ----------
const fnOf = (file: string) => {
  const s = readFileSync(new URL(`../supabase/${file}`, import.meta.url), 'utf8')
  const a = s.indexOf('create or replace function public.hb_upsert')
  return { all: s, fn: s.slice(a, s.indexOf('end $$;', a) + 7) }
}
const s050 = fnOf('050_avis_vocal.sql')
const s054 = fnOf('054_questions_enregistrees.sql')
const withoutAdditions = s054.fn
  .replace(",'saved_questions') then", ') then')
  .replace(/\n {4}-- 054 : questions et filtres enregistrés[\s\S]*?\n {4}end if;\n/, '')
  .replace("      -- 054 : questions enregistrées : déjà contrôlé ci-dessus (les siennes seulement).\n      when p_table = 'saved_questions' then true\n", '')
assert.equal(withoutAdditions, s050.fn, 'hb_upsert de 054 = celui de 050 + les seuls ajouts de 054')
const sql054 = s054.all
assert.ok(sql054.includes("create policy \"own_read\" on public.hb_saved_questions for select to authenticated using (\n  (select public.hb_has_role()) and data ->> 'createdBy' = (select auth.uid())::text"), 'lecture : le créateur seul')
assert.ok(sql054.includes('revoke all on public.hb_saved_questions from public, anon, authenticated;'), 'aucun droit direct')
assert.ok(!/grant (insert|update|delete)/i.test(sql054), 'écriture seulement par hb_upsert')
assert.ok(!sql054.includes('hb_log'), 'pas d’historique (contenu personnel)')
assert.ok(!/supabase_realtime/.test(sql054), 'pas de diffusion en direct')
assert.ok(sql054.includes("count(*) < 150"), 'plafond serveur')

console.log('test-questions-compte : OK')
