/*
 * PUSH DE LA VEILLE, CÔTÉ TÉLÉPHONE : la partie PURE (ni réseau, ni IndexedDB, ni service worker), testée par
 * tools/test-veille-sw.ts ; le service worker qui s'en sert : src/veilleSw.ts ; l'envoi : supabase/functions/veille.
 *
 * Le message reçu ne dit que QUELS événements préparer ({ type: "veille", jour, ev: [{ id, nom, h }] }) ; le service worker :
 *  1. affiche TOUJOURS une notification tout de suite (pas de push silencieux sur le web) : « Demain : Détection U13 à
 *     9 h 30 », « Préparation hors ligne de vos joueurs… » ;
 *  2. attend 0 à 20 s au hasard (5 s au plus sur iPhone, où le service worker vit moins longtemps) : les téléphones d'un même
 *     lot ne téléchargent pas tous à la même seconde ;
 *  3. prend la session de la personne (src/authRefresh.ts, workerSession) ; sans session valable : la notification invite à
 *     ouvrir l'appli ;
 *  4. télécharge, avec SES droits (règles de lecture habituelles, HTTPS), les événements, leurs joueurs (au plus
 *     PRIORITE_MAX), leurs mesures et avis, la grille de notation (critères) et la configuration ; serveur occupé (429, 503) :
 *     il abandonne sans insister, l'appli se synchronisera à l'ouverture ;
 *  5. range les lignes dans la base du téléphone (Dexie) avec la règle de l'appli (src/syncLive.ts, keepRows : jamais
 *     par-dessus une version plus récente, ligne identique pas réécrite), et jamais une ligne qui attend d'être envoyée ;
 *  6. remplace la notification par le résultat exact : « Vos 24 joueurs sont prêts hors ligne. », ou ce qui a manqué.
 * Le curseur de synchronisation n'est jamais avancé (comme la lecture prioritaire, src/priorite.ts) : la synchronisation
 * suivante relit tout normalement, rien ne peut être sauté.
 */
import { keepRows, type ServerRow } from './syncLive'
import { PRIORITE_MAX } from './priorite'

export interface VeilleEvent {
  id: string
  nom: string
  h?: string
}
export interface VeilleMessage {
  type: 'veille'
  jour: string
  ev: VeilleEvent[]
  plus: number
  calme: boolean
}

const HEURE = /^([01]\d|2[0-3]):[0-5]\d$/
const JOUR = /^\d{4}-\d{2}-\d{2}$/

/** Message « veille » lisible (null : autre message, ou illisible). Champs inattendus ignorés. */
export function parseVeille(d: unknown): VeilleMessage | null {
  const o = d as { type?: unknown; jour?: unknown; ev?: unknown; plus?: unknown; calme?: unknown } | null
  if (!o || typeof o !== 'object' || o.type !== 'veille' || typeof o.jour !== 'string' || !JOUR.test(o.jour) || !Array.isArray(o.ev)) return null
  const ev: VeilleEvent[] = []
  for (const x of o.ev.slice(0, 20)) {
    const e = x as { id?: unknown; nom?: unknown; h?: unknown } | null
    if (!e || typeof e.id !== 'string' || !e.id || e.id.length > 100 || ev.some((y) => y.id === e.id)) continue
    const item: VeilleEvent = { id: e.id, nom: typeof e.nom === 'string' && e.nom.trim() ? e.nom.trim().slice(0, 60) : 'Événement' }
    if (typeof e.h === 'string' && HEURE.test(e.h)) item.h = e.h
    ev.push(item)
  }
  if (!ev.length) return null
  const plus = typeof o.plus === 'number' && Number.isInteger(o.plus) && o.plus > 0 ? o.plus : 0
  return { type: 'veille', jour: o.jour, ev, plus, calme: o.calme === true }
}

