// Copie GÉNÉRÉE des modules purs de l'appli dont la fonction Supabase « mcp » a besoin (supabase/functions/mcp/partage/).
//
// POURQUOI UNE COPIE : la fonction tourne sous Deno, qui veut des imports avec l'extension (« ./nameMatch.ts ») et ne voit au
// déploiement que le dossier supabase/functions ; l'appli (Vite) importe sans extension depuis src/. La source de vérité
// reste dans src/ : ce script recopie les fichiers tels quels, en changeant seulement les chemins d'import, et
// tools/test-mcp.ts échoue si une copie n'est plus identique à ce que le script produirait (on a modifié src/ sans relancer
// le script, ou modifié la copie à la main).
//
//   npx jiti tools/generer-partage-mcp.ts            écrit les copies
//   npx jiti tools/generer-partage-mcp.ts --verifier n'écrit rien ; code de sortie 1 si une copie est à refaire
//
// Fichiers recopiés : seulement des modules PURS (ni Dexie, ni React, ni réseau, ni localStorage). Un import vers un fichier
// qui n'est pas dans la liste fait échouer le script (pour ne pas emporter l'appli dans la fonction par mégarde). Les types
// de src/db.ts utilisés par importMesures.ts viennent de partage/db.ts (écrit à la main, quelques champs).
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
export const DOSSIER = 'supabase/functions/mcp/partage'
/** Modules recopiés (src/<nom>.ts → partage/<nom>.ts). */
export const MODULES = ['nameMatch', 'importMesures', 'codesJoueurs', 'sportConfig', 'gender', 'askAction', 'questionLogCore', 'propositionsAdminCore'] as const
/** Imports permis en plus des modules recopiés : fichiers écrits à la main dans partage/ (types seulement). */
const A_LA_MAIN = ['db']

const banniere = (nom: string) =>
  `// FICHIER GÉNÉRÉ par tools/generer-partage-mcp.ts depuis src/${nom}.ts : ne pas le modifier ici. Après un changement dans\n` +
  `// src/${nom}.ts : npx jiti tools/generer-partage-mcp.ts (tools/test-mcp.ts vérifie que la copie est à jour).\n`

/** Contenu attendu de chaque copie (chemin relatif au dépôt → texte). */
export function genererPartage(): Record<string, string> {
  const out: Record<string, string> = {}
  for (const nom of MODULES) {
    const src = readFileSync(join(ROOT, 'src', `${nom}.ts`), 'utf8')
    const body = src.replace(/(from\s+')\.\/([A-Za-z0-9_]+)(')/g, (_all, a: string, mod: string, b: string) => {
      if (!(MODULES as readonly string[]).includes(mod) && !A_LA_MAIN.includes(mod))
        throw new Error(`src/${nom}.ts importe « ./${mod} », qui n'est pas un module partagé avec la fonction mcp`)
      return `${a}./${mod}.ts${b}`
    })
    if (/^\s*(import|export)\b[^\n]*\bfrom\s+['"](?!\.\/)/m.test(body) || /\bimport\('/.test(body)) throw new Error(`src/${nom}.ts importe un paquet ou un import dynamique : pas partageable tel quel`)
    out[`${DOSSIER}/${nom}.ts`] = banniere(nom) + body
  }
  return out
}

/** Copies à refaire (absentes ou différentes). */
export function copiesPerimees(): string[] {
  return Object.entries(genererPartage())
    .filter(([p, txt]) => !existsSync(join(ROOT, p)) || readFileSync(join(ROOT, p), 'utf8') !== txt)
    .map(([p]) => p)
}

const principal = /generer-partage-mcp\.ts$/.test(process.argv[1] ?? '')
if (principal) {
  if (process.argv.includes('--verifier')) {
    const p = copiesPerimees()
    if (p.length) {
      console.error(`Copies à refaire : ${p.join(', ')}\n  npx jiti tools/generer-partage-mcp.ts`)
      process.exit(1)
    }
    console.log('Copies à jour.')
  } else {
    for (const [p, txt] of Object.entries(genererPartage())) writeFileSync(join(ROOT, p), txt)
    console.log(`Copies écrites dans ${DOSSIER} : ${MODULES.join(', ')}.`)
  }
}
