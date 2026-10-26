import { db } from './db'
import { fromRow, requestKey, SERVER_CAP, type AroundRequest, type Rencontre, type UsualTeam } from './rencontres'
import { supabase } from './sync'

/*
 * Accès au serveur pour « Autour de moi » et « Mon équipe » (supabase/056_rencontres.sql ; règles pures : src/rencontres.ts).
 *  - Rencontres : hb_rencontres_autour, à la demande. Rien n'est écrit sur l'appareil ; les dernières réponses restent en
 *    mémoire (le retour sur l'onglet est immédiat, sans nouvel appel tant que la demande est la même et récente).
 *  - « Mon équipe » du jeune (compte joueur) : hb_player_set_team, seule écriture permise ; la copie locale de sa fiche est
 *    alignée tout de suite (la synchronisation la confirmera), sans passer par la file d'envoi. Sans serveur (mode essai ou
 *    local) : sur l'appareil seulement, pour essayer l'écran.
 * Script pas encore passé, ou pas de serveur : « pas encore ouvert sur ce serveur » (pas une erreur).
 * Seuls partent le lieu (arrondi), la période, le sexe et les n° de club des jeunes de la liste : jamais un nom ni une fiche.
 */

export type AroundError = 'pas_ouvert' | 'hors_ligne' | 'reseau'
export type AroundResult = { ok: true; fixtures: Rencontre[]; capped: boolean; at: number } | { ok: false; error: AroundError }

export const AROUND_ERRORS: Record<AroundError, string> = {
  pas_ouvert: 'Les rencontres ne sont pas encore ouvertes sur ce serveur.',
  hors_ligne: 'Pas de connexion internet : les rencontres se lisent en ligne.',
  reseau: 'Les rencontres n’ont pas pu être lues. Réessaie dans un instant.',
}

/** Fonction ou table absente (script pas encore passé). */
const missing = (e: { code?: string } | null | undefined) => ['PGRST202', 'PGRST205', '42883', '42P01'].includes(e?.code ?? '')

// Dernières réponses (8 au plus), de la plus ancienne à la plus récente.
const cache = new Map<string, Extract<AroundResult, { ok: true }>>()
const MAX_CACHE = 8
/** Une réponse plus vieille est relue (en gardant l'ancienne à l'écran pendant ce temps). */
export const FRESH_MS = 5 * 60 * 1000

/** Réponse déjà en mémoire pour cette demande (même ancienne) ; undefined sinon. */
export const cachedAround = (req: AroundRequest) => cache.get(requestKey(req))

/** Rencontres autour d'un point (voir hb_rencontres_autour) ; gardées en mémoire. */
export async function fetchAround(req: AroundRequest): Promise<AroundResult> {
  if (!supabase) return { ok: false, error: 'pas_ouvert' }
  if (typeof navigator !== 'undefined' && !navigator.onLine) return { ok: false, error: 'hors_ligne' }
  const { data, error } = await supabase.rpc('hb_rencontres_autour', {
    p_lat: req.lat,
    p_lng: req.lng,
    p_km: req.km,
    p_from: req.from,
    p_to: req.to,
    p_categories: null,
    p_sex: req.sex ?? null,
    p_clubs: req.clubs ?? null,
  })
  if (error) return { ok: false, error: missing(error) ? 'pas_ouvert' : 'reseau' }
  const rows = Array.isArray(data) ? data : []
  const fixtures = rows.map(fromRow).filter((f): f is Rencontre => !!f)
  const res = { ok: true as const, fixtures, capped: rows.length >= SERVER_CAP, at: Date.now() }
  const key = requestKey(req)
  cache.delete(key)
  cache.set(key, res)
  while (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value!)
  return res
}

// ---------- « Mon équipe » écrite par le jeune ----------

export type TeamResult = { ok: true; value: UsualTeam } | { ok: false; error: string }

const TEAM_ERRORS: Record<string, string> = {
  pas_ouvert: '« Mon équipe » n’est pas encore ouvert sur ce serveur : demande à ton encadrant.',
  hors_ligne: 'Pas de connexion internet : réessaie quand tu es en ligne.',
  pas_joueur: 'Réservé à ton compte joueur.',
  sans_fiche: 'Ton compte n’est pas encore relié à ta fiche.',
  fiche_introuvable: 'Ta fiche n’est pas disponible : demande à ton encadrant.',
}

/**
 * Le jeune enregistre son équipe (champs déjà nettoyés : cleanUsualTeam). `server` : compte joueur avec le serveur ; sinon
 * (essai, local) sur l'appareil seulement. Rend ce qui a été gardé, la copie locale de la fiche suit.
 */
export async function saveMyTeam(playerId: string, team: Pick<UsualTeam, 'n' | 'level' | 'playsIn'>, server: boolean): Promise<TeamResult> {
  let stored: UsualTeam
  if (server && supabase) {
    if (!navigator.onLine) return { ok: false, error: TEAM_ERRORS.hors_ligne }
    const { data, error } = await supabase.rpc('hb_player_set_team', { p_team: team })
    if (error) {
      const code = missing(error) ? 'pas_ouvert' : (error.message ?? '').trim()
      return { ok: false, error: TEAM_ERRORS[code] ?? `Enregistrement impossible : ${error.message}` }
    }
    stored = (data as UsualTeam | null) ?? { at: new Date().toISOString(), src: 'joueur' }
  } else {
    stored = { ...team, at: new Date().toISOString(), src: 'joueur' }
  }
  // Copie locale alignée (jamais par save() : rien dans la file d'envoi, le serveur a déjà la sienne).
  const row = await db.players.get(playerId)
  if (row) await db.players.put({ ...row, usualTeam: stored, updatedAt: Math.max(Date.now(), row.updatedAt + 1) })
  return { ok: true, value: stored }
}
