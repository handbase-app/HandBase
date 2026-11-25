// Test de « Coller un tableau » de mesures (src/importMesures.ts) : lecture des formats collés (tableau à barres d'une IA,
// tabulations, CSV point-virgule et virgule, texte simple), colonnes reconnues (nom, prénom, numéro, année, date, tests
// d'après leur libellé, accents, abréviations, unités), nombres à la française et unités dans la cellule, rapprochement des
// joueurs (nom approchant, initiales, numéro de maillot, année de naissance), alertes (bornes, unité, doublon, illisible),
// cases cochées d'office et mesures à écrire. Données FICTIVES seulement.
//
//   npx jiti tools/test-import-mesures.ts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  autoChecked,
  convertUnit,
  headerScore,
  identityRole,
  matchPlayer,
  matchTest,
  nameMatchScore,
  parseDate,
  parseNumber,
  parseTable,
  parseYear,
  plausibleRange,
  propose,
  rangeFromThresholds,
  readValue,
  testWords,
  toWrite,
  willSave,
  type Candidate,
  type ImportCriterion,
  type ImportCtx,
} from '../src/importMesures'

let n = 0
const t = (name: string, f: () => void) => {
  f()
  n++
  console.log(`ok - ${name}`)
}

let order = 0
const crit = (id: string, label: string, unit?: string, extra: Partial<ImportCriterion> = {}): ImportCriterion => ({
  id,
  label,
  unit,
  scale: 'number',
  category: 'Tests',
  order: order++,
  kind: 'factual',
  active: true,
  ...extra,
})
// Tests de la démo (libellés et unités de public/demo/criteres-demo.json).
const C: ImportCriterion[] = [
  crit('taille', 'Taille', 'cm'),
  crit('poids', 'Poids', 'kg'),
  crit('detente', 'Détente', undefined, { scale: 'score5' }),
  crit('taille_assise', 'Taille assise', 'cm'),
  crit('envergure', 'Envergure', 'cm'),
  crit('sprint_5', 'Sprint 5 m', 's'),
  crit('sprint_10', 'Sprint 10 m', 's'),
  crit('sprint_30', 'Sprint 30 m', 's'),
  crit('t_test', 'T-Test', 's'),
  crit('vift', '30-15 IFT (VIFT)', 'km/h'),
  crit('vma', 'VMA', 'km/h'),
  crit('saut_bilateral', 'Grand saut bilatéral', 'm'),
  crit('saut_largeur_g', 'Saut à la largeur G', 'm'),
  crit('saut_largeur_d', 'Saut à la largeur D', 'm'),
  crit('medball_conc', 'Méd. ball concentrique', 'm'),
  crit('medball_plio', 'Méd. ball pliométrique', 'm'),
  crit('chaine_post_g', 'Chaîne post. G', undefined, { scale: 'score3' }),
  crit('shirado', 'Shirado (gainage abdos)', 's'),
  crit('cmj_hauteur', 'CMJ – hauteur', 'cm'),
  crit('cmj_bras', 'CMJ bras libres – hauteur', 'cm'),
  crit('cmj_puissance', 'CMJ – puissance relative', 'W/kg'),
  crit('cmj_rsi', 'CMJ – RSI modifié', undefined),
  crit('lateralite', 'Côté fort', undefined, { scale: 'choice', options: ['Gauche', 'Droit'] }),
  crit('ancien', 'Ancien test', 'cm', { active: false }),
  crit('avis', 'Vision du jeu', undefined, { kind: 'subjective', scale: 'score5' }),
]
const byId = (id: string) => C.find((c) => c.id === id)!

// Joueurs FICTIFS.
const P: Candidate[] = [
  { id: 'p1', firstName: 'Lucas', lastName: 'Martin', birthDate: '2011-03-02', num: '7' },
  { id: 'p2', firstName: 'Emma', lastName: 'Lefèvre', birthDate: '2011-07-15', num: '12' },
  { id: 'p3', firstName: 'Noé', lastName: 'Dubois-Garnier', birthDate: '2010-11-30', num: '3' },
  { id: 'p4', firstName: 'Léa', lastName: 'Moreau', birthDate: '2012-01-20' },
  { id: 'p5', firstName: 'Lucas', lastName: 'Moreau', birthDate: '2010-05-05' },
  { id: 'p6', firstName: 'Jean-Pierre', lastName: 'Fontaine', birthDate: '2011-09-09' },
  { id: 'p7', firstName: 'Hugo', lastName: 'Martins', birthDate: '2011-02-02' },
]
const TODAY = '2026-11-05'
const ctx = (extra: Partial<ImportCtx> = {}): ImportCtx => ({ criteria: C, players: P, existing: [], date: TODAY, today: TODAY, ...extra })

