// Test du contenu du volley (phase 2) : critères et tests (public/demo/criteres-volley.json, lu par le vrai importeur),
// grille de chaque poste, échelle 1 à 5 et ses repères, sens des tests, profil physique et maturité, pastilles du
// séquenceur et filtre par geste, vocabulaire de dictée, démonstration fictive (src/demoVolley.ts), consignes de la
// fonction « transcrire » selon le sport (supabase/functions/transcrire/sport.ts : volley, handball inchangé) et champ
// « sport » envoyé par l'appli. Données fictives seulement ; faux fetch, aucun appel réseau.
//
//   npx jiti tools/test-volley-contenu.ts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parseRows, rowsFromJson } from '../src/criteriaFormat'
import { applySportConfig, isKeeper, LIBERO, proposedOnly, resolveSportConfig, VOLLEYBALL, type ConfigRow } from '../src/sportConfig'
import { criterionApplies, type Criterion, type Measurement } from '../src/db'
import { scoreLegend, sportContent } from '../src/sportContent'
import { measureDirection } from '../src/compare'
import { categoryKind } from '../src/radarZones'
import { buildAvisPayload, understandAvis } from '../src/dictation/avis'
import { pillLabel } from '../src/seqPills'
import { CATS, catOf, catsFor, countLabel, momentKind, parseFilter, presentCats, SHOW_ALL, toggleCat, visibleMoments, VOLLEY_CATS } from '../src/actionFilter'
import { VOLLEY_KINDS, VOLLEY_SKILLS, volleyMomentKind, volleyNote } from '../src/volleyActions'
import { dictationVocabulary, motsVoxtralVolley } from '../src/dictation/vocabulary'
import { correct } from '../src/dictation/clean'
import { sportField, understandAction, understandFilters, understandQuestion, understandSql, type Endpoint } from '../src/dictation/transcribe'
import { consignesDuSport, remplacements, sportDe, VOLLEY, type NomConsignes } from '../supabase/functions/transcrire/sport.ts'
import { buildVolleyDemo, CAT_YEARS, GRID_CHAMP, GRID_MENTAL, GRID_PASSEUR, QUICK, RANGES, SESSIONS, TESTS } from '../src/demoVolley'
import { snapshots } from '../src/maturitySnapshot'
import { applyAnswer, buildSchema, EMPTY_FILTERS, type SearchContext } from '../src/voiceSearch'
import { interpretRecipe, type QCriterion, type QuestionContext } from '../src/recipe'
import { parsePlan } from '../src/askAction'
import { guardSql } from '../src/sqlGuard'
import { routeAsk } from '../src/demander'

let n = 0
const t = async (name: string, f: () => void | Promise<void>) => {
  await f()
  n++
  console.log(`ok ${n} - ${name}`)
}
const volley = () => applySportConfig(resolveSportConfig([], 'volley'))
const handball = () => applySportConfig(resolveSportConfig([], 'handball'))
const withoutLibero = () => applySportConfig(resolveSportConfig([{ id: 'postes', key: 'postes', value: VOLLEYBALL.positions.filter((p) => p.code !== 'L') } as ConfigRow], 'volley'))
const withLibero = () => applySportConfig(resolveSportConfig([{ id: 'postes', key: 'postes', value: [...VOLLEYBALL.positions, LIBERO] } as ConfigRow], 'volley'))

const file = readFileSync(new URL('../public/demo/criteres-volley.json', import.meta.url), 'utf8')
const json = JSON.parse(file) as { format: string; version: number; criteria: Record<string, unknown>[] }

// ---------- 1. Critères : le vrai importeur ----------

volley()
const parsed = parseRows(rowsFromJson(file))
const criteria: Criterion[] = parsed.rows.map(({ c }) => ({ ...c, updatedAt: 0 }) as Criterion)
const byId = new Map(criteria.map((c) => [c.id, c]))

await t('fichier au format des critères (handbase-criteres), importé sans erreur avec les postes du volley', () => {
  assert.equal(json.format, 'handbase-criteres')
  assert.equal(json.version, 1)
  assert.deepEqual(parsed.errors, [])
  assert.equal(parsed.rows.length, json.criteria.length)
  assert.equal(criteria.length, 43)
  assert.equal(new Set(criteria.map((c) => c.id)).size, criteria.length, 'identifiants uniques')
  // Même forme que le fichier du handball : clés dans l'ordre des colonnes de l'export.
  const keys = ['id', 'category', 'label', 'kind', 'scale', 'unit', 'options', 'description', 'positions', 'quick', 'active', 'order']
  for (const c of json.criteria) assert.deepEqual(Object.keys(c), keys.filter((k) => k in c), String(c.id))
  // Libéro (poste facultatif) : ses critères s'importent aussi quand il est ajouté.
  withLibero()
  assert.deepEqual(parseRows(rowsFromJson(file)).errors, [])
  volley()
})

