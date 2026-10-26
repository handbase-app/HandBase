// Test de « Autour de moi » et de « Mon équipe » (src/rencontres.ts), sur des clubs, rencontres et joueurs FICTIFS.
//
//   npx jiti tools/test-rencontres.ts
//
// Heure locale fixée (Europe/Paris) : les périodes se calculent en heure de l'appareil, passage à l'heure d'hiver compris.
process.env.TZ = 'Europe/Paris'

import assert from 'node:assert/strict'
import { SPORT_CONTENT } from '../src/sportContent'
import { deptCenters, insideRepo, parseArgs, seedSql, VENUES } from './seed-rencontres'
import {
  aroundRequest,
  boxAround,
  citiesOf,
  cleanUsualTeam,
  deptCenter,
  distanceText,
  distinctYouths,
  fixtureHeading,
  fromRow,
  hasTeamInfo,
  haversineKm,
  indexPlayers,
  itineraryUrl,
  matchPlayers,
  namesLine,
  parsePrefs,
  periodRange,
  playerCategory,
  requestKey,
  safeUrl,
  sameTeam,
  searchCities,
  seasonCategory,
  seasonEndYear,
  sortFixtures,
  teamsLabel,
  teamSummary,
  upperCategories,
  venuesOf,
  withinRadius,
  youthsText,
  type MatchPlayer,
  type Rencontre,
} from '../src/rencontres'

const HB = SPORT_CONTENT.handball.youthCategories
const VB = SPORT_CONTENT.volley.youthCategories
const near = (a: number, b: number, eps: number, msg?: string) => assert.ok(Math.abs(a - b) <= eps, `${msg ?? ''} ${a} ≉ ${b}`)

// ---------- Distance ----------
{
  const paris = { lat: 48.8566, lng: 2.3522 }
  const lyon = { lat: 45.764, lng: 4.8357 }
  near(haversineKm(paris, lyon), 391.5, 2, 'Paris – Lyon')
  near(haversineKm(lyon, paris), haversineKm(paris, lyon), 1e-9, 'symétrique')
  assert.equal(haversineKm(paris, paris), 0)
  // Même valeur que le serveur sur l'exemple de supabase/056 (Toulon – Marseille : 47,4 km).
  near(haversineKm({ lat: 43.12, lng: 5.93 }, { lat: 43.3, lng: 5.4 }), 47.4, 0.06, 'Toulon – Marseille')
  // La boîte contient le cercle (points à km pile, aux quatre coins cardinaux).
  const c = { lat: 43.12, lng: 5.93 }
  const b = boxAround(c, 50)
  for (const [dLat, dLng] of [
    [50 / 111.2, 0],
    [-50 / 111.2, 0],
    [0, 50 / (111.2 * Math.cos((43.12 * Math.PI) / 180))],
    [0, -50 / (111.2 * Math.cos((43.12 * Math.PI) / 180))],
  ]) {
    const p = { lat: c.lat + dLat, lng: c.lng + dLng }
    near(haversineKm(c, p), 50, 0.6, 'point à 50 km')
    assert.ok(p.lat >= b.minLat && p.lat <= b.maxLat && p.lng >= b.minLng && p.lng <= b.maxLng, 'dans la boîte')
  }
}

