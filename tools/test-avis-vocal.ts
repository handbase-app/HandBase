// Test de l'« avis vocal » (src/dictation/avis.ts) : critères envoyés, relecture des réponses du modèle (identifiants
// inventés, valeurs hors échelle, extraits absents du texte, minimum incertain, doublons), extraits approchés, fusion des
// commentaires ; appel à la fonction « transcrire » (?mode=avis) avec un faux fetch.
//
//   npx jiti tools/test-avis-vocal.ts
import assert from 'node:assert/strict'
import { avisProposals, buildAvisPayload, decide, decideAll, droppedText, findQuote, interpretAvis, mergeComment, understandAvis, type AvisState } from '../src/dictation/avis'
import {
  buildAvisVocal,
  buildVocalAvis,
  copyForClaude,
  exportCsv,
  splitLog,
  splitVocal,
  VOCAL_MAX_PHRASE,
  vocalCsv,
  vocalForClaude,
  vocalToReview,
  type QuestionLogRow,
} from '../src/questionLogCore'
import { DictationError, requestAccess, type Endpoint } from '../src/dictation/transcribe'
import type { Criterion } from '../src/db'

const base = { updatedAt: 0, kind: 'subjective' as const, active: true, category: 'Jeu', order: 0 }
const criteria: Criterion[] = [
  { ...base, id: 'vit', label: 'Vitesse', scale: 'score5', quick: true },
  { ...base, id: 'tir', label: 'Tir', description: 'Puissance et précision', scale: 'score5' },
  { ...base, id: 'lec', label: 'Lecture du jeu', scale: 'score5' },
  { ...base, id: 'rep', label: 'Repli défensif', scale: 'score3', positions: ['AG', 'AD', 'ARG', 'ARD', 'DC', 'PIV'] },
  { ...base, id: 'gb', label: 'Placement dans les buts', scale: 'score5', positions: ['GB'] },
  { ...base, id: 'taille', label: 'Envergure', scale: 'number', unit: 'cm' },
  { ...base, id: 'main', label: 'Bras fort', scale: 'choice', options: ['Gauche', 'Droit'] },
  { ...base, id: 'note', label: 'Remarque', scale: 'text' },
  { ...base, id: 'off', label: 'Ancien critère', scale: 'score5', active: false },
  { ...base, id: 'sup', label: 'Supprimé', scale: 'score5', deleted: true },
  { ...base, id: 'fact', label: 'Détente', scale: 'score5', kind: 'factual' },
]

// ---------- Critères envoyés ----------
{
  const p = buildAvisPayload(criteria, 'AG')
  assert.deepEqual(
    p.criteres.map((c) => c.label),
    ['Vitesse', 'Tir', 'Lecture du jeu', 'Repli défensif'],
    'échelles seulement, poste du joueur, actifs, d’observation',
  )
  assert.deepEqual(p.criteres.map((c) => c.id), ['c1', 'c2', 'c3', 'c4'], 'identifiants courts')
  assert.deepEqual(p.criteres[0].echelle, { min: 1, max: 5, libelles: { '1': 'très insuffisant', '3': 'niveau attendu', '5': 'remarquable' } })
  assert.deepEqual(p.criteres[3].echelle, { min: 0, max: 3 })
  assert.equal(p.criteres[1].description, 'Puissance et précision')
  assert.equal(p.refs.c4.criterionId, 'rep')
  // Rien d'autre que id, label, description, échelle.
  for (const c of p.criteres) for (const k of Object.keys(c)) assert.ok(['id', 'label', 'description', 'echelle'].includes(k), k)
  const gb = buildAvisPayload(criteria, 'GB')
  assert.deepEqual(gb.criteres.map((c) => c.label), ['Vitesse', 'Tir', 'Lecture du jeu', 'Placement dans les buts'], 'gardien')
  const sans = buildAvisPayload(criteria, undefined)
  assert.ok(!sans.criteres.some((c) => c.label === 'Placement dans les buts'), 'sans poste : pas de critère de gardien')
}

// ---------- Extraits ----------
const texte =
  "Très rapide, il explose sur les contre-attaques. Au tir c'est correct, sans plus. Il voit bien le jeu. Par contre il doit travailler ses replis, il est souvent en retard."
