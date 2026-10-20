// Test du MODE AVANCÉ de « Poser une question » (requête SQL exécutée dans le navigateur sur une copie locale jetable) :
// construction des tables plates depuis un jeu fictif (src/sqlMirror.ts : exclusions, aucun texte libre, notes sur 5,
// dernière taille, noms du staff uniques), base SQLite (sql.js) en lecture seule, contrôle des requêtes (src/sqlGuard.ts :
// instructions dangereuses, plusieurs instructions, LIMIT ajouté ou ramené), exemples des consignes de la fonction
// (chacun exécuté sur le jeu fictif avec le résultat attendu), performance sur 40 000 joueurs fictifs, et AUCUNE DONNÉE
// dans ce qui part vers la fonction (faux fetch : aucun appel réseau, rien ne part chez Mistral). Noms fictifs seulement.
//
//   npx jiti tools/test-sql.ts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import initSqlJs, { type Database } from 'sql.js'
import { buildMirrorTables, buildSqlSchema, loadMirror, mirrorSignature, type MCriterion, type MEval, type MirrorInput, type MPlayer, type MSight } from '../src/sqlMirror'
import { cleanSqlSpec, columnLabel, decodeSqlSpec, encodeSqlSpec, guardSql, safeExplanation, NEUTRAL_EXPLANATION } from '../src/sqlGuard'
import { parseSaved } from '../src/recipe'
import { understandSql, requestAccess, type Endpoint } from '../src/dictation/transcribe'

const TODAY = '2026-10-14'
const SQL = await initSqlJs()
const POSITIONS = [
  { id: 'GB', label: 'Gardien' },
  { id: 'AG', label: 'Ailier gauche' },
  { id: 'ARG', label: 'Arrière gauche' },
  { id: 'DC', label: 'Demi-centre' },
  { id: 'ARD', label: 'Arrière droit' },
  { id: 'AD', label: 'Ailier droit' },
  { id: 'PIV', label: 'Pivot' },
]
const CRITERIA: MCriterion[] = [
  { id: 'taille', label: 'Taille', category: 'Gabarit', kind: 'factual', scale: 'number', unit: 'cm' },
  { id: 'cmj_hauteur', label: 'CMJ – hauteur', category: 'Sauts (plateforme)', kind: 'factual', scale: 'number', unit: 'cm' },
  { id: 'agressivite', label: 'Agressivité défensive', category: 'Défense', kind: 'subjective', scale: 'score5' },
  { id: 'placement', label: 'Placement / replacement', category: 'Défense', kind: 'subjective', scale: 'score5' },
  { id: 'tir', label: 'Efficacité au tir', category: 'Attaque', kind: 'subjective', scale: 'score5' },
  { id: 'duel', label: 'Duel / 1 contre 1', category: 'Attaque', kind: 'subjective', scale: 'score3' },
  { id: 'vision', label: 'Vision du jeu', category: 'Intelligence de jeu', kind: 'subjective', scale: 'score5' },
  { id: 'commentaire', label: 'Commentaire', category: 'Divers', kind: 'subjective', scale: 'text' },
  { id: 'vieux', label: 'Ancien critère', category: 'Attaque', kind: 'subjective', scale: 'score5', deleted: true },
]
const REGIONS: Record<string, string> = { '83': 'region-sud', '13': 'region-sud', '75': 'region-idf' }
const REGION_NAMES: Record<string, string> = { 'region-sud': 'Région Sud', 'region-idf': 'Île-de-France' }
const DEPT_NAMES: Record<string, string> = { '83': 'Var', '13': 'Bouches-du-Rhône', '75': 'Paris' }
const STAFF: Record<string, string> = { u1: 'Coach Un', u2: 'Coach Deux', u3: 'Coach Trois', u4: 'Coach Quatre', u5: 'Coach Quatre' }

