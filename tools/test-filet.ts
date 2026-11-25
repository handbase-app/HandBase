// Test du filet économe (src/filet.ts, pendant de supabase/059_filet_econome.sql ; série 8 du 30/10 : « quoi de neuf ? »
// ne répondait « rien de neuf » que 4 % du temps) : texte jsonb et empreintes identiques à Postgres (vecteurs calculés par
// Postgres 15), heures serveur en µs, registre (relecture, lignes reçues en direct, plafond), décision : rien de neuf, ligne déjà
// reçue en direct (pas de relecture, curseur avancé, ligne confirmée), vraie ligne manquante (relecture), ligne validée en retard
// dans la fenêtre (relecture), ligne forgée (relecture) ; compatibilité : serveur sans 059 (hb_quoi_de_neuf, comme avant),
// réponse d'avant quand le serveur ne donne pas d'empreinte ou que le registre est incomplet. Données fictives seulement.
// L'égalité octet pour octet avec Postgres sur un vrai jeu est vérifiée par tools/essai-sql-059 (miroir).
//
//   npx jiti tools/test-filet.ts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  ASK_AGAIN_MS,
  askWhatsNew,
  decideFilet,
  FILET_CAP,
  jsonbText,
  LEDGER_MAX,
  ledgerEndPull,
  ledgerNote,
  ledgerStartPull,
  ledgerTrim,
  OVERLAP_US,
  PullBuffer,
  readFiletAnswer,
  readLedger,
  rowHash,
  suaMicros,
  windowHash,
  type AskState,
  type FiletPrint,
  type Ledger,
  type LedgerEntry,
} from '../src/filet'
import { planPull, whatsNewAnswer } from '../src/syncLive'

let n = 0
let chain: Promise<void> = Promise.resolve()
const t = (name: string, f: () => void | Promise<void>) => {
  chain = chain.then(async () => {
    await f()
    n++
    console.log(`ok ${n} - ${name}`)
  })
}

// ---------- Texte jsonb, heures, empreintes ----------

t('texte jsonb comme Postgres : clés (longueur puis octets), « , » et « : », échappements, -0, imbrication', () => {
  // Vecteur de Postgres 15 : '{"id":"x","b":[1,"é\n\\"],"aa":{"z":true,"":null}}'::jsonb::text
  assert.equal(jsonbText({ id: 'x', b: [1, 'é\n\\'], aa: { z: true, '': null } }), '{"b": [1, "é\\n\\\\"], "aa": {"": null, "z": true}, "id": "x"}')
  assert.equal(jsonbText({}), '{}')
  assert.equal(jsonbText([]), '[]')
  assert.equal(jsonbText({ é: 1, z: 2 }), '{"z": 2, "é": 1}') // é : 2 octets en UTF-8
  assert.equal(jsonbText('a"b\\c\b\f\n\r\t\u0001\u001f\u007f/🤾'), '"a\\"b\\\\c\\b\\f\\n\\r\\t\\u0001\\u001f\u007f/🤾"')
  assert.equal(jsonbText(-0), '0')
  assert.equal(jsonbText({ a: undefined, b: 1 }), '{"b": 1}')
  assert.equal(jsonbText([1.5, -3, 1234567890123, true, null]), '[1.5, -3, 1234567890123, true, null]')
})

t('heure serveur en µs : PostgREST, jsonb, Z, décalage, sans fraction ; illisible : null', () => {
  const base = Date.UTC(2026, 9, 30, 10, 0, 0) * 1000
  assert.equal(suaMicros('2026-10-30T10:00:00.123456+00:00'), base + 123456)
  assert.equal(suaMicros('2026-10-30T10:00:00.1234+00:00'), base + 123400)
  assert.equal(suaMicros('2026-10-30T10:00:00+00:00'), base)
  assert.equal(suaMicros('2026-10-30T10:00:00Z'), base)
  assert.equal(suaMicros('2026-10-30 12:00:00.5+02'), base + 500000)
  assert.equal(suaMicros('2026-10-30T07:30:00-02:30'), base)
  assert.equal(suaMicros('pas une heure'), null)
  assert.equal(suaMicros(null), null)
  assert.equal(suaMicros('2026-10-30T10:00:00.123456+00:00'), 1793354400123456)
})

