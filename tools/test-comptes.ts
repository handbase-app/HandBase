// Test de « Changer de compte » en un toucher (04/11 ; src/comptesCore.ts, src/comptes.ts, src/components/TestAccounts.tsx) ;
// comptes gardés aussi sur le compte administrateur (09/11 : supabase/076_comptes_test.sql, fonction comptes-test : fusion des
// listes, place sur l'appareil, liaison sans mot de passe des comptes déjà gardés, règles de la fonction) :
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
  realDbName,
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
  type RemoteAccount,
  parseRemote,
  remoteFromRows,
  remoteText,
  releaseCandidate,
  placeFor,
  homeUidOf,
  remoteErrorText,
} from '../src/comptesCore'
import { decisionLier, decisionOuvrir, libelleDe, lireDemande, MAX_LIGNES, roleTest, statutRefus } from '../supabase/functions/comptes-test/regles'

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
  // Version d'essai (serveur de test) : ses réglages « handbase-essai. » suivent le compte aussi ; base maison renommée.
  assert.ok(isAccountKey('handbase-essai.lastPull.players'))
  assert.ok(!isAccountKey('handbase-essai.theme'))
  assert.equal(realDbName(HOME_DB, true), 'handbase-essai')
  assert.equal(realDbName(HOME_DB, false), 'handbase')
  assert.equal(realDbName(testDbName('11111111-2222-3333-4444-555555555555'), true), 'handbase-compte-11111111-2222-3333-4444-555555555555')
  assert.deepEqual(parseBundle(JSON.stringify({ ...b, 'sb-x-auth-token': 'jeton', 'handbase.n': 3 })), b)
  assert.deepEqual(parseBundle('cassé'), {})
})