// ---------- Formats ----------

t('tableau à barres (Claude, Gemini, ChatGPT) : en-tête, tirets retirés, gras retiré, phrases autour ignorées', () => {
  const md = [
    'Voici le tableau des résultats :',
    '',
    '| Joueur | Sprint 10 m (s) | CMJ (cm) | Taille |',
    '|:-------|---------------:|:-------:|--------|',
    '| **Lucas Martin** | 1,86 | 38 | 1m72 |',
    '| Emma Lefevre | 1,92 | 35,5 | 168 |',
    '',
    'Dis-moi si tu veux autre chose.',
  ].join('\n')
  const p = parseTable(md)
  assert.equal(p.format, 'markdown')
  assert.deepEqual(p.rows[0], ['Joueur', 'Sprint 10 m (s)', 'CMJ (cm)', 'Taille'])
  assert.deepEqual(p.rows[1], ['Lucas Martin', '1,86', '38', '1m72'])
  assert.equal(p.rows.length, 3)
})

t('tabulations (tableau rendu copié, Excel, Google Sheets)', () => {
  const p = parseTable('Nom\tPrénom\tN°\tSprint 30 m\nMARTIN\tLucas\t7\t4,52\nLEFÈVRE\tEmma\t12\t4,61\n')
  assert.equal(p.format, 'tabulations')
  assert.deepEqual(p.rows[2], ['LEFÈVRE', 'Emma', '12', '4,61'])
})

t('CSV point-virgule (tableur français), guillemets', () => {
  const p = parseTable('Nom;Prénom;Date;Poids (kg)\r\n"Martin";"Lucas";05/11/2026;"52,4"\r\nMoreau;Léa;05/11/2026;47\r\n')
  assert.equal(p.format, 'csv-point-virgule')
  assert.deepEqual(p.rows[1], ['Martin', 'Lucas', '05/11/2026', '52,4'])
})

t('CSV virgule (en-tête sans nombre décimal, même nombre de virgules) ; sinon texte simple', () => {
  const p = parseTable('Nom,Prénom,VMA\nMartin,Lucas,"15,5"\nMoreau,Léa,14.5\n')
  assert.equal(p.format, 'csv-virgule')
  assert.deepEqual(p.rows[1], ['Martin', 'Lucas', '15,5'])
  // « 1,86 » ne doit pas être coupé : lignes de texte simple.
  assert.equal(parseTable('Lucas M. 1,86 38\nEmma L. 1,92 35').format, 'texte')
})

t('texte simple : nom puis valeurs, numéro en tête, unités séparées recollées, séparateurs', () => {
  const p = parseTable('Lucas M. 1,86 38\nEmma Lefèvre : 1,92 – 35,5 cm\n')
  assert.equal(p.format, 'texte')
  assert.ok(p.free)
  assert.deepEqual(p.rows, [
    ['Lucas M.', '1,86', '38'],
    ['Emma Lefèvre', '1,92', '35,5 cm'],
  ])
  const q = parseTable('7 Lucas Martin 2011 1,86\n12 Emma L. 2011 1,92')
  assert.deepEqual(q.rows[0], ['7', 'Lucas Martin', '2011', '1,86'])
  assert.deepEqual(q.rows[1], ['12', 'Emma L.', '2011', '1,92'])
})

// ---------- Nombres, unités, dates ----------

