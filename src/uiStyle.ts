/*
 * Styles d'interface de l'installation (choisis par l'organisation, Réglages → Style de l'installation) : polices, arrondis,
 * traitement des titres, blocs mis en avant (bande des chiffres clés du bilan, carte « Bilan de détection » de l'accueil),
 * en-tête, fond de la carte et teinte de son échelle. Chaque style a une version claire et une version sombre ; chaque
 * utilisateur garde son choix Clair / Sombre / Auto (src/theme.ts).
 *
 * « Actuel » (par défaut, rien de réglé) = l'appli telle qu'elle était : aucune variable ni attribut en plus, les six thèmes
 * de couleurs (src/theme.ts) restent proposés. Les autres styles posent data-style (et data-emph, data-header, data-map,
 * data-upper selon le style) sur <html> ; les règles correspondantes sont dans src/index.css.
 *
 * Fichier pur (ni Dexie ni React ni document) : testé par tools/test-styles.ts (résolution, contrastes WCAG).
 */

import { neonVars, type Neon } from './neon'

export type StyleId = 'actuel' | 'sport' | 'officiel' | 'sombre'

/** Couleurs d'une version (claire ou sombre) d'un style. */
export interface Palette {
  bg: string
  panel: string
  panel2: string
  line: string
  muted: string
  fg: string
  /**
   * Couleur de l'appli (--color-accent) : choix sélectionnés (pastilles, segmentés, cases), bordures au survol, barres
   * de progression, courbes. Sport, Officiel, Salle : couleur d'encre de la marque (bleu nuit, marine, ardoise ; claire
   * en version sombre), pour que la couleur vive ne serve qu'à quelques endroits (voir brand).
   */
  accent: string
  /** Accent écrit en texte (liens, titres de section) : assez contrasté sur le fond et les cartes. */
  accentText: string
  /** Texte posé sur l'accent (pastilles et segmentés sélectionnés). */
  onAccent: string
  /**
   * Couleur vive de la marque (orange, rouge, jaune), réservée : action principale (btn-primary), onglet actif du menu,
   * chiffre clé du bandeau (emph.accent) et échelle de la carte (scale).
   */
  brand: string
  /** Couleur vive écrite en texte (onglet actif du menu) : assez contrastée sur le fond. */
  brandText: string
  /** Texte posé sur la couleur vive. */
  onBrand: string
  /** Boutons principaux (sinon la couleur vive). */
  primary?: string
  onPrimary?: string
  /** Blocs mis en avant : fond, fond des cartes dedans, texte, texte atténué, accent, bordure. */
  emph: { bg: string; bg2: string; fg: string; muted: string; accent: string; onAccent: string; line: string }
  /** En-tête coloré (style Officiel). */
  header?: { bg: string; fg: string; muted: string; line: string; panel: string }
  /** Fond propre à la carte de France (style Sport : bleu nuit). */
  map?: { bg: string; panel: string; panel2: string; fg: string; muted: string; line: string }
  /** Teinte de l'échelle de la carte (du plus faible au plus fort). */
  scale: string
  /** Néon du style (capsule Nextar, Avis vocal, propositions de l'avis vocal : src/neon.ts) ; il remplace celui du thème. */
  neon: Neon
}

export interface UiStyle {
  id: StyleId
  label: string
  /** Une ligne sous le nom (vignette). */
  note: string
  /** Polices : texte, titres, chiffres ; feuille Google Fonts chargée à la demande (hors ligne : polices du système). */
  fonts?: { body: string; heading: string; figures: string; href: string; names: string }
  /** Arrondis (variables de Tailwind : rounded-sm, -md, -lg, -xl, -2xl suivent). */
  radius?: { sm: string; md: string; lg: string; xl: string; '2xl': string }
  /** Titres (h1, h2, h3) en capitales. */
  upperHeadings?: boolean
  light?: Palette
  dark?: Palette
}

const SYS = 'system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif'
const GF = 'https://fonts.googleapis.com/css2?'

