// Test de « Ajouter à mes événements » depuis une rencontre (src/rencontreEvent.ts), sur des rencontres, comptes et
// joueurs FICTIFS.
//
//   npx jiti tools/test-rencontre-evenement.ts
//
// Heure locale fixée (Europe/Paris) : le jour et l'heure de l'événement sont ceux de l'appareil.
process.env.TZ = 'Europe/Paris'

import assert from 'node:assert/strict'
import { eventIcs } from '../src/agenda'
import { buildCopyDraft, ALL_COPY } from '../src/eventCopy'
import type { HBEvent } from '../src/db'
import {
  ACTION_LABEL,
  categoryLabel,
  eventFromRencontre,
  findRencontreEvent,
  firstName,
  goingStaff,
  indexRencontreEvents,
  joinEvent,
  localDateTime,
  rencontreAction,
  rencontreEventName,
  rencontreSnapshot,
  staffGoingLabel,
  staffName,
} from '../src/rencontreEvent'
import { fromRow, type Rencontre } from '../src/rencontres'

const row = (o: Record<string, unknown> = {}) =>
  fromRow({
    id: 'demo:r1',
    starts_at: '2026-11-01T13:00:00Z',
    lat: 44.9334,
    lng: 4.8924,
    category: 'U15',
    sex: 'M',
    level: 'regional',
    competition: 'Championnat régional U15 masculin',
    home_name: 'HBC Fictif',
    home_club: '6226001',
    home_team: 2,
    away_name: 'AS Exemple',
    away_club: '6226002',
    away_team: 1,
    venue: 'Gymnase des Tilleuls',
    city: 'Valence',
    live_url: 'https://exemple.test/direct',
    distance_km: 12.3,
    source: 'demo',
    ...o,
  })!
const R: Rencontre = row()

// ---------- Nom, jour, heure ----------
assert.equal(categoryLabel(R), 'U15 masculin')
assert.equal(categoryLabel({ category: 'M15', sex: 'F' }), 'M15 féminin', 'volley : catégories du sport')
assert.equal(categoryLabel({ category: 'U13', sex: 'X' }), 'U13 mixte')
// Comme les matchs créés depuis une feuille (« Compétition – Équipe A / Équipe B »).
assert.equal(rencontreEventName(R), 'U15 masculin – HBC Fictif (2) / AS Exemple (1)')
assert.equal(rencontreEventName({ ...R, home: { name: 'A' }, away: { name: 'B' } }), 'U15 masculin – A / B', 'sans numéro d’équipe')
assert.ok(rencontreEventName({ ...R, home: { name: 'x'.repeat(300) } }).length <= 200)
assert.deepEqual(localDateTime('2026-11-01T13:00:00Z'), { date: '2026-11-01', time: '14:00' }, 'heure d’hiver : UTC+1')
assert.deepEqual(localDateTime('2026-10-24T22:30:00Z'), { date: '2026-10-25', time: '00:30' }, 'jour local, pas jour UTC')
assert.deepEqual(localDateTime('2026-10-24T12:00:00+02:00'), { date: '2026-10-24', time: '12:00' })

