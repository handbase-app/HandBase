#!/usr/bin/env python3
"""
Icônes de l'appli par sport (« proposition A », validée le 25/10/2026) : le logo Nextar (le mot, dans son carré bleu
nuit) un peu remonté, et le nom du sport écrit dessous en vert menthe (#89F7B3 → #61D0D1) : « HANDBALL », « VOLLEY ».

Le logo n'est jamais redessiné : le mot et son carré sont repris tels quels de public/brand/nextar.svg. Le nom du sport
est vectorisé (lettres changées en tracés, pas de <text>) pour s'afficher pareil sur tous les appareils, avec la police
Noto Sans Bold (libre, OFL) de la machine.

Produit, pour chaque sport :
  - icon.svg              icône du manifeste (« any »), carré arrondi, coins transparents ; aussi le logo de l'écran
                          de connexion (src/appBrandCore.ts) ;
  - icon-192.png, icon-512.png   la même en PNG (Chrome Android exige 192 et 512) ;
  - icon-maskable-512.png plein cadre, tout le dessin dans la zone sûre (cercle central de 80 %) ;
  - apple-touch-icon.png  180 px, opaque (iOS arrondit lui-même les coins).
Handball (sport par défaut) : dans public/ ; volley : dans public-sport/volley/, qui remplace les fichiers de même nom à
la construction (VITE_SPORT=volley, plugin « sport-public » de vite.config.ts).
Et src/sportWordmark.ts : le nom de chaque sport en tracés, aux coordonnées du mot « Nextar », pour l'écran d'ouverture
(index.html, %SPORT_WORD…%).

Les favicons (16 et 32 px, onglet) restent le pictogramme seul (X + étoile), sans texte : non touchés ici.

Prérequis : Python 3, fontTools (pip install fonttools, au besoin dans un venv), Pillow, et Inkscape (rendu PNG ; lu et
écrit par des tubes, ce qui marche aussi avec l'Inkscape « snap »).

    python3 tools/icones-sport.py                 # depuis la racine du dépôt
    python3 tools/icones-sport.py --font /chemin/Police-Bold.ttf
"""
import argparse
import io
import re
import subprocess
from pathlib import Path

from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.svgLib.path import parse_path
from fontTools.ttLib import TTFont
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / 'public/brand/nextar.svg'
DEFAULT_FONT = '/usr/share/fonts/truetype/noto/NotoSans-Bold.ttf'

# Maquette validée (512 × 512) : mot « Nextar » remonté (y 178,5 → 150), nom du sport centré dessous.
WORD_Y = 150
SPORTS = {
    'handball': {'text': 'HANDBALL', 'size': 54, 'spacing': 9, 'baseline': 384, 'out': ROOT / 'public'},
    'volley': {'text': 'VOLLEY', 'size': 64, 'spacing': 14, 'baseline': 388, 'out': ROOT / 'public-sport/volley'},
}
MINT = '<linearGradient id="mv" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#89F7B3"/><stop offset="1" stop-color="#61D0D1"/></linearGradient>'
BG = '<linearGradient id="bgv" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#0A182D"/><stop offset="1" stop-color="#1A3C46"/></linearGradient>'
SAFE_RADIUS = 0.4 * 512  # zone sûre des icônes « maskable » : cercle de 80 % du côté
SAFE_MARGIN = 0.94  # un peu de marge en plus dans ce cercle


def fmt(v: float) -> str:
    s = f'{v:.2f}'.rstrip('0').rstrip('.')
    return '0' if s in ('-0', '') else s


def wordmark_svg(src: str):
    """Le <svg> imbriqué du mot « Nextar » (dans son carré), ses attributs de placement et ses tracés."""
    m = re.search(r'<svg x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)" viewBox="([\d. ]+)">.*?</svg>', src, re.S)
    if not m:
        raise SystemExit(f'{SOURCE} : mot « Nextar » introuvable')
    x, y, w, h = (float(v) for v in m.group(1, 2, 3, 4))
    vb = [float(v) for v in m.group(5).split()]
    return m.group(0), x, y, w, h, vb


def wordmark_bounds(inner: str):
    """Boîte de l'encre du mot (unités du viewBox du mot), traits de contour compris (étoile : 4,3)."""
    pen = BoundsPen(None)
    for d in re.findall(r'<path d="([^"]+)"', inner):
        parse_path(d, pen)
    x0, y0, x1, y1 = pen.bounds
    half = 4.3 / 2
    return x0 - half, y0 - half, x1 + half, y1 + half


def outline(font: TTFont, text: str, size: float, spacing: float, cx: float, baseline: float):
    """Texte → tracé SVG centré sur cx (encre, sans l'espacement après la dernière lettre), ligne de base à `baseline`."""
    gs = font.getGlyphSet()
    cmap = font.getBestCmap()
    k = size / font['head'].unitsPerEm
    names = [cmap[ord(c)] for c in text]
    # Avances (espacement entre les lettres, comme letter-spacing), puis encre réelle pour centrer.
    xs, x = [], 0.0
    for i, n in enumerate(names):
        xs.append(x)
        x += gs[n].width * k + (spacing if i < len(names) - 1 else 0)
    bp = BoundsPen(gs)
    for n, gx in zip(names, xs):
        gs[n].draw(TransformPen(bp, (k, 0, 0, -k, gx, 0)))
    ix0, iy0, ix1, iy1 = bp.bounds
    dx = cx - (ix0 + ix1) / 2
    sp = SVGPathPen(gs, ntos=fmt)
    for n, gx in zip(names, xs):
        gs[n].draw(TransformPen(sp, (k, 0, 0, -k, gx + dx, baseline)))
    return sp.getCommands(), (ix0 + dx, iy0 + baseline, ix1 + dx, iy1 + baseline)


