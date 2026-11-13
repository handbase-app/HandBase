/*
 * Retour dans l'appli : logique pure (sans React ni page), testée dans tools/test-retour.ts. Branchée dans src/backNav.tsx.
 *
 *  1. Chemin parcouru : chaque entrée de l'historique (clé du routeur) retient la précédente ; le bouton « ← » remonte
 *     ce chemin (backTarget) au lieu d'aller vers une destination fixe.
 *  2. Fenêtres par-dessus l'écran (Filtres, bulle ✦, carte d'action, lecteur vidéo, menu du compte…) : à l'ouverture,
 *     une entrée d'historique à la même adresse, marquée `hbModal` (profondeur 1, 2… pour une fenêtre ouverte depuis une
 *     autre). Le retour du téléphone ou du navigateur ferme la fenêtre du dessus au lieu de quitter l'écran ; la fermer
 *     par son ✕ ou Échap retire son entrée (pas de « retour pour rien » ensuite). Le routeur ne voit jamais ces entrées
 *     (événement popstate arrêté) : ni changement d'écran, ni position de page remise.
 *     Une fenêtre qui se ferme parce que l'appli ouvre un autre écran (carte d'action acceptée, « Réglages » du menu…) :
 *     le nouvel écran PREND LA PLACE de l'entrée de la fenêtre (pushState changé en replaceState), si bien que le retour
 *     depuis ce nouvel écran ramène à l'écran d'où la fenêtre avait été ouverte, en un seul geste.
 *     Une entrée de fenêtre restée sans fenêtre (rechargement pendant qu'elle était ouverte, « avancer » du navigateur,
 *     fenêtre du dessous refermée sous une autre) ne montre rien de plus que l'écran : un retour qui y arrive continue
 *     tout seul, dans le même sens.
 */

// ---------- 1. Chemin parcouru ----------

export type Entry = {
  path: string
  /** Entrée d'avant (clé), dans l'appli. */
  prev?: string
  /** Position de la page, et des zones `data-keep-scroll`. */
  y?: number
  s?: Record<string, number>
  /** État gardé avec l'entrée (useEntryState : « nouveau » à l'ouverture…). */
  st?: Record<string, unknown>
}
export type EntryMap = Record<string, Entry>
export type NavType = 'POP' | 'PUSH' | 'REPLACE'

// Formulaires et écrans de passage : on ne revient pas dessus.
export const TRANSIENT = /\/(nouveau|nouvelle|modifier|mesures)$/

/**
 * Note la navigation vers `key` (écran `path`) depuis l'entrée `cur`. `fresh` : première entrée d'une page chargée par une
 * adresse ouverte directement (lien partagé, notification, adresse tapée ; pas un rechargement ni un retour) : elle ne
 * vient de nulle part dans l'appli, ce qu'une entrée de même clé avait noté est oublié. Renvoie true si `map` a changé.
 */
export function noteEntry(map: EntryMap, cur: string | undefined, key: string, path: string, type: NavType, fresh = false): boolean {
  const known = map[key]
  if (fresh && cur === undefined) {
    map[key] = { path }
    return true
  }
  if (known) {
    // Même clé, autre écran : position et état oubliés.
    if (known.path === path) return false
    known.path = path
    delete known.y
    delete known.s
    delete known.st
    return true
  }
  const prev = type === 'PUSH' ? cur : type === 'REPLACE' && cur ? map[cur]?.prev : undefined
  // Remplacement (filtre noté dans l'adresse, joueur suivant…) : même écran, même position, même état.
  const was = type === 'REPLACE' && cur ? map[cur] : undefined
  map[key] = {
    path,
    prev,
    ...(was?.y !== undefined && { y: was.y }),
    ...(was?.s && { s: { ...was.s } }),
    ...(was?.st && { st: { ...was.st } }),
  }
  return true
}

/**
 * Écran où ramène « ← » depuis l'entrée `key` (écran `pathname`) : le premier écran d'avant qui n'est ni le même ni un
 * formulaire, et le nombre de pas d'historique pour y revenir. Pas d'écran d'avant connu (entrée directe) : steps 0.
 */