/** « 09:30 » → « 9 h 30 » ; « 14:00 » → « 14 h ». */
export function heureFr(h: string | undefined): string {
  if (!h || !HEURE.test(h)) return ''
  const [hh, mm] = h.split(':')
  return `${Number(hh)} h${mm === '00' ? '' : ` ${mm}`}`
}

const nb = (n: number, one: string, many = one + 's') => `${n.toLocaleString('fr-FR')} ${n > 1 ? many : one}`

/** Issue de la préparation. */
export type Issue =
  | { kind: 'pret'; joueurs: number; evenements: number; manquants: number }
  | { kind: 'occupe' }
  | { kind: 'session' }
  | { kind: 'reseau' }
  | { kind: 'erreur' }
  | { kind: 'en-cours' }

/** Titre de la notification : « Demain : Détection U13 à 9 h 30 », ou « Demain : 3 événements ». */
export function titreVeille(m: VeilleMessage): string {
  const total = m.ev.length + m.plus
  if (total > 1) return `Demain : ${nb(total, 'événement')}`
  const e = m.ev[0]
  const h = heureFr(e.h)
  return `Demain : ${e.nom}${h ? ` à ${h}` : ''}`
}

/** Texte de la notification selon l'issue (exact : il dit ce qui est vraiment sur le téléphone). */
export function texteVeille(m: VeilleMessage, issue: Issue): string {
  const total = m.ev.length + m.plus
  // Plusieurs événements : les trois premiers, puis « et 2 autres ».
  const liste =
    total > 1
      ? m.ev
          .slice(0, 3)
          .map((e) => (e.h ? `${e.nom} (${heureFr(e.h)})` : e.nom))
          .join(', ') + (total > 3 ? ` et ${nb(total - 3, 'autre')}` : '') + '. '
      : ''
  switch (issue.kind) {
    case 'en-cours':
      return `${liste}Préparation hors ligne de vos joueurs…`
    case 'pret': {
      if (issue.evenements === 0) return `${liste}Ouvrez l’appli pour retrouver ${total > 1 ? 'ces événements' : 'cet événement'}.`
      const base =
        issue.joueurs === 0
          ? 'Prêt hors ligne (aucun joueur dans la liste pour l’instant).'
          : issue.joueurs === 1
            ? 'Votre joueur est prêt hors ligne.'
            : `Vos ${nb(issue.joueurs, 'joueur')} sont prêts hors ligne.`
      return `${liste}${base}${issue.manquants > 0 ? ' Le reste arrivera à l’ouverture de l’appli.' : ''}`
    }
    case 'occupe':
      return `${liste}Serveur très demandé : vos joueurs se chargeront à l’ouverture de l’appli.`
    case 'session':
      return `${liste}Ouvrez l’appli pour préparer vos joueurs hors ligne (connexion à renouveler).`
    case 'reseau':
      return `${liste}Pas de réseau : ouvrez l’appli une fois connecté pour préparer vos joueurs.`
    default:
      return `${liste}Préparation impossible pour l’instant : ouvrez l’appli pour charger vos joueurs.`
  }
}

/** Page ouverte par la notification : l'événement s'il est seul, sinon la liste des événements. */
export const urlVeille = (m: VeilleMessage) => (m.ev.length === 1 && m.plus === 0 ? `/evenements/${encodeURIComponent(m.ev[0].id)}` : '/evenements')

/** Étiquette de la notification : la même pour le premier affichage et le résultat (la seconde remplace la première). */
export const tagVeille = (m: VeilleMessage) => `veille:${m.jour}`

/** Attente avant de télécharger : 0 à 20 s au hasard (0 à 5 s sur iPhone / iPad). */
export function attenteVeille(rnd: () => number, userAgent = ''): number {
  const max = /iphone|ipad|ipod|macintosh.*safari(?!.*chrome)/i.test(userAgent) ? 5000 : 20_000
  return Math.round(Math.min(Math.max(rnd(), 0), 1) * max)
}

