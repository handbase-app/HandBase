import { TRIAL } from './db'
import {
  cleanMoods,
  journalAdd,
  journalDelete,
  journalEdit,
  journalErrorText,
  journalShare,
  moodFields,
  moodTrend,
  sortNotes,
  withNote,
  type JournalMood,
  type JournalNote,
  type MoodTrend,
} from './playerSpace'
import { supabase } from './sync'

/*
 * « Mon journal du hand » (supabase/052_journal_joueur.sql) : accès aux notes, sans React.
 *  - Avec le serveur : table hb_player_journal, lue À LA DEMANDE et en ligne (pas de synchronisation hors ligne) ; le jeune lit
 *    toutes ses notes, le staff seulement les notes partagées (règles du serveur) ; écritures par les fonctions du joueur
 *    (hb_player_journal_add / _edit / _share / _delete) ; tendance des humeurs pour le staff (hb_player_mood_trend : des
 *    nombres, jamais de texte). Humeurs : jusqu'à 3 par note (076 : p_moods, `moods`) ; avant 076, une seule (p_mood, `mood`).
 *  - Sans serveur (mode essai / local) : sur l'appareil (stockage du navigateur), mêmes règles (src/playerSpace.ts).
 * Rien de ce qui est écrit ici ne part vers une IA.
 */

type Res<T> = { ok: true; value: T } | { ok: false; error: string }

const LOCAL_KEY = (playerId: string) => `handbase${TRIAL ? '-essai' : ''}.journal.${playerId}`

/** Sur l'appareil : pas de serveur, ou fiche de démonstration (« demo-… », jamais envoyée ; comme le wellness). */
export const isLocalJournal = (playerId: string) => !supabase || playerId.startsWith('demo-')

export function readLocal(playerId: string): JournalNote[] {
  try {
    const raw = localStorage.getItem(LOCAL_KEY(playerId))
    const v = raw ? (JSON.parse(raw) as unknown) : []
    return Array.isArray(v) ? sortNotes(v as JournalNote[]) : []
  } catch {
    return []
  }
}
export function writeLocal(playerId: string, notes: JournalNote[]) {
  try {
    if (notes.length) localStorage.setItem(LOCAL_KEY(playerId), JSON.stringify(notes))
    else localStorage.removeItem(LOCAL_KEY(playerId))
  } catch {
    /* stockage indisponible : le journal d'essai ne survit pas au rechargement */
  }
}

interface Row {
  id: string
  at: string
  text: string
  mood: string | null
  /** Humeurs (076) : absentes avant le script. */
  moods?: string[] | null
  shared: boolean
  edited_at: string | null
  /** Cahiers (074) : absents avant le script. */
  kind?: string | null
  jour?: string | null
  parts?: Record<string, string | number> | null
}
export const fromRow = (r: Row): JournalNote => ({
  id: r.id,
  at: new Date(r.at).toISOString(),
  text: r.text,
  ...moodFields(cleanMoods(r.moods?.length ? r.moods : r.mood)),
  shared: !!r.shared,
  ...(r.edited_at ? { editedAt: new Date(r.edited_at).toISOString() } : {}),
  ...(r.kind === 'cahier' || r.kind === 'match' ? { kind: r.kind, ...(r.jour ? { day: r.jour } : {}), ...(r.parts ? { parts: r.parts } : {}) } : {}),
})
/** Note renvoyée par une fonction du journal : humeurs remises en forme (`moods` de 076, sinon `mood` seule). */
const fromRpc = (v: unknown): JournalNote => {
  const n: JournalNote = { ...(v as JournalNote) }
  const ms = cleanMoods(n.moods?.length ? n.moods : n.mood)
  delete n.mood
  delete n.moods
  return { ...n, ...moodFields(ms) }
}

/**
 * Appel d'une fonction du journal avec la liste des humeurs (076 : p_moods) et la première (p_mood, que les serveurs d'avant
 * 076 connaissent). Serveur d'avant 076 (fonction à p_moods inconnue : PGRST202) : de nouveau, avec p_mood seul (une humeur
 * gardée, comme avant).
 */
async function rpcWithMoods(fn: string, args: Record<string, unknown>, moods: readonly JournalMood[]) {
  const r = await supabase!.rpc(fn, { ...args, p_mood: moods[0] ?? null, p_moods: [...moods] })
  if (r.error?.code !== 'PGRST202') return r
  return supabase!.rpc(fn, { ...args, p_mood: moods[0] ?? null })
}

