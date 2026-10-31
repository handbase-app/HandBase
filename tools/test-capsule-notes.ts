// Test des notes en capsule segmentée (src/scoreCapsule.ts, CriterionInput de l'écran d'avis) : état de chaque segment
// (vide / retenu / proposé par l'avis vocal), effet d'un toucher (choisir, retirer la note retenue, valider la proposée),
// échelles score5 / score3 / score2 inchangées, noms accessibles ; néon des propositions accordé à chaque thème et style.
//
//   npx jiti tools/test-capsule-notes.ts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { hasPendingProposal, scaleSteps, scoreAfterTap, segmentLabel, segmentState } from '../src/scoreCapsule'
import { scaleMax, scaleMin, type CriterionScale } from '../src/db'
import { decide, type AvisState } from '../src/dictation/avis'
import { BRAND_NEON, type Neon } from '../src/neon'
import { computeLook, THEMES } from '../src/theme'
import { contrast, STYLES, styleById } from '../src/uiStyle'

const states = (value: number | string | undefined, suggested: number | undefined, steps = [1, 2, 3, 4, 5]) =>
  steps.map((n) => segmentState(n, value, suggested))

// ---------- Échelles : une capsule par critère, un segment par note de l'échelle (rien ne change dans les données) ----------
{
  const steps = (s: CriterionScale) => scaleSteps(scaleMin(s), scaleMax(s)!)
  assert.deepEqual(steps('score5'), [1, 2, 3, 4, 5])
  assert.deepEqual(steps('score3'), [0, 1, 2, 3])
  assert.deepEqual(steps('score2'), [0, 1, 2])
  assert.deepEqual(scaleSteps(3, 2), [])
}

// ---------- État des segments ----------
{
  // Pas noté, rien de proposé : tout est vide.
  assert.deepEqual(states(undefined, undefined), ['vide', 'vide', 'vide', 'vide', 'vide'])
  // Note retenue : un seul segment plein.
  assert.deepEqual(states(5, undefined), ['vide', 'vide', 'vide', 'vide', 'retenu'])
  // Proposition de l'avis vocal sur un critère pas noté.
  assert.deepEqual(states(undefined, 4), ['vide', 'vide', 'vide', 'propose', 'vide'])
  assert.equal(hasPendingProposal(undefined, 4), true)
  // Proposition différente de la note déjà saisie : les deux se voient.
  assert.deepEqual(states(2, 4), ['vide', 'retenu', 'vide', 'propose', 'vide'])
  // Proposition identique à la note saisie : plus rien à valider, simple note retenue.
  assert.deepEqual(states(4, 4), ['vide', 'vide', 'vide', 'retenu', 'vide'])
  assert.equal(hasPendingProposal(4, 4), false)
  assert.equal(hasPendingProposal(undefined, undefined), false)
  // Échelle 0 à 3 : le 0 est une vraie note (pas « vide »).
  assert.deepEqual(states(0, undefined, [0, 1, 2, 3]), ['retenu', 'vide', 'vide', 'vide'])
  assert.deepEqual(states(undefined, 0, [0, 1, 2, 3]), ['propose', 'vide', 'vide', 'vide'])
}

// ---------- Un toucher ----------
{
  assert.equal(scoreAfterTap(3, undefined, undefined), 3) // choisir
  assert.equal(scoreAfterTap(3, 3, undefined), undefined) // toucher la note retenue la retire
  assert.equal(scoreAfterTap(4, 3, undefined), 4) // changer
  assert.equal(scoreAfterTap(4, undefined, 4), 4) // valider la proposée
  assert.equal(scoreAfterTap(4, 2, 4), 4) // valider la proposée à la place d'une note déjà saisie
  assert.equal(scoreAfterTap(5, undefined, 4), 5) // une autre note : la proposition est modifiée
  assert.equal(scoreAfterTap(2, 2, 4), undefined) // retirer la note saisie : la proposition est ignorée (decide plus bas)
  assert.equal(scoreAfterTap(0, undefined, undefined), 0)
}

// ---------- Journal de l'avis vocal : la réponse du coach suit le toucher (logique inchangée de src/dictation/avis.ts) ----------
{
  const st: AvisState = {
    playerId: 'p',
    transcript: 'Bonne vision du jeu.',
    result: { suggestions: [{ criterionId: 'vis', label: 'Vision du jeu', value: 4, quote: 'Bonne vision du jeu', confidence: 'forte' }], pointsForts: '', axes: '', ambigus: [], dropped: [] },
    pending: ['vis'],
    strengths: false,
    improvements: false,
  }
  const tap = (n: number, value?: number) => decide(st, 'vis', { value: scoreAfterTap(n, value, 4) }).decisions?.vis
  assert.deepEqual(tap(4), { kept: 'accepte' })
  assert.deepEqual(tap(5), { kept: 'modifie', final: 5 })
  assert.deepEqual(tap(2, 2), { kept: 'ignore' })
}

