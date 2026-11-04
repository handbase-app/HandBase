import { TRIAL } from './db'
import { cleanMyGoals, emptyMyGoals, myGoalsFromRow, pruneChecks, type MyGoals } from './myGoals'
import type { WorkObjective } from './objectives'
import { supabase } from './sync'

/*
 * Objectifs « à moi » et coches du jeune (supabase/065_objectifs_etapes.sql, src/myGoals.ts) : accès aux données, sans React.
 *  - Avec le serveur : lus À LA DEMANDE et en ligne (pas de synchronisation hors ligne) dans hb_player_goals (règles du
 *    serveur : le jeune lit sa ligne, le staff celle des fiches qu'il lit) ; le jeune écrit par hb_player_goals_save (sa
 *    fiche, jamais une autre). Script pas passé (fonction ou table absente : PGRST202 / PGRST205) : `missing`, la partie du
 *    jeune reste en lecture (ceux du staff s'affichent comme avant).
 *  - Sans serveur (mode essai / local), et pour les fiches de démonstration (« demo-… », jamais envoyées) : sur l'appareil
 *    (stockage du navigateur), mêmes règles.
 * Rien de ce qui est écrit ici ne part vers une IA.
 */

export type Res<T> = { ok: true; value: T } | { ok: false; error: string; missing?: boolean }

const KEY_PREFIX = `handbase${TRIAL ? '-essai' : ''}.objectifs.`
const LOCAL_KEY = (playerId: string) => KEY_PREFIX + playerId
/** Sur l'appareil : pas de serveur, ou fiche de démonstration (elle n'existe pas sur le serveur). */
export const goalsAreLocal = (playerId: string) => !supabase || playerId.startsWith('demo-')

function readLocal(playerId: string): MyGoals {
  try {
    const raw = localStorage.getItem(LOCAL_KEY(playerId))
    return raw ? cleanMyGoals(JSON.parse(raw)) : emptyMyGoals()
  } catch {
    return emptyMyGoals()
  }
}
function writeLocal(playerId: string, g: MyGoals) {
  try {
    if (g.own.length || Object.keys(g.checks).length) localStorage.setItem(LOCAL_KEY(playerId), JSON.stringify(g))
    else localStorage.removeItem(LOCAL_KEY(playerId))
  } catch {
    /* stockage indisponible : l'essai ne survit pas au rechargement */
  }
}

/** Le serveur n'a pas (encore) le script 065. */
export const goalsMissing = (code?: string) => code === 'PGRST202' || code === 'PGRST205' || code === '42P01'

/** Refus du serveur → phrase pour le jeune (jamais de message technique brut quand on le connaît). */
const ERRORS: Record<string, string> = {
  max_en_cours: '5 objectifs à toi en cours au plus : coche-en un « atteint » ou retire-le d’abord.',
  trop_d_objectifs: 'Trop d’objectifs gardés : retire ceux qui ne te servent plus.',
  trop_d_etapes: '8 étapes au plus par objectif.',
  lien: 'Un lien n’est pas une adresse web (il doit commencer par http:// ou https://).',
  trop_long: 'C’est trop long : raccourcis un peu.',
  pas_joueur: 'Seul le jeune écrit ici, depuis sa page.',
  sans_fiche: 'Ton compte n’est pas encore relié à ta fiche : demande à ton encadrant.',
}
export function goalsErrorText(message?: string, code?: string): string {
  if (goalsMissing(code)) return 'Pas encore ouvert sur ce serveur : demande à ton encadrant.'
  const k = Object.keys(ERRORS).find((x) => message?.includes(x))
  return k ? ERRORS[k] : `Enregistrement impossible${message ? ` : ${message}` : ''}.`
}

const offline = (): Res<never> => ({ ok: false, error: 'Il faut être en ligne pour ça : ce n’est pas gardé sur l’appareil.' })
const fail = (e: { message?: string; code?: string }): Res<never> => ({ ok: false, error: goalsErrorText(e.message, e.code), ...(goalsMissing(e.code) ? { missing: true } : {}) })

/** Ses objectifs et ses coches (le jeune : les siens ; le staff : ceux d'une fiche qu'il lit). Pas de ligne : vide. */
export async function fetchPlayerGoals(playerId: string): Promise<Res<MyGoals>> {
  if (goalsAreLocal(playerId)) return { ok: true, value: readLocal(playerId) }
  if (!navigator.onLine) return offline()
  const { data, error } = await supabase!.from('hb_player_goals').select('own, checks, updated_at').eq('player_id', playerId).maybeSingle()
  if (error) return fail(error)
  return { ok: true, value: myGoalsFromRow(data as Record<string, unknown> | null) }
}

/**
 * Enregistre tout ce qui est à lui (ses objectifs, ses coches) ; renvoie ce qui est gardé. Les coches d'étapes qui ne sont
 * plus sur la fiche tombent (le serveur fait de même, et pose lui-même le jour des nouvelles coches).
 */
export async function saveMyGoals(playerId: string, next: MyGoals, staff: readonly WorkObjective[]): Promise<Res<MyGoals>> {
  const g = pruneChecks(cleanMyGoals(next), staff)
  if (goalsAreLocal(playerId)) {
    const kept = { ...g, at: new Date().toISOString() }
    writeLocal(playerId, kept)
    return { ok: true, value: kept }
  }
  if (!navigator.onLine) return offline()
  const { data, error } = await supabase!.rpc('hb_player_goals_save', { p_own: g.own, p_checks: Object.keys(g.checks) })
  if (error) return fail(error)
  return { ok: true, value: myGoalsFromRow(data as Record<string, unknown> | null) }
}

/** Démonstration : objectifs « à moi » et coches fictifs posés sur l'appareil (fiches « demo-… »). */
export function seedDemoGoals(byPlayer: Record<string, MyGoals>) {
  for (const [id, g] of Object.entries(byPlayer)) writeLocal(id, cleanMyGoals(g))
}

/** Démonstration effacée : ses objectifs aussi. */
export function clearDemoGoals() {
  try {
    const keys: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k?.startsWith(KEY_PREFIX + 'demo-')) keys.push(k)
    }
    keys.forEach((k) => localStorage.removeItem(k))
  } catch {
    /* stockage indisponible : rien à effacer */
  }
}
