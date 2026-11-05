// Test de la boîte « À valider » (src/propositionsCore.ts, règles pures) : garder un tableau pour plus tard (lignes, titre,
// contexte, limites : 300 lignes, 200 Ko, 30 en attente), pastille de l'en-tête (comptage, texte), passage collage →
// proposition → validation en partie → « Défaire », état après validation, lignes déposées par le serveur MCP (objets),
// aller-retour avec le serveur (envoi, relecture, version locale plus récente, oubli des effacées), ménage de l'appareil,
// mêmes bornes que supabase/067_propositions.sql, notification de la fonction « veille » (texte, message minimal, préférence)
// et branchements dans l'appli ; propositions D'ADMINISTRATION (sorte « admin », src/propositionsAdmin.ts) : lecture des
// actions, libellés avec les noms remis sur l'appareil, application partielle par les chemins de l'appli (faux chemins qui
// notent les appels : hb_update_member, save, remove, mergePlayers), « Défaire », rejet. Données FICTIVES seulement.
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
import { actionsDe, appliquerActions, defaireActions, etatApresAdmin, libelleAction, nonDefaisables, resumeAdmin, sorteProposition, type DepsAdmin } from '../src/propositionsAdmin'
import { lireAction, saisonDe } from '../src/propositionsAdminCore'

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


// ---------- Propositions d'administration (sorte « admin ») ----------

const ta: Promise<void>[] = []
const tAsync = (name: string, f: () => Promise<void>) => {
  ta.push(
    (async () => {
      await f()
      n++
      console.log(`ok ${n} - ${name}`)
    })(),
  )
}

const U_BRUNO = '00000000-0000-4000-8000-0000000000c1'
const U_NOUVEAU = '00000000-0000-4000-8000-0000000000b5'
const U_CAMILLE = '00000000-0000-4000-8000-0000000000b2'
const ADMIN_LIGNES = [
  { a: 'role', userId: U_BRUNO, compte: 'C-AAAAAAA', nom: 'Bruno Encadrant-Fictif', role: 'observateur', avant: 'preparateur' },
  { a: 'role', userId: U_NOUVEAU, compte: 'C-BBBBBBB', nom: '', role: 'preparateur', avant: null },
  { a: 'unite', userId: U_CAMILLE, compte: 'C-CCCCCCC', nom: 'Camille Fictive', uniteId: 'u-var', unite: 'Comité Fictif du Var', roleUnite: 'observateur' },
  { a: 'secteur', userId: U_CAMILLE, compte: 'C-CCCCCCC', nom: 'Camille Fictive', depts: ['83', '2A'] },
  { a: 'archiver', quoi: 'evenement', id: 'ev-s1', nom: 'Tournoi d’automne Fictif', date: '2025-10-18' },
  { a: 'archiver', quoi: 'evenement', id: 'ev-absent', nom: 'Événement disparu', date: '2025-11-02' },
  { a: 'archiver', quoi: 'groupe', id: 'g-pole', nom: 'Pôle Fictif' },
  { a: 'fusion', garder: 'p-noah', fondre: 'p-noah-bis' },
  { a: 'supprimer_tout', id: 'x' },
]

