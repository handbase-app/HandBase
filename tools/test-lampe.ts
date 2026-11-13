// Test de la « Lampe d'Aladin » (src/lamp.ts), des cahiers (src/cahiers.ts) et de leurs données d'essai (src/demoLamp.ts) ;
// règles reprises par supabase/074_lampe.sql : trimestres, vacances scolaires par zone et jours fériés, zone d'après le site
// du pôle, part proportionnelle, trimestre neutralisé (arrivée en cours de saison), bonus du week-end, plafond de 90 %, part
// des encadrants (qui ne baisse pas), lots avec ex aequo (jamais vus par le jeune), série positive, phrase du jour, vœux,
// réglage de l'installation, cahier du hand et cahier de match (mots positifs ou neutres), cohérence avec le script SQL.
// Données fictives.
//
//   npx jiti tools/test-lampe.ts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  addDays,
  cleanCoach,
  cleanLampSettings,
  cleanWishes,
  coachLowered,
  coachPart,
  DAY_COMPLETE,
  dayFlags,
  DEFAULT_COACH_CRITERIA,
  DEFAULT_WISHES,
  deptOfSite,
  easter,
  isPublicHoliday,
  isRequestedDay,
  lampContext,
  lampLots,
  lampSettingsValue,
  lampView,
  pctText,
  publicHolidays,
  round1,
  schoolHolidayOf,
  seasonYear,
  sortLamps,
  TASK,
  todayLine,
  trimesterBounds,
  zoneFor,
  type LampSettings,
  type Zone,
} from '../src/lamp'
import { cahierText, cleanCahier, cleanMatch, MATCH_FEELINGS, MATCH_RESULTS, partsCount, playTime, resultOf, writableDays, CAHIER_BACK_DAYS, MATCH_BACK_DAYS } from '../src/cahiers'
import { completionRate } from '../src/wellness'
import { buildDemoLamp } from '../src/demoLamp'
import { buildDemoWellness } from '../src/demoWellness'

let n = 0
const ok = (cond: unknown, msg: string) => {
  assert.ok(cond, msg)
  n++
}
const eq = <T>(a: T, b: T, msg: string) => {
  assert.deepEqual(a, b, msg)
  n++
}
const near = (a: number, b: number, msg: string) => {
  assert.ok(Math.abs(a - b) < 1e-6, `${msg} : ${a} au lieu de ${b}`)
  n++
}

const S: LampSettings = cleanLampSettings({}, { trial: true })
/** Jours demandés d'une période (zone B, pont compté). */
const requested = (from: string, to: string, zone: Zone | null = 'B') => {
  const out: string[] = []
  for (let d = from; d <= to; d = addDays(d, 1)) if (isRequestedDay(d, zone)) out.push(d)
  return out
}
/** Tous les jours demandés allumés (3 tâches) jusqu'à `to`. */
const allLit = (from: string, to: string, zone: Zone | null = 'B') => {
  const m = new Map<string, number>()
  for (const d of requested(from, to, zone)) m.set(d, DAY_COMPLETE)
  return m
}

// ---------- Saison, trimestres ----------
eq(seasonYear('2026-11-09'), 2026, 'novembre 2026 : saison 2026')
eq(seasonYear('2027-06-30'), 2026, 'juin 2027 : saison 2026')
eq(seasonYear('2027-09-01'), 2027, 'rentrée 2027 : saison 2027')
eq(
  trimesterBounds(2026).map((t) => `${t.key} ${t.from} ${t.to}`),
  ['T1 2026-09-01 2026-12-31', 'T2 2027-01-01 2027-03-31', 'T3 2027-04-01 2027-06-30'],
  'trois trimestres : 1er sept → 31 déc, 1er janv → 31 mars, 1er avril → 30 juin',
)

