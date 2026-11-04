// Test des repères des tests physiques (src/reperes.ts) : médaille Bronze / Argent / Or quand un résultat atteint un repère
// de l'installation ; sens du critère (sprint : plus bas est mieux ; détente : plus haut ; sens choisi au réglage ; sens
// inconnu : rien), sexe, âge de saison ou catégorie (la ligne la plus précise gagne), absence de repère, valeur égale au
// seuil, lecture de la valeur stockée (illisible écartée, libellés réglables), ordre des seuils, volley (catégories M13…).
// Valeurs FICTIVES seulement (aucun barème réel).
//
//   npx jiti tools/test-reperes.ts
import assert from 'node:assert/strict'
import type { Criterion } from '../src/db'
import {
  cleanReperes,
  DEFAULT_MEDAL_LABELS,
  hasReperes,
  lineOrderProblem,
  lineWho,
  medalFor,
  numericValue,
  repereLine,
  reperesOf,
  REPERES_KEY,
  seasonAge,
  type ReperesConfig,
} from '../src/reperes'
import { applySportConfig, HANDBALL, VOLLEYBALL } from '../src/sportConfig'
import { SPORT_CONTENT } from '../src/sportContent'

let n = 0
const t = (name: string, f: () => void) => {
  f()
  n++
  console.log(`ok ${n} - ${name}`)
}

const crit = (id: string, over: Partial<Criterion> = {}): Criterion =>
  ({ id, label: id, category: 'Tests', kind: 'factual', scale: 'number', unit: 's', active: true, order: 1, updatedAt: 0, ...over }) as Criterion

const sprint = crit('sprint_10') // plus bas est mieux (src/compare.ts)
const cmj = crit('cmj_hauteur', { unit: 'cm' }) // plus haut est mieux
const gainage = crit('gainage_maison') // temps en secondes : sens inconnu

// Joueuse née en 2012 ; mesure du 15/10/2026 : saison 2026-2027, âge de saison 15 (U15 au handball).
const fille = { sex: 'F', birthDate: '2012-05-10' }
const garcon = { sex: 'M', birthDate: '2012-05-10' }
const DAY = '2026-10-15'

const cfg: ReperesConfig = cleanReperes({
  criteria: [
    {
      criterionId: 'sprint_10',
      lines: [
        { bronze: 2.3, argent: 2.1, or: 1.9 }, // tous
        { sex: 'F', cat: 'U15', bronze: 2.4, argent: 2.2, or: 2.0 },
        { sex: 'F', age: 15, bronze: 2.5, argent: 2.3, or: 2.1 },
        { sex: 'M', cat: 'U13', bronze: 2.6 },
      ],
    },
    { criterionId: 'cmj_hauteur', lines: [{ sex: 'M', bronze: 30, argent: 35, or: 40 }] },
    { criterionId: 'gainage_maison', lines: [{ bronze: 60, argent: 90, or: 120 }] },
  ],
})

t('âge de saison : année où finit la saison − année de naissance', () => {
  assert.equal(seasonAge('2012-05-10', '2026-10-15'), 15)
  assert.equal(seasonAge('2012-05-10', '2026-06-15'), 14)
  assert.equal(seasonAge('2012-05-10', '2026-09-01'), 15)
  assert.equal(seasonAge(undefined, DAY), undefined)
  assert.equal(seasonAge('', DAY), undefined)
})

t('sens du critère : sprint plus bas est mieux, détente plus haut', () => {
  // Fille 15 ans : ligne la plus précise (sexe + âge) → 2,5 / 2,3 / 2,1.
  assert.equal(medalFor(cfg, sprint, 2.05, fille, DAY), 'or')
  assert.equal(medalFor(cfg, sprint, 2.2, fille, DAY), 'argent')
  assert.equal(medalFor(cfg, sprint, 2.45, fille, DAY), 'bronze')
  assert.equal(medalFor(cfg, sprint, 2.6, fille, DAY), undefined)
  assert.equal(medalFor(cfg, cmj, 41, garcon, DAY), 'or')
  assert.equal(medalFor(cfg, cmj, 36, garcon, DAY), 'argent')
  assert.equal(medalFor(cfg, cmj, 29.9, garcon, DAY), undefined)
})

