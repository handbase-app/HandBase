// Test du wellness (src/wellness.ts, src/demoWellness.ts ; règles reprises par supabase/073_wellness.sql) : notes 1 à 10 et
// douleur nettoyées, jours de semaine seulement pour le taux de réponse (période, début en cours de saison, week-end jamais
// demandé), saison réglable, couleurs par rapport à SA moyenne, charge aiguë / chronique (durée facultative), règles sur
// l'appareil (aujourd'hui seulement, séances d'aujourd'hui ou d'hier, 6 par jour), mots positifs, réglage de l'installation
// fermé par défaut, cohérence avec le script SQL, données de démonstration. Données fictives.
//
//   npx jiti tools/test-wellness.ts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  addDays,
  BODY_ZONES,
  chargeSummary,
  chargeTone,
  cleanEntry,
  cleanPainText,
  cleanZones,
  completionRate,
  entryFromRow,
  isWeekday,
  myHistory,
  myWellnessExport,
  ownAverage,
  painWord,
  purgeBefore,
  removeSessionLocal,
  rpeWord,
  saveEntryLocal,
  saveSessionLocal,
  scaleWord,
  seasonStart,
  SEASON_START_MONTH,
  sessionFromRow,
  sessionLoad,
  staffRank,
  staffRow,
  toneVsAverage,
  TONE_WORDS,
  CHARGE_WORDS,
  wellnessEnabledOf,
  wellnessErrorText,
  WELLNESS_ERRORS,
  WELLNESS_GRACE_DAYS,
  WELLNESS_KEYS,
  type WellnessEntry,
  type WellnessSession,
} from '../src/wellness'
import { buildDemoWellness } from '../src/demoWellness'

let n = 0
const t = (name: string, f: () => void) => {
  f()
  n++
  console.log(`ok ${n} - ${name}`)
}

// Samedi 7, dimanche 8, lundi 9 novembre 2026.
const MON = '2026-11-09'
const entry = (day: string, s: Partial<Record<string, number>>, pain = false): WellnessEntry => ({ day, scores: s, pain })

t('jours de semaine et calendrier', () => {
  assert.equal(isWeekday('2026-11-07'), false)
  assert.equal(isWeekday('2026-11-08'), false)
  assert.equal(isWeekday(MON), true)
  assert.equal(isWeekday('2026-11-13'), true)
  assert.equal(addDays('2026-10-25', 1), '2026-10-26') // changement d'heure : sans effet
  assert.equal(addDays('2026-03-01', -1), '2026-02-28')
})

t('taux de réponse : jours de semaine seulement', () => {
  // Du lundi 2 au dimanche 15 novembre : 10 jours demandés.
  const r = completionRate(['2026-11-02', '2026-11-03', '2026-11-07', '2026-11-08', '2026-11-03', '2026-11-20'], '2026-11-02', '2026-11-15')
  assert.deepEqual(r, { requested: 10, answered: 2, rate: 0.2 }) // week-end et hors période ignorés, doublon compté une fois
  assert.deepEqual(completionRate([], '2026-11-07', '2026-11-08'), { requested: 0, answered: 0, rate: null }) // un week-end
  assert.deepEqual(completionRate(['2026-11-09'], '2026-11-09', '2026-11-09'), { requested: 1, answered: 1, rate: 1 })
  assert.equal(completionRate([], '2026-11-10', '2026-11-09').rate, null) // période à l'envers
  assert.equal(completionRate([], 'nimporte', '2026-11-09').rate, null)
})

t('taux : tout répondu = 100 %, début en cours de saison', () => {
  const from = '2026-09-01'
  const days: string[] = []
  for (let d = from; d <= MON; d = addDays(d, 1)) if (isWeekday(d)) days.push(d)
  assert.equal(completionRate(days, from, MON).rate, 1)
  // Arrivé le jeudi 5 novembre : seuls ses jours comptent (jeu, ven, lun = 3).
  const late = completionRate(['2026-11-05', '2026-11-09'], '2026-11-05', MON)
  assert.deepEqual(late, { requested: 3, answered: 2, rate: 2 / 3 })
  // Réponses le week-end : ne font jamais dépasser 100 %.
  assert.equal(completionRate([...days, '2026-11-07', '2026-11-08'], from, MON).rate, 1)
})

