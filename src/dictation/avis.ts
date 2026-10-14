// « Avis vocal » (essai) : le coach parle librement d'un joueur, l'appli PROPOSE des notes et des commentaires, le coach valide.
// Fonctions pures (testées avec de fausses réponses du modèle : tools/test-avis-vocal.ts) :
//  1. buildAvisPayload : les critères envoyés à la fonction « transcrire » (?mode=avis) avec le texte dicté : seulement ceux
//     qui s'appliquent au poste du joueur et qui se notent sur une échelle (score5, score3, score2), sous des identifiants
//     courts (c1, c2…) ; libellé, description, échelle. Aucune donnée de joueur, aucun nom ;
//  2. interpretAvis : relit la réponse du modèle : identifiant connu, valeur entière dans l'échelle, extrait vraiment présent
//     dans le texte dicté (sans accents, majuscules ni ponctuation, à une lettre près, petits mots sautés) ; sinon la proposition est écartée.
//     Le minimum de l'échelle n'est gardé qu'avec une confiance « forte ». Deux notes différentes pour un critère : aucune
//     n'est gardée, l'hésitation est signalée ;
//  3. mergeComment : ajoute un commentaire proposé à celui déjà écrit (sans doublon).
// Rien n'est enregistré ici : les propositions s'affichent sur la fiche, le coach les accepte ou les écarte, puis enregistre.

import { scaleMax, scaleMin, criterionApplies, type Criterion, type Position } from '../db'
import { DictationError, ERROR_TEXT, modeCode, type Endpoint } from './transcribe'

/** Texte dicté : 60 s de parole font environ 1 000 caractères ; marge pour un texte tapé ou corrigé. */
export const MAX_AVIS_TEXTE = 2000
const MAX_LABEL = 100
const MAX_DESCRIPTION = 200
const MAX_COMMENT = 400
const MAX_AMBIGUS = 5

/** Repères de l'échelle 1 à 5 (les mêmes que la légende de l'écran de notation). */
const LIBELLES_5: Record<string, string> = { '1': 'très insuffisant', '3': 'niveau attendu', '5': 'remarquable' }

export type AvisCritere = { id: string; label: string; description?: string; echelle: { min: number; max: number; libelles?: Record<string, string> } }
export type AvisRef = { criterionId: string; label: string; min: number; max: number }
export type AvisPayload = { criteres: AvisCritere[]; refs: Record<string, AvisRef> }

const clip = (s: string, n: number) => {
  const t = s.replace(/\s+/g, ' ').trim()
  return t.length > n ? t.slice(0, n - 1).trimEnd() + '…' : t
}

/** Critères à envoyer pour ce joueur : actifs, d'observation, applicables à son poste, notés sur une échelle. */
export function buildAvisPayload(criteria: Criterion[], position?: Position): AvisPayload {
  const criteres: AvisCritere[] = []
  const refs: Record<string, AvisRef> = {}
  for (const c of criteria) {
    if (c.deleted || !c.active || c.kind !== 'subjective' || !criterionApplies(c, position)) continue
    const max = scaleMax(c.scale)
    if (max === null) continue
    const min = scaleMin(c.scale)
    const id = `c${criteres.length + 1}`
    const label = clip(c.label, MAX_LABEL)
    const description = c.description ? clip(c.description, MAX_DESCRIPTION) : ''
    criteres.push({ id, label, ...(description && { description }), echelle: { min, max, ...(c.scale === 'score5' && { libelles: LIBELLES_5 }) } })
    refs[id] = { criterionId: c.id, label, min, max }
  }
  return { criteres, refs }
}

// ---------- Citation : l'extrait est-il vraiment dans le texte dicté ? ----------

const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()

type Tok = { w: string; start: number; end: number }
function tokens(s: string): Tok[] {
  const out: Tok[] = []
  for (const m of s.matchAll(/[\p{L}\p{N}]+/gu)) out.push({ w: fold(m[0]), start: m.index!, end: m.index! + m[0].length })
  return out
}