await t('tests : unités, catégories, identifiants de la maturité (taille, poids, taille_assise)', () => {
  const tests = criteria.filter((c) => c.kind === 'factual')
  assert.deepEqual(
    tests.map((c) => [c.id, c.unit, c.category]),
    [
      ['taille', 'cm', 'Gabarit'],
      ['poids', 'kg', 'Gabarit'],
      ['taille_assise', 'cm', 'Mensurations'],
      ['envergure', 'cm', 'Mensurations'],
      ['atteinte', 'cm', 'Mensurations'],
      ['hauteur_attaque', 'cm', 'Détente'],
      ['hauteur_contre', 'cm', 'Détente'],
      ['cmj_hauteur', 'cm', 'Détente'],
      ['t_test', 's', 'Vitesse et puissance'],
      ['medecine_ball', 'm', 'Vitesse et puissance'],
    ],
  )
  assert.ok(tests.every((c) => c.scale === 'number' && !c.positions && c.description))
  assert.deepEqual(TESTS, tests.map((c) => c.id), 'la démo mesure les 10 tests')
  // Fiche joueur : « Gabarit » (taille, poids) dans l'en-tête, les autres catégories en tests.
  assert.deepEqual(tests.filter((c) => c.category === 'Gabarit').map((c) => c.id), ['taille', 'poids'])
})

await t('sens des tests : T-test plus petit = meilleur ; sauts, attaque, contre, médecine-ball plus grand ; gabarit sans « meilleur »', () => {
  const dir = Object.fromEntries(criteria.filter((c) => c.kind === 'factual').map((c) => [c.id, measureDirection(c)]))
  assert.deepEqual(dir, { taille: 0, poids: 0, taille_assise: 0, envergure: 0, atteinte: 0, hauteur_attaque: 1, hauteur_contre: 1, cmj_hauteur: 1, t_test: -1, medecine_ball: 1 })
  // Handball : ses tests gardent leur sens (la liste du volley ne s'applique pas).
  handball()
  assert.equal(measureDirection({ id: 'hauteur_attaque', scale: 'number', unit: 'cm' } as Criterion), 0)
  assert.equal(measureDirection({ id: 'sprint_10', scale: 'number', unit: 's' } as Criterion), -1)
  volley()
})

await t('profil physique de la fiche : gabarit, mensurations et détente (8 mesures) ; handball inchangé', () => {
  const profile = criteria.filter((c) => c.kind === 'factual' && sportContent().profileCategories.includes(c.category)).map((c) => c.id)
  assert.deepEqual(profile, ['taille', 'poids', 'taille_assise', 'envergure', 'atteinte', 'hauteur_attaque', 'hauteur_contre', 'cmj_hauteur'])
  assert.deepEqual(sportContent('handball').profileCategories, ['Gabarit', 'Critères physiologiques'])
  assert.equal(sportContent('handball').profileSummary, 'Taille, poids, explosivité, puissance, vitesse, détente, tir')
})

// ---------- 2. Grilles par poste ----------

const subjective = criteria.filter((c) => c.kind === 'subjective')
const gridOf = (pos?: string) => [...new Set(subjective.filter((c) => criterionApplies(c, pos)).map((c) => c.category))]
const countOf = (pos: string) => subjective.filter((c) => criterionApplies(c, pos)).length

await t('chaque poste a sa grille : Passeur (P), Joueur de champ (R4, C, PT), Libéro (L), et le bloc mental pour tous', () => {
  assert.deepEqual(gridOf('P'), ['Passeur', 'Mental et comportement'])
  for (const p of ['R4', 'C', 'PT']) assert.deepEqual(gridOf(p), ['Joueur de champ', 'Mental et comportement'], p)
  assert.equal(countOf('P'), 9 + 6)
  assert.equal(countOf('R4'), 10 + 6)
  // Libéro dans les postes par défaut (31/10) ; une installation qui l'a retiré : ses critères ne s'affichent pour personne,
  // pas même un joueur sans poste.
  assert.equal(isKeeper('L'), true)
  assert.equal(proposedOnly('L'), false)
  withoutLibero()
  assert.equal(proposedOnly('L'), true)
  assert.deepEqual(gridOf(undefined), ['Joueur de champ', 'Passeur', 'Mental et comportement'])
  withLibero()
  assert.equal(proposedOnly('L'), false)
  assert.deepEqual(gridOf('L'), ['Libéro', 'Mental et comportement'])
  assert.equal(countOf('L'), 8 + 6)
  volley()
  // Grilles du volley, dans l'ordre (libellés courts).
  const labels = (cat: string) => subjective.filter((c) => c.category === cat).map((c) => c.label)
  assert.deepEqual(labels('Joueur de champ'), ['Service', 'Réception', 'Attaque', 'Contre', 'Défense', 'Déplacements', 'Lecture du jeu', 'Jeu sans ballon', 'Engagement', 'Communication et attitude'])
  assert.deepEqual(labels('Passeur'), [
    'Précision de la passe', 'Vitesse vers le ballon', 'Technique à deux mains', 'Distribution et choix', 'Jeu rapide avec le central',
    'Passe arrière et en suspension', 'Attaque du passeur et 2e main', 'Contre et défense du passeur', 'Leadership',
  ])
  assert.deepEqual(labels('Libéro'), ['Réception flottant', 'Réception sauté', 'Défense', 'Plongeons et récupérations', 'Couverture', 'Passe haute derrière les 3 m', 'Lecture et anticipation', 'Animation et communication'])
  assert.deepEqual(labels('Mental et comportement'), ['Concentration', 'Persévérance', 'Réaction après l’erreur', 'Esprit d’équipe', 'Écoute des consignes', 'Autonomie'])
  assert.ok(subjective.every((c) => c.scale === 'score5'), 'toutes notées de 1 à 5')
  // Mode rapide : quelques critères par grille (les mêmes que la démo).
  assert.deepEqual(new Set(subjective.filter((c) => c.quick && !c.positions?.includes('L')).map((c) => c.id)), QUICK)
  // Radar : le libéro dans la famille du gardien (exclu des moyennes des autres postes), le mental en haut.
  assert.equal(categoryKind('Libéro'), 'gardien')
  assert.equal(categoryKind('Mental et comportement'), 'mental')
  assert.equal(categoryKind('Joueur de champ'), 'autre')
})