// ---------- Jours fériés, vacances scolaires ----------
eq(easter(2027), '2027-03-28', 'Pâques 2027')
eq(easter(2026), '2026-04-05', 'Pâques 2026')
ok(publicHolidays(2027).includes('2027-03-29') && publicHolidays(2027).includes('2027-05-06') && publicHolidays(2027).includes('2027-05-17'), 'lundi de Pâques, Ascension, lundi de Pentecôte 2027')
ok(isPublicHoliday('2026-11-11') && !isRequestedDay('2026-11-11', 'B'), '11 novembre (mercredi) : férié, pas demandé')
ok(!isRequestedDay('2026-10-19', 'A') && !isRequestedDay('2026-10-19', 'B') && !isRequestedDay('2026-10-19', 'C'), 'Toussaint : toutes les zones')
ok(isRequestedDay('2026-11-02', 'B'), 'reprise de la Toussaint (lundi 2 novembre) : demandé')
ok(!isRequestedDay('2026-12-21', 'C') && isRequestedDay('2027-01-04', 'C'), 'Noël : du 19 décembre à la reprise du 4 janvier')
ok(!isRequestedDay('2027-02-15', 'A') && isRequestedDay('2027-02-15', 'B') && !isRequestedDay('2027-02-15', 'C'), 'hiver, 15 février : zones A et C en vacances, pas B')
ok(isRequestedDay('2027-03-01', 'A') && !isRequestedDay('2027-03-01', 'B') && isRequestedDay('2027-03-01', 'C'), 'hiver, 1er mars : reprise A, B encore en vacances')
ok(!isRequestedDay('2027-04-19', 'A') && !isRequestedDay('2027-04-19', 'B') && isRequestedDay('2027-04-19', 'C'), 'printemps, 19 avril : reprise C, A et B en vacances')
ok(!isRequestedDay('2027-05-03', 'B') === false && isRequestedDay('2027-05-03', 'B'), 'printemps B : reprise le 3 mai')
ok(!isRequestedDay('2027-05-07', 'B') && isRequestedDay('2027-05-07', 'B', { pont: false }), 'pont de l’Ascension : vacances par défaut, demandé sans le pont')
eq(schoolHolidayOf('2027-02-24', 'B')?.label, 'Vacances d’hiver', 'nom des vacances')
eq(schoolHolidayOf('2027-02-24', null), null, 'zone inconnue : aucune vacance retirée')
ok(isRequestedDay('2027-02-24', null) && !isRequestedDay('2027-03-29', null), 'zone inconnue : jours fériés seulement')
eq(schoolHolidayOf('2028-02-15', 'A'), null, 'saison absente du calendrier : rien (à compléter chaque année)')
// Jours demandés de chaque trimestre (zone B, rentrée le mardi 1er septembre) : comptés à la main.
eq(requested('2026-09-01', '2026-12-31').length, 68, 'T1 zone B : 68 jours (22 + 12 + 20 + 14)')
eq(requested('2027-01-01', '2027-03-31').length, 52, 'T2 zone B : 52 jours')
eq(requested('2027-04-01', '2027-06-30').length, 52, 'T3 zone B : 52 jours (pont et lundi de Pentecôte retirés)')
eq(requested('2027-01-01', '2027-03-31', 'A').length, 52, 'T2 zone A : 52 jours aussi (deux semaines de vacances)')
eq(requested('2027-02-01', '2027-02-28', 'A').length, 10, 'février zone A : 10 jours')
eq(requested('2027-02-01', '2027-02-28', 'B').length, 15, 'février zone B : 15 jours')
eq(requested('2027-02-01', '2027-02-28', 'C').length, 10, 'février zone C : 10 jours')

// ---------- Zone de l'académie ----------
eq(zoneFor({ departments: ['83'] }), 'B', 'département 83 (académie de Nice) : B')
eq(zoneFor({ site: 'Saint-Raphaël' }), 'B', 'site Saint-Raphaël : B')
eq(zoneFor({ site: 'Aix-en-Provence (Luynes)' }), 'B', 'site écrit avec un complément : B')
eq(zoneFor({ site: 'Toulouse' }), 'C', 'Toulouse : C')
eq(zoneFor({ site: 'LYON' }), 'A', 'Lyon (majuscules) : A')
eq(zoneFor({ site: 'Châtenay-Malabry' }), 'C', 'Châtenay-Malabry (Versailles) : C')
eq(zoneFor({ departments: ['2A'], site: 'Ajaccio', setting: 'B' }), 'B', 'Corse : calendrier propre, réglage à défaut')
eq(zoneFor({ site: 'Ville inconnue', setting: 'C' }), 'C', 'site inconnu : réglage de l’installation')
eq(zoneFor({ playerDept: '6' }), 'B', 'département de la fiche à défaut (« 6 » → 06)')
eq(zoneFor({}), null, 'rien : zone inconnue')
eq(deptOfSite('Cournon-d’Auvergne'), '63', 'apostrophe typographique')

