// Mesure (pas un test) : ouverture du Bilan de détection (/bilan, carte de France) dans un vrai Chrome, sur 40 000 fiches
// FICTIVES écrites dans la base locale de l'origine (IndexedDB « handbase-essai » du serveur d'essai, jamais Supabase), avec
// le processeur ralenti (téléphone milieu de gamme ≈ ×4 à ×6). Chrome sans écran piloté par le protocole DevTools.
//
//   1. serveur d'essai SANS base partagée (port libre) :
//        VITE_TRIAL=1 VITE_SUPABASE_URL= VITE_SUPABASE_ANON_KEY= npx vite --port 5198 --strictPort
//   2. node --experimental-websocket tools/bench-page-bilan.mjs [--port 5198] [--cpu 1,4,6] [--runs 3] [--device phone|desktop]
//      node --experimental-websocket tools/bench-page-bilan.mjs --fingerprint avant.json   (chiffres affichés, pour comparer)
//
// Profil Chrome jetable (dossier temporaire) : rien n'est écrit ailleurs. Données fictives (mêmes fiches que
// tools/bench-page-joueurs.mjs, tirées sur 32 bits, plus « vu », avis, événements, « à revoir », deux profils recherchés, un comité fictif) :
// aucune personne réelle. Scénarios (rôle administrateur du serveur d'essai : les 4 onglets) :
//   1er démarrage : appli rechargée directement sur /bilan, sans carte gardée sur l'appareil (src/bilanSnapshot.ts) ;
//   démarrage : appli rechargée directement sur /bilan (rien en mémoire ; bilan déjà ouvert sur cet appareil) ;
//   ouverture : accueil rechargé, puis « Bilan » dans le menu (premier passage de la session) ;
//   retour    : du bilan, « Joueurs » dans le menu, puis « Retour » (navigateur) ;
//   revisite  : accueil, puis de nouveau « Bilan ».
// Mesures : carte dessinée (contours), carte en couleur (chiffres de la dernière visite ou frais), chiffres prêts (tuiles des 4 onglets, plus de « … » ni de « mise à jour »), plus long
// blocage du fil principal, mémoire JS. --profile cold|open|back|again : profil du processeur de ce scénario (25 fonctions les plus lourdes).
// --accueil : appli rechargée sur l'accueil (tâches longues des 8 premières secondes), puis Joueurs, puis Bilan : ce que
// coûte la préparation du bilan au démarrage (src/coverageCache.ts warmCoverage).
// --detail : durée de chaque lecture (IndexedDB) et de chaque calcul, refaits dans la page.
// --fingerprint <fichier> : pour une liste d'états (onglets, filtres, lieux, « Voir comme… »), le texte de la page, les
// couleurs et les chiffres de la carte, enregistrés pour comparer avant / après (node tools/bench-page-bilan.mjs --compare a.json b.json).
//
// Mesures du 25/10/2026 (médianes de 3 ; carte dessinée / carte en couleur / chiffres prêts, en ms ; « avant » : une seule
// valeur, la page n'apparaissait qu'avec tous ses chiffres) :
//   téléphone 412×915         avant                               après
//   ×1 1er démarrage           3409                               249 / 1233 / 1597
//      démarrage               3361                               282 /  282 / 1657
//      ouverture (menu)        2006                               172
//      retour / revisite       1644 / 1558                         91 / 58
//   ×4 1er démarrage           7630                               721 / 2896 / 3860
//      démarrage               7664                               844 /  844 / 4033
//      ouverture (menu)        5352                               674
//      retour / revisite       4128 / 3958                        350 / 211
//   ×6 1er démarrage          11889                              1075 / 4716 / 6112
//      démarrage              11648                              1287 / 1287 / 6951
//      ouverture (menu)        7339                              1175
//      retour / revisite       6118 / 5930                        576 / 357
//   plus long blocage ×4 (ouverture) 971 → 291 ms ; mémoire JS 133 → 94 Mo. Ordinateur 1440×900 : mêmes ordres de grandeur.
//   --accueil ×4 : menu 293 → 291 ms, blocage des 8 premières secondes 4,0 → 3,3 s, Joueurs 486 / 2014 → 549 / 1723.
//   Le temps partait dans les lectures (toute la base relue à chaque ouverture, les fiches deux fois au démarrage) et les
//   calculs refaits à chaque passage ; pas dans le dessin de la carte.
import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`)
  return i > 0 ? process.argv[i + 1] : d
}

// ---------- Comparaison de deux relevés (sans Chrome) ----------
if (process.argv.includes('--compare')) {
  const i = process.argv.indexOf('--compare')
  const [a, b] = [process.argv[i + 1], process.argv[i + 2]].map((f) => JSON.parse(readFileSync(f, 'utf8')))
  let diff = 0
  for (const k of Object.keys(a)) {
    for (const part of Object.keys(a[k])) {
      if (JSON.stringify(a[k][part]) === JSON.stringify(b[k]?.[part])) continue
      diff++
      const x = String(a[k][part]).split('\n')
      const y = String(b[k]?.[part] ?? '').split('\n')
      const at = x.findIndex((l, j) => l !== y[j])
      console.log(`DIFFÉRENT ${k} / ${part} (ligne ${at}) :\n  avant : ${x.slice(at, at + 3).join(' ⏎ ')}\n  après : ${y.slice(at, at + 3).join(' ⏎ ')}`)
    }
  }
  console.log(diff ? `${diff} différence(s)` : `Identiques : ${Object.keys(a).length} états`)
  process.exit(diff ? 1 : 0)
}

const PORT = Number(arg('port', 5198))
const CPUS = String(arg('cpu', '1,4,6')).split(',').map(Number)
const RUNS = Number(arg('runs', 3))
const N = Number(arg('n', 40000))
const MOBILE = arg('device', 'phone') === 'phone'
// --profile cold|open|back|again : profil du processeur de ce scénario (premier passage de chaque ralenti).
const PROFILE = process.argv.includes('--profile') ? arg('profile', 'open') : ''
const FINGERPRINT = arg('fingerprint', '')
const ORIGIN = `http://localhost:${PORT}`

