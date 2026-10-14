// Test du « Journal des questions » (src/questionLogCore.ts) : anonymisation des phrases et des requêtes SQL (prénoms et
// noms des fiches de l'appareil, accents, noms composés, mots courants qui sont aussi des noms, licences), entrée de CHAQUE
// question (recette complète / partielle / pas comprise ; mode avancé ok / erreur / refus / délai / réseau), droits simulés
// (écriture par tout compte qui pose une question, lecture par les administrateurs seulement, rien pendant « Voir comme… »),
// issues et filtres, regroupement avec compteur (ratées d'abord, plus fréquentes), « Copier pour Claude » (ratés à traiter et
// questions les plus fréquentes). Noms fictifs ou génériques seulement.
//
//   npx jiti tools/test-journal-questions.ts
import assert from 'node:assert/strict'
import {
  buildAnonymizer,
  buildEntry,
  copyForClaude,
  filterEntries,
  groupEntries,
  maskLicences,
  outcomeOf,
  questionLogRights,
  RECIPE_LABEL,
  similarKey,
  STATUS_LABEL,
  type QuestionLogRow,
} from '../src/questionLogCore'

// Fiches fictives : prénoms et noms seulement (c'est tout ce que lit l'anonymisation).
const players = [
  { firstName: 'Lucas', lastName: 'Martin' },
  { firstName: 'Lucas', lastName: 'Zorbeck' },
  { firstName: 'Jean-Pierre', lastName: 'Rose' },
  { firstName: 'Éloïse', lastName: 'Blanc' },
  { firstName: 'Rose', lastName: 'Quillard' },
  { firstName: 'Thomas', lastName: 'Varnier' },
  { firstName: 'Noa', lastName: 'Thomas' },
  { firstName: 'Inès', lastName: 'De La Brunière' },
  { firstName: 'Paris', lastName: 'Ostrander' }, // prénom qui est aussi une ville
  { firstName: 'Marin', lastName: 'Pivot' }, // nom qui est aussi un poste
]
const keep = ['HBC Toulon', 'Var', 'Paris', 'Île-de-France', 'Région Sud', 'Gardien', 'Pivot', 'Ailier gauche', 'Vitesse 30 m']
const an = buildAnonymizer({ players, keep })
const t = an.text
const q = an.sql

// ---------- Phrases ----------

assert.equal(t("combien s'appellent Lucas"), "combien s'appellent [prénom]")
assert.equal(t("combien s'appellent lucas"), "combien s'appellent [prénom]", 'minuscules')
assert.equal(t('les Martin nés en 2010'), 'les [nom] nés en 2010', 'année gardée')
assert.equal(t('les MARTIN du Var'), 'les [nom] du Var', 'majuscules ; département gardé')
assert.equal(t('les joueurs nommés Zorbeck au poste de pivot'), 'les joueurs nommés [nom] au poste de pivot')
// Accents : « eloise » écrit sans accent, « Éloïse » avec.
assert.equal(t('fiches de eloise'), 'fiches de [prénom]')
assert.equal(t('fiches d’Éloïse'), 'fiches d’[prénom]')
// Noms composés : une seule étiquette ; « jean pierre » en deux mots : deux étiquettes.
assert.equal(t('les mesures de Jean-Pierre'), 'les mesures de [prénom]')
assert.equal(t('les mesures de jean pierre'), 'les mesures de [prénom] [prénom]')
// Particules jamais remplacées.
assert.equal(t('Inès De La Brunière est-elle gauchère'), '[prénom] De La [nom] est-elle gauchère')
// Ambigu (Thomas : 1 prénom, 1 nom) : « [nom] ».
assert.equal(t('combien de Thomas'), 'combien de [nom]')

