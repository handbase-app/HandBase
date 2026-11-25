import { cahierText, cleanCahier, cleanMatch, type CahierKind, type CahierParts, type MatchParts } from './cahiers'
import { addDays, DEFAULT_COACH_CRITERIA, DEFAULT_WISHES, dow, isRequestedDay, mondayOf, seasonYear, trimesterBounds, type Zone } from './lamp'
import type { JournalNote } from './playerSpace'
import { WELLNESS_KEYS, type WellnessEntry, type WellnessSession } from './wellness'

/*
 * Lampe d'Aladin FICTIVE de la démonstration (src/demo.ts, mode essai) : pure et déterministe (tirée des identifiants, jamais
 * de hasard), testée par tools/test-lampe.ts. Part du wellness fictif des 5 dernières semaines (src/demoWellness.ts, gardé tel
 * quel : ses scénarios restent vrais) et le prolonge jusqu'à la rentrée, puis ajoute cahiers du hand, cahiers de match, points
 * des encadrants et vœux. Sur `ids` (joueurs du groupe de démonstration, dans l'ordre) :
 *  - le 1er : tout rempli depuis la rentrée (aujourd'hui compris), un cahier de match chaque samedi, encadrants au maximum →
 *    en route vers 100 % ;
 *  - le 2e : tout rempli, sauf le cahier du hand d'aujourd'hui (« Encore ton cahier du hand… »), une partie des encadrants ;
 *  - les autres : des taux variés (wellness ~6 jours sur 7, séance ~85 %, cahier de 40 à 90 %), quelques cahiers de match.
 * Zone B (site de démonstration dans le Var). Textes courts, positifs, sans aucun nom.
 */

export const DEMO_LAMP_ZONE: Zone = 'B'

const hashN = (s: string, n: number) => {
  let h = 7
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return h % n
}
const clamp = (n: number) => Math.max(1, Math.min(10, n))

export const DEMO_TRAVAIL = [
  'Les tirs en appui, je me sentais bien dans mes jambes',
  'Le repli défensif, bonnes sensations',
  'Les passes dans la course',
  'Le jeu à deux avec le pivot',
  'Les appuis en défense, j’étais réactif',
  'Le 1 contre 1, plus de confiance',
  'La relance rapide après la récupération',
]
export const DEMO_DIFFICILE = [
  'Enchaîner les efforts en fin de séance',
  'Rester concentré sur les consignes',
  'Garder la précision quand je suis fatigué',
  'Communiquer en défense',
  'Le timing de la passe',
]
export const DEMO_OBJECTIF = [
  'Garder ma précision jusqu’au bout',
  'Parler plus en défense',
  'Prendre l’intervalle plus vite',
  'Rester lucide en fin de séance',
  'Travailler mon appui gauche',
]
export const DEMO_BIEN = ['Mes courses en contre-attaque', 'Mes duels', 'Mon placement', 'Mes passes décisives', 'Mon énergie du début à la fin']
export const DEMO_AMELIORER = ['Mes tirs de loin', 'Mon repli', 'Ma lecture du jeu', 'Ma communication', 'Mes choix en fin de match']
const pick = <T>(xs: readonly T[], key: string) => xs[hashN(key, xs.length)]

export interface DemoLampPlayer {
  wellness: { entries: WellnessEntry[]; sessions: WellnessSession[] }
  notes: JournalNote[]
  coach: Record<string, number>
  wishes: string[]
}
export interface DemoLamp {
  zone: Zone
  players: Record<string, DemoLampPlayer>
}

function note(id: string, kind: CahierKind, day: string, parts: CahierParts | MatchParts, shared: boolean): JournalNote {
  return { id: `demo-cahier-${id.replace(/[^A-Za-z0-9_-]/g, '')}-${kind}-${day}`, at: `${day}T18:${String(10 + hashN(id + day, 45)).padStart(2, '0')}:00.000Z`, text: cahierText(kind, parts), shared, kind, day, parts: parts as Record<string, string | number> }
}