export const STYLES: UiStyle[] = [
  { id: 'actuel', label: 'Actuel', note: 'l’appli telle qu’elle est, six thèmes de couleurs' },
  {
    id: 'sport',
    label: 'Sport',
    note: 'titres condensés en capitales, bleu nuit et orange',
    fonts: {
      body: `"Barlow", ${SYS}`,
      heading: `"Barlow Condensed", "Arial Narrow", "Roboto Condensed", ${SYS}`,
      figures: `"Barlow Condensed", "Arial Narrow", ${SYS}`,
      href: `${GF}family=Barlow:wght@400;500;600;700;800&family=Barlow+Condensed:wght@600;700;800&display=swap`,
      names: 'Barlow Condensed · Barlow',
    },
    radius: { sm: '3px', md: '4px', lg: '6px', xl: '6px', '2xl': '8px' },
    upperHeadings: true,
    light: {
      bg: '#f2f4f8',
      panel: '#ffffff',
      panel2: '#e8ecf3',
      line: '#cdd5e1',
      muted: '#4a5a72',
      fg: '#0b1f3a',
      accent: '#0b1f3a',
      accentText: '#1c3d6e',
      onAccent: '#ffffff',
      brand: '#ff5a1f',
      brandText: '#c2410c',
      onBrand: '#0b1f3a',
      emph: { bg: '#0b1f3a', bg2: '#11294a', fg: '#ffffff', muted: '#b4c2d8', accent: '#ff5a1f', onAccent: '#0b1f3a', line: '#2a4670' },
      map: { bg: '#0b1f3a', panel: '#0b1f3a', panel2: '#183559', fg: '#ffffff', muted: '#a9b8cf', line: '#2a4670' },
      scale: '#ff5a1f',
      neon: { a: '#fdba74', b: '#f97316', ink: '#0b1f3a', text: '#c2410c' },
    },
    dark: {
      bg: '#06142a',
      panel: '#0c2242',
      panel2: '#132d55',
      line: '#24426c',
      muted: '#a3b4cd',
      fg: '#eef2f8',
      accent: '#dce5f2',
      accentText: '#bccbe2',
      onAccent: '#0b1f3a',
      brand: '#ff5a1f',
      brandText: '#ff7a45',
      onBrand: '#0b1f3a',
      emph: { bg: '#123462', bg2: '#173c70', fg: '#ffffff', muted: '#c3d0e3', accent: '#ff9466', onAccent: '#0b1f3a', line: '#2f5690' },
      map: { bg: '#0b1f3a', panel: '#0b1f3a', panel2: '#183559', fg: '#ffffff', muted: '#a9b8cf', line: '#2a4670' },
      scale: '#ff5a1f',
      neon: { a: '#ffc078', b: '#ff6a2b', ink: '#0b1f3a', text: '#ffb36b' },
    },
  },
  {
    id: 'officiel',
    label: 'Officiel',
    note: 'institutionnel et sobre, en-tête bleu marine',
    fonts: {
      body: `"Public Sans", ${SYS}`,
      heading: `"Public Sans", ${SYS}`,
      figures: `"Public Sans", ${SYS}`,
      href: `${GF}family=Public+Sans:wght@400;500;600;700;800&display=swap`,
      names: 'Public Sans',
    },
    radius: { sm: '2px', md: '3px', lg: '4px', xl: '4px', '2xl': '4px' },
    light: {
      bg: '#f4f5f8',
      panel: '#ffffff',
      panel2: '#eceff4',
      line: '#d2d8e2',
      muted: '#4f5b70',
      fg: '#12285c',
      accent: '#12285c',
      accentText: '#2a4a94',
      onAccent: '#ffffff',
      brand: '#c8102e',
      brandText: '#c8102e',
      onBrand: '#ffffff',
      emph: { bg: '#12285c', bg2: '#1b3672', fg: '#ffffff', muted: '#c3cde2', accent: '#ff8f9c', onAccent: '#12285c', line: '#2e4a8a' },
      header: { bg: '#12285c', fg: '#ffffff', muted: '#c3cde2', line: '#2e4a8a', panel: '#1b3672' },
      // Carte en marine (pas en rouge : sur une carte de couverture, le rouge se lirait comme une alerte).
      scale: '#12285c',
      neon: { a: '#38bdf8', b: '#818cf8', ink: '#0a1226', text: '#1d4ed8' },
    },
    dark: {
      bg: '#0a1226',
      panel: '#111c37',
      panel2: '#18264a',
      line: '#28385e',
      muted: '#a4b0c8',
      fg: '#eef1f7',
      accent: '#dfe6f5',
      accentText: '#b3c3e6',
      onAccent: '#0a1226',
      brand: '#ff5c70',
      brandText: '#ff7585',
      onBrand: '#0a1226',
      emph: { bg: '#1b3672', bg2: '#244590', fg: '#ffffff', muted: '#c9d3e8', accent: '#ffa5b0', onAccent: '#12285c', line: '#3a5aa6' },
      header: { bg: '#12285c', fg: '#ffffff', muted: '#c3cde2', line: '#2e4a8a', panel: '#1b3672' },
      scale: '#7aa2ff',
      neon: { a: '#7dd3fc', b: '#818cf8', ink: '#0a1226', text: '#7dd3fc' },
    },
  },
  {
    // Identifiant « sombre » gardé (valeur déjà enregistrée dans hb_config) ; affiché « Salle ».
    id: 'sombre',
    label: 'Salle',
    note: 'la salle en soirée : ardoise, jaune des lignes du terrain, chiffres du tableau de score',
    fonts: {
      body: `"Sofia Sans", ${SYS}`,
      heading: `"Sofia Sans", ${SYS}`,
      figures: `"Sofia Sans Condensed", "Arial Narrow", ${SYS}`,
      href: `${GF}family=Sofia+Sans:wght@400;500;600;700;800&family=Sofia+Sans+Condensed:wght@600;700;800&display=swap`,
      names: 'Sofia Sans · Sofia Sans Condensed',
    },
    radius: { sm: '4px', md: '6px', lg: '8px', xl: '8px', '2xl': '10px' },
    light: {
      bg: '#eef1f4',
      panel: '#ffffff',
      panel2: '#e3e8ee',
      line: '#c9d2dc',
      muted: '#4b5a6b',
      fg: '#17212b',
      accent: '#17212b',
      accentText: '#2b4a6a',
      onAccent: '#ffffff',
      brand: '#f5c518',
      brandText: '#7a5a00',
      onBrand: '#17212b',
      emph: { bg: '#17212b', bg2: '#213040', fg: '#ffffff', muted: '#b3c1d0', accent: '#f5c518', onAccent: '#17212b', line: '#34465a' },
      // Jaune foncé : le jaune des lignes ne se voit pas assez sur une carte blanche.
      scale: '#c28800',
      neon: { a: '#fcd34d', b: '#eab308', ink: '#17212b', text: '#7a5a00' },
    },
    dark: {
      bg: '#17212b',
      panel: '#1f2b37',
      panel2: '#283644',
      line: '#374759',
      muted: '#9fb0c3',
      fg: '#edf1f5',
      accent: '#e3e9ef',
      accentText: '#c5d3e2',
      onAccent: '#17212b',
      brand: '#f5c518',
      brandText: '#f5c518',
      onBrand: '#17212b',
      emph: { bg: '#101a24', bg2: '#182634', fg: '#ffffff', muted: '#aebdcc', accent: '#f5c518', onAccent: '#17212b', line: '#2b3d51' },
      scale: '#f5c518',
      neon: { a: '#fff3a3', b: '#f5c518', ink: '#17212b', text: '#fde68a' },
    },
  },
]

