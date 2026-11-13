import { alive, db, newId, save, TRIAL, type HBEvent, type Video } from './db'
import { parseSheet, toStored, type ParsedSheet } from './matchSheet'
import {
  findDuplicate,
  matchKeyOf,
  myIndexes,
  playerMatchesFrom,
  playerSheetRequest,
  seqDataFrom,
  sheetEventName,
  type Attachment,
  type PlayerMarks,
  type PlayerMatch,
  type PlayerSeqData,
  type ProposedBy,
  type SheetProvider,
  type SheetSource,
} from './playerMatches'
import { supabase } from './sync'

/*
 * « Mes matchs » de l'espace joueur : lecture et écritures (règles pures : src/playerMatches.ts).
 *  - Compte joueur avec le serveur : TOUT passe par les fonctions de supabase/053_matchs_joueur.sql (hb_player_matches,
 *    hb_player_import_sheet, hb_player_add_video, hb_player_set_marks) ; rien n'est écrit sur l'appareil (le jeune ne
 *    synchronise ni les événements ni les vidéos).
 *  - Sans serveur (mode essai / local) : même comportement, sur l'appareil (Dexie), pour essayer l'écran ; rattachements et
 *    repères du jeune gardés dans le stockage de l'appareil.
 *  - Aperçu d'un administrateur (avec le serveur) : lecture sur l'appareil, aucune écriture.
 * Aucune donnée n'est envoyée ailleurs qu'au serveur de l'appli (ni IA, ni service tiers) ; le PDF reste sur l'appareil.
 */

export type Result<T> = { ok: true; value: T } | { ok: false; error: string }

/** Contexte : fiche du jeune, et s'il passe par le serveur (compte joueur) ou par l'appareil (essai, aperçu). */
export interface MatchCtx {
  playerId: string
  server: boolean
  /** Aperçu du staff : lecture seule. */
  readOnly?: boolean
}

// ---------- Lecture du PDF (sur l'appareil) ----------

/** Feuille lue depuis un PDF choisi sur l'appareil (pdf.js chargé à ce moment-là ; rien n'est envoyé, le PDF n'est pas gardé). */
export function pdfSheetProvider(file: Blob, source: SheetSource = 'joueur'): SheetProvider {
  return {
    source,
    async read() {
      const { readPdfItems } = await import('./matchSheetPdf')
      const s = parseSheet(await readPdfItems(file))
      if (!s.actions.length && !s.roster.length) throw new Error('Ce PDF ne ressemble pas à une feuille de match (ni joueurs ni déroulé trouvés).')
      return s
    },
  }
}

// ---------- Rattachements et repères sur l'appareil (mode essai) ----------

const LOCAL_KEY = (pid: string, what: string) => `handbase${TRIAL ? '-essai' : ''}.moi.${what}.${pid}`
function readLocal<T>(pid: string, what: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(LOCAL_KEY(pid, what))
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}
function writeLocal(pid: string, what: string, v: unknown) {
  try {
    localStorage.setItem(LOCAL_KEY(pid, what), JSON.stringify(v))
  } catch {
    /* stockage indisponible : rien de gardé */
  }
}

const errOf = (e: { code?: string; message?: string } | null | undefined) =>
  e?.code === 'PGRST202' ? 'pas_ouvert' : (e?.message ?? '').trim() || 'reseau'

// ---------- Mes matchs ----------

export async function loadMatches(ctx: MatchCtx): Promise<Result<PlayerMatch[]>> {
  if (ctx.server && supabase) {
    if (!navigator.onLine) return { ok: false, error: 'hors_ligne' }
    const { data, error } = await supabase.rpc('hb_player_matches')
    if (error) return { ok: false, error: errOf(error) }
    return { ok: true, value: (data as PlayerMatch[] | null) ?? [] }
  }
  const [events, videos] = await Promise.all([db.events.toArray(), db.videos.toArray()])
  return {
    ok: true,
    value: playerMatchesFrom(alive(events), alive(videos), ctx.playerId, readLocal<Attachment[]>(ctx.playerId, 'matchs', [])),
  }
}

