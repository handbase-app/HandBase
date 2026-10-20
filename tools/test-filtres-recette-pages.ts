// Test des listes Événements et Groupes en ÉDITEUR DE RECETTE (src/listQuery.ts, src/eventQuery.ts, src/groupQuery.ts) :
// ÉQUIVALENCE avec les anciens filtres (mêmes événements, mêmes groupes, même ordre, sur un jeu fictif), fusion phrase +
// filtres posés (ajout par défaut, remplacement d'une clé redite, effacement et retrait seulement s'ils sont dits),
// commandes locales sans appel, calculs sur la sélection, détection « simple nom » / phrase, lecture de la recette rendue
// (valeurs revérifiées), ce qui part au modèle (noms des filtres seulement, schéma sans aucun nom), exemples des consignes
// « evenements » et « groupes » de la fonction (chacun relu par l'appli avec l'effet attendu), appel avec contexte (faux
// fetch : rien ne part), session, performance. Jeu fictif : aucun nom réel.
//
//   npx jiti tools/test-filtres-recette-pages.ts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  activeListKeys,
  calcList,
  cleanListQuery,
  emptyListQuery,
  filterItems,
  isListSearch,
  listChangeText,
  listChips,
  listFilterCount,
  listKeysForModel,
  listKeysOfWord,
  localListCommand,
  mergeListQuery,
  parseNumCond,
  removeListKeys,
  selectItems,
  type ListQuery,
} from '../src/listQuery'
import {
  buildEventsSchema,
  eventInfo,
  eventsNeedInfo,
  eventsSpec,
  legacyEventsToQuery,
  periodRange,
  placeDept,
  readEventsRecipe,
  type EventCtx,
  type EventFilters,
  type EventsReadCtx,
  type QEvent,
} from '../src/eventQuery'
import { buildGroupsSchema, groupsSpec, legacyGroupsToQuery, readGroupsRecipe, type GroupCtx, type GroupFilters, type GroupsReadCtx, type QGroup } from '../src/groupQuery'
import { decideAction } from '../src/playerQuery'
import { understandQuestion, type Endpoint } from '../src/dictation/transcribe'

const TODAY = '2026-10-14'
const ME = 'u-moi'
const REGIONS: Record<string, string> = { '83': 'region-sud', '13': 'region-sud', '06': 'region-sud', '75': 'region-idf', '35': 'region-bre', '29': 'region-bre' }
const regionOf = (d: string) => REGIONS[d]
const geo = {
  regions: [
    { id: 'region-sud', name: 'Région Sud' },
    { id: 'region-idf', name: 'Île-de-France' },
    { id: 'region-bre', name: 'Bretagne' },
  ],
  depts: [
    { code: '06', name: 'Alpes-Maritimes' },
    { code: '13', name: 'Bouches-du-Rhône' },
    { code: '29', name: 'Finistère' },
    { code: '35', name: 'Ille-et-Vilaine' },
    { code: '75', name: 'Paris' },
    { code: '83', name: 'Var' },
  ],
  regionOfDept: regionOf,
}
const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()

let seed = 11
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31)
const pick = <T>(xs: T[]) => xs[Math.floor(rnd() * xs.length)]

// ---------- Jeu fictif : événements ----------
const TYPES = ['match', 'tournoi', 'entrainement', 'observation']
const PLACES = ['Ville-Fictive (83)', 'Salle Imaginaire', 'Exempleville 13000', 'Gymnase du Test', '']
const NAMES = ['Tournoi de Fictiville', 'Match Exemple – Imaginaire', 'Stage Intercomités', 'Journée de détection', 'Plateau U13']
const PEOPLE = ['Paul Fictif', 'Anne Exemple', 'Marc Imaginaire']
const UIDS = ['u-paul', 'u-anne', ME]
function makeEvents(n: number): QEvent[] {
  return Array.from({ length: n }, (_, i) => {
    const c = Math.floor(rnd() * 3)
    const d = new Date(Date.UTC(2023, 0, 1) + Math.floor(rnd() * 1400) * 86400000).toISOString().slice(0, 10)
    return {
      id: `e${i}`,
      name: `${pick(NAMES)} ${2023 + Math.floor(rnd() * 4)}`,
      type: pick(TYPES),
      date: d,
      place: pick(PLACES) || undefined,
      createdBy: UIDS[c],
      createdByName: PEOPLE[c],
      editors: rnd() < 0.2 ? [ME] : undefined,
      playerIds: Array.from({ length: Math.floor(rnd() * 30) }, (_, k) => `p${(i * 7 + k) % 200}`),
      archived: rnd() < 0.1 || undefined,
      matchSheet: rnd() < 0.3 ? {} : undefined,
    }
  })
}
const EVENTS = makeEvents(300).sort((a, b) => b.date.localeCompare(a.date))
const stats = new Map<string, { avis: number; players: Set<string> }>()
for (const e of EVENTS) if (rnd() < 0.6) stats.set(e.id, { avis: Math.floor(rnd() * 40), players: new Set((e.playerIds ?? []).slice(0, Math.floor(rnd() * 10)).concat(rnd() < 0.3 ? ['p-hors-liste'] : [])) })
const ectx: EventCtx = {
  today: TODAY,
  me: ME,
  isParticipant: (ev) => !!ev.editors?.includes(ME),
  stats,
  videos: new Set(EVENTS.filter(() => rnd() < 0.2).map((e) => e.id)),
  rewatch: new Set(EVENTS.filter(() => rnd() < 0.15).map((e) => e.id)),
  info: new Map(EVENTS.map((e) => [e.id, eventInfo(e.place, (e.playerIds ?? []).map((p) => ({ dept: ['83', '13', '75', '35'][Number(p.slice(1)) % 4], year: 2009 + (Number(p.slice(1)) % 4) })))])),
  deptName: (c) => geo.depts.find((d) => d.code === c)?.name ?? c,
  regionName: (id) => geo.regions.find((r) => r.id === id)?.name,
  regionOf,
}

