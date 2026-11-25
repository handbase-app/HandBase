// Test du défilement des longues listes (src/listWindow.ts, utilisé par components/InfiniteList.tsx) : hauteurs des rangées
// (mesurées ou estimées, une ou deux colonnes), rangée sous une hauteur, fenêtre dessinée (~60 lignes, paquets de 10),
// marges au-dessus et en dessous, mesures lues sur la page, retour sur la liste à la même ligne. Données fictives.
//
//   npx jiti tools/test-defilement.ts
import assert from 'node:assert/strict'
import { estimateOf, itemAt, olderDays, lineAt, lineCount, lineOffsets, linePitches, offsetOf, paddings, storePitches, windowRange } from '../src/listWindow'

const keys = (n: number) => Array.from({ length: n }, (_, i) => `joueur-${i + 1}`)

// ---------- Rangées ----------
assert.equal(lineCount(0, 1), 0)
assert.equal(lineCount(5, 1), 5)
assert.equal(lineCount(5, 2), 3)
assert.equal(lineCount(40_000, 2), 20_000)

// ---------- Hauteurs : estimées, puis mesurées (deux colonnes : la plus haute de la rangée) ----------
{
  const k = keys(5)
  const h = new Map<string, number>()
  assert.deepEqual([...lineOffsets(k, 1, h, 60)], [0, 60, 120, 180, 240, 300])
  h.set('joueur-2', 80)
  assert.deepEqual([...lineOffsets(k, 1, h, 60)], [0, 60, 140, 200, 260, 320])
  // Deux colonnes : rangées (1, 2), (3, 4), (5) ; la 1re prend 80 (joueur 2), les autres l'estimation.
  assert.deepEqual([...lineOffsets(k, 2, h, 60)], [0, 80, 140, 200])
  h.set('joueur-3', 50)
  assert.deepEqual([...lineOffsets(k, 2, h, 60)], [0, 80, 130, 190])
}

// ---------- Rangée sous une hauteur ----------
{
  const off = lineOffsets(keys(10), 1, new Map(), 50) // 0, 50, …, 500
  assert.equal(lineAt(off, -100), 0)
  assert.equal(lineAt(off, 0), 0)
  assert.equal(lineAt(off, 49.9), 0)
  assert.equal(lineAt(off, 50), 1)
  assert.equal(lineAt(off, 275), 5)
  assert.equal(lineAt(off, 499), 9)
  assert.equal(lineAt(off, 10_000), 9)
  assert.equal(lineAt(new Float64Array(1), 30), 0)
}

// ---------- Fenêtre : 40 000 fiches, téléphone (une colonne, lignes de 60 px, écran de 700 px) ----------
{
  const n = 40_000
  const off = lineOffsets(keys(n), 1, new Map(), 60)
  assert.equal(off[n], 2_400_000)
  // En haut : rangées 0 à 11 visibles, + 20 de marge, arrondi au paquet de 10 suivant.
  let w = windowRange(off, n, 1, 0, 700, 20, 10)
  assert.deepEqual(w, { start: 0, end: 40, top: 0, bottom: (n - 40) * 60 })
  // Liste plus bas que le haut de l'écran (barre « Demander » au-dessus) : même début.
  assert.equal(windowRange(off, n, 1, -300, 400, 20, 10).start, 0)
  // Au milieu (ligne 20 000 en haut de l'écran) : une soixantaine de lignes, marges exactes.
  w = windowRange(off, n, 1, 20_000 * 60, 20_000 * 60 + 700, 20, 10)
  assert.equal(w.start, 19_980)
  assert.equal(w.end, 20_040)
  assert.equal(w.end - w.start, 60)
  assert.equal(w.top, 19_980 * 60)
  assert.equal(w.bottom, (n - 20_040) * 60)
  // Marges + lignes dessinées = hauteur totale : la barre de défilement reste juste.
  assert.equal(w.top + (w.end - w.start) * 60 + w.bottom, off[n])
  // Quelques pixels plus bas : même fenêtre (elle ne bouge que tous les 10 éléments).
  assert.deepEqual(windowRange(off, n, 1, 20_000 * 60 + 100, 20_000 * 60 + 800, 20, 10), w)
  // 10 lignes plus bas : on ajoute les 10 suivantes, on retire les 10 d'avant.
  const next = windowRange(off, n, 1, 20_010 * 60, 20_010 * 60 + 700, 20, 10)
  assert.deepEqual([next.start, next.end], [19_990, 20_050])
  // Tout en bas : jusqu'au dernier, pas de marge en dessous.
  w = windowRange(off, n, 1, off[n] - 700, off[n], 20, 10)
  assert.equal(w.end, n)
  assert.equal(w.bottom, 0)
  // Barre de défilement tirée d'un coup (bien plus bas que la liste) : la fin de la liste.
  assert.equal(windowRange(off, n, 1, 9e9, 9e9 + 700, 20, 10).end, n)
}