t('empreintes identiques à Postgres (ligne : id, heure µs, data::text ; fenêtre : empreintes triées)', async () => {
  // Vecteurs de Postgres 15 (voir l'en-tête de supabase/059_filet_econome.sql pour la formule).
  assert.equal(await rowHash('x', 1793354400123456, { id: 'x', b: [1, 'é\n\\'], aa: { z: true, '': null } }), '2530dfa056b05d0c')
  assert.equal(await windowHash(['fedcba9876543210', '0123456789abcdef']), 'ba4f290c4e996ff09f764b7a316e184a85e2ac6766183b66102d1dea7cd3c15d')
  // Ordre des clés reçu sans effet ; contenu changé : autre empreinte.
  const a = await rowHash('p1', 1, { id: 'p1', lastName: 'Fictif', updatedAt: 5 })
  assert.equal(await rowHash('p1', 1, { updatedAt: 5, lastName: 'Fictif', id: 'p1' }), a)
  assert.notEqual(await rowHash('p1', 1, { id: 'p1', lastName: 'Fictiv', updatedAt: 5 }), a)
  assert.notEqual(await rowHash('p1', 2, { id: 'p1', lastName: 'Fictif', updatedAt: 5 }), a)
})

// ---------- Scénarios ----------

const T = 1793354400000000 // 2026-10-30T10:00:00Z en µs
const iso = (us: number) => new Date(Math.floor(us / 1000)).toISOString().replace('Z', '') + String(us % 1000).padStart(3, '0') + '+00:00'
type Row = { id: string; server_updated_at: string; data: Record<string, unknown> }
const row = (id: string, us: number, extra: Record<string, unknown> = {}): Row => ({ id, server_updated_at: iso(us), data: { id, updatedAt: us, ...extra } })
const entry = async (r: Row): Promise<LedgerEntry> => ({ id: r.id, us: suaMicros(r.server_updated_at)!, h: await rowHash(r.id, suaMicros(r.server_updated_at)!, r.data) })

/** Le serveur : lignes visibles du compte ; réponse de hb_filet pour un curseur (même calcul que 059, avec plafond). */
async function serverAnswer(rows: Row[], cursorUs: number, recent = true): Promise<FiletPrint> {
  const w = cursorUs - OVERLAP_US
  const win = rows.filter((r) => suaMicros(r.server_updated_at)! >= w).sort((a, b) => suaMicros(a.server_updated_at)! - suaMicros(b.server_updated_at)!)
  const neuf = recent ? win.length > 0 : rows.some((r) => suaMicros(r.server_updated_at)! > cursorUs)
  if (win.length > FILET_CAP) return { n: FILET_CAP + 1, neuf }
  const out: FiletPrint = { n: win.length, w, neuf }
  if (win.length) {
    out.e = await windowHash(await Promise.all(win.map(async (r) => (await entry(r)).h)))
    out.m = win[win.length - 1].server_updated_at
  }
  return out
}

/** L'appareil après une relecture de `pulled` depuis le curseur précédent (startUs) : registre complet depuis le seuil. */
function afterPull(pulled: Row[], startUs: number): Promise<Ledger> {
  const buf = new PullBuffer<Row>(startUs)
  buf.page(pulled)
  return Promise.all(buf.rows.map(({ row }) => entry(row))).then((es) => ledgerEndPull(ledgerStartPull({}, 'measurements', startUs), 'measurements', es, buf.threshold()))
}

t('rien de neuf : l’appareil a déjà toute la fenêtre (curseur récent) → pas de relecture (avant : « oui » 5 minutes)', async () => {
  const rows = [row('m1', T - 30e6), row('m2', T - 10e6), row('m3', T)]
  const ledger = await afterPull(rows, T - 120e6)
  const cursor = T
  const a = await serverAnswer(rows, cursor)
  assert.equal(a.neuf, true) // l'ancienne réponse aurait fait relire
  const d = await decideFilet(a, ledger.measurements)
  assert.deepEqual([d.pull, d.why], [false, 'identique'])
  assert.equal(d.confirm?.cursor, rows[2].server_updated_at)
})

