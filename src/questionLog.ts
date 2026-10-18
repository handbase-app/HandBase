import { useLiveQuery } from 'dexie-react-hooks'
import { db, newId, POSITIONS, save, saveMany, type QuestionLog } from './db'
import { getMe } from './components/ui'
import { regionLabel, regionOfDept } from './lists'
import { playerDepartment } from './perimeter'
import { buildAvis, buildEntry, makeLogDeduper, questionLogRights, type AnonymizerInput, type AvisInput, type QuestionTrace } from './questionLogCore'
import { currentUserId, realRole } from './roles'
import { spyTarget } from './spy'
import type { MirrorInput } from './sqlMirror'
import { buildAvisVocal, buildVocalAvis, type AvisVocalInput, type VocalVerdict } from './questionLogCore'

export type { QuestionTrace, Verdict } from './questionLogCore'

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
 *  - AVIS (phase de test) : après chaque réponse, « Super », « Mauvaise réponse » ou « Pas de réponse », avec un commentaire
 *    facultatif (src/components/AnswerFeedback.tsx) : une NOUVELLE ligne (kind = 'avis', questionId = la ligne de la
 *    question ; supabase/049_avis_questions.sql), commentaire anonymisé comme la phrase. Une fois par question (retenu sur
 *    l'appareil). Hors ligne : dans la file d'envoi comme le reste.
 *  - Sans copie locale prête (listes Événements, Groupes, « Filtrer » du bilan, avis) : l'anonymisation lit les fiches et
 *    les critères de l'appareil (anonInputFromDb).
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

/** Fiches et mots à garder lus sur l'appareil (quand la copie locale de « Poser une question » n'est pas prête). */
async function anonInputFromDb(): Promise<AnonymizerInput> {
  const [players, criteria] = await Promise.all([db.players.toArray(), db.criteria.toArray()])
  const keep = new Set<string>()
  for (const p of players) {
    if (p.club) keep.add(p.club)
    const r = regionOfDept(playerDepartment(p))
    if (r) keep.add(regionLabel(r))
  }
  for (const p of POSITIONS) keep.add(p.label)
  for (const c of criteria) {
    keep.add(c.label)
    if (c.category) keep.add(c.category)
  }
  return { players, keep: [...keep] }
}

const me = () => ({ id: currentUserId() ?? undefined, name: getMe() || undefined })

/** Même phrase, même page, à moins de 2 s : une seule ligne (l'écran a pu noter deux fois la même arrivée). */
const dedupe = makeLogDeduper(2000)

/**
 * Enregistre une question (anonymisée) et rend l'identifiant de sa ligne (pour l'avis sur la réponse), tout de suite ;
 * l'écriture se fait ensuite. undefined : pas notée (pendant « Voir comme… », rôle sans question, phrase vide). Jamais
 * d'erreur. `input` : copie locale de « Poser une question » (null : fiches de l'appareil).
 */
export function logQuestion(trace: QuestionTrace, input: MirrorInput | null): string | undefined {
  try {
    if (!canLogQuestion() || !trace.phrase.trim()) return undefined
    const at = new Date()
    const twin = dedupe.seen(trace.phrase, trace.page, at.getTime())
    if (twin) return twin
    const id = newId()
    dedupe.add(trace.phrase, trace.page, id, at.getTime())
    void (async () => {
      try {
        const anon: AnonymizerInput = input ? { players: input.players, keep: keepWords(input) } : await anonInputFromDb()
        const entry = buildEntry(trace, anon, me(), at)
        await save<QuestionLog>('question_log', { id, ...entry } as Omit<QuestionLog, 'updatedAt'>)
      } catch {
        /* journal : jamais bloquant */
      }
    })()
    return id
  } catch {
    return undefined
  }
}

// ---------- Avis sur une réponse ----------

const AVIS_KEY = 'handbase.avis-questions'
const AVIS_KEEP = 300

/** Questions déjà jugées sur cet appareil (une fois par question). */
function givenAvis(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(AVIS_KEY) ?? '[]')
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}
export const hasAvis = (questionId: string) => givenAvis().includes(questionId)

/** Enregistre l'avis (nouvelle ligne, commentaire anonymisé). true : noté (ou déjà donné). Jamais d'erreur. */
export async function logAvis(a: AvisInput): Promise<boolean> {
  try {
    if (!canLogQuestion()) return false
    if (hasAvis(a.questionId)) return true
    const row = buildAvis(a, await anonInputFromDb(), me())
    if (!row) return false
    await save<QuestionLog>('question_log', { id: newId(), ...row } as Omit<QuestionLog, 'updatedAt'>)
    try {
      localStorage.setItem(AVIS_KEY, JSON.stringify([...givenAvis(), a.questionId].slice(-AVIS_KEEP)))
    } catch {
      /* stockage indisponible : l'avis est noté quand même */
    }
    return true
  } catch {
    return false
  }
}

// ---------- Évaluations vocales (« Avis vocal » de l'écran de notation, phase de test) ----------
// Ligne kind = 'avis_vocal' (supabase/050_avis_vocal.sql) : dictée anonymisée, notes proposées et ce qu'en a fait
// l'entraîneur, appréciation. Jamais rien du joueur évalué (questionLogCore.ts, buildAvisVocal). Mêmes droits et même file
// d'envoi que les questions.

/** Enregistre une évaluation vocale ; rend tout de suite l'identifiant de sa ligne (l'écriture suit). Jamais d'erreur. */
export function logAvisVocal(a: AvisVocalInput): string | undefined {
  try {
    if (!canLogQuestion() || !a.phrase.trim()) return undefined
    const id = newId()
    const at = new Date()
    void (async () => {
      try {
        const row = buildAvisVocal(a, await anonInputFromDb(), me(), at)
        if (row) await save<QuestionLog>('question_log', { id, ...row } as unknown as Omit<QuestionLog, 'updatedAt'>)
      } catch {
        /* journal : jamais bloquant */
      }
    })()
    return id
  } catch {
    return undefined
  }
}

/** Appréciation donnée après l'écriture de l'évaluation vocale : une ligne d'avis qui la vise. true : notée. */
export async function logAvisVocalVerdict(a: { vocalId: string; verdict: VocalVerdict; comment?: string }): Promise<boolean> {
  try {
    if (!canLogQuestion()) return false
    const row = buildVocalAvis(a, await anonInputFromDb(), me())
    if (!row) return false
    await save<QuestionLog>('question_log', { id: newId(), ...row } as unknown as Omit<QuestionLog, 'updatedAt'>)
    return true
  } catch {
    return false
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
