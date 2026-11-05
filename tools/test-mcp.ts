// Test du serveur MCP Nextar (supabase/functions/mcp) et de la remise des noms sur l'appareil, sur un jeu FICTIF :
//  - RÈGLE « AUCUN NOM » : chaque outil appelé de plusieurs façons ; aucune réponse ne contient un nom, un prénom, une date
//    de naissance, un club, une licence ou un commentaire du jeu (tools/mcp-jeu-fictif.ts) ; liste blanche des clés
//    (verifierSortie) ; nextar_lire ne demande jamais les noms à la base ; source.ts ne sélectionne ni noms ni commentaires
//    pour la lecture (faux client qui note les requêtes) ;
//  - codes : stables, format, signe de contrôle (toute faute d'un signe attrapée), 40 000 identifiants fictifs (codes partagés
//    détectés, jamais résolus en un nom), même résultat dans l'appli et dans la copie de la fonction ;
//  - rapprochement (nextar_proposer) : trouvé / à vérifier / plusieurs possibles / introuvable, par événement, groupe ou toute
//    la base (grande base : premier tri), colonnes reliées par identifiant de test, lignes déposées telles qu'écrites, et
//    proposition qui s'ouvre dans l'écran « À valider » de l'appli avec les mêmes joueurs ;
//  - nextar_lire (filtres, tri, limite), nextar_suivi, nextar_rapport (codes faux signalés, bornes) ;
//  - nextar_connexions (administrateurs) : liste filtrée par la fenêtre, tri, libellés, bornes ; refus sans données pour un
//    coach ; jamais d'adresse mail (même quand le nom du profil en est une), de téléphone, d'identifiant brut ni d'adresse IP ;
//  - rapport → remplacement local des codes (Markdown, fiches fondues, codes inconnus, partagés, faux) ;
//  - copies générées à jour (tools/generer-partage-mcp.ts), bornes égales à celles des scripts 067 et 068, branchements.
//
//   npx jiti tools/test-mcp.ts
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  CODE_ALPHABET,
  codeJoueur,
  codeValide,
  codesDuTexte,
  codesPartages,
  indexCodes,
  indexFiches,
  normaliserCode,
  remplacerCodes,
} from '../src/codesJoueurs'
import * as copieCodes from '../supabase/functions/mcp/partage/codesJoueurs'
import { propose, type ImportCriterion } from '../src/importMesures'
import { fromServer, rowsOf, type ServerProposition } from '../src/propositionsCore'
import { inlineText, parseInline, parseMarkdown } from '../src/rapportMarkdown'
import {
  BORNES,
  codeCompte,
  ilYA,
  outilConnexions,
  outilContexte,
  outilLire,
  outilProposer,
  outilRapport,
  outilSuivi,
  ROLE_LIBELLE,
  sansCoordonnees,
  typeAppareil,
  verifierSortie,
  type Reglages,
  type Source,
} from '../supabase/functions/mcp/outils'
import { sourceSupabase } from '../supabase/functions/mcp/source'
import { copiesPerimees } from './generer-partage-mcp'
import { COMPTES, CRITERES, EVENEMENTS, grandeBase, JOUEURS, MAINTENANT_FICTIF, sourceFictive, textesInterdits, textesInterditsComptes } from './mcp-jeu-fictif'

let n = 0
const t = async (name: string, f: () => void | Promise<void>) => {
  await f()
  n++
  console.log(`ok ${n} - ${name}`)
}
const reg: Reglages = { appUrl: 'https://exemple.test/HandBase', today: '2026-11-05' }
const code = (id: string) => codeJoueur(id)
const interdits = textesInterdits()
/** Toutes les réponses d'outils passent ici : liste blanche, puis recherche des textes du jeu. */
const sorties: unknown[] = []
const garde = <T>(x: T): T => {
  verifierSortie(x)
  sorties.push(x)
  const s = JSON.stringify(x)
  for (const txt of interdits) assert.ok(!s.includes(txt), `« ${txt} » ne doit jamais sortir : ${s.slice(0, 300)}`)
  return x
}
const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')

// ---------- Copies générées ----------

await t('copies de la fonction à jour (src/ → supabase/functions/mcp/partage/)', () => {
  assert.deepEqual(copiesPerimees(), [], 'relancer : npx jiti tools/generer-partage-mcp.ts')
})

// ---------- Codes ----------

await t('code : format « J- » + 7 signes de Crockford, stable', () => {
  const c = code('p-lucas')
  assert.match(c, /^J-[0-9A-HJKMNP-TV-Z]{7}$/)
  assert.equal(code('p-lucas'), c)
  assert.notEqual(code('p-emma'), c)
  assert.ok(codeValide(c))
  assert.equal(CODE_ALPHABET.length, 32)
})

await t('code : même résultat dans l’appli et dans la copie de la fonction', () => {
  for (let i = 0; i < 2000; i++) assert.equal(copieCodes.codeJoueur(`id-${i}`), codeJoueur(`id-${i}`))
})

const ids40k = Array.from({ length: 40_000 }, (_, i) => `${(i * 2654435761 >>> 0).toString(16)}-${i}-fictif`)
await t('40 000 identifiants fictifs : codes valides, collisions rares et toutes détectées (code partagé)', () => {
  const idx = indexCodes(ids40k)
  for (const id of ids40k.slice(0, 5000)) assert.ok(codeValide(code(id)))
  const partages = codesPartages(idx)
  const total = [...idx.values()].reduce((s, v) => s + v.length, 0)
  assert.equal(total, ids40k.length, 'chaque fiche dans l’index')
  assert.ok(partages.length <= 6, `collisions trop nombreuses : ${partages.length}`)
  for (const c of partages) assert.ok(idx.get(c)!.length > 1)
  console.log(`   (${idx.size} codes distincts pour 40 000 fiches ; ${partages.length} code(s) partagé(s), signalés)`)
})

// Deux identifiants qui tombent sur le même code (cherchés une fois, déterministes).
const collision = (() => {
  const seen = new Map<string, string>()
  for (let i = 0; i < 400_000; i++) {
    const id = `col-${i}`
    const c = code(id)
    const o = seen.get(c)
    if (o) return [o, id] as const
    seen.set(c, id)
  }
  throw new Error('pas de collision trouvée')
})()

await t('code partagé : jamais résolu en un nom (appareil), signalé (serveur)', () => {
  const [a, b] = collision
  const idx = indexCodes([a, b, 'p-lucas'])
  const m = remplacerCodes(`voir ${code(a)} et ${code('p-lucas')}`, idx, (id) => ({ [a]: 'Alpha Fictif', [b]: 'Beta Fictif', 'p-lucas': 'Lucas Exemplaire' })[id])
  assert.deepEqual(m[1], { k: 'code', code: code(a), raison: 'partage', fiches: 2 })
  assert.equal(m[3].k, 'joueur')
})

