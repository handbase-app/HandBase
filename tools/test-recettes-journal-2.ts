// Test des recettes tirées du journal des questions, 2e relecture (questions du 18/10 au 31/10, base de test) : un cas par
// constat. Réponses du modèle simulées (aucun appel réseau) ; jeu fictif, aucun nom réel.
//  1. dictée : « dans le bar » → Var (jamais « trap bar »), « cochers » → gauchers, « Se passe tout. » → « Efface tout » ;
//  2. « ce rythme-là » n'est pas une phrase coupée ; phrase sans aucune demande (bruit du micro) : pas de mode avancé auto ;
//  3. lieu rendu dans nonGere (« Combien de clubs en Occitanie ? ») : appliqué d'après la phrase ;
//  4. département rendu comme région (« région Alpes-Maritimes ») : le département ;
//  5. « la liste des clubs de la région Sud » : le tableau par club ;
//  6. tri vide de sens (« tri : tri ») : ni tri ni « pas pris en compte » ;
//  7. « les 10 gauchers les plus grands », « le plus grand joueur » : tri par taille et le nombre dit ;
//  8. « du pôle de X et du pôle d'Y » : les groupes « Pôle … », pas les clubs ; « en structure pôle » : rien ;
//  9. actions : « … et tu me crées un groupe tournoi … », « …. Et tu me créeras un groupe … », « crée-moi un groupe. Nom. »,
//     « Filtrer les joueurs gauchers dans l'événement … » ;
// 10. liste Événements : « les stages de test Pôle » trouve « Stage test Pôle … » (pluriel dit, singulier dans le nom).
//
//   npx jiti tools/test-recettes-journal-2.ts
import assert from 'node:assert/strict'
import { answersNothing, buildIndex, interpretRecipe, runRecipe, type QData, type QPlayer, type QuestionContext, type Recipe } from '../src/recipe'
import { correctQuestionPhrase, incompletePhrase, noRequest, rescueInterpretation } from '../src/questionRescue'
import { listRecipe, localQueryCommand, mergeQuery, EMPTY_QUERY } from '../src/playerQuery'
import { detectAction, matchName } from '../src/askAction'
import { bestMatch, readName } from '../src/voiceFilters'
import { textMatch } from '../src/listQuery'
import { readEventsRecipe } from '../src/eventQuery'

const TODAY = '2026-10-31'
const REGIONS: Record<string, string> = { '83': 'region-sud', '06': 'region-sud', '13': 'region-sud', '34': 'region-occ', '31': 'region-occ' }
const ctx: QuestionContext = {
  regions: [
    { id: 'region-sud', name: 'Région Sud' },
    { id: 'region-occ', name: 'Occitanie' },
  ],
  depts: [
    { code: '83', name: 'Var' },
    { code: '06', name: 'Alpes-Maritimes' },
    { code: '13', name: 'Bouches-du-Rhône' },
    { code: '34', name: 'Hérault' },
    { code: '31', name: 'Haute-Garonne' },
  ],
  regionOfDept: (c) => REGIONS[c],
  positions: [
    { id: 'GB', label: 'Gardien' },
    { id: 'PIV', label: 'Pivot' },
  ],
  clubs: [
    { key: 'fictiville handball', name: 'Fictiville Handball', dept: '83' },
    { key: 'club beta', name: 'Club Beta', dept: '06' },
    { key: 'club gamma', name: 'Club Gamma', dept: '34' },
  ],
  groups: [
    { id: 'g-fic', name: 'Pôle Fictiville' },
    { id: 'g-exe', name: 'Pôle Exempleville-sur-Mer' },
    { id: 'g-idf', name: 'Pôle test Île-de-France 2010' },
    { id: 'g-sel', name: 'Sélection fictive' },
  ],
  events: [],
  criteria: [
    { id: 'taille', label: 'Taille', category: 'Gabarit', kind: 'factual', scale: 'number', unit: 'cm' },
    { id: 'trap', label: 'Soulevé de terre trap bar', category: 'Force', kind: 'factual', scale: 'number', unit: 'kg' },
  ],
  zoneOf: () => null,
  today: TODAY,
}