type P = MPlayer & { department?: string }
const pl = (id: string, firstName: string, lastName: string, birthDate: string, sex: 'M' | 'F', position: string, club: string, department: string, extra: Partial<P> = {}): P => ({
  id,
  firstName,
  lastName,
  birthDate,
  sex,
  position,
  club,
  department,
  updatedAt: 1,
  ...extra,
})
const players: P[] = [
  pl('p1', 'Lucas', 'Durand', '2010-03-02', 'M', 'PIV', 'HBC Exemple', '83', { laterality: 'gaucher' }),
  pl('p2', 'Lúcas', 'Petit', '2010-07-15', 'M', 'ARG', 'AS Fictive', '83', { laterality: 'droitier' }),
  pl('p3', 'Emma', 'Moreau', '2011-01-20', 'F', 'PIV', 'HBC Exemple', '83', { laterality: 'gaucher', secondaryPositions: ['AD'] }),
  pl('p4', 'Léa', 'Bernard', '2011-11-01', 'F', 'DC', 'Handball Imaginaire', '13', { laterality: 'droitier', secondaryPositions: ['PIV'] }),
  pl('p5', 'Hugo', 'Lambert', '2010-05-05', 'M', 'PIV', 'Handball Imaginaire', '13', { laterality: 'gaucher', poles: [{ from: '2025-09-01', site: 'Fictiville' }] }),
  pl('p6', 'Nina', 'Roux', '2011-02-02', 'F', 'GB', 'AS Fictive', '83'),
  pl('p7', 'Tom', 'Faure', '2009-09-09', 'M', 'GB', 'Entente du Nord Fictif', '75', { poles: [{ from: '2023-09-01', to: '2025-06-30', site: 'Fictiville' }] }),
  pl('p8', 'Jules', 'Blanc', '2010-06-06', 'M', 'GB', 'HBC Exemple', '83'),
  pl('px', 'Effacé', 'Supprimé', '2010-01-01', 'M', 'GB', 'HBC Exemple', '83', { deleted: true }),
  pl('py', 'Fondu', 'Ailleurs', '2010-01-01', 'M', 'GB', 'HBC Exemple', '83', { mergedInto: 'p1' }),
  pl('pz', 'Hors', 'Cadre', '2010-01-01', 'M', 'GB', 'HBC Exemple', '83', { review: 'refused' }),
]
const S = (playerId: string, day: string, event: string, person: string): MSight => ({ playerId, day, event, person })
const sights: MSight[] = [
  S('p1', '2026-09-20', 'ev1', 'u1'),
  S('p1', '2026-09-20', 'ev1', 'u2'),
  S('p1', '2026-10-04', 'ev2', 'u3'),
  S('p3', '2026-09-20', 'ev1', 'u1'),
  S('p3', '2026-10-04', 'ev2', 'u2'),
  S('p3', '2026-10-04', 'ev2', 'u3'),
  S('p5', '2026-09-20', 'ev1', 'u1'),
  S('p5', '2026-09-20', 'ev1', 'u2'),
  S('p5', '2026-10-04', 'ev2', 'u3'),
  S('p4', '2026-10-04', 'ev2', 'u1'),
  S('p4', '2025-11-02', 'ev0', 'u2'),
  S('p2', '2025-12-01', 'ev0', 'u1'),
  S('p7', '2026-09-30', 'jour:2026-09-30', 'u4'),
  S('p8', '2026-09-12', 'ev3', 'u5'),
  S('px', '2026-09-12', 'ev3', 'u5'), // joueur supprimé : pas copié
]
const E = (id: string, playerId: string, eventId: string | undefined, observerId: string, date: string, scores: Record<string, number | string>, extra: Partial<MEval> = {}): MEval => ({
  id,
  playerId,
  eventId,
  observerId,
  observer: STAFF[observerId],
  date,
  scores,
  updatedAt: 1,
  ...extra,
})
const SECRET = 'Texte libre du coach à ne jamais copier'
const evals: (MEval & { strengths?: string; improvements?: string })[] = [
  E('a1', 'p1', 'ev1', 'u1', '2026-09-20', { agressivite: 3, placement: 2, tir: 4, commentaire: SECRET }, { strengths: SECRET } as Partial<MEval>),
  E('a2', 'p5', 'ev1', 'u1', '2026-09-20', { agressivite: 4 }),
  E('a3', 'p3', 'ev2', 'u2', '2026-10-04', { tir: 4, duel: 3 }),
  E('a4', 'p4', 'ev2', 'u1', '2026-10-04', { tir: 3, vieux: 5, vision: 9 }), // critère supprimé et note hors échelle : ignorés
  E('a5', 'p4', undefined, 'u2', '2026-10-05T18:30:00Z', { tir: 5 }, { review: 'pending', contextType: 'club' }),
  E('a6', 'p2', 'ev0', 'u1', '2026-06-10', { tir: 2 }),
  E('a7', 'p7', undefined, 'u4', '2026-09-30', { tir: 1 }, { review: 'refused' }),
  E('a8', 'p8', 'ev3', 'u5', '2026-09-12', { tir: 4 }, { deleted: true }),
]
const measures = [
  { playerId: 'p1', criterionId: 'taille', value: 190, date: '2026-09-01' },
  { playerId: 'p5', criterionId: 'taille', value: 180, date: '2026-01-01' },
  { playerId: 'p5', criterionId: 'taille', value: 186, date: '2026-09-01' },
  { playerId: 'p2', criterionId: 'taille', value: '178', date: '2026-09-01' },
  { playerId: 'p8', criterionId: 'taille', value: 192, date: '2026-09-01' },
  { playerId: 'p6', criterionId: 'taille', value: 170, date: '2026-09-01' },
  { playerId: 'p7', criterionId: 'taille', value: 181, date: '2026-09-01' },
  { playerId: 'p1', criterionId: 'cmj_hauteur', value: 40, date: '2026-09-01', note: SECRET } as { playerId: string; criterionId: string; value: number; date: string },
  { playerId: 'p5', criterionId: 'cmj_hauteur', value: 38, date: '2026-09-01' },
  { playerId: 'p3', criterionId: 'cmj_hauteur', value: 45, date: '2026-09-02', deleted: true },
]
const input: MirrorInput = {
  players,
  sights,
  evals,
  measures,
  criteria: CRITERIA,
  groups: [
    { id: 'g-ic', name: 'Intercomités', playerIds: ['p1', 'p3', 'p5', 'p7', 'px'] },
    { id: 'g-old', name: 'Ancien groupe', playerIds: ['p1'], deleted: true },
  ],
  events: [
    { id: 'ev1', name: 'Stage fictif', type: 'entrainement', date: '2026-09-20', place: 'Fictiville', playerIds: ['p6'] },
    { id: 'ev2', name: 'Tournoi imaginaire', type: 'tournoi', date: '2026-10-04' },
    { id: 'ev3', name: 'Match fictif', type: 'match', date: '2026-09-12' },
    { id: 'ev0', name: 'Ancien tournoi', type: 'tournoi', date: '2025-11-02' },
    { id: 'evx', name: 'Supprimé', type: 'match', date: '2026-01-01', deleted: true },
  ],
  deptOf: (p) => (p as P).department,
  regionOf: (d) => REGIONS[d],
  regionName: (id) => REGION_NAMES[id] ?? id,
  deptName: (c) => DEPT_NAMES[c] ?? c,
  zoneOf: (c) => (/defens/i.test(c) ? 'gauche' : /attaq/i.test(c) ? 'droite' : null),
  staffName: (id) => STAFF[id] ?? 'Personne du staff',
  today: TODAY,
}

