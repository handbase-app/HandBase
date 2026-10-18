// Test des styles d'interface (src/uiStyle.ts, src/theme.ts) : rien de réglé = l'appli d'origine (mêmes variables, aucun
// attribut de style) ; résolution du choix de l'organisation (clé « apparence » de hb_config) ; Clair / Sombre / Auto de
// chacun ; contrastes WCAG de chaque palette (texte 4,5:1 au moins) et couleurs d'état / graphiques encore lisibles.
//
//   npx jiti tools/test-styles.ts          (ajouter --table pour afficher tous les rapports de contraste)
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { computeLook, THEMES } from '../src/theme'
import {
  APPEARANCE_KEY,
  cleanAppearance,
  contrast,
  flatten,
  LOGO_MAX_CHARS,
  paletteOf,
  resolveAppearance,
  STYLES,
  styleLook,
  svgDataUrl,
  svgLogoSafe,
  textPairs,
} from '../src/uiStyle'

const table = process.argv.includes('--table')

// ---------- Contraste : valeurs de référence WCAG ----------
assert.equal(Math.round(contrast('#000000', '#ffffff') * 10) / 10, 21)
assert.equal(contrast('#777777', '#777777'), 1)
assert.ok(Math.abs(contrast('#767676', '#ffffff') - 4.54) < 0.01)
assert.equal(flatten('#ffffff80', '#000000'), '#808080')
assert.equal(flatten('#123456', '#ffffff'), '#123456')

// ---------- Actuel (par défaut) : exactement les variables d'avant ----------
for (const t of THEMES) {
  const look = computeLook('actuel', t.id)
  assert.deepEqual(look.vars, {
    '--color-bg': t.colors.bg,
    '--color-panel': t.colors.panel,
    '--color-panel-2': t.colors.panel2,
    '--color-line': t.colors.line,
    '--color-muted': t.colors.muted,
    '--color-fg': t.colors.fg,
    '--color-accent': t.colors.accent,
    '--color-accent-soft': t.colors.accent + '22',
  })
  assert.equal(look.light, t.light)
  assert.equal(look.themeColor, t.colors.bg)
  assert.ok(!Object.values(look.attrs).some(Boolean), 'Actuel : aucun attribut de style')
  assert.equal(look.fontHref, undefined, 'Actuel : aucune police chargée')
}
assert.equal(computeLook('actuel', 'auto', true).theme.id, 'clair')
assert.equal(computeLook('actuel', 'auto', false).theme.id, 'nuit')

// ---------- Choix de l'organisation ----------
assert.deepEqual(resolveAppearance([]), { style: 'actuel' }, 'rien de réglé : Actuel')
assert.deepEqual(resolveAppearance([{ id: APPEARANCE_KEY, key: APPEARANCE_KEY, value: { style: 'sport' } }]), { style: 'sport' })
assert.deepEqual(resolveAppearance([{ id: APPEARANCE_KEY, key: APPEARANCE_KEY, value: { style: 'sport' }, deleted: true }]), { style: 'actuel' }, 'ligne supprimée')
assert.deepEqual(resolveAppearance([{ id: 'sport', key: 'sport', value: { style: 'sport' } }]), { style: 'actuel' }, 'autre clé ignorée')
assert.deepEqual(cleanAppearance({ style: 'inconnu' }), { style: 'actuel' })
assert.deepEqual(cleanAppearance('sport'), { style: 'actuel' })
assert.deepEqual(cleanAppearance({ style: 'officiel', name: '  Ligue Fictive  ' }), { style: 'officiel', name: 'Ligue Fictive' })
assert.equal(cleanAppearance({ style: 'sport', name: 'x'.repeat(80) }).name?.length, 40)
const png = 'data:image/png;base64,iVBORw0KGgo='
assert.equal(cleanAppearance({ style: 'sport', logo: png }).logo, png)
assert.equal(cleanAppearance({ style: 'sport', logo: png }).logoBg, undefined, 'fond transparent par défaut')
assert.equal(cleanAppearance({ style: 'sport', logo: png, logoBg: 'white' }).logoBg, 'white', 'tuile blanche gardée')
assert.equal(cleanAppearance({ style: 'sport', logoBg: 'white' }).logoBg, undefined, 'pas de fond sans logo')
assert.equal(cleanAppearance({ style: 'sport', logo: png, logoBg: 'rouge' }).logoBg, undefined, 'fond inconnu ignoré')
assert.equal(cleanAppearance({ style: 'sport', logo: 'data:image/svg+xml;base64,PHN2Zz4=' }).logo, undefined, 'SVG incomplet refusé')
{
  const ok = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><defs><linearGradient id="g"/></defs><circle cx="5" cy="5" r="4" fill="url(#g)"/><use href="#g"/></svg>'
  assert.ok(svgLogoSafe(ok), 'SVG simple accepté')
  assert.equal(cleanAppearance({ style: 'sport', logo: svgDataUrl(ok) }).logo, svgDataUrl(ok), 'SVG sûr gardé')
  assert.ok(svgLogoSafe('<?xml version="1.0"?><!-- logo --><svg viewBox="0 0 1 1"><text>Club é</text></svg>'), 'en-tête XML, commentaire, accents')
  for (const bad of [
    '<svg><script>alert(1)</script></svg>',
    '<svg onload="alert(1)"><rect/></svg>',
    '<svg><a href="javascript:alert(1)"><rect/></a></svg>',
    '<svg><image href="https://exemple.test/x.png"/></svg>',
    '<svg><foreignObject><div/></foreignObject></svg>',
    '<!DOCTYPE svg [<!ENTITY x "y">]><svg/>',
    '<svg><style>@import url(https://exemple.test/a.css)</style></svg>',
    '<svg><rect fill="url(https://exemple.test/p.svg#a)"/></svg>',
    '<html><svg></svg></html>',
  ]) {
    assert.ok(!svgLogoSafe(bad), `SVG refusé : ${bad}`)
    assert.equal(cleanAppearance({ style: 'sport', logo: svgDataUrl(bad) }).logo, undefined, `SVG piégé non relu : ${bad}`)
  }
}
assert.equal(cleanAppearance({ style: 'sport', logo: 'https://exemple.test/logo.png' }).logo, undefined, 'adresse refusée')
assert.equal(cleanAppearance({ style: 'sport', logo: 'data:image/png;base64,' + 'A'.repeat(LOGO_MAX_CHARS) }).logo, undefined, 'trop lourd')