// ---------- Quand ----------
{
  const at = (y: number, m: number, d: number, h = 0, min = 0) => new Date(y, m - 1, d, h, min)
  const show = (r: { from: Date; to: Date }) => [r.from, r.to].map((x) => `${x.toLocaleDateString('sv')} ${String(x.getHours()).padStart(2, '0')}:${String(x.getMinutes()).padStart(2, '0')}`)
  // Mercredi : le samedi et le dimanche qui viennent (du samedi 0 h au lundi 0 h).
  assert.deepEqual(show(periodRange('weekend', at(2026, 10, 28, 10))), ['2026-10-31 00:00', '2026-11-02 00:00'])
  // Samedi après-midi, dimanche soir : le week-end en cours (samedi compris).
  assert.deepEqual(show(periodRange('weekend', at(2026, 10, 31, 15))), ['2026-10-31 00:00', '2026-11-02 00:00'])
  assert.deepEqual(show(periodRange('weekend', at(2026, 11, 1, 23, 30))), ['2026-10-31 00:00', '2026-11-02 00:00'])
  // Samedi juste après minuit, lundi matin : celui-ci, puis le suivant.
  assert.deepEqual(show(periodRange('weekend', at(2026, 10, 31, 0, 1))), ['2026-10-31 00:00', '2026-11-02 00:00'])
  assert.deepEqual(show(periodRange('weekend', at(2026, 11, 2, 8))), ['2026-11-07 00:00', '2026-11-09 00:00'])
  // Vendredi soir du passage à l'heure d'hiver (nuit du 24 au 25 octobre 2026) : minuit local aux deux bornes, 49 h.
  const dst = periodRange('weekend', at(2026, 10, 23, 22))
  assert.deepEqual(show(dst), ['2026-10-24 00:00', '2026-10-26 00:00'])
  assert.equal((dst.to.getTime() - dst.from.getTime()) / 3.6e6, 49)
  // Fin d'année : le week-end passe en janvier.
  assert.deepEqual(show(periodRange('weekend', at(2026, 12, 31, 12))), ['2027-01-02 00:00', '2027-01-04 00:00'])
  // 7 et 30 jours : d'aujourd'hui 0 h.
  assert.deepEqual(show(periodRange('7j', at(2026, 10, 28, 10))), ['2026-10-28 00:00', '2026-11-04 00:00'])
  assert.deepEqual(show(periodRange('30j', at(2026, 10, 28, 10))), ['2026-10-28 00:00', '2026-11-27 00:00'])
}

// ---------- Catégories ----------
{
  assert.equal(seasonEndYear('2026-10-31'), 2027)
  assert.equal(seasonEndYear('2026-09-01'), 2027)
  assert.equal(seasonEndYear('2026-08-31'), 2026)
  assert.equal(seasonEndYear('2027-05-02'), 2027)
  // Handball, saison 2026-2027 : U13 = 2014-2015, U15 = 2012-2013, U18 = 2009-2011.
  assert.equal(seasonCategory('2015-12-31', '2026-10-31', HB), 'U13')
  assert.equal(seasonCategory('2014-01-01', '2026-10-31', HB), 'U13')
  assert.equal(seasonCategory('2013-06-15', '2026-10-31', HB), 'U15')
  assert.equal(seasonCategory('2012-03-01', '2026-10-31', HB), 'U15')
  assert.equal(seasonCategory('2011-03-01', '2026-10-31', HB), 'U18')
  assert.equal(seasonCategory('2009-03-01', '2026-10-31', HB), 'U18')
  assert.equal(seasonCategory('2008-03-01', '2026-10-31', HB), undefined, 'trop âgé : hors des catégories de jeunes')
  assert.equal(seasonCategory('2016-03-01', '2026-10-31', HB), undefined, 'trop jeune')
  // Fin de saison 2025-2026 (31 août) : un joueur de 2011 est encore U15.
  assert.equal(seasonCategory('2011-03-01', '2026-08-31', HB), 'U15')
  assert.equal(seasonCategory(undefined, '2026-10-31', HB), undefined, 'année inconnue')
  assert.equal(seasonCategory('', '2026-10-31', HB), undefined)
  // Volley : M13, M15, M18 (mêmes âges, comme src/demoVolley.ts : M18 = 2009-2011 en 2026-2027).
  assert.equal(seasonCategory('2010-05-05', '2026-11-07', VB), 'M18')
  assert.equal(seasonCategory('2013-05-05', '2026-11-07', VB), 'M15')
  // Surclassement : la catégorie déclarée, si c'est une catégorie du sport.
  assert.equal(playerCategory({ birthDate: '2012-01-01', usualTeam: { playsIn: 'U18' } }, '2026-10-31', HB), 'U18')
  assert.equal(playerCategory({ birthDate: '2012-01-01', usualTeam: { playsIn: 'M18' } }, '2026-10-31', HB), 'U15', 'catégorie d’un autre sport : ignorée')
  assert.equal(playerCategory({ usualTeam: { playsIn: 'U15' } }, '2026-10-31', HB), 'U15', 'année inconnue mais catégorie déclarée')
}