// ---------- Tables plates ----------
let t0 = performance.now()
const tables = buildMirrorTables(input)
const T = Object.fromEntries(tables.map((t) => [t.name, t]))
assert.deepEqual(Object.keys(T), ['joueurs', 'vus', 'avis', 'notes', 'criteres', 'mesures', 'evenements', 'evenement_joueurs', 'groupes', 'groupe_joueurs', 'staff'])
for (const t of tables) for (const r of t.rows) assert.equal(r.length, t.columns.length, `${t.name} : une valeur par colonne`)
assert.equal(T.joueurs.rows.length, 8, 'supprimés, fondus et hors cadre jamais copiés')
assert.ok(!JSON.stringify(tables).includes(SECRET), 'aucun texte libre des coachs copié (points forts, commentaires, notes de mesure)')
assert.ok(!T.vus.rows.some((r) => r[0] === 'px'))
assert.deepEqual(
  T.avis.rows.map((r) => [r[0], r[5]]),
  [['a1', 1], ['a2', 1], ['a3', 1], ['a4', 1], ['a5', 0], ['a6', 1]],
  'avis supprimés et hors cadre écartés ; en attente : valide = 0',
)
assert.equal(T.avis.rows.find((r) => r[0] === 'a5')![4], '2026-10-05', 'date du jour (horodatage ramené au jour)')
const note = (avis: string, crit: string) => T.notes.rows.find((r) => r[0] === avis && r[2] === crit)
assert.equal(note('a3', 'duel')![4], 5, 'duel 3/3 → 5 sur 5')
assert.equal(note('a4', 'vieux'), undefined, 'critère supprimé : pas de note')
assert.equal(note('a4', 'vision'), undefined, 'note hors échelle : ignorée')
assert.equal(note('a1', 'commentaire'), undefined, 'texte : jamais copié')
const j = (id: string) => Object.fromEntries(T.joueurs.columns.map((c, i) => [c, T.joueurs.rows.find((r) => r[0] === id)![i]]))
assert.deepEqual(j('p5'), {
  id: 'p5',
  nom: 'Lambert',
  prenom: 'Hugo',
  naissance: '2010-05-05',
  annee: 2010,
  sexe: 'M',
  poste: 'PIV',
  postes_secondaires: null,
  lateralite: 'gaucher',
  club: 'Handball Imaginaire',
  departement: '13',
  departement_nom: 'Bouches-du-Rhône',
  region: 'Région Sud',
  taille_cm: 186,
  pole: 'en_cours',
})
assert.equal(j('p7').pole, 'passe')
assert.equal(j('p2').taille_cm, 178, 'taille écrite en texte : lue')
assert.equal(j('p4').postes_secondaires, 'PIV')
assert.deepEqual(T.staff.rows.map((r) => r[0]).sort(), ['Coach Deux', 'Coach Quatre', 'Coach Quatre (2)', 'Coach Trois', 'Coach Un'], 'deux personnes du même nom : distinguées')
assert.deepEqual(T.groupes.rows, [['g-ic', 'Intercomités']], 'groupe supprimé écarté')
assert.deepEqual(T.groupe_joueurs.rows.map((r) => r[1]), ['p1', 'p3', 'p5', 'p7'])
const ev1 = T.evenements.rows.find((r) => r[0] === 'ev1')!
assert.equal(ev1[5], '83', 'département le plus fréquent des joueurs de l’événement')
assert.ok(!T.evenements.rows.some((r) => r[0] === 'evx'))
assert.ok(T.evenement_joueurs.rows.some((r) => r[0] === 'ev1' && r[1] === 'p6'), 'liste de l’événement')
assert.ok(T.mesures.rows.every((r) => typeof r[2] === 'number'), 'mesures chiffrées seulement')
assert.ok(!T.mesures.rows.some((r) => r[0] === 'p3'), 'mesure supprimée écartée')
assert.notEqual(mirrorSignature(input), mirrorSignature({ ...input, players: players.slice(1) }), 'signature : change avec les données')

