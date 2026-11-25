// FICHIER GÉNÉRÉ par tools/generer-partage-mcp.ts depuis src/propositionsJoueursCore.ts : ne pas le modifier ici. Après un changement dans
// src/propositionsJoueursCore.ts : npx jiti tools/generer-partage-mcp.ts (tools/test-mcp.ts vérifie que la copie est à jour).
/*
 * Boîte « À valider », propositions sur des JOUEURS préparées par Claude (serveur MCP, outils nextar_proposer_avis,
 * nextar_proposer_vus et nextar_proposer_a_revoir : supabase/functions/mcp/proposerJoueurs.ts) et ouvertes par l'appli du
 * coach (src/propositionsJoueurs.ts, écran src/components/PropositionsJoueurs.tsx). Sortes de la table hb_propositions déjà
 * prévues par supabase/067_propositions.sql (« avis », « vus », « a_revoir ») : aucun SQL.
 *
 * Fichier PUR, sans import : utilisé par l'appli et, en copie générée, par la fonction « mcp » (tools/generer-partage-mcp.ts).
 *
 * Une proposition : contexte { sorte, version, portee, id?, nom?, date?, typeContexte?, lieu?, joueurs? } et une ligne
 * (objet) par joueur de la feuille :
 *  - toutes : { n, nom?, numero?, annee?, code?, joueur?, possibles?, confiance } : nom tel que lu sur la feuille (ou code
 *    J-… donné par Claude), rapprochement du serveur (fiche sûre, fiches possibles) ; l'appli refait le rapprochement sur
 *    l'appareil et le coach peut changer de joueur ;
 *  - « avis »     : + { notes: { <critère d'avis>: note }, date?, forts?, progres? } (notes déjà contrôlées : critère connu,
 *                   échelle du critère, poste) ; points forts et axes de progression : le texte du coach, gardé tel quel,
 *                   jamais renvoyé à Claude ;
 *  - « vus »      : rien de plus (l'événement est dans le contexte) ;
 *  - « a_revoir » : + { raison? } (texte court du coach, gardé comme commentaire du « à revoir »).
 * Les identifiants de fiches restent dans la proposition du coach (sa ligne, lue par lui seul) : le serveur MCP ne rend à
 * Claude que des codes J-… et un état par ligne, jamais un nom ni un texte.
 * Uniquement des formulations positives ou neutres sur les jeunes (« à revoir », « vu », « points forts », « axes de
 * progression ») : aucun libellé négatif.
 */

export type SorteJoueurs = 'avis' | 'vus' | 'a_revoir'
export const SORTES_JOUEURS: readonly SorteJoueurs[] = ['avis', 'vus', 'a_revoir']

/** Bornes (contrôlées par le serveur MCP et relues par l'appli ; la table, elle, accepte 300 lignes et 200 Ko). */
export const JOUEURS_LIMITES = {
  /** Lignes (joueurs) par proposition. */
  lignes: { avis: 100, vus: 200, a_revoir: 100 } as Record<SorteJoueurs, number>,
  /** Notes par ligne. */
  notes: 40,
  /** Points forts, axes de progression (signes). */
  texte: 300,
  /** Raison d'un « à revoir » (signes). */
  raison: 120,
  /** Nom tel que lu sur la feuille. */
  nom: 120,
  /** Lieu d'un avis hors événement. */
  lieu: 80,
  /** Possibles gardés par ligne. */
  possibles: 5,
} as const

export type Confiance = 'sur' | 'verifier' | 'introuvable'

export interface LigneJoueur {
  /** Rang de la ligne dans la demande (1, 2, …). */
  n: number
  /** Nom tel que lu sur la feuille (rapprochement refait sur l'appareil). */
  nom?: string
  /** N° de maillot lu. */
  numero?: string
  /** Année de naissance lue. */
  annee?: number
  /** Code « J-… » donné à la place d'un nom. */
  code?: string
  /** Fiche trouvée par le serveur (sûre). */
  joueur?: string
  /** Fiches possibles quand le serveur hésite (la première d'abord). */
  possibles?: string[]
  confiance: Confiance
}

export interface LigneAvis extends LigneJoueur {
  /** Notes par critère d'avis (identifiant → note dans l'échelle du critère, ou option choisie). */
  notes: Record<string, number | string>
  /** Date de l'avis (AAAA-MM-JJ) ; absente : celle du contexte. */
  date?: string
  /** Points forts (texte du coach). */
  forts?: string
  /** Axes de progression (texte du coach). */
  progres?: string
}