// ---------- Mon équipe ----------
{
  const codes = HB.map((c) => c.code)
  assert.deepEqual(cleanUsualTeam({ n: 2, level: 'regional', playsIn: 'U18', at: 'x', src: 'staff', zz: 1 }, codes), { n: 2, level: 'regional', playsIn: 'U18' })
  assert.deepEqual(cleanUsualTeam({ n: 4, level: 'mondial', playsIn: 'U99' }, codes), {})
  assert.deepEqual(cleanUsualTeam({ n: '1' }, codes), {}, 'numéro en texte : refusé')
  assert.deepEqual(cleanUsualTeam(null, codes), {})
  assert.equal(hasTeamInfo({ at: '2026-10-26T10:00:00.000Z', src: 'joueur' }), false, 'équipe effacée')
  assert.equal(hasTeamInfo({ n: 1 }), true)
  assert.equal(sameTeam({ n: 1, at: 'a' }, { n: 1, at: 'b', src: 'staff' }), true)
  assert.equal(sameTeam({ n: 1 }, { n: 1, level: 'regional' }), false)
  assert.equal(teamSummary({ birthDate: '2012-02-02', usualTeam: { n: 1, level: 'regional' } }, '2026-10-31', HB), 'U15 · Équipe 1 · Régional')
  assert.equal(teamSummary({ birthDate: '2012-02-02', usualTeam: { playsIn: 'U18', n: 2 } }, '2026-10-31', HB), 'U18 (surclassement) · Équipe 2')
  assert.equal(teamSummary({ birthDate: '2012-02-02', usualTeam: { playsIn: 'U15', level: 'departemental' } }, '2026-10-31', HB), 'U15 · Départemental', 'catégorie déclarée = celle de son âge')
  assert.equal(teamSummary({ birthDate: '2012-02-02' }, '2026-10-31', HB), '')
  assert.equal(teamSummary({ usualTeam: { n: 3 } }, '2026-10-31', HB), 'Équipe 3', 'année inconnue')
  // « Joue en » : seulement au-dessus de sa catégorie (jamais en dessous) ; tout si elle est inconnue ; le choix déjà fait reste.
  const up = (own: string | undefined, chosen?: string) => upperCategories(own, HB, chosen).map((c) => c.code)
  assert.deepEqual(up('U13'), ['U15', 'U18'])
  assert.deepEqual(up('U15'), ['U18'])
  assert.deepEqual(up('U18'), [])
  assert.deepEqual(up(undefined), ['U13', 'U15', 'U18'])
  assert.deepEqual(up('U18', 'U15'), ['U15'], 'choix d’une autre saison gardé à l’écran')
}