// ---------- Base SQLite en lecture seule ----------
function open(ts = tables): Database {
  const db = new SQL.Database()
  loadMirror(db, ts)
  return db
}
const db = open()
console.log(`Jeu fictif : copie construite et chargée en ${Math.round(performance.now() - t0)} ms`)
const q = (sql: string) => {
  const g = guardSql(sql)
  assert.ok(g.ok, `${sql} : ${!g.ok && g.error}`)
  const r = db.exec(g.sql)
  return r.length ? r[r.length - 1] : { columns: [], values: [] }
}
assert.deepEqual(q('SELECT count(*) FROM joueurs').values, [[8]])
assert.deepEqual(q("SELECT sans_accents('Lúcas Lefèvre-Dubois')").values, [['lucas lefevre dubois']])
// Lecture seule : même sans le contrôle, rien ne s'écrit dans la copie.
for (const w of ["INSERT INTO joueurs (id) VALUES ('pirate')", "UPDATE joueurs SET nom = 'X'", 'DELETE FROM joueurs', 'CREATE TABLE t (x)', 'DROP TABLE joueurs'])
  assert.throws(() => db.exec(w), /readonly|query_only|attempt to write/i, w)
assert.deepEqual(db.exec('SELECT count(*) FROM joueurs')[0].values, [[8]])

// ---------- Contrôle des requêtes ----------
const refuse = (sql: unknown, why: RegExp) => {
  const g = guardSql(sql)
  assert.ok(!g.ok, `refusée : ${String(sql)}`)
  assert.match(g.error, why, String(sql))
}
refuse('', /vide/)
refuse(42, /absente/)
refuse('DELETE FROM joueurs', /SELECT ou WITH/)
refuse("SELECT 1; DELETE FROM joueurs", /une seule instruction/)
refuse('SELECT 1; SELECT 2', /une seule instruction/)
refuse("ATTACH DATABASE 'x' AS y", /SELECT ou WITH/)
refuse("SELECT * FROM joueurs WHERE 1 = 1 UNION SELECT * FROM pragma_table_info('joueurs')", /PRAGMA/)
refuse("WITH x AS (SELECT 1) INSERT INTO joueurs (id) SELECT 1", /INSERT/)
refuse("SELECT replace(nom, 'a', 'b') FROM joueurs", /REPLACE/)
refuse("SELECT load_extension('x')", /LOAD_EXTENSION/)
refuse("SELECT readfile('/etc/passwd')", /READFILE/)
refuse('SELECT * FROM sqlite_master', /SQLITE_MASTER/)
refuse('select 1 /* commentaire non fermé', /non fermé/)
refuse("SELECT 'texte non fermé", /non fermé/)
refuse('SELECT * FROM joueurs WHERE id = ?', /paramètre/)
refuse('SELECT * FROM joueurs WHERE id = :id', /paramètre/)
refuse('SELECT 1\u0000', /contrôle/)
refuse(`SELECT ${'1,'.repeat(2500)}1`, /trop longue/)
refuse('VACUUM', /SELECT ou WITH/)
refuse('-- rien\nDROP TABLE joueurs', /SELECT ou WITH/)
// Acceptées : mots interdits dans un texte ou un commentaire, point-virgule final, WITH.
const ok = (sql: string) => {
  const g = guardSql(sql)
  assert.ok(g.ok, `${sql} : ${!g.ok && g.error}`)
  return g.sql
}
assert.equal(ok("SELECT nom FROM joueurs WHERE club = 'Delete; Drop' ;"), "SELECT nom FROM joueurs WHERE club = 'Delete; Drop'\nLIMIT 500", 'texte ; LIMIT ajouté')
assert.equal(ok('SELECT nom FROM joueurs -- update ici\nORDER BY nom'), 'SELECT nom FROM joueurs -- update ici\nORDER BY nom\nLIMIT 500')
assert.equal(ok('SELECT nom FROM joueurs LIMIT 20'), 'SELECT nom FROM joueurs LIMIT 20', 'LIMIT ≤ 500 gardé')
assert.equal(ok('SELECT nom FROM joueurs LIMIT 10000'), 'SELECT nom FROM joueurs LIMIT 500', 'LIMIT ramené à 500')
assert.equal(ok('SELECT nom FROM joueurs LIMIT 900 OFFSET 10'), 'SELECT nom FROM joueurs LIMIT 500 OFFSET 10')
assert.equal(ok('SELECT nom FROM joueurs LIMIT 10, 900'), 'SELECT nom FROM joueurs LIMIT 500 OFFSET 10')
assert.equal(ok('SELECT nom FROM joueurs LIMIT (SELECT 9000)'), 'SELECT * FROM (\nSELECT nom FROM joueurs LIMIT (SELECT 9000)\n) LIMIT 500', 'LIMIT calculé : enveloppé')
assert.equal(ok('SELECT nom FROM (SELECT nom FROM joueurs LIMIT 3)'), 'SELECT nom FROM (SELECT nom FROM joueurs LIMIT 3)\nLIMIT 500', 'LIMIT d’une sous-requête : pas celui du résultat')
assert.ok(ok('WITH x AS (SELECT id FROM joueurs) SELECT count(*) FROM x').endsWith('LIMIT 500'))
assert.equal(ok('SELECT "nb update" FROM (SELECT 1 AS "nb update")'), 'SELECT "nb update" FROM (SELECT 1 AS "nb update")\nLIMIT 500', 'identifiant entre guillemets')
for (const s of ['SELECT nom FROM joueurs', 'SELECT nom FROM joueurs LIMIT 10000', 'SELECT nom FROM joueurs LIMIT (SELECT 9000)']) assert.equal(ok(ok(s)), ok(s), 'contrôle stable')
assert.equal(q('SELECT joueurs.id FROM joueurs, joueurs AS b, joueurs AS c').values.length, 500, '500 lignes au plus')
assert.equal(q('SELECT nom FROM joueurs LIMIT (SELECT 9000)').values.length, 8)