// ---------- Contexte d'une fiche ----------
eq(lampContext({ poles: [{ site: 'Saint-Raphaël', from: '2025-09-01' }] }, '2026-11-09'), { zone: 'B' }, 'au pôle depuis l’an dernier : pas d’arrivée cette saison, zone du site')
eq(lampContext({ poles: [{ site: 'Toulouse', from: '2024-09-01', to: '2026-06-30' }, { site: 'Lyon', from: '2026-10-05' }] }, '2026-11-09'), { start: '2026-10-05', zone: 'A' }, 'arrivé en octobre à Lyon : période en cours')
eq(lampContext({ department: '83' }, '2026-11-09'), { zone: 'B' }, 'sans période : département de la fiche')
eq(lampContext(null, '2026-11-09', { fallback: 'B' }), { zone: 'B' }, 'rien : zone du mode essai')
eq(lampContext({ poles: [{ site: 'Ville inconnue', from: '2026-09-01' }] }, '2026-11-09', { departments: ['31'] }), { zone: 'C' }, 'départements de l’unité Pôle d’abord')

// ---------- La lampe : part proportionnelle ----------
const T = { wellness: TASK.wellness, seance: TASK.seance, cahier: TASK.cahier }
{
  // Fin du 1er trimestre, tout allumé depuis la rentrée.
  const v = lampView({ today: '2026-12-31', days: allLit('2026-09-01', '2026-12-31'), zone: 'B', settings: S })
  near(v.trimesters[0].share, 30, 'T1 parfait : 30 %')
  near(v.pct, 30, '… lampe à 30 %')
  eq(v.trimesters[0].requested, 68, '… 68 jours demandés')
  near(v.maxPct, 100, '… 100 % encore possible')
  ok(v.onTrack, '… en route vers 100 %')
  eq(v.litDays, 68, '… 68 journées allumées')
  eq(v.streak, 68, '… série de 68 (vacances et week-ends ne cassent rien)')
}
{
  // La moitié des jours du T1 allumés : 15 %.
  const all = requested('2026-09-01', '2026-12-31')
  const m = new Map(all.filter((_, i) => i % 2 === 0).map((d) => [d, DAY_COMPLETE] as const))
  const v = lampView({ today: '2026-12-31', days: m, zone: 'B', settings: S })
  near(v.trimesters[0].share, 15, 'moitié des jours : 15 %')
  near(v.maxPct, 100, '… 100 % encore possible grâce aux bonus des week-ends à venir (plafond 90 %) : ce que lit le jeune')
  ok(!v.onTrack, '… mais plus « sur la route » pour le staff (lot assuré : sans compter les bonus à venir)')
  near(v.trackPct, 15 + 60 + 10, '… 85 % en allumant tout le reste')
  const noBonus = cleanLampSettings({ regles: { weekendBonus: 0 } }, { trial: true })
  const vn = lampView({ today: '2026-12-31', days: m, zone: 'B', settings: noBonus })
  ok(!vn.onTrack, 'sans bonus : 100 % n’est plus possible')
  near(vn.maxPct, 15 + 60 + 10, '… au plus 85 %')
}
{
  // Deux tâches sur trois : la journée ne s'allume pas.
  const m = new Map<string, number>([['2026-09-01', T.wellness | T.seance]])
  const v = lampView({ today: '2026-09-01', days: m, zone: 'B', settings: S })
  eq(v.litDays, 0, 'wellness + séance sans cahier : pas allumée')
  eq(v.today.missing, ['cahier'], '… il manque le cahier')
  eq(todayLine(v), 'Encore ton cahier du hand pour allumer ta journée', '… phrase du jour')
  const v2 = lampView({ today: '2026-09-01', days: new Map(), zone: 'B', settings: S })
  eq(todayLine(v2), 'Encore ton wellness du matin, ta séance (intensité ressentie) et ton cahier du hand pour allumer ta journée', 'rien fait : les trois')
  const v3 = lampView({ today: '2026-09-01', days: new Map([['2026-09-01', DAY_COMPLETE]]), zone: 'B', settings: S })
  ok(v3.today.complete && todayLine(v3).startsWith('Journée allumée'), 'tout fait : journée allumée')
  const v4 = lampView({ today: '2026-10-20', days: new Map(), zone: 'B', settings: S })
  eq(todayLine(v4), 'Vacances de la Toussaint : rien n’est demandé, profite bien', 'vacances : rien n’est demandé')
}
{
  // Saison entière parfaite, encadrants au maximum : 100 %.
  const days = allLit('2026-09-01', '2027-06-30')
  const coach = Object.fromEntries(DEFAULT_COACH_CRITERIA.map((c) => [c.key, 2]))
  const v = lampView({ today: '2027-06-30', days, zone: 'B', settings: S, coach })
  near(v.diligence, 90, 'saison parfaite : 90 % d’assiduité')
  near(v.coach, 10, '… 10 % des encadrants')
  near(v.pct, 100, '… 100 %')
  // Avec des cahiers de match chaque samedi : bonus gagnés, mais plafond de 90 %.
  const withMatch = new Map(days)
  for (let d = '2026-09-05'; d <= '2027-06-30'; d = addDays(d, 7)) withMatch.set(d, TASK.match)
  const vb = lampView({ today: '2027-06-30', days: withMatch, zone: 'B', settings: S, coach })
  ok(vb.bonus.weeks.length > 20, 'bonus gagnés chaque semaine complète')
  near(vb.diligence, 90, '… plafond : 90 %')
  near(vb.pct, 100, '… 100 % au plus')
}
{
  // Bonus du week-end, en septembre (zone B).
  const days = allLit('2026-09-01', '2026-09-30')
  days.set('2026-09-05', TASK.match) // samedi après la semaine du 1er au 4
  days.set('2026-09-13', TASK.match) // dimanche après la semaine du 7 au 11
  const v = lampView({ today: '2026-09-30', days, zone: 'B', settings: S })
  eq(v.bonus.weeks, ['2026-08-31', '2026-09-07'], 'deux semaines complètes suivies d’un cahier de match')
  near(v.pct, (30 * 22) / 68 + 2, '… 30 % × 22/68 + 2 × 1 %')
  // Un jour manqué dans la semaine du 7 : pas de bonus pour elle.
  const d2 = new Map(days)
  d2.delete('2026-09-08')
  const v2 = lampView({ today: '2026-09-30', days: d2, zone: 'B', settings: S })
  eq(v2.bonus.weeks, ['2026-08-31'], 'jour manqué : pas de bonus cette semaine-là')
  // Cahier de match un mercredi : jamais un bonus.
  const d3 = allLit('2026-09-01', '2026-09-11')
  d3.set('2026-09-09', DAY_COMPLETE | TASK.match)
  eq(lampView({ today: '2026-09-11', days: d3, zone: 'B', settings: S }).bonus.weeks, [], 'cahier de match en semaine : pas de bonus')
  // Le week-end : la semaine est complète, le cahier de match est attendu.
  const d4 = allLit('2026-09-07', '2026-09-11')
  const vw = lampView({ today: '2026-09-12', days: d4, zone: 'B', settings: S })
  ok(vw.weekend?.eligible && !vw.weekend.matchDone, 'samedi après une semaine complète : bonus possible')
  eq(todayLine(vw), 'Ta semaine est complète : remplis ton cahier de match pour un bonus', '… phrase du week-end')
}
{
  // Le bonus rattrape des jours manqués, sans dépasser 90 %.
  const days = allLit('2026-09-01', '2027-06-30')
  days.delete('2026-09-15')
  days.delete('2026-09-16')
  for (let d = '2026-09-05'; d <= '2027-06-30'; d = addDays(d, 7)) days.set(d, TASK.match)
  const v = lampView({ today: '2027-06-30', days, zone: 'B', settings: S })
  near(v.diligence, 90, 'deux jours manqués rattrapés par les bonus : 90 %')
  const noBonus = allLit('2026-09-01', '2027-06-30')
  noBonus.delete('2026-09-15')
  near(lampView({ today: '2027-06-30', days: noBonus, zone: 'B', settings: S }).diligence, 60 + (30 * 67) / 68, 'sans bonus : 30 × 67/68 + 60')
}
{
  // Arrivée en cours de trimestre : jours comptés depuis l'arrivée (le trimestre peut encore donner 30 %).
  const v = lampView({ today: '2026-12-31', start: '2026-11-16', days: allLit('2026-11-16', '2026-12-31'), zone: 'B', settings: S })
  eq(v.trimesters[0].requested, 25, 'arrivée le 16 novembre : 25 jours demandés au T1')
  near(v.trimesters[0].share, 30, '… tous allumés : 30 %')
  // Arrivée après la fin du T1 : T1 neutralisé, son poids passe aux deux autres (45 % chacun).
  const v2 = lampView({ today: '2027-06-30', start: '2027-01-11', days: allLit('2027-01-11', '2027-06-30'), zone: 'B', settings: S })
  ok(v2.trimesters[0].neutral && v2.trimesters[0].weight === 0, 'arrivée en janvier : T1 neutralisé')
  near(v2.trimesters[1].weight, 45, '… T2 vaut 45 %')
  eq(v2.trimesters[1].requested, 47, '… 47 jours demandés au T2 depuis le 11 janvier')
  near(v2.diligence, 90, '… tout allumé : 90 % quand même')
  // Lancement de la lampe en cours de saison (réglage « debut ») : comme une arrivée pour tous.
  const late = cleanLampSettings({ debut: '2026-11-09' }, { trial: true })
  eq(lampView({ today: '2026-11-09', days: new Map(), zone: 'B', settings: late }).start, '2026-11-09', 'réglage « debut » : premier jour compté')
}
{
  // Série : positive, jamais cassée par un jour pas encore fini.
  const days = new Map([
    ['2026-09-07', DAY_COMPLETE],
    ['2026-09-08', DAY_COMPLETE],
    ['2026-09-09', DAY_COMPLETE],
  ])
  eq(lampView({ today: '2026-09-10', days, zone: 'B', settings: S }).streak, 3, 'jeudi pas encore allumé : série de 3')
  days.delete('2026-09-08')
  const v = lampView({ today: '2026-09-10', days, zone: 'B', settings: S })
  eq([v.streak, v.bestStreak], [1, 1], 'mardi manqué : la série repart (meilleure : 1)')
  const wk = new Map([
    ['2026-09-11', DAY_COMPLETE],
    ['2026-09-14', DAY_COMPLETE],
    ['2026-09-15', DAY_COMPLETE],
  ])
  eq(lampView({ today: '2026-09-15', days: wk, zone: 'B', settings: S }).streak, 3, 'le week-end ne casse pas la série')
}