def icon_svg(inner_moved: str, word_d: str, rounded: bool, transform: str = '') -> str:
    rx = ' rx="72"' if rounded else ''
    rect = f'<rect width="512" height="512"{rx} fill="url(#bgv)"/>'
    body = f'{inner_moved}<path d="{word_d}" fill="url(#mv)"/>'
    if transform:
        body = f'<g transform="{transform}">{body}</g>'
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="512" height="512" '
        f'viewBox="0 0 512 512"><defs>{BG}{MINT}</defs>{rect}{body}</svg>\n'
    )


def render(svg: str, size: int, opaque: bool) -> bytes:
    png = subprocess.run(
        ['inkscape', '--pipe', '--export-type=png', f'--export-width={size}', f'--export-height={size}', '--export-filename=-'],
        input=svg.encode(),
        capture_output=True,
        check=True,
    ).stdout
    im = Image.open(io.BytesIO(png)).convert('RGBA')
    if im.size != (size, size):
        raise SystemExit(f'rendu {im.size} au lieu de {size}')
    if opaque:
        im = im.convert('RGB')
    out = io.BytesIO()
    im.save(out, 'PNG', optimize=True)
    return out.getvalue()


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--font', default=DEFAULT_FONT, help=f'police grasse (défaut : {DEFAULT_FONT})')
    args = ap.parse_args()

    font = TTFont(args.font)
    src = SOURCE.read_text()
    inner, wx, wy, ww, wh, vb = wordmark_svg(src)
    inner_moved = re.sub(r'^(<svg x="[\d.]+" )y="[\d.]+"', rf'\g<1>y="{WORD_Y}"', inner, count=1)
    # Placement du mot (preserveAspectRatio par défaut : xMidYMid meet) : unités du mot → unités de l'icône.
    s = min(ww / vb[2], wh / vb[3])
    ox = wx + (ww - vb[2] * s) / 2 - vb[0] * s
    oy = WORD_Y + (wh - vb[3] * s) / 2 - vb[1] * s
    bx0, by0, bx1, by1 = wordmark_bounds(inner)
    ink = (ox + bx0 * s, oy + by0 * s, ox + bx1 * s, oy + by1 * s)

    ts = [
        '// Généré par tools/icones-sport.py (ne pas modifier à la main) : nom de chaque sport en tracés (Noto Sans Bold),',
        "// aux coordonnées du mot « Nextar » (viewBox de index.html et de NextarWordmark : « 50 60 870 215 »), placé comme",
        "// sur l'icône de l'appli. Sert à l'écran d'ouverture (index.html, vite.config.ts).",
        '',
        'export interface SportWord {',
        '  /** Texte écrit (capitales). */',
        '  text: string',
        '  /** Tracé, unités du mot « Nextar ». */',
        '  d: string',
        '  /** Bas de l\'encre du tracé (unités du mot), pour cadrer le viewBox. */',
        '  bottom: number',
        '}',
        '',
        'export const SPORT_WORDS: Record<string, SportWord> = {',
    ]
    for sport, c in SPORTS.items():
        d, (tx0, ty0, tx1, ty1) = outline(font, c['text'], c['size'], c['spacing'], 256, c['baseline'])
        out: Path = c['out']
        out.mkdir(parents=True, exist_ok=True)

        # Icône (« any ») et PNG 192 / 512 : carré arrondi, coins transparents.
        icon = icon_svg(inner_moved, d, rounded=True)
        (out / 'icon.svg').write_text(icon)
        (out / 'icon-192.png').write_bytes(render(icon, 192, opaque=False))
        (out / 'icon-512.png').write_bytes(render(icon, 512, opaque=False))
        # iOS : opaque, plein cadre (il arrondit lui-même).
        (out / 'apple-touch-icon.png').write_bytes(render(icon_svg(inner_moved, d, rounded=False), 180, opaque=True))
        # Maskable : plein cadre ; mot + sport centrés et réduits pour que les coins de leur boîte tiennent dans la zone sûre.
        x0, y0 = min(ink[0], tx0), min(ink[1], ty0)
        x1, y1 = max(ink[2], tx1), max(ink[3], ty1)
        cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
        half_diag = ((x1 - x0) ** 2 + (y1 - y0) ** 2) ** 0.5 / 2
        k = min(1.0, SAFE_RADIUS * SAFE_MARGIN / half_diag)
        tr = f'translate(256 256) scale({k:.4f}) translate({fmt(-cx)} {fmt(-cy)})'
        (out / 'icon-maskable-512.png').write_bytes(render(icon_svg(inner_moved, d, rounded=False, transform=tr), 512, opaque=True))
        print(f'{sport}: {out.relative_to(ROOT)}/ (maskable : échelle {k:.3f}, boîte {fmt(x1 - x0)} × {fmt(y1 - y0)})')

        # Écran d'ouverture : le même tracé, exprimé dans les unités du mot « Nextar ».
        inv = (1 / s, 0, 0, 1 / s, -ox / s, -oy / s)
        sp = SVGPathPen(None, ntos=fmt)
        parse_path(d, TransformPen(sp, inv))
        ts.append(f"  {sport}: {{ text: '{c['text']}', d: '{sp.getCommands()}', bottom: {fmt((ty1 - oy) / s)} }},")
    ts.append('}')
    (ROOT / 'src/sportWordmark.ts').write_text('\n'.join(ts) + '\n')
    print('src/sportWordmark.ts')


if __name__ == '__main__':
    main()
