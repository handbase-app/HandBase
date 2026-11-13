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
// Notes « déduites » (confiance « deduit ») : le modèle interprète la description d'ensemble (« valeureuse, ne lâche jamais
// rien » → Engagement) ; l'extrait reste un passage mot pour mot du texte, revérifié de la même façon. Portrait en une phrase,
// remarques pas reliées à un critère (nonRelies, citations revérifiées) et « Mes expressions » de l'entraîneur (vocabulaire
// seulement, src/expressions.ts) envoyées avec les critères.
// Rien n'est enregistré ici : les propositions s'affichent sur la fiche, le coach les accepte ou les écarte, puis enregistre.

import { scaleMax, scaleMin, criterionApplies, type Criterion, type Position } from '../db'
import { sportContent } from '../sportContent'
import { DictationError, ERROR_TEXT, modeCode, sportField, type Endpoint } from './transcribe'

/** Texte dicté : 60 s de parole font environ 1 000 caractères ; marge pour un texte tapé ou corrigé. */
export const MAX_AVIS_TEXTE = 2000
const MAX_LABEL = 100
const MAX_DESCRIPTION = 200
const MAX_COMMENT = 400
const MAX_AMBIGUS = 5
const MAX_PORTRAIT = 160
const MAX_NON_RELIES = 5
/** Expression de l'entraîneur (« teigneux ») et citation « pas reliée » : 60 caractères au plus. */
export const MAX_EXPRESSION = 60
export const MAX_EXPRESSIONS = 100

/**
 * Repères de l'échelle 1 à 5 : ceux du sport, les mêmes que la légende de l'écran de notation (src/sportContent.ts ;
 * handball : 1 très insuffisant, 3 niveau attendu, 5 remarquable ; volley : En découverte… Remarquable).
 */
const libelles5 = (): Record<string, string> => ({ ...sportContent().scoreLabels })

export type AvisCritere = { id: string; label: string; description?: string; echelle: { min: number; max: number; libelles?: Record<string, string> } }
export type AvisRef = { criterionId: string; label: string; min: number; max: number }
export type AvisPayload = { criteres: AvisCritere[]; refs: Record<string, AvisRef>; expressions: AvisExpression[] }

/** Sens d'une expression sur un critère : plutôt haut, moyen, plutôt bas. */
export type Sens = 'haut' | 'moyen' | 'bas'
export const SENS: Sens[] = ['haut', 'moyen', 'bas']
export const SENS_LABEL: Record<Sens, string> = { haut: 'plutôt haut', moyen: 'moyen', bas: 'plutôt bas' }
/** Vocabulaire de l'entraîneur tel qu'il part : le mot et ses critères sous leurs identifiants courts. */
export type AvisExpression = { texte: string; cibles: { id: string; sens: Sens }[] }
/** Expression gardée sur l'appareil (src/expressions.ts) : seuls le texte et les cibles comptent ici. */
export type ExpressionLike = { texte: string; cibles: { criterionId: string; sens: Sens }[]; deleted?: boolean }

const clip = (s: string, n: number) => {
  const t = s.replace(/\s+/g, ' ').trim()
  return t.length > n ? t.slice(0, n - 1).trimEnd() + '…' : t
}

/**
 * Critères à envoyer pour ce joueur : actifs, d'observation, applicables à son poste, notés sur une échelle. Expressions de
 * l'entraîneur : leurs cibles traduites en c1, c2… (celles hors de la liste écartées ; une expression sans cible restante
 * ne part pas), 100 au plus. Jamais de nom ni de donnée de joueur.
 */
export function buildAvisPayload(criteria: Criterion[], position?: Position, expressions: ExpressionLike[] = []): AvisPayload {
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
    criteres.push({ id, label, ...(description && { description }), echelle: { min, max, ...(c.scale === 'score5' && { libelles: libelles5() }) } })
    refs[id] = { criterionId: c.id, label, min, max }
  }
  const short = new Map(Object.entries(refs).map(([id, r]) => [r.criterionId, id]))
  const out: AvisExpression[] = []
  for (const e of expressions) {
    if (out.length >= MAX_EXPRESSIONS) break
    const texte = typeof e.texte === 'string' ? e.texte.replace(/\s+/g, ' ').trim().slice(0, MAX_EXPRESSION) : ''
    if (e.deleted || !texte) continue
    const cibles: AvisExpression['cibles'] = []
    for (const c of e.cibles ?? []) {
      const id = short.get(c.criterionId)
      if (id && SENS.includes(c.sens) && !cibles.some((x) => x.id === id) && cibles.length < 3) cibles.push({ id, sens: c.sens })
    }
    if (cibles.length) out.push({ texte, cibles })
  }
  return { criteres, refs, expressions: out }
}

