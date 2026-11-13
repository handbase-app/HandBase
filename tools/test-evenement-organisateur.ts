// Test de l'unité organisatrice d'un événement (src/eventOrganizer.ts, même règle que supabase/048_evenements_organisateur.sql) :
// unité proposée d'office (une unité, plusieurs, administrateur, feuille de match, aucune), unités proposées, territoire d'une
// unité, filtre « Mes territoires » (la Ligue voit ceux de ses comités, pas l'inverse ; créateur, participant, sans
// organisateur ; un de mes joueurs inscrit). Données fictives seulement.
//
//   npx jiti tools/test-evenement-organisateur.ts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  DEFAULT_TERRITORY_FILTER,
  defaultOrganizer,
  inMyTerritories,
  lowestFirst,
  organizerChoices,
  myPlayersIn,
  organizerLabel,
  seenThroughMyPlayers,
  unitTerritory,
  type TerritoryPlayer,
} from '../src/eventOrganizer'
import { perimeterOf } from '../src/perimeter'
import type { AssignmentRow, LevelRow, UnitRow } from '../src/structureTree'

let n = 0
const t = (name: string, f: () => void) => {
  f()
  n++
  console.log(`ok ${n} - ${name}`)
}

// ---------- Arbre fictif ----------

const levels: LevelRow[] = [
  { id: 'niveau-federation', name: 'Fédération', order: 1 },
  { id: 'niveau-ligue', name: 'Ligue', order: 2 },
  { id: 'niveau-comite', name: 'Comité', order: 3 },
  { id: 'niveau-pole', name: 'Pôle', order: 4 },
  { id: 'niveau-club', name: 'Club', order: 5 },
]
const units: UnitRow[] = [
  { id: 'fed', levelId: 'niveau-federation', name: 'Fédération fictive' },
  { id: 'sud', levelId: 'niveau-ligue', name: 'Ligue Sud fictive', parentId: 'fed' },
  { id: 'c83', levelId: 'niveau-comite', name: 'Comité du Var', parentId: 'sud', departments: ['83'] },
  { id: 'c13', levelId: 'niveau-comite', name: 'Comité 13 fictif', parentId: 'sud', departments: ['13'] },
  { id: 'clA', levelId: 'niveau-club', name: 'Club A', parentId: 'c83', clubNumber: '6383001' },
  { id: 'clB', levelId: 'niveau-club', name: 'Club B', parentId: 'c83', clubNumber: '6383002' },
  { id: 'pole', levelId: 'niveau-pole', name: 'Pôle fictif', parentId: 'sud' },
  { id: 'nord', levelId: 'niveau-ligue', name: 'Ligue Nord fictive', parentId: 'fed' },
  { id: 'c59', levelId: 'niveau-comite', name: 'Comité 59 fictif', parentId: 'nord', departments: ['59'] },
  { id: 'old', levelId: 'niveau-comite', name: 'Comité supprimé', parentId: 'sud', departments: ['84'], deleted: true },
  // Boucle (impossible en principe) : le tri doit s'arrêter.
  { id: 'loopA', levelId: 'niveau-comite', name: 'Boucle A', parentId: 'loopB' },
  { id: 'loopB', levelId: 'niveau-comite', name: 'Boucle B', parentId: 'loopA' },
]
const as = (userId: string, ...unitIds: string[]): AssignmentRow[] => unitIds.map((unitId, i) => ({ id: `${userId}-${i}`, userId, unitId, role: 'preparateur' }))
const input = (assignments: AssignmentRow[]) => ({ units, levels, assignments })

// ---------- Unité proposée d'office ----------