// ---------- Clair / Sombre / Auto pour un autre style ----------
for (const s of STYLES.filter((x) => x.id !== 'actuel')) {
  assert.ok(s.light && s.dark && s.fonts && s.radius, `${s.id} : deux versions, polices, arrondis`)
  // Les thèmes clairs donnent la version claire, les sombres la version sombre ; « auto » suit le téléphone.
  for (const t of THEMES) assert.equal(computeLook(s.id, t.id).vars['--color-bg'], (t.light ? s.light : s.dark)!.bg, `${s.id} / ${t.id}`)
  assert.equal(computeLook(s.id, 'auto', true).vars['--color-bg'], s.light!.bg)
  assert.equal(computeLook(s.id, 'auto', false).vars['--color-bg'], s.dark!.bg)
  const look = styleLook(s, true)
  assert.equal(look.attrs['data-style'], true)
  assert.ok(look.fontHref?.startsWith('https://fonts.googleapis.com/'), 'polices : Google Fonts seulement')
  for (const k of ['sm', 'md', 'lg', 'xl', '2xl']) assert.ok(look.vars[`--radius-${k}`], `${s.id} : --radius-${k}`)
}
assert.equal(styleLook(STYLES.find((s) => s.id === 'officiel')!, true).attrs['data-header'], true, 'Officiel : en-tête coloré')
assert.equal(styleLook(STYLES.find((s) => s.id === 'sport')!, false).attrs['data-map'], true, 'Sport : carte sur fond bleu nuit')
assert.equal(styleLook(STYLES.find((s) => s.id === 'sport')!, true).attrs['data-upper'], true, 'Sport : titres en capitales')
assert.equal(STYLES.find((s) => s.id === 'sombre')?.label, 'Salle', 'style « sombre » : identifiant gardé, affiché « Salle »')
assert.deepEqual(cleanAppearance({ style: 'sombre' }), { style: 'sombre' }, 'valeur déjà enregistrée « sombre » relue')

