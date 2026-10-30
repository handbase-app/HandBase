/*
 * FILET ÉCONOME (supabase/059_filet_econome.sql) : la partie PURE (ni Dexie, ni React, ni Supabase), testée par
 * tools/test-filet.ts ; l'état et les appels au serveur vivent dans src/sync.ts.
 *
 * POURQUOI (série 8 du 30/10) : « quoi de neuf ? » (hb_quoi_de_neuf, 057) ne répondait « rien de neuf » que 3,8 à 4,9 % du
 * temps :
 *  (a) curseur de moins de 5 minutes : le serveur regarde depuis curseur − 60 s (une ligne validée en retard peut porter une
 *      heure antérieure au curseur) : il répond « oui » pendant 5 minutes après chaque réception, pour des lignes que
 *      l'appareil a déjà ;
 *  (b) les lignes reçues en direct (ligne dans le signal) n'avancent pas le curseur : le filet les relit une fois.
 *
 * MÊME SÛRETÉ, SANS RELIRE CE QUE L'APPAREIL A DÉJÀ : hb_filet(curseurs) rend, pour chaque table, une EMPREINTE de ce que le
 * compte peut lire dans la FENÊTRE [curseur − 60 s, maintenant] (toujours, quel que soit l'âge du curseur) :
 *   { n : lignes, e : empreinte, w : début de la fenêtre (µs), m : plus grande heure serveur, neuf : réponse d'avant }
 * L'appareil garde un REGISTRE des lignes du serveur qu'il a reçues dans cette fenêtre (relecture, envoi de ses propres
 * lignes par hb_upsert_lignes, relecture par identifiant, ET lignes reçues en direct) : identifiant, heure serveur, empreinte de
 * la ligne. Même empreinte : il a déjà tout (lignes validées en retard comprises), rien à relire ; le curseur avance à m et les
 * lignes reçues en direct de la fenêtre sont confirmées (leur CONTENU est celui du serveur, voir plus bas). Empreinte
 * différente : la table est relue, comme avant. Le serveur ne sait pas (plus de 500 lignes dans la fenêtre) ou le registre
 * n'est pas complet pour cette fenêtre : la réponse d'avant (neuf), comme avant.
 *
 * EMPREINTE (identique au serveur, octet pour octet) :
 *   ligne    h = 16 premiers caractères hexadécimaux de sha256( id + "\n" + heure serveur en µs + "\n" + data::text )
 *   fenêtre  e = sha256( concaténation des h triés )   (rien dans la fenêtre : n = 0, pas d'empreinte à comparer)
 * data::text est le texte jsonb de Postgres : clés triées (plus courtes d'abord, puis octet par octet), « ", " » et « ": »,
 * échappements de Postgres (jsonbText le refait). Une écriture qui ne se refait pas à l'identique (nombre écrit 1e-7, par
 * exemple) donne une empreinte différente : l'appareil relit, jamais l'inverse (une empreinte égale pour un contenu différent
 * demanderait une collision de sha256).
 *
 * SÉCURITÉ : le contenu d'une ligne reçue en direct vient d'un autre appareil ; il n'est confirmé que si son empreinte (contenu
 * compris) est celle de la ligne du serveur : une ligne forgée ou erronée ne l'est jamais, elle est relue (et la vérification
 * des lignes à confirmer la remplace ou la retire, comme avant). hb_filet est SECURITY INVOKER : elle ne voit que ce que le
 * compte peut lire et n'en rend qu'un compte, une heure et une empreinte.
 *
 * REGISTRE, par table (stockage local) : r = { id: [heure en µs, h] }, L = heure à partir de laquelle il est COMPLET (toutes les
 * lignes du serveur d'heure >= L y sont, telles que reçues ; absent : pas complet, réponse d'avant). Une relecture depuis
 * `start` le refait au-dessus de start (complet depuis max(start, dernière heure − 60 s)) ; une relecture interrompue le laisse
 * incomplet. Au plus LEDGER_MAX lignes par table : au-delà, les plus anciennes sortent et L monte d'autant.
 */

