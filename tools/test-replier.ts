// Test des sections repliables des listes Événements et Groupes (src/fold.ts, src/components/FoldSection.tsx) : sections
// repliées au départ (passés, archivés), clés de session distinctes par page et par section, nombre du titre.
//
//   npx jiti tools/test-replier.ts
import assert from 'node:assert/strict'
import { foldCount, foldKey, startsOpen } from '../src/fold'

// ---------- 1. Dépliée ou repliée au départ ----------
{
  assert.equal(startsOpen('current'), true, 'À venir, Pôles, groupes en cours : dépliés')
  assert.equal(startsOpen('past'), false, 'événements passés : repliés')
  assert.equal(startsOpen('archived'), false, 'archivés : repliés')
}

// ---------- 2. Clés de session ----------
{
  assert.equal(foldKey('evenements', 'passes'), 'handbase.evenements.replier.passes')
  assert.equal(foldKey('groupes', 'private'), 'handbase.groupes.replier.private')
  const keys = [
    foldKey('evenements', 'avenir'),
    foldKey('evenements', 'passes'),
    foldKey('groupes', 'poles'),
    foldKey('groupes', 'private'),
    foldKey('groupes', 'team'),
    foldKey('groupes', 'staff'),
    foldKey('groupes', 'autres'),
    // Clés déjà utilisées avant (Archivés) : gardées telles quelles.
    'handbase.evenements.archived',
    'handbase.groupes.archived',
  ]
  assert.equal(new Set(keys).size, keys.length, 'une clé par section')
  // Pas de collision avec les autres clés de session des pages (filtres, « tout afficher »…).
  for (const k of ['handbase.evenements.all', 'handbase.evenements.territoires', 'handbase.groupes.tous']) assert.ok(!keys.includes(k), k)
}

// ---------- 3. Nombre du titre (« Passés · 12 ») ----------
{
  assert.equal(foldCount(12), '12')
  assert.equal(foldCount(1), '1')
  assert.equal(foldCount(0), '', 'section vide : pas de nombre')
  assert.equal(foldCount(undefined), '', 'nombre inconnu (chargement) : rien')
  assert.equal(foldCount(NaN), '')
  assert.equal(foldCount(-3), '')
  assert.equal(foldCount(2.7), '2')
}

console.log('test-replier : OK')
