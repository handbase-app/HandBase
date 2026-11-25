// Test de « Mes matchs » de l'espace joueur (src/playerMatches.ts) : repérage du jeune sur la feuille, repérage du même
// match déjà dans l'appli, ce qui part au serveur, liste de ses matchs, séquenceur simplifié. Feuille FICTIVE
// (tools/feuille-fictive.mjs) et données inventées.
//
//   npx jiti tools/test-matchs-joueur.ts
import assert from 'node:assert/strict'
import { build } from './feuille-fictive.mjs'
import { actionKeys, type MatchSheet, type PdfItem } from '../src/matchSheet'
import {
  cleanMarks,
  clubOfMe,
  findDuplicate,
  findMeOnSheet,
  marksFor,
  MATCH_ERRORS,
  matchErrorText,
  matchKeyOf,
  mergeMarks,
  myActions,
  myActionKeys,
  myIndexes,
  onSheetLine,
  playerMatchesFrom,
  playerSheetRequest,
  presenceError,
  proposedOf,
  sameMatch,
  seqDataFrom,
  sheetSourceOf,
  type DupCandidate,
  type PlayerSeqData,
} from '../src/playerMatches'

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
const sheet = parseSheet(await items(new Uint8Array(build('test').bytes)))
let n = 0
const ok = (name: string, fn: () => void) => {
  fn()
  n++
  console.log('ok -', name)
}

// ---------- Le jeune sur la feuille ----------
const idx = (last: string) => sheet.roster.findIndex((r) => r.lastName === last)
assert.ok(sheet.homeClub === '6399001' && sheet.awayClub === '6399002', 'clubs lus sur la feuille fictive')

ok('licence actuelle', () => {
  assert.deepEqual(findMeOnSheet(sheet, { firstName: 'X', lastName: 'Y', license: '9990000000003' }), { kind: 'license', index: idx('BRAVO') })
})
ok('ancienne licence', () => {
  assert.deepEqual(findMeOnSheet(sheet, { firstName: 'X', lastName: 'Y', license: '1111111111111', previousLicenses: ['9990000000013'] }), { kind: 'license', index: idx('KILO') })
})
ok('nom + club de son équipe (accents et casse ignorés)', () => {
  assert.deepEqual(findMeOnSheet(sheet, { firstName: 'leo', lastName: 'Bravo', clubCode: '6399001' }), { kind: 'name', index: idx('BRAVO') })
  assert.deepEqual(findMeOnSheet(sheet, { firstName: 'Eric', lastName: 'lima', clubCode: '6399002' }), { kind: 'name', index: idx('LIMA') })
})
ok('nom de naissance', () => {
  assert.deepEqual(findMeOnSheet(sheet, { firstName: 'Tom', lastName: 'Foxtrot', clubCode: '6399001' }), { kind: 'name', index: idx('ECHO') })
})
ok('club déduit de la licence (7 premiers chiffres)', () => {
  assert.equal(clubOfMe({ license: '6399001000123' }), '6399001')
  assert.equal(clubOfMe({ clubCode: ' 6383001 ', license: '6399001000123' }), '6383001')
  assert.equal(clubOfMe({ license: 'abc' }), undefined)
  // Licence de la fiche inconnue sur la feuille, mais même club : c'est lui (licence renouvelée…).
  assert.deepEqual(findMeOnSheet(sheet, { firstName: 'Léo', lastName: 'BRAVO', license: '6399001000999' }), { kind: 'name', index: idx('BRAVO') })
})
ok('même nom, autre club : absent', () => {
  assert.deepEqual(findMeOnSheet(sheet, { firstName: 'Léo', lastName: 'Bravo', clubCode: '6383001' }), { kind: 'absent' })
})
ok('club inconnu : le nom suffit, sauf deux licences différentes', () => {
  const noClub = { ...sheet, homeClub: undefined, awayClub: undefined }
  assert.deepEqual(findMeOnSheet(noClub, { firstName: 'Léo', lastName: 'Bravo' }), { kind: 'name', index: idx('BRAVO') })
  assert.deepEqual(findMeOnSheet(noClub, { firstName: 'Léo', lastName: 'Bravo', license: '1234567000001' }), { kind: 'absent' })
})
ok('personne : absent ; homonymes : several (on ne choisit pas)', () => {
  assert.deepEqual(findMeOnSheet(sheet, { firstName: 'Inconnu', lastName: 'Personne', license: '0000000000000' }), { kind: 'absent' })
  const twice = { ...sheet, roster: [...sheet.roster, { ...sheet.roster[idx('BRAVO')], license: undefined, num: '99' }] }
  assert.deepEqual(findMeOnSheet({ ...twice, roster: twice.roster.map((r) => (r.lastName === 'BRAVO' ? { ...r, license: undefined } : r)) }, { firstName: 'Léo', lastName: 'Bravo', clubCode: '6399001' }), {
    kind: 'several',
  })
  assert.ok(presenceError({ kind: 'absent' })?.includes('feuille'))
  assert.equal(presenceError({ kind: 'license', index: 0 }), undefined)
})
ok('ligne vide : jamais lui', () => {
  assert.equal(onSheetLine({ firstName: '', lastName: '' }, { firstName: '', lastName: '' }), undefined)
  assert.equal(onSheetLine({ firstName: 'A', lastName: '' }, { firstName: 'A', lastName: '' }), undefined)
})

