import { useSyncExternalStore } from 'react'
import { DEFAULT_PICTOS, isDefaultPictos, parsePictos, PICTOS_KEY, serializePictos, type PictoKind } from './pictos'
import {
  affichagePayload,
  DEFAULT_SOUS_NOM,
  isDefaultSousNom,
  parseAffichage,
  parseSousNom,
  sameAffichage,
  serializeSousNom,
  SOUS_NOM_KEY,
  type SousNomKind,
} from './sousNom'
import { spyTarget } from './spy'
import { supabase } from './sync'

/*
 * Affichage des listes de joueurs : pictogrammes au bout des lignes (src/pictos.ts) et « Sous le nom » (src/sousNom.ts).
 * Un seul réglage pour toutes les listes, changé depuis n'importe laquelle et appliqué partout en direct.
 * - Appareil : localStorage (« handbase.pictos », « handbase.sousNom » ; rien tant que c'est le défaut) : marche hors ligne
 *   et avant la connexion.
 * - Compte : hb_profiles.affichage (supabase/063_affichage.sql), lu avec le rôle à la connexion (src/roles.ts, même requête).
 *   S'il y a une valeur, elle gagne ; sinon celle de l'appareil y est envoyée une fois. Chaque changement part 1,5 s après la
 *   dernière bascule (un seul appel, hb_set_affichage), en ligne et connecté seulement ; hors ligne, au retour du réseau.
 *   Pas d'envoi pendant « Voir comme… », ni sans serveur (essai, démonstration : appareil seul).
 */

const readKey = <T>(key: string, parse: (raw: string | null) => T, fallback: T): T => {
  try {
    return parse(localStorage.getItem(key))
  } catch {
    return fallback
  }
}
const writeKey = (key: string, value: string | null) => {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch {
    /* stockage indisponible : le choix vaut jusqu'à la fermeture */
  }
}

let pictos: PictoKind[] = readKey(PICTOS_KEY, parsePictos, [...DEFAULT_PICTOS])
let sousNom: SousNomKind[] = readKey(SOUS_NOM_KEY, parseSousNom, [...DEFAULT_SOUS_NOM])
const subs = new Set<() => void>()
const emit = () => subs.forEach((f) => f())

function store(p: PictoKind[], s: SousNomKind[]) {
  pictos = p
  sousNom = s
  writeKey(PICTOS_KEY, isDefaultPictos(p) ? null : serializePictos(p))
  writeKey(SOUS_NOM_KEY, isDefaultSousNom(s) ? null : serializeSousNom(s))
  emit()
}

function subscribe(f: () => void) {
  subs.add(f)
  // Autre onglet : même réglage.
  const onStorage = (e: StorageEvent) => {
    if (e.key !== PICTOS_KEY && e.key !== SOUS_NOM_KEY && e.key !== null) return
    pictos = readKey(PICTOS_KEY, parsePictos, [...DEFAULT_PICTOS])
    sousNom = readKey(SOUS_NOM_KEY, parseSousNom, [...DEFAULT_SOUS_NOM])
    emit()
  }
  if (subs.size === 1) window.addEventListener('storage', onStorage)
  return () => {
    subs.delete(f)
    if (!subs.size) window.removeEventListener('storage', onStorage)
  }
}

export const usePictos = () => useSyncExternalStore(subscribe, () => pictos)
export const useSousNom = () => useSyncExternalStore(subscribe, () => sousNom)

/** Nouveau choix, ou fonction du choix en cours (bascules rapprochées : chacune part de la précédente). */
type Next<T> = T[] | ((cur: T[]) => T[])
export function setPictos(on: Next<PictoKind>) {
  store(typeof on === 'function' ? on(pictos) : on, sousNom)
  schedule()
}
export function setSousNom(on: Next<SousNomKind>) {
  store(pictos, typeof on === 'function' ? on(sousNom) : on)
  schedule()
}

// ---------- Compte ----------

/** Compte dont la valeur a été lue (colonne présente) ; null : pas d'envoi. */
let account: string | null = null
/** Changement pas encore envoyé (hors ligne, ou dans le délai). */
let dirty = false
let timer: ReturnType<typeof setTimeout> | undefined
const DELAY = 1500

function schedule() {
  if (!supabase) return
  dirty = true
  clearTimeout(timer)
  timer = setTimeout(() => void flush(), DELAY)
}

async function flush() {
  if (!supabase || !dirty || !account || spyTarget()) return
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return // repris au retour du réseau
  const { data } = await supabase.auth.getSession()
  if (data.session?.user.id !== account) return
  dirty = false
  const { error } = await supabase.rpc('hb_set_affichage', { p: affichagePayload(pictos, sousNom) })
  // Fonction absente (avant 063) ou refus : l'appareil garde son choix, on ne réessaie qu'au prochain changement.
  if (error && /fetch|network|Failed/i.test(error.message)) dirty = true
}

if (typeof window !== 'undefined') window.addEventListener('online', () => void flush())

/**
 * Valeur lue sur le compte à la connexion (src/roles.ts, refreshRole) ; `column` faux : la colonne n'existe pas encore
 * (avant 063), rien n'est envoyé. Valeur présente : elle gagne (sauf un changement de l'appareil pas encore envoyé) ;
 * absente : celle de l'appareil est envoyée une fois.
 */
export function applyAccountAffichage(uid: string, raw: unknown, column = true) {
  account = column ? uid : null
  if (!column) return
  const v = parseAffichage(raw)
  if (v && !dirty) {
    if (!sameAffichage(v, { pictos, sousNom })) store(v.pictos, v.sousNom)
    return
  }
  if (!v || !sameAffichage(v, { pictos, sousNom })) {
    dirty = true
    void flush()
  }
}

/** Déconnexion : plus d'envoi (le choix reste sur l'appareil). */
export function forgetAccountAffichage() {
  account = null
  dirty = false
  clearTimeout(timer)
}
