// Nextar : partie PURE de la fonction « veille » (ni Deno, ni réseau, ni base), testée par tools/test-veille.ts.
// Voir index.ts et supabase/060_push_veille.sql.
//
// LE MESSAGE POUSSÉ est un SIGNAL MINIMAL : { type: "veille", v: 1, jour, ev: [{ id, nom, h }], calme? } :
//  - id : identifiant de l'événement (le service worker télécharge ensuite, avec la session de la personne et SES droits) ;
//  - nom : nom court de l'événement (40 caractères au plus) et h : heure « HH:MM » (ou absente), pour le texte affiché ;
//  - calme : créneau « ne pas déranger » de la personne : notification sans son ni vibration (une notification visible
//    reste obligatoire sur le web : jamais de push silencieux) ;
//  - JAMAIS un joueur, une mesure, un avis, un lieu, un nom de personne : rien d'autre que ces clés (payloadIsMinimal).
// Le web push chiffre le message de bout en bout (clés de l'abonnement) : le service de push du téléphone ne le lit pas.

/** Une ligne rendue par hb_veille_prendre. */
export interface VeilleRow {
  user_id: string
  event_id: string
  nom: string | null
  heure: string | null
  notif?: Record<string, unknown> | null
}

/** Un événement du lendemain, tel qu'il part dans le message. */
export interface VeilleEvent {
  id: string
  nom: string
  h?: string
}

export interface VeillePayload {
  type: 'veille'
  v: 1
  jour: string
  ev: VeilleEvent[]
  /** Événements de plus, non détaillés (au-delà de MAX_EVENTS). */
  plus?: number
  calme?: true
}

/** Événements détaillés dans un message, au plus (les autres sont comptés : « plus »). */
export const MAX_EVENTS = 5
/** Longueur d'un nom d'événement dans le message. */
export const MAX_NOM = 40
/** Taille d'un message, au plus (le web push accepte ~4 Ko chiffrés). */
export const MAX_OCTETS = 3000
/** Lot de personnes par appel (VEILLE_LOT), fenêtre d'envoi en heures de Paris (VEILLE_DEBUT, VEILLE_FIN). */
export const LOT_DEFAUT = 300
export const DEBUT_DEFAUT = 18
export const FIN_DEFAUT = 22
/** Durée de vie du message chez le service de push (téléphone éteint à 18 h, rallumé à 6 h : encore utile). */
export const TTL_S = 14 * 3600
/** Envois en parallèle, au plus. */
export const PARALLELE = 20

/** Jour (AAAA-MM-JJ) et heure à Paris (changements d'heure compris). */
export function parisParts(now: Date): { jour: string; heure: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Paris',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now)
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? ''
  return { jour: `${get('year')}-${get('month')}-${get('day')}`, heure: Number(get('hour')) % 24 }
}

/** Heure de Paris dans la fenêtre d'envoi [debut, fin[. */
export const dansFenetre = (heure: number, debut = DEBUT_DEFAUT, fin = FIN_DEFAUT) => (debut <= fin ? heure >= debut && heure < fin : heure >= debut || heure < fin)

/** Nombre entier lu dans une variable d'environnement ou le corps de la requête, borné ; défaut sinon. */
export function entier(v: unknown, defaut: number, min: number, max: number): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN
  return Number.isInteger(n) && n >= min && n <= max ? n : defaut
}

