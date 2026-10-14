/*
 * Découpage officiel des régions et noms de repli : fichier pur (ni Dexie ni React), partagé par src/lists.ts et
 * « Importer une structure (CSV) » (src/structureImport.ts, rattachement des Pôles Espoirs à leur ligue).
 */

/**
 * Découpage officiel (INSEE, régions de 2016), avec les identifiants de la liste des régions
 * (supabase/019_listes_regions.sql). Référence quand un département de la liste n'a pas de région.
 * Corse : un seul département pour nous (« 20 », n° de club) ; ultramarins : une ligue par territoire (Antilles = 971 + 972).
 */
export const OFFICIAL_REGIONS: Record<string, string> = {
  'region-ara': '01 03 07 15 26 38 42 43 63 69 73 74',
  'region-bfc': '21 25 39 58 70 71 89 90',
  'region-bre': '22 29 35 56',
  'region-cvl': '18 28 36 37 41 45',
  'region-cor': '20 2A 2B',
  'region-ges': '08 10 51 52 54 55 57 67 68 88',
  'region-hdf': '02 59 60 62 80',
  'region-idf': '75 77 78 91 92 93 94 95',
  'region-nor': '14 27 50 61 76',
  'region-naq': '16 17 19 23 24 33 40 47 64 79 86 87',
  'region-occ': '09 11 12 30 31 32 34 46 48 65 66 81 82',
  'region-pdl': '44 49 53 72 85',
  'region-sud': '04 05 06 13 83 84',
  // Ligues ultramarines (nom fédéral : « Ultramarins ») ; « 97 » = territoire non précisé (anciens n° de club).
  'region-ant': '971 972',
  'region-guy': '973',
  'region-reu': '974',
  'region-may': '976',
  'region-nc': '988',
  'region-om': '97',
}

/** Noms de repli (liste des régions absente : mode essai, base pas encore synchronisée). */
export const REGION_FALLBACK: Record<string, string> = {
  'region-ara': 'Auvergne-Rhône-Alpes',
  'region-bfc': 'Bourgogne-Franche-Comté',
  'region-bre': 'Bretagne',
  'region-cvl': 'Centre-Val de Loire',
  'region-cor': 'Corse',
  'region-ges': 'Grand Est',
  'region-hdf': 'Hauts-de-France',
  'region-idf': 'Île-de-France',
  'region-nor': 'Normandie',
  'region-naq': 'Nouvelle-Aquitaine',
  'region-occ': 'Occitanie',
  'region-pdl': 'Pays de la Loire',
  'region-sud': 'Région Sud',
  'region-ant': 'Antilles',
  'region-guy': 'Guyane',
  'region-reu': 'La Réunion',
  'region-may': 'Mayotte',
  'region-nc': 'Nouvelle-Calédonie',
  'region-om': 'Ultramarins (non précisé)',
}
