import { simultaneous, timeline, timelineOf, type ActionKind, type MatchSheet, type Timeline } from './matchSheet'

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
 * après le dernier : pente 1, plus 60 s par temps mort d'équipe (mapTime) : le moment LE PLUS TÔT possible, car le chrono du
 * hand ne va jamais plus vite que la vidéo, il ne peut que s'arrêter ; l'action arrive sur la cible juste avant ou pile au
 * moment où elle se produit, jamais après, puis attend s'il y a eu un arrêt (faute, blessé, 7 m…). Période sans repère :
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
 * File vue au temps courant now, avec l'action annoncée pendingId : c'est la fonction qu'utilise l'écran (Sequencer.tsx),
 * une seule règle pour l'action annoncée et toutes les autres.
 *
 * L'action annoncée est au plus tôt maintenant : son temps estimé est max(estimation, now). Estimation dépassée (la vidéo
 * continue, on attend qu'elle arrive), elle devient une ancre provisoire au temps courant, exactement comme si on venait
 * d'appuyer sur « C'est ici », et toute la file est recalculée avec elle (matchSheet.ts timeline) : elle reste sur la cible
 * et les actions suivantes non calées, estimées à partir d'elle (pente 1 et temps morts), s'arrêtent avec elle en gardant
 * leur écart de temps de jeu. Les actions calées gardent leur vraie position ; les non calées situées après une calée se
 * basent sur elle (interpolation entre l'ancre provisoire et la calée, puis pente 1 après la calée). Vaut aussi pour une
 * action annoncée déjà calée (choisie sur la frise pour la recaler, ou la dernière de la feuille) : son ancre provisoire
 * remplace son calage tant qu'elle est dépassée. Avant l'estimation (on recule), rien ne change. late : secondes de
 * dépassement de l'estimation (0 sinon).
 */
export function liveQueue(
  ms: Pick<MatchSheet, 'actions' | 'halfMin' | 'sync'>,
  base: SeqItem[],
  pendingId: string | undefined,
  now: number,
): { queue: SeqItem[]; late: number } {
  const p = base.find((x) => x.id === pendingId)
  if (!p || p.v === undefined || p.v >= now) return { queue: base, late: 0 }
  const keys = timelineOf(ms).keys
  const fix = { ...ms.sync?.fix }
  for (const j of p.is) fix[keys[j]] = now
  const tl = timeline({ ...ms, sync: { marks: {}, ...ms.sync, fix } })
  // Mêmes éléments, mêmes états (calée ou non) : seul le temps vidéo est recalculé avec l'ancre provisoire.
  const queue = base.map((x) => {
    const v = x.id === p.id ? now : tl.at(x.i)
    return v === x.v ? x : { ...x, v }
  })
  return { queue, late: now - p.v }
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
 * temps courant (liveQueue : l'action annoncée ne dépasse jamais la cible, sans autre règle ici). Seules les actions
 * visibles (0 ≤ x ≤ 1) sont rendues.
 */
export function seqView(queue: SeqItem[], pendingId: string | undefined, now: number, ahead = 60, aim = 1 / 3): SeqMark[] {
  const scale = (1 - aim) / ahead
  const pj = queue.findIndex((x) => x.id === pendingId)
  return queue.flatMap((it, j) => {
    if (it.v === undefined) return []
    const pending = j === pj
    const x = aim + (it.v - now) * scale
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

/**
 * Compte à rebours : l'estimation est le moment le plus tôt possible, d'où « au plus tôt dans ~40 s » (court, téléphone :
 * « ≥ 40 s »), « maintenant » sur la cible, puis « attendue depuis ~12 s » (court : « +12 s ») quand le jeu a été arrêté.
 */
export function fmtCountdown(s: number, short = false): string {
  if (Math.abs(s) <= PING) return 'maintenant'
  const a = Math.abs(s)
  const txt = a < 60 ? `${Math.round(a)} s` : `${Math.round(a / 60)} min`
  if (short) return s > 0 ? `≥ ${txt}` : `+${txt}`
  return s > 0 ? `au plus tôt dans ~${txt}` : `attendue depuis ~${txt}`
}

/** Jet de 7 m (but, tir ou arrêt) : le chrono s'arrête souvent avant (faute, joueur au sol, soigneurs), durée inconnue. */
const SEVEN: ActionKind[] = ['but7', 'tir7', 'arret7']
export const isPenalty = (ms: Pick<MatchSheet, 'actions'>, it: SeqItem | undefined) => !!it && it.is.some((j) => SEVEN.includes(ms.actions[j].k))