await t('signe de contrôle : toute faute d’un seul signe est attrapée', () => {
  for (const id of ids40k.slice(0, 300)) {
    const c = code(id)
    for (let p = 2; p < 9; p++)
      for (const ch of CODE_ALPHABET) {
        if (ch === c[p]) continue
        assert.ok(!codeValide(c.slice(0, p) + ch + c.slice(p + 1)), `${c} → faute en ${p} non vue`)
      }
  }
})

await t('lecture tolérante : minuscules, O lu 0, I et L lus 1 ; pas un code : null', () => {
  const c = code('p-emma')
  assert.equal(normaliserCode(c.toLowerCase()), c)
  const avecO = c.replace(/0/g, 'O')
  assert.equal(normaliserCode(avecO), c)
  assert.equal(normaliserCode('J-1234'), null)
  assert.equal(normaliserCode('X-1234567'), null)
  assert.equal(normaliserCode('J-12345U7'), null, 'U n’est pas dans l’alphabet')
  const { valides, invalides } = codesDuTexte(`${c}, ${c}, J-AAAAAAA, J-12345678 (trop long)`)
  assert.deepEqual(valides, [c])
  assert.deepEqual(invalides, ['J-AAAAAAA'])
})

// ---------- Outils : contexte ----------

await t('nextar_contexte : tests, critères d’avis, postes, événements et groupes ; aucune donnée de joueur', async () => {
  const src = sourceFictive()
  const c = garde(await outilContexte(src, reg))
  assert.deepEqual(
    c.tests.map((x) => x.id),
    ['sprint_10', 'cmj', 'taille', 'lateralite'],
  )
  assert.deepEqual(c.tests.find((x) => x.id === 'lateralite')?.options, ['Gauche', 'Droit'])
  assert.deepEqual(c.criteres_avis.find((x) => x.id === 'tir')?.postes, ['ARG', 'ARD'])
  assert.equal(c.criteres_avis.find((x) => x.id === 'defense')?.postes, 'tous')
  assert.ok(c.postes.some((p) => p.code === 'ARG' && p.libelle === 'Arrière gauche'))
  assert.deepEqual(
    c.evenements.map((e) => e.libelle),
    ['Détection U15 Var'],
    'archivé caché par défaut',
  )
  assert.equal(c.evenements[0].joueurs, 5)
  const avec = garde(await outilContexte(src, reg, { archives: true }))
  assert.equal(avec.evenements.length, 2)
  assert.equal(src.appelsNoms, 0)
})

// ---------- Outils : proposer ----------

const TABLEAU = '| N° | Joueur | Sprint 10 m (s) | CMJ (cm) |\n|---|---|---|---|\n| 7 | Lucas E. | 1,84 | 38 |\n| | Emma Imaginaire | 2,01 | 186 |\n| | Hugo M. | 1,95 | 35 |\n| | Inconnu Total | 2,2 | 30 |'

await t('nextar_proposer (tableau, événement par son nom) : codes et états par ligne seulement', async () => {
  const src = sourceFictive()
  const r = garde(await outilProposer(src, reg, { evenement: 'detection u15 var', date: '2026-11-04', tableau: TABLEAU, titre: 'Tests du 04/11' }))
  assert.ok('lignes' in r)
  if (!('lignes' in r)) return
  assert.deepEqual(
    r.lignes.map((l) => [l.etat, 'code' in l ? l.code : null, 'possibles' in l ? l.possibles : null]),
    [
      ['trouvé', code('p-lucas'), null],
      ['trouvé', code('p-emma'), null],
      ['plusieurs possibles', null, 2],
      ['introuvable', null, null],
    ],
  )
  assert.deepEqual(r.lignes[1].alertes, ['unité probablement fausse'], 'CMJ 186 : unité')
  assert.equal(r.portee, 'événement « Détection U15 Var »')
  assert.equal(r.lien_boite, 'https://exemple.test/HandBase/?propositions=1')
  assert.deepEqual(r.resume, { trouves: 2, a_verifier: 0, plusieurs: 1, introuvables: 1 })
  assert.deepEqual(
    r.colonnes.map((c) => c.role),
    ['maillot', 'joueur', 'test', 'test'],
  )
  // Déposé tel qu'écrit, avec le contexte de l'appli.
  const d = src.propositionsDeposees[0]
  assert.equal(d.titre, 'Tests du 04/11')
  assert.deepEqual(d.lignes[1], ['7', 'Lucas E.', '1,84', '38'])
  assert.deepEqual(d.contexte, { portee: 'evenement', id: 'ev-var', nom: 'Détection U15 Var', date: '2026-11-04', format: 'markdown', joueurs: EVENEMENTS[0].playerIds })
  // Ni les noms reçus, ni les en-têtes ne sont répétés.
  assert.ok(!JSON.stringify(r).includes('Inconnu Total') && !JSON.stringify(r).includes('Sprint 10 m (s)'))
})

await t('nextar_proposer (objets, groupe) : colonnes reliées par identifiant de test, choix gardés pour l’appli', async () => {
  const src = sourceFictive()
  const r = garde(
    await outilProposer(src, reg, {
      groupe: 'g-pole',
      lignes: [
        { prenom: 'Noah', nom: 'Fictivus', annee: 2012, valeurs: { cmj: '42 cm', sprint_10: '1.95' } },
        { prenom: 'Jade', nom: 'Chimerique', valeurs: { cmj: 30 } },
        { prenom: 'Lea', nom: 'Bidonville', valeurs: { cmj: 33 } },
      ],
    }),
  )
  if (!('lignes' in r)) throw new Error(JSON.stringify(r))
  assert.deepEqual(
    r.lignes.map((l) => l.etat),
    ['trouvé', 'trouvé', 'introuvable'],
    'Léa n’est pas dans le groupe',
  )
  assert.equal(r.lignes[0].valeurs, 2)
  const d = src.propositionsDeposees[0]
  assert.deepEqual(d.lignes[0], ['Nom', 'Prénom', 'Année', 'CMJ (cm)', 'Sprint 10 m (s)'])
  assert.deepEqual(d.contexte.choix, { columns: { 3: { k: 'test', criterionId: 'cmj' }, 4: { k: 'test', criterionId: 'sprint_10' } } })
  assert.equal(d.titre, 'Tests du 05/11 · Pôle Espoirs Fictif')
})

