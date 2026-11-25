// Test des AVIS sur les réponses (src/questionLogCore.ts) : construction d'une ligne d'avis (nouvelle ligne du journal,
// kind = 'avis'), anonymisation du commentaire comme la phrase, bornes et refus (identifiant, verdict), séparation questions /
// avis, « à traiter » avec un avis négatif, filtre par avis, « Copier pour Claude » et export CSV avec les avis.
// Noms fictifs seulement.
//
//   npx jiti tools/test-avis-questions.ts
import assert from 'node:assert/strict'
import {
  buildAvis,
  buildEntry,
  copyForClaude,
  exportCsv,
  filterByAvis,
  filterEntries,
  groupEntries,
  isBadVerdict,
  MAX_COMMENT,
  splitLog,
  VERDICT_LABEL,
  type QuestionLogRow,
} from '../src/questionLogCore'

const players = [
  { firstName: 'Lucas', lastName: 'Zorbeck' },
  { firstName: 'Éloïse', lastName: 'Varnier' },
  { firstName: 'Rose', lastName: 'Quillard' },
]
const input = { players, keep: ['HBC Toulon', 'Var'] }
const at = new Date('2026-10-18T10:00:00.000Z')
const me = { id: 'u1', name: 'Coach A' }

// ---------- Construction ----------

const a1 = buildAvis({ questionId: 'q-1', verdict: 'mauvaise', comment: '  je voulais les frères de Lucas Zorbeck, licence 6383015001234\n du Var ', page: 'joueurs' }, input, me, at)!
assert.deepEqual(a1, {
  at: '2026-10-18T10:00:00.000Z',
  authorId: 'u1',
  authorName: 'Coach A',
  kind: 'avis',
  questionId: 'q-1',
  verdict: 'mauvaise',
  comment: 'je voulais les frères de [prénom] [nom], licence [licence] du Var',
  page: 'joueurs',
})
assert.ok(!('phrase' in a1) && !('recipe' in a1), 'un avis n’a ni phrase ni recette')

// Sans commentaire, sans page : champs absents.
const a2 = buildAvis({ questionId: 'q-2', verdict: 'super', comment: '   ' }, input, {}, at)!
assert.deepEqual(a2, { at: '2026-10-18T10:00:00.000Z', kind: 'avis', questionId: 'q-2', verdict: 'super' })

// Accents, minuscules, prénom courant : comme la phrase.
assert.equal(buildAvis({ questionId: 'q', verdict: 'sans_reponse', comment: 'la taille d’eloise' }, input)!.comment, 'la taille d’[prénom]')
assert.equal(buildAvis({ questionId: 'q', verdict: 'sans_reponse', comment: 'maillot rose' }, input)!.comment, 'maillot rose', 'mot courant gardé')
// Commentaire borné (500 caractères), caractères de contrôle retirés.
assert.equal(buildAvis({ questionId: 'q', verdict: 'super', comment: 'x'.repeat(900) }, input)!.comment!.length, MAX_COMMENT)
assert.equal(buildAvis({ questionId: 'q', verdict: 'super', comment: 'a\u0007b\tc' }, input)!.comment, 'a b c')
// Refus : identifiant ou verdict inconnus (le serveur les refuserait).
assert.equal(buildAvis({ questionId: '', verdict: 'super' }, input), null)
assert.equal(buildAvis({ questionId: 'pas un id !', verdict: 'super' }, input), null)
assert.equal(buildAvis({ questionId: 'x'.repeat(65), verdict: 'super' }, input), null)
assert.equal(buildAvis({ questionId: 'q', verdict: 'bof' as never }, input), null)

assert.equal(VERDICT_LABEL.super, 'Super')
assert.equal(VERDICT_LABEL.mauvaise, 'Mauvaise réponse')
assert.equal(VERDICT_LABEL.sans_reponse, 'Pas de réponse')
assert.ok(isBadVerdict('mauvaise') && isBadVerdict('sans_reponse') && !isBadVerdict('super') && !isBadVerdict(undefined))

// La page de la question est gardée (journal).
assert.equal(buildEntry({ phrase: 'combien de gardiens', recipe: 'complete', page: 'evenements' }, input, {}, at).page, 'evenements')

// ---------- Journal avec avis ----------

const q = (id: string, phrase: string, recipe: QuestionLogRow['recipe'], extra: Partial<QuestionLogRow> = {}): QuestionLogRow => ({
  id,
  at: `2026-10-1${id.slice(-1)}T09:00:00.000Z`,
  phrase,
  recipe,
  ...extra,
})
const av = (id: string, questionId: string, verdict: 'super' | 'mauvaise' | 'sans_reponse', comment?: string, extra: Partial<QuestionLogRow> = {}) =>
  ({ id, at: '2026-10-18T09:30:00.000Z', kind: 'avis', questionId, verdict, ...(comment ? { comment } : {}), ...extra }) as unknown as QuestionLogRow