t('ligne déjà reçue en direct : pas de relecture, curseur avancé à sa dernière heure, ligne confirmée', async () => {
  const pulled = [row('m1', T - 30e6), row('m2', T)]
  let ledger = await afterPull(pulled, T - 120e6)
  // Plus tard : une mesure d'un autre appareil arrive en direct (ligne dans le signal), heure serveur T + 90 s.
  const live = row('m9', T + 90e6, { value: 12 })
  ledger = ledgerNote(ledger, 'measurements', [await entry(live)])
  const a = await serverAnswer([...pulled, live], T)
  const d = await decideFilet(a, ledger.measurements)
  assert.deepEqual([d.pull, d.why], [false, 'identique'])
  assert.equal(d.confirm?.cursor, live.server_updated_at)
  assert.ok(d.confirm?.ids.includes('m9'))
  // Curseur avancé : la fenêtre suivante part de T + 30 s ; le registre allégé reste complet pour elle.
  ledger = ledgerTrim(ledger, 'measurements', suaMicros(live.server_updated_at)! - OVERLAP_US)
  assert.deepEqual(Object.keys(ledger.measurements.r), ['m9'])
  const again = await decideFilet(await serverAnswer([...pulled, live], suaMicros(live.server_updated_at)!), ledger.measurements)
  assert.equal(again.why, 'identique')
})

t('vraie ligne manquante (écrite par le serveur, signal perdu) : relecture', async () => {
  const pulled = [row('m1', T - 30e6), row('m2', T)]
  const ledger = await afterPull(pulled, T - 120e6)
  const d = await decideFilet(await serverAnswer([...pulled, row('m3', T + 40e6)], T), ledger.measurements)
  assert.deepEqual([d.pull, d.why], [true, 'differente'])
  assert.equal(d.confirm, undefined)
})

t('ligne validée en retard dans la fenêtre (heure antérieure au curseur) : relecture', async () => {
  const pulled = [row('m1', T - 30e6), row('m2', T)]
  const ledger = await afterPull(pulled, T - 120e6)
  // Validée après la relecture, avec une heure serveur de T − 5 s (avant le curseur T, dans la fenêtre T − 60 s →).
  const late = row('m-retard', T - 5e6)
  const a = await serverAnswer([...pulled, late], T)
  assert.equal(a.m, pulled[1].server_updated_at) // la plus grande heure ne bouge pas : seule l'empreinte la trahit
  const d = await decideFilet(a, ledger.measurements)
  assert.deepEqual([d.pull, d.why], [true, 'differente'])
})

t('ligne reçue en direct au contenu forgé (même identifiant, même heure) : jamais confirmée, relecture', async () => {
  const pulled = [row('m1', T - 30e6)]
  let ledger = await afterPull(pulled, T - 120e6)
  const genuine = row('m5', T + 20e6, { value: 10 })
  const forged = { ...genuine, data: { ...genuine.data, value: 99 } }
  ledger = ledgerNote(ledger, 'measurements', [await entry(forged)])
  const d = await decideFilet(await serverAnswer([...pulled, genuine], T), ledger.measurements)
  assert.deepEqual([d.pull, d.why], [true, 'differente'])
})

t('fenêtre vide : rien à relire ; ligne reçue en direct après la réponse (plus récente que m) : pas confirmée', async () => {
  const ledger = await afterPull([], T - 60e6)
  assert.equal((await decideFilet(await serverAnswer([], T), ledger.measurements)).why, 'identique')
  const pulled = [row('m1', T)]
  let l2 = await afterPull(pulled, T - 60e6)
  l2 = ledgerNote(l2, 'measurements', [await entry(row('m-apres', T + 200e6))])
  const d = await decideFilet(await serverAnswer(pulled, T), l2.measurements)
  assert.equal(d.why, 'identique')
  assert.ok(!d.confirm?.ids.includes('m-apres'))
})

