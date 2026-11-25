import { newId, today, TRIAL } from './db'
import { supabase } from './sync'
import { wellnessMissing } from './wellness'
import { isLocalWellness, localEntries, wellnessEnabled, type Res } from './wellnessApi'
import { alertDefOf, cleanRule, cleanRuleName, evaluateAlerts, myAlertsOf, requestedDayFor, RULES_PER_ACCOUNT, type AlertHit, type MyAlerts, type WellnessAlertDef } from './wellnessAlerts'

/*
 * Alertes wellness de « Mes suivis » (supabase/080_alertes_wellness.sql, src/wellnessAlerts.ts) : accès aux données, sans React.
 *  - RÉGLAGES (nom, règle, cible : pas des données de santé) : table hb_wellness_alertes, les siens seulement (règles de la
 *    table) ; sans serveur (mode essai, local) : le stockage du navigateur (RULES_KEY), réglages seulement.
 *  - ALERTES EN COURS : calculées par le serveur (hb_wellness_alertes_moi), lues à la demande, gardées en mémoire le temps
 *    de l'écran ; jamais sur l'appareil, ni dans un export, ni vers une IA. Le serveur ne rend que « quelle alerte, quel
 *    suivi, depuis combien de jours ». Fiches de démonstration (« demo-… ») et mode essai : calculées ici avec la même règle,
 *    sur leurs réponses fictives déjà posées sur l'appareil (src/wellnessApi.ts).
 *  - Script pas passé (fonction ou table absente) : `missing`, l'encart se tait.
 */

const RULES_KEY = `handbase${TRIAL ? '-essai' : ''}.alertesWellness`
const isLocal = () => !supabase
/** Réponses relues pour le calcul sur l'appareil (même fenêtre que le serveur). */
const FETCH_DAYS = 50

const ERRORS: Record<string, string> = {
  trop_d_alertes: `${RULES_PER_ACCOUNT} alertes au plus.`,
  regle: 'Réglage incomplet.',
  nom: 'Donne un nom à l’alerte.',
}
const offline = (): Res<never> => ({ ok: false, error: 'Il faut être en ligne pour ça.' })
const fail = (e: { message?: string; code?: string }): Res<never> =>
  wellnessMissing(e.code)
    ? { ok: false, error: 'Les alertes wellness ne sont pas encore en place sur ce serveur.', missing: true }
    : { ok: false, error: ERRORS[(e.message ?? '').trim()] ?? (e.code === '42501' ? 'Réservé aux encadrants.' : `Impossible : ${e.message ?? 'connexion internet ?'}`) }

function readLocalDefs(): WellnessAlertDef[] {
  try {
    const raw = localStorage.getItem(RULES_KEY)
    const v = raw ? (JSON.parse(raw) as unknown) : []
    return (Array.isArray(v) ? v : []).map(alertDefOf).filter((d): d is WellnessAlertDef => !!d)
  } catch {
    return []
  }
}
function writeLocalDefs(defs: WellnessAlertDef[]) {
  try {
    localStorage.setItem(RULES_KEY, JSON.stringify(defs))
  } catch {
    /* stockage indisponible : l'essai ne survit pas au rechargement */
  }
}

/** Mes alertes réglées (dans l'ordre de création). */
export async function listAlertDefs(): Promise<Res<WellnessAlertDef[]>> {
  if (isLocal()) return { ok: true, value: readLocalDefs() }
  if (!navigator.onLine) return offline()
  const { data, error } = await supabase!.from('hb_wellness_alertes').select('id, nom, actif, regle, cible').order('created_at').order('id')
  if (error) return fail(error)
  return { ok: true, value: ((data ?? []) as unknown[]).map(alertDefOf).filter((d): d is WellnessAlertDef => !!d) }
}

/** Crée (sans `id`) ou modifie une alerte. Renvoie ce qui est gardé. */
export async function saveAlertDef(d: Omit<WellnessAlertDef, 'id'> & { id?: string }): Promise<Res<WellnessAlertDef>> {
  const regle = cleanRule(d.regle)
  const nom = cleanRuleName(d.nom)
  if (!regle) return { ok: false, error: ERRORS.regle }
  if (!nom) return { ok: false, error: ERRORS.nom }
  const row = { nom, actif: d.actif, regle, cible: d.cible || null }
  if (isLocal()) {
    const defs = readLocalDefs()
    if (!d.id && defs.length >= RULES_PER_ACCOUNT) return { ok: false, error: ERRORS.trop_d_alertes }
    const saved: WellnessAlertDef = { id: d.id ?? newId(), ...row }
    writeLocalDefs(d.id ? defs.map((x) => (x.id === d.id ? saved : x)) : [...defs, saved])
    return { ok: true, value: saved }
  }
  if (!navigator.onLine) return offline()
  const q = d.id ? supabase!.from('hb_wellness_alertes').update(row).eq('id', d.id) : supabase!.from('hb_wellness_alertes').insert(row)
  const { data, error } = await q.select('id, nom, actif, regle, cible').single()
  if (error) return fail(error)
  const saved = alertDefOf(data)
  return saved ? { ok: true, value: saved } : { ok: false, error: 'Réponse du serveur illisible.' }
}

/** Supprime une alerte. */
export async function removeAlertDef(id: string): Promise<Res<true>> {
  if (isLocal()) {
    writeLocalDefs(readLocalDefs().filter((x) => x.id !== id))
    return { ok: true, value: true }
  }
  if (!navigator.onLine) return offline()
  const { error } = await supabase!.from('hb_wellness_alertes').delete().eq('id', id)
  if (error) return fail(error)
  return { ok: true, value: true }
}

/** Suivis gardés sur l'appareil (mode essai, démonstration) : calcul ici, même règle, sur leurs réponses fictives. */
function localHits(defs: readonly WellnessAlertDef[], followed: readonly { id: string; groups: readonly string[] }[]): { readable: string[]; hits: AlertHit[] } {
  const players = followed.filter((p) => isLocalWellness(p.id)).map((p) => ({ id: p.id, groups: p.groups, account: true, since: null, entries: localEntries(p.id, FETCH_DAYS) }))
  return { readable: players.map((p) => p.id), hits: evaluateAlerts(defs, players, today(), requestedDayFor(null)) }
}

/**
 * Alertes en cours sur mes suivis. Serveur : hb_wellness_alertes_moi (il retrouve lui-même mes suivis et ne regarde que ceux
 * dont je lis le wellness) ; `followed` (mes suivis et leurs groupes suivis, calculés sur l'appareil) ne sert qu'aux fiches
 * gardées sur l'appareil.
 */
export async function fetchMyAlerts(defs: readonly WellnessAlertDef[], followed: readonly { id: string; groups: readonly string[] }[]): Promise<Res<MyAlerts>> {
  const loc = localHits(defs, followed)
  if (isLocal()) return { ok: true, value: { enabled: await wellnessEnabled(), readable: new Set(loc.readable), hits: loc.hits } }
  if (!navigator.onLine) return offline()
  const { data, error } = await supabase!.rpc('hb_wellness_alertes_moi')
  if (error) return fail(error)
  const r = myAlertsOf(data)
  for (const id of loc.readable) r.readable.add(id)
  return { ok: true, value: { ...r, hits: [...r.hits, ...loc.hits] } }
}
