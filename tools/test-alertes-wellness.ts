// Test des alertes wellness de « Mes suivis » (src/wellnessAlerts.ts) : les 4 sortes (note sous un seuil, douleur, chute sur
// 14 jours, pas de réponse), 1 / 2 / 3 jours, jours non demandés (week-end, fériés, vacances), aujourd'hui sans réponse,
// plusieurs alertes, cible groupe ou tous les suivis, réglages relus, mots neutres accordés, pureté du module, mêmes
// constantes et mêmes vacances que le script SQL 080 (la même série en SQL : tools/essai-sql-080). Données fictives.
//
//   npx jiti tools/test-alertes-wellness.ts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { publicHolidays, SCHOOL_HOLIDAYS } from '../src/lamp'
import { WELLNESS_LOW_DAYS, WELLNESS_LOW_MAX } from '../src/wellnessAlert'
import {
  ALERT_KINDS,
  ALERT_NOTES,
  alertDefOf,
  alertsByPlayer,
  cleanRule,
  cleanRuleName,
  concernedText,
  DEFAULT_ALERT_NAME,
  DEFAULT_RULE,
  DROP_BASE_DAYS,
  DROP_BASE_MIN,
  evaluateAlerts,
  hitText,
  LOOKBACK_DAYS,
  morningText,
  myAlertsOf,
  noneText,
  notSharedText,
  requestedDayFor,
  ruleHit,
  ruleStreak,
  ruleText,
  RULE_DAYS_MAX,
  RULE_DROP_MAX,
  RULE_MAX_MAX,
  RULE_NAME_MAX,
  RULES_PER_ACCOUNT,
  type WellnessAlertDef,
} from '../src/wellnessAlerts'
import { CAS, rep } from './alertes-wellness-cas'

let n = 0
const ok = (name: string, f: () => void) => {
  f()
  n++
  console.log(`ok - ${name}`)
}

// ---------- Les cas communs (mêmes cas vérifiés en SQL par tools/essai-sql-080) ----------

for (const c of CAS) {
  ok(c.nom, () => {
    const s = ruleStreak(c.regle, c.entries, c.today, { requestedDay: requestedDayFor(c.zone ?? null), account: c.account, since: c.since })
    assert.equal(s.length, c.attendu)
  })
}

ok('les 4 sortes sont couvertes par les cas communs', () => {
  for (const k of ALERT_KINDS) assert.ok(CAS.some((c) => c.regle.type === k), k)
})

ok('1, 2 ou 3 jours : l’alerte se lève quand la série atteint la durée', () => {
  const entries = [rep('2026-11-23', 4), rep('2026-11-24', 4), rep('2026-11-25', 4)]
  for (const jours of [1, 2, 3, 4]) {
    const r = { type: 'seuil' as const, note: 'moyenne' as const, max: 5, jours }
    assert.equal(ruleHit(r, ruleStreak(r, entries, '2026-11-25')), jours <= 3, String(jours))
  }
})

ok('la série est faite des jours demandés, du plus récent au plus ancien', () => {
  const s = ruleStreak({ type: 'seuil', note: 'moyenne', max: 5, jours: 1 }, [rep('2026-11-20', 4), rep('2026-11-23', 4), rep('2026-11-24', 4)], '2026-11-25')
  assert.deepEqual(s, ['2026-11-24', '2026-11-23', '2026-11-20'])
})

ok('chute : jamais plus de 30 jours regardés en arrière', () => {
  assert.equal(LOOKBACK_DAYS, 30)
  assert.equal(DROP_BASE_DAYS, 14)
  assert.equal(DROP_BASE_MIN, 3)
})

// ---------- Plusieurs alertes, cible ----------

const def = (id: string, regle: WellnessAlertDef['regle'], cible: string | null = null, actif = true): WellnessAlertDef => ({ id, nom: id, actif, regle, cible })