// ---------- Part des encadrants ----------
near(coachPart({ entrainabilite: 2, attitude: 1 }, DEFAULT_COACH_CRITERIA), 3, '2 + 1 points : 3 %')
near(coachPart({ entrainabilite: 5, bidule: 2, attitude: -1, humeur: 1.5 }, DEFAULT_COACH_CRITERIA), 2, 'points nettoyés : 2 au plus, clés connues, entiers positifs')
near(coachPart(Object.fromEntries(DEFAULT_COACH_CRITERIA.map((c) => [c.key, 2])), DEFAULT_COACH_CRITERIA), 10, 'tout au maximum : 10 %')
eq(cleanCoach({ attitude: 2, humeur: 0, x: 1 }, DEFAULT_COACH_CRITERIA), { attitude: 2 }, '0 : absent')
eq(coachLowered({ attitude: 2, humeur: 1 }, { attitude: 1, humeur: 2 }), ['attitude'], 'baisse repérée (refusée au staff, 074)')
eq(coachLowered({ attitude: 1 }, { attitude: 1, humeur: 2 }), [], 'ajout : rien de baissé')
{
  const v = lampView({ today: '2026-09-01', days: new Map(), zone: 'B', settings: S, coach: { attitude: 2 } })
  near(v.coach, 2, 'part des encadrants ajoutée à la lampe')
  near(v.pct, 2, '… même un jour sans rien d’allumé')
}

