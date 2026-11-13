import { db, newId, save, saveMany, type HBEvent, type Video } from './db'
import { isGenerated, planPlayerMoments, timeline, videoTitle, type MatchSheet, type MatchSync } from './matchSheet'
import { can } from './roles'
import { momentsOf, withMoments } from './videos'

/*
 * Calage d'une feuille de match sur la vidéo : écritures, sans interface (aucun React ici, pour pouvoir changer d'écran de
 * calage sans toucher à la logique). Le calcul lui-même (repères, interpolation, saisies en retard réparties, moment ↔
 * action) est dans matchSheet.ts ; ici : poser / retirer un repère, annuler, et recaler les moments générés sur les fiches
 * de tous les joueurs du match après chaque calage.
 */

// ---------- Écritures du calage ----------

/** Modifie le calage de la feuille (relue au moment d'écrire). */
export async function updateSync(eventId: string, fn: (s: MatchSync, ms: MatchSheet) => MatchSync) {
  const ev = await db.events.get(eventId)
  if (!ev?.matchSheet) return
  const ms = ev.matchSheet
  await save<HBEvent>('events', { ...ev, matchSheet: { ...ms, sync: fn({ marks: {}, ...ms.sync }, ms) } })
}

// ---------- Calage à l'œil : « C'est ici », annulation, recalage de tous les moments ----------

/**
 * Un repère de période (marks : s1, e1…), une action calée (fix : clé actionKeys) ou une action ignorée au séquençage
 * (skip : clé actionKeys, v = 1) ; v absent = retiré.
 */
export type SyncChange = { kind: 'mark' | 'fix' | 'skip'; key: string; v?: number }
/**
 * Un calage annulable : toutes ses écritures (un groupe d'actions simultanées se cale d'un coup), avec la valeur d'avant ;
 * ctx : ce que l'écran veut retrouver en annulant (le repère choisi à ce moment-là).
 */
export type UndoEntry = { eventId: string; changes: { kind: SyncChange['kind']; key: string; prev?: number }[]; label: string; ctx?: string }

/**
 * Calages annulables de la session (tous écrans confondus : un « C'est ici » posé depuis la fiche d'un joueur s'annule aussi
 * depuis l'événement). Gardés en mémoire seulement : après un rechargement, on retire le repère à la main.
 */
const undoStack: UndoEntry[] = []
const undoListeners = new Set<() => void>()
const undoChanged = () => undoListeners.forEach((l) => l())

/** Prévenu à chaque changement de la pile d'annulation ; rend de quoi se désabonner. */
export function onUndoChange(l: () => void) {
  undoListeners.add(l)
  return () => {
    undoListeners.delete(l)
  }
}

/** Dernier calage annulable de cet événement. */
export const lastUndo = (eventId: string) => undoStack.filter((e) => e.eventId === eventId).at(-1)

/** Oublie les calages annulables d'un événement (feuille recalée sur une autre vidéo). */
export function forgetUndo(eventId: string) {
  const keep = undoStack.filter((e) => e.eventId !== eventId)
  undoStack.splice(0, undoStack.length, ...keep)
  undoChanged()
}

const sameMoments = (a: { at: number; dur?: number; note?: string }[], b: { at: number; dur?: number; note?: string }[]) =>
  a.length === b.length && a.every((m, i) => m.at === b[i].at && (m.dur ?? 0) === (b[i].dur ?? 0) && (m.note ?? '') === (b[i].note ?? ''))

export interface GenerateResult {
  created: number
  updated: number
  moments: number
  unplaced: number
  dropped: number
  foreign: number
}

/**
 * Moments sur les fiches : pour chaque joueur relié, un lien vidéo (même adresse que la vidéo du match) avec un moment
 * par but (et, en option, par arrêt et par tir). Relancer met à jour les moments générés (note « … · feuille ») et garde
 * ceux ajoutés à la main. Un lien du même match ajouté par un autre compte n'est pas modifié (seul son auteur le peut,
 * règle du serveur 036 : vrai aussi pour un administrateur). Lancé aussi après chaque calage (refreshMoments).
 */