ok('plusieurs alertes, cible groupe ou tous les suivis, alerte éteinte ignorée', () => {
  const low = [rep('2026-11-23', 4), rep('2026-11-24', 4, true), rep('2026-11-25', 4, true)]
  const fine = [rep('2026-11-23', 8), rep('2026-11-24', 8), rep('2026-11-25', 8, true)]
  const defs = [
    def('a', { type: 'seuil', note: 'moyenne', max: 5, jours: 3 }),
    def('b', { type: 'douleur', jours: 1 }, 'g1'),
    def('c', { type: 'douleur', jours: 1 }, null, false),
    def('d', { type: 'silence', jours: 1 }),
  ]
  const hits = evaluateAlerts(
    defs,
    [
      { id: 'p1', entries: low, account: true, groups: ['g1'] },
      { id: 'p2', entries: fine, account: true, groups: ['g2'] },
      { id: 'p3', entries: [rep('2026-11-20', 7)], account: true, groups: [] },
      { id: 'p4', entries: [], account: false, groups: ['g1'] },
    ],
    '2026-11-25',
  )
  assert.deepEqual(hits, [
    { alerte: 'a', playerId: 'p1', jours: 3 },
    { alerte: 'b', playerId: 'p1', jours: 2 },
    { alerte: 'd', playerId: 'p3', jours: 2 },
  ])
})

ok('aucune alerte réglée : rien', () => {
  assert.deepEqual(evaluateAlerts([], [{ id: 'p1', entries: [], account: true }], '2026-11-25'), [])
})

// ---------- Réglages relus ----------

ok('alerte proposée par défaut : celle du groupe (moyenne à 5 ou moins, 3 jours de suite)', () => {
  assert.deepEqual(DEFAULT_RULE, { type: 'seuil', note: 'moyenne', max: WELLNESS_LOW_MAX, jours: WELLNESS_LOW_DAYS })
  assert.equal(WELLNESS_LOW_MAX, 5)
  assert.equal(WELLNESS_LOW_DAYS, 3)
  assert.equal(DEFAULT_ALERT_NAME, 'À recharger')
})

ok('règle relue : clés connues seulement, bornes, sortes', () => {
  assert.deepEqual(cleanRule({ type: 'seuil', note: 'sommeil', max: 4, jours: 2, autre: 1 }), { type: 'seuil', note: 'sommeil', max: 4, jours: 2 })
  assert.deepEqual(cleanRule({ type: 'douleur', jours: 1, note: 'energie' }), { type: 'douleur', jours: 1 })
  assert.deepEqual(cleanRule({ type: 'chute', note: 'moyenne', baisse: 3, jours: 2 }), { type: 'chute', note: 'moyenne', baisse: 3, jours: 2 })
  assert.deepEqual(cleanRule({ type: 'silence', jours: 10 }), { type: 'silence', jours: 10 })
  for (const bad of [
    null,
    [],
    'seuil',
    { type: 'seuil', note: 'moyenne', max: 10, jours: 3 },
    { type: 'seuil', note: 'moyenne', max: 0, jours: 3 },
    { type: 'seuil', note: 'moral', max: 5, jours: 3 },
    { type: 'seuil', note: 'moyenne', max: 5, jours: 0 },
    { type: 'seuil', note: 'moyenne', max: 5, jours: 11 },
    { type: 'seuil', note: 'moyenne', max: 5.5, jours: 3 },
    { type: 'chute', note: 'moyenne', jours: 3 },
    { type: 'autre', jours: 3 },
    { type: 'douleur', jours: '2' },
  ])
    assert.equal(cleanRule(bad), null, JSON.stringify(bad))
})

ok('nom relu : espaces et retours à la ligne repliés, 40 caractères', () => {
  assert.equal(cleanRuleName('  À   recharger\n\tvite  '), 'À recharger vite')
  assert.equal(cleanRuleName('x'.repeat(60)).length, RULE_NAME_MAX)
  assert.equal(cleanRuleName('   '), '')
  assert.equal(cleanRuleName(3), '')
})

ok('ligne de la table relue (cible vide = tous mes suivis), ligne abîmée : null', () => {
  assert.deepEqual(alertDefOf({ id: 'u1', nom: 'Sommeil', actif: false, regle: { type: 'seuil', note: 'sommeil', max: 4, jours: 2 }, cible: '' }), {
    id: 'u1',
    nom: 'Sommeil',
    actif: false,
    regle: { type: 'seuil', note: 'sommeil', max: 4, jours: 2 },
    cible: null,
  })
  assert.equal(alertDefOf({ id: 'u1', nom: '', regle: DEFAULT_RULE }), null)
  assert.equal(alertDefOf({ id: 'u1', nom: 'x', regle: { type: 'seuil' } }), null)
})

