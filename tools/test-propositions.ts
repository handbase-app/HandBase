// Test de la boîte « À valider » (src/propositionsCore.ts, règles pures) : garder un tableau pour plus tard (lignes, titre,
// contexte, limites : 300 lignes, 200 Ko, 30 en attente), pastille de l'en-tête (comptage, texte), passage collage →
// proposition → validation en partie → « Défaire », état après validation, lignes déposées par le serveur MCP (objets),
// aller-retour avec le serveur (envoi, relecture, version locale plus récente, oubli des effacées), ménage de l'appareil,
// mêmes bornes que supabase/067_propositions.sql, notification de la fonction « veille » (texte, message minimal, préférence)
// et branchements dans l'appli. Données FICTIVES seulement.
//
//   npx jiti tools/test-propositions.ts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parseTable, propose, toWrite, willSave, autoChecked, type Candidate, type ImportCriterion, type ImportCtx } from '../src/importMesures'
import {
  badgeCount,
  badgeLabel,
  cellsOf,
  dataLineCount,
  defaultTitle,
  etatApresValidation,
  expiredLocal,
  fromServer,
  isPending,
  jsonBytes,
  LIMITS,
  pendingOf,
  planDelete,
  planEtat,
  planKeep,
  planPull,
  porteeLabel,
  rowsOf,
  SOURCE_LABEL,
  toServer,
  type PropositionRow,
  type ServerProposition,
} from '../src/propositionsCore'
import {
  idProposition,
  propositionAAnnoncer,
  propositionIsMinimal,
  propositionPayload,
  propositionTexte,
  PROPOSITION_URL,
  titreCourt,
} from '../supabase/functions/veille/veille'

let n = 0
const t = (name: string, f: () => void) => {
  f()
  n++
  console.log(`ok ${n} - ${name}`)
}

const ME = '00000000-0000-0000-0000-0000000000d1'
const OTHER = '00000000-0000-0000-0000-0000000000d2'
const NOW = Date.parse('2026-11-05T10:00:00Z')
const DAY = 86_400_000
let seq = 0
const newId = () => `p-${++seq}`
const opts = (now = NOW) => ({ owner: ME, now, newId })

const TABLE = `| Joueur | Sprint 10 m (s) | CMJ (cm) |
|---|---|---|
| Lucas Exemple | 1,86 | 38 |
| Emma Fictive | 1,92 | 35 |
| Personne Inconnue | 2,01 | 30 |`

const ctxEv = { portee: 'evenement' as const, id: 'ev-1', nom: 'Pôle U15', date: '2026-09-05', joueurs: ['j1', 'j2'] }

const keep = (rows: string[][], existing: PropositionRow[] = [], o = opts()) => {
  const r = planKeep(existing, { rows, contexte: ctxEv }, o)
  if ('error' in r) throw new Error(r.error)
  return r.row
}

t('garder un tableau collé : nouvelle proposition en attente, titre et contexte', () => {
  const rows = parseTable(TABLE).rows
  const r = keep(rows)
  assert.equal(r.owner, ME)
  assert.equal(r.source, 'collage')
  assert.equal(r.kind, 'mesures')
  assert.equal(r.etat, 'en_attente')
  assert.equal(r.titre, 'Tests du 05/09 · Pôle U15')
  assert.equal(r.dirty, 1)
  assert.equal(r.onServer, 0)
  assert.equal(r.expiresAt - r.createdAt, LIMITS.joursExpiration * DAY)
  assert.deepEqual(r.lignes[0], ['Joueur', 'Sprint 10 m (s)', 'CMJ (cm)'])
  assert.equal(r.lignes.length, 4)
  assert.deepEqual(r.contexte.joueurs, ['j1', 'j2'])
  assert.equal(dataLineCount(r.lignes), 3)
})

t('titre : donné, sinon « Tests du … · nom », sinon « Tests » ; lignes vides retirées', () => {
  const r = planKeep([], { rows: [['a', '1'], ['', '  '], []], contexte: {}, titre: '  Tests\n rentrée  ' }, opts())
  assert.ok(!('error' in r))
  if ('error' in r) return
  assert.equal(r.row.titre, 'Tests rentrée')
  assert.equal(r.row.lignes.length, 1)
  assert.equal(defaultTitle({}), 'Tests')
  assert.equal(defaultTitle({ date: '2026-11-05' }), 'Tests du 05/11')
  assert.ok(defaultTitle({ date: '2026-11-05', nom: 'x'.repeat(200) }).length <= LIMITS.titre)
})