function lev(a: string, b: string, cap: number): number {
  if (Math.abs(a.length - b.length) > cap) return cap + 1
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    prev = cur
  }
  return prev[b.length]
}

/** Même mot, à une lettre près pour les mots de 5 lettres et plus (accord, faute de frappe), deux au-delà de 9. */
function sameWord(a: string, b: string): boolean {
  if (a === b) return true
  const n = Math.min(a.length, b.length)
  const cap = n >= 9 ? 2 : n >= 5 ? 1 : 0
  return cap > 0 && lev(a, b, cap) <= cap
}

// Petits mots qu'on peut sauter d'un côté ou de l'autre (« au tir c'est correct » / « au tir, correct »). Jamais une
// négation ni un mot qui porte le sens (« ne », « pas », « peu », « mal », « bien »…) : un extrait qui en change un est écarté.
const FILLERS = new Set(['de', 'd', 'du', 'des', 'l', 'la', 'le', 'les', 'un', 'une', 'et', 'a', 'au', 'aux', 'c', 'ce', 'est', 'euh', 'ben', 'alors', 'donc'])

/** Cherche un morceau d'extrait (sans « … ») dans le texte : renvoie le passage du texte, tel qu'il a été dicté. */
function findPart(text: string, tt: Tok[], q: Tok[]): string | null {
  const n = q.length
  // Aligne q[a…] sur tt[b…] : mots identiques (à une lettre près pour les longs), petits mots sautés ; renvoie la fin.
  const memo = new Map<number, { end: number; hits: number } | null>()
  const match = (a: number, b: number): { end: number; hits: number } | null => {
    if (a === n) return { end: b, hits: 0 }
    const key = a * (tt.length + 1) + b
    if (memo.has(key)) return memo.get(key)!
    let r: { end: number; hits: number } | null = null
    if (b < tt.length && sameWord(q[a].w, tt[b].w)) {
      const next = match(a + 1, b + 1)
      if (next) r = { end: next.end, hits: next.hits + 1 }
    }
    if (!r && FILLERS.has(q[a].w)) r = match(a + 1, b)
    if (!r && b < tt.length && FILLERS.has(tt[b].w) && a > 0) r = match(a, b + 1)
    memo.set(key, r)
    return r
  }
  for (let i = 0; i < tt.length; i++) {
    for (const a0 of FILLERS.has(q[0].w) ? [0, 1] : [0]) {
      if (a0 >= n || !sameWord(q[a0].w, tt[i].w)) continue
      const r = match(a0, i)
      // Assez de mots retrouvés : deux, ou un seul de 4 lettres au moins.
      if (r && (r.hits >= 2 || (r.hits === 1 && tt[i].w.length >= 4))) {
        let last = r.end - 1
        while (last > i && FILLERS.has(tt[last].w) && !sameWord(tt[last].w, q[n - 1].w)) last--
        return text.slice(tt[i].start, tt[last].end)
      }
    }
  }
  return null
}

/**
 * L'extrait proposé par le modèle figure-t-il dans le texte dicté ? (sans accents, majuscules ni ponctuation ; à une lettre
 * près pour les mots longs ; petits mots sautés). Renvoie le passage du texte lui-même (c'est lui qui est affiché), ou null.
 * Un extrait coupé par « … » : chaque morceau doit s'y trouver.
 */
export function findQuote(text: string, quote: string): string | null {
  const tt = tokens(text)
  const parts = quote
    .split(/…|\.{3}/)
    .map((p) => tokens(p))
    .filter((p) => p.length)
  if (!parts.length) return null
  const found: string[] = []
  for (const p of parts) {
    const f = findPart(text, tt, p)
    if (f === null) return null
    found.push(f)
  }
  return found.join(' … ')
}

// ---------- Relecture de la réponse du modèle ----------

