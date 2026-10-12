// Test du lecteur de feuille de match (src/matchSheet.ts) sur la feuille FICTIVE de tools/feuille-fictive.mjs.
//
//   npx jiti tools/test-feuille.ts                 → vérifications sur la feuille fictive
//   npx jiti tools/test-feuille.ts chemin.pdf      → lit une autre feuille et n'affiche que des comptes (aucun nom)
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { build } from './feuille-fictive.mjs'
import {
  actionKeys,
  breakBefore,
  CLIP_LEAD,
  END2,
  countKinds,
  guessHalfMin,
  isGenerated,
  lateIndexes,
  mapTime,
  matchPlayer,
  periodStart,
  momentAction,
  momentNote,
  planPlayerMoments,
  sheetPlayersOf,
  splitName,
  timeline,
  toStored,
  TWO_MIN,
  type PdfItem,
} from '../src/matchSheet'

async function items(data: Uint8Array): Promise<PdfItem[]> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const doc = await pdfjs.getDocument({ data, isEvalSupported: false, verbosity: 0 }).promise
  const out: PdfItem[] = []
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n)
    const h = page.getViewport({ scale: 1 }).height
    for (const it of (await page.getTextContent()).items) {
      if ('str' in it && it.str.trim()) out.push({ page: n, x: it.transform[4], y: h - it.transform[5], w: it.width, h: it.height, str: it.str })
    }
  }
  return out
}

const { parseSheet } = await import('../src/matchSheet')
const other = process.argv[2]

if (other) {
  // Autre feuille (réelle) : comptes seulement, jamais de nom ni de licence.
  const s = parseSheet(await items(new Uint8Array(readFileSync(other))))
  const periods = [...new Set(s.actions.map((a) => a.p))]
  console.log({
    joueurs: s.roster.length,
    recevant: s.roster.filter((r) => r.side === 'home').length,
    visiteur: s.roster.filter((r) => r.side === 'away').length,
    licences13: s.roster.filter((r) => /^\d{13}$/.test(r.license ?? '')).length,
    actions: s.actions.length,
    periodes: periods,
    parPeriode: periods.map((p) => s.actions.filter((a) => a.p === p).length),
    types: Object.fromEntries(countKinds(s.actions)),
    sansJoueur: s.actions.filter((a) => a.pl === undefined && a.k !== 'tm').length,
    enRetard: lateIndexes(s.actions).size,
    miTemps: guessHalfMin(s.actions),
    scoreEnTete: s.score,
    scoreFinDeroule: s.actions.at(-1)?.s,
    butsFeuille: s.roster.reduce((n, r) => n + (r.stats.buts ?? 0), 0),
    butsDeroule: s.actions.filter((a) => a.k === 'but' || a.k === 'but7').length,
    butsAvecEquipeOk: s.actions.filter((a) => (a.k === 'but' || a.k === 'but7') && a.pl !== undefined && s.roster[a.pl].side === a.side).length,
    enTete: { code: !!s.code, competition: !!s.competition, date: s.date, heure: s.time, lieu: !!s.place, clubs: [!!s.homeClub, !!s.awayClub] },
    alertes: s.warnings,
  })
  process.exit(0)
}

// ---------- Feuille fictive ----------
const T = build('test')
const { flow: FLOW, final: FINAL, home: HOME, away: AWAY } = T
const LATE_T = 412
const s = parseSheet(await items(new Uint8Array(T.bytes)))
assert.equal(s.code, 'ZZTEST1')
assert.equal(s.competition, 'U15 MASCULINS 2026-2027 TEST (PHASE 1)')
assert.equal(s.pool, 'POULE 1')
assert.equal(s.date, '2026-10-10')
assert.equal(s.time, '15:00')
assert.equal(s.place, 'GYMNASE DES ESSAIS, VILLE-TEST')
assert.equal(s.home, 'HANDBALL CLUB ALPHA')
assert.equal(s.away, 'ENTENTE BETA HB')
assert.equal(s.homeClub, '6399001')
assert.equal(s.awayClub, '6399002')
assert.deepEqual(s.score, FINAL)
assert.equal(s.roster.length, HOME.length + AWAY.length, 'joueurs (officiels exclus)')
assert.deepEqual(
  s.roster.map((r) => [r.side, r.num, r.license]),
  [...HOME.map((p) => ['home', p.num, p.lic]), ...AWAY.map((p) => ['away', p.num, p.lic])],
)
assert.ok(s.roster.find((r) => r.num === '7' && r.side === 'home')?.captain)
const echo = s.roster.find((r) => r.license === '9990000000006')!
assert.deepEqual([echo.lastName, echo.firstName, echo.birthName], ['ECHO', 'Tom', 'FOXTROT'])
const golf = s.roster.find((r) => r.license === '9990000000007')!
assert.deepEqual([golf.lastName, golf.firstName], ['DE LA GOLF', 'Paul'])
assert.deepEqual(splitName('DELTA Jean-Marc'), { lastName: 'DELTA', firstName: 'Jean-Marc', birthName: undefined })
assert.equal(s.roster[0].stats.arrets, FLOW.filter((a) => a.label === 'Arrêt' && a.name === HOME[0].name).length || undefined)

