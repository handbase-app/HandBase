// Test de la fermeture automatique du lecteur vidéo posé à la racine (src/dockWatch.ts) : il reste ouvert quand la page
// est démontée puis remontée à la même adresse (téléphone tourné, même si la fiche met longtemps à revenir), et se ferme
// quand on a quitté l'écran de la vidéo (autre onglet, autre fiche, autre page).
//
//   npx jiti tools/test-lecteur-dock.ts
import assert from 'node:assert/strict'
import { createDockWatch } from '../src/dockWatch'

function setup() {
  let closes = 0
  const w = createDockWatch(() => closes++)
  return { w, closes: () => closes }
}
const FICHE = '/joueurs/p1'
const P = 'player:p1'

// Rotation : démontage puis remontage à la même adresse, quel que soit le délai (aucun minuteur).
{
  const { w, closes } = setup()
  w.mount(P, FICHE)
  w.opened(P, FICHE)
  w.unmount(P, FICHE)
  w.navigated(FICHE) // rien ne bouge
  assert.equal(closes(), 0, 'rotation : le lecteur reste ouvert pendant le rechargement')
  w.mount(P, FICHE)
  assert.equal(closes(), 0)
  // Plusieurs rotations de suite, dans les deux sens.
  for (let i = 0; i < 5; i++) {
    w.unmount(P, FICHE)
    w.mount(P, FICHE)
  }
  assert.equal(closes(), 0, 'rotations répétées : toujours ouvert')
  assert.equal(w.count(P), 1)
}

// Double montage (mode strict de React en développement) : rien ne se ferme.
{
  const { w, closes } = setup()
  w.mount(P, FICHE)
  w.unmount(P, FICHE)
  w.mount(P, FICHE)
  w.opened(P, FICHE)
  assert.equal(closes(), 0)
}

// On quitte la fiche (autre page) : la section est démontée, l'adresse a déjà changé → fermé.
{
  const { w, closes } = setup()
  w.mount(P, FICHE)
  w.opened(P, FICHE)
  w.unmount(P, '/evenements')
  assert.equal(closes(), 1, 'navigation : fermé')
  w.navigated('/evenements')
  assert.equal(closes(), 1, 'une seule fermeture')
}

// Autre onglet de la fiche (?onglet=avis) : la section Vidéos disparaît → fermé.
{
  const { w, closes } = setup()
  w.mount(P, FICHE)
  w.opened(P, FICHE)
  w.unmount(P, FICHE + '?onglet=avis')
  assert.equal(closes(), 1)
}

// Rotation pendant laquelle on part ailleurs (fiche pas encore revenue) : fermé au changement d'adresse.
{
  const { w, closes } = setup()
  w.mount(P, FICHE)
  w.opened(P, FICHE)
  w.unmount(P, FICHE)
  assert.equal(closes(), 0)
  w.navigated('/joueurs')
  assert.equal(closes(), 1, 'parti pendant le rechargement : fermé')
}

// La section reste montée pendant un changement d'adresse (avis ouverts sur un événement, ?avis=…) : l'adresse de la
// vidéo suit ; une rotation ensuite ne ferme rien.
{
  const { w, closes } = setup()
  const EV = '/evenements/e1'
  const O = 'event:e1'
  w.mount(O, EV)
  w.opened(O, EV)
  w.navigated(EV + '?avis=p1')
  assert.equal(closes(), 0)
  w.unmount(O, EV + '?avis=p1')
  w.mount(O, EV + '?avis=p1')
  assert.equal(closes(), 0, 'rotation après changement d’adresse, section montée : ouvert')
  w.unmount(O, EV)
  assert.equal(closes(), 1, 'avis refermés en démontant la section : fermé')
}

// Autre section (fiche d'un autre joueur) montée ou démontée : sans effet sur la vidéo ouverte.
{
  const { w, closes } = setup()
  w.mount(P, FICHE)
  w.opened(P, FICHE)
  w.mount('player:p2', FICHE)
  w.unmount('player:p2', '/joueurs/p2')
  assert.equal(closes(), 0)
}

// Lecteur fermé à la main : plus rien à surveiller.
{
  const { w, closes } = setup()
  w.mount(P, FICHE)
  w.opened(P, FICHE)
  w.closed()
  w.unmount(P, '/joueurs')
  w.navigated('/joueurs')
  assert.equal(closes(), 0)
}

// Fiche ouverte depuis un événement, un groupe, le bilan : même règle, chaque adresse de contexte compte.
for (const url of ['/evenements/e1/joueurs/p1', '/groupes/g1/joueurs/p1', '/bilan/joueurs/p1?club=x']) {
  const { w, closes } = setup()
  w.mount(P, url)
  w.opened(P, url)
  w.unmount(P, url)
  w.mount(P, url)
  assert.equal(closes(), 0, url)
  w.unmount(P, url.replace('p1', 'p2'))
  assert.equal(closes(), 1, url)
}

console.log('test-lecteur-dock : OK')
