// Test du wellness (src/wellness.ts, src/demoWellness.ts ; règles reprises par supabase/073_wellness.sql) : notes 1 à 10 et
// douleurs nettoyées (une ligne par endroit : endroit anatomique et côté, ce que c'est, intensité), silhouette et liste des
// endroits, jours de semaine seulement pour le taux de réponse (période, début en cours de saison, week-end jamais
// demandé), saison réglable, couleurs par rapport à SA moyenne, charge aiguë / chronique (durée obligatoire), règles sur
// l'appareil (aujourd'hui seulement, séances d'aujourd'hui ou d'hier, 6 par jour), mots positifs, réglage de l'installation
// fermé par défaut, cohérence avec le script SQL, données de démonstration. Données fictives.
//
//   npx jiti tools/test-wellness.ts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  addDays,
  AREA_OTHER,
  BODY_AREAS,
  chargeSummary,
  chargeTone,
  cleanEntry,
  cleanPain,
  cleanPains,
  cleanPainText,
  completionRate,
  entryFromRow,
  isWeekday,
  myHistory,
  myWellnessExport,
  nearestPoint,
  ownAverage,
  painLine,
  painMax,
  painPlace,
  painTone,
  painWord,
  PAIN_ENTRIES_MAX,
  PAIN_TEXT_MAX,
  PAIN_TYPES,
  purgeBefore,
  removeSessionLocal,
  rpeWord,
  saveEntryLocal,
  saveSessionLocal,
  scaleWord,
  searchAreas,
  seasonStart,
  SEASON_START_MONTH,
  sessionFromRow,
  sessionLoad,
  SILHOUETTE_POINTS,
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
  type PainEntry,
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
const entry = (day: string, s: Partial<Record<string, number>>, pains?: PainEntry[]): WellnessEntry => ({ day, scores: s, pain: !!pains, ...(pains ? { pains } : {}) })
const ischio: PainEntry = { zone: 'ischios', cote: 'd', type: 'contracture', intensite: 6 }

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

t('nettoyage : notes 1 à 10, une ligne par endroit', () => {
  const r = cleanEntry(
    {
      scores: { energie: 7, fraicheur: 11, humeur: '8', sommeil: 6.5, bidule: 3 },
      pain: true,
      pains: [
        { zone: 'quadriceps', cote: 'd', type: 'courbatures', intensite: 3, bidule: 1 },
        { zone: 'ischios', cote: 'd', type: 'contracture', texte: '  en\u0007  sprint\n ', intensite: 6 },
        { zone: 'lombaires', type: 'gene', intensite: 2, cote: null },
      ],
    },
    MON,
  )
  assert.ok(r.ok)
  assert.deepEqual(r.ok && r.entry, {
    day: MON,
    scores: { energie: 7 },
    pain: true,
    pains: [
      { zone: 'quadriceps', cote: 'd', type: 'courbatures', intensite: 3 },
      { zone: 'ischios', cote: 'd', type: 'contracture', texte: 'en sprint', intensite: 6 },
      { zone: 'lombaires', type: 'gene', intensite: 2 },
    ],
  })
  // Sans douleur : aucune ligne gardée.
  const s = cleanEntry({ scores: { sommeil: 10 }, pain: false, pains: [ischio] }, MON)
  assert.deepEqual(s.ok && s.entry, { day: MON, scores: { sommeil: 10 }, pain: false })
  // Douleur seule : acceptée ; rien : refusé ; douleur sans ligne valable : « douleurs ».
  assert.ok(cleanEntry({ pain: true, pains: [ischio] }, MON).ok)
  assert.deepEqual(cleanEntry({ scores: { energie: 0 } }, MON), { ok: false, error: 'valeurs' })
  assert.deepEqual(cleanEntry({ scores: { energie: 5 }, pain: true }, MON), { ok: false, error: 'douleurs' })
  assert.deepEqual(cleanEntry({ scores: { energie: 5 }, pain: true, pains: [] }, MON), { ok: false, error: 'douleurs' })
  assert.deepEqual(cleanEntry({ pain: true, pains: [ischio, { zone: 'x', type: 'gene', intensite: 2 }] }, MON), { ok: false, error: 'douleurs' })
  assert.equal(PAIN_TEXT_MAX, 80)
  assert.equal(cleanPainText('é'.repeat(300))?.length, PAIN_TEXT_MAX)
  assert.equal(cleanPainText('   '), undefined)
})

