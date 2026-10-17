// Test des pastilles du séquençage (src/seqPills.ts) : libellés courts et longs, abréviation des équipes, couleurs
// d'équipe (contraste du texte blanc, distinctes entre elles, du vert « calée » et du jaune de la cible), empilement des
// pastilles proches sur deux rangées. Noms d'équipes fictifs.
//
//   npx jiti tools/test-pastilles.ts
import assert from 'node:assert/strict'
import type { ActionKind } from '../src/matchSheet'
import { AIM_COLOR, contrast, FIXED_COLOR, hueGap, NO_TEAM, pillLabel, pillWidth, stackLanes, teamAbbr, TEAM_COLOR, type PillKind } from '../src/seqPills'

// Libellés : texte court sur la pastille, long dans l'annonce.
assert.equal(pillLabel('but').short, 'BUT')
assert.equal(pillLabel('but7').short, '7 M')
assert.equal(pillLabel('but7').long, 'But sur 7 m')
assert.equal(pillLabel('tir7').short, '7 M ✕')
assert.equal(pillLabel('arret').short, 'ARRÊT')
assert.equal(pillLabel('2mn').short, '2′')
assert.equal(pillLabel('avert').glyph, 'card')
assert.equal(pillLabel('disq').long, 'Carton rouge')
assert.equal(pillLabel('tm').short, 'TM')
// Tir : toujours un tir raté (un tir réussi est un but). Perte de balle et passe décisive : prêtes pour une saisie future
// (« + Action »), pas sur la feuille.
assert.equal(pillLabel('tir').short, 'TIR')
assert.equal(pillLabel('tir').long, 'Tir raté')
assert.equal(pillLabel('tir7').long, '7 m raté')
assert.equal(pillLabel('passe').short, 'PASSE')
assert.equal(pillLabel('passe').long, 'Passe décisive')
assert.equal(pillLabel('perte').short, 'PERTE')
assert.equal(pillLabel('perte').long, 'Perte de balle')
assert.equal(pillLabel('autre', 'Commotion cérébrale').short, 'COMMOTION')
assert.equal(pillLabel('autre', 'Commotion cérébrale').long, 'Commotion cérébrale')
assert.equal(pillLabel('autre').short, 'ACTION')
assert.equal(pillLabel('autre', 'Interruptionlongue').short, 'INTERRUP.')
const all: PillKind[] = ['but', 'but7', 'tir', 'tir7', 'arret', 'arret7', '2mn', 'avert', 'disq', 'bleu', 'tm', 'autre', 'perte', 'passe'] satisfies (ActionKind | 'perte' | 'passe')[]
for (const k of all) assert.ok(pillLabel(k).short.length <= 9 && pillLabel(k).long, k)
assert.equal(new Set(all.map((k) => pillLabel(k).short)).size, all.length, 'libellés courts tous différents')

// Abréviations : 3 lettres comme un tableau d'affichage, sans forme de club, article ni catégorie ; toujours différentes.
assert.deepEqual(teamAbbr('HBC Rhône Sud', 'Handball Collines'), { home: 'RHS', away: 'COL' })
assert.deepEqual(teamAbbr('Entente Drôme-Ardèche -15 M', 'AS Vallée Bleue'), { home: 'DRA', away: 'VAB' })
assert.deepEqual(teamAbbr('US Les Trois Rivières', 'HB Plaine'), { home: 'TRR', away: 'PLA' })
assert.deepEqual(teamAbbr('HB Valence 1', 'HB Valence 2'), { home: 'VAL1', away: 'VAL2' })
assert.deepEqual(teamAbbr('HB Valence', 'Valence HB'), { home: 'LOC', away: 'VIS' })
assert.deepEqual(teamAbbr('', 'HBC'), { home: 'LOC', away: 'VIS' })

// Couleurs : texte blanc lisible (≥ 4,5:1), équipes distinctes entre elles, du vert « calée » et du jaune de la cible.
for (const c of [TEAM_COLOR.home, TEAM_COLOR.away, NO_TEAM]) assert.ok(contrast(c, '#ffffff') >= 4.5, `${c} : ${contrast(c, '#ffffff').toFixed(2)}`)
assert.ok(Math.abs(contrast('#000000', '#ffffff') - 21) < 1e-9)
assert.ok(hueGap(TEAM_COLOR.home, TEAM_COLOR.away) >= 120, 'bleu / orange')
for (const c of [TEAM_COLOR.home, TEAM_COLOR.away]) {
  assert.ok(hueGap(c, FIXED_COLOR) >= 40, `${c} / vert`)
  assert.ok(hueGap(c, AIM_COLOR) >= 30, `${c} / jaune`)
}

// Empilement : isolées → rangée du haut ; proches → l'une en bas ; l'action annoncée occupe toutes les rangées.
assert.deepEqual(stackLanes([{ x: 100, w: 60 }, { x: 300, w: 60 }]), [0, 0])
assert.deepEqual(stackLanes([{ x: 100, w: 60 }, { x: 130, w: 60 }, { x: 160, w: 60 }, { x: 300, w: 60 }]), [0, 1, 0, 0])
assert.deepEqual(stackLanes([{ x: 300, w: 60 }, { x: 100, w: 60 }, { x: 130, w: 60 }]), [0, 0, 1], 'dans l’ordre de x')
assert.deepEqual(stackLanes([{ x: 100, w: 140, block: true }, { x: 150, w: 60 }, { x: 250, w: 60 }]), [-1, 0, 0])
// Trop serrées pour deux rangées : la moins chargée (recouvrement inévitable, mais réparti).
assert.deepEqual(stackLanes([{ x: 100, w: 60 }, { x: 110, w: 60 }, { x: 120, w: 60 }]), [0, 1, 0])
// La rangée ne dépend que des écarts : décaler toute la frise (défilement) ne change rien.
const row = [40, 70, 95, 200, 215, 400].map((x) => ({ x, w: 60 }))
assert.deepEqual(stackLanes(row), stackLanes(row.map((b) => ({ ...b, x: b.x - 333 }))))
assert.ok(pillWidth(['BUT', 'RHS n°7'], 12, 18) > pillWidth(['BUT'], 12, 18))

// Match chargé (fictif) : 60 actions, une toutes les ~30 s, frise de 1100 px sur 60 s : sur deux rangées, aucune pastille
// n'en recouvre une autre de sa rangée tant que deux actions consécutives sont à plus de ~2 s l'une de l'autre.
{
  const W = 1100
  const scale = ((1 - 1 / 3) / 60) * W
  let t = 0
  const ts = Array.from({ length: 60 }, (_, i) => (t += i % 5 === 4 ? 3 : 25 + (i % 3) * 5))
  const boxes = ts.map((v) => ({ x: v * scale, w: 62 }))
  const lanes = stackLanes(boxes)
  for (let i = 0; i < boxes.length; i++)
    for (let j = i + 1; j < boxes.length; j++)
      if (lanes[i] === lanes[j]) assert.ok(Math.abs(boxes[i].x - boxes[j].x) >= 62, `${i} et ${j} se recouvrent`)
}

console.log('test-pastilles : ok')
