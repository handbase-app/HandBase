// Test du registre des changements côté appareil (src/registre.ts, pendant de supabase/061_registre_changements.sql) : lecture de
// la réponse (complète, « trop », pas complète, mal formée), plan par ligne citée (déjà sur l'appareil avec la même empreinte :
// rien, ligne reçue en direct confirmée ; empreinte différente ou ligne forgée : relue ; sans empreinte : relue seulement si
// elle vient du direct ; plus récente sur l'appareil : rien ; perte d'accès : toujours relue), curseurs (avance à l'heure du
// serveur − 60 s, jamais en arrière ; « trop » : ramené à la plus ancienne heure citée), état gardé, filet rare d'un jour,
// canaux (même liste, différence à ouvrir / fermer), et câblage de src/sync.ts (registre d'abord, filet de 059 rare, relecture
// par identifiant, vérifications d'un jour ou sur changement de canaux, canaux du direct changés un par un). L'égalité des
// empreintes avec Postgres sur une vraie réponse est vérifiée par tools/essai-sql-061 (miroir). Données fictives seulement.
//
//   npx jiti tools/test-registre.ts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { CHARGE_REGLES } from '../src/charge'
import { ledgerNote, rowHash, suaMicros, type Ledger } from '../src/filet'
import {
  curseurApres,
  curseurTrop,
  diffCanaux,
  filetRareDu,
  lireEtatRegistre,
  lireRegistre,
  memesCanaux,
  planRegistre,
  REGISTRE_RECOUVREMENT_MS,
  type RegistreReponse,
} from '../src/registre'

let n = 0
let chain: Promise<void> = Promise.resolve()
const t = (name: string, f: () => void | Promise<void>) => {
  chain = chain.then(async () => {
    await f()
    n++
    console.log(`ok ${n} - ${name}`)
  })
}

const T0 = '2026-11-01T09:00:00.000000+00:00'
const us0 = suaMicros(T0)!
const vide = () => new Set<string>()

t('réponse complète : lignes [id, heure, empreinte, perte], tables « trop », canaux, annonce', () => {
  const r = lireRegistre({
    c: '123456',
    t: T0,
    complet: true,
    canaux: ['hb:commun', 'hb:club:6300001'],
    e: { measurements: [['m1', us0, 'abcd', 0], ['m2', us0 + 1, null, 1]], seen: { trop: 812, depuis: us0 - 5 } },
    k: { niveau: 'charge', ttl: 60 },
  })!
  assert.equal(r.c, '123456')
  assert.equal(r.complet, true)
  assert.deepEqual(r.canaux, ['hb:commun', 'hb:club:6300001'])
  assert.deepEqual(r.e.measurements, { lignes: [{ id: 'm1', us: us0, h: 'abcd', perte: false }, { id: 'm2', us: us0 + 1, h: null, perte: true }] })
  assert.deepEqual(r.e.seen, { trop: 812, depuis: us0 - 5 })
  assert.deepEqual(r.k, { niveau: 'charge', ttl: 60 })
})

t('réponse pas complète : curseur seulement ; réponses mal formées : écartées (l’appli fait comme sans registre)', () => {
  const r = lireRegistre({ c: '99', t: T0, complet: false, canaux: [] })!
  assert.equal(r.complet, false)
  assert.deepEqual(r.e, {})
  assert.equal(lireRegistre(null), null)
  assert.equal(lireRegistre([]), null)
  assert.equal(lireRegistre({ c: 'abc', complet: true, e: {} }), null, 'curseur pas un nombre')
  assert.equal(lireRegistre({ c: '1', complet: 'oui' }), null)
  assert.equal(lireRegistre({ c: '1', complet: true }), null, 'complète sans e')
  assert.equal(lireRegistre({ c: '1', complet: true, e: { players: [[42]] } }), null, 'ligne sans identifiant')
  assert.equal(lireRegistre({ c: '1', complet: true, e: { players: 'tout' } }), null)
})

/** Appareil : registre du filet et lignes reçues en direct. */
async function appareil(rows: { t: string; id: string; us: number; data: Record<string, unknown> }[]) {
  let led: Ledger = {}
  for (const r of rows) led = ledgerNote(led, r.t, [{ id: r.id, us: r.us, h: await rowHash(r.id, r.us, r.data) }])
  return led
}
const rep = (e: RegistreReponse['e']): RegistreReponse => ({ c: '10', t: T0, complet: true, canaux: null, e, k: null })