export interface LigneAReVoir extends LigneJoueur {
  /** Raison courte (texte du coach). */
  raison?: string
}

export type LigneSorte = LigneJoueur | LigneAvis | LigneAReVoir

/** Contextes d'un avis hors événement (les mêmes que src/db.ts, CONTEXT_TYPES). */
export const TYPES_CONTEXTE = ['unss', 'club', 'match', 'selection', 'video', 'autre'] as const
export type TypeContexte = (typeof TYPES_CONTEXTE)[number]

/** Contexte d'une proposition sur des joueurs. */
export interface ContexteJoueurs {
  sorte: SorteJoueurs
  version: 1
  /** Où chercher les joueurs : événement, groupe, toute la base. */
  portee: 'evenement' | 'groupe' | 'tous'
  /** Identifiant de l'événement ou du groupe. */
  id?: string
  /** Nom de l'événement ou du groupe. */
  nom?: string
  /** Date des avis (AAAA-MM-JJ). */
  date?: string
  /** Avis hors événement : contexte (« match », « club »…) et lieu. */
  typeContexte?: TypeContexte
  lieu?: string
  /** Joueurs de l'événement ou du groupe au moment du dépôt (fiches). */
  joueurs?: string[]
}

/** Texte d'une cellule : caractères de contrôle et espaces resserrés, coupé à `n`. */
export const texteCourt = (v: unknown, n: number): string =>
  typeof v === 'string' || typeof v === 'number'
    ? String(v)
        .replace(/[\u0000-\u001f\u007f]/g, ' ') // eslint-disable-line no-control-regex
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, n)
        .trim()
    : ''

/** Texte libre du coach (points forts, axes, raison) : retours à la ligne gardés, rien d'autre de spécial ; vide : undefined. */
export function texteCoach(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined
  const t = v
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, ' ') // eslint-disable-line no-control-regex
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return t || undefined
}

export const estDate = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s))

const ID = /^[\w.:-]{1,80}$/
const id = (v: unknown) => (typeof v === 'string' && ID.test(v) ? v : undefined)

/** Échelle d'un critère d'avis : bornes des notes (null : pas une note bornée). */
export function bornesEchelle(scale?: string): { min: number; max: number } | null {
  if (scale === 'score5' || scale === undefined) return { min: 1, max: 5 }
  if (scale === 'score3') return { min: 0, max: 3 }
  if (scale === 'score2') return { min: 0, max: 2 }
  return null
}

/** « 1 à 5 », « 0 à 3 »… */
export const texteEchelle = (scale?: string) => {
  const b = bornesEchelle(scale)
  return b ? `${b.min} à ${b.max}` : scale === 'choice' ? 'une des options' : 'un nombre'
}

/**
 * Note donnée pour un critère d'avis, contrôlée sur l'échelle du critère : note entière dans les bornes (« 4 », 4, « 4/5 »),
 * option exacte (sans tenir compte des majuscules et accents) pour un critère à choix, nombre pour un critère chiffré. Un
 * critère en texte libre n'est jamais rempli de cette façon. Renvoie la note à garder, ou la raison du refus (texte neutre).
 */
export function controleNote(c: { scale?: string; options?: string[] }, v: unknown): { ok: number | string } | { raison: string } {
  const b = bornesEchelle(c.scale)
  if (c.scale === 'text') return { raison: 'critère en texte libre : à remplir dans l’appli' }
  if (c.scale === 'choice') {
    const cle = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
    const opt = typeof v === 'string' ? (c.options ?? []).find((o) => cle(o) === cle(v)) : undefined
    return opt ? { ok: opt } : { raison: 'option inconnue pour ce critère' }
  }
  let x = NaN
  if (typeof v === 'number') x = v
  else if (typeof v === 'string') {
    const m = /^\s*(-?\d+(?:[.,]\d+)?)\s*(?:\/\s*(\d+))?\s*$/.exec(v)
    if (m && (!m[2] || !b || +m[2] === b.max)) x = +m[1].replace(',', '.')
  }
  if (!Number.isFinite(x)) return { raison: b ? `hors échelle (${b.min} à ${b.max})` : 'nombre attendu' }
  if (!b) return { ok: x }
  if (!Number.isInteger(x) || x < b.min || x > b.max) return { raison: `hors échelle (${b.min} à ${b.max})` }
  return { ok: x }
}

