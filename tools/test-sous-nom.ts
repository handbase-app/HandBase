// Test de « Sous le nom » (src/sousNom.ts) : réglage par défaut et relu, bascule, valeur du compte (hb_profiles.affichage)
// lue et envoyée, morceaux de la ligne dans l'ordre fixe (inconnus sautés, club / trimestre retirés par une liste, âge sur
// ligne large), dernières mesures. Joueurs fictifs.
//
//   npx jiti tools/test-sous-nom.ts
import assert from 'node:assert/strict'
import {
  affichagePayload,
  ageOn,
  DEFAULT_SOUS_NOM,
  isDefaultSousNom,
  latestSubMeasures,
  parseAffichage,
  parseSousNom,
  sameAffichage,
  serializeSousNom,
  SOUS_NOM_KINDS,
  sousNomPieces,
  toggleSousNom,
  type SubOptions,
} from '../src/sousNom'

// ---------- Réglage ----------
assert.equal(SOUS_NOM_KINDS.length, 10)
assert.deepEqual(DEFAULT_SOUS_NOM, ['annee', 'trimestre', 'club', 'taille'])
assert.deepEqual(parseSousNom(null), ['annee', 'trimestre', 'club', 'taille'])
assert.deepEqual(parseSousNom('{pas du json'), ['annee', 'trimestre', 'club', 'taille'])
assert.deepEqual(parseSousNom('{"a":1}'), ['annee', 'trimestre', 'club', 'taille'])
// Inconnus ignorés, doublons retirés, ordre fixe.
assert.deepEqual(parseSousNom('["poids","age","inconnu","annee","age",3]'), ['annee', 'age', 'poids'])
// Rien de choisi : gardé tel quel.
assert.deepEqual(parseSousNom('[]'), [])
assert.equal(serializeSousNom(['taille', 'annee']), '["annee","taille"]')
assert.deepEqual(toggleSousNom(DEFAULT_SOUS_NOM, 'age'), ['annee', 'age', 'trimestre', 'club', 'taille'])
assert.deepEqual(toggleSousNom(DEFAULT_SOUS_NOM, 'club'), ['annee', 'trimestre', 'taille'])
assert.ok(isDefaultSousNom(['taille', 'club', 'trimestre', 'annee']))
assert.ok(!isDefaultSousNom(['annee']))

// ---------- Valeur du compte ----------
assert.equal(parseAffichage(null), null)
assert.equal(parseAffichage('texte'), null)
assert.equal(parseAffichage([]), null)
assert.equal(parseAffichage({ pictos: ['suivi'] }), null) // un tableau manque
assert.equal(parseAffichage({ pictos: 'suivi', sousNom: [] }), null)
assert.deepEqual(parseAffichage({ pictos: ['vu', 'suivi', 'futur'], sousNom: ['club', 'annee', 'futur'], autre: 1 }), { pictos: ['suivi', 'vu'], sousNom: ['annee', 'club'] })
assert.deepEqual(parseAffichage({ pictos: [], sousNom: [] }), { pictos: [], sousNom: [] })
assert.deepEqual(affichagePayload(['revoir', 'suivi'], ['taille', 'annee']), { pictos: ['suivi', 'revoir'], sousNom: ['annee', 'taille'] })
assert.ok(sameAffichage({ pictos: ['vu', 'suivi'], sousNom: ['club'] }, { pictos: ['suivi', 'vu'], sousNom: ['club'] }))
assert.ok(!sameAffichage({ pictos: ['suivi'], sousNom: ['club'] }, { pictos: ['suivi'], sousNom: [] }))

// ---------- Âge ----------
assert.equal(ageOn('2012-05-10', '2026-11-02'), 14)
assert.equal(ageOn('2012-11-02', '2026-11-02'), 14) // anniversaire le jour même
assert.equal(ageOn('2012-11-03', '2026-11-02'), 13)
assert.equal(ageOn('2012', '2026-11-02'), null)
assert.equal(ageOn(undefined, '2026-11-02'), null)