// Déroulé : toutes les lignes, dans l'ordre, sur les deux colonnes, deux périodes.
assert.equal(s.actions.length, FLOW.length, 'nombre d’actions')
assert.deepEqual(
  s.actions.map((a) => a.t),
  FLOW.map((a) => a.t),
)
assert.deepEqual([...new Set(s.actions.map((a) => a.p))], [1, 2])
assert.ok(s.actions.filter((a) => a.p === 2).every((a) => a.t >= 1500))
assert.deepEqual(s.actions.at(-1)!.s, FINAL)
for (const [i, a] of s.actions.entries()) {
  const f = FLOW[i]
  if (!f.name) {
    assert.equal(a.k, 'tm')
    assert.equal(a.side, 'home')
    continue
  }
  if (f.label === 'Commotion') {
    assert.equal(a.k, 'autre')
    assert.equal(a.label, 'Commotion')
  }
  assert.equal(s.roster[a.pl!].name, f.name, `joueur de l’action ${i}`)
  if (f.label.startsWith('But')) assert.equal(a.side, f.side)
}
assert.equal(guessHalfMin(s.actions), 25)
const late = lateIndexes(s.actions)
assert.equal(late.size, 7)
assert.ok([...late].every((i) => s.actions[i].t === LATE_T))

// Relier : licence exacte, sinon même nom (à confirmer).
const fiche = (id: string, firstName: string, lastName: string, license?: string) => ({ id, firstName, lastName, license, updatedAt: 0 })
const players = [fiche('a', 'Hugo', 'Alpha', '9990000000002'), fiche('b', 'Léo', 'Bravo'), fiche('c', 'Tom', 'Foxtrot')]
assert.equal(matchPlayer(s.roster[1], players).kind, 'license')
const byName = matchPlayer(s.roster[2], players)
assert.ok(byName.kind === 'name' && byName.candidates[0].id === 'b')
assert.equal(matchPlayer(echo, players).kind, 'name', 'nom de naissance')
assert.equal(matchPlayer(s.roster[3], players).kind, 'none')