// ---------- Chrome et protocole DevTools ----------
const profile = mkdtempSync(join(tmpdir(), 'bench-bilan-'))
const chrome = spawn('google-chrome', ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--enable-precise-memory-info', '--disable-features=BackForwardCache', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'], detached: true })
// Chrome arrêté et profil effacé, même sur une erreur. google-chrome lance ses processus dans son propre groupe : tout le
// groupe est arrêté, puis le profil effacé une fois Chrome sorti (il écrit encore un instant).
const stopChrome = () => {
  try {
    process.kill(-chrome.pid, 'SIGTERM')
  } catch {
    chrome.kill()
  }
}
const cleanup = () => {
  stopChrome()
  try {
    rmSync(profile, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 })
  } catch (e) {
    console.error(`Profil Chrome à effacer à la main : ${profile} (${e.code})`)
  }
}
const finish = async (code = 0) => {
  ws.close()
  stopChrome()
  await new Promise((ok) => (chrome.exitCode !== null ? ok() : chrome.once('exit', ok)))
  for (let i = 0; i < 50; i++) {
    try {
      rmSync(profile, { recursive: true, force: true })
      break
    } catch {
      await sleep(100)
    }
  }
  process.exit(code)
}
process.on('exit', cleanup)
process.on('uncaughtException', (e) => (console.error(e), process.exit(1)))
process.on('unhandledRejection', (e) => (console.error(e), process.exit(1)))
const wsUrl = await new Promise((ok, ko) => {
  let buf = ''
  chrome.stderr.on('data', (d) => {
    buf += d
    const m = buf.match(/DevTools listening on (ws:\/\/\S+)/)
    if (m) ok(m[1])
  })
  setTimeout(() => ko(new Error('Chrome ne répond pas')), 15000)
})
const ws = new WebSocket(wsUrl)
await new Promise((ok) => (ws.onopen = ok))
let seq = 0
const waiting = new Map()
const handlers = []
ws.onmessage = (e) => {
  const m = JSON.parse(e.data)
  if (m.id && waiting.has(m.id)) {
    const { ok, ko } = waiting.get(m.id)
    waiting.delete(m.id)
    m.error ? ko(new Error(JSON.stringify(m.error))) : ok(m.result)
  } else if (m.method) handlers.forEach((h) => h(m))
}
const send = (method, params = {}, sessionId) =>
  new Promise((ok, ko) => {
    const id = ++seq
    waiting.set(id, { ok, ko })
    ws.send(JSON.stringify({ id, method, params, sessionId }))
  })