// ---------- Jeu fictif ----------
type P = QPlayer & { department?: string }
let n = 0
const heights: Record<string, number> = {}
const pl = (birth: string, sex: 'M' | 'F', club: string, dept: string, extra: Partial<P> = {}, height?: number): P => {
  n++
  if (height) heights[`p${n}`] = height
  return { id: `p${n}`, firstName: `Prénom${n}`, lastName: `NOM${n}`, birthDate: `${birth}-03-01`, sex, club, department: dept, ...extra }
}
const players: P[] = [
  pl('2010', 'M', 'Fictiville Handball', '83', { laterality: 'gaucher' }, 192),
  pl('2010', 'M', 'Fictiville Handball', '83', { laterality: 'gaucher' }, 185),
  pl('2011', 'M', 'Club Beta', '06', { laterality: 'gaucher' }, 199),
  pl('2010', 'F', 'Club Beta', '06', { laterality: 'gaucher' }, 176),
  pl('2011', 'M', 'Club Gamma', '34', { laterality: 'gaucher' }, 181),
  pl('2010', 'M', 'Club Gamma', '34', { laterality: 'droitier' }, 202),
  pl('2012', 'F', 'Club Gamma', '34', {}, 170),
]
const data: QData<P> = {
  players,
  sights: ['p1', 'p3', 'p4', 'p5'].map((playerId) => ({ playerId, day: '2026-09-20', event: 'ev1', person: 'u1' })),
  evals: [],
  measures: Object.entries(heights).map(([playerId, value]) => ({ playerId, criterionId: 'taille', value, date: '2026-09-20' })),
  criteria: ctx.criteria,
  groups: [
    { id: 'g-fic', playerIds: ['p1', 'p2'] },
    { id: 'g-exe', playerIds: ['p5'] },
    { id: 'g-idf', playerIds: ['p7'] },
  ],
  events: [],
  deptOf: (p) => p.department,
  regionOf: (d) => REGIONS[d],
  zoneOf: () => null,
  today: TODAY,
}
const ix = buildIndex(data)

/** Comme la page de réponse (src/pages/Question.tsx) : relecture, relecture d'après la phrase, statut du journal. */
function ask(phrase: string, raw: unknown, nonGere: string[] = [], scope: 'question' | 'liste' = 'question') {
  const heard = correctQuestionPhrase(phrase)
  const it = rescueInterpretation(interpretRecipe(raw, nonGere, ctx, heard), heard, ctx, { scope })
  const status = answersNothing(it.recipe, it.unsupported) ? 'pas_comprise' : it.notes.length || it.unsupported.length ? 'partielle' : 'complete'
  return { ...it, heard, status, answer: runRecipe(ix, scope === 'liste' ? listRecipe(it.recipe) : it.recipe) }
}

// ---------- 1. Dictée ----------
{
  // « bar » entendu pour « Var » : le département, et plus la mesure « trap bar ».
  const said = 'Montre-moi les joueurs de plus d’un mètre 95 dans le bar et les bouches du Rhône.'
  assert.equal(correctQuestionPhrase(said), 'Montre-moi les joueurs de plus d’un mètre 95 dans le Var et les bouches du Rhône.')
  const a = ask(said, { population: { departements: ['Var', 'Bouches-du-Rhône'], tailleMin: 195 } })
  assert.equal(a.status, 'complete', JSON.stringify([a.notes, a.unsupported]))
  assert.deepEqual(a.recipe.pop.depts, ['83', '13'])
  assert.equal(correctQuestionPhrase('les joueurs du bar'), 'les joueurs du Var')
  // « trap bar » (une mesure) et « bar » ailleurs : jamais touchés.
  assert.equal(correctQuestionPhrase('plus de 100 kg au trap bar'), 'plus de 100 kg au trap bar')
  assert.equal(correctQuestionPhrase('le meilleur au soulevé de terre trap bar'), 'le meilleur au soulevé de terre trap bar')
  // « cochers » entendu pour « gauchers » (pluriel seulement).
  assert.equal(correctQuestionPhrase('Donne-moi la liste des cochers nés en 2010 ou plus.'), 'Donne-moi la liste des gauchers nés en 2010 ou plus.')
  assert.equal(correctQuestionPhrase('les cochères du Var'), 'les gauchères du Var')
  assert.equal(correctQuestionPhrase('il faut cocher la case'), 'il faut cocher la case')
  const c = ask('Donne-moi la liste des cochers nés en 2010 ou plus.', { population: { annee: { de: 2010 } } })
  assert.equal(c.recipe.pop.hand, 'gaucher', 'la latéralité est lue dans la phrase corrigée')
  // « Se passe tout. » entendu pour « Efface tout » : la commande des listes, sans appel.
  assert.equal(correctQuestionPhrase('Se passe tout.'), 'Efface tout')
  assert.deepEqual(localQueryCommand(correctQuestionPhrase('Se passe tout.')), { action: 'effacer' })
  assert.equal(correctQuestionPhrase('Que se passe-t-il pour tout le Var ?'), 'Que se passe-t-il pour tout le Var ?')
}

