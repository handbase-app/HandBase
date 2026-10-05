import { useEffect, useState } from 'react'

/*
 * Thèmes de couleurs. Chaque thème donne les couleurs de base de l'appli (fond, cartes, bordures, textes,
 * accent), posées en variables CSS sur <html> ; les thèmes clairs ajoutent data-light (couleurs d'état
 * foncées, src/index.css). « Auto » suit le réglage clair / sombre du téléphone. Choix gardé sur l'appareil.
 */

export interface Theme {
  id: string
  label: string
  light: boolean
  /** Précision sous le nom (« d’origine », « noir pur »…). */
  note?: string
  colors: { bg: string; panel: string; panel2: string; line: string; muted: string; fg: string; accent: string }
}

export const THEMES: Theme[] = [
  { id: 'nuit', label: 'Nuit', note: 'd’origine', light: false, colors: { bg: '#1e1e2e', panel: '#26263a', panel2: '#2e2e46', line: '#3a3a56', muted: '#9a9ab8', fg: '#ececf4', accent: '#f43f5e' } },
  { id: 'ardoise', label: 'Ardoise', light: false, colors: { bg: '#0f172a', panel: '#1e293b', panel2: '#273449', line: '#334155', muted: '#94a3b8', fg: '#e2e8f0', accent: '#0284c7' } },
  { id: 'foret', label: 'Forêt', light: false, colors: { bg: '#0f1a14', panel: '#16251c', panel2: '#1d3025', line: '#2a4535', muted: '#8fb3a0', fg: '#e6f2ea', accent: '#16a34a' } },
  { id: 'ocean', label: 'Océan', light: false, colors: { bg: '#0b1622', panel: '#112233', panel2: '#172c42', line: '#23405c', muted: '#8aa8c4', fg: '#e3eef8', accent: '#0891b2' } },
  { id: 'charbon', label: 'Charbon', note: 'noir pur', light: false, colors: { bg: '#000000', panel: '#111111', panel2: '#1a1a1a', line: '#2a2a2a', muted: '#9a9a9a', fg: '#f2f2f2', accent: '#ef4444' } },
  { id: 'aubergine', label: 'Aubergine', light: false, colors: { bg: '#1a1023', panel: '#241732', panel2: '#2d1d3f', line: '#43305a', muted: '#a896c2', fg: '#efe8f7', accent: '#9333ea' } },
  { id: 'clair', label: 'Clair', light: true, colors: { bg: '#f4f5f9', panel: '#ffffff', panel2: '#eceef5', line: '#d9dce8', muted: '#636a80', fg: '#1e1e2e', accent: '#e11d48' } },
  { id: 'sable', label: 'Sable', light: true, colors: { bg: '#f6f1e7', panel: '#fffdf8', panel2: '#efe7d6', line: '#ded2bb', muted: '#76695a', fg: '#2b2419', accent: '#c2410c' } },
  { id: 'ciel', label: 'Ciel', light: true, colors: { bg: '#edf4fb', panel: '#ffffff', panel2: '#e1ecf8', line: '#c7daef', muted: '#56708e', fg: '#10233a', accent: '#2563eb' } },
  { id: 'menthe', label: 'Menthe', light: true, colors: { bg: '#ecf7f2', panel: '#ffffff', panel2: '#ddf1e8', line: '#bfe0d1', muted: '#52766a', fg: '#12291f', accent: '#0d9488' } },
]

export const AUTO = 'auto'
const KEY = 'handbase.theme'
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
export const resolveTheme = (choice: string) => (choice === AUTO ? (media?.matches ? light() : dark()) : (THEMES.find((t) => t.id === choice) ?? dark()))

let version = 0
const listeners = new Set<() => void>()

/** Pose les couleurs du thème sur la page (appelé au démarrage, avant le premier affichage). */
export function applyTheme(choice = readThemeChoice()) {
  const t = resolveTheme(choice)
  const root = document.documentElement
  const c = t.colors
  const vars: Record<string, string> = {
    '--color-bg': c.bg,
    '--color-panel': c.panel,
    '--color-panel-2': c.panel2,
    '--color-line': c.line,
    '--color-muted': c.muted,
    '--color-fg': c.fg,
    '--color-accent': c.accent,
    '--color-accent-soft': c.accent + '22',
  }
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v)
  root.toggleAttribute('data-light', t.light)
  root.style.colorScheme = t.light ? 'light' : 'dark'
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', c.bg)
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

/** Change à chaque changement de thème (pour redessiner les graphiques). */
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
