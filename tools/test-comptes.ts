// Test de « Changer de compte » en un toucher (04/11 ; src/comptesCore.ts, src/comptes.ts, src/components/TestAccounts.tsx) :
// liste des comptes gardés (ajout, remplacement, retrait, au plus 2 comptes de test, une seule maison), session jamais gardée
// en double (le compte actif n'est jamais garé), réglages handbase.* rangés par compte (thème exclu), base par compte, qui
// voit quoi (un vrai jeune sur son téléphone : rien ; l'administrateur : ajouter ; compte de test : revenir), aucun jeton dans
// les textes affichés ; client de connexion à part qui n'écrit rien dans le stockage de la session active ; branchements
// (base Dexie, service worker, effacement de l'appareil). Comptes et jetons fictifs (aucun serveur contacté).
//
//   npx jiti tools/test-comptes.ts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import {
  accountLabel,
  accountsView,
  activeDbOf,
  addErrorText,
  addTest,
  bundleOf,
  firstName,
  HOME_DB,
  isAccountKey,
  isTestDb,
  MAX_TEST,
  park,
  parseBundle,
  parseList,
  listText,
  removeTest,
  sessionFresh,
  testDbName,
  tokensOf,
  unpark,
  type SavedAccount,
} from '../src/comptesCore'

let n = 0
let chain: Promise<void> = Promise.resolve()
const t = (name: string, f: () => void | Promise<void>) => {
  chain = chain.then(async () => {
    await f()
    n++
    console.log(`ok ${n} - ${name}`)
  })
}

const ADMIN = '11111111-1111-4111-8111-111111111111'
const LEO = '22222222-2222-4222-8222-222222222222'
const EMMA = '33333333-3333-4333-8333-333333333333'
const TOM = '44444444-4444-4444-8444-444444444444'
const NOW = Date.parse('2026-11-04T18:00:00Z')
const sess = (rt: string, uid: string, expiresAt = NOW / 1000 + 3600) =>
  JSON.stringify({ access_token: `acces-secret-${rt}`, refresh_token: `renouv-secret-${rt}`, expires_at: expiresAt, user: { id: uid } })
const admin = { uid: ADMIN, name: 'Coach Démo', email: 'coach@exemple.test', role: 'admin' }
const leo = { uid: LEO, name: 'Léo Essai', email: 'leo@exemple.test', role: 'joueur' }
const emma = { uid: EMMA, name: '', email: 'emma@exemple.test', role: 'joueur' }
const tom = { uid: TOM, name: 'Tom Essai', email: 'tom@exemple.test', role: 'observateur' }

/** Premier ajout : l'administrateur (actif) est garé et devient la maison ; Léo est ajouté puis devient actif. */
const firstSwitch = () => {
  let l = park([], admin, sess('a1', ADMIN), HOME_DB, NOW)
  const r = addTest(l, leo, sess('l1', LEO), ADMIN, NOW)
  assert.ok(r.list)
  l = unpark(r.list, LEO)
  return l
}

t('base : la maison garde « handbase », chaque compte de test a la sienne ; valeur gardée invalide → maison', () => {
  assert.equal(testDbName(LEO), `handbase-compte-${LEO}`)
  assert.ok(isTestDb(testDbName(LEO)))
  assert.equal(activeDbOf(null), HOME_DB)
  assert.equal(activeDbOf(testDbName(LEO)), testDbName(LEO))
  for (const bad of ['handbase', 'handbase-essai', 'handbase-compte-', 'handbase-compte-../x', 'autre', `handbase-compte-${LEO}x`]) assert.equal(activeDbOf(bad), HOME_DB, bad)
})

t('premier ajout : maison = administrateur (session garée), Léo actif (aucune session garée : une seule copie)', () => {
  const l = firstSwitch()
  assert.equal(l.length, 2)
  const [h, test] = l
  assert.equal(h.uid, ADMIN)
  assert.ok(h.home)
  assert.equal(h.db, HOME_DB)
  assert.equal(h.session, sess('a1', ADMIN))
  assert.equal(test.uid, LEO)
  assert.ok(!test.home)
  assert.equal(test.db, testDbName(LEO))
  assert.equal(test.session, null)
})