t('qui voit quoi : vrai jeune → rien ; administrateur → ajouter ; compte de test → revenir, passer, retirer', () => {
  // Un vrai jeune sur son téléphone : aucune liste, pas administrateur.
  const young = accountsView([], LEO, HOME_DB, 'joueur')
  assert.deepEqual(young, { show: false, onTest: false, active: null, home: null, others: [], canAdd: false, remote: [], toLink: [], linked: [], everywhere: false })
  // Même avec une liste du serveur (copie d'un autre compte) : rien.
  assert.deepEqual(accountsView([], LEO, HOME_DB, 'joueur', [{ uid: EMMA, name: '', email: 'emma@exemple.test', role: 'joueur', at: 0 }]).remote, [])
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
  assert.match(src('src/db.ts'), /new Dexie\(realDbName\(accountDb, TRIAL\)\)/)
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

// ---------- Comptes gardés sur le compte administrateur (076, fonction comptes-test) ----------

const rEmma: RemoteAccount = { uid: EMMA, name: '', email: 'emma@exemple.test', role: 'joueur', at: NOW }
const rTom: RemoteAccount = { uid: TOM, name: 'Tom Essai', email: 'tom@exemple.test', role: 'observateur', at: NOW }
const rLeo: RemoteAccount = { uid: LEO, name: 'Léo Essai', email: 'leo@exemple.test', role: 'joueur', at: NOW }

t('liste du serveur : lignes valables seulement, copie locale lue par CET administrateur seulement', () => {
  const rows = [
    { test_uid: EMMA.toUpperCase(), email: 'emma@exemple.test', libelle: '', role: 'joueur', ajoute_le: '2026-11-04T18:00:00Z' },
    { test_uid: EMMA, email: 'double@exemple.test' },
    { test_uid: 'pas-un-id' },
    null,
    { test_uid: TOM, email: 'tom@exemple.test', libelle: 'Tom Essai', role: 'admin', ajoute_le: 'cassé' },
  ]
  const r = remoteFromRows(rows)
  assert.deepEqual(r, [
    { uid: EMMA, name: '', email: 'emma@exemple.test', role: 'joueur', at: NOW },
    // Rôle administrateur jamais montré comme tel (la fonction le refuse de toute façon).
    { uid: TOM, name: 'Tom Essai', email: 'tom@exemple.test', role: '', at: 0 },
  ])
  assert.deepEqual(remoteFromRows('pas une liste'), [])
  const text = remoteText(ADMIN, r)
  assert.deepEqual(parseRemote(text, ADMIN), r)
  assert.deepEqual(parseRemote(text, ADMIN.toUpperCase()), r)
  // Un autre administrateur sur le même appareil : rien (pas la liste d'un autre).
  assert.equal(parseRemote(text, LEO), null)
  assert.equal(parseRemote(text, null), null)
  assert.equal(parseRemote('cassé', ADMIN), null)
  assert.equal(parseRemote(null, ADMIN), null)
  // Administrateur de l'appareil : la maison ; sans liste, le compte actif s'il est administrateur.
  assert.equal(homeUidOf(firstSwitch(), LEO, 'joueur'), ADMIN)
  assert.equal(homeUidOf([], ADMIN, 'admin'), ADMIN)
  assert.equal(homeUidOf([], LEO, 'joueur'), null)
})

t('fusion : comptes du serveur absents de l’appareil proposés, ceux de l’appareil pas en double, à lier sans mot de passe', () => {
  // Administrateur seul sur un nouvel appareil (téléphone) : Emma et Tom ajoutés ailleurs → « Passer sur … ».
  const phone = accountsView([], ADMIN, HOME_DB, 'admin', [rEmma, rTom])
  assert.ok(phone.everywhere && phone.canAdd)
  assert.deepEqual(
    phone.remote.map((r) => r.uid),
    [EMMA, TOM],
  )
  assert.deepEqual(phone.toLink, [])
  // Avant 076 (null) : exactement comme avant.
  const before = accountsView([], ADMIN, HOME_DB, 'admin', null)
  assert.ok(!before.everywhere)
  assert.deepEqual(before.remote, [])
  // Sur l'ordinateur : Léo gardé (garé) et enregistré, Emma au serveur seulement.
  const back = unpark(park(firstSwitch(), leo, sess('l2', LEO), testDbName(LEO), NOW), ADMIN)
  const pc = accountsView(back, ADMIN, HOME_DB, 'admin', [rLeo, rEmma])
  assert.deepEqual(
    pc.others.map((a) => a.uid),
    [LEO],
  )
  assert.deepEqual(
    pc.remote.map((r) => r.uid),
    [EMMA],
  )
  assert.deepEqual(pc.linked, [LEO])
  assert.deepEqual(pc.toLink, [])
  // Léo ajouté avant cette version (pas au serveur) : proposé à la liaison (sa session est gardée).
  const old = accountsView(back, ADMIN, HOME_DB, 'admin', [rEmma])
  assert.deepEqual(
    old.toLink.map((a) => a.uid),
    [LEO],
  )
  assert.deepEqual(old.linked, [])
  // Sur Léo (compte de test actif, pas au serveur) : liste du serveur visible (administrateur garé), Léo à lier, pas en double.
  const l = firstSwitch()
  const onLeo = accountsView(l, LEO, testDbName(LEO), 'joueur', [rEmma, rTom])
  assert.ok(onLeo.everywhere)
  assert.deepEqual(
    onLeo.remote.map((r) => r.uid),
    [EMMA, TOM],
  )
  assert.deepEqual(
    onLeo.toLink.map((a) => a.uid),
    [LEO],
  )
  const onLeoLinked = accountsView(l, LEO, testDbName(LEO), 'joueur', [rLeo, rEmma])
  assert.deepEqual(
    onLeoLinked.remote.map((r) => r.uid),
    [EMMA],
  )
  assert.deepEqual(onLeoLinked.linked, [LEO])
  // Maison sans session garée : pas de jeton administrateur → rien du serveur.
  const noHome = accountsView(
    l.map((a) => ({ ...a, session: null })),
    LEO,
    testDbName(LEO),
    'joueur',
    [rEmma],
  )
  assert.ok(!noHome.everywhere)
  assert.deepEqual(noHome.remote, [])
  // La maison elle-même n'est jamais proposée comme compte de test.
  const self = accountsView(back, ADMIN, HOME_DB, 'admin', [{ ...rEmma, uid: ADMIN }])
  assert.deepEqual(self.remote, [])
})

t('appareil plein : le compte enregistré utilisé le moins récemment laisse sa place ; sinon « plein »', () => {
  // Maison + Léo + Emma (2 comptes de test), administrateur actif.
  let l = unpark(park(firstSwitch(), leo, sess('l2', LEO), testDbName(LEO), NOW), ADMIN)
  l = addTest(l, emma, sess('e1', EMMA), ADMIN, NOW + 5000).list!
  // Léo utilisé avant Emma.
  assert.ok(l.find((a) => a.uid === LEO)!.used < l.find((a) => a.uid === EMMA)!.used)
  // Tom (au serveur) à ouvrir : aucun enregistré → plein.
  assert.deepEqual(placeFor(l, TOM, ADMIN, [TOM]), { error: 'plein' })
  // Léo et Emma enregistrés : Léo (le moins récent) laisse sa place.
  const p = placeFor(l, TOM, ADMIN, [TOM, LEO, EMMA])
  assert.ok('release' in p && p.release.uid === LEO)
  // Emma seule enregistrée : c'est elle.
  const p2 = placeFor(l, TOM, ADMIN, [EMMA])
  assert.ok('release' in p2 && p2.release.uid === EMMA)
  // Compte déjà sur l'appareil, ou place libre : rien à libérer.
  assert.deepEqual(placeFor(l, LEO, ADMIN, []), { ok: true })
  assert.deepEqual(placeFor(firstSwitch(), TOM, LEO, []), { ok: true })
  // Jamais le compte actif ni la maison.
  assert.equal(releaseCandidate(l, LEO, [LEO]), null)
  assert.equal(releaseCandidate(l, EMMA, [ADMIN]), null)
  // Passage sur un compte : sa date d'usage avance (unpark avec la date).
  const used = unpark(l, LEO, NOW + 9000)
  assert.equal(used.find((a) => a.uid === LEO)!.used, NOW + 9000)
  const p3 = placeFor(used, TOM, ADMIN, [LEO, EMMA])
  assert.ok('release' in p3 && p3.release.uid === EMMA)
  // Ajout possible quand l'appareil est plein mais qu'un compte enregistré peut laisser sa place.
  assert.equal(accountsView(l, ADMIN, HOME_DB, 'admin', [rLeo]).canAdd, true)
  assert.equal(accountsView(l, ADMIN, HOME_DB, 'admin', []).canAdd, false)
  // Liste d'avant (sans « used ») : relue avec la date d'ajout.
  const legacy = parseList(JSON.stringify(l.map(({ used: _u, ...a }) => a)))
  assert.equal(legacy.find((a) => a.uid === EMMA)!.used, NOW + 5000)
})

t('fonction comptes-test : demandes lues, décisions (administrateur seulement, jamais un administrateur comme cible)', () => {
  const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.c2lnbmF0dXJl'
  assert.deepEqual(lireDemande(JSON.stringify({ action: 'lier', jeton_test: jwt })), { action: 'lier', jeton_test: jwt })
  assert.deepEqual(lireDemande(JSON.stringify({ action: 'ouvrir', test_uid: EMMA.toUpperCase() })), { action: 'ouvrir', test_uid: EMMA })
  assert.deepEqual(lireDemande(JSON.stringify({ action: 'retirer', test_uid: TOM })), { action: 'retirer', test_uid: TOM })
  for (const bad of ['', 'cassé', '[]', '{}', JSON.stringify({ action: 'lier' }), JSON.stringify({ action: 'lier', jeton_test: 'pas un jeton' }), JSON.stringify({ action: 'ouvrir', test_uid: 'x' }), JSON.stringify({ action: 'supprimer', test_uid: TOM }), 'x'.repeat(9000)])
    assert.equal(lireDemande(bad), null, bad.slice(0, 40))
  const base = { appelant: ADMIN, roleAppelant: 'admin', cible: LEO, roleCible: 'joueur', lignes: 0, dejaLie: false }
  assert.equal(decisionLier(base), null)
  assert.equal(decisionLier({ ...base, roleAppelant: 'preparateur' }), 'pas_admin')
  assert.equal(decisionLier({ ...base, cible: ADMIN.toUpperCase() }), 'meme_compte')
  assert.equal(decisionLier({ ...base, roleCible: 'admin' }), 'cible_admin')
  assert.equal(decisionLier({ ...base, lignes: MAX_LIGNES }), 'trop')
  assert.equal(decisionLier({ ...base, lignes: MAX_LIGNES, dejaLie: true }), null)
  const o = { roleAppelant: 'admin', ligne: true, cibleExiste: true, email: 'leo@exemple.test', bloqueeJusqua: null, roleCible: 'joueur', maintenant: NOW }
  assert.equal(decisionOuvrir(o), null)
  assert.equal(decisionOuvrir({ ...o, roleAppelant: 'joueur' }), 'pas_admin')
  assert.equal(decisionOuvrir({ ...o, ligne: false }), 'inconnu')
  assert.equal(decisionOuvrir({ ...o, cibleExiste: false }), 'cible_absente')
  assert.equal(decisionOuvrir({ ...o, email: '' }), 'cible_absente')
  assert.equal(decisionOuvrir({ ...o, bloqueeJusqua: '2026-12-01T00:00:00Z' }), 'cible_bloquee')
  assert.equal(decisionOuvrir({ ...o, bloqueeJusqua: '2026-01-01T00:00:00Z' }), null)
  assert.equal(decisionOuvrir({ ...o, roleCible: 'admin' }), 'cible_admin')
  assert.equal(statutRefus('pas_admin'), 403)
  assert.equal(statutRefus('trop'), 409)
  assert.equal(statutRefus('inconnu'), 404)
  assert.equal(roleTest('admin'), '')
  assert.equal(roleTest('joueur'), 'joueur')
  assert.equal(libelleDe({ full_name: '  Léo Essai ' }), 'Léo Essai')
  assert.equal(libelleDe(null), '')
  // Messages clairs, sans jeton.
  for (const c of ['pas_admin', 'cible_admin', 'inconnu', 'trop', 'non_connecte', '', 'serveur']) assert.ok(!/eyJ|token|jeton/i.test(remoteErrorText(c)), c)
})

t('fonction comptes-test : jamais de jeton stocké ni journalisé, generateLink sans envoi, 076 sans colonne secrète', () => {
  const src = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
  const fn = src('supabase/functions/comptes-test/index.ts')
  assert.doesNotMatch(fn.replace(/^\s*\/\/.*$/gm, ''), /console\./)
  assert.match(fn, /generateLink\(\{ type: 'magiclink', email/)
  assert.match(fn, /return json\(\{ token_hash: tokenHash \}\)/)
  // La ligne enregistrée : e-mail, libellé, rôle ; jamais le jeton.
  const ligne = fn.slice(fn.indexOf('const ligne = {'), fn.indexOf('}', fn.indexOf('const ligne = {')))
  assert.doesNotMatch(ligne, /jeton|token/)
  const sql = src('supabase/076_comptes_test.sql')
  const table = sql.slice(sql.indexOf('create table'), sql.indexOf(');', sql.indexOf('create table')))
  assert.doesNotMatch(table, /pass|jeton|token|secret/i)
  assert.match(sql, /revoke all on public\.hb_comptes_test from public, anon, authenticated;/)
  assert.match(sql, /grant select on public\.hb_comptes_test to authenticated;/)
  assert.match(sql, /using \(admin_uid = \(select auth\.uid\(\)\) and \(select public\.hb_is_admin\(\)\)\)/)
  // Appli : rien du serveur pendant « Voir comme… », liaison après la connexion avec mot de passe, échange sur un client à part.
  const comptes = src('src/comptes.ts')
  assert.match(comptes, /const remoteList = \(\) => \(spyTarget\(\) \? null/)
  assert.match(comptes, /async function adminToken\(\)[^]*?if \(spyTarget\(\)\) return null/)
  assert.match(comptes, /linkRemote\(s\.access_token\)/)
  assert.match(comptes, /tempClient\(\)\s*\n\s*let v = await c\.auth\.verifyOtp\(\{ token_hash: hash, type: 'magiclink' \}\)/)
  assert.match(comptes, /await kv\.del\(REMOTE_KEY\)/)
})

t('ouverture : jeton à usage unique échangé (verify, type magiclink) sur un client à part, sans rien écrire dans le stockage', async () => {
  const writes: string[] = []
  const g = globalThis as { localStorage?: unknown }
  const before = g.localStorage
  g.localStorage = { getItem: () => null, setItem: (k: string) => void writes.push(k), removeItem: () => {}, key: () => null, length: 0 }
  try {
    const user = { id: EMMA, email: 'emma@exemple.test', user_metadata: {}, aud: 'authenticated', app_metadata: {}, created_at: '' }
    const seen: { url: string; body: Record<string, unknown> }[] = []
    const fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      seen.push({ url: String(input), body: JSON.parse(String(init?.body ?? '{}')) })
      return new Response(JSON.stringify({ access_token: 'a1', refresh_token: 'r1', expires_in: 3600, token_type: 'bearer', user }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    const c = createClient('https://abcdefgh.supabase.co', 'cle-publique', {
      global: { fetch },
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: 'hb-compte-2' },
      realtime: { transport: class {} as unknown as never },
    })
    const { data } = await c.auth.verifyOtp({ token_hash: 'hache-fictif', type: 'magiclink' })
    assert.equal(data.session?.user.id, EMMA)
    assert.equal(seen.length, 1)
    assert.match(seen[0].url, /\/auth\/v1\/verify$/)
    assert.equal(seen[0].body.token_hash, 'hache-fictif')
    assert.equal(seen[0].body.type, 'magiclink')
    assert.deepEqual(writes, [])
  } finally {
    g.localStorage = before
  }
})

void chain.then(() => console.log(`\n${n} tests passés`))
