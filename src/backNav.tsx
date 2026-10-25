import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useLocation, useNavigate, useNavigationType, type Location, type NavigationType } from 'react-router-dom'
import { backTarget, createBackLayers, depthOf, newKey, noteEntry, type BackLayers, type Entry, type Layer } from './backCore'
import { canLeave } from './components/Confirm'
import { db } from './db'
import { playerName } from './components/ui'

// ---------- Chemin parcouru dans l'appli ----------
// Chaque entrée de l'historique (location.key) retient la précédente : le bouton « ← » d'un écran
// ramène là d'où l'on vient (groupe, événement, accueil…), et non à une destination fixe.
// Gardé dans sessionStorage : survit à un rechargement de l'onglet.
// Chaque entrée retient aussi sa position (page, et zones qui défilent seules marquées `data-keep-scroll="nom"`) :
// en revenant par l'historique (bouton retour de l'appli ou du navigateur), l'écran est remis où on l'avait laissé.
// Logique pure (chemin, écran visé, fenêtres et geste Retour) : src/backCore.ts.

const STORE = 'hb-back'
const MAX = 300

let map: Record<string, Entry> = {}
try {
  map = JSON.parse(sessionStorage.getItem(STORE) ?? '{}') ?? {}
} catch {
  map = {}
}
let cur: string | undefined

let persistTimer: ReturnType<typeof setTimeout> | undefined
function persist() {
  clearTimeout(persistTimer)
  persistTimer = undefined
  const keys = Object.keys(map)
  // Les plus anciennes entrées partent (ordre d'insertion).
  for (const k of keys.slice(0, Math.max(0, keys.length - MAX))) delete map[k]
  try {
    sessionStorage.setItem(STORE, JSON.stringify(map))
  } catch {
    /* stockage indisponible : tant pis, retour par défaut */
  }
}

/**
 * Page chargée par une adresse ouverte directement (lien partagé, notification, adresse tapée), pas par un rechargement
 * ni un retour : sa première entrée ne vient de nulle part dans l'appli.
 */
let freshLoad = false
if (typeof window !== 'undefined') {
  try {
    freshLoad = (performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined)?.type === 'navigate'
  } catch {
    freshLoad = false
  }
  // Entrée directe : le routeur la nommerait « default », comme toutes les entrées directes d'avant dans cet onglet (dont
  // le chemin noté n'a rien à voir avec celle-ci). Une clé neuve, gardée par l'historique (un rechargement la retrouve).
  try {
    const st = history.state as { key?: unknown } | null
    if (!st || typeof st !== 'object' || typeof st.key !== 'string') history.replaceState({ ...(st ?? {}), key: newKey() }, '')
  } catch {
    /* historique indisponible */
  }
}

/** Note la navigation en cours (idempotent : appelé pendant le rendu, avant les écrans). */
function track(loc: Location, type: NavigationType) {
  // On quitte l'écran en cours (encore affiché pendant ce rendu) : sa position exacte.
  if (cur && cur !== loc.key) snapshot(cur)
  if (noteEntry(map, cur, loc.key, loc.pathname, type, freshLoad)) persist()
  cur = loc.key
}

// ---------- Position de chaque écran ----------

let restoring = false
/** Écran affiché (pour savoir, à l'arrivée sur un autre, s'il remplace la page ou s'ouvre à côté de sa liste). */
let shownPath: string | undefined
let stopRestore: (() => void) | undefined

/** Écran qui défile (la page, ou une zone `data-keep-scroll`) : sa position est notée pour l'entrée en cours. */
function onScroll(e: Event) {
  if (restoring || !cur || !map[cur]) return
  const t = e.target
  const entry = map[cur]
  if (t === document || t === document.documentElement || t === document.body) entry.y = Math.round(window.scrollY)
  else if (t instanceof HTMLElement && t.dataset.keepScroll) (entry.s ??= {})[t.dataset.keepScroll] = Math.round(t.scrollTop)
  else return
  // Écrit un peu plus tard (pas à chaque pixel).
  if (!persistTimer) persistTimer = setTimeout(persist, 400)
}
/** Position de la page et des zones `data-keep-scroll` affichées, notée pour l'entrée `key`. */
function snapshot(key: string) {
  const entry = map[key]
  if (restoring || !entry) return
  entry.y = Math.round(window.scrollY)
  for (const el of document.querySelectorAll<HTMLElement>('[data-keep-scroll]')) (entry.s ??= {})[el.dataset.keepScroll!] = Math.round(el.scrollTop)
}
if (typeof window !== 'undefined') {
  // L'appli remet elle-même chaque écran en place (les listes arrivent après coup : le navigateur n'y parvient pas).
  try {
    history.scrollRestoration = 'manual'
  } catch {
    /* navigateur ancien */
  }
  document.addEventListener('scroll', onScroll, { capture: true, passive: true })
  window.addEventListener('pagehide', () => persist())
}

