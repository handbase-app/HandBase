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
//  - outils d'administration (admin.ts : nextar_admin_a_faire, _sante, _activite, _questions) : refus SANS AUCUNE lecture pour
//    un compte qui n'est pas administrateur ; listes blanches propres ; joueurs en codes ; noms masqués côté serveur dans les
//    questions ([joueur], [nom], [licence]) ; doublons = règle de src/merge.ts ; 069 absent / appliqué / en erreur ; bornes ;
//    source.ts (colonnes nommées, comptages sans lignes, aucune écriture) ; supabase/069_admin_sante.sql (définition, droits) ;
//  - nextar_admin_proposer (adminProposer.ts) : refus sans lecture NI écriture pour un compte qui n'est pas administrateur ;
//    rôles (jamais administrateur, jamais le dernier administrateur, jamais son propre compte, rôle déjà là, staff → joueur),
//    périmètres (unité par nom ou identifiant, nom ambigu, secteur), archivage (déjà archivé, groupe Pôle, fin de saison),
//    fusions (codes J-… résolus, fiche fondue, code faux) ; bornes (50 actions) ; 070 absent (« indisponible ») ; lignes
//    déposées lisibles par l'appli ; supabase/070_propositions_admin.sql (additif, sorte réservée aux administrateurs) ;
//  - rapport → remplacement local des codes (Markdown, fiches fondues, codes inconnus, partagés, faux) ;
//  - copies générées à jour (tools/generer-partage-mcp.ts), bornes égales à celles des scripts 067 et 068, branchements.
//
//   npx jiti tools/test-mcp.ts
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
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
import { doublonsProbables, masqueNoms, outilAdminActivite, outilAdminAFaire, outilAdminQuestions, outilAdminSante, REFUS_ADMIN, taille } from '../supabase/functions/mcp/admin'
import { INDISPONIBLE_070, outilAdminProposer, type AdminProposerInput } from '../supabase/functions/mcp/adminProposer'
import { lireAction } from '../src/propositionsAdminCore'
import { actionsDe, libelleAction, resumeAdmin } from '../src/propositionsAdmin'
import { sourceSupabase } from '../supabase/functions/mcp/source'
import { copiesPerimees } from './generer-partage-mcp'
import {
  COMPTE_INACTIF,
  COMPTES,
  CRITERES,
  EVENEMENTS,
  grandeBase,
  JOUEURS,
  JOUEURS_ADMIN,
  MAINTENANT_FICTIF,
  SECOND_ADMIN,
  sourceFictive,
  textesInterdits,
  textesInterditsAdmin,
  textesInterditsComptes,
} from './mcp-jeu-fictif'

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

// ---------- Outils d'administration (admin.ts), lecture seule ----------

/** Adresse de l'appli des essais d'administration (« exemple.test » est cherché comme reste d'adresse mail). */
const regA: Reglages = { ...regC, appUrl: 'https://nextar-essai.invalid/HandBase' }
const interditsAdmin = [...textesInterdits([...JOUEURS, ...JOUEURS_ADMIN]), ...textesInterditsAdmin()]
const sortiesAdmin: unknown[] = []
/** Réponse d'un outil d'administration : sa liste blanche, puis aucun nom de joueur, mail, téléphone, IP, jeton du jeu. */
const gardeA = <T>(outil: string, x: T): T => {
  verifierSortie(x, outil)
  sortiesAdmin.push(x)
  const s = JSON.stringify(x)
  for (const txt of interditsAdmin) assert.ok(!s.includes(txt), `${outil} : « ${txt} » ne doit jamais sortir : ${s.slice(0, 300)}`)
  assert.ok(!s.includes('@'), `${outil} : « @ »`)
  assert.ok(!/\b\d{1,3}(\.\d{1,3}){3}\b/.test(s), `${outil} : adresse IP`)
  for (const c of [...COMPTES, COMPTE_INACTIF]) assert.ok(!s.includes(c.userId), `${outil} : identifiant brut`)
  for (const p of [...JOUEURS, ...JOUEURS_ADMIN]) assert.ok(!s.includes(`"${p.id}"`), `${outil} : identifiant de fiche ${p.id}`)
  return x
}
const ok = <T,>(r: T): Exclude<T, { erreur: string }> => {
  if (r && typeof r === 'object' && 'erreur' in r && Object.keys(r).length === 1) throw new Error(JSON.stringify(r))
  return r as Exclude<T, { erreur: string }>
}
const OUTILS_ADMIN = {
  nextar_admin_a_faire: (s: Source) => outilAdminAFaire(s, regA, {}),
  nextar_admin_sante: (s: Source) => outilAdminSante(s, regA),
  nextar_admin_activite: (s: Source) => outilAdminActivite(s, regA, {}),
  nextar_admin_questions: (s: Source) => outilAdminQuestions(s, regA, {}),
  nextar_admin_proposer: (s: Source) => outilAdminProposer(s, regA, { sorte: 'role', actions: [{ compte: codeCompte(COMPTES[1].userId), role: 'observateur' }] }),
} as const

await t('outils d’administration : un compte qui n’est pas administrateur reçoit un refus, sans AUCUNE lecture', async () => {
  for (const [nom, f] of Object.entries(OUTILS_ADMIN)) {
    const src = sourceFictive()
    const r = gardeA(nom, await f(src))
    assert.deepEqual(r, { erreur: REFUS_ADMIN }, nom)
    assert.equal(src.appelsAdmin, 0, `${nom} : aucune lecture d'administration`)
    assert.equal(src.appelsConnexions, 0, `${nom} : aucune connexion lue`)
    assert.equal(src.appelsNoms, 0, `${nom} : aucun nom lu`)
  }
})

await t('nextar_admin_a_faire : comptes sans rôle, fiches et avis à valider (codes, auteur par nom affiché), doublons, questions à traiter', async () => {
  const src = sourceFictive({ admin: true })
  const r = ok(gardeA('nextar_admin_a_faire', await outilAdminAFaire(src, regA, {})))
  assert.deepEqual(r.resume, { comptes_sans_role: 1, fiches_a_valider: 2, avis_a_valider: 2, doublons: 2, propositions_en_attente: 0, questions_a_traiter: 8 })
  assert.deepEqual(r.comptes_sans_role, [{ compte: codeCompte(SR.userId), nom_affiche: '(nom pas encore choisi)', depuis: '2026-11-04T07:00:00.000Z', il_y_a: 'il y a 1 j' }])
  assert.deepEqual(r.fiches_a_valider[0], {
    code: code('p-noah-bis'),
    poste: 'PIV',
    annee: 2012,
    departement: '13',
    proposee_le: '2026-10-30T18:00:00.000Z',
    il_y_a: 'il y a 5 j',
    par: { compte: codeCompte(CAM.userId), nom_affiche: '(nom pas encore choisi)' },
  }, 'la plus ancienne d’abord ; nom du profil = adresse mail : remplacé')
  assert.equal(r.fiches_a_valider[1].par.nom_affiche, 'Bruno Encadrant-Fictif')
  assert.deepEqual(r.avis_a_valider.map((a) => a.code), [code('p-emma'), code('p-jade')])
  assert.equal(r.avis_a_valider[1].par.nom_affiche, '(compte supprimé ou invisible)')
  assert.deepEqual(r.doublons, [
    { codes: [code('p-noah'), code('p-noah-bis')], raison: 'même prénom et même nom (sans accents ni tirets), même année de naissance ; fiche proposée' },
    { codes: [code('p-zoe-bis'), code('p-hors')], raison: 'même prénom et même nom (sans accents ni tirets), même date de naissance ; fiche hors cadre' },
  ], 'fiche fondue (p-fondu) ignorée ; homonymes sans fiche proposée ni hors cadre ignorés ; [à garder, à fondre]')
  assert.equal(r.questions_a_traiter, 8)
  assert.equal(r.liens.validation, 'https://nextar-essai.invalid/HandBase/avis-spontanes')
  assert.ok(!('tronque' in r))
})