t('retour : Léo garé avec SES derniers jetons, la maison redevient active (session plus garée)', () => {
  let l = firstSwitch()
  l = park(l, leo, sess('l2', LEO), testDbName(LEO), NOW + 1000)
  l = unpark(l, ADMIN)
  assert.equal(l.find((a) => a.uid === LEO)!.session, sess('l2', LEO))
  assert.equal(l.find((a) => a.uid === ADMIN)!.session, null)
  // Jamais le compte actif garé, jamais deux copies d'une session.
  const sessions = l.map((a) => a.session).filter(Boolean)
  assert.equal(new Set(sessions).size, sessions.length)
})

t('ajout : remplacement du même compte (reconnexion), au plus 2 comptes de test, pas le compte actif', () => {
  let l = firstSwitch()
  l = park(l, leo, sess('l2', LEO), testDbName(LEO), NOW)
  l = unpark(l, ADMIN)
  const again = addTest(l, { ...leo, name: 'Léo Essai' }, sess('l3', LEO), ADMIN, NOW)
  assert.ok(again.list)
  assert.equal(again.list.length, 2)
  assert.equal(again.list.find((a) => a.uid === LEO)!.session, sess('l3', LEO))
  const two = addTest(again.list, emma, sess('e1', EMMA), ADMIN, NOW)
  assert.ok(two.list)
  assert.equal(two.list.filter((a) => !a.home).length, MAX_TEST)
  assert.deepEqual(addTest(two.list, tom, sess('t1', TOM), ADMIN, NOW), { error: 'plein' })
  assert.deepEqual(addTest(two.list, admin, sess('a9', ADMIN), ADMIN, NOW), { error: 'actif' })
  // Maison reconnectée depuis un compte de test (sa session ne valait plus) : remplacée, toujours la maison.
  const fromLeo = unpark(park(two.list, leo, sess('l4', LEO), testDbName(LEO), NOW), LEO)
  const home = addTest(fromLeo, admin, sess('a2', ADMIN), LEO, NOW)
  assert.ok(home.list)
  assert.ok(home.list.find((a) => a.uid === ADMIN)!.home)
  assert.equal(home.list.find((a) => a.uid === ADMIN)!.session, sess('a2', ADMIN))
  assert.match(addErrorText('plein'), /2 comptes de test/)
})

t('retrait : un compte de test part, jamais la maison', () => {
  const l = firstSwitch()
  assert.deepEqual(
    removeTest(l, LEO).map((a) => a.uid),
    [ADMIN],
  )
  assert.equal(removeTest(l, ADMIN).length, 2)
})

t('liste relue : entrées invalides écartées, une seule maison, au plus 1 + 2, liste sans maison vide, base recalculée', () => {
  const l = firstSwitch()
  assert.deepEqual(parseList(listText(l)), l)
  assert.deepEqual(parseList('pas du json'), [])
  assert.deepEqual(parseList('{}'), [])
  const forged = [
    { uid: ADMIN, home: true, db: 'autre-base', session: 'x' },
    { uid: 'pas-un-id', home: false },
    { uid: ADMIN, home: false },
    { uid: LEO, home: true, db: HOME_DB },
    { uid: EMMA },
    { uid: TOM },
  ]
  const p = parseList(JSON.stringify(forged))
  assert.deepEqual(
    p.map((a) => [a.uid, a.home, a.db]),
    [
      [ADMIN, true, HOME_DB],
      [LEO, false, testDbName(LEO)],
      [EMMA, false, testDbName(EMMA)],
    ],
  )
  assert.deepEqual(parseList(JSON.stringify([{ uid: LEO, home: false, session: sess('l', LEO) }])), [])
})