/** Réponse HTTP d'une lecture : ok, serveur occupé (on abandonne sans insister), session refusée, autre erreur. */
export function statutLecture(status: number): 'ok' | 'occupe' | 'session' | 'erreur' {
  if (status >= 200 && status < 300) return 'ok'
  if (status === 429 || status === 503) return 'occupe'
  if (status === 401 || status === 403) return 'session'
  return 'erreur'
}

/** Joueurs des événements reçus (non supprimés), dans l'ordre des événements puis de leur liste, sans doublon, au plus max. */
export function joueursDes(events: readonly { data?: { playerIds?: unknown; deleted?: unknown } }[], max = PRIORITE_MAX): string[] {
  const out = new Set<string>()
  for (const e of events) {
    if (!e?.data || e.data.deleted === true || !Array.isArray(e.data.playerIds)) continue
    for (const id of e.data.playerIds) {
      if (out.size >= max) return [...out]
      if (typeof id === 'string' && id && id.length <= 100) out.add(id)
    }
  }
  return [...out]
}

/** Nombre de joueurs inscrits au-delà de max (non préparés : « le reste arrivera à l'ouverture »). */
export function joueursEnTrop(events: readonly { data?: { playerIds?: unknown; deleted?: unknown } }[], max = PRIORITE_MAX): number {
  const all = new Set<string>()
  for (const e of events) if (e?.data && e.data.deleted !== true && Array.isArray(e.data.playerIds)) for (const id of e.data.playerIds) if (typeof id === 'string' && id) all.add(id)
  return Math.max(0, all.size - max)
}

/** Identifiant sûr dans une adresse PostgREST (id=in.(…)) : guillemets, sans caractère de contrôle. */
export function inList(ids: readonly string[]): string {
  // eslint-disable-next-line no-control-regex
  return `(${ids.map((id) => `"${id.replace(/[\u0000-\u001f"\\]/g, '')}"`).join(',')})`
}

/** Morceaux de n éléments. */
export function paquets<T>(list: readonly T[], n: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < list.length; i += n) out.push(list.slice(i, i + n))
  return out
}

/**
 * Lignes reçues à ranger sur le téléphone : règle de l'appli (keepRows : absente, plus récente et différente, ou purgée),
 * jamais une ligne qui attend d'être envoyée (pending), jamais une ligne illisible (identifiant différent de data.id).
 */
export function lignesARanger<T extends ServerRow>(rows: readonly T[], locals: readonly ({ updatedAt?: number } | undefined)[], pending: ReadonlySet<string>): T[] {
  const ok = rows.map((r, i) => ({ r, l: locals[i] })).filter(({ r }) => r && typeof r.id === 'string' && r.data && typeof r.data === 'object' && (r.data.id === undefined || r.data.id === r.id) && !pending.has(r.id))
  const kept = new Set(keepRows(ok.map((x) => x.r), ok.map((x) => x.l)))
  return ok.map((x) => x.r).filter((r) => kept.has(r))
}

/** Tables lues par la veille, dans l'ordre (configuration et grille avant les joueurs, comme la synchronisation). */
export const VEILLE_TABLES = ['config', 'criteria', 'events', 'players', 'measurements', 'evaluations'] as const
export type VeilleTable = (typeof VEILLE_TABLES)[number]

/** Événements à préparer par la synchronisation périodique (Android) : ceux du compte (créateur ou participant) d'ici à jours. */
export function evenementsDuCompte(
  events: readonly { id: string; data?: { date?: unknown; createdBy?: unknown; editors?: unknown; deleted?: unknown; archived?: unknown } }[],
  uid: string,
  today: string,
  last: string,
): string[] {
  return events
    .filter((e) => {
      const d = e.data
      if (!d || d.deleted === true || d.archived === true || typeof d.date !== 'string') return false
      const day = d.date.slice(0, 10)
      if (day < today || day > last) return false
      return d.createdBy === uid || (Array.isArray(d.editors) && d.editors.includes(uid))
    })
    .map((e) => e.id)
}
