import { useEffect, useState } from 'react'
import { DEFAULT_SCALE, scaleFloor } from './mapScale'
import { BRAND_NEON, neonVars, type Neon } from './neon'
import { DEFAULT_APPEARANCE, cleanAppearance, paletteOf, STYLE_ATTRS, styleById, styleLook, type Appearance, type StyleId } from './uiStyle'

/*
 * Thèmes de couleurs et style de l'installation.
 *
 * Style (src/uiStyle.ts) : choisi par l'organisation (table hb_config, clé « apparence », lue par src/installation.ts) ;
 * gardé aussi sur l'appareil pour être posé avant le premier affichage. « Actuel » (par défaut) : l'appli d'origine, avec
 * ses six thèmes de couleurs au choix de chacun. Autres styles : chacun choisit Clair, Sombre ou Auto (les thèmes clairs
 * donnent la version claire du style, les sombres la version sombre).
 *
 * Thème : couleurs de base de l'appli (fond, cartes, bordures, textes, accent), posées en variables CSS sur <html> ; les
 * thèmes clairs ajoutent data-light (couleurs d'état foncées, src/index.css). « Auto » suit le réglage clair / sombre du
 * téléphone. Choix gardé sur l'appareil.
 */

export interface Theme {
  id: string
  label: string
  light: boolean
  /** Précision sous le nom (« d’origine », « noir pur »…). */
  note?: string
  colors: { bg: string; panel: string; panel2: string; line: string; muted: string; fg: string; accent: string }
  /** Néon accordé au thème (capsule Nextar, Avis vocal, propositions : src/neon.ts). Thèmes clairs : plus soutenu. */
  neon: Neon
}

export const THEMES: Theme[] = [
  { id: 'nuit', label: 'Nuit', note: 'd’origine', light: false, colors: { bg: '#1e1e2e', panel: '#26263a', panel2: '#2e2e46', line: '#3a3a56', muted: '#9a9ab8', fg: '#ececf4', accent: '#f43f5e' }, neon: BRAND_NEON },
  { id: 'ocean', label: 'Océan', light: false, colors: { bg: '#0b1622', panel: '#112233', panel2: '#172c42', line: '#23405c', muted: '#8aa8c4', fg: '#e3eef8', accent: '#0891b2' }, neon: { a: '#67e8f9', b: '#2dd4bf', ink: '#04202e', text: '#67e8f9' } },
  { id: 'charbon', label: 'Charbon', note: 'noir pur', light: false, colors: { bg: '#000000', panel: '#111111', panel2: '#1a1a1a', line: '#2a2a2a', muted: '#9a9a9a', fg: '#f2f2f2', accent: '#ef4444' }, neon: { a: '#e6fffa', b: '#67e8f9', ink: '#031014', text: '#a5f3fc' } },
  { id: 'clair', label: 'Clair', light: true, colors: { bg: '#f4f5f9', panel: '#ffffff', panel2: '#eceef5', line: '#d9dce8', muted: '#636a80', fg: '#1e1e2e', accent: '#e11d48' }, neon: { a: '#34d399', b: '#06b6d4', ink: '#0a182d', text: '#0f766e' } },
  { id: 'sable', label: 'Sable', light: true, colors: { bg: '#f6f1e7', panel: '#fffdf8', panel2: '#efe7d6', line: '#ded2bb', muted: '#76695a', fg: '#2b2419', accent: '#c2410c' }, neon: { a: '#6ee7b7', b: '#10b981', ink: '#0a182d', text: '#047857' } },
  { id: 'ciel', label: 'Ciel', light: true, colors: { bg: '#edf4fb', panel: '#ffffff', panel2: '#e1ecf8', line: '#c7daef', muted: '#56708e', fg: '#10233a', accent: '#2563eb' }, neon: { a: '#38bdf8', b: '#818cf8', ink: '#0a182d', text: '#1d4ed8' } },
]

export const AUTO = 'auto'
/** Choix « Clair » / « Sombre » d'un style autre qu'Actuel : gardés comme les thèmes Clair et Nuit (rien ne se perd). */
export const LIGHT_CHOICE = 'clair'
export const DARK_CHOICE = 'nuit'
const KEY = 'handbase.theme'
/** Apparence de l'installation, recopiée sur l'appareil (posée avant le premier affichage, sans attendre la base). */
const STYLE_KEY = 'handbase.apparence'
const dark = () => THEMES[0]
const light = () => THEMES.find((t) => t.id === 'clair')!

export function readThemeChoice(): string {
  try {
    return localStorage.getItem(KEY) ?? AUTO
  } catch {
    return AUTO
  }
}

const media = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: light)') : null
/** Thème réellement affiché pour un choix (« auto » : selon le téléphone). */
export const resolveTheme = (choice: string, systemLight = !!media?.matches) =>
  choice === AUTO ? (systemLight ? light() : dark()) : (THEMES.find((t) => t.id === choice) ?? dark())

// ---------- Apparence de l'installation ----------

function readCachedAppearance(): Appearance {
  try {
    const s = localStorage.getItem(STYLE_KEY)
    return s ? cleanAppearance(JSON.parse(s)) : { ...DEFAULT_APPEARANCE }
  } catch {
    return { ...DEFAULT_APPEARANCE }
  }
}

let org: Appearance = readCachedAppearance()
/** Aperçu (Réglages, administrateurs) : montré sur cet appareil seulement, tant qu'il n'est pas appliqué. */
let preview: Appearance | null = null

