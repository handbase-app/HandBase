// Test de « Demander » (src/demander.ts), partie pure de la barre unique (src/components/Demander.tsx) :
//  1. historique local : relecture sans rien croire (JSON cassé, entrées sans texte, page inconnue, date absurde), doublons,
//     30 entrées au plus, la plus récente en tête, retrait, effacement ;
//  2. suggestions : trois par page, courtes, en français, qui changent avec la saison et sont des phrases que les moteurs
//     comprennent (mêmes tournures que les exemples des tests existants) ;
//  3. routeAsk : où va une demande faite depuis l'en-tête : nom → Joueurs (+ « Ouvrir l'événement / le groupe » s'il y
//     correspond, sans accents ni majuscules) ; « ouvre la fiche de X » → la fiche (nom approchant compris) ; phrase
//     d'événements → Événements ; de groupes → Groupes ; question de calcul → bilan ; sinon Joueurs ; « crée un groupe
//     avec… » → Joueurs filtrés, sélection prête (jamais une création) ; toujours au moins une proposition.
// Jeu fictif : aucun nom réel.
//
//   npx jiti tools/test-demander.ts
import assert from 'node:assert/strict'
import {
  ASK_PAGES,
  clearHistory,
  HISTORY_MAX,
  pageOfPath,
  parseHistory,
  pushHistory,
  removeHistory,
  routeAsk,
  seasonStart,
  suggestionsFor,
  type AskContext,
  type AskEntry,
} from '../src/demander'
import { isNameQuery } from '../src/playerQuery'

// ---------- 1. Historique ----------
{
  assert.deepEqual(parseHistory('pas du json'), [])
  assert.deepEqual(parseHistory('{"a":1}'), [])
  assert.deepEqual(parseHistory(null), [])
  const raw = JSON.stringify([
    { text: 'les gauchers de 2011', page: 'joueurs', at: 1700000000000 },
    { text: '  Les Gauchers de 2011 ', page: 'bilan', at: 1600000000000 }, // doublon (majuscules, espaces)
    { text: '', page: 'joueurs', at: 1 }, // sans texte
    { text: 'ouvre le tournoi', page: 'ailleurs', at: 1 }, // page inconnue
    { text: 'Martin', page: 'joueurs', at: 'hier' }, // date absurde : gardée, date à 0
    { text: 42, page: 'joueurs' },
    null,
    'texte nu',
  ])
  const h = parseHistory(raw)
  assert.deepEqual(h, [
    { text: 'les gauchers de 2011', page: 'joueurs', at: 1700000000000 },
    { text: 'Martin', page: 'joueurs', at: 0 },
  ])
  // Relecture d'une valeur déjà lue : même résultat.
  assert.deepEqual(parseHistory(JSON.parse(raw)), h)

  // Ajout : en tête, dédoublonné (accents et majuscules près), 30 au plus.
  let l: AskEntry[] = []
  l = pushHistory(l, { text: 'Les tournois de cette saison', page: 'evenements', at: 10 })
  l = pushHistory(l, { text: 'Martin', page: 'joueurs', at: 20 })
  l = pushHistory(l, { text: 'les tournois de cette saison', page: 'evenements', at: 30 })
  assert.deepEqual(
    l.map((e) => [e.text, e.at]),
    [
      ['les tournois de cette saison', 30],
      ['Martin', 20],
    ],
  )
  assert.equal(pushHistory(l, { text: '   ', page: 'joueurs' }).length, 2, 'texte vide : rien d’ajouté')
  for (let i = 0; i < 40; i++) l = pushHistory(l, { text: `demande ${i}`, page: ASK_PAGES[i % 4], at: 100 + i })
  assert.equal(l.length, HISTORY_MAX)
  assert.equal(l[0].text, 'demande 39')
  assert.equal(l[HISTORY_MAX - 1].text, 'demande 10')
  assert.ok(!l.some((e) => e.text === 'Martin'), 'les plus anciennes partent')
  // Texte trop long : coupé (rien d'énorme en stockage).
  assert.equal(pushHistory([], { text: 'x'.repeat(1000), page: 'bilan' })[0].text.length, 300)
  // Retrait, effacement.
  assert.equal(removeHistory(l, 'DEMANDE 39').length, HISTORY_MAX - 1)
  assert.equal(removeHistory(l, 'inconnue').length, HISTORY_MAX)
  assert.deepEqual(clearHistory(), [])
  // Entrée relue depuis le stockage : date par défaut posée (Date.now) quand elle n'est pas donnée.
  assert.ok(pushHistory([], { text: 'a', page: 'joueurs' })[0].at > 0)
}