t('nombres à la française, unités dans la cellule, 1m86, minutes', () => {
  assert.deepEqual(parseNumber('1,86'), { n: 1.86 })
  assert.deepEqual(parseNumber('1.86'), { n: 1.86 })
  assert.deepEqual(parseNumber('1,86 s'), { n: 1.86, unit: 's' })
  assert.deepEqual(parseNumber('1,86s'), { n: 1.86, unit: 's' })
  assert.deepEqual(parseNumber('186 cm'), { n: 186, unit: 'cm' })
  assert.deepEqual(parseNumber('1m86'), { n: 1.86, unit: 'm' })
  assert.deepEqual(parseNumber('1 m 5'), { n: 1.5, unit: 'm' })
  assert.deepEqual(parseNumber('15,5 km/h'), { n: 15.5, unit: 'km/h' })
  assert.deepEqual(parseNumber("1'52"), { n: 112, unit: 's' })
  assert.deepEqual(parseNumber("52''"), { n: 52, unit: 's' })
  assert.deepEqual(parseNumber('1 234'), { n: 1234 })
  assert.deepEqual(parseNumber('**38**'), { n: 38 })
  assert.equal(parseNumber('1,86 / 1,84'), null)
  assert.equal(parseNumber('Lucas'), null)
  assert.equal(parseNumber('12 pommes'), null)
  assert.equal(convertUnit(186, 'cm', 'm'), 1.86)
  assert.equal(convertUnit(1.86, 'm', 'cm'), 186)
  assert.equal(convertUnit(1860, 'ms', 's'), 1.86)
  assert.equal(convertUnit(2, 'kg', 's'), null)
})

t('dates (JJ/MM/AAAA, AA, points, ISO, mois en lettres, sans année) et années de naissance', () => {
  assert.equal(parseDate('05/11/2026', TODAY), '2026-11-05')
  assert.equal(parseDate('5/11/26', TODAY), '2026-11-05')
  assert.equal(parseDate('05.11.2026', TODAY), '2026-11-05')
  assert.equal(parseDate('2026-11-05', TODAY), '2026-11-05')
  assert.equal(parseDate('3 nov. 2026', TODAY), '2026-11-03')
  assert.equal(parseDate('1er octobre', TODAY), '2026-10-01')
  // Sans année, dans le futur : l'année d'avant.
  assert.equal(parseDate('20/12', TODAY), '2025-12-20')
  assert.equal(parseDate('31/02/2026', TODAY), null)
  assert.equal(parseDate('Lucas', TODAY), null)
  assert.equal(parseYear('2011', TODAY), 2011)
  assert.equal(parseYear('11', TODAY), 2011)
  assert.equal(parseYear('02/03/2011', TODAY), 2011)
})

// ---------- Colonnes ----------

t('en-têtes d’identité : joueur, nom, prénom, numéro, année, date, colonnes à ignorer', () => {
  assert.equal(identityRole('Joueur'), 'joueur')
  assert.equal(identityRole('Nom Prénom'), 'joueur')
  assert.equal(identityRole('NOM'), 'nom')
  assert.equal(identityRole('Prénom'), 'prenom')
  assert.equal(identityRole('N°'), 'maillot')
  assert.equal(identityRole('#'), 'maillot')
  assert.equal(identityRole('Maillot'), 'maillot')
  assert.equal(identityRole('Année de naissance'), 'annee')
  assert.equal(identityRole('Né en'), 'annee')
  assert.equal(identityRole('Date du test'), 'date')
  assert.equal(identityRole('Club'), 'ignore')
  assert.equal(identityRole('Remarques'), 'ignore')
  assert.equal(identityRole('Sprint 10 m'), null)
})