assert.equal(findQuote(texte, 'il explose sur les contre-attaques'), 'il explose sur les contre-attaques')
assert.equal(findQuote(texte, 'IL EXPLOSE sur les contre attaques'), 'il explose sur les contre-attaques', 'casse, tiret')
assert.equal(findQuote(texte, 'Au tir c est correct'), "Au tir c'est correct", 'apostrophe')
assert.equal(findQuote(texte, 'tres rapide'), 'Très rapide', 'accents')
assert.equal(findQuote(texte, 'il doit travailler ses replies'), 'il doit travailler ses replis', 'une lettre près')
assert.equal(findQuote(texte, 'il doit travailler ses replis défensifs'), null, 'mot ajouté par le modèle')
assert.equal(findQuote(texte, 'Au tir correct'), "Au tir c'est correct", 'petits mots sautés')
assert.equal(findQuote(texte, 'les contre-attaques. Au tir'), 'les contre-attaques. Au tir', 'par-dessus la ponctuation')
assert.equal(findQuote('Il ne voit pas bien le jeu.', 'il voit bien le jeu'), null, 'négation : jamais sautée')
assert.equal(findQuote('Il voit peu le jeu.', 'il voit le jeu'), null)
assert.equal(findQuote(texte, 'Très rapide … explose'), 'Très rapide … explose', 'extrait coupé')
assert.equal(findQuote(texte, 'il tire très fort'), null, 'extrait inventé')
assert.equal(findQuote(texte, 'excellent défenseur'), null)
assert.equal(findQuote(texte, 'il'), null, 'un petit mot ne suffit pas')
assert.equal(findQuote(texte, ''), null)
assert.equal(findQuote(texte, 'il voit mal le jeu'), null, 'un mot changé sur un extrait court')

// ---------- Relecture des réponses du modèle ----------
{
  const payload = buildAvisPayload(criteria, 'AG')
  const r = interpretAvis(
    {
      notes: [
        { id: 'c1', valeur: 5, extrait: 'il explose sur les contre-attaques', confiance: 'forte' },
        { id: 'c2', valeur: '3', extrait: "Au tir c'est correct", confiance: 'forte' },
        { id: 'c4', valeur: 1, extrait: 'il doit travailler ses replis', confiance: 'moyenne' },
        { id: 'c9', valeur: 4, extrait: 'Très rapide', confiance: 'forte' }, // identifiant inventé
        { id: 'vit', valeur: 4, extrait: 'Très rapide', confiance: 'forte' }, // vrai identifiant, jamais envoyé
        { id: 'c3', valeur: 7, extrait: 'Il voit bien le jeu', confiance: 'forte' }, // hors échelle
        { id: 'c3', valeur: 3.5, extrait: 'Il voit bien le jeu', confiance: 'forte' }, // pas entier
        { id: 'c3', valeur: 4, extrait: 'il lit parfaitement le jeu', confiance: 'forte' }, // extrait inventé
        'n’importe quoi',
        null,
      ],
      pointsForts: '« Très rapide, explosif en contre-attaque. »',
      axes: 'À travailler : les replis défensifs (c4).',
      ambigus: ['« Il voit bien le jeu » : c3 ou Prise d’information', 42, ''],
    },
    payload,
    texte,
  )
  assert.deepEqual(
    r.suggestions.map((s) => [s.criterionId, s.value, s.quote, s.confidence]),
    [
      ['vit', 5, 'il explose sur les contre-attaques', 'forte'],
      ['tir', 3, "Au tir c'est correct", 'forte'],
      ['rep', 1, 'il doit travailler ses replis', 'moyenne'],
    ],
  )
  assert.deepEqual(
    r.dropped.map((d) => d.reason),
    ['id_inconnu', 'id_inconnu', 'hors_echelle', 'hors_echelle', 'citation_absente', 'mal_forme', 'mal_forme'],
  )
  assert.equal(r.pointsForts, 'Très rapide, explosif en contre-attaque.', 'guillemets retirés')
  assert.equal(r.axes, 'À travailler : les replis défensifs (« Repli défensif »).', 'identifiant remplacé par le libellé')
  assert.deepEqual(r.ambigus, ['« Il voit bien le jeu » : « Lecture du jeu » ou Prise d’information'])
  assert.match(droppedText(r.dropped), /^7 propositions écartées \(critère inconnu, note hors échelle, passage introuvable dans le texte, réponse incomplète\)\.$/)
}
{
  // Minimum : seulement avec une confiance forte ; doublons ; notes contradictoires.
  const payload = buildAvisPayload(criteria, 'AG')
  const r = interpretAvis(
    {
      notes: [
        { id: 'c1', valeur: 1, extrait: 'Très rapide', confiance: 'moyenne' },
        { id: 'c4', valeur: 0, extrait: 'il est souvent en retard', confiance: 'forte' },
        { id: 'c2', valeur: 3, extrait: "Au tir c'est correct", confiance: 'forte' },
        { id: 'c2', valeur: 3, extrait: 'sans plus', confiance: 'moyenne' },
        { id: 'c3', valeur: 4, extrait: 'Il voit bien le jeu', confiance: 'forte' },
        { id: 'c3', valeur: 2, extrait: 'Il voit bien le jeu', confiance: 'bof' },
      ],
    },
    payload,
    texte,
  )
  assert.deepEqual(r.suggestions.map((s) => [s.criterionId, s.value]), [['tir', 3], ['rep', 0]])
  assert.deepEqual(r.dropped.map((d) => d.reason), ['minimum_incertain', 'doublon'])
  assert.deepEqual(r.ambigus, ['la note de « Lecture du jeu »'], 'deux notes différentes : aucune gardée')
  assert.equal(r.pointsForts, '')
  assert.equal(r.axes, '')
}
{
  // Réponses mal formées : rien de proposé, pas d'erreur.
  const payload = buildAvisPayload(criteria, 'AG')
  for (const raw of [null, undefined, 'texte', 42, [], { notes: 'c1' }, { notes: [{}] }])
    assert.deepEqual(interpretAvis(raw, payload, texte).suggestions, [], JSON.stringify(raw))
}