/** Recouvrement de la fenêtre (même valeur que le serveur, 059, et la relecture par curseur, src/sync.ts). */
export const OVERLAP_US = 60_000_000
/** Au-delà de ce nombre de lignes dans la fenêtre, le serveur ne calcule pas l'empreinte (même valeur que 059). */
export const FILET_CAP = 500
/** Lignes gardées au plus par table dans le registre. */
export const LEDGER_MAX = 1000

// ---------- Texte jsonb ----------

const enc = new TextEncoder()
const utf8 = (s: string) => enc.encode(s)

/** Ordre des clés d'un objet jsonb : longueur en octets UTF-8, puis octet par octet. */
export function jsonbKeyCompare(a: string, b: string): number {
  const x = utf8(a)
  const y = utf8(b)
  if (x.length !== y.length) return x.length - y.length
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] - y[i]
  return 0
}

/** Chaîne comme Postgres l'écrit (escape_json) : \" \\ \b \f \n \r \t, autres caractères de contrôle en \u00xx. */
export function jsonbString(s: string): string {
  let out = '"'
  for (const ch of s) {
    const c = ch.codePointAt(0)!
    if (ch === '"') out += '\\"'
    else if (ch === '\\') out += '\\\\'
    else if (c === 8) out += '\\b'
    else if (c === 12) out += '\\f'
    else if (c === 10) out += '\\n'
    else if (c === 13) out += '\\r'
    else if (c === 9) out += '\\t'
    else if (c < 0x20) out += '\\u' + c.toString(16).padStart(4, '0')
    else out += ch
  }
  return out + '"'
}

/**
 * Texte de jsonb (data::text) d'une valeur reçue en JSON. Nombre : écriture JavaScript (celle des appareils qui écrivent) ;
 * une écriture que Postgres rendrait autrement (exposant…) donne seulement une empreinte différente (relecture).
 */
export function jsonbText(v: unknown): string {
  if (v === null || v === undefined) return 'null'
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  if (typeof v === 'number') return Number.isFinite(v) ? String(Object.is(v, -0) ? 0 : v) : 'null'
  if (typeof v === 'string') return jsonbString(v)
  if (Array.isArray(v)) return '[' + v.map(jsonbText).join(', ') + ']'
  if (typeof v === 'object') {
    const keys = Object.keys(v as object).filter((k) => (v as Record<string, unknown>)[k] !== undefined)
    keys.sort(jsonbKeyCompare)
    return '{' + keys.map((k) => jsonbString(k) + ': ' + jsonbText((v as Record<string, unknown>)[k])).join(', ') + '}'
  }
  return 'null'
}

// ---------- Heures et empreintes ----------

/**
 * Heure serveur (texte de PostgREST ou de jsonb : 2026-10-30T10:00:00.123456+00:00, Z, +02, espace au lieu de T) en
 * microsecondes depuis 1970 ; null : illisible.
 */
export function suaMicros(s: unknown): number | null {
  if (typeof s !== 'string') return null
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}(?::?\d{2})?)?$/.exec(s.trim())
  if (!m) return null
  const [, y, mo, d, h, mi, se, frac, tz] = m
  let ms = Date.UTC(+y, +mo - 1, +d, +h, +mi, +se)
  if (Number.isNaN(ms)) return null
  if (tz && tz !== 'Z') {
    const sign = tz[0] === '-' ? -1 : 1
    const hh = +tz.slice(1, 3)
    const mm = tz.length > 3 ? +tz.slice(-2) : 0
    ms -= sign * (hh * 60 + mm) * 60_000
  }
  return ms * 1000 + (frac ? +frac.padEnd(6, '0') : 0)
}

export type Sha256Hex = (text: string) => Promise<string>

/** sha256 en hexadécimal (Web Crypto : navigateur en https, Node 20). */
export const sha256Hex: Sha256Hex = async (text) => {
  const buf = await crypto.subtle.digest('SHA-256', utf8(text))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** Empreinte d'une ligne du serveur (voir l'en-tête ; même calcul que 059). */
