// Test de la synchronisation allégée (src/syncLive.ts, pendant de supabase/057_synchro_legere.sql) : canaux du compte (même
// règle que hb_mes_canaux : administrateur, fédération, comité, club, joueur, sans rôle), délais de relecture (regroupement,
// canaux larges étalés, annonce de version), cadence du filet de sécurité, lecture d'un signal, plan de relecture d'après
// « quoi de neuf ? », lignes reçues à garder, regroupement des signaux ; envoi des signaux par l'appareil qui écrit (canaux
// d'une ligne, miroir de hb_canaux_ligne ; messages groupés, seulement sur les canaux ouverts, sans nom) ; et le script SQL
// écrit comme l'appli l'attend (mêmes noms de canaux, mêmes tables, plus de diffusion par la base, règles d'écoute et
// d'envoi). Données fictives seulement.
//
//   npx jiti tools/test-synchro-legere.ts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  ALL_TOPIC,
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
  outgoingSignals,
  parseSignal,
  planPull,
  pullDelay,
  rowChannels,
  STAFF_TOPIC,
  SYNC_MS,
  syncEvery,
  VERSION_JITTER_MS,
  versionCheckDelay,
  type ChannelLookup,
  type SentRow,
  type Timers,
} from '../src/syncLive'

let n = 0
const t = (name: string, f: () => void) => {
  f()
  n++
  console.log(`ok ${n} - ${name}`)
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
  // Charge utile : {t, id, v} et rien d'autre (ni nom, ni texte, ni contenu).
  for (const m of out) assert.deepEqual(Object.keys(m.payload).sort(), ['id', 't', 'v'])
  assert.ok(!JSON.stringify(out).includes('Fictif') && !JSON.stringify(out).includes('Coach') && !JSON.stringify(out).includes('Texte'))
  // Même table en deux paquets : toujours un seul signal par canal.
  const twice = outgoingSignals([{ table: 'evaluations', rows: evals.slice(0, 1) }, { table: 'evaluations', rows: evals.slice(1) }], open, LOOK, 'v')
  assert.equal(twice.length, 2)
  // Aucun canal ouvert (direct pas encore abonné) : rien.
  assert.deepEqual(outgoingSignals([{ table: 'evaluations', rows: evals }], new Set(), LOOK, 'v'), [])
  // Le signal se lit comme ceux que la base envoyait.
  assert.deepEqual(parseSignal(out[0].payload, SYNC_TABLES), { table: out[0].payload.t, id: out[0].payload.id, v: '2026-10-28T12:00:00.000Z' })
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
  assert.ok(code.includes(`create policy "hb_emettre" on realtime.messages for insert to authenticated\n      with check (${rule})`))
  assert.equal([...code.matchAll(/create policy [^;]* on realtime\.messages/g)].length, 2)
  assert.ok(!/on realtime\.messages for (all|update|delete)/.test(code))
  // Relançable : les deux règles sont retirées avant d'être reposées.
  assert.ok(code.includes(`drop policy if exists "hb_recevoir" on realtime.messages`) && code.includes(`drop policy if exists "hb_emettre" on realtime.messages`))
})

console.log(`\n${n} tests réussis.`)
