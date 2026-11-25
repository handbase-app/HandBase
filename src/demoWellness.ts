import { addDays, isWeekday, seasonStart, staffDay, WELLNESS_KEYS, type WellnessEntry, type WellnessSession } from './wellness'

/*
 * Wellness FICTIF de la démonstration (src/demo.ts, mode essai) : pur et déterministe (tiré des identifiants, jamais de
 * hasard), testé par tools/test-wellness.ts. Sur `ids` (joueurs du groupe de démonstration, dans l'ordre) :
 *  - les deux premiers répondent tous les jours de semaine (100 %) ;
 *  - le 3e signale le jour du tableau (aujourd'hui ; le week-end, vendredi : staffDay) des courbatures aux deux quadriceps
 *    (3/10 chacun) ;
 *  - le 4e n'a pas encore répondu ce jour-là ;
 *  - le 5e est nettement en dessous de sa moyenne aujourd'hui (énergie, fraîcheur) ;
 *  - le 7e a une semaine plus chargée que d'habitude ;
 *  - le 8e signale une contracture aux ischio-jambiers droits (6/10, 7/10 le jour demandé d'avant) et une gêne aux lombaires
 *    (2/10) ;
 *  - les autres répondent environ 6 jours de semaine sur 7.
 * 5 semaines d'historique ; séances (intensité ET durée) le lundi, mardi, jeudi et vendredi (et le mercredi pour le 7e).
 */

const hashN = (s: string, n: number) => {
  let h = 7
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return h % n
}
const clamp = (n: number) => Math.max(1, Math.min(10, n))

export function buildDemoWellness(ids: readonly string[], today: string, weeks = 5): Record<string, { entries: WellnessEntry[]; sessions: WellnessSession[] }> {
  const out: Record<string, { entries: WellnessEntry[]; sessions: WellnessSession[] }> = {}
  const at = `${today}T07:30:00.000Z`
  const ref = staffDay(today)
  // Jour demandé d'avant (la contracture du 8e commence là).
  const before = staffDay(addDays(ref, -1))
  ids.forEach((id, i) => {
    const entries: WellnessEntry[] = []
    const sessions: WellnessSession[] = []
    const base = 6 + hashN(id, 3) // 6 à 8
    for (let n = weeks * 7 - 1; n >= 0; n--) {
      const day = addDays(today, -n)
      if (!isWeekday(day)) continue
      const isToday = day === ref
      const answers = i < 2 || (isToday ? i !== 3 : day === before && i === 7 ? true : hashN(id + day, 7) !== 0)
      if (answers) {
        const scores: WellnessEntry['scores'] = {}
        for (const k of WELLNESS_KEYS) scores[k] = clamp(base + hashN(id + day + k, 3) - 1)
        const e: WellnessEntry = { day, scores, pain: false, at: `${day}T07:${String(10 + hashN(id + day, 40)).padStart(2, '0')}:00.000Z` }
        if (isToday && i === 2)
          Object.assign(e, {
            pain: true,
            pains: [
              { zone: 'quadriceps', cote: 'd', type: 'courbatures', intensite: 3 },
              { zone: 'quadriceps', cote: 'g', type: 'courbatures', intensite: 3 },
            ],
            scores: { ...scores, fraicheur: clamp(base - 2) },
          })
        if (isToday && i === 4) e.scores = { ...scores, energie: clamp(base - 4), fraicheur: clamp(base - 3) }
        if (i === 7 && day === before) Object.assign(e, { pain: true, pains: [{ zone: 'ischios', cote: 'd', type: 'contracture', intensite: 7 }], scores: { ...scores, fraicheur: clamp(base - 2) } })
        if (i === 7 && isToday)
          Object.assign(e, {
            pain: true,
            pains: [
              { zone: 'ischios', cote: 'd', type: 'contracture', intensite: 6 },
              { zone: 'lombaires', type: 'gene', intensite: 2 },
            ],
            scores: { ...scores, fraicheur: clamp(base - 1) },
          })
        entries.push(e)
      }
      // Séances : lundi, mardi, jeudi, vendredi (le 7e aussi le mercredi), notées le soir même, toujours avec leur durée.
      const dow = new Date(day + 'T12:00:00Z').getUTCDay()
      const trains = dow !== 3 || i === 6
      if (trains && day !== today && !(isToday && i === 3)) {
        const heavy = i === 6 && n <= 6
        const rpe = clamp(5 + hashN(id + day + 'rpe', 3) + (heavy ? 2 : 0))
        const minutes = heavy ? 120 : [75, 90, 90, 105][hashN(id + day + 'min', 4)]
        sessions.push({ id: `demo-seance-${id.replace(/[^A-Za-z0-9_-]/g, '')}-${day}`, day, rpe, minutes, at })
      }
    }
    out[id] = { entries: entries.reverse(), sessions: sessions.reverse() }
  })
  return out
}

/**
 * Saison passée FICTIVE (jauges « même période l'an dernier » du tableau du groupe, src/pages/GroupWellness.tsx) : du
 * 1er septembre au 30 juin de la saison d'avant, jours de semaine, ~6 réponses sur 7 (les deux premiers : toutes). Pour que la
 * démonstration montre des écarts : l'an dernier, énergie et sommeil un peu plus hauts, humeur un peu plus basse, fraîcheur
 * pareille. Pur et déterministe (tiré des identifiants) ; aucune séance. Testé par tools/test-wellness-periodes.ts.
 */
export const DEMO_LAST_YEAR_SHIFT: Record<string, number> = { energie: 1.5, fraicheur: 0, humeur: -1, sommeil: 1 }
export function buildDemoWellnessLastYear(ids: readonly string[], today: string): Record<string, WellnessEntry[]> {
  const out: Record<string, WellnessEntry[]> = {}
  const y = Number(seasonStart(today).slice(0, 4)) - 1
  const from = `${y}-09-01`
  const to = `${y + 1}-06-30`
  ids.forEach((id, i) => {
    const base = 6 + hashN(id, 3)
    const list: WellnessEntry[] = []
    for (let day = from; day <= to; day = addDays(day, 1)) {
      if (!isWeekday(day)) continue
      if (i >= 2 && hashN(id + day + 'ly', 7) === 0) continue
      const scores: WellnessEntry['scores'] = {}
      for (const k of WELLNESS_KEYS) scores[k] = clamp(Math.round(base + hashN(id + day + k, 3) - 1 + DEMO_LAST_YEAR_SHIFT[k]))
      list.push({ day, scores, pain: false, at: `${day}T07:${String(10 + hashN(id + day, 40)).padStart(2, '0')}:00.000Z` })
    }
    out[id] = list
  })
  return out
}
