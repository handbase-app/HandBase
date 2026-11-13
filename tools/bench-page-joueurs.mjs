// Mesure (pas un test) : ouverture de la page Joueurs dans un vrai Chrome, sur 40 000 fiches FICTIVES écrites dans la base
// locale de l'origine (IndexedDB « handbase-essai » du serveur d'essai, jamais Supabase), avec le processeur ralenti
// (téléphone milieu de gamme ≈ ×4 à ×6). Chrome sans écran piloté par le protocole DevTools (aucun paquet ajouté).
//
//   1. serveur d'essai SANS base partagée (port libre) :
//        VITE_TRIAL=1 VITE_SUPABASE_URL= VITE_SUPABASE_ANON_KEY= npx vite --port 5198 --strictPort
//   2. node --experimental-websocket tools/bench-page-joueurs.mjs [--port 5198] [--cpu 1,6] [--runs 3] [--n 40000]
//
// Profil Chrome jetable (dossier temporaire) : rien n'est écrit ailleurs. Noms et prénoms tirés de syllabes, clubs « HBC
// Fictif n » : aucune personne réelle. Chaque scénario part de l'accueil, puis touche « Joueurs » dans le menu :
//   ouverture  : premier passage sur la page (rien en mémoire) ;
//   retour     : fiche d'un joueur ouverte depuis la liste, puis « Retour » (navigateur) ;
//   revisite   : accueil, puis de nouveau « Joueurs ».
// Mesures : premières lignes visibles (ms depuis le toucher), liste complète prête (nombre affiché, plus de « chargement »),
// plus long blocage du fil principal, mémoire JS ; puis le détail des lectures (IndexedDB, mesures) faites dans la page et
// des contrôles (ordre recalculé = ordre de l'index, premières fiches = début de la liste). --profile : profil du processeur.
// Serveur de développement (React en mode développement, comme le serveur d'essai ouvert sur le téléphone).
//
// Mesures du 25/10/2026 (médianes de 3, téléphone 412×915 ; premières lignes / liste prête, en ms) :
//                  avant (useLiveQuery sur l'index)            après (src/playersCache.ts)
//   ×1  ouverture  2430 / 2430  retour 2169  revisite 2148     120 / 801   retour 141   revisite 100
//   ×4  ouverture  7595 / 7595  retour 7033  revisite 7089     483 / 2071  retour 487   revisite 370
//   ×6  ouverture 10294 / 10294 retour 10262 revisite 10208    723 / 3136  retour 731   revisite 561
//   ordinateur ×1 : ouverture 2538 avant, 121 / 790 après ; mémoire JS 119 Mo avant, 77 Mo après. Le temps partait dans le suivi de useLiveQuery (Dexie range chaque clé lue
//   sur un index dans un arbre : 40 000 fiches + 93 000 mesures lues par curseur avec anyOf), pas dans les calculs.
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`)
  return i > 0 ? process.argv[i + 1] : d
}
const PORT = Number(arg('port', 5198))
const CPUS = String(arg('cpu', '1,6')).split(',').map(Number)
const RUNS = Number(arg('runs', 3))
const N = Number(arg('n', 40000))
const MOBILE = arg('device', 'phone') === 'phone'
// --profile : profil du processeur pendant la première ouverture (temps propre par fonction, les 25 plus lourdes).
const PROFILE = process.argv.includes('--profile')
const ORIGIN = `http://localhost:${PORT}`

