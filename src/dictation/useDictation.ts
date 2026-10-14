// Disponibilité de la dictée vocale dans l'appli : un seul point de décision.
//  1. le rôle : can.dictate(role) (src/roles.ts) ;
//  2. l'appareil : getUserMedia et MediaRecorder présents ;
//  3. le serveur : un GET à la fonction « transcrire » (accès, quotas et MODES connus de la version déployée), gardé en
//     sessionStorage et RAFRAÎCHI : toutes les 10 minutes, au retour sur l'onglet s'il date de plus de 10 minutes, et tout
//     de suite quand un appel répond « mode inconnu » (fonction redéployée plus ancienne ou plus récente que l'appli).
//     Sur un serveur sans la fonction (prod), elle répond « absent » : le bouton ne s'affiche pas, sans message d'erreur ;
//  4. le réglage de l'appareil « Dictée vocale (essai) » (Réglages), activé par défaut, gardé en localStorage.
// Sans serveur (mode local, version d'essai) : jamais disponible, aucun appel.

import { useEffect, useState } from 'react'
import { supabase } from '../sync'
import { can, useRole } from '../roles'
import { understandAvis, type AvisAnswer, type AvisCritere } from './avis'
import {
  DictationError,
  requestAccess,
  transcribe,
  understandFilters,
  understandQuestion,
  understandSql,
  type Access,
  type AccessStatus,
  type Endpoint,
  type FilterAnswer,
  type QuestionAnswer,
  type SqlAnswer,
  type SqlRetry,
  type Transcript,
} from './transcribe'

const baseUrl = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.replace(/\/+$/, '')
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined
const ACCESS_KEY = 'handbase.dictation.access'
const SETTING_KEY = 'handbase.dictation'
/** Réponses gardées (10 minutes, CAPS_TTL) ; les autres (réseau, session expirée) sont redemandées un peu plus tard. */
const LASTING: AccessStatus[] = ['ok', 'absent', 'pas_admin', 'sans_cle']
const RETRY_MS = 60_000
/** Durée de vie des capacités connues (modes de la fonction) : au-delà, redemandées (intervalle, retour sur l'onglet). */
export const CAPS_TTL = 10 * 60_000

export const recorderSupported = () =>
  typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== 'undefined'

let access: { uid: string; value: Access; at: number } | null = null
let pending: Promise<void> | null = null
let enabled = readSetting()
const listeners = new Set<() => void>()
const notify = () => listeners.forEach((l) => l())

function readSetting(): boolean {
  try {
    return localStorage.getItem(SETTING_KEY) !== 'off'
  } catch {
    return true
  }
}

export function setDictationEnabled(on: boolean) {
  enabled = on
  try {
    if (on) localStorage.removeItem(SETTING_KEY)
    else localStorage.setItem(SETTING_KEY, 'off')
  } catch {
    /* stockage indisponible : réglage gardé jusqu'au rechargement */
  }
  notify()
}

/** Réponse encore valable ? (capacités de moins de 10 minutes ; erreur passagère : moins d'une minute) */
export const accessFresh = (a: { value: Access; at: number } | null, now = Date.now()) =>
  !!a && now - a.at < (LASTING.includes(a.value.status) ? CAPS_TTL : RETRY_MS)

/** Mise à jour des quotas après un appel : l'âge des capacités ne change pas (elles ne sont pas relues). */
function remember(uid: string, value: Access, at = Date.now()) {
  access = { uid, value, at }
  try {
    if (LASTING.includes(value.status)) sessionStorage.setItem(ACCESS_KEY, JSON.stringify({ uid, value, at }))
    else sessionStorage.removeItem(ACCESS_KEY)
  } catch {
    /* stockage indisponible */
  }
  notify()
}