// ---------- Fusion des commentaires ----------
assert.equal(mergeComment('', 'Très rapide.'), 'Très rapide.')
assert.equal(mergeComment(undefined, 'Très rapide.'), 'Très rapide.')
assert.equal(mergeComment('Bon match.', 'Très rapide.'), 'Bon match.\nTrès rapide.')
assert.equal(mergeComment('Bon match. Très rapide !', 'très rapide'), 'Bon match. Très rapide !', 'déjà présent')
assert.equal(mergeComment('Bon match.', '  '), 'Bon match.')

// ---------- Appel à la fonction (faux fetch) ----------
const calls: { url: string; init?: RequestInit }[] = []
const reply = (status: number, body: unknown) => async (url: string | URL | Request, init?: RequestInit) => {
  calls.push({ url: String(url), init })
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}
const ep = (f: typeof fetch): Endpoint => ({ url: 'https://x.supabase.co/functions/v1/transcrire', headers: { Authorization: 'Bearer t' }, fetch: f })
const payload = buildAvisPayload(criteria, 'AG')

const ok = await understandAvis(
  ep(reply(200, { notes: [{ id: 'c1', valeur: 5, extrait: 'Très rapide', confiance: 'forte' }], pointsForts: 'Rapide.', axes: '', ambigus: [], ms: 900, restant_mois: 10, restant_jour: 3, model: 'x' }) as typeof fetch),
  '  Très   rapide.  ',
  payload.criteres,
)
assert.equal(calls[0].url, 'https://x.supabase.co/functions/v1/transcrire?mode=avis')
const sent = JSON.parse(String(calls[0].init?.body))
assert.deepEqual(Object.keys(sent), ['texte', 'criteres'], 'le texte et les critères, rien d’autre')
assert.equal(sent.texte, 'Très rapide.')
assert.equal((calls[0].init?.headers as Record<string, string>)['Content-Type'], 'application/json')
assert.equal(ok.restantJour, 3)
assert.deepEqual(interpretAvis(ok.raw, payload, 'Très rapide.').suggestions.map((s) => s.value), [5])

