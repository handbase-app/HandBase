// Test du retour dans l'appli (src/backCore.ts) : écran visé par « ← », entrée directe, et fenêtres que le geste Retour
// ferme (Filtres, bulle ✦, carte d'action, lecteur vidéo…), sur un faux historique de navigateur et un faux routeur.
//
//   npx jiti tools/test-retour.ts
import assert from 'node:assert/strict'
import { backTarget, createBackLayers, depthOf, noteEntry, type EntryMap, type HistoryHost } from '../src/backCore'

// ---------- 1. Chemin parcouru, écran visé ----------
{
  const map: EntryMap = {}
  noteEntry(map, undefined, 'k0', '/', 'POP')
  noteEntry(map, 'k0', 'k1', '/evenements', 'PUSH')
  noteEntry(map, 'k1', 'k2', '/evenements/e1', 'PUSH')
  noteEntry(map, 'k2', 'k3', '/evenements/e1/joueurs/p1', 'PUSH')
  noteEntry(map, 'k3', 'k4', '/joueurs/p1/modifier', 'PUSH')
  // Formulaire ouvert depuis la fiche dans l'événement : « ← » et Enregistrer y ramènent (1 pas).
  assert.deepEqual(backTarget(map, 'k4', '/joueurs/p1/modifier'), { target: '/evenements/e1/joueurs/p1', steps: 1 })
  // Écran ouvert depuis un formulaire : le formulaire est sauté.
  noteEntry(map, 'k4', 'k5', '/joueurs/p1/mesures', 'PUSH')
  assert.deepEqual(backTarget(map, 'k5', '/joueurs/p1/mesures'), { target: '/evenements/e1/joueurs/p1', steps: 2 })
  // Même écran (filtre noté dans l'adresse en remplaçant) : sauté aussi.
  noteEntry(map, 'k2', 'k2b', '/evenements/e1', 'PUSH')
  assert.deepEqual(backTarget(map, 'k2b', '/evenements/e1'), { target: '/evenements', steps: 2 })
  // Remplacement : même écran d'avant, même position, même état gardé.
  map.k3.y = 420
  map.k3.st = { 'alerte.a.nouveaux': ['p1'] }
  noteEntry(map, 'k3', 'k3r', '/evenements/e1/joueurs/p2', 'REPLACE')
  assert.equal(map.k3r.prev, 'k2')
  assert.equal(map.k3r.y, 420)
  assert.deepEqual(map.k3r.st, { 'alerte.a.nouveaux': ['p1'] })
  map.k3r.st!['alerte.a.nouveaux'] = []
  assert.deepEqual(map.k3.st, { 'alerte.a.nouveaux': ['p1'] }, 'copie, pas partage')

  // Entrée directe (lien partagé, notification) : rien d'avant, l'écran de repli.
  assert.deepEqual(backTarget(map, 'k0', '/'), { steps: 0 })
  // Une entrée directe d'avant avec la même clé (le routeur nomme « default » toutes les entrées directes) : oubliée.
  map.default = { path: '/joueurs/p9', prev: 'k1', y: 900, st: { x: 1 } }
  noteEntry(map, undefined, 'default', '/joueurs/p9', 'POP', true)
  assert.deepEqual(map.default, { path: '/joueurs/p9' })
  assert.deepEqual(backTarget(map, 'default', '/joueurs/p9'), { steps: 0 })
  // Rechargement (pas une entrée directe) : le chemin est gardé.
  map.k9 = { path: '/joueurs/p9', prev: 'k1', y: 300 }
  assert.equal(noteEntry(map, undefined, 'k9', '/joueurs/p9', 'POP', false), false)
  assert.deepEqual(backTarget(map, 'k9', '/joueurs/p9'), { target: '/evenements', steps: 1 })
  // Même clé, autre écran : position et état oubliés.
  noteEntry(map, 'k9', 'k9', '/joueurs/p8', 'POP')
  assert.equal(map.k9.y, undefined)
}

// ---------- 2. Faux navigateur et faux routeur ----------