t('limites : tableau vide, 300 lignes au plus, 200 Ko au plus, 30 en attente au plus', () => {
  assert.ok('error' in planKeep([], { rows: [['', '']], contexte: {} }, opts()))
  const many = Array.from({ length: 301 }, (_, i) => [`Joueur ${i}`, '1,8'])
  assert.match((planKeep([], { rows: many, contexte: {} }, opts()) as { error: string }).error, /300 lignes/)
  assert.ok(!('error' in planKeep([], { rows: many.slice(0, 300), contexte: {} }, opts())))
  const big = Array.from({ length: 210 }, () => ['x'.repeat(1000)])
  assert.match((planKeep([], { rows: big, contexte: {} }, opts()) as { error: string }).error, /200 Ko/)
  const full: PropositionRow[] = []
  for (let i = 0; i < LIMITS.enAttente; i++) full.push(keep([['a', String(i)]], full))
  assert.equal(badgeCount(full, ME, NOW), 30)
  assert.match((planKeep(full, { rows: [['b', '1']], contexte: {} }, opts()) as { error: string }).error, /pleine/)
  // Une traitée libère une place ; celles d'un autre compte ne comptent pas.
  full[0] = planEtat(full[0], 'validee', NOW)
  assert.ok(!('error' in planKeep(full, { rows: [['b', '1']], contexte: {} }, opts())))
  assert.ok(!('error' in planKeep(full, { rows: [['b', '1']], contexte: {} }, { ...opts(), owner: OTHER })))
})

t('contexte borné : joueurs coupés à 600, choix retirés plutôt que de dépasser 32 Ko', () => {
  const joueurs = Array.from({ length: 900 }, (_, i) => `00000000-0000-0000-0000-${String(i).padStart(12, '0')}`)
  const r = planKeep([], { rows: [['a', '1']], contexte: { portee: 'groupe', nom: 'G', joueurs } }, opts())
  assert.ok(!('error' in r))
  if ('error' in r) return
  assert.equal(r.row.contexte.joueurs?.length, LIMITS.joueurs)
  assert.ok(jsonBytes(r.row.contexte) <= LIMITS.contexte)
  const huge = planKeep([], { rows: [['a', '1']], contexte: { choix: { values: Object.fromEntries(Array.from({ length: 3000 }, (_, i) => [`${i}:1`, 'x'.repeat(10)])) } } }, opts())
  assert.ok(!('error' in huge) && !huge.row.contexte.choix)
})

t('rouvrir et garder de nouveau : même proposition (identifiant, création), choix mis à jour', () => {
  const a = keep(parseTable(TABLE).rows)
  const b = planKeep([a], { id: a.id, rows: parseTable(TABLE).rows, contexte: { ...ctxEv, choix: { players: { 2: '' } } } }, opts(NOW + 5000))
  assert.ok(!('error' in b))
  if ('error' in b) return
  assert.equal(b.row.id, a.id)
  assert.equal(b.row.createdAt, a.createdAt)
  assert.deepEqual(b.row.contexte.choix, { players: { 2: '' } })
  assert.ok(b.row.updatedAt > a.updatedAt)
})

t('pastille : seulement mes propositions en attente (ni traitées, ni retirées, ni expirées, sorte connue)', () => {
  const rows: PropositionRow[] = []
  rows.push(keep([['a', '1']], rows))
  rows.push(keep([['b', '1']], rows))
  rows.push(planEtat(keep([['c', '1']], rows), 'rejetee', NOW))
  rows.push(planDelete(keep([['d', '1']], rows), NOW))
  rows.push({ ...keep([['e', '1']], rows), expiresAt: NOW - 1 })
  rows.push({ ...keep([['f', '1']], rows), kind: 'avis' })
  rows.push({ ...keep([['g', '1']], rows), owner: OTHER })
  assert.equal(badgeCount(rows, ME, NOW), 2)
  assert.equal(badgeCount([], ME, NOW), 0)
  assert.equal(badgeLabel(0), '')
  assert.equal(badgeLabel(2), '2 à valider')
  assert.equal(badgeLabel(150), '99+ à valider')
  // Plus récente d'abord.
  const later = { ...rows[1], createdAt: NOW + 1000 }
  assert.deepEqual(pendingOf([rows[0], later], ME, NOW).map((r) => r.id), [later.id, rows[0].id])
  assert.equal(isPending({ etat: 'en_attente', expiresAt: NOW + 1 }, NOW), true)
  assert.equal(isPending({ etat: 'en_attente', expiresAt: NOW }, NOW), false)
})