export const DEFAULT_STYLE: StyleId = 'actuel'
export const styleById = (id?: string | null): UiStyle => STYLES.find((s) => s.id === id) ?? STYLES[0]

// ---------- Choix de l'organisation (table hb_config, clé « apparence ») ----------

/** Clé de la configuration de l'installation (supabase/044_structure.sql : toute clé en minuscules est acceptée). */
export const APPEARANCE_KEY = 'apparence'
/** Logo : image réduite sur l'appareil, gardée en data URL dans la configuration (≈ 50 Ko au plus). */
export const LOGO_MAX_CHARS = 70_000
export const NAME_MAX = 40

export interface Appearance {
  style: StyleId
  /** Nom de l'organisation (fédération, ligue…), en tête de l'accueil ; sinon l'unité au sommet de la structure. */
  name?: string
  /** Logo de l'organisation, sur l'accueil (data URL PNG, JPEG, WebP ou SVG vérifié : svgLogoSafe). L'appli garde le sien (Nextar). */
  logo?: string
  /** Fond du logo sur l'accueil : transparent (par défaut, le logo tel quel) ou une tuile blanche (logo foncé en mode sombre). */
  logoBg?: 'white'
}

export const DEFAULT_APPEARANCE: Appearance = { style: DEFAULT_STYLE }

const LOGO_RE = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/
const SVG_RE = /^data:image\/svg\+xml;base64,([A-Za-z0-9+/=]+)$/

/**
 * Logo SVG acceptable : un dessin, sans rien qui s'exécute ni ne va chercher ailleurs. Le logo est toujours affiché par
 * <img> (où un SVG ne lance aucun script), mais on refuse en plus à l'entrée : scripts, attributs « on… », liens
 * javascript:, contenus étrangers (foreignObject, iframe…), images ou feuilles externes, entités XML.
 */