t('en-têtes de tests : accents, abréviations, unités, petites fautes', () => {
  const m = (h: string) => matchTest(h, C.filter((c) => c.active !== false && c.kind !== 'subjective'))?.id
  assert.equal(m('Sprint 10 m (s)'), 'sprint_10')
  assert.equal(m('sprint 10m'), 'sprint_10')
  assert.equal(m('Sprint10'), 'sprint_10')
  assert.equal(m('Sprnt 30 m'), 'sprint_30')
  assert.equal(m('CMJ cm'), 'cmj_hauteur')
  assert.equal(m('CMJ (cm)'), 'cmj_hauteur')
  assert.equal(m('CMJ W/kg'), 'cmj_puissance')
  assert.equal(m('Taille'), 'taille')
  assert.equal(m('TAILLE (cm)'), 'taille')
  assert.equal(m('Taille assise'), 'taille_assise')
  assert.equal(m('Poids kg'), 'poids')
  assert.equal(m('T-test'), 't_test')
  assert.equal(m('VIFT'), 'vift')
  assert.equal(m('30-15'), 'vift')
  assert.equal(m('VMA (km/h)'), 'vma')
  assert.equal(m('Medball conc.'), 'medball_conc')
  assert.equal(m('Médecine-ball pliométrique (m)'), 'medball_plio')
  assert.equal(m('Saut largeur gauche'), 'saut_largeur_g')
  assert.equal(m('Saut largeur D'), 'saut_largeur_d')
  assert.equal(m('Grand saut'), 'saut_bilateral')
  assert.equal(m('Shirado'), 'shirado')
  assert.equal(m('sprint_5'), 'sprint_5')
  assert.equal(m('Vitesse de réaction'), undefined)
  assert.equal(m('10 m'), undefined)
  assert.ok(headerScore('CMJ cm', byId('cmj_hauteur')) > headerScore('CMJ cm', byId('cmj_bras')))
  assert.deepEqual(testWords('Sprint 10 m (s)'), { words: ['sprint', '10'], unit: 's' })
})

t('colonnes d’un tableau sans en-tête (texte simple) : numéro, joueur, année, « Valeur N » à relier', () => {
  const p = propose(parseTable('7 Lucas Martin 2011 1,86 38\n12 Emma L. 2011 1,92 35').rows, ctx(), {}, true)
  assert.equal(p.hasHeader, false)
  assert.deepEqual(
    p.columns.map((c) => [c.header, c.role.k]),
    [
      ['Colonne 1', 'maillot'],
      ['Colonne 2', 'joueur'],
      ['Colonne 3', 'annee'],
      ['Valeur 1', 'inconnue'],
      ['Valeur 2', 'inconnue'],
    ],
  )
  // Aucune valeur tant que les colonnes ne sont pas reliées ; le coach relie « Valeur 1 » au sprint 10 m.
  assert.equal(p.rows[0].values.length, 0)
  const q = propose(parseTable('7 Lucas Martin 2011 1,86 38').rows, ctx(), { columns: { 3: { k: 'test', criterionId: 'sprint_10' }, 4: { k: 'ignore' } } }, true)
  assert.equal(q.columns[3].header, 'Valeur 1')
  assert.equal(q.columns[3].auto, false)
  assert.deepEqual(q.rows[0].values.map((v) => [v.criterionId, v.value]), [['sprint_10', 1.86]])
  assert.equal(q.rows[0].match.playerId, 'p1')
})

t('colonne non reconnue : « inconnue », reliée d’un toucher ; colonne en doute signalée', () => {
  const p = propose([['Joueur', 'Vitesse max', 'Saut'], ['Lucas Martin', '28', '2,3']], ctx())
  assert.equal(p.columns[1].role.k, 'inconnue')
  assert.equal(p.columns[2].role.k, 'test')
  assert.equal(p.columns[2].doubt, true)
})

// ---------- Bornes, unités, alertes de valeur ----------

t('bornes plausibles par test (nom et unité) ; repères de l’installation', () => {
  assert.deepEqual(plausibleRange(byId('taille')), [100, 230])
  assert.deepEqual(plausibleRange(byId('taille_assise')), [50, 120])
  assert.deepEqual(plausibleRange(byId('sprint_10')), [1.2, 3.5])
  assert.deepEqual(plausibleRange(byId('sprint_30')), [3.3, 7.5])
  assert.deepEqual(plausibleRange(byId('cmj_hauteur')), [5, 90])
  assert.deepEqual(plausibleRange(byId('cmj_puissance')), [5, 100])
  assert.deepEqual(plausibleRange(byId('saut_bilateral')), [0.5, 4])
  assert.deepEqual(plausibleRange(byId('vma')), [6, 28])
  assert.deepEqual(plausibleRange(byId('cmj_rsi')), [0.05, 5])
  assert.deepEqual(plausibleRange(byId('taille'), [140, 200]), [140, 200])
  assert.deepEqual(rangeFromThresholds([1.9, 1.8, 1.7]), [0.566667, 5.7])
  assert.equal(rangeFromThresholds([]), undefined)
})