// ---------- 1. Équivalence avec les anciens filtres de la liste Événements ----------
{
  // Copie fidèle de l'ancien calcul (src/pages/Events.tsx avant la recette).
  const legacy = (v: { q: string; type: string; year: string; mine: boolean }) => {
    const words = fold(v.q).split(/\s+/).filter(Boolean)
    return EVENTS.filter(
      (e) =>
        words.every((w) => fold(`${e.name} ${e.place ?? ''} ${e.createdByName ?? ''}`).includes(w)) &&
        (!v.type || e.type === v.type) &&
        (!v.year || e.date.startsWith(v.year)) &&
        (!v.mine || (!!e.createdBy && e.createdBy === ME)),
    )
  }
  let n = 0
  for (const q of ['', 'tournoi', 'fictiville 2024', 'Imaginaire', 'anne', 'salle', 'zzz'])
    for (const type of ['', ...TYPES])
      for (const year of ['', '2023', '2024', '2025', '2026'])
        for (const mine of [false, true]) {
          const v = { q, type, year, mine }
          const a = legacy(v).map((e) => e.id)
          const b = selectItems(eventsSpec, EVENTS, legacyEventsToQuery(v), ectx).map((e) => e.id)
          assert.deepEqual(b, a, JSON.stringify(v))
          n++
        }
  console.log(`Événements : mêmes résultats que les anciens filtres sur ${n} combinaisons`)
}

// ---------- Jeu fictif : groupes ----------
function makeGroups(n: number): QGroup[] {
  return Array.from({ length: n }, (_, i) => {
    const c = Math.floor(rnd() * 3)
    const dept = rnd() < 0.7 ? pick(['83', '13', '75', '35']) : undefined
    const v = rnd()
    return {
      id: `g${i}`,
      name: `${pick(['Intercomités', 'Pôle', 'Sélection', 'Stage'])} ${dept ?? 'national'} ${2009 + (i % 5)}`,
      description: rnd() < 0.5 ? pick(['groupe d’essai', 'liste fictive']) : undefined,
      playerIds: Array.from({ length: Math.floor(rnd() * 40) }, (_, k) => `p${k}`),
      private: v < 0.2 || undefined,
      team: (v >= 0.2 && v < 0.4) || undefined,
      sex: pick([undefined, 'M', 'F', 'mixte'] as const),
      department: dept,
      regionId: dept ? regionOf(dept) : rnd() < 0.3 ? 'region-bre' : undefined,
      scope: pick([undefined, 'federation', 'ligue', 'comite'] as const),
      years: rnd() < 0.8 ? [String(2009 + (i % 5)), ...(rnd() < 0.3 ? [String(2010 + (i % 5))] : [])] : undefined,
      createdBy: UIDS[c],
      createdByName: PEOPLE[c],
      editors: rnd() < 0.2 ? [ME] : undefined,
      updatedAt: Math.floor(rnd() * 1e9),
      archived: rnd() < 0.1 || undefined,
    }
  })
}
const GROUPS = makeGroups(200).sort((a, b) => a.name.localeCompare(b.name))
const gctx: GroupCtx = {
  me: ME,
  isParticipant: (g) => !!g.editors?.includes(ME),
  followed: new Set(GROUPS.filter(() => rnd() < 0.2).map((g) => g.id)),
  deptName: (c) => geo.depts.find((d) => d.code === c)?.name ?? c,
  regionName: (id) => geo.regions.find((r) => r.id === id)?.name,
  regionOf,
}

// ---------- 2. Équivalence avec les anciens filtres de la liste Groupes ----------
{
  const legacy = (v: { q: string; scope: string; sex: string; dept: string; region: string; year: string }) => {
    const words = fold(v.q).split(/\s+/).filter(Boolean)
    return GROUPS.filter(
      (g) =>
        words.every((w) => fold(`${g.name} ${g.description ?? ''} ${g.createdByName ?? ''}`).includes(w)) &&
        (!v.sex || g.sex === v.sex) &&
        (!v.dept || g.department === v.dept) &&
        (!v.region || g.regionId === v.region) &&
        (!v.year || !!g.years?.includes(v.year)),
    )
  }
  let n = 0
  for (const q of ['', 'intercomites', 'pole 83', 'fictive', 'paul'])
    for (const scope of ['', 'federation', 'ligue', 'comite'])
      for (const sex of ['', 'M', 'F', 'mixte'])
        for (const [dept, region] of [['', ''], ['83', 'region-sud'], ['', 'region-bre'], ['75', '']])
          for (const year of ['', '2010', '2012']) {
            // L'ancien niveau (« scope ») n'est plus un filtre : ignoré, mêmes groupes que sans lui.
            const v = { q, scope, sex, dept, region, year }
            assert.deepEqual(
              selectItems(groupsSpec, GROUPS, legacyGroupsToQuery(v), gctx).map((g) => g.id),
              legacy(v).map((g) => g.id),
              JSON.stringify(v),
            )
            n++
          }
  console.log(`Groupes : mêmes résultats que les anciens filtres (niveau ignoré) sur ${n} combinaisons`)
}