// Calage et moments.
const links = s.roster.map((_, i) => (i === 1 ? 'a' : i === 2 ? 'b' : undefined))
const st = toStored(s, links)
assert.equal(st.halfMin, 25)
assert.ok(!JSON.stringify(st).includes('BRAVO') && !JSON.stringify(st).includes('Léo'), 'aucun nom enregistré')
assert.ok(!JSON.stringify(st).includes('9990000000'), 'aucune licence enregistrée')
assert.equal(st.players[1].playerId, 'a')
assert.equal(timeline(st).at(0), undefined, 'non calé')
st.sync = { marks: { s1: 100, s2: 3000 } }
let tl = timeline(st)
const first = s.actions.findIndex((a) => a.p === 1)
assert.equal(tl.at(first), 100 + s.actions[first].t)
const p2i = s.actions.findIndex((a) => a.p === 2)
assert.equal(tl.at(p2i), 3000 + s.actions[p2i].t - 1500)
// Saisies en retard : une suite d'actions consécutives, réparties à intervalles égaux entre les actions fiables voisines.
const lateList = [...late].sort((a, b) => a - b)
assert.ok(lateList.every((j, k) => j === lateList[0] + k), 'saisies en retard consécutives')
const lb = lateList[0] - 1
const la = lateList.at(-1)! + 1
assert.ok(!late.has(lb) && !late.has(la) && s.actions[lb].p === 1 && s.actions[la].p === 1)
{
  const v0 = tl.at(lb)!
  const v1 = tl.at(la)!
  assert.equal(v0, 100 + s.actions[lb].t)
  lateList.forEach((j, k) => assert.ok(Math.abs(tl.at(j)! - (v0 + ((v1 - v0) * (k + 1)) / (lateList.length + 1))) < 1e-6, `saisie en retard ${k} répartie`))
  assert.equal(tl.status(lateList[0]), 'estimated')
  assert.equal(tl.fixedCount, 0)
}
// Coup d'envoi seul : 2e mi-temps estimée (fin de la 1re + pause estimée), aucune action non placée.
{
  const only = timeline({ ...st, sync: { marks: { s1: 100 } } })
  assert.equal(only.at(p2i), 100 + 1500 + breakBefore(2) + (s.actions[p2i].t - 1500))
  assert.ok(s.actions.every((_, i) => only.at(i) !== undefined), 'toutes les actions placées avec le seul coup d’envoi')
  assert.equal(timeline({ ...st, sync: { marks: {} } }).at(first), undefined, 'rien sans repère')
}
// Fin de période : interpolation, arrêts cumulés.
st.sync.marks.e1 = 100 + 1500 + 120
tl = timeline(st)
assert.equal(tl.stoppage(1), 120)
assert.ok(Math.abs(tl.at(first)! - (100 + s.actions[first].t * (1620 / 1500))) < 1e-6)
assert.equal(mapTime([{ g: 0, v: 10, key: 'x' }, { g: 100, v: 210, key: 'y' }], 50), 110)
// Repère sur une action : les actions voisines se recalent.
const keys = actionKeys(st.actions)
const mid = s.actions.findIndex((a, i) => a.p === 1 && a.t > 900 && !late.has(i))
st.sync.fix = { [keys[mid]]: 1200 }
tl = timeline(st)
assert.equal(tl.at(mid), 1200)
assert.ok(tl.anchors(1).some((a) => a.key === keys[mid]))
assert.equal(tl.status(mid), 'fixed')
assert.equal(tl.fixedCount, 1)
// Au-delà du dernier repère : pente observée entre le premier et le dernier (arrêts de jeu reportés sur la suite).
{
  const k = s.actions.findIndex((a, i) => a.p === 1 && a.t > s.actions[mid].t + 60 && !late.has(i))
  const slow = timeline({ ...st, sync: { marks: { s1: 100 }, fix: { [keys[mid]]: 100 + s.actions[mid].t * 1.2 } } })
  assert.ok(Math.abs(slow.at(k)! - (100 + s.actions[k].t * 1.2)) < 1e-6, 'pente prolongée')
}
// Action en retard posée à la main : placée, ne sert pas de repère au match, mais ses voisines en retard se recalculent.
const vEnd = tl.at(la)!
st.sync.fix[keys[lateList[0]]] = vEnd - 70
tl = timeline(st)
assert.equal(tl.at(lateList[0]), vEnd - 70)
assert.equal(tl.status(lateList[0]), 'fixed')
assert.ok(!tl.anchors(1).some((a) => a.key === keys[lateList[0]]))
assert.equal(tl.at(la), vEnd, 'actions fiables inchangées')
lateList.slice(1).forEach((j, k) =>
  assert.ok(Math.abs(tl.at(j)! - (vEnd - 70 + (70 * (k + 1)) / lateList.length)) < 1e-6, `saisie en retard ${k + 1} recalculée`),
)

