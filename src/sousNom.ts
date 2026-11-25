import type { Laterality } from './db'
import { PICTO_KINDS, type PictoKind } from './pictos'
import { playerDepartment } from './perimeter'
import { playerCategory, type UsualTeam } from './rencontres'
import type { YouthCategory } from './sportContent'

/*
 * « Sous le nom » : ce que chaque ligne de joueur montre sous le nom (src/components/PlayerRow.tsx, ligne secondaire par
 * défaut), choisi dans « Filtres » → « Affichage » de n'importe quelle liste (src/components/PictoDisplay.tsx). Un seul
 * réglage pour toutes les listes, comme les pictogrammes ; gardé sur l'appareil (localStorage « handbase.sousNom ») et sur
 * le compte avec eux (hb_profiles.affichage, supabase/063_affichage.sql ; src/affichage.ts). Partie pure : testée par
 * tools/test-sous-nom.ts.
 */

/** Ordre d'affichage fixe (celui des pastilles). */
export const SOUS_NOM_KINDS = ['annee', 'age', 'trimestre', 'club', 'departement', 'taille', 'poids', 'lateralite', 'categorie', 'envergure'] as const
export type SousNomKind = (typeof SOUS_NOM_KINDS)[number]

export const SOUS_NOM_LABELS: Record<SousNomKind, string> = {
  annee: 'Année',
  age: 'Âge',
  trimestre: 'Trimestre',
  club: 'Club',
  departement: 'Département',
  taille: 'Taille',
  poids: 'Poids',
  lateralite: 'Latéralité',
  categorie: 'Catégorie',
  envergure: 'Envergure',
}

/** Par défaut : la ligne d'avant ce réglage (année · trimestre · club · taille). */
export const DEFAULT_SOUS_NOM: readonly SousNomKind[] = ['annee', 'trimestre', 'club', 'taille']
export const SOUS_NOM_KEY = 'handbase.sousNom'

/** Mesures lues pour la ligne (dernière valeur de chaque critère). */
export const SOUS_NOM_MEASURES = ['taille', 'poids', 'envergure'] as const
export type SousNomMeasure = (typeof SOUS_NOM_MEASURES)[number]

/** Garde les clés connues de `known`, dans leur ordre, sans doublon ; undefined si `v` n'est pas un tableau. */
function pick<K extends string>(v: unknown, known: readonly K[]): K[] | undefined {
  if (!Array.isArray(v)) return undefined
  return known.filter((k) => v.includes(k))
}

/** Réglage relu (texte JSON du stockage) : absent ou illisible → défaut ; inconnus ignorés ; ordre fixe. */
export function parseSousNom(raw: string | null | undefined): SousNomKind[] {
  if (raw == null) return [...DEFAULT_SOUS_NOM]
  try {
    return pick(JSON.parse(raw), SOUS_NOM_KINDS) ?? [...DEFAULT_SOUS_NOM]
  } catch {
    return [...DEFAULT_SOUS_NOM]
  }
}

export const serializeSousNom = (on: readonly SousNomKind[]) => JSON.stringify(SOUS_NOM_KINDS.filter((k) => on.includes(k)))
export const toggleSousNom = (on: readonly SousNomKind[], k: SousNomKind): SousNomKind[] => SOUS_NOM_KINDS.filter((x) => (x === k ? !on.includes(k) : on.includes(x)))
export const isDefaultSousNom = (on: readonly SousNomKind[]) => serializeSousNom(on) === serializeSousNom(DEFAULT_SOUS_NOM)

// ---------- Valeur gardée sur le compte (hb_profiles.affichage) ----------

export interface Affichage {
  pictos: PictoKind[]
  sousNom: SousNomKind[]
}

/**
 * Valeur du compte relue : un objet avec les deux tableaux, sinon null (rien d'enregistré, ou forme inconnue : la valeur de
 * l'appareil reste). Clés inconnues ignorées (une version plus récente de l'appli a pu en ajouter).
 */
export function parseAffichage(v: unknown): Affichage | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null
  const o = v as Record<string, unknown>
  const pictos = pick(o.pictos, PICTO_KINDS)
  const sousNom = pick(o.sousNom, SOUS_NOM_KINDS)
  return pictos && sousNom ? { pictos, sousNom } : null
}

/** Ce qui part au serveur (hb_set_affichage) : clés connues, ordre fixe. */
export const affichagePayload = (pictos: readonly PictoKind[], sousNom: readonly SousNomKind[]): Affichage => ({
  pictos: PICTO_KINDS.filter((k) => pictos.includes(k)),
  sousNom: SOUS_NOM_KINDS.filter((k) => sousNom.includes(k)),
})

export const sameAffichage = (a: Affichage, b: Affichage) => JSON.stringify(affichagePayload(a.pictos, a.sousNom)) === JSON.stringify(affichagePayload(b.pictos, b.sousNom))

// ---------- Morceaux de la ligne ----------

export type SubPlayer = {
  birthDate?: string
  club?: string
  clubCode?: string
  license?: string
  department?: string
  laterality?: Laterality
  sex?: string
  usualTeam?: UsualTeam
}

/** Morceau de la ligne : texte, bulle d'aide, `wide` : seulement sur une ligne large (âge non choisi, liste Joueurs). */
export interface SubPiece {
  key: SousNomKind
  text: string
  title?: string
  wide?: boolean
}