t('plan : même heure et même empreinte → rien à relire ; ligne reçue en direct → confirmée (son contenu est celui du serveur)', async () => {
  const data = { id: 'm1', playerId: 'p1', value: 42, updatedAt: 1 }
  const led = await appareil([{ t: 'measurements', id: 'm1', us: us0, data }])
  const h = await rowHash('m1', us0, data)
  const r = rep({ measurements: { lignes: [{ id: 'm1', us: us0, h, perte: false }] } })
  assert.deepEqual(planRegistre(r, ['measurements'], led, vide), {}, 'reçue d’une relecture : rien')
  assert.deepEqual(planRegistre(r, ['measurements'], led, () => new Set(['m1'])), { measurements: { lire: [], confirmer: ['m1'] } })
})

t('plan : empreinte différente (ligne forgée ou autre version) → relue ; ligne absente de l’appareil → relue', async () => {
  const led = await appareil([{ t: 'measurements', id: 'm1', us: us0, data: { id: 'm1', value: 999 } }])
  const h = await rowHash('m1', us0, { id: 'm1', value: 42 })
  const r = rep({ measurements: { lignes: [{ id: 'm1', us: us0, h, perte: false }, { id: 'm2', us: us0, h, perte: false }] } })
  assert.deepEqual(planRegistre(r, ['measurements'], led, () => new Set(['m1'])), { measurements: { lire: ['m1', 'm2'], confirmer: [] } })
})

t('plan : sans empreinte (autres tables) → relue seulement si elle vient du direct ; heure plus ancienne sur l’appareil → relue', async () => {
  const led = await appareil([{ t: 'events', id: 'e1', us: us0, data: {} }, { t: 'events', id: 'e2', us: us0 - 10, data: {} }])
  const r = rep({ events: { lignes: [{ id: 'e1', us: us0, h: null, perte: false }, { id: 'e2', us: us0, h: null, perte: false }] } })
  assert.deepEqual(planRegistre(r, ['events'], led, vide), { events: { lire: ['e2'], confirmer: [] } })
  assert.deepEqual(planRegistre(r, ['events'], led, () => new Set(['e1'])), { events: { lire: ['e1', 'e2'], confirmer: [] } })
})

t('plan : version plus récente sur l’appareil → rien (la version citée est dépassée)', async () => {
  const led = await appareil([{ t: 'players', id: 'p1', us: us0 + 5, data: { id: 'p1' } }])
  const r = rep({ players: { lignes: [{ id: 'p1', us: us0, h: 'x', perte: false }] } })
  assert.deepEqual(planRegistre(r, ['players'], led, vide), {})
})

t('plan : perte d’accès (pierre tombale) → toujours relue, même si l’appareil a la ligne à la même heure', async () => {
  const data = { id: 'p1', clubCode: '6300001' }
  const led = await appareil([{ t: 'players', id: 'p1', us: us0, data }])
  const r = rep({ players: { lignes: [{ id: 'p1', us: us0, h: null, perte: true }] } })
  assert.deepEqual(planRegistre(r, ['players'], led, vide), { players: { lire: ['p1'], confirmer: [] } })
  // Heure inconnue : relue aussi.
  assert.deepEqual(planRegistre(rep({ players: { lignes: [{ id: 'p9', us: null, h: null, perte: false }] } }), ['players'], led, vide).players?.lire, ['p9'])
})

t('plan : table « trop » → relecture par curseur (depuis la plus ancienne heure citée) ; table pas lue par ce compte → ignorée', () => {
  const r = rep({ measurements: { trop: 900, depuis: us0 - 1 }, question_log: { lignes: [{ id: 'q', us: us0, h: null, perte: false }] } })
  assert.deepEqual(planRegistre(r, ['measurements'], {}, vide), { measurements: { lire: [], confirmer: [], trop: us0 - 1 } })
})