// ---------- Lecteurs d'écran ----------
{
  assert.equal(segmentLabel(3, 5, 'vide'), '3 sur 5')
  assert.equal(segmentLabel(4, 5, 'propose'), '4 sur 5, proposé par l’avis vocal : toucher pour valider')
  assert.equal(segmentLabel(2, 3, 'retenu'), '2 sur 3, note retenue : toucher pour la retirer')
}

// ---------- Néon de la capsule Nextar, accordé au thème ; propositions de l'avis vocal sobres (31/10) ----------
{
  const css = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8')
  assert.ok(!/#a3e635|#4d7c0f/i.test(css), 'plus de vert lime pour les propositions')
  assert.match(css, /--color-suggest: var\(--neon-text\);/)
  assert.match(css, /--neon-grad: linear-gradient\(120deg, var\(--neon-a\), var\(--neon-b\)\);/)
  // Par défaut (avant le thème) : la menthe du logo.
  assert.match(css, /--neon-a: #89f7b3;/)
  // La capsule de l'en-tête et sa pastille micro partagent le même dégradé.
  const rule = (cls: string) => css.slice(css.indexOf(`${cls} {`), css.indexOf('}', css.indexOf(`${cls} {`)))
  for (const cls of ['.ask-capsule', '.ask-mic']) assert.match(rule(cls), /var\(--neon-grad\)/, cls)
  // Propositions de l'avis vocal : dans la couleur du texte du thème, sans dégradé ni halo (le néon était criard).
  for (const cls of ['.sug-ring', '.sug-fill', '.sug-tag', '.sug-box']) {
    assert.ok(css.includes(`${cls} {`), cls)
    assert.match(rule(cls), /var\(--color-fg\)/, cls)
    assert.doesNotMatch(rule(cls), /--neon-/, cls)
  }
}

// ---------- Un néon par thème et par style d'installation, lisible ----------
{
  assert.deepEqual(BRAND_NEON, { a: '#89f7b3', b: '#61d0d1', ink: '#0a182d', text: '#89f7b3' }, 'Nuit : la menthe de la marque')
  assert.equal(THEMES.find((t) => t.id === 'nuit')!.neon, BRAND_NEON)
  const hex = /^#[0-9a-f]{6}$/
  const check = (name: string, n: Neon, panel: string, light: boolean) => {
    for (const k of ['a', 'b', 'ink', 'text'] as const) assert.match(n[k], hex, `${name} : ${k}`)
    // Texte posé sur le néon : AA sur les deux bouts du dégradé.
    assert.ok(contrast(n.ink, n.a) >= 4.5, `${name} : encre sur ${n.a} (${contrast(n.ink, n.a).toFixed(2)})`)
    assert.ok(contrast(n.ink, n.b) >= 4.5, `${name} : encre sur ${n.b} (${contrast(n.ink, n.b).toFixed(2)})`)
    // Néon écrit en texte sur les cartes : AA.
    assert.ok(contrast(n.text, panel) >= 4.5, `${name} : texte ${n.text} sur ${panel} (${contrast(n.text, panel).toFixed(2)})`)
    // Le néon se voit sur le fond des cartes (liseré) : thèmes sombres nettement, clairs au moins un peu.
    assert.ok(Math.max(contrast(n.a, panel), contrast(n.b, panel)) >= (light ? 1.8 : 5), `${name} : liseré visible`)
  }
  for (const t of THEMES) {
    check(`thème ${t.id}`, t.neon, t.colors.panel, t.light)
    const vars = computeLook('actuel', t.id).vars
    assert.equal(vars['--neon-a'], t.neon.a)
    assert.equal(vars['--neon-text'], t.neon.text)
  }
  // Les thèmes ne partagent pas tous le même néon (il s'accorde au thème).
  assert.ok(new Set(THEMES.map((t) => t.neon.a + t.neon.b)).size >= 5)
  for (const s of STYLES)
    for (const light of [true, false]) {
      const p = light ? s.light : s.dark
      if (!p) continue
      check(`style ${s.id} ${light ? 'clair' : 'sombre'}`, p.neon, p.panel, light)
      // Le style l'emporte sur le thème.
      const t = THEMES.find((x) => x.light === light)!
      assert.equal(computeLook(s.id, t.id).vars['--neon-a'], p.neon.a, `${s.id} / ${t.id}`)
    }
  // L'en-tête coloré (Officiel) : le liseré se voit sur le bleu de l'en-tête.
  for (const p of [styleById('officiel').light!, styleById('officiel').dark!]) assert.ok(contrast(p.neon.a, p.header!.bg) >= 5)
}

console.log('test-capsule-notes : OK')