export async function rowHash(id: string, suaUs: number, data: unknown, sha: Sha256Hex = sha256Hex): Promise<string> {
  return (await sha(`${id}\n${suaUs}\n${jsonbText(data)}`)).slice(0, 16)
}

/** Empreinte d'une fenêtre : sha256 de la concaténation des empreintes de lignes triées. */
export async function windowHash(hashes: readonly string[], sha: Sha256Hex = sha256Hex): Promise<string> {
  return sha([...hashes].sort().join(''))
}

// ---------- Registre ----------

/** Registre d'une table : r = { id: [heure µs, h] } ; L : complet à partir de cette heure (µs) ; o : plancher après débordement. */
export interface LedgerTable {
  L?: number
  o?: number
  r: Record<string, [number, string]>
}
export type Ledger = Record<string, LedgerTable>
export interface LedgerEntry {
  id: string
  us: number
  h: string
}

/** Relit le registre gardé (texte JSON) ; illisible : vide (tout repasse par la réponse d'avant). */
export function readLedger(text: string | null): Ledger {
  try {
    const p = JSON.parse(text ?? '{}') as unknown
    if (!p || typeof p !== 'object' || Array.isArray(p)) return {}
    const out: Ledger = {}
    for (const [t, v] of Object.entries(p as Record<string, unknown>)) {
      const x = v as Partial<LedgerTable> | null
      if (!x || typeof x !== 'object' || !x.r || typeof x.r !== 'object') continue
      const r: LedgerTable['r'] = {}
      for (const [id, e] of Object.entries(x.r)) if (Array.isArray(e) && typeof e[0] === 'number' && typeof e[1] === 'string') r[id] = [e[0], e[1]]
      const lt: LedgerTable = { r }
      if (typeof x.L === 'number') lt.L = x.L
      if (typeof x.o === 'number') lt.o = x.o
      out[t] = lt
    }
    return out
  } catch {
    return {}
  }
}

const copy = (lt: LedgerTable | undefined): LedgerTable => ({ ...(lt?.L !== undefined ? { L: lt.L } : {}), ...(lt?.o !== undefined ? { o: lt.o } : {}), r: { ...(lt?.r ?? {}) } })

/** Garde au plus `max` lignes (les plus récentes) ; les autres sortent et le plancher (o, et L s'il existe) monte d'autant. */
function cap(lt: LedgerTable, max: number): LedgerTable {
  const ids = Object.keys(lt.r)
  if (ids.length <= max) return lt
  const sorted = ids.sort((a, b) => lt.r[a][0] - lt.r[b][0])
  const drop = sorted.slice(0, ids.length - max)
  let floor = Math.max(...drop.map((id) => lt.r[id][0])) + 1
  // Les lignes de la même heure que la dernière sortie sortent aussi (sinon le registre serait incomplet à cette heure).
  for (const id of sorted.slice(drop.length)) if (lt.r[id][0] < floor) drop.push(id)
  floor = Math.max(...drop.map((id) => lt.r[id][0])) + 1
  for (const id of drop) delete lt.r[id]
  lt.o = Math.max(lt.o ?? -Infinity, floor)
  if (lt.L !== undefined) lt.L = Math.max(lt.L, lt.o)
  return lt
}

/** Retire les lignes d'heure < below (plus utiles : sous la fenêtre) ; complet depuis max(L, below). */
export function ledgerTrim(l: Ledger, table: string, below: number): Ledger {
  const cur = l[table]
  if (!cur) return l
  const lt = copy(cur)
  let changed = false
  for (const [id, [us]] of Object.entries(lt.r)) {
    if (us < below) {
      delete lt.r[id]
      changed = true
    }
  }
  if (lt.L !== undefined && lt.L < below) {
    lt.L = below
    changed = true
  }
  return changed ? { ...l, [table]: lt } : l
}

/** Note des lignes du serveur reçues (la plus récente heure l'emporte pour un identifiant). */
export function ledgerNote(l: Ledger, table: string, entries: readonly LedgerEntry[], max = LEDGER_MAX): Ledger {
  if (!entries.length) return l
  const lt = copy(l[table])
  for (const e of entries) {
    const had = lt.r[e.id]
    if (!had || had[0] <= e.us) lt.r[e.id] = [e.us, e.h]
  }
  return { ...l, [table]: cap(lt, max) }
}

