// Test du fichier d'agenda (src/agenda.ts) : RFC 5545, sur des événements FICTIFS.
//
//   npx jiti tools/test-agenda.ts
//
// Heure locale fixée (Europe/Paris) : le jour et l'heure d'un événement sont ceux de l'appareil ; le passage à l'heure
// d'hiver (dimanche 25 octobre 2026, 3 h → 2 h) change le décalage avec l'UTC.
process.env.TZ = 'Europe/Paris'

import assert from 'node:assert/strict'
import {
  agendaFileName,
  agendaUid,
  dayStamp,
  escapeText,
  eventIcs,
  foldLine,
  icsFor,
  localStart,
  utcStamp,
  youthsToSee,
  type AgendaEvent,
} from '../src/agenda'

const NOW = new Date('2026-10-26T09:30:00Z')
const lines = (ics: string) => ics.split('\r\n')
/** Lignes dépliées (RFC 5545 3.1 : CRLF suivi d'une espace = suite de la ligne). */
const unfold = (ics: string) => ics.replace(/\r\n /g, '').split('\r\n')
const prop = (ics: string, name: string) => unfold(ics).find((l) => l.startsWith(`${name}:`) || l.startsWith(`${name};`))
const bytes = (s: string) => Buffer.byteLength(s, 'utf8')

// ---------- Échappement ----------
assert.equal(escapeText('a\\b;c,d'), 'a\\\\b\\;c\\,d')
assert.equal(escapeText('ligne 1\nligne 2\r\nligne 3\rfin'), 'ligne 1\\nligne 2\\nligne 3\\nfin')
assert.equal(escapeText('tab\there\u0007bip'), 'tab\there' + 'bip', 'caractères de contrôle retirés, tabulation gardée')
assert.equal(escapeText('Été : « Gymnase », Valence'), 'Été : « Gymnase »\\, Valence')

// ---------- Pliage à 75 octets ----------
{
  const short = 'SUMMARY:court'
  assert.equal(foldLine(short), short)
  const ascii = 'DESCRIPTION:' + 'x'.repeat(200)
  const f = foldLine(ascii)
  const ls = f.split('\r\n')
  assert.ok(ls.length > 2)
  assert.equal(bytes(ls[0]), 75, 'première ligne pleine')
  for (const l of ls) assert.ok(bytes(l) <= 75, `ligne de ${bytes(l)} octets`)
  for (const l of ls.slice(1)) assert.ok(l.startsWith(' '), 'suite : commence par une espace')
  assert.equal(f.replace(/\r\n /g, ''), ascii, 'dépliée : identique')
  // Caractères de 2, 3 et 4 octets (é, €, emoji, idéogrammes) : jamais coupés.
  for (const unit of ['é', '€', '🤾', '漢', 'aé€🤾']) {
    for (let pre = 0; pre < 6; pre++) {
      const s = 'LOCATION:' + 'a'.repeat(pre) + unit.repeat(60)
      const out = foldLine(s)
      for (const l of out.split('\r\n')) {
        assert.ok(bytes(l) <= 75, `${unit} : ${bytes(l)} octets`)
        assert.ok(!l.includes('�'), 'aucun caractère coupé')
        // Chaque morceau est de l'UTF-8 valable à lui seul : rien de coupé au milieu d'une séquence.
        assert.equal(Buffer.from(l, 'utf8').toString('utf8'), l)
        assert.ok(!/[\ud800-\udbff]$/.test(l) && !/^ ?[\udc00-\udfff]/.test(l), 'paire de substitution entière')
      }
      assert.equal(out.replace(/\r\n /g, ''), s)
    }
  }
}

// ---------- Heures : UTC, passage à l'heure d'hiver ----------
{
  // Samedi 24 octobre 2026, 14 h à Paris (heure d'été, UTC+2) → 12 h UTC.
  assert.equal(utcStamp(localStart('2026-10-24', '14:00')!), '20261024T120000Z')
  // Dimanche 25 octobre 2026, 14 h (heure d'hiver depuis 3 h, UTC+1) → 13 h UTC.
  assert.equal(utcStamp(localStart('2026-10-25', '14:00')!), '20261025T130000Z')
  // Dimanche 1er novembre, 10 h 30 → 9 h 30 UTC.
  assert.equal(utcStamp(localStart('2026-11-01', '10:30')!), '20261101T093000Z')
  // Été : 28 mars 2027 (passage à l'heure d'été), 15 h → 13 h UTC.
  assert.equal(utcStamp(localStart('2027-03-28', '15:00')!), '20270328T130000Z')
  assert.equal(localStart('2026-10-24'), undefined, 'sans heure : pas d’instant')
  assert.equal(localStart('2026-02-30', '10:00'), undefined, 'jour impossible')
  assert.equal(localStart('2026-10-24', '25:00'), undefined, 'heure impossible')

  // Match de nuit qui traverse le changement d'heure : samedi 23 h 30 (UTC+2) + 2 h → 21 h 30 UTC + 2 h.
  const ics = icsFor({ uid: 'e1', title: 'Match', start: localStart('2026-10-24', '23:30')!, now: NOW })
  assert.equal(prop(ics, 'DTSTART'), 'DTSTART:20261024T213000Z')
  assert.equal(prop(ics, 'DTEND'), 'DTEND:20261024T233000Z', 'durée par défaut : 2 h (temps réel)')
  assert.equal(prop(ics, 'DTSTAMP'), 'DTSTAMP:20261026T093000Z')
}