// Passage complet avec le module de « Coller un tableau » : collage → proposition → écran « À valider » → validation partielle.
let order = 0
const crit = (id: string, label: string, unit?: string): ImportCriterion => ({ id, label, unit, scale: 'number', category: 'Tests', order: order++, kind: 'factual', active: true })
const CRITERIA = [crit('sprint_10', 'Sprint 10 m', 's'), crit('cmj_hauteur', 'CMJ – hauteur', 'cm')]
const PLAYERS: Candidate[] = [
  { id: 'j1', firstName: 'Lucas', lastName: 'Exemple', birthDate: '2011-03-02' },
  { id: 'j2', firstName: 'Emma', lastName: 'Fictive', birthDate: '2011-07-12' },
]

t('collage → proposition → validation en partie → la pastille disparaît → « Défaire » la remet', () => {
  const pasted = parseTable(TABLE)
  let box: PropositionRow[] = [keep(pasted.rows)]
  assert.equal(badgeCount(box, ME, NOW), 1)
  // Rouverte depuis la boîte : ses lignes brutes repassent dans propose(), comme le tableau collé.
  const p = box[0]
  const ctx: ImportCtx = { criteria: CRITERIA, players: PLAYERS, existing: [], date: p.contexte.date!, today: '2026-11-05' }
  const proposal = propose(rowsOf(p.lignes), ctx)
  assert.equal(proposal.rows.length, 3)
  assert.equal(proposal.rows[2].match.confidence, 'introuvable')
  const checked = (r: (typeof proposal.rows)[number]) => autoChecked(r)
  const written = toWrite(proposal, checked)
  assert.equal(written.length, 4) // 2 joueurs × 2 tests
  // Même calcul que l'écran « À valider » (ImportReview, onSaved).
  const lignes = proposal.rows.filter((r) => r.values.some((v) => v.value !== undefined)).length
  const enregistrees = proposal.rows.filter((r) => r.match.playerId && checked(r) && r.values.some((v) => willSave(v))).length
  assert.deepEqual({ lignes, enregistrees }, { lignes: 3, enregistrees: 2 })
  const etat = etatApresValidation({ lignes, enregistrees })
  assert.equal(etat, 'partielle')
  box = [planEtat(p, etat, NOW + 1000)]
  assert.equal(badgeCount(box, ME, NOW + 1000), 0)
  assert.equal(box[0].dirty, 1)
  // « Défaire » dans les 10 s : de nouveau en attente.
  box = [planEtat(box[0], 'en_attente', NOW + 2000)]
  assert.equal(badgeCount(box, ME, NOW + 2000), 1)
})

t('état après validation : toutes, une partie, aucune', () => {
  assert.equal(etatApresValidation({ lignes: 3, enregistrees: 3 }), 'validee')
  assert.equal(etatApresValidation({ lignes: 3, enregistrees: 1 }), 'partielle')
  assert.equal(etatApresValidation({ lignes: 3, enregistrees: 0 }), 'en_attente')
  assert.equal(etatApresValidation({ lignes: 0, enregistrees: 0 }), 'en_attente')
})

t('lignes déposées par le serveur MCP : listes ou objets { cellules, … } ; libellés', () => {
  assert.deepEqual(cellsOf(['Lucas', 1.86, null]), ['Lucas', '1.86', ''])
  assert.deepEqual(cellsOf({ cellules: ['J-A07', '1,86'], code: 'J-A07' }), ['J-A07', '1,86'])
  assert.deepEqual(cellsOf(42), [])
  assert.deepEqual(rowsOf([['Joueur', 'Taille'], { cellules: ['J-A07', '172'] }, ['', ''], 'x']), [['Joueur', 'Taille'], ['J-A07', '172']])
  assert.equal(SOURCE_LABEL.mcp, 'depuis Claude')
  assert.equal(SOURCE_LABEL.collage, 'collé')
  assert.equal(porteeLabel({ portee: 'groupe', nom: 'Pôle U15' }), 'groupe « Pôle U15 »')
  assert.equal(porteeLabel({}), 'toute la base')
})

