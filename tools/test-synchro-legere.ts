// Test de la synchronisation allégée (src/syncLive.ts, pendant de supabase/057_synchro_legere.sql) : canaux du compte (même
// règle que hb_mes_canaux : administrateur, fédération, comité, club, joueur, sans rôle), délais de relecture (regroupement,
// canaux larges étalés, annonce de version), cadence du filet de sécurité, lecture d'un signal, plan de relecture d'après
// « quoi de neuf ? », lignes reçues à garder, regroupement des signaux ; envoi des signaux par l'appareil qui écrit (canaux
// d'une ligne, miroir de hb_canaux_ligne ; messages groupés, seulement sur les canaux ouverts, sans nom) ; et le script SQL
// écrit comme l'appli l'attend (mêmes noms de canaux, mêmes tables, plus de diffusion par la base, règles d'écoute et
// d'envoi). Première synchronisation allégée (29/10) : avancement sans comptage, lecture par pages correcte avec un serveur
// qui plafonne à 1 000 lignes par réponse, affectations du compte seulement (hors administrateur) et clé « mes_affectations »
// de « quoi de neuf ? ». Ligne dans le signal (série 5 du 29/10) : tables et canaux où la ligne enregistrée peut voyager,
// plafond de taille, relecture ciblée des seuls identifiants, table inconnue refusée, fusion d'une ligne reçue (plus
// récente, plus ancienne, envoi en attente), lignes à confirmer par la synchronisation suivante. Données fictives seulement.
//
//   npx jiti tools/test-synchro-legere.ts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  ALL_TOPIC,
  assignmentScope,
  assignmentScopeKey,
  BROAD_JITTER_MS,
  channelsOf,
  COMMON_TOPIC,
  CONTENT_MAX,
  CONTENT_TABLES,
  dueForSync,
  forSignal,
  GROUP_MS,
  Grouper,
  isBroadTopic,
  jitter,
  keepRows,
  LIVE_SYNC_MS,
  MY_ASSIGNMENTS_KEY,
  otherAssignmentIds,
  outgoingSignals,
  parseSignal,
  planAssignmentScope,
  planPull,
  PULL_PAGE,
  pullDelay,
  readPages,
  rowChannels,
  STAFF_TOPIC,
  SYNC_MS,
  syncEvery,
  VERSION_JITTER_MS,
  versionCheckDelay,
  whatsNewAnswer,
  whatsNewRequest,
  dropProvisional,
  FUTURE_MS,
  ID_TABLES,
  LIVE_ROWS_MAX,
  liveKey,
  liveRowsToApply,
  markProvisional,
  packSignal,
  planLive,
  planVerify,
  PROVISIONAL_MAX,
  provisionalBefore,
  provisionalCount,
  readProvisional,
  readServerRow,
  ROW_TABLES,
  rowFitsTopic,
  rowsToWrite,
  serverRowChannels,
  SIGNAL_MAX_BYTES,
  splitLiveKeys,
  writeAnswer,
  type ChannelLookup,
  type PageKey,
  type SentRow,
  type ServerRow,
  type Timers,
} from '../src/syncLive'
import { SCOPED_TABLES } from '../src/perimeter'
import { aggregate, forward, percent, PROGRESS_MIN, progressLabel, showProgress, startTable, tableShare, type TableProgress } from '../src/syncProgress'

let n = 0
// Les tests passent l'un après l'autre (certains attendent : lecture par pages) ; un échec arrête tout (code de sortie non nul).
let chain: Promise<void> = Promise.resolve()
const t = (name: string, f: () => void | Promise<void>) => {
  chain = chain.then(async () => {
    await f()
    n++
    console.log(`ok ${n} - ${name}`)
  })
}

// Tables synchronisées (src/db.ts, SYNC_TABLES), lues dans le source pour ne pas charger Dexie ici.
const dbSrc = readFileSync(new URL('../src/db.ts', import.meta.url), 'utf8')
const SYNC_TABLES = [...dbSrc.match(/export const SYNC_TABLES = \[([^\]]+)\]/)![1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1])
assert.equal(SYNC_TABLES.length, 19)

// ---------- Canaux du compte ----------

const uid = '11111111-1111-4111-8111-111111111111'

t('canaux : administrateur et niveau Fédération → commun, le sien, staff, tout', () => {
  assert.deepEqual(channelsOf({ uid, role: 'admin', scope: { all: true, depts: [], clubs: [] } }), [COMMON_TOPIC, `hb:compte:${uid}`, STAFF_TOPIC, ALL_TOPIC])
  // Affecté à une fédération et à une ligue : « tout » suffit (pas de canaux par département).
  assert.deepEqual(channelsOf({ uid, role: 'observateur', scope: { all: true, depts: ['83', '13'], clubs: [] } }), [COMMON_TOPIC, `hb:compte:${uid}`, STAFF_TOPIC, ALL_TOPIC])
})
t('canaux : comité → ses départements ; ligue → tous ses départements ; club → son n°', () => {
  assert.deepEqual(channelsOf({ uid, role: 'preparateur', scope: { all: false, depts: ['83'], clubs: [] } }), [COMMON_TOPIC, `hb:compte:${uid}`, STAFF_TOPIC, 'hb:dept:83'])
  assert.deepEqual(channelsOf({ uid, role: 'observateur', scope: { all: false, depts: ['04', '05', '971'], clubs: [] } }), [
    COMMON_TOPIC,
    `hb:compte:${uid}`,
    STAFF_TOPIC,
    'hb:dept:04',
    'hb:dept:05',
    'hb:dept:971',
  ])
  assert.deepEqual(channelsOf({ uid, role: 'preparateur', scope: { all: false, depts: [], clubs: ['6383015'] } }), [COMMON_TOPIC, `hb:compte:${uid}`, STAFF_TOPIC, 'hb:club:6383015'])
  // Comité et club à la fois ; valeurs vides ignorées.
  assert.deepEqual(channelsOf({ uid, role: 'preparateur', scope: { all: false, depts: ['83', ''], clubs: ['6383015'] } }), [
    COMMON_TOPIC,
    `hb:compte:${uid}`,
    STAFF_TOPIC,
    'hb:dept:83',
    'hb:club:6383015',
  ])
})
t('canaux : compte joueur → sa fiche seulement ; sans fiche reliée : commun et le sien', () => {
  assert.deepEqual(channelsOf({ uid, role: 'joueur', playerId: 'p-1', scope: null }), [COMMON_TOPIC, `hb:compte:${uid}`, 'hb:joueur:p-1'])
  assert.deepEqual(channelsOf({ uid, role: 'joueur', playerId: null, scope: null }), [COMMON_TOPIC, `hb:compte:${uid}`])
})
t('canaux : sans rôle (compte en attente) → commun et le sien ; staff sans affectation → staff seul ; sans compte → rien', () => {
  assert.deepEqual(channelsOf({ uid, role: null, scope: { all: false, depts: [], clubs: [] } }), [COMMON_TOPIC, `hb:compte:${uid}`])
  assert.deepEqual(channelsOf({ uid, role: 'observateur', scope: { all: false, depts: [], clubs: [] } }), [COMMON_TOPIC, `hb:compte:${uid}`, STAFF_TOPIC])
  assert.deepEqual(channelsOf({ uid, role: 'observateur', scope: null }), [COMMON_TOPIC, `hb:compte:${uid}`, STAFF_TOPIC])
  assert.deepEqual(channelsOf({ uid: null, role: 'admin', scope: { all: true, depts: [], clubs: [] } }), [])
})
t('canaux : aucun nom de canal ne porte autre chose qu’un code, un n° ou un identifiant technique', () => {
  for (const c of channelsOf({ uid, role: 'preparateur', scope: { all: false, depts: ['2A'], clubs: ['6383015'] } })) assert.match(c, /^hb:(commun|staff|tout|compte:[0-9a-f-]+|dept:[0-9AB]+|club:\d+)$/)
})

// ---------- Délais ----------

