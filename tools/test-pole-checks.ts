// Test du garde-fou des périodes de pôle (src/poleChecks.ts) : sortie avant l'entrée refusée ; âge à l'entrée hors 12–17 ans,
// chevauchement, entrée à plus d'un an d'ici en simples avertissements ; rien pour une arrivée de la saison prochaine ni
// pour un pôle ancien ; textes accordés au sexe, neutres. Données fictives seulement.
//
//   npx jiti tools/test-pole-checks.ts
import assert from 'node:assert/strict'
import { ageAt, poleBlocking, poleBlockMessage, poleIssues } from '../src/poleChecks'

let n = 0
const t = (name: string, f: () => void) => {
  f()
  n++
  console.log(`ok ${n} - ${name}`)
}

const TODAY = '2026-11-23'
const kinds = (xs: ReturnType<typeof poleIssues>) => xs.map((x) => `${x.index}:${x.kind}:${x.level}`)

t('âge exact à une date (anniversaire compris)', () => {
  assert.equal(ageAt('2010-09-01', '2024-08-31'), 13)
  assert.equal(ageAt('2010-09-01', '2024-09-01'), 14)
  assert.equal(ageAt('2008-02-29', '2026-02-28'), 17)
  assert.equal(ageAt('2008-02-29', '2026-03-01'), 18)
})

t('périodes cohérentes : rien (entrée à 14 ans, sortie après, arrivée de la saison prochaine, pôle bien avant toute observation)', () => {
  const ok = poleIssues(
    [
      { regionId: 'region-sud', site: 'Nice', from: '2023-09-01', to: '2025-06-30', exitReason: 'fin_cursus' },
      { regionId: 'region-sud', site: 'Nice', from: '2027-07-01' },
    ],
    { today: TODAY, birthDate: '2010-05-26', sex: 'F' },
  )
  assert.deepEqual(ok, [])
  assert.equal(poleBlocking(ok), false)
  assert.equal(poleBlockMessage(ok), null)
  // Sortie le jour même de l'entrée : accepté.
  assert.deepEqual(poleIssues([{ from: '2025-09-01', to: '2025-09-01' }], { today: TODAY }), [])
  // Période vide (ligne ajoutée, rien de saisi) ou incomplète : rien.
  assert.deepEqual(poleIssues([{}, { regionId: 'region-ara' }, { to: '2026-06-30' }], { today: TODAY, birthDate: '2011-01-01' }), [])
  assert.deepEqual(poleIssues(undefined, { today: TODAY }), [])
})

t('sortie avant l\'entrée : refusée, message clair, enregistrement bloqué', () => {
  const xs = poleIssues([{ from: '2026-09-01', to: '2026-06-30' }], { today: TODAY, birthDate: '2012-03-10' })
  assert.deepEqual(kinds(xs), ['0:sortie_avant_entree:error'])
  assert.match(xs[0].message, /La sortie \(30 juin 2026\) est avant l'entrée \(1er septembre 2026\)/)
  assert.equal(poleBlocking(xs), true)
  assert.match(poleBlockMessage(xs)!, /une période a sa sortie avant son entrée/)
  const two = poleIssues([{ from: '2026-09-01', to: '2026-06-30' }, { from: '2024-09-01', to: '2023-06-30' }], { today: TODAY })
  assert.match(poleBlockMessage(two)!, /2 périodes ont leur sortie avant leur entrée/)
  // Une période à l'envers ne compte pas dans les chevauchements.
  assert.ok(!two.some((x) => x.kind === 'chevauchement'))
})

t('âge à l\'entrée : avertissement avant 12 ans et à 18 ans ou plus (d\'après la date de naissance), accordé au sexe', () => {
  const young = poleIssues([{ from: '2023-09-01' }], { today: TODAY, birthDate: '2012-02-01', sex: 'M' })
  assert.deepEqual(kinds(young), ['0:age:warning'])
  assert.match(young[0].message, /^Entré à 11 ans d'après la date de naissance/)
  assert.equal(poleBlocking(young), false)
  const old = poleIssues([{ from: '2027-07-01' }], { today: TODAY, birthDate: '2008-02-01', sex: 'F' })
  assert.deepEqual(kinds(old), ['0:age:warning'])
  assert.match(old[0].message, /^Entrée à 19 ans/)
  // 12 ans et 17 ans : pas d'avertissement.
  assert.deepEqual(poleIssues([{ from: '2024-09-01' }], { today: TODAY, birthDate: '2012-03-01' }), [])
  assert.deepEqual(poleIssues([{ from: '2026-09-01' }], { today: TODAY, birthDate: '2009-01-15' }), [])
  // Sans date de naissance (ou invalide) : pas de contrôle d'âge.
  assert.deepEqual(poleIssues([{ from: '2015-09-01' }], { today: TODAY }), [])
  assert.deepEqual(poleIssues([{ from: '2015-09-01' }], { today: TODAY, birthDate: '2009' }), [])
})

t('chevauchement : avertissement sous la seconde période, sortie vide = au pôle', () => {
  const xs = poleIssues(
    [
      { site: 'Nice', from: '2024-09-01' },
      { site: 'Aix-en-Provence', from: '2025-09-01', to: '2026-06-30' },
    ],
    { today: TODAY, birthDate: '2010-04-04' },
  )
  assert.deepEqual(kinds(xs), ['1:chevauchement:warning'])
  assert.equal(xs[0].other, 0)
  assert.match(xs[0].message, /recouvre la 1re période/)
  // Bout à bout (sortie le 30 juin, entrée le 1er juillet) : rien.
  assert.deepEqual(poleIssues([{ from: '2024-09-01', to: '2026-06-30' }, { from: '2026-07-01' }], { today: TODAY, birthDate: '2010-04-04' }), [])
  // Même jour de sortie et d'entrée : un jour en commun.
  assert.deepEqual(kinds(poleIssues([{ from: '2024-09-01', to: '2026-07-01' }, { from: '2026-07-01' }], { today: TODAY })), ['1:chevauchement:warning'])
})

t('entrée à plus d\'un an d\'ici : avertissement ; la saison prochaine (1er juillet) non', () => {
  assert.deepEqual(poleIssues([{ from: '2027-07-01' }], { today: TODAY }), [])
  assert.deepEqual(poleIssues([{ from: '2027-11-23' }], { today: TODAY }), [])
  const far = poleIssues([{ from: '2027-11-24' }], { today: TODAY })
  assert.deepEqual(kinds(far), ['0:futur:warning'])
  assert.match(far[0].message, /24 novembre 2027 : plus d'un an d'ici/)
})

t('plusieurs problèmes : triés par période, le refus d\'abord ; textes neutres (jamais d\'étiquette sur le jeune)', () => {
  const xs = poleIssues([{ from: '2030-09-01', to: '2029-06-30' }, { from: '2020-09-01' }], { today: TODAY, birthDate: '2012-06-01', sex: 'F' })
  assert.deepEqual(kinds(xs), ['0:sortie_avant_entree:error', '0:age:warning', '0:futur:warning', '1:age:warning'])
  for (const x of xs) assert.doesNotMatch(x.message, /pas retenu|faible|mauvais|échec|trop jeune|trop vieux|trop âgé/i)
})

console.log(`\n${n} tests OK`)