// ---------- Même match ----------
const key = matchKeyOf(sheet)
const ev = (o: Partial<DupCandidate> & { id: string }): DupCandidate => ({ date: sheet.date!, matchSheet: { code: sheet.code, home: sheet.home, away: sheet.away }, ...o })
ok('code rencontre : le match du staff d’abord, puis le plus ancien', () => {
  const list = [
    ev({ id: 'b', createdAtServer: '2026-10-11', proposedBy: { kind: 'joueur', playerId: 'p1' } }),
    ev({ id: 'c', createdAtServer: '2026-10-12' }),
    ev({ id: 'a', createdAtServer: '2026-10-13' }),
    ev({ id: 'z', deleted: true }),
  ]
  assert.equal(findDuplicate(list, key)?.id, 'c')
  assert.equal(findDuplicate([list[0]], key)?.id, 'b')
})
ok('codes différents : jamais le même match (même date et mêmes équipes)', () => {
  assert.equal(sameMatch(ev({ id: 'x', matchSheet: { code: 'AUTRE', home: sheet.home, away: sheet.away } }), key), false)
})
ok('sans code : même date + n° des deux clubs, ou noms des équipes (accents, casse, espaces)', () => {
  const k = { ...key, code: undefined }
  assert.ok(sameMatch(ev({ id: 'x', matchSheet: { home: 'autre nom', away: 'autre', homeClub: '6399001', awayClub: '6399002' } }), k))
  assert.ok(sameMatch(ev({ id: 'y', matchSheet: { home: 'Handball-Club Alpha', away: 'entente  béta hb' } }), k))
  assert.equal(sameMatch(ev({ id: 'w', date: '2026-10-11', matchSheet: { home: sheet.home, away: sheet.away } }), k), false)
  assert.equal(sameMatch(ev({ id: 'v', matchSheet: { home: sheet.away, away: sheet.home } }), k), false)
  assert.equal(sameMatch({ id: 'u', date: sheet.date! }, k), false)
})

// ---------- Ce qui part au serveur ----------
ok('feuille envoyée sans aucun nom ni licence, sa seule ligne à part', () => {
  const i = idx('BRAVO')
  const req = playerSheetRequest(sheet, i)
  const body = JSON.stringify(req.p_sheet)
  for (const r of sheet.roster) {
    // (Nom seul pas vérifié : un nom fictif peut être aussi un mot du nom d'une équipe.)
    assert.ok(!body.includes(r.name) && !body.includes(r.firstName), `nom absent : ${r.name}`)
    assert.ok(!r.license || !body.includes(r.license), 'licence absente')
  }
  assert.ok(req.p_sheet.players.every((x) => !x.playerId), 'aucune fiche reliée par l’appareil')
  assert.equal(req.p_sheet.sync, undefined)
  assert.equal(req.p_sheet.players.length, sheet.roster.length)
  assert.deepEqual(req.p_me, { index: i, license: '9990000000003', lastName: 'BRAVO', firstName: 'Léo' })
  assert.deepEqual(req.p_meta, { date: sheet.date, place: sheet.place, homeClub: '6399001', awayClub: '6399002' })
  // Seul le prénom du jeune lui-même part (dans p_me) ; ceux des autres jamais.
  assert.ok(!JSON.stringify(req).includes('Hugo'))
})

