import { cahierText, cleanParts, isEmptyParts, partsCount, type CahierKind, type CahierParts, type MatchParts } from './cahiers'
import { db, newId, today, TRIAL } from './db'
import { cleanCoach, cleanLampSettings, cleanWishes, coachLowered, dayFlags, LAMP_KEY, type LampSettings } from './lamp'
import { fromRow, isLocalJournal, readLocal as readLocalNotes, writeLocal as writeLocalNotes } from './playerJournal'
import { sortNotes, type JournalNote } from './playerSpace'
import { supabase } from './sync'
import { fetchMyWellness, isLocalWellness, seedDemoWellness } from './wellnessApi'
import type { DemoLamp } from './demoLamp'

/*
 * Lampe d'Aladin, cahiers et vœux (supabase/074_lampe.sql, src/lamp.ts, src/cahiers.ts) : accès aux données, sans React.
 *  - Avec le serveur : lu À LA DEMANDE et en ligne (jamais synchronisé ni gardé sur l'appareil du staff). Le jeune passe par
 *    hb_lampe_moi / hb_lampe_voeux / hb_cahier_enregistrer ; ses cahiers se lisent dans son journal (hb_player_journal, 052) ;
 *    le staff par hb_lampe_groupe (masques par jour, points, vœux : jamais un texte) et hb_lampe_coach. Script pas passé
 *    (fonction absente) : `missing`, la section se tait.
 *  - Sans serveur (mode essai / local) et pour les fiches de démonstration (« demo-… ») : sur l'appareil (wellness et journal
 *    de l'essai, plus une clé « lampe » par fiche pour les points et les vœux), mêmes règles.
 * Rien ne part vers une IA.
 */

export type Res<T> = { ok: true; value: T } | { ok: false; error: string; missing?: boolean }

export const LAMP_ERRORS: Record<string, string> = {
  lampe_fermee: 'La lampe n’est pas encore ouverte sur cette installation.',
  pas_demande: 'La lampe n’est pas demandée dans ton groupe.',
  jour_ferme: 'Ce jour-là ne se modifie plus.',
  sorte: 'Cahier inconnu.',
  trop_long: 'Trop long.',
  baisse: 'Les points des encadrants s’ajoutent seulement : un point donné ne se retire pas (un administrateur peut corriger une erreur).',
  joueur_inconnu: 'Joueur introuvable, ou tu n’es pas de son encadrement.',
  groupe_inconnu: 'Groupe introuvable, ou tu n’en es pas l’encadrant.',
  pas_joueur: 'Réservé au compte du jeune.',
  sans_fiche: 'Ton compte n’est pas encore relié à ta fiche.',
}
const missingCode = (code?: string) => code === 'PGRST202' || code === 'PGRST205' || code === '42P01' || code === '42883' || code === '42703'
export function lampErrorText(message?: string | null, code?: string): string {
  if (missingCode(code)) return 'La lampe n’est pas encore en place sur ce serveur.'
  const k = (message ?? '').trim()
  return LAMP_ERRORS[k] ?? (k ? `Impossible : ${k}` : 'Impossible (connexion internet ?).')
}
const fail = (e: { message?: string; code?: string }): Res<never> => ({ ok: false, error: lampErrorText(e.message, e.code), ...(missingCode(e.code) ? { missing: true } : {}) })
const offline = (): Res<never> => ({ ok: false, error: 'Il faut être en ligne pour ça : ce n’est pas gardé sur l’appareil.' })

// ---------- Sur l'appareil ----------

