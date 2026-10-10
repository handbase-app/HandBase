// Feuilles de match FFHB FICTIVES (même mise en page que la feuille électronique : en-tête, deux listes de joueurs,
// déroulé du match sur deux colonnes en page 2), pour tester l'import sans données réelles.
//
//   node tools/feuille-fictive.mjs test [sortie.pdf]   feuille de test (noms inventés, mi-temps de 25 min)
//
// « test » : 2e période comptée depuis le début du match (25:xx), une saisie en retard (7 actions à la même seconde),
// un temps mort, une action « Commotion », un nom de naissance.
// La feuille de la démo (public/demo/feuille-match-demo.pdf) est faite par tools/feuille-demo.ts avec writeSheet.
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

const H = 841.89

const DATASETS = {
  test: {
    seed: 7,
    code: 'ZZTEST1',
    competition: 'U15 MASCULINS 2026-2027 TEST (PHASE 1)',
    pool: 'POULE 1',
    date: 'samedi 10/10/2026 15:00',
    salle: ['GYMNASE DES ESSAIS', 'GYMNASE DES ESSAIS 1 RUE FICTIVE 83000 VILLE-TEST'],
    half: 25,
    home: {
      name: 'HANDBALL CLUB ALPHA',
      club: '6399001',
      officials: ['YANKEE Paul', 'XRAY Jean'],
      players: [
        { num: '1', name: 'HOTEL Max', lic: '9990000000001', gk: true },
        { num: '4', name: 'ALPHA Hugo', lic: '9990000000002' },
        { num: '7', name: 'BRAVO Léo', lic: '9990000000003', capt: true },
        { num: '9', name: 'CHARLIE Noé', lic: '9990000000004' },
        { num: '11', name: 'DELTA Jean-Marc', lic: '9990000000005' },
        { num: '14', name: 'ECHO Tom (Né.e FOXTROT)', lic: '9990000000006' },
        { num: '23', name: 'DE LA GOLF Paul', lic: '9990000000007' },
      ],
    },
    away: {
      name: 'ENTENTE BETA HB',
      club: '6399002',
      officials: ['WHISKEY Marc'],
      players: [
        { num: '12', name: 'INDIA Luc', lic: '9990000000011', gk: true },
        { num: '2', name: 'JULIETT Rémi', lic: '9990000000012' },
        { num: '3', name: 'KILO Yann', lic: '9990000000013', capt: true },
        { num: '5', name: 'LIMA Éric', lic: '9990000000014' },
        { num: '8', name: 'MIKE Ugo', lic: '9990000000015' },
        { num: '10', name: 'NOVEMBER Théo', lic: '9990000000016' },
        { num: '17', name: 'OSCAR Axel', lic: '9990000000017' },
      ],
    },
    script: (g) => {
      g.play(1, 40, 400, 6)
      g.late(1, 412, 7)
      g.play(1, 430, 1490, 14)
      g.push(2, 1500, '2MN', 'away', 1)
      g.push(2, 1519, 'Commotion', 'home', 0)
      g.play(2, 1530, 2350, 16)
      g.timeout(2, 2380, 'home')
      g.play(2, 2400, 2990, 8)
    },
  },
}

export function build(which = 'test') {
  const d = DATASETS[which]
  let seed = d.seed
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647
  const team = (side) => (side === 'home' ? d.home : d.away)
  const fieldOf = (side) => team(side).players.filter((p) => !p.gk)
  // Gardien en jeu : le 1er en 1re période, le 2e en 2e période (sinon le premier gardien).
  const keeper = (side, period) => {
    const gks = team(side).players.filter((p) => p.gk)
    return gks.find((p) => p.keeper === period) ?? gks[0]
  }
  const pickField = (side) => {
    const list = fieldOf(side)
    const total = list.reduce((n, p) => n + (p.w ?? 1), 0)
    let r = rand() * total
    for (const p of list) if ((r -= p.w ?? 1) < 0) return p
    return list[list.length - 1]
  }
  const flow = [] // { p, t, label, player?, side? }
  const g = {
    push: (p, tt, label, side, idx) => flow.push({ p, t: tt, label, side, player: fieldOf(side)[idx] }),
    timeout: (p, tt, side) => flow.push({ p, t: tt, label: `Temps mort ${side === 'home' ? 'Recevant' : 'Visiteur'}` }),
    one(p, tt) {
      const side = rand() < 0.5 ? 'home' : 'away'
      const other = side === 'home' ? 'away' : 'home'
      const shooter = pickField(side)
      const r = rand()
      if (r < 0.5) flow.push({ p, t: tt, label: r < 0.07 ? 'But 7m' : 'But', side, player: shooter })
      else if (r < 0.82) {
        flow.push({ p, t: tt, label: 'Tir', side, player: shooter })
        if (rand() < 0.75) flow.push({ p, t: tt + (rand() < 0.3 ? 1 : 0), label: 'Arrêt', side: other, player: keeper(other, p) })
      } else if (r < 0.94) flow.push({ p, t: tt, label: '2MN', side, player: shooter })
      else flow.push({ p, t: tt, label: 'Avertissement', side, player: shooter })
    },
    play(p, from, to, n) {
      let tt = from
      for (let i = 0; i < n; i++) {
        tt += Math.max(1, Math.floor(((to - from) / n) * (0.5 + rand())))
        if (tt > to) tt = to
        g.one(p, tt)
      }
    },
    late(p, tt, n) {
      const start = flow.length
      while (flow.length - start < n) g.one(p, tt)
      for (const a of flow.slice(start)) a.t = tt
      flow.length = start + n
    },
  }
  d.script(g)
  return writeSheet(d, flow)
}

