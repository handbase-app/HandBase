// Essai de bout en bout (tools/essai-mcp/lancer.sh) : appels HTTP au serveur MCP lancé dans le runtime des fonctions
// Supabase, comme le ferait Claude : découverte OAuth, refus sans jeton, CORS, puis initialize, tools/list et chaque outil
// (dix-huit, dont nextar_joueur, nextar_lire par trimestre, le canal « mcp » de nextar_connexions et le type « mcp » du journal, les outils de traçabilité nextar_admin_journal, _saisies, _lots, nextar_admin_proposer qui dépose une proposition d'administration dans le jeu fictif, et les propositions
// d'avis, de vus et de « à revoir »)
// avec un jeton fictif. Vérifie qu'aucune réponse ne contient un nom, une date de naissance, un club, une licence ou un
// commentaire du jeu fictif.
//   MCP_URL=http://127.0.0.1:9707/functions/v1/mcp JETONS=<fichier> npx jiti tools/essai-mcp/appels.ts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { JOUEURS, JOUEURS_ADMIN, textesInterdits, textesInterditsAdmin, textesInterditsComptes } from '../mcp-jeu-fictif'

const URL_MCP = process.env.MCP_URL ?? 'http://127.0.0.1:9707/functions/v1/mcp'
const jetons = JSON.parse(readFileSync(process.env.JETONS!, 'utf8')) as Record<string, string>
const interdits = textesInterdits()
const interditsAdmin = [...textesInterdits([...JOUEURS, ...JOUEURS_ADMIN]), ...textesInterditsAdmin()]

let n = 0
const ok = (nom: string) => console.log(`ok ${++n} - ${nom}`)

/** Corps d'une réponse MCP : JSON, ou flux SSE (« data: {…} »). */
async function lire(res: Response): Promise<any> {
  const t = await res.text()
  if ((res.headers.get('content-type') ?? '').includes('text/event-stream')) {
    const data = t
      .split('\n')
      .filter((l) => l.startsWith('data:'))
      .map((l) => l.slice(5).trim())
      .filter(Boolean)
    return data.length ? JSON.parse(data[data.length - 1]) : null
  }
  return t ? JSON.parse(t) : null
}

let id = 0
async function rpc(method: string, params: unknown, jeton = jetons.coach, version = '2025-06-18') {
  const res = await fetch(URL_MCP, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'mcp-protocol-version': version,
      ...(jeton ? { authorization: `Bearer ${jeton}` } : {}),
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }),
  })
  return { res, body: res.status === 200 ? await lire(res) : await res.text() }
}

const sansNoms = (quoi: string, x: unknown) => {
  const s = JSON.stringify(x)
  for (const t of interdits) assert.ok(!s.includes(t), `${quoi} : « ${t} » ne doit pas apparaître`)
}

