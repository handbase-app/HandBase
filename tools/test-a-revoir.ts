// Test de la section « À revoir » (src/rewatchCore.ts) : origine d'un « à revoir » (OÙ : nettoyage, adresse de l'écran,
// événement ou groupe de la ligne, liste Joueurs et son filtre, jamais de nom cherché), ligne en clair (QUI, QUAND, OÙ),
// filtre « À revoir » de la liste Joueurs (par qui, repérés à, quand, état ; relecture d'une phrase rendue par le modèle,
// pastille, exécution par la recette), rangement en cartes (par date, événement, personne, origine ; « Sans origine » à
// la fin), et accord avec le script serveur supabase/055_a_revoir_origine.sql. Données fictives seulement.
//
//   npx jiti tools/test-a-revoir.ts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  anyMatches,
  cleanOrigin,
  cleanWanted,
  dateBucket,
  factMatches,
  groupRewatch,
  listOrigin,
  ORIGIN_KINDS,
  originFromPath,
  originGroup,
  originOf,
  originText,
  pickOrigin,
  readWanted,
  rewatchLine,
  wantedText,
  whenLabel,
  whenRange,
  whenText,
  type RankedRow,
  type RewatchFact,
  type RewatchLike,
} from '../src/rewatchCore'
import { buildIndex, cleanRecipe, interpretRecipe, recipeChips, removeChip, runRecipe, type Names, type QPlayer, type QuestionContext } from '../src/recipe'
import { activeKeys, keysForModel, keysOfWord, isNameQuery, listRecipe, mergeQuery, EMPTY_QUERY } from '../src/playerQuery'

const TODAY = '2026-10-25' // un dimanche
const names = { event: (id: string) => ({ esp: 'Tournoi de l’Espenon', stage: 'Stage de Toussaint' })[id], group: (id: string) => ({ g1: 'Repérés en tournoi' })[id] }

// ---------- 1. Origine : nettoyage (mêmes règles que hb_rewatch_origin) ----------
{
  assert.deepEqual(cleanOrigin({ kind: 'list', label: '  Féminin · nées en 2011 ', saved: false, x: 1 }), { kind: 'list', label: 'Féminin · nées en 2011' })
  assert.deepEqual(cleanOrigin({ kind: 'event', id: 'esp', label: 'a\u0001b' }), { kind: 'event', id: 'esp', label: 'a b' })
  assert.equal(cleanOrigin({ kind: 'inconnu' }), undefined)
  assert.equal(cleanOrigin(null), undefined)
  assert.equal(cleanOrigin([{ kind: 'list' }]), undefined)
  assert.deepEqual(cleanOrigin({ kind: 'group', id: 5 }), { kind: 'group' }, 'identifiant non textuel : écarté')
  assert.deepEqual(cleanOrigin({ kind: 'list', saved: true }), { kind: 'list' }, 'saved sans nom : écarté')
  assert.equal(cleanOrigin({ kind: 'list', label: 'x'.repeat(300) })!.label!.length, 120)
  assert.equal(cleanOrigin({ kind: 'event', id: 'x'.repeat(121) })!.id, undefined)
}

