/*
 * « Cahier du hand » (chaque jour de classe) et « Cahier de match » (le week-end) : deux sortes de notes du « journal du hand »
 * (supabase/052, étendu par supabase/074_lampe.sql : colonnes kind, jour, parts de hb_player_journal). Privées par défaut,
 * partagées avec l'encadrant une par une comme les autres notes. Une par jour et par sorte (réécrite si on la reprend).
 * Partie PURE (ni Dexie ni React), mêmes règles que le serveur (hb_lp_parts, hb_lp_ok, hb_lp_texte), testée par
 * tools/test-lampe.ts. Clavier seulement : rien ne part vers une IA.
 */

export type CahierKind = 'cahier' | 'match'

/** Les 3 questions du cahier du hand (responsable du pôle). */
export const CAHIER_FIELDS = [
  { key: 'travail', label: 'Ce que j’ai travaillé / mes sensations', hint: 'Ex. : les tirs en appui, je me sentais bien dans mes jambes' },
  { key: 'difficile', label: 'Ce qui était difficile', hint: 'Ex. : enchaîner après l’effort' },
  { key: 'objectif', label: 'Mon objectif sur le même thème', hint: 'Ex. : garder ma précision en fin de séance' },
] as const
export type CahierKey = (typeof CAHIER_FIELDS)[number]['key']
export const CAHIER_TEXT_MAX = 500

/** Cahier de match : sensation globale, mots POSITIFS ou NEUTRES seulement (jamais « pas bien »). */
export const MATCH_FEELINGS = [
  { id: 'super', label: 'Super', emoji: '🤩' },
  { id: 'correct', label: 'Correct', emoji: '🙂' },
  { id: 'complique', label: 'Compliqué', emoji: '😅' },
] as const
export type MatchFeeling = (typeof MATCH_FEELINGS)[number]['id']
/** Résultat, dit de façon neutre. */
export const MATCH_RESULTS = [
  { id: 'victoire', label: 'Victoire' },
  { id: 'nul', label: 'Nul' },
  { id: 'defaite', label: 'Défaite' },
] as const
export type MatchResult = (typeof MATCH_RESULTS)[number]['id']
export const MATCH_TEXTS = [
  { key: 'bienAtt', label: 'Ce que j’ai bien fait en attaque' },
  { key: 'bienDef', label: 'Ce que j’ai bien fait en défense' },
  { key: 'amelAtt', label: 'Ce que je peux améliorer en attaque' },
  { key: 'amelDef', label: 'Ce que je peux améliorer en défense' },
] as const
export type MatchTextKey = (typeof MATCH_TEXTS)[number]['key']
export const MATCH_TEXT_MAX = 300
/** Minutes d'une mi-temps au plus ; score au plus. */
export const MATCH_HALF_MAX = 40
export const MATCH_SCORE_MAX = 99
export const OPPONENT_MAX = 80
/** Jours en arrière où l'on peut encore écrire : cahier du hand (aujourd'hui ou hier), cahier de match (3 jours : le match
 *  du samedi se raconte jusqu'au mardi). Mêmes valeurs que hb_lp_retard() (074). */
export const CAHIER_BACK_DAYS = 1
export const MATCH_BACK_DAYS = 3

export type CahierParts = Partial<Record<CahierKey, string>>
export interface MatchParts {
  adversaire?: string
  nous?: number
  eux?: number
  resultat?: MatchResult
  sensation?: MatchFeeling
  mt1?: number
  mt2?: number
  bienAtt?: string
  bienDef?: string
  amelAtt?: string
  amelDef?: string
}

/** Texte de plusieurs lignes : caractères de contrôle retirés (sauf retours à la ligne), bords coupés, longueur limitée. */
const text = (v: unknown, max: number) =>
  typeof v === 'string'
    ? v
        .replace(/\r\n?/g, '\n')
        .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
        .trim()
        .slice(0, max)
        .trim() || undefined
    : undefined
const oneLine = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f\s]+/g, ' ').trim().slice(0, max).trim() || undefined : undefined)
const int = (v: unknown, hi: number) => (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= hi ? v : undefined)

export function cleanCahier(v: unknown): CahierParts {
  const o = v && typeof v === 'object' ? (v as Record<string, unknown>) : {}
  const out: CahierParts = {}
  for (const f of CAHIER_FIELDS) {
    const t = text(o[f.key], CAHIER_TEXT_MAX)
    if (t) out[f.key] = t
  }
  return out
}

/** Résultat déduit du score s'il est donné (sinon celui choisi). */
export function resultOf(nous?: number, eux?: number, chosen?: MatchResult): MatchResult | undefined {
  if (nous !== undefined && eux !== undefined) return nous > eux ? 'victoire' : nous < eux ? 'defaite' : 'nul'
  return chosen
}