// ---------- 3. Fusion : ajout par défaut, remplacement d'une clé redite, retrait, effacement ----------
{
  const q0: ListQuery<EventFilters> = { f: { types: ['tournoi'] }, q: '' }
  // « Tournoi » posé à la main, puis « à venir dans le Var » : les deux restent.
  let m = mergeListQuery(eventsSpec, q0, { f: { period: { kind: 'upcoming' }, depts: ['83'] } }, decideAction('ajouter', 'à venir dans le Var'), [], regionOf)
  assert.deepEqual(m.f, { types: ['tournoi'], period: { kind: 'upcoming' }, depts: ['83'] })
  assert.equal(listChangeText(eventsSpec, q0, m, ectx).text, 'Ajouté : à venir · Var')
  // Clé redite : nouvelle valeur.
  const m2 = mergeListQuery(eventsSpec, m, { f: { types: ['match'] } }, 'ajouter', [], regionOf)
  assert.deepEqual(m2.f.types, ['match'])
  assert.equal(listChangeText(eventsSpec, m, m2, ectx).text, 'Remplacé : Match')
  // Le modèle dit « remplacer » sans que la phrase le dise : ramené à un ajout.
  assert.equal(decideAction('remplacer', 'les matchs'), 'ajouter')
  assert.equal(decideAction('effacer', 'les matchs'), 'ajouter')
  assert.equal(decideAction('ajouter', 'efface tout et montre les matchs'), 'effacer')
  // Effacer : tout, puis ce que dit la phrase (recherche et calcul compris).
  const withQ = { ...m, q: 'fictiville', calc: { type: 'count' as const } }
  const m3 = mergeListQuery(eventsSpec, withQ, { f: { types: ['match'] } }, 'effacer', [], regionOf)
  assert.deepEqual(m3, { f: { types: ['match'] }, q: '' })
  // Retirer : ce qui est dit, et seulement ça.
  const m4 = mergeListQuery(eventsSpec, m, { f: {} }, 'retirer', ['depts'], regionOf)
  assert.deepEqual(m4.f, { types: ['tournoi'], period: { kind: 'upcoming' } })
  assert.equal(listChangeText(eventsSpec, m, m4, ectx).text, 'Retiré : Var')
  // « peu importe le lieu, seulement les miens » : retrait + ajout.
  const m5 = mergeListQuery(eventsSpec, { f: { places: ['Salle Imaginaire'] }, q: '' }, { f: { who: 'mine' } }, 'ajouter', ['places'], regionOf)
  assert.deepEqual(m5.f, { who: 'mine' })
  // Un département d'une autre région écarte la région d'avant ; dans la même région, elle reste.
  assert.deepEqual(mergeListQuery(eventsSpec, { f: { regions: ['region-bre'] }, q: '' }, { f: { depts: ['83'] } }, 'ajouter', [], regionOf).f, { depts: ['83'] })
  assert.deepEqual(mergeListQuery(eventsSpec, { f: { regions: ['region-sud'] }, q: '' }, { f: { depts: ['83'] } }, 'ajouter', [], regionOf).f, { depts: ['83'], regions: ['region-sud'] })
  // Tri et calcul dits : le tri remplace, le calcul s'applique à la sélection (qui reste filtrée).
  const m6 = mergeListQuery(eventsSpec, { ...m, sort: { by: 'date', dir: 'desc' } }, { f: {}, sort: { by: 'players', dir: 'desc' }, calc: { type: 'table', by: 'month' } }, 'ajouter', [], regionOf)
  assert.deepEqual([m6.f, m6.sort, m6.calc], [m.f, { by: 'players', dir: 'desc' }, { type: 'table', by: 'month' }])
  // Recherche par nom dite : posée ; « enlève le nom » la retire.
  const m7 = mergeListQuery(eventsSpec, m, { f: {}, q: 'fictiville' }, 'ajouter', [], regionOf)
  assert.equal(m7.q, 'fictiville')
  assert.equal(removeListKeys(m7, listKeysOfWord(eventsSpec, 'le nom')).q, '')

  // Groupes : une ligue d'ailleurs écarte les comités ; un comité ajouté garde la ligue de sa région.
  const g0: ListQuery<GroupFilters> = { f: { sex: 'F', depts: ['83'], regions: ['region-sud'] }, q: '' }
  assert.deepEqual(mergeListQuery(groupsSpec, g0, { f: { regions: ['region-bre'] } }, 'ajouter', [], regionOf).f, { sex: 'F', regions: ['region-bre'] })
  assert.deepEqual(mergeListQuery(groupsSpec, g0, { f: { depts: ['13'] } }, 'ajouter', [], regionOf).f, { sex: 'F', depts: ['13'], regions: ['region-sud'] })
  assert.deepEqual(mergeListQuery(groupsSpec, { f: { regions: ['region-bre'] }, q: '' }, { f: { depts: ['13'] } }, 'ajouter', [], regionOf).f, { depts: ['13'] })
  const g1 = mergeListQuery(groupsSpec, g0, { f: { years: ['2011'] } }, 'ajouter', [], regionOf)
  assert.deepEqual(g1.f, { ...g0.f, years: ['2011'] })
  assert.equal(listChangeText(groupsSpec, g0, g1, gctx).text, 'Ajouté : année 2011')
}

// ---------- 4. Commandes locales (sans appel) ----------
{
  assert.deepEqual(localListCommand(eventsSpec, 'efface tout'), { action: 'effacer' })
  assert.deepEqual(localListCommand(eventsSpec, 'montre tous les événements'), { action: 'effacer' })
  assert.deepEqual(localListCommand(eventsSpec, 'enlève le lieu'), { action: 'retirer', keys: ['places'] })
  assert.deepEqual(localListCommand(eventsSpec, 'sans la date'), { action: 'retirer', keys: ['period'] })
  assert.deepEqual(localListCommand(eventsSpec, 'enlève le type et la vidéo'), { action: 'retirer', keys: ['types', 'video'] })
  assert.equal(localListCommand(eventsSpec, 'enlève les tournois de Fictiville'), null, 'une phrase avec un nom part au modèle')
  assert.deepEqual(localListCommand(groupsSpec, 'peu importe le comité'), { action: 'retirer', keys: ['depts'] })
  assert.deepEqual(localListCommand(groupsSpec, 'retire le sexe et l’année'), { action: 'retirer', keys: ['sex', 'years'] })
  assert.deepEqual(localListCommand(groupsSpec, 'affiche tous les groupes'), { action: 'effacer' })
  // Noms rendus par le modèle dans « retirer » : retrouvés.
  for (const k of Object.values(eventsSpec.modelKey)) assert.ok(listKeysOfWord(eventsSpec, k).length, k)
  for (const k of Object.values(groupsSpec.modelKey)) assert.ok(listKeysOfWord(groupsSpec, k).length, k)
}

