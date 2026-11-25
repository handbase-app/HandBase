import { MAX_EXPRESSION, MAX_EXPRESSIONS, SENS, type Sens } from './dictation/avis'

/*
 * « Mes expressions » : le vocabulaire d'un entraîneur (« teigneux », « valeureux », « joue très personnel ») relié à 1 à 3
 * critères, chacun avec un sens (plutôt haut, moyen, plutôt bas). Partie pure (testée : tools/test-avis-expressions.ts),
 * sans base ni réseau ; src/expressions.ts la garde sur l'appareil et la synchronise (supabase/062_mes_expressions.sql).
 * Personnelles : leur auteur seul les voit, administrateurs compris. Seul le vocabulaire part avec un avis vocal.
 */

export type ExpressionCible = { criterionId: string; sens: Sens }

/** Ligne de la table locale « expressions » (src/db.ts) ; `owner` : le compte (vide en version d'essai sans serveur). */
export type ExpressionRow = {
  id: string
  owner: string
  texte: string
  cibles: ExpressionCible[]
  createdAt: number
  updatedAt: number
  deleted?: boolean
  /** Modifiée sur l'appareil, pas encore envoyée (1) ; envoyée ou reçue du serveur (0). */
  dirty: 0 | 1
}

/** Ligne de hb_expressions telle que lue ou écrite (user_id posé par le serveur). */
export type ServerExpression = { id: string; texte: string; cibles: unknown; created_at: string; updated_at: string; deleted_at: string | null }

/** Texte d'une expression : espaces resserrés, 60 caractères au plus. */
export const cleanTexte = (s: string) => s.replace(/\s+/g, ' ').trim().slice(0, MAX_EXPRESSION).trimEnd()

const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()

/** Même expression (majuscules et espaces indifférents ; accents gardés comme le serveur : lower(texte)). */
export const sameTexte = (a: string, b: string) => cleanTexte(a).toLowerCase() === cleanTexte(b).toLowerCase()

/** Cibles relues : 1 à 3, critères distincts, sens connu (sinon écartées). */
export function cleanCibles(raw: unknown): ExpressionCible[] {
  const out: ExpressionCible[] = []
  for (const c of Array.isArray(raw) ? raw : []) {
    const id = c && typeof c === 'object' ? (c as { criterionId?: unknown }).criterionId : undefined
    const sens = c && typeof c === 'object' ? (c as { sens?: unknown }).sens : undefined
    if (typeof id !== 'string' || !id || id.length > 80 || !SENS.includes(sens as Sens) || out.some((x) => x.criterionId === id)) continue
    out.push({ criterionId: id, sens: sens as Sens })
    if (out.length === 3) break
  }
  return out
}

/** Expressions vivantes d'un compte, par ordre alphabétique (sans accents). */
export function ownExpressions(rows: ExpressionRow[], owner: string): ExpressionRow[] {
  return rows.filter((r) => !r.deleted && r.owner === owner).sort((a, b) => fold(a.texte).localeCompare(fold(b.texte), 'fr'))
}

/**
 * Enregistrer une expression : même texte qu'une existante (ou même identifiant) : elle est mise à jour ; sinon une nouvelle.
 * Au-delà de 100, les plus anciennes (dernière modification) sont retirées. Renvoie les lignes à écrire (dirty).
 */
export function planSave(
  current: ExpressionRow[],
  input: { id?: string; texte: string; cibles: ExpressionCible[] },
  ctx: { owner: string; now: number; newId: () => string },
): ExpressionRow[] {
  const texte = cleanTexte(input.texte)
  const cibles = cleanCibles(input.cibles)
  if (!texte || !cibles.length) return []
  const mine = current.filter((r) => !r.deleted && r.owner === ctx.owner)
  const byId = input.id ? mine.find((r) => r.id === input.id) : undefined
  const sameText = mine.find((r) => sameTexte(r.texte, texte) && r.id !== byId?.id)
  const out: ExpressionRow[] = []
  const stamp = (r: ExpressionRow) => Math.max(ctx.now, r.updatedAt + 1)
  if (byId) {
    out.push({ ...byId, texte, cibles, updatedAt: stamp(byId), dirty: 1 })
    // Renommée en une expression qui existe déjà : celle-ci disparaît (une seule par texte).
    if (sameText) out.push({ ...sameText, cibles: [], deleted: true, updatedAt: stamp(sameText), dirty: 1 })
  } else if (sameText) {
    out.push({ ...sameText, texte, cibles, updatedAt: stamp(sameText), dirty: 1 })
  } else {
    out.push({ id: ctx.newId(), owner: ctx.owner, texte, cibles, createdAt: ctx.now, updatedAt: ctx.now, dirty: 1 })
    const extra = mine.length + 1 - MAX_EXPRESSIONS
    if (extra > 0)
      for (const r of [...mine].sort((a, b) => a.updatedAt - b.updatedAt).slice(0, extra)) out.push({ ...r, cibles: [], deleted: true, updatedAt: stamp(r), dirty: 1 })
  }
  return out
}

/** Supprimer : il ne reste que l'identifiant et le texte (pour que les autres appareils l'oublient aussi). */
export const planDelete = (r: ExpressionRow, now: number): ExpressionRow => ({ ...r, cibles: [], deleted: true, updatedAt: Math.max(now, r.updatedAt + 1), dirty: 1 })

/** Ligne de l'appareil → ligne envoyée au serveur (user_id : celui de la session, posé par le serveur). */
export const toServer = (r: ExpressionRow) => ({
  id: r.id,
  texte: r.texte,
  cibles: r.deleted ? [] : r.cibles,
  created_at: new Date(r.createdAt).toISOString(),
  updated_at: new Date(r.updatedAt).toISOString(),
  deleted_at: r.deleted ? new Date(r.updatedAt).toISOString() : null,
})

/**
 * Ligne reçue du serveur → ligne à écrire sur l'appareil, ou null : rien à faire (version de l'appareil plus récente et pas
 * encore envoyée, ou identique). Ligne illisible : ignorée.
 */
export function fromServer(s: ServerExpression, local: ExpressionRow | undefined, owner: string): ExpressionRow | null {
  const updatedAt = Date.parse(s.updated_at)
  if (!s.id || !Number.isFinite(updatedAt)) return null
  if (local && local.dirty && local.updatedAt >= updatedAt) return null
  if (local && !local.dirty && local.updatedAt === updatedAt) return null
  const deleted = !!s.deleted_at
  const cibles = deleted ? [] : cleanCibles(s.cibles)
  const texte = cleanTexte(typeof s.texte === 'string' ? s.texte : '')
  if (!deleted && (!texte || !cibles.length)) return null
  return {
    id: s.id,
    owner,
    texte,
    cibles,
    createdAt: Number.isFinite(Date.parse(s.created_at)) ? Date.parse(s.created_at) : updatedAt,
    updatedAt,
    ...(deleted && { deleted: true }),
    dirty: 0,
  }
}