// ---------- eventFromRencontre ----------
{
  const ev = eventFromRencontre(R, { id: 'u-moi', name: '  Camille TESTEUR ' }, ['p1', 'p2', 'p1', ''], {
    id: 'ev-1',
    organizer: { id: 'unit-83', name: 'Comité fictif' },
  })
  assert.equal(ev.id, 'ev-1')
  assert.equal(ev.type, 'match')
  assert.equal(ev.name, 'U15 masculin – HBC Fictif (2) / AS Exemple (1)')
  assert.equal(ev.date, '2026-11-01')
  assert.equal(ev.time, '14:00')
  assert.equal(ev.place, 'Gymnase des Tilleuls, Valence')
  assert.equal(ev.sex, 'M')
  assert.deepEqual(ev.playerIds, ['p1', 'p2'], 'jeunes de Qui, sans doublon')
  assert.deepEqual(ev.addedBy, { p1: 'u-moi', p2: 'u-moi' })
  assert.deepEqual(ev.editors, ['u-moi'], 'participants = moi')
  assert.deepEqual(ev.names, { 'u-moi': 'Camille TESTEUR' })
  assert.equal(ev.organizerUnitId, 'unit-83')
  assert.equal(ev.organizerName, 'Comité fictif')
  assert.equal(ev.rencontreId, 'demo:r1')
  assert.deepEqual(ev.rencontre, {
    category: 'U15',
    sex: 'M',
    level: 'regional',
    competition: 'Championnat régional U15 masculin',
    lat: 44.9334,
    lng: 4.8924,
    venue: 'Gymnase des Tilleuls',
    city: 'Valence',
    home: { name: 'HBC Fictif', team: 2, club: '6226001' },
    away: { name: 'AS Exemple', team: 1, club: '6226002' },
  })
  assert.ok(!('liveUrl' in ev.rencontre!) && !('distanceKm' in ev.rencontre!), 'ni lien de diffusion ni distance (ils changent)')
  assert.ok(!('updatedAt' in ev), 'save() pose updatedAt')
  // Mode local (pas de compte) : ni participant ni « ajouté par » ; sans jeune : pas de liste ; mixte ; pas d'organisateur.
  const local = eventFromRencontre(row({ sex: 'X', venue: null, city: null }), {}, [], { id: 'ev-2' })
  assert.deepEqual(local.editors, [])
  assert.equal(local.playerIds, undefined)
  assert.equal(local.addedBy, undefined)
  assert.equal(local.names, undefined)
  assert.equal(local.organizerUnitId, undefined)
  assert.equal(local.place, undefined)
  assert.equal(local.sex, 'mixte')
  assert.deepEqual(rencontreSnapshot(row({ competition: null, home_team: null, home_club: null })).home, { name: 'HBC Fictif' })
  // « Dupliquer l'événement » ne reprend jamais le lien vers la rencontre.
  const draft = buildCopyDraft({ ...ev, updatedAt: 1 } as HBEvent, ALL_COPY, [], '2026-10-26')
  assert.ok(!('rencontreId' in draft) && !('rencontre' in draft))
  // Le fichier d'agenda de cet événement : nombre de jeunes, jamais d'identifiant ni de nom.
  const ics = eventIcs(ev, { now: new Date('2026-10-26T10:00:00Z') })!.ics.replace(/\r\n /g, '')
  assert.ok(ics.includes('DESCRIPTION:2 jeunes à voir\\nU15 · Régional · Championnat régional U15 masculin'))
  assert.ok(!ics.includes('p1') && !ics.includes('TESTEUR') && !ics.includes('u-moi'))
}

// ---------- Un événement par rencontre ----------
{
  type E = { id: string; rencontreId?: string; deleted?: boolean; createdAtServer?: string }
  const evs: E[] = [
    { id: 'a', rencontreId: 'r1', deleted: true, createdAtServer: '2026-10-01T00:00:00Z' },
    { id: 'z', rencontreId: 'r1', createdAtServer: '2026-10-20T10:00:00Z' },
    { id: 'b', rencontreId: 'r1', createdAtServer: '2026-10-20T09:00:00Z' },
    { id: 'c', rencontreId: 'r1' }, // créé sur cet appareil, pas encore envoyé
    { id: 'd', rencontreId: 'r2' },
    { id: 'e' },
  ]
  assert.equal(findRencontreEvent(evs, 'r1')?.id, 'b', 'le plus ancien déjà sur le serveur, jamais un supprimé')
  assert.equal(findRencontreEvent(evs, 'r2')?.id, 'd')
  assert.equal(findRencontreEvent(evs, 'r3'), undefined)
  assert.equal(findRencontreEvent([{ id: 'a', rencontreId: 'r1', deleted: true }], 'r1'), undefined, 'supprimé : on peut en recréer un')
  const ix = indexRencontreEvents(evs)
  assert.deepEqual([...ix.keys()].sort(), ['r1', 'r2'])
  assert.equal(ix.get('r1')?.id, 'b')
  // Même choix quel que soit l'ordre (deux encadrants l'ont créé en même temps).
  assert.equal(indexRencontreEvents([...evs].reverse()).get('r1')?.id, 'b')
  assert.equal(indexRencontreEvents([{ id: 'y', rencontreId: 'r9' }, { id: 'x', rencontreId: 'r9' }]).get('r9')?.id, 'x')
}

