// Feuille de match de la DÉMONSTRATION (public/demo/feuille-match-demo.pdf) : le déroulé d'une vraie feuille (temps,
// actions, scores, périodes, saisies en retard, date, heure, compétition) avec des joueurs de la base de démonstration
// à la place des vrais joueurs (recevant → JS Sainte-Luneignan, visiteur → Olympique Portlieu ; gardiens → gardiens),
// officiels, arbitres et salle inventés. Elle peut ainsi être calée sur la vraie vidéo du match.
//
//   npx jiti tools/feuille-demo.ts chemin/vers/la-vraie-feuille.pdf [sortie.pdf]
//
// La vraie feuille est lue au moment de l'exécution et n'est jamais recopiée : seuls les temps, scores, types d'action,
// numéros de maillot et l'en-tête du match passent dans la feuille produite ; aucun nom ni licence réel.
import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { KIND_LABEL, lateIndexes, parseSheet, type PdfItem } from '../src/matchSheet'
import { writeSheet } from './feuille-fictive.mjs'

type Demo = { name: string; lic: string; gk?: boolean }
// Joueurs U18 masculins de la base de démonstration (données fictives).
const HOME: Demo[] = [
  { name: 'BÉNARD Rayan', lic: '5531320000080', gk: true },
  { name: 'ROY Rayan', lic: '5531320000157', gk: true },
  { name: 'ÉTIENNE Mehdi', lic: '5531320000235', gk: true },
  // Homonyme du gardien, dans la même équipe : seule la licence (et les statistiques) les distingue.
  { name: 'BÉNARD Rayan', lic: '5531320000093' },
  { name: 'FAURE Sacha', lic: '5531320000226' },
  { name: 'CARPENTIER Martin', lic: '5531320000192' },
  { name: 'BERTIN Timéo', lic: '5531320000335' },
  { name: 'CHEVALIER Maël', lic: '5531320000117' },
  { name: 'GIRAUD Hugo', lic: '5531320000217' },
  { name: 'MAILLARD Samuel', lic: '5531320000096' },
  { name: 'NOËL Arthur', lic: '5531320000057' },
  { name: 'PAYET Tom', lic: '5531320000195' },
  { name: 'SANTOS Mehdi', lic: '5531320000018' },
  { name: 'VIDAL Hugo', lic: '5531320000032' },
]
const AWAY: Demo[] = [
  { name: 'GERMAIN Clément', lic: '6075817000005', gk: true },
  { name: 'JULIEN Noé', lic: '6075817000030', gk: true },
  { name: 'BOUCHER Adam', lic: '6075817000134' },
  { name: 'CHAUVIN Mohamed', lic: '6075817000128' },
  { name: 'JACQUET Clément', lic: '6075817000094' },
  { name: 'JOLY Maël', lic: '6075817000048' },
  { name: 'MARTY Maxime', lic: '6075817000089' },
  { name: 'MENDES Louis', lic: '6075817000037' },
  { name: 'PAYET Timéo', lic: '6075817000167' },
  { name: 'GARNIER Evan', lic: '6075817000036' },
  { name: 'GUICHARD Dylan', lic: '6075817000049' },
  { name: 'LAPORTE Valentin', lic: '6075817000202' },
  { name: 'MILLET Adam', lic: '6075817000233' },
  { name: 'ROY Victor', lic: '6075817000070' },
]

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

const [src, dest = 'public/demo/feuille-match-demo.pdf'] = process.argv.slice(2)
if (!src) throw new Error('Indique le chemin de la vraie feuille de match (PDF).')
const real = parseSheet(await items(new Uint8Array(readFileSync(src))))

// Correspondance réel → démo (en mémoire seulement) : gardiens (arrêts sur la feuille) → gardiens, autres → joueurs de champ.
const mapping = new Map<number, Demo & { num: string; capt?: boolean }>()
for (const side of ['home', 'away'] as const) {
  const demo = side === 'home' ? HOME : AWAY
  const gks = demo.filter((p) => p.gk)
  const field = demo.filter((p) => !p.gk)
  const idx = real.roster.flatMap((r, i) => (r.side === side ? [i] : []))
  const keepers = idx.filter((i) => real.roster[i].stats.arrets)
  const others = idx.filter((i) => !real.roster[i].stats.arrets)
  assert.ok(keepers.length <= gks.length && others.length <= field.length, `pas assez de joueurs de démo (${side})`)
  keepers.forEach((i, j) => mapping.set(i, { ...gks[j], num: real.roster[i].num ?? String(j + 1), capt: real.roster[i].captain }))
  others.forEach((i, j) => mapping.set(i, { ...field[j], num: real.roster[i].num ?? String(50 + j), capt: real.roster[i].captain }))
}
const team = (side: 'home' | 'away') =>
  real.roster.flatMap((r, i) => (r.side === side ? [mapping.get(i)!] : []))

const OFFICIAL = 'MARCHAL Denis'
const flow = real.actions.map((a) => ({
  p: a.p,
  t: a.t,
  s: a.s,
  side: a.side,
  label: a.k === 'tm' ? `Temps mort ${a.side === 'home' ? 'Recevant' : 'Visiteur'}` : a.k === 'autre' ? a.label.split(' ')[0] : a.k === '2mn' ? '2MN' : KIND_LABEL[a.k],
  // Action d'un officiel (avertissement…) : un officiel inventé.
  player: a.k === 'tm' ? undefined : a.pl !== undefined ? mapping.get(a.pl) : { name: OFFICIAL },
}))

const [d, m, y] = (real.date ?? '2026-01-01').split('-').reverse()
const weekday = new Date(`${real.date}T12:00:00`).toLocaleDateString('fr-FR', { weekday: 'long' })
const r = writeSheet(
  {
    code: 'DEMOU18',
    competition: real.competition ?? 'U18 MASCULINS',
    pool: 'POULE A',
    date: `${weekday} ${d}/${m}/${y}${real.time ? ` ${real.time}` : ''}`,
    salle: ['SALLE DU STADE', 'SALLE DU STADE 2 RUE DU PORT 55100 SAINTE-LUNEIGNAN'],
    table: 'LEFORT Agnès',
    home: { name: 'JS SAINTE-LUNEIGNAN HANDBALL', club: '5531320', officials: [OFFICIAL, 'LECLERC Sophie'], players: team('home') },
    away: { name: 'OLYMPIQUE PORTLIEU HANDBALL', club: '6075817', officials: ['BARON Michel'], players: team('away') },
  },
  flow,
)

// Vérification : la feuille produite se relit avec le même déroulé.
const out = parseSheet(await items(new Uint8Array(r.bytes)))
assert.equal(out.actions.length, real.actions.length)
out.actions.forEach((a, i) => {
  const b = real.actions[i]
  assert.deepEqual([a.p, a.t, a.s, a.k], [b.p, b.t, b.s, b.k], `action ${i}`)
  // Bon joueur de démo, homonymes compris (départagés par les statistiques de la feuille).
  if (b.pl !== undefined) assert.equal(out.roster[a.pl!]?.license, mapping.get(b.pl)!.lic, `joueur de l’action ${i}`)
})
assert.deepEqual(out.score, real.score)
assert.equal(lateIndexes(out.actions).size, lateIndexes(real.actions).size)
mkdirSync(dirname(dest), { recursive: true })
writeFileSync(dest, r.bytes)
console.log(`${dest} : ${out.actions.length} actions, score ${out.score?.join('-')}, ${out.roster.length} joueurs, ${lateIndexes(out.actions).size} en retard`)