async function endpoint(): Promise<(Endpoint & { uid: string }) | null> {
  if (!supabase || !baseUrl) return null
  const { data } = await supabase.auth.getSession()
  const s = data.session
  if (!s?.access_token) return null
  const headers: Record<string, string> = { Authorization: `Bearer ${s.access_token}` }
  if (anonKey) headers.apikey = anonKey
  return { url: `${baseUrl}/functions/v1/transcrire`, headers, uid: s.user.id }
}

/**
 * Demande l'accès (et les modes) au serveur si on ne le connaît pas pour ce compte ou s'il date de plus de 10 minutes.
 * Pendant la nouvelle demande, l'ancienne réponse reste affichée (pas de bouton qui disparaît puis revient).
 */
function ensureAccess(): Promise<void> {
  pending ??= (async () => {
    try {
      const ep = await endpoint()
      if (!ep) return
      if (access?.uid === ep.uid && accessFresh(access)) return
      try {
        const saved = JSON.parse(sessionStorage.getItem(ACCESS_KEY) ?? 'null') as { uid: string; value: Access; at?: number } | null
        if (saved?.uid === ep.uid && LASTING.includes(saved.value.status) && typeof saved.at === 'number' && accessFresh({ value: saved.value, at: saved.at })) {
          access = { uid: saved.uid, value: saved.value, at: saved.at }
          notify()
          return
        }
      } catch {
        /* stockage indisponible */
      }
      remember(ep.uid, await requestAccess(ep))
    } finally {
      pending = null
    }
  })()
  return pending
}

/** Capacités périmées (« mode inconnu » : la fonction déployée n'est pas celle qu'on croyait) : redemandées tout de suite. */
export function invalidateAccess() {
  if (access) access = { ...access, at: 0 }
  try {
    sessionStorage.removeItem(ACCESS_KEY)
  } catch {
    /* stockage indisponible */
  }
  void ensureAccess()
}

/** Erreur d'un appel : accès retiré, quota atteint, mode inconnu (capacités à relire). */
function afterError(uid: string, e: unknown) {
  const code = e instanceof DictationError ? e.code : ''
  const lost: Record<string, AccessStatus> = { pas_admin: 'pas_admin', absent: 'absent', cle_absente: 'sans_cle' }
  if (lost[code]) remember(uid, { status: lost[code] })
  if (code === 'quota_atteint' && access?.uid === uid) remember(uid, { ...access.value, restantMois: 0 }, access.at)
  if (code === 'mode_inconnu') invalidateAccess()
}

/** Quotas rendus par un appel réussi. */
function afterCall(uid: string, r: { restantMois?: number; restantJour?: number }) {
  if (access?.uid === uid) remember(uid, { ...access.value, restantMois: r.restantMois, restantJour: r.restantJour }, access.at)
}

/** Envoie le son à la fonction ; met à jour l'accès connu (quotas, accès retiré). Le Blob n'est pas gardé. */
export async function sendDictation(blob: Blob, seconds: number, signal?: AbortSignal): Promise<Transcript> {
  const ep = await endpoint()
  if (!ep) throw new DictationError('non_connecte')
  try {
    const r = await transcribe(ep, blob, seconds, signal)
    afterCall(ep.uid, r)
    return r
  } catch (e) {
    afterError(ep.uid, e)
    throw e
  }
}

/** Recherche en langage naturel : la phrase, le schéma et les filtres actifs seulement (src/voiceSearch.ts, src/voicePages.ts). */
export async function sendFilterRequest(phrase: string, schema: unknown, actuels: Record<string, unknown>, signal?: AbortSignal, page?: string): Promise<FilterAnswer> {
  const ep = await endpoint()
  if (!ep) throw new DictationError('non_connecte')
  try {
    const r = await understandFilters(ep, phrase, schema, actuels, signal, page)
    afterCall(ep.uid, r)
    return r
  } catch (e) {
    afterError(ep.uid, e)
    throw e
  }
}