// ---------- 2. Phrase coupée, bruit du micro ----------
{
  assert.equal(incompletePhrase('Combien de temps pourrais-je tenir avec ce rythme-là ?'), null, '« là » n’est pas l’article « la »')
  assert.equal(incompletePhrase('Les joueurs de celui-là.'), null)
  assert.match(incompletePhrase('Les joueurs vus dans la') ?? '', /Phrase incomplète/)
  // (Un simple nom ne passe jamais ici : recherche par nom avant tout appel.)
  for (const t of ['Parce qu’on peut le faire.', 'Thank you.', 'Pour valider.', 'Bon, on y va ?']) assert.equal(noRequest(t), true, t)
  for (const t of ['Se passe tout.', 'les 2011', 'car pivot', 'Combien de temps pourrais-je tenir ?', 'Qui est le plus grand ?', 'les gauchers du Var', 'Trouve-moi tous les gamins'])
    assert.equal(noRequest(t), false, t)
}

// ---------- 3. Lieu rendu dans nonGere ----------
{
  const a = ask('Combien de clubs en Occitanie ?', { sortie: { type: 'nombre' } }, ['Occitanie'])
  assert.equal(a.status, 'complete', JSON.stringify([a.notes, a.unsupported]))
  assert.deepEqual(a.recipe.pop.regions, ['region-occ'])
  assert.deepEqual(a.recipe.out, { type: 'table', groupBy: 'club', countRows: true })
  assert.equal(a.answer.table!.filter((x) => x.key).length, 1, 'un seul club d’Occitanie dans le jeu')
  // Liste Joueurs aussi.
  const l = ask('les gauchers de Haute-Garonne', { population: { lateralite: 'gaucher' } }, ['Haute-Garonne'], 'liste')
  assert.deepEqual(l.recipe.pop.depts, ['31'])
  assert.deepEqual(l.unsupported, [])
  // Un lieu déjà appliqué : rien n'est changé ; un « pas pris en compte » sans lieu : rien n'est ajouté.
  assert.deepEqual(ask('les gauchers du Var en Occitanie', { population: { departements: ['Var'] } }, ['Occitanie']).recipe.pop.depts, ['83'])
  assert.equal(ask('les gauchers du Var', { population: { lateralite: 'gaucher' } }, ['taille moyenne']).recipe.pop.depts, undefined)
}

// ---------- 4. Département rendu comme région ----------
{
  const raw = { population: { regions: ['Alpes-Maritimes'], lateralite: 'gaucher' }, vus: { op: '>=', n: 1 }, sortie: { type: 'liste' } }
  const it = interpretRecipe(raw, [], ctx)
  assert.deepEqual(it.notes, [])
  assert.deepEqual(it.recipe.pop.depts, ['06'])
  assert.equal(it.recipe.pop.regions, undefined)
  const a = ask('Donne-moi la liste des joueurs vus dans les Alpes-Maritimes qui sont gauchers.', raw)
  assert.equal(a.status, 'complete')
  assert.deepEqual(a.answer.rows!.map((x) => x.p.id).sort(), ['p3', 'p4'])
  // L'inverse : une région rendue comme département.
  const r = interpretRecipe({ population: { departements: ['Occitanie'] } }, [], ctx)
  assert.deepEqual([r.notes, r.recipe.pop.regions, r.recipe.pop.depts], [[], ['region-occ'], undefined])
  // Ni l'un ni l'autre : signalé comme avant.
  assert.match(interpretRecipe({ population: { regions: ['Zorglubie'] } }, [], ctx).notes.join(), /région « Zorglubie » \(introuvable\)/)
}

// ---------- 5. Liste des clubs d'une région ----------
{
  for (const [raw, nonGere] of [
    [{}, ['liste des clubs de la région Sud']],
    [{ population: { regions: ['Sud'] } }, []],
    [{ population: { regions: ['Région Sud'] }, sortie: { type: 'liste' } }, ['liste des clubs']],
  ] as [unknown, string[]][]) {
    const a = ask('Donne-moi la liste des clubs de la région Sud.', raw, nonGere)
    assert.equal(a.status, 'complete', `${JSON.stringify(raw)} : ${JSON.stringify([a.notes, a.unsupported])}`)
    assert.deepEqual(a.recipe.pop.regions, ['region-sud'])
    assert.equal(a.recipe.out.type, 'table')
    assert.equal(a.recipe.out.groupBy, 'club')
    assert.deepEqual(a.answer.table!.map((x) => x.key).sort(), ['club beta', 'fictiville handball'])
  }
  // « les joueurs des clubs du Var » : une liste de joueurs, pas un tableau.
  assert.equal(ask('les joueurs des clubs du Var', { population: { departements: ['Var'] } }).recipe.out.type, 'list')
  // « combien de clubs » : toujours le nombre de clubs.
  assert.equal(ask('combien de clubs dans le Var ?', { population: { departements: ['Var'] } }).recipe.out.countRows, true)
}