t('canaux larges : commun, staff, tout ; les autres sont ciblés', () => {
  assert.ok(isBroadTopic(COMMON_TOPIC) && isBroadTopic(STAFF_TOPIC) && isBroadTopic(ALL_TOPIC))
  assert.ok(!isBroadTopic('hb:dept:83') && !isBroadTopic('hb:club:6383015') && !isBroadTopic(`hb:compte:${uid}`) && !isBroadTopic('hb:joueur:p-1'))
})
t('relecture : 1,5 s de regroupement ; canal large : + 0 à 10 s au hasard', () => {
  assert.equal(GROUP_MS, 1500)
  assert.equal(BROAD_JITTER_MS, 10_000)
  assert.equal(pullDelay('hb:dept:83', () => 0.99), GROUP_MS)
  assert.equal(pullDelay(COMMON_TOPIC, () => 0), GROUP_MS)
  assert.equal(pullDelay(STAFF_TOPIC, () => 0.5), GROUP_MS + 5000)
  assert.equal(pullDelay(ALL_TOPIC, () => 0.999999), GROUP_MS + 9999)
  // Un tirage hors [0, 1) reste borné.
  assert.equal(jitter(100, () => 1), 99)
  assert.equal(jitter(100, () => -3), 0)
  for (let i = 0; i < 200; i++) {
    const d = pullDelay(ALL_TOPIC)
    assert.ok(d >= GROUP_MS && d < GROUP_MS + BROAD_JITTER_MS, `délai ${d}`)
  }
})
t('version annoncée : vérification dans les 30 s ; déjà la mienne, vide ou mal formée : rien', () => {
  assert.equal(VERSION_JITTER_MS, 30_000)
  assert.equal(versionCheckDelay('2026-10-28T10:00:00.000Z', '2026-10-27T10:00:00.000Z', () => 0.5), 15_000)
  assert.equal(versionCheckDelay('2026-10-28T10:00:00.000Z', '2026-10-28T10:00:00.000Z'), null)
  assert.equal(versionCheckDelay('', 'x'), null)
  assert.equal(versionCheckDelay('   ', 'x'), null)
  assert.equal(versionCheckDelay(undefined, 'x'), null)
  assert.equal(versionCheckDelay(42, 'x'), null)
  // Appareil sans heure de construction (développement) : il vérifie quand même.
  assert.equal(versionCheckDelay('v2', '', () => 0), 0)
})
t('filet de sécurité : 5 minutes en direct, 1 minute sinon', () => {
  assert.equal(LIVE_SYNC_MS, 5 * 60_000)
  assert.equal(SYNC_MS, 60_000)
  assert.equal(syncEvery(true), LIVE_SYNC_MS)
  assert.equal(syncEvery(false), SYNC_MS)
  const t0 = 1_000_000
  assert.ok(dueForSync(t0, 0, true), 'jamais synchronisé : tout de suite')
  assert.ok(!dueForSync(t0 + 4 * 60_000, t0, true))
  assert.ok(dueForSync(t0 + 5 * 60_000, t0, true))
  assert.ok(!dueForSync(t0 + 59_000, t0, false))
  assert.ok(dueForSync(t0 + 60_000, t0, false))
  // Le direct tombe : la cadence resserre aussitôt.
  assert.ok(dueForSync(t0 + 90_000, t0, false) && !dueForSync(t0 + 90_000, t0, true))
})

// ---------- Signaux ----------

t('signal : table connue, repères facultatifs ; mal formé ou table inconnue : ignoré', () => {
  assert.deepEqual(parseSignal({ t: 'players', id: 'p-1', v: '2026-10-28T10:00:00.123456+00:00' }, SYNC_TABLES), { table: 'players', id: 'p-1', v: '2026-10-28T10:00:00.123456+00:00' })
  assert.deepEqual(parseSignal({ t: 'seen' }, SYNC_TABLES), { table: 'seen' })
  assert.equal(parseSignal({ t: 'hb_players' }, SYNC_TABLES), null, 'nom court attendu')
  assert.equal(parseSignal({ t: 'profiles' }, SYNC_TABLES), null, 'table jamais synchronisée')
  assert.equal(parseSignal({ t: 'players', id: 3 }, SYNC_TABLES)!.id, undefined, 'identifiant non texte ignoré')
  assert.equal(parseSignal(null, SYNC_TABLES), null)
  assert.equal(parseSignal('players', SYNC_TABLES), null)
  assert.equal(parseSignal({}, SYNC_TABLES), null)
})
t('signal avec contenu (configuration, critères, niveaux) : la ligne est lue ; contenu mal formé : signal simple', () => {
  const s = parseSignal({ t: 'criteria', id: 'taille', v: 'x', ligne: { id: 'taille', data: { id: 'taille', label: 'Taille', updatedAt: 5 }, deleted: false, server_updated_at: 'x' } }, SYNC_TABLES)
  assert.deepEqual(s, { table: 'criteria', id: 'taille', v: 'x', row: { id: 'taille', data: { id: 'taille', label: 'Taille', updatedAt: 5 }, deleted: false, server_updated_at: 'x' } })
  assert.equal(parseSignal({ t: 'criteria', ligne: { id: 'taille' } }, SYNC_TABLES)!.row, undefined)
  assert.equal(parseSignal({ t: 'criteria', ligne: { id: 'taille', data: [1] } }, SYNC_TABLES)!.row, undefined)
  assert.equal(parseSignal({ t: 'criteria', ligne: 'x' }, SYNC_TABLES)!.row, undefined)
  assert.deepEqual([...CONTENT_TABLES], ['config', 'criteria', 'levels'])
})

// ---------- Plan de relecture ----------

t('quoi de neuf : true relu, false rien, null table inconnue, clé absente relue ; tables jamais reçues toujours relues', () => {
  const tables = ['players', 'criteria', 'seen', 'saved_questions', 'config'] as const
  const plan = planPull(tables, new Set(['config']), { players: true, criteria: false, seen: null, config: false })
  assert.deepEqual(plan, { pull: ['players', 'saved_questions', 'config'], absent: ['seen'], quiet: ['criteria'] })
})
t('quoi de neuf : sans réponse (fonction absente, erreur), tout est relu comme avant', () => {
  const tables = ['players', 'criteria'] as const
  assert.deepEqual(planPull(tables, new Set(), null), { pull: ['players', 'criteria'], absent: [], quiet: [] })
  assert.deepEqual(planPull([], new Set(), { players: true }), { pull: [], absent: [], quiet: [] })
})

// ---------- Lignes reçues ----------

t('lignes reçues : absente écrite, plus récente écrite, identique ou plus ancienne ignorée, effacée toujours appliquée', () => {
  const rows = [
    { id: 'a', data: { id: 'a', updatedAt: 10, x: 1 } },
    { id: 'b', data: { id: 'b', updatedAt: 10, x: 2 } },
    { id: 'c', data: { id: 'c', updatedAt: 10, x: 3 } },
    { id: 'd', data: { id: 'd', updatedAt: 5, x: 4 } },
    { id: 'e', data: { id: 'e', purged: true } },
    { id: 'f', data: { id: 'f', updatedAt: 10, x: 6, deleted: true } },
    { id: 'g', data: { id: 'g', updatedAt: 10, x: 7 } },
  ]
  const locals = [
    undefined, // a : absente
    { id: 'b', updatedAt: 10, x: 2 }, // b : identique
    { id: 'c', updatedAt: 9, x: 0 }, // c : plus ancienne sur l'appareil
    { id: 'd', updatedAt: 6, x: 0 }, // d : plus récente sur l'appareil (modification pas encore envoyée)
    { id: 'e', updatedAt: 99, x: 0 }, // e : effacée par le serveur
    { id: 'f', updatedAt: 10, x: 6 }, // f : même heure, mais supprimée : différente, appliquée
    { id: 'g', updatedAt: 10, x: 7, deleted: true }, // g : même heure, l'appareil l'a supprimée : la version reçue (non supprimée) l'emporte
  ]
  assert.deepEqual(
    keepRows(rows, locals).map((r) => r.id),
    ['a', 'c', 'e', 'f', 'g'],
  )
  assert.deepEqual(keepRows([], []), [])
})

// ---------- Regroupement ----------

