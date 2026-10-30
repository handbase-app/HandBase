// Test de l'écran d'ouverture (src/splash.ts) : quand entrer dans l'appli selon le temps écoulé et la synchro
// (à jour, lente, bloquée, impossible, pas connecté, tout premier chargement), toucher pour passer, bouton
// « Entrer quand même », pulsation de la pastille, barre et texte.
//
//   npx jiti tools/test-ouverture.ts
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { BUTTON_MS, LOGIN_MIN_MS, MAX_MS, MIN_MS, splashBar, splashDecision, splashText, STALL_MS, type SplashInput } from '../src/splash'
import { BUSY_LABEL } from '../src/syncProgress'
import { THEMES } from '../src/theme'
import { contrast, paletteOf, STYLES } from '../src/uiStyle'

const at = (elapsed: number, o: Partial<SplashInput> = {}) => splashDecision({ elapsed, lastActivity: elapsed, sync: 'pending', firstLoad: false, ...o })
const enters = (elapsed: number, o: Partial<SplashInput> = {}) => at(elapsed, o).enter

assert.equal(MIN_MS, 2800)
assert.equal(STALL_MS, 2500)
assert.equal(MAX_MS, 8000)
assert.equal(BUTTON_MS, 10_000)

// Minimum : le temps de l'animation, quoi qu'il arrive (sauf toucher).
for (const sync of ['none', 'done', 'pending'] as const) {
  assert.equal(enters(0, { sync }), false, `${sync} à 0 s`)
  assert.equal(enters(MIN_MS - 1, { sync, lastActivity: 0 }), false, `${sync} juste avant le minimum`)
}

// Synchro à jour : on entre dès le minimum (pas de pulsation).
assert.deepEqual(at(MIN_MS, { sync: 'done' }), { enter: true, button: false, pulse: false, skippable: true })
// Synchro finie après le minimum : on entre à ce moment-là.
assert.equal(enters(4000, { sync: 'pending', lastActivity: 3900 }), false)
assert.equal(enters(4100, { sync: 'done', lastActivity: 4100 }), true)

// Pas de réseau du tout (pas de serveur, hors ligne, erreur) : fin de l'animation.
assert.equal(enters(MIN_MS, { sync: 'none', lastActivity: 0 }), true)
assert.equal(at(MIN_MS, { sync: 'none' }).pulse, false, 'hors ligne : la pastille dit déjà « Hors ligne »')

// Synchro qui avance (signe de vie récent) : on reste ; jusqu'au plafond.
for (let t = MIN_MS; t < MAX_MS; t += 250) assert.equal(enters(t, { lastActivity: t - 400 }), false, `avance encore à ${t}`)
// Plafond : 8 s, même si elle avance toujours ; la pastille clignote.
assert.deepEqual(at(MAX_MS, { lastActivity: MAX_MS - 100 }), { enter: true, button: false, pulse: true, skippable: true })

// Synchro bloquée : plus rien depuis 2,5 s → on entre (au plus tôt au minimum).
assert.equal(enters(MIN_MS, { lastActivity: 0 }), true, 'rien depuis le début : entrée au minimum')
assert.equal(enters(MIN_MS, { lastActivity: 400 }), false)
assert.equal(enters(400 + STALL_MS - 1, { lastActivity: 400 }), false)
assert.equal(enters(400 + STALL_MS, { lastActivity: 400 }), true)
// Lente puis bloquée : avance jusqu'à 4 s, plus rien ensuite → entrée à 6,5 s, avec pulsation.
assert.equal(enters(6400, { lastActivity: 4000 }), false)
assert.deepEqual(at(6500, { lastActivity: 4000 }), { enter: true, button: false, pulse: true, skippable: true })

// Toucher / clic / Entrée / Échap : on passe tout de suite (pulsation si la synchro n'est pas finie).
assert.deepEqual(at(300, { skipped: true }), { enter: true, button: false, pulse: true, skippable: true })
assert.deepEqual(at(300, { sync: 'done', skipped: true }), { enter: true, button: false, pulse: false, skippable: true })
assert.equal(enters(300, { sync: 'none', skipped: true }), true)

// Pas connecté : animation courte puis l'écran de connexion, sans attendre de synchro.
assert.ok(LOGIN_MIN_MS < MIN_MS)
assert.equal(enters(LOGIN_MIN_MS - 1, { sync: 'login', lastActivity: 0 }), false)
assert.deepEqual(at(LOGIN_MIN_MS, { sync: 'login', lastActivity: 0 }), { enter: true, button: false, pulse: false, skippable: true })
assert.equal(enters(200, { sync: 'login', skipped: true }), true)
// Même sur un appareil vide (jamais synchronisé) : la connexion d'abord.
assert.equal(enters(LOGIN_MIN_MS, { sync: 'login', firstLoad: true }), true)

// Tout premier chargement : on reste avec la vraie progression, au-delà du plafond et même bloqué.
const first = (elapsed: number, o: Partial<SplashInput> = {}) => at(elapsed, { firstLoad: true, ...o })
for (const t of [MIN_MS, MAX_MS, 9999]) {
  assert.deepEqual(first(t, { lastActivity: 0 }), { enter: false, button: false, pulse: false, skippable: false }, `premier chargement à ${t}`)
}
// Toucher sans effet pendant le premier chargement (c'est le bouton).
assert.equal(first(5000, { skipped: true }).enter, false)
assert.equal(first(BUTTON_MS + 5000, { skipped: true }).enter, false)
// Bouton « Entrer quand même » après 10 s.
assert.equal(first(BUTTON_MS - 1).button, false)
assert.deepEqual(first(BUTTON_MS), { enter: false, button: true, pulse: false, skippable: false })
assert.deepEqual(first(BUTTON_MS + 2000, { forced: true }), { enter: true, button: true, pulse: true, skippable: false })
// Bouton pas encore visible : sans effet.
assert.equal(first(4000, { forced: true }).enter, false)
// Premier chargement terminé : entrée automatique (au plus tôt au minimum).
assert.equal(first(MIN_MS - 1, { sync: 'done' }).enter, false)
assert.equal(first(MIN_MS, { sync: 'done' }).enter, true)
assert.equal(first(25_000, { sync: 'done', lastActivity: 25_000 }).enter, true)
// Premier chargement devenu impossible (réseau coupé, erreur) : on entre, la pastille dit pourquoi.
assert.equal(first(MIN_MS, { sync: 'none' }).enter, true)
assert.equal(first(12_000, { sync: 'none' }).enter, true)

