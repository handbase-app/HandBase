import { useLiveQuery } from 'dexie-react-hooks'
import { db, newId, POSITIONS, save, saveMany, type QuestionLog } from './db'
import { getMe } from './components/ui'
import { buildAnonymizer, type QuestionLogFields, type QuestionStatus } from './questionLogCore'
import { currentUserId, realRole } from './roles'
import { spyTarget } from './spy'
import type { MirrorInput } from './sqlMirror'

/*
 * « Journal des questions avancées » : écriture d'une entrée à chaque passage en mode avancé (src/components/SqlAnswer.tsx)
 * et lecture pour Réglages (src/components/QuestionLogView.tsx). Fonctions pures : src/questionLogCore.ts.
 *  - Seulement pour un administrateur (la table hb_question_log, supabase/043_journal_questions.sql, est réservée aux
 *    administrateurs : un autre compte verrait son entrée refusée), jamais pendant « Voir comme… ».
 *  - Anonymisée ICI, avant tout stockage : prénoms et noms des fiches de l'appareil, licences (questionLogCore.ts).
 *  - Synchronisée entre administrateurs comme les autres tables ; tant que le serveur ne connaît pas la table (043 pas
 *    encore passé), les entrées restent sur l'appareil et partent plus tard (src/sync.ts, OPTIONAL_TABLES).
 *  - Ne bloque jamais la question : toute erreur ici est ignorée.
 */

/** Ce que le mode avancé a fait, tel quel (anonymisé par logAdvancedQuestion). */
export type AdvancedTrace = {
  how: 'auto' | 'button'
  phrase: string
  recipeMissing?: string[]
  modelMissing?: string[]
  sql?: string
  sqlRetry?: string
  status: QuestionStatus
  detail?: string
  rows?: number
  display?: string
}

/** Le journal est-il ouvert à ce compte ? (administrateur réel, hors « Voir comme… ») */
export const canUseQuestionLog = () => realRole() === 'admin' && !spyTarget()

/** Mots à ne pas prendre pour des noms : clubs, départements, régions, postes et critères de l'appareil. */
function keepWords(input: MirrorInput): string[] {
  const keep = new Set<string>()
  const depts = new Set<string>()
  for (const p of input.players) {
    if (p.club) keep.add(p.club)
    const d = input.deptOf(p)
    if (d) depts.add(d)
  }
  for (const d of depts) {
    keep.add(input.deptName(d))
    const r = input.regionOf(d)
    if (r) keep.add(input.regionName(r))
  }
  for (const p of POSITIONS) keep.add(p.label)
  for (const c of input.criteria) {
    keep.add(c.label)
    if (c.category) keep.add(c.category)
  }
  return [...keep]
}

const clip = (s: string | undefined, n: number) => (s ? s.slice(0, n) : undefined)

/** Enregistre un passage en mode avancé (anonymisé). Sans effet hors administrateur ; jamais d'erreur. */
export async function logAdvancedQuestion(trace: AdvancedTrace, input: MirrorInput | null) {
  try {
    if (!canUseQuestionLog() || !input || !trace.phrase.trim()) return
    const an = buildAnonymizer({ players: input.players, keep: keepWords(input) })
    const list = (xs?: string[]) => {
      const out = (xs ?? []).map((x) => clip(an.text(x), 200)!).filter(Boolean).slice(0, 10)
      return out.length ? out : undefined
    }
    const entry: QuestionLogFields = {
      at: new Date().toISOString(),
      authorId: currentUserId() ?? undefined,
      authorName: getMe() || undefined,
      how: trace.how,
      phrase: clip(an.text(trace.phrase), 300)!,
      recipeMissing: list(trace.recipeMissing),
      modelMissing: list(trace.modelMissing),
      sql: clip(trace.sql && an.sql(trace.sql), 4200),
      sqlRetry: clip(trace.sqlRetry && an.sql(trace.sqlRetry), 4200),
      status: trace.status,
      detail: clip(trace.detail && an.text(trace.detail), 300),
      rows: trace.rows,
      display: clip(trace.display, 20),
    }
    // Champs vides retirés (la ligne reste petite).
    const row = Object.fromEntries(Object.entries({ id: newId(), ...entry }).filter(([, v]) => v !== undefined)) as Omit<QuestionLog, 'updatedAt'>
    await save<QuestionLog>('question_log', row)
  } catch {
    /* journal : jamais bloquant */
  }
}

/** Entrées du journal (non supprimées), la plus récente d'abord. */
export function useQuestionLog(): QuestionLog[] | undefined {
  return useLiveQuery(async () => (await db.question_log.toArray()).filter((r) => !r.deleted).sort((a, b) => b.at.localeCompare(a.at)), [])
}

/** Coche ou décoche « transformée en recette » (une entrée ou un groupe). */
export async function setRecipeDone(rows: QuestionLog[], done: boolean) {
  const changed = rows.filter((r) => !!r.recipeDone !== done).map((r) => ({ ...r, recipeDone: done }))
  if (changed.length) await saveMany<QuestionLog>('question_log', changed)
}

/** « Vider le journal » : toutes les entrées marquées supprimées (synchronisé ; effacées du serveur au bout de 30 jours). */
export async function clearQuestionLog() {
  const rows = (await db.question_log.toArray()).filter((r) => !r.deleted)
  if (rows.length) await saveMany<QuestionLog>('question_log', rows.map((r) => ({ ...r, deleted: true })))
  return rows.length
}