// ---------- Rencontres fictives ----------
const A = '6283001'
const B = '6283002'
const C = '6283003'
const D = '6213001'
const F = (id: string, p: Partial<Rencontre> & Pick<Rencontre, 'category' | 'sex' | 'level' | 'home' | 'away'>): Rencontre => ({
  id,
  startsAt: '2026-10-31T14:00:00+01:00',
  lat: 43.12,
  lng: 5.93,
  source: 'demo',
  ...p,
})
const fixtures: Rencontre[] = [
  F('f1', { category: 'U15', sex: 'M', level: 'regional', home: { club: A, team: 1, name: 'Club A' }, away: { club: B, team: 2, name: 'Club B' } }),
  F('f2', { category: 'U15', sex: 'M', level: 'departemental', startsAt: '2026-11-01T10:30:00+01:00', lat: 43.2, lng: 5.8, home: { club: A, team: 2, name: 'Club A' }, away: { club: C, name: 'Club C' } }),
  F('f3', { category: 'U15', sex: 'F', level: 'departemental', home: { club: C, name: 'Club C' }, away: { club: B, team: 1, name: 'Club B' } }),
  F('f4', { category: 'U18', sex: 'M', level: 'national', startsAt: '2026-10-31T18:00:00+01:00', lat: 43.3, lng: 5.4, home: { club: D, team: 1, name: 'Club D' }, away: { club: A, team: 1, name: 'Club A' } }),
  F('f5', { category: 'U13', sex: 'X', level: 'departemental', home: { club: A, name: 'Club A' }, away: { club: C, name: 'Club C' } }),
  // Derby : équipes 1 et 2 du même club.
  F('f6', { category: 'U15', sex: 'M', level: 'departemental', startsAt: '2026-10-31T16:00:00+01:00', home: { club: A, team: 1, name: 'Club A' }, away: { club: A, team: 2, name: 'Club A' } }),
  // Équipe sans numéro connu : le niveau décide.
  F('f7', { category: 'U15', sex: 'M', level: 'regional', startsAt: '2026-11-01T15:00:00+01:00', lat: 43.5, lng: 6.5, home: { club: A, name: 'Club A' }, away: { club: D, name: 'Club D' } }),
  // Équipe sans club connu : personne.
  F('f8', { category: 'U15', sex: 'M', level: 'departemental', home: { name: 'Équipe invitée' }, away: { name: 'Autre invitée' } }),
]
type P = MatchPlayer & { name: string }
const pl = (id: string, o: Omit<P, 'id' | 'name'>): P => ({ id, name: id.toUpperCase(), ...o })
const players: P[] = [
  pl('p1', { sex: 'M', birthDate: '2012-04-01', clubCode: A }),
  pl('p2', { sex: 'M', birthDate: '2012-04-01', clubCode: A, usualTeam: { n: 1 } }),
  pl('p3', { sex: 'M', birthDate: '2013-04-01', clubCode: A, usualTeam: { level: 'departemental' } }),
  pl('p4', { sex: 'M', birthDate: '2012-04-01', clubCode: A, usualTeam: { playsIn: 'U18', n: 1 } }),
  pl('p5', { sex: 'F', birthDate: '2012-04-01', clubCode: B }),
  pl('p6', { sex: 'M', birthDate: '2012-04-01' }), // sans club
  pl('p7', { sex: 'M', clubCode: A }), // année inconnue
  pl('p8', { sex: 'M', clubCode: A, usualTeam: { playsIn: 'U15', n: 2 } }), // année inconnue, catégorie déclarée
  pl('p9', { birthDate: '2012-04-01', clubCode: A }), // sexe inconnu
  pl('p10', { sex: 'M', birthDate: '2012-04-01', license: `${B}123456`, usualTeam: { n: 2 } }), // club lu dans la licence
  pl('p11', { sex: 'M', birthDate: '2014-04-01', clubCode: A }),
  pl('p12', { sex: 'F', birthDate: '2015-04-01', clubCode: C }),
  pl('p13', { sex: 'M', birthDate: '2012-04-01', clubCode: A, usualTeam: { n: 1, level: 'departemental' } }),
]
{
  const m = matchPlayers(fixtures, players, HB)
  const ids = (f: string) => (m.get(f) ?? []).map((x) => x.player.id).sort()
  const of = (f: string, p: string) => m.get(f)?.find((x) => x.player.id === p)
  // f1 : U15 M régional, A (1) – B (2).
  assert.deepEqual(ids('f1'), ['p1', 'p10', 'p13', 'p2'])
  assert.equal(of('f1', 'p2')?.byTeam, true, 'équipe 1 = équipe 1')
  assert.equal(of('f1', 'p2')?.side, 'home')
  assert.equal(of('f1', 'p10')?.side, 'away', 'licence du club B, équipe 2')
  assert.equal(of('f1', 'p1')?.byTeam, false, 'sans équipe : club et catégorie')
  assert.equal(of('f1', 'p13')?.byTeam, true, 'équipe connue des deux côtés : le niveau déclaré ne compte plus')
  // f2 : U15 M départemental, A (2) – C.
  assert.deepEqual(ids('f2'), ['p1', 'p3', 'p8'], 'p2 et p13 (équipe 1) non ; p3 (niveau départemental) oui ; p8 (année inconnue, U15 déclarée, équipe 2) oui')
  // f3 : U15 F : seulement les filles du club B (et de C).
  assert.deepEqual(ids('f3'), ['p5'])
  // f4 : U18 M national, D (1) – A (1) : le surclassé (U18 déclarée, équipe 1).
  assert.deepEqual(ids('f4'), ['p4'])
  // f5 : U13 mixte, A – C : garçons et filles de la catégorie.
  assert.deepEqual(ids('f5'), ['p11', 'p12'])
  // f6 : derby A (1) – A (2) : chacun une seule fois, de son côté s'il a une équipe.
  assert.deepEqual(ids('f6'), ['p1', 'p13', 'p2', 'p3', 'p8'])
  assert.equal(of('f6', 'p2')?.side, 'home')
  assert.equal(of('f6', 'p8')?.side, 'away')
  assert.equal(of('f6', 'p8')?.byTeam, true)
  // f7 : U15 M régional, A sans numéro : le niveau décide (p3 départemental : non ; p13 départemental : non).
  assert.deepEqual(ids('f7'), ['p1', 'p2', 'p8'])
  // f8 : pas de club : personne. Joueurs sans club, sans sexe, sans année : jamais.
  assert.equal(m.has('f8'), false)
  for (const id of ['p6', 'p7', 'p9']) assert.ok(![...m.values()].flat().some((x) => x.player.id === id), `${id} ne joue nulle part`)
  // Statut : « devrait jouer » ; confirmé (étape 2) : « joue ».
  assert.ok([...m.values()].flat().every((x) => x.status === 'devrait_jouer'))
  const conf = matchPlayers(fixtures, indexPlayers(players), HB, { confirmed: new Set(['f1|p2']) })
  assert.equal(conf.get('f1')?.find((x) => x.player.id === 'p2')?.status, 'joue')
  assert.equal(conf.get('f1')?.find((x) => x.player.id === 'p1')?.status, 'devrait_jouer')
  // Comptes.
  assert.equal(distinctYouths(m), 10, 'p1 p2 p3 p4 p5 p8 p10 p11 p12 p13, sans doublon')
  assert.equal(distinctYouths(m, ['f1', 'f2']), 6)
  // Saison de la rencontre : la même liste un 30 août (saison 2025-2026), p1 (2012) y est U15 et p3 (2013) U13.
  const aug = matchPlayers([{ ...fixtures[1], id: 'aout', startsAt: '2026-08-30T10:00:00+02:00' }], players, HB)
  assert.deepEqual((aug.get('aout') ?? []).map((x) => x.player.id).sort(), ['p1', 'p8'])
}

