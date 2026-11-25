// Test du signe d'attente (src/attente.ts, src/aiWait.ts) : moyenne glissante des durées par sorte de demande, avancée de la
// barre selon le temps écoulé (90 % à la durée habituelle, puis presque à l'arrêt, jamais 100 % avant la réponse), seuil
// « Encore un instant… » (2 × la durée habituelle), « ≈ 2 s » seulement si fiable, relecture prudente du stockage, durée
// notée seulement pour une demande aboutie. Et les accélérations de la recherche par nom (src/nameMatch.ts) : mêmes résultats
// que le calcul d'avant.
//
//   npx jiti tools/test-attente.ts
import assert from 'node:assert/strict'
import { addSample, DEFAULT_MS, etaText, expectedMs, HOLD_AT, isSlow, parseStats, progressAt, waitText, type WaitStat } from '../src/attente'
import { timeAi, waitStat } from '../src/aiWait'
import { levenshtein, nameLike, nameLikeFor } from '../src/nameMatch'

// ---------- 1. Moyenne glissante ----------
{
  assert.equal(expectedMs(undefined), DEFAULT_MS, 'rien de mesuré : 2,5 s')
  let s: WaitStat | undefined
  s = addSample(s, 2000)
  assert.deepEqual(s, { avg: 2000, dev: 0, n: 1 }, 'première mesure : la moyenne')
  s = addSample(s, 3000)
  assert.equal(s!.avg, 2300, 'moyenne glissante (30 % de la nouvelle mesure)')
  assert.equal(s!.dev, 300, 'écart glissant')
  assert.equal(s!.n, 2)
  assert.equal(expectedMs(s), 2300)
  // Valeurs aberrantes : ignorées (même objet rendu).
  assert.equal(addSample(s, 50), s, 'moins de 0,1 s : ignoré')
  assert.equal(addSample(s, 120_000), s, 'plus d’une minute (veille, réseau perdu) : ignoré')
  assert.equal(addSample(s, NaN), s)
  assert.equal(addSample(undefined, 20), undefined)
  // Durées qui changent : la moyenne suit en quelques demandes.
  let t: WaitStat | undefined
  for (let i = 0; i < 10; i++) t = addSample(t, 2000)
  for (let i = 0; i < 6; i++) t = addSample(t, 6000)
  assert.ok(t!.avg > 5000 && t!.avg < 6000, `la moyenne suit les durées récentes (${t!.avg})`)
}

// ---------- 2. Avancée de la barre ----------
{
  const E = 2000
  assert.equal(progressAt(0, E), 0)
  assert.ok(Math.abs(progressAt(E, E) - HOLD_AT) < 1e-9, '90 % à la durée habituelle')
  assert.ok(progressAt(E / 2, E) > 0.45 * HOLD_AT * 1.4, 'vite au début (plus de la moitié du chemin à mi-temps)')
  let prev = -1
  for (let ms = 0; ms <= 20 * E; ms += 50) {
    const p = progressAt(ms, E)
    assert.ok(p >= prev, `jamais en arrière (${ms} ms)`)
    assert.ok(p < 0.97, `jamais fini avant la réponse (${ms} ms : ${p})`)
    prev = p
  }
  assert.ok(progressAt(2 * E, E) - progressAt(E, E) < 0.05, 'après la durée habituelle : presque à l’arrêt')
  assert.equal(progressAt(-10, E), 0, 'temps négatif : 0')
  assert.ok(progressAt(100, 0) > 0.8, 'durée nulle : pas de division par zéro')
}

// ---------- 3. Textes : « Je cherche… », « Encore un instant… » ----------
{
  assert.equal(waitText(0, 2000), 'Je cherche…')
  assert.equal(waitText(4000, 2000), 'Je cherche…', 'exactement 2 × : encore « Je cherche… »')
  assert.equal(waitText(4001, 2000), 'Encore un instant…', 'au-delà de 2 × la durée habituelle')
  assert.ok(!isSlow(3000, 2000) && isSlow(5000, 2000))
}

