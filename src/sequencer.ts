import { simultaneous, timelineOf, type ActionKind, type MatchSheet, type Timeline } from './matchSheet'

/*
 * Séquençage en plein écran (calcul pur, sans écran : src/components/Sequencer.tsx l'affiche, MatchTimeline.tsx l'écrit).
 *
 * On regarde le match en entier ; les actions de la feuille arrivent de droite à gauche sur une frise transparente posée sur
 * la vidéo, vers une ligne de visée fixe (au tiers de la largeur depuis la gauche). Quand l'action annoncée est sur la cible,
 * « C'est ici » la cale au temps courant de la vidéo, et la suivante devient l'action annoncée.
 *
 * Estimation du temps vidéo d'une action non calée : celle de toute l'appli (matchSheet.ts timeline), pour que la frise
 * défilante, la frise du match et les moments générés disent la même chose. Repères = actions calées (temps de jeu fiable)
 * et repères de période posés ; interpolation linéaire par morceaux entre repères de la même période ; avant le premier ou
 * après le dernier : pente 1 avec un seul repère, sinon pente moyenne observée (bornée 0,5 à 3) ; période sans repère :
 * déduite de la voisine (fin + pause estimée, 10 min avant la 2e mi-temps). Le temps de jeu de la feuille est cumulé (la
 * 2e mi-temps reprend à 20:00, 25:00 ou 30:00) et chaque action porte sa période. Sans aucun repère : pas d'estimation.
 */

/** Une entrée de la file : une action, ou un groupe d'actions simultanées (même temps de jeu, calées ensemble). */
export interface SeqItem {
  /** Même identifiant que le repère de la frise du match (MatchTimeline : « a12 »). */
  id: string
  /** Première action du groupe (indice dans la feuille). */
  i: number
  /** Toutes les actions du groupe (une seule le plus souvent). */
  is: number[]
  /** Type montré : but d'abord, puis exclusion, carton, temps mort, le reste. */
  k: ActionKind
  /** Période et temps de jeu (s depuis le coup d'envoi, cumulé). */
  p: number
  g: number
  /** Temps vidéo : calé, ou estimé ; undefined sans aucun repère. */
  v?: number
  /** Toutes les actions du groupe sont calées. */
  fixed: boolean
}

const KIND_RANK: Partial<Record<ActionKind, number>> = { but: 0, but7: 0, '2mn': 1, disq: 2, avert: 2, bleu: 2, tm: 3 }
const rank = (k: ActionKind) => KIND_RANK[k] ?? 4

/**
 * File de séquençage, dans l'ordre de la feuille : un élément par action ou groupe d'actions simultanées, sauf les
 * ignorés (« Ignorer » : sync.skip pour toutes les actions du groupe ; ils restent sur la feuille et ne sont pas des
 * repères). Une action passée (« Passer ») reste dans la file, non calée : on peut y revenir.
 */
export function seqQueue(ms: Pick<MatchSheet, 'actions' | 'halfMin' | 'sync'>, tl: Timeline = timelineOf(ms)): SeqItem[] {
  const sim = simultaneous(ms.actions, tl.late)
  const fix = ms.sync?.fix ?? {}
  const skip = ms.sync?.skip ?? {}
  return ms.actions.flatMap((a, i) => {
    const g = sim[i]
    if (g[0] !== i || g.every((j) => skip[tl.keys[j]])) return []
    const lead = [...g].sort((x, y) => rank(ms.actions[x].k) - rank(ms.actions[y].k))[0]
    return [{ id: `a${i}`, i, is: g, k: ms.actions[lead].k, p: a.p, g: a.t, v: tl.at(i), fixed: g.every((j) => fix[tl.keys[j]] !== undefined) }]
  })
}

/** Avance tolérée sur l'estimation avant de choisir l'action annoncée par défaut (s). */
const BEHIND = 10

/**
 * Action annoncée (en attente de calage) : celle choisie (id) si elle est dans la file ; sinon la première non calée qui
 * n'est pas déjà loin derrière le temps courant (reprise en cours de match), sinon la première non calée. undefined :
 * tout est calé.
 */
export function pendingOf(queue: SeqItem[], id: string | undefined, now: number): SeqItem | undefined {
  const chosen = id ? queue.find((x) => x.id === id) : undefined
  if (chosen) return chosen
  const open = queue.filter((x) => !x.fixed)
  return open.find((x) => x.v === undefined || x.v >= now - BEHIND) ?? open[0]
}