t('réponse d’avant : plus de 500 lignes (pas d’empreinte), registre incomplet (relecture interrompue, curseur ancien)', async () => {
  const many = Array.from({ length: FILET_CAP + 20 }, (_, i) => row(`m${i}`, T - 50e6 + i))
  const big = await serverAnswer(many, T)
  assert.deepEqual([big.n, big.e, big.w], [FILET_CAP + 1, undefined, undefined])
  assert.deepEqual(await decideFilet(big, (await afterPull(many, T - 120e6)).measurements), { pull: true, why: 'avant' })
  assert.deepEqual(await decideFilet({ ...big, neuf: false }, undefined), { pull: false, why: 'avant' })
  const rows = [row('m1', T)]
  const a = await serverAnswer(rows, T)
  // Relecture commencée, pas finie : registre incomplet.
  assert.equal((await decideFilet(a, ledgerStartPull(await afterPull(rows, T - 120e6), 'measurements', T - 120e6).measurements)).why, 'avant')
  // Relecture partie du curseur (sans recouvrement) : registre complet seulement depuis plus tard que la fenêtre.
  assert.equal((await decideFilet(a, (await afterPull(rows, T)).measurements)).why, 'avant')
  // Table inconnue du serveur, pas de curseur : comme avant.
  assert.deepEqual(await decideFilet(null, undefined), { pull: null, why: 'absente' })
  assert.deepEqual(await decideFilet(true, undefined), { pull: true, why: 'avant' })
  assert.deepEqual(await decideFilet(undefined, undefined), { pull: true, why: 'avant' })
})

t('registre : relecture par pages (seules les lignes de la dernière minute gardées), plafond, illisible = vide', async () => {
  const buf = new PullBuffer<Row>(T - 600e6)
  buf.page(Array.from({ length: 50 }, (_, i) => row(`a${i}`, T - 300e6 + i * 1e6)))
  buf.page(Array.from({ length: 50 }, (_, i) => row(`b${i}`, T - 100e6 + i * 2e6)))
  // Dernière heure T − 2 s : gardées celles d'heure >= T − 62 s.
  assert.equal(buf.threshold(), T - 2e6 - OVERLAP_US)
  assert.ok(buf.rows.every((x) => x.us >= T - 62e6))
  assert.equal(buf.rows.length, 31)
  // Import de masse (plus que LEDGER_MAX lignes dans la minute) : les plus récentes, seuil monté d'autant.
  const imp = new PullBuffer<Row>(T - 600e6, 10)
  imp.page(Array.from({ length: 25 }, (_, i) => row(`i${i}`, T + i)))
  assert.equal(imp.rows.length, 10)
  assert.equal(imp.threshold(), T + 15)
  // Registre plafonné : les plus anciennes sortent, L monte d'autant.
  let l: Ledger = ledgerEndPull({}, 'seen', [], T)
  l = ledgerNote(l, 'seen', Array.from({ length: 12 }, (_, i) => ({ id: `s${i}`, us: T + i, h: 'h' })), 10)
  assert.equal(Object.keys(l.seen.r).length, 10)
  assert.equal(l.seen.L, T + 2)
  assert.deepEqual(readLedger('pas du json'), {})
  assert.deepEqual(readLedger(JSON.stringify(l)), l)
  assert.ok(LEDGER_MAX >= 2 * FILET_CAP)
})

// ---------- Compatibilité ----------

t('compatibilité : serveur sans 059 → hb_quoi_de_neuf (booléens, comme avant), hb_filet redemandée une heure plus tard', async () => {
  const calls: string[] = []
  const missing = (e: { code?: string }) => e.code === 'PGRST202' || e.code === '42883'
  const oldServer = async (fn: string) => {
    calls.push(fn)
    return fn === 'hb_filet' ? { data: null, error: { code: 'PGRST202', message: 'Could not find the function' } } : { data: { players: true, measurements: false }, error: null }
  }
  const st: AskState = { filetMissingAt: 0, oldMissingAt: 0, filetOn: false }
  const r = await askWhatsNew(oldServer, { players: 'x', measurements: 'y' }, st, 1e12, missing)
  assert.deepEqual(r, { kind: 'ancien', data: { players: true, measurements: false } })
  assert.deepEqual(calls, ['hb_filet', 'hb_quoi_de_neuf'])
  assert.equal(st.filetOn, false)
  // Dans l'heure : une seule requête (hb_quoi_de_neuf).
  await askWhatsNew(oldServer, {}, st, 1e12 + 1000, missing)
  assert.deepEqual(calls, ['hb_filet', 'hb_quoi_de_neuf', 'hb_quoi_de_neuf'])
  // Une heure plus tard : hb_filet redemandée (059 passé entre-temps ?).
  await askWhatsNew(oldServer, {}, st, 1e12 + ASK_AGAIN_MS, missing)
  assert.equal(calls[3], 'hb_filet')
  // La réponse d'avant mène au même plan qu'avant.
  const plan = planPull(['players', 'measurements'], new Set(), whatsNewAnswer((r as { data: unknown }).data, false))
  assert.deepEqual([plan.pull, plan.quiet], [['players'], ['measurements']])
  // Serveur à jour : hb_filet seule.
  const calls2: string[] = []
  const st2: AskState = { filetMissingAt: 0, oldMissingAt: 0, filetOn: false }
  const r2 = await askWhatsNew(async (fn) => (calls2.push(fn), { data: { players: { n: 0, w: 1, neuf: false } }, error: null }), {}, st2, 1e12, missing)
  assert.equal(r2?.kind, 'filet')
  assert.deepEqual(calls2, ['hb_filet'])
  assert.equal(st2.filetOn, true)
  // Autre erreur (réseau) : null, rien de retenu (on redemande hb_filet à la prochaine synchronisation).
  const st3: AskState = { filetMissingAt: 0, oldMissingAt: 0, filetOn: false }
  assert.equal(await askWhatsNew(async () => ({ data: null, error: { message: 'Failed to fetch' } }), {}, st3, 1e12, missing), null)
  assert.equal(st3.filetMissingAt, 0)
  // Ni l'une ni l'autre : null (tout relire, comme avant 057).
  const st4: AskState = { filetMissingAt: 0, oldMissingAt: 0, filetOn: false }
  assert.equal(await askWhatsNew(async () => ({ data: null, error: { code: '42883' } }), {}, st4, 1e12, missing), null)
  assert.ok(st4.oldMissingAt > 0)
})