// ---------- 5. Calculs sur la sélection ----------
{
  const sums = [(e: QEvent) => e.playerIds?.length ?? 0]
  const qy: ListQuery<EventFilters> = { f: { types: ['tournoi'] }, q: '', calc: { type: 'count' } }
  const list = selectItems(eventsSpec, EVENTS, qy, ectx)
  const c = calcList(eventsSpec, list, { type: 'count' }, ectx, sums)
  assert.equal(c.count, EVENTS.filter((e) => e.type === 'tournoi').length)
  assert.equal(c.sums[0], list.reduce((n, e) => n + (e.playerIds?.length ?? 0), 0))
  const byType = calcList(eventsSpec, EVENTS, { type: 'table', by: 'type' }, ectx)
  assert.equal(byType.rows!.reduce((n, r) => n + r.n, 0), EVENTS.length)
  assert.ok(byType.rows!.every((r, i, a) => !i || a[i - 1].n >= r.n), 'du plus grand au plus petit')
  assert.ok(byType.rows!.some((r) => r.label === 'Entraînement'))
  const byMonth = calcList(eventsSpec, list, { type: 'table', by: 'month' }, ectx)
  assert.ok(byMonth.rows!.every((r, i, a) => !i || a[i - 1].key > r.key), 'par mois : dans l’ordre du temps, le plus récent d’abord')
  assert.match(byMonth.rows![0].label, /^(janvier|février|mars|avril|mai|juin|juillet|août|septembre|octobre|novembre|décembre) \d{4}$/)
  const byDept = calcList(groupsSpec, GROUPS, { type: 'table', by: 'dept' }, gctx)
  assert.equal(byDept.rows!.at(-1)!.label, 'non renseigné', 'sans comité : en dernier')
  assert.equal(byDept.rows!.find((r) => r.key === '83')!.label, 'Var')
  // Années d'âge : un groupe de deux années compte dans les deux.
  const byYear = calcList(groupsSpec, GROUPS, { type: 'table', by: 'year' }, gctx)
  assert.equal(
    byYear.rows!.reduce((n, r) => n + r.n, 0),
    GROUPS.reduce((n, g) => n + Math.max(1, new Set(g.years ?? []).size), 0),
  )
}

// ---------- 6. Filtres (tests de chaque clé) ----------
{
  const only = (f: EventFilters) => selectItems(eventsSpec, EVENTS, { f, q: '' }, ectx)
  assert.ok(only({ period: { kind: 'upcoming' } }).every((e) => e.date >= TODAY))
  assert.ok(only({ period: { kind: 'past' } }).every((e) => e.date < TODAY))
  assert.deepEqual(periodRange({ kind: 'season' }, TODAY), { from: '2026-09-01', to: '2027-08-31' })
  assert.deepEqual(periodRange({ kind: 'season', start: 2025 }, TODAY), { from: '2025-09-01', to: '2026-08-31' })
  assert.deepEqual(periodRange({ kind: 'month' }, TODAY), { from: '2026-10-01', to: '2026-10-31' })
  assert.ok(only({ period: { kind: 'between', from: '2024-03-01', to: '2024-05-31' } }).every((e) => e.date >= '2024-03-01' && e.date <= '2024-05-31'))
  assert.ok(only({ who: 'created' }).every((e) => e.createdBy === ME))
  assert.ok(only({ who: 'participant' }).every((e) => e.editors?.includes(ME)))
  assert.equal(only({ who: 'mine' }).length, EVENTS.filter((e) => e.createdBy === ME || e.editors?.includes(ME)).length)
  assert.ok(only({ sheet: true }).every((e) => !!e.matchSheet))
  assert.ok(only({ video: true }).every((e) => ectx.videos.has(e.id)))
  assert.ok(only({ rewatch: true }).every((e) => ectx.rewatch.has(e.id)))
  assert.ok(only({ players: { op: 'gte', n: 20 } }).length > 0)
  assert.ok(only({ avis: { op: 'eq', n: 0 } }).every((e) => !stats.get(e.id)?.avis))
  assert.ok(only({ places: ['Imaginaire'] }).every((e) => e.place === 'Salle Imaginaire'))
  assert.ok(only({ creators: ['Anne'] }).every((e) => e.createdByName === 'Anne Exemple'))
  assert.ok(only({ depts: ['83'] }).every((e) => ectx.info!.get(e.id)!.depts.includes('83')))
  assert.ok(only({ gens: [2011] }).length > 0)
  // Plusieurs générations : un joueur né dans l'une d'elles (src/birthYears.ts).
  const gensOf = (e: QEvent) => ectx.info!.get(e.id)!.years
  const two = only({ gens: [2009, 2011] })
  assert.ok(two.length > 0 && two.every((e) => gensOf(e).some((y) => y === 2009 || y === 2011)))
  assert.ok(two.length >= only({ gens: [2011] }).length)
  assert.equal(
    two.length,
    EVENTS.filter((e) => gensOf(e).some((y) => y === 2009 || y === 2011)).length,
    'génération 2009 ou 2011',
  )
  // Session d'avant : { years: [a, b] } (de… à) relu en générations.
  assert.deepEqual(cleanListQuery(eventsSpec, { f: { years: [2009, 2011] }, q: '' }).f, { gens: [2009, 2010, 2011] })
  assert.deepEqual(cleanListQuery(eventsSpec, { f: { years: [2011, 2011] }, q: '' }).f, { gens: [2011] })
  assert.deepEqual(cleanListQuery(eventsSpec, { f: { gens: [2012, 2010, 2010, 'x'] }, q: '' }).f, { gens: [2010, 2012] })
  assert.equal(listChips(eventsSpec, { f: { gens: [2011] }, q: '' }, ectx)[0].label, 'génération 2011')
  assert.equal(listChips(eventsSpec, { f: { gens: [2010, 2011, 2012] }, q: '' }, ectx)[0].label, 'générations 2010 à 2012')
  assert.equal(listChips(eventsSpec, { f: { gens: [2010, 2012] }, q: '' }, ectx)[0].label, 'générations 2010 et 2012')
  // Joueurs d'un événement : sa liste et les joueurs notés hors liste, comptés une fois.
  const hl = EVENTS.find((e) => stats.get(e.id)?.players.has('p-hors-liste'))!
  assert.equal(eventsSpec.sorts[1].get(hl, ectx), new Set([...(hl.playerIds ?? []), 'p-hors-liste']).size)
  // Tri : joueurs, du plus grand au plus petit.
  const sorted = selectItems(eventsSpec, EVENTS, { f: {}, q: '', sort: { by: 'players', dir: 'desc' } }, ectx)
  assert.ok(sorted.every((e, i, a) => !i || (eventsSpec.sorts[1].get(a[i - 1], ectx) as number) >= (eventsSpec.sorts[1].get(e, ectx) as number)))
  // Lieu d'un événement : écrit dans le lieu, sinon ses joueurs.
  assert.equal(placeDept('Ville-Fictive (83)'), '83')
  assert.equal(placeDept('Exempleville 13000'), '13')
  assert.equal(placeDept('Gymnase du Test'), undefined)
  assert.deepEqual(eventInfo('Gymnase du Test', [{ dept: '13', year: 2011 }, { dept: '13', year: 2011 }, { dept: '83', year: 2012 }, { year: 2005 }, { year: 2006 }, { year: 2007 }, { year: 2008 }, { year: 2009 }]), {
    depts: ['13'],
    years: [2011],
  })
  assert.deepEqual(eventInfo('Salle (83)', [{ dept: '13' }]).depts, ['83'])
  assert.ok(eventsNeedInfo({ f: { depts: ['83'] }, q: '' }) && !eventsNeedInfo({ f: { types: ['match'] }, q: '' }))
  // Groupes.
  const g = (f: GroupFilters) => selectItems(groupsSpec, GROUPS, { f, q: '' }, gctx)
  assert.ok(g({ vis: ['private'] }).every((x) => x.private))
  assert.ok(g({ vis: ['team', 'staff'] }).every((x) => !x.private))
  assert.ok(g({ followed: true }).every((x) => gctx.followed.has(x.id)))
  assert.ok(g({ who: 'created' }).every((x) => x.createdBy === ME))
  assert.ok(g({ players: { op: 'lte', n: 5 } }).every((x) => x.playerIds.length <= 5))
  assert.ok(g({ years: ['2010', '2011'] }).every((x) => x.years?.some((y) => y === '2010' || y === '2011')))
  // Nombres des menus : chaque menu compte les éléments qui passent les AUTRES filtres.
  const qy: ListQuery<GroupFilters> = { f: { sex: 'F', depts: ['83'] }, q: '' }
  assert.equal(filterItems(groupsSpec, GROUPS, qy, gctx, 'sex').length, GROUPS.filter((x) => x.department === '83').length)
}