t('une seule unité : choisie d’office', () => {
  assert.equal(defaultOrganizer({ ...input(as('u', 'c83')), userId: 'u' }), 'c83')
  assert.equal(defaultOrganizer({ ...input(as('u', 'pole')), userId: 'u' }), 'pole')
})
t('plusieurs unités : la plus proche du terrain (profondeur, puis niveau)', () => {
  assert.equal(defaultOrganizer({ ...input(as('u', 'sud', 'c83')), userId: 'u' }), 'c83')
  assert.equal(defaultOrganizer({ ...input(as('u', 'c83', 'sud', 'fed')), userId: 'u' }), 'c83')
  assert.equal(defaultOrganizer({ ...input(as('u', 'clA', 'c83')), userId: 'u' }), 'clA')
  // Même profondeur (sous la ligue) : le niveau le plus bas (Pôle après Comité).
  assert.equal(defaultOrganizer({ ...input(as('u', 'c13', 'pole')), userId: 'u' }), 'pole')
  // Même profondeur, même niveau : par nom.
  assert.equal(defaultOrganizer({ ...input(as('u', 'c83', 'c13')), userId: 'u' }), 'c13')
})
t('administrateur : son unité s’il est affecté, sinon rien', () => {
  assert.equal(defaultOrganizer({ ...input([]), userId: 'admin' }), undefined)
  assert.equal(defaultOrganizer({ ...input(as('admin', 'sud')), userId: 'admin' }), 'sud')
})
t('aucune affectation (ou affectations et unités supprimées) : rien, champ vide', () => {
  assert.equal(defaultOrganizer({ ...input([]), userId: 'u' }), undefined)
  assert.equal(defaultOrganizer({ ...input(as('u', 'old')), userId: 'u' }), undefined)
  assert.equal(defaultOrganizer({ ...input([{ id: 'x', userId: 'u', unitId: 'c83', role: 'preparateur', deleted: true }]), userId: 'u' }), undefined)
  assert.equal(defaultOrganizer({ ...input(as('autre', 'c83')), userId: 'u' }), undefined)
  assert.equal(defaultOrganizer({ ...input(as('u', 'c83')), userId: null }), undefined)
})
t('feuille de match : même défaut (l’unité du créateur), les clubs de la feuille n’y entrent pas', () => {
  // Encadrant du Var qui observe un match entre deux clubs d'ailleurs, dont l'un existe dans la structure : le Var.
  assert.equal(defaultOrganizer({ ...input(as('u', 'c83')), userId: 'u' }), 'c83')
  // Le code : le formulaire de la feuille pose le même champ, sans rien lire des clubs de la feuille.
  const src = readFileSync(new URL('../src/components/MatchSheet.tsx', import.meta.url), 'utf8')
  assert.ok(src.includes('<OrganizerField value={organizer} onChange={setOrganizer} auto />'))
  assert.ok(!/homeClub[^\n]*organi|organi[^\n]*homeClub/i.test(src))
  assert.equal(defaultOrganizer.length, 1)
})

// ---------- Unités proposées ----------

t('compte non administrateur : ses unités seulement, la plus basse en tête', () => {
  const ids = organizerChoices({ ...input(as('u', 'sud', 'c83')), userId: 'u', admin: false }).map((u) => u.id)
  assert.deepEqual(ids, ['c83', 'sud'])
})
t('modification : l’unité déjà choisie reste proposée, même hors de ses unités', () => {
  const ids = organizerChoices({ ...input(as('u', 'c83')), userId: 'u', admin: false, current: 'c59' }).map((u) => u.id)
  assert.deepEqual(ids, ['c59', 'c83'])
  // Unité supprimée depuis : pas proposée (le champ la garde telle quelle).
  assert.deepEqual(organizerChoices({ ...input(as('u', 'c83')), userId: 'u', admin: false, current: 'old' }).map((u) => u.id), ['c83'])
})
t('sans affectation : aucune unité proposée', () => {
  assert.deepEqual(organizerChoices({ ...input([]), userId: 'u', admin: false }), [])
})
t('administrateur : toutes les unités (non supprimées)', () => {
  const ids = organizerChoices({ ...input([]), userId: 'admin', admin: true }).map((u) => u.id)
  assert.equal(ids.length, units.filter((u) => !u.deleted).length)
  assert.ok(!ids.includes('old'))
  assert.equal(ids[ids.length - 1], 'fed') // la plus haute en dernier
})
t('tri : une boucle dans l’arbre ne bloque pas', () => {
  const ids = lowestFirst(units.filter((u) => u.id.startsWith('loop')), units, levels).map((u) => u.id)
  assert.deepEqual(ids.sort(), ['loopA', 'loopB'])
})