export function buildDemoLamp(ids: readonly string[], today: string, base: Record<string, { entries: WellnessEntry[]; sessions: WellnessSession[] }>): DemoLamp {
  const players: Record<string, DemoLampPlayer> = {}
  const seasonFrom = trimesterBounds(seasonYear(today))[0].from
  const req = (d: string) => isRequestedDay(d, DEMO_LAMP_ZONE)
  ids.forEach((id, i) => {
    const b = base[id] ?? { entries: [], sessions: [] }
    const perfect = i < 2
    // Wellness : celui de la démonstration (5 semaines), prolongé jusqu'à la rentrée.
    const firstBase = b.entries.map((e) => e.day).sort()[0] ?? today
    const entries: WellnessEntry[] = []
    const sessions: WellnessSession[] = []
    const baseLevel = 6 + hashN(id, 3)
    for (let d = seasonFrom; d < firstBase && d <= today; d = addDays(d, 1)) {
      if (!req(d)) continue
      if (!perfect && hashN(id + d + 'w', 7) === 0) continue
      const scores: WellnessEntry['scores'] = {}
      for (const k of WELLNESS_KEYS) scores[k] = clamp(baseLevel + hashN(id + d + k, 3) - 1)
      entries.push({ day: d, scores, pain: false, at: `${d}T07:${String(10 + hashN(id + d, 40)).padStart(2, '0')}:00.000Z` })
    }
    entries.push(...b.entries)
    // Séances : celles de la démonstration ; les parfaits en ont une chaque jour demandé (aujourd'hui compris) ; les autres
    // ~85 % des jours demandés avant les 5 semaines.
    const sessionDays = new Set(b.sessions.map((s) => s.day))
    sessions.push(...b.sessions)
    for (let d = seasonFrom; d <= today; d = addDays(d, 1)) {
      if (!req(d) || sessionDays.has(d)) continue
      const add = perfect || (d !== today && hashN(id + d + 's', 20) < 17)
      if (!add) continue
      sessions.push({ id: `demo-seance-${id.replace(/[^A-Za-z0-9_-]/g, '')}-${d}`, day: d, rpe: clamp(5 + hashN(id + d + 'rpe', 3)), minutes: [75, 90, 90, 105][hashN(id + d + 'min', 4)], at: `${d}T19:00:00.000Z` })
    }
    // Cahiers du hand : parfaits tous les jours demandés (le 2e : pas encore aujourd'hui) ; les autres de 40 à 90 %.
    const rate = perfect ? 10 : 4 + (i % 6)
    const notes: JournalNote[] = []
    const answered = new Set(entries.map((e) => e.day))
    for (let d = seasonFrom; d <= today; d = addDays(d, 1)) {
      if (!req(d)) continue
      if (i === 1 && d === today) continue
      if (!perfect && (!answered.has(d) || hashN(id + d + 'c', 10) >= rate)) continue
      const parts = cleanCahier({ travail: pick(DEMO_TRAVAIL, id + d + 't'), difficile: pick(DEMO_DIFFICILE, id + d + 'd'), objectif: pick(DEMO_OBJECTIF, id + d + 'o') })
      notes.push(note(id, 'cahier', d, parts, hashN(id + d + 'p', 4) === 0))
    }
    // Cahiers de match : les parfaits chaque samedi passé ; les autres un samedi sur trois environ.
    for (let m = mondayOf(seasonFrom); addDays(m, 5) <= today; m = addDays(m, 7)) {
      const sat = addDays(m, 5)
      if (sat < seasonFrom || dow(sat) !== 6) continue
      if (!perfect && hashN(id + sat + 'm', 3) !== 0) continue
      const nous = 18 + hashN(id + sat + 'n', 14)
      const eux = 18 + hashN(id + sat + 'e', 14)
      const parts = cleanMatch({
        adversaire: `Club fictif ${'ABCDEFGH'[hashN(id + sat + 'a', 8)]}`,
        nous,
        eux,
        sensation: (['super', 'correct', 'complique'] as const)[hashN(id + sat + 's', 3)],
        mt1: 15 + hashN(id + sat + '1', 16),
        mt2: 10 + hashN(id + sat + '2', 21),
        bienAtt: pick(DEMO_BIEN, id + sat + 'ba'),
        bienDef: pick(DEMO_BIEN, id + sat + 'bd'),
        amelAtt: pick(DEMO_AMELIORER, id + sat + 'aa'),
        amelDef: pick(DEMO_AMELIORER, id + sat + 'ad'),
      })
      notes.push(note(id, 'match', sat, parts, hashN(id + sat + 'p', 3) === 0))
    }
    const keys = DEFAULT_COACH_CRITERIA.map((c) => c.key)
    const coach: Record<string, number> =
      i === 0 ? Object.fromEntries(keys.map((k) => [k, 2])) : i === 1 ? { [keys[0]]: 2, [keys[1]]: 2, [keys[2]]: 1 } : i === 4 ? { [keys[1]]: 1 } : i === 6 ? { [keys[0]]: 1, [keys[4]]: 1 } : {}
    const w = DEFAULT_WISHES.map((x) => x.id)
    const wishes = i % 5 === 3 ? [] : [w[(i * 2) % w.length], w[(i * 2 + 3) % w.length], w[(i + 1) % w.length]].filter((x, k, a) => a.indexOf(x) === k).slice(0, i === 0 ? 3 : 1 + (i % 3))
    players[id] = {
      wellness: { entries: entries.sort((a, c) => a.day.localeCompare(c.day)), sessions: sessions.sort((a, c) => a.day.localeCompare(c.day)) },
      notes: notes.sort((a, c) => (a.at < c.at ? 1 : -1)),
      coach,
      wishes,
    }
  })
  return { zone: DEMO_LAMP_ZONE, players }
}
