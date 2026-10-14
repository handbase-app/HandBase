import { geoMercator, geoPath } from 'd3-geo'
import type { FeatureCollection, Geometry } from 'geojson'

/*
 * Encarts ultramarins de la carte de France (src/components/FranceMap.tsx) : un petit dessin par territoire,
 * comme les cartes officielles. Sans React ni base locale, pour être testé seul (tools/test-bilan.ts).
 *
 * Contours (src/assets/outre-mer.json, ~14 Ko, coordonnées à 3 décimales, simplifiés par Douglas-Peucker,
 * îlots minuscules retirés) :
 *  - 971, 972, 973, 974, 976 : france-geojson de Grégoire David (departements-avec-outre-mer.geojson,
 *    https://github.com/gregoiredavid/france-geojson), issus d'Admin Express IGN — Licence Ouverte Etalab ;
 *  - 988 : Natural Earth 1:50m, Admin 0 Countries (https://www.naturalearthdata.com) — domaine public.
 */

export type OutreMerGeo = FeatureCollection<Geometry, { code: string; nom: string }>

/** Territoires dessinés, dans l'ordre des encarts : numéro (celui des licences), abréviation, nom, libellé de l'encart. */
export const OUTRE_MER: readonly { code: string; abbr: string; name: string; short: string }[] = [
  { code: '971', abbr: 'GP', name: 'Guadeloupe', short: 'Guadeloupe' },
  { code: '972', abbr: 'MQ', name: 'Martinique', short: 'Martinique' },
  { code: '973', abbr: 'GF', name: 'Guyane', short: 'Guyane' },
  { code: '974', abbr: 'RE', name: 'La Réunion', short: 'Réunion' },
  { code: '976', abbr: 'YT', name: 'Mayotte', short: 'Mayotte' },
  { code: '988', abbr: 'NC', name: 'Nouvelle-Calédonie', short: 'Calédonie' },
]
/** Ultramarin sans territoire précis (n° de club « 97… » : department() donne « 97 ») : pas de contour, une pastille. */
export const OTHER_OM = { code: '97', abbr: 'OM', name: 'Autres outre-mer', short: 'Autres OM' } as const

/** Pastille « Autres outre-mer » : seulement s'il y a des joueurs ainsi codés. */
export const showOtherOM = (byDept: { get(code: string): { total: number } | undefined }) => (byDept.get(OTHER_OM.code)?.total ?? 0) > 0

/** Tracé SVG de chaque territoire, chacun recalé dans un cadre w × h (marge m) : pas à l'échelle, comme les encarts officiels. */
export function insetPaths(geo: OutreMerGeo, w: number, h: number, m = 3): Map<string, string> {
  const out = new Map<string, string>()
  for (const f of geo.features) {
    const p = geoMercator().fitExtent(
      [
        [m, m],
        [w - m, h - m],
      ],
      f,
    )
    out.set(f.properties.code, geoPath(p)(f) ?? '')
  }
  return out
}