type St = Record<string, unknown> | null
class FakeBrowser implements HistoryHost {
  entries: { state: St; url: string }[]
  i = 0
  pending: number[] = []
  listeners: { fn: (e: Event) => void; capture: boolean }[] = []
  constructor(url: string, state: St) {
    this.entries = [{ state, url }]
  }
  get cur() {
    return this.entries[this.i]
  }
  /** Adresse relative (une adresse complète est ramenée à son chemin, comme le navigateur). */
  static rel(url: string) {
    return url.replace(/^http:\/\/app/, '')
  }
  history = (() => {
    const b = this
    return {
      get state() {
        return b.cur.state
      },
      pushState(data: unknown, _u: string, url?: string | URL | null) {
        b.entries.splice(b.i + 1)
        b.entries.push({ state: structuredClone(data) as St, url: url ? FakeBrowser.rel(String(url)) : b.cur.url })
        b.i++
      },
      replaceState(data: unknown, _u: string, url?: string | URL | null) {
        b.entries[b.i] = { state: structuredClone(data) as St, url: url ? FakeBrowser.rel(String(url)) : b.cur.url }
      },
      go(n = 0) {
        b.pending.push(n)
      },
    }
  })()
  location = (() => {
    const b = this
    return {
      get href() {
        return `http://app${b.cur.url}`
      },
      get pathname() {
        return b.cur.url.split('?')[0]
      },
    }
  })()
  addEventListener(_t: 'popstate', fn: (e: Event) => void, opts?: boolean | AddEventListenerOptions) {
    this.listeners.push({ fn, capture: typeof opts === 'boolean' ? opts : !!opts?.capture })
  }
  /** Le navigateur traite les retours demandés (asynchrones en vrai), un événement popstate à chaque pas. */
  flush() {
    for (let guard = 0; this.pending.length && guard < 50; guard++) {
      const n = this.pending.shift()!
      const j = this.i + n
      if (j < 0 || j >= this.entries.length || n === 0) continue
      this.i = j
      let stopped = false
      const e = { stopImmediatePropagation: () => (stopped = true) } as unknown as Event
      for (const l of [...this.listeners.filter((x) => x.capture), ...this.listeners.filter((x) => !x.capture)]) {
        if (stopped) break
        l.fn(e)
      }
    }
  }
  /** Geste Retour (ou bouton du navigateur). */
  back() {
    this.history.go(-1)
    this.flush()
  }
  forward() {
    this.history.go(1)
    this.flush()
  }
}

/** Faux routeur (comme react-router : clé et rang dans l'état, écoute popstate sans capture). */
class FakeRouter {
  shown: string
  pops = 0
  n = 0
  constructor(private b: FakeBrowser) {
    this.shown = b.cur.url
    b.addEventListener('popstate', () => {
      this.pops++
      this.shown = b.cur.url
    })
  }
  private idx() {
    return ((this.b.history.state as St)?.idx as number) ?? 0
  }
  push(url: string) {
    this.b.history.pushState({ usr: null, key: `r${++this.n}`, idx: this.idx() + 1 }, '', url)
    this.shown = url
  }
  replace(url: string) {
    this.b.history.replaceState({ usr: null, key: `r${++this.n}`, idx: this.idx() }, '', url)
    this.shown = url
  }
}

function setup() {
  const b = new FakeBrowser('/', { usr: null, key: 'r0', idx: 0 })
  const layers = createBackLayers(b)
  const r = new FakeRouter(b)
  r.push('/joueurs')
  return { b, layers, r }
}
/** Fenêtre de test : ouverte, avec sa fermeture notée. */
function win(layers: ReturnType<typeof createBackLayers>) {
  const w = { open: true, layer: null as unknown as ReturnType<typeof layers.open> }
  w.layer = layers.open(() => (w.open = false))
  return w
}
/** Fermeture par l'appli (✕, Échap) : comme useBackCloses une fois la fenêtre démontée. */
function shut(layers: ReturnType<typeof createBackLayers>, w: ReturnType<typeof win>) {
  w.open = false
  layers.release(w.layer)
}

// ---------- 3. Le geste Retour ferme la fenêtre, on reste sur l'écran ----------
{
  const { b, layers, r } = setup()
  const w = win(layers)
  assert.equal(b.entries.length, 3, 'une entrée de plus pour la fenêtre')
  assert.equal(b.cur.url, '/joueurs', 'même adresse')
  assert.equal(depthOf(b.history.state), 1)
  b.back()
  assert.equal(w.open, false, 'la fenêtre se ferme')
  assert.equal(r.shown, '/joueurs', 'on reste sur la liste')
  assert.equal(r.pops, 0, 'le routeur ne voit rien (pas de changement d’écran, pas de position remise)')
  layers.release(w.layer) // démontage après la fermeture : rien de plus
  b.flush()
  assert.equal(b.i, 1)
  // Retour suivant : on quitte la liste.
  b.back()
  assert.equal(r.shown, '/')
  assert.equal(r.pops, 1)
}

// ---------- 4. Fermée par son ✕ : pas de retour pour rien ensuite ----------
{
  const { b, layers, r } = setup()
  const w = win(layers)
  shut(layers, w)
  b.flush()
  assert.equal(b.i, 1, 'son entrée est retirée')
  assert.equal(r.pops, 0)
  b.back()
  assert.equal(r.shown, '/', 'un seul retour quitte la liste')
  // « Avancer » du navigateur vers l'entrée de la fenêtre fermée : rien à rouvrir ; le retour suivant ne reste pas en place.
  b.forward()
  assert.equal(r.shown, '/joueurs')
  b.forward()
  assert.equal(r.shown, '/joueurs')
  b.back()
  assert.equal(r.shown, '/', 'pas de retour pour rien')
}