// Moments d'un joueur : buts, notes marquées ; relancer ne double pas ; les moments à la main restent.
const pl = s.actions.find((a) => a.k === 'but' && a.pl !== undefined && !late.has(s.actions.indexOf(a)))!.pl!
const plan1 = planPlayerMoments(st, pl, [{ at: 5, note: 'à revoir' }])
assert.ok(plan1.generated > 0)
assert.ok(plan1.moments.every((m) => m.note === 'à revoir' || (isGenerated(m) && m.dur === 12)))
assert.ok(plan1.moments.some((m) => /^But(?: 7m)? \d+-\d+ · feuille$/.test(m.note ?? '')))
const plan2 = planPlayerMoments(st, pl, plan1.moments)
assert.deepEqual(plan2.moments, plan1.moments)
assert.ok(!isGenerated({ at: 1, note: 'But 3-2' }))
// Moment généré → action de la feuille (note : type et score ; à note égale, le moment le plus proche).
for (const m of plan1.moments.filter(isGenerated)) {
  const i = momentAction(st, [pl], m)!
  assert.ok(i !== undefined && s.actions[i].pl === pl && momentNote(st.actions[i]) === m.note)
  assert.equal(Math.max(0, Math.round(timeline(st).at(i)! - CLIP_LEAD)), m.at)
}
assert.equal(momentAction(st, [pl], { at: 5, note: 'à revoir' }), undefined)
assert.deepEqual(sheetPlayersOf(st, 'a'), [1])
assert.deepEqual(sheetPlayersOf(st, 'z', (id) => (id === 'a' ? 'z' : id)), [1], 'fiche fondue suivie')
// « C'est ici » sur un but : il devient repère, les moments des autres joueurs bougent, le sien est « calé ».
{
  const goals = s.actions.flatMap((a, i) => ((a.k === 'but' || a.k === 'but7') && a.pl !== undefined && !late.has(i) && a.p === 1 ? [i] : []))
  const g = goals[Math.floor(goals.length / 2)]
  const other = goals.find((i) => s.actions[i].pl !== s.actions[g].pl && s.actions[i].t > s.actions[g].t)!
  const before = planPlayerMoments(st, s.actions[other].pl!).moments.find((m) => m.note === momentNote(st.actions[other]))!
  const prev = timeline(st).at(g)!
  const moved = { ...st, sync: { ...st.sync, fix: { ...st.sync.fix, [keys[g]]: prev + 30 } } }
  const after = planPlayerMoments(moved, s.actions[other].pl!).moments.find((m) => m.note === momentNote(st.actions[other]))!
  assert.ok(after.at > before.at, 'moment d’un autre joueur recalé')
  const mine = planPlayerMoments(moved, s.actions[g].pl!).moments.find((m) => m.note === momentNote(st.actions[g]))!
  assert.equal(mine.at, Math.round(prev + 30 - CLIP_LEAD))
  assert.equal(timeline(moved).status(momentAction(moved, [s.actions[g].pl!], mine)!), 'fixed')
}
// Gardien : arrêts en option.
st.sync.opts = { saves: true }
const gk = planPlayerMoments(st, 0)
assert.equal(gk.generated + gk.unplaced, FLOW.filter((a) => a.name === HOME[0].name && (a.label === 'Arrêt' || a.label.startsWith('But'))).length)

// ---------- Feuille de la démo (public/demo, faite par tools/feuille-demo.ts) ----------
const d = parseSheet(await items(new Uint8Array(readFileSync(new URL('../public/demo/feuille-match-demo.pdf', import.meta.url)))))
assert.equal(guessHalfMin(d.actions), 30)
assert.deepEqual([...new Set(d.actions.map((a) => a.p))], [1, 2])
assert.deepEqual(d.actions.at(-1)!.s, d.score)
assert.ok(d.roster.every((r) => /^(5531320|6075817)\d{6}$/.test(r.license ?? '')), 'licences de la démo')
// Homonymes (même équipe) : le gardien a les arrêts, l'autre les buts ; aucune action d'un joueur sans joueur relié.
const gkHomonym = d.roster.findIndex((r) => r.license === '5531320000080')
const fieldHomonym = d.roster.findIndex((r) => r.license === '5531320000093')
assert.ok(gkHomonym >= 0 && fieldHomonym >= 0 && d.roster[gkHomonym].name === d.roster[fieldHomonym].name)
assert.ok(d.actions.filter((a) => a.k === 'arret' && d.roster[a.pl!]?.name === d.roster[gkHomonym].name).every((a) => a.pl === gkHomonym))
assert.equal(d.actions.filter((a) => a.pl === undefined && a.k !== 'tm' && !a.who).length, 0)

// Bande d'une exclusion de 2 minutes : 120 s de jeu, au rythme constaté (repères s1 et e1 : arrêts de jeu répartis).
{
  const dl = lateIndexes(d.actions)
  const two = d.actions.findIndex((a, i) => a.k === '2mn' && a.p === 1 && !dl.has(i))
  assert.ok(two >= 0, 'exclusion de 2 min dans la démo')
  const r = timeline({ actions: d.actions, halfMin: 30, sync: { marks: { s1: 100, e1: 100 + 1800 * 1.2 } } })
  assert.ok(Math.abs(r.spanEnd(two, 120)! - (r.at(two)! + 144)) < 1e-6, 'bande 2 min au rythme du match')
  assert.equal(r.videoAt(1, 0), 100)
}