// ---------- Rayon, tri, salles ----------
{
  const center = { lat: 43.12, lng: 5.93 }
  const near40 = withinRadius(fixtures, center, 40)
  assert.deepEqual(near40.map((f) => f.id).sort(), ['f1', 'f2', 'f3', 'f5', 'f6', 'f8'], 'f4 (Marseille, 47 km) et f7 (~50 km) dehors')
  assert.equal(near40.find((f) => f.id === 'f1')?.distanceKm, 0)
  near(near40.find((f) => f.id === 'f2')!.distanceKm, 13.8, 0.05)
  const m = matchPlayers(near40, players, HB)
  assert.deepEqual(sortFixtures(near40, m, 'date').map((f) => f.id), ['f1', 'f3', 'f5', 'f8', 'f6', 'f2'], 'heure, puis distance, puis identifiant')
  assert.deepEqual(sortFixtures(near40, m, 'distance').map((f) => f.id), ['f1', 'f3', 'f5', 'f8', 'f6', 'f2'])
  assert.deepEqual(sortFixtures(near40, m, 'jeunes').map((f) => f.id), ['f6', 'f1', 'f2', 'f5', 'f3', 'f8'])
  const v = venuesOf(near40, m)
  assert.equal(v.length, 2, 'une salle à Toulon, une à 14 km')
  const toulon = v.find((x) => x.lat === 43.12)!
  assert.equal(toulon.fixtures.length, 5)
  assert.equal(toulon.youths, 9, 'jeunes différents de la salle : f1, f3, f5, f6')
}