// ---------- Journée entière ----------
{
  assert.equal(dayStamp('2026-12-31'), '20261231')
  assert.equal(dayStamp('2026-12-31', 1), '20270101', 'fin exclue : le lendemain, changement d’année')
  assert.equal(dayStamp('2028-02-28', 1), '20280229', 'année bissextile')
  const ics = icsFor({ uid: 'e2', title: 'Tournoi', start: '2026-11-01', allDay: true, now: NOW })
  assert.equal(prop(ics, 'DTSTART'), 'DTSTART;VALUE=DATE:20261101')
  assert.equal(prop(ics, 'DTEND'), 'DTEND;VALUE=DATE:20261102')
  assert.ok(!ics.includes('BEGIN:VALARM'), 'pas de rappel sur une journée entière')
  const two = icsFor({ uid: 'e3', title: 'Stage', start: '2026-11-01', end: '2026-11-03', allDay: true, now: NOW })
  assert.equal(prop(two, 'DTEND'), 'DTEND;VALUE=DATE:20261104', 'trois jours : fin exclue le 4')
  assert.throws(() => icsFor({ uid: 'x', title: 'x', start: '2026-13-01', allDay: true }))
  assert.throws(() => icsFor({ uid: 'x', title: 'x', start: '2026-11-01' }), 'heure attendue')
}