t('réglages par compte : clés handbase.* seulement, thème et clés des comptes exclus', () => {
  const b = bundleOf([
    ['handbase.owner', ADMIN],
    ['handbase.lastPull.players', '123'],
    ['handbase.role', 'admin'],
    ['handbase.theme', 'sombre'],
    ['hb-comptes.base', testDbName(LEO)],
    ['sb-abc-auth-token', sess('a', ADMIN)],
    ['autre', '1'],
  ])
  assert.deepEqual(Object.keys(b).sort(), ['handbase.lastPull.players', 'handbase.owner', 'handbase.role'])
  assert.ok(!isAccountKey('handbase.theme'))
  assert.deepEqual(parseBundle(JSON.stringify({ ...b, 'sb-x-auth-token': 'jeton', 'handbase.n': 3 })), b)
  assert.deepEqual(parseBundle('cassé'), {})
})

t('qui voit quoi : vrai jeune → rien ; administrateur → ajouter ; compte de test → revenir, passer, retirer', () => {
  // Un vrai jeune sur son téléphone : aucune liste, pas administrateur.
  const young = accountsView([], LEO, HOME_DB, 'joueur')
  assert.deepEqual(young, { show: false, onTest: false, active: null, home: null, others: [], canAdd: false })
  // Un encadrant ordinaire : rien non plus.
  assert.equal(accountsView([], TOM, HOME_DB, 'preparateur').show, false)
  // L'administrateur, appareil sans compte de test : « Ajouter un compte de test… ».
  const a0 = accountsView([], ADMIN, HOME_DB, 'admin')
  assert.ok(a0.show && a0.canAdd && !a0.onTest)
  // Sur Léo (compte de test) : « Revenir sur Coach (admin) », pas d'ajout (Léo n'est pas administrateur).
  const l = firstSwitch()
  const onLeo = accountsView(l, LEO, testDbName(LEO), 'joueur')
  assert.ok(onLeo.show && onLeo.onTest)
  assert.equal(onLeo.home?.uid, ADMIN)
  assert.equal(onLeo.active?.uid, LEO)
  assert.deepEqual(onLeo.others, [])
  assert.equal(onLeo.canAdd, false)
  // Écran de connexion du compte de test (rôle oublié, compte inconnu) : la base dit où l'on est, le retour reste possible.
  const loginLeo = accountsView(l, null, testDbName(LEO), 'observateur')
  assert.ok(loginLeo.onTest && loginLeo.home?.uid === ADMIN)
  // Revenu sur l'administrateur : « Passer sur Léo (joueur) », ajout encore possible (1 sur 2).
  const back = unpark(park(l, leo, sess('l2', LEO), testDbName(LEO), NOW), ADMIN)
  const onAdmin = accountsView(back, ADMIN, HOME_DB, 'admin')
  assert.ok(!onAdmin.onTest && onAdmin.canAdd)
  assert.deepEqual(
    onAdmin.others.map((a) => a.uid),
    [LEO],
  )
  // Deux comptes de test : plus d'ajout.
  const full = addTest(back, emma, sess('e1', EMMA), ADMIN, NOW).list!
  assert.equal(accountsView(full, ADMIN, HOME_DB, 'admin').canAdd, false)
  // Maison sans session garée (ne devrait pas arriver) : pas de « Revenir » proposé.
  assert.equal(accountsView(l.map((a) => ({ ...a, session: null })), LEO, testDbName(LEO), 'joueur').home, null)
})

t('aucun jeton dans les textes affichés', () => {
  const l: SavedAccount[] = addTest(firstSwitch(), emma, sess('e1', EMMA), LEO, NOW).list!
  const shown = l.flatMap((a) => [accountLabel(a), firstName(a), `Passer sur ${accountLabel(a)}`, `Revenir sur ${accountLabel(a)}`])
  for (const s of shown) assert.ok(!/secret|acces-|renouv-|eyJ/.test(s), s)
  assert.equal(accountLabel(admin), 'Coach (admin)')
  assert.equal(accountLabel(leo), 'Léo (joueur)')
  assert.equal(accountLabel(emma), 'emma (joueur)')
  assert.equal(accountLabel({ name: '', email: '', role: '' }), 'ce compte')
})