/** Le critère vaut-il pour ce poste ? (aucun poste précisé sur le critère, ou poste inconnu : oui). */
export const vautPourPoste = (positions: readonly string[] | undefined, poste: string | undefined) => !positions?.length || !poste || positions.includes(poste)

/** Une ligne déposée → ligne de la sorte, ou null (forme inconnue : jamais applicable). */
export function lireLigne(sorte: SorteJoueurs, l: unknown): LigneSorte | null {
  if (!l || typeof l !== 'object' || Array.isArray(l)) return null
  const o = l as Record<string, unknown>
  const n = typeof o.n === 'number' && Number.isInteger(o.n) && o.n > 0 ? o.n : null
  if (n === null) return null
  const confiance: Confiance = o.confiance === 'sur' || o.confiance === 'verifier' ? o.confiance : 'introuvable'
  const nom = texteCourt(o.nom, JOUEURS_LIMITES.nom)
  const numero = texteCourt(o.numero, 6)
  const annee = typeof o.annee === 'number' && Number.isInteger(o.annee) && o.annee > 1900 && o.annee < 2100 ? o.annee : undefined
  const code = typeof o.code === 'string' && /^J-[0-9A-Z]{7}$/.test(o.code) ? o.code : undefined
  const joueur = id(o.joueur)
  const possibles = Array.isArray(o.possibles) ? [...new Set(o.possibles.map(id).filter((x): x is string => !!x))].slice(0, JOUEURS_LIMITES.possibles) : []
  const base: LigneJoueur = {
    n,
    ...(nom ? { nom } : {}),
    ...(numero ? { numero } : {}),
    ...(annee ? { annee } : {}),
    ...(code ? { code } : {}),
    ...(joueur ? { joueur } : {}),
    ...(possibles.length ? { possibles } : {}),
    confiance: joueur ? confiance : confiance === 'sur' ? 'introuvable' : confiance,
  }
  if (sorte === 'vus') return base
  if (sorte === 'a_revoir') {
    const raison = texteCoach(o.raison)?.slice(0, JOUEURS_LIMITES.raison).trim()
    return { ...base, ...(raison ? { raison } : {}) }
  }
  const notes: Record<string, number | string> = {}
  if (o.notes && typeof o.notes === 'object' && !Array.isArray(o.notes))
    for (const [k, v] of Object.entries(o.notes as Record<string, unknown>).slice(0, JOUEURS_LIMITES.notes))
      if (ID.test(k) && ((typeof v === 'number' && Number.isFinite(v)) || (typeof v === 'string' && v.trim()))) notes[k] = typeof v === 'string' ? texteCourt(v, 60) : v
  const forts = texteCoach(o.forts)?.slice(0, JOUEURS_LIMITES.texte).trim()
  const progres = texteCoach(o.progres)?.slice(0, JOUEURS_LIMITES.texte).trim()
  const date = estDate(o.date) ? o.date : undefined
  return { ...base, notes, ...(date ? { date } : {}), ...(forts ? { forts } : {}), ...(progres ? { progres } : {}) }
}

/** Contexte lu (forme inconnue : null). */
export function lireContexte(c: unknown): ContexteJoueurs | null {
  if (!c || typeof c !== 'object' || Array.isArray(c)) return null
  const o = c as Record<string, unknown>
  const sorte = SORTES_JOUEURS.find((s) => s === o.sorte)
  if (!sorte) return null
  const portee = o.portee === 'evenement' || o.portee === 'groupe' ? o.portee : 'tous'
  const typeContexte = TYPES_CONTEXTE.find((t) => t === o.typeContexte)
  const lieu = texteCourt(o.lieu, JOUEURS_LIMITES.lieu)
  const joueurs = Array.isArray(o.joueurs) ? o.joueurs.map(id).filter((x): x is string => !!x) : undefined
  return {
    sorte,
    version: 1,
    portee,
    ...(id(o.id) && portee !== 'tous' ? { id: id(o.id) } : {}),
    ...(texteCourt(o.nom, 120) ? { nom: texteCourt(o.nom, 120) } : {}),
    ...(estDate(o.date) ? { date: o.date } : {}),
    ...(typeContexte ? { typeContexte } : {}),
    ...(lieu ? { lieu } : {}),
    ...(joueurs?.length ? { joueurs } : {}),
  }
}

/** Libellés des sortes (boîte « À valider »). */
export const SORTE_JOUEURS_LIBELLE: Record<SorteJoueurs, string> = { avis: 'avis', vus: 'vus', a_revoir: 'à revoir' }