// Faux positifs évités : mot composé dont une partie n'est pas un nom.
assert.equal(t('le club des martin-pêcheurs'), 'le club des martin-pêcheurs')
// Mots courants (Rose, Blanc) : gardés en minuscules ou en début de phrase, remplacés avec une majuscule ou collés à un nom.
assert.equal(t('joueurs en maillot blanc ou rose'), 'joueurs en maillot blanc ou rose')
assert.equal(t('Rose et Blanc sont-ils mesurés'), 'Rose et [nom] sont-ils mesurés', 'début de phrase : gardé ; majuscule ailleurs : remplacé')
assert.equal(t('la taille de Rose'), 'la taille de [nom]', 'Rose : 1 prénom, 1 nom → ambigu → [nom]')
assert.equal(t('lucas blanc a-t-il été vu'), '[prénom] [nom] a-t-il été vu', 'collé à un prénom reconnu')
// Vocabulaire de l'appli (clubs, départements, régions, postes) gardé… sauf collé à un nom.
assert.equal(t('les gardiens du HBC Toulon en Île-de-France'), 'les gardiens du HBC Toulon en Île-de-France')
assert.equal(t('les pivots de Paris'), 'les pivots de Paris')
assert.equal(t('fiche de Paris Ostrander'), 'fiche de [prénom] [nom]')
assert.equal(t('Marin Pivot'), '[prénom] [nom]')
assert.equal(t('le meilleur Pivot'), 'le meilleur Pivot', 'poste gardé même avec une majuscule')
// Licences ; années et petits nombres gardés.
assert.equal(t('licence 6383015001234'), 'licence [licence]')
assert.equal(t('la licence 638 301 500 1234'), 'la licence [licence]')
assert.equal(t('nés en 2010 2011 ou 2012, plus de 180 cm, département 83'), 'nés en 2010 2011 ou 2012, plus de 180 cm, département 83')
assert.equal(maskLicences('saison 2010-2011'), 'saison 2010-2011')
assert.equal(maskLicences('entre 180 185'), 'entre 180 185')
assert.equal(maskLicences('n° 123456'), 'n° [licence]')
// Rien de connu : phrase intacte.
assert.equal(t('quels U15 ont progressé en vitesse depuis septembre ?'), 'quels U15 ont progressé en vitesse depuis septembre ?')

// ---------- SQL ----------

assert.equal(q("SELECT count(*) FROM joueurs WHERE prenom = 'Lucas'"), "SELECT count(*) FROM joueurs WHERE prenom = '[prénom]'")
assert.equal(q("SELECT id FROM joueurs WHERE sans_accents(prenom) = 'eloise'"), "SELECT id FROM joueurs WHERE sans_accents(prenom) = '[prénom]'")
assert.equal(q("SELECT id FROM joueurs WHERE sans_accents(nom) LIKE '%martin%'"), "SELECT id FROM joueurs WHERE sans_accents(nom) LIKE '%[nom]%'")
// Colonne nom : remplacé quel que soit le mot (même un mot inconnu des fiches, même un mot courant).
assert.equal(q("SELECT id FROM joueurs WHERE nom IN ('Blanc', 'Inconnu')"), "SELECT id FROM joueurs WHERE nom IN ('[nom]', '[nom]')")
assert.equal(q("SELECT id FROM joueurs j WHERE j.nom = 'N''Golo'"), "SELECT id FROM joueurs j WHERE j.nom = '[nom]'")
// Autres textes : même règle que les phrases (club, département, poste gardés) ; licences masquées partout.
assert.equal(
  q("SELECT nom, prenom FROM joueurs WHERE club = 'HBC Toulon' AND departement = '83' AND poste = 'PIV' AND annee = 2010"),
  "SELECT nom, prenom FROM joueurs WHERE club = 'HBC Toulon' AND departement = '83' AND poste = 'PIV' AND annee = 2010",
)
assert.equal(q("SELECT * FROM joueurs WHERE licence = '6383015001234' OR id = 6383015001234"), "SELECT * FROM joueurs WHERE licence = '[licence]' OR id = [licence]")
assert.equal(q("SELECT count(*) AS \"Lucas\" FROM joueurs -- les Zorbeck\nWHERE 1"), 'SELECT count(*) AS "[prénom]" FROM joueurs -- les [nom]\nWHERE 1')
// Mots du SQL lui-même jamais touchés (colonne « nom », alias, LIMIT).
assert.equal(q('SELECT nom AS martin FROM joueurs LIMIT 500'), 'SELECT nom AS martin FROM joueurs LIMIT 500')