const { targetId } = await send('Target.createTarget', { url: 'about:blank' })
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
const S = (method, params) => send(method, params, sessionId)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function evaluate(expression, tries = 3) {
  const r = await S('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }).catch(async (e) => {
    if (!tries || !/navigated or closed|context/.test(e.message)) throw e
    await sleep(1500)
    return { retry: true }
  })
  if (r.retry) return evaluate(expression, tries - 1)
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? JSON.stringify(r.exceptionDetails))
  return r.result.value
}
const loaded = () => new Promise((ok) => handlers.push(function h(m) {
  if (m.method === 'Page.loadEventFired') (handlers.splice(handlers.indexOf(h), 1), ok())
}))
async function goto(path) {
  const l = loaded()
  await S('Page.navigate', { url: ORIGIN + path })
  await l
}
await S('Page.enable')
await S('Runtime.enable')
await S('Performance.enable')
await S('Emulation.setDeviceMetricsOverride', MOBILE ? { width: 412, height: 915, deviceScaleFactor: 2.6, mobile: true } : { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })
if (MOBILE) await S('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 })

// Sonde posée dans chaque page : carte dessinée, chiffres prêts, plus long blocage, à partir d'un top (ou du chargement : t0 = 0).
await S('Page.addScriptToEvaluateOnNewDocument', {
  source: `(() => {
    const b = (window.__bench = { t0: -1, boot: 0, map: 0, paint: 0, full: 0, longest: 0, blocked: 0 })
    if (sessionStorage.getItem('bench.cold') === '1') (sessionStorage.removeItem('bench.cold'), (b.t0 = 0))
    new PerformanceObserver((l) => { for (const e of l.getEntries()) if (b.t0 >= 0 && e.startTime >= b.t0 && !b.full) { b.longest = Math.max(b.longest, e.duration); b.blocked += Math.max(0, e.duration - 50) } }).observe({ type: 'longtask', buffered: true })
    const check = () => {
      if (b.t0 < 0 || location.pathname !== '/bilan') return
      const now = performance.now() - b.t0
      if (!b.boot && document.querySelector('a[href="/joueurs"]')) b.boot = now
      const paths = document.querySelectorAll('.map-surface svg path').length
      if (!b.map && paths >= 90) b.map = now
      // Carte en couleur (dernière visite gardée sur l'appareil, ou chiffres frais) : une zone peinte avec l'échelle.
      if (b.map && !b.paint && [...document.querySelectorAll('.map-surface svg path')].some((p) => /--color-scale/.test(p.getAttribute('fill') ?? ''))) b.paint = now
      const tabs = document.querySelector('[role=tablist][aria-label="Ce que montre la carte"]')
      if (b.map && !b.full && tabs && !/…/.test(tabs.textContent) && !document.querySelector('[data-bilan-stale]') && !/Chargement/.test(document.querySelector('main')?.textContent ?? '')) b.full = now
    }
    // Vérifié à chaque image (pas à chaque changement de la page : la sonde elle-même ralentissait la page mesurée).
    const frame = () => { check(); if (b.t0 >= 0 && !b.full) requestAnimationFrame(frame) }
    if (b.t0 === 0) requestAnimationFrame(frame)
    window.__benchStart = () => (Object.assign(b, { t0: performance.now(), boot: 0, map: 0, paint: 0, full: 0, longest: 0, blocked: 0 }), setTimeout(() => requestAnimationFrame(frame), 0))
  })()`,
})

// ---------- Données fictives (une fois) ----------
const SEED = `(async (N) => {
  const { db } = await import('/src/db.ts')
  if ((await db.players.count()) === N && (await db.units.get('un-83'))?.code === 'bench-v3') return 'déjà là'
  for (const t of ['players', 'measurements', 'seen', 'evaluations', 'events', 'rewatch', 'alerts', 'levels', 'units', 'assignments']) await db[t].clear()
  // Tirage sur 32 bits (mulberry32) : reproductible, sans les cycles courts d'un calcul en nombres flottants.
  let s = 7
  const rnd = () => { s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
  const pick = (xs) => xs[Math.floor(rnd() * xs.length)]
  const SYL = ['ma','ri','lo','du','pon','ber','nar','le','fe','vre','mo','reau','ga','tier','dre','si','mon','la','cour','ti','neau','bou','chet','roy']
  const FIRST = ['Lucas','Léa','Jean-Pierre','Inès','Hugo','Zoé','Noah','Jade','Tom','Lina','Mathéo','Chloé','Rémi','Manon','Gabin','Louise']
  const POS = ['GB','AG','ARG','DC','ARD','AD','PIV', undefined]
  const HANDS = ['droitier','gaucher','ambidextre', undefined]
  const now = Date.now()
  const players = [], ms = []
  for (let i = 0; i < N; i++) {
    const c = Math.floor(rnd() * 1400), dept = String(10 + (c % 85)).padStart(2, '0')
    const odd = ['de la Tour', 'De La Tour', 'Élise', 'eloi', 'Zz', 'van Damme', 'Ølsen', ' Espace', 'b', '']
    const ln = i % 997 === 3 ? odd[(i / 997 | 0) % odd.length] : pick(SYL) + pick(SYL) + (rnd() < 0.5 ? pick(SYL) : '')
    const sex = rnd() < 0.5 ? 'M' : 'F'
    const id = 'bench-' + i
    players.push({
      id, updatedAt: now - i, firstName: pick(FIRST), lastName: i % 997 === 3 ? ln : ln[0].toUpperCase() + ln.slice(1), mergedInto: i % 613 === 5 ? 'bench-1' : undefined,
      birthDate: (2008 + Math.floor(rnd() * 6)) + '-' + String(1 + Math.floor(rnd() * 12)).padStart(2, '0') + '-' + String(1 + Math.floor(rnd() * 28)).padStart(2, '0'),
      sex, position: pick(POS), laterality: pick(HANDS), license: '6' + dept + String(1000000 + i).slice(-7),
      licenseStatus: 'QUALIFIE', licenseRequestType: rnd() < 0.7 ? 'RENOUVELLEMENT' : 'CREATION', clubCode: String(50 + Math.floor(c / 1000)) + dept + String(c % 1000).padStart(3, '0'),
      club: 'HBC Fictif ' + c, nationality: 'FRANCAISE', category: sex === 'M' ? '-15 ans M' : '-15 ans F', team: rnd() < 0.3 ? 'Équipe ' + (c % 9) : undefined,
      createdBy: 'staff-fictif', createdByName: 'Staff Fictif', createdAtServer: '2026-09-01T10:00:00Z', updatedByName: 'Staff Fictif', updatedAtServer: '2026-09-01T10:00:00Z',
      review: i % 400 === 0 ? 'pending' : i % 997 === 0 ? 'refused' : undefined, deleted: i % 250 === 0 ? true : undefined,
    })
    if (rnd() < 0.6) for (let k = 0, n = 1 + Math.floor(rnd() * 3); k < n; k++) {
      const date = '202' + (4 + k) + '-03-1' + k, h = 150 + Math.floor(rnd() * 40) + k * 3
      ms.push({ id: id + '-t' + k, playerId: id, criterionId: 'taille', value: h, date, updatedAt: now, author: 'Staff Fictif' })
      ms.push({ id: id + '-p' + k, playerId: id, criterionId: 'poids', value: Math.round(h * 0.33 + rnd() * 10), date, updatedAt: now, author: 'Staff Fictif' })
    }
    if (rnd() < 0.3) ms.push({ id: id + '-v', playerId: id, criterionId: 'vma', value: 12 + Math.floor(rnd() * 6), date: '2026-03-10', updatedAt: now })
    // Tailles déclarées à la licence (pas « mesurées par le staff ») pour 20 %.
    if (rnd() < 0.2) ms.push({ id: id + '-d', playerId: id, criterionId: 'taille', value: 160 + Math.floor(rnd() * 30), date: '2026-09-01', updatedAt: now, author: 'Licence FFHB (déclarée)' })
  }
  // Événements (2 saisons ; quelques-uns supprimés), « vu » (≈ 35 % des joueurs, 1 à 3 fois), avis (≈ 15 %), « à revoir ».
  const events = []
  for (let e = 0; e < 400; e++) {
    const y = e % 2 ? 2025 : 2026, m = e % 2 ? 1 + (e % 12) : 1 + (e % 10)
    events.push({ id: 'ev-' + e, name: 'Tournoi fictif ' + e, type: pick(['match', 'tournoi', 'observation']), date: y + '-' + String(m).padStart(2, '0') + '-' + String(1 + (e % 28)).padStart(2, '0'), updatedAt: now, deleted: e % 97 === 0 ? true : undefined })
  }
  const seen = [], evals = [], rewatch = []
  const staff = ['staff-a', 'staff-b', 'staff-c', 'local']
  for (let i = 0; i < N; i++) {
    const id = 'bench-' + i
    if (rnd() < 0.35) for (let k = 0, n = 1 + Math.floor(rnd() * 3); k < n; k++) {
      const ev = pick(events), who = pick(staff)
      seen.push({ id: who + ':' + ev.id + ':' + id, eventId: ev.id, playerId: id, at: ev.date + 'T1' + (k % 10) + ':00:00Z', createdBy: who === 'local' ? undefined : who, createdByName: who === 'local' ? undefined : 'Staff ' + who.slice(-1).toUpperCase(), updatedAt: now - k, deleted: rnd() < 0.02 ? true : undefined })
    }
    if (rnd() < 0.15) {
      const ev = rnd() < 0.8 ? pick(events) : undefined
      const r = rnd()
      evals.push({ id: id + '-e', playerId: id, eventId: ev?.id, contextType: ev ? undefined : 'club', observer: 'Staff Fictif', observerId: pick(staff), date: ev?.date ?? '2026-10-0' + (1 + (i % 9)), scores: { attaque: 1 + Math.floor(rnd() * 5), defense: 1 + Math.floor(rnd() * 5) }, review: r < 0.7 ? 'validated' : r < 0.9 ? 'pending' : 'refused', updatedAt: now })
    }
    if (rnd() < 0.02) rewatch.push({ id: id + '-r', playerId: id, events: [pick(events).id], updatedAt: now })
  }
  await db.criteria.bulkPut([
    { id: 'taille', label: 'Taille', category: 'Gabarit', kind: 'factual', scale: 'number', unit: 'cm', order: 1, updatedAt: now },
    { id: 'poids', label: 'Poids', category: 'Gabarit', kind: 'factual', scale: 'number', unit: 'kg', order: 2, updatedAt: now },
    { id: 'vma', label: 'VMA', category: 'Tests', kind: 'factual', scale: 'number', unit: 'km/h', order: 3, updatedAt: now },
    { id: 'attaque', label: 'Attaque', category: 'Jeu', kind: 'rating', scale: '1-5', order: 4, updatedAt: now },
    { id: 'defense', label: 'Défense', category: 'Jeu', kind: 'rating', scale: '1-5', order: 5, updatedAt: now },
  ])
  // Deux profils recherchés (onglet « Profils repérés ») ; un comité fictif (83) et un compte qui y est affecté (« Voir comme… »).
  await db.alerts.bulkPut([
    { id: 'al-1', name: 'Grands 2011', rules: { sex: 'M', years: ['2011'], minHeight: 175 }, updatedAt: now },
    { id: 'al-2', name: 'Gauchères', rules: { sex: 'F', laterality: 'gaucher' }, updatedAt: now },
  ])
  await db.levels.bulkPut([{ id: 'lv-comite', name: 'Comité', order: 2, updatedAt: now }])
  await db.units.bulkPut([{ id: 'un-83', levelId: 'lv-comite', name: 'Comité Fictif (83)', departments: ['83'], code: 'bench-v3', updatedAt: now }])
  await db.assignments.bulkPut([{ id: 'as-1', userId: 'obs-fictif', unitId: 'un-83', role: 'membre', updatedAt: now }])
  const put = async (t, rows) => { for (let i = 0; i < rows.length; i += 5000) await db[t].bulkPut(rows.slice(i, i + 5000)) }
  await db.events.bulkPut(events)
  await put('players', players); await put('measurements', ms); await put('seen', seen); await put('evaluations', evals); await put('rewatch', rewatch)
  return players.length + ' fiches, ' + ms.length + ' mesures, ' + seen.length + ' « vu », ' + evals.length + ' avis, ' + rewatch.length + ' à revoir, ' + events.length + ' événements'
})(${N})`

const memMB = async () => {
  await S('HeapProfiler.collectGarbage').catch(() => {})
  const m = await S('Performance.getMetrics')
  return Math.round(m.metrics.find((x) => x.name === 'JSHeapUsedSize').value / 1e6)
}

function printProfile(p) {
  const self = new Map()
  const dt = p.timeDeltas
  const byId = new Map(p.nodes.map((n) => [n.id, n]))
  p.samples.forEach((id, i) => {
    const f = byId.get(id).callFrame
    const k = `${f.functionName || '(anonyme)'}  ${f.url.replace(/^.*\/(src|node_modules\/\.vite\/deps)\//, '$1/').replace(/\?.*$/, '')}:${f.lineNumber + 1}`
    self.set(k, (self.get(k) ?? 0) + (dt[i] ?? 0) / 1000)
  })
  const total = [...self.values()].reduce((a, b) => a + b, 0)
  console.log(`Profil (${Math.round(total)} ms échantillonnés) :`)
  for (const [k, v] of [...self].sort((a, b) => b[1] - a[1]).slice(0, 25)) console.log(`  ${String(Math.round(v)).padStart(6)} ms  ${k}`)
  // --timeline : ce qui occupe le fil principal, par tranche de 250 ms (les 3 fonctions les plus lourdes de chaque tranche).
  if (!process.argv.includes('--timeline')) return
  const buckets = new Map()
  let t = 0
  p.samples.forEach((id, i) => {
    t += (dt[i] ?? 0) / 1000
    const f = byId.get(id).callFrame
    const name = f.functionName || '(anonyme)'
    if (name === '(idle)' || name === '(program)') return
    const k = `${name} ${f.url.replace(/^.*\/(src|node_modules\/\.vite\/deps)\//, '').replace(/\?.*$/, '')}:${f.lineNumber + 1}`
    const b = Math.floor(t / 250)
    if (!buckets.has(b)) buckets.set(b, new Map())
    buckets.get(b).set(k, (buckets.get(b).get(k) ?? 0) + (dt[i] ?? 0) / 1000)
  })
  for (const [b, m] of [...buckets].sort((x, y) => x[0] - y[0])) {
    const busy = [...m.values()].reduce((x, y) => x + y, 0)
    console.log(`  ${String(b * 250).padStart(5)} ms  occupé ${String(Math.round(busy)).padStart(3)} ms : ${[...m].sort((x, y) => y[1] - x[1]).slice(0, 3).map(([k, v]) => `${k} ${Math.round(v)}`).join(' · ')}`)
  }
}

async function waitQuiet(ms = 1500, max = 60000) {
  await evaluate(`new Promise((ok) => { let last = performance.now(); new PerformanceObserver(() => (last = performance.now())).observe({ type: 'longtask' }); const s = performance.now(); const i = setInterval(() => { if (performance.now() - last > ${ms} || performance.now() - s > ${max}) (clearInterval(i), ok()) }, 100) })`)
}
async function waitBench() {
  const s = Date.now()
  for (;;) {
    const b = await evaluate('window.__bench')
    if (b.full || Date.now() - s > 120000) return { boot: Math.round(b.boot), map: Math.round(b.map), paint: Math.round(b.paint), full: Math.round(b.full), longest: Math.round(b.longest) }
    await sleep(50)
  }
}
async function measure(click) {
  await evaluate('window.__benchStart()')
  await evaluate(click)
  return waitBench()
}
async function profiled(k, r, f) {
  if (PROFILE !== k || r) return f()
  await S('Profiler.enable').then(() => S('Profiler.setSamplingInterval', { interval: 500 })).then(() => S('Profiler.start'))
  const v = await f()
  printProfile((await S('Profiler.stop')).profile)
  return v
}
const clickNav = (to) => `document.querySelector('a[href="${to}"]').click()`

await goto('/')
await sleep(1500)
console.log('Données :', await evaluate(SEED))

// ---------- Détail des lectures et des calculs (--detail), refaits dans la page ----------
const DETAIL = `(async () => {
  const { db, alive } = await import('/src/db.ts')
  const cov = await import('/src/coverage.ts')
  const { department } = await import('/src/components/PlayerFilter.tsx')
  const { regionOfDept } = await import('/src/lists.ts')
  const t = () => performance.now()
  const out = {}
  const time = async (k, f) => { const a = t(); const v = await f(); out[k] = Math.round(t() - a); return v }
  const players = await time('idbPlayers', () => db.players.toArray())
  const seen = await time('idbSeen', () => db.seen.toArray())
  const evals = await time('idbEvals', () => db.evaluations.toArray())
  const dead = await time('idbDeadEvents', () => db.events.filter((e) => !!e.deleted).primaryKeys())
  await time('idbEvents', () => db.events.toArray())
  await time('idbRewatch', () => db.rewatch.toArray())
  const ms = await time('idbMeasures', () => db.measurements.toArray())
  const sights = await time('toSights', () => cov.toSights(seen, evals, { deadEvents: new Set(dead) }))
  const last = await time('lastSights', () => cov.lastSights(sights, cov.seasonOf(new Date().toLocaleDateString('sv'))))
  await time('staffMeasured', () => cov.staffMeasured(ms))
  const place = { deptOf: department, regionOf: (d) => regionOfDept(d) }
  const forMap = await time('filterPlayers', () => cov.filterPlayers(players, { sex: 'all', years: [] }, place))
  await time('coverageByPlace', () => cov.coverageByPlace(forMap, last, place))
  await time('coverageByYear', () => cov.coverageByYear(forMap, last))
  await time('coverageByClub', () => cov.coverageByClub(forMap, last))
  const alerts = await import('/src/alerts.ts')
  await time('loadAlertContext', () => alerts.loadAlertContext())
  await time('computeAlerts', () => alerts.computeAlerts())
  // Lecture par paquets (src/playersCache.ts readByChunks) : durée totale et plus long blocage selon la taille des paquets.
  const chunked = async (table, n) => { const rows = []; for (;;) { const last = rows.length ? rows[rows.length - 1].id : undefined; const part = await (last === undefined ? table.limit(n) : table.where(':id').above(last).limit(n)).toArray(); for (const r of part) rows.push(r); if (part.length < n) return rows } }
  for (const [name, table] of [['fiches', db.players], ['mesures', db.measurements]])
    for (const n of [2500, 5000, 10000, 20000, 0]) {
      let longest = 0
      const obs = new PerformanceObserver((l) => { for (const e of l.getEntries()) longest = Math.max(longest, e.duration) })
      obs.observe({ type: 'longtask' })
      await time(name + (n ? ' par ' + n : ' en une fois'), () => (n ? chunked(table, n) : table.toArray()))
      await new Promise((r) => setTimeout(r, 300))
      obs.disconnect()
      out[name + (n ? ' par ' + n : ' en une fois') + ' (blocage)'] = Math.round(longest)
    }
  return out
})()`
if (process.argv.includes('--detail')) {
  for (const cpu of CPUS) {
    await S('Emulation.setCPUThrottlingRate', { rate: cpu })
    await goto('/')
    await waitQuiet()
    console.log(`×${cpu} détail (ms) :`, await evaluate(DETAIL))
  }
  await finish()
}

// ---------- Démarrage de l'appli sur l'accueil (--accueil) : la préparation du bilan ne doit rien ralentir ----------
// Accueil rechargé : menu affiché, tâches longues des 8 premières secondes (total au-delà de 50 ms, plus longue) ; puis, à
// 8 s, « Joueurs » : premières lignes et liste prête (mêmes repères que tools/bench-page-joueurs.mjs), puis « Bilan ».
if (process.argv.includes('--accueil')) {
  const res = []
  for (const cpu of CPUS) {
    await S('Emulation.setCPUThrottlingRate', { rate: cpu })
    for (let r = 0; r < RUNS; r++) {
      await goto('/joueurs')
      await waitQuiet()
      await evaluate(`sessionStorage.setItem('bench.cold', '1')`)
      await goto('/')
      const start = await evaluate(`new Promise((ok) => { const b = { menu: 0, longest: 0, blocked: 0 }; new PerformanceObserver((l) => { for (const e of l.getEntries()) if (e.startTime < 8000) { b.longest = Math.max(b.longest, e.duration); b.blocked += Math.max(0, e.duration - 50) } }).observe({ type: 'longtask', buffered: true }); const i = setInterval(() => { if (!b.menu && document.querySelector('a[href="/bilan"]')) b.menu = performance.now(); if (performance.now() > 8000) (clearInterval(i), ok(b)) }, 20) })`)
      await evaluate('window.__benchStart()')
      await evaluate(`document.querySelector('a[href="/joueurs"]').click()`)
      const j = await evaluate(`new Promise((ok) => { const t0 = performance.now(); let first = 0; const i = setInterval(() => { const now = performance.now() - t0; if (!first && document.querySelector('a[data-player]')) first = now; const c = document.querySelector('.wait-count'); if (first && c && /\\d/.test(c.textContent) && !/hargement/.test(c.textContent)) (clearInterval(i), ok({ first: Math.round(first), full: Math.round(now) })); if (now > 60000) (clearInterval(i), ok({ first: Math.round(first), full: -1 })) }, 10) })`)
      await waitQuiet()
      const bilan = await measure(clickNav('/bilan'))
      res.push({ cpu, start, j, bilan })
      console.log(`×${cpu} n°${r + 1}  menu ${Math.round(start.menu)} ms  tâches longues (8 s) : ${Math.round(start.blocked)} ms au-delà de 50 ms, plus longue ${Math.round(start.longest)}  Joueurs ${j.first} / ${j.full}  puis Bilan ${bilan.map} / ${bilan.full}`)
    }
  }
  const med = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]
  for (const cpu of CPUS) {
    const rs = res.filter((x) => x.cpu === cpu)
    console.log(`  ×${cpu}  menu ${med(rs.map((x) => Math.round(x.start.menu)))}  blocage ${med(rs.map((x) => Math.round(x.start.blocked)))} (plus longue ${med(rs.map((x) => Math.round(x.start.longest)))})  Joueurs ${med(rs.map((x) => x.j.first))} / ${med(rs.map((x) => x.j.full))}  Bilan ${med(rs.map((x) => x.bilan.map))} / ${med(rs.map((x) => x.bilan.full))}`)
  }
  await finish()
}