t('curseur après une réponse complète : heure du serveur − 60 s, jamais en arrière ; heure illisible : inchangé', () => {
  const next = curseurApres('2026-11-01T08:00:00.000Z', T0)!
  assert.equal(next, new Date(Date.parse(T0) - REGISTRE_RECOUVREMENT_MS).toISOString())
  assert.equal(curseurApres('2026-11-01T08:59:30.123456+00:00', T0), '2026-11-01T08:59:30.123456+00:00', 'déjà plus récent : gardé')
  assert.equal(curseurApres('2026-11-01T08:00:00Z', null), '2026-11-01T08:00:00Z')
  assert.equal(curseurApres('2026-11-01T08:00:00Z', 'pas une heure'), '2026-11-01T08:00:00Z')
  assert.equal(curseurApres(null, T0), new Date(Date.parse(T0) - 60_000).toISOString())
})

t('curseur d’une table « trop » : ramené à la plus ancienne heure citée si elle est avant (ligne validée en retard)', () => {
  assert.equal(curseurTrop('2026-11-01T09:00:00Z', suaMicros('2026-11-01T08:58:00.5Z')), '2026-11-01T08:58:00.500Z')
  assert.equal(curseurTrop('2026-11-01T08:00:00Z', us0), '2026-11-01T08:00:00Z', 'curseur déjà avant : gardé')
  assert.equal(curseurTrop(null, us0), null, 'table jamais reçue : relue en entier de toute façon')
  assert.equal(curseurTrop('2026-11-01T08:00:00Z', null), '2026-11-01T08:00:00Z')
})

t('état gardé : curseur, dernier filet, canaux ; illisible → vide (premier passage : filet de 059)', () => {
  assert.deepEqual(lireEtatRegistre(JSON.stringify({ c: '42', f: 1000, canaux: ['hb:commun'] })), { c: '42', f: 1000, canaux: ['hb:commun'] })
  assert.deepEqual(lireEtatRegistre(null), { c: null, f: null, canaux: null })
  assert.deepEqual(lireEtatRegistre('{pas du json'), { c: null, f: null, canaux: null })
  assert.deepEqual(lireEtatRegistre(JSON.stringify({ c: 'x; drop', f: 'hier' })), { c: null, f: null, canaux: null })
})

t('filet rare (059) : jamais fait, ou fait il y a plus d’un jour ; horloge revenue en arrière : refait', () => {
  const J = CHARGE_REGLES.filetRareMs
  assert.equal(J, 24 * 60 * 60_000)
  assert.equal(filetRareDu(10 * J, null, J), true)
  assert.equal(filetRareDu(10 * J, 10 * J - J / 2, J), false)
  assert.equal(filetRareDu(10 * J, 9 * J, J), true)
  assert.equal(filetRareDu(10 * J, 11 * J, J), true)
})

t('canaux : même liste (ordre indifférent) ; changement : seuls les canaux qui changent sont fermés / ouverts', () => {
  assert.equal(memesCanaux(['a', 'b'], ['b', 'a']), true)
  assert.equal(memesCanaux(['a', 'b'], ['a']), false)
  assert.equal(memesCanaux(null, ['a']), false)
  assert.deepEqual(diffCanaux(['hb:commun', 'hb:staff', 'hb:club:1'], ['hb:commun', 'hb:staff', 'hb:dept:83']), { fermer: ['hb:club:1'], ouvrir: ['hb:dept:83'] })
  assert.deepEqual(diffCanaux(['a'], ['a']), { fermer: [], ouvrir: [] })
})

t('simulation d’une journée : 5 min de notations du club reçues en direct → 0 relecture, toutes confirmées ; une perte relue', async () => {
  // L'appareil a reçu en direct 30 mesures de son club (lignes enregistrées, heures serveur) : le registre les cite avec leurs
  // empreintes ; une fiche est partie dans un autre club (perte).
  const rows = Array.from({ length: 30 }, (_, i) => ({ t: 'measurements', id: `m${i}`, us: us0 + i, data: { id: `m${i}`, playerId: 'p1', value: i, updatedAt: i } }))
  const led = await appareil(rows)
  const lignes = await Promise.all(rows.map(async (r) => ({ id: r.id, us: r.us, h: await rowHash(r.id, r.us, r.data), perte: false })))
  const r = rep({ measurements: { lignes }, players: { lignes: [{ id: 'p7', us: us0, h: null, perte: true }] } })
  const plan = planRegistre(r, ['measurements', 'players'], led, (t) => (t === 'measurements' ? new Set(rows.map((x) => x.id)) : new Set()))
  assert.equal(plan.measurements.lire.length, 0)
  assert.equal(plan.measurements.confirmer.length, 30)
  assert.deepEqual(plan.players.lire, ['p7'])
})