export function backTarget(map: EntryMap, key: string, pathname: string): { target?: string; steps: number } {
  let steps = 0
  for (let e = map[key]; e?.prev && steps < 50; ) {
    const t = map[e.prev]
    if (!t) break
    steps++
    if (t.path !== pathname && !TRANSIENT.test(t.path)) return { target: t.path, steps }
    e = t
  }
  return { steps: 0 }
}

/** Clé neuve pour une entrée directe (le routeur nommerait toutes les entrées directes « default »). */
export const newKey = () => `d${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`

// ---------- 2. Fenêtres et geste Retour ----------

export const MARK = 'hbModal'

/** Ce dont le moteur a besoin de la page (window en vrai ; un faux historique dans les tests). */
export interface HistoryHost {
  history: {
    readonly state: unknown
    pushState(data: unknown, unused: string, url?: string | URL | null): void
    replaceState(data: unknown, unused: string, url?: string | URL | null): void
    go(delta?: number): void
  }
  location: { readonly href: string; readonly pathname: string }
  addEventListener(type: 'popstate', fn: (e: Event) => void, opts?: boolean | AddEventListenerOptions): void
}

/** Une fenêtre ouverte : son entrée d'historique est à `depth` au-dessus de l'écran. */
export type Layer = {
  readonly depth: number
  close: () => void
  /** Entrée retirée ou remplacée : plus rien à faire pour elle. */
  gone: boolean
  /** Démontée, fermeture en attente (StrictMode la remonte aussitôt : elle garde alors son entrée). */
  releasing: boolean
}

type Obj = Record<string, unknown>
const obj = (s: unknown): Obj | null => (s && typeof s === 'object' ? (s as Obj) : null)
export const depthOf = (s: unknown) => {
  const v = obj(s)?.[MARK]
  return typeof v === 'number' && v > 0 ? v : 0
}
const idxOf = (s: unknown) => {
  const v = obj(s)?.idx
  return typeof v === 'number' ? v : 0
}
const keyOf = (s: unknown) => {
  const v = obj(s)?.key
  return typeof v === 'string' ? v : 'default'
}
const strip = (s: unknown): unknown => {
  const o = obj(s)
  if (!o || !(MARK in o)) return s
  const rest = { ...o }
  delete rest[MARK]
  return rest
}
const withMark = (s: unknown, d: number): unknown => (d > 0 ? { ...(obj(s) ?? {}), [MARK]: d } : strip(s))

/**
 * Installe le moteur sur `host` : remplace pushState / replaceState (le routeur passe par eux) et écoute popstate avant
 * le routeur (capture). À appeler une fois, avant le montage du routeur.
 */