// ---------- Chrome et protocole DevTools ----------
const profile = mkdtempSync(join(tmpdir(), 'bench-joueurs-'))
const chrome = spawn('google-chrome', ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--enable-precise-memory-info', '--disable-features=BackForwardCache', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] })
// Erreur en cours de route : Chrome arrêté et profil effacé quand même.
const cleanup = () => {
  chrome.kill()
  rmSync(profile, { recursive: true, force: true })
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
  // La page peut se recharger d'elle-même au premier lancement (profil neuf) : on réessaie.
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

// Sonde posée dans chaque page : premières lignes, liste prête, plus long blocage (longtask), à partir d'un top donné.
await S('Page.addScriptToEvaluateOnNewDocument', {
  source: `(() => {
    const b = (window.__bench = { t0: 0, first: 0, full: 0, longest: 0, blocked: 0 })
    new PerformanceObserver((l) => { for (const e of l.getEntries()) if (b.t0 && e.startTime >= b.t0 && !b.full) { b.longest = Math.max(b.longest, e.duration); b.blocked += Math.max(0, e.duration - 50) } }).observe({ type: 'longtask', buffered: false })
    const check = () => {
      if (!b.t0) return
      const now = performance.now() - b.t0
      if (!b.first && location.pathname === '/joueurs' && document.querySelector('a[data-player]')) b.first = now
      const c = document.querySelector('.wait-count')
      if (b.first && !b.full && c && /\\d/.test(c.textContent) && !/hargement/.test(c.textContent)) b.full = now
    }
    new MutationObserver(check).observe(document, { subtree: true, childList: true, characterData: true })
    // Liste restée affichée (rien ne change dans la page) : vue à la première image après le toucher.
    const frame = () => { check(); if (b.t0 && !b.full) requestAnimationFrame(frame) }
    window.__benchStart = () => (Object.assign(b, { t0: performance.now(), first: 0, full: 0, longest: 0, blocked: 0 }), setTimeout(() => requestAnimationFrame(frame), 0))
  })()`,
})

// ---------- Données fictives (une fois) ----------
const SEED = `(async (N) => {
  const { db } = await import('/src/db.ts')
  if ((await db.players.count()) === N) return 'déjà là'
  await db.players.clear(); await db.measurements.clear()
  let s = 7
  const rnd = () => ((s = (s * 1103515245 + 12345) % 2 ** 31) / 2 ** 31)
  const pick = (xs) => xs[Math.floor(rnd() * xs.length)]
  const SYL = ['ma','ri','lo','du','pon','ber','nar','le','fe','vre','mo','reau','ga','tier','dre','si','mon','la','cour','ti','neau','bou','chet','roy']
  const FIRST = ['Lucas','Léa','Jean-Pierre','Inès','Hugo','Zoé','Noah','Jade','Tom','Lina','Mathéo','Chloé','Rémi','Manon','Gabin','Louise']
  const POS = ['GB','AG','ARG','DC','ARD','AD','PIV', undefined]
  const HANDS = ['droitier','gaucher','ambidextre', undefined]
  const now = Date.now()
  const players = [], ms = []
  for (let i = 0; i < N; i++) {
    const c = Math.floor(rnd() * 1400), dept = String(10 + (c % 85)).padStart(2, '0')
    // Quelques noms qui éprouvent l'ordre de l'index (accents, majuscules, particules, vide), et des fiches fondues.
    const odd = ['de la Tour', 'De La Tour', 'Élise', 'eloi', 'Zz', 'van Damme', 'Ølsen', ' Espace', 'b', '']
    const ln = i % 997 === 3 ? odd[(i / 997 | 0) % odd.length] : pick(SYL) + pick(SYL) + (rnd() < 0.5 ? pick(SYL) : '')
    const sex = rnd() < 0.5 ? 'M' : 'F'
    const id = 'bench-' + i
    players.push({
      id, updatedAt: now - i, firstName: pick(FIRST), lastName: i % 997 === 3 ? ln : ln[0].toUpperCase() + ln.slice(1), mergedInto: i % 613 === 5 ? 'bench-1' : undefined,
      birthDate: (2008 + Math.floor(rnd() * 6)) + '-' + String(1 + Math.floor(rnd() * 12)).padStart(2, '0') + '-' + String(1 + Math.floor(rnd() * 28)).padStart(2, '0'),
      sex, position: pick(POS), laterality: pick(HANDS), license: '6' + dept + String(1000000 + i).slice(-7),
      licenseStatus: 'QUALIFIE', licenseRequestType: rnd() < 0.7 ? 'RENOUVELLEMENT' : 'CREATION', clubCode: '5' + dept + String(c).padStart(4, '0'),
      club: 'HBC Fictif ' + c, nationality: 'FRANCAISE', category: sex === 'M' ? '-15 ans M' : '-15 ans F', team: rnd() < 0.3 ? 'Équipe ' + (c % 9) : undefined,
      createdBy: 'staff-fictif', createdByName: 'Staff Fictif', createdAtServer: '2026-09-01T10:00:00Z', updatedByName: 'Staff Fictif', updatedAtServer: '2026-09-01T10:00:00Z',
      review: i % 400 === 0 ? 'pending' : i % 997 === 0 ? 'refused' : undefined, deleted: i % 250 === 0 ? true : undefined,
    })
    // Taille et poids pour 60 % (1 à 3 séances), un test physique pour 30 %.
    if (rnd() < 0.6) for (let k = 0, n = 1 + Math.floor(rnd() * 3); k < n; k++) {
      const date = '202' + (4 + k) + '-03-1' + k, h = 150 + Math.floor(rnd() * 40) + k * 3
      ms.push({ id: id + '-t' + k, playerId: id, criterionId: 'taille', value: h, date, updatedAt: now, author: 'Staff Fictif' })
      ms.push({ id: id + '-p' + k, playerId: id, criterionId: 'poids', value: Math.round(h * 0.33 + rnd() * 10), date, updatedAt: now, author: 'Staff Fictif' })
    }
    if (rnd() < 0.3) ms.push({ id: id + '-v', playerId: id, criterionId: 'vma', value: 12 + Math.floor(rnd() * 6), date: '2026-03-10', updatedAt: now })
  }
  await db.criteria.bulkPut([
    { id: 'taille', label: 'Taille', category: 'Gabarit', kind: 'factual', scale: 'number', unit: 'cm', order: 1, updatedAt: now },
    { id: 'poids', label: 'Poids', category: 'Gabarit', kind: 'factual', scale: 'number', unit: 'kg', order: 2, updatedAt: now },
    { id: 'vma', label: 'VMA', category: 'Tests', kind: 'factual', scale: 'number', unit: 'km/h', order: 3, updatedAt: now },
  ])
  for (let i = 0; i < players.length; i += 5000) await db.players.bulkPut(players.slice(i, i + 5000))
  for (let i = 0; i < ms.length; i += 5000) await db.measurements.bulkPut(ms.slice(i, i + 5000))
  return players.length + ' fiches, ' + ms.length + ' mesures'
})(${N})`

// Détail des lectures, refaites dans la page (mêmes appels que l'écran).
const BREAKDOWN = `(async () => {
  const { db, alive } = await import('/src/db.ts')
  const { latestByPlayer, byLastName, inPlainList } = await import('/src/playersOrder.ts')
  const t = () => performance.now()
  const out = {}
  let a = t(); const rows = await db.players.orderBy('lastName').toArray(); out.idbPlayers = t() - a
  a = t(); const live = alive(rows); out.alive = t() - a
  a = t(); const first = await db.players.orderBy('lastName').filter((p) => !p.deleted && p.review !== 'refused').limit(60).toArray(); out.idbFirst60 = t() - a
  a = t(); const ms = await db.measurements.where('criterionId').anyOf('taille', 'poids').toArray(); out.idbMeasures = t() - a
  a = t(); await Promise.all(['taille', 'poids'].map((c) => db.measurements.where('criterionId').equals(c).toArray())); out.idbMeasuresEquals = t() - a
  a = t(); latestByPlayer(ms); out.latestByPlayer = t() - a
  a = t(); await db.measurements.where('playerId').anyOf(first.map((p) => p.id)).toArray(); out.idbMeasures60 = t() - a
  out.rows = live.length; out.measures = ms.length
  // Contrôles : l'ordre recalculé est celui de l'index ; les premières fiches lues à part sont le début de la liste complète.
  const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i])
  const ids = (xs) => xs.map((p) => p.id)
  out.ordreIdentique = same(ids(live), ids(byLastName(alive(await db.players.toArray()))))
  const eq = (await Promise.all(['poids', 'taille'].map((c) => db.measurements.where('criterionId').equals(c).toArray()))).flat()
  out.mesuresIdentiques = same(ms.map((m) => m.id), eq.map((m) => m.id))
  const cache = await import('/src/playersCache.ts').catch(() => null)
  if (cache?.readPlainPreview) {
    const full = latestByPlayer(ms)
    const key = (l) => (l ? ['taille', 'poids'].map((c) => l.get(c)?.id ?? '-').join() : '-,-')
    out.premieresIdentiques = true
    for (const sex of [undefined, 'M', 'F']) {
      const pv = await cache.readPlainPreview(sex, 60)
      const want = live.filter((p) => inPlainList(p, sex)).slice(0, 60)
      if (!same(ids(pv.rows), ids(want)) || !want.every((p) => key(pv.latest.get(p.id)) === key(full.get(p.id)))) out.premieresIdentiques = false
    }
  }
  return out
})()`

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
    const n = byId.get(id)
    const f = n.callFrame
    const k = `${f.functionName || '(anonyme)'}  ${f.url.replace(/^.*\/(src|node_modules\/\.vite\/deps)\//, '$1/').replace(/\?.*$/, '')}:${f.lineNumber + 1}`
    self.set(k, (self.get(k) ?? 0) + (dt[i] ?? 0) / 1000)
  })
  const total = [...self.values()].reduce((a, b) => a + b, 0)
  console.log(`Profil (${Math.round(total)} ms échantillonnés) :`)
  for (const [k, v] of [...self].sort((a, b) => b[1] - a[1]).slice(0, 25)) console.log(`  ${String(Math.round(v)).padStart(6)} ms  ${k}`)
}