t('valeur égale au seuil : atteint', () => {
  assert.equal(medalFor(cfg, sprint, 2.1, fille, DAY), 'or')
  assert.equal(medalFor(cfg, sprint, 2.5, fille, DAY), 'bronze')
  assert.equal(medalFor(cfg, cmj, 30, garcon, DAY), 'bronze')
  assert.equal(medalFor(cfg, cmj, 40, garcon, DAY), 'or')
})

t('sexe : une ligne réservée aux garçons ne vaut pas pour une fille ; sexe inconnu : lignes « tous » seulement', () => {
  assert.equal(medalFor(cfg, cmj, 45, fille, DAY), undefined)
  assert.equal(medalFor(cfg, cmj, 45, { birthDate: '2012-05-10' }, DAY), undefined)
  // Sprint, sexe inconnu : la ligne « tous » (2,3 / 2,1 / 1,9).
  assert.equal(medalFor(cfg, sprint, 2.2, { birthDate: '2012-05-10' }, DAY), 'bronze')
  assert.equal(medalFor(cfg, sprint, 1.9, { sex: null, birthDate: '2012-05-10' }, DAY), 'or')
})

t('âge ou catégorie : la ligne la plus précise gagne (sexe, puis âge, puis catégorie)', () => {
  const rc = cfg.criteria.find((c) => c.criterionId === 'sprint_10')!
  // Fille 15 ans : sexe + âge.
  assert.equal(repereLine(rc, fille, DAY)?.age, 15)
  // Fille 14 ans (mesure de juin 2026, saison 2025-2026) : sexe + catégorie U15.
  assert.equal(repereLine(rc, fille, '2026-06-01')?.cat, 'U15')
  assert.equal(medalFor(cfg, sprint, 2.2, fille, '2026-06-01'), 'argent')
  // Garçon 15 ans : pas de ligne garçon U15 → ligne « tous ».
  assert.deepEqual(repereLine(rc, garcon, DAY), { bronze: 2.3, argent: 2.1, or: 1.9 })
  // Garçon U13 (né en 2014, âge de saison 13) : sa ligne (bronze seul).
  assert.equal(medalFor(cfg, sprint, 2.55, { sex: 'M', birthDate: '2014-01-01' }, DAY), 'bronze')
  // Âge inconnu : catégorie écrite sur la fiche si c'est un code connu ; sinon ligne « tous ».
  assert.equal(repereLine(rc, { sex: 'F', category: 'u15' }, DAY)?.cat, 'U15')
  assert.deepEqual(repereLine(rc, { sex: 'F', category: '-18 nat' }, DAY), { bronze: 2.3, argent: 2.1, or: 1.9 })
})

t('sens inconnu : aucune médaille, sauf sens choisi au réglage', () => {
  assert.equal(medalFor(cfg, gainage, 200, fille, DAY), undefined)
  const withDir = cleanReperes({ criteria: [{ criterionId: 'gainage_maison', dir: 1, lines: [{ bronze: 60, argent: 90, or: 120 }] }] })
  assert.equal(medalFor(withDir, gainage, 95, fille, DAY), 'argent')
  // Le sens du réglage passe devant celui du critère.
  const reversed = cleanReperes({ criteria: [{ criterionId: 'cmj_hauteur', dir: -1, lines: [{ bronze: 40, or: 30 }] }] })
  assert.equal(medalFor(reversed, cmj, 30, garcon, DAY), 'or')
  assert.equal(medalFor(reversed, cmj, 45, garcon, DAY), undefined)
})

t('absence de repère : rien (critère sans repère, aucun repère, autre échelle, valeur non numérique)', () => {
  assert.equal(hasReperes(cleanReperes(undefined)), false)
  assert.equal(medalFor(cleanReperes(null), sprint, 1.5, fille, DAY), undefined)
  assert.equal(medalFor(cfg, crit('sprint_30'), 3, fille, DAY), undefined)
  assert.equal(medalFor(cfg, crit('sprint_10', { scale: 'score5' }), 1, fille, DAY), undefined)
  assert.equal(medalFor(cfg, sprint, 'blessé', fille, DAY), undefined)
  assert.equal(medalFor(cfg, sprint, '', fille, DAY), undefined)
  assert.equal(medalFor(cfg, undefined, 2, fille, DAY), undefined)
  // Valeur écrite en texte avec une virgule : lue.
  assert.equal(numericValue('2,05'), 2.05)
  assert.equal(medalFor(cfg, sprint, '2,05', fille, DAY), 'or')
})