export function createBackLayers(host: HistoryHost) {
  const h = host.history
  const origPush = h.pushState.bind(h)
  const origReplace = h.replaceState.bind(h)

  /** Entrée où l'on est : rang du routeur (idx), et profondeur de fenêtre (0 : l'écran lui-même). */
  let pos = { idx: idxOf(h.state), depth: depthOf(h.state) }
  /** Écran que le routeur affiche : son entrée (état sans marque, adresse). */
  let screen = { state: strip(h.state), href: host.location.href }
  let layers: Layer[] = []
  /** Retours lancés ici (fermeture par ✕, entrées sautées) dont l'événement popstate n'est pas encore arrivé. */
  let expect = 0

  const topLive = () => layers.reduce((m, l) => (l.gone || l.releasing ? m : Math.max(m, l.depth)), 0)
  const sameScreen = (idx: number) => idx === idxOf(screen.state)

  /** Recule jusqu'à l'entrée de la plus haute fenêtre encore ouverte (ou jusqu'à l'écran). */
  function settle() {
    layers = layers.filter((l) => !l.gone)
    const t = topLive()
    if (pos.depth <= t || !sameScreen(pos.idx)) return
    const n = pos.depth - t
    pos = { ...pos, depth: t }
    expect++
    h.go(-n)
  }

  /** L'entrée où l'on arrive montre l'écran tel que le routeur l'affiche (adresse changée pendant que la fenêtre était ouverte : filtres…). */
  function fit(d: number) {
    if (keyOf(h.state) === keyOf(screen.state) && host.location.href === screen.href && depthOf(h.state) === d) return
    origReplace(withMark(screen.state, d), '', screen.href)
  }

  function onPop(e: Event) {
    const s = h.state
    const d = depthOf(s)
    const idx = idxOf(s)
    const from = pos
    pos = { idx, depth: d }
    const ours = expect > 0
    if (ours) expect--
    if (!sameScreen(idx)) {
      // Autre écran : le routeur s'en charge ; les fenêtres de l'écran quitté se ferment avec lui.
      expect = 0
      for (const l of layers) {
        if (l.gone) continue
        l.gone = true
        if (!l.releasing) l.close()
      }
      layers = []
      screen = { state: strip(s), href: host.location.href }
      return
    }
    // Même écran : affaire de fenêtres, le routeur n'en sait rien.
    e.stopImmediatePropagation()
    const shut = layers.filter((l) => !l.gone && l.depth > d)
    for (const l of shut) l.gone = true
    fit(d)
    if (!ours) {
      if (shut.length) {
        for (const l of shut.reverse()) if (!l.releasing) l.close()
      } else {
        // Rien ne s'est fermé (entrée restée sans fenêtre) : le geste continue, dans le même sens.
        const back = idx < from.idx || (idx === from.idx && d <= from.depth)
        h.go(back ? -1 : 1)
        return
      }
    }
    settle()
  }
  host.addEventListener('popstate', onPop, { capture: true })

  // Le routeur ouvre un écran : sur une entrée de fenêtre, il prend sa place (le retour ramène à l'écran d'en dessous).
  h.pushState = (data: unknown, unused: string, url?: string | URL | null) => {
    if (depthOf(h.state) > 0 && expect === 0) {
      origReplace(strip(data), unused, url)
      for (const l of layers) l.gone = true
      layers = []
    } else origPush(data, unused, url)
    pos = { idx: idxOf(h.state), depth: 0 }
    screen = { state: strip(h.state), href: host.location.href }
  }
  // Le routeur remplace l'adresse (filtre noté dans l'adresse…) : l'entrée reste celle de la fenêtre. Un autre écran à la
  // place d'une fenêtre : comme une ouverture (rang suivant, pour ne pas le confondre avec l'écran d'en dessous).
  h.replaceState = (data: unknown, unused: string, url?: string | URL | null) => {
    const d = depthOf(h.state)
    const before = host.location.pathname
    origReplace(d > 0 ? withMark(data, d) : data, unused, url)
    if (d > 0 && host.location.pathname !== before) {
      origReplace({ ...(obj(strip(h.state)) ?? {}), idx: idxOf(h.state) + 1 }, '', host.location.href)
      for (const l of layers) l.gone = true
      layers = []
    }
    pos = { idx: idxOf(h.state), depth: depthOf(h.state) }
    screen = { state: strip(h.state), href: host.location.href }
  }

  return {
    /** Ouvre une fenêtre : son entrée d'historique (même adresse) ; `close` est appelé si le retour la ferme. */
    open(close: () => void): Layer {
      const depth = pos.depth + 1
      origPush(withMark(h.state, depth), '')
      pos = { ...pos, depth }
      const l: Layer = { depth, close, gone: false, releasing: false }
      layers.push(l)
      return l
    },
    /** Fenêtre fermée par l'appli (✕, Échap, choix fait) : son entrée est retirée (rien si le retour l'a déjà fait). */
    release(l: Layer) {
      if (l.gone) return
      l.gone = true
      settle()
    },
    /** Pour les tests. */
    debug: () => ({ pos: { ...pos }, layers: layers.length, expect }),
  }
}
export type BackLayers = ReturnType<typeof createBackLayers>