// ---------- 6. Tri vide de sens ----------
{
  const a = ask('On rajoute que les joueurs doivent s’appeler Prénom3.', { population: { prenom: 'Prénom3' }, sortie: { tri: 'tri' } }, [], 'liste')
  assert.equal(a.status, 'complete', JSON.stringify(a.unsupported))
  assert.equal(a.recipe.out.sort, undefined)
  assert.deepEqual(a.recipe.pop.names, ['Prénom3'])
  // Un vrai tri inconnu reste signalé.
  assert.deepEqual(interpretRecipe({ sortie: { tri: 'pointure' } }, [], ctx).unsupported, ['tri « pointure »'])
}

// ---------- 7. Les N plus grands ----------
{
  const phrase = 'Donne-moi les 10 joueurs gauchers les plus grands de France.'
  for (const raw of [{ population: { lateralite: 'gaucher' } }, { population: { lateralite: 'gaucher' }, sortie: { type: 'liste', tri: 'taille', ordre: 'decroissant' } }]) {
    for (const scope of ['question', 'liste'] as const) {
      const a = ask(phrase, raw, [], scope)
      assert.equal(a.status, 'complete')
      assert.deepEqual(a.recipe.out.sort, { by: 'height', dir: 'desc' }, scope)
      assert.equal(a.recipe.out.limit, 10, scope)
    }
  }
  // Liste Joueurs : le nombre est gardé dans la liste fusionnée.
  const li = ask('Donne-moi les 3 joueurs gauchers les plus grands de France.', { population: { lateralite: 'gaucher' } }, [], 'liste')
  const merged = mergeQuery(EMPTY_QUERY, li.recipe, 'ajouter')
  assert.equal(merged.recipe.out.limit, 3)
  assert.deepEqual(runRecipe(ix, merged.recipe).rows!.map((x) => x.p.id), ['p3', 'p1', 'p2'])
  // Singulier : le premier.
  const one = ask('Qui est le plus grand joueur gaucher de France ?', { population: { lateralite: 'gaucher' } })
  assert.equal(one.recipe.out.limit, 1)
  assert.deepEqual(one.answer.rows!.map((x) => x.p.id), ['p3'])
  // Plus petites, en lettres.
  const small = ask('les cinq joueuses les plus petites', { population: { sexe: 'F' } })
  assert.deepEqual([small.recipe.out.sort, small.recipe.out.limit], [{ by: 'height', dir: 'asc' }, 5])
  // Sans nombre : trié, sans limite ; une année n'est pas un nombre de joueurs.
  const all = ask('les gauchers les plus grands', { population: { lateralite: 'gaucher' } })
  assert.deepEqual([all.recipe.out.sort, all.recipe.out.limit], [{ by: 'height', dir: 'desc' }, undefined])
  assert.equal(ask('les 2010 les plus grands', { population: { annee: 2010 } }).recipe.out.limit, undefined)
  // Un nombre (« combien ») : pas touché.
  assert.equal(ask('combien de joueurs sont plus grands que le plus grand gardien ?', { sortie: { type: 'nombre' } }).recipe.out.type, 'count')
}

// ---------- 8. Pôles ----------
{
  const phrase = 'tous les joueurs du pôle de Fictiville et du pôle d’Exempleville'
  const a = ask(phrase, { population: { clubs: ['Fictiville', 'Exempleville'] } }, [], 'liste')
  assert.deepEqual(a.recipe.pop.groups, ['g-fic', 'g-exe'])
  assert.equal(a.recipe.pop.clubs, undefined, 'pas le club de la ville')
  assert.deepEqual([a.notes, a.unsupported], [[], []], 'plus de « club introuvable »')
  assert.deepEqual(a.answer.rows!.map((x) => x.p.id).sort(), ['p1', 'p2', 'p5'])
  const b = ask('tous les joueurs qui appartiennent au pôle de Fictiville et au pôle d’Exempleville-sur-Mer', { population: {} })
  assert.deepEqual(b.recipe.pop.groups, ['g-fic', 'g-exe'])
  // « en structure pôle sur la France », « en Pôle Espoirs », « en pôle gaucher » : aucun groupe.
  for (const t of [
    'Combien de joueurs gauchers en structure pôle sur la France de plus d’un mètre quatre-vingt ?',
    'Combien de joueurs gauchers en Pôle Espoirs sur la région sud ?',
    'Combien de joueurs actuellement en pôle gaucher ont été vus ?',
  ])
    assert.equal(ask(t, { population: { lateralite: 'gaucher', pole: 'actuel' } }).recipe.pop.groups, undefined, t)
  // Un pôle inconnu : rien (le « club introuvable » reste dit).
  const z = ask('les joueurs du pôle de Zorglub', { population: { clubs: ['Zorglub'] } }, [], 'liste')
  assert.equal(z.recipe.pop.groups, undefined)
  assert.equal(z.notes.length, 1)
}