t('session garée : fraîche ou à rafraîchir (marge 2 min), jetons lisibles', () => {
  assert.ok(sessionFresh(sess('a', ADMIN, NOW / 1000 + 600), NOW))
  assert.ok(!sessionFresh(sess('a', ADMIN, NOW / 1000 + 60), NOW))
  assert.ok(!sessionFresh(sess('a', ADMIN, NOW / 1000 - 10), NOW))
  assert.ok(!sessionFresh('cassé', NOW))
  assert.deepEqual(tokensOf(sess('a', ADMIN)), { access_token: 'acces-secret-a', refresh_token: 'renouv-secret-a' })
  assert.equal(tokensOf('{"access_token":1}'), null)
})

t('client à part (persistSession false) : connexion et renouvellement sans rien écrire dans le stockage du site', async () => {
  const writes: string[] = []
  const g = globalThis as { localStorage?: unknown }
  const before = g.localStorage
  g.localStorage = { getItem: () => null, setItem: (k: string) => void writes.push(k), removeItem: () => {}, key: () => null, length: 0 }
  try {
    const user = { id: LEO, email: 'leo@exemple.test', user_metadata: { full_name: 'Léo Essai' }, aud: 'authenticated', app_metadata: {}, created_at: '' }
    let k = 0
    const fetch = async (input: RequestInfo | URL) => {
      const u = String(input)
      assert.match(u, /\/auth\/v1\/token\?grant_type=(password|refresh_token)$/)
      k++
      return new Response(JSON.stringify({ access_token: `a${k}`, refresh_token: `r${k}`, expires_in: 3600, token_type: 'bearer', user }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    const c = createClient('https://abcdefgh.supabase.co', 'cle-publique', {
      global: { fetch },
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: 'hb-compte-1' },
      // (transport fictif : Node 20 n'a pas de WebSocket ; rien n'est ouvert)
      realtime: { transport: class {} as unknown as never },
    })
    const { data } = await c.auth.signInWithPassword({ email: 'leo@exemple.test', password: 'x' })
    assert.equal(data.session?.refresh_token, 'r1')
    const r = await c.auth.refreshSession({ refresh_token: 'r1' })
    assert.equal(r.data.session?.refresh_token, 'r2')
    // Texte gardé : relisible comme une session de supabase-js (jetons, expiration, compte).
    const kept = JSON.parse(JSON.stringify(r.data.session))
    assert.equal(kept.user.id, LEO)
    assert.equal(typeof kept.expires_at, 'number')
    assert.deepEqual(writes, [])
  } finally {
    g.localStorage = before
  }
})

t('branchements : base Dexie et service worker sur la base active, effacement complet, notifications, menu', () => {
  const src = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
  assert.match(src('src/db.ts'), /activeDbOf\(localStorage\.getItem\(BASE_KEY\)\)/)
  assert.match(src('src/db.ts'), /new Dexie\(TRIAL \? 'handbase-essai' : accountDb\)/)
  assert.match(src('src/veilleSw.ts'), /activeDbOf\(await idbKv\(\)\?\.get\(BASE_KEY\)\)/)
  const sync = src('src/sync.ts')
  assert.match(sync, /accountHooks\.forgetAll\(\)/)
  assert.match(sync, /if \(!supabase \|\| wiping \|\| frozen\) return/)
  const comptes = src('src/comptes.ts')
  assert.match(comptes, /accountHooks\.forgetAll = forgetAll/)
  // Session écrite AVANT la liste (jamais deux copies), dans le verrou de renouvellement.
  const lock = comptes.indexOf('await webLock()(')
  const write = comptes.indexOf('await authStorage.setItem(authStorageKey, target!)')
  const list = comptes.indexOf('await writeList(next)', write)
  assert.ok(lock > 0 && write > lock && list > write)
  assert.match(comptes, /persistSession: false/)
  assert.match(src('src/App.tsx'), /!player && !onTestAccount\(\)\) void syncSubscription\(\)/)
  assert.match(src('src/components/ProfileMenu.tsx'), /accountMenuItems\(accounts\)/)
  assert.match(src('src/logout.ts'), /keptAccounts\(\)/)
})

void chain.then(() => console.log(`\n${n} tests passés`))