await t('échelle 1 à 5 : les repères positifs du volley à l’écran de notation et pour l’avis vocal ; handball inchangé', () => {
  assert.equal(scoreLegend('volley'), '1 = En découverte · 2 = En construction · 3 = Acquis · 4 = Point fort · 5 = Remarquable')
  assert.equal(scoreLegend('handball'), '1 = très insuffisant · 3 = niveau attendu · 5 = remarquable')
  const p = buildAvisPayload(criteria, 'R4')
  assert.equal(p.criteres.length, 16)
  assert.deepEqual(p.criteres[0].echelle, { min: 1, max: 5, libelles: { '1': 'En découverte', '2': 'En construction', '3': 'Acquis', '4': 'Point fort', '5': 'Remarquable' } })
  // Aucun mot négatif sur le joueur (« le contre adverse le plus faible » : l'adversaire, tactique de distribution).
  assert.ok(!/insuffisant|mauvais|faible|\bnul/i.test(JSON.stringify(subjective).replace('contre adverse le plus faible', '')), 'aucun mot négatif')
})

// ---------- 3. Séquenceur : pastilles et filtre par geste ----------

await t('pastilles : 6 gestes × (réussi, neutre, à retravailler) et le geste seul', () => {
  assert.deepEqual(VOLLEY_SKILLS.map((s) => s.id), ['service', 'reception', 'passe', 'attaque', 'contre', 'defense'])
  assert.equal(VOLLEY_KINDS.length, 24)
  assert.deepEqual(pillLabel('attaque_reussi'), { short: 'ATTAQUE +', long: 'Attaque réussie', glyph: 'shot' })
  assert.deepEqual(pillLabel('service_neutre'), { short: 'SERVICE', long: 'Service neutre', glyph: 'ball' })
  assert.deepEqual(pillLabel('reception_retravailler'), { short: 'RÉCEP. ↻', long: 'Réception à retravailler', glyph: 'platform' })
  assert.equal(pillLabel('contre_reussi').long, 'Contre réussi')
  assert.equal(pillLabel('contre_reussi').glyph, 'block')
  for (const k of VOLLEY_KINDS) assert.ok(pillLabel(k).short.length <= 9 && pillLabel(k).long, k)
  // Mots positifs ou neutres.
  assert.ok(!VOLLEY_KINDS.some((k) => /rat|faute|mauvais|échec|perdu/i.test(pillLabel(k).long)))
  assert.equal(volleyNote('defense', 'retravailler'), 'Défense à retravailler')
  assert.equal(volleyNote('service', 'reussi'), 'Service réussi')
})

