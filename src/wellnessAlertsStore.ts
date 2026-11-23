import { useEffect, useMemo, useSyncExternalStore } from 'react'
import { useFollows } from './follows'
import { currentUserId, useRole, type Role } from './roles'
import { alertsByPlayer, type MyAlerts, type WellnessAlertDef } from './wellnessAlerts'
import { fetchMyAlerts, listAlertDefs } from './wellnessAlertsApi'

/*
 * Alertes wellness en cours, partagées par toute l'appli : le cœur de l'en-tête (src/App.tsx) et la page « Alertes
 * wellness » (src/pages/WellnessAlerts.tsx) lisent le MÊME résultat. Un seul appel au serveur (hb_wellness_alertes_moi) à
 * l'ouverture de l'appli, puis au retour sur l'appli (au plus toutes les 30 s), au retour du réseau après une erreur, et
 * quand les suivis ou les réglages changent. Gardé en MÉMOIRE seulement : rien n'est écrit sur l'appareil (ni base, ni
 * stockage du navigateur) ; changement de compte : tout est oublié.
 * Seulement pour le staff (administrateur, encadrant) : un observateur ou un joueur ne lit jamais le wellness.
 */

export const wellnessStaff = (r: Role) => r === 'admin' || r === 'preparateur'

export interface WellnessAlertsState {
  /** Mes alertes réglées (null : pas encore lues). */
  defs: WellnessAlertDef[] | null
  /** Alertes en cours (null : pas encore lues). */
  res: MyAlerts | null
  error: string | null
  /** Script du serveur pas passé : tout se tait. */
  missing: boolean
  /** Suivis (directement ou par un groupe) au moment du calcul. */
  followed: ReadonlySet<string>
  /** Suivis en alerte : chaque alerte qui sonne pour lui (seulement les suivis et les alertes connues). */
  byPlayer: ReadonlyMap<string, { def: WellnessAlertDef; jours: number }[]>
}

const EMPTY: WellnessAlertsState = { defs: null, res: null, error: null, missing: false, followed: new Set(), byPlayer: new Map() }

let state = EMPTY
const listeners = new Set<() => void>()
function set(next: Partial<WellnessAlertsState>) {
  state = { ...state, ...next }
  if (state.defs && state.res) state = { ...state, byPlayer: alertsByPlayer(state.defs, state.res.hits, state.followed) }
  listeners.forEach((l) => l())
}

/** Ce que l'appli a demandé : le compte, ses suivis (et leurs groupes suivis, pour les fiches gardées sur l'appareil). */
let account: string | null = null
let followedKey: string | null = null
let followedList: { id: string; groups: string[] }[] = []
let lastLoad = 0
let seq = 0

async function load() {
  const my = ++seq
  lastLoad = Date.now()
  const followed = new Set(followedList.map((p) => p.id))
  const d = await listAlertDefs()
  if (my !== seq) return
  if (!d.ok) return set({ missing: !!d.missing, error: d.missing ? null : d.error })
  const r = await fetchMyAlerts(d.value, followedList)
  if (my !== seq) return
  if (!r.ok) return set({ defs: d.value, missing: !!r.missing, error: r.missing ? null : r.error })
  set({ defs: d.value, res: r.value, error: null, missing: false, followed })
}

let installed = false
function install() {
  if (installed || typeof window === 'undefined') return
  installed = true
  // Retour sur l'appli : relecture, au plus toutes les 30 s (pas en boucle).
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && account !== null && Date.now() - lastLoad > 30_000) void load()
  })
  // Retour du réseau après un échec : relecture.
  window.addEventListener('online', () => {
    if (account !== null && state.error) void load()
  })
}

/** Relecture tout de suite (réglages changés) ; `min` : pas si la dernière a moins de `min` ms. */
export function refreshWellnessAlerts(min = 0) {
  if (account === null || Date.now() - lastLoad < min) return
  void load()
}

/**
 * Posé une fois dans l'appli pour le staff (src/App.tsx) : donne le compte et ses suivis ; lecture au démarrage (quand les
 * suivis sont connus), puis seulement quand le compte ou les suivis changent.
 */
export function WellnessAlertsFeeder() {
  const follows = useFollows()
  const role = useRole()
  const uid = currentUserId()
  const list = useMemo(
    () => (follows ? [...follows.followed].sort().map((id) => ({ id, groups: follows.groups.filter((g) => g.group.playerIds.includes(id)).map((g) => g.group.id) })) : null),
    [follows],
  )
  const key = list ? list.map((p) => `${p.id}:${p.groups.join('+')}`).join() : null
  const acc = `${uid ?? ''}|${role}`
  useEffect(() => {
    if (!list || key === null) return
    install()
    if (acc !== account) {
      // Autre compte : rien de l'ancien ne reste affiché.
      account = acc
      state = EMPTY
      followedKey = null
    }
    if (key === followedKey) return
    followedKey = key
    followedList = list
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [acc, key])
  useEffect(
    () => () => {
      // Plus de staff à l'écran (déconnexion, autre rôle) : oublié.
      account = null
      followedKey = null
      seq++
      state = EMPTY
      listeners.forEach((l) => l())
    },
    [],
  )
  return null
}

const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => {
    listeners.delete(l)
  }
}
const get = () => state

/** Les alertes en cours (null : pas du staff). */
export function useWellnessAlerts(): WellnessAlertsState | null {
  const staff = wellnessStaff(useRole())
  const s = useSyncExternalStore(subscribe, get)
  return staff ? s : null
}

/**
 * Cœur de l'en-tête : null = pas de bouton (pas du staff, script absent, wellness fermé sur l'installation, pas encore lu) ;
 * sinon le nombre de suivis en alerte (0 : gris).
 */
export function useWellnessAlertCount(): number | null {
  const s = useWellnessAlerts()
  if (!s || s.missing || !s.res?.enabled) return null
  return s.byPlayer.size
}