// ---------- 2. Origine : d'après l'écran, l'événement ou le groupe de la ligne ----------
{
  assert.deepEqual(originFromPath('/'), { kind: 'home' })
  assert.deepEqual(originFromPath('/joueurs'), { kind: 'list' })
  assert.deepEqual(originFromPath('/joueurs/p1?onglet=croissance'), { kind: 'player' })
  assert.deepEqual(originFromPath('/evenements/esp'), { kind: 'event', id: 'esp' })
  assert.deepEqual(originFromPath('/evenements/esp/joueurs/p1'), { kind: 'event', id: 'esp' }, 'fiche ouverte depuis l’événement')
  assert.deepEqual(originFromPath('/groupes/g1/joueurs/p1'), { kind: 'group', id: 'g1' })
  assert.deepEqual(originFromPath('/groupes/nouveau'), { kind: 'other' })
  assert.deepEqual(originFromPath('/bilan'), { kind: 'bilan' })
  assert.deepEqual(originFromPath('/bilan/joueurs/p1'), { kind: 'bilan' })
  assert.deepEqual(originFromPath('/bilan/question?r=x'), { kind: 'question' })
  assert.deepEqual(originFromPath('/suivis'), { kind: 'follows' })
  assert.deepEqual(originFromPath('/a-revoir/joueurs/p1'), { kind: 'rewatch' })
  assert.deepEqual(originFromPath('/comparer'), { kind: 'other' })
  // L'événement ou le groupe de la ligne passe avant l'écran.
  assert.deepEqual(pickOrigin({ originEventId: 'esp' }, { kind: 'list', label: 'Var' }), { kind: 'event', id: 'esp' })
  assert.deepEqual(pickOrigin({ groupId: 'g1' }, { kind: 'list' }), { kind: 'group', id: 'g1' })
  assert.deepEqual(pickOrigin({}, { kind: 'list', label: 'Var' }), { kind: 'list', label: 'Var' })
  assert.equal(pickOrigin({}, undefined), undefined)
  // Liste Joueurs : le filtre enregistré, sinon les filtres posés (coupés proprement).
  assert.deepEqual(listOrigin(['Féminin', 'nées en 2011'], 'Mes gardiennes'), { kind: 'list', label: 'Mes gardiennes', saved: true })
  assert.deepEqual(listOrigin(['Féminin', 'nées en 2011', 'Var (83)']), { kind: 'list', label: 'Féminin · nées en 2011 · Var (83)' })
  assert.deepEqual(listOrigin([]), { kind: 'list' })
  const long = listOrigin(Array.from({ length: 30 }, (_, i) => `filtre numéro ${i}`))
  assert.ok(long.label!.length <= 120 && long.label!.endsWith('…'), long.label)
}

// ---------- 3. Ligne en clair : qui, quand, d'où ----------
{
  const at = new Date(2026, 9, 12, 15, 40).toISOString()
  const now = new Date(2026, 9, 25, 10, 0)
  assert.equal(whenText(at, now), 'le 12/10 à 15 h 40')
  assert.equal(whenText(new Date(2025, 2, 3, 9, 5).toISOString(), now), 'le 03/03/2025 à 9 h 05')
  const base: RewatchLike = { playerId: 'p1', createdBy: 'u2', createdByName: 'Sophie Fictive', createdAtServer: at, updatedAt: 0 }
  assert.equal(rewatchLine({ ...base, origin: { kind: 'event', id: 'esp' } }, false, names, now), 'Mis par Sophie Fictive, le 12/10 à 15 h 40, depuis l’événement « Tournoi de l’Espenon »')
  assert.equal(rewatchLine({ ...base, origin: { kind: 'list', label: 'Féminin · nées en 2011' } }, true, names, now), 'Mis par toi, le 12/10 à 15 h 40, depuis la liste Joueurs (Féminin · nées en 2011)')
  assert.equal(rewatchLine({ ...base, origin: { kind: 'list', label: 'Mes gardiennes', saved: true } }, false, names, now), 'Mis par Sophie Fictive, le 12/10 à 15 h 40, depuis la liste Joueurs, filtre « Mes gardiennes »')
  assert.equal(rewatchLine({ ...base, origin: { kind: 'group', id: 'g1' } }, false, names, now).endsWith('depuis le groupe « Repérés en tournoi »'), true)
  assert.equal(rewatchLine({ ...base, origin: { kind: 'player' } }, false, names, now).endsWith('depuis sa fiche'), true)
  // Ligne d'avant 055 : l'événement où il a été repéré, sinon pas de « depuis ».
  assert.equal(rewatchLine({ ...base, originEventId: 'esp' }, false, names, now).endsWith('depuis l’événement « Tournoi de l’Espenon »'), true)
  assert.equal(rewatchLine(base, false, names, now), 'Mis par Sophie Fictive, le 12/10 à 15 h 40')
  assert.equal(rewatchLine({ ...base, createdByName: undefined, origin: { kind: 'other' } }, false, names, now), 'Mis par un membre du staff, le 12/10 à 15 h 40')
  // Pas encore envoyé : l'heure de l'appareil.
  assert.ok(rewatchLine({ playerId: 'p1', updatedAt: new Date(2026, 9, 24, 8, 3).getTime() }, true, names, now).startsWith('Mis par toi, le 24/10 à 8 h 03'))
  assert.equal(originText({ kind: 'event', id: 'inconnu' }, names), 'un événement')
  assert.equal(originText(undefined, names), undefined)
  assert.deepEqual(originOf({ originEventId: 'esp', origin: { kind: 'list' } }), { kind: 'list' }, 'origin passe avant originEventId')
  // Regroupement par origine.
  assert.deepEqual(originGroup({ origin: { kind: 'list', label: 'Var' } }, names), { key: 'list::Var', title: 'Liste Joueurs · Var' })
  assert.deepEqual(originGroup({ origin: { kind: 'list', label: 'Mes gardiennes', saved: true } }, names), { key: 'list:s:Mes gardiennes', title: 'Filtre « Mes gardiennes »' })
  assert.deepEqual(originGroup({ originEventId: 'esp' }, names), { key: 'event:esp', title: 'Tournoi de l’Espenon' })
  assert.deepEqual(originGroup({ origin: { kind: 'player' } }, names), { key: 'player', title: 'Depuis une fiche' })
  assert.deepEqual(originGroup({}, names), { key: 'none', title: 'Sans origine' })
}