await t('filtre : une pastille par geste (résultats regroupés), type d’un moment lu dans sa note', () => {
  assert.deepEqual(VOLLEY_CATS.map((c) => c.label.short), ['SERVICE', 'RÉCEPTION', 'PASSE', 'ATTAQUE', 'CONTRE', 'DÉFENSE', 'AUTRE'])
  assert.equal(catsFor(), VOLLEY_CATS)
  assert.equal(catOf('attaque_retravailler'), 'attaque')
  assert.equal(catOf('attaque'), 'attaque')
  assert.equal(catOf('but'), 'autre', 'une action du handball : autre')
  const notes = ['Attaque réussie · zone 4', 'Réception neutre', 'Service flottant réussi', 'Bloc neutre', 'Défense à retravailler', 'Passe haute réussie · n° 7', 'Attaque zone 2', 'Temps fort', 'But 2-1 · feuille']
  assert.deepEqual(notes.map((note) => momentKind({ note })), ['attaque_reussi', 'reception_neutre', 'service_reussi', 'contre_neutre', 'defense_retravailler', 'passe_reussi', 'attaque', 'autre', 'autre'])
  assert.equal(volleyMomentKind('RÉCEPTION à retravailler'), 'reception_retravailler', 'sans accents ni majuscules')
  const present = presentCats(notes.map((note) => momentKind({ note })))
  assert.deepEqual(present.map((p) => `${p.cat.label.short} ${p.n}`), ['SERVICE 1', 'RÉCEPTION 1', 'PASSE 1', 'ATTAQUE 2', 'CONTRE 1', 'DÉFENSE 1', 'AUTRE 2'])
  // Choix mémorisé : gestes du volley reconnus, types inconnus ignorés.
  assert.deepEqual(parseFilter('{"hide":["contre","but","7m"],"sides":[]}'), { hide: ['contre'], sides: [] })
  const onlyAttack = toggleCat({ hide: present.map((p) => p.cat.id), sides: [] }, 'attaque')
  assert.equal(countLabel(1, 2, onlyAttack, present.map((p) => p.cat.id)), '1/2 attaques')
  const ms = notes.map((note, i) => ({ at: i * 3, note }))
  assert.deepEqual(visibleMoments(ms, onlyAttack), [0, 6])
  assert.deepEqual(visibleMoments(ms, SHOW_ALL).length, ms.length)
  // Handball : catégories et lecture des notes inchangées.
  handball()
  assert.equal(catsFor(), CATS)
  assert.equal(momentKind({ note: 'Attaque réussie' }), 'autre')
  assert.equal(momentKind({ note: 'But 7m 3-2 · feuille' }), 'but7')
  assert.equal(catOf('passe'), 'passe')
  assert.equal(CATS.find((c) => c.id === 'passe')!.label.long, 'Passe décisive')
  assert.equal(pillLabel('passe').long, 'Passe décisive')
  volley()
  assert.equal(pillLabel('passe').long, 'Passe', 'volley : la passe du passeur')
})

// ---------- 4. Dictée ----------

