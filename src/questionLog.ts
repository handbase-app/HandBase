import { useLiveQuery } from 'dexie-react-hooks'
import { db, newId, POSITIONS, save, saveMany, type QuestionLog } from './db'
import { getMe } from './components/ui'
import { buildEntry, questionLogRights, type QuestionTrace } from './questionLogCore'
import { currentUserId, realRole } from './roles'
import { spyTarget } from './spy'
import type { MirrorInput } from './sqlMirror'

export type { QuestionTrace } from './questionLogCore'

/*
 * « Journal des questions » : écriture d'une entrée pour CHAQUE question de « Poser une question » (src/pages/Question.tsx,
 * src/components/SqlAnswer.tsx) et lecture pour Réglages (src/components/QuestionLogView.tsx). Fonctions pures :
 * src/questionLogCore.ts.
 *  - ÉCRITURE : tout compte qui peut poser une question (administrateur, encadrant), jamais pendant « Voir comme… ». Le
 *    serveur (supabase/043_journal_questions.sql, hb_upsert) n'accepte d'un non-administrateur que la création de ses
 *    propres lignes, auteur posé par lui.
 *  - LECTURE : administrateurs seulement. Un autre compte ne relit jamais le journal, pas même ses lignes : la table n'est
 *    pas synchronisée vers son appareil (src/sync.ts, ADMIN_READ) et ses lignes envoyées en sont retirées ; côté serveur, la
 *    règle de lecture le lui interdit.
 *  - Anonymisée ICI, avant tout stockage : prénoms et noms des fiches de l'appareil, licences (questionLogCore.ts). Jamais
 *    le résultat.
 *  - Tant que le serveur ne connaît pas la table (043 pas encore passé), les entrées restent dans la file d'envoi et partent
 *    plus tard (src/sync.ts, OPTIONAL_TABLES).
 *  - Ne bloque jamais la question : toute erreur ici est ignorée.
 */

/** Note-t-on les questions de ce compte ? Oui (tout rôle qui peut poser une question), sauf pendant « Voir comme… ». */
export const canLogQuestion = () => questionLogRights(realRole(), !!spyTarget()).write
/** Le journal est-il lisible par ce compte ? (administrateur réel, hors « Voir comme… ») */
export const canUseQuestionLog = () => questionLogRights(realRole(), !!spyTarget()).read

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

/** Enregistre une question (anonymisée). Sans effet pendant « Voir comme… » ; jamais d'erreur. */
export async function logQuestion(trace: QuestionTrace, input: MirrorInput | null) {
  try {
    if (!canLogQuestion() || !input || !trace.phrase.trim()) return
    const entry = buildEntry(trace, { players: input.players, keep: keepWords(input) }, { id: currentUserId() ?? undefined, name: getMe() || undefined })
    await save<QuestionLog>('question_log', { id: newId(), ...entry } as Omit<QuestionLog, 'updatedAt'>)
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
