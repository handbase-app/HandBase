// Feuille de match FFHB FICTIVE (même mise en page que la feuille électronique : en-tête, deux listes de joueurs,
// déroulé du match sur deux colonnes en page 2), pour tester l'import sans données réelles.
// Noms, licences, clubs et salle sont inventés.
//
//   node tools/feuille-fictive.mjs [sortie.pdf]      (par défaut : feuille-fictive.pdf dans le dossier courant)
//
// Contenu : mi-temps de 25 min (U15), 2e période comptée depuis le début du match (25:xx), une saisie en retard
// (7 actions à la même seconde en 1re période), un temps mort, une action « Commotion », un nom de naissance.
import { writeFileSync } from 'node:fs'

const H = 841.89
const pages = [[], []]
const t = (p, x, y, str, size = 6) => pages[p - 1].push({ x, y, str, size })

export const HOME = [
  { num: '1', name: 'HOTEL Max', lic: '9990000000001', gk: true },
  { num: '4', name: 'ALPHA Hugo', lic: '9990000000002' },
  { num: '7', name: 'BRAVO Léo', lic: '9990000000003', capt: true },
  { num: '9', name: 'CHARLIE Noé', lic: '9990000000004' },
  { num: '11', name: 'DELTA Jean-Marc', lic: '9990000000005' },
  { num: '14', name: 'ECHO Tom (Né.e FOXTROT)', lic: '9990000000006' },
  { num: '23', name: 'DE LA GOLF Paul', lic: '9990000000007' },
]
export const AWAY = [
  { num: '12', name: 'INDIA Luc', lic: '9990000000011', gk: true },
  { num: '2', name: 'JULIETT Rémi', lic: '9990000000012' },
  { num: '3', name: 'KILO Yann', lic: '9990000000013', capt: true },
  { num: '5', name: 'LIMA Éric', lic: '9990000000014' },
  { num: '8', name: 'MIKE Ugo', lic: '9990000000015' },
  { num: '10', name: 'NOVEMBER Théo', lic: '9990000000016' },
  { num: '17', name: 'OSCAR Axel', lic: '9990000000017' },
]

// Déroulé (temps de jeu en secondes, action, équipe, indice du joueur) : généré de façon déterministe.
let seed = 7
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
const field = (team) => (team === 'home' ? HOME : AWAY).slice(1)
const keeper = (team) => (team === 'home' ? HOME : AWAY)[0]
const flow = [] // { t, label, name, team? }
function play(tStart, tEnd, n) {
  let tt = tStart
  for (let i = 0; i < n; i++) {
    tt += Math.floor(((tEnd - tStart) / n) * (0.6 + rand() * 0.8))
    if (tt >= tEnd) tt = tEnd - (n - i)
    const team = rand() < 0.5 ? 'home' : 'away'
    const other = team === 'home' ? 'away' : 'home'
    const shooter = field(team)[Math.floor(rand() * 6)]
    const r = rand()
    if (r < 0.55) flow.push({ t: tt, label: r < 0.1 ? 'But 7m' : 'But', name: shooter.name, team })
    else if (r < 0.85) {
      flow.push({ t: tt, label: 'Tir', name: shooter.name, team })
      flow.push({ t: tt, label: 'Arrêt', name: keeper(other).name, team: other })
    } else if (r < 0.95) flow.push({ t: tt, label: '2MN', name: shooter.name, team })
    else flow.push({ t: tt, label: 'Avertissement', name: shooter.name, team })
  }
}
play(40, 400, 6)
// Saisie en retard : 7 actions enregistrées à la même seconde.
const lateT = 412
for (let i = 0; i < 4; i++) flow.push({ t: lateT, label: 'But', name: field(i % 2 ? 'away' : 'home')[i].name, team: i % 2 ? 'away' : 'home' })
flow.push({ t: lateT, label: 'Tir', name: field('home')[2].name, team: 'home' })
flow.push({ t: lateT, label: 'Arrêt', name: keeper('away').name, team: 'away' })
flow.push({ t: lateT, label: 'But 7m', name: field('away')[3].name, team: 'away' })
play(430, 1490, 14)
const p2Start = flow.length
flow.push({ t: 1500, label: '2MN', name: field('away')[1].name, team: 'away' })
flow.push({ t: 1519, label: 'Commotion', name: field('home')[0].name, team: 'home' })
play(1530, 2350, 16)
flow.push({ t: 2380, label: 'Temps mort Recevant' })
play(2400, 2990, 8)

// Score après chaque action.
let sh = 0
let sa = 0
for (const a of flow) {
  if (a.label.startsWith('But')) a.team === 'home' ? sh++ : sa++
  a.score = `${String(sh).padStart(2, '0')} - ${String(sa).padStart(2, '0')}`
}
export const FINAL = [sh, sa]