const server = (r: PropositionRow, over: Partial<ServerProposition> = {}): ServerProposition => ({
  ...toServer(r),
  created_at: new Date(r.createdAt).toISOString(),
  updated_at: new Date(r.updatedAt).toISOString(),
  expires_at: new Date(r.expiresAt).toISOString(),
  ...over,
})

t('serveur : ce qui part (sans compte ni dates de création), ce qui revient, version locale plus récente gardée', () => {
  const r = keep(parseTable(TABLE).rows)
  const body = toServer(r)
  assert.deepEqual(Object.keys(body).sort(), ['contexte', 'deleted_at', 'etat', 'id', 'kind', 'lignes', 'source', 'titre'])
  const back = fromServer(server(r), undefined, ME)
  assert.ok(back)
  assert.equal(back!.dirty, 0)
  assert.equal(back!.onServer, 1)
  assert.deepEqual(back!.lignes, r.lignes)
  // Modifiée ici après la version du serveur : la version locale l'emporte.
  const local = planEtat({ ...back!, dirty: 0 }, 'validee', r.updatedAt + 10_000)
  assert.equal(fromServer(server(r), local, ME), null)
  // Valeurs inconnues : ignorée.
  assert.equal(fromServer(server(r, { etat: 'perdue' }), undefined, ME), null)
  assert.equal(fromServer(server(r, { lignes: 'x' }), undefined, ME), null)
  // Retirée ailleurs : date du retrait reprise.
  const del = fromServer(server(r, { deleted_at: new Date(NOW).toISOString() }), undefined, ME)
  assert.equal(del!.deletedAt, NOW)
})

t('relecture : nouvelles et changées relues, effacées sur le serveur oubliées (sauf modifiées ici)', () => {
  const a = { ...keep([['a', '1']]), dirty: 0 as const, onServer: 1 as const }
  const b = { ...keep([['b', '1']]), dirty: 0 as const, onServer: 1 as const }
  const c = { ...keep([['c', '1']]), dirty: 1 as const, onServer: 1 as const }
  const d = keep([['d', '1']]) // jamais envoyée
  const meta = [
    { id: a.id, updated_at: new Date(a.updatedAt).toISOString() },
    { id: b.id, updated_at: new Date(b.updatedAt + 60_000).toISOString() },
    { id: 'mcp-1', updated_at: new Date(NOW).toISOString() },
  ]
  const plan = planPull([a, b, c, d], meta, ME)
  assert.deepEqual(plan.fetch.sort(), [b.id, 'mcp-1'].sort())
  assert.deepEqual(plan.forget, [])
  const plan2 = planPull([a, b, c, d], [], ME)
  assert.deepEqual(plan2.forget.sort(), [a.id, b.id].sort()) // c : modifiée ici ; d : pas encore envoyée
})

t('ménage de l\'appareil : traitées ou retirées depuis 7 jours, expirées ; rien qui reste à envoyer', () => {
  const a = { ...planEtat(keep([['a', '1']]), 'validee', NOW), updatedAt: NOW - 8 * DAY, dirty: 0 as const }
  const b = { ...planEtat(keep([['b', '1']]), 'validee', NOW), updatedAt: NOW - 2 * DAY, dirty: 0 as const }
  const c = { ...keep([['c', '1']]), expiresAt: NOW - 1, dirty: 0 as const }
  const d = { ...planEtat(keep([['d', '1']]), 'rejetee', NOW), updatedAt: NOW - 8 * DAY } // encore à envoyer
  const e = { ...keep([['e', '1']]), dirty: 0 as const }
  assert.deepEqual(expiredLocal([a, b, c, d, e], NOW).sort(), [a.id, c.id].sort())
})

