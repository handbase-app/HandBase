/*
 * « Mes suivis », journée dépliée : une ligne compacte par joueur (nom, un pictogramme par sorte de nouveauté avec leur
 * nombre), le détail écrit en dessous une fois la ligne dépliée (src/pages/Follows.tsx). Ici la partie pure : ce que
 * chaque pictogramme compte et ouvre sur la fiche (src/playerFocus.ts), l'écart d'une mesure avec la précédente.
 * Test : tools/test-voir-fiche.ts.
 */
import type { PlayerFocus } from './playerFocus'

/** Le strict nécessaire d'une nouveauté (src/follows.ts : FollowNews). */
export interface NewsLike {
  kind: 'measurement' | 'evaluation' | 'video'
  refId: string
  criterionId?: string
  time: number
}

export type NewsKind = NewsLike['kind']
/** Ordre des pictogrammes : avis, mesures, vidéos. */
export const ROW_KINDS: readonly NewsKind[] = ['evaluation', 'measurement', 'video']

/** Pictogramme d'une sorte de nouveauté : combien, et où il mène sur la fiche. */
export interface RowPicto {
  kind: NewsKind
  n: number
  focus: PlayerFocus
}

/**
 * Pictogrammes d'un joueur sur une journée, dans l'ordre ROW_KINDS (seulement les sortes présentes) :
 *   mesures → la courbe de la plus récente, sa ligne marquée ;
 *   avis    → cet avis s'il est seul, sinon le détail des avis ;
 *   vidéos  → cette vidéo si elle est seule, sinon la liste des vidéos.
 */
export function rowPictos(items: readonly NewsLike[]): RowPicto[] {
  const out: RowPicto[] = []
  for (const kind of ROW_KINDS) {
    const of = items.filter((n) => n.kind === kind)
    if (!of.length) continue
    const last = of.reduce((a, b) => (b.time > a.time ? b : a))
    const focus: PlayerFocus =
      kind === 'measurement'
        ? { kind: 'mesure', id: last.criterionId ?? last.refId, row: last.refId }
        : kind === 'evaluation'
          ? { kind: 'avis', id: of.length === 1 ? last.refId : 'tous' }
          : { kind: 'video', id: of.length === 1 ? last.refId : 'toutes' }
    out.push({ kind, n: of.length, focus })
  }
  return out
}

/** Nom accessible d'un pictogramme : « 3 nouvelles mesures de DUPONT Léo », « 1 nouvel avis sur … ». */
export function pictoLabel(kind: NewsKind, n: number, who: string): string {
  if (kind === 'evaluation') return `${n} ${n > 1 ? 'nouveaux avis' : 'nouvel avis'} sur ${who}`
  if (kind === 'measurement') return `${n} ${n > 1 ? 'nouvelles mesures' : 'nouvelle mesure'} de ${who}`
  return `${n} ${n > 1 ? 'nouvelles vidéos' : 'nouvelle vidéo'} de ${who}`
}

/**
 * Écart d'une mesure avec la précédente du même test, écrit sans jugement : « +2 cm », « −0,3 s », « = » (même valeur).
 * `unit` : l'unité du critère ; `outOf` : critère noté sur une échelle (/5…), écart sans unité.
 */
export function deltaText(cur: number, prev: number, unit?: string, outOf = false): string {
  const d = Math.round((cur - prev) * 100) / 100
  if (d === 0) return '='
  const s = Math.abs(d).toLocaleString('fr-FR', { maximumFractionDigits: 2 })
  return `${d > 0 ? '+' : '−'}${s}${unit && !outOf ? ` ${unit}` : ''}`
}

/** Mesure précédente du même test pour un joueur : la dernière avant celle-ci (date du test, puis ordre de saisie). */
export function previousValue<M extends { id: string; date: string; value: unknown; at: number }>(list: readonly M[], m: M): number | undefined {
  let best: M | undefined
  for (const x of list) {
    if (x.id === m.id || typeof x.value !== 'number') continue
    const before = x.date < m.date || (x.date === m.date && x.at < m.at)
    if (!before) continue
    if (!best || x.date > best.date || (x.date === best.date && x.at > best.at)) best = x
  }
  return best?.value as number | undefined
}