const fails: [number, unknown, string][] = [
  [429, { error: 'quota_jour_atteint' }, 'quota_jour_atteint'],
  [502, { error: 'reponse_illisible' }, 'reponse_illisible'],
  [404, {}, 'absent'],
  [403, {}, 'pas_admin'],
]
for (const [status, body, code] of fails) {
  await assert.rejects(understandAvis(ep(reply(status, body) as typeof fetch), 'Très rapide', payload.criteres), (e: unknown) => e instanceof DictationError && e.code === code)
}
await assert.rejects(understandAvis(ep(reply(200, {}) as typeof fetch), '   ', payload.criteres), (e: unknown) => e instanceof DictationError && e.code === 'texte_absent')
await assert.rejects(understandAvis(ep(reply(200, {}) as typeof fetch), 'x'.repeat(2001), payload.criteres), (e: unknown) => e instanceof DictationError && e.code === 'texte_trop_long')
await assert.rejects(understandAvis(ep(reply(200, {}) as typeof fetch), 'Très rapide', []), (e: unknown) => e instanceof DictationError && e.code === 'criteres_invalides')
await assert.rejects(
  understandAvis(ep((async () => { throw new TypeError('réseau') }) as typeof fetch), 'Très rapide', payload.criteres),
  (e: unknown) => e instanceof DictationError && e.code === 'reseau',
)

// Disponibilité : « avis » annoncé par la fonction.
assert.equal((await requestAccess(ep(reply(200, { pret: true, modes: ['dictee', 'filtres', 'avis'] }) as typeof fetch))).avis, true)
assert.equal((await requestAccess(ep(reply(200, { pret: true, modes: ['dictee', 'filtres'] }) as typeof fetch))).avis, undefined)
assert.equal((await requestAccess(ep(reply(200, { pret: true }) as typeof fetch))).avis, undefined)