// ---------- 6 bis. Choix multiples : OU dans un champ, ET entre les champs ----------
{
  // Événements : tournois OU matchs, dans le Var OU les Bouches-du-Rhône.
  const qy: ListQuery<EventFilters> = { f: { types: ['tournoi', 'match'], depts: ['83', '13'] }, q: '' }
  const got = selectItems(eventsSpec, EVENTS, qy, ectx).map((e) => e.id)
  const depts = (e: QEvent) => ectx.info!.get(e.id)!.depts
  const want = EVENTS.filter((e) => (e.type === 'tournoi' || e.type === 'match') && depts(e).some((d) => d === '83' || d === '13')).map((e) => e.id)
  assert.ok(want.length > 5)
  assert.deepEqual(got, want)
  const chips = new Map(listChips(eventsSpec, qy, ectx).map((c) => [c.key, c.label]))
  assert.equal(chips.get('types'), 'Tournoi ou Match')
  assert.equal(chips.get('depts'), 'Var ou Bouches-du-Rhône')
  assert.equal(listFilterCount(eventsSpec, qy), 2, 'un par champ, quel que soit le nombre de valeurs')
  assert.equal(listFilterCount(eventsSpec, { ...qy, q: 'tournoi', sort: { by: 'date', dir: 'asc' } }), 3, 'tri compris, recherche non')
  // Nombre d'un type (les autres champs appliqués) : celui qu'on obtient en le cochant seul.
  const others = filterItems(eventsSpec, EVENTS, qy, ectx, 'types')
  for (const t of TYPES) assert.equal(others.filter((e) => e.type === t).length, selectItems(eventsSpec, EVENTS, { ...qy, f: { ...qy.f, types: [t] } }, ectx).length, t)
  // Groupes : visibilités, ligues, comités, années d'âge : l'un ou l'autre.
  const gq: ListQuery<GroupFilters> = { f: { depts: ['83', '13'], years: ['2010', '2011'] }, q: '' }
  const g = selectItems(groupsSpec, GROUPS, gq, gctx).map((x) => x.id)
  assert.deepEqual(g, GROUPS.filter((x) => (x.department === '83' || x.department === '13') && x.years?.some((y) => y === '2010' || y === '2011')).map((x) => x.id))
  assert.equal(new Map(listChips(groupsSpec, gq, gctx).map((c) => [c.key, c.label])).get('depts'), 'Var ou Bouches-du-Rhône')
  // Session d'avant (une seule valeur) : toujours lue.
  assert.deepEqual(cleanListQuery(eventsSpec, { f: { types: 'tournoi', depts: '83' }, q: '' }).f, { types: ['tournoi'], depts: ['83'] })
}

// ---------- 7. Simple nom ou phrase ----------
{
  const hays = EVENTS.map(eventsSpec.hay)
  for (const t of ['', 'Fictiville', 'Tournoi de Fictiville 2024', 'plateau u13', 'Imaginaire', 'Paul', 'Zorglub']) assert.ok(isListSearch(t, hays), `nom : ${t}`)
  for (const t of ['les tournois de cette saison', 'combien par mois ?', 'à venir dans le Var', 'mes événements avec une vidéo', 'ceux avec plus de 20 joueurs', 'tournois 2025 à Fictiville en mars', 'efface tout']) assert.ok(!isListSearch(t, hays), `phrase : ${t}`)
  const ghays = GROUPS.map(groupsSpec.hay)
  for (const t of ['Intercomités 83', 'pôle', 'liste fictive']) assert.ok(isListSearch(t, ghays), `groupe : ${t}`)
  for (const t of ['les groupes de filles du Var', 'combien par comité ?', 'ceux de 2011']) assert.ok(!isListSearch(t, ghays), `phrase : ${t}`)
}

