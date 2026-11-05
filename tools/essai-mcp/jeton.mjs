// Essai de bout en bout (tools/essai-mcp/lancer.sh) : une paire de clés ES256 JETABLE, sa clé publique en JWKS (comme celles
// d'un projet Supabase avec clés de signature asymétriques) et des jetons FICTIFS signés avec. Écrit dans le dossier donné :
// env (pour le runtime) et jetons.json (pour appels.ts). Rien n'est envoyé nulle part.
//   node tools/essai-mcp/jeton.mjs <dossier>
import { generateKeyPairSync, sign } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

const dir = process.argv[2]
if (!dir) throw new Error('dossier attendu')
const kid = 'essai-mcp-' + Date.now()
const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
const jwk = { ...publicKey.export({ format: 'jwk' }), kid, alg: 'ES256', use: 'sig' }
const b64 = (x) => Buffer.from(typeof x === 'string' ? x : JSON.stringify(x)).toString('base64url')
const now = Math.floor(Date.now() / 1000)
const jeton = (claims, key = privateKey) => {
  const head = b64({ alg: 'ES256', typ: 'JWT', kid })
  const body = b64({ iss: 'http://127.0.0.1:54321/auth/v1', aud: 'authenticated', role: 'authenticated', iat: now, exp: now + 3600, ...claims })
  const sig = sign('sha256', Buffer.from(`${head}.${body}`), { key, dsaEncoding: 'ieee-p1363' }).toString('base64url')
  return `${head}.${body}.${sig}`
}
const autre = generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey
const jetons = {
  coach: jeton({ sub: '00000000-0000-4000-8000-0000000000c1', email: 'coach@exemple.test', client_id: 'client-fictif' }),
  // Administrateur fictif (nextar_connexions) : main/index.ts lui donne la Source « administrateur » du jeu fictif.
  admin: jeton({ sub: '00000000-0000-4000-8000-0000000000a1', email: 'admin@exemple.test', client_id: 'client-fictif' }),
  expire: jeton({ sub: '00000000-0000-4000-8000-0000000000c1', exp: now - 60 }),
  fauxSignataire: jeton({ sub: '00000000-0000-4000-8000-0000000000c1' }, autre),
}
writeFileSync(join(dir, 'jetons.json'), JSON.stringify(jetons))
writeFileSync(
  join(dir, 'env'),
  [
    'SUPABASE_URL=http://127.0.0.1:54321',
    'SUPABASE_PUBLISHABLE_KEY=sb_publishable_essai_fictif',
    'SUPABASE_SECRET_KEY=sb_secret_essai_fictif',
    `SUPABASE_JWKS=${JSON.stringify({ keys: [jwk] })}`,
    'SUPABASE_FUNCTION_SLUG=mcp',
  ].join('\n') + '\n',
)
console.log('clés et jetons fictifs prêts')