t('saison : début réglable par une seule constante, purge avec un mois de grâce', () => {
  assert.equal(SEASON_START_MONTH, 9)
  assert.equal(seasonStart('2026-11-09'), '2026-09-01')
  assert.equal(seasonStart('2026-08-31'), '2025-09-01')
  assert.equal(seasonStart('2026-09-01'), '2026-09-01')
  assert.equal(seasonStart('2026-07-15', 7), '2026-07-01')
  assert.equal(WELLNESS_GRACE_DAYS, 30)
  assert.equal(purgeBefore('2026-11-09'), '2026-09-01')
  assert.equal(purgeBefore('2026-09-15'), '2025-09-01') // la saison passée reste jusqu'au 1er octobre
  assert.equal(purgeBefore('2026-10-01'), '2026-09-01')
})

t('nettoyage : notes 1 à 10, douleur, zones, texte', () => {
  const r = cleanEntry({ scores: { energie: 7, fraicheur: 11, humeur: '8', sommeil: 6.5, bidule: 3 }, pain: true, zones: ['f-genou-g', 'f-genou-g', 'x', 'd-mollet-d'], painText: '  après\u0007  le\nmatch ', painLevel: 4 }, MON)
  assert.ok(r.ok)
  assert.deepEqual(r.ok && r.entry, { day: MON, scores: { energie: 7 }, pain: true, zones: ['f-genou-g', 'd-mollet-d'], painText: 'après le match', painLevel: 4 })
  // Sans douleur : ni zone, ni texte, ni intensité.
  const s = cleanEntry({ scores: { sommeil: 10 }, pain: false, zones: ['f-tete'], painText: 'x', painLevel: 3 }, MON)
  assert.deepEqual(s.ok && s.entry, { day: MON, scores: { sommeil: 10 }, pain: false })
  // Douleur seule : acceptée ; rien : refusé.
  assert.ok(cleanEntry({ pain: true }, MON).ok)
  assert.deepEqual(cleanEntry({ scores: { energie: 0 } }, MON), { ok: false, error: 'valeurs' })
  assert.equal(cleanPainText('é'.repeat(300))?.length, 120)
  assert.equal(cleanPainText('   '), undefined)
  assert.equal(cleanZones(Array.from({ length: 20 }, (_, i) => BODY_ZONES[i].id)).length, 12)
})

t('mots toujours positifs ou neutres', () => {
  const words = Array.from({ length: 10 }, (_, i) => scaleWord(i + 1)!.word)
  assert.deepEqual([...new Set(words)], ['À recharger', 'Doucement', 'Correct', 'Bien', 'Au top'])
  for (const x of [...words, ...Object.values(TONE_WORDS), ...Object.values(CHARGE_WORDS)]) assert.doesNotMatch(x, /mauvais|nul|faible|mal\b|échec|pas retenu/i)
  assert.equal(scaleWord(0), null)
  assert.equal(scaleWord(11), null)
  assert.equal(painWord(2), 'Légère')
  assert.equal(painWord(8), 'Forte')
  assert.equal(rpeWord(10), 'Maximale')
})

t('moyenne personnelle : 28 jours d\'avant, au moins 3 réponses', () => {
  const es = [entry('2026-11-02', { energie: 8 }), entry('2026-11-03', { energie: 6 }), entry('2026-11-04', { energie: 7 }), entry(MON, { energie: 2 }), entry('2026-09-01', { energie: 1 })]
  assert.equal(ownAverage(es, 'energie', MON), 7) // ni le jour même, ni plus de 28 jours avant
  assert.equal(ownAverage(es.slice(0, 2), 'energie', MON), null)
  assert.equal(ownAverage(es, 'sommeil', MON), null)
})