// Libellés de colonnes, explications.
assert.equal(columnLabel('nb_joueurs'), 'Nombre de joueurs')
assert.equal(columnLabel('taille_moyenne_cm'), 'Taille moyenne cm')
assert.equal(columnLabel('nb_gauchers'), 'Nombre gauchers')
assert.equal(safeExplanation('Les joueurs les plus faibles en défense.'), NEUTRAL_EXPLANATION, 'jamais de mot négatif sur les jeunes')
assert.equal(safeExplanation('Joueurs pas retenus'), NEUTRAL_EXPLANATION)
assert.equal(safeExplanation('  Nombre de   joueurs. '), 'Nombre de joueurs.')
const spec = cleanSqlSpec({ sql: 'SELECT count(*) AS nb FROM joueurs;', explanation: 'Nombre de joueurs.', display: 'nombre' })!
assert.deepEqual(spec, { sql: 'SELECT count(*) AS nb FROM joueurs\nLIMIT 500', explanation: 'Nombre de joueurs.', display: 'nombre' })
assert.deepEqual(decodeSqlSpec(encodeSqlSpec(spec)), spec, 'requête dans l’adresse')
assert.equal(decodeSqlSpec(JSON.stringify({ sql: 'DROP TABLE joueurs', explanation: 'x' })), null, 'adresse piégée : refusée')
assert.equal(decodeSqlSpec('{pas du json'), null)
assert.equal(cleanSqlSpec({ sql: 'SELECT 1', display: 'pirate' })!.display, 'tableau')
// « Mes questions » : requête enregistrée, recontrôlée à la lecture ; piégée : écartée.
const saved = parseSaved([
  { id: 'q1', name: 'Mes Lucas', recipe: {}, vars: ['sex'], sql: spec, phrase: 'combien de Lucas', at: 2 },
  { id: 'q2', name: 'Piège', recipe: {}, sql: { sql: 'DELETE FROM joueurs', explanation: 'x', display: 'nombre' } },
  { id: 'q3', name: 'Recette', recipe: { pop: { sex: 'F' }, out: { type: 'count' } }, vars: ['sex'] },
])
assert.deepEqual(saved.map((x) => x.id), ['q1', 'q3'])
assert.deepEqual(saved[0].sql, spec)
assert.deepEqual(saved[0].vars, [], 'pas de variables en mode avancé')
assert.equal(saved[1].sql, undefined)