const LAMP_PREFIX = `handbase${TRIAL ? '-essai' : ''}.lampe.`
interface LocalLamp {
  coach: Record<string, number>
  wishes: string[]
}
function readLocal(playerId: string): LocalLamp {
  try {
    const v = JSON.parse(localStorage.getItem(LAMP_PREFIX + playerId) ?? '{}') as Partial<LocalLamp>
    return { coach: v.coach && typeof v.coach === 'object' ? v.coach : {}, wishes: Array.isArray(v.wishes) ? v.wishes.filter((x): x is string => typeof x === 'string') : [] }
  } catch {
    return { coach: {}, wishes: [] }
  }
}
function writeLocal(playerId: string, d: LocalLamp) {
  try {
    if (Object.keys(d.coach).length || d.wishes.length) localStorage.setItem(LAMP_PREFIX + playerId, JSON.stringify(d))
    else localStorage.removeItem(LAMP_PREFIX + playerId)
  } catch {
    /* stockage indisponible : l'essai ne survit pas au rechargement */
  }
}

/** Réglage « lampe » de l'installation, copie de l'appareil (staff ; mode essai ou sans serveur : ouverte). */
export async function localLampSettings(): Promise<LampSettings> {
  const row = await db.config.get(LAMP_KEY)
  return cleanLampSettings(row && !row.deleted ? row.value : undefined, { trial: TRIAL || !supabase })
}

/** Masques par jour d'après le wellness, les séances et les cahiers de l'appareil. */
async function localDays(playerId: string, settings: LampSettings): Promise<Map<string, number>> {
  const wl = await fetchMyWellness(playerId, 400)
  const notes = readLocalNotes(playerId)
  const ok = (k: CahierKind) => notes.filter((n) => n.kind === k && n.day && partsCount(k, n.parts ?? {}, settings.rules.cahierMinFields)).map((n) => n.day!)
  return dayFlags({
    wellness: wl.ok ? wl.value.entries.map((e) => e.day) : [],
    seance: wl.ok ? wl.value.sessions.map((s) => s.day) : [],
    cahier: ok('cahier'),
    match: ok('match'),
  })
}

// ---------- Le jeune ----------

export interface MyLamp {
  /** Ouverte sur l'installation. */
  enabled: boolean
  /** Demandée à ce jeune (groupe du wellness). */
  requested: boolean
  settings: LampSettings
  /** Aujourd'hui pour le serveur (jour de Paris). */
  today: string
  days: Map<string, number>
  coach: Record<string, number>
  wishes: string[]
}

const toMap = (o: unknown) => {
  const m = new Map<string, number>()
  if (o && typeof o === 'object') for (const [k, v] of Object.entries(o as Record<string, unknown>)) if (typeof v === 'number') m.set(k, v)
  return m
}

export async function fetchMyLamp(playerId: string): Promise<Res<MyLamp>> {
  if (isLocalWellness(playerId)) {
    const settings = await localLampSettings()
    const wl = await fetchMyWellness(playerId, 1)
    const l = readLocal(playerId)
    return {
      ok: true,
      value: {
        enabled: settings.actif && (!wl.ok || wl.value.enabled),
        requested: wl.ok && wl.value.requested,
        settings,
        today: today(),
        days: await localDays(playerId, settings),
        coach: cleanCoach(l.coach, settings.criteria, settings.rules.coachPointsMax),
        wishes: cleanWishes(l.wishes, settings.catalogue),
      },
    }
  }
  if (!navigator.onLine) return offline()
  const { data, error } = await supabase!.rpc('hb_lampe_moi')
  if (error) return fail(error)
  const r = (data ?? {}) as Record<string, unknown>
  const settings = cleanLampSettings({ ...((r.reglage as object) ?? {}), actif: r.actif === true })
  return {
    ok: true,
    value: {
      enabled: r.actif === true,
      requested: r.demande === true,
      settings,
      today: typeof r.aujourdhui === 'string' ? r.aujourdhui : today(),
      days: toMap(r.jours),
      coach: cleanCoach(r.coach, settings.criteria, settings.rules.coachPointsMax),
      wishes: cleanWishes(r.voeux, settings.catalogue),
    },
  }
}