// ---------- 4. Filtre « À revoir » ----------
{
  const f = (x: Partial<RewatchFact>): RewatchFact => ({ mine: false, staff: true, day: '2026-10-10', done: false, ...x })
  // Moments.
  assert.deepEqual(whenRange({ kind: 'month' }, TODAY), { from: '2026-10-01', to: '2026-10-31' })
  assert.deepEqual(whenRange({ kind: 'lastMonth' }, TODAY), { from: '2026-09-01', to: '2026-09-30' })
  assert.deepEqual(whenRange({ kind: 'lastMonth' }, '2026-01-15'), { from: '2025-12-01', to: '2025-12-31' })
  assert.deepEqual(whenRange({ kind: 'lastMonth' }, '2026-03-10'), { from: '2026-02-01', to: '2026-02-28' })
  assert.deepEqual(whenRange({ kind: 'season' }, TODAY), { from: '2026-09-01', to: '2027-08-31', label: '2026-2027' })
  assert.deepEqual(whenRange({ kind: 'between', from: '2026-10-01' }, TODAY), { from: '2026-10-01', to: '9999-12-31' })
  // Par qui : défaut = mon staff (moi compris) ; moi ; tous les staffs (administrateur).
  assert.ok(factMatches(f({}), {}, TODAY))
  assert.ok(!factMatches(f({ staff: false }), {}, TODAY), 'autre staff : seulement « tous les staffs »')
  assert.ok(factMatches(f({ staff: false }), { by: 'all' }, TODAY))
  assert.ok(factMatches(f({ mine: true, staff: false }), {}, TODAY), 'le mien compte toujours')
  assert.ok(!factMatches(f({}), { by: 'me' }, TODAY))
  assert.ok(factMatches(f({ mine: true }), { by: 'me' }, TODAY))
  // Repérés à, quand, état.
  assert.ok(factMatches(f({ origin: 'esp' }), { from: ['esp', 'stage'] }, TODAY))
  assert.ok(!factMatches(f({}), { from: ['esp'] }, TODAY))
  assert.ok(factMatches(f({ day: '2026-09-30' }), { when: { kind: 'lastMonth' } }, TODAY))
  assert.ok(!factMatches(f({ day: '2026-10-01' }), { when: { kind: 'lastMonth' } }, TODAY))
  assert.ok(factMatches(f({ day: '2026-10-05' }), { when: { kind: 'between', from: '2026-10-05', to: '2026-10-05' } }, TODAY), 'bornes comprises')
  assert.ok(!factMatches(f({ day: '' }), { when: { kind: 'season' } }, TODAY))
  assert.ok(factMatches(f({ done: true }), { state: 'done' }, TODAY))
  assert.ok(!factMatches(f({ done: true }), { state: 'open' }, TODAY))
  // Un joueur passe si UN de ses « à revoir » remplit TOUT le filtre.
  assert.ok(!anyMatches([f({ mine: true, done: true }), f({ origin: 'esp' })], { by: 'me', from: ['esp'] }, TODAY))
  assert.ok(anyMatches([f({ mine: true, done: true }), f({ mine: true, origin: 'esp' })], { by: 'me', from: ['esp'] }, TODAY))
  assert.ok(!anyMatches(undefined, {}, TODAY))
  // Relecture (adresse, session) : rien n'y est cru.
  assert.deepEqual(cleanWanted(true), {})
  assert.deepEqual(cleanWanted({ by: 'staff', from: ['esp', 'esp', 3], when: { kind: 'between', from: '2026-10-20', to: '2026-10-01' }, state: 'x' }), {
    from: ['esp'],
    when: { kind: 'between', from: '2026-10-01', to: '2026-10-20' },
  })
  assert.deepEqual(cleanWanted({ when: { kind: 'between' } }), {}, 'entre deux dates sans date : rien')
  assert.equal(cleanWanted('oui'), undefined)
  // Pastille, accordée (jamais de libellé négatif).
  const ev = (id: string) => names.event(id) ?? 'événement'
  assert.equal(wantedText({}, ev), 'à revoir')
  assert.equal(wantedText({ by: 'me', when: { kind: 'lastMonth' } }, ev), 'mes à revoir · mis à revoir le mois dernier')
  assert.equal(wantedText({ from: ['esp'], state: 'open' }, ev, true), 'à revoir · repérées à Tournoi de l’Espenon · pas encore revues')
  assert.equal(wantedText({ by: 'all', state: 'done' }, ev), 'à revoir · tous les staffs · revus')
  assert.equal(whenLabel({ kind: 'between', from: '2026-10-01', to: '2026-10-20' }), 'du 01/10/2026 au 20/10/2026')
}