/** Style choisi par la personne sur cet appareil (null : celui de l'installation). */
const PERSONAL_KEY = 'handbase.style'
export function readPersonalStyle(): StyleId | null {
  try {
    const v = localStorage.getItem(PERSONAL_KEY)
    return v && styleById(v).id === v ? (v as StyleId) : null
  } catch {
    return null
  }
}
export function setPersonalStyle(id: StyleId | null) {
  try {
    if (id) localStorage.setItem(PERSONAL_KEY, id)
    else localStorage.removeItem(PERSONAL_KEY)
  } catch {
    /* stockage indisponible */
  }
  applyTheme()
}

/** Apparence affichée : l'aperçu en cours, sinon celle de l'installation avec le style choisi par la personne. */
export const currentAppearance = (): Appearance => {
  if (preview) return preview
  const mine = readPersonalStyle()
  return mine ? { ...org, style: mine } : org
}
/** Apparence enregistrée pour l'installation (sans l'aperçu). */
export const installationAppearance = (): Appearance => org

/** Nouvelle apparence lue dans la configuration (src/installation.ts). */
export function setInstallationAppearance(a: Appearance) {
  if (JSON.stringify(a) === JSON.stringify(org)) return
  org = a
  try {
    if (a.style === DEFAULT_APPEARANCE.style && !a.name && !a.logo) localStorage.removeItem(STYLE_KEY)
    else localStorage.setItem(STYLE_KEY, JSON.stringify(a))
  } catch {
    /* stockage indisponible */
  }
  applyTheme()
}

/** Aperçu d'une apparence sur cet appareil (null : fin de l'aperçu). */
export function previewAppearance(a: Appearance | null) {
  if (JSON.stringify(a) === JSON.stringify(preview)) return
  preview = a
  applyTheme()
}

/**
 * Ce qui est posé sur la page pour un style et un choix de thème. Actuel : exactement les variables d'avant (couleurs du
 * thème), aucun attribut de style. Autre style : sa version claire ou sombre selon le thème choisi.
 */
export function computeLook(style: StyleId, choice: string, systemLight = !!media?.matches) {
  const t = resolveTheme(choice, systemLight)
  const s = styleById(style)
  const look = styleLook(s, t.light)
  const c = t.colors
  const vars: Record<string, string> =
    s.id === 'actuel'
      ? {
          '--color-bg': c.bg,
          '--color-panel': c.panel,
          '--color-panel-2': c.panel2,
          '--color-line': c.line,
          '--color-muted': c.muted,
          '--color-fg': c.fg,
          '--color-accent': c.accent,
          '--color-accent-soft': c.accent + '22',
          ...neonVars(t.neon),
        }
      : look.vars
  // Départ de l'échelle de la carte du bilan (--scale-floor, src/mapScale.ts) : sur le fond de la carte du style.
  const p = paletteOf(s, t.light)
  const m = p?.map ?? p
  const scaleFloorPct = p && m ? scaleFloor(p.scale, m.panel, m.panel2) : scaleFloor(DEFAULT_SCALE, c.panel, c.panel2)
  return { theme: t, light: t.light, vars, attrs: look.attrs, fontHref: look.fontHref, themeColor: s.id === 'actuel' ? c.bg : (look.themeColor ?? c.bg), scaleFloor: scaleFloorPct }
}

/** Feuilles de polices déjà demandées (une seule fois chacune ; hors ligne, les polices du système prennent le relais). */
function loadFonts(href?: string) {
  if (!href || typeof document === 'undefined') return
  if (document.querySelector(`link[data-style-fonts][href="${href}"]`)) return
  const l = document.createElement('link')
  l.rel = 'stylesheet'
  l.href = href
  l.dataset.styleFonts = ''
  document.head.appendChild(l)
}

let version = 0
const listeners = new Set<() => void>()
/** Variables posées par le dernier passage (celles d'un style quitté sont retirées). */
let applied = new Set<string>()

/** Pose les couleurs du thème et le style sur la page (appelé au démarrage, avant le premier affichage). */
export function applyTheme(choice = readThemeChoice()) {
  const a = currentAppearance()
  const look = computeLook(a.style, choice)
  const root = document.documentElement
  for (const k of applied) if (!(k in look.vars)) root.style.removeProperty(k)
  for (const [k, v] of Object.entries(look.vars)) root.style.setProperty(k, v)
  applied = new Set(Object.keys(look.vars))
  for (const at of STYLE_ATTRS) {
    if (at === 'data-style') {
      if (look.attrs[at]) root.setAttribute(at, a.style)
      else root.removeAttribute(at)
    } else root.toggleAttribute(at, !!look.attrs[at])
  }
  loadFonts(look.fontHref)
  root.toggleAttribute('data-light', look.light)
  root.style.setProperty('--scale-floor', `${look.scaleFloor}%`)
  root.style.colorScheme = look.light ? 'light' : 'dark'
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', look.themeColor)
  version++
  listeners.forEach((l) => l())
}

export function setThemeChoice(choice: string) {
  try {
    localStorage.setItem(KEY, choice)
  } catch {
    /* stockage indisponible */
  }
  applyTheme(choice)
}

// « Auto » : suivre le téléphone quand il passe du clair au sombre.
media?.addEventListener('change', () => readThemeChoice() === AUTO && applyTheme())

/** Change à chaque changement de thème ou de style (pour redessiner les graphiques, l'en-tête). */
export function useThemeVersion() {
  const [v, setV] = useState(version)
  useEffect(() => {
    const l = () => setV(version)
    listeners.add(l)
    return () => {
      listeners.delete(l)
    }
  }, [])
  return v
}

/** Valeur d'une couleur du thème, pour les graphiques qui ne lisent pas les variables CSS. */
export const themeColor = (name: 'bg' | 'panel' | 'panel-2' | 'line' | 'muted' | 'fg' | 'accent') =>
  getComputedStyle(document.documentElement).getPropertyValue(`--color-${name}`).trim()