// 1. Découverte OAuth (RFC 9728), sans jeton.
{
  const res = await fetch(`${URL_MCP}/oauth-protected-resource`)
  assert.equal(res.status, 200)
  const meta = (await res.json()) as { resource: string; authorization_servers: string[] }
  assert.ok(meta.resource.endsWith('/functions/v1/mcp'), meta.resource)
  assert.ok(meta.authorization_servers.some((s) => s.endsWith('/auth/v1')), JSON.stringify(meta))
  ok(`découverte : ressource ${meta.resource}, serveur d'autorisation ${meta.authorization_servers[0]}`)
}
// 2. Sans jeton, jeton expiré, mauvais signataire : 401 avec WWW-Authenticate (resource_metadata).
for (const [nom, j] of [
  ['sans jeton', ''],
  ['jeton expiré', jetons.expire],
  ['jeton d’un autre signataire', jetons.fauxSignataire],
] as const) {
  const { res } = await rpc('tools/list', {}, j)
  assert.equal(res.status, 401, nom)
  const www = res.headers.get('www-authenticate') ?? ''
  assert.match(www, /Bearer/i, nom)
  assert.match(www, /resource_metadata="[^"]*oauth-protected-resource"/, nom)
  ok(`${nom} : 401 et WWW-Authenticate vers la description de la ressource`)
}
// 3. CORS : origine de l'appli acceptée, autre origine non.
{
  const pre = (origin: string) =>
    fetch(URL_MCP, { method: 'OPTIONS', headers: { origin, 'access-control-request-method': 'POST', 'access-control-request-headers': 'authorization, content-type, mcp-protocol-version' } })
  const a = await pre('https://handbase-demo.github.io')
  assert.equal(a.headers.get('access-control-allow-origin'), 'https://handbase-demo.github.io')
  const b = await pre('https://site-inconnu.example')
  assert.notEqual(b.headers.get('access-control-allow-origin'), 'https://site-inconnu.example')
  assert.notEqual(b.headers.get('access-control-allow-origin'), '*')
  ok('CORS : origine de l’appli acceptée, origine inconnue refusée')
}
// 4. Avec le jeton du coach : initialize, liste des outils.
{
  const { res, body } = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'essai', version: '1' } })
  assert.equal(res.status, 200)
  assert.equal(body.result.serverInfo.name, 'nextar')
  assert.match(body.result.instructions, /code/)
  ok(`initialize : ${body.result.serverInfo.name} ${body.result.serverInfo.version}, protocole ${body.result.protocolVersion}`)
}
{
  const { body } = await rpc('tools/list', {})
  const noms = body.result.tools.map((t: { name: string }) => t.name).sort()
  assert.deepEqual(noms, [
    'nextar_admin_a_faire',
    'nextar_admin_activite',
    'nextar_admin_journal',
    'nextar_admin_lots',
    'nextar_admin_proposer',
    'nextar_admin_questions',
    'nextar_admin_saisies',
    'nextar_admin_sante',
    'nextar_connexions',
    'nextar_contexte',
    'nextar_joueur',
    'nextar_lire',
    'nextar_proposer',
    'nextar_proposer_a_revoir',
    'nextar_proposer_avis',
    'nextar_proposer_vus',
    'nextar_rapport',
    'nextar_suivi',
  ])
  for (const n of ['nextar_admin_a_faire', 'nextar_admin_activite', 'nextar_admin_questions', 'nextar_admin_sante', 'nextar_admin_journal', 'nextar_admin_saisies', 'nextar_admin_lots']) {
    const o = body.result.tools.find((t: { name: string }) => t.name === n)
    assert.match(o.description, /^Réservé aux administrateurs ; lecture seule\./, n)
    assert.equal(o.annotations.readOnlyHint, true, n)
  }
  const act = body.result.tools.find((t: { name: string }) => t.name === 'nextar_admin_activite')
  assert.equal(act.inputSchema.properties.jours.maximum, 365)
  assert.deepEqual(act.inputSchema.properties.par.enum, ['total', 'jour', 'heure'])
  for (const k of ['depuis', 'jusqu_a', 'inclure_generation', 'inactifs_jours', 'limite']) assert.ok(act.inputSchema.properties[k], `nextar_admin_activite publie ${k}`)
  const jo = body.result.tools.find((t: { name: string }) => t.name === 'nextar_admin_journal')
  assert.equal(jo.inputSchema.properties.limite.maximum, 500)
  assert.deepEqual(jo.inputSchema.properties.types.items.enum, ['mesure', 'avis', 'evenement', 'vu', 'fiche', 'connexion', 'mcp'])
  const cx = body.result.tools.find((t: { name: string }) => t.name === 'nextar_connexions')
  assert.match(cx.description, /Réservé aux administrateurs ; noms et rôles des comptes, jamais d’adresse mail/)
  assert.equal(cx.inputSchema.properties.minutes.maximum, 10080)
  assert.equal(cx.inputSchema.properties.limite.maximum, 200)
  const lire = body.result.tools.find((t: { name: string }) => t.name === 'nextar_lire')
  assert.equal(lire.annotations.readOnlyHint, true)
  assert.ok(lire.inputSchema.properties.limite)
  assert.equal(lire.inputSchema.properties.trimestres.items.maximum, 4)
  assert.ok(lire.inputSchema.properties.nes_entre.properties.de && lire.inputSchema.properties.nes_entre.properties.a)
  const jr = body.result.tools.find((t: { name: string }) => t.name === 'nextar_joueur')
  assert.equal(jr.annotations.readOnlyHint, true)
  assert.deepEqual(jr.inputSchema.required, ['code'])
  for (const k of ['tests', 'depuis', 'jusqu_a']) assert.ok(jr.inputSchema.properties[k], `nextar_joueur publie ${k}`)
  const prop = body.result.tools.find((t: { name: string }) => t.name === 'nextar_admin_proposer')
  assert.match(prop.description, /^Réservé aux administrateurs ; N’APPLIQUE RIEN/)
  assert.equal(prop.annotations.readOnlyHint, false)
  assert.equal(prop.annotations.destructiveHint, false)
  assert.equal(prop.inputSchema.properties.actions.maxItems, 50)
  for (const n of ['nextar_proposer_avis', 'nextar_proposer_vus', 'nextar_proposer_a_revoir']) {
    const o = body.result.tools.find((t: { name: string }) => t.name === n)
    assert.equal(o.annotations.readOnlyHint, false, n)
    assert.equal(o.annotations.destructiveHint, false, n)
    assert.ok(o.inputSchema.properties.lignes, n)
  }
  const pav = body.result.tools.find((t: { name: string }) => t.name === 'nextar_proposer_avis')
  assert.deepEqual(pav.inputSchema.properties.contexte.enum, ['unss', 'club', 'match', 'selection', 'video', 'autre'])
  assert.deepEqual(body.result.tools.find((t: { name: string }) => t.name === 'nextar_proposer_vus').inputSchema.required.sort(), ['evenement', 'lignes'])
  ok('tools/list : les dix-huit outils, schémas et annotations (paramètres publiés : nextar_admin_activite par / depuis / jusqu_a / inclure_generation, nextar_lire trimestres / nes_entre, nextar_joueur ; outils d’administration en lecture seule ; propositions : dépôt)')
}
// 5. Chaque outil.
const appel = async (name: string, args: unknown, jeton = jetons.coach) => {
  const { res, body } = await rpc('tools/call', { name, arguments: args }, jeton)
  assert.equal(res.status, 200, name)
  assert.ok(!body.error, `${name} : ${JSON.stringify(body.error)}`)
  sansNoms(name, body)
  return { out: JSON.parse(body.result.content[0].text), isError: !!body.result.isError }
}
{
  const { out } = await appel('nextar_contexte', {})
  assert.ok(out.tests.some((t: { id: string }) => t.id === 'sprint_10'))
  assert.ok(out.evenements.some((e: { libelle: string }) => e.libelle === 'Détection U15 Var'))
  ok('nextar_contexte')
}
let propId = ''
{
  const { out } = await appel('nextar_proposer', {
    evenement: 'Détection U15 Var',
    date: '2026-11-04',
    lignes: [
      { numero: 7, nom: 'Exemplaire', prenom: 'Lucas', valeurs: { sprint_10: '1,84', cmj: 38 } },
      { nom: 'Imaginaire', prenom: 'Emma', valeurs: { sprint_10: 2.01 } },
      { prenom: 'Hugo', nom: 'M.', valeurs: { sprint_10: 1.95 } },
      { nom: 'Inconnu', prenom: 'Personne', valeurs: { sprint_10: 2.2 } },
    ],
  })
  assert.deepEqual(
    out.lignes.map((l: { etat: string }) => l.etat),
    ['trouvé', 'trouvé', 'plusieurs possibles', 'introuvable'],
  )
  propId = out.id
  ok(`nextar_proposer : ${out.resume.trouves} trouvés, ${out.resume.plusieurs} à plusieurs possibles, ${out.resume.introuvables} introuvable (codes seulement)`)
}
// Avis, vus, à revoir : dépôt, rapprochement, refus ; jamais un nom ni le texte du coach.
{
  const texte = 'Lucas Exemplaire a une lecture du jeu remarquable'
  const { out, isError } = await appel('nextar_proposer_avis', {
    evenement: 'Détection U15 Var',
    lignes: [
      { joueur: 'EXEMPLAIRE Lucas', numero: 7, notes: { tir: 4, defense: '3' }, points_forts: texte },
      { joueur: 'Emma Imaginaire', notes: { tir: 4, defense: 6 } },
      { joueur: 'Hugo M.', notes: { mental: 3 } },
    ],
  })
  assert.ok(!isError, JSON.stringify(out))
  assert.deepEqual(out.lignes.map((l: { etat: string }) => l.etat), ['trouvé', 'refusée', 'plusieurs possibles'])
  assert.ok(!JSON.stringify(out).includes(texte), 'texte du coach jamais renvoyé')
  const trop = await appel('nextar_proposer_avis', { lignes: Array.from({ length: 101 }, () => ({ joueur: 'Lucas', notes: { mental: 3 } })) })
  assert.ok(trop.isError && /100 joueurs au plus/.test(trop.out.erreur))
  const { out: vus } = await appel('nextar_proposer_vus', { evenement: 'ev-var', lignes: [{ numero: '7' }, { numero: '11' }] })
  assert.deepEqual(vus.resume, { trouves: 2, a_verifier: 0, plusieurs: 0, introuvables: 0, refusees: 0 })
  const sansEv = await rpc('tools/call', { name: 'nextar_proposer_vus', arguments: { lignes: [{ numero: '7' }] } })
  assert.equal(sansEv.res.status, 200)
  const { out: ar } = await appel('nextar_proposer_a_revoir', { lignes: [{ joueur: 'Noah Fictivus', raison: 'Revoir Noah Fictivus au pivot' }] })
  assert.equal(ar.lignes[0].etat, 'trouvé')
  assert.ok(!JSON.stringify(ar).includes('Revoir Noah'), 'raison jamais renvoyée')
  const { out: suivi } = await appel('nextar_suivi', { id: ar.id })
  assert.equal(suivi.sorte, 'à revoir')
  ok('nextar_proposer_avis / _vus / _a_revoir : dépôt, rapprochement, refus (note hors échelle, trop de lignes, événement manquant), aucun nom ni texte rendu')
}
{
  const { out } = await appel('nextar_suivi', { id: propId })
  assert.equal(out.etat, 'en attente')
  ok('nextar_suivi')
}
let codes: string[] = []
{
  const { out } = await appel('nextar_lire', { annees: [2011], avec_mesures: 'toutes', tri: { par: 'test', test: 'sprint_10', ordre: 'asc' } })
  assert.ok(out.joueurs.length >= 3)
  codes = out.joueurs.map((j: { code: string }) => j.code)
  ok(`nextar_lire : ${out.joueurs.length} lignes en codes`)
}
{
  // Trimestre de naissance (coach, sans 072) ; puis l'administrateur (072 dans le jeu : calcul dans la « base »).
  const { out } = await appel('nextar_lire', { nes_entre: { de: '2011-T4', a: '2012-T1' } })
  assert.equal(out.joueurs.length, 2)
  assert.ok(out.joueurs.every((j: { trimestre: number }) => j.trimestre === 4 || j.trimestre === 1))
  const { out: base } = await appel('nextar_lire', { annees: [2011], trimestres: [1], tri: { par: 'test', test: 'taille', ordre: 'desc' }, limite: 10 }, jetons.admin)
  assert.match(base.calcul, /dans la base/)
  assert.ok(base.joueurs.every((j: { trimestre: number }) => j.trimestre === 1))
  ok(`nextar_lire : trimestre de naissance et « nés entre » (${out.joueurs.length} lignes) ; avec 072 : ${base.calcul}`)
}
{
  const { out, isError } = await appel('nextar_joueur', { code: codes[0], tests: ['taille', 'sprint_10'] })
  assert.ok(!isError, JSON.stringify(out))
  assert.equal(out.profil.code, codes[0])
  assert.ok(out.profil.trimestre >= 1 && out.profil.trimestre <= 4)
  assert.ok(out.mesures.length >= 1 && out.mesures.every((m: { serie: unknown[] }) => m.serie.length >= 1))
  const inconnu = await appel('nextar_joueur', { code: 'J-0000000' })
  assert.ok(inconnu.isError && /introuvable|signe de contrôle/.test(inconnu.out.erreur))
  ok(`nextar_joueur : profil, ${out.mesures.length} série(s) datée(s), ${out.vus.length} vu(s), ${out.avis.length} groupe(s) d’avis ; code faux refusé`)
}
{
  const { out } = await appel('nextar_rapport', { titre: 'Essai', markdown: `# Essai\n\n${codes.map((c) => `- ${c}`).join('\n')}` })
  assert.match(out.lien, /\/rapport\//)
  assert.equal(out.codes, codes.length)
  ok('nextar_rapport : lien vers /rapport/<id>')
}
{
  const { out, isError } = await appel('nextar_lire', { evenement: 'Événement qui n’existe pas' })
  assert.ok(isError && out.erreur)
  ok('erreur rendue proprement (isError)')
}
// nextar_connexions : refus pour le coach ; liste pour l'administrateur (noms et rôles des comptes, jamais d'adresse mail).
{
  const { out, isError } = await appel('nextar_connexions', { minutes: 10080 })
  assert.ok(isError)
  assert.deepEqual(Object.keys(out), ['erreur'])
  assert.match(out.erreur, /^Réservé aux administrateurs/)
  ok('nextar_connexions (coach) : « réservé aux administrateurs », aucune donnée')
}
{
  const { out, isError } = await appel('nextar_connexions', {}, jetons.admin)
  assert.ok(!isError, JSON.stringify(out))
  assert.equal(out.fenetre_minutes, 10)
  assert.equal(out.total, 5)
  assert.equal(out.connexions[0].nom_affiche, 'Alice Administratrice-Fictive')
  assert.equal(out.connexions[0].canal, 'appli et mcp', 'l’appel en cours compte')
  const mcpSeul = out.connexions.find((c: { nom_affiche: string }) => c.nom_affiche === 'Hélène Claude-Fictive')
  assert.equal(mcpSeul?.canal, 'mcp', 'une administratrice qui n’utilise que Claude apparaît')
  assert.deepEqual(out.par_canal, { appli: 2, mcp: 1, appli_et_mcp: 2 })
  const s = JSON.stringify(out)
  for (const t of textesInterditsComptes()) assert.ok(!s.includes(t), `nextar_connexions : « ${t} » ne doit pas apparaître`)
  const { res } = await rpc('tools/call', { name: 'nextar_connexions', arguments: { minutes: 0 } }, jetons.admin)
  assert.equal(res.status, 200)
  ok(`nextar_connexions (administrateur) : ${out.total} comptes, sans adresse mail ni identifiant brut`)
}
// Outils d'administration : refus pour le coach (aucune donnée) ; réponse pour l'administrateur, sans nom de joueur, adresse
// mail, téléphone, IP ni jeton ; 069 absent dans l'essai : « indisponible tant que 069… ».
for (const [nom, args] of [
  ['nextar_admin_a_faire', {}],
  ['nextar_admin_sante', {}],
  ['nextar_admin_activite', { jours: 30 }],
  ['nextar_admin_questions', { jours: 60, filtre: 'toutes' }],
  ['nextar_admin_journal', { depuis: '2026-11-05', regrouper: false }],
  ['nextar_admin_saisies', { depuis: '2026-11-05', detail: true }],
  ['nextar_admin_lots', {}],
  ['nextar_admin_activite', { depuis: '2026-11-04', jusqu_a: '2026-11-06', par: 'heure', inclure_generation: true }],
  ['nextar_admin_journal', { depuis: '2026-11-05', types: ['mcp'], regrouper: false }],
] as const) {
  const coach = await appel(nom, args)
  assert.ok(coach.isError, nom)
  assert.deepEqual(Object.keys(coach.out), ['erreur'], nom)
  assert.match(coach.out.erreur, /^Réservé aux administrateurs/, nom)
  const { out, isError } = await appel(nom, args, jetons.admin)
  assert.ok(!isError, `${nom} : ${JSON.stringify(out)}`)
  const s = JSON.stringify(out)
  for (const t of interditsAdmin) assert.ok(!s.includes(t), `${nom} : « ${t} » ne doit pas apparaître`)
  assert.ok(!s.includes('@'), `${nom} : « @ »`)
  if (nom === 'nextar_admin_a_faire') assert.equal(out.resume.doublons, 2)
  if (nom === 'nextar_admin_sante') assert.match(out.base, /indisponible tant que supabase\/069_admin_sante\.sql/)
  if (nom === 'nextar_admin_activite') assert.equal(out.inactifs.total, 1)
  if (nom === 'nextar_admin_activite' && 'par' in args) assert.deepEqual(out.comptes[0].histogramme.map((h: { tranche_paris: string }) => h.tranche_paris), ['04/11/2026 23 h', '05/11/2026 00 h'])
  if (nom === 'nextar_admin_journal' && !('types' in args)) assert.equal(out.actions[1].heure_paris, '05/11/2026 08:40')
  if (nom === 'nextar_admin_journal' && 'types' in args) assert.ok(out.actions.length === 3 && out.actions.every((a: { type: string; objet: { outil: string } }) => a.type === 'mcp' && /^nextar_/.test(a.objet.outil)))
  if (nom === 'nextar_admin_saisies') assert.ok(out.mesures.par_test.some((x: { test: string; nb: number }) => x.test === 'Sprint 10 m' && x.nb === 4))
  if (nom === 'nextar_admin_lots') assert.match(out.via, /indisponible tant que supabase\/071_provenance\.sql/)
  if (nom === 'nextar_admin_questions') assert.ok(out.groupes.some((g: { formulation: string }) => g.formulation === 'Montre les mesures de [joueur]'))
  ok(`${nom} : refus pour le coach, réponse pour l’administrateur (sans nom de joueur ni adresse mail)`)
}
{
  const { res } = await rpc('tools/call', { name: 'nextar_admin_activite', arguments: { jours: 0 } }, jetons.admin)
  assert.equal(res.status, 200)
  ok('nextar_admin_activite : jours hors bornes refusé par le schéma, sans plantage')
}
// nextar_admin_proposer : refus pour le coach ; pour l'administrateur, actions prêtes et refusées, proposition déposée.
{
  const args = { sorte: 'archiver', evenements_avant: '2026-07-01', actions: [{ evenement: 'ev-old' }] }
  const coach = await appel('nextar_admin_proposer', args)
  assert.ok(coach.isError)
  assert.deepEqual(Object.keys(coach.out), ['erreur'])
  const { out, isError } = await appel('nextar_admin_proposer', args, jetons.admin)
  assert.ok(!isError, JSON.stringify(out))
  assert.equal(out.etat, 'en_attente')
  assert.deepEqual(out.resume, { pretes: 3, refusees: 1 })
  assert.match(out.actions[0].raison, /déjà archivé/)
  assert.match(out.titre, /Fin de saison 2025-26/)
  const s = JSON.stringify(out)
  for (const t of interditsAdmin) assert.ok(!s.includes(t), `nextar_admin_proposer : « ${t} » ne doit pas apparaître`)
  const trop = await rpc('tools/call', { name: 'nextar_admin_proposer', arguments: { sorte: 'archiver', actions: Array.from({ length: 51 }, () => ({ evenement: 'ev-var' })) } }, jetons.admin)
  assert.equal(trop.res.status, 200)
  ok('nextar_admin_proposer : refus pour le coach ; fin de saison préparée pour l’administrateur (3 prêtes, 1 refusée), 51 actions refusées par le schéma')
}
// 6. Protocole récent (sans version 2025) : la liste répond aussi.
{
  const { res } = await rpc('tools/list', {}, jetons.coach, '2025-03-26')
  assert.equal(res.status, 200)
  ok('protocole 2025-03-26 accepté')
}
console.log(`\n${n} vérifications de bout en bout : toutes vertes.`)