/**
 * Écrit la feuille : d (en-tête, équipes, joueurs, officiels), flow (actions { p, t, label, side, player, score? } ;
 * sans score fourni, il est calculé d'après les buts).
 */
export function writeSheet(d, flow) {
  const pages = [[], []]
  const t = (p, x, y, str, size = 6) => pages[p - 1].push({ x, y, str, size })
  let sh = 0
  let sa = 0
  for (const a of flow) {
    if (a.label.startsWith('But')) a.side === 'home' ? sh++ : sa++
    if (a.s) [sh, sa] = a.s
    a.score = `${String(sh).padStart(2, '0')} - ${String(sa).padStart(2, '0')}`
  }
  const mmss = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`

  // ---------- Page 1 : en-tête et joueurs ----------
  function header(p, y0) {
    t(p, 45, y0, 'Organisateur')
    t(p, 86, y0, 'FEDERATION FRANCAISE DE HANDBALL (5000000)')
    t(p, 440, y0, 'Code Renc')
    t(p, 477, y0, d.code)
    t(p, 47, y0 + 13, 'Compétition')
    t(p, 86, y0 + 13, d.competition)
    t(p, 86, y0 + 20, d.pool)
    t(p, 450, y0 + 13, 'Groupe')
    t(p, 477, y0 + 13, 'M000000001')
    t(p, 118, y0 + 38, `${d.home.name} / ${d.away.name}`, 10)
    t(p, 488, y0 + 38, String(sh), 10)
    t(p, 527, y0 + 38, String(sa), 10)
  }
  header(1, 111)
  t(1, 46, 163, 'Date')
  t(1, 66, 163, d.date)
  t(1, 214, 163, 'Journée')
  t(1, 242, 163, 'J1')
  t(1, 399, 163, 'Salle')
  t(1, 419, 163, d.salle[0])
  t(1, 419, 170, d.salle[1])
  t(1, 19, 183, 'Chronométreur')
  t(1, 66, 183, d.table ?? 'TABLE Fictive')
  t(1, 242, 183, '9990000000099')

  const stats = (pl) => {
    const mine = flow.filter((a) => a.player === pl)
    return {
      buts: mine.filter((a) => a.label.startsWith('But')).length,
      sept: mine.filter((a) => a.label === 'But 7m').length,
      tirs: mine.filter((a) => a.label.startsWith('But') || a.label === 'Tir').length,
      arrets: mine.filter((a) => a.label === 'Arrêt').length,
      av: mine.filter((a) => a.label === 'Avertissement').length,
      deux: mine.filter((a) => a.label === '2MN').length,
    }
  }
  const step = 13
  function roster(y0, tm, visitor) {
    const cols = [
      [68, 'Capt'],
      [97, 'N°'],
      [174, "NOM Prenom (Nom d'usage)"],
      [328, 'Licence'],
      [370, 'Type'],
      [396, 'JFL'],
      [421, 'Buts'],
      [448, '7m'],
      [473, 'Tirs'],
      [495, 'Arrets'],
      [524, 'Av.'],
      [552, "2'"],
      [575, 'Dis'],
    ]
    for (const [x, s] of cols) t(1, x, y0, s)
    let y = y0 + step
    for (const p of tm.players) {
      if (p.capt) t(1, 73, y, 'X')
      t(1, p.num.length > 1 ? 97 : 99, y, p.num)
      t(1, 116, y, p.name)
      t(1, 316, y, p.lic)
      t(1, 374, y, 'A')
      const s = stats(p)
      if (s.buts) t(1, s.buts > 9 ? 423 : 425, y, String(s.buts))
      if (s.sept) t(1, 451, y, String(s.sept))
      if (s.tirs) t(1, s.tirs > 9 ? 474 : 476, y, String(s.tirs))
      if (s.arrets) t(1, s.arrets > 9 ? 500 : 501, y, String(s.arrets))
      if (s.av) t(1, 526, y, 'X')
      if (s.deux) t(1, 552, y, String(s.deux))
      y += step
    }
    for (const [i, o] of tm.officials.entries()) {
      t(1, 69, y, `Officiel Resp. ${'ABCD'[i]}`)
      t(1, 116, y, o)
      t(1, 317, y, `99900000009${i}${visitor ? 1 : 0}`)
      y += step
    }
    t(1, 17, y0 + 150, `Club ${visitor ? 'visiteur' : 'recevant'} - ${tm.club}`, 10)
    t(1, 46, y0 + 160, tm.name, 10)
    return y
  }
  const end1 = roster(240, d.home, false)
  const end2 = roster(end1 + 10, d.away, true)
  t(1, 20, Math.max(end2 + 20, 708), 'Détail score')

  // ---------- Page 2 : déroulé sur deux colonnes ----------
  header(2, 12)
  t(2, 273, 64, 'Déroulé du match')
  let col = 0
  let y = 84
  const COLS = [11, 305]
  const bottom = 815
  const line = (a) => {
    if (y > bottom) {
      col++
      y = 76
    }
    const x = COLS[col]
    t(2, x, y, mmss(a.t))
    t(2, x + 28, y, a.score)
    t(2, x + 66, y, a.player ? `${a.label} ${a.player.name}` : a.label)
    y += 11
  }
  const period = (n) => {
    if (y > bottom - 30) {
      col++
      y = 76
    }
    t(2, COLS[col] + 107, y, `PERIODE ${n}`, 12)
    y += 15
    t(2, COLS[col] - 2, y, 'Temps')
    t(2, COLS[col] + 29, y, 'Score')
    t(2, COLS[col] + 161, y, 'Action')
    y += 11
  }
  for (const p of [...new Set(flow.map((a) => a.p))]) {
    if (p > 1) y += 7
    period(p)
    flow.filter((a) => a.p === p).forEach(line)
  }

  // ---------- Écriture du PDF (Helvetica, WinAnsi) ----------
  const esc = (s) => s.replace(/[\\()]/g, (c) => '\\' + c).replace(/’/g, "'")
  const objs = []
  const add = (s) => (objs.push(s), objs.length)
  const font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>')
  const pageIds = []
  const pagesId = objs.length + 1 + pages.length * 2
  for (const items of pages) {
    const body = items.map((i) => `BT /F1 ${i.size} Tf 1 0 0 1 ${i.x} ${(H - i.y).toFixed(2)} Tm (${esc(i.str)}) Tj ET`).join('\n')
    const stream = add(`<< /Length ${Buffer.byteLength(body, 'latin1')} >>\nstream\n${body}\nendstream`)
    pageIds.push(add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 595.28 ${H}] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${stream} 0 R >>`))
  }
  add(`<< /Type /Pages /Kids [${pageIds.map((i) => `${i} 0 R`).join(' ')}] /Count ${pageIds.length} >>`)
  const catalog = add(`<< /Type /Catalog /Pages ${pagesId} 0 R /Info << /Title (Feuille de match fictive) >> >>`)
  let out = '%PDF-1.4\n'
  const offsets = []
  objs.forEach((o, i) => {
    offsets.push(Buffer.byteLength(out, 'latin1'))
    out += `${i + 1} 0 obj\n${o}\nendobj\n`
  })
  const xref = Buffer.byteLength(out, 'latin1')
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`
  out += `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return {
    bytes: Buffer.from(out, 'latin1'),
    flow: flow.map((a) => ({ p: a.p, t: a.t, label: a.label, side: a.side, name: a.player?.name, lic: a.player?.lic })),
    final: [sh, sa],
    half: d.half,
    home: d.home.players,
    away: d.away.players,
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const which = process.argv[2] ?? 'test'
  if (!DATASETS[which]) throw new Error(`Feuille inconnue : ${which} (la feuille de la démo se fait avec tools/feuille-demo.ts)`)
  const file = process.argv[3] ?? 'feuille-fictive.pdf'
  const r = build(which)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, r.bytes)
  console.log(`${file} : ${r.flow.length} actions, score ${r.final[0]}-${r.final[1]}`)
}