await t('dictée : mots du volley (100 au plus, acceptés par la fonction), corrections prudentes, aucun mot du handball', () => {
  assert.ok(motsVoxtralVolley.length <= 100)
  assert.equal(new Set(motsVoxtralVolley).size, motsVoxtralVolley.length, 'sans doublon')
  assert.ok(motsVoxtralVolley.every((m) => m.length <= 40 && /^[\p{L}\p{N} '’+\-_]+$/u.test(m)), 'mots acceptés par la fonction')
  for (const m of ['passeur', 'réceptionneur-attaquant', 'pointu', 'central', 'libéro', 'manchette', 'service flottant', 'service smashé', 'Volleyades', 'Interpôles', 'CRE', 'CDE', "hauteur d'attaque"]) assert.ok(motsVoxtralVolley.includes(m), m)
  for (const m of ['smash', 'dig', 'pivot', 'gardien', 'demi-centre', 'Intercomités']) assert.ok(!motsVoxtralVolley.includes(m), m)
  assert.deepEqual(dictationVocabulary('volley').mots, motsVoxtralVolley)
  const fix = (s: string) => correct(s, 'volley').texte
  assert.equal(fix('le libero en zone quatre'), 'le libéro en zone 4')
  assert.equal(fix('une bonne manchete'), 'une bonne manchette')
  assert.equal(fix('aux volley ades M 15 puis aux inter pôles'), 'aux Volleyades M15 puis aux Interpôles')
  assert.equal(fix('le R 4 et le T test'), 'le R4 et le T-test')
  assert.equal(fix('il mesure 1 m 15 de plus'), 'il mesure 1 m 15 de plus', '« 1 m 15 » n’est pas une catégorie')
  assert.equal(fix('une roue coulette'), 'une roue coulette', 'aucune correction du handball')
})

// ---------- 5. Démonstration ----------

const now = Date.parse('2026-10-21T10:00:00Z')
const demo = buildVolleyDemo(now, 'moi')

await t('démo : 40 joueuses et joueurs fictifs, M13 à M18, les 4 postes, filles majoritaires', () => {
  const { players } = demo
  assert.equal(players.length, 40)
  assert.equal(players.filter((p) => p.sex === 'F').length, 23)
  assert.ok(players.every((p) => p.id.startsWith('demo-')))
  for (const p of players) assert.ok(CAT_YEARS[p.category as 'M13'].includes(Number(p.birthDate!.slice(0, 4))), `${p.id} : ${p.category} ${p.birthDate}`)
  assert.deepEqual([...new Set(players.map((p) => p.position))].sort(), ['C', 'P', 'PT', 'R4'])
  assert.deepEqual([...new Set(players.map((p) => p.category))], ['M13', 'M15', 'M18'])
  assert.equal(new Set(players.map((p) => `${p.firstName} ${p.lastName}`)).size, 40, 'noms tous différents')
  assert.ok(players.every((p) => p.department && p.club && !p.license), 'département et club, aucune licence')
  assert.ok(!/hand|gardien|pivot|Intercomit/i.test(JSON.stringify(demo)), 'rien du handball')
  assert.ok(!/pas retenu|insuffisant|mauvais|nul\b|faible/i.test(JSON.stringify(demo)), 'rien de négatif')
  // Déterministe : même jeu à chaque chargement.
  assert.deepEqual(buildVolleyDemo(now, 'moi'), demo)
})

await t('démo : mesures dans les fourchettes de jeunes repérés (dernière séance), cohérentes et suivies dans le temps', () => {
  for (const p of demo.players) {
    const ms = demo.measurements.filter((m) => m.playerId === p.id)
    const last = (id: string) => ms.filter((m) => m.criterionId === id && m.date === SESSIONS[2])[0]?.value as number
    const R = RANGES[p.sex!][p.category as 'M13']
    const within = (v: number, [a, b]: readonly [number, number], what: string) => assert.ok(v >= Math.min(a, b) - 0.01 && v <= Math.max(a, b) + 0.01, `${p.id} ${what} ${v} hors [${a}, ${b}]`)
    within(last('taille'), R.taille, 'taille')
    within(last('taille_assise'), R.assise, 'taille assise')
    within(last('poids'), R.poids, 'poids')
    within(last('atteinte'), R.atteinte, 'atteinte')
    within(last('hauteur_attaque'), R.attaque, 'attaque')
    within(last('hauteur_contre'), R.contre, 'contre')
    within(last('cmj_hauteur'), R.cmj, 'CMJ')
    within(last('t_test'), R.ttest, 'T-test')
    within(last('medecine_ball'), R.mb, 'médecine-ball')
    assert.ok(last('hauteur_attaque') > last('atteinte') && last('hauteur_contre') < last('hauteur_attaque'), p.id)
    const env = last('envergure') - last('taille')
    assert.ok(env >= (p.sex === 'F' ? -2.6 : -0.6) && env <= 8.6, `${p.id} envergure − taille ${env}`)
    // Taille, poids et taille assise le même jour à chaque séance (maturité) ; M13 : 2 séances, sinon 3.
    const dates = [...new Set(ms.map((m) => m.date))].sort()
    assert.equal(dates.length, p.category === 'M13' ? 2 : 3)
    for (const d of dates) for (const id of TESTS) assert.ok(ms.some((m) => m.date === d && m.criterionId === id), `${p.id} ${d} ${id}`)
    // Elle ou il grandit.
    const heights = dates.map((d) => ms.find((m) => m.date === d && m.criterionId === 'taille')!.value as number)
    assert.deepEqual([...heights].sort((a, b) => a - b), heights, p.id)
  }
  // Toutes les mesures portent sur un test du fichier.
  assert.ok(demo.measurements.every((m) => byId.get(m.criterionId)?.kind === 'factual'))
})

await t('démo : maturité et taille adulte prédite calculées avec taille, poids et taille assise', () => {
  for (const p of demo.players) {
    const snaps = snapshots(p, demo.measurements.filter((m) => m.playerId === p.id) as Measurement[])
    assert.ok(snaps.length >= 2, p.id)
    for (const s of snaps) {
      assert.ok(s.sitting !== undefined && s.weight !== undefined, `${p.id} : même jour`)
      assert.ok(s.mirwald !== null, `${p.id} : Mirwald`)
    }
    const last = snaps.at(-1)!
    if (last.age < 17.5) {
      assert.ok(last.kr, `${p.id} : Khamis-Roche (${last.age.toFixed(1)} ans)`)
      const [lo, hi] = p.sex === 'F' ? [160, 200] : [172, 215]
      assert.ok(last.kr.predicted > lo && last.kr.predicted < hi, `${p.id} : taille adulte prédite ${last.kr.predicted}`)
      assert.ok(last.kr.pah > 80 && last.kr.pah <= 100, `${p.id} : ${last.kr.pah} % de la taille adulte`)
    }
  }
})

await t('démo : événements de la filière, pôle et sélection, avis sur les grilles du poste', () => {
  assert.deepEqual(demo.events.map((e) => e.name), [
    'Interpôles Sud',
    'Stage CRE de Pâques',
    'Volleyades M15',
    'Journée de détection départementale M13',
    'Tournoi des sélections départementales M13',
    'Stage CDE',
  ])
  assert.deepEqual(demo.groups.map((g) => g.name), ['Pôle Espoirs fictif', 'Sélection régionale M15 garçons', 'Repérés au TSD M13'])
  const pole = demo.groups[0]
  assert.ok(pole.playerIds.length >= 6 && pole.playerIds.every((id) => demo.players.find((p) => p.id === id)?.sex === 'F'))
  const tsd = demo.events[4]
  assert.deepEqual(tsd.tournament!.teams.map((x) => x.name), ['Sélection Rhône', 'Sélection Loire', 'Sélection Isère', 'Sélection Ain'])
  assert.ok(tsd.playerIds!.every((id) => tsd.tournament!.players![id]?.team), 'chaque joueur dans la sélection de son comité')
  assert.ok(demo.evaluations.length >= 60)
  for (const e of demo.evaluations) {
    const p = demo.players.find((x) => x.id === e.playerId)!
    for (const [id, v] of Object.entries(e.scores)) {
      const c = byId.get(id)
      assert.ok(c && c.kind === 'subjective', id)
      assert.ok(criterionApplies(c, p.position), `${e.id} : ${id} pour ${p.position}`)
      assert.ok(Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 5)
    }
    if (e.eventId) assert.ok(demo.events.some((ev) => ev.id === e.eventId))
  }
  for (const id of [...GRID_CHAMP, ...GRID_PASSEUR, ...GRID_MENTAL]) assert.ok(byId.has(id), id)
  // Vidéos : moments lus comme des gestes (pastilles du séquenceur).
  const v = demo.videos.find((x) => x.moments && x.moments.length > 3)!
  assert.deepEqual(presentCats(v.moments!.map(momentKind)).map((p) => `${p.cat.label.short} ${p.n}`), ['SERVICE 1', 'RÉCEPTION 1', 'ATTAQUE 2', 'CONTRE 1', 'DÉFENSE 1'])
})

// ---------- 6. Consignes de la fonction « transcrire » ----------

const fn = readFileSync(new URL('../supabase/functions/transcrire/index.ts', import.meta.url), 'utf8')
const between = (from: string, to = '`') => {
  const i = fn.indexOf(from)
  assert.ok(i >= 0, from)
  return fn.slice(i + from.length, fn.indexOf(to, i + from.length))
}
const ACTIONS_COMMUNES = between('const ACTIONS_COMMUNES = `')
const LISTE = between('const CONSIGNES_LISTE = (quoi: string) => `')
const resolve = (s: string) =>
  s.replace(/\$\{ACTIONS_COMMUNES\}/g, ACTIONS_COMMUNES).replace(/\$\{CONSIGNES_LISTE\('([^']*)'\)\}/g, (_m, quoi: string) => LISTE.replace('${quoi}', quoi))
/** Consignes du handball telles qu'envoyées (interpolations résolues). */
const HANDBALL: Record<NomConsignes, string> = {
  filtres: between('const CONSIGNES = `'),
  bilan: resolve(between('  bilan: `', '`,')),
  evenements: resolve(between('  evenements: `', '`,')),
  groupes: resolve(between('  groupes: `', '`,')),
  avis: between('const CONSIGNES_AVIS = `'),
  question: between('const CONSIGNES_QUESTION = `'),
  joueurs: between('const CONSIGNES_JOUEURS = `'),
  contexte_evenements: resolve(between('const CONSIGNES_EVENEMENTS = `')),
  contexte_groupes: resolve(between('const CONSIGNES_GROUPES = `')),
  sql: between('const CONSIGNES_SQL = `'),
  action: between('const CONSIGNES_ACTION = `'),
}
const noms = Object.keys(HANDBALL) as NomConsignes[]
const V = Object.fromEntries(noms.map((k) => [k, consignesDuSport(HANDBALL[k], k, 'volley')])) as Record<NomConsignes, string>

await t('sport de la requête : volley reconnu, sinon handball', () => {
  assert.equal(sportDe('volley'), 'volley')
  assert.equal(sportDe(' Volley-Ball '), 'volley')
  for (const x of [undefined, '', 'handball', 'basket', 42, null]) assert.equal(sportDe(x), 'handball', String(x))
})

await t('handball (champ absent, handball ou inconnu) : consignes identiques, octet pour octet', () => {
  for (const k of noms) assert.equal(consignesDuSport(HANDBALL[k], k, sportDe(undefined)), HANDBALL[k], k)
  assert.deepEqual(remplacements('question', 'handball'), [])
  // index.ts : chaque consigne passe par consignesDuSport avec le sport de la requête.
  for (const s of ["consignesDuSport(consignesPage, nomPage, sportDe(entree.sport))", "consignesDuSport(CONSIGNES_AVIS, 'avis', sportDe(entree.sport))", "consignesDuSport(CONSIGNES_QUESTION, 'question', sport)", "consignesDuSport(CONSIGNES_JOUEURS, 'joueurs', sport)", "consignesDuSport(CONSIGNES_SQL, 'sql', sportDe(entree.sport))", "consignesDuSport(CONSIGNES_ACTION, 'action', sportDe(entree.sport))", "import { consignesDuSport, sportDe, type NomConsignes } from './sport.ts'"])
    assert.ok(fn.includes(s), s)
})

await t('volley : chaque remplacement trouve son texte du handball (consigne modifiée sans mettre sport.ts à jour : échec)', () => {
  for (const k of noms) for (const [de] of VOLLEY[k]) assert.ok(HANDBALL[k].includes(de), `${k} : « ${de.slice(0, 70)}… » introuvable`)
  assert.ok(noms.some((k) => HANDBALL[k].includes('entraîneur de handball')))
  assert.ok(HANDBALL.contexte_groupes.includes('appli de détection de handball'))
})

await t('volley : « entraîneur de volley », plus aucun mot ni poste du handball', () => {
  for (const k of noms) {
    const s = V[k]
    if (k !== 'joueurs') assert.ok(/entraîneur de volley|détection de volley/.test(s), k)
    for (const re of [/handball/i, /gardien/i, /pivot/i, /demi-centre/i, /Intercomit/i, /\bGB\b/, /\bPIV\b/, /"DC"/, /\bU1\d\b/, /feuille de match/, /buts marqués/, /\b[Tt]ir\b/, /Prise d'information/, /[Rr]epli/, /Intelligence de jeu/, /au sprint/, /CMJ – hauteur/, /très insuffisant/])
      assert.ok(!re.test(s), `${k} : ${re} — ${s.match(re)?.[0]}`)
  }
  assert.ok(V.filtres.includes('« montre-moi les centraux du Pôle »'))
  assert.ok(V.question.includes('"postes":["C"]'))
  assert.ok(V.action.includes('« passeurs » → postes ["P"]'))
  assert.ok(V.avis.includes('c1 Attaque (1-5)'))
})

// Contextes de l'appli, avec les postes et les critères du volley (libéro non ajouté).
const REGIONS: Record<string, string> = { '83': 'region-sud', '13': 'region-sud', '06': 'region-sud', '75': 'region-idf', '35': 'region-bre', '69': 'region-ara' }
const positions = VOLLEYBALL.positions.map((p) => ({ id: p.code, label: p.label }))
const regions = [
  { id: 'region-sud', name: 'Région Sud' },
  { id: 'region-idf', name: 'Île-de-France' },
  { id: 'region-bre', name: 'Bretagne' },
  { id: 'region-ara', name: 'Auvergne-Rhône-Alpes' },
]
const depts = [
  { code: '83', name: 'Var' },
  { code: '13', name: 'Bouches-du-Rhône' },
  { code: '06', name: 'Alpes-Maritimes' },
  { code: '75', name: 'Paris' },
  { code: '35', name: 'Ille-et-Vilaine' },
  { code: '69', name: 'Rhône' },
]

await t('volley, liste Joueurs : chaque exemple des consignes est accepté par l’appli et change les filtres', () => {
  const ctx: SearchContext = {
    positions,
    regions,
    depts,
    clubs: ['Volley Club Toulon Fictif', 'Entente Volley Villeurbanne'],
    groups: [{ id: 'g1', name: 'Volleyades M15' }],
    profiles: [],
    regionOfDept: (c) => REGIONS[c],
    thisYear: 2026,
  }
  const schema = buildSchema(ctx)
  assert.match(String(schema.poste), /^P \(passeur\), R4 \(réceptionneur-attaquant\), C \(central\), PT \(pointu\)/)
  const examples = [...V.filtres.matchAll(/^Actuels (\{.*?\}) ; « (.*) » → (\{.*\})$/gm)]
  assert.ok(examples.length >= 12)
  const toValues = (a: Record<string, unknown>) => {
    const v = applyAnswer({ action: 'remplacer', filtres: { ...a, recherche: undefined } }, EMPTY_FILTERS, ctx).values
    return a.recherche ? { ...v, q: 'Martin' } : v
  }
  for (const [, actuels, phrase, reponse] of examples) {
    const r = JSON.parse(reponse)
    const out = applyAnswer(r, toValues(JSON.parse(actuels)), ctx)
    assert.equal(out.action, r.action, phrase)
    assert.equal(out.notFound.length, 0, `${phrase} : ${out.notFound}`)
    assert.ok(out.changed, phrase)
    for (const k of [...Object.keys(r.filtres), ...r.retirer]) assert.ok(k in schema, `${phrase} : ${k}`)
  }
  const c = examples.find((e) => e[2].includes('centraux'))!
  assert.equal(applyAnswer(JSON.parse(c[3]), EMPTY_FILTERS, ctx).values.position, 'C')
})

await t('volley, questions : chaque recette d’exemple est relue sans note (postes, gestes, grilles, mesures du volley)', () => {
  const qCriteria: QCriterion[] = criteria.map((c) => ({ id: c.id, label: c.label, category: c.category, kind: c.kind, scale: c.scale, unit: c.unit, positions: c.positions }))
  const ctx: QuestionContext = {
    regions,
    depts,
    regionOfDept: (c) => REGIONS[c],
    positions,
    clubs: [{ key: 'entente volley villeurbanne', name: 'Entente Volley Villeurbanne', dept: '69' }],
    groups: [{ id: 'g-vol', name: 'Volleyades' }],
    events: [{ id: 'e-cannes', name: 'Tournoi de Cannes', date: '2026-10-04' }],
    criteria: qCriteria,
    today: '2026-10-14',
  }
  const examples = [...V.question.matchAll(/^« (.*) » → (\{.*\})$/gm)].map(([, phrase, j]) => ({ phrase, answer: JSON.parse(j) as { recette: unknown; nonGere: string[] } }))
  assert.ok(examples.length >= 30)
  for (const { phrase, answer } of examples) {
    const it = interpretRecipe(answer.recette, answer.nonGere, ctx, phrase)
    assert.deepEqual(it.notes, [], `${phrase} : ${it.notes.join(' | ')}`)
    assert.equal(it.unsupported.length, /points marqués|Nationale|changé/.test(phrase) ? 1 : 0, `${phrase} : ${it.unsupported}`)
    for (const p of it.recipe.pop.positions ?? []) assert.ok(['P', 'R4', 'C', 'PT'].includes(p), `${phrase} : ${p}`)
  }
  const get = (s: string) => interpretRecipe(examples.find((e) => e.phrase.startsWith(s))!.answer.recette, [], ctx).recipe
  assert.deepEqual(get('les meilleurs en réception').out.avg, { on: 'criterion', id: 'champ_reception' })
  assert.deepEqual(get('les pointus gauchers').avis, [{ target: { on: 'criterion', id: 'champ_attaque' }, op: 'gte', value: 4 }])
  assert.deepEqual(get('les joueurs vus par au moins 3 coachs').avis[0].target, { on: 'criterion', id: 'champ_defense' }, 'défense du joueur de champ : le libéro n’est pas ajouté')
  assert.deepEqual(get('les joueurs du tournoi de Cannes').measures, [{ id: 'hauteur_attaque', op: 'gte', value: 300 }])
  assert.deepEqual(get('les passeurs les plus précis').out.avg, { on: 'mix', parts: [{ on: 'criterion', id: 'passeur_precision' }, { on: 'criterion', id: 'passeur_distribution' }] })
})

await t('volley, actions et SQL : plans acceptés, requêtes en lecture seule', () => {
  const block = V.action
  const examples = [...block.matchAll(/^« (.+?) » → (\{.*\})$/gm)]
  assert.ok(examples.length >= 9)
  for (const [, phrase, j] of examples) {
    const raw = JSON.parse(j)
    const c = parsePlan(raw)
    if (raw.action === 'interdite' || raw.action === 'aucune') assert.ok(!c.ok, phrase)
    else {
      assert.ok(c.ok, phrase)
      const pos = (c.plan.players?.population as { postes?: string[] } | undefined)?.postes ?? []
      for (const p of pos) assert.ok(['P', 'R4', 'C', 'PT'].includes(p), `${phrase} : ${p}`)
    }
  }
  const sql = [...V.sql.matchAll(/^« (.*) » → (\{.*\})$/gm)].map(([, phrase, j]) => ({ phrase, a: JSON.parse(j) as { sql: string; explication: string } }))
  assert.ok(sql.length >= 10)
  for (const { phrase, a } of sql) {
    if (!a.sql) continue
    const g = guardSql(a.sql)
    assert.ok(g.ok, `${phrase} : ${!g.ok && g.error}`)
    assert.ok(!/'GB'|'PIV'|,PIV,|gardien|pivot/i.test(a.sql + a.explication), phrase)
  }
})

// ---------- 7. Ce que l'appli envoie : le sport, rien d'autre ----------

await t('l’appli envoie « sport » au volley (un mot), rien de plus au handball', async () => {
  const bodies: Record<string, unknown>[] = []
  const ep: Endpoint = {
    url: 'https://exemple.invalid/functions/v1/transcrire',
    headers: { Authorization: 'Bearer x' },
    fetch: (async (_u: string, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)))
      return new Response(JSON.stringify({ filtres: {}, recette: {}, sql: 'SELECT 1', plan: { action: 'aucune' }, notes: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }) as typeof fetch,
  }
  const all = async () => {
    bodies.length = 0
    await understandFilters(ep, 'les passeurs de 2011', { poste: 'P' })
    await understandQuestion(ep, 'combien de centraux', { postes: 'C' })
    await understandSql(ep, 'combien de centraux', { joueurs: 'id' })
    await understandAction(ep, 'crée un groupe avec les pointus', { postes: 'PT' })
    await understandAvis(ep, 'Remarquable en attaque', buildAvisPayload(criteria, 'R4').criteres)
    return bodies.map((b) => b.sport)
  }
  volley()
  assert.deepEqual(sportField(), { sport: 'volley' })
  assert.deepEqual(await all(), ['volley', 'volley', 'volley', 'volley', 'volley'])
  handball()
  assert.deepEqual(sportField(), {})
  assert.deepEqual(await all(), [undefined, undefined, undefined, undefined, undefined])
  assert.deepEqual(Object.keys(bodies[0]), ['phrase', 'schema', 'actuels'], 'handball : la requête d’avant')
  volley()
})

await t('✦ en volley : « les passeuses du stage CRE » reste une recherche de joueurs', () => {
  assert.equal(routeAsk('les passeuses du stage CRE')[0].kind, 'players')
  assert.equal(routeAsk('les stages de cette saison')[0].kind, 'events')
  handball()
  assert.equal(routeAsk('les gardiens du stage de Toussaint')[0].kind, 'players')
  volley()
})

console.log(`\n${n} tests OK`)