// ---------- Lots (staff seulement) ----------
{
  const lots = lampLots([
    { id: 'a', pct: 100, trackPct: 100 },
    { id: 'b', pct: 40, trackPct: 100 },
    { id: 'c', pct: 70.04, trackPct: 75 },
    { id: 'd', pct: 69.96, trackPct: 72 },
    { id: 'e', pct: 60, trackPct: 61 },
  ])
  eq(lots.get('a'), 'assure', '100 % : lot assuré')
  eq(lots.get('b'), 'assure', 'encore possible : lot assuré (si ça continue)')
  eq([lots.get('c'), lots.get('d')], ['consolation', 'consolation'], 'meilleur des autres, ex aequo au dixième : tous les deux')
  eq(lots.get('e'), undefined, 'les autres : rien (jamais d’étiquette négative)')
  eq(lampLots([{ id: 'x', pct: 0, trackPct: 50 }]).size, 0, 'personne au-dessus de 0 % : pas de lot de consolation')
  eq(sortLamps([{ pct: 50, name: 'B' }, { pct: 80, name: 'C' }, { pct: 50, name: 'A' }]).map((r) => r.name), ['C', 'A', 'B'], 'ordre : pourcentage, puis nom')
}
eq(pctText(42.46), '42,5 %', 'pourcentage au dixième, à la française')
eq(round1(69.96), 70, 'arrondi au dixième')