await t('nextar_admin_a_faire : limite (bornée), propositions du compte au titre masqué, trop de fiches → pas de doublons ni de titres', async () => {
  const src = sourceFictive({ admin: true })
  await outilProposer(src, reg, { titre: 'Tests de Lucas Exemplaire', evenement: 'Détection U15 Var', lignes: [{ nom: 'Exemplaire', prenom: 'Lucas', valeurs: { sprint_10: 1.9 } }] })
  const r1 = ok(gardeA('nextar_admin_a_faire', await outilAdminAFaire(src, regA, { limite: 1 })))
  assert.equal(r1.fiches_a_valider.length, 1)
  assert.equal(r1.doublons.length, 1)
  assert.equal(r1.tronque, true)
  assert.equal(r1.resume.propositions_en_attente, 1)
  assert.equal(r1.propositions_en_attente[0].titre, 'Tests de [joueur]')
  const rMax = ok(gardeA('nextar_admin_a_faire', await outilAdminAFaire(src, regA, { limite: 10_000 })))
  assert.equal(rMax.fiches_a_valider.length, 2, 'limite bornée à 50 : tout tient')
  const trop = sourceFictive({ admin: true, nomsTronques: true })
  await outilProposer(trop, reg, { titre: 'Tests de Lucas Exemplaire', lignes: [['Lucas Exemplaire', '1,9']], colonnes: ['Joueur', 'sprint_10'] })
  const r2 = ok(gardeA('nextar_admin_a_faire', await outilAdminAFaire(trop, regA, {})))
  assert.equal(r2.resume.doublons, null)
  assert.deepEqual(r2.doublons, [])
  assert.ok(r2.avertissements.some((a) => /doublons non calculés/.test(a)))
  assert.ok(r2.propositions_en_attente.length === 1 && !('titre' in r2.propositions_en_attente[0]), 'sans la liste des noms : pas de titre')
})

await t('doublons probables : même règle que src/merge.ts (possibleDuplicates) et que le filtre de l’écran Propositions', () => {
  const merge = read('src/merge.ts')
  assert.match(merge, /const sameBirth = \(a\?: string, b\?: string\) => !a \|\| !b \|\| a === b \|\| \(a\.length === 4 \|\| b\.length === 4 \? a\.slice\(0, 4\) === b\.slice\(0, 4\) : false\)/)
  assert.match(merge, /\.replace\(\/\[\^a-zA-Z\]\/g, ''\)/)
  assert.match(read('src/pages/Review.tsx'), /possibleDuplicates\(alive\(await db\.players\.toArray\(\)\)\)\.filter\(\(\[a, b\]\) => !!a\.review \|\| !!b\.review\)/)
  const d = doublonsProbables([
    { id: 'a', firstName: 'Jean-Pierre', lastName: "D'Amico", birthDate: '2011-01-01' },
    { id: 'b', firstName: 'Jean Pierre', lastName: 'Damico', birthDate: '2011', review: 'pending' },
    { id: 'c', firstName: 'Jean-Pierre', lastName: 'Damico', birthDate: '2012-01-01', review: 'pending' },
    { id: 'd', firstName: 'Paul', lastName: 'Sansétat' },
    { id: 'e', firstName: 'Paul', lastName: 'Sansetat' },
    { id: 'demo-1', firstName: 'Jean-Pierre', lastName: 'Damico', review: 'pending' },
  ])
  assert.deepEqual(d.map((x) => [x.a.id, x.b.id]), [['a', 'b']], 'naissances incompatibles, ni proposée ni hors cadre, démo : ignorés')
})

await t('masquage des noms (questions, titres) : mots et parties de noms, minuscules sans accents, mots outils, vocabulaire, mots propres, coordonnées', () => {
  const m = masqueNoms([{ firstName: 'Jean-Pierre', lastName: "D'Amico" }, { firstName: 'Léa', lastName: 'Bidonville' }, { firstName: 'Rose', lastName: 'De' }], ['Pôle Espoirs Fictif', 'Sprint 10 m', 'Var'])
  assert.equal(m.texte('Montre Jean-Pierre et lea bidonville', 200), 'Montre [joueur] et [joueur]')
  assert.equal(m.texte("les mesures de d'Amico", 200), 'les mesures de [joueur]', 'nom collé (« damico ») : tout le mot')
  assert.equal(m.texte("la sœur d'Bidonville", 200), "la sœur d'[joueur]", 'partie d’un mot composé')
  assert.equal(m.texte('la de rose', 200), 'la de [joueur]', '« de » est un mot outil même si c’est un nom ; « rose » est un prénom du périmètre')
  assert.equal(m.texte('Sprint au Pôle Espoirs Fictif du Var', 200), 'Sprint au Pôle Espoirs Fictif du Var', 'vocabulaire de l’installation gardé')
  assert.equal(m.texte('Joueurs de Martigues vus par Durand', 200), 'Joueurs de [nom] vus par [nom]', 'mot propre inconnu hors début de phrase')
  assert.equal(m.texte('Martigues ? Durand. ARG GB', 200), 'Martigues ? Durand. ARG GB', 'début de phrase et sigles : gardés')
  assert.equal(m.texte('[prénom] [nom] et [prénom]', 200), '[joueur] et [joueur]')
  assert.equal(m.texte('licence 6383001000111 tel 06 12 34 56 78 mail x.y@exemple.test ip 10.0.0.1', 200), 'licence [licence] tel mail ip')
  assert.equal(m.noms, 8, 'jean, pierre, jeanpierre, amico, damico, lea, bidonville, rose')
  assert.equal(masqueNoms([]).texte('x'.repeat(500), 50).length, 50)
})