/** Faux chemins de l'appli : notent chaque appel ; hb_update_member refuse le compte « nouveau » (comme la base le ferait). */
function fauxChemins(o: { serveur?: boolean } = {}) {
  const appels: string[] = []
  const lignes = new Map<string, Record<string, unknown> & { id: string }>([
    ['events:ev-s1', { id: 'ev-s1', name: 'Tournoi d’automne Fictif', archived: false }],
    ['groups:g-pole', { id: 'g-pole', name: 'Pôle Fictif', poleUnitId: 'u-pole' }],
  ])
  const membres = [
    { user_id: U_BRUNO, role: 'preparateur', departments: [] },
    { user_id: U_NOUVEAU, role: null, departments: [] },
    { user_id: U_CAMILLE, role: 'observateur', departments: ['13'] },
  ]
  const d: DepsAdmin = {
    rpc:
      o.serveur === false
        ? null
        : async (fn, args) => {
            appels.push(`rpc ${fn} ${JSON.stringify(args ?? {})}`)
            if (fn === 'hb_members') return { data: membres, error: null }
            if (fn === 'hb_update_member' && args?.p_user === U_NOUVEAU) return { data: null, error: { message: 'Réservé aux administrateurs' } }
            return { data: null, error: null }
          },
    enLigne: () => true,
    evenement: async (id) => lignes.get(`events:${id}`) as never,
    groupe: async (id) => lignes.get(`groups:${id}`) as never,
    save: async (table, row) => {
      appels.push(`save ${table} ${row.id} ${'archived' in row ? `archived=${row.archived}` : `unit=${row.unitId} role=${row.role}`}`)
      lignes.set(`${table}:${row.id}`, row)
    },
    remove: async (table, id) => {
      appels.push(`remove ${table} ${id}`)
    },
    affectations: async () => [],
    fiche: async (id) => ({ id }),
    fondre: async (source, cible) => {
      appels.push(`merge ${source} → ${cible}`)
      return null
    },
    newId: () => 'aff-1',
  }
  return { d, appels, lignes }
}

t('propositions d’administration : sorte « admin » lue du serveur, comptée dans la pastille, actions lisibles, libellés neutres', () => {
  const s: ServerProposition = { id: 'adm-1', source: 'mcp', kind: 'admin', titre: 'Fin de saison', contexte: { sorte: 'archiver', version: 1 }, lignes: ADMIN_LIGNES, etat: 'en_attente', created_at: '2026-11-05T10:00:00Z', updated_at: '2026-11-05T10:00:00Z', expires_at: '2026-12-05T10:00:00Z', deleted_at: null }
  const row = fromServer(s, undefined, ME)!
  assert.equal(row.kind, 'admin')
  assert.equal(badgeCount([row], ME, NOW), 1)
  const acts = actionsDe(row.lignes)
  assert.equal(acts.filter((a) => a.action).length, 8, 'la ligne inconnue n’est pas applicable')
  assert.equal(acts[8].action, null)
  assert.equal(sorteProposition(row.contexte), 'archiver')
  const noms = { compte: (id: string, n: string) => (id === U_NOUVEAU ? 'Nouveau Compte-Fictif' : n), fiche: (id: string) => (id === 'p-noah' ? 'Noah Fictivus' : id === 'p-noah-bis' ? 'Noah Fictivus (bis)' : undefined), code: (id: string) => `J-${id.length}` }
  const L = acts.map((a) => (a.action ? libelleAction(a.action, noms) : null))
  assert.equal(L[0]!.titre, 'Donner le rôle Observateur à Bruno Encadrant-Fictif')
  assert.match(L[0]!.detail!, /rôle actuel : Encadrant/)
  assert.equal(L[1]!.titre, 'Donner le rôle Encadrant à Nouveau Compte-Fictif', 'nom à jour remis par l’appareil')
  assert.equal(L[2]!.titre, 'Affecter Camille Fictive à « Comité Fictif du Var »')
  assert.equal(L[3]!.titre, 'Secteur de Camille Fictive : 83, 2A')
  assert.equal(L[4]!.titre, 'Archiver l’événement « Tournoi d’automne Fictif »')
  assert.match(L[4]!.detail!, /18\/10\/2025 · saison 2025-26/)
  assert.equal(L[7]!.titre, 'Fondre « Noah Fictivus (bis) » dans « Noah Fictivus »')
  assert.equal(libelleAction(acts[7].action!, noms, true).titre, 'Fondre « Noah Fictivus » dans « Noah Fictivus (bis) »', 'inverser')
  assert.match(libelleAction(acts[7].action!, { ...noms, fiche: () => undefined }).titre, /absente de cet appareil/)
  assert.equal(resumeAdmin('archiver', actionsDe(ADMIN_LIGNES.slice(4, 6))), 'Archiver 2 événements de la saison 2025-26')
  assert.equal(resumeAdmin('archiver', actionsDe(ADMIN_LIGNES.slice(4, 7))), 'Archiver 2 événements de la saison 2025-26 et 1 groupe')
  assert.equal(saisonDe('2026-08-31'), '2025-26')
  assert.equal(saisonDe('2026-09-01'), '2026-27')
  // Libellés neutres : aucun mot négatif sur un joueur.
  const tout = L.filter(Boolean).map((x) => `${x!.titre} ${x!.detail ?? ''}`).join(' ')
  assert.doesNotMatch(tout, /pas retenu|refus|écarté|mauvais|faible/i)
  // Jamais « administrateur » à donner ; formes inconnues ignorées.
  assert.equal(lireAction({ a: 'role', userId: 'u', compte: 'C-AAAAAAA', nom: 'x', role: 'admin' }), null)
  assert.equal(lireAction({ a: 'secteur', userId: 'u', compte: 'C-AAAAAAA', nom: 'x', depts: ['99'] }), null)
  assert.equal(lireAction(['role']), null)
})