// ---------- Réglage, vœux ----------
{
  const d = cleanLampSettings(undefined)
  ok(!d.actif, 'réglage absent : fermée (hors essai)')
  ok(cleanLampSettings(undefined, { trial: true }).actif, 'mode essai : ouverte')
  eq(d.catalogue.map((w) => w.id), DEFAULT_WISHES.map((w) => w.id), 'catalogue par défaut')
  eq(d.criteria.map((c) => c.label), ['Entraînabilité', 'Attitude', 'Humeur', 'Remise en question', 'Transformation'], 'critères du responsable du pôle')
  eq(d.rules, { trimesterShare: 30, diligenceCap: 90, weekendBonus: 1, coachShare: 10, coachPointsMax: 2, cahierMinFields: 3 }, 'règles par défaut')
  const s = cleanLampSettings({
    actif: true,
    zone: 'C',
    pont: false,
    debut: '2026-11-09',
    catalogue: [{ label: 'Un stage d’été', by: 'Partenaire fictif' }, { id: 'ballon', label: '  Un   ballon ' }, { id: 'ballon', label: 'doublon' }, { label: '' }],
    criteres: [{ key: 'attitude', label: 'Attitude' }, { label: 'Esprit d’équipe' }],
    regles: { weekendBonus: 2, diligenceCap: 500, cahierMinFields: 2 },
  })
  eq(s.catalogue, [{ id: 'un-stage-d-ete', label: 'Un stage d’été', by: 'Partenaire fictif' }, { id: 'ballon', label: 'Un ballon' }], 'catalogue nettoyé (identifiant tiré du nom, doublon et vide écartés)')
  eq(s.criteria.map((c) => c.key), ['attitude', 'esprit-d-equipe'], 'critères de l’installation')
  eq([s.rules.weekendBonus, s.rules.diligenceCap, s.rules.cahierMinFields], [2, 90, 2], 'règles : valeurs valables gardées, hors bornes ignorées')
  eq([s.zone, s.pont, s.debut], ['C', false, '2026-11-09'], 'zone, pont, début')
  eq(cleanLampSettings({ catalogue: [] }).catalogue, [], 'catalogue vidé par l’administrateur : vide')
  eq(cleanLampSettings(lampSettingsValue(s)), s, 'aller-retour du réglage')
  eq(cleanWishes(['ballon', 'inconnu', 'ballon', 'maillot', 'pro', 'centre'], DEFAULT_WISHES), ['ballon', 'maillot', 'pro'], 'vœux : sans doublon, 3 au plus, dans l’ordre')
  // Bonus réglé à 2 %.
  const days = allLit('2026-09-01', '2026-09-04')
  days.set('2026-09-05', TASK.match)
  near(lampView({ today: '2026-09-05', days, zone: 'B', settings: cleanLampSettings({ regles: { weekendBonus: 2 } }, { trial: true }) }).bonus.pct, 2, 'bonus réglé à 2 %')
}