await t('nextar_admin_sante : sans 069 (« indisponible tant que 069… »), avec 069 (champs connus seulement), 069 en erreur', async () => {
  const sans = ok(gardeA('nextar_admin_sante', await outilAdminSante(sourceFictive({ admin: true }), regA)))
  assert.equal(sans.script_069, 'pas appliqué')
  assert.match(String(sans.base), /^indisponible tant que supabase\/069_admin_sante\.sql n’est pas appliqué$/)
  assert.equal(sans.tables, sans.base)
  assert.deepEqual(sans.indisponible, ['base', 'tables', 'registre', 'charge', 'abonnements', 'veille', 'notifications', 'taches', 'transcription'])
  assert.deepEqual(sans.volumes[0], { table: 'fiches joueur', lignes: JOUEURS.length + JOUEURS_ADMIN.length - 1 })
  assert.deepEqual(sans.volumes.find((v) => v.table === 'vidéos'), { table: 'vidéos', lignes: null, precision: 'illisible avec ce compte' })
  assert.deepEqual(sans.comptes.par_role.find((x) => x.role === 'Observateur'), { role: 'Observateur', nb: 4 })
  assert.equal(sans.connexions.comptes_24h, 6)
  assert.equal(sans.connexions.appli_installee_30j, 1)
  assert.match(sans.version_appli, /^indisponible/)
  assert.deepEqual(sans.journal_questions, { questions_7j: 7, erreurs_7j: 1 })
  assert.equal(sans.derniere_ecriture, '2026-11-05T09:56:00.000Z')
  const avec = ok(gardeA('nextar_admin_sante', await outilAdminSante(sourceFictive({ admin: true, sante: 'ok' }), regA)))
  assert.equal(avec.script_069, 'appliqué')
  assert.ok(!('indisponible' in avec))
  assert.deepEqual(avec.base, { taille_octets: 439_353_344, taille: '419 Mo', postgres: '17.4' })
  assert.deepEqual((avec.tables as { table: string }[]).map((x) => x.table), ['hb_registre', 'hb_measurements', 'hb_players'])
  assert.deepEqual(avec.abonnements, { total: 4, comptes: 3, par_appareil: [{ appareil: 'iPhone', nb: 3 }, { appareil: 'Android', nb: 1 }], sans_envoi_reussi_30j: 1 }, 'clé en trop (endpoint) non recopiée')
  assert.deepEqual((avec.taches as { tache: string }[]).map((x) => x.tache), ['handbase-purge', 'alerte'], 'adresse mail retirée du nom de tâche')
  assert.deepEqual(avec.notifications, { en_attente: 0 })
  const err = ok(gardeA('nextar_admin_sante', await outilAdminSante(sourceFictive({ admin: true, sante: 'erreur' }), regA)))
  assert.equal(err.script_069, 'erreur')
  assert.ok(err.avertissements.some((a) => /hb_admin_sante \(069\) a répondu par une erreur/.test(a)))
  assert.equal(taille(1023), '1023 octets')
  assert.equal(taille(1536), '1,5 Ko')
  assert.equal(taille(-1), undefined)
})

await t('nextar_admin_activite : par compte du staff (créations sur la période), dernière activité, inactifs, bornes', async () => {
  const src = sourceFictive({ admin: true })
  const r = ok(gardeA('nextar_admin_activite', await outilAdminActivite(src, regA, {})))
  assert.equal(r.periode_jours, 30)
  assert.equal(r.depuis, '2026-10-06T10:00:00.000Z')
  assert.equal(r.total, 6, 'compte sans rôle exclu')
  assert.deepEqual(r.totaux, { avis: 19, mesures: 170, evenements: 4, vus: 95, fiches: 4 })
  assert.deepEqual(r.comptes[0], { compte: codeCompte(A.userId), nom_affiche: 'Alice Administratrice-Fictive', role: 'Administrateur', avis: 2, mesures: 140, evenements: 3, vus: 25, fiches: 1, derniere_activite: '2026-11-05T09:59:00.000Z', il_y_a: 'il y a 1 min' })
  assert.equal(r.comptes[1].nom_affiche, 'Bruno Encadrant-Fictif')
  assert.ok(!r.comptes.some((c) => c.compte === codeCompte(SR.userId)))
  assert.deepEqual(r.inactifs, { seuil_jours: 30, total: 1, comptes: [{ compte: codeCompte(COMPTE_INACTIF.userId), nom_affiche: 'Fabien Inactif-Fictif', role: 'Observateur', derniere_activite: '2026-09-21T10:00:00.000Z', il_y_a: 'il y a 45 j' }] })
  const r60 = ok(gardeA('nextar_admin_activite', await outilAdminActivite(src, regA, { inactifs_jours: 60 })))
  assert.equal(r60.inactifs.total, 0)
  const b = ok(gardeA('nextar_admin_activite', await outilAdminActivite(src, regA, { jours: 0, inactifs_jours: 10_000, limite: 2 })))
  assert.equal(b.periode_jours, 1)
  assert.equal(b.inactifs.seuil_jours, 365)
  assert.equal(b.comptes.length, 2)
  assert.equal(b.tronque, true)
  const grand = ok(gardeA('nextar_admin_activite', await outilAdminActivite(src, regA, { jours: 9999 })))
  assert.equal(grand.periode_jours, 365)
})

await t('nextar_admin_questions : à traiter, regroupées, noms masqués côté serveur, comptes distincts, avis, bornes, période', async () => {
  const src = sourceFictive({ admin: true })
  const r = ok(gardeA('nextar_admin_questions', await outilAdminQuestions(src, regA, {})))
  if (!('groupes' in r) || !('total' in r)) throw new Error('groupes attendus')
  assert.deepEqual(r.resume, { questions: 8, a_traiter: 7, ratees: 5, sauvees: 1, comprises: 2, comptes: 2, avis: { super: 0, mauvaise: 1, sans_reponse: 0 } })
  assert.equal(r.total, 6, '« liste des gardiens… » comprise : pas à traiter')
  const g0 = r.groupes[0]
  assert.equal(g0.formulation, 'Montre les mesures de [joueur]')
  assert.deepEqual(g0.autres_formulations, ['montre les mesures de [joueur]'], 'minuscules sans accents : masqué aussi, même groupe')
  assert.equal(g0.nb, 2)
  assert.equal(g0.comptes, 2)
  assert.equal(g0.issue, 'Ratée')
  const sauvee = r.groupes.find((g) => g.issue === 'Sauvée par le mode avancé')!
  assert.equal(sauvee.formulation, '[joueur] a-t-il progressé au Sprint 10 m ?')
  assert.deepEqual(sauvee.pas_applique, ['[joueur]', 'tri par progression'])
  const avis = r.groupes.find((g) => g.avis)!
  assert.equal(avis.formulation, 'Gauchers nés en 2011 dans le Var')
  assert.equal(avis.ce_qu_ils_voulaient![0], 'je voulais la fiche de [joueur], appeler le ou', 'nom, téléphone et mail retirés du commentaire')
  assert.ok(r.groupes.some((g) => g.formulation === 'Qui est [joueur] ?'), 'adresse IP retirée')
  assert.ok(r.groupes.some((g) => g.formulation === 'Joueurs vus à [nom] et [nom]'))
  assert.match(r.masquage, /\[joueur\]/)
  assert.ok(!JSON.stringify(r).includes('Tom'), 'question de plus de 30 jours : hors période')
  const r60 = ok(gardeA('nextar_admin_questions', await outilAdminQuestions(src, regA, { jours: 60, filtre: 'toutes', limite: 1 })))
  if (!('groupes' in r60)) throw new Error('groupes attendus')
  assert.equal(r60.resume.questions, 9)
  assert.equal(r60.groupes.length, 1)
  assert.equal(r60.tronque, true)
  const tout = ok(gardeA('nextar_admin_questions', await outilAdminQuestions(src, regA, { jours: 60, filtre: 'toutes', limite: 1000 })))
  assert.ok(JSON.stringify(tout).includes('licence [licence] de [joueur]'), 'licence et « Tom Utopiste » masqués')
  assert.ok(JSON.stringify(tout).includes('liste des gardiens du Pôle Espoirs Fictif'), 'vocabulaire gardé')
  const b = ok(gardeA('nextar_admin_questions', await outilAdminQuestions(src, regA, { jours: 0 })))
  assert.equal(b.periode_jours, 1)
  // Trop de fiches pour lire tous les noms : aucune formulation, seulement les nombres et les pages.
  const trop = ok(gardeA('nextar_admin_questions', await outilAdminQuestions(sourceFictive({ admin: true, nomsTronques: true }), regA, {})))
  assert.deepEqual(trop.groupes, [])
  assert.match(trop.masquage, /aucune formulation n’est rendue/)
  assert.equal(trop.resume.a_traiter, 7)
})