/** Minuteries simulées : on avance l'horloge à la main. */
function fakeTimers() {
  let now = 0
  let seq = 0
  const pending = new Map<number, { at: number; f: () => void }>()
  const timers: Timers = {
    setTimeout: (f, ms) => {
      pending.set(++seq, { at: now + ms, f })
      return seq
    },
    clearTimeout: (id) => void pending.delete(id as number),
  }
  const advance = (ms: number) => {
    const end = now + ms
    for (;;) {
      const next = [...pending.entries()].filter(([, p]) => p.at <= end).sort((a, b) => a[1].at - b[1].at)[0]
      if (!next) break
      now = next[1].at
      pending.delete(next[0])
      next[1].f()
    }
    now = end
  }
  return { timers, advance, now: () => now, pending: () => pending.size }
}

t('regroupement : plusieurs signaux en 1,5 s = une seule relecture, avec toutes les tables', () => {
  const runs: string[][] = []
  const ft = fakeTimers()
  const g = new Grouper<string>((tables) => runs.push([...tables].sort()), ft.timers, ft.now)
  g.add('players', 1500)
  ft.advance(500)
  g.add('measurements', 1500)
  g.add('players', 1500)
  assert.equal(g.pending, 2)
  ft.advance(999)
  assert.deepEqual(runs, [], 'pas encore')
  ft.advance(1)
  assert.deepEqual(runs, [['measurements', 'players']])
  assert.equal(g.pending, 0)
  // Le groupe suivant repart de zéro.
  g.add('seen', 1500)
  ft.advance(1500)
  assert.deepEqual(runs, [['measurements', 'players'], ['seen']])
})
t('regroupement : la première échéance l’emporte (un signal large retardé suit une relecture déjà prévue ; un signal ciblé avance une relecture large)', () => {
  const runs: string[][] = []
  const ft = fakeTimers()
  const g = new Grouper<string>((tables) => runs.push([...tables].sort()), ft.timers, ft.now)
  g.add('players', 1500)
  g.add('criteria', 9000) // canal large, tirage à 7,5 s
  ft.advance(1500)
  assert.deepEqual(runs, [['criteria', 'players']], 'le signal large part avec la relecture déjà prévue')
  g.add('config', 9000)
  ft.advance(3000)
  g.add('seen', 1500) // échéance à 4,5 s < 9 s
  ft.advance(1500)
  assert.deepEqual(runs[1], ['config', 'seen'])
  assert.equal(ft.pending(), 0, 'aucune minuterie oubliée')
})
t('regroupement : annulation (déconnexion) ; délai négatif ramené à 0', () => {
  const runs: string[][] = []
  const ft = fakeTimers()
  const g = new Grouper<string>((tables) => runs.push([...tables]), ft.timers, ft.now)
  g.add('players', 1500)
  g.cancel()
  ft.advance(5000)
  assert.deepEqual(runs, [])
  assert.equal(ft.pending(), 0)
  g.add('players', -5)
  ft.advance(0)
  assert.deepEqual(runs, [['players']])
})

// ---------- Envoi des signaux par l'appareil qui écrit ----------

// Base locale fictive : deux joueurs (club du Var, joueur sans licence du 13), une unité organisatrice, un staff.
const LOOK: ChannelLookup = {
  player: (id) =>
    ({ p1: { clubCode: '6383015' }, p2: { department: '13' }, p3: { license: '6401002123456' } } as Record<string, { clubCode?: string; license?: string; department?: string }>)[id],
  territory: (id) => (id === 'unite-83' ? { depts: ['83'], clubs: [] } : undefined),
  teamMembers: (ids) => (ids.includes('staff-1') ? ['u7', 'u8'] : []),
}
const row = (id: string, extra: Record<string, unknown> = {}): SentRow => ({ id, updatedAt: 1, createdBy: 'u1', ...extra })

t('canaux d’une ligne : joueurs et lignes rattachées (département, club, auteur, tout)', () => {
  assert.deepEqual(rowChannels('players', row('p1', { clubCode: '6383015' }), LOOK), ['hb:club:6383015', 'hb:compte:u1', 'hb:dept:83', 'hb:tout'])
  // Licence d'outre-mer : le territoire (6401… → 971), comme hb_player_dept.
  assert.deepEqual(rowChannels('players', row('p3', { license: '6401002123456' }), LOOK), ['hb:club:6401002', 'hb:compte:u1', 'hb:dept:971', 'hb:tout'])
  // Fiche proposée sans licence : département saisi, pas de club.
  assert.deepEqual(rowChannels('players', row('p2', { department: '13' }), LOOK), ['hb:compte:u1', 'hb:dept:13', 'hb:tout'])
  for (const table of ['measurements', 'evaluations', 'seen', 'rewatch'] as const) {
    assert.deepEqual(rowChannels(table, row('x', { playerId: 'p1' }), LOOK), ['hb:club:6383015', 'hb:compte:u1', 'hb:dept:83', 'hb:tout'], table)
  }
  // Joueur absent de l'appareil : tout et l'auteur (le filet de sécurité rattrape le reste).
  assert.deepEqual(rowChannels('evaluations', row('x', { playerId: 'inconnu' }), LOOK), ['hb:compte:u1', 'hb:tout'])
  assert.deepEqual(rowChannels('videos', row('v', { targetKind: 'player', targetId: 'p2' }), LOOK), ['hb:compte:u1', 'hb:dept:13', 'hb:tout'])
  assert.deepEqual(rowChannels('videos', row('v', { targetKind: 'event', targetId: 'e1' }), LOOK), [STAFF_TOPIC])
})

t('canaux d’une ligne : comptes, groupes, alertes, événements, tables communes', () => {
  assert.deepEqual(rowChannels('follows', row('f'), LOOK), ['hb:compte:u1'])
  assert.deepEqual(rowChannels('saved_questions', row('q'), LOOK), ['hb:compte:u1'])
  assert.deepEqual(rowChannels('teams', row('s', { members: ['u2', 'u3'] }), LOOK), ['hb:compte:u1', 'hb:compte:u2', 'hb:compte:u3'])
  assert.deepEqual(rowChannels('groups', row('g', { private: true }), LOOK), ['hb:compte:u1'])
  assert.deepEqual(rowChannels('groups', row('g', { team: true, editors: ['u2'], teams: ['staff-1'] }), LOOK), ['hb:compte:u1', 'hb:compte:u2', 'hb:compte:u7', 'hb:compte:u8'])
  assert.deepEqual(rowChannels('groups', row('g'), LOOK), ['hb:compte:u1', STAFF_TOPIC])
  assert.deepEqual(rowChannels('alerts', row('a', { private: true }), LOOK), ['hb:compte:u1'])
  assert.deepEqual(rowChannels('alerts', row('a'), LOOK), [STAFF_TOPIC])
  // Événement sans organisateur : tout le staff ; avec : tout, territoire, joueurs inscrits, auteur, participants.
  assert.deepEqual(rowChannels('events', row('e', { playerIds: ['p1'] }), LOOK), [STAFF_TOPIC])
  assert.deepEqual(rowChannels('events', row('e', { organizerUnitId: 'unite-83', playerIds: ['p1', 'p2'], editors: ['u2'] }), LOOK), [
    'hb:club:6383015',
    'hb:compte:u1',
    'hb:compte:u2',
    'hb:dept:13',
    'hb:dept:83',
    'hb:tout',
  ])
  // Unité inconnue de l'appareil : le staff ET tout (le serveur dirait l'un ou l'autre).
  assert.deepEqual(rowChannels('events', row('e', { organizerUnitId: 'unite-x' }), LOOK), ['hb:compte:u1', STAFF_TOPIC, ALL_TOPIC].sort())
  for (const table of ['criteria', 'levels', 'units', 'assignments'] as const) assert.deepEqual(rowChannels(table, row('c'), LOOK), [STAFF_TOPIC], table)
  for (const table of ['config', 'lists'] as const) assert.deepEqual(rowChannels(table, row('c'), LOOK), [COMMON_TOPIC], table)
  assert.deepEqual(rowChannels('question_log', row('l'), LOOK), [ALL_TOPIC])
  // Sans auteur : aucun canal de compte vide.
  assert.deepEqual(rowChannels('follows', { id: 'f' }, LOOK), [])
})

