// Dictée par Voxtral (Mistral AI) au travers de la fonction Supabase « transcrire » (supabase/functions/transcrire/).
// Fonctions sans dépendance à l'appli (testables avec un faux fetch : tools/test-dictee.ts) ; la session, le cache
// et les réglages sont dans useDictation.ts.
//  - GET : accès ouvert ? (compte administrateur, clé Mistral configurée) et quotas restants ;
//  - POST (multipart) : file, duree (s, 60 au plus), context_bias (mots du hand, répété) → { text, restant_mois, restant_jour }.
// Le son n'est jamais gardé : le Blob reçu n'est référencé que le temps de l'envoi.

import { cleanDetail, type Replacement } from './clean'
import { motsVoxtral } from './vocabulary'

/** Limites de la fonction (à garder alignées sur supabase/functions/transcrire/index.ts). */
export const MAX_SECONDS = 60
export const MAX_BYTES = 2 * 1024 * 1024

/** ok : prêt ; absent : fonction inexistante (prod) ; pas_admin ; sans_cle : clé Mistral non configurée ; non_connecte ; erreur : réseau. */
export type AccessStatus = 'ok' | 'absent' | 'pas_admin' | 'sans_cle' | 'non_connecte' | 'erreur'
export type Access = { status: AccessStatus; restantMois?: number; restantJour?: number }

export type Endpoint = { url: string; headers: Record<string, string>; fetch?: typeof fetch }

/** Messages clairs pour le coach, par code d'erreur de la fonction (et quelques codes de l'appareil). */
export const ERROR_TEXT: Record<string, string> = {
  micro_refuse: 'Micro refusé : autorisez-le dans les réglages du navigateur pour dicter.',
  micro_absent: 'Aucun micro trouvé sur cet appareil.',
  micro_occupe: 'Micro déjà utilisé par une autre appli.',
  trop_court: 'Trop court : rien n’a été envoyé.',
  vide: 'Rien entendu : parlez plus près du micro, puis réessayez.',
  reseau: 'Pas de réseau : la dictée a besoin d’une connexion. Tapez au clavier.',
  quota_atteint: 'Quota du mois atteint : tapez au clavier.',
  quota_jour_atteint: 'Plafond du jour atteint pour votre compte : tapez au clavier, ou réessayez demain.',
  pas_admin: 'Dictée réservée aux administrateurs pendant l’essai.',
  non_connecte: 'Session expirée : reconnectez-vous pour dicter.',
  trop_long: 'Son trop long : 60 secondes au plus.',
  trop_gros: 'Son trop lourd : 2 Mo au plus.',
  mistral_limite: 'Limite de l’offre gratuite atteinte pour l’instant : réessayez dans un moment.',
  cle_absente: 'Dictée indisponible pour l’instant (serveur).',
  mistral_cle: 'Dictée indisponible pour l’instant (serveur).',
  mistral_erreur: 'Transcription impossible pour l’instant : réessayez.',
  absent: 'Dictée indisponible sur ce serveur.',
}

export class DictationError extends Error {
  code: string
  constructor(code: string, message?: string) {
    super(message ?? ERROR_TEXT[code] ?? `Transcription impossible (${code}).`)
    this.code = code
  }
}

/** Format d'enregistrement : webm/opus (Chrome, Firefox, Android), mp4 (Safari) ; '' = choix du navigateur. */
export function pickMimeType(isSupported: ((t: string) => boolean) | undefined): string {
  if (!isSupported) return ''
  for (const t of ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/aac']) {
    try {
      if (isSupported(t)) return t
    } catch {
      /* navigateur capricieux : on essaie le suivant */
    }
  }
  return ''
}

/** Nom de fichier avec la bonne extension (Mistral se fie au nom). */
export function fileNameFor(type: string): string {
  const ext = /ogg/.test(type) ? 'ogg' : /mp4|m4a|aac/.test(type) ? 'm4a' : /wav/.test(type) ? 'wav' : /mpeg|mp3/.test(type) ? 'mp3' : 'webm'
  return 'son.' + ext
}

/** Accès à la dictée (GET). Ne lève jamais : un serveur sans la fonction (prod) répond simplement « absent ». */
export async function requestAccess(ep: Endpoint): Promise<Access> {
  const f = ep.fetch ?? fetch
  let res: Response
  try {
    res = await f(ep.url, { headers: ep.headers })
  } catch {
    return { status: 'erreur' }
  }
  if (res.status === 404) return { status: 'absent' }
  if (res.status === 401) return { status: 'non_connecte' }
  if (res.status === 403) return { status: 'pas_admin' }
  if (!res.ok) return { status: 'erreur' }
  try {
    const d = (await res.json()) as { pret?: boolean; restant_mois?: number; restant_jour?: number }
    return { status: d.pret ? 'ok' : 'sans_cle', restantMois: d.restant_mois, restantJour: d.restant_jour }
  } catch {
    return { status: 'erreur' }
  }
}

export type Transcript = {
  /** Texte nettoyé et corrigé, à insérer (le coach relit toujours avant d'enregistrer). */
  text: string
  /** Texte brut renvoyé par Voxtral. */
  raw: string
  corrections: Replacement[]
  restantMois?: number
  restantJour?: number
}

/** Envoie le son (POST), puis nettoie et corrige le texte. Lève une DictationError au message clair. */
export async function transcribe(ep: Endpoint, blob: Blob, seconds: number, signal?: AbortSignal): Promise<Transcript> {
  if (seconds > MAX_SECONDS + 0.5) throw new DictationError('trop_long')
  if (blob.size > MAX_BYTES) throw new DictationError('trop_gros')
  const form = new FormData()
  form.append('file', blob, fileNameFor(blob.type))
  form.append('duree', String(Math.min(Math.max(Math.ceil(seconds * 10) / 10, 0.1), MAX_SECONDS)))
  for (const m of motsVoxtral) form.append('context_bias', m)
  const f = ep.fetch ?? fetch
  let res: Response
  try {
    res = await f(ep.url, { method: 'POST', headers: ep.headers, body: form, signal })
  } catch (e) {
    if ((e as Error)?.name === 'AbortError') throw new DictationError('annule', 'Dictée annulée.')
    throw new DictationError('reseau')
  }
  let d: { text?: string; error?: string; restant_mois?: number; restant_jour?: number } = {}
  try {
    d = await res.json()
  } catch {
    /* réponse vide */
  }
  if (!res.ok) {
    const code = d.error ?? (res.status === 404 ? 'absent' : res.status === 401 ? 'non_connecte' : res.status === 403 ? 'pas_admin' : 'mistral_erreur')
    throw new DictationError(code)
  }
  const raw = (d.text ?? '').trim()
  const { texte, corrections } = cleanDetail(raw)
  if (!texte) throw new DictationError('vide')
  return { text: texte, raw, corrections, restantMois: d.restant_mois, restantJour: d.restant_jour }
}