export function svgLogoSafe(svg: string): boolean {
  const t = svg.trim()
  if (!/^(<\?xml[^>]*\?>\s*)?(<!--[\s\S]*?-->\s*)*<svg[\s>]/i.test(t) || !/<\/svg>\s*$/i.test(t)) return false
  if (/<!(DOCTYPE|ENTITY)/i.test(t)) return false
  if (/<\s*(script|foreignObject|iframe|object|embed|audio|video|handler|listener)\b/i.test(t)) return false
  if (/\son[a-z]+\s*=/i.test(t)) return false
  if (/javascript\s*:|vbscript\s*:/i.test(t)) return false
  // Références : seulement internes (#id) ou images embarquées (data:image/…), jamais une adresse.
  for (const m of t.matchAll(/(?:xlink:)?href\s*=\s*["']([^"']*)["']/gi)) if (!/^(#|data:image\/(png|jpeg|webp|gif);)/i.test(m[1].trim())) return false
  if (/url\(\s*["']?\s*(?!#)/i.test(t)) return false
  if (/@import/i.test(t)) return false
  return true
}

const fromBase64 = (b: string) => new TextDecoder().decode(Uint8Array.from(atob(b), (c) => c.charCodeAt(0)))
/** Texte SVG → data URL (base64, UTF-8). */
export const svgDataUrl = (svg: string) => {
  const bytes = new TextEncoder().encode(svg)
  let bin = ''
  for (const x of bytes) bin += String.fromCharCode(x)
  return `data:image/svg+xml;base64,${btoa(bin)}`
}
/** Logo acceptable (organisation, appli : src/appBrandCore.ts) : data URL PNG, JPEG, WebP, ou SVG sûr ; taille limitée. */
export function logoOk(v: string): boolean {
  if (v.length > LOGO_MAX_CHARS) return false
  if (LOGO_RE.test(v)) return true
  const m = SVG_RE.exec(v)
  if (!m) return false
  try {
    return svgLogoSafe(fromBase64(m[1]))
  } catch {
    return false
  }
}

/** Valeur stockée relue : style inconnu → Actuel ; nom coupé ; logo refusé s'il n'est pas une petite image. */
export function cleanAppearance(v: unknown): Appearance {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return { ...DEFAULT_APPEARANCE }
  const o = v as Record<string, unknown>
  const style = STYLES.some((s) => s.id === o.style) ? (o.style as StyleId) : DEFAULT_STYLE
  const name = typeof o.name === 'string' && o.name.trim() ? o.name.trim().slice(0, NAME_MAX) : undefined
  const logo = typeof o.logo === 'string' && logoOk(o.logo) ? o.logo : undefined
  const logoBg = logo && o.logoBg === 'white' ? ('white' as const) : undefined
  return { style, ...(name ? { name } : {}), ...(logo ? { logo } : {}), ...(logoBg ? { logoBg } : {}) }
}

/** Lignes de hb_config (non supprimées) → apparence de l'installation. */
export function resolveAppearance(rows: readonly { id: string; key?: string; value: unknown; deleted?: boolean }[] = []): Appearance {
  const row = rows.find((r) => !r.deleted && (r.key ?? r.id) === APPEARANCE_KEY)
  return row ? cleanAppearance(row.value) : { ...DEFAULT_APPEARANCE }
}

// ---------- Ce qui est posé sur la page ----------

/** Rendu d'un style dans une version : variables CSS et attributs de <html>. Actuel : rien (les thèmes de couleurs s'en chargent). */
export interface StyleLook {
  vars: Record<string, string>
  attrs: Record<string, boolean>
  /** Feuille de polices à charger (Google Fonts). */
  fontHref?: string
  /** Couleur de la barre du téléphone. */
  themeColor?: string
}

/** Attributs posés par les styles (enlevés quand on revient à Actuel). */
export const STYLE_ATTRS = ['data-style', 'data-emph', 'data-header', 'data-map', 'data-upper'] as const

/** Version d'un style : claire ou sombre ; Actuel n'a pas de palette propre (undefined). */
export const paletteOf = (s: UiStyle, light: boolean): Palette | undefined => (light ? s.light : s.dark)

export function styleLook(s: UiStyle, light: boolean): StyleLook {
  const p = paletteOf(s, light)
  if (!p) return { vars: {}, attrs: {} }
  const vars: Record<string, string> = {
    '--color-bg': p.bg,
    '--color-panel': p.panel,
    '--color-panel-2': p.panel2,
    '--color-line': p.line,
    '--color-muted': p.muted,
    '--color-fg': p.fg,
    '--color-accent': p.accent,
    '--color-accent-soft': p.accent + '22',
    '--color-accent-text': p.accentText,
    '--color-on-accent': p.onAccent,
    '--color-brand': p.brand,
    '--color-brand-text': p.brandText,
    '--color-primary': p.primary ?? p.brand,
    '--color-on-primary': p.onPrimary ?? p.onBrand,
    '--color-scale': p.scale,
    '--emph-bg': p.emph.bg,
    '--emph-bg2': p.emph.bg2,
    '--emph-fg': p.emph.fg,
    '--emph-muted': p.emph.muted,
    '--emph-accent': p.emph.accent,
    '--emph-on-accent': p.emph.onAccent,
    '--emph-line': p.emph.line,
    ...neonVars(p.neon),
  }
  if (p.header) Object.assign(vars, { '--header-bg': p.header.bg, '--header-fg': p.header.fg, '--header-muted': p.header.muted, '--header-line': p.header.line, '--header-panel': p.header.panel })
  if (p.map)
    Object.assign(vars, {
      '--map-bg': p.map.bg,
      '--map-panel': p.map.panel,
      '--map-panel-2': p.map.panel2,
      '--map-fg': p.map.fg,
      '--map-muted': p.map.muted,
      '--map-line': p.map.line,
    })
  if (s.fonts) Object.assign(vars, { '--font-body': s.fonts.body, '--font-heading': s.fonts.heading, '--font-figures': s.fonts.figures })
  if (s.radius) for (const [k, v] of Object.entries(s.radius)) vars[`--radius-${k}`] = v
  return {
    vars,
    attrs: { 'data-style': true, 'data-emph': true, 'data-header': !!p.header, 'data-map': !!p.map, 'data-upper': !!s.upperHeadings },
    fontHref: s.fonts?.href,
    themeColor: p.header?.bg ?? p.bg,
  }
}

// ---------- Contraste (WCAG 2.x) ----------

/** Couleur #rrggbb ou #rrggbbaa posée sur un fond opaque → #rrggbb. */
export function flatten(c: string, under: string): string {
  const h = c.replace('#', '')
  if (h.length !== 8) return '#' + h.slice(0, 6)
  const a = parseInt(h.slice(6, 8), 16) / 255
  const u = under.replace('#', '')
  const mix = (i: number) => Math.round(parseInt(h.slice(i, i + 2), 16) * a + parseInt(u.slice(i, i + 2), 16) * (1 - a))
  return '#' + [0, 2, 4].map((i) => mix(i).toString(16).padStart(2, '0')).join('')
}

const channel = (v: number) => {
  const s = v / 255
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
}
export function luminance(hex: string): number {
  const h = hex.replace('#', '').slice(0, 6)
  const [r, g, b] = [0, 2, 4].map((i) => channel(parseInt(h.slice(i, i + 2), 16)))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
/** Rapport de contraste (1 à 21). */
export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m)
  return (x + 0.05) / (y + 0.05)
}

/** Paires texte / fond à vérifier pour une palette (nom, texte, fond). Toutes du texte : 4,5:1 au moins (WCAG AA). */
export function textPairs(p: Palette): [string, string, string][] {
  const pairs: [string, string, string][] = [
    ['texte / fond', p.fg, p.bg],
    ['texte / carte', p.fg, p.panel],
    ['texte / carte 2', p.fg, p.panel2],
    ['atténué / fond', p.muted, p.bg],
    ['atténué / carte', p.muted, p.panel],
    ['atténué / carte 2', p.muted, p.panel2],
    ['accent (texte) / fond', p.accentText, p.bg],
    ['accent (texte) / carte', p.accentText, p.panel],
    ['sélection : texte / fond', p.onAccent, p.accent],
    ['marque (texte, onglet actif) / fond', p.brandText, p.bg],
    ['marque (texte, onglet actif) / carte', p.brandText, p.panel],
    ['bouton principal', p.onPrimary ?? p.onBrand, p.primary ?? p.brand],
    ['mis en avant : texte', p.emph.fg, p.emph.bg],
    ['mis en avant : atténué', p.emph.muted, p.emph.bg],
    ['mis en avant : texte / carte', p.emph.fg, p.emph.bg2],
    ['mis en avant : atténué / carte', p.emph.muted, p.emph.bg2],
    ['mis en avant : accent', p.emph.accent, p.emph.bg],
    ['mis en avant : accent / carte', p.emph.accent, p.emph.bg2],
    ['mis en avant : sur accent', p.emph.onAccent, p.emph.accent],
  ]
  if (p.header) pairs.push(['en-tête : texte', p.header.fg, p.header.bg], ['en-tête : atténué', p.header.muted, p.header.bg])
  if (p.map) pairs.push(['carte : texte', p.map.fg, p.map.panel], ['carte : atténué', p.map.muted, p.map.panel])
  return pairs.map(([n, fg, bg]) => [n, flatten(fg, bg), bg])
}