t('signaux d’un envoi : un par table et par canal, seulement sur les canaux ouverts, sans nom', () => {
  // Compte de club (6383015) : il écoute le commun, le sien, le staff et son club ; pas le 83, pas « tout ».
  const open = new Set(channelsOf({ uid: 'u1', role: 'observateur', scope: { all: false, depts: [], clubs: ['6383015'] } }))
  const evals = [1, 2, 3].map((i) => row(`ev${i}`, { playerId: 'p1', comment: 'Texte libre', createdByName: 'Coach Un' }))
  const out = outgoingSignals([{ table: 'evaluations', rows: evals }, { table: 'players', rows: [row('p1', { clubCode: '6383015', lastName: 'Fictif' })] }], open, LOOK, '2026-10-28T12:00:00.000Z')
  assert.deepEqual(
    out.map((m) => `${m.event} ${m.payload.t} ${m.topic}`).sort(),
    ['signal evaluations hb:club:6383015', 'signal evaluations hb:compte:u1', 'signal players hb:club:6383015', 'signal players hb:compte:u1'],
  )
  // Jamais un canal non écouté (le serveur le refuserait : règle hb_emettre).
  for (const m of out) assert.ok(open.has(m.topic), m.topic)
  // Charge utile : {t, id, v} et les identifiants envoyés (relus par identifiant), rien d'autre (ni nom, ni texte, ni contenu :
  // pas de ligne enregistrée renvoyée par le serveur ici).
  for (const m of out) assert.deepEqual(Object.keys(m.payload).sort(), ['id', 'ids', 't', 'v'])
  assert.deepEqual(out.find((m) => m.payload.t === 'evaluations')!.payload.ids, ['ev1', 'ev2', 'ev3'])
  assert.ok(!JSON.stringify(out).includes('Fictif') && !JSON.stringify(out).includes('Coach') && !JSON.stringify(out).includes('Texte'))
  // Même table en deux paquets : toujours un seul signal par canal.
  const twice = outgoingSignals([{ table: 'evaluations', rows: evals.slice(0, 1) }, { table: 'evaluations', rows: evals.slice(1) }], open, LOOK, 'v')
  assert.equal(twice.length, 2)
  // Aucun canal ouvert (direct pas encore abonné) : rien.
  assert.deepEqual(outgoingSignals([{ table: 'evaluations', rows: evals }], new Set(), LOOK, 'v'), [])
  // Le signal se lit comme ceux que la base envoyait ({t, id, v}), plus les identifiants (signal ciblé).
  assert.deepEqual(parseSignal(out[0].payload, SYNC_TABLES), { table: out[0].payload.t, id: out[0].payload.id, v: '2026-10-28T12:00:00.000Z', targeted: true, ids: out[0].payload.ids })
})

t('signaux d’un envoi : contenu pour configuration, critères et niveaux, sans les noms ; au-delà de CONTENT_MAX, un signal', () => {
  const open = new Set(channelsOf({ uid: 'u1', role: 'admin', scope: { all: true, depts: [], clubs: [] } }))
  const crit = row('c1', { label: 'Vision du jeu', createdByName: 'Coach Un', updatedByName: 'Coach Deux', deleted: false })
  const out = outgoingSignals([{ table: 'criteria', rows: [crit] }, { table: 'config', rows: [row('cfg', { value: 1, deleted: true })] }], open, LOOK, 'v')
  assert.deepEqual(out.map((m) => `${m.event} ${m.payload.t} ${m.topic}`).sort(), ['ligne config hb:commun', 'ligne criteria hb:staff'])
  const c = out.find((m) => m.payload.t === 'criteria')!
  assert.deepEqual(c.payload.ligne, { id: 'c1', data: { id: 'c1', updatedAt: 1, createdBy: 'u1', label: 'Vision du jeu', deleted: false }, deleted: false })
  assert.equal(out.find((m) => m.payload.t === 'config')!.payload.ligne!.deleted, true)
  // Reçu par un autre appareil : une ligne à appliquer (parseSignal), comme avant.
  const s = parseSignal(c.payload, SYNC_TABLES)!
  assert.equal(s.row!.id, 'c1')
  assert.equal(s.row!.data.label, 'Vision du jeu')
  // Import de critères : un seul signal, sans contenu.
  const many = Array.from({ length: CONTENT_MAX + 1 }, (_, i) => row(`c${i}`))
  const big = outgoingSignals([{ table: 'criteria', rows: many }], open, LOOK, 'v')
  assert.deepEqual(big.map((m) => `${m.event} ${m.topic}`), ['signal hb:staff'])
  assert.equal(big[0].payload.ligne, undefined)
  // Mesures (pas une table de contenu) : jamais de contenu.
  assert.ok(outgoingSignals([{ table: 'measurements', rows: [row('m', { playerId: 'p1', value: 180 })] }], open, LOOK, 'v').every((m) => m.event === 'signal' && !m.payload.ligne))
})

t('ligne gardée pour la signaler : les champs des canaux seulement (même résultat), la ligne entière pour le contenu', () => {
  const rows: [Parameters<typeof rowChannels>[0], SentRow][] = [
    ['players', row('p1', { clubCode: '6383015', firstName: 'Prénom', lastName: 'Fictif', photo: 'data:…', notes: 'Texte libre' })],
    ['evaluations', row('ev', { playerId: 'p1', comment: 'Texte libre', scores: { tir: 4 } })],
    ['events', row('e', { name: 'Stage', organizerUnitId: 'unite-83', playerIds: ['p1', 'p2'], editors: ['u2'], teams: ['staff-1'] })],
    ['groups', row('g', { name: 'Équipe', team: true, editors: ['u2'], teams: ['staff-1'], playerIds: ['p1'] })],
    ['videos', row('v', { targetKind: 'player', targetId: 'p2', url: 'https://exemple.test/v' })],
    ['teams', row('s', { name: 'Staff', members: ['u2'] })],
    ['alerts', row('a', { private: true, text: 'Texte' })],
  ]
  for (const [table, r] of rows) {
    const kept = forSignal(table, r)
    assert.deepEqual(rowChannels(table, kept, LOOK), rowChannels(table, r, LOOK), table)
    for (const k of ['firstName', 'lastName', 'photo', 'notes', 'comment', 'scores', 'name', 'url', 'text']) assert.ok(!(k in kept), `${table} : ${k}`)
  }
  const crit = row('c1', { label: 'Vision du jeu' })
  assert.equal(forSignal('criteria', crit), crit)
})

// ---------- Première synchronisation allégée (essai de charge du 29/10) ----------