// ---------- Morceaux de la ligne ----------
const cats = [
  { code: 'U13', ages: [12, 13] },
  { code: 'U15', ages: [14, 15] },
  { code: 'U18', ages: [16, 17, 18] },
]
const o: SubOptions = { today: '2026-11-02', cats }
const p = { birthDate: '2012-05-10', club: 'HBC Exemple', clubCode: '6383015', laterality: 'gaucher' as const, sex: 'F' }
const text = (on: Parameters<typeof sousNomPieces>[1], extra: Partial<SubOptions> = {}, pl: Parameters<typeof sousNomPieces>[0] = p) =>
  sousNomPieces(pl, on, { ...o, ...extra }).map((x) => (x.wide ? `(${x.text})` : x.text)).join(' · ')

// Défaut : année · trimestre · club · taille (taille connue seulement).
assert.equal(text(DEFAULT_SOUS_NOM), '2012 · Q2 · HBC Exemple')
assert.equal(text(DEFAULT_SOUS_NOM, { measures: { taille: 172 } }), '2012 · Q2 · HBC Exemple · 172 cm')
assert.equal(text(DEFAULT_SOUS_NOM, { measures: { taille: '172' } }), '2012 · Q2 · HBC Exemple · 172 cm')
// Tout, dans l'ordre fixe (saison 2026-2027 : 2027 − 2012 = 15 → U15 ; département lu dans le n° de club).
assert.equal(
  text([...SOUS_NOM_KINDS].reverse(), { measures: { taille: 172, poids: 58.5, envergure: 175 } }),
  '2012 · 14 ans · Q2 · HBC Exemple · Dép. 83 · 172 cm · 58,5 kg · Gauchère · U15 · env. 175 cm',
)
// Inconnus sautés : sans date ni club ni mesures, rien.
assert.equal(text(SOUS_NOM_KINDS, {}, {}), '')
// Département saisi à la main (sans licence) ; latéralité au masculin par défaut.
assert.equal(text(['departement', 'lateralite'], {}, { department: '06', laterality: 'droitier' }), 'Dép. 06 · Droitier')
// Surclassement déclaré : la catégorie jouée.
assert.equal(text(['categorie'], {}, { birthDate: '2012-05-10', usualTeam: { playsIn: 'U18' } }), 'U18')
// Hors des catégories de jeunes : sautée.
assert.equal(text(['categorie'], {}, { birthDate: '1990-01-01' }), '')
// Une liste retire le club (liste d'un club) ou le trimestre, même choisis.
assert.equal(text(DEFAULT_SOUS_NOM, { club: false }), '2012 · Q2')
assert.equal(text(DEFAULT_SOUS_NOM, { quarter: false }), '2012 · HBC Exemple')
// Âge donné par la liste (Joueurs) mais pas choisi : ligne large seulement ; choisi : toujours.
assert.equal(text(DEFAULT_SOUS_NOM, { wideAge: true }), '2012 · (14 ans) · Q2 · HBC Exemple')
assert.equal(text(['annee', 'age'], { wideAge: true }), '2012 · 14 ans')
// Bulles d'aide : trimestre, département, catégorie.
const tips = sousNomPieces(p, ['trimestre', 'departement', 'categorie'], o).map((x) => x.title)
assert.deepEqual(tips, ['Né(e) au 2e trimestre (avril à juin)', 'Département 83', 'Catégorie U15 cette saison'])

// ---------- Dernières mesures ----------
const m = (playerId: string, criterionId: string, value: number | string, date: string, updatedAt = 1, deleted?: boolean) => ({ playerId, criterionId, value, date, updatedAt, deleted })
const latest = latestSubMeasures([
  m('a', 'taille', 160, '2025-09-01'),
  m('a', 'taille', 165, '2026-03-01'),
  m('a', 'taille', 170, '2026-06-01', 1, true), // supprimée
  m('a', 'poids', 50, '2026-03-01', 1),
  m('a', 'poids', 51, '2026-03-01', 2), // même jour, plus récente
  m('a', 'vma', 15, '2026-03-01'), // pas montrée sous le nom
  m('b', 'envergure', 180, '2026-01-01'),
])
assert.deepEqual(latest.get('a'), { taille: 165, poids: 51 })
assert.deepEqual(latest.get('b'), { envergure: 180 })
assert.equal(latest.get('c'), undefined)

console.log('test-sous-nom : OK')