// ---------- Fichier complet ----------
{
  const ics = icsFor({
    uid: 'demo:abc 123/é',
    title: 'U15 masculin – Club A (2) / Club B (1)',
    start: localStart('2026-11-01', '14:00')!,
    location: 'Gymnase des Tilleuls, Valence',
    geo: { lat: 44.933393, lng: 4.89236 },
    url: 'https://exemple.test/app/evenements/e1',
    description: '3 jeunes à voir\nU15 · Régional · Championnat régional U15 masculin',
    now: NOW,
  })
  assert.ok(ics.endsWith('\r\n'), 'se termine par CRLF')
  assert.ok(!/[^\r]\n/.test(ics), 'que des CRLF')
  for (const l of lines(ics)) assert.ok(bytes(l) <= 75, `ligne trop longue : ${l}`)
  const u = unfold(ics)
  assert.deepEqual(u.slice(0, 6), ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Nextar//Agenda//FR', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'BEGIN:VEVENT'])
  assert.deepEqual(u.slice(-3), ['END:VEVENT', 'END:VCALENDAR', ''])
  assert.equal(prop(ics, 'UID'), 'UID:demo:abc-123--@nextar', 'UID réduit aux caractères sûrs')
  assert.equal(prop(ics, 'DTSTART'), 'DTSTART:20261101T130000Z')
  assert.equal(prop(ics, 'DTEND'), 'DTEND:20261101T150000Z')
  assert.equal(prop(ics, 'SUMMARY'), 'SUMMARY:U15 masculin – Club A (2) / Club B (1)')
  assert.equal(prop(ics, 'LOCATION'), 'LOCATION:Gymnase des Tilleuls\\, Valence')
  assert.equal(prop(ics, 'GEO'), 'GEO:44.933393;4.892360')
  assert.equal(prop(ics, 'URL'), 'URL:https://exemple.test/app/evenements/e1')
  assert.equal(prop(ics, 'DESCRIPTION'), 'DESCRIPTION:3 jeunes à voir\\nU15 · Régional · Championnat régional U15 masculin')
  // Rappel 2 h avant, seulement pour l'événement à l'heure connue.
  const alarm = u.slice(u.indexOf('BEGIN:VALARM'), u.indexOf('END:VALARM') + 1)
  assert.deepEqual(alarm, ['BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:U15 masculin – Club A (2) / Club B (1)', 'TRIGGER:-PT2H', 'END:VALARM'])
  assert.equal(u.filter((l) => l === 'BEGIN:VEVENT').length, 1)
  // UID stable : même événement, autre moment → même UID.
  const again = icsFor({ uid: 'demo:abc 123/é', title: 'autre titre', start: new Date(), now: new Date() })
  assert.equal(prop(again, 'UID'), prop(ics, 'UID'))
  // Lien autre que http(s), coordonnées impossibles : retirés.
  const bad = icsFor({ uid: 'b', title: 'b', start: '2026-11-01', allDay: true, url: 'javascript:alert(1)', geo: { lat: 120, lng: 3 }, now: NOW })
  assert.ok(!prop(bad, 'URL') && !prop(bad, 'GEO'))
  assert.equal(agendaUid('a b'), 'a-b@nextar')
}

// ---------- Fichier d'un événement : jamais un nom de jeune ----------
{
  // Joueurs FICTIFS : leurs « noms » sont glissés partout où un appel maladroit pourrait les faire passer.
  const NAMES = ['ZOÉFICTIVE', 'Testprénom', 'NOMFICTIF']
  const ev: AgendaEvent & Record<string, unknown> = {
    id: 'ev-1',
    name: 'U15 masculin – Club A (2) / Club B (1)',
    type: 'match',
    date: '2026-11-01',
    time: '14:00',
    place: 'Gymnase des Tilleuls, Valence',
    // Identifiants de joueurs : seulement comptés.
    playerIds: ['p-ZOÉFICTIVE', 'p-NOMFICTIF', 'p-3'],
    rencontreId: 'demo:r1',
    rencontre: { category: 'U15', level: 'regional', competition: 'Championnat régional U15 masculin', lat: 44.93, lng: 4.89 },
    // Champs qu'un événement peut avoir et que le fichier ne doit jamais lire.
    names: { u1: 'Testprénom ENCADRANT' },
    players: [{ firstName: 'Testprénom', lastName: 'ZOÉFICTIVE' }],
    addedBy: { 'p-ZOÉFICTIVE': 'u1' },
    matchSheet: { home: 'NOMFICTIF' },
  }
  const out = eventIcs(ev, { url: 'https://exemple.test/evenements/ev-1', now: NOW })!
  assert.ok(out)
  for (const n of NAMES) assert.ok(!out.ics.toLowerCase().includes(n.toLowerCase()), `« ${n} » ne doit pas apparaître`)
  assert.equal(prop(out.ics, 'DESCRIPTION'), 'DESCRIPTION:3 jeunes à voir\\nU15 · Régional · Championnat régional U15 masculin')
  assert.equal(prop(out.ics, 'UID'), 'UID:demo:r1@nextar', 'UID de la rencontre (même entrée depuis « Autour de moi »)')
  assert.equal(prop(out.ics, 'DTSTART'), 'DTSTART:20261101T130000Z')
  assert.equal(prop(out.ics, 'GEO'), 'GEO:44.930000;4.890000')
  assert.equal(out.fileName, 'match-2026-11-01.ics')
  // Le nombre peut être donné à part (fiche d'une rencontre) : toujours un nombre.
  assert.match(prop(eventIcs(ev, { youths: 1, now: NOW })!.ics, 'DESCRIPTION')!, /^DESCRIPTION:1 jeune à voir\\n/)
  // Sans heure : journée entière, pas de rappel ; sans rencontre ni joueur : pas de description.
  const plain = eventIcs({ id: 'ev-2', name: 'Stage de Toussaint', type: 'entrainement', date: '2026-10-28', place: 'Valence' }, { now: NOW })!
  assert.equal(prop(plain.ics, 'DTSTART'), 'DTSTART;VALUE=DATE:20261028')
  assert.ok(!plain.ics.includes('VALARM') && !prop(plain.ics, 'DESCRIPTION') && !prop(plain.ics, 'GEO') && !prop(plain.ics, 'URL'))
  assert.equal(prop(plain.ics, 'UID'), 'UID:ev-2@nextar')
  assert.equal(plain.fileName, 'entrainement-2026-10-28.ics')
  assert.equal(eventIcs({ id: 'x', name: 'x', type: 'match', date: 'bientôt' }), null, 'jour illisible : pas de fichier')
  assert.equal(agendaFileName('tournoi', '2026-11-01'), 'tournoi-2026-11-01.ics')
  assert.equal(agendaFileName('autre', '2026-11-01'), 'evenement-2026-11-01.ics')
  assert.equal(youthsToSee(0), '')
  assert.equal(youthsToSee(12), '12 jeunes à voir')
}

console.log('test-agenda : OK')
