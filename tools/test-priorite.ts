// Test « joueurs des événements du jour d'abord » (src/priorite.ts) et de la vérification allégée des lignes visibles
// (src/charge.ts, premiereVerifVisibles : hb_events?select=id plus à chaque lancement). Événements et joueurs fictifs.
//
//   npx jiti tools/test-priorite.ts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { addDays, eventDayPlayers, planPriorite, PRIORITE_MAX, PRIORITE_TABLES } from '../src/priorite'
import { CHARGE_REGLES, premiereVerifVisibles, prochaineVerifVisibles } from '../src/charge'
import { PULL_ORDER } from '../src/syncLive'
import type { SyncTable } from '../src/db'

let n = 0
const t = (name: string, f: () => void) => {
  f()
  n++
  console.log(`ok ${n} - ${name}`)
}

const TODAY = '2026-11-14'
const ev = (date: string, playerIds: unknown, o: { deleted?: boolean; archived?: boolean } = {}) => ({ date, playerIds, ...o })

t('dates : jour suivant, fin de mois, fin d’année, changement d’heure', () => {
  assert.equal(addDays('2026-11-14', 1), '2026-11-15')
  assert.equal(addDays('2026-11-30', 1), '2026-12-01')
  assert.equal(addDays('2026-12-31', 1), '2027-01-01')
  assert.equal(addDays('2026-10-24', 1), '2026-10-25') // passage à l'heure d'hiver
  assert.equal(addDays('2026-10-25', 1), '2026-10-26')
  assert.equal(addDays('2028-02-28', 1), '2028-02-29')
})

t('joueurs prioritaires : aujourd’hui puis demain, dans l’ordre des listes, sans doublon', () => {
  const events = [
    ev('2026-11-15', ['p5', 'p1']), // demain
    ev('2026-11-14', ['p1', 'p2']), // aujourd'hui
    ev('2026-11-13', ['hier']), // hier : non
    ev('2026-11-16', ['apres-demain']), // non
    ev('2026-11-14', ['p3', 'p2']), // aujourd'hui (2e)
  ]
  assert.deepEqual(eventDayPlayers(events, TODAY), ['p1', 'p2', 'p3', 'p5'])
  // Horizon réglable : aujourd'hui seulement.
  assert.deepEqual(eventDayPlayers(events, TODAY, 0), ['p1', 'p2', 'p3'])
})

t('joueurs prioritaires : événements supprimés, archivés, sans liste ou mal formés écartés', () => {
  const events = [
    ev(TODAY, ['a'], { deleted: true }),
    ev(TODAY, ['b'], { archived: true }),
    ev(TODAY, undefined),
    ev(TODAY, 'c'),
    { date: 20261114, playerIds: ['d'] },
    ev(TODAY, ['', null, 7, 'e']),
    ev(`${TODAY}T09:00:00`, ['f']), // date avec heure : le jour compte
  ]
  assert.deepEqual(eventDayPlayers(events, TODAY), ['e', 'f'])
  assert.deepEqual(eventDayPlayers([], TODAY), [])
})

t('joueurs prioritaires : au plus PRIORITE_MAX (ceux d’aujourd’hui d’abord)', () => {
  const many = Array.from({ length: 400 }, (_, i) => `j${i}`)
  const out = eventDayPlayers([ev('2026-11-15', ['demain']), ev(TODAY, many)], TODAY)
  assert.equal(PRIORITE_MAX, 300)
  assert.equal(out.length, PRIORITE_MAX)
  assert.ok(!out.includes('demain'))
  assert.deepEqual(eventDayPlayers([ev(TODAY, many)], TODAY, 1, 2), ['j0', 'j1'])
})

t('plan : seulement les tables jamais reçues parmi joueurs, mesures, avis ; rien sans joueur prioritaire', () => {
  const all = new Set<SyncTable>(['players', 'measurements', 'evaluations', 'seen', 'events'])
  assert.deepEqual([...PRIORITE_TABLES], ['players', 'measurements', 'evaluations'])
  assert.deepEqual(planPriorite(all, all, ['p1']), ['players', 'measurements', 'evaluations'])
  assert.deepEqual(planPriorite(all, all, []), [])
  // Appareil déjà servi (aucune table fraîche) : rien de plus que la lecture ordinaire.
  assert.deepEqual(planPriorite(new Set(), all, ['p1']), [])
  // Seules les mesures sont à relire depuis le début : seulement elles.
  assert.deepEqual(planPriorite(new Set<SyncTable>(['measurements']), all, ['p1']), ['measurements'])
  // Table fraîche mais pas à relire (pas lue par ce compte) : non.
  assert.deepEqual(planPriorite(all, new Set<SyncTable>(['players']), ['p1']), ['players'])
})