// ---------- Entrée : toutes les questions, anonymisée, jamais de résultat ----------

const at = new Date('2026-10-14T08:00:00Z')
// Recette complète : ni mode avancé, ni requête.
const full = buildEntry({ phrase: 'les 2011 de Lucas Martin', recipe: 'complete' }, { players, keep }, { id: 'u-enc', name: 'Encadrant' }, at)
assert.deepEqual(full, { at: '2026-10-14T08:00:00.000Z', authorId: 'u-enc', authorName: 'Encadrant', phrase: 'les 2011 de [prénom] [nom]', recipe: 'complete' })
// Recette partielle, puis mode avancé : ce qui n'est pas appliqué (anonymisé), statut, requête anonymisée, nombre de lignes.
const part = buildEntry(
  {
    phrase: 'taille moyenne des Zorbeck par poste',
    recipe: 'partielle',
    recipeMissing: ['moyenne de taille : pas calculée par la recette', 'nom « Zorbeck »'],
    how: 'auto',
    status: 'ok',
    sql: "SELECT poste, AVG(taille_cm) FROM joueurs WHERE nom = 'Zorbeck' GROUP BY poste",
    rows: 3,
    display: 'tableau',
  },
  { players, keep },
  {},
  at,
)
assert.equal(part.phrase, 'taille moyenne des [nom] par poste')
assert.deepEqual(part.recipeMissing, ['moyenne de taille : pas calculée par la recette', 'nom « [nom] »'])
assert.equal(part.sql, "SELECT poste, AVG(taille_cm) FROM joueurs WHERE nom = '[nom]' GROUP BY poste")
assert.deepEqual([part.how, part.status, part.rows, part.display], ['auto', 'ok', 3, 'tableau'])
assert.ok(!('result' in part) && !JSON.stringify(part).includes('Zorbeck'), 'aucun nom, aucun résultat')
// « how » sans mode avancé lancé : retiré ; textes bornés.
const long = buildEntry({ phrase: 'x'.repeat(400), recipe: 'pas_comprise', how: 'auto', recipeMissing: Array.from({ length: 15 }, (_, i) => `m${i}`) }, { players }, {}, at)
assert.equal(long.how, undefined)
assert.equal(long.phrase.length, 300)
assert.equal(long.recipeMissing!.length, 10)

// ---------- Statuts et issues ----------

assert.equal(outcomeOf({ recipe: 'complete' }), 'complete')
assert.equal(outcomeOf({ recipe: 'complete', status: 'erreur' }), 'complete', 'la recette suffisait')
assert.equal(outcomeOf({ recipe: 'partielle', status: 'ok' }), 'sauvee')
assert.equal(outcomeOf({ recipe: 'pas_comprise', status: 'ok' }), 'sauvee')
for (const st of ['erreur', 'refus', 'delai', 'reseau', 'annule'] as const) assert.equal(outcomeOf({ recipe: 'partielle', status: st }), 'rate', st)
assert.equal(outcomeOf({ recipe: 'pas_comprise' }), 'rate', 'mode avancé indisponible')
assert.deepEqual(Object.keys(STATUS_LABEL), ['ok', 'erreur', 'refus', 'delai', 'reseau', 'annule'])
assert.deepEqual(Object.keys(RECIPE_LABEL), ['complete', 'partielle', 'pas_comprise'])

// ---------- Droits (miroir du serveur, 043) ----------

assert.deepEqual(questionLogRights('admin'), { write: true, read: true })
assert.deepEqual(questionLogRights('preparateur'), { write: true, read: false }, 'encadrant : note ses questions, ne relit jamais le journal')
assert.deepEqual(questionLogRights('observateur'), { write: false, read: false }, 'pas de « Poser une question »')
assert.deepEqual(questionLogRights(null), { write: false, read: false })
assert.deepEqual(questionLogRights('admin', true), { write: false, read: false }, 'rien pendant « Voir comme… »')

// ---------- Regroupement, filtres, tri ----------