// ---------- 2. Suggestions ----------
{
  assert.equal(seasonStart('2026-10-19'), 2026)
  assert.equal(seasonStart('2026-03-01'), 2025)
  assert.equal(seasonStart('2026-09-01'), 2026)
  assert.equal(seasonStart('2026-08-31'), 2025)
  for (const page of ASK_PAGES) {
    for (const today of ['2026-10-19', '2027-03-15']) {
      const s = suggestionsFor(page, { today })
      assert.equal(s.length, 3, page)
      for (const x of s) {
        assert.ok(x.length >= 10 && x.length <= 80, `${page} : « ${x} »`)
        assert.ok(!isNameQuery(x), `${page} : « ${x} » doit être une phrase, pas un nom`)
        assert.ok(/^[A-ZÉ]/.test(x), `${page} : « ${x} » commence par une majuscule`)
      }
      assert.equal(new Set(s).size, 3, 'trois suggestions différentes')
    }
  }
  // Elles changent avec la saison (début de saison : « pas encore vus » ; année d'âge des 15 ans).
  const oct = suggestionsFor('joueurs', { today: '2026-10-19' })
  const mar = suggestionsFor('joueurs', { today: '2027-03-15' })
  assert.notDeepEqual(oct, mar)
  assert.ok(oct[0].includes('pas encore vus cette saison'))
  assert.ok(mar[0].includes('pas vus depuis 6 mois'))
  assert.ok(oct.some((x) => x.includes('2011')), 'saison 2026-2027 : les 2011')
  assert.ok(suggestionsFor('joueurs', { today: '2027-09-10' }).some((x) => x.includes('2012')))
  // Tournures des exemples existants (tools/test-questions.ts, test-filtres-recette-pages.ts).
  assert.ok(suggestionsFor('evenements', { today: '2026-10-19' }).includes('Les tournois de cette saison'))
  assert.ok(suggestionsFor('evenements', { today: '2026-10-19' }).some((x) => /combien .* par mois \?/i.test(x)))
  assert.ok(suggestionsFor('groupes', { today: '2026-10-19' }).some((x) => /^Les groupes de filles/.test(x)))
  assert.ok(suggestionsFor('bilan', { today: '2026-10-19' }).some((x) => /^Quel club a le plus de/.test(x)))
  assert.ok(suggestionsFor('bilan', { today: '2026-10-19' }).some((x) => /vues une seule fois cette saison, par département$/.test(x)))
  // Jamais de libellé négatif sur un jeune.
  for (const page of ASK_PAGES) for (const x of suggestionsFor(page, { today: '2026-10-19' })) assert.ok(!/retenu|faible|mauvais|nul/i.test(x), x)
}

