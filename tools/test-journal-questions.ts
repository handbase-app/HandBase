// Test du « Journal des questions avancées » (src/questionLogCore.ts) : anonymisation des phrases et des requêtes SQL
// (prénoms et noms des fiches de l'appareil, accents, noms composés, mots courants qui sont aussi des noms, licences),
// regroupement des phrases semblables et texte « Copier pour Claude ». Noms fictifs ou génériques seulement.
//
//   npx jiti tools/test-journal-questions.ts
import assert from 'node:assert/strict'
import { buildAnonymizer, copyForClaude, groupEntries, maskLicences, similarKey, type QuestionLogRow } from '../src/questionLogCore'

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

// ---------- Regroupement ----------

const e = (id: string, at: string, phrase: string, extra: Partial<QuestionLogRow> = {}): QuestionLogRow => ({ id, at, phrase, how: 'auto', status: 'ok', ...extra })
const rows: QuestionLogRow[] = [
  e('1', '2026-10-01T10:00:00Z', "combien s'appellent [prénom]", { sql: "SELECT count(*) FROM joueurs WHERE prenom = '[prénom]'", rows: 1, display: 'nombre', recipeMissing: ['prénom'] }),
  e('2', '2026-10-03T10:00:00Z', "Combien s’appellent [prénom] ?", { status: 'erreur_sql', sql: 'SELECT x', sqlRetry: 'SELECT y', detail: 'no such column: x' }),
  e('3', '2026-10-02T10:00:00Z', 'les [nom] nés en 2010', { rows: 3, display: 'joueurs' }),
  e('4', '2026-10-04T10:00:00Z', 'les [nom] nés en 2011', { rows: 2, recipeDone: true }),
  e('5', '2026-10-05T10:00:00Z', 'joueurs en maillot blanc', { deleted: true }),
  e('6', '2026-09-20T10:00:00Z', 'quels clubs ont le plus de gauchers', { status: 'delai', sql: 'SELECT club FROM joueurs', modelMissing: ['plus de'] }),
]
assert.equal(similarKey("combien s'appellent [prénom]"), similarKey('Combien s’appellent [prénom] ?'))
assert.equal(similarKey('les [nom] nés en 2010'), similarKey('les [nom] nés en 2011'), 'années remplacées par #')
assert.notEqual(similarKey('les [nom] nés en 2010'), similarKey('les [prénom] nés en 2010'))
const groups = groupEntries(rows)
assert.equal(groups.length, 3, 'entrée supprimée ignorée ; phrases semblables groupées')
assert.deepEqual(
  groups.map((g) => g.entries.map((x) => x.id)),
  [['4', '3'], ['2', '1'], ['6']],
  'groupes les plus récents d’abord, entrées les plus récentes d’abord',
)
assert.equal(groups[0].done, false, 'groupe à moitié transformé : encore à traiter')
assert.equal(groups[1].phrases.length, 2)

// ---------- « Copier pour Claude » ----------

const md = copyForClaude(rows, '2026-10-14')
console.log(md)
assert.ok(md.startsWith('# HandBase : questions passées en mode avancé'))
assert.ok(md.includes('4 questions, 3 formes différentes · relevé du 2026-10-14'), 'seulement les entrées à traiter (ni supprimées, ni transformées)')
assert.ok(md.includes("## 1. « combien s'appellent [prénom] » ×2") || md.includes('## 1. « Combien s’appellent [prénom] ? » ×2'))
assert.ok(md.includes('- Pas pris en compte par la recette : prénom'))
assert.ok(md.includes('- Statut : Erreur SQL, Réponse calculée') || md.includes('- Statut : Réponse calculée, Erreur SQL'))
assert.ok(md.includes('- Réponse : affichage nombre, 1 ligne'), 'référence : l’essai réussi')
assert.ok(md.includes("```sql\nSELECT count(*) FROM joueurs WHERE prenom = '[prénom]'\n```"))
assert.ok(md.includes('- Erreur : no such column: x'))
assert.ok(md.includes('## 2. « les [nom] nés en 2010 » ×1'), 'entrée transformée en recette retirée du groupe')
assert.ok(!md.includes('2011'), 'entrée transformée en recette absente')
assert.ok(!md.includes('maillot'), 'entrée supprimée absente')
assert.ok(md.includes('- Pas géré en mode avancé : plus de'))
assert.ok(md.includes('- Statut : Délai dépassé'))
// Requête corrigée seule (groupe sans réussite) : les deux requêtes.
const md2 = copyForClaude([e('9', '2026-10-06T10:00:00Z', 'top [nom]', { status: 'erreur_sql', sql: 'SELECT a', sqlRetry: 'SELECT b' })], '2026-10-14')
assert.ok(md2.includes('- Requête (1er essai, refusée ou en erreur) :\n```sql\nSELECT a\n```\n- Requête corrigée :\n```sql\nSELECT b\n```'))
assert.ok(copyForClaude([], '2026-10-14').endsWith('Rien à traiter.'))

console.log('test-journal-questions : OK')