// ---------- 5. Phrase rendue par le modèle (aRevoir) ----------
{
  const notes: string[] = []
  const skip = (what: string, why: string) => notes.push(`${what} (${why})`)
  const find = (s: string) => (/espenon/i.test(s) ? 'esp' : undefined)
  assert.deepEqual(readWanted(true, find, skip), {})
  assert.deepEqual(readWanted({ par: 'moi', periode: 'mois_dernier' }, find, skip), { by: 'me', when: { kind: 'lastMonth' } })
  assert.deepEqual(readWanted({ par: 'staff', evenements: ['tournoi de l’Espenon'], etat: 'a_revoir' }, find, skip), { from: ['esp'], state: 'open' })
  assert.deepEqual(readWanted({ periode: { du: '2026-10-01', au: '2026-10-15' }, etat: 'revu' }, find, skip), { when: { kind: 'between', from: '2026-10-01', to: '2026-10-15' }, state: 'done' })
  assert.deepEqual(readWanted({ periode: 'cette saison', par: 'tous' }, find, skip), { by: 'all', when: { kind: 'season' } })
  assert.deepEqual(notes, [])
  assert.deepEqual(readWanted({ evenements: ['Tournoi de Cannes'], periode: 'demain' }, find, skip), {})
  assert.equal(notes.length, 2, notes.join(' ; '))
  assert.equal(readWanted(undefined, find, skip), undefined)
}