// ---------- nextar_admin_proposer : préparer des actions d'administration (adminProposer.ts) ----------

const C = (i: number) => codeCompte(COMPTES[i].userId)
const proposer = async (o: Parameters<typeof sourceFictive>[0], input: AdminProposerInput) => {
  const src = sourceFictive({ admin: true, ...o })
  const r = gardeA('nextar_admin_proposer', await outilAdminProposer(src, regA, input)) as Record<string, unknown> & {
    actions?: { n: number; etat: string; raison?: string; [k: string]: unknown }[]
    resume?: { pretes: number; refusees: number }
  }
  return { src, r, act: (n: number) => r.actions!.find((a) => a.n === n)! }
}

await t('nextar_admin_proposer : un compte qui n’est pas administrateur reçoit un refus, sans RIEN lire ni écrire (toutes les sortes)', async () => {
  for (const input of [
    { sorte: 'role', actions: [{ compte: C(1), role: 'observateur' }] },
    { sorte: 'perimetre', actions: [{ compte: C(1), unite: 'u-var' }] },
    { sorte: 'archiver', evenements_avant: '2026-07-01' },
    { sorte: 'fusion', actions: [{ garder: code('p-noah'), fondre: code('p-noah-bis') }] },
    { sorte: 'inconnue' },
  ] as AdminProposerInput[]) {
    const src = sourceFictive()
    const r = gardeA('nextar_admin_proposer', await outilAdminProposer(src, regA, input))
    assert.deepEqual(r, { erreur: REFUS_ADMIN })
    assert.equal(src.appelsAdmin, 0, 'aucune lecture d’administration')
    assert.equal(src.appelsNoms, 0, 'aucun nom lu')
    assert.equal(src.ecritures, 0, 'aucune écriture')
    assert.equal(src.propositionsAdmin.length, 0)
  }
})

await t('nextar_admin_proposer (rôles) : prêtes ou refusées avec la raison ; dernier administrateur, son propre compte, administrateur, rôle déjà là', async () => {
  const { src, r, act } = await proposer({}, {
    sorte: 'role',
    actions: [
      { compte: C(1), role: 'observateur' }, // 1 Bruno, encadrant → observateur : prête
      { compte: C(5).toLowerCase(), role: 'Encadrant' }, // 2 compte sans rôle → encadrant (minuscules) : prête
      { compte: C(0), role: 'observateur' }, // 3 soi-même, seul administrateur : dernier administrateur
      { compte: C(2), role: 'administrateur' }, // 4 nommer un administrateur : refusé
      { compte: C(3), role: 'observateur' }, // 5 déjà observateur
      { compte: C(4), role: 'joueur' }, // 6 staff → joueur : refusé
      { compte: 'C-1234567', role: 'observateur' }, // 7 code inconnu
      { compte: 'Bruno', role: 'observateur' }, // 8 code mal formé
      { compte: C(1), role: 'encadrant' }, // 9 doublon dans la proposition
      { compte: C(2), role: 'chef' }, // 10 rôle inconnu
    ],
  })
  assert.equal(r.etat, 'en_attente')
  assert.deepEqual(r.resume, { pretes: 2, refusees: 8 })
  assert.equal(act(1).etat, 'prête')
  assert.equal(act(1).nom_affiche, 'Bruno Encadrant-Fictif')
  assert.equal(act(1).role, 'Observateur')
  assert.equal(act(1).role_actuel, 'Encadrant')
  assert.equal(act(2).etat, 'prête')
  assert.equal(act(2).role, 'Encadrant')
  assert.equal(act(2).role_actuel, 'En attente (aucun rôle)')
  assert.match(act(3).raison!, /dernier administrateur/)
  assert.match(act(4).raison!, /se nomme uniquement depuis Supabase/)
  assert.match(act(5).raison!, /a déjà le rôle Observateur/)
  assert.match(act(6).raison!, /Réglages › Membres/)
  assert.match(act(7).raison!, /introuvable/)
  assert.match(act(8).raison!, /mal formé/)
  assert.match(act(9).raison!, /déjà demandé/)
  assert.match(act(10).raison!, /rôle manquant ou inconnu/)
  // Déposé : les deux prêtes seulement, avec l'identifiant du compte (pour l'appli), jamais rendu.
  assert.equal(src.propositionsAdmin.length, 1)
  const d = src.propositionsAdmin[0]
  assert.deepEqual(d.contexte, { sorte: 'role', version: 1 })
  assert.equal(d.lignes.length, 2)
  assert.deepEqual(d.lignes[0], { a: 'role', userId: COMPTES[1].userId, compte: C(1), nom: 'Bruno Encadrant-Fictif', role: 'observateur', avant: 'preparateur' })
  assert.equal(r.id, d.id)
  assert.equal(r.titre, 'Rôles à donner (2)')
  assert.match(String(r.lien_boite), /\?propositions=1$/)
  assert.match(String(r.message), /RIEN n’est appliqué/)
  // Le nom affiché qui est une adresse mail ne sort pas.
  const { act: act2 } = await proposer({}, { sorte: 'role', actions: [{ compte: C(2), role: 'encadrant' }] })
  assert.equal(act2(1).nom_affiche, '(nom pas encore choisi)')
})

await t('nextar_admin_proposer (rôles) : un autre administrateur (pas le dernier) et son propre compte quand il y en a deux ; compte de session inconnu', async () => {
  const { act } = await proposer({ secondAdmin: true }, { sorte: 'role', actions: [{ compte: codeCompte(SECOND_ADMIN.userId), role: 'observateur' }, { compte: C(0), role: 'encadrant' }, { compte: C(5), role: 'joueur' }] })
  assert.match(act(1).raison!, /compte administrateur : son rôle se change uniquement depuis Supabase/)
  assert.match(act(2).raison!, /ton propre rôle/)
  assert.equal(act(3).etat, 'prête', 'compte en attente → compte joueur')
  const { r, src } = await proposer({ moi: null }, { sorte: 'role', actions: [{ compte: C(1), role: 'observateur' }] })
  assert.equal(r.etat, 'non déposée')
  assert.match(r.actions![0].raison!, /compte de la session inconnu/)
  assert.equal(src.ecritures, 0, 'aucune prête : rien n’est déposé')
})