t('ordre de lecture : les événements avant les joueurs (ils disent qui passe en premier)', () => {
  const at = (x: string) => PULL_ORDER.indexOf(x as never)
  assert.ok(at('events') < at('players'))
  assert.deepEqual(PULL_ORDER.slice(at('players'), at('players') + 4), ['players', 'measurements', 'evaluations', 'seen'])
  assert.ok(at('teams') < at('groups') && at('groups') < at('rewatch'))
})

t('ordre « événements du jour d’abord » : simulation de la première synchronisation', () => {
  // Serveur fictif : 2 500 joueurs triés par heure serveur ; ceux de l'événement du jour sont parmi les derniers.
  const players = Array.from({ length: 2500 }, (_, i) => ({ id: `j${String(i).padStart(4, '0')}`, at: i }))
  const ids = eventDayPlayers([ev(TODAY, ['j2400', 'j2499', 'j0007'])], TODAY)
  const applied: string[] = []
  // pullPriority : par identifiant, sans curseur ; puis la lecture ordinaire, par pages de 1 000, qui pose le curseur.
  for (const p of players.filter((x) => ids.includes(x.id))) applied.push(p.id)
  const firstPriority = applied.length
  let cursor = -1
  for (let page = 0; page * 1000 < players.length; page++) {
    const rows = players.filter((x) => x.at > cursor).slice(0, 1000)
    for (const r of rows) if (!applied.includes(r.id)) applied.push(r.id)
    cursor = rows[rows.length - 1].at
  }
  // Les 3 joueurs du jour arrivent en premier ; tous les joueurs arrivent ; le curseur est au bout.
  assert.deepEqual(applied.slice(0, firstPriority).sort(), ['j0007', 'j2400', 'j2499'])
  assert.equal(new Set(applied).size, players.length)
  assert.equal(cursor, 2499)
})

t('câblage : lecture prioritaire avant les joueurs, premier chargement seulement, sans toucher au curseur', () => {
  const sync = readFileSync(new URL('../src/sync.ts', import.meta.url), 'utf8')
  const loop = sync.slice(sync.indexOf('for (const table of PULL_ORDER) {'))
  const prio = loop.indexOf("if (table === 'players' && !scope && PRIORITE_TABLES.some(")
  assert.ok(prio > 0 && prio < loop.indexOf('await pullTable(table, uid, per, first)'), 'avant la lecture ordinaire')
  assert.ok(sync.includes('eventDayPlayers(await db.events.toArray(), today())'))
  const body = sync.slice(sync.indexOf('async function pullPriority('), sync.indexOf('async function forgetOtherAssignments('))
  assert.ok(body.length > 0)
  assert.ok(!body.includes('setItem(PULL_KEY'), 'la lecture prioritaire n’avance jamais le curseur')
  assert.ok(body.includes("table === 'players' ? 'id' : 'data->>playerId'"), 'index existants (046), pas de SQL nouveau')
  assert.ok(body.includes('markPlayersReady()'), 'l’appli s’ouvre sur les joueurs du jour')
})

t('vérification des lignes visibles : plus pendant l’ouverture, étalée, pas avant une heure après la dernière', () => {
  const now = 10_000_000_000
  const [min, max] = CHARGE_REGLES.verifVisiblesEtalementMs
  assert.equal(premiereVerifVisibles(now, null, () => 0), now + min)
  assert.equal(premiereVerifVisibles(now, null, () => 0.999999), now + max - 1)
  // Faite la veille : 30 s à 3 min après le lancement.
  assert.equal(premiereVerifVisibles(now, now - 14 * 3600_000, () => 0.5), now + min + Math.floor(0.5 * (max - min)))
  // Faite il y a 20 min (lancement précédent) : pas avant 40 min.
  assert.equal(premiereVerifVisibles(now, now - 20 * 60_000, () => 0), now + 40 * 60_000)
  // Heure gardée dans le futur (horloge changée) ou illisible : ignorée.
  assert.equal(premiereVerifVisibles(now, now + 3600_000, () => 0), now + min)
  assert.equal(premiereVerifVisibles(now, Number.NaN, () => 0), now + min)
  // Ensuite : 10, 30, 60 min selon le niveau.
  assert.equal(prochaineVerifVisibles(now, 'calme'), now + 10 * 60_000)
  assert.equal(prochaineVerifVisibles(now, 'charge'), now + 30 * 60_000)
  assert.equal(prochaineVerifVisibles(now, 'sature'), now + 60 * 60_000)
  const sync = readFileSync(new URL('../src/sync.ts', import.meta.url), 'utf8')
  // (Registre de 061 : même vérification, reprise et rythme d'un jour : tools/test-registre.ts.)
  assert.ok(sync.includes('nextForgetAt ??= premiereVerifVisibles(Date.now(), kept > 0 ? kept : null, Math.random, regles)'))
  assert.ok(sync.includes(': prochaineVerifVisibles(Date.now(), charge.niveau())'))
  assert.ok(sync.includes('store.set(FORGET_KEY, String(Date.now()))'))
  assert.ok(!sync.includes('lastForget'), 'plus de vérification d’office à chaque lancement')
})

console.log(`${n} tests OK`)