// Fin des 2 minutes : repère à l'exclusion + 120 s de jeu ; les estimations voisines bougent, le retirer (Annuler) les rétablit.
{
  const dl = lateIndexes(d.actions)
  const base = { actions: d.actions, halfMin: 30, sync: { marks: { s1: 100 } as Record<string, number>, fix: {} as Record<string, number> } }
  const t0 = timeline(base)
  const two = d.actions.findIndex((a, i) => a.k === '2mn' && !dl.has(i) && t0.end2(i))
  assert.ok(two >= 0, 'exclusion fiable dans la démo')
  const e0 = t0.end2(two)!
  assert.equal(e0.fixed, false)
  assert.ok(Math.abs(e0.v - (t0.at(two)! + TWO_MIN)) < 1e-6, 'fin estimée 2 min après (un seul repère : temps réel)')
  assert.ok(t0.endKey(two).endsWith(END2))
  // Voisine : une action fiable de la même période après la fin des 2 minutes.
  const nb = d.actions.findIndex((a, i) => i > two && a.p === d.actions[two].p && !dl.has(i) && a.t > d.actions[two].t + TWO_MIN)
  const before = d.actions.map((_, i) => t0.at(i))
  const moved = { ...base, sync: { ...base.sync, fix: { [t0.endKey(two)]: e0.v + 30 } } }
  const t1 = timeline(moved)
  assert.deepEqual(t1.end2(two), { v: e0.v + 30, fixed: true })
  assert.ok(t1.anchors(d.actions[two].p).some((a) => a.key === t0.endKey(two)), 'repère de la période')
  // Après le dernier repère : pente observée entre le coup d'envoi et la fin des 2 minutes.
  const g2 = d.actions[two].t + TWO_MIN
  const slope = (e0.v + 30 - 100) / g2
  assert.ok(Math.abs(t1.at(nb)! - (e0.v + 30 + (d.actions[nb].t - g2) * slope)) < 1e-6, 'voisine décalée')
  assert.ok(t1.at(nb)! > before[nb]! + 30)
  assert.ok(Math.abs(t1.at(two)! - (100 + d.actions[two].t * slope)) < 1e-6, 'l’exclusion, entre coup d’envoi et fin des 2 minutes, est interpolée')
  assert.ok(Math.abs(t1.end2(two)!.v - t1.at(two)! - TWO_MIN * slope) < 1e-6, '2 minutes de jeu au rythme du calage')
  // Annuler : le repère retiré, toutes les estimations reviennent.
  const t2 = timeline({ ...base, sync: { ...base.sync, fix: {} } })
  assert.deepEqual(d.actions.map((_, i) => t2.at(i)), before)
  // Exclusion saisie en retard : sa fin calée la place (2 minutes avant) et recale ses voisines en retard, pas le reste.
  const lateTwo = d.actions.findIndex((a, i) => a.k === '2mn' && dl.has(i) && t0.end2(i))
  assert.ok(lateTwo >= 0, "exclusion saisie en retard dans la démo")
  {
    const tl3 = timeline({ ...base, sync: { ...base.sync, fix: { [t0.endKey(lateTwo)]: t0.end2(lateTwo)!.v + 40 } } })
    assert.ok(Math.abs(tl3.at(lateTwo)! - (t0.at(lateTwo)! + 40)) < 1e-6, 'exclusion en retard déduite de sa fin')
    assert.ok(!tl3.anchors(d.actions[lateTwo].p).some((a) => a.key === t0.endKey(lateTwo)), 'pas un repère du match')
    assert.equal(tl3.at(nb), before[nb], 'actions fiables inchangées')
  }
  // Fin au-delà de la période : pas de repère de fin.
  const lastTwo = { ...d.actions[two], t: periodStart(d.actions[two].p, 30) + 30 * 60 - 30 }
  assert.equal(timeline({ ...base, actions: [lastTwo] }).end2(0), undefined)
}

console.log(`OK : ${s.actions.length} actions, ${s.roster.length} joueurs, ${late.size} en retard, mi-temps ${guessHalfMin(s.actions)} min ; démo : ${d.actions.length} actions, score ${d.score?.join('-')}`)