// ---------- Couleur vive réservée ----------
// Choix sélectionnés (pastilles, segmentés), barres, bordures : couleur d'encre (--color-accent) ; la couleur vive
// (--color-brand) ne sert qu'au bouton principal, à l'onglet actif du menu, au chiffre clé du bandeau et à la carte.
const css = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8')
assert.match(css, /nav\[aria-label="Menu principal"\] a\[aria-current="page"\] \{\s*--color-accent: var\(--color-brand\);/, 'onglet actif : couleur vive')
assert.match(css, /\.btn-primary \{ background-color: var\(--color-primary\)/, 'bouton principal : couleur vive')
for (const s of STYLES.filter((x) => x.id !== 'actuel')) {
  for (const light of [true, false]) {
    const p = paletteOf(s, light)!
    const look = styleLook(s, light)
    assert.notEqual(p.accent.toLowerCase(), p.brand.toLowerCase(), `${s.id} : sélection ≠ couleur vive`)
    assert.equal(look.vars['--color-primary'], p.primary ?? p.brand, `${s.id} : bouton principal en couleur vive`)
    assert.equal(look.vars['--color-brand-text'], p.brandText)
    // Chiffre clé du bandeau : la couleur vive (ou sa version éclaircie sur le bloc foncé), pas l'encre.
    assert.notEqual(p.emph.accent.toLowerCase(), p.accent.toLowerCase(), `${s.id} : chiffre clé ≠ encre`)
    // En sombre, la sélection est claire (texte foncé dessus) ; en clair, foncée (texte blanc).
    assert.equal(contrast(p.accent, '#ffffff') > contrast(p.accent, '#000000'), light, `${s.id} ${light ? 'clair' : 'sombre'} : sélection ${light ? 'foncée' : 'claire'}`)
  }
}

// ---------- Contrastes ----------
// Couleurs d'état (src/index.css : version foncée sur les thèmes clairs, Tailwind 300/400 sur les sombres), avis des
// observateurs (Opinions.tsx), comparaison (Compare.tsx) : du texte ou de fins traits → 4,5:1 (texte) / 3:1 (graphiques).
const read = (f: string) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8')
const arr = (src: string, name: string) => [...src.match(new RegExp(`${name} = \\[([^\\]]+)\\]`))![1].matchAll(/'(#[0-9a-f]{6})'/gi)].map((m) => m[1])
const op = read('src/components/Opinions.tsx')
const cmp = read('src/pages/Compare.tsx')
const STATUS_LIGHT = ['#92400e', '#047857', '#b91c1c', '#6d28d9', '#a16207', '#0369a1', '#c2410c', '#be123c', '#0f766e']
// Tailwind v4 (oklch) arrondis en hexadécimal : amber-300, emerald-300, red-400, violet-300, yellow-300, sky-300, orange-300, rose-300, teal-300.
const STATUS_DARK = ['#ffd230', '#5ee9b5', '#ff6467', '#c4b4ff', '#ffdf20', '#74d4ff', '#ffb86a', '#ffa1ad', '#46ecd5']
const RADAR = [...read('src/radarZones.ts').matchAll(/color: '(#[0-9A-F]{6})'/g)].map((m) => m[1])

let fails = 0
const rows: string[] = []
const check = (style: string, mode: string, name: string, fg: string, bg: string, min: number) => {
  const r = contrast(flatten(fg, bg), bg)
  if (table) rows.push(`${style.padEnd(9)} ${mode.padEnd(6)} ${name.padEnd(34)} ${fg} / ${bg}  ${r.toFixed(2)}${r < min ? '  < ' + min : ''}`)
  if (r < min) {
    fails++
    console.error(`✗ ${style} ${mode} : ${name} ${fg} sur ${bg} = ${r.toFixed(2)} (< ${min})`)
  }
}
for (const s of STYLES.filter((x) => x.id !== 'actuel')) {
  for (const light of [true, false]) {
    const p = paletteOf(s, light)!
    const mode = light ? 'clair' : 'sombre'
    for (const [n, fg, bg] of textPairs(p)) check(s.id, mode, n, fg, bg, 4.5)
    for (const c of light ? STATUS_LIGHT : STATUS_DARK) check(s.id, mode, `état ${c}`, c, p.panel, 4.5)
    for (const c of light ? arr(op, 'COLORS_LIGHT') : arr(op, 'COLORS_DARK')) check(s.id, mode, `avis ${c}`, c, p.panel, 3)
    for (const c of light ? arr(cmp, 'COLORS_LIGHT') : arr(cmp, 'COLORS_DARK')) check(s.id, mode, `comparaison ${c}`, c, p.panel, 3)
    // Sélection (pastilles, segmentés, barres, bordures) et échelle de la carte (teinte pleine) : éléments graphiques,
    // 3:1 sur leur fond.
    check(s.id, mode, 'sélection (graphique) / carte', p.accent, p.panel, 3)
    check(s.id, mode, 'sélection (graphique) / carte 2', p.accent, p.panel2, 3)
    check(s.id, mode, 'échelle (100 %) / fond de carte', p.scale, p.map?.panel ?? p.panel, 3)
    // Radar : secteurs teintés, contour du joueur en couleur du texte ; points de couleur : 2:1 au moins (repérage, la
    // légende et les libellés portent l'information).
    for (const c of RADAR) check(s.id, mode, `radar ${c}`, c, p.panel, 2)
  }
}
// Rapport des thèmes d'origine (style Actuel, inchangés) : affiché seulement, rien n'est imposé.
if (table) {
  for (const t of THEMES) {
    const c = t.colors
    for (const [n, fg, bg] of [
      ['texte / fond', c.fg, c.bg],
      ['atténué / carte', c.muted, c.panel],
      ['accent (texte) / fond', c.accent, c.bg],
      ['blanc / accent', '#ffffff', c.accent],
    ] as const)
      rows.push(`actuel    ${t.id.padEnd(6)} ${n.padEnd(34)} ${fg} / ${bg}  ${contrast(fg, bg).toFixed(2)} (info)`)
  }
  console.log(rows.join('\n'))
}
assert.equal(fails, 0, `${fails} contraste(s) insuffisant(s)`)
console.log('Styles : OK')