// ---------- Marque « proposé par le joueur », source ----------
ok('proposedOf et sheetSourceOf', () => {
  assert.deepEqual(proposedOf({ proposedBy: { kind: 'joueur', playerId: 'p1', at: '2026-10-20T00:00:00Z' } }), { kind: 'joueur', playerId: 'p1', at: '2026-10-20T00:00:00Z' })
  assert.equal(proposedOf({ proposedBy: { kind: 'autre', playerId: 'p1' } }), undefined)
  assert.equal(proposedOf({ proposedBy: 'p1' }), undefined)
  assert.equal(proposedOf(null), undefined)
  assert.equal(sheetSourceOf({ source: 'joueur' }), 'joueur')
  assert.equal(sheetSourceOf({ source: 'gesthand' }), 'gesthand')
  assert.equal(sheetSourceOf({}), 'staff')
  assert.equal(sheetSourceOf({ source: 'pirate' }), 'staff')
})

// ---------- Mes matchs ----------
const ms = (o: Partial<MatchSheet> = {}): MatchSheet => ({ v: 1, home: 'A', away: 'B', halfMin: 25, players: [], actions: [], importedAt: '', ...o })
ok('mes matchs : feuille reliée ou rattachement, du plus récent au plus ancien ; titres du staff jamais montrés', () => {
  const events = [
    { id: 'e1', date: '2026-10-01', matchSheet: ms({ players: [{ side: 'home', num: '7', playerId: 'p1' }], score: [20, 18] }) },
    { id: 'e2', date: '2026-10-10', matchSheet: ms({ players: [{ side: 'away', num: '9' }] }), proposedBy: { kind: 'joueur', playerId: 'p1' } },
    { id: 'e3', date: '2026-10-05', matchSheet: ms({ players: [{ side: 'home', num: '7', playerId: 'p2' }] }) },
    { id: 'e4', date: '2026-10-06', deleted: true, matchSheet: ms({ players: [{ side: 'home', num: '7', playerId: 'p1' }] }) },
    { id: 'e5', date: '2026-10-07' },
  ]
  const videos = [
    { id: 'v1', url: 'https://youtu.be/aaaaaaaaaaa', title: 'Titre interne', targetKind: 'event', targetId: 'e1' },
    { id: 'v2', url: 'https://youtu.be/bbbbbbbbbbb', title: 'Notre match', targetKind: 'event', targetId: 'e2', proposedBy: { kind: 'joueur', playerId: 'p1' } },
    { id: 'v3', url: 'https://youtu.be/ccccccccccc', targetKind: 'event', targetId: 'e2', deleted: true },
    { id: 'v4', url: 'https://youtu.be/ddddddddddd', targetKind: 'player', targetId: 'e1' },
  ]
  const list = playerMatchesFrom(events, videos, 'p1', [{ eventId: 'e2', side: 'away', num: '9' }])
  assert.deepEqual(
    list.map((m) => [m.eventId, m.side, m.num]),
    [
      ['e2', 'away', '9'],
      ['e1', 'home', '7'],
    ],
  )
  assert.deepEqual(list[1].videos, [{ id: 'v1', url: 'https://youtu.be/aaaaaaaaaaa', mine: false, proposed: false }])
  assert.equal(list[0].videos[0].title, 'Notre match')
  assert.equal(list[0].mine, true, 'proposé par lui (mode essai, sans signature)')
  assert.equal(list[1].score?.[0], 20)
  assert.deepEqual(playerMatchesFrom(events, videos, 'p9'), [])
})