// ---------- Lignes du serveur ----------
{
  const row = {
    id: 'demo:1',
    starts_at: '2026-10-31T13:00:00+00:00',
    lat: 43.12,
    lng: 5.93,
    category: 'U15',
    sex: 'M',
    level: 'regional',
    competition: 'Championnat régional U15 masculin',
    home_unit_id: 'u1',
    home_club: A,
    home_team: 2,
    home_name: 'Club A',
    away_unit_id: null,
    away_club: B,
    away_team: null,
    away_name: 'Club B',
    venue: 'Gymnase des Tilleuls',
    city: 'Villefictive',
    live_url: null,
    source: 'demo',
    distance_km: '12.3',
  }
  const f = fromRow(row)!
  assert.equal(f.distanceKm, 12.3, 'numeric rendu en texte')
  assert.deepEqual(f.home, { name: 'Club A', unitId: 'u1', club: A, team: 2 })
  assert.deepEqual(f.away, { name: 'Club B', club: B })
  assert.equal(f.liveUrl, undefined)
  assert.equal(teamsLabel(f), 'Club A (2) – Club B')
  assert.equal(fixtureHeading(f), 'U15 · Régional · Championnat régional U15 masculin')
  assert.equal(fromRow({ ...row, live_url: 'javascript:alert(1)' })!.liveUrl, undefined, 'lien dangereux écarté')
  assert.equal(fromRow({ ...row, live_url: 'https://diffusion.example/match' })!.liveUrl, 'https://diffusion.example/match')
  assert.equal(fromRow({ ...row, home_name: '' }), null)
  assert.equal(fromRow({ ...row, level: 'mondial' }), null)
  assert.equal(fromRow({ ...row, lat: 120 }), null)
  assert.equal(fromRow({ ...row, starts_at: 'demain' }), null)
  assert.equal(fromRow(null), null)
  assert.equal(safeUrl('ftp://x'), undefined)
}

// ---------- Textes, lien Itinéraire ----------
{
  assert.equal(youthsText(1), '1 jeune')
  assert.equal(youthsText(3), '3 jeunes')
  assert.equal(namesLine(['Léa DUPONT']), 'Léa DUPONT')
  assert.equal(namesLine(['A', 'B']), 'A, B')
  assert.equal(namesLine(['A', 'B', 'C', 'D']), 'A, B +2')
  assert.equal(namesLine(['A', 'B', 'C'], 1), 'A +2')
  assert.equal(distanceText(0.43), '400 m')
  assert.equal(distanceText(0.02), '100 m')
  assert.equal(distanceText(3.44), '3,4 km')
  assert.equal(distanceText(12.6), '13 km')
  assert.equal(distanceText(undefined), '')
  // Les coordonnées de la salle, rien d'autre (ni nom, ni joueur).
  assert.equal(itineraryUrl(43.12, 5.93), 'https://www.openstreetmap.org/directions?route=%3B43.12000%2C5.93000#map=15/43.12000/5.93000')
}

// ---------- Où : villes, département ----------
{
  const deptOf = (n: string) => n.slice(2, 4)
  const U = (id: string, city: string | undefined, clubNumber: string | undefined, lat?: number, lng?: number, extra = {}) => ({
    id,
    levelId: 'niveau-club',
    city,
    clubNumber,
    ...(lat !== undefined ? { lat, lng } : {}),
    ...extra,
  })
  const units = [
    U('u1', 'Villefictive', '6283001', 43.1, 5.9),
    U('u2', 'Villefictive', '6283002', 43.14, 5.95),
    U('u3', 'Saint-Exemple-sur-Mer', '6283003', 43.4, 6.2),
    U('u4', 'Villefictive', '6213001', 43.3, 5.4), // même nom, autre département
    U('u5', 'Sans-Coordonnées', '6283004'),
    U('u6', 'Supprimée', '6283005', 43, 6, { deleted: true }),
    { id: 'c1', levelId: 'niveau-comite', city: 'Chef-lieu', lat: 43.2, lng: 6.0 },
  ]
  const cities = citiesOf(units, deptOf)
  assert.deepEqual(cities.map((c) => `${c.name}|${c.dept}|${c.clubs}`), ['Villefictive|83|2', 'Saint-Exemple-sur-Mer|83|1', 'Villefictive|13|1'])
  near(cities[0].lat, 43.12, 1e-9)
  assert.deepEqual(searchCities(cities, 'ville').map((c) => c.dept), ['83', '13'])
  assert.deepEqual(searchCities(cities, 'exemple').map((c) => c.name), ['Saint-Exemple-sur-Mer'], 'contient')
  assert.deepEqual(searchCities(cities, 'saint exemple').map((c) => c.name), ['Saint-Exemple-sur-Mer'], 'tirets et espaces')
  assert.deepEqual(searchCities(cities, ''), [])
  const d83 = deptCenter(units, '83', deptOf)!
  near(d83.lat, (43.1 + 43.14 + 43.4) / 3, 1e-9)
  assert.equal(deptCenter(units, '06', deptOf), undefined)
}