const e = (id: string, at: string, phrase: string, extra: Partial<QuestionLogRow> = {}): QuestionLogRow => ({ id, at, phrase, recipe: 'partielle', how: 'auto', status: 'ok', ...extra })
const rows: QuestionLogRow[] = [
  e('1', '2026-10-01T10:00:00Z', "combien s'appellent [prénom]", { sql: "SELECT count(*) FROM joueurs WHERE prenom = '[prénom]'", rows: 1, display: 'nombre', recipeMissing: ['prénom'] }),
  e('2', '2026-10-03T10:00:00Z', 'Combien s’appellent [prénom] ?', { status: 'erreur', sql: 'SELECT x', sqlRetry: 'SELECT y', detail: 'no such column: x' }),
  e('3', '2026-10-02T10:00:00Z', 'les [nom] nés en 2010', { rows: 3, display: 'joueurs' }),
  e('4', '2026-10-04T10:00:00Z', 'les [nom] nés en 2011', { rows: 2, recipeDone: true }),
  e('5', '2026-10-05T10:00:00Z', 'joueurs en maillot blanc', { deleted: true }),
  e('6', '2026-09-20T10:00:00Z', 'quels clubs ont le plus de gauchers', { status: 'delai', sql: 'SELECT club FROM joueurs', modelMissing: ['plus de'] }),
  // Comprises par la recette (sans mode avancé) : fréquentes.
  e('7', '2026-10-06T10:00:00Z', 'les joueuses 2011 vues une fois', { recipe: 'complete', how: undefined, status: undefined }),
  e('8', '2026-10-07T10:00:00Z', 'les joueuses 2012 vues une fois', { recipe: 'complete', how: undefined, status: undefined }),
  e('9', '2026-10-08T10:00:00Z', 'les joueuses 2013 vues une fois', { recipe: 'complete', how: undefined, status: undefined }),
  // Pas comprise, mode avancé indisponible : ratée.
  e('10', '2026-09-01T10:00:00Z', 'qui a changé de club', { recipe: 'pas_comprise', how: undefined, status: undefined, recipeMissing: ['changé de club'] }),
]
assert.equal(similarKey("combien s'appellent [prénom]"), similarKey('Combien s’appellent [prénom] ?'))
assert.equal(similarKey('les [nom] nés en 2010'), similarKey('les [nom] nés en 2011'), 'années remplacées par #')
assert.notEqual(similarKey('les [nom] nés en 2010'), similarKey('les [prénom] nés en 2010'))
const recent = groupEntries(rows)
assert.equal(recent.length, 5, 'entrée supprimée ignorée ; phrases semblables groupées')
assert.deepEqual(
  recent.map((g) => g.entries.map((x) => x.id)),
  [['9', '8', '7'], ['4', '3'], ['2', '1'], ['6'], ['10']],
  'groupes les plus récents d’abord, entrées les plus récentes d’abord',
)
assert.equal(recent[1].done, false, 'groupe à moitié transformé : encore à traiter')
assert.equal(recent[2].phrases.length, 2)
assert.deepEqual(recent.map((g) => g.outcome), ['complete', 'sauvee', 'rate', 'rate', 'rate'], 'issue la moins bonne du groupe')
// Ratées d'abord (puis les plus fréquentes, puis les plus récentes).
assert.deepEqual(groupEntries(rows, 'rates').map((g) => g.entries[0].id), ['2', '6', '10', '4', '9'])
// Les plus fréquentes (compteur).
assert.deepEqual(groupEntries(rows, 'frequentes').map((g) => [g.entries[0].id, g.entries.length]), [['9', 3], ['4', 2], ['2', 2], ['6', 1], ['10', 1]])
// Filtres par issue.
const idsOf = (xs: QuestionLogRow[]) => xs.map((x) => x.id).sort()
assert.deepEqual(idsOf(filterEntries(rows, 'rate')), ['10', '2', '6'])
assert.deepEqual(idsOf(filterEntries(rows, 'sauvee')), ['1', '3', '4'])
assert.deepEqual(idsOf(filterEntries(rows, 'complete')), ['7', '8', '9'])
assert.deepEqual(idsOf(filterEntries(rows, 'a_traiter')), ['1', '10', '2', '3', '6'], 'ni comprises, ni transformées, ni supprimées')
assert.equal(filterEntries(rows, 'toutes').length, 9)