// ---------- 6. Dans la recette : relecture, pastille, exécution, fusion, mots ----------
{
  type P = QPlayer
  const players: P[] = [
    { id: 'a', firstName: 'Léo', lastName: 'Fictif', sex: 'M', birthDate: '2011-03-01' },
    { id: 'b', firstName: 'Lina', lastName: 'Exemple', sex: 'F', birthDate: '2011-05-01' },
    { id: 'c', firstName: 'Noé', lastName: 'Imaginaire', sex: 'M', birthDate: '2010-01-01' },
  ]
  const rewatch = new Map<string, RewatchFact[]>([
    ['a', [{ mine: true, staff: true, day: '2026-09-12', origin: 'esp', done: false }]],
    ['b', [{ mine: false, staff: true, day: '2026-10-20', done: true }]],
  ])
  const ix = buildIndex({ players, sights: [], evals: [], measures: [], criteria: [], groups: [], events: [{ id: 'esp', date: '2026-09-12' }], deptOf: () => undefined, regionOf: () => undefined, today: TODAY, rewatch })
  const ids = (r: unknown) => runRecipe(ix, { ...cleanRecipe(r), out: { type: 'count' } }).match.map((p) => p.id)
  assert.deepEqual(ids({ pop: { rewatch: {} } }), ['a', 'b'])
  assert.deepEqual(ids({ pop: { rewatch: { by: 'me', when: { kind: 'lastMonth' } } } }), ['a'])
  assert.deepEqual(ids({ pop: { rewatch: { state: 'open' } } }), ['a'])
  assert.deepEqual(ids({ pop: { rewatch: { state: 'done' }, sex: 'F' } }), ['b'])
  assert.deepEqual(ids({ pop: { rewatch: { from: ['esp'] } } }), ['a'])
  assert.deepEqual(ids({ pop: { rewatch: { when: { kind: 'month' } } } }), ['b'])
  // Pastille et retrait.
  const n: Names = {
    region: (x) => x, dept: (x) => x, club: (x) => x, group: (x) => x, event: (id) => names.event(id) ?? 'événement', criterion: (x) => x, position: (x) => x, today: TODAY,
  }
  const r = cleanRecipe({ pop: { sex: 'F', rewatch: { state: 'open' } } })
  assert.equal(recipeChips(r, n).find((c) => c.key === 'rewatch')?.label, 'à revoir · pas encore revues')
  assert.equal(removeChip(r, 'rewatch').pop.rewatch, undefined)
  // Phrase : « mes à revoir du mois dernier », « repérés au tournoi de l'Espenon » (événement retrouvé sur l'appareil).
  const ctx: QuestionContext = { regions: [], depts: [], positions: [], clubs: [], groups: [], events: [{ id: 'esp', name: 'Tournoi de l’Espenon', date: '2026-09-12' }], criteria: [], today: TODAY }
  const it = interpretRecipe({ population: { aRevoir: { par: 'moi', periode: 'mois_dernier', evenements: ['tournoi de l’Espenon'] } } }, [], ctx)
  assert.deepEqual(it.recipe.pop, { rewatch: { by: 'me', from: ['esp'], when: { kind: 'lastMonth' } } })
  assert.deepEqual(it.notes, [])
  assert.deepEqual(interpretRecipe({ population: { aRevoir: true } }, [], ctx).recipe.pop, { rewatch: {} })
  // Fusion avec la liste : la phrase remplace le filtre « À revoir » d'avant.
  const cur = { recipe: listRecipe(cleanRecipe({ pop: { sex: 'M', rewatch: { state: 'open' } } })), q: '' }
  assert.deepEqual(mergeQuery(cur, it.recipe, 'ajouter').recipe.pop, { sex: 'M', rewatch: { by: 'me', from: ['esp'], when: { kind: 'lastMonth' } } })
  // Ce qui part au modèle : le NOM du filtre seulement ; relu dans « retirer ».
  assert.deepEqual(keysForModel(cur), ['sexe', 'aRevoir'])
  assert.deepEqual(activeKeys(cur), ['sex', 'rewatch'])
  assert.deepEqual(keysOfWord('aRevoir'), ['rewatch'])
  assert.deepEqual(keysOfWord('les à revoir'), ['rewatch'])
  assert.deepEqual(EMPTY_QUERY.recipe.pop, {})
  // « mes à revoir » est une phrase, pas un nom cherché.
  assert.equal(isNameQuery('mes à revoir'), false)
  assert.equal(isNameQuery('Martin'), true)
}