t('couleur par rapport à SA moyenne', () => {
  assert.equal(toneVsAverage(9, 7), 'usual')
  assert.equal(toneVsAverage(6, 7), 'usual') // jusqu'à −1
  assert.equal(toneVsAverage(5.5, 7), 'below')
  assert.equal(toneVsAverage(4.6, 7), 'below')
  assert.equal(toneVsAverage(4.5, 7), 'wellBelow') // −2,5
  assert.equal(toneVsAverage(3, null), 'none')
  assert.equal(toneVsAverage(undefined, 7), 'none')
  // Même note, deux jeunes : couleur différente selon leur propre habitude.
  assert.equal(toneVsAverage(5, 5.2), 'usual')
  assert.equal(toneVsAverage(5, 8.5), 'wellBelow')
})

t('charge : RPE × durée, aiguë 7 j contre moyenne par semaine sur 28 j', () => {
  const ss: WellnessSession[] = []
  // 4 semaines régulières : 3 séances × 6 × 90 = 1 620 par semaine.
  for (let w = 0; w < 4; w++) for (const d of [0, 2, 4]) ss.push({ id: `${w}${d}`, day: addDays(MON, -(w * 7 + d)), rpe: 6, minutes: 90 })
  const c = chargeSummary(ss, MON)
  assert.equal(c.acute, 1620)
  assert.equal(c.chronicWeekly, 1620)
  assert.equal(c.ratio, 1)
  assert.equal(c.tone, 'usual')
  // Semaine chargée : + 2 séances de 8 × 120.
  const heavy = chargeSummary([...ss, { id: 'h1', day: MON, rpe: 8, minutes: 120 }, { id: 'h2', day: addDays(MON, -1), rpe: 8, minutes: 120 }], MON)
  assert.ok(heavy.ratio! > 1.3)
  assert.equal(heavy.tone, heavy.ratio! > 1.5 ? 'muchMore' : 'more')
  // Sans durée : comptée comme séance, pas dans la charge.
  const nd = chargeSummary([{ id: 'a', day: MON, rpe: 7 }], MON)
  assert.deepEqual([nd.acute, nd.sessions7, nd.noMinutes7, nd.ratio, nd.tone], [0, 1, 1, null, 'none'])
  assert.equal(sessionLoad({ rpe: 7 }), null)
  assert.equal(sessionLoad({ rpe: 7, minutes: 60 }), 420)
  assert.equal(chargeTone(0.5), 'less')
  assert.equal(chargeTone(1.31), 'more')
  assert.equal(chargeTone(1.6), 'muchMore')
  // Séance future ou trop ancienne : ignorée.
  assert.equal(chargeSummary([{ id: 'f', day: addDays(MON, 1), rpe: 5, minutes: 60 }, { id: 'o', day: addDays(MON, -40), rpe: 5, minutes: 60 }], MON).acute, 0)
})

t('ligne du staff et ordre du tableau', () => {
  const past = ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05'].map((d) => entry(d, { energie: 8, fraicheur: 8, humeur: 7, sommeil: 7 }))
  const low = staffRow([...past, entry(MON, { energie: 4, fraicheur: 6, humeur: 7, sommeil: 9 })], [], MON)
  assert.deepEqual(low.tones, { energie: 'wellBelow', fraicheur: 'below', humeur: 'usual', sommeil: 'usual' })
  assert.equal(low.lastDay, MON)
  const missing = staffRow(past, [], MON)
  assert.equal(missing.today, null)
  assert.equal(missing.lastDay, '2026-11-05')
  const pain = staffRow([...past, entry(MON, { energie: 8 }, true)], [], MON)
  assert.ok(staffRank(pain) < staffRank(low) && staffRank(low) < staffRank(missing))
})

t('historique du jeune : 14 jours, comparé à sa moyenne, ton positif', () => {
  const es = Array.from({ length: 20 }, (_, i) => entry(addDays(MON, -i), { energie: 7, sommeil: 6 }))
  const h = myHistory(es, MON)
  assert.equal(h.days.length, 14)
  assert.equal(h.days[0].day, MON)
  assert.equal(h.recent.energie, 7)
  assert.match(h.line, /Belle régularité/)
  const softer = myHistory([...Array.from({ length: 10 }, (_, i) => entry(addDays(MON, -20 - i), { energie: 9 })), entry(MON, { energie: 4 }), entry(addDays(MON, -1), { energie: 4 })], MON)
  assert.match(softer.line, /plus doux que d’habitude/)
  assert.match(myHistory([], MON).line, /apparaîtront/)
  assert.match(myHistory([entry(MON, { energie: 5 })], MON).line, /quelques matins/)
})