// ---------- « Copier pour Claude » : ratés à traiter + les plus fréquentes ----------

const md = copyForClaude(rows, '2026-10-14')
console.log(md)
assert.ok(md.startsWith('# HandBase : questions posées au bilan'))
assert.ok(md.includes('9 questions au journal · 5 questions à traiter en 4 formes · relevé du 2026-10-14'))
const [todo, freq] = md.split('## Questions les plus fréquentes')
// 1. Ratés à traiter, ratés d'abord.
assert.ok(todo.indexOf('### 1. « Combien s’appellent [prénom] ? » ×2 · Ratée') > 0 || todo.indexOf("### 1. « combien s'appellent [prénom] » ×2 · Ratée") > 0, todo)
assert.ok(todo.indexOf('### 2. « quels clubs ont le plus de gauchers » ×1 · Ratée') > 0)
assert.ok(todo.indexOf('### 3. « qui a changé de club » ×1 · Ratée') > 0)
assert.ok(todo.indexOf('### 4. « les [nom] nés en 2010 » ×1 · Sauvée par le mode avancé') > 0, 'entrée transformée en recette retirée du groupe')
assert.ok(todo.includes('- Pas appliqué par la recette : prénom'))
assert.ok(todo.includes('- Mode avancé : erreur, réponse calculée'), 'statuts du groupe, avec leur nombre')
assert.ok(todo.includes('- Réponse : affichage nombre, 1 ligne'), 'référence : l’essai réussi')
assert.ok(todo.includes("```sql\nSELECT count(*) FROM joueurs WHERE prenom = '[prénom]'\n```"))
assert.ok(todo.includes('- Erreur : no such column: x'))
assert.ok(todo.includes('- Mode avancé : pas lancé'), 'question pas comprise sans mode avancé')
assert.ok(todo.includes('- Recette : Pas comprise'))
assert.ok(todo.includes('- Pas géré en mode avancé : plus de'))
assert.ok(todo.includes('- Mode avancé : délai dépassé'))
assert.ok(!todo.includes('2011') && !todo.includes('joueuses'), 'ni transformée, ni comprise dans les ratés')
assert.ok(!md.includes('maillot'), 'entrée supprimée absente')
// 2. Les plus fréquentes, toutes issues, avec leur nombre.
assert.ok(freq.includes('1. « les joueuses 2013 vues une fois » ×3 : Comprise par la recette ×3'), freq)
assert.ok(freq.includes('« les [nom] nés en 2011 » ×2 : Sauvée par le mode avancé ×2 (transformée en recette)') === false, 'pas toutes transformées')
assert.ok(/2\. « les \[nom\] nés en 2011 » ×2 : Sauvée par le mode avancé ×2/.test(freq), freq)
// Requête corrigée seule (groupe sans réussite) : les deux requêtes.
const md2 = copyForClaude([e('11', '2026-10-06T10:00:00Z', 'top [nom]', { status: 'erreur', sql: 'SELECT a', sqlRetry: 'SELECT b' })], '2026-10-14')
assert.ok(md2.includes('- Requête (1er essai, refusée ou en erreur) :\n```sql\nSELECT a\n```\n- Requête corrigée :\n```sql\nSELECT b\n```'))
const empty = copyForClaude([], '2026-10-14')
assert.ok(empty.includes('Rien à traiter.') && empty.endsWith('Aucune question.'))
// Aucun résultat dans ce qui part : seules ces clés existent dans une entrée.
const KEYS = new Set(['id', 'updatedAt', 'deleted', 'at', 'authorId', 'authorName', 'phrase', 'recipe', 'recipeMissing', 'how', 'status', 'modelMissing', 'sql', 'sqlRetry', 'detail', 'rows', 'display', 'recipeDone'])
for (const k of Object.keys(part)) assert.ok(KEYS.has(k), k)

console.log('test-journal-questions : OK')
