#!/usr/bin/env node
// Nextar : génère une paire de clés VAPID (web push) pour UN projet Supabase, à lancer soi-même sur son ordinateur.
// Aucune dépendance (module crypto de Node). La clé PRIVÉE n'est jamais affichée : elle est écrite seulement dans un fichier
// créé en mode 600 (lecture par vous seul), dans un dossier en 700, hors du dépôt. Seule la clé PUBLIQUE est affichée.
//
//   node tools/vapid-generer.mjs <nom> mailto:<adresse>
//     ex. node tools/vapid-generer.mjs volley mailto:contact@exemple.fr
//   → ~/.config/nextar/vapid-<nom>.env  (VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT)
//
// Ensuite :
//  - secrets de la fonction : Supabase > Edge Functions > Secrets : coller les 3 valeurs du fichier (ou, avec la CLI :
//    supabase secrets set --env-file ~/.config/nextar/vapid-<nom>.env --project-ref <ref>) ;
//  - clé publique dans la construction de l'appli : variable VITE_VAPID_PUBLIC_KEY (GitHub et .env.*.local).
// Un fichier existant n'est jamais remplacé (changer de clés désabonne tous les appareils) : --remplacer pour le forcer.
import { createECDH } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, openSync, writeSync, closeSync, unlinkSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const args = process.argv.slice(2)
const force = args.includes('--remplacer')
const [nom, sujet] = args.filter((a) => a !== '--remplacer')
if (!nom || !/^[a-z0-9-]{1,40}$/.test(nom) || !sujet || !/^(mailto:[^@\s]+@[^@\s]+|https:\/\/\S+)$/.test(sujet)) {
  console.error('Usage : node tools/vapid-generer.mjs <nom : lettres, chiffres, tirets> mailto:<adresse> [--remplacer]')
  process.exit(2)
}

const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const ecdh = createECDH('prime256v1')
ecdh.generateKeys()
const publicKey = b64url(ecdh.getPublicKey(null, 'uncompressed')) // 65 octets
// Clé privée : 32 octets (zéros devant si besoin).
const priv = ecdh.getPrivateKey()
const privateKey = b64url(Buffer.concat([Buffer.alloc(Math.max(0, 32 - priv.length)), priv]))

const dir = join(homedir(), '.config', 'nextar')
mkdirSync(dir, { recursive: true, mode: 0o700 })
chmodSync(dir, 0o700)
const file = join(dir, `vapid-${nom}.env`)
if (existsSync(file)) {
  if (!force) {
    console.error(`${file} existe déjà : rien n'est remplacé (de nouvelles clés désabonneraient tous les appareils). --remplacer pour forcer.`)
    process.exit(1)
  }
  unlinkSync(file)
}
// Créé directement en 600 (jamais lisible par d'autres, même un instant), et jamais par-dessus un fichier existant (wx).
const fd = openSync(file, 'wx', 0o600)
writeSync(fd, `VAPID_PUBLIC_KEY=${publicKey}\nVAPID_PRIVATE_KEY=${privateKey}\nVAPID_SUBJECT=${sujet}\n`)
closeSync(fd)
chmodSync(file, 0o600)

console.log(`Clés VAPID « ${nom} » écrites dans ${file} (mode 600 : clé privée lisible par vous seul, jamais affichée).`)
console.log(`Clé publique (VITE_VAPID_PUBLIC_KEY) : ${publicKey}`)
