/**
 * Départ de l'échelle de couleur de la carte du bilan (src/pages/Coverage.tsx, fillAt) : la zone la moins vue est un
 * mélange de la teinte de l'échelle (--color-scale) et du fond des zones (--color-panel), à `floor` % de teinte. Sur
 * fond sombre, 8 % de teinte se confondaient avec « aucun joueur » (--color-panel-2) : on monte le départ jusqu'à un
 * écart visible (ΔE CIE76, MIN_DE_*). Thèmes clairs d'Actuel et Salle clair : 8 %, rien ne change ; Officiel clair
 * (échelle marine, presque le gris « aucun joueur » à 8 %) et cartes sur fond sombre (Sport) : départ relevé.
 */
type Rgb = readonly [number, number, number]

/** Teinte de l'échelle du style Actuel (même valeur que --color-scale dans src/index.css). */
export const DEFAULT_SCALE = '#14b8a6'
/** Départ habituel (thèmes clairs). */
export const BASE_FLOOR = 8
/**
 * Écart minimal entre « aucun joueur » et la zone la moins vue (ΔE CIE76) : 6 sur fond clair (l'écart d'origine des
 * thèmes clairs, gardé tel quel), 15 sur fond sombre (où l'œil distingue moins bien deux couleurs foncées proches).
 */
export const MIN_DE_LIGHT = 6
export const MIN_DE_DARK = 15
/** Sur fond sombre, la zone la moins vue est au moins aussi claire que « aucun joueur » plus cet écart de luminosité (L*). */
export const MIN_DL_DARK = 4

const hex = (h: string): Rgb => {
  const s = h.replace('#', '')
  const f = s.length === 3 ? [...s].map((c) => c + c).join('') : s.slice(0, 6)
  return [0, 2, 4].map((i) => parseInt(f.slice(i, i + 2), 16) / 255) as unknown as Rgb
}

/** Mélange sRGB comme color-mix(in srgb, a p %, b). */
export const mix = (a: Rgb, p: number, b: Rgb): Rgb => [0, 1, 2].map((i) => a[i] * (p / 100) + b[i] * (1 - p / 100)) as unknown as Rgb

function lab([r, g, b]: Rgb): Rgb {
  const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  const [R, G, B] = [lin(r), lin(g), lin(b)]
  const x = (0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047
  const y = 0.2126 * R + 0.7152 * G + 0.0722 * B
  const z = (0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116)
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))]
}

/** Écart de couleur CIE76 entre deux couleurs « #rrggbb » ou composantes 0–1. */
export function deltaE(a: Rgb | string, b: Rgb | string): number {
  const [l1, a1, b1] = lab(typeof a === 'string' ? hex(a) : a)
  const [l2, a2, b2] = lab(typeof b === 'string' ? hex(b) : b)
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2)
}

/** Part de teinte (en %) de la zone la moins vue : 8 % au moins, plus si c'est nécessaire pour se détacher de « aucun joueur ». */
export function scaleFloor(scale: string, panel: string, noPlayer: string): number {
  const s = hex(scale)
  const p = hex(panel)
  const n = hex(noPlayer)
  const dark = lab(p)[0] < 50
  const ok = (c: Rgb) =>
    // Sombre : nettement différente ET plus claire que « aucun joueur » (plus foncée, elle semblait « pire que vide »).
    dark ? deltaE(c, n) >= MIN_DE_DARK && lab(c)[0] - lab(n)[0] >= MIN_DL_DARK : deltaE(c, n) >= MIN_DE_LIGHT
  for (let f = BASE_FLOOR; f <= 60; f++) if (ok(mix(s, f, p))) return f
  return 60
}