t('une douleur : endroit connu, côté pour un endroit pair, type, intensité 1 à 10', () => {
  assert.deepEqual(cleanPain(ischio), ischio)
  assert.equal(cleanPain({ ...ischio, cote: undefined }), null) // endroit pair sans côté
  assert.equal(cleanPain({ ...ischio, cote: 'x' }), null)
  assert.equal(cleanPain({ zone: 'tete', cote: 'g', type: 'coup', intensite: 2 }), null) // côté sur un endroit sans côté
  assert.ok(cleanPain({ zone: 'tete', type: 'coup', intensite: 2 }))
  assert.equal(cleanPain({ ...ischio, type: 'blessure' }), null)
  assert.equal(cleanPain({ ...ischio, type: undefined }), null)
  for (const i of [0, 11, 5.5, '6', undefined]) assert.equal(cleanPain({ ...ischio, intensite: i }), null, String(i))
  assert.equal(cleanPain({ ...ischio, texte: 12 }), null)
  // Autre endroit : le texte est obligatoire (c'est l'endroit).
  assert.equal(cleanPain({ zone: AREA_OTHER, type: 'gene', intensite: 3 }), null)
  assert.equal(cleanPain({ zone: AREA_OTHER, type: 'gene', intensite: 3, texte: '   ' }), null)
  assert.deepEqual(cleanPain({ zone: AREA_OTHER, type: 'gene', intensite: 3, texte: 'Côtes à droite' }), { zone: AREA_OTHER, type: 'gene', intensite: 3, texte: 'Côtes à droite' })
  assert.equal(cleanPain(null), null)
  assert.equal(cleanPain([ischio]), null)
  // Lignes : 1 à 8, un endroit (et côté) une seule fois ; les deux côtés d'un même endroit : deux lignes.
  assert.equal(cleanPains([ischio, { ...ischio, intensite: 2 }]), null)
  assert.equal(cleanPains([ischio, { ...ischio, cote: 'g' }])?.length, 2)
  const nine = BODY_AREAS.filter((a) => a.sides).slice(0, 9).map((a) => ({ zone: a.id, cote: 'g', type: 'gene', intensite: 2 }))
  assert.equal(PAIN_ENTRIES_MAX, 8)
  assert.equal(cleanPains(nine), null)
  assert.equal(cleanPains(nine.slice(0, 8))?.length, 8)
  assert.equal(cleanPains('x'), null)
})

t('noms anatomiques, côté du jeune, lignes du staff', () => {
  assert.equal(painPlace({ zone: 'quadriceps', cote: 'd' }), 'Quadriceps droit')
  assert.equal(painPlace({ zone: 'ischios', cote: 'd' }), 'Ischio-jambiers droits')
  assert.equal(painPlace({ zone: 'cheville', cote: 'g' }), 'Cheville gauche')
  assert.equal(painPlace({ zone: 'lombaires' }), 'Lombaires (bas du dos)')
  assert.equal(painPlace({ zone: AREA_OTHER, texte: 'Côtes' }), 'Côtes')
  assert.equal(painLine(ischio), 'Ischio-jambiers droits · Contracture · 6/10')
  assert.equal(painLine({ zone: 'genou', cote: 'g', type: 'autre', texte: 'tiraillement', intensite: 3 }), 'Genou gauche · Autre : tiraillement · 3/10')
  assert.deepEqual(PAIN_TYPES.map((x) => x.label), ['Courbatures', 'Gêne', 'Douleur', 'Contracture', 'Coup / choc', 'Autre'])
  // L'intensité la plus forte mène la couleur.
  assert.equal(painMax(entry(MON, {}, [ischio, { zone: 'lombaires', type: 'gene', intensite: 2 }])), 6)
  assert.equal(painMax(entry(MON, { energie: 5 })), null)
  assert.deepEqual([painTone(3), painTone(4), painTone(6), painTone(7)], ['light', 'medium', 'medium', 'strong'])
  // Chaque endroit a un nom ; chaque point de la silhouette vise un endroit connu, avec un côté s'il est pair.
  const ids = new Set(BODY_AREAS.map((a) => a.id))
  assert.equal(ids.size, BODY_AREAS.length)
  for (const p of SILHOUETTE_POINTS) {
    assert.ok(ids.has(p.area), p.area)
    assert.equal(!!p.cote, !!BODY_AREAS.find((a) => a.id === p.area)!.sides, p.area)
  }
  // Tous les endroits (sauf « autre ») sont sur la silhouette, des deux côtés s'ils sont pairs.
  for (const a of BODY_AREAS) if (a.id !== AREA_OTHER) for (const c of a.sides ? (['g', 'd'] as const) : [undefined]) assert.ok(SILHOUETTE_POINTS.some((p) => p.area === a.id && p.cote === c), `${a.id} ${c}`)
})