t('sur l\'appareil : aujourd\'hui seulement, séances aujourd\'hui ou hier, 6 par jour', () => {
  const a = saveEntryLocal([], { scores: { energie: 5 } }, MON, 'x')
  assert.ok(a.ok)
  const b = saveEntryLocal(a.ok ? a.list : [], { scores: { energie: 9 } }, MON, 'y')
  assert.ok(b.ok && b.list.length === 1 && b.list[0].scores.energie === 9) // modifié le jour même
  assert.deepEqual(saveEntryLocal([], {}, MON, 'x'), { ok: false, error: 'valeurs' })
  let id = 0
  const nid = () => `s${++id}`
  let list: WellnessSession[] = []
  for (let i = 0; i < 6; i++) {
    const r = saveSessionLocal(list, { day: MON, rpe: 5 }, MON, nid, 'x')
    assert.ok(r.ok)
    list = r.ok ? r.list : list
  }
  assert.deepEqual(saveSessionLocal(list, { day: MON, rpe: 5 }, MON, nid, 'x'), { ok: false, error: 'trop' })
  assert.ok(saveSessionLocal(list, { day: addDays(MON, -1), rpe: 5, minutes: 60 }, MON, nid, 'x').ok)
  assert.deepEqual(saveSessionLocal(list, { day: addDays(MON, -2), rpe: 5 }, MON, nid, 'x'), { ok: false, error: 'jour_ferme' })
  assert.deepEqual(saveSessionLocal(list, { day: MON, rpe: 11 }, MON, nid, 'x'), { ok: false, error: 'valeurs' })
  assert.deepEqual(saveSessionLocal(list, { day: MON, rpe: 5, minutes: 0 }, MON, nid, 'x'), { ok: false, error: 'valeurs' })
  assert.deepEqual(saveSessionLocal(list, { id: 'zzz', day: MON, rpe: 5 }, MON, nid, 'x'), { ok: false, error: 'seance_inconnue' })
  const edited = saveSessionLocal(list, { id: 's1', day: MON, rpe: 8, minutes: 90 }, MON, nid, 'x')
  assert.ok(edited.ok && edited.list.length === 6 && edited.list.find((s) => s.id === 's1')!.rpe === 8)
  const old: WellnessSession[] = [{ id: 'o', day: addDays(MON, -3), rpe: 5 }]
  assert.deepEqual(removeSessionLocal(old, 'o', MON), { ok: false, error: 'jour_ferme' })
  assert.ok(removeSessionLocal(list, 's2', MON).ok)
})

t('lignes reçues : illisibles écartées', () => {
  assert.equal(entryFromRow({ day: 'hier', scores: { energie: 5 } }), null)
  assert.equal(entryFromRow({ day: MON, scores: {} }), null)
  assert.deepEqual(entryFromRow({ playerId: 'j-1', day: MON, scores: { energie: 5 }, pain: false, at: 'z' }), { day: MON, scores: { energie: 5 }, pain: false, playerId: 'j-1', at: 'z' })
  assert.equal(sessionFromRow({ id: 'a', day: MON, rpe: 12 }), null)
  assert.deepEqual(sessionFromRow({ id: 'a', day: MON, rpe: 6, minutes: 90 }), { id: 'a', day: MON, rpe: 6, minutes: 90 })
})

t('réglage de l\'installation : fermé par défaut, ouvert en mode essai', () => {
  assert.equal(wellnessEnabledOf([]), false)
  assert.equal(wellnessEnabledOf([{ id: 'wellness', key: 'wellness', value: { actif: 'oui' } }]), false)
  assert.equal(wellnessEnabledOf([{ id: 'wellness', key: 'wellness', value: { actif: true }, deleted: true }]), false)
  assert.equal(wellnessEnabledOf([{ id: 'wellness', key: 'wellness', value: { actif: true } }]), true)
  assert.equal(wellnessEnabledOf([], { trial: true }), true)
  assert.equal(wellnessEnabledOf([], { local: true }), true)
  assert.equal(wellnessErrorText('wellness_ferme'), 'Réservé aux essais pour l’instant.')
  assert.match(wellnessErrorText('x', 'PGRST202'), /pas encore en place/)
})