/** De quoi séquencer un de mes matchs : déroulé (mes actions marquées), mi-temps, calage du staff et le mien. */
export async function loadSeq(ctx: MatchCtx, eventId: string): Promise<Result<PlayerSeqData>> {
  if (ctx.server && supabase) {
    if (!navigator.onLine) return { ok: false, error: 'hors_ligne' }
    const { data, error } = await supabase.rpc('hb_player_match_seq', { p_event_id: eventId })
    if (error) return { ok: false, error: errOf(error) }
    return { ok: true, value: data as PlayerSeqData }
  }
  const ev = await db.events.get(eventId)
  const ms = ev && !ev.deleted ? ev.matchSheet : undefined
  if (!ms) return { ok: false, error: 'match_inconnu' }
  const att = readLocal<Attachment[]>(ctx.playerId, 'matchs', []).find((a) => a.eventId === eventId)
  const mine = myIndexes(ms.players, ctx.playerId, att?.side, att?.num)
  return { ok: true, value: seqDataFrom(ms, mine, readLocal<Record<string, PlayerMarks>>(ctx.playerId, 'reperes', {})[eventId]) }
}

export interface ImportResult {
  eventId: string
  created: boolean
  attached: boolean
  already: boolean
}

/** Envoie la feuille (le jeune est au rang `index`) : crée le match, ou le rattache au même match déjà dans l'appli. */
export async function importSheet(ctx: MatchCtx, s: ParsedSheet, index: number): Promise<Result<ImportResult>> {
  if (ctx.readOnly) return { ok: false, error: 'Aperçu : rien n’est enregistré.' }
  if (ctx.server && supabase) {
    if (!navigator.onLine) return { ok: false, error: 'hors_ligne' }
    const { data, error } = await supabase.rpc('hb_player_import_sheet', playerSheetRequest(s, index))
    if (error) return { ok: false, error: errOf(error) }
    const r = data as { event_id: string; created: boolean; attached: boolean; already: boolean }
    return { ok: true, value: { eventId: r.event_id, created: r.created, attached: r.attached, already: r.already } }
  }
  // Mode essai : même chose sur l'appareil.
  if (!s.date) return { ok: false, error: 'date_invalide' }
  const events = alive(await db.events.toArray())
  const dup = findDuplicate(
    events.map((e) => ({ ...e, proposedBy: (e as { proposedBy?: unknown }).proposedBy })),
    matchKeyOf(s),
  )
  const r = s.roster[index]
  if (dup) {
    const attached = readLocal<Attachment[]>(ctx.playerId, 'matchs', [])
    const already = !!dup.matchSheet?.players.some((x) => x.playerId === ctx.playerId) || attached.some((a) => a.eventId === dup.id)
    if (!already) writeLocal(ctx.playerId, 'matchs', [...attached, { eventId: dup.id, side: r.side, num: r.num }])
    return { ok: true, value: { eventId: dup.id, created: false, attached: !already, already } }
  }
  const links = s.roster.map((_, i) => (i === index ? ctx.playerId : undefined))
  const { sync: _drop, ...stored } = toStored(s, links)
  const ev = await save<HBEvent & { proposedBy: ProposedBy }>('events', {
    id: newId(),
    name: sheetEventName(s),
    type: 'match',
    date: s.date,
    time: s.time,
    place: s.place,
    playerIds: [ctx.playerId],
    editors: [],
    matchSheet: { ...stored, source: 'joueur', homeClub: s.homeClub, awayClub: s.awayClub } as HBEvent['matchSheet'],
    proposedBy: { kind: 'joueur', playerId: ctx.playerId, at: new Date().toISOString() },
  })
  return { ok: true, value: { eventId: ev.id, created: true, attached: false, already: false } }
}