export async function generateMoments(eventId: string): Promise<GenerateResult> {
  const ev = await db.events.get(eventId)
  const ms = ev?.matchSheet
  const url = ms?.sync?.url
  const res: GenerateResult = { created: 0, updated: 0, moments: 0, unplaced: 0, dropped: 0, foreign: 0 }
  if (!ev || !ms || !url) return res
  const tl = timeline(ms)
  const title = videoTitle(ms, ev.date)
  const rows: Video[] = []
  const done = new Set<string>()
  for (const [pl, sp] of ms.players.entries()) {
    if (!sp.playerId) continue
    // Fiche fondue dans une autre depuis l'import : on suit la fusion.
    let p = await db.players.get(sp.playerId)
    for (let n = 0; p?.mergedInto && n < 5; n++) p = await db.players.get(p.mergedInto)
    if (!p || p.deleted || done.has(p.id)) continue
    done.add(p.id)
    const vids = (await db.videos.where('targetId').equals(p.id).toArray()).filter((v) => !v.deleted && v.targetKind === 'player' && v.url === url)
    const mine = vids.find((v) => can.editVideo(v) && (v.title === title || momentsOf(v).some(isGenerated))) ?? vids.find((v) => can.editVideo(v))
    const plan = planPlayerMoments(ms, pl, mine ? momentsOf(mine) : [], tl)
    res.unplaced += plan.unplaced
    res.dropped += plan.dropped
    if (!mine) {
      if (!plan.generated) continue
      if (vids.some((v) => momentsOf(v).some(isGenerated))) {
        res.foreign++
        continue
      }
      rows.push({ id: newId(), targetKind: 'player', targetId: p.id, url, title, ...withMoments(plan.moments), updatedAt: 0 })
      res.created++
    } else {
      const next = withMoments(plan.moments)
      if (sameMoments(momentsOf(mine), next.moments ?? [])) {
        res.moments += plan.generated
        continue
      }
      rows.push({ ...mine, ...next })
      res.updated++
    }
    res.moments += plan.generated
  }
  await saveMany<Video>('videos', rows)
  return res
}

/**
 * Recalage des moments générés de tous les joueurs du match (generateMoments), à la file : deux calages rapprochés ne lancent
 * pas deux générations en même temps (elles pourraient créer deux fois le même lien), et un recalage pas encore commencé
 * sert à tous les calages faits en attendant.
 */
const queued = new Map<string, Promise<GenerateResult>>()
let chain: Promise<unknown> = Promise.resolve()
export function refreshMoments(eventId: string): Promise<GenerateResult> {
  const q = queued.get(eventId)
  if (q) return q
  const run = chain.then(() => {
    queued.delete(eventId)
    return generateMoments(eventId)
  })
  queued.set(eventId, run)
  chain = run.catch(() => {})
  return run
}

/**
 * Pose ou retire un ou plusieurs repères (un groupe d'actions simultanées se cale d'un coup, au même temps vidéo), puis
 * recale aussitôt les moments de tous les joueurs du match.
 * video : vidéo de l'événement sur laquelle on cale (première écriture) ; absente depuis la fiche d'un joueur (même adresse).
 * label : affiché pour « Annuler » ; sans label, pas d'annulation (c'est déjà une annulation).
 */
export async function applyCalibration(
  eventId: string,
  ch: SyncChange | SyncChange[],
  label?: string,
  video?: Pick<Video, 'id' | 'url'>,
  ctx?: string,
) {
  const list = Array.isArray(ch) ? ch : [ch]
  const prev: UndoEntry['changes'] = []
  await updateSync(eventId, (s) => {
    const marks = { ...s.marks }
    const fix = { ...s.fix }
    const skip = { ...s.skip }
    for (const c of list) {
      const obj = c.kind === 'mark' ? marks : c.kind === 'skip' ? skip : fix
      prev.push({ kind: c.kind, key: c.key, prev: obj[c.key] })
      if (c.v === undefined) delete obj[c.key]
      else obj[c.key] = c.v
    }
    return { ...s, ...(video && { videoId: video.id, url: video.url }), marks, fix, ...((s.skip || Object.keys(skip).length) && { skip }) }
  })
  if (label) {
    undoStack.push({ eventId, changes: prev, label, ctx })
    if (undoStack.length > 50) undoStack.shift()
    undoChanged()
  }
  return refreshMoments(eventId)
}

/** Annule le dernier calage de cet événement (les valeurs d'avant reviennent, ou les repères disparaissent) ; rend ce calage. */
export async function undoLast(eventId: string): Promise<UndoEntry | undefined> {
  const i = undoStack.map((e) => e.eventId).lastIndexOf(eventId)
  if (i < 0) return undefined
  const [e] = undoStack.splice(i, 1)
  undoChanged()
  await applyCalibration(
    eventId,
    e.changes.map((c) => ({ kind: c.kind, key: c.key, v: c.prev })),
  )
  return e
}