t('valeurs : conversion d’après l’unité écrite, unité probablement fausse (avec conversion), hors bornes, illisible', () => {
  assert.deepEqual(readValue('186', byId('taille')), { value: 186, alerts: [] })
  assert.deepEqual(readValue('1m86', byId('taille')), { value: 186, alerts: [], converted: { from: 1.86, unit: 'm' } })
  // Unité dans l'en-tête de colonne (« Taille (m) ») : 1,86 → 186 cm, sans alerte.
  assert.deepEqual(readValue('1,86', byId('taille'), 'm'), { value: 186, alerts: [], converted: { from: 1.86, unit: 'm' } })
  // Sans unité : 1,86 pour une taille en cm → « 186 cm ? ».
  assert.deepEqual(readValue('1,86', byId('taille')).alerts, [{ k: 'unite', suggestion: 186 }])
  assert.deepEqual(readValue('245', byId('saut_bilateral')).alerts, [{ k: 'unite', suggestion: 2.45 }])
  assert.deepEqual(readValue('0,38', byId('cmj_hauteur')).alerts, [{ k: 'unite', suggestion: 38 }])
  assert.deepEqual(readValue('1860', byId('sprint_10')).alerts, [{ k: 'unite', suggestion: 1.86 }])
  assert.deepEqual(readValue('9,5', byId('sprint_10')).alerts, [{ k: 'bornes', min: 1.2, max: 3.5 }])
  assert.deepEqual(readValue('blessé', byId('sprint_10')), { alerts: [] })
  assert.deepEqual(readValue('-', byId('sprint_10')), { alerts: [] })
  assert.deepEqual(readValue('rapide', byId('sprint_10')), { alerts: [{ k: 'illisible' }] })
  // Notes : entier dans l'échelle ; choix : option (début du mot accepté s'il n'y en a qu'une).
  assert.deepEqual(readValue('4', byId('detente')), { value: 4, alerts: [] })
  assert.deepEqual(readValue('7', byId('detente')).alerts, [{ k: 'bornes', min: 1, max: 5 }])
  assert.deepEqual(readValue('g', byId('lateralite')), { value: 'Gauche', alerts: [] })
  assert.deepEqual(readValue('droite', byId('lateralite')), { alerts: [{ k: 'illisible' }] })
  assert.deepEqual(readValue('Droit', byId('lateralite')), { value: 'Droit', alerts: [] })
})

// ---------- Joueurs ----------

t('noms : ordre libre, majuscules, accents, initiales, nom composé collé, petites fautes', () => {
  assert.ok(nameMatchScore('MARTIN Lucas', P[0]).strong)
  assert.ok(nameMatchScore('lucas martin', P[0]).strong)
  assert.ok(nameMatchScore('Emma Lefevre', P[1]).strong)
  assert.ok(nameMatchScore('Lucas M.', P[0]).strong)
  assert.ok(nameMatchScore('L. Martin', P[0]).strong)
  assert.ok(nameMatchScore('Noé Dubois Garnier', P[2]).strong)
  assert.ok(nameMatchScore('Jeanpierre Fontaine', P[5]).strong)
  const typo = nameMatchScore('Lucas Martine', P[0])
  assert.ok(typo.s > 0.8 && !typo.strong)
  assert.equal(nameMatchScore('Zoé Bernard', P[0]).s, 0)
})