// ---------- Cahiers ----------
eq(cleanCahier({ travail: '  Tirs en appui\u0007  ', difficile: '', objectif: 'Précision', x: 'y' }), { travail: 'Tirs en appui', objectif: 'Précision' }, 'cahier du hand nettoyé')
ok(!partsCount('cahier', cleanCahier({ travail: 'a', difficile: 'b' })), '2 questions sur 3 : ne compte pas')
ok(partsCount('cahier', cleanCahier({ travail: 'a', difficile: 'b' }), 2), '… sauf réglé à 2')
ok(partsCount('cahier', cleanCahier({ travail: 'a', difficile: 'b', objectif: 'c' })), '3 questions : compte')
const m = cleanMatch({ adversaire: '  Club   fictif ', nous: 25, eux: 20, resultat: 'defaite', sensation: 'pas bien', mt1: 24, mt2: 45, bienAtt: 'Mes courses', amelDef: 'Mes replis' })
eq(m, { adversaire: 'Club fictif', nous: 25, eux: 20, resultat: 'victoire', mt1: 24, bienAtt: 'Mes courses', amelDef: 'Mes replis' }, 'cahier de match nettoyé (même résultat que le serveur, essai 074)')
ok(!partsCount('match', m), 'sans sensation : ne compte pas')
ok(partsCount('match', { ...m, sensation: 'super' }), 'sensation + une ligne : compte')
eq(resultOf(20, 20), 'nul', 'score égal : nul')
eq(resultOf(undefined, undefined, 'defaite'), 'defaite', 'sans score : résultat choisi')
eq(playTime({ mt1: 20, mt2: 15 }), 35, 'temps cumulé')
eq(playTime({}), undefined, 'aucune mi-temps : pas de temps')
eq(MATCH_FEELINGS.map((f) => f.label), ['Super', 'Correct', 'Compliqué'], 'sensations : mots positifs ou neutres')
ok(![...MATCH_FEELINGS.map((f) => f.label), ...MATCH_RESULTS.map((r) => r.label)].some((l) => /pas bien|nul(le)? à|raté|mauvais/i.test(l)), 'jamais « pas bien », « raté », « mauvais »')
eq(
  cahierText('match', cleanMatch({ adversaire: 'Club fictif', nous: 20, eux: 20, sensation: 'complique', mt1: 20, mt2: 15, bienAtt: 'Mes courses' })),
  '🏟️ Cahier de match contre Club fictif\nRésultat : Nul 20 – 20\nSensation : Compliqué\nTemps de jeu : 20 + 15 = 35 min\nCe que j’ai bien fait en attaque : Mes courses',
  'texte du cahier de match : même forme que hb_lp_texte (essai 074)',
)
eq(
  cahierText('cahier', cleanCahier({ travail: 'Tirs en appui, bonnes jambes', difficile: 'Enchaîner', objectif: 'Garder ma précision' })),
  '📒 Cahier du hand\nCe que j’ai travaillé / mes sensations : Tirs en appui, bonnes jambes\nCe qui était difficile : Enchaîner\nMon objectif sur le même thème : Garder ma précision',
  'texte du cahier du hand : même forme que le serveur',
)
eq(writableDays('cahier', '2026-11-09'), ['2026-11-09', '2026-11-08'], 'cahier du hand : aujourd’hui ou hier')
eq(writableDays('match', '2026-11-09').length, 4, 'cahier de match : 3 jours en arrière')