await t('proposition déposée par le serveur : s’ouvre dans « À valider » avec les mêmes joueurs (lignes, contexte, choix)', async () => {
  const src = sourceFictive()
  const r = await outilProposer(src, reg, { evenement: 'ev-var', lignes: [['7', 'Lucas E.', '1,84'], ['', 'Emma Imaginaire', '2,01']], colonnes: ['N°', 'Joueur', 'sprint_10'] })
  if (!('lignes' in r)) throw new Error(JSON.stringify(r))
  const d = src.propositionsDeposees[0]
  const s: ServerProposition = { id: d.id, source: 'mcp', kind: 'mesures', titre: d.titre, contexte: d.contexte, lignes: d.lignes, etat: 'en_attente', created_at: '2026-11-05T10:00:00Z', updated_at: '2026-11-05T10:00:00Z', expires_at: '2026-12-05T10:00:00Z', deleted_at: null }
  const row = fromServer(s, undefined, 'coach')!
  assert.equal(row.source, 'mcp')
  // Comme PropositionReview : rowsOf, joueurs du contexte, colonnes déjà reliées (fromChoix).
  const ids = row.contexte.joueurs!
  const players = JOUEURS.filter((p) => ids.includes(p.id)).map((p) => ({ id: p.id, firstName: p.firstName, lastName: p.lastName, birthDate: p.birthDate, num: EVENEMENTS[0].nums?.[p.id] }))
  const crits = CRITERES.map((c) => ({ ...c, category: c.category ?? '', order: c.order ?? 0, scale: c.scale ?? 'number' })) as ImportCriterion[]
  const p = propose(rowsOf(row.lignes), { criteria: crits, players, existing: [], date: row.contexte.date!, today: reg.today }, { columns: row.contexte.choix?.columns as never })
  assert.deepEqual(
    p.rows.map((x) => (x.match.confidence === 'sur' ? code(x.match.playerId!) : x.match.confidence)),
    r.lignes.map((l) => ('code' in l ? l.code : l.etat)),
  )
  assert.equal(p.columns[2].role.k === 'test' && p.columns[2].role.criterionId, 'sprint_10')
})

await t('nextar_proposer sur toute la base (15 000 fiches fictives, premier tri) : juste et rapide', async () => {
  const base = grandeBase(15_000)
  const src = sourceFictive({ joueurs: base })
  const compte = new Map<string, number>()
  for (const p of base) compte.set(p.lastName, (compte.get(p.lastName) ?? 0) + 1)
  const uniques = base.filter((p) => compte.get(p.lastName) === 1).slice(0, 25)
  assert.ok(uniques.length >= 10)
  const t0 = Date.now()
  const r = garde(await outilProposer(src, reg, { lignes: uniques.map((p) => ({ prenom: p.firstName, nom: p.lastName, valeurs: { sprint_10: '2,1' } })) }), )
  const ms = Date.now() - t0
  if (!('lignes' in r)) throw new Error(JSON.stringify(r))
  r.lignes.forEach((l, i) => {
    assert.equal(l.etat, 'trouvé', `${i}`)
    assert.equal('code' in l && l.code, code(uniques[i].id))
  })
  assert.ok(ms < 8000, `trop lent : ${ms} ms`)
  console.log(`   (${uniques.length} lignes sur 15 000 fiches : ${ms} ms)`)
  const s = JSON.stringify(r)
  for (const p of uniques) assert.ok(!s.includes(p.lastName) && !s.includes(p.license) && !s.includes(p.club))
})