export type AvisSuggestion = { criterionId: string; label: string; value: number; quote: string; confidence: 'forte' | 'moyenne' }
export type AvisDropReason = 'mal_forme' | 'id_inconnu' | 'hors_echelle' | 'citation_absente' | 'minimum_incertain' | 'doublon'
export type AvisResult = {
  suggestions: AvisSuggestion[]
  pointsForts: string
  axes: string
  ambigus: string[]
  /** Propositions écartées par la relecture (jamais affichées comme des notes). */
  dropped: { reason: AvisDropReason; label?: string }[]
}

const intValue = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && /^\s*\d+\s*$/.test(v) ? Number(v) : NaN
  return Number.isInteger(n) ? n : null
}

/** Remplace les identifiants courts (« c3 ») que le modèle aurait laissés dans un texte par les libellés. */
const withLabels = (s: string, refs: Record<string, AvisRef>) => s.replace(/\bc(\d{1,3})\b/g, (m) => (refs[m] ? `« ${refs[m].label} »` : m))

const cleanText = (v: unknown, refs: Record<string, AvisRef>, n: number) =>
  typeof v === 'string' ? clip(withLabels(v.trim().replace(/^(?:"([^"]*)"|«\s*([^«»]*?)\s*»)$/, '$1$2'), refs), n) : ''

/** Revérifie chaque proposition du modèle ; seules les sûres deviennent des notes proposées. */
export function interpretAvis(raw: unknown, payload: Pick<AvisPayload, 'refs'>, transcript: string): AvisResult {
  const { refs } = payload
  const r = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
  const dropped: AvisResult['dropped'] = []
  const kept = new Map<string, AvisSuggestion>()
  const conflict = new Set<string>()
  for (const n of Array.isArray(r.notes) ? r.notes : []) {
    if (!n || typeof n !== 'object') {
      dropped.push({ reason: 'mal_forme' })
      continue
    }
    const { id, valeur, extrait, confiance } = n as Record<string, unknown>
    const ref = typeof id === 'string' ? refs[id.trim()] : undefined
    if (!ref) {
      dropped.push({ reason: 'id_inconnu' })
      continue
    }
    const value = intValue(valeur)
    if (value === null || value < ref.min || value > ref.max) {
      dropped.push({ reason: 'hors_echelle', label: ref.label })
      continue
    }
    const quote = typeof extrait === 'string' ? findQuote(transcript, extrait) : null
    if (!quote) {
      dropped.push({ reason: 'citation_absente', label: ref.label })
      continue
    }
    const confidence = confiance === 'forte' ? 'forte' : 'moyenne'
    if (value === ref.min && confidence !== 'forte') {
      dropped.push({ reason: 'minimum_incertain', label: ref.label })
      continue
    }
    const prev = kept.get(ref.criterionId)
    if (prev && prev.value !== value) conflict.add(ref.criterionId)
    else if (prev) dropped.push({ reason: 'doublon', label: ref.label })
    else kept.set(ref.criterionId, { criterionId: ref.criterionId, label: ref.label, value, quote, confidence })
  }
  const ambigus: string[] = []
  for (const id of conflict) {
    const s = kept.get(id)!
    kept.delete(id)
    ambigus.push(`la note de « ${s.label} »`)
  }
  for (const a of Array.isArray(r.ambigus) ? r.ambigus : []) {
    const t = cleanText(a, refs, 160)
    if (t && !ambigus.includes(t)) ambigus.push(t)
  }
  // Ordre des critères sur la fiche (celui de la liste envoyée).
  const order = Object.values(refs).map((x) => x.criterionId)
  const suggestions = [...kept.values()].sort((a, b) => order.indexOf(a.criterionId) - order.indexOf(b.criterionId))
  return {
    suggestions,
    pointsForts: cleanText(r.pointsForts, refs, MAX_COMMENT),
    axes: cleanText(r.axes, refs, MAX_COMMENT),
    ambigus: ambigus.slice(0, MAX_AMBIGUS),
    dropped,
  }
}

/** Propositions en attente pour un joueur : notes pas encore acceptées ni écartées, commentaires pas encore ajoutés. */
export type AvisState = {
  playerId: string
  transcript: string
  result: AvisResult
  /** Critères dont la note proposée attend une réponse du coach. */
  pending: string[]
  strengths: boolean
  improvements: boolean
}

export const pendingSuggestion = (s: AvisState | null, playerId: string, criterionId: string): AvisSuggestion | undefined =>
  s && s.playerId === playerId && s.pending.includes(criterionId) ? s.result.suggestions.find((x) => x.criterionId === criterionId) : undefined

/** Ajoute un commentaire proposé à celui déjà écrit : à la ligne, sans doublon (déjà présent : inchangé). */
export function mergeComment(current: string | undefined, proposal: string): string {
  const cur = (current ?? '').trimEnd()
  const p = proposal.trim()
  if (!p) return current ?? ''
  if (!cur) return p
  const norm = (s: string) => tokens(s).map((t) => t.w).join(' ')
  if (norm(cur).includes(norm(p))) return current ?? ''
  return `${cur}\n${p}`
}

/** Phrase courte des propositions écartées (« 2 propositions écartées : extrait introuvable dans le texte »). */
export function droppedText(d: AvisResult['dropped']): string {
  if (!d.length) return ''
  const why: Record<AvisDropReason, string> = {
    mal_forme: 'réponse incomplète',
    id_inconnu: 'critère inconnu',
    hors_echelle: 'note hors échelle',
    citation_absente: 'passage introuvable dans le texte',
    minimum_incertain: 'note la plus basse pas assez sûre',
    doublon: 'en double',
  }
  const reasons = [...new Set(d.map((x) => why[x.reason]))]
  return `${d.length} proposition${d.length > 1 ? 's' : ''} écartée${d.length > 1 ? 's' : ''} (${reasons.join(', ')}).`
}

// ---------- Appel à la fonction « transcrire » (POST ?mode=avis) ----------

const AVIS_ERRORS: Record<string, string> = {
  texte_absent: 'Rien à analyser : dictez d’abord votre avis.',
  texte_trop_long: 'Avis trop long : 2 000 caractères au plus.',
  criteres_invalides: 'Aucun critère à proposer pour ce joueur.',
  reponse_illisible: 'Avis pas compris pour l’instant : réessayez, ou notez à la main.',
}

export type AvisAnswer = { raw: unknown; ms?: number; restantMois?: number; restantJour?: number }

/** Envoie le texte dicté et les critères (rien d'autre) ; renvoie la réponse brute du modèle, à relire par interpretAvis. */
export async function understandAvis(ep: Endpoint, texte: string, criteres: AvisCritere[], signal?: AbortSignal): Promise<AvisAnswer> {
  const text = texte.replace(/\s+/g, ' ').trim()
  const err = (code: string) => new DictationError(code, AVIS_ERRORS[code] ?? ERROR_TEXT[code])
  if (!text) throw err('texte_absent')
  if (text.length > MAX_AVIS_TEXTE) throw err('texte_trop_long')
  if (!criteres.length) throw err('criteres_invalides')
  const f = ep.fetch ?? fetch
  let res: Response
  try {
    res = await f(ep.url + (ep.url.includes('?') ? '&' : '?') + 'mode=avis', {
      method: 'POST',
      headers: { ...ep.headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ texte: text, criteres }),
      signal,
    })
  } catch (e) {
    if ((e as Error)?.name === 'AbortError') throw new DictationError('annule', 'Analyse annulée.')
    throw err('reseau')
  }
  let d: Record<string, unknown> & { error?: string; ms?: number; restant_mois?: number; restant_jour?: number } = {}
  try {
    d = await res.json()
  } catch {
    /* réponse vide */
  }
  if (!res.ok) throw err(modeCode(d.error ?? (res.status === 404 ? 'absent' : res.status === 401 ? 'non_connecte' : res.status === 403 ? 'pas_admin' : 'mistral_erreur')))
  const { notes, pointsForts, axes, ambigus } = d
  return { raw: { notes, pointsForts, axes, ambigus }, ms: d.ms, restantMois: d.restant_mois, restantJour: d.restant_jour }
}