/** Jour « AAAA-MM-JJ » valide (date réelle). */
export function jourValide(v: unknown): v is string {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false
  const d = new Date(`${v}T12:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v
}

/**
 * Créneau « ne pas déranger » de la personne (supabase/027, même règle que la fonction notify) : par défaut 21 h – 8 h ;
 * quiet: false le coupe ; de quietFrom à quietTo, qui peut passer minuit.
 */
export function enCalme(notif: Record<string, unknown> | null | undefined, heure: number): boolean {
  const n = (notif ?? {}) as { quiet?: unknown; quietFrom?: unknown; quietTo?: unknown }
  if (n.quiet === false) return false
  const from = typeof n.quietFrom === 'number' ? n.quietFrom : 21
  const to = typeof n.quietTo === 'number' ? n.quietTo : 8
  return from === to ? false : from < to ? heure >= from && heure < to : heure >= from || heure < to
}

const HEURE = /^([01]\d|2[0-3]):[0-5]\d$/

/** Nom court : espaces resserrés, caractères de contrôle retirés, coupé à MAX_NOM (avec « … »). */
export function nomCourt(nom: string | null | undefined): string {
  // eslint-disable-next-line no-control-regex
  const s = String(nom ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim() || 'Événement'
  return s.length > MAX_NOM ? s.slice(0, MAX_NOM - 1).trimEnd() + '…' : s
}

/**
 * Regroupe les lignes par personne (un seul envoi par personne, même avec plusieurs événements), dans l'ordre des personnes
 * rendu par le serveur ; pour chacune, ses événements par heure (sans heure en dernier), puis nom, sans doublon.
 */
export function parPersonne(rows: readonly VeilleRow[]): Map<string, { events: VeilleEvent[]; notif: Record<string, unknown> }> {
  const out = new Map<string, { events: VeilleEvent[]; notif: Record<string, unknown> }>()
  for (const r of rows) {
    if (!r || typeof r.user_id !== 'string' || typeof r.event_id !== 'string' || !r.event_id) continue
    let p = out.get(r.user_id)
    if (!p) out.set(r.user_id, (p = { events: [], notif: (r.notif ?? {}) as Record<string, unknown> }))
    if (p.events.some((e) => e.id === r.event_id)) continue
    const e: VeilleEvent = { id: r.event_id, nom: nomCourt(r.nom) }
    if (typeof r.heure === 'string' && HEURE.test(r.heure)) e.h = r.heure
    p.events.push(e)
  }
  for (const p of out.values())
    p.events.sort((a, b) => (a.h ?? '99:99').localeCompare(b.h ?? '99:99') || a.nom.localeCompare(b.nom, 'fr') || a.id.localeCompare(b.id))
  return out
}

/** Message d'une personne (voir l'en-tête) ; au plus MAX_EVENTS détaillés et MAX_OCTETS. */
export function veillePayload(jour: string, events: readonly VeilleEvent[], opts: { calme?: boolean } = {}): VeillePayload {
  const ev = events.slice(0, MAX_EVENTS).map((e) => ({ id: String(e.id).slice(0, 100), nom: nomCourt(e.nom), ...(e.h && HEURE.test(e.h) ? { h: e.h } : {}) }))
  const p: VeillePayload = { type: 'veille', v: 1, jour, ev }
  if (events.length > MAX_EVENTS) p.plus = events.length - MAX_EVENTS
  if (opts.calme) p.calme = true
  // Très gros identifiants : on retire des événements détaillés jusqu'à tenir (comptés dans « plus »).
  while (p.ev.length > 1 && octets(p) > MAX_OCTETS) {
    p.ev.pop()
    p.plus = (p.plus ?? 0) + 1
  }
  return p
}

const octets = (p: unknown) => new TextEncoder().encode(JSON.stringify(p)).length

const CLES = new Set(['type', 'v', 'jour', 'ev', 'plus', 'calme'])
const CLES_EV = new Set(['id', 'nom', 'h'])

/** Le message ne contient-il QUE les clés du signal minimal (aucune donnée de joueur, aucun champ inattendu) ? */
export function payloadIsMinimal(p: unknown): boolean {
  if (!p || typeof p !== 'object' || Array.isArray(p)) return false
  const o = p as Record<string, unknown>
  if (o.type !== 'veille' || o.v !== 1 || !jourValide(o.jour) || !Array.isArray(o.ev)) return false
  if (Object.keys(o).some((k) => !CLES.has(k))) return false
  if (o.plus !== undefined && !(Number.isInteger(o.plus) && (o.plus as number) > 0)) return false
  if (o.calme !== undefined && o.calme !== true) return false
  if (o.ev.length > MAX_EVENTS) return false
  for (const e of o.ev as unknown[]) {
    if (!e || typeof e !== 'object' || Array.isArray(e)) return false
    const x = e as Record<string, unknown>
    if (Object.keys(x).some((k) => !CLES_EV.has(k))) return false
    if (typeof x.id !== 'string' || typeof x.nom !== 'string' || x.nom.length > MAX_NOM) return false
    if (x.h !== undefined && (typeof x.h !== 'string' || !HEURE.test(x.h))) return false
  }
  return octets(o) <= MAX_OCTETS
}

/** Abonnement expiré ou retiré par le téléphone (le service de push répond 404 ou 410) : à oublier. */
export const abonnementPerdu = (status: number | undefined) => status === 404 || status === 410

/** Morceaux de n éléments (listes d'identifiants dans l'adresse d'une requête). */
export function paquets<T>(list: readonly T[], n: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < list.length; i += n) out.push(list.slice(i, i + n))
  return out
}

/** Exécute les tâches avec au plus n en parallèle (ordre des résultats = ordre des tâches). */
export async function parallele<T>(tasks: readonly (() => Promise<T>)[], n = PARALLELE): Promise<T[]> {
  const out = new Array<T>(tasks.length)
  let next = 0
  const worker = async () => {
    while (next < tasks.length) {
      const i = next++
      out[i] = await tasks[i]()
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(n, tasks.length)) }, worker))
  return out
}

// ---------- Propositions à valider (supabase/067_propositions.sql) ----------
// Une proposition déposée par le serveur MCP (ou lue sur une photo) : le déclencheur hb_propositions_signal appelle cette
// fonction avec { type: "proposition", id }. Le message poussé est une notification SIMPLE, au format de la fonction
// « notify » (public/push-sw.js l'affiche telle quelle) : { body, url, tag, calme? } ; body = « 1 proposition à valider ·
// Tests rentrée Pôle » (titre de la proposition, coupé), url = la boîte « À valider ». JAMAIS un joueur, une ligne, une mesure.

/** Adresse ouverte par le toucher : l'appli ouvre la boîte « À valider » (src/components/Propositions.tsx). */
export const PROPOSITION_URL = '/?propositions=1'
/** Même sujet : la nouvelle notification remplace la précédente au lieu de s'empiler. */
export const PROPOSITION_TAG = 'propositions'
/** Durée de vie chez le service de push (téléphone éteint) : un jour. */
export const PROPOSITION_TTL_S = 24 * 3600
/** Longueur du titre dans le message. */
export const MAX_TITRE = 40

export interface PropositionPayload {
  body: string
  url: string
  tag: string
  calme?: true
}

/** Identifiant de proposition valable (uuid). */
export const idProposition = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)

/** Titre court : espaces resserrés, caractères de contrôle retirés, coupé à MAX_TITRE (avec « … »). */
export function titreCourt(titre: string | null | undefined): string {
  // eslint-disable-next-line no-control-regex
  const s = String(titre ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim()
  return s.length > MAX_TITRE ? s.slice(0, MAX_TITRE - 1).trimEnd() + '…' : s
}

/** « 1 proposition à valider · Tests rentrée Pôle » ; « 3 propositions à valider · <titre de la dernière> ». */
export function propositionTexte(n: number, titre: string | null | undefined): string {
  const k = Math.max(1, Math.floor(n) || 1)
  const head = `${k} proposition${k > 1 ? 's' : ''} à valider`
  const t = titreCourt(titre)
  return t ? `${head} · ${t}` : head
}

/** Message d'une proposition (voir plus haut) ; `calme` : créneau « ne pas déranger » (notification sans son). */
export function propositionPayload(n: number, titre: string | null | undefined, opts: { calme?: boolean } = {}): PropositionPayload {
  return { body: propositionTexte(n, titre), url: PROPOSITION_URL, tag: PROPOSITION_TAG, ...(opts.calme ? { calme: true as const } : {}) }
}

/**
 * Faut-il annoncer cette proposition ? Seulement si elle attend encore, n'a pas été retirée, ne vient pas de l'appareil
 * lui-même (« collage ») et que la personne n'a pas coupé « Propositions à valider » (préférence proposition, oui par défaut).
 */
export function propositionAAnnoncer(
  p: { source?: string | null; etat?: string | null; deleted_at?: string | null } | null | undefined,
  notif: Record<string, unknown> | null | undefined,
): boolean {
  if (!p || p.source === 'collage' || p.etat !== 'en_attente' || p.deleted_at) return false
  return (notif ?? {}).proposition !== false
}

const CLES_PROP = new Set(['body', 'url', 'tag', 'calme'])

/** Le message ne contient-il QUE le texte, le lien et le sujet (aucune donnée de joueur, aucun champ inattendu) ? */
export function propositionIsMinimal(p: unknown): boolean {
  if (!p || typeof p !== 'object' || Array.isArray(p)) return false
  const o = p as Record<string, unknown>
  if (Object.keys(o).some((k) => !CLES_PROP.has(k))) return false
  if (o.url !== PROPOSITION_URL || o.tag !== PROPOSITION_TAG || typeof o.body !== 'string') return false
  if (o.calme !== undefined && o.calme !== true) return false
  return /^\d+ propositions? à valider( · .{1,40})?$/.test(o.body)
}