// ---------- Fenêtre : deux colonnes (grand écran), bornes sur des rangées entières ----------
{
  const n = 5_001 // nombre impair : dernière rangée à un seul élément
  const off = lineOffsets(keys(n), 2, new Map(), 70)
  const w = windowRange(off, n, 2, 1_000 * 70, 1_000 * 70 + 900, 20, 10)
  assert.equal(w.start % 2, 0, 'début sur la 1re colonne')
  assert.equal(w.start, 1_980)
  assert.equal(w.end, 2_050) // rangées 990 à 1 024 : 35 rangées, 70 éléments
  assert.equal(w.top, (1_980 / 2) * 70)
  const end = windowRange(off, n, 2, off[off.length - 1] - 900, off[off.length - 1], 20, 10)
  assert.equal(end.end, n, 'dernier élément seul sur sa rangée compris')
}

// ---------- Écart entre les rangées : pas d'écart sous la dernière dessinée ----------
{
  const n = 1_000
  const off = lineOffsets(keys(n), 1, new Map(), 68) // 60 px + 8 px d'écart
  const p = paddings(off, n, 1, 100, 160, 8)
  assert.equal(p.top, 100 * 68)
  assert.equal(p.bottom, (n - 160) * 68 - 8)
  // Fenêtre au-delà de la liste (liste raccourcie par un filtre) : bornée.
  assert.deepEqual(paddings(off, 50, 1, 100, 160, 8), { start: 50, end: 50, top: 50 * 68, bottom: 0 })
}

// ---------- Mesures lues sur la page ----------
{
  // Une colonne, rangées de 60, 90, 60 px, sans écart.
  assert.deepEqual(linePitches([0, 60, 150], [60, 150, 210], 1), [60, 90, 60])
  // Écart de 8 px : du haut d'une rangée au haut de la suivante ; la dernière : sa hauteur + l'écart.
  assert.deepEqual(linePitches([0, 68, 136], [60, 128, 196], 1, 8), [68, 68, 68])
  // Deux colonnes : la rangée suit l'élément le plus haut.
  assert.deepEqual(linePitches([0, 0, 90, 90], [60, 90, 150, 140], 2), [90, 60])
  const h = new Map<string, number>()
  const k = keys(10)
  assert.equal(storePitches(h, k, 4, 2, [90, 60]), true)
  assert.deepEqual([...h], [['joueur-5', 90], ['joueur-6', 90], ['joueur-7', 60], ['joueur-8', 60]])
  // Mêmes mesures (à un demi-pixel près) : rien ne change, pas de nouveau rendu.
  assert.equal(storePitches(h, k, 4, 2, [90.3, 60]), false)
  assert.equal(estimateOf([60, 62, 200, 61, 0], 64), 62)
  assert.equal(estimateOf([], 64), 64)
}

// ---------- Retour sur la liste : mêmes mesures → même page, même ligne en haut ----------
{
  const n = 40_000
  const k = keys(n)
  const h = new Map<string, number>()
  // Lignes vues pendant le défilement (hauteurs variées), les autres estimées.
  for (let i = 30_000; i < 30_100; i++) h.set(k[i], 60 + (i % 3) * 12)
  const before = lineOffsets(k, 1, h, 64)
  const y = offsetOf(before, 1, 30_050) + 17 // 17 px dans la ligne 30 051
  assert.equal(itemAt(before, 1, y), 30_050)
  // Au retour : mêmes mesures gardées → même hauteur totale, même ligne sous la même position.
  const after = lineOffsets(k, 1, new Map(h), 64)
  assert.equal(after[n], before[n])
  assert.equal(itemAt(after, 1, y), 30_050)
  const w = windowRange(after, n, 1, y, y + 700, 20, 10)
  assert.ok(w.start <= 30_050 && 30_050 < w.end, 'la ligne est dessinée')
  // Deux colonnes : la position revient sur la rangée de l'élément (son début).
  const off2 = lineOffsets(k, 2, new Map(), 70)
  assert.equal(itemAt(off2, 2, offsetOf(off2, 2, 12_345)), 12_344)
}

// ---------- Fil par périodes : 60 jours de plus, plus loin d'un coup quand rien n'arrive, borné ----------
assert.equal(olderDays(30, true, 1095), 90)
assert.equal(olderDays(30, false, 1095), 90)
assert.equal(olderDays(90, false, 1095), 180)
assert.equal(olderDays(180, true, 1095), 240)
assert.equal(olderDays(720, false, 1095), 1095)
assert.equal(olderDays(1095, false, 1095), 1095)
{
  // Fil vide au-delà de 30 jours : la fin (3 ans) en 5 lectures au lieu de 18.
  let d = 30
  let reads = 0
  while (d < 1095) (d = olderDays(d, false, 1095)), reads++
  assert.equal(reads, 5)
}

console.log('✓ défilement des longues listes : fenêtre, marges, mesures, retour à la même ligne')