// ---------- Territoire d'une unité (même calcul que hb_unit_territory) ----------

t('territoire : comité, ligue, club, pôle (celui de sa ligue), fédération', () => {
  assert.deepEqual(unitTerritory(units, 'c83'), { depts: ['83'], clubs: [] })
  assert.deepEqual(unitTerritory(units, 'sud'), { depts: ['13', '83'], clubs: [] })
  assert.deepEqual(unitTerritory(units, 'clA'), { depts: ['83'], clubs: ['6383001'] })
  assert.deepEqual(unitTerritory(units, 'pole'), { depts: ['13', '83'], clubs: [] })
  assert.deepEqual(unitTerritory(units, 'fed'), { depts: ['13', '59', '83'], clubs: [] })
  assert.deepEqual(unitTerritory(units, 'inconnue'), { depts: [], clubs: [] })
})

// ---------- Filtre « Mes territoires » ----------

const ev = (id: string, organizerUnitId?: string, extra: { createdBy?: string; editors?: string[]; teams?: string[] } = {}) => ({ id, organizerUnitId, ...extra })
const EVENTS = [ev('e-sud', 'sud'), ev('e-83', 'c83'), ev('e-13', 'c13'), ev('e-clA', 'clA'), ev('e-clB', 'clB'), ev('e-pole', 'pole'), ev('e-59', 'c59'), ev('e-fed', 'fed'), ev('e-libre')]
const seen = (userId: string, assignments: AssignmentRow[], admin = false, participant = (_: { editors?: string[] }) => false, events = EVENTS) => {
  const per = perimeterOf({ userId, admin, units, levels, assignments })
  const cache = new Map<string, { depts: string[]; clubs: string[] }>()
  return events.filter((e) => inMyTerritories(e, { per, userId, units, participant }, cache)).map((e) => e.id)
}

t('défaut « Tous » tant que 048 n’est pas passé', () => {
  assert.equal(DEFAULT_TERRITORY_FILTER, 'tous')
})
t('ligue : ses comités, pôles et clubs, et les événements sans organisateur ; pas les autres ligues ni la fédération', () => {
  assert.deepEqual(seen('u', as('u', 'sud')), ['e-sud', 'e-83', 'e-13', 'e-clA', 'e-clB', 'e-pole', 'e-libre'])
})
t('comité : les siens et ceux de ses clubs ; PAS ceux de la ligue (ni de son pôle)', () => {
  assert.deepEqual(seen('u', as('u', 'c83')), ['e-83', 'e-clA', 'e-clB', 'e-libre'])
})
t('club : les siens seulement (pas ceux de son comité, ni d’un autre club du département)', () => {
  assert.deepEqual(seen('u', as('u', 'clA')), ['e-clA', 'e-libre'])
})
t('pôle : le territoire de sa ligue, donc comme la ligue', () => {
  assert.deepEqual(seen('u', as('u', 'pole')), seen('v', as('v', 'sud')))
})
t('fédération et administrateur : tout', () => {
  assert.equal(seen('u', as('u', 'fed')).length, EVENTS.length)
  assert.equal(seen('admin', [], true).length, EVENTS.length)
})
t('sans affectation : seulement les événements sans organisateur', () => {
  assert.deepEqual(seen('u', []), ['e-libre'])
})
t('créateur et participant : vus même hors de leurs territoires', () => {
  const mine = [ev('x-cree', 'sud', { createdBy: 'u' }), ev('x-part', 'c59', { editors: ['u'] }), ev('x-staff', 'fed', { teams: ['s1'] }), ev('x-autre', 'sud', { createdBy: 'w' })]
  const part = (e: { editors?: string[]; teams?: string[] }) => !!e.editors?.includes('u') || !!e.teams?.includes('s1')
  assert.deepEqual(seen('u', as('u', 'c83'), false, part, mine), ['x-cree', 'x-part', 'x-staff'])
})
t('unité organisatrice supprimée ou inconnue : comme sans organisateur (le serveur fait de même)', () => {
  assert.deepEqual(seen('u', as('u', 'clA'), false, undefined, [ev('a', 'old'), ev('b', 'inconnue')]), ['a', 'b'])
})