/** Élément suivant (dir 1) ou précédent (-1) dans l'ordre de la feuille ; undefined au bout. */
export function stepQueue(queue: SeqItem[], id: string | undefined, dir: 1 | -1): SeqItem | undefined {
  const j = queue.findIndex((x) => x.id === id)
  if (j < 0) return dir === 1 ? queue[0] : undefined
  return queue[j + dir]
}

/** Écart (s) sous lequel l'action annoncée est « sur la cible » : ping. */
export const PING = 2

/**
 * File vue au temps courant now, avec l'action annoncée pendingId. Tant qu'elle n'est pas calée, l'action annoncée est
 * « au plus tôt maintenant » : estimation dépassée (la vidéo continue au-delà), elle reste figée sur la cible (ancre
 * provisoire au temps courant) et toute la frise s'arrête avec elle : les actions suivantes non calées, jusqu'à la
 * prochaine action calée, sont décalées d'autant et gardent leur écart estimé avec elle (différence de temps de jeu
 * convertie par l'estimation). Au calage, la vraie ancre remplace la provisoire et tout se recale (appui en avance : la
 * suite arrive plus tôt ; en retard : plus tard) ; en reculant avant l'estimation, rien n'est décalé. Les actions calées
 * gardent leur temps. late : secondes de dépassement de l'estimation (0 sinon).
 */
export function liveQueue(base: SeqItem[], pendingId: string | undefined, now: number): { queue: SeqItem[]; late: number } {
  const pj = base.findIndex((x) => x.id === pendingId)
  const p = base[pj]
  if (!p || p.fixed || p.v === undefined || p.v >= now) return { queue: base, late: 0 }
  const late = now - p.v
  const queue = base.slice()
  for (let j = pj; j < queue.length && !queue[j].fixed; j++) if (queue[j].v !== undefined) queue[j] = { ...queue[j], v: queue[j].v! + late }
  return { queue, late }
}

/** Position d'un élément sur la frise défilante : x de 0 (gauche) à 1 (droite). */
export interface SeqMark {
  it: SeqItem
  x: number
  /** Action annoncée. */
  pending: boolean
  /** Déjà passée (à gauche de la cible, ou passée sans calage) : estompée. */
  past: boolean
}

/**
 * Frise défilante : ligne de visée à aim (fraction de la largeur), ahead secondes visibles à sa droite (autant à l'échelle
 * à sa gauche : ahead × aim / (1 − aim)). Une action est à x = aim + (v − now) / ahead × (1 − aim). queue : file vue au
 * temps courant (liveQueue : l'action annoncée ne dépasse jamais la cible). Seules les actions visibles (0 ≤ x ≤ 1) sont
 * rendues.
 */
export function seqView(queue: SeqItem[], pendingId: string | undefined, now: number, ahead = 60, aim = 1 / 3): SeqMark[] {
  const scale = (1 - aim) / ahead
  const pj = queue.findIndex((x) => x.id === pendingId)
  return queue.flatMap((it, j) => {
    if (it.v === undefined) return []
    const pending = j === pj
    const x = pending ? Math.max(aim, aim + (it.v - now) * scale) : aim + (it.v - now) * scale
    // Passée : à gauche de la cible, ou non calée avant l'action annoncée (passée sans calage).
    const past = !pending && (x < aim - 1e-9 || (j < pj && !it.fixed))
    return x < 0 || x > 1 ? [] : [{ it, x, pending, past }]
  })
}

/** Secondes avant l'action annoncée d'après l'estimation (négatif : estimation dépassée) ; undefined sans estimation. */
export const countdownOf = (base: SeqItem[], pendingId: string | undefined, now: number) => {
  const v = base.find((x) => x.id === pendingId)?.v
  return v === undefined ? undefined : v - now
}

/** L'action annoncée est sur la cible : à ± PING s de son estimation, ou estimation dépassée (elle y reste figée). */
export const isPing = (countdown: number | undefined) => countdown !== undefined && countdown <= PING

/** « dans ~40 s », « dans ~3 min », « maintenant », « dépassée de ~12 s ». */
export function fmtCountdown(s: number): string {
  if (Math.abs(s) <= PING) return 'maintenant'
  const a = Math.abs(s)
  const txt = a < 60 ? `~${Math.round(a)} s` : `~${Math.round(a / 60)} min`
  return s > 0 ? `dans ${txt}` : `dépassée de ${txt}`
}
