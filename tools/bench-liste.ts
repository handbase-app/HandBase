// Mesure (pas un test) : temps des calculs de la liste Joueurs sur 40 000 fiches fictives (src/playerQuery.ts), frappe
// lettre par lettre d'un nom (exact puis approchant), filtres cochés, nombres des menus. Sur ordinateur ; un téléphone milieu
// de gamme est en gros 4 à 6 fois plus lent (ralentissement CPU ×4 du navigateur).
//
//   npx jiti tools/bench-liste.ts
// Mesures du 20/10/2026 (ordinateur), frappe approchante « marix », « marixx » : 54 et 65 ms avant (mots du nom refaits à
// chaque lettre pour chaque fiche, distance d'édition qui créait des tableaux), 20 et 22 ms après (tokensOf gardé :
// src/components/PlayerFilter.tsx ; levenshtein sans tableau neuf : src/nameMatch.ts).
import { buildPlayersIndex, cleanQuery, EMPTY_QUERY, listRecipe, quickCounts, selectPlayers, type JoueursQuery } from '../src/playerQuery'
import { cleanRecipe, type QPlayer, type Recipe } from '../src/recipe'
import { nameTokens, playerHaystack } from '../src/nameMatch'
import type { Laterality, Position } from '../src/db'

type P = QPlayer & { department?: string; license?: string }
const SYL = ['ma', 'ri', 'lo', 'du', 'pon', 'ber', 'nar', 'le', 'fe', 'vre', 'mo', 'reau', 'ga', 'tier', 'dre', 'si', 'mon', 'la', 'cour', 'ti', 'neau', 'bou', 'chet', 'roy']
const FIRST = ['Lucas', 'Léa', 'Jean-Pierre', 'Inès', 'Hugo', 'Zoé', 'Noah', 'Jade', 'Tom', 'Lina', 'Mathéo', 'Chloé', 'Rémi', 'Manon', 'Gabin', 'Louise']
const CLUBS = Array.from({ length: 400 }, (_, i) => `HBC Fictif ${i}`)
const POS: (Position | undefined)[] = ['GB', 'AG', 'ARG', 'DC', 'ARD', 'AD', 'PIV', undefined]
const HANDS: (Laterality | undefined)[] = ['droitier', 'gaucher', 'ambidextre', undefined]
let seed = 11
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31)
const pick = <T>(xs: T[]) => xs[Math.floor(rnd() * xs.length)]
const last = () => {
  const s = pick(SYL) + pick(SYL) + (rnd() < 0.5 ? pick(SYL) : '')
  return s[0].toUpperCase() + s.slice(1)
}
const players: P[] = Array.from({ length: 40_000 }, (_, i) => {
  const c = Math.floor(rnd() * CLUBS.length)
  return {
    id: `p${i}`,
    firstName: pick(FIRST),
    lastName: last(),
    birthDate: `${2008 + Math.floor(rnd() * 6)}-${String(1 + Math.floor(rnd() * 12)).padStart(2, '0')}-15`,
    sex: rnd() < 0.5 ? 'M' : 'F',
    club: CLUBS[c],
    department: String(10 + (c % 85)),
    position: pick(POS),
    laterality: pick(HANDS),
    license: `638301${String(1000000 + i).slice(-7)}`,
  }
}).sort((a, b) => a.lastName.localeCompare(b.lastName, 'fr') || a.id.localeCompare(b.id))

const ms = (f: () => void, n = 3) => {
  let best = Infinity
  for (let i = 0; i < n; i++) {
    const t0 = performance.now()
    f()
    best = Math.min(best, performance.now() - t0)
  }
  return Math.round(best * 10) / 10
}

let ix!: ReturnType<typeof buildPlayersIndex<P>>
const tIndex = ms(() => {
  ix = buildPlayersIndex<P>({
    players,
    sights: [],
    evals: [],
    measures: players.filter((_, i) => i % 2).map((p) => ({ playerId: p.id, criterionId: 'taille', value: 150 + (Number(p.id.slice(1)) % 50), date: '2026-03-01' })),
    criteria: [{ id: 'taille', label: 'Taille', category: 'Gabarit', kind: 'factual', scale: 'number', unit: 'cm' }],
    groups: [{ id: 'g1', playerIds: players.slice(0, 3000).map((p) => p.id) }],
    events: [],
    deptOf: (p) => p.department,
    regionOf: (d) => (Number(d) < 50 ? 'r1' : 'r2'),
    today: '2026-10-20',
  })
}, 1)

const hays = new WeakMap<P, string>()
const hay = (p: P) => hays.get(p) ?? (hays.set(p, playerHaystack(p)), hays.get(p)!)
const tokNoCache = (p: P) => nameTokens(p)
const toks = new WeakMap<P, string[]>()
const tokCache = (p: P) => toks.get(p) ?? (toks.set(p, nameTokens(p)), toks.get(p)!)
const withPop = (pop: Recipe['pop'], q = ''): JoueursQuery => cleanQuery({ recipe: listRecipe(cleanRecipe({ pop })), q })

const tHayFirst = ms(() => selectPlayers(ix, { ...EMPTY_QUERY, q: 'x' }, hay, tokNoCache), 1)
const typing = (word: string, tok: (p: P) => string[]) => {
  const out: number[] = []
  for (let i = 1; i <= word.length; i++) out.push(ms(() => selectPlayers(ix, { ...EMPTY_QUERY, q: word.slice(0, i) }, hay, tok)))
  return out
}
console.log(`40 000 fiches (ordinateur ; téléphone ≈ ×4 à ×6)`)
console.log(`  index (buildPlayersIndex)            ${tIndex} ms`)
console.log(`  1re recherche (textes préparés)       ${tHayFirst} ms`)
console.log(`  sans filtre                           ${ms(() => selectPlayers(ix, EMPTY_QUERY, hay, tokNoCache))} ms`)
console.log(`  frappe « dupon » (exact)              ${typing('dupon', tokNoCache).join(' / ')} ms`)
console.log(`  frappe « marixx » (approchant), mots refaits ${typing('marixx', tokNoCache).join(' / ')} ms`)
const tokFirst = ms(() => selectPlayers(ix, { ...EMPTY_QUERY, q: 'zzzq' }, hay, tokCache), 1)
console.log(`  mots du nom préparés (1re fois)      ${tokFirst} ms`)
console.log(`  frappe « marixx » (approchant), mots gardés ${typing('marixx', tokCache).join(' / ')} ms`)
console.log(`  garçons 2010 ≥ 185                    ${ms(() => selectPlayers(ix, withPop({ sex: 'M', years: [2010, 2010], hMin: 185 }), hay, tokCache))} ms`)
console.log(`  dépt + gaucher + pivot                ${ms(() => selectPlayers(ix, withPop({ depts: ['83'], hand: 'gaucher', positions: ['PIV'] }), hay, tokCache))} ms`)
console.log(`  tri par taille (filles)               ${ms(() => selectPlayers(ix, { recipe: listRecipe(cleanRecipe({ pop: { sex: 'F' }, out: { type: 'list', sort: { by: 'height', dir: 'desc' } } })), q: '' }, hay, tokCache))} ms`)
console.log(`  nombres des menus (quickCounts)       ${ms(() => quickCounts(ix, withPop({ sex: 'M', depts: ['83'] }), hay, tokCache))} ms`)
