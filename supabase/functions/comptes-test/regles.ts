// HandBase : règles pures de la fonction « comptes-test » (index.ts) : lecture de la demande et décisions, sans réseau ni
// Deno (testées par tools/test-comptes.ts avec npx jiti). Aucun jeton n'apparaît jamais dans une réponse d'erreur.

/** Lignes au plus par administrateur (comptes de test gardés sur son compte). */
export const MAX_LIGNES = 20
/** Taille au plus d'une demande (JSON) et d'un jeton d'accès. */
export const MAX_DEMANDE = 8192
export const MAX_JETON = 4096

const UID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const JWT = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/

export type Demande = { action: 'lier'; jeton_test: string } | { action: 'ouvrir'; test_uid: string } | { action: 'retirer'; test_uid: string }

/** Demande lue (texte JSON) ; null : forme refusée (« demande »). */
export function lireDemande(texte: string): Demande | null {
  if (!texte || texte.length > MAX_DEMANDE) return null
  let o: Record<string, unknown>
  try {
    o = JSON.parse(texte)
  } catch {
    return null
  }
  if (!o || typeof o !== 'object' || Array.isArray(o)) return null
  if (o.action === 'lier') {
    const j = o.jeton_test
    return typeof j === 'string' && j.length <= MAX_JETON && JWT.test(j) ? { action: 'lier', jeton_test: j } : null
  }
  if (o.action === 'ouvrir' || o.action === 'retirer') {
    const u = o.test_uid
    return typeof u === 'string' && UID.test(u) ? { action: o.action, test_uid: u.toLowerCase() } : null
  }
  return null
}

/** Rôles qu'un compte de test peut avoir (jamais administrateur). */
export const roleTest = (r: unknown): '' | 'preparateur' | 'observateur' | 'joueur' =>
  r === 'preparateur' || r === 'observateur' || r === 'joueur' ? r : ''

export type Refus = 'pas_admin' | 'meme_compte' | 'cible_admin' | 'trop' | 'inconnu' | 'cible_absente' | 'cible_bloquee'

/** « lier » : l'appelant est administrateur, la cible (jeton vérifié) est un autre compte, pas administrateur ; place libre. */
export function decisionLier(p: { appelant: string; roleAppelant: unknown; cible: string; roleCible: unknown; lignes: number; dejaLie: boolean }): Refus | null {
  if (p.roleAppelant !== 'admin') return 'pas_admin'
  if (p.cible.toLowerCase() === p.appelant.toLowerCase()) return 'meme_compte'
  if (p.roleCible === 'admin') return 'cible_admin'
  if (!p.dejaLie && p.lignes >= MAX_LIGNES) return 'trop'
  return null
}

/** « ouvrir » : l'appelant est toujours administrateur, la ligne existe, la cible existe, n'est pas bloquée ni administrateur. */
export function decisionOuvrir(p: { roleAppelant: unknown; ligne: boolean; cibleExiste: boolean; email: string; bloqueeJusqua: string | null | undefined; roleCible: unknown; maintenant: number }): Refus | null {
  if (p.roleAppelant !== 'admin') return 'pas_admin'
  if (!p.ligne) return 'inconnu'
  if (!p.cibleExiste || !p.email) return 'cible_absente'
  if (p.bloqueeJusqua && Date.parse(p.bloqueeJusqua) > p.maintenant) return 'cible_bloquee'
  if (p.roleCible === 'admin') return 'cible_admin'
  return null
}

/** Nom affiché gardé (métadonnées full_name, 120 caractères au plus). */
export const libelleDe = (meta: unknown) => {
  const n = meta && typeof meta === 'object' ? (meta as { full_name?: unknown }).full_name : ''
  return typeof n === 'string' ? n.trim().slice(0, 120) : ''
}

/** Statut HTTP d'un refus. */
export const statutRefus = (r: Refus) =>
  r === 'pas_admin' || r === 'cible_admin' || r === 'cible_bloquee' ? 403 : r === 'trop' ? 409 : r === 'meme_compte' ? 400 : 404