// ---------- 9. Actions ----------
{
  const plan = (p: string, page?: string) => {
    const d = detectAction(p, page)
    assert.ok(d && d.kind === 'plan', `action locale attendue : ${p} → ${JSON.stringify(d)}`)
    return d.plan
  }
  let p = plan('Sélectionne-moi tous les joueurs du pôle de Fictiville et du pôle d’Exempleville et tu me crées un groupe tournoi Fictif.', 'joueurs')
  assert.deepEqual([p.action, p.name, p.playersPhrase], ['creer_groupe', 'tournoi Fictif', 'tous les joueurs du pôle de Fictiville et du pôle d’Exempleville'])
  p = plan('Sélectionne-moi tous les joueurs qui appartiennent au pôle de Fictiville. Et tu me créeras un groupe préparation au tournoi Fictif.', 'joueurs')
  assert.deepEqual([p.action, p.name, p.playersPhrase], ['creer_groupe', 'préparation au tournoi Fictif', 'tous les joueurs qui appartiennent au pôle de Fictiville'])
  p = plan('Sélectionne-moi tous les joueurs du pôle de Fictiville et crée-moi un groupe. Tournoi Fictif.', 'joueurs')
  assert.deepEqual([p.name, p.playersPhrase], ['Tournoi Fictif', 'tous les joueurs du pôle de Fictiville'])
  // Comme avant : sans nom, ou « appelé … ».
  p = plan('Trouve-moi tous les gauchers du Var et crée-moi un groupe avec')
  assert.deepEqual([p.name, p.playersPhrase], [undefined, 'tous les gauchers du Var'])
  p = plan('trouve les gauchers et crée un groupe appelé Gauchers Fictifs')
  assert.equal(p.name, 'Gauchers Fictifs')
  // « Filtrer … dans l'événement X » (liste Événements) : la partie joueurs sans le verbe ; nom coupé par la dictée retrouvé.
  p = plan('Filtrer les joueurs gauchers dans l’événement stage test pays de la loi.', 'evenements')
  assert.deepEqual([p.action, p.target, p.playersPhrase], ['ouvrir_evenement', 'stage test pays de la loi', 'les joueurs gauchers'])
  const ev = [
    { id: 'e1', name: 'Stage test Pays de la Loire' },
    { id: 'e2', name: 'Stage test Pôle Bretagne' },
  ]
  const m = matchName(p.target!, ev)
  assert.ok(m.kind === 'approx' && m.best.id === 'e1', JSON.stringify(m))
  // Toujours pas une action : un filtre de la liste Joueurs.
  assert.equal(detectAction('les gauchers dans l’événement Stage test', 'joueurs'), null)
}

// ---------- 10. Liste Événements : pluriel dit ----------
{
  const names = ['Stage test Pôle Bretagne', 'Stage test Pôle 2011 – Sud', 'Stage test Pays de la Loire', 'Détection test Var 2013']
  const r = readName('stages de test Pôle', names)
  assert.ok('q' in r, JSON.stringify(r))
  const hits = names.filter((x) => textMatch(x, 'q' in r ? r.q : ''))
  assert.deepEqual(hits, ['Stage test Pôle Bretagne', 'Stage test Pôle 2011 – Sud'])
  const geo = { regions: [], depts: [] }
  const er = readEventsRecipe({ noms: ['stages de test Pôle'] }, [], { today: TODAY, names, places: [], creators: [], geo })
  assert.deepEqual(er.notes ?? [], [], 'plus de « aucun événement de ce nom »')
  // Un seul nom au pluriel : retrouvé.
  assert.deepEqual(bestMatch('les détections test Var 2013', names, (x) => [x]), { found: 'Détection test Var 2013' })
  // Recherche tapée « stages » : trouve « Stage … » ; un mot absent : rien.
  assert.equal(textMatch('Stage test Pays de la Loire', 'stages loire'), true)
  assert.equal(textMatch('Stage test Pays de la Loire', 'tournois'), false)
}

console.log('test-recettes-journal-2 : OK')