const rows: QuestionLogRow[] = [
  q('q1', 'combien de gardiens', 'complete', { page: 'joueurs' }),
  q('q2', 'les gauchers du Var', 'complete'),
  q('q3', 'les plus rapides', 'pas_comprise'),
  q('q4', 'les pivots', 'complete', { recipeDone: true }),
  av('a1', 'q1', 'super'),
  av('a2', 'q2', 'mauvaise', 'je voulais les gauchères aussi'),
  av('a3', 'q4', 'sans_reponse'),
  av('a4', 'q-disparue', 'mauvaise', 'question vidée'),
  av('a5', 'q2', 'super', undefined, { deleted: true }),
]

const { questions, avis, orphans } = splitLog(rows)
assert.deepEqual(questions.map((r) => r.id), ['q1', 'q2', 'q3', 'q4'], 'les avis ne sont pas des questions')
assert.deepEqual(avis.get('q2')!.map((r) => r.id), ['a2'], 'avis supprimé ignoré')
assert.deepEqual(orphans.map((r) => r.id), ['a4'])

// Les fonctions de l'écran ignorent les lignes d'avis même sans splitLog.
assert.equal(filterEntries(rows, 'toutes').length, 4)
assert.equal(groupEntries(rows).length, 4)
// « À traiter » : une question comprise par la recette mais jugée mauvaise l'est ; transformée en recette : non.
assert.deepEqual(filterEntries(questions, 'a_traiter').map((r) => r.id), ['q3'], 'sans avis : comme avant')
assert.deepEqual(filterEntries(questions, 'a_traiter', avis).map((r) => r.id), ['q2', 'q3'])
// Filtre par avis.
assert.deepEqual(filterByAvis(questions, avis, 'tous').map((r) => r.id), ['q1', 'q2', 'q3', 'q4'])
assert.deepEqual(filterByAvis(questions, avis, 'avec_avis').map((r) => r.id), ['q1', 'q2', 'q4'])
assert.deepEqual(filterByAvis(questions, avis, 'mauvaise').map((r) => r.id), ['q2'])
assert.deepEqual(filterByAvis(questions, avis, 'sans_reponse').map((r) => r.id), ['q4'])

// « Copier pour Claude » : la question jugée mauvaise est à traiter, avec l'avis et le commentaire.
const md = copyForClaude(rows, '2026-10-18')
assert.match(md, /4 questions au journal · 2 questions à traiter/)
assert.match(md, /« les gauchers du Var » ×1/)
assert.match(md, /- Avis des entraîneurs : Mauvaise réponse/)
assert.match(md, /- Ce qu'ils voulaient : « je voulais les gauchères aussi »/)
assert.match(md, /« combien de gardiens » ×1 : Comprise par la recette · avis : Super/)
assert.doesNotMatch(md, /question vidée/, 'avis sans question : pas dans le texte pour Claude')

// Export CSV : une ligne par question (la plus récente d'abord) avec ses avis, puis les avis orphelins ; « ; » et guillemets.
const csv = exportCsv([...rows, q('q5', 'les "grands"; vraiment', 'partielle', { recipeMissing: ['taille'] })]).split('\r\n')
assert.equal(csv[0].split(';').length, 15)
assert.match(csv[0], /^date;auteur;page;phrase;issue;recette;/)
assert.equal(csv.length, 1 + 5 + 1)
assert.match(csv[1], /^2026-10-15T09:00:00.000Z;;;"les ""grands""; vraiment";Ratée;Recette partielle;taille;/)
const l2 = csv.find((l) => l.includes('les gauchers du Var'))!
assert.match(l2, /;Mauvaise réponse;je voulais les gauchères aussi;2026-10-18T09:30:00.000Z;$/)
const l1 = csv.find((l) => l.includes('combien de gardiens'))!
assert.match(l1, /^2026-10-11T09:00:00.000Z;;joueurs;combien de gardiens;Comprise par la recette;Recette complète;;;;;;Super;;/)
assert.match(csv[csv.length - 1], /;Mauvaise réponse;question vidée;/, 'avis orphelin à la fin')
// Export d'une sélection : seulement ces questions, sans orphelins.
assert.equal(exportCsv(rows, filterByAvis(questions, avis, 'mauvaise')).split('\r\n').length, 2)

console.log('test-avis-questions : OK')