async function waitQuiet(ms = 1500, max = 60000) {
  // Plus de tâche longue depuis `ms` : la page est au repos.
  await evaluate(`new Promise((ok) => { let last = performance.now(); new PerformanceObserver(() => (last = performance.now())).observe({ type: 'longtask' }); const s = performance.now(); const i = setInterval(() => { if (performance.now() - last > ${ms} || performance.now() - s > ${max}) (clearInterval(i), ok()) }, 100) })`)
}
async function measure(click) {
  await evaluate('window.__benchStart()')
  await evaluate(click)
  const s = Date.now()
  for (;;) {
    const b = await evaluate('window.__bench')
    if (b.full || Date.now() - s > 90000) return { first: Math.round(b.first), full: Math.round(b.full), longest: Math.round(b.longest) }
    await sleep(50)
  }
}
const clickNav = `document.querySelector('a[href="/joueurs"]').click()`

await goto('/')
await sleep(1500)
console.log('Données :', await evaluate(SEED))
const results = []
for (const cpu of CPUS) {
  await S('Emulation.setCPUThrottlingRate', { rate: cpu })
  for (let r = 0; r < RUNS; r++) {
    await goto('/')
    await waitQuiet()
    if (PROFILE && r === 0) await S('Profiler.enable').then(() => S('Profiler.setSamplingInterval', { interval: 500 })).then(() => S('Profiler.start'))
    const open = await measure(clickNav)
    if (PROFILE && r === 0) printProfile((await S('Profiler.stop')).profile)
    const mem = await memMB()
    await waitQuiet()
    // Retour depuis une fiche.
    await evaluate(`document.querySelectorAll('a[data-player]')[3].click()`)
    await sleep(1500)
    await waitQuiet()
    const back = await measure('history.back()')
    await waitQuiet()
    // Revisite : accueil puis Joueurs (navigation dans l'appli).
    await evaluate(`document.querySelector('a[href="/"]')?.click()`)
    await sleep(1000)
    await waitQuiet()
    const again = await measure(clickNav)
    results.push({ cpu, run: r + 1, open, back, again, mem })
    console.log(`×${cpu} n°${r + 1}  ouverture ${open.first} / ${open.full} ms (blocage max ${open.longest})  retour ${back.first} / ${back.full}  revisite ${again.first} / ${again.full}  mémoire ${mem} Mo`)
  }
  const bd = await evaluate(BREAKDOWN)
  console.log(`×${cpu} détail :`, Object.fromEntries(Object.entries(bd).map(([k, v]) => [k, typeof v === 'number' ? Math.round(v) : v])))
}
const med = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]
console.log(`\nMédianes (${MOBILE ? 'téléphone 412×915' : 'ordinateur 1440×900'}) — premières lignes / liste prête, ms`)
for (const cpu of CPUS) {
  const rs = results.filter((r) => r.cpu === cpu)
  const f = (k) => `${med(rs.map((r) => r[k].first))} / ${med(rs.map((r) => r[k].full))}`
  console.log(`  ×${cpu}  ouverture ${f('open')}   retour ${f('back')}   revisite ${f('again')}   mémoire ${med(rs.map((r) => r.mem))} Mo`)
}
ws.close()
chrome.kill()
await sleep(300)
rmSync(profile, { recursive: true, force: true })