t('silhouette : devant de la cuisse = quadriceps, arrière = ischio-jambiers, côté du jeune', () => {
  // De face, la droite du jeune est à gauche de l'écran.
  assert.deepEqual(nearestPoint('face', 44, 130), { area: 'quadriceps', cote: 'd', view: 'face', x: 45, y: 133 })
  assert.equal(nearestPoint('face', 75, 130)?.cote, 'g')
  assert.equal(nearestPoint('face', 57, 146)?.area, 'adducteurs')
  // De dos, la droite du jeune est à droite de l'écran ; même hauteur de cuisse : ischio-jambiers.
  assert.deepEqual(nearestPoint('dos', 72, 138), { area: 'ischios', cote: 'd', view: 'dos', x: 71, y: 140 })
  assert.equal(nearestPoint('dos', 48, 138)?.cote, 'g')
  assert.equal(nearestPoint('dos', 60, 92)?.area, 'lombaires')
  // Loin du corps : rien.
  assert.equal(nearestPoint('face', 110, 200), null)
  // Points d'une même vue assez espacés : 12 unités du repère 120 × 240 entre deux endroits, 10 entre les deux côtés d'un même
  // endroit (de part et d'autre du milieu, comme l'intérieur des deux cuisses).
  for (const v of ['face', 'dos'] as const) {
    const ps = SILHOUETTE_POINTS.filter((p) => p.view === v)
    for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) assert.ok(Math.hypot(ps[i].x - ps[j].x, ps[i].y - ps[j].y) >= (ps[i].area === ps[j].area ? 10 : 12), `${v} ${ps[i].area}/${ps[j].area}`)
  }
})

t('liste des endroits : recherche sans accents, mots voisins, « autre » au bout', () => {
  const ids = (q: string) => searchAreas(q).map((a) => a.id)
  assert.equal(ids('').length, BODY_AREAS.length)
  assert.deepEqual(ids('cuisse'), ['quadriceps', 'ischios', 'adducteurs', AREA_OTHER])
  assert.deepEqual(ids('ISCHIO'), ['ischios', AREA_OTHER])
  assert.deepEqual(ids('epaule'), ['epaule', AREA_OTHER])
  assert.ok(ids('talon').includes('achille') && ids('talon').includes('pied'))
  assert.deepEqual(ids('bas du dos'), ['lombaires', AREA_OTHER])
  assert.deepEqual(ids('zzz'), [AREA_OTHER])
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
  // Une seule séance, sans historique : sa charge compte aussi dans la moyenne.
  const one = chargeSummary([{ id: 'a', day: MON, rpe: 7, minutes: 60 }], MON)
  assert.deepEqual([one.acute, one.sessions7], [420, 1])
  assert.equal(sessionLoad({ rpe: 7, minutes: 60 }), 420)
  assert.equal(chargeTone(null), 'none')
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
  const pain = staffRow([...past, entry(MON, { energie: 8 }, [{ zone: 'lombaires', type: 'gene', intensite: 2 }])], [], MON)
  const strong = staffRow([...past, entry(MON, { energie: 8 }, [{ zone: 'lombaires', type: 'gene', intensite: 2 }, ischio])], [], MON)
  assert.ok(staffRank(strong) < staffRank(pain) && staffRank(pain) < staffRank(low) && staffRank(low) < staffRank(missing))
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
    const r = saveSessionLocal(list, { day: MON, rpe: 5, minutes: 45 }, MON, nid, 'x')
    assert.ok(r.ok)
    list = r.ok ? r.list : list
  }
  assert.deepEqual(saveSessionLocal(list, { day: MON, rpe: 5, minutes: 45 }, MON, nid, 'x'), { ok: false, error: 'trop' })
  assert.ok(saveSessionLocal(list, { day: addDays(MON, -1), rpe: 5, minutes: 60 }, MON, nid, 'x').ok)
  assert.deepEqual(saveSessionLocal(list, { day: addDays(MON, -2), rpe: 5, minutes: 45 }, MON, nid, 'x'), { ok: false, error: 'jour_ferme' })
  assert.deepEqual(saveSessionLocal(list, { day: MON, rpe: 11, minutes: 45 }, MON, nid, 'x'), { ok: false, error: 'valeurs' })
  assert.deepEqual(saveSessionLocal(list, { day: MON, rpe: 5, minutes: 0 }, MON, nid, 'x'), { ok: false, error: 'valeurs' })
  assert.deepEqual(saveSessionLocal(list, { day: MON, rpe: 5, minutes: 601 }, MON, nid, 'x'), { ok: false, error: 'valeurs' })
  // Durée obligatoire (le pôle note l'intensité ET la durée).
  assert.deepEqual(saveSessionLocal(list, { day: addDays(MON, -1), rpe: 5 } as unknown as { day: string; rpe: number; minutes: number }, MON, nid, 'x'), { ok: false, error: 'valeurs' })
  assert.deepEqual(saveSessionLocal(list, { id: 'zzz', day: MON, rpe: 5, minutes: 45 }, MON, nid, 'x'), { ok: false, error: 'seance_inconnue' })
  const edited = saveSessionLocal(list, { id: 's1', day: MON, rpe: 8, minutes: 90 }, MON, nid, 'x')
  assert.ok(edited.ok && edited.list.length === 6 && edited.list.find((s) => s.id === 's1')!.rpe === 8)
  const old: WellnessSession[] = [{ id: 'o', day: addDays(MON, -3), rpe: 5, minutes: 45 }]
  assert.deepEqual(removeSessionLocal(old, 'o', MON), { ok: false, error: 'jour_ferme' })
  assert.ok(removeSessionLocal(list, 's2', MON).ok)
})