t('copie RGPD du jeune', () => {
  const x = myWellnessExport([entry(MON, { energie: 7 }, true)], [{ id: 'a', day: MON, rpe: 6 }])
  assert.equal(x.wellness[0].energieGenerale, 7)
  assert.equal(x.wellness[0].douleursGenes, true)
  assert.deepEqual(x.mesSeances, [{ jour: MON, intensiteRessentie: 6, dureeEnMinutes: null }])
})

t('cohérent avec supabase/073_wellness.sql', () => {
  const sql = readFileSync(new URL('../supabase/073_wellness.sql', import.meta.url), 'utf8')
  // Mêmes clés, mêmes zones, mêmes constantes, mêmes refus.
  const keys = sql.match(/unnest\(array\[([^\]]+)\]\) k/)![1].match(/'([^']+)'/g)!.map((s) => s.slice(1, -1))
  assert.deepEqual(keys, WELLNESS_KEYS)
  const zones = sql.match(/hb_wl_zones_connues\(\) returns text\[\]\s+language sql immutable as \$\$\s+select array\[([^\]]+)\]/)![1].match(/'([^']+)'/g)!.map((s) => s.slice(1, -1))
  assert.deepEqual([...zones].sort(), BODY_ZONES.map((z) => z.id).sort())
  assert.match(sql, new RegExp(`hb_wellness_mois_saison\\(\\) returns int language sql immutable as \\$\\$ select ${SEASON_START_MONTH} \\$\\$`))
  assert.match(sql, new RegExp(`hb_wellness_garde_jours\\(\\) returns int language sql immutable as \\$\\$ select ${WELLNESS_GRACE_DAYS} \\$\\$`))
  for (const k of Object.keys(WELLNESS_ERRORS)) if (!['pas_joueur', 'sans_fiche'].includes(k)) assert.match(sql, new RegExp(`'${k}'`), k)
  assert.match(sql, />= 6 then/)
  assert.match(sql, /between 1 and 600/)
  // hb_upsert n'est pas réécrit ; la purge n'est pas programmée hors de la section ACTIVATION.
  assert.doesNotMatch(sql, /create or replace function public\.hb_upsert/)
  assert.doesNotMatch(sql.split('-- ---------- ACTIVATION')[0], /^select cron\.schedule/m)
})

t('démonstration : deux à 100 %, une gêne aujourd\'hui, un pas encore répondu', () => {
  const ids = Array.from({ length: 10 }, (_, i) => `demo-p-${i + 1}`)
  const d = buildDemoWellness(ids, MON)
  const from = addDays(MON, -34)
  const rate = (id: string) => completionRate(d[id].entries.map((e) => e.day), from, MON).rate
  assert.equal(rate(ids[0]), 1)
  assert.equal(rate(ids[1]), 1)
  assert.ok(ids.slice(2).some((id) => rate(id)! < 1)) // les autres : pas tous à 100 %
  assert.equal(d[ids[2]].entries.find((e) => e.day === MON)?.pain, true)
  assert.equal(d[ids[3]].entries.some((e) => e.day === MON), false)
  for (const id of ids) for (const e of d[id].entries) assert.ok(isWeekday(e.day) && cleanEntry(e, e.day).ok)
  assert.ok(d[ids[5]].sessions.length > 0 && d[ids[5]].sessions.every((s) => s.minutes === undefined))
  assert.ok(['more', 'muchMore'].includes(chargeSummary(d[ids[6]].sessions, MON).tone))
  // Chargée un dimanche : la gêne et le « pas encore répondu » sont sur le vendredi (jour du tableau).
  const sun = buildDemoWellness(ids, '2026-11-08')
  assert.equal(sun[ids[2]].entries.find((e) => e.day === '2026-11-06')?.pain, true)
  assert.equal(sun[ids[3]].entries.some((e) => e.day === '2026-11-06'), false)
  // Toujours les mêmes données (aucun hasard).
  assert.deepEqual(buildDemoWellness(ids, MON), d)
})

console.log(`\n${n} essais réussis`)