// ---------- Taux de réponse du wellness, hors vacances (nice to have) ----------
{
  const r = completionRate([], '2026-10-12', '2026-10-30', (d) => isRequestedDay(d, 'B'))
  eq(r.requested, 5, 'taux du wellness sans les vacances de la Toussaint : 5 jours demandés')
  eq(completionRate([], '2026-10-12', '2026-10-30').requested, 15, '… sans réglage : 15 (lundi → vendredi)')
}

// ---------- Données d'essai ----------
{
  const ids = Array.from({ length: 10 }, (_, i) => `demo-p-${i + 1}`)
  const today = '2026-11-09'
  const base = buildDemoWellness(ids, today)
  const a = buildDemoLamp(ids, today, base)
  const b = buildDemoLamp(ids, today, base)
  eq(JSON.stringify(a), JSON.stringify(b), 'déterministe')
  const view = (id: string) => {
    const d = a.players[id]
    const days = dayFlags({
      wellness: d.wellness.entries.map((e) => e.day),
      seance: d.wellness.sessions.map((s) => s.day),
      cahier: d.notes.filter((x) => x.kind === 'cahier' && partsCount('cahier', x.parts ?? {})).map((x) => x.day!),
      match: d.notes.filter((x) => x.kind === 'match' && partsCount('match', x.parts ?? {})).map((x) => x.day!),
    })
    return lampView({ today, days, zone: a.zone, settings: S, coach: d.coach })
  }
  const v1 = view(ids[0])
  ok(v1.onTrack && v1.trimesters[0].done === v1.trimesters[0].past + (v1.today.complete ? 1 : 0), 'joueur 1 : rien manqué, en route vers 100 %')
  ok(view(ids[1]).onTrack, 'joueur 2 : en route vers 100 % aussi')
  ok(v1.bonus.weeks.length >= 3, 'joueur 1 : des bonus du week-end')
  ok(v1.coach > 0, 'joueur 1 : part des encadrants donnée')
  const others = ids.slice(2).map((id) => round1(view(id).pct))
  ok(new Set(others).size >= 4 && Math.max(...others) < round1(v1.pct), `les autres : des pourcentages variés, en dessous du 1er (${others.join(' ; ')} / ${round1(v1.pct)})`)
  ok(Object.values(a.players).every((p) => p.wishes.length <= 3), 'vœux : 3 au plus')
  ok(Object.values(a.players).some((p) => p.notes.some((x) => x.kind === 'match')), 'des cahiers de match')
  ok(a.players[ids[3]].wellness.entries.every((e) => e.day !== today), 'joueur 4 : n’a toujours pas répondu aujourd’hui (scénario du wellness gardé)')
}

// ---------- Cohérence avec supabase/074_lampe.sql ----------
{
  const sql = readFileSync(new URL('../supabase/074_lampe.sql', import.meta.url), 'utf8')
  ok(sql.includes(`array['${DEFAULT_COACH_CRITERIA.map((c) => c.key).join("', '")}']`), 'critères par défaut : mêmes clés que le serveur')
  ok(sql.includes(`array['${DEFAULT_WISHES.map((w) => w.id).join("', '")}']`), 'catalogue par défaut : mêmes identifiants que le serveur')
  ok(sql.includes(`when 'cahier' then ${CAHIER_BACK_DAYS} when 'match' then ${MATCH_BACK_DAYS}`), 'jours en arrière : mêmes que le serveur')
  ok(sql.includes(`in ('${MATCH_FEELINGS.map((f) => f.id).join("', '")}')`), 'sensations : mêmes que le serveur')
  ok(/select w\.jour, 1 as b[\s\S]*select s\.jour, 2[\s\S]*when 'cahier' then 4 else 8/.test(sql) && TASK.wellness === 1 && TASK.seance === 2 && TASK.cahier === 4 && TASK.match === 8, 'bits des tâches : mêmes que le serveur')
  ok(sql.includes('select 9 $$') && S.rules.cahierMinFields === 3 && sql.includes("'^[1-3]$'), 3)"), 'rentrée et questions du cahier : mêmes valeurs')
  ok(!/hb_upsert\s*\(/.test(sql.replace(/^--.*$/gm, '')), 'hb_upsert jamais redéfini ni appelé')
}

console.log(`test-lampe : ${n} vérifications, tout est bon.`)