/** Début d'une relecture depuis startUs : lignes d'heure >= startUs retirées (elles vont être relues), registre incomplet. */
export function ledgerStartPull(l: Ledger, table: string, startUs: number): Ledger {
  const lt: LedgerTable = { r: {} }
  for (const [id, e] of Object.entries(l[table]?.r ?? {})) if (e[0] < startUs) lt.r[id] = e
  return { ...l, [table]: lt }
}

/**
 * Lignes d'une relecture à garder (en mémoire pendant la relecture, empreintes calculées à la fin) : seules les plus récentes
 * comptent (heure >= dernière heure − OVERLAP_US), au plus LEDGER_MAX.
 */
export class PullBuffer<R extends { id: string; server_updated_at?: string; data: unknown }> {
  rows: { row: R; us: number }[] = []
  maxUs: number | null = null
  floor = -Infinity
  readonly startUs: number
  readonly max: number
  constructor(startUs: number, max = LEDGER_MAX) {
    this.startUs = startUs
    this.max = max
  }
  page(rows: readonly R[]) {
    for (const row of rows) {
      const us = suaMicros(row.server_updated_at)
      if (us === null) continue
      this.rows.push({ row, us })
      if (this.maxUs === null || us > this.maxUs) this.maxUs = us
    }
    const below = this.threshold()
    this.rows = this.rows.filter((x) => x.us >= below)
    if (this.rows.length > this.max) {
      this.rows.sort((a, b) => a.us - b.us)
      const cut = this.rows.length - this.max
      let floor = this.rows[cut - 1].us + 1
      this.rows = this.rows.slice(cut).filter((x) => x.us >= floor)
      floor = Math.max(floor, this.floor)
      this.floor = floor
    }
  }
  /** Heure à partir de laquelle le registre sera complet après cette relecture. */
  threshold() {
    return Math.max(this.startUs, this.maxUs === null ? -Infinity : this.maxUs - OVERLAP_US, this.floor)
  }
}

/** Fin d'une relecture réussie : lignes gardées notées, registre complet depuis le seuil de la relecture. */
export function ledgerEndPull(l: Ledger, table: string, entries: readonly LedgerEntry[], threshold: number, max = LEDGER_MAX): Ledger {
  const lt = copy(l[table])
  for (const e of entries) lt.r[e.id] = [e.us, e.h]
  for (const [id, [us]] of Object.entries(lt.r)) if (us < threshold) delete lt.r[id]
  delete lt.o
  lt.L = threshold
  return { ...l, [table]: cap(lt, max) }
}

// ---------- Réponse du serveur et décision ----------

/** Réponse de hb_filet pour une table : null (table inconnue), booléen (pas de curseur : true), ou empreinte. */
export interface FiletPrint {
  n: number
  e?: string
  w?: number
  m?: string | null
  neuf: boolean
}
export type FiletAnswer = boolean | null | FiletPrint

/** Clé des seules affectations du compte (même clé que hb_quoi_de_neuf, src/syncLive.ts MY_ASSIGNMENTS_KEY). */
const MINE = 'mes_affectations'

/** Réponse de hb_filet ramenée aux tables (null : illisible). Valeur mal formée : true (prudence, on relit). */
export function readFiletAnswer(data: unknown, mine: boolean): Record<string, FiletAnswer> | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null
  const out: Record<string, FiletAnswer> = {}
  for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
    const t = mine && k === MINE ? 'assignments' : k
    if (mine && k === 'assignments') continue
    if (v === null || typeof v === 'boolean') out[t] = v
    else if (v && typeof v === 'object' && typeof (v as FiletPrint).n === 'number' && typeof (v as FiletPrint).neuf === 'boolean') {
      const p = v as FiletPrint
      const print: FiletPrint = { n: p.n, neuf: p.neuf }
      if (typeof p.e === 'string') print.e = p.e
      if (typeof p.w === 'number') print.w = p.w
      if (typeof p.m === 'string') print.m = p.m
      out[t] = print
    } else out[t] = true
  }
  return out
}

