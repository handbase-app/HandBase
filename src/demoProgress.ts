import type { Evaluation, HBEvent, Player } from './db'

/*
 * Démonstration de la vue « Progression » de l'onglet Avis (src/components/OpinionsProgress.tsx) : une saison passée
 * (sept. 2025 → mai 2026, 8 événements génériques) d'avis sur 4 joueurs fictifs déjà présents dans la démo, pour voir le
 * chemin parcouru : montée, baisse, « a varié ↕ » (yo-yo), et 1 → 5 → 4 (« dernier avis −1 »). Deux observateurs par
 * événement ; quelques critères pas notés à certains crans (report de la dernière note), un critère noté plus tard que les
 * autres (« nouveau » au départ). Les notes finissent près de celles des avis existants du joueur (la saison en cours
 * continue sans à-coup). Calcul pur et déterministe, sans le tirage au hasard du reste de la démo (sa suite ne change pas).
 * Identifiants « demo-prog-… » : effacés avec la démo (clearDemo).
 */

const P = 'demo-prog-'

/** Saison passée : noms et types génériques. */
const SEASON: Omit<HBEvent, 'id' | 'updatedAt' | 'playerIds'>[] = [
  { name: 'Tournoi de rentrée', type: 'tournoi', date: '2025-09-20', place: 'Démo' },
  { name: 'Stage de Toussaint', type: 'entrainement', date: '2025-10-25', place: 'Démo' },
  { name: 'Match amical de novembre', type: 'match', date: '2025-11-22', place: 'Démo' },
  { name: 'Tournoi de Noël', type: 'tournoi', date: '2025-12-13', place: 'Démo' },
  { name: 'Match de janvier', type: 'match', date: '2026-01-24', place: 'Démo' },
  { name: 'Stage d’hiver', type: 'entrainement', date: '2026-02-21', place: 'Démo' },
  { name: 'Stage de printemps', type: 'entrainement', date: '2026-04-18', place: 'Démo' },
  { name: 'Tournoi de fin de saison', type: 'tournoi', date: '2026-05-30', place: 'Démo' },
]

type Shape = 'montee' | 'baisse' | 'yoyo' | 'pic' | 'stable'
/** Profil dominant de chaque joueur choisi (le 1er surtout monte, le 2e baisse, le 3e fait le yo-yo, le 4e 1 → 5 → 4). */
const MIX: Shape[][] = [
  ['montee', 'montee', 'pic', 'montee', 'stable', 'yoyo', 'montee', 'baisse'],
  ['baisse', 'baisse', 'stable', 'montee', 'baisse', 'yoyo'],
  ['yoyo', 'yoyo', 'montee', 'yoyo', 'stable', 'baisse'],
  ['pic', 'pic', 'montee', 'pic', 'yoyo', 'stable', 'baisse'],
]
const YOYO = [0, 1.5, -1, 1, -1.2, 1, -0.5, 0.3]
const PIC = [1, 2, 3, 4, 5, 5, 5, 4]

const clamp = (v: number) => Math.max(1, Math.min(5, v))
const hashN = (s: string, n: number) => {
  let h = 7
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return h % n
}

/** Note « réelle » au cran j (0 à 7) d'un critère de profil `shape`, qui finit près de `end`. */
function noteAt(shape: Shape, end: number, j: number): number {
  const f = j / (SEASON.length - 1)
  if (shape === 'montee') return clamp(Math.max(1, end - 2.5) + (end - Math.max(1, end - 2.5)) * f)
  if (shape === 'baisse') return clamp(Math.min(5, end + 1.5) + (end - Math.min(5, end + 1.5)) * f)
  if (shape === 'yoyo') return clamp(end + YOYO[j])
  if (shape === 'pic') return PIC[j]
  return clamp(end)
}

/**
 * Avis de la saison passée pour 4 joueurs (ceux qui ont le plus d'avis, hors gardiens), avec leurs critères (`critsOf`)
 * et deux observateurs (`observers`).
 */
export function buildProgressDemo(
  players: Player[],
  existing: readonly Evaluation[],
  critsOf: (p: Player) => string[],
  observers: [string, string],
  now: number,
  skip: (p: Player) => boolean = () => false,
): { events: HBEvent[]; evaluations: Evaluation[] } {
  const avisOf = (id: string) => existing.filter((e) => e.playerId === id)
  const chosen = players
    .filter((p) => !skip(p))
    .map((p, i) => ({ p, i, n: avisOf(p.id).length }))
    .sort((a, b) => b.n - a.n || a.i - b.i)
    .slice(0, MIX.length)
    .map((x) => x.p)
  const events: HBEvent[] = SEASON.map((ev, j) => ({ ...ev, id: `${P}ev-${j + 1}`, playerIds: chosen.map((p) => p.id), updatedAt: now }))
  const evaluations: Evaluation[] = []
  chosen.forEach((p, k) => {
    const crits = critsOf(p)
    const mine = avisOf(p.id)
    // Note d'arrivée : moyenne de ses avis existants sur le critère (3,5 sans avis).
    const endOf = (c: string) => {
      const vs = mine.map((e) => e.scores[c]).filter((v): v is number => typeof v === 'number')
      return vs.length ? vs.reduce((a, b) => a + b, 0) / vs.length : 3.5
    }
    // Un critère noté seulement à partir du 3e cran.
    const late = crits[hashN(p.id + 'tard', crits.length)]
    SEASON.forEach((_, j) => {
      const notes = [{} as Record<string, number>, {} as Record<string, number>]
      crits.forEach((c, ci) => {
        if (c === late && j < 2) return
        // Pas observé ce jour-là (jamais au premier ni au dernier cran).
        if (j > 0 && j < SEASON.length - 1 && hashN(`${p.id}:${c}:${j}`, 6) === 0) return
        const v = noteAt(MIX[k][ci % MIX[k].length], endOf(c), j)
        // Deux observateurs : leurs notes entières encadrent la note « réelle » (moyenne au demi-point).
        notes[0][c] = clamp(Math.floor(v + 0.25))
        notes[1][c] = clamp(Math.ceil(v - 0.25))
      })
      observers.forEach((o, oi) =>
        evaluations.push({
          id: `${P}e-${j + 1}-${p.id}-${oi + 1}`,
          playerId: p.id,
          eventId: events[j].id,
          observer: o,
          date: events[j].date,
          scores: notes[oi],
          minutesObserved: 30 + 10 * hashN(`${p.id}${j}${oi}`, 6),
          updatedAt: now,
        }),
      )
    })
  })
  return { events, evaluations }
}