t('lecture de la valeur stockée : illisible écarté, libellés réglables, ligne de configuration', () => {
  const c = cleanReperes({
    labels: { or: '  Niveau national  ', argent: '', bronze: 3 },
    criteria: [
      { criterionId: 'x', lines: [{ sex: 'X', age: 14.5, cat: 'U15', bronze: '2' }] }, // aucun seuil lisible → critère écarté
      { criterionId: 'y', lines: [{ age: 14, cat: 'U15', or: 10 }, 'n’importe quoi'] },
      { criterionId: 'y', lines: [{ or: 1 }] }, // doublon écarté
      { lines: [{ or: 1 }] },
    ],
  })
  assert.equal(c.labels.or, 'Niveau national')
  assert.equal(c.labels.argent, DEFAULT_MEDAL_LABELS.argent)
  assert.equal(c.labels.bronze, DEFAULT_MEDAL_LABELS.bronze)
  assert.deepEqual(c.criteria, [{ criterionId: 'y', lines: [{ age: 14, or: 10 }] }])
  assert.deepEqual(cleanReperes('rien').labels, DEFAULT_MEDAL_LABELS)
  const rows = [
    { id: REPERES_KEY, key: REPERES_KEY, value: { criteria: [{ criterionId: 'cmj_hauteur', lines: [{ or: 50 }] }] } },
    { id: 'sport', key: 'sport', value: { sport: 'handball' } },
  ]
  assert.equal(reperesOf(rows).criteria.length, 1)
  assert.equal(reperesOf([{ ...rows[0], deleted: true }]).criteria.length, 0)
})

t('ordre des seuils au réglage, et « pour qui »', () => {
  assert.equal(lineOrderProblem({ bronze: 30, argent: 35, or: 40 }, 1), null)
  assert.match(lineOrderProblem({ bronze: 30, argent: 28 }, 1)!, /Argent doit être plus haut que Bronze/)
  assert.equal(lineOrderProblem({ bronze: 2.4, or: 2.0 }, -1), null)
  assert.match(lineOrderProblem({ bronze: 2.4, argent: 2.4 }, -1)!, /plus bas/)
  assert.equal(lineWho({ sex: 'F', cat: 'U15' }), 'Filles · U15')
  assert.equal(lineWho({ sex: 'M', age: 14 }), 'Garçons · 14 ans')
  assert.equal(lineWho({}), 'Tous')
})

t('volley : catégories M13 / M15 / M18, T-test plus bas est mieux, hauteur d’attaque plus haut', () => {
  applySportConfig(VOLLEYBALL)
  try {
    const vcfg = cleanReperes({
      criteria: [
        { criterionId: 't_test', lines: [{ sex: 'F', cat: 'M15', bronze: 12, argent: 11.5, or: 11 }] },
        { criterionId: 'hauteur_attaque', lines: [{ sex: 'M', cat: 'M18', bronze: 300, argent: 315, or: 330 }] },
      ],
    })
    const tt = crit('t_test')
    const ha = crit('hauteur_attaque', { unit: 'cm' })
    assert.equal(medalFor(vcfg, tt, 11.4, fille, DAY), 'argent')
    assert.equal(medalFor(vcfg, tt, 12.5, fille, DAY), undefined)
    // Garçon né en 2010 : âge de saison 17 → M18.
    assert.equal(medalFor(vcfg, ha, 330, { sex: 'M', birthDate: '2010-03-01' }, DAY), 'or')
    // Les catégories du handball ne servent pas au volley.
    assert.equal(medalFor(cleanReperes({ criteria: [{ criterionId: 't_test', lines: [{ cat: 'U15', or: 11 }] }] }), tt, 10, fille, DAY), undefined)
    // Catégories passées explicitement : celles données.
    assert.equal(medalFor(vcfg, tt, 11, fille, DAY, SPORT_CONTENT.volley.youthCategories), 'or')
  } finally {
    applySportConfig(HANDBALL)
  }
})

console.log(`\n${n} tests passés`)