// ---------- 8. Ce qui part au modèle : noms des filtres, schémas sans aucune donnée ----------
const ercx: EventsReadCtx = {
  today: TODAY,
  names: EVENTS.map((e) => e.name),
  places: [...new Set(EVENTS.map((e) => e.place ?? '').filter(Boolean))],
  creators: PEOPLE,
  geo,
}
const grcx: GroupsReadCtx = { today: TODAY, names: GROUPS.map((x) => x.name), creators: PEOPLE, geo }
{
  const qy: ListQuery<EventFilters> = { f: { types: ['tournoi'], places: ['Salle Imaginaire'], creators: ['Paul Fictif'], depts: ['83'] }, q: 'Fictiville', sort: { by: 'date', dir: 'asc' } }
  assert.deepEqual(listKeysForModel(eventsSpec, qy), ['types', 'lieux', 'departements', 'createurs', 'tri', 'recherche'])
  const sent = JSON.stringify([listKeysForModel(eventsSpec, qy), buildEventsSchema(TODAY), buildGroupsSchema(TODAY)])
  for (const x of [...NAMES, ...PLACES.filter(Boolean), ...PEOPLE, 'Fictiville', 'Imaginaire', 'Var', 'Intercomités', 'Bretagne']) assert.ok(!sent.includes(x), `rien de « ${x} » ne part`)
  // Chaque clé du schéma est lue par l'appli (et rien d'autre).
  assert.deepEqual(readEventsRecipe(Object.fromEntries(Object.keys(buildEventsSchema(TODAY)).filter((k) => k !== 'aujourdhui').map((k) => [k, null])), [], ercx).unsupported, [])
  assert.deepEqual(readGroupsRecipe(Object.fromEntries(Object.keys(buildGroupsSchema(TODAY)).filter((k) => k !== 'aujourdhui').map((k) => [k, null])), [], grcx).unsupported, [])
}

// ---------- 9. Lecture de la recette rendue (valeurs revérifiées) ----------
{
  let r = readEventsRecipe({ types: ['tournois', 'stage'], periode: 'saison_derniere', lieux: ['salle imaginaire'] }, [], ercx)
  assert.deepEqual(r.f, { types: ['tournoi', 'entrainement'], period: { kind: 'season', start: 2025 }, places: ['Salle Imaginaire'] })
  r = readEventsRecipe({ periode: { du: '2025-03-01', au: '2025-05-31' }, lieux: ['Bretagne'], mes: 'crees' }, [], ercx)
  assert.deepEqual(r.f, { period: { kind: 'between', from: '2025-03-01', to: '2025-05-31' }, regions: ['region-bre'], who: 'created' }, 'un lieu qui est une région')
  r = readEventsRecipe({ periode: { annee: 2024 }, lieux: ['Var'], joueurs: { op: '>', n: 15 } }, [], ercx)
  assert.deepEqual(r.f, { period: { kind: 'year', year: 2024 }, depts: ['83'], players: { op: 'gte', n: 16 } })
  r = readEventsRecipe({ periode: 'hier', types: ['réunion'], lieux: ['Atlantide'], createurs: ['Zorglub'], couleur: 'bleu', generation: 2031 }, ['la météo'], ercx)
  assert.deepEqual(r.f, {})
  assert.deepEqual(r.unsupported, ['la météo', '« couleur »'])
  assert.equal(r.notes.length, 5)
  r = readEventsRecipe({ noms: ['tournoi de fictiville'], sortie: { type: 'tableau', par: 'mois' } }, [], ercx)
  assert.deepEqual([r.q, r.calc], ['tournoi fictiville', { type: 'table', by: 'month' }])
  r = readEventsRecipe({ sortie: { type: 'liste', tri: 'joueurs', ordre: 'croissant' } }, [], ercx)
  assert.deepEqual(r.sort, { by: 'players', dir: 'asc' })
  let gr = readGroupsRecipe({ visibilite: ['prive', 'mon_staff'], sexe: 'mixtes', comites: ['13'], annees: [2011, '2012'] }, [], grcx)
  assert.deepEqual(gr.f, { vis: ['private', 'team'], sex: 'mixte', depts: ['13'], years: ['2011', '2012'] })
  gr = readGroupsRecipe({ ligues: ['PACA'], suivis: true, mes: 'participant', createurs: ['marc'], sortie: { type: 'tableau', par: 'comite' } }, [], grcx)
  assert.deepEqual([gr.f, gr.calc], [{ regions: ['region-sud'], who: 'participant', followed: true, creators: ['Marc Imaginaire'] }, { type: 'table', by: 'dept' }])
  assert.deepEqual(parseNumCond('12'), { op: 'gte', n: 12 })
  assert.deepEqual(parseNumCond({ op: '<', n: 10 }), { op: 'lte', n: 9 })
  assert.equal(parseNumCond({ op: '>=', n: -3 }), undefined)
}