// ---------- Un de mes joueurs inscrit (048, règle (d)) ----------

// Joueurs fictifs : n° de club → département (6383001 → 83), licence, département saisi (fiche sans club).
const PLAYERS: Record<string, TerritoryPlayer> = {
  pA1: { clubCode: '6383001' },
  pA2: { license: '6383001123456' },
  pB: { clubCode: '6383002' },
  p13: { clubCode: '6313005' },
  p59: { clubCode: '6259001' },
  pLibre: { department: '83' },
  pSuppr: { clubCode: '6383001', deleted: true },
}
const evp = (id: string, organizerUnitId: string | undefined, playerIds: string[], extra: { createdBy?: string; editors?: string[] } = {}) => ({
  id,
  organizerUnitId,
  playerIds,
  ...extra,
})
const withPlayers = (userId: string, assignments: AssignmentRow[], events: ReturnType<typeof evp>[]) => {
  const per = perimeterOf({ userId, admin: false, units, levels, assignments })
  const ctx = { per, userId, units, participant: () => false, player: (id: string) => PLAYERS[id] }
  return events.filter((e) => inMyTerritories(e, ctx)).map((e) => e.id)
}

t('club : voit l’événement du comité où sont deux de ses joueurs (et pas celui où il n’en a aucun)', () => {
  const evs = [evp('stage-83', 'c83', ['pA1', 'pA2', 'pB']), evp('stage-83-sans', 'c83', ['pB', 'p13'])]
  assert.deepEqual(withPlayers('u', as('u', 'clA'), evs), ['stage-83'])
})
t('comité : voit le stage de Ligue où sont ses jeunes ; club : le rassemblement fédéral de son joueur', () => {
  const ligue = [evp('stage-ligue', 'sud', ['p13', 'pB']), evp('stage-ligue-13', 'sud', ['p13'])]
  assert.deepEqual(withPlayers('u', as('u', 'c83'), ligue), ['stage-ligue'])
  assert.deepEqual(withPlayers('u', as('u', 'clA'), [evp('edf', 'fed', ['p59', 'pA2'])]), ['edf'])
  // Joueur sans club, département saisi : compte pour le comité, pas pour un club.
  assert.deepEqual(withPlayers('u', as('u', 'c83'), [evp('x', 'sud', ['pLibre'])]), ['x'])
  assert.deepEqual(withPlayers('u', as('u', 'clA'), [evp('x', 'sud', ['pLibre'])]), [])
})
t('aucun joueur à lui (ou joueurs absents de l’appareil) : ne voit pas', () => {
  assert.deepEqual(withPlayers('u', as('u', 'c13'), [evp('a', 'c83', ['pA1', 'pB']), evp('b', 'sud', ['inconnu']), evp('c', 'sud', [])]), [])
  assert.deepEqual(withPlayers('u', [], [evp('a', 'c83', ['pA1'])]), [])
})
t('joueur supprimé : ne compte pas', () => {
  assert.deepEqual(withPlayers('u', as('u', 'clA'), [evp('a', 'c83', ['pSuppr', 'pB'])]), [])
  assert.deepEqual(withPlayers('u', as('u', 'clA'), [evp('a', 'c83', ['pSuppr', 'pA1'])]), ['a'])
})
t('pôle sans territoire : ses joueurs sont ceux de sa ligue (047)', () => {
  assert.deepEqual(withPlayers('u', as('u', 'pole'), [evp('edf', 'fed', ['p13']), evp('edf2', 'fed', ['p59'])]), ['edf'])
})
t('mention « Tu vois cet événement parce que… » : seulement quand rien d’autre ne le montre', () => {
  const per = perimeterOf({ userId: 'u', admin: false, units, levels, assignments: as('u', 'clA') })
  const ctx = { per, userId: 'u', units, participant: (e: { editors?: string[] }) => !!e.editors?.includes('u'), player: (id: string) => PLAYERS[id] }
  assert.equal(seenThroughMyPlayers(evp('a', 'c83', ['pA1', 'pA2', 'pB', 'pA1']), ctx), 2) // doublon compté une fois
  assert.equal(seenThroughMyPlayers(evp('a', 'clA', ['pA1']), ctx), 0) // son club organise
  assert.equal(seenThroughMyPlayers(evp('a', undefined, ['pA1']), ctx), 0) // sans organisateur : visible par tous
  assert.equal(seenThroughMyPlayers(evp('a', 'c83', ['pA1'], { createdBy: 'u' }), ctx), 0)
  assert.equal(seenThroughMyPlayers(evp('a', 'c83', ['pA1'], { editors: ['u'] }), ctx), 0)
  assert.equal(seenThroughMyPlayers(evp('a', 'c83', ['pB']), ctx), 0)
  // Sans fiches (contexte sans « player ») : la règle est ignorée.
  assert.equal(myPlayersIn(evp('a', 'c83', ['pA1']), { per }), 0)
})

