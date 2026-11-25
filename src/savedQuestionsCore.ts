import { parseSaved, type SavedQuestion } from './recipe'

/*
 * « Mes questions » / « Mes filtres » enregistrés : la partie pure (testée : tools/test-questions-compte.ts), sans base ni
 * stockage. src/savedQuestions.ts s'en sert pour choisir où elles vivent et pour les verser au compte.
 *  - SANS SERVEUR (version d'essai sans base, démonstration) ou tant que le serveur ne connaît pas la table
 *    (supabase/054_questions_enregistrees.sql pas encore passé) : sur l'appareil (localStorage), comme avant.
 *  - Dès qu'une synchronisation trouve la table : l'appareil y VERSE ses questions (une fois, sans doublon), puis elles vivent
 *    dans la table synchronisée « saved_questions » (tous les appareils du compte, son seul créateur les voit).
 */

/** Questions gardées, par compte (ou par appareil sans serveur). Le serveur en accepte 150 (marge : deux appareils hors ligne). */
export const QMAX = 100

/** Ligne de la table synchronisée (src/db.ts, SavedQuestionRow), telle que lue ou écrite ici. */
export type QRow = {
  id: string
  name?: string
  recipe?: unknown
  vars?: string[]
  phrase?: string
  at?: number
  sql?: unknown
  deleted?: boolean
  updatedAt?: number
}

export type StoreMode = 'local' | 'migrate' | 'synced'

/**
 * Où vivent les questions :
 *  - 'local' : sur l'appareil (pas de serveur, démonstration, compte inconnu, ou table pas (encore) connue du serveur) ;
 *  - 'migrate' : la table vient d'être trouvée pour ce compte : verser celles de l'appareil, puis 'synced' ;
 *  - 'synced' : déjà versées pour ce compte (noté sur l'appareil) : la table, même hors ligne au lancement.
 */
export function storeMode(o: { server: boolean; demo: boolean; uid: string | null; migratedFor: string | null; serverHas: boolean | undefined }): StoreMode {
  if (!o.server || o.demo || !o.uid) return 'local'
  if (o.migratedFor === o.uid) return 'synced'
  return o.serverHas === true ? 'migrate' : 'local'
}

const LOCAL_ID = /[^A-Za-z0-9_-]/g
/** Identifiant sur le compte : « <compte>:<identifiant de l'appareil> » (le serveur n'accepte que ce format). */
export const accountId = (uid: string, localId: string) => `${uid}:${localId.replace(LOCAL_ID, '').slice(0, 64) || 'q'}`

/** Nouvel identifiant d'appareil (« q » + date + hasard), comme avant. */
export const newLocalId = (now = Date.now(), rnd = Math.random()) => `q${now.toString(36)}${rnd.toString(36).slice(2, 6)}`

/** Question → ligne de la table (champs connus seulement ; le serveur les nettoie de nouveau). */
export function toRow(q: SavedQuestion, id = q.id): QRow {
  return {
    id,
    name: q.name,
    ...(q.sql ? { sql: q.sql } : { recipe: q.recipe }),
    vars: q.vars,
    ...(q.phrase ? { phrase: q.phrase } : {}),
    at: q.at,
  }
}

/** Questions du compte `uid` lues dans la table : non supprimées, revérifiées (parseSaved), les plus récentes d'abord. */
export function ownSaved(rows: QRow[], uid: string): SavedQuestion[] {
  const mine = rows.filter((r) => !r.deleted && r.id.startsWith(`${uid}:`))
  return parseSaved(mine.sort((a, b) => (b.at ?? 0) - (a.at ?? 0))).slice(0, QMAX)
}

/** Même contenu (même recette ou même requête, même nom) : enregistrée deux fois, sur deux appareils. */
const sameContent = (a: { name?: string; recipe?: unknown; sql?: unknown }, b: { name?: string; recipe?: unknown; sql?: unknown }) =>
  (a.name ?? '').trim().toLowerCase() === (b.name ?? '').trim().toLowerCase() &&
  JSON.stringify(a.sql ?? null) === JSON.stringify(b.sql ?? null) &&
  (!!a.sql || JSON.stringify(a.recipe ?? null) === JSON.stringify(b.recipe ?? null))

/**
 * Questions de l'appareil à verser au compte : sans doublon d'identifiant (déjà versée, même supprimée depuis : elle ne
 * revient pas) ni de contenu (la même enregistrée sur un autre appareil) ; au plus QMAX en tout (les plus récentes gardées).
 */
export function planMigration(local: SavedQuestion[], existing: QRow[], uid: string): QRow[] {
  const ids = new Set(existing.map((r) => r.id))
  const alive = existing.filter((r) => !r.deleted && r.id.startsWith(`${uid}:`))
  const out: QRow[] = []
  for (const q of [...local].sort((a, b) => b.at - a.at)) {
    const id = q.id.startsWith(`${uid}:`) ? q.id : accountId(uid, q.id)
    if (ids.has(id)) continue
    const row = toRow(q, id)
    if ([...alive, ...out].some((r) => sameContent(r, row))) continue
    ids.add(id)
    out.push(row)
  }
  return out.slice(0, Math.max(0, QMAX - alive.length))
}

/** Questions à retirer pour faire de la place à `adding` nouvelles (les plus anciennes), au plus QMAX en tout. */
export function overflowIds(current: SavedQuestion[], adding = 1): string[] {
  const extra = current.length + adding - QMAX
  if (extra <= 0) return []
  return [...current]
    .sort((a, b) => a.at - b.at)
    .slice(0, extra)
    .map((q) => q.id)
}

/** Nom d'une question, nettoyé (80 caractères, espaces resserrés) ; vide : « Ma question ». */
export const cleanName = (name: string) => name.replace(/\s+/g, ' ').trim().slice(0, 80) || 'Ma question'