export interface SubOptions {
  /** Jour (AAAA-MM-JJ) : âge et catégorie de saison. */
  today: string
  /** Catégories de jeunes du sport (src/sportContent.ts). */
  cats: readonly YouthCategory[]
  /** Dernières mesures connues (valeur brute). */
  measures?: Partial<Record<SousNomMeasure, number | string>>
  /** La liste retire le club (liste d'un club) ou le trimestre. */
  club?: boolean
  quarter?: boolean
  /** Âge sur ligne large même s'il n'est pas choisi (liste Joueurs, comme avant le réglage). */
  wideAge?: boolean
}

const QUARTER_MONTHS = ['janvier à mars', 'avril à juin', 'juillet à septembre', 'octobre à décembre']

/** Âge (années révolues) au jour `today` ; null si la date est illisible ou après ce jour. */
export function ageOn(birthDate: string | undefined, today: string): number | null {
  if (!birthDate || !/^\d{4}-\d{2}-\d{2}/.test(birthDate)) return null
  let a = Number(today.slice(0, 4)) - Number(birthDate.slice(0, 4))
  if (today.slice(5, 10) < birthDate.slice(5, 10)) a--
  return a >= 0 ? a : null
}

const num = (v: number | string | undefined) => {
  if (v === undefined || v === null || v === '') return undefined
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toLocaleString('fr-FR', { maximumFractionDigits: 1 })
  return String(v)
}
const lat: Record<Laterality, [string, string]> = { droitier: ['Droitier', 'Droitière'], gaucher: ['Gaucher', 'Gauchère'], ambidextre: ['Ambidextre', 'Ambidextre'] }

/**
 * Morceaux de la ligne sous le nom, dans l'ordre fixe, pour les choix `on` ; ce qui est inconnu pour ce joueur est sauté.
 * Club et trimestre : jamais si la liste les retire. Âge : choisi, toujours ; sinon, avec `wideAge`, sur ligne large.
 */
export function sousNomPieces(p: SubPlayer, on: readonly SousNomKind[], o: SubOptions): SubPiece[] {
  const out: SubPiece[] = []
  const has = (k: SousNomKind) => on.includes(k)
  for (const k of SOUS_NOM_KINDS) {
    switch (k) {
      case 'annee': {
        const y = has(k) && /^\d{4}/.test(p.birthDate ?? '') ? p.birthDate!.slice(0, 4) : undefined
        if (y) out.push({ key: k, text: y })
        break
      }
      case 'age': {
        if (!has(k) && !o.wideAge) break
        const a = ageOn(p.birthDate, o.today)
        if (a !== null) out.push({ key: k, text: `${a} ans`, ...(has(k) ? {} : { wide: true }) })
        break
      }
      case 'trimestre': {
        const m = has(k) && o.quarter !== false && /^\d{4}-\d{2}/.test(p.birthDate ?? '') ? Number(p.birthDate!.slice(5, 7)) : 0
        if (m >= 1 && m <= 12) {
          const q = Math.ceil(m / 3)
          out.push({ key: k, text: `Q${q}`, title: `Né(e) au ${q === 1 ? '1er' : `${q}e`} trimestre (${QUARTER_MONTHS[q - 1]})` })
        }
        break
      }
      case 'club':
        if (has(k) && o.club !== false && p.club?.trim()) out.push({ key: k, text: p.club.trim() })
        break
      case 'departement': {
        const d = has(k) ? playerDepartment(p) : undefined
        if (d) out.push({ key: k, text: `Dép. ${d}`, title: `Département ${d}` })
        break
      }
      case 'taille':
      case 'poids':
      case 'envergure': {
        const v = has(k) ? num(o.measures?.[k]) : undefined
        if (v) out.push(k === 'envergure' ? { key: k, text: `env. ${v} cm`, title: `Envergure ${v} cm` } : { key: k, text: `${v} ${k === 'poids' ? 'kg' : 'cm'}` })
        break
      }
      case 'lateralite':
        if (has(k) && p.laterality && lat[p.laterality]) out.push({ key: k, text: lat[p.laterality][p.sex === 'F' ? 1 : 0] })
        break
      case 'categorie': {
        const c = has(k) ? playerCategory(p, o.today, o.cats) : undefined
        if (c) out.push({ key: k, text: c, title: `Catégorie ${c} cette saison` })
        break
      }
    }
  }
  return out
}

/** Dernière valeur de chaque mesure de la ligne, par joueur (lignes supprimées ignorées ; la plus récente gagne). */
export function latestSubMeasures(
  rows: readonly { playerId: string; criterionId: string; value: number | string; date: string; updatedAt: number; deleted?: boolean }[],
): Map<string, Partial<Record<SousNomMeasure, number | string>>> {
  const best = new Map<string, { date: string; updatedAt: number }>()
  const out = new Map<string, Partial<Record<SousNomMeasure, number | string>>>()
  for (const m of rows) {
    if (m.deleted || !(SOUS_NOM_MEASURES as readonly string[]).includes(m.criterionId)) continue
    const k = `${m.playerId}|${m.criterionId}`
    const cur = best.get(k)
    if (cur && (m.date < cur.date || (m.date === cur.date && m.updatedAt <= cur.updatedAt))) continue
    best.set(k, { date: m.date, updatedAt: m.updatedAt })
    const o = out.get(m.playerId) ?? {}
    o[m.criterionId as SousNomMeasure] = m.value
    out.set(m.playerId, o)
  }
  return out
}