/** Ses cahiers des `days` derniers jours (le plus récent en premier). */
export async function fetchMyCahiers(playerId: string, days = 60): Promise<Res<JournalNote[]>> {
  const from = new Date(Date.now() - days * 86400000).toLocaleDateString('sv')
  if (isLocalJournal(playerId)) return { ok: true, value: readLocalNotes(playerId).filter((n) => n.kind && (n.day ?? '') >= from) }
  if (!navigator.onLine) return offline()
  const { data, error } = await supabase!
    .from('hb_player_journal')
    .select('*')
    .eq('player_id', playerId)
    .eq('deleted', false)
    .not('kind', 'is', null)
    .gte('jour', from)
    .order('jour', { ascending: false })
    .limit(200)
  if (error) return fail(error)
  return { ok: true, value: (data as Parameters<typeof fromRow>[0][]).map(fromRow) }
}

/** Écrit le cahier d'un jour (réécrit s'il existe ; tout vide : retiré, null). */
export async function saveCahier(playerId: string, kind: CahierKind, day: string, parts: CahierParts | MatchParts): Promise<Res<JournalNote | null>> {
  if (isLocalJournal(playerId)) {
    const clean = cleanParts(kind, parts)
    const notes = readLocalNotes(playerId)
    const old = notes.find((n) => n.kind === kind && n.day === day)
    const rest = notes.filter((n) => n !== old)
    if (isEmptyParts(clean)) {
      writeLocalNotes(playerId, rest)
      return { ok: true, value: null }
    }
    const now = new Date().toISOString()
    const note: JournalNote = {
      id: old?.id ?? newId(),
      at: old?.at ?? now,
      text: cahierText(kind, clean),
      shared: !!old?.shared,
      ...(old ? { editedAt: now } : {}),
      kind,
      day,
      parts: clean as Record<string, string | number>,
    }
    writeLocalNotes(playerId, sortNotes([note, ...rest]))
    return { ok: true, value: note }
  }
  if (!navigator.onLine) return offline()
  const { data, error } = await supabase!.rpc('hb_cahier_enregistrer', { p_kind: kind, p_jour: day, p_parts: parts })
  if (error) return fail(error)
  return { ok: true, value: (data as JournalNote | null) ?? null }
}

/** Ses vœux (3 au plus, dans l'ordre). */
export async function saveMyWishes(playerId: string, ids: string[], settings: LampSettings): Promise<Res<string[]>> {
  if (isLocalWellness(playerId)) {
    const l = readLocal(playerId)
    const wishes = cleanWishes(ids, settings.catalogue)
    writeLocal(playerId, { ...l, wishes })
    return { ok: true, value: wishes }
  }
  if (!navigator.onLine) return offline()
  const { data, error } = await supabase!.rpc('hb_lampe_voeux', { p_voeux: ids })
  if (error) return fail(error)
  return { ok: true, value: cleanWishes(data, settings.catalogue) }
}

// ---------- Le staff ----------

export interface StaffLampRow {
  days: Map<string, number>
  coach: Record<string, number>
  coachAt?: string
  wishes: string[]
}
export interface GroupLamps {
  enabled: boolean
  settings: LampSettings
  today: string
  /** Fiches qui ont un espace joueur (elles seules ont une lampe). */
  accounts: Set<string>
  rows: Map<string, StaffLampRow>
}