/**
 * Retour sur une entrée de l'historique : la page (et ses zones `data-keep-scroll`) reprend sa position, dès que le
 * contenu est assez long (listes chargées après coup). S'arrête dès que l'on touche l'écran, la molette ou le clavier.
 */
function restore(key: string) {
  stopRestore?.()
  const e = map[key]
  if (!e || (e.y === undefined && !e.s)) return
  const { y, s = {} } = e
  restoring = true
  let tries = 0
  let ok = 0
  const user = () => stop()
  const evs = ['wheel', 'touchstart', 'keydown', 'mousedown'] as const
  const timer = setInterval(() => {
    let done = true
    if (y !== undefined && Math.abs(window.scrollY - y) > 1) {
      window.scrollTo(0, y)
      done = Math.abs(window.scrollY - y) <= 1
    }
    for (const [name, v] of Object.entries(s)) {
      const el = document.querySelector<HTMLElement>(`[data-keep-scroll="${CSS.escape(name)}"]`)
      if (!el) {
        done = false
        continue
      }
      if (Math.abs(el.scrollTop - v) > 1) {
        el.scrollTop = v
        done &&= Math.abs(el.scrollTop - v) <= 1
      }
    }
    ok = done ? ok + 1 : 0
    if (ok >= 3 || ++tries > 50) stop()
  }, 50)
  function stop() {
    clearInterval(timer)
    for (const ev of evs) window.removeEventListener(ev, user, true)
    restoring = false
    stopRestore = undefined
  }
  for (const ev of evs) window.addEventListener(ev, user, { capture: true, passive: true })
  stopRestore = stop
}

/** À monter une fois, dans le routeur. */
export function BackTracker() {
  const loc = useLocation()
  const type = useNavigationType()
  track(loc, type)
  useLayoutEffect(() => {
    const from = shownPath
    shownPath = loc.pathname
    // Retour (ou rechargement) : l'écran reprend sa position.
    if (type === 'POP') {
      restore(loc.key)
    } else {
      stopRestore?.()
      // Nouvel écran : en haut. Sauf élément ouvert à côté de sa liste (ordinateur, /joueurs → /joueurs/:id) :
      // la liste reste où elle était.
      const beside = loc.pathname.startsWith(`${from}/`) && !!document.querySelector('.md-list')
      if (type === 'PUSH' && from !== loc.pathname && !beside) window.scrollTo(0, 0)
    }
  }, [loc.key, loc.pathname, type])
  return null
}

/** Écran d'où l'on vient (même règle que useBack), ou undefined. */
function previousPath(key: string, pathname: string): string | undefined {
  return backTarget(map, key, pathname).target
}

// Onglets de la barre du bas (NAV, src/App.tsx) : on y revient par la barre, pas besoin de bouton retour vers eux.
const TABS = new Set(['/', '/joueurs', '/evenements', '/groupes', '/bilan'])

/** Bouton retour pour un onglet (ex. Joueurs) : seulement si l'on vient d'un autre écran que les onglets (bilan de détection, groupe…). */
export function TabBackButton({ className = '' }: { className?: string }) {
  const loc = useLocation()
  const prev = previousPath(loc.key, loc.pathname)
  if (!prev || TABS.has(prev)) return null
  return <BackButton fallback="/" label="ACCUEIL" className={className} />
}