// Barre : progression réelle (par tables et par pages, sans comptage : src/syncProgress.ts), pleine à la fin, « en attente »
// tant que rien n'est reçu ; jamais au-delà de 100 %.
const p = (done: number, share: number, first = false) => ({ table: 'players' as const, done, share, first })
assert.equal(splashBar('done', null), 1)
assert.equal(splashBar('none', null), 1)
assert.equal(splashBar('pending', null), null)
assert.equal(splashBar('pending', p(0, 0)), null)
assert.equal(splashBar('pending', p(738, 0.25)), 0.25)
assert.equal(splashBar('pending', p(3000, 1.2)), 1)

// Texte (espaces fines insécables des milliers selon toLocaleString : comparé sans espaces).
const flat = (s: string) => s.replace(/\s/g, ' ')
assert.equal(flat(splashText('pending', p(738, 0.25), true, true)), 'Mise à jour : 738 éléments reçus (joueurs)')
assert.equal(flat(splashText('pending', p(12400, 0.4, true), true, true)), 'Premier chargement : 12 400 éléments reçus (joueurs)')
assert.equal(flat(splashText('pending', p(1, 0.5, true), true, true)), 'Premier chargement : 1 élément reçu (joueurs)')
// Rien encore reçu : texte d'attente (plus de « 0 / 40 001 » : le total n'est plus demandé au serveur).
assert.equal(splashText('pending', p(0, 0, true), true, true), 'Synchronisation…')
assert.equal(splashText('pending', null, true, true), 'Synchronisation…')
assert.equal(splashText('done', p(10, 10), true, true), 'À jour')
assert.equal(splashText('none', null, true, false), 'Hors ligne : données de l’appareil')
assert.equal(splashText('none', null, true, true), 'Synchro impossible : données de l’appareil')
assert.equal(splashText('none', null, false, true), 'Données de l’appareil')
assert.equal(splashText('login', null, true, true), '')

// Message d'attente (serveur très demandé) : à la place du compte pendant la synchro, jamais quand elle est finie ou impossible.
assert.equal(splashText('pending', p(738, 0.25), true, true, true), BUSY_LABEL)
assert.equal(splashText('pending', null, true, true, true), BUSY_LABEL)
assert.equal(splashText('done', null, true, true, true), 'À jour')
assert.equal(splashText('none', null, true, false, true), 'Hors ligne : données de l’appareil')
assert.equal(splashText('login', null, true, true, true), '')
// Un seul endroit : le texte n'est écrit que dans src/syncProgress.ts ; l'ancien texte a disparu.
const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const x = join(dir, f)
    return statSync(x).isDirectory() ? files(x) : /\.(ts|tsx|html)$/.test(f) ? [x] : []
  })
const root = new URL('..', import.meta.url).pathname
const sources = [...files(join(root, 'src')), join(root, 'index.html')]
const holders = sources.filter((f) => readFileSync(f, 'utf8').includes(BUSY_LABEL.slice(0, 20)))
assert.deepEqual(holders.map((f) => f.slice(root.length)), ['src/syncProgress.ts'])
assert.ok(!sources.some((f) => readFileSync(f, 'utf8').includes('la synchro reprend toute seule')), 'ancien texte retiré')
assert.ok(BUSY_LABEL.endsWith('…') && !/serveur|requête|synchro/i.test(BUSY_LABEL), 'humain, sans mot technique')
// Tient sur une ligne d'un téléphone de 360 px (10 px gras : ~5,6 px par caractère, 32 px de marges).
assert.ok(BUSY_LABEL.length <= 58, `${BUSY_LABEL.length} caractères`)
const bar = readFileSync(join(root, 'src/components/SyncProgress.tsx'), 'utf8')
assert.ok(bar.includes("busy ? 'text-fg' : 'text-muted'") && bar.includes('{busy ? BUSY_LABEL :'), 'barre : texte en couleur du texte, sans « … » ajouté')
// Contraste (AA, 4,5:1) du message dans la barre (couleur du texte sur le fond) : tous les thèmes et styles, clairs et sombres ;
// écran d'ouverture (toujours sombre, index.html : #8fb3bd sur #0A182D).
for (const t of THEMES) assert.ok(contrast(t.colors.fg, t.colors.bg) >= 4.5, `thème ${t.id}`)
for (const st of STYLES)
  for (const light of [true, false]) {
    const pal = paletteOf(st, light)
    if (pal) assert.ok(contrast(pal.fg, pal.bg) >= 4.5, `style ${st.id} ${light ? 'clair' : 'sombre'}`)
  }
const html = readFileSync(join(root, 'index.html'), 'utf8')
assert.ok(html.includes('#splash .sp-txt{') && html.includes('color:#8fb3bd'))
assert.ok(contrast('#8fb3bd', '#0A182D') >= 4.5, 'écran d’ouverture')

console.log('test-ouverture : OK')