await t('nextar_admin_proposer (périmètres) : unité par nom ou identifiant, nom ambigu, inconnue, secteur, rôle dans l’unité', async () => {
  const { src, r, act } = await proposer({}, {
    sorte: 'perimetre',
    actions: [
      { compte: C(1), unite: 'comite fictif du var' }, // 1 par nom (sans accents ni majuscules) : prête, rôle Encadrant
      { compte: C(2), unite: 'u-club', role_unite: 'encadrant' }, // 2 par identifiant, rôle donné
      { compte: C(3), unite: 'Ligue Doublon' }, // 3 deux unités de ce nom
      { compte: C(4), unite: 'Unité Inexistante' }, // 4 introuvable
      { compte: C(4), secteur: ['83', '2a', '83'] }, // 5 secteur : prête, 2A, sans doublon
      { compte: C(3), secteur: ['99'] }, // 6 département inconnu
      { compte: C(3), unite: 'u-var', secteur: ['83'] }, // 7 les deux
      { compte: C(5), unite: 'u-var' }, // 8 compte sans rôle
      { compte: C(0), secteur: ['83'] }, // 9 administrateur : pas de secteur
      { compte: C(3), unite: 'u-var', role_unite: 'administrateur' }, // 10 rôle administrateur pour un observateur
    ],
  })
  assert.deepEqual(r.resume, { pretes: 3, refusees: 7 })
  assert.equal(act(1).unite, 'Comité Fictif du Var')
  assert.equal(act(1).role_unite, 'Encadrant')
  assert.equal(act(2).role_unite, 'Encadrant')
  assert.match(act(3).raison!, /plusieurs unités/)
  assert.match(act(4).raison!, /unité introuvable/)
  assert.deepEqual(act(5).secteur, ['83', '2A'])
  assert.match(act(6).raison!, /département inconnu : 99/)
  assert.match(act(7).raison!, /pas les deux/)
  assert.match(act(8).raison!, /sans rôle du staff/)
  assert.match(act(9).raison!, /pas de secteur/)
  assert.match(act(10).raison!, /seulement pour un compte administrateur/)
  assert.deepEqual(src.propositionsAdmin[0].lignes.map((l) => l.a), ['unite', 'unite', 'secteur'])
  assert.equal(src.propositionsAdmin[0].lignes[0].uniteId, 'u-var')
  assert.equal(src.propositionsAdmin[0].lignes[1].roleUnite, 'preparateur')
})

await t('nextar_admin_proposer (archivage) : par identifiant, déjà archivé, groupe Pôle, fin de saison (événements avant une date), titre', async () => {
  const { src, r, act } = await proposer({}, {
    sorte: 'archiver',
    actions: [{ evenement: 'ev-var' }, { evenement: 'ev-old' }, { groupe: 'g-pole-u15' }, { groupe: 'g-stage' }, { groupe: 'g-nulle-part' }, { evenement: 'ev-var', groupe: 'g-stage' }],
  })
  assert.deepEqual(r.resume, { pretes: 2, refusees: 4 })
  assert.deepEqual([act(1).quoi, act(1).id, act(1).libelle, act(1).date], ['événement', 'ev-var', 'Détection U15 Var', '2026-10-12'])
  assert.match(act(2).raison!, /déjà archivé/)
  assert.match(act(3).raison!, /groupe Pôle/)
  assert.equal(act(4).etat, 'prête')
  assert.match(act(5).raison!, /introuvable/)
  assert.match(act(6).raison!, /OU un groupe/)
  assert.equal(src.propositionsAdmin[0].lignes.length, 2)
  // Fin de saison : les événements non archivés datés avant le 1er juillet 2026, les plus anciens d'abord.
  const fin = await proposer({}, { sorte: 'archiver', evenements_avant: '2026-07-01' })
  assert.deepEqual(fin.r.actions!.map((a) => a.id), ['ev-s1', 'ev-s2', 'ev-s3'])
  assert.equal(fin.r.titre, 'Fin de saison 2025-26 : 3 événements à archiver')
  assert.ok((fin.r.avertissements as string[]).some((a) => /1 événements sans date/.test(a)))
  const aucun = await proposer({}, { sorte: 'archiver', evenements_avant: '2020-01-01' })
  assert.equal(aucun.r.etat, 'non déposée')
  assert.ok((aucun.r.avertissements as string[]).some((a) => /Aucun événement/.test(a)))
})

await t('nextar_admin_proposer (fusions) : codes J-… résolus côté serveur, fiche fondue, code faux, même fiche, fiche déjà prise', async () => {
  const faux = code('p-tom').slice(0, 8) + (code('p-tom')[8] === '0' ? '1' : '0')
  const { src, r, act } = await proposer({}, {
    sorte: 'fusion',
    actions: [
      { garder: code('p-noah'), fondre: code('p-noah-bis').toLowerCase() }, // 1 prête
      { garder: code('p-lucas'), fondre: code('p-fondu') }, // 2 fiche déjà fondue
      { garder: code('p-tom'), fondre: faux }, // 3 code faux
      { garder: code('p-emma'), fondre: code('p-emma') }, // 4 même fiche
      { garder: code('p-noah'), fondre: code('p-zoe-bis') }, // 5 p-noah déjà dans une fusion
      { garder: code('p-hors'), fondre: code('p-zoe-bis') }, // 6 prête (hors cadre : fiche existante)
    ],
  })
  assert.deepEqual(r.resume, { pretes: 2, refusees: 4 })
  assert.deepEqual([act(1).garder, act(1).fondre], [code('p-noah'), code('p-noah-bis')])
  assert.match(act(2).raison!, /déjà fondue/)
  assert.match(act(3).raison!, /introuvable/)
  assert.match(act(4).raison!, /même fiche/)
  assert.match(act(5).raison!, /déjà dans une autre fusion/)
  assert.deepEqual(src.propositionsAdmin[0].lignes[0], { a: 'fusion', garder: 'p-noah', fondre: 'p-noah-bis' })
  assert.equal(src.appelsNoms, 0, 'aucun nom de joueur lu : seulement les identifiants')
})