/**
 * Retour : l'écran d'où l'on vient (en sautant le même écran et les formulaires), par l'historique, donc dans l'état où
 * on l'a laissé (filtres, choix, onglet, position) ; sinon (adresse ouverte directement, lien partagé) `fallback`.
 * Libellé : le nom de cet écran ; `fallbackLabel` quand c'est justement `fallback` (nom plus parlant : « Tournoi U15 »…).
 * `go` demande d'abord si une saisie en cours peut être perdue ; `exit` non (après un enregistrement, une suppression ou
 * une annulation déjà confirmée) : `fallback` y remplace toujours l'écran actuel (formulaire, fiche supprimée).
 * `replace` : sans écran d'origine, `go` aussi remplace l'écran actuel par `fallback` (fermeture d'une fiche ouverte par un lien).
 * `known` : l'écran d'origine est connu (on y revient par l'historique).
 */
export function useBack(
  fallback: string,
  fallbackLabel: string,
  opts: { replace?: boolean } = {},
): { label: string; go: () => void; exit: () => void; known: boolean; leaveScreen: () => void } {
  const loc = useLocation()
  const nav = useNavigate()
  const { target, steps } = backTarget(map, loc.key, loc.pathname)
  const label = useTargetLabel(target)
  if (!target)
    return {
      label: fallbackLabel,
      known: false,
      go: async () => (await canLeave()) && nav(fallback, { replace: !!opts.replace }),
      exit: () => nav(fallback, { replace: true }),
      leaveScreen: async () => (await canLeave()) && nav(fallback, { replace: !!opts.replace }),
    }
  const same = target === fallback.replace(/[?#].*$/, '')
  return {
    label: same ? fallbackLabel : (label ?? 'RETOUR'),
    known: true,
    go: async () => (await canLeave()) && nav(-steps),
    exit: () => nav(-steps),
    // Bouton « ← » de l'écran : fenêtre restée ouverte sans couvrir l'écran (lecteur vidéo), ses entrées sautées d'un coup —
    // on revient à l'écran annoncé (elle se ferme avec celui qu'on quitte), pas seulement à l'écran sans la vidéo.
    leaveScreen: async () => {
      if (!(await canLeave())) return
      let open = 0
      try {
        open = depthOf(window.history.state)
      } catch {
        open = 0
      }
      nav(-(steps + open))
    },
  }
}

/**
 * L'entrée juste avant celle-ci dans l'appli, même à la même adresse (« Modifier » choisi dans le menu d'une ligne de la
 * liste, l'élément déjà ouvert à côté) : `go` y revient par l'historique, tel quel. `known` : false pour une entrée directe.
 */
export function useOrigin(): { known: boolean; go: () => void } {
  const loc = useLocation()
  const nav = useNavigate()
  const prev = map[loc.key]?.prev
  return { known: !!prev && !!map[prev], go: () => nav(-1) }
}

/** Annuler un formulaire : retour d'où l'on vient ; ouvert directement (lien, rechargement), `fallback` le remplace. */
export function useGoBack(fallback: string): () => void {
  return useBack(fallback, '', { replace: true }).go
}

/**
 * État attaché à l'entrée de l'historique (gardé avec elle, sessionStorage) : retrouvé en revenant sur cet écran (retour
 * d'une fiche…), neuf à la visite suivante. Ex. les joueurs « nouveaux » à l'ouverture d'un profil recherché, qui sont
 * aussitôt marqués comme vus : au retour d'une fiche, les mêmes restent marqués, dans le même ordre.
 */
export function useEntryState<T>(name: string, initial: T | (() => T)): [T, (v: T) => void] {
  const { key } = useLocation()
  const id = `${key}\n${name}`
  const read = (): T => {
    const st = map[key]?.st
    if (st && Object.prototype.hasOwnProperty.call(st, name)) return st[name] as T
    return typeof initial === 'function' ? (initial as () => T)() : initial
  }
  const [box, setBox] = useState(() => ({ id, v: read() }))
  let shown = box
  // Autre entrée (ou autre nom) sans remontage de l'écran : sa propre valeur.
  if (box.id !== id) {
    shown = { id, v: read() }
    setBox(shown)
  }
  const v = shown.v
  useEffect(() => {
    const e = map[key]
    if (!e) return
    ;(e.st ??= {})[name] = v as unknown
    persist()
  }, [key, name, v])
  return [v, (next: T) => setBox({ id, v: next })]
}

const STATIC: Record<string, string> = {
  '/': 'ACCUEIL',
  '/joueurs': 'JOUEURS',
  '/evenements': 'ÉVÉNEMENTS',
  '/groupes': 'GROUPES',
  '/alertes': 'PROFILS RECHERCHÉS',
  '/actualite': 'QUOI DE NEUF',
  '/avis-spontanes': 'PROPOSITIONS',
  '/rates': 'RATÉS',
  '/parametres': 'RÉGLAGES',
  '/confidentialite': 'CONFIDENTIALITÉ',
  '/evaluer': 'ÉVALUER',
  '/suivis': 'MES SUIVIS',
  '/staffs': 'MES STAFFS',
  '/comparer': 'COMPARAISON',
  '/a-revoir': 'MES À REVOIR',
  '/bilan': 'BILAN DE DÉTECTION',
  '/bilan/rapport': 'RAPPORT CHIFFRÉ',
  '/bilan/question': 'QUESTION',
}

/** Nom de l'écran visé : fixe, ou lu dans la base (joueur, événement, groupe, alerte). */
export function useTargetLabel(path?: string): string | undefined {
  // Fiche ouverte depuis un événement, un groupe ou le bilan (/evenements/:id/joueurs/:pid, /groupes/:id/joueurs/:pid,
  // /bilan/joueurs/:pid) : le nom du joueur.
  const [, kind, id] = path?.replace(/^\/((evenements|groupes)\/[^/]+|bilan(\/question)?)(?=\/joueurs\/[^/]+$)/, '').match(/^\/(joueurs|evenements|groupes|alertes)\/([^/]+)$/) ?? []
  const name = useLiveQuery(async () => {
    if (!id) return undefined
    if (kind === 'joueurs') {
      const p = await db.players.get(id)
      return p ? playerName(p) : 'FICHE DU JOUEUR'
    }
    const row = await (kind === 'evenements' ? db.events : kind === 'groupes' ? db.groups : db.alerts).get(id)
    return row?.name?.toUpperCase() ?? { evenements: 'ÉVÉNEMENT', groupes: 'GROUPE', alertes: 'PROFIL RECHERCHÉ' }[kind]
  }, [kind, id])
  if (!path) return undefined
  return id ? (name ?? '…') : STATIC[path]
}

/** Bouton « ← … » en haut d'un écran. */
export function BackButton({ fallback, label, className = '' }: { fallback: string; label: string; className?: string }) {
  const back = useBack(fallback, label)
  return (
    <button onClick={back.leaveScreen} className={`min-w-0 truncate text-left text-xs font-bold text-muted ${className}`}>
      ← {back.label}
    </button>
  )
}

// ---------- Fenêtres par-dessus l'écran : le geste Retour les ferme ----------

let layers: BackLayers | undefined
if (typeof window !== 'undefined') {
  try {
    layers = createBackLayers(window)
  } catch {
    layers = undefined
  }
}

/**
 * Fenêtre par-dessus l'écran (Filtres, bulle ✦, carte d'action, lecteur vidéo…), ouverte tant que `active` : le retour du
 * téléphone ou du navigateur la ferme (`onClose`) et laisse sur l'écran, dans le même état ; fermée par son ✕ ou Échap,
 * son entrée d'historique est retirée. Fenêtre ouverte depuis une autre : chacune la sienne, le retour ferme celle du
 * dessus. Fermée parce que l'appli ouvre un autre écran : il prend la place de son entrée (voir src/backCore.ts).
 */
export function useBackCloses(onClose: () => void, active = true) {
  const cb = useRef(onClose)
  useLayoutEffect(() => {
    cb.current = onClose
  })
  const held = useRef<Layer | null>(null)
  useEffect(() => {
    if (!active || !layers) return
    const engine = layers
    let l = held.current
    // StrictMode (développement) démonte et remonte aussitôt : même fenêtre, même entrée.
    if (l && l.releasing && !l.gone) l.releasing = false
    else {
      l = engine.open(() => cb.current())
      held.current = l
    }
    const mine = l
    return () => {
      mine.releasing = true
      // Un peu plus tard : une navigation lancée en même temps (carte acceptée…) prend la place de l'entrée, sans retour.
      setTimeout(() => {
        if (!mine.releasing) return
        engine.release(mine)
        if (held.current === mine) held.current = null
      }, 0)
    }
  }, [active])
}