t('rapprochement : sûr, à vérifier (faute, plusieurs possibles, année), introuvable, numéro de maillot', () => {
  assert.deepEqual(matchPlayer({ name: 'Martin Lucas' }, P), { playerId: 'p1', confidence: 'sur', others: [], why: 'nom exact' })
  // Faute de nom : proposé, à vérifier.
  const typo = matchPlayer({ name: 'Emma Lefebre' }, P)
  assert.equal(typo.playerId, 'p2')
  assert.equal(typo.confidence, 'verifier')
  // « Lucas M. » : Lucas Martin ou Lucas Moreau → à vérifier ; l'année départage.
  const two = matchPlayer({ name: 'Lucas M.' }, P)
  assert.equal(two.confidence, 'verifier')
  assert.deepEqual([two.playerId, ...two.others].sort().slice(0, 2), ['p1', 'p5'])
  assert.deepEqual(matchPlayer({ name: 'Lucas M.', year: 2010 }, P).playerId, 'p5')
  assert.equal(matchPlayer({ name: 'Lucas M.', year: 2010 }, P).confidence, 'sur')
  // Année qui ne va pas : à vérifier.
  assert.equal(matchPlayer({ name: 'Emma Lefèvre', year: 2009 }, P).confidence, 'verifier')
  // Numéro de maillot dans l'événement.
  assert.deepEqual(matchPlayer({ name: '', num: '12' }, P), { playerId: 'p2', confidence: 'sur', others: [], why: 'n° 12' })
  assert.equal(matchPlayer({ name: 'Emma L.', num: '12' }, P).confidence, 'sur')
  const clash = matchPlayer({ name: 'Lucas Martin', num: '12' }, P)
  assert.equal(clash.playerId, 'p1')
  assert.equal(clash.confidence, 'verifier')
  assert.equal(matchPlayer({ name: 'Zoé Bernard' }, P).confidence, 'introuvable')
  // Martin / Martins : orthographe exacte, sûr.
  assert.equal(matchPlayer({ name: 'Hugo Martins' }, P).confidence, 'sur')
})

// ---------- Propositions complètes ----------

const MD = [
  '| Nom | Prénom | Sprint 10 m (s) | CMJ (cm) | Taille |',
  '|---|---|---|---|---|',
  '| MARTIN | Lucas | 1,86 | 38 | 172 |',
  '| Lefebre | Emma | 1,92 | 35,5 | 1,68 |',
  '| Bernard | Zoé | 1,99 | 30 | 160 |',
  '| Moreau | Léa | 2,01 | 31 | 158 |',
].join('\n')

t('propositions : joueur, confiance, valeurs, alertes (faute de nom, unité, doublon, introuvable), cases cochées', () => {
  const existing = [{ playerId: 'p4', criterionId: 'sprint_10', date: TODAY, value: 2.03 }]
  const p = propose(parseTable(MD).rows, ctx({ existing }))
  assert.equal(p.hasHeader, true)
  assert.deepEqual(
    p.columns.map((c) => c.role.k === 'test' ? c.role.criterionId : c.role.k),
    ['nom', 'prenom', 'sprint_10', 'cmj_hauteur', 'taille'],
  )
  const [lucas, emma, zoe, lea] = p.rows
  assert.equal(lucas.match.playerId, 'p1')
  assert.equal(lucas.match.confidence, 'sur')
  assert.deepEqual(lucas.values.map((v) => [v.criterionId, v.value, v.alerts.length]), [['sprint_10', 1.86, 0], ['cmj_hauteur', 38, 0], ['taille', 172, 0]])
  assert.ok(autoChecked(lucas))
  // Faute de nom + taille en mètres.
  assert.equal(emma.match.playerId, 'p2')
  assert.equal(emma.match.confidence, 'verifier')
  assert.deepEqual(emma.values[2].alerts, [{ k: 'unite', suggestion: 168 }])
  assert.ok(!autoChecked(emma))
  // Introuvable.
  assert.equal(zoe.match.confidence, 'introuvable')
  assert.equal(zoe.match.playerId, undefined)
  assert.ok(!autoChecked(zoe))
  // Doublon en base (même joueur, même test, même date) : pas ajouté d'office.
  assert.deepEqual(lea.values[0].alerts, [{ k: 'doublon', existing: 2.03 }])
  assert.ok(!willSave(lea.values[0]))
  assert.ok(willSave(lea.values[0], 'keep'))
  // Le doublon n'est pas importé d'office : il ne bloque pas la ligne (ses autres valeurs le sont).
  assert.ok(autoChecked(lea))
  assert.deepEqual(toWrite(p, (r) => autoChecked(r)).filter((m) => m.playerId === 'p4').map((m) => m.criterionId), ['cmj_hauteur', 'taille'])
  // Ajouté quand même : importé avec la ligne.
  assert.deepEqual(toWrite(p, (r) => autoChecked(r), { [`${lea.line}:2`]: 'keep' }).filter((m) => m.playerId === 'p4').length, 3)
  // Une ligne faite seulement de doublons n'a rien à importer : pas cochée.
  const only = propose([['Joueur', 'Sprint 10 m'], ['Léa Moreau', '2,01']], ctx({ existing })).rows[0]
  assert.ok(!autoChecked(only))
})