// ---------- 3. Où va une demande faite depuis l'en-tête ----------
const ctx: AskContext = {
  players: [
    { id: 'p1', name: 'MARTIN Lucas' },
    { id: 'p2', name: 'DUPONT Léa' },
    { id: 'p3', name: 'DE LA CRUZ Inès' },
    { id: 'p4', name: 'FICTIF Jean-Pierre' },
  ],
  events: [
    { id: 'e1', name: 'Tournoi de Fictiville 2026' },
    { id: 'e2', name: 'Intercomités 83' },
    { id: 'e3', name: 'Stage de Noël' },
  ],
  groups: [
    { id: 'g1', name: 'Sélection U15 F' },
    { id: 'g2', name: 'Grands gauchers' },
  ],
}
const kinds = (p: string, c = ctx) => routeAsk(p, c).map((r) => r.kind)
const first = (p: string, c = ctx) => routeAsk(p, c)[0]
{
  assert.deepEqual(routeAsk('   ', ctx), [], 'phrase vide : rien')
  // Toujours au moins une proposition, même sans aucun nom connu.
  for (const p of ['Martin', 'les gauchers', 'ouvre la fiche de Personne', 'combien ?', 'crée un groupe avec les 2011', 'x']) assert.ok(routeAsk(p).length >= 1, p)

  // (a) Un simple nom : Joueurs, avec le nom cherché ; une licence aussi.
  let r = routeAsk('Martin', ctx)
  assert.equal(r[0].kind, 'name')
  assert.equal(r[0].to, '/joueurs')
  assert.deepEqual(r[0].apply, { page: 'joueurs', phrase: 'Martin' })
  assert.ok(r[0].label.includes('« Martin »'))
  // … puis la fiche du joueur de ce nom (nom de l'appareil, jamais envoyé).
  assert.deepEqual(r.slice(1).map((x) => [x.kind, x.to]), [['open-player', '/joueurs/p1']])
  assert.equal(first('638 301 500').kind, 'name')
  // Un nom qui correspond à un événement ou à un groupe (sans accents ni majuscules) : « Ouvrir … » proposé après Joueurs.
  r = routeAsk('intercomites', ctx)
  assert.deepEqual(
    r.map((x) => [x.kind, x.to]),
    [
      ['name', '/joueurs'],
      ['open-event', '/evenements/e2'],
    ],
  )
  assert.equal(r[1].label, 'Ouvrir l’événement « Intercomités 83 »')
  r = routeAsk('Selection U15', ctx)
  assert.ok(r.some((x) => x.kind === 'open-group' && x.to === '/groupes/g1'))
  assert.equal(r.find((x) => x.kind === 'open-group')!.label, 'Ouvrir le groupe « Sélection U15 F »')
  // Sans listes dans le contexte : seulement Joueurs.
  assert.deepEqual(kinds('Martin', {}), ['name'])

  // (b) « ouvre / va à / montre la fiche de X » : la fiche du joueur en premier ; nom approchant (dictée) compris.
  r = routeAsk('ouvre la fiche de Lucas Martin', ctx)
  assert.equal(r[0].kind, 'open-player')
  assert.equal(r[0].to, '/joueurs/p1')
  assert.equal(r[0].label, 'Ouvrir la fiche de MARTIN Lucas')
  assert.equal(r[r.length - 1].kind, 'name', 'et la recherche dans Joueurs en dernier recours')
  assert.equal(first('Montre-moi Dupond', ctx).to, '/joueurs/p2', 'nom approchant')
  assert.equal(first('va à la fiche de De La Cruz', ctx).to, '/joueurs/p3')
  assert.equal(first('ouvre jean-pierre fictif', ctx).to, '/joueurs/p4')
  // Un événement ou un groupe nommé : ouvert directement.
  assert.equal(first('ouvre le tournoi de Fictiville', ctx).to, '/evenements/e1')
  assert.equal(first('va au stage de noel', ctx).to, '/evenements/e3')
  assert.equal(first('ouvre le groupe grands gauchers', ctx).to, '/groupes/g2')
  assert.equal(first('affiche Intercomités 83', ctx).to, '/evenements/e2', 'sans dire « l’événement » : trouvé quand même')
  // Rien de ce nom : recherche dans Joueurs (nom), ou phrase.
  assert.equal(first('ouvre la fiche de Personne', ctx).kind, 'name')
  assert.equal(first('montre les gauchers', ctx).kind, 'players')

  // (c) Une phrase d'événements → Événements (Joueurs en second) ; de groupes → Groupes.
  r = routeAsk('les tournois de cette saison', ctx)
  assert.equal(r[0].kind, 'events')
  assert.equal(r[0].to, '/evenements')
  assert.deepEqual(r[0].apply, { page: 'evenements', phrase: 'les tournois de cette saison' })
  assert.equal(r[1].kind, 'players')
  assert.equal(first('à venir dans le Var').kind, 'events')
  assert.equal(first('les stages de l’été dernier').kind, 'events')
  assert.equal(first('les groupes du Var').kind, 'groups')
  assert.equal(first('les groupes de filles du Var').kind, 'groups', 'le sujet est dit en tête : Groupes, malgré « filles »')
  assert.equal(first('mes groupes de plus de 15 joueurs').kind, 'groups')
  assert.equal(first('combien d’événements par mois ?').kind, 'events', 'calcul sur les événements : la liste Événements')
  assert.ok(kinds('combien d’événements par mois ?').includes('bilan'), '… et le bilan proposé ensuite')
  assert.equal(first('combien de groupes par comité ?').kind, 'groups')
  // Les mots de joueurs l'emportent quand le sujet n'est pas dit en tête.
  assert.equal(first('les joueurs du tournoi de Fictiville').kind, 'players')
  assert.equal(first('les gardiennes vues au stage de Noël').kind, 'players')

  // (d) Une question de calcul → le bilan (« Poser une question »), Joueurs en second.
  for (const p of ['Combien de gauchers vus dans le Var ?', 'Quel club a le plus de joueurs vus ?', 'les 2011 par département', 'quelle est la taille moyenne des gardiens ?', 'le nombre de licenciés par club']) {
    r = routeAsk(p, ctx)
    assert.equal(r[0].kind, 'bilan', p)
    assert.equal(r[0].to, '/bilan')
    assert.deepEqual(r[0].apply, { page: 'bilan', phrase: p })
    assert.equal(r[1].kind, 'players', p)
  }

  // (e) Sinon → Joueurs (filtres), avec le bilan et « créer un groupe » proposés ensuite.
  r = routeAsk('les gauchers de 2011 vus cette saison dans le Var', ctx)
  assert.deepEqual(
    r.map((x) => x.kind),
    ['players', 'bilan', 'select'],
  )
  assert.equal(r[0].label, 'Filtrer Joueurs')
  assert.deepEqual(r[0].apply, { page: 'joueurs', phrase: 'les gauchers de 2011 vus cette saison dans le Var' })
  assert.deepEqual(r[2].apply, { page: 'joueurs', phrase: 'les gauchers de 2011 vus cette saison dans le Var', select: 'groupe' })
  assert.equal(first('nés en 2010 de plus d’1 m 85').kind, 'players')
  assert.equal(first('efface les filtres').kind, 'players', 'commande locale : la liste s’en charge')

  // Jamais une action qui écrit : « crée un groupe avec… » filtre Joueurs avec la sélection prête ; rien n'est créé.
  r = routeAsk('Crée un groupe avec les gauchers de 2011', ctx)
  assert.equal(r[0].kind, 'select')
  assert.equal(r[0].to, '/joueurs')
  assert.deepEqual(r[0].apply, { page: 'joueurs', phrase: 'les gauchers de 2011', select: 'groupe' })
  assert.ok(/créer le groupe avec le résultat/.test(r[0].label))
  assert.ok(/rien n’est créé/.test(r[0].hint ?? ''))
  assert.equal(r[1].kind, 'players')
  assert.deepEqual(first('fais un événement avec les 2011 du Var').apply, { page: 'joueurs', phrase: 'les 2011 du Var', select: 'evenement' })
  assert.deepEqual(first('Ajoute une sélection pour les pivots gauchers').apply?.select, 'groupe')
  assert.ok(!routeAsk('crée un groupe avec les 2011', ctx).some((x) => x.to.startsWith('/groupes/nouveau')), 'jamais le formulaire de création en direct')
  // Casse et accents gardés dans la phrase relancée.
  assert.equal(first('Crée un groupe avec les Gauchères du Var').apply?.phrase, 'les Gauchères du Var')

  // La page d'un chemin (suggestions de l'en-tête).
  assert.equal(pageOfPath('/evenements/e1'), 'evenements')
  assert.equal(pageOfPath('/groupes'), 'groupes')
  assert.equal(pageOfPath('/bilan/question'), 'bilan')
  assert.equal(pageOfPath('/'), 'joueurs')
  assert.equal(pageOfPath('/parametres'), 'joueurs')

  // Rapide sur une grande base de noms (40 000 joueurs fictifs).
  const big: AskContext = { ...ctx, players: Array.from({ length: 40000 }, (_, i) => ({ id: `q${i}`, name: `FICTIF${i % 997} Prénom${i % 53}` })) }
  const t0 = performance.now()
  for (let i = 0; i < 20; i++) routeAsk('ouvre la fiche de fictif12 prenom7', big)
  assert.ok(performance.now() - t0 < 2000, `routeAsk sur 40 000 noms : ${Math.round((performance.now() - t0) / 20)} ms par demande`)
}

console.log('test-demander : OK')