// ---------- Exemples des consignes de la fonction : exécutés sur le jeu fictif ----------
const fn = readFileSync(new URL('../supabase/functions/transcrire/index.ts', import.meta.url), 'utf8')
const start = fn.indexOf('const CONSIGNES_SQL = `')
assert.ok(start > 0, 'consignes du mode sql')
const consignes = fn.slice(start, fn.indexOf('`', start + 30))
const examples = [...consignes.matchAll(/^« (.*) » → (\{.*\})$/gm)].map(([, phrase, json]) => ({ phrase, answer: JSON.parse(json) as { sql: string; explication: string; affichage: string; nonGere: string[] } }))
assert.ok(examples.length >= 10, `${examples.length} exemples`)
type Rows = (string | number | null)[][]
const expect: Record<string, (rows: Rows, cols: string[]) => void> = {
  "combien de joueurs s'appellent Lucas": (rows) => assert.deepEqual(rows, [[2]], 'Lucas et Lúcas'),
  'quel club a le plus de pivots gauchers': (rows) => assert.deepEqual(rows, [['HBC Exemple', 2], ['Handball Imaginaire', 1]]),
  'les joueurs vus par 3 coachs différents mais jamais notés au-dessus de 3 en défense': (rows, cols) => {
    assert.equal(cols[0], 'joueur_id')
    assert.deepEqual(rows.map((r) => r[0]), ['p1', 'p3'], 'p5 a un 4 en défense, p4 vu par 2 personnes')
  },
  'moyenne de taille par poste chez les 2010': (rows) => assert.deepEqual(rows, [['GB', 192, 1], ['PIV', 188, 2], ['ARG', 178, 1]]),
  'les joueurs qui peuvent aussi jouer pivot': (rows) => assert.deepEqual(rows.map((r) => r[0]), ['p4']),
  'quel coach a vu le plus de joueurs différents dans le Var': (rows) => {
    assert.deepEqual(rows[0], ['Coach Un', 3])
    assert.deepEqual(rows.map((r) => r[1]), [3, 2, 2, 1])
  },
  'la moyenne en attaque des joueuses 2011 par club': (rows) => assert.deepEqual(rows, [['HBC Exemple', 4.5, 1], ['Handball Imaginaire', 3, 1]], 'avis en attente non compté'),
  "combien d'avis ont été écrits chaque mois depuis le 1er septembre 2026": (rows) => assert.deepEqual(rows, [['2026-09', 2], ['2026-10', 3]]),
  "les joueurs du groupe Intercomités qui n'ont pas encore de mesure de CMJ": (rows) => assert.deepEqual(rows.map((r) => r[0]), ['p7', 'p3']),
  'quelle génération compte le plus de gauchers': (rows) => assert.deepEqual(rows, [[2010, 2], [2011, 1]]),
  'le gardien le plus grand de chaque département': (rows) => assert.deepEqual(rows.map((r) => [r[0], r[3]]), [['p7', '75'], ['p8', '83']]),
  'combien de joueurs par département ont été vus cette saison': (rows) => assert.deepEqual(rows, [['83', 3], ['13', 2], ['75', 1]]),
  'quels joueurs ont changé de club cette année ?': () => assert.fail('pas de requête'),
}
for (const { phrase, answer } of examples) {
  assert.ok(expect[phrase], `résultat attendu décrit pour « ${phrase} »`)
  assert.deepEqual(Object.keys(answer), ['sql', 'explication', 'affichage', 'nonGere'], phrase)
  assert.ok(!/mauvais|nul|faible|pire|pas retenu|insuffisant|régress/i.test(answer.explication), `explication positive ou neutre : ${answer.explication}`)
  assert.ok(['nombre', 'liste', 'tableau', 'carte'].includes(answer.affichage), phrase)
  if (!answer.sql) {
    assert.ok(answer.nonGere.length > 0, `${phrase} : pas de requête, raison donnée`)
    continue
  }
  // Exemple tel quel : déjà conforme au contrôle (rien à ajouter sauf, au plus, LIMIT 500).
  const g = guardSql(answer.sql)
  assert.ok(g.ok, `${phrase} : ${!g.ok && g.error}`)
  assert.ok(g.sql === answer.sql || g.sql === `${answer.sql}\nLIMIT 500`, phrase)
  if (answer.affichage === 'liste') assert.ok(/AS joueur_id|^SELECT joueur_id/i.test(answer.sql), `${phrase} : colonne joueur_id`)
  const r = q(answer.sql)
  expect[phrase](r.values as Rows, r.columns)
}
const sqlSchema = buildSqlSchema({ criteria: CRITERIA, positions: POSITIONS, zoneOf: input.zoneOf, today: TODAY })
const chars = consignes.length + Object.entries(sqlSchema).map(([k, v]) => `${k} : ${v}`).join('\n').length
console.log(`Consignes « sql » : ${examples.length} exemples, ≈ ${chars} caractères avec la description (≈ ${Math.round(chars / 3.5)} jetons)`)
assert.ok(chars < 16000, 'consignes compactes')
// Colonnes décrites = colonnes de la copie.
for (const t of tables) for (const c of t.columns) assert.ok(new RegExp(`\\b${c}\\b`).test(JSON.stringify(sqlSchema)), `${t.name}.${c} décrite`)