t('choix du coach : valeur corrigée (conversion proposée), autre joueur choisi, ligne laissée de côté', () => {
  const rows = parseTable(MD).rows
  const p = propose(rows, ctx(), { values: { '1:4': '168' }, players: { 1: 'p2', 2: '' } })
  const [, emma, zoe] = p.rows
  assert.equal(emma.match.confidence, 'sur')
  assert.equal(emma.match.why, 'choisi')
  assert.deepEqual(emma.values[2], { col: 4, criterionId: 'taille', raw: '168', value: 168, alerts: [], converted: undefined, edited: true })
  assert.ok(autoChecked(emma))
  assert.equal(zoe.match.playerId, undefined)
  // Mesures à écrire : lignes cochées seulement.
  const w = toWrite(p, (r) => autoChecked(r))
  assert.equal(w.length, 9) // Lucas, Emma, Léa : 3 tests chacun ; Zoé laissée de côté
  assert.deepEqual(w[0], { playerId: 'p1', criterionId: 'sprint_10', value: 1.86, date: TODAY })
  assert.ok(w.every((m) => m.date === TODAY))
})

t('colonne date du tableau : elle l’emporte sur la date choisie ; date illisible signalée', () => {
  const p = propose(parseTable('Nom;Prénom;Date;Poids\nMartin;Lucas;03/11/2026;52,4\nMoreau;Léa;hier;47').rows, ctx())
  assert.equal(p.rows[0].date, '2026-11-03')
  assert.ok(p.rows[0].dateFromTable)
  assert.equal(p.rows[1].date, TODAY)
  assert.equal(p.rows[1].badDate, 'hier')
  assert.ok(!autoChecked(p.rows[1]))
})

t('doublon dans le tableau même (deux fois le même joueur) : à vérifier', () => {
  const p = propose(parseTable('Joueur\tPoids\nLucas Martin\t52\nMARTIN Lucas\t53').rows, ctx())
  assert.equal(p.rows[0].match.confidence, 'verifier')
  assert.equal(p.rows[1].match.confidence, 'verifier')
  assert.deepEqual(p.rows[1].values[0].alerts, [{ k: 'doublon', inPaste: true }])
})

t('numéros de maillot de l’événement et texte simple de bout en bout', () => {
  const p = propose(parseTable('Maillot;Sprint 30 m\n7;4,52\n12;4,61\n99;4,7').rows, ctx())
  assert.deepEqual(p.rows.map((r) => [r.match.playerId, r.match.confidence]), [['p1', 'sur'], ['p2', 'sur'], [undefined, 'introuvable']])
  const f = parseTable('Lucas Martin 1m72\nEmma Lefèvre 168 cm')
  const q = propose(f.rows, ctx(), { columns: { 1: { k: 'test', criterionId: 'taille' } } }, f.free)
  assert.deepEqual(q.rows.map((r) => [r.match.playerId, r.values[0].value]), [['p1', 172], ['p2', 168]])
})

t('tests inactifs ou subjectifs : jamais proposés ; lignes sans nom ni valeur ignorées', () => {
  const p = propose([['Joueur', 'Ancien test', 'Vision du jeu'], ['Lucas Martin', '12', '4'], ['', '', '']], ctx())
  assert.ok(p.columns.slice(1).every((c) => c.role.k !== 'test'))
  assert.equal(p.rows.length, 1)
})

t('aucune IA ni réseau : le module ne fait aucun appel (fichier pur)', () => {
  const src = readFileSync(new URL('../src/importMesures.ts', import.meta.url), 'utf8')
  assert.ok(!/fetch\(|supabase|transcrire|mistral|gemini\s*\(/i.test(src.replace(/\/\/.*|\/\*[\s\S]*?\*\//g, '')))
})

console.log(`\n${n} tests passés`)
