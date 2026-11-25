// Test de l'avis vocal « en langage naturel » (src/dictation/avis.ts, src/expressionsCore.ts) : vocabulaire de l'entraîneur
// envoyé sous les identifiants courts (critères hors de la liste écartés), sens d'une note (échelles 1 à 5 et 0 à 3), texte
// d'une expression retenue, notes « déduites », portrait et remarques « pas reliées » relus, enregistrement des expressions
// (même texte : mise à jour ; plafond), lignes du serveur ; appel à la fonction avec un faux fetch. Données fictives.
//
//   npx jiti tools/test-avis-expressions.ts
import assert from 'node:assert/strict'
import { buildAvisPayload, expressionText, interpretAvis, sensFromValue, understandAvis, MAX_EXPRESSIONS } from '../src/dictation/avis'
import { cleanCibles, fromServer, ownExpressions, planDelete, planSave, toServer, type ExpressionRow } from '../src/expressionsCore'
import type { Endpoint } from '../src/dictation/transcribe'
import type { Criterion } from '../src/db'

const base = { updatedAt: 0, kind: 'subjective' as const, active: true, category: 'Mental', order: 0 }
const criteria: Criterion[] = [
  { ...base, id: 'eng', label: 'Engagement', scale: 'score5' },
  { ...base, id: 'comb', label: 'Combativité', scale: 'score5' },
  { ...base, id: 'coll', label: 'Jeu collectif', scale: 'score5', category: 'Jeu' },
  { ...base, id: 'rep', label: 'Repli défensif', scale: 'score3', positions: ['AG'] },
  { ...base, id: 'gb', label: 'Placement dans les buts', scale: 'score5', positions: ['GB'] },
  { ...base, id: 'note', label: 'Remarque', scale: 'text' },
]

// ---------- Vocabulaire envoyé ----------
{
  const p = buildAvisPayload(criteria, 'AG', [
    { texte: '  teigneux ', cibles: [{ criterionId: 'comb', sens: 'haut' }, { criterionId: 'eng', sens: 'haut' }] },
    // Critère de gardien : pas dans la liste d'un ailier ; le texte (champ libre) aussi : écartés.
    { texte: 'chat', cibles: [{ criterionId: 'gb', sens: 'haut' }, { criterionId: 'coll', sens: 'bas' }, { criterionId: 'note', sens: 'haut' }] },
    // Plus aucune cible : l'expression ne part pas.
    { texte: 'mur', cibles: [{ criterionId: 'gb', sens: 'haut' }] },
    { texte: 'supprimée', cibles: [{ criterionId: 'eng', sens: 'haut' }], deleted: true },
    { texte: 'doublon', cibles: [{ criterionId: 'rep', sens: 'moyen' }, { criterionId: 'rep', sens: 'bas' }] },
  ])
  assert.deepEqual(p.criteres.map((c) => `${c.id} ${c.label}`), ['c1 Engagement', 'c2 Combativité', 'c3 Jeu collectif', 'c4 Repli défensif'])
  assert.deepEqual(p.expressions, [
    { texte: 'teigneux', cibles: [{ id: 'c2', sens: 'haut' }, { id: 'c1', sens: 'haut' }] },
    { texte: 'chat', cibles: [{ id: 'c3', sens: 'bas' }] },
    { texte: 'doublon', cibles: [{ id: 'c4', sens: 'moyen' }] },
  ])
  // Rien d'autre que le texte et les cibles (identifiants courts, sens).
  for (const e of p.expressions) {
    assert.deepEqual(Object.keys(e), ['texte', 'cibles'])
    for (const c of e.cibles) assert.deepEqual(Object.keys(c), ['id', 'sens'])
  }
  // 100 au plus ; 60 caractères au plus.
  const many = Array.from({ length: 130 }, (_, i) => ({ texte: `mot ${i} ${'x'.repeat(80)}`, cibles: [{ criterionId: 'eng', sens: 'haut' as const }] }))
  const big = buildAvisPayload(criteria, 'AG', many)
  assert.equal(big.expressions.length, MAX_EXPRESSIONS)
  assert.ok(big.expressions.every((e) => e.texte.length <= 60))
  // Sans expression : rien de plus.
  assert.deepEqual(buildAvisPayload(criteria, 'AG').expressions, [])
}

// ---------- Sens d'une note ----------
assert.deepEqual([1, 2, 3, 4, 5].map((v) => sensFromValue(v, 1, 5)), ['bas', 'bas', 'moyen', 'haut', 'haut'])
assert.deepEqual([0, 1, 2, 3].map((v) => sensFromValue(v, 0, 3)), ['bas', 'bas', 'haut', 'haut'], '0 à 3 : pas de milieu entier')
assert.deepEqual([0, 1, 2].map((v) => sensFromValue(v, 0, 2)), ['bas', 'moyen', 'haut'])

