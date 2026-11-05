// Essai de bout en bout (tools/essai-mcp/lancer.sh) : appels HTTP au serveur MCP lancé dans le runtime des fonctions
// Supabase, comme le ferait Claude : découverte OAuth, refus sans jeton, CORS, puis initialize, tools/list et chaque outil
// avec un jeton fictif. Vérifie qu'aucune réponse ne contient un nom, une date de naissance, un club, une licence ou un
// commentaire du jeu fictif.
//   MCP_URL=http://127.0.0.1:9707/functions/v1/mcp JETONS=<fichier> npx jiti tools/essai-mcp/appels.ts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { textesInterdits } from '../mcp-jeu-fictif'

const URL_MCP = process.env.MCP_URL ?? 'http://127.0.0.1:9707/functions/v1/mcp'
const jetons = JSON.parse(readFileSync(process.env.JETONS!, 'utf8')) as Record<string, string>
const interdits = textesInterdits()

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
  assert.deepEqual(noms, ['nextar_contexte', 'nextar_lire', 'nextar_proposer', 'nextar_rapport', 'nextar_suivi'])
  const lire = body.result.tools.find((t: { name: string }) => t.name === 'nextar_lire')
  assert.equal(lire.annotations.readOnlyHint, true)
  assert.ok(lire.inputSchema.properties.limite)
  ok('tools/list : les cinq outils, schémas et annotations')
}
// 5. Chaque outil.
const appel = async (name: string, args: unknown) => {
  const { res, body } = await rpc('tools/call', { name, arguments: args })
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
// 6. Protocole récent (sans version 2025) : la liste répond aussi.
{
  const { res } = await rpc('tools/list', {}, jetons.coach, '2025-03-26')
  assert.equal(res.status, 200)
  ok('protocole 2025-03-26 accepté')
}
console.log(`\n${n} vérifications de bout en bout : toutes vertes.`)