tAsync('propositions d’administration : application PARTIELLE par les chemins de l’appli (hb_update_member, save, mergePlayers), état, « Défaire »', async () => {
  const { d, appels, lignes } = fauxChemins()
  const acts = actionsDe(ADMIN_LIGNES)
  // L'administrateur décoche la fusion (i = 7) ; la ligne inconnue (8) n'est pas cochable.
  const cochees = new Set([0, 1, 2, 3, 4, 5, 6])
  const { resultats, retours } = await appliquerActions(acts, cochees, new Set(), d)
  const par = Object.fromEntries(resultats.map((r) => [r.i, `${r.ok ? 'ok' : 'non'} ${r.message}`]))
  assert.deepEqual(par, {
    0: 'ok fait',
    1: 'non Réservé aux administrateurs',
    2: 'ok fait',
    3: 'ok fait',
    4: 'ok fait',
    5: 'non événement introuvable sur cet appareil (supprimé, ou pas encore reçu)',
    6: 'non groupe Pôle : passe d’une saison à l’autre par « Changement de saison »',
  })
  assert.deepEqual(appels, [
    'rpc hb_members {}',
    `rpc hb_update_member {"p_user":"${U_BRUNO}","p_role":"observateur"}`,
    `rpc hb_update_member {"p_user":"${U_NOUVEAU}","p_role":"preparateur"}`,
    `save assignments aff-1 unit=u-var role=observateur`,
    `rpc hb_update_member {"p_user":"${U_CAMILLE}","p_departments":["83","2A"]}`,
    'save events ev-s1 archived=true',
  ])
  assert.ok(!appels.some((a) => a.startsWith('merge')), 'fusion décochée : non faite')
  assert.equal(lignes.get('events:ev-s1')!.archived, true)
  // 4 sur 8 actions lisibles : validée en partie.
  assert.equal(etatApresAdmin(acts, resultats), 'partielle')
  assert.equal(etatApresAdmin(acts, []), 'en_attente')
  assert.equal(etatApresAdmin(actionsDe(ADMIN_LIGNES.slice(0, 1)), [{ i: 0, ok: true, message: 'fait' }]), 'validee')
  // Défaire : rôle remis (Encadrant), affectation retirée, secteur remis (13), événement désarchivé ; du dernier au premier.
  assert.deepEqual(retours.map((r) => r.k), ['role', 'unite', 'secteur', 'archiver'])
  appels.length = 0
  const def = await defaireActions(retours, d)
  assert.ok(def.every((r) => r.ok))
  assert.deepEqual(appels, [
    'save events ev-s1 archived=false',
    `rpc hb_update_member {"p_user":"${U_CAMILLE}","p_departments":["13"]}`,
    'remove assignments aff-1',
    `rpc hb_update_member {"p_user":"${U_BRUNO}","p_role":"preparateur"}`,
  ])
  assert.equal(lignes.get('events:ev-s1')!.archived, false)
})