// ---------- Texte d'une expression retenue ----------
assert.equal(expressionText('« Joue très personnel »'), 'joue très personnel')
assert.equal(expressionText('  "Teigneuse"  '), 'teigneuse')
assert.equal(expressionText('Valeureuse'), 'valeureuse')
assert.equal(expressionText('x'.repeat(80)).length, 60)

// ---------- Relecture : déduit, portrait, pas relié ----------
{
  const payload = buildAvisPayload(criteria, 'AG')
  const texte = 'Une joueuse valeureuse, elle ne lâche jamais rien, vraiment teigneuse. Et elle a un sacré caractère.'
  const r = interpretAvis(
    {
      notes: [
        { id: 'c1', valeur: 4, extrait: 'elle ne lâche jamais rien', confiance: 'deduit' },
        { id: 'c2', valeur: 4, extrait: 'vraiment teigneuse', confiance: 'forte' },
        // Déduite au minimum : écartée (le minimum demande une confiance « forte »).
        { id: 'c3', valeur: 1, extrait: 'un sacré caractère', confiance: 'deduit' },
        // Extrait inventé : écarté, même déduit.
        { id: 'c4', valeur: 2, extrait: 'replie toujours', confiance: 'deduit' },
      ],
      pointsForts: 'Valeureuse, combative.',
      portrait: '« Joueuse engagée et combative, qui ne lâche rien. »',
      nonRelies: ['un sacré caractère', 'Un SACRÉ caractère', 'jamais dit ça', 42, 'x'.repeat(61), '« valeureuse »', 'a', 'b', 'c', 'd'],
    },
    payload,
    texte,
  )
  assert.deepEqual(r.suggestions.map((s) => [s.label, s.value, s.confidence]), [['Engagement', 4, 'deduit'], ['Combativité', 4, 'forte']])
  assert.deepEqual(r.dropped.map((d) => d.reason).sort(), ['citation_absente', 'minimum_incertain'])
  assert.equal(r.portrait, 'Joueuse engagée et combative, qui ne lâche rien.')
  assert.deepEqual(r.nonRelies, ['un sacré caractère', 'valeureuse'], 'présentes dans le texte, sans doublon, 60 caractères au plus')
  // Portrait trop long : coupé à 160 ; absent ou pas une chaîne : vide.
  assert.equal(interpretAvis({ portrait: 'p'.repeat(300) }, payload, texte).portrait.length, 160)
  assert.equal(interpretAvis({ portrait: 3 }, payload, texte).portrait, '')
  assert.deepEqual(interpretAvis({ nonRelies: 'un sacré caractère' }, payload, texte).nonRelies, [])
  // Confiance inconnue : « moyenne » (comme avant).
  assert.equal(interpretAvis({ notes: [{ id: 'c2', valeur: 4, extrait: 'vraiment teigneuse', confiance: '?' }] }, payload, texte).suggestions[0].confidence, 'moyenne')
}

// ---------- Appel : vocabulaire envoyé seulement s'il y en a ; portrait et pas reliés rendus ----------
{
  const bodies: Record<string, unknown>[] = []
  const ep: Endpoint = {
    url: 'https://x.supabase.co/functions/v1/transcrire',
    headers: { Authorization: 'Bearer t' },
    fetch: (async (_u: string, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)))
      return new Response(JSON.stringify({ notes: [], pointsForts: '', axes: '', ambigus: [], portrait: 'Joueuse engagée.', nonRelies: ['teigneuse'], ms: 1 }), { status: 200 })
    }) as typeof fetch,
  }
  const p = buildAvisPayload(criteria, 'AG', [{ texte: 'teigneux', cibles: [{ criterionId: 'comb', sens: 'haut' }] }])
  const ans = await understandAvis(ep, 'Vraiment teigneuse.', p.criteres, undefined, p.expressions)
  assert.deepEqual(Object.keys(bodies[0]), ['texte', 'criteres', 'expressions'])
  assert.deepEqual(bodies[0].expressions, [{ texte: 'teigneux', cibles: [{ id: 'c2', sens: 'haut' }] }])
  assert.deepEqual((ans.raw as { portrait: string; nonRelies: string[] }).portrait, 'Joueuse engagée.')
  assert.deepEqual((ans.raw as { nonRelies: string[] }).nonRelies, ['teigneuse'])
  await understandAvis(ep, 'Vraiment teigneuse.', p.criteres)
  assert.deepEqual(Object.keys(bodies[1]), ['texte', 'criteres'], 'sans vocabulaire : comme avant')
}