// ---------- 9 bis. Groupes : plus de filtre sur le niveau (Fédération, ligue, comité) ----------
{
  const g = (f: GroupFilters) => selectItems(groupsSpec, GROUPS, { f, q: '' }, gctx).map((x) => x.id)
  const old = { scope: 'ligue', sex: 'F' } as unknown as GroupFilters
  // Ancienne valeur (adresse, filtre enregistré, session) : ignorée à la lecture, sans erreur, sans pastille ni filtrage caché.
  assert.deepEqual(groupsSpec.clean(old), { sex: 'F' })
  assert.deepEqual(groupsSpec.clean({ scope: ['federation', 'comite'] }), {})
  assert.deepEqual(cleanListQuery(groupsSpec, { f: { scope: 'comite', depts: ['83'] }, q: '', calc: { type: 'table', by: 'scope' } }), { f: { depts: ['83'] }, q: '' })
  assert.deepEqual(selectItems(groupsSpec, GROUPS, cleanListQuery(groupsSpec, { f: old, q: '' }), gctx).map((x) => x.id), g({ sex: 'F' }))
  assert.deepEqual(listChips(groupsSpec, cleanListQuery(groupsSpec, { f: old, q: '' }), gctx).map((c) => c.key), ['sex'])
  assert.equal(listFilterCount(groupsSpec, cleanListQuery(groupsSpec, { f: old, q: '' })), 1)
  assert.deepEqual(legacyGroupsToQuery({ q: '', scope: 'federation', sex: '', dept: '83', region: '', year: '' }).f, { depts: ['83'] })
  // Territoire sans niveau : un comité ne garde que les groupes de ce comité.
  assert.deepEqual(g({ depts: ['83'] }), GROUPS.filter((x) => x.department === '83').map((x) => x.id))
  // Ce qui part au modèle : plus de niveau ; un « niveau » rendu quand même est dit non pris en compte.
  const schema = buildGroupsSchema(TODAY)
  assert.ok(!('niveau' in schema) && !/niveau/.test(schema.sortie), 'description sans niveau')
  assert.ok(!listKeysForModel(groupsSpec, { f: { sex: 'M' }, q: '' }).includes('niveau'))
  const gr = readGroupsRecipe({ niveau: 'ligue', sexe: 'F' }, [], grcx)
  assert.deepEqual([gr.f, gr.unsupported], [{ sex: 'F' }, ['« niveau »']])
  // Le sexe des groupes ne change pas : Garçons / Filles / Mixte, un seul choix.
  assert.deepEqual(groupsSpec.clean({ sex: 'mixte' }), { sex: 'mixte' })
  assert.deepEqual(g({ sex: 'mixte' }), GROUPS.filter((x) => x.sex === 'mixte').map((x) => x.id))
  console.log('Groupes : plus de filtre sur le niveau, anciennes valeurs ignorées')
}

// ---------- 10. Exemples des consignes « evenements » et « groupes » de la fonction ----------
const fn = readFileSync(new URL('../supabase/functions/transcrire/index.ts', import.meta.url), 'utf8')
function examples(name: string) {
  const start = fn.indexOf(`const ${name} = `)
  assert.ok(start > 0, name)
  const block = fn.slice(start, fn.indexOf('`\n', start + 30))
  const ex = [...block.matchAll(/^Actuels (\[[^\]]*\]) ; « (.+?) » → (\{.+\})$/gm)]
  assert.ok(ex.length >= 6 && ex.length <= 8, `${name} : ${ex.length} exemples`)
  return ex
}
{
  const value: Record<string, Partial<EventFilters>> = { types: { types: ['tournoi'] }, periode: { period: { kind: 'upcoming' } }, lieux: { places: ['Salle Imaginaire'] } }
  const expect: Record<string, (q: ListQuery<EventFilters>) => void> = {
    'les tournois de cette saison': (q) => assert.deepEqual(q.f, { types: ['tournoi'], period: { kind: 'season' } }),
    'à venir dans le Var': (q) => assert.deepEqual(q.f, { types: ['tournoi'], period: { kind: 'upcoming' }, depts: ['83'] }),
    'combien par mois ?': (q) => assert.deepEqual([q.f, q.calc], [{ types: ['tournoi'], period: { kind: 'upcoming' } }, { type: 'table', by: 'month' }]),
    'seulement les miens avec une feuille de match': (q) => assert.deepEqual(q.f, { period: { kind: 'upcoming' }, who: 'mine', sheet: true }),
    'enlève le lieu': (q) => assert.deepEqual(q.f, { types: ['tournoi'] }),
    'efface tout et montre les matchs entre mars et mai 2025': (q) => assert.deepEqual(q.f, { types: ['match'], period: { kind: 'between', from: '2025-03-01', to: '2025-05-31' } }),
    "ceux avec au moins 20 joueurs et des joueurs à revoir, les plus récents d'abord": (q) => assert.deepEqual([q.f, q.sort], [{ players: { op: 'gte', n: 20 }, rewatch: true }, { by: 'date', dir: 'desc' }]),
    'les observations de la génération 2011 créées par Paul': (q) => assert.deepEqual(q.f, { period: { kind: 'upcoming' }, types: ['observation'], creators: ['Paul Fictif'], gens: [2011] }),
  }
  checkExamples('CONSIGNES_EVENEMENTS', eventsSpec, value, expect, (raw, ng) => readEventsRecipe(raw, ng, ercx), buildEventsSchema(TODAY))
}
{
  const value: Record<string, Partial<GroupFilters>> = { sexe: { sex: 'M' }, annees: { years: ['2010'] }, comites: { depts: ['35'] } }
  const expect: Record<string, (q: ListQuery<GroupFilters>) => void> = {
    'les groupes de filles du Var': (q) => assert.deepEqual(q.f, { sex: 'F', depts: ['83'] }),
    'ceux de 2011': (q) => assert.deepEqual(q.f, { sex: 'M', years: ['2011'] }),
    'combien par comité ?': (q) => assert.deepEqual([q.f, q.calc], [{ sex: 'M', years: ['2010'] }, { type: 'table', by: 'dept' }]),
    'peu importe le comité, seulement les groupes privés': (q) => assert.deepEqual(q.f, { vis: ['private'] }),
    'enlève le sexe': (q) => assert.deepEqual(q.f, { depts: ['35'] }),
    'efface tout et montre les groupes que je suis': (q) => assert.deepEqual(q.f, { followed: true }),
    'mes groupes de plus de 15 joueurs, classés par nombre de joueurs': (q) => assert.deepEqual([q.f, q.sort], [{ who: 'mine', players: { op: 'gte', n: 16 } }, { by: 'players', dir: 'desc' }]),
    'les groupes créés par Paul en Bretagne': (q) => assert.deepEqual(q.f, { regions: ['region-bre'], creators: ['Paul Fictif'] }),
  }
  checkExamples('CONSIGNES_GROUPES', groupsSpec, value, expect, (raw, ng) => readGroupsRecipe(raw, ng, grcx), buildGroupsSchema(TODAY))
}
function checkExamples<F extends object>(
  name: string,
  spec: typeof eventsSpec | typeof groupsSpec,
  value: Record<string, Partial<F>>,
  expect: Record<string, (q: ListQuery<F>) => void>,
  read: (raw: unknown, ng: string[]) => ReturnType<typeof readEventsRecipe> | ReturnType<typeof readGroupsRecipe>,
  schema: Record<string, string>,
) {
  const s = spec as unknown as Parameters<typeof mergeListQuery<F, unknown, unknown>>[0]
  const seen = new Set<string>()
  for (const [, actuels, said, json] of examples(name)) {
    const ans = JSON.parse(json) as { action: string; recette: Record<string, unknown>; retirer: string[]; nonGere: string[] }
    assert.deepEqual(Object.keys(ans), ['action', 'recette', 'retirer', 'nonGere'], said)
    seen.add(ans.action)
    for (const k of [...Object.keys(ans.recette), ...ans.retirer, ...JSON.parse(actuels)]) assert.ok(k in schema, `${said} : clé ${k}`)
    const cur: ListQuery<F> = { f: Object.assign({}, ...(JSON.parse(actuels) as string[]).map((k) => value[k] ?? {})), q: '' }
    assert.deepEqual(listKeysForModel(s, cur), JSON.parse(actuels), `actuels de « ${said} »`)
    // Commande locale reconnue sans appel : même effet que la réponse du modèle.
    const local = localListCommand(s, said)
    const it = read(ans.recette, ans.nonGere) as unknown as { f: Partial<F>; q?: string; sort?: ListQuery<F>['sort']; calc?: ListQuery<F>['calc']; notes: string[]; unsupported: string[] }
    assert.deepEqual([it.notes, it.unsupported], [[], []], `« ${said} » relu sans perte`)
    const remove = ans.retirer.flatMap((r) => listKeysOfWord(s, r))
    const merged = mergeListQuery(s, cur, it, decideAction(ans.action, said), remove, regionOf)
    if (local) assert.deepEqual(local.action === 'effacer' ? emptyListQuery<F>() : removeListKeys(cur, local.keys), merged, `commande locale : ${said}`)
    assert.ok(expect[said], `effet attendu de « ${said} »`)
    expect[said](merged)
  }
  assert.deepEqual([...seen].sort(), ['ajouter', 'effacer', 'retirer'], name)
}
assert.ok(fn.includes("evenements: CONSIGNES_EVENEMENTS, groupes: CONSIGNES_GROUPES"))
assert.ok(fn.includes("'question_evenements', 'question_groupes'"), 'GET : modes annoncés')