// ---------- Relevé des chiffres affichés (avant / après) ----------
if (FINGERPRINT) {
  await S('Emulation.setCPUThrottlingRate', { rate: 1 })
  const base = 's=all&p=saison&v=carte'
  const states = {
    vus: base,
    vusParDept: base + '&m=dept',
    licencies: 'onglet=licencies&' + base,
    mesures: 'onglet=mesures&' + base,
    reperes: 'onglet=reperes&' + base,
    depuisToujours: 's=all&p=tout&v=carte',
    filles: 's=F&p=saison&v=carte',
    garcons2011: 's=M&p=saison&v=carte&a=2011',
    annees: 's=all&p=saison&v=carte&a=2010,2012',
    region: base + '&r=REGION',
    departement: base + '&r=REGION&d=83',
    departementMesures: 'onglet=mesures&' + base + '&r=REGION&d=83',
    club: base + '&r=REGION&d=83&c=CLUB',
    generations: 's=all&p=saison&v=generations',
    nomCherche: base + '&t=mar',
    reperesFilles: 'onglet=reperes&s=F&p=tout&v=carte',
  }
  // Région du 83 (listes de l'appli) ; le club est le premier du 83 dans la liste (clubs « HBC Fictif n »).
  const ctx = await evaluate(`(async () => { const { regionOfDept } = await import('/src/lists.ts'); return { region: regionOfDept('83') } })()`)
  const snap = `(() => {
    const main = document.querySelector('main') ?? document.body
    const map = [...document.querySelectorAll('.map-surface svg path')].map((p) => p.getAttribute('fill') ?? '').join('|')
    const labels = [...document.querySelectorAll('.map-surface svg text, .map-surface [aria-label]')].map((t) => t.getAttribute('aria-label') ?? t.textContent).join('|')
    return { text: main.innerText.replace(/\\n+/g, '\\n'), map, labels }
  })()`
  const out = {}
  const ready = async () => {
    const s = Date.now()
    for (;;) {
      const ok = await evaluate(`(() => { const t = document.querySelector('main')?.textContent ?? ''; return document.querySelectorAll('.map-surface svg path').length >= 1 && !/Chargement/.test(t) && !document.querySelector('[data-bilan-stale]') && !/…/.test(document.querySelector('[role=tablist]')?.textContent ?? '') })()`).catch(() => false)
      if (ok || Date.now() - s > 60000) return
      await sleep(200)
    }
  }
  const visit = async (k, q) => {
    let query = q.replace('REGION', encodeURIComponent(ctx.region ?? ''))
    if (query.includes('CLUB')) {
      // Premier club du 83 dans la liste du département.
      await goto('/bilan?' + query.replace('&c=CLUB', ''))
      await ready()
      await waitQuiet(800)
      const club = await evaluate(`document.querySelector('[data-club]')?.getAttribute('data-club') ?? ''`)
      query = query.replace('CLUB', encodeURIComponent(club))
    }
    await goto('/bilan?' + query)
    // Carte de la dernière visite (src/bilanSnapshot.ts), montrée pendant la lecture : mêmes couleurs que la carte finale.
    const early = await evaluate(`new Promise((ok) => { const s = performance.now(); const i = setInterval(() => { const st = document.querySelector('[data-bilan-stale]'); const n = document.querySelectorAll('.map-surface svg path').length; if ((st && n >= 90) || performance.now() - s > 20000 || (!st && !/Chargement/.test(document.querySelector('main')?.textContent ?? ''))) (clearInterval(i), ok(st && n >= 90 ? [...document.querySelectorAll('.map-surface svg path')].map((p) => p.getAttribute('fill') ?? '').join('|') : null)) }, 5) })`)
    await ready()
    await waitQuiet(800)
    out[k] = await evaluate(snap)
    if (early !== null) (snapSeen++, early === out[k].map || snapDiff++)
    // Même vue retrouvée sans recharger (Joueurs, puis « Retour ») : données et calculs gardés en mémoire ; mêmes chiffres.
    await evaluate(clickNav('/joueurs'))
    await sleep(500)
    await waitQuiet(800)
    await evaluate('history.back()')
    await sleep(300)
    await ready()
    await waitQuiet(800)
    const again = await evaluate(snap)
    const body = (t) => t.slice(t.indexOf('Bilan de détection'))
    const same = body(again.text) === body(out[k].text) && again.map === out[k].map && again.labels === out[k].labels
    if (!same) retourDiff++
    console.log(`  ${k} : ${out[k].text.length} car., ${out[k].map.split('|').length} zones${same ? ', identique au retour' : ' — DIFFÉRENT AU RETOUR'}`)
  }
  let retourDiff = 0
  let snapSeen = 0
  let snapDiff = 0
  for (const [k, q] of Object.entries(states)) await visit(k, q)
  // « Voir comme… » : un observateur fictif du comité fictif (83) ; l'appli repart avec son périmètre.
  await evaluate(`sessionStorage.setItem('handbase.spy', JSON.stringify({ uid: 'obs-fictif', role: 'observateur', departments: ['83'], name: 'Observateur Fictif' }))`)
  await visit('voirComme', base)
  await visit('voirCommeFilles', 's=F&p=tout&v=carte')
  await evaluate(`sessionStorage.removeItem('handbase.spy')`)
  writeFileSync(FINGERPRINT, JSON.stringify(out, null, 1))
  console.log(`Carte de la dernière visite montrée pour ${snapSeen} vue(s), ${snapDiff ? `${snapDiff} différente(s) de la carte finale` : 'chaque fois identique à la carte finale'}`)
  console.log(`Relevé : ${FINGERPRINT}${retourDiff ? ` — ${retourDiff} vue(s) différente(s) au retour` : ' (chaque vue identique au retour)'}`)
  await finish()
}