/** Que faire d'une table ? pull : relire (null : table inconnue du serveur) ; confirm : rien à relire, curseur et lignes confirmées. */
export interface FiletDecision {
  pull: boolean | null
  /** Pourquoi (mesures, essais) : identique, différente, réponse d'avant, inconnue. */
  why: 'identique' | 'differente' | 'avant' | 'absente'
  confirm?: { cursor: string | null; ids: string[] }
}

/**
 * Décide d'après la réponse et le registre. L'empreinte n'est comparée que si le serveur l'a donnée et si le registre est
 * complet depuis le début de la fenêtre ; on compare les lignes du registre d'heure dans [w, m] (une ligne reçue en direct
 * après la réponse du serveur, plus récente que m, n'est pas confirmée : elle le sera au prochain passage).
 */
export async function decideFilet(a: FiletAnswer | undefined, lt: LedgerTable | undefined, sha: Sha256Hex = sha256Hex): Promise<FiletDecision> {
  if (a === null) return { pull: null, why: 'absente' }
  if (a === undefined || typeof a === 'boolean') return { pull: a !== false, why: 'avant' }
  const mUs = a.m ? suaMicros(a.m) : null
  // (n = 0 : rien dans la fenêtre, pas d'empreinte ; plus de FILET_CAP lignes : ni empreinte ni fenêtre, réponse d'avant.)
  const usable = typeof a.w === 'number' && lt?.L !== undefined && lt.L <= a.w && (a.n === 0 || (typeof a.e === 'string' && mUs !== null))
  if (!usable) return { pull: a.neuf, why: 'avant' }
  const w = a.w!
  const local = Object.entries(lt!.r).filter(([, [us]]) => us >= w && (mUs === null || us <= mUs))
  const same = a.n === 0 ? local.length === 0 : local.length === a.n && (await windowHash(local.map(([, [, h]]) => h), sha)) === a.e
  if (!same) return { pull: true, why: 'differente' }
  return { pull: false, why: 'identique', confirm: { cursor: a.n > 0 && a.m ? a.m : null, ids: local.map(([id]) => id) } }
}

// ---------- Quelle fonction demander ? ----------

/** Fonctions absentes du serveur (059 ou 057 pas passés) : heure du constat ; filetOn : hb_filet a répondu pendant ce lancement. */
export interface AskState {
  filetMissingAt: number
  oldMissingAt: number
  filetOn: boolean
}
type Rpc = (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }>

/** Redemande une fonction absente au bout de ce délai. */
export const ASK_AGAIN_MS = 60 * 60_000

/**
 * « Quoi de neuf ? » : hb_filet (059) d'abord ; absente (code 42883 / PGRST202) : hb_quoi_de_neuf (057), comme avant, et
 * hb_filet n'est redemandée qu'une heure plus tard ; les deux absentes, ou autre erreur : null (l'appli relit tout, comme
 * avant). Le même objet de curseurs part aux deux (mêmes clés).
 */
export async function askWhatsNew(
  rpc: Rpc,
  curseurs: Record<string, string>,
  state: AskState,
  now: number,
  missing: (e: { code?: string }) => boolean,
): Promise<{ kind: 'filet'; data: unknown } | { kind: 'ancien'; data: unknown } | null> {
  if (now - state.filetMissingAt >= ASK_AGAIN_MS) {
    const { data, error } = await rpc('hb_filet', { curseurs })
    if (!error) {
      state.filetOn = true
      return { kind: 'filet', data }
    }
    if (!missing(error)) return null
    state.filetMissingAt = now
    state.filetOn = false
  }
  if (now - state.oldMissingAt < ASK_AGAIN_MS) return null
  const { data, error } = await rpc('hb_quoi_de_neuf', { curseurs })
  if (!error) return { kind: 'ancien', data }
  if (missing(error)) state.oldMissingAt = now
  return null
}