// ---------- Journal des évaluations vocales (src/questionLogCore.ts, buildAvisVocal) ----------
// Noms fictifs seulement.
{
  const players = [
    { firstName: 'Lucas', lastName: 'Zorbeck' },
    { firstName: 'Éloïse', lastName: 'Varnier' },
  ]
  const anon = { players, keep: ['HBC Toulon', 'Vitesse', 'Tir', 'Lecture du jeu', 'Repli défensif'] }
  const at = new Date('2026-10-18T10:00:00.000Z')
  const me = { id: 'u1', name: 'Coach A' }

  // État tenu par l'écran de notation : décisions note par note.
  const result = {
    suggestions: [
      { criterionId: 'vit', label: 'Vitesse', value: 5, quote: 'Très rapide', confidence: 'forte' as const },
      { criterionId: 'tir', label: 'Tir', value: 3, quote: 'Au tir', confidence: 'moyenne' as const },
      { criterionId: 'lec', label: 'Lecture du jeu', value: 4, quote: 'voit bien', confidence: 'moyenne' as const },
      { criterionId: 'rep', label: 'Repli défensif', value: 2, quote: 'replis', confidence: 'moyenne' as const },
    ],
    pointsForts: 'Vitesse',
    axes: '',
    ambigus: [],
    dropped: [],
  }
  // « lec » : déjà la même note sur la fiche, jamais mise en attente.
  let st: AvisState = { id: 'a1', playerId: 'p-secret', transcript: 'x', result, pending: ['vit', 'tir', 'rep'], strengths: true, improvements: false }
  st = decide(st, 'vit', { value: 5 })
  st = decide(st, 'tir', { value: 4 })
  assert.deepEqual(st.pending, ['rep'])
  assert.equal(decide(st, 'lec', { value: 1 }), st, 'critère pas en attente : inchangé')
  const ign = decide(st, 'rep', 'ignore')
  assert.deepEqual(ign.decisions?.rep, { kept: 'ignore' })
  assert.deepEqual(decide(st, 'rep', { value: undefined }).decisions?.rep, { kept: 'ignore' }, 'note effacée : ignorée')
  const all = decideAll(st, 'accepte')
  assert.deepEqual(all.pending, [])
  assert.equal(all.strengths, false)
  assert.deepEqual(all.decisions?.rep, { kept: 'accepte' })
  assert.deepEqual(decideAll(st, 'ignore').decisions?.rep, { kept: 'ignore' })
  assert.deepEqual(avisProposals(ign), [
    { criterionId: 'vit', label: 'Vitesse', score: 5, kept: 'accepte' },
    { criterionId: 'tir', label: 'Tir', score: 3, kept: 'modifie', final: 4 },
    { criterionId: 'lec', label: 'Lecture du jeu', score: 4, kept: 'accepte' },
    { criterionId: 'rep', label: 'Repli défensif', score: 2, kept: 'ignore' },
  ])
  // Encore en attente (analyse abandonnée) : ignorée.
  assert.equal(avisProposals(st).find((p) => p.criterionId === 'rep')?.kept, 'ignore')

  // Ligne enregistrée : dictée et commentaire anonymisés, rien du joueur.
  const phrase = 'Lucas Zorbeck est très rapide, licence 6383015001234. Au tir correct, il voit bien le jeu comme Éloïse.'
  const row = buildAvisVocal(
    {
      phrase,
      proposals: avisProposals(ign),
      verdict: 'en_partie',
      comment: '  pour Zorbeck\n j’aurais mis 3 au repli ',
      // Champs qu'un appel maladroit pourrait ajouter : jamais recopiés.
      ...({ playerId: 'p-secret', birthDate: '2011-03-02', club: 'HBC Toulon', lastName: 'Zorbeck' } as object),
    },
    anon,
    me,
    at,
  )!
  assert.deepEqual(row, {
    at: '2026-10-18T10:00:00.000Z',
    authorId: 'u1',
    authorName: 'Coach A',
    kind: 'avis_vocal',
    phrase: '[prénom] [nom] est très rapide, licence [licence]. Au tir correct, il voit bien le jeu comme [prénom].',
    proposals: [
      { criterionId: 'vit', label: 'Vitesse', score: 5, kept: 'accepte' },
      { criterionId: 'tir', label: 'Tir', score: 3, kept: 'modifie', final: 4 },
      { criterionId: 'lec', label: 'Lecture du jeu', score: 4, kept: 'accepte' },
      { criterionId: 'rep', label: 'Repli défensif', score: 2, kept: 'ignore' },
    ],
    verdict: 'en_partie',
    comment: 'pour [nom] j’aurais mis 3 au repli',
  })
  // Aucun champ du joueur, à aucun niveau.
  const json = JSON.stringify(row)
  for (const bad of ['p-secret', 'Zorbeck', 'Lucas', 'Éloïse', '2011', 'Toulon', '6383015001234']) assert.ok(!json.includes(bad), bad)
  assert.deepEqual(Object.keys(row).sort(), ['at', 'authorId', 'authorName', 'comment', 'kind', 'phrase', 'proposals', 'verdict'])
  for (const p of row.proposals) for (const k of Object.keys(p)) assert.ok(['criterionId', 'label', 'score', 'kept', 'final'].includes(k), k)

  // Bornes et refus.
  assert.equal(buildAvisVocal({ phrase: '   ', proposals: [] }, anon, me, at), null, 'phrase vide')
  const big = buildAvisVocal(
    {
      phrase: 'mot '.repeat(600),
      proposals: [
        ...Array.from({ length: 45 }, (_, i) => ({ criterionId: `c${i}`, score: 3, kept: 'accepte' as const })),
      ],
      verdict: 'super' as never,
      comment: 'x'.repeat(800),
    },
    anon,
    me,
    at,
  )!
  assert.equal(big.phrase.length, VOCAL_MAX_PHRASE)
  assert.equal(big.proposals.length, 40)
  assert.equal(big.verdict, undefined, 'verdict d’une question : refusé ici')
  assert.equal(big.comment!.length, 500)
  const odd = buildAvisVocal(
    {
      phrase: 'ok',
      proposals: [
        { criterionId: 'a b', kept: 'accepte' },
        { criterionId: 'ok1', kept: 'peut-etre' as never },
        { criterionId: 'ok2', score: 99, kept: 'modifie', final: -1 },
        { criterionId: 'ok3', score: 3, kept: 'accepte', final: 4 },
      ],
    },
    anon,
  )!
  assert.deepEqual(odd.proposals, [{ criterionId: 'ok2', kept: 'modifie' }, { criterionId: 'ok3', score: 3, kept: 'accepte' }], 'critère invalide, note hors bornes, final seulement si modifiée')

  // Appréciation donnée après : ligne d'avis qui vise l'évaluation vocale.
  const late = buildVocalAvis({ vocalId: 'v-1', verdict: 'pas_coherente', comment: 'Lucas mérite 4' }, anon, me, at)!
  assert.deepEqual(late, { at: '2026-10-18T10:00:00.000Z', authorId: 'u1', authorName: 'Coach A', kind: 'avis', questionId: 'v-1', verdict: 'pas_coherente', comment: '[prénom] mérite 4', page: 'avis_vocal' })
  assert.equal(buildVocalAvis({ vocalId: 'v 1', verdict: 'coherente' }, anon), null)
  assert.equal(buildVocalAvis({ vocalId: 'v1', verdict: 'super' as never }, anon), null)

  // Journal : séparation des évaluations vocales et des questions ; écrans, copie et CSV.
  const q = { id: 'q1', at: '2026-10-17T10:00:00.000Z', phrase: 'combien de gardiens', recipe: 'complete' as const }
  const rows: QuestionLogRow[] = [
    q,
    { id: 'aq', at: '2026-10-17T11:00:00.000Z', kind: 'avis', questionId: 'q1', verdict: 'super' },
    { ...(row as object), id: 'v-1' } as unknown as QuestionLogRow,
    { ...(late as object), id: 'av', at: '2026-10-18T11:00:00.000Z' } as unknown as QuestionLogRow,
    { ...(buildAvisVocal({ phrase: 'tout bon', proposals: [{ criterionId: 'vit', score: 4, kept: 'accepte' }], verdict: 'coherente' }, anon, me, at) as object), id: 'v-2' } as unknown as QuestionLogRow,
  ]
  const { others, vocal } = splitVocal(rows)
  assert.deepEqual(others.map((r) => r.id), ['q1', 'aq'])
  assert.deepEqual(vocal.map((v) => v.row.id).sort(), ['v-1', 'v-2'])
  const v1 = vocal.find((v) => v.row.id === 'v-1')!
  assert.deepEqual(v1.verdicts.map((x) => x.verdict), ['pas_coherente', 'en_partie'], 'appréciation arrivée après, puis celle de la ligne')
  assert.equal(vocalToReview(v1), true)
  assert.equal(vocalToReview(vocal.find((v) => v.row.id === 'v-2')!), false, 'tout accepté et cohérente')
  assert.equal(splitLog(others).questions.length, 1, 'les questions ne voient pas les évaluations vocales')
  assert.ok(!copyForClaude(others, '2026-10-18').includes('tout bon'))
  assert.ok(!exportCsv(others).includes('avis_vocal'))
  const md = vocalForClaude(vocal)
  assert.ok(md.includes('2 évaluations · 5 notes proposées (3 acceptées · 1 modifiée · 1 ignorée) · appréciations : '), md)
  assert.ok(md.includes('« [prénom] [nom] est très rapide'))
  assert.ok(md.includes('Tir : proposé 3 → Modifiée (mis 4)'))
  assert.ok(md.includes('Repli défensif : proposé 2 → Ignorée'))
  assert.ok(md.includes('Commentaires : « [prénom] mérite 4 » ; « pour [nom] j’aurais mis 3 au repli »'))
  assert.ok(!md.includes('tout bon'), 'tout accepté : pas à regarder')
  assert.equal(vocalForClaude([]).includes('Aucune évaluation vocale.'), true)
  const csv = vocalCsv(vocal).split('\r\n')
  assert.equal(csv[0], 'date;auteur;phrase;critère;identifiant du critère;proposé;gardé;final;appréciation;commentaire')
  assert.equal(csv.length, 1 + 4 + 1)
  assert.ok(csv.some((l) => l.includes(';Tir;tir;3;Modifiée;4;Pas cohérente | En partie;')))
  for (const bad of ['p-secret', 'Zorbeck', 'Lucas']) assert.ok(!csv.join('\n').includes(bad), bad)
}

console.log('test-avis-vocal : OK')