/** Sens d'une note : au-dessus du milieu de l'échelle « haut », en dessous « bas », pile au milieu « moyen ». */
export function sensFromValue(value: number, min: number, max: number): Sens {
  const mid = (min + max) / 2
  return value > mid ? 'haut' : value < mid ? 'bas' : 'moyen'
}

/** Texte d'une expression retenue depuis une citation : sans guillemets autour, première lettre en minuscule, 60 caractères. */
export function expressionText(quote: string): string {
  const t = quote
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[«"“'\s]+|[»"”'\s]+$/g, '')
    .trim()
  return (t.charAt(0).toLocaleLowerCase('fr') + t.slice(1)).slice(0, MAX_EXPRESSION).trimEnd()
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

/** « deduit » : note interprétée d'après la description d'ensemble, sans que le critère soit nommé. */
export type AvisSuggestion = { criterionId: string; label: string; value: number; quote: string; confidence: 'forte' | 'moyenne' | 'deduit' }
export type AvisDropReason = 'mal_forme' | 'id_inconnu' | 'hors_echelle' | 'citation_absente' | 'minimum_incertain' | 'doublon'
export type AvisResult = {
  suggestions: AvisSuggestion[]
  pointsForts: string
  axes: string
  ambigus: string[]
  /** Le type de joueur décrit, en une phrase (160 caractères au plus) ; vide si trop peu a été dit. */
  portrait: string
  /** Remarques sur le joueur reliées à aucun critère : passages du texte (60 caractères au plus, revérifiés). */
  nonRelies: string[]
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
    const confidence = confiance === 'forte' ? 'forte' : confiance === 'deduit' ? 'deduit' : 'moyenne'
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
    portrait: cleanText(r.portrait, refs, MAX_PORTRAIT),
    nonRelies: cleanNonRelies(r.nonRelies, transcript),
    dropped,
  }
}

/** Citations « pas reliées » : chaînes de 60 caractères au plus, vraiment dans le texte (le passage dicté est gardé), sans doublon. */
function cleanNonRelies(v: unknown, transcript: string): string[] {
  const out: string[] = []
  for (const x of Array.isArray(v) ? v : []) {
    if (typeof x !== 'string') continue
    const q = x.replace(/\s+/g, ' ').trim().replace(/^[«"“\s]+|[»"”\s]+$/g, '')
    if (!q || q.length > MAX_EXPRESSION) continue
    const found = findQuote(transcript, q)
    if (!found || found.length > MAX_EXPRESSION || out.some((o) => fold(o) === fold(found))) continue
    out.push(found)
    if (out.length >= MAX_NON_RELIES) break
  }
  return out
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
  /** Portrait proposé, pas encore accepté ni refusé. */
  portrait?: boolean
  /** Remarques à trancher (« J'hésite », « Pas relié ») pas encore traitées par le coach : leur nombre. */
  doubts?: number
  /** « Tout refuser » touché : la ligne d'état le dit. */
  refused?: boolean
  /** Identifiant de l'analyse (une évaluation vocale au journal, une appréciation par analyse). */
  id?: string
  /** Réponses du coach aux notes proposées (journal des évaluations vocales) : acceptée, modifiée (note mise), ignorée. */
  decisions?: Record<string, AvisDecision>
  /** Propositions posées sur la fiche par « Accepter » (fenêtre des propositions) : notes et commentaires. */
  added?: number
}

export type AvisDecision = { kept: 'accepte' | 'modifie' | 'ignore'; final?: number }

/**
 * Réponse du coach à la note proposée (en attente) pour un critère : `value` = la note qu'il a choisie (la même : acceptée ;
 * une autre : modifiée ; vide : ignorée), 'ignore' = ✕. Le critère sort des notes en attente. Critère pas en attente : inchangé.
 */
export function decide(s: AvisState, criterionId: string, choice: { value: number | string | undefined } | 'ignore'): AvisState {
  if (!s.pending.includes(criterionId)) return s
  const sug = s.result.suggestions.find((x) => x.criterionId === criterionId)
  let d: AvisDecision = { kept: 'ignore' }
  if (choice !== 'ignore' && choice.value !== undefined && choice.value !== '') {
    d = choice.value === sug?.value ? { kept: 'accepte' } : { kept: 'modifie', ...(typeof choice.value === 'number' && { final: choice.value }) }
  }
  return { ...s, pending: s.pending.filter((x) => x !== criterionId), decisions: { ...s.decisions, [criterionId]: d } }
}

/** « Tout accepter » / « Tout ignorer » : toutes les notes encore en attente, et les commentaires proposés. */
export function decideAll(s: AvisState, kept: 'accepte' | 'ignore'): AvisState {
  const decisions = { ...s.decisions }
  for (const id of s.pending) decisions[id] = { kept }
  return { ...s, pending: [], strengths: false, improvements: false, portrait: false, doubts: 0, decisions }
}

/**
 * Notes proposées et ce qu'en a fait le coach, pour le journal : critère (identifiant et libellé), note proposée, réponse.
 * Une note proposée identique à celle déjà saisie (jamais mise en attente) compte comme acceptée ; une encore en attente,
 * comme ignorée. Rien du joueur.
 */
export function avisProposals(s: AvisState): { criterionId: string; label: string; score: number; kept: AvisDecision['kept']; final?: number }[] {
  return s.result.suggestions.map((x) => {
    const d: AvisDecision = s.decisions?.[x.criterionId] ?? { kept: s.pending.includes(x.criterionId) ? 'ignore' : 'accepte' }
    return { criterionId: x.criterionId, label: x.label, score: x.value, ...d }
  })
}

export const pendingSuggestion = (s: AvisState | null, playerId: string, criterionId: string): AvisSuggestion | undefined =>
  s && s.playerId === playerId && s.pending.includes(criterionId) ? s.result.suggestions.find((x) => x.criterionId === criterionId) : undefined

/**
 * Hésitation de l'analyse (« « joue très personnel » : Jeu collectif ou Prise de décision ») lue pour la fenêtre des
 * propositions : le passage dit et les critères candidats reconnus par leur libellé (au moins deux, sinon null : la phrase
 * reste un simple texte). Le coach choisit le critère, puis la note.
 */
export function parseAmbigu(text: string, refs: Iterable<Pick<AvisRef, 'criterionId' | 'label'>>): { quote: string; ids: string[] } | null {
  const m = /^(.*?)\s*:\s*(.+)$/.exec(text.trim())
  if (!m) return null
  const quote = m[1].replace(/^[«"\s]+|[»"\s]+$/g, '').trim()
  const byLabel = new Map<string, string>()
  for (const r of refs) byLabel.set(fold(r.label).trim(), r.criterionId)
  const ids = m[2]
    .split(/\s+ou\s+|\s*,\s*|\s*\/\s*/i)
    .map((x) => byLabel.get(fold(x.replace(/[.»"]+$/, '')).trim()))
    .filter((x, i, a): x is string => !!x && a.indexOf(x) === i)
  return quote && ids.length >= 2 ? { quote, ids } : null
}

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

/**
 * Envoie le texte dicté, les critères et le vocabulaire de l'entraîneur s'il en a (rien d'autre) ; renvoie la réponse brute
 * du modèle, à relire par interpretAvis.
 */
export async function understandAvis(ep: Endpoint, texte: string, criteres: AvisCritere[], signal?: AbortSignal, expressions: AvisExpression[] = []): Promise<AvisAnswer> {
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
      body: JSON.stringify({ texte: text, criteres, ...(expressions.length && { expressions }), ...sportField() }),
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
  const { notes, pointsForts, axes, ambigus, portrait, nonRelies } = d
  return { raw: { notes, pointsForts, axes, ambigus, portrait, nonRelies }, ms: d.ms, restantMois: d.restant_mois, restantJour: d.restant_jour }
}