await t('nextar_admin_proposer : bornes (50 actions, aucune action, sorte inconnue, champ hors sorte), titre borné, 070 absent', async () => {
  const src = sourceFictive({ admin: true })
  const trop = gardeA('nextar_admin_proposer', await outilAdminProposer(src, regA, { sorte: 'archiver', actions: Array.from({ length: 51 }, () => ({ evenement: 'ev-var' })) }))
  assert.match(String((trop as { erreur: string }).erreur), /50 actions au plus/)
  assert.equal(src.ecritures, 0)
  assert.match(String(((await outilAdminProposer(src, regA, { sorte: 'role' })) as { erreur: string }).erreur), /Aucune action/)
  assert.match(String(((await outilAdminProposer(src, regA, { sorte: 'supprimer', actions: [{}] })) as { erreur: string }).erreur), /Sorte inconnue/)
  assert.match(String(((await outilAdminProposer(src, regA, { sorte: 'role', evenements_avant: '2026-07-01', actions: [{}] })) as { erreur: string }).erreur), /archiver/)
  assert.match(String(((await outilAdminProposer(src, regA, { sorte: 'archiver', evenements_avant: '01/07/2026' })) as { erreur: string }).erreur), /AAAA-MM-JJ/)
  const cinquante = await proposer({}, { sorte: 'archiver', titre: 'x'.repeat(200), actions: Array.from({ length: 50 }, () => ({ evenement: 'ev-var' })) })
  assert.equal(cinquante.r.resume!.pretes, 1, 'le même événement n’est préparé qu’une fois')
  assert.equal(String(cinquante.r.titre).length, 80)
  // 070 pas appliqué : « indisponible », rien de déposé, les actions vérifiées quand même.
  const sans = await proposer({ sans070: true }, { sorte: 'role', actions: [{ compte: C(1), role: 'observateur' }] })
  assert.equal(sans.r.erreur, INDISPONIBLE_070)
  assert.match(INDISPONIBLE_070, /indisponible tant que supabase\/070_propositions_admin\.sql n’est pas appliqué/)
  assert.equal(sans.r.etat, 'non déposée')
  assert.equal(sans.r.actions![0].etat, 'prête')
  assert.equal(sans.src.propositionsAdmin.length, 0)
})

await t('nextar_admin_proposer → appli : chaque ligne déposée se lit (src/propositionsAdminCore.ts) et s’affiche avec les noms remis sur l’appareil', async () => {
  const toutes: Record<string, unknown>[] = []
  for (const input of [
    { sorte: 'role', actions: [{ compte: C(1), role: 'observateur' }, { compte: C(5), role: 'encadrant' }] },
    { sorte: 'perimetre', actions: [{ compte: C(1), unite: 'u-var' }, { compte: C(4), secteur: ['13'] }, { compte: C(4), secteur: [] }] },
    { sorte: 'archiver', evenements_avant: '2026-07-01', actions: [{ groupe: 'g-stage' }] },
    { sorte: 'fusion', actions: [{ garder: code('p-noah'), fondre: code('p-noah-bis') }] },
  ] as AdminProposerInput[]) {
    const { src } = await proposer({}, input)
    toutes.push(...src.propositionsAdmin[0].lignes)
    const acts = actionsDe(src.propositionsAdmin[0].lignes)
    assert.ok(acts.every((a) => a.action), `${input.sorte} : toutes lisibles`)
    assert.ok(resumeAdmin(input.sorte as never, acts).length > 0)
  }
  assert.ok(toutes.every((l) => lireAction(l)), 'toutes lisibles par l’appli')
  const noms = { compte: (_id: string, n: string) => n, fiche: (id: string) => ({ 'p-noah': 'Noah Fictivus', 'p-noah-bis': 'Noah Fictivus' })[id], code }
  const lib = toutes.map((l) => libelleAction(lireAction(l)!, noms).titre)
  assert.ok(lib.includes('Donner le rôle Observateur à Bruno Encadrant-Fictif'))
  assert.ok(lib.includes('Affecter Bruno Encadrant-Fictif à « Comité Fictif du Var »'))
  assert.ok(lib.includes('Archiver le groupe « Stage Toussaint Fictif »'))
  assert.ok(lib.includes('Fondre « Noah Fictivus » dans « Noah Fictivus »'))
  assert.equal(resumeAdmin('archiver', actionsDe(toutes.filter((l) => l.a === 'archiver' && l.quoi === 'evenement'))), 'Archiver 3 événements de la saison 2025-26')
  assert.equal(lireAction({ a: 'role', userId: 'u', compte: 'C-1234567', nom: 'x', role: 'admin' }), null, 'jamais « administrateur »')
  assert.equal(lireAction({ a: 'supprimer', id: 'x' }), null)
  assert.equal(lireAction({ a: 'fusion', garder: 'a', fondre: 'a' }), null)
})

await t('source.ts (nextar_admin_proposer) : compte du jeton, unités (id, nom), identifiants des fiches seulement, une seule écriture (sorte « admin »)', async () => {
  const appels: { table: string; select?: string; insert?: Record<string, unknown>; ops: string[] }[] = []
  let erreurInsert: { code: string; message: string } | null = null
  const faux = {
    rpc: async () => ({ data: null, error: null }),
    from(table: string) {
      const a: (typeof appels)[number] = { table, ops: [] }
      appels.push(a)
      const q: Record<string, unknown> = {}
      const chain = (op: string) => (...args: unknown[]) => {
        a.ops.push(op)
        if (op === 'select') a.select = String(args[0])
        if (op === 'insert') a.insert = args[0] as Record<string, unknown>
        return q
      }
      for (const op of ['select', 'eq', 'in', 'or', 'order', 'range', 'limit', 'insert', 'is']) q[op] = chain(op)
      q.single = async () => (erreurInsert ? { data: null, error: erreurInsert } : { data: { id: 'p1' }, error: null })
      q.then = (ok: (v: unknown) => void) => ok({ data: table === 'hb_players' ? [{ id: 'a', m: null }, { id: 'b', m: 'a' }] : [{ id: 'u1', n: 'Unité' }], error: null })
      return q
    },
  }
  const src = sourceSupabase(faux, 'compte-du-jeton')
  assert.equal(await src.moi(), 'compte-du-jeton')
  assert.equal(await sourceSupabase(faux).moi(), null)
  assert.deepEqual(await src.unites(), [{ id: 'u1', name: 'Unité' }])
  assert.deepEqual(await src.idsFiches(10), { fiches: [{ id: 'a', fondue: false }, { id: 'b', fondue: true }], tronque: false })
  assert.equal(appels.find((a) => a.table === 'hb_players')!.select, 'id, m:data->>mergedInto', 'ni nom, ni date, ni club')
  assert.equal(appels.find((a) => a.table === 'hb_units')!.select, 'id, n:data->>name')
  assert.deepEqual(await src.deposerPropositionAdmin({ titre: 't', contexte: { sorte: 'role' }, lignes: [{ a: 'role' }] }), { id: 'p1' })
  const ins = appels.filter((a) => a.ops.includes('insert'))
  assert.deepEqual(ins.map((a) => [a.table, a.insert!.kind, a.insert!.source]), [['hb_propositions', 'admin', 'mcp']])
  erreurInsert = { code: '23514', message: 'new row for relation "hb_propositions" violates check constraint "hb_propositions_kind_check"' }
  assert.deepEqual(await src.deposerPropositionAdmin({ titre: 't', contexte: {}, lignes: [{}] }), { indisponible: true })
  erreurInsert = { code: '42P01', message: 'relation "public.hb_propositions" does not exist' }
  assert.deepEqual(await src.deposerPropositionAdmin({ titre: 't', contexte: {}, lignes: [{}] }), { indisponible: true })
  erreurInsert = { code: '42501', message: 'Propositions d’administration : réservées aux administrateurs' }
  assert.match(String(((await src.deposerPropositionAdmin({ titre: 't', contexte: {}, lignes: [{}] })) as { erreur: string }).erreur), /réservé aux administrateurs/)
  erreurInsert = { code: '23514', message: 'new row violates check constraint "hb_propositions_admin_forme"' }
  assert.ok('erreur' in (await src.deposerPropositionAdmin({ titre: 't', contexte: {}, lignes: [{}] })), 'forme refusée : une erreur, pas « indisponible »')
  assert.ok(!appels.some((a) => a.ops.some((o) => o === 'update' || o === 'delete' || o === 'upsert')))
})