// ---------- 4. « ≈ 2 s » seulement si fiable ----------
{
  assert.equal(etaText(undefined, 0), null, 'rien de mesuré : pas de temps affiché')
  let s: WaitStat | undefined
  for (const ms of [2100, 2300]) s = addSample(s, ms)
  assert.equal(etaText(s, 0), null, 'moins de 3 mesures : pas de temps')
  s = addSample(s, 2200)
  assert.equal(etaText(s, 0), '≈ 2 s', 'durées régulières : ≈ 2 s')
  assert.equal(etaText(s, 3000), null, 'durée habituelle dépassée : plus de temps affiché')
  let irregular: WaitStat | undefined
  for (const ms of [800, 5000, 1200, 6000, 900]) irregular = addSample(irregular, ms)
  assert.equal(etaText(irregular, 0), null, 'durées très variables : pas de faux chiffre')
  assert.equal(etaText({ avg: 600, dev: 50, n: 5 }, 0), '≈ 1 s')
  assert.equal(etaText({ avg: 12_400, dev: 900, n: 5 }, 0), '≈ 10 s', 'long : arrondi à 5 s')
}

// ---------- 5. Relecture du stockage ----------
{
  assert.deepEqual(parseStats(null), {})
  assert.deepEqual(parseStats('pas du json'), {})
  assert.deepEqual(parseStats('[1,2]'), {})
  assert.deepEqual(parseStats(JSON.stringify({ question: { avg: 2400.4, dev: 300, n: 4 } })), { question: { avg: 2400, dev: 300, n: 4 } })
  const bad = parseStats(
    JSON.stringify({
      question: { avg: 'x', dev: 1, n: 1 },
      action: { avg: -5, dev: 1, n: 1 },
      sql: { avg: 2000, dev: 1, n: 0 },
      'Mode<script>': { avg: 2000, dev: 1, n: 1 },
      dictee: { avg: 1500, dev: 100, n: 5000 },
    }),
  )
  assert.deepEqual(bad, { dictee: { avg: 1500, dev: 100, n: 999 } }, 'valeurs douteuses écartées')
}

// ---------- 6. Durée notée seulement pour une demande aboutie ----------
{
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
  assert.equal(waitStat('essai_test'), undefined)
  const r = await timeAi('essai_test', async () => (await wait(150), 42))
  assert.equal(r, 42, 'la réponse passe telle quelle')
  const s = waitStat('essai_test')
  assert.ok(s && s.n === 1 && s.avg >= 140 && s.avg < 1000, `durée mesurée côté appareil (${s?.avg} ms)`)
  await assert.rejects(timeAi('essai_test', async () => (await wait(150), Promise.reject(new Error('annule')))))
  assert.equal(waitStat('essai_test')!.n, 1, 'erreur ou annulation : pas comptée')
}

// ---------- 7. Recherche par nom : mêmes résultats qu'avant les accélérations ----------
{
  // Distance d'édition d'avant (tableaux neufs à chaque appel), pour comparaison.
  const oldLev = (a: string, b: string, max = 2): number => {
    if (Math.abs(a.length - b.length) > max) return max + 1
    let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
    for (let i = 1; i <= a.length; i++) {
      const cur = [i]
      let best = i
      for (let j = 1; j <= b.length; j++) {
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
        best = Math.min(best, cur[j])
      }
      if (best > max) return max + 1
      prev = cur
    }
    return prev[b.length]
  }
  let seed = 5
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31)
  const word = (n: number) => Array.from({ length: n }, () => 'abcdeilmnorstu'[Math.floor(rnd() * 14)]).join('')
  for (let k = 0; k < 20_000; k++) {
    const a = word(1 + Math.floor(rnd() * 9))
    const b = rnd() < 0.3 ? a.slice(0, -1) + word(1) : word(1 + Math.floor(rnd() * 9))
    const max = rnd() < 0.5 ? 1 : 2
    assert.equal(levenshtein(a, b, max), oldLev(a, b, max), `levenshtein(${a}, ${b}, ${max})`)
  }
  const long = 'a'.repeat(70)
  assert.equal(levenshtein(long, long.slice(1) + 'b', 2), oldLev(long, long.slice(1) + 'b', 2), 'mot très long')
  assert.equal(levenshtein('', '', 2), 0)
  for (const [w, t, ok] of [
    ['mateo', 'matteo', true],
    ['lukas', 'lucas', true],
    ['dupond', 'dupont', true],
    ['le', 'lea', false],
    ['martin', 'morel', false],
    ['jean2', 'jean', false],
  ] as const) {
    assert.equal(nameLike(w, t), ok, `${w} ~ ${t}`)
    assert.equal(nameLikeFor(w)(t), ok)
  }
}

console.log('test-attente : OK')