await t('nextar_proposer, périmètre de plus de 20 000 fiches : déposée, rapprochement laissé à l’appli', async () => {
  const src = sourceFictive({ joueurs: grandeBase(BORNES.rapprochementTous + 500) })
  const r = garde(await outilProposer(src, reg, { lignes: [{ prenom: 'Adam', nom: 'Personne', valeurs: { cmj: 30 } }] }))
  if (!('lignes' in r)) throw new Error(JSON.stringify(r))
  assert.equal(r.lignes[0].etat, 'à rapprocher dans Nextar')
  assert.equal(r.resume.a_rapprocher, 1)
  assert.match(r.avertissements[0], /rapprochés dans l'appli/)
  assert.equal(src.propositionsDeposees.length, 1)
  assert.equal(src.propositionsDeposees[0].contexte.joueurs, undefined, 'toute la base : l’appli cherche dans ses fiches')
})

await t('nextar_proposer : bornes et erreurs (lignes, taille, contexte, nom ambigu, dépôt refusé)', async () => {
  const src = sourceFictive()
  const trop = garde(await outilProposer(src, reg, { lignes: Array.from({ length: 301 }, (_, i) => [`Joueur ${i}`, '1,9']) }))
  assert.match((trop as { erreur: string }).erreur, /299 au plus/)
  const lourd = garde(await outilProposer(src, reg, { tableau: 'x'.repeat(BORNES.octets + 1) }))
  assert.match((lourd as { erreur: string }).erreur, /200 Ko/)
  assert.ok('erreur' in garde(await outilProposer(src, reg, { evenement: 'ev-var', groupe: 'g-pole', tableau: TABLEAU })))
  assert.ok('erreur' in garde(await outilProposer(src, reg, {})))
  const inconnu = garde(await outilProposer(src, reg, { evenement: 'Tournoi de Mars', tableau: TABLEAU }))
  assert.match((inconnu as { erreur: string }).erreur, /Introuvable/)
  const amb = garde(await outilProposer(sourceFictive(), reg, { evenement: 'e', tableau: TABLEAU }))
  assert.ok('erreur' in amb)
  const refus = garde(await outilProposer(sourceFictive({ erreurDepot: 'Boîte pleine : 30 propositions en attente au plus.' }), reg, { tableau: TABLEAU }))
  assert.match((refus as { erreur: string }).erreur, /Boîte pleine/)
  assert.equal(src.propositionsDeposees.length, 0, 'rien de déposé sur erreur')
})

// ---------- Outils : suivi ----------

await t('nextar_suivi : état d’une proposition, liste des dernières ; jamais leurs lignes', async () => {
  const src = sourceFictive()
  const p = await outilProposer(src, reg, { tableau: TABLEAU })
  if (!('id' in p)) throw new Error()
  const s = garde(await outilSuivi(src, reg, { id: p.id }))
  assert.equal((s as { etat: string }).etat, 'en attente')
  assert.equal((s as { nb_lignes: number }).nb_lignes, 5)
  src.propositionsDeposees[0].etat = 'partielle'
  assert.equal((garde(await outilSuivi(src, reg, { id: p.id })) as { etat: string }).etat, 'validée en partie')
  const l = garde(await outilSuivi(src, reg, {}))
  assert.equal((l as { propositions: unknown[] }).propositions.length, 1)
  assert.ok('erreur' in garde(await outilSuivi(src, reg, { id: '00000000-0000-4000-8000-999999999999' })))
})

// ---------- Outils : lire ----------

await t('nextar_lire : lignes en codes (poste, année, sexe, département, vus, mesures, avis) ; aucun nom demandé à la base', async () => {
  const src = sourceFictive()
  const r = garde(await outilLire(src, reg, { annees: [2011], avec_mesures: 'toutes', avec_avis_criteres: true }))
  if (!('joueurs' in r)) throw new Error(JSON.stringify(r))
  const lucas = r.joueurs.find((j) => j.code === code('p-lucas'))!
  assert.deepEqual(lucas, {
    code: code('p-lucas'),
    poste: 'ARG',
    annee: 2011,
    sexe: 'M',
    departement: '83',
    vus: 2,
    mesures: { sprint_10: { valeur: 1.86, date: '2026-10-12' }, taille: { valeur: 176, date: '2026-10-12' } },
    avis: { nb: 2, moyenne: 4.2, criteres: { tir: 4.5, defense: 3.5, mental: 5 } },
  })
  assert.ok(!r.joueurs.some((j) => j.code === code('p-fondu') || j.code === code('p-hors')), 'fiche fondue et hors cadre exclues')
  assert.equal(r.total, 5)
  assert.equal(src.appelsNoms, 0, 'nextar_lire ne lit jamais les noms')
  console.log(`   exemple de ligne : ${JSON.stringify(lucas)}`)
})

await t('nextar_lire : filtres (sexe, postes, départements, événement, groupe, mesures, vus, avis), tri et limite', async () => {
  const src = sourceFictive()
  const codes = async (i: Parameters<typeof outilLire>[2]) => {
    const r = garde(await outilLire(src, reg, i))
    if (!('joueurs' in r)) throw new Error(JSON.stringify(r))
    return r.joueurs.map((j) => j.code)
  }
  assert.deepEqual(await codes({ sexe: 'F', annees: [2011], tri: { par: 'annee' } }), [code('p-emma'), code('p-lea')].sort())
  assert.deepEqual((await codes({ postes: ['ARG'] })).sort(), [code('p-lucas'), code('p-hugo')].sort())
  assert.deepEqual(await codes({ departements: ['2a'] }), [code('p-jade')])
  assert.deepEqual((await codes({ evenement: 'Détection U15 Var', postes: ['ARG', 'AG'] })).sort(), [code('p-lucas'), code('p-hugo'), code('p-hugo2')].sort())
  assert.deepEqual((await codes({ groupe: 'Pôle Espoirs Fictif', sexe: 'M' })).sort(), [code('p-lucas'), code('p-noah')].sort())
  assert.deepEqual(await codes({ mesures: [{ test: 'Sprint 10 m', max: 1.9 }] }), [code('p-lucas')])
  assert.deepEqual(await codes({ mesures: [{ test: 'cmj', min: 35 }] }), [code('p-noah')])
  assert.deepEqual(await codes({ vus_min: 2 }), [code('p-lucas')])
  assert.deepEqual(await codes({ avis_min: 4 }), [code('p-lucas'), code('p-emma')], 'tri par défaut : code ; avis')
  assert.deepEqual(await codes({ avis_criteres: [{ critere: 'Défense', min: 3.5 }], tri: { par: 'avis', ordre: 'desc' } }), [code('p-lucas'), code('p-emma')])
  assert.deepEqual(await codes({ annees: [2011], tri: { par: 'test', test: 'sprint_10', ordre: 'asc' }, limite: 2 }), [code('p-lucas'), code('p-hugo')])
  const lim = garde(await outilLire(src, reg, { limite: 5000 }))
  assert.ok('joueurs' in lim && lim.joueurs.length <= BORNES.lireMax)
  assert.ok('erreur' in garde(await outilLire(src, reg, { mesures: [{ test: 'Test inconnu' }] })))
  assert.ok('erreur' in garde(await outilLire(src, reg, { tri: { par: 'test' } })))
  assert.ok('erreur' in garde(await outilLire(src, reg, { evenement: 'ev-var', groupe: 'g-pole' })))
  assert.equal(src.appelsNoms, 0)
})

// ---------- Outils : rapport ----------

await t('nextar_rapport : gardé, lien /rapport/<id>, codes comptés, codes faux signalés, bornes', async () => {
  const src = sourceFictive()
  const md = `# Gauchers 2011\n\n| Code | Poste |\n|---|---|\n| ${code('p-lucas')} | ARG |\n| ${code('p-lea')} | ARD |\n\n${code('p-lucas')} est rapide. J-ZZZZZZZ ?`
  const r = garde(await outilRapport(src, reg, { markdown: md }))
  if (!('lien' in r)) throw new Error(JSON.stringify(r))
  assert.equal(r.titre, 'Gauchers 2011')
  assert.equal(r.lien, `https://exemple.test/HandBase/rapport/${r.id}`)
  assert.equal(r.codes, 2)
  assert.deepEqual(r.codes_invalides, ['J-ZZZZZZZ'])
  assert.equal(src.rapportsDeposes[0].contenu, md)
  assert.ok('erreur' in garde(await outilRapport(src, reg, { markdown: '   ' })))
  assert.ok('erreur' in garde(await outilRapport(src, reg, { markdown: 'x'.repeat(BORNES.rapport + 1) })))
})

// ---------- Outils : connexions (administrateurs seulement) ----------

const regC: Reglages = { ...reg, maintenant: MAINTENANT_FICTIF }
const interditsComptes = textesInterditsComptes()
/** Réponse de nextar_connexions : sa liste blanche, puis aucune adresse, aucun téléphone, aucun identifiant brut, aucun joueur. */
const gardeC = <T>(x: T): T => {
  verifierSortie(x, 'nextar_connexions')
  sorties.push(x)
  const s = JSON.stringify(x)
  for (const txt of [...interdits, ...interditsComptes]) assert.ok(!s.includes(txt), `« ${txt} » ne doit jamais sortir : ${s.slice(0, 300)}`)
  const cles = new Set<string>()
  const tour = (v: unknown) => {
    if (Array.isArray(v)) v.forEach(tour)
    else if (v && typeof v === 'object') for (const [k, w] of Object.entries(v)) (cles.add(k.toLowerCase()), tour(w))
  }
  tour(x)
  for (const k of cles) assert.ok(!/mail|phone|tel|^ip|user_?agent|user_?id|uid|token|jeton|session_id/.test(k), `clé « ${k} »`)
  return x
}
type ReponseC = Awaited<ReturnType<typeof outilConnexions>>
const liste = (r: ReponseC) => {
  if (!('connexions' in r)) throw new Error(JSON.stringify(r))
  return r
}
const [A, B, CAM, D, E, SR] = COMPTES

await t('nextar_connexions (admin, 10 min) : comptes vus sur la fenêtre, du plus récent, nom, rôle, périmètre, appareil, sessions', async () => {
  const r = liste(gardeC(await outilConnexions(sourceFictive({ admin: true }), regC, {})))
  assert.equal(r.fenetre_minutes, 10)
  assert.equal(r.maintenant, '2026-11-05T10:00:00.000Z')
  assert.equal(r.depuis, '2026-11-05T09:50:00.000Z')
  assert.equal(r.total, 4)
  assert.ok(!('tronque' in r))
  assert.deepEqual(
    r.connexions.map((c) => c.compte),
    [A, B, SR, CAM].map((c) => codeCompte(c.userId)),
    'Denis (12 min) et Élise (3 h) sont hors de la fenêtre ; tri du plus récent',
  )
  assert.deepEqual(r.connexions[0], {
    compte: codeCompte(A.userId),
    nom_affiche: 'Alice Administratrice-Fictive',
    role: 'Administrateur',
    perimetre: 'Toute la base (administrateur)',
    derniere_activite: '2026-11-05T09:59:00.000Z',
    il_y_a: 'il y a 1 min',
    appareil: 'ordinateur',
    sessions: 1,
  })
  assert.deepEqual(r.connexions[1], {
    compte: codeCompte(B.userId),
    nom_affiche: 'Bruno Encadrant-Fictif',
    role: 'Encadrant',
    perimetre: 'Comité Fictif du Var (83)',
    derniere_activite: '2026-11-05T09:57:00.000Z',
    il_y_a: 'il y a 3 min',
    appareil: 'téléphone',
    appli_installee: true,
    sessions: 2,
  })
  // Sans nom ni rôle, appareil farfelu (adresse IP, mail dans le texte) : rien de tout cela ne sort.
  assert.deepEqual(r.connexions[2], { compte: codeCompte(SR.userId), nom_affiche: '(nom pas encore choisi)', role: 'En attente (aucun rôle)', derniere_activite: '2026-11-05T09:55:00.000Z', il_y_a: 'il y a 5 min', sessions: 1 })
  // Nom du profil = adresse mail : remplacé.
  assert.equal(r.connexions[3].nom_affiche, '(nom pas encore choisi)')
  assert.equal(r.connexions[3].perimetre, 'Club Rêvé (n° 6383999)')
  assert.equal(r.connexions[3].appareil, 'téléphone ou tablette')
  assert.match(r.connexions[3].compte, /^C-[0-9A-HJKMNP-TV-Z]{7}$/)
})

await t('nextar_connexions : fenêtre plus large (15 min, 5 h, 7 jours), limite, tronque', async () => {
  const src = sourceFictive({ admin: true })
  const r15 = liste(gardeC(await outilConnexions(src, regC, { minutes: 15 })))
  assert.equal(r15.total, 5)
  const d = r15.connexions.find((c) => c.compte === codeCompte(D.userId))!
  assert.equal(d.perimetre, 'Toute la base', 'affecté au niveau Fédération')
  assert.equal(d.appareil, 'tablette')
  const r300 = liste(gardeC(await outilConnexions(src, regC, { minutes: 300 })))
  assert.equal(r300.total, 6)
  const e = r300.connexions[r300.connexions.length - 1]
  assert.equal(e.compte, codeCompte(E.userId))
  assert.equal(e.perimetre, 'secteur 13, 84')
  assert.equal(e.il_y_a, 'il y a 3 h 00')
  const semaine = liste(gardeC(await outilConnexions(src, regC, { minutes: 10_080 })))
  assert.equal(semaine.connexions[0].sessions, 2, 'la session d’avant-hier compte sur 7 jours')
  const lim = liste(gardeC(await outilConnexions(src, regC, { limite: 2 })))
  assert.equal(lim.connexions.length, 2)
  assert.equal(lim.total, 4)
  assert.equal(lim.tronque, true)
})

await t('nextar_connexions : bornes des paramètres (minutes 1 à 10 080, limite 1 à 200, valeurs folles ramenées)', async () => {
  const src = sourceFictive({ admin: true })
  const b = async (i: { minutes?: number; limite?: number }) => liste(gardeC(await outilConnexions(src, regC, i)))
  assert.equal((await b({ minutes: 0 })).fenetre_minutes, 1)
  assert.equal((await b({ minutes: -50 })).fenetre_minutes, 1)
  assert.equal((await b({ minutes: 1 })).total, 1, 'seule Alice (il y a 1 min, borne comprise)')
  assert.equal((await b({ minutes: 1e9 })).fenetre_minutes, BORNES.connexionsMinutesMax)
  assert.equal((await b({ minutes: Number.NaN })).fenetre_minutes, 10)
  assert.equal((await b({ minutes: 4.9 })).fenetre_minutes, 4)
  assert.equal((await b({ limite: 0 })).connexions.length, 1)
  const beaucoup = Array.from({ length: 260 }, (_, i) => ({ userId: `00000000-0000-4000-8000-${String(1000 + i).padStart(12, '0')}`, device: 'Ordinateur', startedAt: '2026-11-05T09:50:00.000Z', lastSeenAt: new Date(MAINTENANT_FICTIF - i * 1000).toISOString() }))
  const gros = liste(gardeC(await outilConnexions(sourceFictive({ admin: true, sessions: beaucoup }), regC, { limite: 5000 })))
  assert.equal(gros.connexions.length, BORNES.connexionsMax)
  assert.equal(gros.total, 260)
  assert.equal(gros.tronque, true)
  assert.equal(gros.connexions[0].nom_affiche, '(nom pas encore choisi)', 'compte sans profil')
  assert.deepEqual([BORNES.connexionsMinutes, BORNES.connexionsMinutesMax, BORNES.connexionsDefaut, BORNES.connexionsMax], [10, 10_080, 50, 200])
})

await t('nextar_connexions (coach, observateur) : « réservé aux administrateurs », aucune donnée lue ni rendue', async () => {
  const src = sourceFictive()
  const r = gardeC(await outilConnexions(src, regC, { minutes: 10_080, limite: 200 }))
  assert.deepEqual(Object.keys(r), ['erreur'])
  assert.match((r as { erreur: string }).erreur, /^Réservé aux administrateurs/)
  assert.equal(src.appelsConnexions, 0, 'ni connexions ni comptes demandés')
})

await t('nextar_connexions : aucune adresse mail même si la base en glisse une (nom, unité, champ en trop), clés interdites refusées', async () => {
  // Une Source qui en dit trop (champ email, nom = « Prénom <adresse> téléphone », unité avec un mail) : rien ne sort.
  const base = sourceFictive({ admin: true })
  const bavarde: Source = {
    ...base,
    comptes: async (ids) =>
      ids.map((id, i) => ({
        userId: id,
        fullName: i === 0 ? 'Jean Fictif <jean.fictif@exemple.test> 06 12 34 56 78' : 'Zoé Fictive (+33 6 12 34 56 78) 10.0.0.12',
        role: 'observateur',
        unites: [{ name: 'Comité contact@exemple.test', depts: ['83'] }],
        email: 'jean.fictif@exemple.test',
        phone: '0612345678',
      })) as never,
  }
  const r = liste(gardeC(await outilConnexions(bavarde, regC, { minutes: 60 })))
  assert.equal(r.connexions[0].nom_affiche, 'Jean Fictif')
  assert.equal(r.connexions[1].nom_affiche, 'Zoé Fictive')
  assert.equal(r.connexions[0].perimetre, 'Comité (83)')
  const s = JSON.stringify(r)
  assert.ok(!s.includes('@') && !/"(email|mail|phone|ip|user_agent)"/.test(s))
  // Le dernier verrou : la liste blanche de l'outil.
  const C = (o: Record<string, unknown>) => () => verifierSortie({ connexions: [{ compte: 'C-1', ...o }] }, 'nextar_connexions')
  assert.throws(C({ email: 'x' }), /interdite/)
  assert.throws(C({ 'e-mail': 'x' }), /interdite/)
  assert.throws(C({ mail: 'x' }), /interdite/)
  assert.throws(C({ phone: 'x' }), /interdite/)
  assert.throws(C({ telephone: 'x' }), /interdite/)
  assert.throws(C({ ip: 'x' }), /interdite/)
  assert.throws(C({ user_agent: 'x' }), /interdite/)
  assert.throws(C({ userAgent: 'x' }), /interdite/)
  assert.throws(C({ user_id: 'x' }), /interdite/)
  assert.throws(C({ token: 'x' }), /interdite/)
  assert.throws(C({ device: 'x' }), /interdite/)
  assert.throws(C({ nom_affiche: 'quelqu.un@exemple.test' }), /adresse mail ou IP/)
  assert.throws(C({ appareil: 'ordinateur 192.168.0.1' }), /adresse mail ou IP/)
  assert.throws(C({ code: 'J-1' }), /inconnue/, 'aucune clé des outils de joueurs')
  assert.throws(() => verifierSortie({ joueurs: [{ code: 'J-1', nom_affiche: 'X' }] }), /inconnue/, 'nom_affiche : seulement dans nextar_connexions')
  assert.doesNotThrow(C({ nom_affiche: 'Camille Fictive', role: 'Observateur', derniere_activite: '2026-11-05T09:58:12.000Z', il_y_a: 'il y a 2 min' }))
})

await t('nextar_connexions : petits outils (appareil, « il y a », coordonnées retirées, code de compte, rôles = appli)', () => {
  assert.deepEqual(typeAppareil('iPhone'), { appareil: 'téléphone' })
  assert.deepEqual(typeAppareil('iPad (appli installée)'), { appareil: 'tablette', appli_installee: true })
  assert.deepEqual(typeAppareil('Ordinateur'), { appareil: 'ordinateur' })
  assert.deepEqual(typeAppareil('Android (appli installée)'), { appareil: 'téléphone ou tablette', appli_installee: true })
  assert.deepEqual(typeAppareil('Mozilla/5.0 (appli installée)'), {})
  assert.deepEqual(typeAppareil(null), {})
  assert.equal(ilYA(20_000), 'à l’instant')
  assert.equal(ilYA(59 * 60_000), 'il y a 59 min')
  assert.equal(ilYA(125 * 60_000), 'il y a 2 h 05')
  assert.equal(ilYA(3 * 86_400_000 + 5), 'il y a 3 j')
  assert.equal(sansCoordonnees('Pôle 2025 - 2026', 80), 'Pôle 2025 - 2026', 'une saison n’est pas un téléphone')
  assert.equal(sansCoordonnees('Marc Fictif 06.12.34.56.78', 80), 'Marc Fictif')
  assert.equal(sansCoordonnees('a@b.c', 80), '')
  const c = codeCompte(A.userId)
  assert.equal(c, codeCompte(A.userId))
  assert.match(c, /^C-.{7}$/)
  assert.ok(!c.includes(A.userId))
  const roles = read('src/roles.ts')
  for (const [k, v] of Object.entries(ROLE_LIBELLE)) assert.match(roles, new RegExp(`\\b${k}: '${v}'`), `src/roles.ts : ${k} → ${v}`)
  assert.match(read('src/components/Members.tsx'), /'En attente \(aucun rôle\)'/)
  assert.match(read('src/components/Members.tsx'), /'\(nom pas encore choisi\)'/)
})

// ---------- Liste blanche ----------

await t('verifierSortie : clé interdite, clé inconnue, clé nominative dans un dictionnaire, texte trop long : refusés', () => {
  assert.throws(() => verifierSortie({ joueurs: [{ code: 'J-1', nom: 'X' }] }), /interdite/)
  assert.throws(() => verifierSortie({ joueurs: [{ code: 'J-1', lastName: 'X' }] }), /interdite/)
  assert.throws(() => verifierSortie({ joueurs: [{ code: 'J-1', surnom: 'X' }] }), /inconnue/)
  assert.throws(() => verifierSortie({ joueurs: [{ mesures: { birthDate: { valeur: 1 } } }] }), /interdite/)
  assert.throws(() => verifierSortie({ joueurs: [{ mesures: { cmj: { valeur: 1, club: 'x' } } }] }), /interdite/)
  assert.throws(() => verifierSortie({ message: 'x'.repeat(3000) }), /trop long/)
  assert.doesNotThrow(() => verifierSortie({ joueurs: [{ code: 'J-1', mesures: { sprint_10: { valeur: 1.9, date: '2026-01-01' } } }] }))
})

await t(`RÈGLE « AUCUN NOM » : ${''}aucune des réponses d’outils ne contient un nom, une date de naissance, un club, une licence ou un commentaire`, () => {
  assert.ok(sorties.length >= 30, `${sorties.length} réponses vérifiées`)
  const tout = JSON.stringify(sorties)
  for (const txt of interdits) assert.ok(!tout.includes(txt), txt)
  for (const p of JOUEURS) assert.ok(!tout.includes(p.birthDate))
  console.log(`   (${sorties.length} réponses, ${interdits.length} textes interdits cherchés)`)
})

// ---------- source.ts : ce qui est demandé à la base ----------

await t('source.ts : la lecture ne sélectionne ni noms ni commentaires ; écritures limitées aux propositions et rapports', async () => {
  const appels: { table: string; select?: string; insert?: unknown; ops: string[] }[] = []
  const faux = {
    from(table: string) {
      const a: (typeof appels)[number] = { table, ops: [] }
      appels.push(a)
      const q: Record<string, unknown> = {}
      const chain = (op: string) => (...args: unknown[]) => {
        a.ops.push(op)
        if (op === 'select') a.select = String(args[0])
        if (op === 'insert') a.insert = args[0]
        return q
      }
      for (const op of ['select', 'eq', 'in', 'or', 'order', 'range', 'limit', 'insert', 'is']) q[op] = chain(op)
      q.maybeSingle = async () => ({ data: null, error: null })
      q.single = async () => ({ data: { id: 'x', expires_at: 'y' }, error: null })
      q.then = (ok: (v: unknown) => void) => ok({ data: [], error: null })
      return q
    },
  }
  const src = sourceSupabase(faux)
  await src.joueursLire({ annees: [2011], postes: ['ARG'] }, 100)
  await src.joueursLire({ ids: ['a', 'b'] }, 100)
  await src.mesures(['a'])
  await src.avis(['a'])
  await src.vus(['a'])
  const lecture = appels.filter((a) => ['hb_players', 'hb_measurements', 'hb_evaluations', 'hb_seen'].includes(a.table))
  assert.ok(lecture.length >= 5)
  for (const a of lecture) {
    assert.ok(a.select && !/firstName|lastName|club|license|licence|strengths|improvements|portrait|observer|notes/.test(a.select), a.select)
    assert.ok(!/(^|[\s,])data(\s*,|$)/.test(a.select!), `« data » entier demandé : ${a.select}`)
  }
  await src.joueursNoms(['a'], 10)
  assert.match(appels[appels.length - 1].select!, /firstName/, 'le rapprochement, lui, lit les noms (côté serveur)')
  await src.deposerProposition({ titre: 't', contexte: {}, lignes: [['a']] })
  await src.deposerRapport({ titre: 't', contenu: 'c' })
  const ecritures = appels.filter((a) => a.ops.includes('insert'))
  assert.deepEqual(
    ecritures.map((a) => a.table),
    ['hb_propositions', 'hb_rapports'],
  )
  assert.equal((ecritures[0].insert as { source: string }).source, 'mcp')
  assert.ok(!appels.some((a) => a.ops.some((o) => o === 'update' || o === 'delete' || o === 'upsert' || o === 'rpc')))
})

await t('source.ts (connexions) : hb_is_admin, puis hb_connections et profils sans email ni téléphone ; aucune écriture', async () => {
  const appels: { table: string; select?: string; ops: string[] }[] = []
  const rpcs: string[] = []
  const reponses: Record<string, unknown[]> = {
    hb_connections: [{ u: 'u1', d: 'iPhone', s: '2026-11-05T09:00:00Z', l: '2026-11-05T09:58:00Z' }],
    hb_profiles: [{ user_id: 'u1', full_name: 'Compte Fictif', role: 'preparateur', departments: ['83'] }],
    hb_assignments: [{ u: 'u1', unite: 'unite-1' }],
    hb_units: [{ id: 'unite-1', n: 'Ligue Fictive', l: 'niveau-ligue', d: ['13', '83'], c: null }],
    hb_levels: [{ id: 'niveau-ligue', n: 'Ligue' }],
  }
  const faux = {
    rpc(fn: string) {
      rpcs.push(fn)
      return Promise.resolve({ data: fn === 'hb_is_admin', error: null })
    },
    from(table: string) {
      const a: (typeof appels)[number] = { table, ops: [] }
      appels.push(a)
      const q: Record<string, unknown> = {}
      const chain = (op: string) => (...args: unknown[]) => {
        a.ops.push(op)
        if (op === 'select') a.select = String(args[0])
        return q
      }
      for (const op of ['select', 'eq', 'in', 'gte', 'order', 'range', 'limit', 'insert', 'update', 'delete', 'upsert']) q[op] = chain(op)
      q.then = (ok: (v: unknown) => void) => ok({ data: reponses[table] ?? [], error: null })
      return q
    },
  }
  const src = sourceSupabase(faux)
  assert.equal(await src.estAdmin(), true)
  assert.deepEqual(rpcs, ['hb_is_admin'])
  const cx = await src.connexions('2026-11-05T09:50:00Z', 100)
  assert.deepEqual(cx.sessions, [{ userId: 'u1', device: 'iPhone', startedAt: '2026-11-05T09:00:00Z', lastSeenAt: '2026-11-05T09:58:00Z' }])
  assert.ok(appels[0].ops.includes('gte'))
  const cs = await src.comptes(['u1'])
  assert.deepEqual(cs, [{ userId: 'u1', fullName: 'Compte Fictif', role: 'preparateur', departments: ['83'], unites: [{ name: 'Ligue Fictive', depts: ['13', '83'] }] }])
  const prof = appels.find((a) => a.table === 'hb_profiles')!
  assert.equal(prof.select, 'user_id, full_name, role, departments')
  for (const a of appels) {
    assert.ok(a.select && !/email|phone|mail|postalCode|city|lat|lng|ip|agent/i.test(a.select), `${a.table} : ${a.select}`)
    assert.ok(!/(^|[\s,])data(\s*,|$)/.test(a.select), `« data » entier demandé : ${a.select}`)
    assert.ok(!a.ops.some((o) => ['insert', 'update', 'delete', 'upsert'].includes(o)), a.table)
  }
  // hb_is_admin en erreur, ou autre chose que true : pas administrateur.
  const non = sourceSupabase({ ...faux, rpc: () => Promise.resolve({ data: null, error: { message: 'absente', code: 'PGRST202' } }) })
  assert.equal(await non.estAdmin(), false)
  const texte = sourceSupabase({ ...faux, rpc: () => Promise.resolve({ data: 'true', error: null }) })
  assert.equal(await texte.estAdmin(), false)
})

// ---------- Rapport : remise des noms sur l'appareil ----------

await t('rapport → noms remis sur l’appareil : Markdown, fiche fondue, code inconnu, faux, partagé', () => {
  const fiches = [
    ...JOUEURS.filter((p) => p.id !== 'p-fondu'),
    { id: 'p-fondu', firstName: 'Lucas', lastName: 'Exemplaire', mergedInto: 'p-lucas' },
  ].map((p) => (p.id === 'p-lucas' ? { ...p, mergedFrom: [{ id: 'p-fondu' }] } : p))
  const idx = indexFiches(fiches)
  assert.equal(idx.fiches, JOUEURS.length - 1)
  const md = `# Rapport\n\n| Code | Note |\n|---|---|\n| ${code('p-lucas')} | **très bien** |\n\n- ${code('p-fondu')} (fiche fondue)\n- ${code('p-absent')} hors appareil\n- J-ZZZZZZZ faux`
  const blocs = parseMarkdown(md)
  assert.deepEqual(
    blocs.map((b) => b.k),
    ['h', 'table', 'ul'],
  )
  const tab = blocs[1].k === 'table' ? blocs[1] : null
  const cell = tab!.rows[0][0]
  const m = remplacerCodes(inlineText(cell), idx.index, idx.nomDe)
  assert.deepEqual(m, [{ k: 'joueur', code: code('p-lucas'), nom: 'Lucas Exemplaire', id: 'p-lucas' }])
  const ul = blocs[2].k === 'ul' ? blocs[2] : null
  const items = ul!.items.map((it) => remplacerCodes(inlineText(it.c), idx.index, idx.nomDe))
  assert.equal(items[0][0].k, 'joueur')
  assert.equal(items[0][0].k === 'joueur' && idx.ficheDe(items[0][0].id), 'p-lucas', 'fiche fondue → fiche qui reste')
  assert.deepEqual(items[1][0], { k: 'code', code: code('p-absent'), raison: 'inconnu' })
  assert.deepEqual(items[2][0], { k: 'code', code: 'J-ZZZZZZZ', raison: 'invalide' })
  assert.equal(items[1][1].k === 'texte' && items[1][1].t, ' hors appareil')
  // Code partagé par deux fiches de l'appareil : pas de nom.
  const [a, b] = collision
  const idx2 = indexFiches([{ id: a, firstName: 'Alpha', lastName: 'Fictif' }, { id: b, firstName: 'Beta', lastName: 'Fictif' }])
  assert.equal(remplacerCodes(code(a), idx2.index, idx2.nomDe)[0].k, 'code')
  // Fiche supprimée : plus de nom.
  const idx3 = indexFiches([{ id: 'p-lucas', firstName: 'Lucas', lastName: 'Exemplaire', deleted: true }])
  assert.equal(remplacerCodes(code('p-lucas'), idx3.index, idx3.nomDe)[0].k, 'code')
})

await t('Markdown du rapport : titres, listes, citations, tableaux, gras, liens http seulement, échappements', () => {
  const b = parseMarkdown('## Titre ##\nUn **gras** et *italique*, `code`, [site](https://exemple.test) [piège](javascript:alert(1)) sprint_10.\n\n1. un\n2. deux\n   suite\n  - sous\n\n> cité\n\n---\n\n```\nbrut **pas gras**\n```\n\\*pas italique\\*')
  assert.deepEqual(
    b.map((x) => x.k),
    ['h', 'p', 'ol', 'quote', 'hr', 'code', 'p'],
  )
  const p = b[1].k === 'p' ? b[1].c : []
  assert.deepEqual(
    p.map((x) => x.k),
    ['t', 'b', 't', 'i', 't', 'code', 't', 'a', 't'],
  )
  assert.ok(!p.some((x) => x.k === 'a' && x.href.startsWith('javascript')))
  assert.match(inlineText(p), /piège sprint_10\./)
  const ol = b[2].k === 'ol' ? b[2] : null
  assert.equal(ol!.items.length, 3)
  assert.equal(inlineText(ol!.items[1].c), 'deux suite')
  assert.equal(ol!.items[2].depth, 1)
  assert.equal(b[5].k === 'code' && b[5].t, 'brut **pas gras**')
  assert.equal(inlineText(b[6].k === 'p' ? b[6].c : []), '*pas italique*')
  assert.deepEqual(parseInline('a_b_c'), [{ k: 't', t: 'a_b_c' }])
})

// ---------- Bornes et branchements ----------

await t('bornes du serveur = scripts 067 et 068 ; 068 : auteur seul, pas de modification, purge', () => {
  const s067 = read('supabase/067_propositions.sql')
  assert.match(s067, /jsonb_array_length\(lignes\) between 1 and 300/)
  assert.equal(BORNES.lignes, 300)
  assert.match(s067, /source in \('collage', 'mcp', 'photo'\)/)
  const s068 = read('supabase/068_rapports.sql')
  assert.match(s068, /length\(contenu\) between 1 and 100000/)
  assert.equal(BORNES.rapport, 100_000)
  assert.match(s068, /length\(titre\) between 1 and 120/)
  assert.equal(BORNES.titreRapport, 120)
  assert.match(s068, /grant select, insert, delete on public\.hb_rapports to authenticated/)
  assert.ok(!/grant[^;]*update[^;]*hb_rapports to authenticated/i.test(s068))
  assert.match(s068, /interval '30 days'/)
  assert.match(s068, /hb_rapports_purger/)
})

await t('branchements : fonction (outils, OAuth, client du coach, jamais la clé de service), appli (routes, Réglages, boîte)', () => {
  const srv = read('supabase/functions/mcp/serveur.ts')
  for (const outil of ['nextar_contexte', 'nextar_proposer', 'nextar_suivi', 'nextar_lire', 'nextar_rapport', 'nextar_connexions']) assert.match(srv, new RegExp(`'${outil}'`))
  assert.match(srv, /Réservé aux administrateurs ; noms et rôles des comptes, jamais d’adresse mail/)
  assert.match(srv, /minutes: z\.number\(\)\.int\(\)\.min\(1\)\.max\(BORNES\.connexionsMinutesMax\)/)
  assert.match(srv, /limite: z\.number\(\)\.int\(\)\.min\(1\)\.max\(BORNES\.connexionsMax\)/)
  assert.match(srv, /withOAuthProtectedResource\(/)
  assert.match(srv, /withSupabase\(\{ auth: 'user' \}\)/)
  assert.match(srv, /verifierSortie\(out, nom\)/)
  assert.match(srv, /createMcpHandler\(/)
  const idx = read('supabase/functions/mcp/index.ts')
  assert.match(idx, /sourceSupabase\(ctx\.supabase/)
  for (const f of ['index.ts', 'serveur.ts', 'outils.ts', 'source.ts']) {
    const txt = read(`supabase/functions/mcp/${f}`)
    assert.ok(!/supabaseAdmin|SERVICE_ROLE|service_role|sb_secret/.test(txt.replace(/\/\/.*$/gm, '')), `${f} : jamais la clé de service`)
  }
  assert.match(read('supabase/functions/mcp/deno.json'), /"nodeModulesDir": "none"/)
  const app = read('src/App.tsx')
  assert.match(app, /path="\/rapport\/:id"/)
  assert.equal((app.match(/path="\/oauth\/consent"/g) ?? []).length, 2, 'staff et compte joueur')
  assert.match(read('src/pages/Settings.tsx'), /<ConnectedApps \/>/)
  const consent = read('src/pages/OAuthConsent.tsx')
  assert.match(consent, /getAuthorizationDetails/)
  assert.match(consent, /approveAuthorization/)
  assert.match(consent, /denyAuthorization/)
  assert.match(consent, /scrim/)
  const apps = read('src/components/ConnectedApps.tsx')
  assert.match(apps, /listGrants\(\)/)
  assert.match(apps, /revokeGrant\(/)
  assert.match(read('src/pages/Rapport.tsx'), /useNomsParCode\(\)/)
  assert.ok(!/dangerouslySetInnerHTML/.test(read('src/pages/Rapport.tsx')), 'aucun HTML du rapport injecté')
  assert.match(read('src/propositionsCore.ts'), /mcp: 'depuis Claude'/)
})

await t('types des fichiers purs de la fonction (npx tsc -p tools/tsconfig-mcp.json)', () => {
  execFileSync('npx', ['tsc', '-p', 'tools/tsconfig-mcp.json'], { cwd: fileURLToPath(new URL('..', import.meta.url)), stdio: 'pipe' })
})

console.log(`\n${n} tests verts.`)