// ---------- Qui y va ----------
{
  const members = (t: string) => (t === 'gt-1' ? ['u-paul', 'u-moi', 'u-lea'] : undefined)
  assert.deepEqual(goingStaff({ editors: ['u-stef', 'u-moi'], teams: ['gt-1', 'gt-inconnu'] }, members), ['u-stef', 'u-moi', 'u-paul', 'u-lea'])
  assert.deepEqual(goingStaff({}), [])
  const names: Record<string, string> = { 'u-stef': 'Stef FICTIF', 'u-paul': 'Paul', 'u-lea': 'Léa FICTIVE', 'u-moi': 'Moi' }
  const n = (u: string) => names[u]
  assert.equal(staffGoingLabel([], 'u-moi', n), '')
  assert.equal(staffGoingLabel(['u-moi'], 'u-moi', n), 'Tu y vas')
  assert.equal(staffGoingLabel(['u-stef'], 'u-moi', n), 'Stef y va')
  assert.equal(staffGoingLabel(['u-stef', 'u-paul'], 'u-moi', n), 'Stef et Paul y vont')
  assert.equal(staffGoingLabel(['u-moi', 'u-stef'], 'u-moi', n), 'Toi et Stef y allez')
  assert.equal(staffGoingLabel(['u-stef', 'u-moi', 'u-paul'], 'u-moi', n), 'Toi, Stef et Paul y allez')
  assert.equal(staffGoingLabel(['u-stef', 'u-paul', 'u-lea'], 'u-moi', n), '3 du staff y vont')
  assert.equal(staffGoingLabel(['u-moi', 'u-stef', 'u-paul', 'u-lea'], 'u-moi', n), 'Toi et 3 du staff y allez')
  assert.equal(staffGoingLabel(['u-x'], 'u-moi', n), '1 du staff y va', 'nom inconnu : un nombre')
  assert.equal(staffGoingLabel(['u-moi', 'u-x'], 'u-moi', n), 'Toi et 1 du staff y allez')
  assert.equal(staffGoingLabel(['u-stef'], null, n), 'Stef y va', 'mode local')
  assert.equal(firstName('  Stef   MARTIN '), 'Stef')
  assert.equal(firstName(undefined), '')
  const ev = { names: { 'u-stef': 'Stef FICTIF' }, createdBy: 'u-org', createdByName: 'Orga NISATEUR' }
  assert.equal(staffName(ev, 'u-stef'), 'Stef FICTIF')
  assert.equal(staffName(ev, 'u-org'), 'Orga NISATEUR', 'le créateur : nom signé par le serveur')
  assert.equal(staffName(ev, 'u-x'), undefined)
}

// ---------- Bouton proposé, « J'y vais aussi » ----------
{
  const ev = { editors: ['u-stef'], teams: ['gt-1'] }
  const members = (t: string) => (t === 'gt-1' ? ['u-lea'] : undefined)
  const ctx = { me: 'u-moi', canCreate: true, canJoin: false, membersOf: members }
  assert.equal(rencontreAction(undefined, ctx), 'add', 'pas encore d’événement')
  assert.equal(rencontreAction(undefined, { ...ctx, canCreate: false }), null, 'rôle sans création : rien')
  assert.equal(rencontreAction(ev, { ...ctx, canCreate: false, canJoin: true }), null, 'rôle sans création : rien, même s’il existe')
  assert.equal(rencontreAction({ editors: ['u-moi'] }, ctx), 'in', 'j’y vais déjà')
  assert.equal(rencontreAction(ev, { ...ctx, me: 'u-lea' }), 'in', 'j’y vais par un groupe de travail')
  assert.equal(rencontreAction(ev, { ...ctx, canJoin: true }), 'join', 'organisateur ou administrateur : J’y vais aussi')
  assert.equal(rencontreAction(ev, ctx), 'ask', 'le serveur ne me laisse pas m’ajouter : l’ouvrir, demander')
  assert.equal(rencontreAction(ev, { ...ctx, me: null }), 'in', 'mode local : un seul utilisateur')
  assert.equal(ACTION_LABEL.add.full, 'Ajouter à mes événements')
  assert.equal(ACTION_LABEL.in.full, '✓ Dans mes événements')
  assert.equal(ACTION_LABEL.join.full, 'J’y vais aussi')

  const base = eventFromRencontre(R, { id: 'u-stef', name: 'Stef FICTIF' }, ['p1'], { id: 'ev-1' })
  const joined = joinEvent(base, { id: 'u-moi', name: 'Camille TESTEUR' })
  assert.deepEqual(joined.editors, ['u-stef', 'u-moi'])
  assert.deepEqual(joined.names, { 'u-stef': 'Stef FICTIF', 'u-moi': 'Camille TESTEUR' })
  assert.deepEqual(joined.playerIds, base.playerIds, 'le reste ne bouge pas')
  assert.equal(joined.rencontreId, base.rencontreId)
  assert.equal(joinEvent(joined, { id: 'u-moi', name: 'Camille TESTEUR' }), joined, 'déjà participant : inchangé')
  assert.equal(joinEvent(base, {}), base, 'sans compte : inchangé')
  assert.equal(rencontreAction(joined, ctx), 'in', 'après « J’y vais aussi » : dans mes événements')
  assert.equal(staffGoingLabel(goingStaff(joined), 'u-moi', (u) => staffName(joined, u)), 'Toi et Stef y allez')
  assert.equal(staffGoingLabel(goingStaff(base), 'u-moi', (u) => staffName(base, u)), 'Stef y va')
}

console.log('test-rencontre-evenement : OK')