t('câblage (src/sync.ts) : registre d’abord avec le signe de vie, filet de 059 rare, relecture par identifiant, curseurs', () => {
  const sync = readFileSync(new URL('../src/sync.ts', import.meta.url), 'utf8')
  assert.ok(sync.includes("supabase!.rpc('hb_registre_depuis', { p_curseur: etat.c, p_session: session?.id ?? null, p_appareil: session?.device ?? null })"))
  assert.match(sync, /if \(Date\.now\(\) - registreMissingAt >= ASK_AGAIN_MS\) \{\s*const r = await askRegistre\(tables, uid\)\s*if \(r !== undefined\) return r\s*\}\s*return askFilet\(tables\)/)
  assert.ok(sync.includes('if (!rep.complet || (now >= rareApres && filetRareDu(now, etat.f, CHARGE_REGLES.filetRareMs)))'))
  assert.deepEqual(CHARGE_REGLES.rareEtalementMs, [5 * 60_000, 30 * 60_000], 'jamais dans la vague des ouvertures')
  assert.ok(sync.includes('verifVisiblesEtalementMs: CHARGE_REGLES.rareEtalementMs'))
  assert.ok(sync.includes('planRegistre(rep, tables, led(), (t) => new Set(Object.keys(prov()[t] ?? {})))'))
  assert.ok(sync.includes('await readCited(t, p.lire, uid)'))
  assert.ok(sync.includes("const { data, error } = await supabase!.from(`hb_${table}`).select('id, data, server_updated_at').in('id', part)"))
  assert.ok(sync.includes('const next = curseurApres(cur, rep.t)'))
  assert.ok(sync.includes('if (ok) setRegistreEtat({ c: rep.c, f: etat.f, canaux: rep.canaux ?? etat.canaux })'), 'curseur gardé seulement si tout est relu')
  // Staffs lus AVANT « quoi de neuf ? » (le registre peut en relire un) ; registre noté pour le registre du filet.
  assert.ok(sync.indexOf('const teamsBefore = await myTeams(uid)') < sync.indexOf('await whatsNew(wanted.filter((t) => !fresh.has(t)), uid)'))
  assert.ok(sync.includes('(ask.filetMissingAt && !ask.filetOn && !registreOn)'))
})

t('câblage : vérifications d’un jour (ou tout de suite si les canaux / un staff changent), canaux du direct changés un par un', () => {
  const sync = readFileSync(new URL('../src/sync.ts', import.meta.url), 'utf8')
  assert.ok(sync.includes('nextForgetAt = registreOn ? Date.now() + CHARGE_REGLES.verifRegistreMs : prochaineVerifVisibles(Date.now(), charge.niveau())'))
  assert.ok(sync.includes('(registreOn ? CHARGE_REGLES.verifRegistreMs : FORGET_EVERY_MS)'))
  assert.match(sync, /if \(etat\.canaux && !memesCanaux\(rep\.canaux, etat\.canaux\)\) \{\s*structureChanged = true\s*nextForgetAt = 0/)
  assert.ok(sync.includes("if (t === 'teams') nextForgetAt = 0"))
  assert.ok(sync.includes('void refreshChannels(rep.canaux)'))
  assert.ok(sync.includes('if (store.get(SCOPE_KEY) !== sig && (channels.size || channel)) void refreshChannels()'))
  assert.ok(sync.includes('const d = diffCanaux([...channels.keys()], topics)'))
  assert.ok(sync.includes("res = await supabase!.rpc('hb_mes_canaux_memo')"))
  assert.ok(sync.includes("res ??= await supabase!.rpc('hb_mes_canaux')"), 'serveur sans 061 : comme avant')
})

chain.then(
  () => console.log(`${n} tests OK`),
  (e) => {
    console.error(e)
    process.exit(1)
  },
)