const results = []
for (const cpu of CPUS) {
  await S('Emulation.setCPUThrottlingRate', { rate: cpu })
  for (let r = 0; r < RUNS; r++) {
    // Premier démarrage : appli rechargée directement sur le bilan, sans carte gardée sur l'appareil (src/bilanSnapshot.ts).
    await goto('/')
    await waitQuiet()
    await evaluate(`localStorage.removeItem('handbase.bilan.carte'); sessionStorage.setItem('bench.cold', '1')`)
    await goto('/bilan')
    const first = await waitBench()
    await waitQuiet()
    // Démarrage : appli rechargée directement sur le bilan (déjà ouvert sur cet appareil : sa dernière carte est gardée).
    await goto('/')
    await waitQuiet()
    await evaluate(`sessionStorage.setItem('bench.cold', '1')`)
    const cold = await profiled('cold', r, async () => (await goto('/bilan'), waitBench()))
    await waitQuiet()
    // Ouverture : accueil rechargé, puis « Bilan ».
    await goto('/')
    await waitQuiet()
    const open = await profiled('open', r, () => measure(clickNav('/bilan')))
    const mem = await memMB()
    await waitQuiet()
    // Retour : Joueurs, puis « Retour ».
    await evaluate(clickNav('/joueurs'))
    await sleep(1000)
    await waitQuiet()
    const back = await profiled('back', r, () => measure('history.back()'))
    await waitQuiet()
    // Revisite : accueil, puis Bilan.
    await evaluate(clickNav('/'))
    await sleep(1000)
    await waitQuiet()
    const again = await profiled('again', r, () => measure(clickNav('/bilan')))
    await waitQuiet()
    results.push({ cpu, run: r + 1, first, cold, open, back, again, mem })
    const f = (x) => `${x.map} / ${x.paint} / ${x.full} (bloc ${x.longest})`
    console.log(`×${cpu} n°${r + 1}  1er démarrage ${f(first)}  démarrage (menu à ${cold.boot}) ${f(cold)}  ouverture ${f(open)}  retour ${f(back)}  revisite ${f(again)}  mémoire ${mem} Mo`)
  }
}
const med = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]
console.log(`\nMédianes (${MOBILE ? 'téléphone 412×915' : 'ordinateur 1440×900'}) — carte dessinée / en couleur / chiffres prêts (plus long blocage), ms`)
for (const cpu of CPUS) {
  const rs = results.filter((r) => r.cpu === cpu)
  const f = (k) => `${med(rs.map((r) => r[k].map))} / ${med(rs.map((r) => r[k].paint))} / ${med(rs.map((r) => r[k].full))} (${med(rs.map((r) => r[k].longest))})`
  console.log(`  ×${cpu}  1er démarrage ${f('first')}   démarrage (menu à ${med(rs.map((r) => r.cold.boot))}) ${f('cold')}   ouverture ${f('open')}   retour ${f('back')}   revisite ${f('again')}   mémoire ${med(rs.map((r) => r.mem))} Mo`)
}
await finish()