/** Lampes d'un groupe (staff) : hb_lampe_groupe ; fiches de démonstration et mode essai : l'appareil. */
export async function fetchGroupLamps(groupId: string, playerIds: readonly string[]): Promise<Res<GroupLamps>> {
  const settings = await localLampSettings()
  const rows = new Map<string, StaffLampRow>()
  const accounts = new Set<string>()
  const local = playerIds.filter(isLocalWellness)
  for (const id of local) {
    const l = readLocal(id)
    accounts.add(id)
    rows.set(id, { days: await localDays(id, settings), coach: cleanCoach(l.coach, settings.criteria, settings.rules.coachPointsMax), wishes: cleanWishes(l.wishes, settings.catalogue) })
  }
  let enabled = settings.actif
  let t = today()
  if (supabase && local.length < playerIds.length) {
    if (!navigator.onLine) return offline()
    const { data, error } = await supabase.rpc('hb_lampe_groupe', { p_group_id: groupId })
    if (error) return fail(error)
    const r = (data ?? {}) as Record<string, unknown>
    enabled = r.actif === true
    if (typeof r.aujourdhui === 'string') t = r.aujourdhui
    for (const id of Array.isArray(r.comptes) ? (r.comptes as unknown[]) : []) if (typeof id === 'string') accounts.add(id)
    const js = (r.joueurs ?? {}) as Record<string, Record<string, unknown>>
    for (const [id, x] of Object.entries(js))
      rows.set(id, {
        days: toMap(x.jours),
        coach: cleanCoach(x.coach, settings.criteria, settings.rules.coachPointsMax),
        ...(typeof x.coachAt === 'string' ? { coachAt: x.coachAt } : {}),
        wishes: cleanWishes(x.voeux, settings.catalogue),
      })
  }
  return { ok: true, value: { enabled, settings, today: t, accounts, rows } }
}

/** Lampe d'une fiche (onglet Wellness, staff) : par la fonction du groupe (gardée 60 s en mémoire, jamais sur le disque). */
const memo = new Map<string, { at: number; value: GroupLamps }>()
export async function fetchPlayerLamp(playerId: string, groupId: string, fresh = false): Promise<Res<{ g: GroupLamps; row: StaffLampRow | null; account: boolean }>> {
  const hit = memo.get(groupId)
  let g: GroupLamps
  if (!fresh && hit && Date.now() - hit.at < 60_000 && !isLocalWellness(playerId)) g = hit.value
  else {
    const r = await fetchGroupLamps(groupId, [playerId])
    if (!r.ok) return r
    g = r.value
    if (!isLocalWellness(playerId)) memo.set(groupId, { at: Date.now(), value: g })
  }
  return { ok: true, value: { g, row: g.rows.get(playerId) ?? null, account: g.accounts.has(playerId) } }
}

/** Points des encadrants (ils s'ajoutent ; un administrateur peut corriger). */
export async function saveCoach(playerId: string, points: Record<string, number>, settings: LampSettings, admin: boolean): Promise<Res<Record<string, number>>> {
  const clean = cleanCoach(points, settings.criteria, settings.rules.coachPointsMax)
  memo.clear()
  if (isLocalWellness(playerId)) {
    const l = readLocal(playerId)
    if (!admin && coachLowered(l.coach, clean).length) return { ok: false, error: LAMP_ERRORS.baisse }
    writeLocal(playerId, { ...l, coach: clean })
    return { ok: true, value: clean }
  }
  if (!navigator.onLine) return offline()
  const { data, error } = await supabase!.rpc('hb_lampe_coach', { p_player_id: playerId, p_points: clean })
  if (error) return fail(error)
  return { ok: true, value: cleanCoach(data, settings.criteria, settings.rules.coachPointsMax) }
}

// ---------- Démonstration ----------

/** Lampe fictive posée sur l'appareil (fiches « demo-… ») : wellness prolongé, cahiers, points, vœux. */
export function seedDemoLamp(demo: DemoLamp) {
  seedDemoWellness(Object.fromEntries(Object.entries(demo.players).map(([id, p]) => [id, p.wellness])))
  for (const [id, p] of Object.entries(demo.players)) {
    const plain = readLocalNotes(id).filter((n) => !n.kind)
    writeLocalNotes(id, sortNotes([...p.notes, ...plain]))
    writeLocal(id, { coach: p.coach, wishes: p.wishes })
  }
}
/** Démonstration effacée : sa lampe et ses cahiers aussi. */
export function clearDemoLamp() {
  try {
    const keys: string[] = []
    const journal = `handbase${TRIAL ? '-essai' : ''}.journal.demo-`
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k?.startsWith(LAMP_PREFIX + 'demo-') || k?.startsWith(journal)) keys.push(k)
    }
    keys.forEach((k) => localStorage.removeItem(k))
  } catch {
    /* stockage indisponible : rien à effacer */
  }
}
