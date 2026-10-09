import { useLiveQuery } from 'dexie-react-hooks'
import { useLocation, useNavigate, useNavigationType, type Location, type NavigationType } from 'react-router-dom'
import { canLeave } from './components/Confirm'
import { db } from './db'
import { playerName } from './components/ui'

// ---------- Chemin parcouru dans l'appli ----------
// Chaque entrée de l'historique (location.key) retient la précédente : le bouton « ← » d'un écran
// ramène là d'où l'on vient (groupe, événement, accueil…), et non à une destination fixe.
// Gardé dans sessionStorage : survit à un rechargement de l'onglet.

type Entry = { path: string; prev?: string }
const STORE = 'hb-back'
const MAX = 300

let map: Record<string, Entry> = {}
try {
  map = JSON.parse(sessionStorage.getItem(STORE) ?? '{}') ?? {}
} catch {
  map = {}
}
let cur: string | undefined

function persist() {
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
  const known = map[loc.key]
  if (known) {
    if (known.path !== loc.pathname) (known.path = loc.pathname), persist()
  } else {
    const prev = type === 'PUSH' ? cur : type === 'REPLACE' && cur ? map[cur]?.prev : undefined
    map[loc.key] = { path: loc.pathname, prev }
    persist()
  }
  cur = loc.key
}

/** À monter une fois, dans le routeur. */
export function BackTracker() {
  track(useLocation(), useNavigationType())
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

/** Retour : l'écran d'où l'on vient (en sautant le même écran et les formulaires), sinon `fallback`. */
export function useBack(fallback: string, fallbackLabel: string): { label: string; go: () => void } {
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
  if (!target) return { label: fallbackLabel, go: async () => (await canLeave()) && nav(fallback) }
  return { label: label ?? 'RETOUR', go: async () => (await canLeave()) && nav(-steps) }
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
}

/** Nom de l'écran visé : fixe, ou lu dans la base (joueur, événement, groupe, alerte). */
function useTargetLabel(path?: string): string | undefined {
  const [, kind, id] = path?.match(/^\/(joueurs|evenements|groupes|alertes)\/([^/]+)$/) ?? []
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