t('lignes reçues : illisibles écartées', () => {
  assert.equal(entryFromRow({ day: 'hier', scores: { energie: 5 } }), null)
  assert.equal(entryFromRow({ day: MON, scores: {} }), null)
  assert.deepEqual(entryFromRow({ playerId: 'j-1', day: MON, scores: { energie: 5 }, pain: false, at: 'z' }), { day: MON, scores: { energie: 5 }, pain: false, playerId: 'j-1', at: 'z' })
  assert.equal(sessionFromRow({ id: 'a', day: MON, rpe: 12, minutes: 60 }), null)
  assert.equal(sessionFromRow({ id: 'a', day: MON, rpe: 6 }), null) // sans durée : illisible
  // Douleur abîmée : la ligne entière est écartée (jamais une douleur à moitié lue).
  assert.equal(entryFromRow({ day: MON, scores: { energie: 5 }, pain: true, pains: [{ zone: 'ischios', type: 'gene', intensite: 3 }] }), null)
  assert.deepEqual(entryFromRow({ day: MON, scores: {}, pain: true, pains: [ischio] }), { day: MON, scores: {}, pain: true, pains: [ischio] })
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
  const x = myWellnessExport([entry(MON, { energie: 7 }, [ischio, { zone: 'genou', cote: 'g', type: 'autre', texte: 'tiraillement', intensite: 3 }])], [{ id: 'a', day: MON, rpe: 6, minutes: 90 }])
  assert.equal(x.wellness[0].energieGenerale, 7)
  assert.equal(x.wellness[0].douleursGenes, true)
  assert.deepEqual(x.wellness[0].douleurs, [
    { endroit: 'Ischio-jambiers droits', ceQueCEst: 'Contracture', intensite: 6 },
    { endroit: 'Genou gauche', ceQueCEst: 'Autre', precision: 'tiraillement', intensite: 3 },
  ])
  assert.deepEqual(x.mesSeances, [{ jour: MON, intensiteRessentie: 6, dureeEnMinutes: 90, charge: 540 }])
})