const offline = (): Res<never> => ({ ok: false, error: 'Il faut être en ligne pour ton journal : il n’est pas gardé sur l’appareil.' })
const fail = (e: { message?: string; code?: string }): Res<never> => ({ ok: false, error: journalErrorText(e.message, e.code) })

/** Notes d'une fiche, la plus récente en premier. `onlyShared` : celles que le jeune a partagées (ce que le staff lit). */
export async function fetchNotes(playerId: string, onlyShared = false): Promise<Res<JournalNote[]>> {
  if (isLocalJournal(playerId)) {
    const all = readLocal(playerId)
    return { ok: true, value: onlyShared ? all.filter((n) => n.shared) : all }
  }
  if (!navigator.onLine) return offline()
  // « * » : les colonnes des cahiers (074) quand elles existent, sans casser la lecture avant le script. 200 notes simples
  // au plus, plus les cahiers (un par jour et par sorte) : 600.
  let q = supabase!.from('hb_player_journal').select('*').eq('player_id', playerId).eq('deleted', false)
  if (onlyShared) q = q.eq('shared', true)
  const { data, error } = await q.order('at', { ascending: false }).limit(600)
  if (error) return fail(error)
  return { ok: true, value: (data as Row[]).map(fromRow) }
}

/** Nouvelle note (privée), avec 0 à 3 humeurs. Renvoie la liste à afficher. */
export async function addNote(playerId: string, notes: JournalNote[], text: string, moods: readonly JournalMood[] = []): Promise<Res<JournalNote[]>> {
  const ms = cleanMoods(moods)
  if (isLocalJournal(playerId)) {
    const r = journalAdd(notes, text, ms, new Date().toISOString())
    if (!r.ok) return { ok: false, error: journalErrorText(r.error) }
    writeLocal(playerId, r.notes)
    return { ok: true, value: r.notes }
  }
  if (!navigator.onLine) return offline()
  const { data, error } = await rpcWithMoods('hb_player_journal_add', { p_text: text }, ms)
  if (error) return fail(error)
  return { ok: true, value: withNote(notes, fromRpc(data)) }
}

/** Correction d'une note (texte, humeurs). */
export async function editNote(playerId: string, notes: JournalNote[], id: string, text: string, moods: readonly JournalMood[] = []): Promise<Res<JournalNote[]>> {
  const ms = cleanMoods(moods)
  if (isLocalJournal(playerId)) {
    const r = journalEdit(notes, id, text, ms, new Date().toISOString())
    if (!r.ok) return { ok: false, error: journalErrorText(r.error) }
    writeLocal(playerId, r.notes)
    return { ok: true, value: r.notes }
  }
  if (!navigator.onLine) return offline()
  const { data, error } = await rpcWithMoods('hb_player_journal_edit', { p_id: id, p_text: text }, ms)
  if (error) return fail(error)
  return { ok: true, value: withNote(notes, fromRpc(data)) }
}

/** Partager avec son encadrant (ou reprendre). */
export async function shareNote(playerId: string, notes: JournalNote[], id: string, shared: boolean): Promise<Res<JournalNote[]>> {
  if (isLocalJournal(playerId)) {
    const r = journalShare(notes, id, shared)
    if (!r.ok) return { ok: false, error: journalErrorText(r.error) }
    writeLocal(playerId, r.notes)
    return { ok: true, value: r.notes }
  }
  if (!navigator.onLine) return offline()
  const { data, error } = await supabase!.rpc('hb_player_journal_share', { p_id: id, p_shared: shared })
  if (error) return fail(error)
  return { ok: true, value: withNote(notes, fromRpc(data)) }
}

/** Suppression d'une note (son texte est effacé tout de suite sur le serveur). */
export async function deleteNote(playerId: string, notes: JournalNote[], id: string): Promise<Res<JournalNote[]>> {
  const next = journalDelete(notes, id)
  if (isLocalJournal(playerId)) {
    writeLocal(playerId, next)
    return { ok: true, value: next }
  }
  if (!navigator.onLine) return offline()
  const { error } = await supabase!.rpc('hb_player_journal_delete', { p_id: id })
  if (error) return fail(error)
  return { ok: true, value: next }
}

/** Tendance des humeurs (staff) : 8 semaines, des nombres seulement. null : rien à montrer (script pas passé, droits…). */
export async function fetchTrend(playerId: string): Promise<MoodTrend | null> {
  if (isLocalJournal(playerId)) return moodTrend(readLocal(playerId))
  if (!navigator.onLine) return null
  const { data, error } = await supabase!.rpc('hb_player_mood_trend', { p_player_id: playerId })
  if (error || !data) return null
  return data as MoodTrend
}