tAsync('propositions d’administration : fusion (inversée par l’administrateur) par mergePlayers, ne se défait pas ; sans serveur : rôles, secteurs et fusions refusés', async () => {
  const { d, appels } = fauxChemins()
  const acts = actionsDe(ADMIN_LIGNES)
  const { resultats, retours } = await appliquerActions(acts, new Set([7]), new Set([7]), d)
  assert.deepEqual(appels, ['merge p-noah → p-noah-bis'], 'inversée : p-noah fondue dans p-noah-bis')
  assert.equal(retours.length, 0)
  assert.deepEqual(nonDefaisables(resultats, retours), [7])
  // Rôle donné à un compte qui n'en avait pas : ne se défait pas d'ici.
  const r2 = await appliquerActions(actionsDe([{ ...ADMIN_LIGNES[1], userId: U_CAMILLE, role: 'preparateur' }]), new Set([0]), new Set(), {
    ...d,
    rpc: async (fn) => (fn === 'hb_members' ? { data: [{ user_id: U_CAMILLE, role: null, departments: [] }], error: null } : { data: null, error: null }),
  })
  assert.deepEqual(nonDefaisables(r2.resultats, r2.retours), [0])
  // Déjà fait : compte qui a déjà le rôle, affectation déjà là, événement déjà archivé.
  const deja = await appliquerActions(actionsDe([{ ...ADMIN_LIGNES[0], role: 'preparateur' }, ADMIN_LIGNES[2]]), new Set([0, 1]), new Set(), { ...d, affectations: async () => [{ id: 'x', unitId: 'u-var' }] })
  assert.deepEqual(deja.resultats.map((r) => r.message), ['déjà fait', 'déjà fait'])
  // Version sans serveur : rôles, secteurs et fusions demandent le serveur ; archivage et affectation passent.
  const sans = fauxChemins({ serveur: false })
  const r3 = await appliquerActions(acts, new Set([0, 2, 3, 4, 7]), new Set(), sans.d)
  assert.deepEqual(r3.resultats.map((r) => r.ok), [false, true, false, true, false])
  assert.match(r3.resultats[0].message, /en ligne, avec le serveur/)
})

t('propositions d’administration : « Rejeter » (rien n’est fait, état rejetée), « Défaire » remet en attente', () => {
  const row: PropositionRow = { ...keep([['a', '1']], []), kind: 'admin', source: 'mcp', contexte: { sorte: 'role' }, lignes: ADMIN_LIGNES.slice(0, 2) as never }
  const rej = planEtat(row, 'rejetee', NOW + 1)
  assert.equal(rej.etat, 'rejetee')
  assert.equal(badgeCount([rej], ME, NOW + 2), 0)
  const val = planEtat(row, 'partielle', NOW + 1)
  assert.equal(planEtat(val, 'en_attente', NOW + 2).etat, 'en_attente')
  assert.deepEqual(toServer(rej).kind, 'admin')
})

t('propositions d’administration : branchements (boîte, écran, chemins de l’appli, fond flouté, consentement)', () => {
  const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
  const box = read('src/components/Propositions.tsx')
  assert.match(box, /current\?\.kind === 'admin'/)
  assert.match(box, /<AdminReview /)
  const ecran = read('src/components/PropositionsAdmin.tsx')
  assert.match(ecran, /Appliquer \$\{plural\(n, 'action'\)\}/)
  assert.match(ecran, /Rejeter/)
  assert.match(ecran, /Défaire/)
  assert.match(ecran, /useNomsParCode\(\)/, 'noms des joueurs remis sur l’appareil comme /rapport')
  assert.match(ecran, /mergePlayers\(source, cible\)/)
  assert.match(ecran, /supabase!\.rpc\(fn, args\)/)
  assert.match(ecran, /save\(table, row as never\)/)
  assert.match(ecran, /FormActions/)
  assert.match(read('src/components/Confirm.tsx'), /scrim/, 'questions sur fond flouté')
  assert.match(read('src/components/FilterWindow.tsx'), /scrim/, 'fenêtre de la boîte sur fond flouté')
  assert.doesNotMatch(ecran + read('src/propositionsAdmin.ts'), /fetch\(|anthropic|openai|mistral/i)
  assert.match(read('src/propositionsAdmin.ts'), /'hb_update_member'/)
  assert.match(read('src/pages/OAuthConsent.tsx'), /\(administrateur\) voir l’état de l’installation, l’activité du staff, les questions non comprises et qui s’est connecté/)
})

await Promise.all(ta)
console.log(`\n${n} essais réussis`)