ok('réponse du serveur relue : suivis lus, alertes (jamais une note)', () => {
  const r = myAlertsOf({ actif: true, jour: '2026-11-25', lus: ['p1', 'p2', 3], alertes: [{ alerte: 'a', joueur: 'p1', jours: 3 }, { alerte: 'b', joueur: 'p2', jours: 0 }, { x: 1 }] })
  assert.equal(r.enabled, true)
  assert.deepEqual([...r.readable], ['p1', 'p2'])
  assert.deepEqual(r.hits, [{ alerte: 'a', playerId: 'p1', jours: 3 }])
  assert.deepEqual(myAlertsOf(null), { enabled: false, readable: new Set(), hits: [] })
})

// ---------- Mots ----------

ok('mots neutres : À recharger, Douleur signalée, Baisse de 3 points, Pas de réponse depuis 2 jours', () => {
  assert.equal(hitText({ type: 'seuil', note: 'moyenne', max: 5, jours: 3 }, 3), 'À recharger · 3 jours de suite')
  assert.equal(hitText({ type: 'seuil', note: 'sommeil', max: 4, jours: 2 }, 2), 'À recharger · sommeil · 2 jours de suite')
  assert.equal(hitText({ type: 'douleur', jours: 1 }, 1), 'Douleur signalée · 1 jour de suite')
  assert.equal(hitText({ type: 'chute', note: 'moyenne', baisse: 3, jours: 1 }, 2), 'Baisse de 3 points · 2 jours de suite')
  assert.equal(hitText({ type: 'silence', jours: 2 }, 2), 'Pas de réponse depuis 2 jours')
  assert.equal(ruleText(DEFAULT_RULE), 'Moyenne des notes à 5 ou moins, 3 jours demandés de suite')
  assert.equal(ruleText({ type: 'douleur', jours: 1 }), 'Douleur signalée, 1 jour demandé')
  assert.match(ruleText({ type: 'chute', note: 'energie', baisse: 2, jours: 2 }), /^Énergie en baisse d’au moins 2 points sur sa moyenne des 14 jours d’avant/)
})

ok('accord au sexe (src/gender.ts)', () => {
  assert.equal(concernedText(2, 'F'), '2 joueuses concernées')
  assert.equal(concernedText(1, undefined), '1 joueur concerné')
  assert.equal(notSharedText(3, 'F'), '3 joueuses suivies : wellness non partagé avec toi')
  assert.equal(notSharedText(1, 'mixte'), '1 joueur suivi : wellness non partagé avec toi')
  assert.equal(noneText('F'), 'Aucune joueuse suivie concernée pour l’instant.')
  assert.equal(noneText(undefined), 'Aucun joueur suivi concerné pour l’instant.')
})

ok('notification : ni nom ni note, même texte que le serveur', () => {
  assert.equal(morningText(1), '1 alerte wellness sur tes suivis')
  assert.equal(morningText(2), '2 alertes wellness sur tes suivis')
  const sql = readFileSync(new URL('../supabase/080_alertes_wellness.sql', import.meta.url), 'utf8')
  assert.match(sql, /' alertes wellness sur tes suivis' else ' alerte wellness sur tes suivis'/)
  assert.match(sql, /'Alertes wellness',/)
  assert.match(sql, /'\/suivis'\);/)
})

// ---------- Une seule règle : mêmes constantes et mêmes jours en SQL ----------