// ---------- Enregistrement des expressions ----------
{
  let n = 0
  const ctx = (now: number) => ({ owner: 'u1', now, newId: () => `id${++n}` })
  const c = [{ criterionId: 'comb', sens: 'haut' as const }]
  const [a] = planSave([], { texte: ' Teigneux ', cibles: c }, ctx(1000))
  assert.deepEqual([a.id, a.texte, a.dirty, a.owner], ['id1', 'Teigneux', 1, 'u1'])
  // Même texte (majuscules) : mise à jour de la même ligne, plus récente.
  const [b] = planSave([a], { texte: 'teigneux', cibles: [{ criterionId: 'eng', sens: 'bas' }] }, ctx(500))
  assert.equal(b.id, 'id1')
  assert.ok(b.updatedAt > a.updatedAt, 'toujours plus récente, même si l’horloge recule')
  assert.deepEqual(b.cibles, [{ criterionId: 'eng', sens: 'bas' }])
  // Renommée en un texte qui existe : l'autre disparaît.
  const [x] = planSave([b], { texte: 'valeureux', cibles: c }, ctx(2000))
  const out = planSave([b, x], { id: x.id, texte: 'TEIGNEUX', cibles: c }, ctx(3000))
  assert.deepEqual(out.map((r) => [r.id, !!r.deleted]), [[x.id, false], ['id1', true]])
  // Sans texte ou sans cible valable : rien.
  assert.deepEqual(planSave([], { texte: '  ', cibles: c }, ctx(1)), [])
  assert.deepEqual(planSave([], { texte: 'x', cibles: [{ criterionId: 'eng', sens: 'tres' as never }] }, ctx(1)), [])
  // Cibles : 3 au plus, distinctes.
  assert.deepEqual(cleanCibles([{ criterionId: 'a', sens: 'haut' }, { criterionId: 'a', sens: 'bas' }, { criterionId: 'b', sens: 'moyen' }, { criterionId: 'c', sens: 'bas' }, { criterionId: 'd', sens: 'bas' }]).map((x) => x.criterionId), ['a', 'b', 'c'])
  // Plafond : la 101e retire la plus ancienne.
  const full: ExpressionRow[] = Array.from({ length: MAX_EXPRESSIONS }, (_, i) => ({ id: `e${i}`, owner: 'u1', texte: `mot ${i}`, cibles: c, createdAt: i, updatedAt: 100 + i, dirty: 0 }))
  const add = planSave(full, { texte: 'nouveau', cibles: c }, ctx(9999))
  assert.deepEqual(add.map((r) => [r.texte, !!r.deleted]), [['nouveau', false], ['mot 0', true]])
  // Les expressions d'un autre compte de l'appareil ne comptent pas.
  assert.equal(planSave(full.map((r) => ({ ...r, owner: 'u2' })), { texte: 'mot 1', cibles: c }, ctx(1)).length, 1)
  assert.deepEqual(ownExpressions([...full.slice(0, 2), { ...a, texte: 'Écart' }, { ...b, id: 'z', deleted: true }], 'u1').map((r) => r.texte), ['Écart', 'mot 0', 'mot 1'])
  // Suppression : sans cibles, à envoyer.
  const del = planDelete(a, 0)
  assert.deepEqual([del.deleted, del.cibles, del.dirty], [true, [], 1])
  assert.equal(toServer(del).deleted_at, new Date(del.updatedAt).toISOString())
  assert.deepEqual(toServer(a).cibles, c)
}

// ---------- Lignes du serveur ----------
{
  const s = { id: 'id1', texte: 'teigneux', cibles: [{ criterionId: 'comb', sens: 'haut' }, { criterionId: 'x', sens: '?' }], created_at: '2026-10-30T10:00:00Z', updated_at: '2026-10-31T10:00:00Z', deleted_at: null }
  const t = Date.parse(s.updated_at)
  const got = fromServer(s, undefined, 'u1')!
  assert.deepEqual([got.texte, got.cibles, got.dirty, got.owner], ['teigneux', [{ criterionId: 'comb', sens: 'haut' }], 0, 'u1'])
  const local: ExpressionRow = { ...got, cibles: [{ criterionId: 'eng', sens: 'bas' }], updatedAt: t + 1, dirty: 1 }
  assert.equal(fromServer(s, local, 'u1'), null, 'version de l’appareil plus récente, pas encore envoyée : gardée')
  assert.ok(fromServer(s, { ...local, updatedAt: t - 1 }, 'u1'), 'version du serveur plus récente : prise')
  assert.equal(fromServer(s, { ...got }, 'u1'), null, 'identique : rien')
  assert.equal(fromServer({ ...s, deleted_at: s.updated_at }, got, 'u1'), null, 'même heure, déjà reçue')
  const gone = fromServer({ ...s, deleted_at: s.updated_at, updated_at: '2026-10-31T11:00:00Z' }, got, 'u1')!
  assert.deepEqual([gone.deleted, gone.cibles], [true, []])
  assert.equal(fromServer({ ...s, cibles: [] }, undefined, 'u1'), null, 'vivante sans cible : illisible')
}

console.log('test-avis-expressions : OK')