// ---------- Séquenceur simplifié ----------
// Déroulé : 2 de mes buts (rang 1), un but d'un autre (rang 0), une action simultanée à la mienne.
const flow: MatchSheet['actions'] = [
  { t: 60, p: 1, s: [1, 0], k: 'but', side: 'home', pl: 1 },
  { t: 300, p: 1, s: [2, 0], k: 'but', side: 'home', pl: 0 },
  { t: 600, p: 1, s: [3, 0], k: 'but', side: 'home', pl: 1 },
  { t: 600, p: 1, s: [3, 0], k: '2mn', side: 'away', pl: 2 },
  { t: 1600, p: 2, s: [3, 1], k: 'arret', side: 'home', pl: 1 },
]
const players = [
  { side: 'home' as const, num: '4' },
  { side: 'home' as const, num: '7', playerId: 'p1' },
  { side: 'away' as const, num: '9' },
]
const keys = actionKeys(flow)
ok('mes rangs : fiche reliée, sinon équipe + numéro du rattachement', () => {
  assert.deepEqual(myIndexes(players, 'p1'), [1])
  assert.deepEqual(myIndexes(players, 'p2', 'away', '9'), [2])
  assert.deepEqual(myIndexes(players, 'p2'), [])
})
const vid = { id: 'v1', url: 'https://youtu.be/aaaaaaaaaaa' }
ok('données de séquençage : mes actions marquées, aucun joueur ni rang', () => {
  const d = seqDataFrom(ms({ players, actions: flow }), [1])
  assert.deepEqual(
    d.actions.map((a) => !!a.me),
    [true, false, true, false, true],
  )
  assert.ok(!JSON.stringify(d).includes('"pl"'))
  assert.equal(d.staff, undefined)
  assert.deepEqual(myActionKeys(d), [keys[0], keys[2], keys[4]])
})
ok('estimation : sans repère rien ; coup d’envoi posé → minute de la feuille', () => {
  const d = seqDataFrom(ms({ players, actions: flow }), [1])
  assert.ok(myActions(d, vid).every((a) => a.v === undefined))
  const mine = { ...d, mine: { videoId: 'v1', marks: { s1: 100 }, fix: {} } }
  assert.deepEqual(
    myActions(mine, vid).map((a) => a.v),
    [160, 700, 100 + 25 * 60 + 600 + (1600 - 1500)],
  )
  // Repères posés sur une autre vidéo : pas pris.
  assert.ok(myActions(mine, { id: 'v2', url: 'x' }).every((a) => a.v === undefined))
})
ok('le calage du staff prime sur le mien (même vidéo) ; sur une autre vidéo il ne compte pas', () => {
  const d: PlayerSeqData = {
    ...seqDataFrom(ms({ players, actions: flow, sync: { videoId: 'v1', url: vid.url, marks: { s1: 50 }, fix: { [keys[2]]: 640 } } }), [1]),
    mine: { videoId: 'v1', marks: { s1: 100, e1: 1700 }, fix: { [keys[2]]: 700, [keys[0]]: 115 } },
  }
  const m = mergeMarks(d, vid)
  assert.equal(m.marks.s1, 50)
  assert.equal(m.marks.e1, 1700)
  assert.equal(m.markBy('s1'), 'staff')
  assert.equal(m.markBy('e1'), 'moi')
  assert.equal(m.fixBy(keys[2]), 'staff')
  assert.equal(m.fixBy(keys[0]), 'moi')
  const acts = myActions(d, vid)
  assert.deepEqual(
    acts.map((a) => [a.v, a.by]),
    [
      [115, 'moi'],
      [640, 'staff'],
      [acts[2].v, undefined],
    ],
  )
  // Calage du staff sur une autre vidéo : seuls mes repères.
  assert.equal(mergeMarks({ ...d, staff: { ...d.staff!, videoId: 'v9' } }, vid).marks.s1, 100)
})
ok('nettoyage avant envoi : bornes connues, temps valables, MES actions, rien par-dessus le staff', () => {
  const d = seqDataFrom(ms({ players, actions: flow, sync: { videoId: 'v1', marks: { s1: 50 }, fix: { [keys[2]]: 640 } } }), [1])
  const c = cleanMarks(
    { videoId: 'v1', marks: { s1: 99, e1: 1600.04, s2: -1, e2: Number.NaN, zz: 3 } as never, fix: { [keys[0]]: 80.26, [keys[1]]: 300, [keys[2]]: 700, '9:9:9-9:but:0': 1 } },
    d,
    vid,
  )
  assert.deepEqual(c, { videoId: 'v1', marks: { e1: 1600 }, fix: { [keys[0]]: 80.3 } })
})
ok('bornes proposées : mi-temps, plus les prolongations s’il y en a', () => {
  assert.deepEqual(marksFor({ actions: [{ t: 1, p: 1, s: [0, 0], k: 'but' }] }), ['s1', 'e1', 's2', 'e2'])
  assert.deepEqual(marksFor({ actions: [{ t: 1, p: 3, s: [0, 0], k: 'but' }] }), ['s1', 'e1', 's2', 'e2', 's3', 'e3'])
})

// ---------- Messages ----------
ok('messages clairs et positifs', () => {
  assert.ok(matchErrorText('absent_feuille').startsWith('Ton nom'))
  assert.ok(matchErrorText('trop_de_matchs').includes('demain'))
  assert.equal(matchErrorText('xyz'), 'Ça n’a pas marché : xyz')
  assert.ok(matchErrorText('').includes('connexion'))
  // Aucun libellé négatif envers le jeune.
  for (const t of Object.values(MATCH_ERRORS)) assert.ok(!/pas retenu|refusé|interdit|nul/i.test(t), t)
})

console.log(`\n${n} vérifications « Mes matchs » : tout est bon.`)