t('avancement sans comptage : chaque table une part égale, pages qui rapprochent de la fin, 100 % seulement à la fin', () => {
  const per: Partial<Record<'players' | 'criteria' | 'measurements', TableProgress>> = { players: startTable(), criteria: startTable(), measurements: startTable() }
  const shares: number[] = []
  const step = () => {
    const a = aggregate(per, 'players', true)
    shares.push(a.share)
    return a
  }
  assert.deepEqual(step(), { table: 'players', done: 0, share: 0, first: true })
  // Joueurs : 3 pages pleines puis une dernière courte.
  for (let i = 0; i < 3; i++) {
    per.players!.done += PULL_PAGE
    per.players!.pages++
    step()
  }
  assert.equal(tableShare(per.players!), 3 / 4)
  per.players!.done += 120
  per.players!.pages++
  per.players!.finished = true
  step()
  // Critères : une page courte ; mesures : une page pleine, puis une page vide (table finie sans page de plus).
  Object.assign(per.criteria!, { done: 12, pages: 1, finished: true })
  step()
  Object.assign(per.measurements!, { done: PULL_PAGE, pages: 1 })
  const before = step()
  assert.ok(before.share < 1 && percent(before) < 100, 'pas 100 % avant la fin')
  per.measurements!.finished = true
  const end = step()
  assert.equal(end.share, 1)
  assert.equal(percent(end), 100)
  assert.equal(end.done, 3 * PULL_PAGE + 120 + 12 + PULL_PAGE)
  for (let i = 1; i < shares.length; i++) assert.ok(shares[i] >= shares[i - 1], `jamais en arrière (${i})`)
  // Rien de suivi : 0.
  assert.equal(aggregate({}).share, 0)
})
t('avancement : une table en gros retard qui s’ajoute ne fait pas reculer la barre ; affichée au-delà de 2 000 éléments', () => {
  const per: Partial<Record<'players' | 'seen', TableProgress>> = { players: { done: 5000, pages: 5, finished: true } }
  const shown = aggregate(per, 'players', false)
  assert.equal(shown.share, 1)
  per.seen = { done: PULL_PAGE, pages: 1, finished: false }
  const next = aggregate(per, 'seen', false)
  assert.ok(next.share < shown.share)
  assert.equal(forward(shown, next).share, shown.share)
  assert.equal(forward(shown, next).done, 6000)
  assert.equal(forward(null, next), next)
  assert.equal(showProgress({ table: null, done: PROGRESS_MIN, share: 0.5, first: true }), false)
  assert.equal(showProgress({ table: null, done: PROGRESS_MIN + 1, share: 0.5, first: true }), true)
  assert.equal(showProgress(null), false)
  const flat = (x: string) => x.replace(/\s/g, ' ')
  assert.equal(flat(progressLabel({ table: 'measurements', done: 23000, share: 0.4, first: true })), 'Premier chargement : 23 000 éléments reçus (mesures)')
  assert.equal(flat(progressLabel({ table: null, done: 1, share: 0.1, first: false })), 'Mise à jour : 1 élément reçu')
})

/** Serveur fictif : lignes triées (server_updated_at, id), page suivante strictement après le repère, plafond par réponse. */
function fakeServer(n: number, cap: number, tie = 7) {
  const rows = Array.from({ length: n }, (_, i) => ({
    id: `r${String(i).padStart(6, '0')}`,
    // Plusieurs lignes à la même heure (import, transaction) : des égalités à cheval sur deux pages.
    server_updated_at: `2026-10-29T20:${String(Math.floor(i / tie / 60) % 60).padStart(2, '0')}:${String(Math.floor(i / tie) % 60).padStart(2, '0')}.000000+00:00`,
    data: { id: `r${i}` },
  })).sort((a, b) => a.server_updated_at.localeCompare(b.server_updated_at) || a.id.localeCompare(b.id))
  const calls: (PageKey | null)[] = []
  const fetch = async (after: PageKey | null) => {
    calls.push(after)
    const from = after ? rows.filter((r) => r.server_updated_at > after.at || (r.server_updated_at === after.at && r.id > after.id)) : rows
    return from.slice(0, Math.min(PULL_PAGE, cap)) // limit=PULL_PAGE, coupé au plafond du serveur (db-max-rows)
  }
  return { rows, calls, fetch }
}

t('lecture par pages : correcte quand le serveur plafonne à 1 000 lignes par réponse (égalités d’heure à cheval sur deux pages)', async () => {
  // Supabase (et PGRST_DB_MAX_ROWS du serveur autohébergé) : 1 000. PULL_PAGE ne doit jamais dépasser ce plafond.
  assert.ok(PULL_PAGE <= 1000)
  for (const [n, requests] of [[0, 1], [1, 1], [999, 1], [1000, 2], [1001, 2], [2500, 3], [3000, 4]] as const) {
    const srv = fakeServer(n, 1000)
    const got: string[] = []
    const received = await readPages(srv.fetch, (page) => {
      got.push(...page.map((r) => r.id))
    })
    assert.equal(received, n, `${n} lignes`)
    assert.deepEqual(got, srv.rows.map((r) => r.id), `${n} lignes : toutes, une fois, dans l'ordre`)
    assert.equal(srv.calls.length, requests, `${n} lignes : ${requests} requête(s)`)
  }
  // Serveur sans plafond (db-max-rows non réglé) : même résultat (la limite de la requête suffit).
  const free = fakeServer(2500, Infinity)
  let count = 0
  assert.equal(await readPages(free.fetch, (page) => void (count += page.length)), 2500)
  assert.equal(count, 2500)
})

t('affectations : toutes pour un administrateur, les siennes pour les autres ; signature changée → relues depuis le début', () => {
  assert.equal(assignmentScope('admin'), 'all')
  for (const r of ['preparateur', 'observateur', 'joueur', null, undefined, '']) assert.equal(assignmentScope(r), 'mine', String(r))
  assert.equal(assignmentScopeKey('admin', 'u1'), 'all')
  assert.equal(assignmentScopeKey('observateur', 'u1'), 'mine:u1')
  // Rôle encore inconnu (premier lancement) : les siennes ; devenu administrateur : tout relire.
  assert.equal(assignmentScopeKey(null, 'u1'), 'mine:u1')
  assert.deepEqual(planAssignmentScope('mine:u1', 'mine:u1'), { reset: false, forgetOthers: false })
  assert.deepEqual(planAssignmentScope('all', 'all'), { reset: false, forgetOthers: false })
  assert.deepEqual(planAssignmentScope('mine:u1', 'all'), { reset: true, forgetOthers: false })
  // Administrateur retiré, ou appareil d'avant ce tri (il avait tout) : les autres quittent l'appareil.
  assert.deepEqual(planAssignmentScope('all', 'mine:u1'), { reset: true, forgetOthers: true })
  assert.deepEqual(planAssignmentScope(null, 'mine:u1'), { reset: true, forgetOthers: true })
  assert.deepEqual(planAssignmentScope(null, 'all'), { reset: true, forgetOthers: false })
  const rows = [
    { id: 'a1', userId: 'u1' },
    { id: 'a2', userId: 'u2' },
    { id: 'a3', userId: 'u3' },
    { id: 'a4' },
  ]
  // Jamais une affectation qui attend d'être envoyée (a3).
  assert.deepEqual(otherAssignmentIds(rows, 'u1', new Set(['a3'])), ['a2', 'a4'])
})

t('quoi de neuf : affectations du compte sous « mes_affectations », réponse ramenée à la table ; serveur sans la clé : relue', () => {
  assert.equal(MY_ASSIGNMENTS_KEY, 'mes_affectations')
  assert.deepEqual(whatsNewRequest({ players: 'p', assignments: 'a' }, true), { players: 'p', mes_affectations: 'a' })
  assert.deepEqual(whatsNewRequest({ players: 'p', assignments: 'a' }, false), { players: 'p', assignments: 'a' })
  assert.deepEqual(whatsNewRequest({ seen: null }, false), { seen: '' })
  assert.deepEqual(whatsNewAnswer({ players: true, mes_affectations: false }, true), { players: true, assignments: false })
  assert.deepEqual(whatsNewAnswer({ players: true, assignments: false }, false), { players: true, assignments: false })
  assert.equal(whatsNewAnswer(null, true), null)
  assert.equal(whatsNewAnswer([true], true), null)
  const tables = ['players', 'assignments'] as const
  // Rien de neuf parmi les siennes : pas de relecture, même si d'autres affectations ont changé.
  assert.deepEqual(planPull(tables, new Set(), whatsNewAnswer({ players: false, mes_affectations: false }, true)), { pull: [], absent: [], quiet: ['players', 'assignments'] })
  // Serveur avec l'ancienne version de 057 (clé ignorée, absente de la réponse) : prudence, relue (une requête, les siennes).
  assert.deepEqual(planPull(tables, new Set(), whatsNewAnswer({ players: false }, true)), { pull: ['assignments'], absent: [], quiet: ['players'] })
  // Table inconnue du serveur.
  assert.deepEqual(planPull(tables, new Set(), whatsNewAnswer({ players: false, mes_affectations: null }, true)), { pull: [], absent: ['assignments'], quiet: ['players'] })
})