// ---------- 11. Appel avec contexte (faux fetch : rien ne part) ----------
{
  const calls: RequestInit[] = []
  const ep: Endpoint = {
    url: 'https://x.supabase.co/functions/v1/transcrire',
    headers: { Authorization: 'Bearer t' },
    fetch: (async (_u: string, init?: RequestInit) => {
      calls.push(init!)
      return new Response(JSON.stringify({ recette: { types: ['tournoi'] }, nonGere: [], action: 'ajouter', retirer: [] }), { status: 200 })
    }) as unknown as typeof fetch,
  }
  const qy: ListQuery<EventFilters> = { f: { places: ['Salle Imaginaire'] }, q: 'Fictiville' }
  const ans = await understandQuestion(ep, 'les tournois', buildEventsSchema(TODAY), undefined, { contexte: 'evenements', actuels: listKeysForModel(eventsSpec, qy) })
  assert.equal(ans.action, 'ajouter')
  const body = JSON.parse(String(calls[0].body))
  assert.deepEqual(Object.keys(body), ['phrase', 'schema', 'contexte', 'actuels'])
  assert.deepEqual([body.contexte, body.actuels], ['evenements', ['lieux', 'recherche']])
  assert.ok(!String(calls[0].body).includes('Imaginaire') && !String(calls[0].body).includes('Fictiville'), 'ni lieu ni nom cherché')
}

// ---------- 12. Session : rien n'y est cru ----------
{
  const junk = { f: { types: ['match', 'bal'], period: { kind: 'year', year: 'x' }, players: { op: 'gte', n: -1 }, depts: ['83', 'ZZZ'], who: 'tous' }, q: 3, sort: { by: 'couleur' }, calc: { type: 'table', by: 'lune' } }
  assert.deepEqual(cleanListQuery(eventsSpec, junk), { f: { types: ['match'], depts: ['83'] }, q: '' })
  assert.deepEqual(cleanListQuery(groupsSpec, { f: { vis: ['secret'], years: ['20xx', '2011'], followed: 'oui' }, q: 'pôle' }), { f: { years: ['2011'] }, q: 'pôle' })
  assert.deepEqual(cleanListQuery(eventsSpec, null), emptyListQuery())
  const chips = listChips(eventsSpec, { f: { types: ['tournoi', 'match'], period: { kind: 'season' }, avis: { op: 'gte', n: 1 } }, q: '', sort: { by: 'avis', dir: 'desc' } }, ectx)
  assert.deepEqual(
    chips.map((c) => c.label),
    ['Tournoi ou Match', 'cette saison (2026-2027)', 'au moins 1 avis', 'tri : nombre d’avis ↓'],
  )
  assert.deepEqual(activeListKeys(eventsSpec, emptyListQuery()), [])
}

// ---------- 13. Performance (téléphone d'abord) ----------
{
  const big = makeEvents(5000)
  const bctx: EventCtx = { ...ectx, info: new Map(big.map((e) => [e.id, { depts: ['83'], years: [2011] }])) }
  const t0 = performance.now()
  for (let i = 0; i < 20; i++) selectItems(eventsSpec, big, { f: { types: ['tournoi'], period: { kind: 'season', start: 2024 }, depts: ['83'], players: { op: 'gte', n: 5 } }, q: 'fictiville', sort: { by: 'players', dir: 'desc' } }, bctx)
  const ms = (performance.now() - t0) / 20
  console.log(`5 000 événements : filtre et tri ≈ ${ms.toFixed(1)} ms`)
  assert.ok(ms < 60)
}

console.log('test-filtres-recette-pages : OK')