const mmss = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`

// ---------- Page 1 : en-tête et joueurs ----------
function header(p, y0) {
  t(p, 45, y0, 'Organisateur')
  t(p, 86, y0, 'FEDERATION FRANCAISE DE HANDBALL (5000000)')
  t(p, 440, y0, 'Code Renc')
  t(p, 477, y0, 'ZZTEST1')
  t(p, 47, y0 + 13, 'Compétition')
  t(p, 86, y0 + 13, 'U15 MASCULINS 2026-2027 TEST (PHASE 1)')
  t(p, 86, y0 + 20, 'POULE 1')
  t(p, 450, y0 + 13, 'Groupe')
  t(p, 477, y0 + 13, 'M000000001')
  t(p, 118, y0 + 38, 'HANDBALL CLUB ALPHA / ENTENTE BETA HB', 10)
  t(p, 488, y0 + 38, String(sh), 10)
  t(p, 527, y0 + 38, String(sa), 10)
}
header(1, 111)
t(1, 46, 163, 'Date')
t(1, 66, 163, 'samedi 10/10/2026 15:00')
t(1, 214, 163, 'Journée')
t(1, 242, 163, 'J1')
t(1, 399, 163, 'Salle')
t(1, 419, 163, 'GYMNASE DES ESSAIS')
t(1, 419, 170, 'GYMNASE DES ESSAIS 1 RUE FICTIVE 83000 VILLE-TEST')
t(1, 19, 183, 'Chronométreur')
t(1, 66, 183, 'ZULU Anne')
t(1, 242, 183, '9990000000099')

const stats = (p) => {
  const mine = flow.filter((a) => a.name === p.name)
  return {
    buts: mine.filter((a) => a.label.startsWith('But')).length,
    sept: mine.filter((a) => a.label === 'But 7m').length,
    tirs: mine.filter((a) => a.label.startsWith('But') || a.label === 'Tir').length,
    arrets: mine.filter((a) => a.label === 'Arrêt').length,
    deux: mine.filter((a) => a.label === '2MN').length,
  }
}
function team(y0, list, club, clubName, officials) {
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
  let y = y0 + 13
  for (const p of list) {
    if (p.capt) t(1, 73, y, 'X')
    t(1, p.num.length > 1 ? 97 : 99, y, p.num)
    t(1, 116, y, p.name)
    t(1, 316, y, p.lic)
    t(1, 374, y, 'A')
    const s = stats(p)
    if (s.buts) t(1, 425, y, String(s.buts))
    if (s.sept) t(1, 451, y, String(s.sept))
    if (s.tirs) t(1, 476, y, String(s.tirs))
    if (s.arrets) t(1, 501, y, String(s.arrets))
    if (s.deux) t(1, 552, y, String(s.deux))
    y += 13
  }
  for (const [i, o] of officials.entries()) {
    t(1, 69, y, `Officiel Resp. ${'ABCD'[i]}`)
    t(1, 116, y, o)
    t(1, 317, y, `99900000009${i}${y0 > 300 ? 1 : 0}`)
    y += 13
  }
  t(1, 17, y0 + 150, `Club ${y0 > 300 ? 'visiteur' : 'recevant'} - ${club}`, 10)
  t(1, 46, y0 + 160, clubName, 10)
}
team(249, HOME, '6399001', 'HANDBALL CLUB ALPHA', ['YANKEE Paul', 'XRAY Jean'])
team(471, AWAY, '6399002', 'ENTENTE BETA HB', ['WHISKEY Marc'])
t(1, 20, 708, 'Détail score')

// ---------- Page 2 : déroulé sur deux colonnes ----------
header(2, 12)
t(2, 273, 64, 'Déroulé du match')
let col = 0
let y = 84
const COLS = [11, 305]
const bottom = 812
function line(a) {
  if (y > bottom) {
    col++
    y = 76
  }
  const x = COLS[col]
  t(2, x, y, mmss(a.t))
  t(2, x + 28, y, a.score)
  t(2, x + 66, y, a.name ? `${a.label} ${a.name}` : a.label)
  y += 11
}
function period(n) {
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
period(1)
flow.slice(0, p2Start).forEach(line)
y += 7
period(2)
flow.slice(p2Start).forEach(line)

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
const catalog = add(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`)
let out = '%PDF-1.4\n'
const offsets = []
objs.forEach((o, i) => {
  offsets.push(Buffer.byteLength(out, 'latin1'))
  out += `${i + 1} 0 obj\n${o}\nendobj\n`
})
const xref = Buffer.byteLength(out, 'latin1')
out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`
out += `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`

export const FLOW = flow
export const LATE_T = lateT
if (import.meta.url === `file://${process.argv[1]}`) {
  const file = process.argv[2] ?? 'feuille-fictive.pdf'
  writeFileSync(file, Buffer.from(out, 'latin1'))
  console.log(`${file} : ${flow.length} actions, score ${sh}-${sa}`)
}
export const PDF_BYTES = () => Buffer.from(out, 'latin1')