t('appli : plus aucun comptage à la synchronisation ; affectations filtrées sur le compte ; lecture à la demande pour Structure', () => {
  const sync = readFileSync(new URL('../src/sync.ts', import.meta.url), 'utf8').replace(/^\s*(\/\/|\*).*$/gm, '')
  assert.ok(!/count:\s*['"](exact|estimated|planned)['"]/.test(sync), 'aucun count=…')
  assert.ok(!/head:\s*true/.test(sync), 'aucune requête HEAD')
  // Filtre sur la colonne user_id (index utilisable sous les règles de lecture) ; serveur sans elle : data->>userId.
  assert.ok(sync.includes("select.eq('user_id', uid)") && sync.includes("select.eq('data->>userId', uid)"), 'affectations du compte : user_id, à défaut data->>userId')
  assert.ok(/error\.code === '42703'/.test(sync), 'repli seulement sur colonne inconnue')
  assert.ok(sync.includes('export function fetchAllAssignments'))
  const structure = readFileSync(new URL('../src/components/Structure.tsx', import.meta.url), 'utf8')
  assert.ok(structure.includes('fetchAllAssignments') && structure.includes('deviceHasAllAssignments'), 'écran Structure : liste complète à la demande')
  // 057 : la même clé, filtrée sur le compte connecté.
  const sql = readFileSync(new URL('../supabase/057_synchro_legere.sql', import.meta.url), 'utf8').replace(/^\s*--.*$/gm, '')
  assert.ok(sql.includes(`if t = '${MY_ASSIGNMENTS_KEY}' then`))
  assert.ok(sql.includes("v_mine := ' and user_id = $2';"))
  // Colonne générée (copie de data.userId) et index, relançables.
  assert.ok(sql.includes("add column if not exists user_id text generated always as (data ->> 'userId') stored"))
  assert.ok(sql.includes('create index if not exists hb_assignments_mine on public.hb_assignments (user_id, server_updated_at, id)'))
})

// ---------- Le script SQL, écrit comme l'appli l'attend ----------

t('057 : mêmes canaux, mêmes tables que l’appli ; plus de diffusion par la base ; écoute et envoi sur ses canaux', () => {
  const sql = readFileSync(new URL('../supabase/057_synchro_legere.sql', import.meta.url), 'utf8')
  const code = sql.replace(/^\s*--.*$/gm, '') // sans les commentaires
  for (const c of [COMMON_TOPIC, STAFF_TOPIC, ALL_TOPIC, "'hb:dept:' ||", "'hb:club:' ||", "'hb:compte:' ||", "'hb:joueur:' ||"]) assert.ok(code.includes(c), c)
  // Annonce de version : toujours envoyée par la base, sur le canal commun.
  assert.ok(code.includes("'version', 'hb:commun'"))
  // Liste blanche de hb_quoi_de_neuf et retrait des déclencheurs : toutes les tables synchronisées, et seulement elles.
  const lists = [...code.matchAll(/array\[('[a-z_]+'(?:,\s*'[a-z_]+')*)\]/g)].map((m) => [...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]))
  const whitelists = lists.filter((l) => l.includes('players') && l.includes('saved_questions'))
  assert.ok(whitelists.length >= 2, 'liste blanche et retrait des déclencheurs')
  for (const l of whitelists) assert.deepEqual([...l].sort(), [...SYNC_TABLES].sort())
  // Plus de diffusion par la base : déclencheurs retirés (relançable), fonction retirée, aucun déclencheur posé.
  assert.ok(code.includes("drop trigger if exists hb_diffuser on public.hb_%1$s"))
  assert.ok(code.includes('drop function if exists public.hb_diffuser();'))
  assert.ok(!/create (or replace )?(function public\.hb_diffuser|trigger)/.test(code))
  assert.ok(!code.includes('realtime.send(v_charge'))
  // Recouvrement : la même prudence que l'appli (60 s quand le curseur a moins de 5 minutes).
  assert.ok(code.includes("interval '60 seconds'") && code.includes("interval '5 minutes'"))
  // Canaux privés : écoute (select) et envoi (insert) sur ses seuls canaux, broadcast seulement ; rien d'autre.
  const rule = "realtime.messages.extension = 'broadcast' and realtime.topic() = any ((select public.hb_mes_canaux())::text[])"
  assert.ok(code.includes(`create policy "hb_recevoir" on realtime.messages for select to authenticated\n      using (${rule})`))
  // Envoi : en plus, seulement un compte du staff (un compte joueur ou sans rôle n'écrit jamais, il n'a rien à signaler).
  assert.ok(code.includes(`create policy "hb_emettre" on realtime.messages for insert to authenticated\n      with check (${rule} and (select public.hb_has_role()))`))
  assert.equal([...code.matchAll(/create policy [^;]* on realtime\.messages/g)].length, 2)
  assert.ok(!/on realtime\.messages for (all|update|delete)/.test(code))
  // Relançable : les deux règles sont retirées avant d'être reposées.
  assert.ok(code.includes(`drop policy if exists "hb_recevoir" on realtime.messages`) && code.includes(`drop policy if exists "hb_emettre" on realtime.messages`))
})

// ---------- Ligne dans le signal (série 5 du 29/10) ----------

// Lignes telles que le serveur les a enregistrées (réponse de hb_upsert_lignes) : mesure d'un joueur du club 6383015 (83),
// « vu » d'un joueur du 13, fiche du 971. Données fictives.
const stored = (id: string, scope_dept: string | null, scope_club: string | null, extra: Record<string, unknown> = {}): ServerRow => ({
  id,
  data: { id, updatedAt: 10, createdBy: 'u1', createdByName: 'Coach Un', ...extra },
  deleted: false,
  server_updated_at: '2026-10-29T21:40:00.123456+00:00',
  scope_dept,
  scope_club,
})

t('ligne dans le signal : tables concernées (périmètre exactement), tables relues par identifiant', () => {
  assert.deepEqual([...ROW_TABLES].sort(), ['evaluations', 'measurements', 'players', 'seen'])
  // Seulement des tables du périmètre (046), et jamais « à revoir » ni les vidéos (règle de lecture différente du périmètre).
  for (const t of ROW_TABLES) assert.ok((SCOPED_TABLES as readonly string[]).includes(t), t)
  assert.ok(!ROW_TABLES.includes('rewatch') && !ROW_TABLES.includes('videos'))
  for (const t of ROW_TABLES) assert.ok(ID_TABLES.includes(t), t)
  // Relues par identifiant : toutes les tables, sauf staffs, affectations, journal, et tables de contenu (événement « ligne »).
  assert.deepEqual([...ID_TABLES, 'teams', 'assignments', 'question_log', ...CONTENT_TABLES].sort(), [...SYNC_TABLES].sort())
  assert.ok(SIGNAL_MAX_BYTES >= 4000 && SIGNAL_MAX_BYTES <= 8000, 'plafond de 4 à 8 Ko')
  assert.equal(LIVE_ROWS_MAX, 20)
})

t('ligne dans le signal : canaux où elle peut voyager (tout abonné peut la lire par la synchronisation normale)', () => {
  const m = stored('m1', '83', '6383015')
  assert.ok(rowFitsTopic('measurements', ALL_TOPIC, m))
  assert.ok(rowFitsTopic('measurements', 'hb:dept:83', m))
  assert.ok(rowFitsTopic('measurements', 'hb:club:6383015', m))
  assert.ok(rowFitsTopic('measurements', 'hb:compte:u1', m), 'son propre compte (ses autres appareils)')
  assert.ok(!rowFitsTopic('measurements', 'hb:dept:13', m), 'autre département')
  assert.ok(!rowFitsTopic('measurements', 'hb:club:6383099', m), 'autre club')
  assert.ok(!rowFitsTopic('measurements', STAFF_TOPIC, m), 'tout le staff : non (périmètre)')
  assert.ok(!rowFitsTopic('measurements', COMMON_TOPIC, m), 'commun : jamais')
  assert.ok(!rowFitsTopic('measurements', 'hb:joueur:p1', m))
  // Sans département ni club (joueur sans licence, hors de tout périmètre) : tout et son compte seulement.
  const sans = stored('m2', null, null)
  assert.ok(rowFitsTopic('measurements', ALL_TOPIC, sans) && !rowFitsTopic('measurements', 'hb:dept:', sans) && !rowFitsTopic('measurements', 'hb:club:null', sans))
  // Autres tables : jamais de contenu, même sur « tout ».
  for (const t of ['rewatch', 'videos', 'events', 'groups', 'teams', 'question_log', 'assignments'] as const) assert.ok(!rowFitsTopic(t, ALL_TOPIC, m), t)
  // Canaux d'une ligne enregistrée : son périmètre selon le serveur (pas la fiche de l'appareil, peut-être ancienne).
  assert.deepEqual(serverRowChannels('measurements', m), ['hb:club:6383015', 'hb:compte:u1', 'hb:dept:83', 'hb:tout'])
  assert.deepEqual(serverRowChannels('seen', stored('s', '13', null)), ['hb:compte:u1', 'hb:dept:13', 'hb:tout'])
  assert.deepEqual(serverRowChannels('rewatch', m), [])
})

t('signal d’un envoi avec lignes enregistrées : contenu seulement là où il peut aller, identifiants ailleurs', () => {
  // Compte de club (6383015) : il écoute le commun, le sien, le staff et son club.
  const open = new Set(channelsOf({ uid: 'u1', role: 'observateur', scope: { all: false, depts: [], clubs: ['6383015'] } }))
  const m = stored('m1', '83', '6383015', { playerId: 'p1', value: 182 })
  // La fiche de l'appareil dirait un autre club (fiche pas encore à jour) : les canaux viennent du serveur.
  const out = outgoingSignals([{ table: 'measurements', rows: [row('m1', { playerId: 'p2' })], server: [m] }], open, LOOK, 'v')
  assert.deepEqual(out.map((x) => x.topic).sort(), ['hb:club:6383015', 'hb:compte:u1'])
  for (const x of out) {
    assert.deepEqual(x.payload.lignes, [m], x.topic)
    assert.equal(x.payload.ids, undefined, 'tout est dans les lignes')
    assert.equal(x.payload.id, 'm1')
  }
  // Reçu sur le canal du club : appliqué tel quel, rien à relire.
  const s = parseSignal(out[0].payload, SYNC_TABLES)!
  assert.ok(s.targeted)
  assert.deepEqual(planLive(s, out[0].topic), { rows: [m], ids: [], table: false })
  // Une ligne d'un autre comptage (« à revoir ») ou sans ligne enregistrée : identifiants seulement.
  const rw = outgoingSignals([{ table: 'rewatch', rows: [row('r1', { playerId: 'p1' })], server: [stored('r1', '83', '6383015')] }], open, LOOK, 'v')
  assert.ok(rw.length > 0 && rw.every((x) => x.payload.lignes === undefined && x.payload.ids?.join() === 'r1'))
  assert.ok(!JSON.stringify(rw).includes('Coach'))
})

t('signal d’un envoi : plafond de taille (ligne trop grosse → identifiant ; trop d’identifiants → signal simple)', () => {
  const open = new Set([ALL_TOPIC])
  const petite = stored('p-a', '83', null)
  const grosse = stored('p-b', '83', null, { photo: 'x'.repeat(SIGNAL_MAX_BYTES) })
  const p = packSignal('players', ALL_TOPIC, ['p-a', 'p-b'], new Map([['p-a', petite], ['p-b', grosse]]), 'v')
  assert.deepEqual(p.lignes?.map((r) => r.id), ['p-a'])
  assert.deepEqual(p.ids, ['p-b'])
  assert.ok(new TextEncoder().encode(JSON.stringify(p)).length <= SIGNAL_MAX_BYTES)
  // Plusieurs lignes : on remplit jusqu'au plafond, le reste en identifiants ; jamais au-delà du plafond (accents compris).
  const many = Array.from({ length: 40 }, (_, i) => stored(`m${i}`, '83', null, { note: 'é'.repeat(150) }))
  const q = packSignal('measurements', ALL_TOPIC, many.map((r) => r.id), new Map(many.map((r) => [r.id, r])), 'v')
  assert.ok(q.lignes!.length > 0 && q.ids!.length > 0)
  assert.equal(q.lignes!.length + q.ids!.length, 40)
  assert.ok(new TextEncoder().encode(JSON.stringify(q)).length <= SIGNAL_MAX_BYTES)
  // Un import (des centaines d'identifiants) : signal simple, la table est relue par curseur.
  const ids = Array.from({ length: 300 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`)
  assert.deepEqual(packSignal('measurements', ALL_TOPIC, ids, new Map(), 'v'), { t: 'measurements', id: ids[0], v: 'v' })
  // Staffs, affectations, journal : jamais d'identifiants (relus autrement) : signal simple.
  assert.deepEqual(packSignal('teams', 'hb:compte:u1', ['s1'], new Map(), 'v'), { t: 'teams', id: 's1', v: 'v' })
  assert.deepEqual(outgoingSignals([{ table: 'teams', rows: [row('s1')] }], new Set(['hb:compte:u1']), LOOK, 'v')[0].payload, { t: 'teams', id: 's1', v: 'v' })
  void open
})

t('signal reçu : table inconnue refusée, lignes lues et contrôlées, relecture ciblée seulement des identifiants', () => {
  const m = stored('m1', '83', '6383015')
  // Table inconnue : refusée, même avec des lignes.
  assert.equal(parseSignal({ t: 'profiles', id: 'x', v: 'v', lignes: [m] }, SYNC_TABLES), null)
  assert.equal(parseSignal({ t: 'hb_measurements', lignes: [m] }, SYNC_TABLES), null)
  // Signal ciblé : lignes et identifiants.
  const s = parseSignal({ t: 'measurements', id: 'm1', v: 'v', lignes: [m], ids: ['m9'] }, SYNC_TABLES)!
  assert.deepEqual(s, { table: 'measurements', id: 'm1', v: 'v', targeted: true, rows: [m], ids: ['m9'] })
  // Sur le canal du club : la ligne appliquée, m9 relu par identifiant (sans recouvrement : pas la table).
  assert.deepEqual(planLive(s, 'hb:club:6383015'), { rows: [m], ids: ['m9'], table: false })
  // Arrivée sur un canal où elle n'a rien à faire (un autre club) : pas appliquée, relue avec les droits du destinataire.
  assert.deepEqual(planLive(s, 'hb:club:6383099'), { rows: [], ids: ['m9', 'm1'], table: false })
  assert.deepEqual(planLive(s, STAFF_TOPIC), { rows: [], ids: ['m9', 'm1'], table: false })
  // Ancien format ({t, id, v}) : relecture de la table par curseur, comme avant.
  assert.deepEqual(planLive(parseSignal({ t: 'measurements', id: 'm1', v: 'v' }, SYNC_TABLES)!, 'hb:club:6383015'), { rows: [], ids: [], table: true })
  // Table relue autrement (staffs) : toujours par curseur, lignes ignorées.
  assert.equal(planLive(parseSignal({ t: 'teams', lignes: [stored('s1', null, null)] }, SYNC_TABLES)!, 'hb:compte:u1').table, true)
  // Ligne mal formée (identifiant de data différent, data tableau) : le signal n'est plus complet, la table est relue.
  const bad = parseSignal({ t: 'measurements', lignes: [{ id: 'm1', data: { id: 'm2' } }] }, SYNC_TABLES)!
  assert.equal(bad.targeted, false)
  assert.equal(planLive(bad, ALL_TOPIC).table, true)
  assert.equal(readServerRow({ id: 'm1', data: [1] }), null)
  assert.equal(readServerRow({ id: '', data: {} }), null)
  assert.deepEqual(readServerRow({ id: 'm1', data: { v: 1 }, scope_dept: null, scope_club: 5 }), { id: 'm1', data: { v: 1 }, scope_dept: null })
  // Identifiants seuls (ligne trop grosse) : relus, rien appliqué.
  assert.deepEqual(planLive(parseSignal({ t: 'players', ids: ['p1', 'p1', 'p2'] }, SYNC_TABLES)!, ALL_TOPIC), { rows: [], ids: ['p1', 'p2'], table: false })
})

t('ligne reçue : fusion (plus récente appliquée, plus ancienne ou identique ignorée, envoi en attente jamais écrasé)', () => {
  const now = 1_000_000
  const rows = [
    { id: 'a', data: { id: 'a', updatedAt: 20, v: 1 } }, // plus récente que l'appareil
    { id: 'b', data: { id: 'b', updatedAt: 5, v: 2 } }, // plus ancienne que l'appareil
    { id: 'c', data: { id: 'c', updatedAt: 10, v: 3 } }, // identique
    { id: 'd', data: { id: 'd', updatedAt: 30, v: 4 } }, // plus récente, mais modification locale en attente d'envoi
    { id: 'e', data: { id: 'e', updatedAt: 7, v: 5 } }, // absente de l'appareil
    { id: 'f', data: { id: 'f', updatedAt: now + FUTURE_MS + 1, v: 6 } }, // datée trop loin dans le futur
    { id: 'g', data: { id: 'g', updatedAt: 'demain' as unknown as number } }, // heure illisible
  ]
  const locals = [
    { id: 'a', updatedAt: 10, v: 0 },
    { id: 'b', updatedAt: 10, v: 0 },
    { id: 'c', updatedAt: 10, v: 3 },
    { id: 'd', updatedAt: 25, v: 0 },
    undefined,
    { id: 'f', updatedAt: 10 },
    undefined,
  ]
  const plan = liveRowsToApply(rows, locals, new Set(['d']), now)
  assert.deepEqual(plan.apply.map((r) => r.id), ['a', 'e'])
  assert.deepEqual(plan.reread, ['f', 'g'], 'trop en avance ou illisible : relue par identifiant')
})

t('ligne reçue à confirmer : la version du serveur l’emporte à la relecture, quelle que soit son heure (sauf envoi en attente)', () => {
  // L'appareil a appliqué en direct x (forgée, datée loin) et y ; le serveur rend leurs vraies versions.
  const server = [
    { id: 'x', data: { id: 'x', updatedAt: 10, v: 'vraie' } },
    { id: 'y', data: { id: 'y', updatedAt: 10, v: 'même' } },
    { id: 'z', data: { id: 'z', updatedAt: 10, v: 'serveur' } },
    { id: 'w', data: { id: 'w', updatedAt: 10, v: 'serveur' } },
  ]
  const locals = [
    { id: 'x', updatedAt: 9_999_999_999_999, v: 'forgée' },
    { id: 'y', updatedAt: 10, v: 'même' },
    { id: 'z', updatedAt: 99, v: 'locale' }, // pas reçue en direct : plus récente sur l'appareil, gardée (règle normale)
    { id: 'w', updatedAt: 99, v: 'en attente' }, // reçue en direct, mais modifiée depuis et pas encore envoyée
  ]
  const force = new Set(['x', 'y', 'w'])
  assert.deepEqual(rowsToWrite(server, locals, force, new Set(['w'])).map((r) => r.id), ['x'])
  // Sans confirmation à faire : la règle normale (keepRows).
  assert.deepEqual(rowsToWrite(server, locals, new Set(), new Set()).map((r) => r.id), [])
  // Vérification de fin de synchronisation : rendue → remplacée ; absente du serveur → retirée ; en attente → rien.
  assert.deepEqual(planVerify(['x', 'gone', 'w'], [server[0], server[3]], new Set(['w'])), { put: [server[0]], remove: ['gone'] })
})

t('lignes à confirmer : notées à la réception, confirmées par une lecture partie après, gardées sur l’appareil', () => {
  let p = markProvisional({}, 'measurements', ['m1', 'm2'], 100)
  p = markProvisional(p, 'seen', ['s1'], 200)
  assert.equal(provisionalCount(p), 3)
  // Une lecture partie à 150 confirme m1 et m2 (reçues avant), pas s1 (reçue après : peut-être plus récente que la lecture).
  assert.deepEqual([...provisionalBefore(p, 'measurements', 150)].sort(), ['m1', 'm2'])
  assert.deepEqual([...provisionalBefore(p, 'seen', 150)], [])
  p = dropProvisional(p, 'measurements', ['m1', 'm2'])
  assert.deepEqual(p, { seen: { s1: 200 } })
  assert.equal(dropProvisional(p, 'seen', ['autre']), p, 'rien à retirer : même liste')
  // Relue depuis le stockage de l'appareil ; illisible : vide.
  assert.deepEqual(readProvisional(JSON.stringify(p)), p)
  assert.deepEqual(readProvisional('pas du json'), {})
  assert.deepEqual(readProvisional(null), {})
  assert.deepEqual(readProvisional('{"seen": {"s1": "x", "s2": 3}, "x": 4}'), { seen: { s2: 3 } })
  assert.ok(PROVISIONAL_MAX >= 1000)
})

t('réponse de hb_upsert_lignes ; relectures ciblées regroupées par table', () => {
  const m = stored('m1', '83', null)
  assert.deepEqual(writeAnswer({ refusees: ['m2'], lignes: [m, { id: 'bad' }] }), { rejected: ['m2'], rows: [m] })
  assert.deepEqual(writeAnswer({ refusees: [], lignes: null }), { rejected: [], rows: null })
  // Ancienne réponse (hb_upsert : tableau des refusées).
  assert.deepEqual(writeAnswer(['m3']), { rejected: ['m3'], rows: null })
  assert.deepEqual(writeAnswer(null), { rejected: [], rows: null })
  // Identifiants avec « : » (vu : <compte>:<événement>:<joueur>) ; table inconnue ignorée.
  const keys = [liveKey('seen', 'u1:e1:p1'), liveKey('seen', 'u1:e1:p2'), liveKey('measurements', 'm1'), 'profiles:x', 'sans-table']
  assert.deepEqual([...splitLiveKeys(keys, SYNC_TABLES)], [['seen', ['u1:e1:p1', 'u1:e1:p2']], ['measurements', ['m1']]])
})

t('appli : écriture par hb_upsert_lignes, curseur jamais avancé par une ligne reçue en direct ni une relecture ciblée', () => {
  const sync = readFileSync(new URL('../src/sync.ts', import.meta.url), 'utf8')
  assert.ok(sync.includes("rpc('hb_upsert_lignes', { p_table: table, p_rows: rows, p_max: LIVE_ROWS_MAX, p_octets: SIGNAL_MAX_BYTES })"))
  // Repli sur hb_upsert quand la fonction manque (057 pas passé).
  assert.ok(/if \(!missingFunction\(r\.error\)\) return/.test(sync) && sync.includes('upsertRowsMissingAt = Date.now()'))
  const body = (name: string) => {
    const i = sync.indexOf(`async function ${name}(`)
    assert.ok(i >= 0, name)
    const j = sync.indexOf('\n}\n', i)
    return sync.slice(i, j)
  }
  for (const f of ['applyLiveRows', 'readIds', 'verifyProvisional']) assert.ok(!body(f).includes('PULL_KEY'), `${f} : pas de curseur`)
  // Relecture ciblée : par identifiant, sans filtre d'heure.
  assert.ok(body('readIds').includes(".in('id', part)") && !body('readIds').includes('server_updated_at.'))
  // 057 : la fonction, relançable, relit avec les règles de lecture de celui qui écrit.
  const sql = readFileSync(new URL('../supabase/057_synchro_legere.sql', import.meta.url), 'utf8').replace(/^\s*--.*$/gm, '')
  assert.ok(sql.includes('create or replace function public.hb_upsert_lignes(p_table text, p_rows jsonb, p_max integer default 20, p_octets integer default 6000)'))
  assert.ok(/hb_upsert_lignes[^$]*language plpgsql security invoker/.test(sql))
  assert.ok(sql.includes('grant execute on function public.hb_upsert_lignes(text, jsonb, integer, integer) to authenticated;'))
  assert.ok(sql.includes('v_refus := coalesce(public.hb_upsert(p_table, p_rows)'), 'mêmes contrôles que hb_upsert')
})

chain.then(
  () => console.log(`\n${n} tests réussis.`),
  (e) => {
    console.error(e)
    process.exit(1)
  },
)
