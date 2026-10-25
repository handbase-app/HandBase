// Test des icônes par sport (tools/icones-sport.py, vite.config.ts : sportPublicDir) : chaque sport a son jeu complet aux
// mêmes chemins (handball : public/ ; volley : public-sport/volley/), tailles et transparence attendues, nom du sport en
// tracés (pas de <text>), logo Nextar repris tel quel ; favicons communs ; écran d'ouverture : nom du sport fini d'animer
// avant la fin de l'animation (normale et courte).
//
//   npx jiti tools/test-icones-sport.ts
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { LOGIN_MIN_MS, MIN_MS } from '../src/splash'
import { SPORT_WORDS } from '../src/sportWordmark'

const root = resolve(__dirname, '..')
const dirs = { handball: join(root, 'public'), volley: join(root, 'public-sport/volley') }

/** Largeur, hauteur et type de couleur (2 : RGB opaque ; 6 : RGBA) d'un PNG, lus dans son en-tête. */
function png(file: string) {
  const b = readFileSync(file)
  assert.equal(b.toString('latin1', 1, 4), 'PNG', `${file} : pas un PNG`)
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20), color: b[25] }
}

// Le mot « Nextar » du logo (tracé des lettres) : repris tel quel dans chaque icône.
const logo = readFileSync(join(root, 'public/brand/nextar.svg'), 'utf8')
const letters = logo.match(/<path d="(M61\.68[^"]+)"/)?.[1]
assert.ok(letters, 'tracé du mot « Nextar » introuvable dans public/brand/nextar.svg')

const icons: Record<string, string> = {}
for (const [sport, dir] of Object.entries(dirs)) {
  const svg = readFileSync(join(dir, 'icon.svg'), 'utf8')
  icons[sport] = svg
  assert.ok(!/<text\b/.test(svg), `${sport} : nom du sport en <text> (doit être en tracés)`)
  assert.ok(svg.includes(letters), `${sport} : le logo Nextar n'est pas repris tel quel`)
  assert.ok(svg.includes('#89F7B3') && svg.includes('#61D0D1'), `${sport} : dégradé menthe absent`)
  assert.deepEqual(png(join(dir, 'icon-192.png')), { w: 192, h: 192, color: 6 }, `${sport} : icon-192.png`)
  assert.deepEqual(png(join(dir, 'icon-512.png')), { w: 512, h: 512, color: 6 }, `${sport} : icon-512.png`)
  assert.deepEqual(png(join(dir, 'icon-maskable-512.png')), { w: 512, h: 512, color: 2 }, `${sport} : maskable opaque`)
  assert.deepEqual(png(join(dir, 'apple-touch-icon.png')), { w: 180, h: 180, color: 2 }, `${sport} : apple-touch-icon opaque`)
  assert.ok(SPORT_WORDS[sport]?.d.length > 100, `${sport} : tracé de l'écran d'ouverture`)
}
assert.notEqual(icons.handball, icons.volley, 'les deux sports ont la même icône')
assert.equal(SPORT_WORDS.handball.text, 'HANDBALL')
assert.equal(SPORT_WORDS.volley.text, 'VOLLEY')

// Favicons : le pictogramme seul, communs à tous les sports (pas de copie par sport).
for (const f of ['favicon.svg', 'favicon-32.png', 'favicon-16.png']) {
  assert.ok(existsSync(join(dirs.handball, f)), f)
  assert.ok(!existsSync(join(dirs.volley, f)), `${f} : ne change pas selon le sport`)
}

// Écran d'ouverture : emplacements du nom du sport, et son animation finie avant l'entrée la plus rapide.
const html = readFileSync(join(root, 'index.html'), 'utf8')
assert.ok(html.includes('viewBox="%SPORT_WORD_BOX%"') && html.includes('d="%SPORT_WORD_PATH%"'), 'index.html : nom du sport absent')
const anim = html.match(/\.sp-sport\{[^}]*animation:sp-sport calc\(([\d.]+)s\*var\(--sp-d\)\) [\w-]+ calc\(([\d.]+)s\*var\(--sp-d\)\)/)
assert.ok(anim, 'animation .sp-sport introuvable')
const end = (Number(anim[1]) + Number(anim[2])) * 1000
const short = Number(html.match(/#splash\.sp-short\{--sp-d:([\d.]+)\}/)?.[1])
assert.ok(end <= MIN_MS, `nom du sport fini à ${end} ms, après MIN_MS`)
assert.ok(short > 0 && end * short <= LOGIN_MIN_MS, `animation courte : nom du sport fini à ${end * short} ms, après LOGIN_MIN_MS`)

console.log('✓ icônes par sport : jeux complets (handball, volley), tracés, logo repris, favicons communs, écran d’ouverture')