/**
 * État de la dictée pour l'écran courant.
 *  - allowed : rôle, appareil et serveur configuré (avant la réponse du serveur) ;
 *  - available : en plus, le serveur a dit oui (le réglage de l'appareil s'affiche alors) ;
 *  - ready : en plus, le réglage est activé (le bouton micro s'affiche) ;
 *  - searchReady : en plus, la fonction sait traduire une phrase en filtres (recherche vocale de la liste Joueurs) ;
 *  - searchModes : modes annoncés par la fonction (recherche vocale des Événements, des Groupes : « filtres_evenements »…) ;
 *  - avisReady : en plus, la fonction sait proposer des notes d'après un avis dicté (écran de notation, src/dictation/avis.ts).
 */
export function useDictation() {
  const role = useRole()
  const [, force] = useState(0)
  const allowed = can.dictate(role) && !!supabase && !!baseUrl && recorderSupported()
  useEffect(() => {
    const l = () => force((n) => n + 1)
    listeners.add(l)
    return () => {
      listeners.delete(l)
    }
  }, [])
  useEffect(() => {
    if (!allowed) return
    void ensureAccess()
    // Capacités rafraîchies toutes les 10 minutes, et au retour sur l'onglet si elles datent de plus de 10 minutes.
    const timer = window.setInterval(() => void ensureAccess(), CAPS_TTL)
    const onVisible = () => document.visibilityState === 'visible' && void ensureAccess()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [allowed])
  const available = allowed && access?.value.status === 'ok'
  const ready = available && enabled
  const searchReady = ready && !!access?.value.filtres
  return {
    allowed,
    available,
    ready,
    searchReady,
    searchModes: (allowed && access?.value.modes) || [],
    avisReady: ready && !!access?.value.avis,
    // « Poser une question » au bilan : comme la recherche vocale, et la fonction déployée annonce « question ».
    questionReady: searchReady && !!access?.value.modes?.includes('question'),
    // Mode avancé de « Poser une question » (requête SQL exécutée sur la copie locale) : la fonction annonce « sql ».
    sqlReady: searchReady && !!access?.value.modes?.includes('question') && !!access?.value.modes?.includes('sql'),
    enabled,
    access: allowed ? access?.value : undefined,
    setEnabled: setDictationEnabled,
  }
}

/** « Poser une question » : la phrase et la description de la recette seulement (src/recipe.ts), jamais de données de joueur. */
export async function sendQuestionRequest(phrase: string, schema: Record<string, string>, signal?: AbortSignal): Promise<QuestionAnswer> {
  const ep = await endpoint()
  if (!ep) throw new DictationError('non_connecte')
  try {
    const r = await understandQuestion(ep, phrase, schema, signal)
    afterCall(ep.uid, r)
    return r
  } catch (e) {
    afterError(ep.uid, e)
    throw e
  }
}

/** « Poser une question », mode avancé : la phrase, la description des tables et (correction) la requête avec l'erreur SQLite. */
export async function sendSqlRequest(phrase: string, schema: Record<string, string>, precedent?: SqlRetry, signal?: AbortSignal): Promise<SqlAnswer> {
  const ep = await endpoint()
  if (!ep) throw new DictationError('non_connecte')
  try {
    const r = await understandSql(ep, phrase, schema, precedent, signal)
    afterCall(ep.uid, r)
    return r
  } catch (e) {
    afterError(ep.uid, e)
    throw e
  }
}

/** « Avis vocal » : le texte dicté et les critères applicables seulement (src/dictation/avis.ts), jamais de données de joueur. */
export async function sendAvisRequest(texte: string, criteres: AvisCritere[], signal?: AbortSignal): Promise<AvisAnswer> {
  const ep = await endpoint()
  if (!ep) throw new DictationError('non_connecte')
  try {
    const r = await understandAvis(ep, texte, criteres, signal)
    afterCall(ep.uid, r)
    return r
  } catch (e) {
    afterError(ep.uid, e)
    throw e
  }
}