export function cleanMatch(v: unknown): MatchParts {
  const o = v && typeof v === 'object' ? (v as Record<string, unknown>) : {}
  const out: MatchParts = {}
  const adv = oneLine(o.adversaire, OPPONENT_MAX)
  if (adv) out.adversaire = adv
  const nous = int(o.nous, MATCH_SCORE_MAX)
  const eux = int(o.eux, MATCH_SCORE_MAX)
  if (nous !== undefined && eux !== undefined) Object.assign(out, { nous, eux })
  const chosen = MATCH_RESULTS.some((r) => r.id === o.resultat) ? (o.resultat as MatchResult) : undefined
  const res = resultOf(out.nous, out.eux, chosen)
  if (res) out.resultat = res
  if (MATCH_FEELINGS.some((f) => f.id === o.sensation)) out.sensation = o.sensation as MatchFeeling
  const mt1 = int(o.mt1, MATCH_HALF_MAX)
  const mt2 = int(o.mt2, MATCH_HALF_MAX)
  if (mt1 !== undefined) out.mt1 = mt1
  if (mt2 !== undefined) out.mt2 = mt2
  for (const f of MATCH_TEXTS) {
    const t = text(o[f.key], MATCH_TEXT_MAX)
    if (t) out[f.key] = t
  }
  return out
}

export const cleanParts = (kind: CahierKind, v: unknown): CahierParts | MatchParts => (kind === 'cahier' ? cleanCahier(v) : cleanMatch(v))
export const isEmptyParts = (p: object) => Object.keys(p).length === 0

/** Temps de jeu cumulé (minutes) ; aucune mi-temps donnée : undefined. */
export const playTime = (p: Pick<MatchParts, 'mt1' | 'mt2'>) => (p.mt1 === undefined && p.mt2 === undefined ? undefined : (p.mt1 ?? 0) + (p.mt2 ?? 0))

/**
 * La tâche compte-t-elle pour la lampe ? Cahier du hand : `min` questions remplies (3 par défaut). Cahier de match : la
 * sensation globale et au moins une des quatre lignes « bien fait / améliorer ». Même règle que hb_lp_ok (074).
 */
export function partsCount(kind: CahierKind, p: CahierParts | MatchParts, min = 3): boolean {
  if (kind === 'cahier') return CAHIER_FIELDS.filter((f) => (p as CahierParts)[f.key]).length >= min
  const m = p as MatchParts
  return !!m.sensation && MATCH_TEXTS.some((f) => !!m[f.key])
}

/** Texte de la note (journal, et lecture par les anciennes versions de l'appli) ; même forme que hb_lp_texte (074). */
export function cahierText(kind: CahierKind, p: CahierParts | MatchParts): string {
  const out: string[] = []
  if (kind === 'cahier') {
    out.push('📒 Cahier du hand')
    for (const f of CAHIER_FIELDS) if ((p as CahierParts)[f.key]) out.push(`${f.label} : ${(p as CahierParts)[f.key]}`)
  } else {
    const m = p as MatchParts
    out.push('🏟️ Cahier de match' + (m.adversaire ? ` contre ${m.adversaire}` : ''))
    const res = MATCH_RESULTS.find((r) => r.id === m.resultat)?.label
    const score = m.nous !== undefined && m.eux !== undefined ? `${m.nous} – ${m.eux}` : ''
    if (res || score) out.push(`Résultat : ${[res, score].filter(Boolean).join(' ')}`)
    const feel = MATCH_FEELINGS.find((f) => f.id === m.sensation)?.label
    if (feel) out.push(`Sensation : ${feel}`)
    const t = playTime(m)
    if (t !== undefined) out.push(`Temps de jeu : ${m.mt1 ?? 0} + ${m.mt2 ?? 0} = ${t} min`)
    for (const f of MATCH_TEXTS) if (m[f.key]) out.push(`${f.label} : ${m[f.key]}`)
  }
  return out.join('\n').slice(0, 1000)
}

/** Jours où l'on peut écrire ce cahier (le plus récent en premier) ; cahier de match : samedi et dimanche seulement compteront
 *  pour le bonus, mais un match de semaine se raconte aussi. */
export function writableDays(kind: CahierKind, today: string): string[] {
  const n = kind === 'cahier' ? CAHIER_BACK_DAYS : MATCH_BACK_DAYS
  const out: string[] = []
  for (let i = 0; i <= n; i++) out.push(new Date(Date.parse(today + 'T00:00:00Z') - i * 86400000).toISOString().slice(0, 10))
  return out
}