t('cohérent avec supabase/073_wellness.sql', () => {
  const sql = readFileSync(new URL('../supabase/073_wellness.sql', import.meta.url), 'utf8')
  // Mêmes clés, mêmes zones, mêmes constantes, mêmes refus.
  const keys = sql.match(/unnest\(array\[([^\]]+)\]\) k/)![1].match(/'([^']+)'/g)!.map((s) => s.slice(1, -1))
  assert.deepEqual(keys, WELLNESS_KEYS)
  const list = (fn: string) => sql.match(new RegExp(`${fn}\\(\\) returns text\\[\\]\\s+language sql immutable as \\$\\$\\s+select array\\[([^\\]]+)\\]`))![1].match(/'([^']+)'/g)!.map((s) => s.slice(1, -1))
  assert.deepEqual(list('hb_wl_zones_connues'), BODY_AREAS.map((a) => a.id))
  assert.deepEqual(list('hb_wl_zones_cotes'), BODY_AREAS.filter((a) => a.sides).map((a) => a.id))
  assert.deepEqual(list('hb_wl_types'), PAIN_TYPES.map((x) => x.id))
  assert.ok(sql.includes(`jsonb_array_length(p) not between 1 and ${PAIN_ENTRIES_MAX}`))
  assert.ok(sql.includes(`'[[:cntrl:][:space:]]+', ' ', 'g')), ${PAIN_TEXT_MAX})`))
  assert.match(sql, /duree smallint not null/)
  assert.match(sql, /p_duree is null or p_duree not between 1 and 600/)
  assert.match(sql, new RegExp(`hb_wellness_mois_saison\\(\\) returns int language sql immutable as \\$\\$ select ${SEASON_START_MONTH} \\$\\$`))
  assert.match(sql, new RegExp(`hb_wellness_garde_jours\\(\\) returns int language sql immutable as \\$\\$ select ${WELLNESS_GRACE_DAYS} \\$\\$`))
  for (const k of Object.keys(WELLNESS_ERRORS)) if (!['pas_joueur', 'sans_fiche'].includes(k)) assert.match(sql, new RegExp(`'${k}'`), k)
  assert.match(sql, />= 6 then/)
  assert.match(sql, /between 1 and 600/)
  // hb_upsert n'est pas réécrit ; la purge n'est pas programmée hors de la section ACTIVATION.
  assert.doesNotMatch(sql, /create or replace function public\.hb_upsert/)
  assert.doesNotMatch(sql.split('-- ---------- ACTIVATION')[0], /^select cron\.schedule/m)
})

t('démonstration : deux à 100 %, douleurs à plusieurs endroits, un pas encore répondu, durées partout', () => {
  const ids = Array.from({ length: 10 }, (_, i) => `demo-p-${i + 1}`)
  const d = buildDemoWellness(ids, MON)
  const from = addDays(MON, -34)
  const rate = (id: string) => completionRate(d[id].entries.map((e) => e.day), from, MON).rate
  assert.equal(rate(ids[0]), 1)
  assert.equal(rate(ids[1]), 1)
  assert.ok(ids.slice(2).some((id) => rate(id)! < 1)) // les autres : pas tous à 100 %
  // Courbatures aux deux quadriceps (3/10) ; contracture aux ischio-jambiers droits (6/10) et gêne aux lombaires.
  assert.deepEqual(d[ids[2]].entries.find((e) => e.day === MON)?.pains?.map(painLine), ['Quadriceps droit · Courbatures · 3/10', 'Quadriceps gauche · Courbatures · 3/10'])
  assert.deepEqual(d[ids[7]].entries.find((e) => e.day === MON)?.pains?.map(painLine), ['Ischio-jambiers droits · Contracture · 6/10', 'Lombaires (bas du dos) · Gêne · 2/10'])
  assert.equal(d[ids[7]].entries.find((e) => e.day === '2026-11-06')?.pains?.[0].intensite, 7) // vendredi d'avant : 7/10
  assert.equal(d[ids[3]].entries.some((e) => e.day === MON), false)
  for (const id of ids) for (const e of d[id].entries) assert.ok(isWeekday(e.day) && cleanEntry(e, e.day).ok)
  // Toutes les séances ont leur durée (plus de joueur « sans durée »).
  for (const id of ids) assert.ok(d[id].sessions.length > 0 && d[id].sessions.every((s) => sessionFromRow({ ...s }) !== null), id)
  assert.ok(['more', 'muchMore'].includes(chargeSummary(d[ids[6]].sessions, MON).tone))
  // Chargée un dimanche : la gêne et le « pas encore répondu » sont sur le vendredi (jour du tableau).
  const sun = buildDemoWellness(ids, '2026-11-08')
  assert.equal(sun[ids[2]].entries.find((e) => e.day === '2026-11-06')?.pain, true)
  assert.equal(sun[ids[7]].entries.find((e) => e.day === '2026-11-06')?.pains?.length, 2)
  assert.equal(sun[ids[3]].entries.some((e) => e.day === '2026-11-06'), false)
  // Toujours les mêmes données (aucun hasard).
  assert.deepEqual(buildDemoWellness(ids, MON), d)
})

console.log(`\n${n} essais réussis`)