t('mêmes bornes que le serveur (supabase/067_propositions.sql)', () => {
  const sql = readFileSync(new URL('../supabase/067_propositions.sql', import.meta.url), 'utf8')
  assert.match(sql, new RegExp(`jsonb_array_length\\(lignes\\) between 1 and ${LIMITS.lignes}`))
  assert.match(sql, new RegExp(`octet_length\\(lignes::text\\) <= ${LIMITS.octets}`))
  assert.match(sql, new RegExp(`octet_length\\(contexte::text\\) <= ${LIMITS.contexte}`))
  assert.match(sql, new RegExp(`>= ${LIMITS.enAttente} then`))
  assert.match(sql, new RegExp(`interval '${LIMITS.joursExpiration} days'`))
  assert.match(sql, new RegExp(`interval '${LIMITS.joursGarde} days'`))
  assert.match(sql, /check \(source in \('collage', 'mcp', 'photo'\)\)/)
  assert.match(sql, /check \(etat in \('en_attente', 'validee', 'partielle', 'rejetee'\)\)/)
  assert.match(sql, /check \(length\(titre\) between 1 and 80\)/)
  // Rien d'activé par défaut : le déclencheur de la notification et la tâche de purge sont en commentaire.
  for (const line of sql.split('\n')) {
    if (/create trigger hb_propositions_signal|cron\.schedule/.test(line)) assert.match(line, /^--/, `pas actif : ${line}`)
  }
})

t('notification (fonction « veille ») : texte, message minimal, préférence, rien pour un collage', () => {
  assert.equal(propositionTexte(1, 'Tests rentrée Pôle U15'), '1 proposition à valider · Tests rentrée Pôle U15')
  assert.equal(propositionTexte(3, ''), '3 propositions à valider')
  assert.equal(propositionTexte(0, 'x'), '1 proposition à valider · x')
  assert.ok(titreCourt('y'.repeat(100)).length <= 40)
  const p = propositionPayload(2, 'Tests rentrée Pôle U15', { calme: true })
  assert.deepEqual(p, { body: '2 propositions à valider · Tests rentrée Pôle U15', url: PROPOSITION_URL, tag: 'propositions', calme: true })
  assert.equal(propositionIsMinimal(p), true)
  assert.equal(propositionIsMinimal(propositionPayload(1, 'z'.repeat(300))), true)
  assert.equal(propositionIsMinimal({ ...p, joueurs: ['Lucas Exemple'] }), false)
  assert.equal(propositionIsMinimal({ ...p, url: 'https://ailleurs.test' }), false)
  assert.equal(propositionIsMinimal({ ...p, body: 'Lucas Exemple : 1,86 s' }), false)
  assert.equal(propositionAAnnoncer({ source: 'mcp', etat: 'en_attente', deleted_at: null }, {}), true)
  assert.equal(propositionAAnnoncer({ source: 'photo', etat: 'en_attente' }, { proposition: true }), true)
  assert.equal(propositionAAnnoncer({ source: 'collage', etat: 'en_attente' }, {}), false)
  assert.equal(propositionAAnnoncer({ source: 'mcp', etat: 'validee' }, {}), false)
  assert.equal(propositionAAnnoncer({ source: 'mcp', etat: 'en_attente', deleted_at: '2026-11-05' }, {}), false)
  assert.equal(propositionAAnnoncer({ source: 'mcp', etat: 'en_attente' }, { proposition: false }), false)
  assert.equal(propositionAAnnoncer(null, {}), false)
  assert.equal(idProposition('3f2b8c1e-0000-4000-8000-000000000001'), true)
  assert.equal(idProposition("1; drop table x"), false)
})

t('branchements : pastille et boîte dans l\'appli, « Garder pour plus tard », ouverture par la notification, service worker', () => {
  const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
  const app = read('src/App.tsx')
  assert.match(app, /<PropositionsPill \/>/)
  assert.match(app, /<PropositionsHost \/>/)
  const imp = read('src/components/ImportMesures.tsx')
  assert.equal(imp.split('Garder pour plus tard').length - 1 >= 2, true) // collage et écran « À valider »
  assert.match(read('src/components/Propositions.tsx'), /has\('propositions'\)/)
  assert.match(read('src/components/ProfileMenu.tsx'), /openPropositions/)
  assert.match(read('public/push-sw.js'), /silent: !!d\.calme/)
  assert.match(read('supabase/functions/veille/index.ts'), /body\.type === 'proposition'/)
  assert.match(read('src/push.ts'), /id: 'proposition'/)
  // Aucune IA appelée par la boîte : pas d'appel réseau en dehors de notre table.
  const box = read('src/propositions.ts') + read('src/components/Propositions.tsx') + read('src/propositionsCore.ts')
  assert.doesNotMatch(box, /fetch\(|transcrire|mistral|anthropic|openai/i)
})

console.log(`\n${n} essais réussis`)