// ---------- Aucune donnée dans ce qui part ----------
const sent = JSON.stringify(sqlSchema)
const words = [
  ...players.flatMap((p) => [p.firstName, p.lastName, p.club!, p.birthDate!]),
  ...Object.values(STAFF),
  'Intercomités', 'Stage fictif', 'Tournoi imaginaire', 'Fictiville', 'Var', 'Bouches-du-Rhône', 'Région Sud', '2026-09-20', SECRET,
]
for (const w of words) assert.ok(!sent.includes(w), `description sans « ${w} »`)
assert.ok(sent.includes('Défense') && sent.includes('CMJ – hauteur') && sent.includes(TODAY) && sent.includes('PIV (pivot)'), 'catégories, mesures, postes et date du jour décrits')
assert.ok(!sent.includes('Ancien critère') && !sent.includes('Commentaire'), 'critère supprimé ou texte libre non décrit')
const bodies: Record<string, unknown>[] = []
let url = ''
const ep: Endpoint = {
  url: 'https://exemple.invalid/functions/v1/transcrire',
  headers: { Authorization: 'Bearer jeton' },
  fetch: (async (u: string, init: RequestInit) => {
    url = u
    bodies.push(JSON.parse(String(init.body)))
    return new Response(JSON.stringify({ sql: 'SELECT 1', explication: 'Un.', affichage: 'nombre', nonGere: ['x', 3], ms: 9, restant_mois: 10, restant_jour: 4 }), { status: 200 })
  }) as unknown as typeof fetch,
}
const a = await understandSql(ep, '  combien de joueurs   s’appellent Lucas ', sqlSchema)
assert.equal(url, 'https://exemple.invalid/functions/v1/transcrire?mode=sql')
assert.deepEqual(Object.keys(bodies[0]), ['phrase', 'schema'])
assert.equal(bodies[0].phrase, 'combien de joueurs s’appellent Lucas')
assert.deepEqual(bodies[0].schema, sqlSchema)
assert.deepEqual(a, { sql: 'SELECT 1', explication: 'Un.', affichage: 'nombre', nonGere: ['x'], ms: 9, restantMois: 10, restantJour: 4 })
// Correction : la requête et le message de SQLite seulement (jamais de lignes de résultat).
let err = ''
try {
  db.exec("SELECT nom FROM joueurs WHERE prenom = Lucas")
} catch (e) {
  err = (e as Error).message
}
assert.match(err, /no such column/)
await understandSql(ep, 'combien de Lucas', sqlSchema, { sql: "SELECT nom FROM joueurs WHERE prenom = Lucas", erreur: err })
assert.deepEqual(Object.keys(bodies[1]), ['phrase', 'schema', 'precedent'])
assert.deepEqual(bodies[1].precedent, { sql: "SELECT nom FROM joueurs WHERE prenom = Lucas", erreur: err })
const all = JSON.stringify(bodies)
for (const w of words.filter((x) => x !== 'Lucas' && x !== 'Lúcas')) assert.ok(!all.includes(w), `rien envoyé de « ${w} »`)
await assert.rejects(understandSql(ep, 'x'.repeat(301), sqlSchema), /300 caractères/)
const errEp: Endpoint = { ...ep, fetch: (async () => new Response(JSON.stringify({ error: 'reponse_illisible' }), { status: 502 })) as unknown as typeof fetch }
await assert.rejects(understandSql(errEp, 'une question', sqlSchema), /mode avancé/i)
const acc = await requestAccess({ ...ep, fetch: (async () => new Response(JSON.stringify({ pret: true, modes: ['dictee', 'filtres', 'question', 'sql'] }))) as unknown as typeof fetch })
assert.ok(acc.modes?.includes('sql'))