// ---------- Affichage ----------

t('nom de l’organisateur : l’unité du moment, à défaut la copie gardée', () => {
  assert.equal(organizerLabel({ organizerUnitId: 'c83', organizerName: 'Ancien nom' }, units), 'Comité du Var')
  assert.equal(organizerLabel({ organizerUnitId: 'inconnue', organizerName: 'Comité fictif' }, units), 'Comité fictif')
  assert.equal(organizerLabel({}, units), undefined)
})

// ---------- Même règle que le serveur ----------

t('048 : règle de lecture, déclencheurs, relançable, contrôle final en lecture seule', () => {
  const sql = readFileSync(new URL('../supabase/048_evenements_organisateur.sql', import.meta.url), 'utf8')
  for (const s of [
    'add column if not exists scope_dept text[]',
    '(select public.hb_scope_all())',
    'scope_dept is null',
    'scope_dept <@ (select public.hb_scope_depts())::text[]',
    'scope_club <@ (select public.hb_scope_clubs())::text[]',
    'players_dept && (select public.hb_scope_depts())::text[]',
    'players_club && (select public.hb_scope_clubs())::text[]',
    'add column if not exists players_dept text[]',
    "using gin ((data -> 'playerIds'))",
    "(ev.data -> 'playerIds') ?| p_ids",
    'and not pl.deleted',
    'perform public.hb_events_players_rescope(null);',
    'create constraint trigger hb_events_players_upd after update on public.hb_players',
    "data ->> 'createdBy' = (select auth.uid())::text",
    'public.hb_is_participant(data)',
    'public.hb_unit_empty(up.id)',
    'deferrable initially deferred',
    'drop policy if exists "staff_read" on public.hb_events',
  ])
    assert.ok(sql.includes(s), s)
  // Aucun « create function » sans « or replace » (relançable).
  assert.ok(!/create function/i.test(sql))
  // Fin : une requête de contrôle (select), pas d'écriture après elle.
  const code = sql.split('\n').filter((l) => !l.trimStart().startsWith('--')).join('\n').trim()
  assert.ok(code.slice(code.lastIndexOf(';', code.length - 2)).includes('pg_policies'))
})

console.log(`\n${n} tests passés`)