const sql = readFileSync(new URL('../supabase/080_alertes_wellness.sql', import.meta.url), 'utf8')
const sqlInt = (fn: string) => Number(sql.match(new RegExp(`function public\\.${fn}\\(\\) returns int language sql immutable as \\$\\$ select (\\d+) \\$\\$`))?.[1])
const sqlArr = (fn: string) =>
  sql
    .match(new RegExp(`function public\\.${fn}\\(\\) returns text\\[\\] language sql immutable as \\$\\$\\s*select array\\[([^\\]]+)\\]`))?.[1]
    .split(',')
    .map((x) => x.trim().replace(/'/g, ''))

ok('constantes du script SQL = celles du module', () => {
  assert.equal(sqlInt('hb_wla_jours_max'), RULE_DAYS_MAX)
  assert.equal(sqlInt('hb_wla_points_max'), RULE_MAX_MAX)
  assert.equal(sqlInt('hb_wla_points_max'), RULE_DROP_MAX)
  assert.equal(sqlInt('hb_wla_base_jours'), DROP_BASE_DAYS)
  assert.equal(sqlInt('hb_wla_base_min'), DROP_BASE_MIN)
  assert.equal(sqlInt('hb_wla_recul'), LOOKBACK_DAYS)
  assert.equal(sqlInt('hb_wla_max_regles'), RULES_PER_ACCOUNT)
  assert.ok(sqlInt('hb_wla_fenetre') >= LOOKBACK_DAYS + DROP_BASE_DAYS + 2)
  assert.deepEqual(sqlArr('hb_wla_types'), [...ALERT_KINDS])
  assert.deepEqual(sqlArr('hb_wla_notes'), [...ALERT_NOTES])
  assert.match(sql, /left\(btrim\(regexp_replace\(coalesce\(p, ''\), '\[\[:cntrl:\]\[:space:\]\]\+', ' ', 'g'\)\), 40\)/)
})

ok('vacances scolaires du script SQL = SCHOOL_HOLIDAYS de src/lamp.ts', () => {
  const rows = [...sql.matchAll(/\('(\w+)', (null|'[ABC]'), '(\d{4}-\d{2}-\d{2})', '(\d{4}-\d{2}-\d{2})', (true|false)\)/g)].map((m) => ({
    id: m[1],
    zone: m[2] === 'null' ? undefined : m[2].replace(/'/g, ''),
    from: m[3],
    to: m[4],
    optional: m[5] === 'true',
  }))
  const lamp = Object.values(SCHOOL_HOLIDAYS)
    .flat()
    .map((h) => ({ id: h.id, zone: h.zone, from: h.from, to: h.to, optional: !!h.optional }))
  assert.deepEqual(rows, lamp)
})

ok('jours fériés : la même liste que publicHolidays (vérifiée en SQL par tools/essai-sql-080)', () => {
  assert.deepEqual(publicHolidays(2027).slice(0, 3), ['2027-01-01', '2027-03-29', '2027-05-01'])
  assert.match(sql, /public\.hb_wla_paques\(y\) \+ 1, public\.hb_wla_paques\(y\) \+ 39, public\.hb_wla_paques\(y\) \+ 50/)
})

ok('jours demandés : week-end, férié, vacances de la zone seulement si elle est connue, pont', () => {
  const none = requestedDayFor(null)
  const b = requestedDayFor('B')
  assert.ok(none('2026-11-23') && !none('2026-11-28') && !none('2026-11-11'))
  assert.ok(none('2026-10-19') && !b('2026-10-19'))
  assert.ok(!b('2027-05-07') && requestedDayFor('B', false)('2027-05-07'))
})

// ---------- Pureté, confidentialité ----------

ok('module pur (ni base, ni réseau, ni IA, ni stockage) et mots neutres', () => {
  const src = readFileSync(new URL('../src/wellnessAlerts.ts', import.meta.url), 'utf8')
  const imports = [...src.matchAll(/from '([^']+)'/g)].map((m) => m[1])
  assert.deepEqual(imports, ['./gender', './lamp', './wellness', './wellnessAlert'])
  assert.doesNotMatch(src, /fetch\(|supabase\.|mistral|localStorage|sessionStorage|indexedDB|dexie/i)
  const page = readFileSync(new URL('../src/pages/WellnessAlerts.tsx', import.meta.url), 'utf8')
  const box = readFileSync(new URL('../src/components/WellnessAlerts.tsx', import.meta.url), 'utf8')
  for (const t of [src, page, box]) for (const bad of ['mauvais', 'faible', 'pas retenu', 'inquiétant', 'inquietant', 'alarmant', 'nul ']) assert.ok(!t.toLowerCase().includes(bad), bad)
})

ok('l’appareil ne garde jamais de wellness : réglages seulement, résultats en mémoire', () => {
  const api = readFileSync(new URL('../src/wellnessAlertsApi.ts', import.meta.url), 'utf8')
  // Le stockage du navigateur ne sert qu'aux RÉGLAGES du mode essai (sans serveur).
  for (const m of api.matchAll(/localStorage\.setItem\(([^,]+),/g)) assert.equal(m[1].trim(), 'RULES_KEY')
  assert.doesNotMatch(api, /db\.(table|[a-z]+)\.(put|add|bulkPut|bulkAdd)/)
  assert.match(api, /hb_wellness_alertes_moi/)
  const box = readFileSync(new URL('../src/components/WellnessAlerts.tsx', import.meta.url), 'utf8')
  const page = readFileSync(new URL('../src/pages/WellnessAlerts.tsx', import.meta.url), 'utf8')
  const store = readFileSync(new URL('../src/wellnessAlertsStore.ts', import.meta.url), 'utf8')
  for (const t of [box, page, store]) assert.doesNotMatch(t, /localStorage|sessionStorage|useSessionState|indexedDB|db\.[a-z]+\.(put|add|bulkPut|bulkAdd|update)/)
  // Fenêtre des réglages : accrochée là où on a touché, fond flouté.
  assert.match(box, /<AnchoredBubble/)
})

// ---------- Cœur de l'en-tête et page « Alertes wellness » (plus de carte sur « Mes suivis ») ----------

ok('cœur de l’en-tête : staff seulement, un seul calcul partagé, page /alertes-wellness', () => {
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')
  const store = readFileSync(new URL('../src/wellnessAlertsStore.ts', import.meta.url), 'utf8')
  const follows = readFileSync(new URL('../src/pages/Follows.tsx', import.meta.url), 'utf8')
  const page = readFileSync(new URL('../src/pages/WellnessAlerts.tsx', import.meta.url), 'utf8')
  // « Mes suivis » ne montre plus la carte, ni pleine ni vide.
  assert.doesNotMatch(follows, /WellnessAlerts|alertes-wellness/)
  // En-tête : le cœur entre le micro (AskButton) et « Mes suivis », titre et nom lisibles, vers la page.
  const row = app.slice(app.indexOf('<AskButton bar />'), app.indexOf('<ProfileButton />', app.indexOf('<AskButton bar />')))
  assert.ok(row.indexOf('<WellnessHeart') > 0 && row.indexOf('<WellnessHeart') < row.indexOf('<FollowStar'), 'cœur avant « Mes suivis »')
  assert.match(app, /title="Alertes wellness"/)
  assert.match(app, /aria-label=\{n \? `Alertes wellness \(\$\{n\}\)` : 'Alertes wellness'\}/)
  assert.match(app, /n \? 'text-red-400/)
  assert.match(app, /<Route path="\/alertes-wellness" element=\{<WellnessAlertsPage \/>\} \/>/)
  // Un seul chargeur, pour le staff seulement ; le serveur appelé par le magasin partagé, pas par le cœur ni la page.
  assert.match(app, /!player && wellnessStaff\(role\) && <WellnessAlertsFeeder \/>/)
  assert.match(store, /export const wellnessStaff = \(r: Role\) => r === 'admin' \|\| r === 'preparateur'/)
  assert.doesNotMatch(page, /fetchMyAlerts|listAlertDefs/)
  assert.doesNotMatch(app, /fetchMyAlerts|listAlertDefs/)
  // Retour sur l'appli : relecture limitée (pas en boucle).
  assert.match(store, /visibilitychange[\s\S]{0,200}Date\.now\(\) - lastLoad > 30_000/)
})

ok('suivis en alerte : alertes connues et suivis seulement, regroupés par joueur', () => {
  const defs: WellnessAlertDef[] = [
    { id: 'a1', nom: 'Batterie', actif: true, regle: DEFAULT_RULE, cible: null },
    { id: 'a2', nom: 'Douleur', actif: true, regle: { type: 'douleur', jours: 1 }, cible: null },
  ]
  const hits = [
    { alerte: 'a1', playerId: 'j1', jours: 2 },
    { alerte: 'a2', playerId: 'j1', jours: 1 },
    { alerte: 'a1', playerId: 'j2', jours: 3 },
    { alerte: 'supprimee', playerId: 'j3', jours: 1 },
    { alerte: 'a1', playerId: 'plus-suivi', jours: 1 },
  ]
  const by = alertsByPlayer(defs, hits, new Set(['j1', 'j2', 'j3']))
  assert.deepEqual([...by.keys()], ['j1', 'j2'])
  assert.deepEqual(by.get('j1')!.map((h) => h.def.id), ['a1', 'a2'])
})

console.log(`\n${n} tests OK`)