// ---------- Choix gardés, demande ----------
{
  assert.deepEqual(parsePrefs(null), { km: 25, period: 'weekend' })
  assert.deepEqual(parsePrefs({ km: 33, period: 'demain', place: { kind: 'ville', label: 'x', lat: 1, lng: 2 } }), { km: 25, period: 'weekend' })
  assert.deepEqual(parsePrefs({ km: 50, period: '30j', place: { kind: 'city', label: 'Villefictive', lat: 43.12, lng: 5.93, extra: 1 } }), {
    km: 50,
    period: '30j',
    place: { kind: 'city', label: 'Villefictive', lat: 43.12, lng: 5.93 },
  })
  assert.equal(parsePrefs({ place: { kind: 'pos', label: 'Ma position', lat: 95, lng: 0 } }).place, undefined, 'coordonnées impossibles')
  const range = { from: new Date('2026-10-30T23:00:00Z'), to: new Date('2026-11-01T23:00:00Z') }
  const r = aroundRequest({ lat: 43.123456, lng: 5.987654 }, 25, range, players, { sex: 'M' })
  assert.deepEqual(r, { lat: 43.123, lng: 5.988, km: 25, from: '2026-10-30T23:00:00.000Z', to: '2026-11-01T23:00:00.000Z', sex: 'M', clubs: [A, B, C] })
  assert.equal(aroundRequest({ lat: 43, lng: 5 }, 25, range, players, { all: true }).clubs, undefined, 'toutes les rencontres')
  assert.notEqual(requestKey(r), requestKey({ ...r, clubs: [A] }))
}

// ---------- Générateur des rencontres fictives (tools/seed-rencontres.ts) ----------
{
  assert.deepEqual(parseArgs(['/tmp/x.sql']), { out: '/tmp/x.sql', opts: { weeks: 10, rest: 0.15 } })
  assert.deepEqual(parseArgs(['/tmp/x.sql', '--semaines', '4', '--repos', '0.2', '--sport', 'volley', '--estimer']).opts, { weeks: 4, rest: 0.2, sport: 'volley', estimate: true })
  assert.throws(() => parseArgs([]), /manquant/)
  assert.throws(() => parseArgs(['/tmp/x.sql', '--sport', 'basket']), /--sport/)
  assert.throws(() => parseArgs(['/tmp/x.sql', '--semaines', '99']), /--semaines/)
  // Jamais dans le dépôt.
  assert.equal(insideRepo('tools/rencontres.sql'), true)
  assert.equal(insideRepo(new URL('../src/x.sql', import.meta.url).pathname), true)
  assert.equal(insideRepo('/tmp/rencontres.sql'), false)
  // Centres des départements tirés des contours de l'appli : métropole, Corse (« 20 »), outre-mer.
  const centers = deptCenters()
  const [lng83, lat83] = centers.get('83')!
  assert.ok(lat83 > 43 && lat83 < 43.8 && lng83 > 5.6 && lng83 < 6.9, 'Var')
  assert.ok(centers.has('20') && !centers.has('2A') && centers.has('974'))
  // Le fichier : idempotent (jeu « demo » remplacé), une transaction, sport de la base, salles fictives, aucune donnée.
  const sql = seedSql({ weeks: 10, rest: 0.15 }, new Date('2026-10-26T12:00:00Z'))
  assert.match(sql, /delete from public\.hb_rencontres where source = 'demo';/)
  assert.match(sql, /^begin;$/m)
  assert.match(sql, /^commit;$/m)
  assert.match(sql, /from public\.hb_config where id = 'sport'/)
  assert.match(sql, /generate_series\(0, 10\)/)
  assert.ok(!/random\(\)/.test(sql), 'tirages déterministes (md5), pas de random()')
  for (const v of VENUES) assert.ok(sql.includes(v.replace(/'/g, "''")))
  assert.ok(sql.includes("('volley', 'M15', 1, array[14, 15]::int[]"), 'catégories du volley')
  const est = seedSql({ weeks: 2, rest: 0.1, sport: 'volley', estimate: true })
  assert.ok(!/\b(insert|update|delete)\b/i.test(est.replace(/not deleted/g, '')), 'estimation : lecture seule')
  assert.match(est, /coalesce\('volley', 'handball'\)/)
}

console.log('test-rencontres : OK')
