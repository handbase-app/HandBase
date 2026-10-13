import { useLiveQuery } from 'dexie-react-hooks'
import { useLayoutEffect } from 'react'
import { useLocation, useNavigate, useNavigationType, type Location, type NavigationType } from 'react-router-dom'
import { canLeave } from './components/Confirm'
import { db } from './db'
import { playerName } from './components/ui'

// ---------- Chemin parcouru dans l'appli ----------
// Chaque entrée de l'historique (location.key) retient la précédente : le bouton « ← » d'un écran
// ramène là d'où l'on vient (groupe, événement, accueil…), et non à une destination fixe.
// Gardé dans sessionStorage : survit à un rechargement de l'onglet.
// Chaque entrée retient aussi sa position (page, et zones qui défilent seules marquées `data-keep-scroll="nom"`) :
// en revenant par l'historique (bouton retour de l'appli ou du navigateur), l'écran est remis où on l'avait laissé.

type Entry = { path: string; prev?: string; y?: number; s?: Record<string, number> }
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

/** Note la navigation en cours (idempotent : appelé pendant le rendu, avant les écrans). */
function track(loc: Location, type: NavigationType) {
  // On quitte l'écran en cours (encore affiché pendant ce rendu) : sa position exacte.
  if (cur && cur !== loc.key) snapshot(cur)
  const known = map[loc.key]
  if (known) {
    // Même clé, autre écran (adresse tapée ou ouverte directement : clé « default ») : position oubliée.
    if (known.path !== loc.pathname) {
      known.path = loc.pathname
      delete known.y
      delete known.s
      persist()
    }
  } else {
    const prev = type === 'PUSH' ? cur : type === 'REPLACE' && cur ? map[cur]?.prev : undefined
    // Remplacement (filtre noté dans l'adresse, joueur suivant…) : même écran, même position.
    const was = type === 'REPLACE' && cur ? map[cur] : undefined
    map[loc.key] = { path: loc.pathname, prev, ...(was?.y !== undefined && { y: was.y }), ...(was?.s && { s: { ...was.s } }) }
    persist()
  }
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

// Formulaires et écrans de passage : on ne revient pas dessus.
const TRANSIENT = /\/(nouveau|nouvelle|modifier|mesures)$/

/** Écran d'où l'on vient (même règle que useBack), ou undefined. */
function previousPath(key: string, pathname: string): string | undefined {
  for (let e = map[key], steps = 0; e?.prev && steps < 50; steps++) {
    const t = map[e.prev]
    if (!t) return undefined
    if (t.path !== pathname && !TRANSIENT.test(t.path)) return t.path
    e = t
  }
  return undefined
}

// Onglets de la barre du bas : on y revient par la barre, pas besoin de bouton retour vers eux.
const TABS = new Set(['/', '/joueurs', '/evenements', '/groupes', '/parametres'])

/** Bouton retour pour un onglet (ex. Joueurs) : seulement si l'on vient d'un autre écran que les onglets (vue nationale, groupe…). */
export function TabBackButton({ className = '' }: { className?: string }) {
  const loc = useLocation()
  const prev = previousPath(loc.key, loc.pathname)
  if (!prev || TABS.has(prev)) return null
  return <BackButton fallback="/" label="ACCUEIL" className={className} />
}

/**
 * Retour : l'écran d'où l'on vient (en sautant le même écran et les formulaires), par l'historique, donc dans l'état où
 * on l'a laissé (filtres, choix, position) ; sinon (adresse ouverte directement, lien partagé) `fallback`.
 * Libellé : le nom de cet écran ; `fallbackLabel` quand c'est justement `fallback` (nom plus parlant : « Tournoi U15 »…).
 * `replace` : sans écran d'origine, `fallback` remplace l'écran actuel (fermeture d'une fiche ouverte par un lien).
 */
export function useBack(fallback: string, fallbackLabel: string, opts: { replace?: boolean } = {}): { label: string; go: () => void; known: boolean } {
  const loc = useLocation()
  const nav = useNavigate()
  let target: string | undefined
  let steps = 0
  for (let e = map[loc.key]; e?.prev && steps < 50; ) {
    const t = map[e.prev]
    if (!t) break
    steps++
    if (t.path !== loc.pathname && !TRANSIENT.test(t.path)) {
      target = t.path
      break
    }
    e = t
  }
  const label = useTargetLabel(target)
  if (!target) return { label: fallbackLabel, known: false, go: async () => (await canLeave()) && nav(fallback, { replace: !!opts.replace }) }
  const same = target === fallback.replace(/[?#].*$/, '')
  return { label: same ? fallbackLabel : (label ?? 'RETOUR'), known: true, go: async () => (await canLeave()) && nav(-steps) }
}

/** Annuler un formulaire : retour d'où l'on vient ; ouvert directement (lien, rechargement), `fallback` le remplace. */
export function useGoBack(fallback: string): () => void {
  return useBack(fallback, '', { replace: true }).go
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
  '/national': 'VUE NATIONALE',
  '/suivis': 'MES SUIVIS',
  '/staffs': 'MES STAFFS',
  '/comparer': 'COMPARAISON',
  '/a-revoir': 'MES À REVOIR',
  '/bilan': 'BILAN DE DÉTECTION',
  '/bilan/rapport': 'RAPPORT CHIFFRÉ',
}

/** Nom de l'écran visé : fixe, ou lu dans la base (joueur, événement, groupe, alerte). */
function useTargetLabel(path?: string): string | undefined {
  // Fiche ouverte depuis un événement, un groupe ou le bilan (/evenements/:id/joueurs/:pid, /groupes/:id/joueurs/:pid,
  // /bilan/joueurs/:pid) : le nom du joueur.
  const [, kind, id] = path?.replace(/^\/((evenements|groupes)\/[^/]+|bilan)(?=\/joueurs\/[^/]+$)/, '').match(/^\/(joueurs|evenements|groupes|alertes)\/([^/]+)$/) ?? []
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
    <button onClick={back.go} className={`min-w-0 truncate text-left text-xs font-bold text-muted ${className}`}>
      ← {back.label}
    </button>
  )
}
