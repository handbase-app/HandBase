// Disponibilité de la dictée vocale dans l'appli : un seul point de décision.
//  1. le rôle : can.dictate(role) (src/roles.ts) ;
//  2. l'appareil : getUserMedia et MediaRecorder présents ;
//  3. le serveur : un GET à la fonction « transcrire », une fois par session et par compte (gardé en sessionStorage).
//     Sur un serveur sans la fonction (prod), elle répond « absent » : le bouton ne s'affiche pas, sans message d'erreur ;
//  4. le réglage de l'appareil « Dictée vocale (essai) » (Réglages), activé par défaut, gardé en localStorage.
// Sans serveur (mode local, version d'essai) : jamais disponible, aucun appel.

import { useEffect, useState } from 'react'
import { supabase } from '../sync'
import { can, useRole } from '../roles'
import { DictationError, requestAccess, transcribe, understandFilters, type Access, type AccessStatus, type Endpoint, type FilterAnswer, type Transcript } from './transcribe'

const baseUrl = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.replace(/\/+$/, '')
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined
const ACCESS_KEY = 'handbase.dictation.access'
const SETTING_KEY = 'handbase.dictation'
/** Réponses gardées pour la session ; les autres (réseau, session expirée) sont redemandées un peu plus tard. */
const LASTING: AccessStatus[] = ['ok', 'absent', 'pas_admin', 'sans_cle']
const RETRY_MS = 60_000

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

function remember(uid: string, value: Access) {
  access = { uid, value, at: Date.now() }
  try {
    if (LASTING.includes(value.status)) sessionStorage.setItem(ACCESS_KEY, JSON.stringify({ uid, value }))
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

/** Demande l'accès au serveur si on ne le connaît pas déjà pour ce compte (une fois par session). */
function ensureAccess(): Promise<void> {
  pending ??= (async () => {
    try {
      const ep = await endpoint()
      if (!ep) return
      if (access?.uid === ep.uid && (LASTING.includes(access.value.status) || Date.now() - access.at < RETRY_MS)) return
      try {
        const saved = JSON.parse(sessionStorage.getItem(ACCESS_KEY) ?? 'null') as { uid: string; value: Access } | null
        if (saved?.uid === ep.uid && LASTING.includes(saved.value.status)) {
          access = { ...saved, at: Date.now() }
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

/** Envoie le son à la fonction ; met à jour l'accès connu (quotas, accès retiré). Le Blob n'est pas gardé. */
export async function sendDictation(blob: Blob, seconds: number, signal?: AbortSignal): Promise<Transcript> {
  const ep = await endpoint()
  if (!ep) throw new DictationError('non_connecte')
  try {
    const r = await transcribe(ep, blob, seconds, signal)
    if (access?.uid === ep.uid) remember(ep.uid, { ...access.value, restantMois: r.restantMois, restantJour: r.restantJour })
    return r
  } catch (e) {
    const code = e instanceof DictationError ? e.code : ''
    const lost: Record<string, AccessStatus> = { pas_admin: 'pas_admin', absent: 'absent', cle_absente: 'sans_cle' }
    if (lost[code]) remember(ep.uid, { status: lost[code] })
    if (code === 'quota_atteint' && access?.uid === ep.uid) remember(ep.uid, { ...access.value, restantMois: 0 })
    throw e
  }
}

/** Recherche de joueurs en langage naturel : la phrase, le schéma et les filtres actifs seulement (src/voiceSearch.ts). */
export async function sendFilterRequest(phrase: string, schema: unknown, actuels: Record<string, unknown>, signal?: AbortSignal): Promise<FilterAnswer> {
  const ep = await endpoint()
  if (!ep) throw new DictationError('non_connecte')
  try {
    const r = await understandFilters(ep, phrase, schema, actuels, signal)
    if (access?.uid === ep.uid) remember(ep.uid, { ...access.value, restantMois: r.restantMois, restantJour: r.restantJour })
    return r
  } catch (e) {
    const code = e instanceof DictationError ? e.code : ''
    const lost: Record<string, AccessStatus> = { pas_admin: 'pas_admin', absent: 'absent', cle_absente: 'sans_cle' }
    if (lost[code]) remember(ep.uid, { status: lost[code] })
    if (code === 'quota_atteint' && access?.uid === ep.uid) remember(ep.uid, { ...access.value, restantMois: 0 })
    throw e
  }
}

/**
 * État de la dictée pour l'écran courant.
 *  - allowed : rôle, appareil et serveur configuré (avant la réponse du serveur) ;
 *  - available : en plus, le serveur a dit oui (le réglage de l'appareil s'affiche alors) ;
 *  - ready : en plus, le réglage est activé (le bouton micro s'affiche) ;
 *  - searchReady : en plus, la fonction sait traduire une phrase en filtres (recherche vocale de la liste Joueurs).
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
    if (allowed) void ensureAccess()
  }, [allowed])
  const available = allowed && access?.value.status === 'ok'
  const ready = available && enabled
  return { allowed, available, ready, searchReady: ready && !!access?.value.filtres, enabled, access: allowed ? access?.value : undefined, setEnabled: setDictationEnabled }
}