t('réponse de hb_filet lue : booléens, null, empreintes, clé « mes_affectations », valeur mal formée → relire', () => {
  const a = readFiletAnswer({ players: { n: 2, e: 'ab', w: 5, m: '2026-10-30T10:00:00+00:00', neuf: true }, teams: null, lists: true, mes_affectations: { n: 0, w: 1, neuf: false }, assignments: false, rewatch: 'bizarre' }, true)!
  assert.deepEqual(a.players, { n: 2, e: 'ab', w: 5, m: '2026-10-30T10:00:00+00:00', neuf: true })
  assert.equal(a.teams, null)
  assert.equal(a.lists, true)
  assert.deepEqual(a.assignments, { n: 0, w: 1, neuf: false })
  assert.equal(a.rewatch, true)
  assert.equal(readFiletAnswer([1], false), null)
})

t('le script SQL et l’appli disent la même chose (formule, plafond, recouvrement, sécurité, retour arrière)', () => {
  const sql = readFileSync(new URL('../supabase/059_filet_econome.sql', import.meta.url), 'utf8')
  assert.match(sql, /language plpgsql stable security invoker set search_path = public, pg_temp/)
  assert.match(sql, new RegExp(`v_plafond constant integer := ${FILET_CAP};`))
  assert.match(sql, /v_w := v_cur - interval '60 seconds'/)
  assert.equal(OVERLAP_US, 60_000_000)
  assert.match(sql, /left\(encode\(sha256\(convert_to\(s\.id \|\| E'\\n' \|\| \(\(extract\(epoch from s\.server_updated_at\) \* 1000000\)::bigint\)::text\s*\|\| E'\\n' \|\| s\.data::text, 'UTF8'\)\), 'hex'\), 16\)/)
  assert.match(sql, /string_agg\(x\.h, '' order by x\.h collate "C"\)/)
  assert.match(sql, /hb_lire_perimetre\(%L, \$1, \$3\)/)
  assert.match(sql, /revoke all on function public\.hb_filet\(jsonb\) from public, anon;/)
  assert.match(sql, /-- drop function if exists public\.hb_filet\(jsonb\);/)
  assert.doesNotMatch(sql, /hb_quoi_de_neuf\(curseurs jsonb\)/) // l'ancienne fonction n'est pas touchée
  const sync = readFileSync(new URL('../src/sync.ts', import.meta.url), 'utf8')
  assert.match(sync, /askWhatsNew\(\(fn, args\) => supabase!\.rpc\(fn, args\)/)
  assert.match(sync, /setLedger\(ledgerStartPull\(led\(\), table, startMs \* 1000\)\)/)
  assert.match(sync, /await noteRows\(table, held\)/)
  assert.match(sync, /await noteRows\(table, stored\)/)
})

chain.then(
  () => console.log(`\n${n} essais réussis.`),
  (e) => {
    console.error(e)
    process.exit(1)
  },
)