// ---------- 5. La fenêtre se ferme parce que l'appli ouvre un autre écran ----------
{
  const { b, layers, r } = setup()
  const w = win(layers)
  // Carte acceptée : la fenêtre se ferme et l'écran s'ouvre dans le même geste.
  w.open = false
  r.push('/groupes/g1')
  layers.release(w.layer)
  b.flush()
  assert.equal(b.entries.length, 3, "l'écran prend la place de l'entrée de la fenêtre")
  assert.equal(r.shown, '/groupes/g1')
  assert.equal(depthOf(b.history.state), 0)
  b.back()
  assert.equal(r.shown, '/joueurs', "un retour : l'écran d'où la fenêtre a été ouverte")
  b.back()
  assert.equal(r.shown, '/')
}

// ---------- 6. Fenêtre ouverte depuis une autre ----------
{
  const { b, layers, r } = setup()
  const filtres = win(layers)
  const choix = win(layers)
  b.back()
  assert.equal(choix.open, false, 'le retour ferme celle du dessus')
  assert.equal(filtres.open, true, 'la fenêtre du dessous reste ouverte')
  b.back()
  assert.equal(filtres.open, false)
  assert.equal(r.shown, '/joueurs')
  assert.equal(r.pops, 0)
  // Les deux fermées ensemble par l'appli : les deux entrées retirées.
  const f2 = win(layers)
  const c2 = win(layers)
  c2.layer.releasing = true // démontée en même temps que sa fenêtre
  shut(layers, f2)
  layers.release(c2.layer)
  b.flush()
  assert.equal(b.i, 1)
  b.back()
  assert.equal(r.shown, '/')
}

// ---------- 7. Palette ✦ remplacée par la carte d'action ----------
{
  const { b, layers, r } = setup()
  const palette = win(layers)
  const carte = win(layers) // ouverte avant le démontage (différé) de la palette
  palette.open = false
  layers.release(palette.layer)
  b.flush()
  assert.equal(b.i, 3, 'rien ne bouge : la carte est au-dessus')
  // a) Carte fermée par ✕ : retour à l'écran, sans entrée morte.
  shut(layers, carte)
  b.flush()
  assert.equal(b.i, 1)
  assert.equal(r.pops, 0)
  b.back()
  assert.equal(r.shown, '/')
}
{
  const { b, layers, r } = setup()
  const palette = win(layers)
  const carte = win(layers)
  palette.open = false
  layers.release(palette.layer)
  // b) Geste Retour sur la carte : elle se ferme, on reste sur l'écran ; le retour suivant le quitte.
  b.back()
  assert.equal(carte.open, false)
  assert.equal(r.shown, '/joueurs')
  assert.equal(b.i, 1, "l'entrée vide de la palette est sautée")
  b.back()
  assert.equal(r.shown, '/')
}
{
  const { b, layers, r } = setup()
  const palette = win(layers)
  const carte = win(layers)
  palette.open = false
  layers.release(palette.layer)
  // c) Carte acceptée qui ouvre un groupe : le retour ramène à l'écran d'origine, puis le quitte, un geste chacun.
  carte.open = false
  r.push('/groupes/g1')
  layers.release(carte.layer)
  b.flush()
  b.back()
  assert.equal(r.shown, '/joueurs')
  b.back()
  assert.equal(r.shown, '/')
}

// ---------- 8. Adresse changée pendant que la fenêtre est ouverte (filtres notés dans l'adresse) ----------
{
  const { b, layers, r } = setup()
  const w = win(layers)
  r.replace('/joueurs?poste=ali')
  assert.equal(depthOf(b.history.state), 1, "l'entrée reste celle de la fenêtre")
  b.back()
  assert.equal(w.open, false)
  assert.equal(b.cur.url, '/joueurs?poste=ali', 'les filtres choisis restent')
  assert.equal(r.shown, '/joueurs?poste=ali')
  assert.equal(r.pops, 0)
  // Même chose fermée par ✕.
  const w2 = win(layers)
  r.replace('/joueurs?poste=pivot')
  shut(layers, w2)
  b.flush()
  assert.equal(b.cur.url, '/joueurs?poste=pivot')
  assert.equal(depthOf(b.history.state), 0)
  assert.equal(r.pops, 0)
  b.back()
  assert.equal(r.shown, '/')
}

// ---------- 9. Rechargement pendant qu'une fenêtre était ouverte ----------
{
  const b = new FakeBrowser('/', { usr: null, key: 'r0', idx: 0 })
  b.entries.push({ state: { usr: null, key: 'r1', idx: 1 }, url: '/joueurs' }, { state: { usr: null, key: 'r1', idx: 1, hbModal: 1 }, url: '/joueurs' })
  b.i = 2
  createBackLayers(b) // page rechargée : la fenêtre n'est plus là
  const r = new FakeRouter(b)
  b.back()
  assert.equal(r.shown, '/', 'un seul retour quitte la liste')
}

// ---------- 10. Un autre écran remplace celui de la fenêtre (adresse remplacée, autre écran) ----------
{
  const { b, layers, r } = setup()
  const w = win(layers)
  w.open = false
  r.replace('/bilan')
  layers.release(w.layer)
  b.flush()
  assert.equal(r.shown, '/bilan')
  b.back()
  assert.equal(r.shown, '/joueurs', "retour : l'écran d'où la fenêtre a été ouverte")
}

console.log('test-retour : OK')