// ---------- 7. Rangement en cartes ----------
{
  const row = (id: string, playerId: string, day: string, x: Partial<RewatchLike> = {}, fact: Partial<RewatchFact> = {}): RankedRow<RewatchLike> => {
    const at = Date.parse(`${day}T10:00:00Z`)
    return { r: { id, playerId, createdAtServer: new Date(at).toISOString(), updatedAt: at, ...x }, fact: { mine: false, staff: true, day, done: false, ...fact }, at }
  }
  // Dates : aujourd'hui (dimanche 25/10), hier, plus tôt cette semaine (depuis lundi 19), semaine dernière, ce mois, le mois dernier, un mois.
  assert.equal(dateBucket('2026-10-25', TODAY).title, 'Aujourd’hui')
  assert.equal(dateBucket('2026-10-24', TODAY).title, 'Hier')
  assert.equal(dateBucket('2026-10-19', TODAY).title, 'Plus tôt cette semaine')
  assert.equal(dateBucket('2026-10-18', TODAY).title, 'La semaine dernière')
  assert.equal(dateBucket('2026-10-12', TODAY).title, 'La semaine dernière')
  assert.equal(dateBucket('2026-10-11', TODAY).title, 'Plus tôt ce mois-ci')
  assert.equal(dateBucket('2026-09-15', TODAY).title, 'Le mois dernier')
  assert.equal(dateBucket('2026-07-03', TODAY).title, 'Juillet 2026')
  assert.ok(dateBucket('2026-07-03', TODAY).rank < dateBucket('2026-03-03', TODAY).rank)
  // Lundi : « hier » (dimanche) n'est pas « cette semaine ».
  assert.equal(dateBucket('2026-10-25', '2026-10-26').title, 'Hier')
  assert.equal(dateBucket('2026-10-19', '2026-10-26').title, 'La semaine dernière')

  const rows = [
    row('r1', 'p1', '2026-10-25', { createdBy: 'u1', createdByName: 'Sophie', origin: { kind: 'event', id: 'esp' } }),
    row('r2', 'p2', '2026-10-24', { origin: { kind: 'list', label: 'Var' } }, { mine: true }),
    row('r3', 'p1', '2026-09-15', { createdBy: 'u2', createdByName: 'Alex', originEventId: 'stage' }),
    row('r4', 'p3', '2026-07-03', { createdBy: 'u1', createdByName: 'Sophie' }),
    row('r5', 'p2', '2026-10-25', { createdBy: 'u2', createdByName: 'Alex', origin: { kind: 'group', id: 'g1' } }),
  ]
  const ctx = { names, today: TODAY, eventDate: (id: string) => ({ esp: '2026-10-22', stage: '2026-09-10' })[id] }
  const byDate = groupRewatch(rows, 'date', ctx)
  assert.deepEqual(byDate.map((c) => c.title), ['Aujourd’hui', 'Hier', 'Le mois dernier', 'Juillet 2026'])
  assert.deepEqual(byDate[0].players.map((x) => x.playerId), ['p1', 'p2'])
  const byEvent = groupRewatch(rows, 'event', ctx)
  assert.deepEqual(byEvent.map((c) => c.title), ['Tournoi de l’Espenon', 'Stage de Toussaint', 'Hors événement'])
  assert.deepEqual(byEvent[2].players.map((x) => x.playerId), ['p2', 'p3'], 'le plus récent d’abord')
  const byPerson = groupRewatch(rows, 'person', ctx)
  assert.deepEqual(byPerson.map((c) => c.title), ['Toi', 'Alex', 'Sophie'])
  const byOrigin = groupRewatch(rows, 'origin', ctx)
  assert.equal(byOrigin[byOrigin.length - 1].title, 'Sans origine', '« Sans origine » à la fin')
  assert.deepEqual(byOrigin[byOrigin.length - 1].players.map((x) => x.playerId), ['p3'])
  assert.ok(byOrigin.some((c) => c.title === 'Stage de Toussaint'), 'ligne d’avant : l’événement d’origine')
  assert.ok(byOrigin.some((c) => c.title === 'Groupe « Repérés en tournoi »'))
  // Un joueur avec deux « à revoir » dans la même carte : une seule ligne, les deux dedans (le plus récent d'abord).
  const two = groupRewatch([rows[1], rows[4]], 'date', ctx)
  assert.deepEqual(two.map((c) => [c.title, c.players.map((x) => [x.playerId, x.rows.map((y) => y.r.id)])]), [
    ['Aujourd’hui', [['p2', ['r5']]]],
    ['Hier', [['p2', ['r2']]]],
  ])
}

// ---------- 8. Accord avec le serveur (supabase/055) ----------
{
  const sql = readFileSync(new URL('../supabase/055_a_revoir_origine.sql', import.meta.url), 'utf8')
  const kinds = /not in \(([^)]*)\)/.exec(sql.slice(sql.indexOf('hb_rewatch_origin(p jsonb)')))![1].match(/'([a-z]+)'/g)!.map((x) => x.slice(1, -1))
  assert.deepEqual(kinds, [...ORIGIN_KINDS], 'mêmes sortes d’origine que l’appli')
  assert.ok(sql.includes(`'origin', case when v_existing is not null then v_existing -> 'origin' else public.hb_rewatch_origin(v_data -> 'origin') end`), 'origine fixée à la création')
  // Reprise exacte de la dernière hb_upsert (054), seule la ligne de l'origine en plus.
  const fn = (s: string) => s.slice(s.indexOf('create or replace function public.hb_upsert'), s.indexOf('end $$;', s.indexOf('create or replace function public.hb_upsert')))
  const prev = fn(readFileSync(new URL('../supabase/054_questions_enregistrees.sql', import.meta.url), 'utf8'))
  const next = fn(sql)
  const strip = (s: string) => s.split('\n').filter((l) => !/055|hb_rewatch_origin/.test(l)).join('\n').trim()
  assert.equal(strip(next), prev.trim(), 'hb_upsert : 054 + la ligne origin')
}

console.log('test-a-revoir : OK')