// ---------- Fonction : garde-fous du mode ----------
const sFn = fn.slice(fn.indexOf('async function requeteSql'))
assert.ok(fn.includes("searchParams.get('mode') === 'sql') return await requeteSql"), 'routage du mode')
assert.ok(fn.includes("'question', 'question_joueurs', 'question_evenements', 'question_groupes', 'sql', 'action']"), 'GET : modes annonce « sql »')
assert.ok(sFn.includes('hb_transcription_compter'), 'un appel compté')
assert.ok(sFn.includes('avecRelance('), 'relance sur 429')
assert.ok(sFn.includes("Deno.env.get('MISTRAL_MODELE_SQL') || 'codestral-latest'"))
assert.ok(sFn.includes('temperature: 0') && sFn.includes("response_format: { type: 'json_object' }"))
assert.ok(!/\.rpc\('(?!hb_transcription_compter)|\.from\(|\.sql\(|execute/i.test(sFn), 'aucune requête exécutée côté serveur')
for (const line of sFn.split('\n').filter((l) => l.includes('console.'))) assert.ok(!/phrase|texte|sortie|sql\b|schema|precedent/.test(line.replace("'transcrire (sql)", '')), `rien journalisé : ${line}`)
// Le serveur garde aussi la forme : une requête qui ne commence pas par SELECT / WITH n'est pas rendue.
assert.ok(sFn.includes("!/^(select|with)\\b/i.test(sql)"))
for (const mode of ["=== 'filtres'", "=== 'avis'", "=== 'question'"]) assert.ok(fn.includes(mode), mode)

// ---------- Performance : 40 000 joueurs fictifs ----------
let seed = 7
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648)
const POS = ['GB', 'AG', 'ARG', 'DC', 'ARD', 'AD', 'PIV']
const DEPTS = ['83', '13', '75']
const big: P[] = Array.from({ length: 40_000 }, (_, i) =>
  pl(`b${i}`, `Prénom${i % 500}`, `NOM${i}`, `${2008 + (i % 6)}-0${1 + (i % 9)}-1${i % 10}`, i % 2 ? 'M' : 'F', POS[i % 7], `Club fictif ${i % 900}`, DEPTS[i % 3], {
    laterality: i % 5 ? 'droitier' : 'gaucher',
    secondaryPositions: i % 4 ? undefined : [POS[(i + 3) % 7]],
  }),
)
const bigSights = Array.from({ length: 100_000 }, (_, i) => S(`b${Math.floor(rnd() * 40_000)}`, `2026-${String(1 + (i % 10)).padStart(2, '0')}-1${i % 10}`, `e${i % 300}`, `u${i % 40}`))
const bigEvals: MEval[] = Array.from({ length: 10_000 }, (_, i) =>
  E(`x${i}`, `b${Math.floor(rnd() * 40_000)}`, `e${i % 300}`, `u${i % 40}`, `2026-${String(1 + (i % 10)).padStart(2, '0')}-1${i % 10}`, {
    agressivite: 1 + (i % 5),
    placement: 1 + ((i * 3) % 5),
    tir: 1 + ((i * 7) % 5),
    duel: i % 4,
    vision: 1 + (i % 4),
  }),
)
const bigMeasures = big.flatMap((p, i) => [
  ...(i % 3 === 0 ? [{ playerId: p.id, criterionId: 'taille', value: 160 + Math.floor(rnd() * 40), date: '2026-09-01' }] : []),
  ...(i % 5 === 0 ? [{ playerId: p.id, criterionId: 'cmj_hauteur', value: 25 + Math.floor(rnd() * 25), date: '2026-09-01' }] : []),
])
const bigInput: MirrorInput = {
  ...input,
  players: big,
  sights: bigSights,
  evals: bigEvals,
  measures: bigMeasures,
  groups: [{ id: 'g-ic', name: 'Intercomités', playerIds: big.filter((_, i) => i % 50 === 0).map((p) => p.id) }],
  events: Array.from({ length: 300 }, (_, i) => ({ id: `e${i}`, name: `Événement ${i}`, type: 'tournoi', date: '2026-09-01' })),
  staffName: (id) => `Coach ${id}`,
}
t0 = performance.now()
const bigTables = buildMirrorTables(bigInput)
const tBuild = performance.now() - t0
t0 = performance.now()
const bigDb = new SQL.Database()
loadMirror(bigDb, bigTables)
const tLoad = performance.now() - t0
let worst = 0
for (const { answer } of examples) {
  if (!answer.sql) continue
  const g = guardSql(answer.sql)
  t0 = performance.now()
  if (g.ok) bigDb.exec(g.sql)
  worst = Math.max(worst, performance.now() - t0)
}
const rows = bigTables.reduce((n, t) => n + t.rows.length, 0)
console.log(`40 000 joueurs (${rows.toLocaleString('fr-FR')} lignes) : tables ${Math.round(tBuild)} ms, chargement SQLite ${Math.round(tLoad)} ms, requête d'exemple la plus lente ${Math.round(worst)} ms`)
assert.ok(tBuild + tLoad < 2500, `copie en moins de 2,5 s (${Math.round(tBuild + tLoad)} ms ; visé : ~1 s dans le navigateur)`)
assert.ok(worst < 1500, `chaque requête d'exemple en moins de 1,5 s (${Math.round(worst)} ms ; coupée à 3 s dans l'appli)`)
bigDb.close()
db.close()

console.log('test-sql : OK')
