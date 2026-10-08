import type { PoleProgramme } from './db'

/**
 * Sites des Pôles Espoirs de handball (PPF 2025-2029), d'après les sites des ligues (recherche d'octobre 2026) :
 * suggestions du champ « Site » de la fiche joueur, selon le pôle (ligue) et le sexe du joueur. Liste indicative,
 * à corriger au fil de l'eau : le champ reste libre. 14 pôles : 12 ligues de métropole (Région Sud avec la Corse),
 * Antilles-Guyane et Réunion-Mayotte. « accession » : niveau non précisé par la ligue.
 */
export interface PoleSite {
  regions: string[]
  sex: 'M' | 'F'
  site: string
  levels: PoleProgramme[]
}

const S = (regions: string | string[], sex: 'M' | 'F', site: string, ...levels: PoleProgramme[]): PoleSite => ({
  regions: Array.isArray(regions) ? regions : [regions],
  sex,
  site,
  levels,
})
const SUD = ['region-sud', 'region-cor']
const ANT = ['region-ant', 'region-guy', 'region-om']
const REU = ['region-reu', 'region-may', 'region-om']

export const POLE_SITES: PoleSite[] = [
  S('region-ara', 'M', 'Lyon', 'accession_nationale'),
  S('region-ara', 'M', 'Chambéry', 'accession_nationale'),
  S('region-ara', 'M', "Cournon-d'Auvergne", 'accession_territoriale'),
  S('region-ara', 'F', 'Lyon', 'accession_territoriale', 'accession_nationale'),
  S('region-ara', 'F', 'Chambéry', 'accession_territoriale'),
  S('region-ara', 'F', 'Clermont-Ferrand', 'accession_territoriale'),
  S('region-bfc', 'M', 'Dijon', 'accession_nationale', 'excellence'),
  S('region-bfc', 'F', 'Besançon', 'accession', 'excellence'),
  S('region-bfc', 'F', 'Dijon', 'accession_nationale'),
  S('region-bre', 'M', 'Cesson-Sévigné', 'accession_territoriale', 'accession_nationale'),
  S('region-bre', 'F', 'Brest', 'accession_territoriale', 'accession_nationale'),
  S('region-bre', 'F', 'Rennes', 'accession_territoriale'),
  S('region-cvl', 'M', 'Chartres', 'accession'),
  S('region-cvl', 'M', 'Orléans', 'accession'),
  S('region-cvl', 'F', 'Orléans', 'accession'),
  S('region-ges', 'M', 'Strasbourg', 'accession_territoriale', 'accession_nationale'),
  S('region-ges', 'M', 'Pont-à-Mousson', 'accession_territoriale'),
  S('region-ges', 'M', 'Reims', 'accession_territoriale'),
  S('region-ges', 'F', 'Metz', 'accession_territoriale', 'accession_nationale', 'excellence'),
  S('region-ges', 'F', 'Barr', 'accession_territoriale'),
  S('region-hdf', 'M', 'Dunkerque', 'accession_nationale'),
  S('region-hdf', 'M', 'Amiens', 'accession_territoriale'),
  S('region-hdf', 'F', 'Tourcoing', 'accession'),
  S('region-hdf', 'F', 'Amiens', 'accession'),
  S('region-idf', 'M', 'Eaubonne', 'accession', 'excellence'),
  S('region-idf', 'F', 'Châtenay-Malabry', 'accession', 'excellence'),
  S('region-idf', 'F', 'Fontainebleau', 'accession'),
  S('region-nor', 'M', 'Caen', 'accession', 'excellence'),
  S('region-nor', 'F', 'Le Havre', 'accession', 'excellence'),
  S('region-nor', 'F', 'Caen', 'accession'),
  S('region-naq', 'M', 'Bordeaux-Talence', 'accession', 'excellence'),
  S('region-naq', 'M', 'Saint-Yrieix-la-Perche', 'accession'),
  S('region-naq', 'M', 'Pau', 'accession'),
  S('region-naq', 'F', 'Bordeaux-Talence', 'accession', 'excellence'),
  S('region-naq', 'F', 'Angoulême', 'accession'),
  S('region-occ', 'M', 'Montpellier', 'accession_territoriale', 'accession_nationale'),
  S('region-occ', 'M', 'Nîmes', 'accession_territoriale', 'accession_nationale'),
  S('region-occ', 'M', 'Toulouse', 'accession_territoriale', 'accession_nationale'),
  S('region-occ', 'F', 'Nîmes', 'accession'),
  S('region-occ', 'F', 'Toulouse', 'accession', 'excellence'),
  S('region-pdl', 'M', 'Nantes', 'accession_territoriale', 'accession_nationale'),
  S('region-pdl', 'F', 'Nantes', 'accession_territoriale', 'accession_nationale'),
  S(SUD, 'M', 'Saint-Raphaël', 'accession'),
  S(SUD, 'M', 'Aix-en-Provence', 'accession'),
  S(SUD, 'M', 'Ajaccio', 'accession'),
  S(SUD, 'F', 'Aix-en-Provence (Luynes)', 'accession_nationale', 'excellence'),
  S(SUD, 'F', 'Nice', 'accession_territoriale'),
  S(ANT, 'M', 'Guadeloupe (CREPS Antilles-Guyane)', 'accession'),
  S(ANT, 'F', 'Basse-Terre (Guadeloupe)', 'accession'),
  S(REU, 'M', 'Saint-Denis (CREPS Réunion)', 'accession'),
  S(REU, 'F', 'Le Port', 'accession', 'excellence'),
]

/** Sites proposés pour un pôle (ligue) et un sexe ; sans ligue ou sans sexe, on élargit. */
export function poleSites(regionId?: string, sex?: 'M' | 'F') {
  return POLE_SITES.filter((s) => (!regionId || s.regions.includes(regionId)) && (!sex || s.sex === sex))
}