/** Ajoute le lien vidéo d'un de mes matchs ; s'il y en a déjà un, on le rend (created false). */
export async function addVideo(ctx: MatchCtx, eventId: string, url: string, title?: string): Promise<Result<{ videoId: string; created: boolean }>> {
  if (ctx.readOnly) return { ok: false, error: 'Aperçu : rien n’est enregistré.' }
  if (ctx.server && supabase) {
    if (!navigator.onLine) return { ok: false, error: 'hors_ligne' }
    const { data, error } = await supabase.rpc('hb_player_add_video', { p_event_id: eventId, p_url: url, p_title: title ?? null })
    if (error) return { ok: false, error: errOf(error) }
    const r = data as { video_id: string; created: boolean }
    return { ok: true, value: { videoId: r.video_id, created: r.created } }
  }
  const existing = alive(await db.videos.where('targetId').equals(eventId).toArray()).find((v) => v.targetKind === 'event')
  if (existing) return { ok: true, value: { videoId: existing.id, created: false } }
  const v = await save<Video & { proposedBy: ProposedBy }>('videos', {
    id: newId(),
    targetKind: 'event',
    targetId: eventId,
    url,
    ...(title?.trim() ? { title: title.trim().slice(0, 200) } : {}),
    proposedBy: { kind: 'joueur', playerId: ctx.playerId, at: new Date().toISOString() },
  })
  return { ok: true, value: { videoId: v.id, created: true } }
}

/** Enregistre mes repères (bornes et actions calées) sur la vidéo d'un de mes matchs ; ceux du staff priment toujours. */
export async function saveMarks(ctx: MatchCtx, eventId: string, marks: PlayerMarks): Promise<Result<PlayerMarks>> {
  if (ctx.readOnly) return { ok: false, error: 'Aperçu : rien n’est enregistré.' }
  if (ctx.server && supabase) {
    if (!navigator.onLine) return { ok: false, error: 'hors_ligne' }
    const { data, error } = await supabase.rpc('hb_player_set_marks', { p_event_id: eventId, p_video_id: marks.videoId, p_marks: marks.marks, p_fix: marks.fix })
    if (error) return { ok: false, error: errOf(error) }
    return { ok: true, value: data as PlayerMarks }
  }
  const all = readLocal<Record<string, PlayerMarks>>(ctx.playerId, 'reperes', {})
  writeLocal(ctx.playerId, 'reperes', { ...all, [eventId]: marks })
  return { ok: true, value: marks }
}

// ---------- Côté staff : reprendre ou retirer une proposition ----------

/** « Reprendre à mon compte » (adopt) ou retirer (remove) un événement ou un lien vidéo proposé par un jeune. */
export async function decideProposal(table: 'events' | 'videos', id: string, action: 'adopt' | 'remove'): Promise<Result<true>> {
  if (supabase) {
    if (!navigator.onLine) return { ok: false, error: 'hors_ligne' }
    const { error } = await supabase.rpc('hb_player_proposal', { p_table: table, p_id: id, p_action: action })
    if (error) return { ok: false, error: errOf(error) }
    return { ok: true, value: true }
  }
  // Mode essai : sur l'appareil.
  const row = (await db.table(table).get(id)) as (HBEvent | Video) | undefined
  if (!row) return { ok: false, error: 'introuvable' }
  const { proposedBy: _p, ...rest } = row as typeof row & { proposedBy?: unknown }
  await save(table, action === 'adopt' ? rest : { ...row, deleted: true })
  return { ok: true, value: true }
}

/** Repères proposés par les jeunes sur un match (staff : hb_event_player_marks). */
export interface ProposedMarks {
  playerId: string
  name?: string
  videoId: string
  marks: Record<string, number>
  fix: Record<string, number>
  updatedAt?: string
}

export async function loadProposedMarks(eventId: string): Promise<Result<ProposedMarks[]>> {
  if (!supabase) return { ok: true, value: [] }
  if (!navigator.onLine) return { ok: false, error: 'hors_ligne' }
  const { data, error } = await supabase.rpc('hb_event_player_marks', { p_event_id: eventId })
  if (error) return { ok: false, error: errOf(error) }
  return { ok: true, value: (data as ProposedMarks[] | null) ?? [] }
}