await t('supabase/070_propositions_admin.sql : additif, sorte « admin » réservée aux administrateurs (création et modification), forme, 50 actions, contrôle final', () => {
  const sql = read('supabase/070_propositions_admin.sql')
  const code = sql.replace(/^\s*--.*$/gm, '')
  assert.match(code, /check \(kind in \('mesures', 'avis', 'vus', 'a_revoir', 'admin'\)\)/)
  assert.match(code, /jsonb_array_length\(lignes\) between 1 and 50/)
  assert.equal(BORNES.adminActions, 50)
  assert.match(code, /coalesce\(contexte ->> 'sorte', ''\) in \('role', 'perimetre', 'archiver', 'fusion'\)/)
  assert.match(code, /new\.kind = 'admin' and not \(/)
  assert.match(code, /old\.kind = 'admin' and v_uid is not null and not coalesce\(public\.hb_is_admin\(\), false\)/)
  assert.equal((code.match(/errcode = '42501'/g) ?? []).length, 2)
  assert.match(code, /new\.kind := old\.kind;/, 'la sorte ne change jamais')
  assert.ok(!/create table|drop table|hb_upsert|create policy|drop policy|grant /i.test(code), 'additif : ni table, ni règles, ni droits, ni hb_upsert')
  assert.match(sql, /-- ---------- Vérification ----------/)
  assert.match(sql, /RETOUR ARRIÈRE/)
  // Les règles de 067 sont reprises telles quelles (garde de 067 = garde de 070 sans les lignes « 070 »).
  const g067 = read('supabase/067_propositions.sql').match(/create or replace function public\.hb_propositions_garde\(\)[\s\S]*?end \$\$;/)![0]
  const g070 = sql.match(/create or replace function public\.hb_propositions_garde\(\)[\s\S]*?end \$\$;/)![0]
  const sans070 = g070.replace(/^ *-- 070[^\n]*\n[\s\S]*?^ *end if;\n/gm, '')
  assert.equal(sans070.replace(/\s+/g, ' '), g067.replace(/\s+/g, ' '), 'garde de 067 reprise à l’identique')
})

await t('outils d’administration : listes blanches propres (clés interdites, inconnues, textes avec « @ » ou IP refusés)', () => {
  for (const outil of Object.keys(OUTILS_ADMIN)) {
    const V = (o: Record<string, unknown>) => () => verifierSortie(o, outil)
    for (const k of ['email', 'e-mail', 'phone', 'telephone', 'ip', 'user_id', 'userAgent', 'token', 'nom', 'prenom', 'firstName', 'lastName', 'birthDate', 'club', 'licence', 'commentaire', 'device', 'endpoint'])
      assert.throws(V({ [k]: 'x' }), /interdite|inconnue/, `${outil} : ${k}`)
    assert.throws(V({ message: 'écrire à x@exemple.test' }), /adresse mail ou IP/)
    assert.throws(V({ message: 'serveur 10.0.0.1' }), /adresse mail ou IP/)
    assert.throws(V({ connexions_inconnues: 1 }), /inconnue/)
    assert.doesNotThrow(V({ message: 'ok', avertissements: ['ok'], maintenant: '2026-11-05T10:00:00.000Z' }))
  }
  assert.throws(() => verifierSortie({ volumes: [{ code: 'J-1' }] }, 'nextar_admin_sante'), /inconnue/, 'pas de code de joueur dans l’état de l’installation')
  assert.throws(() => verifierSortie({ resume: { comptes_sans_role: 1 } }), /inconnue/, 'clés d’administration : pas dans les outils de joueurs')
  assert.doesNotThrow(() => verifierSortie({ fiches_a_valider: [{ code: 'J-1', par: { compte: 'C-1', nom_affiche: 'X' } }] }, 'nextar_admin_a_faire'))
})

await t('outils d’administration : aucune des réponses ne contient un nom de joueur, une adresse mail, un téléphone, une IP ou un jeton', () => {
  assert.ok(sortiesAdmin.length >= 20, `${sortiesAdmin.length} réponses`)
  const tout = JSON.stringify(sortiesAdmin)
  for (const txt of interditsAdmin) assert.ok(!tout.includes(txt), txt)
  console.log(`   (${sortiesAdmin.length} réponses, ${interditsAdmin.length} textes interdits cherchés)`)
})

await t('source.ts (administration) : colonnes nommées, ni email, ni téléphone, ni requête SQL du journal ; comptages sans lignes ; aucune écriture', async () => {
  const appels: { table: string; select?: string; opts?: unknown; ops: string[]; args: unknown[][] }[] = []
  const rpcs: string[] = []
  const faux = (rpc: (fn: string) => Promise<{ data: unknown; error: unknown }>) => ({
    rpc(fn: string) {
      rpcs.push(fn)
      return rpc(fn)
    },
    from(table: string) {
      const a: (typeof appels)[number] = { table, ops: [], args: [] }
      appels.push(a)
      const q: Record<string, unknown> = {}
      const chain = (op: string) => (...args: unknown[]) => {
        a.ops.push(op)
        a.args.push([op, ...args])
        if (op === 'select') {
          a.select = String(args[0])
          a.opts = args[1]
        }
        return q
      }
      for (const op of ['select', 'eq', 'in', 'is', 'not', 'gte', 'order', 'range', 'limit', 'insert', 'update', 'delete', 'upsert']) q[op] = chain(op)
      q.then = (fini: (v: unknown) => void) => fini({ data: [], error: null, count: 3 })
      return q
    },
  })
  const src = sourceSupabase(faux(async (fn) => (fn === 'hb_last_seen' ? { data: [{ user_id: 'u1', last_seen_at: '2026-11-05T09:00:00Z' }], error: null } : { data: null, error: { code: 'PGRST202', message: 'Could not find the function public.hb_admin_sante' } })))
  await src.profils()
  await src.fichesAValider(5)
  await src.avisAValider(5)
  await src.nomsJoueurs(10)
  await src.propositionsEnAttente(5)
  await src.journal('2026-10-01T00:00:00Z', 100)
  assert.equal(await src.compter('joueurs'), 3)
  assert.equal(await src.compter('connexions'), 3)
  assert.deepEqual(await src.sante(), { absente: true })
  assert.deepEqual(await src.dernieresVues(), [{ userId: 'u1', lastSeenAt: '2026-11-05T09:00:00Z' }])
  await src.derniereEcriture('u1')
  assert.deepEqual(await src.activite('u1', '2026-10-06T10:00:00Z'), { avis: 3, mesures: 3, evenements: 3, vus: 3, fiches: 3 })
  assert.deepEqual(rpcs, ['hb_admin_sante', 'hb_last_seen'])
  const de = (t: string) => appels.filter((a) => a.table === t)
  assert.equal(de('hb_profiles')[0].select, 'user_id, full_name, role, created_at')
  for (const a of appels) {
    assert.ok(a.select && !/email|phone|mail|postalCode|city|lat|lng|agent|endpoint|p256dh/i.test(a.select), `${a.table} : ${a.select}`)
    assert.ok(!/(^|[\s,])data(\s*,|$)/.test(a.select), `« data » entier demandé : ${a.select}`)
    assert.ok(!a.ops.some((o) => ['insert', 'update', 'delete', 'upsert'].includes(o)), `${a.table} : écriture`)
  }
  assert.ok(!/firstName|lastName/.test(de('hb_players')[0].select!), 'fiches à valider : aucun nom')
  assert.match(de('hb_players')[1].select!, /firstName/, 'doublons et masquage : les noms, côté serveur')
  assert.ok(!/strengths|improvements|scores|comment|observer/.test(de('hb_evaluations')[0].select!), 'avis à valider : ni notes ni commentaires')
  const j = de('hb_question_log')[0].select!
  assert.ok(!/sql|detail|authorName/.test(j), `journal : ${j}`)
  assert.equal(de('hb_audit')[0].select, 'at', 'historique : la date seulement')
  const comptages = appels.filter((a) => (a.opts as { head?: boolean } | undefined)?.head === true)
  assert.ok(comptages.length >= 7, 'comptages : head (aucune ligne transférée)')
  const act = appels.filter((a) => a.table === 'hb_measurements')[0]
  assert.deepEqual(act.args.filter((x) => x[0] === 'eq' || x[0] === 'gte').map((x) => x.slice(1)), [['deleted', false], ['created_by', 'u1'], ['server_updated_at', '2026-10-06T10:00:00Z'], ['data->>createdAtServer', '2026-10-06T10:00:00Z']])
  assert.ok(appels.find((a) => a.table === 'hb_events' && a.args.some((x) => x[0] === 'eq' && x[1] === 'data->>createdBy')), 'événements : data->>createdBy (pas de colonne générée)')
  // hb_admin_sante en erreur (autre que « absente ») : erreur ; réponse : ok.
  const e = sourceSupabase(faux(async () => ({ data: null, error: { code: '42501', message: 'Réservé aux administrateurs' } })))
  assert.deepEqual(await e.sante(), { erreur: 'Réservé aux administrateurs' })
  const o = sourceSupabase(faux(async () => ({ data: { version: 1 }, error: null })))
  assert.deepEqual(await o.sante(), { ok: { version: 1 } })
})

await t('supabase/069_admin_sante.sql : SECURITY DEFINER réservé aux administrateurs, search_path fixé, droits, additif, contrôle final', () => {
  const s = read('supabase/069_admin_sante.sql')
  const code = s.replace(/--.*$/gm, '')
  assert.match(code, /create or replace function public\.hb_admin_sante\(\) returns jsonb\s+language plpgsql stable security definer set search_path = public, pg_temp as \$\$/)
  assert.match(code, /begin\s+if not coalesce\(public\.hb_is_admin\(\), false\) then\s+raise exception 'Réservé aux administrateurs' using errcode = '42501';/, 'le rôle d’abord')
  assert.match(code, /revoke all on function public\.hb_admin_sante\(\) from public, anon;/)
  assert.match(code, /grant execute on function public\.hb_admin_sante\(\) to authenticated;/)
  assert.ok(!/hb_upsert|create table|alter table|create policy|drop policy|create trigger|insert into|update public|delete from/i.test(code), 'additif : une fonction, rien d’autre')
  assert.ok(!/endpoint|p256dh|user_agent|return_message|\bcommand\b|email|user_id/i.test(code.replace(/count\(distinct user_id\)/g, '')), 'jamais jeton, adresse d’envoi, commande, message, mail ni compte')
  assert.match(s, /-- ---------- Vérification ----------/)
  assert.match(s, /authenticated_t/)
  assert.ok(existsSync(new URL('../tools/essai-sql-069/lancer.sh', import.meta.url)))
  assert.ok(!existsSync(new URL('../supabase/070_admin_sante.sql', import.meta.url)))
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
  for (const outil of ['nextar_contexte', 'nextar_proposer', 'nextar_suivi', 'nextar_lire', 'nextar_rapport', 'nextar_connexions', 'nextar_admin_a_faire', 'nextar_admin_sante', 'nextar_admin_activite', 'nextar_admin_questions', 'nextar_admin_proposer'])
    assert.match(srv, new RegExp(`'${outil}'`))
  // nextar_admin_proposer : « n’applique rien », dépôt (pas lecture seule), 50 actions au plus.
  const blocP = srv.slice(srv.indexOf(`'nextar_admin_proposer',`), srv.indexOf(`repondre('nextar_admin_proposer'`))
  assert.match(blocP, /Réservé aux administrateurs ; N’APPLIQUE RIEN/)
  assert.match(blocP, /annotations: depot,/)
  assert.match(blocP, /\.max\(BORNES\.adminActions\)/)
  assert.match(read('supabase/functions/mcp/README.md'), /nextar_admin_proposer[\s\S]*070_propositions_admin\.sql/)
  assert.match(read('src/pages/OAuthConsent.tsx'), /préparer des actions d’administration/)
  assert.match(read('supabase/functions/mcp/index.ts'), /sourceSupabase\(ctx\.supabase as ClientSupabase, ctx\.userClaims\?\.id/)
  // Outils d'administration : lecture seule, « Réservé aux administrateurs ; lecture seule » en tête de description.
  for (const outil of ['nextar_admin_a_faire', 'nextar_admin_sante', 'nextar_admin_activite', 'nextar_admin_questions']) {
    const bloc = srv.slice(srv.indexOf(`'${outil}',`), srv.indexOf(`repondre('${outil}'`))
    assert.match(bloc, /Réservé aux administrateurs ; lecture seule\./, outil)
    assert.match(bloc, /annotations: lecture,/, outil)
  }
  assert.match(srv, /jours: jours\('Période en jours'\)/)
  assert.match(srv, /z\.number\(\)\.int\(\)\.min\(1\)\.max\(BORNES\.joursMax\)/)
  const readme = read('supabase/functions/mcp/README.md')
  for (const outil of ['nextar_admin_a_faire', 'nextar_admin_sante', 'nextar_admin_activite', 'nextar_admin_questions', '069_admin_sante.sql']) assert.ok(readme.includes(outil), `README : ${outil}`)
  assert.match(srv, /Réservé aux administrateurs ; noms et rôles des comptes, jamais d’adresse mail/)
  assert.match(srv, /minutes: z\.number\(\)\.int\(\)\.min\(1\)\.max\(BORNES\.connexionsMinutesMax\)/)
  assert.match(srv, /limite: z\.number\(\)\.int\(\)\.min\(1\)\.max\(BORNES\.connexionsMax\)/)
  assert.match(srv, /withOAuthProtectedResource\(/)
  assert.match(srv, /withSupabase\(\{ auth: 'user' \}\)/)
  assert.match(srv, /verifierSortie\(out, nom\)/)
  assert.match(srv, /createMcpHandler\(/)
  const idx = read('supabase/functions/mcp/index.ts')
  assert.match(idx, /sourceSupabase\(ctx\.supabase/)
  for (const f of ['index.ts', 'serveur.ts', 'outils.ts', 'admin.ts', 'adminProposer.ts', 'source.ts']) {
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
