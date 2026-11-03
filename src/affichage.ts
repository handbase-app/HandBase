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
import { parseGroupes, parseGroupesRaw, sameIds, UUID_RE } from './groupRings'
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
 * - Groupes repérés (src/groupRings.ts, 3 au plus ; « handbase.groupesReperes ») : troisième clé `groupes` de la même valeur
 *   (supabase/064_reperer_groupes.sql). Avant 064, le serveur refuse la clé (22023) : la valeur repart sans elle et les
 *   groupes restent sur l'appareil (plus d'essai jusqu'au rechargement). Sans groupe repéré, la clé n'est envoyée que si le
 *   compte en a déjà une (rien ne change pour ceux qui ne s'en servent pas).
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
const GROUPES_KEY = 'handbase.groupesReperes'
let groupes: string[] = readKey(GROUPES_KEY, parseGroupesRaw, [])
const subs = new Set<() => void>()
const emit = () => subs.forEach((f) => f())

function store(p: PictoKind[], s: SousNomKind[]) {
  pictos = p
  sousNom = s
  writeKey(PICTOS_KEY, isDefaultPictos(p) ? null : serializePictos(p))
  writeKey(SOUS_NOM_KEY, isDefaultSousNom(s) ? null : serializeSousNom(s))
  emit()
}

function storeGroupes(g: string[]) {
  groupes = g
  writeKey(GROUPES_KEY, g.length ? JSON.stringify(g) : null)
  emit()
}

function subscribe(f: () => void) {
  subs.add(f)
  // Autre onglet : même réglage.
  const onStorage = (e: StorageEvent) => {
    if (e.key !== PICTOS_KEY && e.key !== SOUS_NOM_KEY && e.key !== GROUPES_KEY && e.key !== null) return
    pictos = readKey(PICTOS_KEY, parsePictos, [...DEFAULT_PICTOS])
    sousNom = readKey(SOUS_NOM_KEY, parseSousNom, [...DEFAULT_SOUS_NOM])
    groupes = readKey(GROUPES_KEY, parseGroupesRaw, [])
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
/** Groupes repérés (identifiants, dans l'ordre du choix). */
export const useGroupesReperes = () => useSyncExternalStore(subscribe, () => groupes)
export const groupesReperes = () => groupes
/** Changement des groupes repérés (hors React : la table des anneaux, src/components/GroupRings.tsx). */
export const onAffichage = (f: () => void) => subscribe(f)

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
export function setGroupesReperes(on: string[] | ((cur: string[]) => string[])) {
  storeGroupes(parseGroupes(typeof on === 'function' ? on(groupes) : on) ?? [])
  schedule()
}

// ---------- Compte ----------

/** Compte dont la valeur a été lue (colonne présente) ; null : pas d'envoi. */
let account: string | null = null
/** Changement pas encore envoyé (hors ligne, ou dans le délai). */
let dirty = false
/** Le compte a déjà une clé `groupes` (après 064) : elle part toujours, même vide. */
let accountGroupes = false
/** Le serveur a refusé la clé `groupes` (avant 064) : plus d'essai jusqu'au rechargement. */
let noGroupesKey = false
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
  const base = affichagePayload(pictos, sousNom)
  // Groupes : identifiants du serveur seulement (forme vérifiée par 064).
  const withG = !noGroupesKey && (groupes.length > 0 || accountGroupes)
  let { error } = await supabase.rpc('hb_set_affichage', { p: withG ? { ...base, groupes: groupes.filter((g) => UUID_RE.test(g)) } : base })
  if (withG && error?.code === '22023') {
    // Avant 064 : la clé est refusée ; le reste part sans elle, les groupes restent sur l'appareil.
    noGroupesKey = true
    ;({ error } = await supabase.rpc('hb_set_affichage', { p: base }))
  } else if (withG && !error) accountGroupes = true
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
  // Groupes repérés du compte (après 064) ; absents : ceux de l'appareil y sont envoyés une fois (s'il y en a).
  const g = raw && typeof raw === 'object' ? parseGroupes((raw as { groupes?: unknown }).groupes) : null
  accountGroupes = !!g
  if (v && !dirty) {
    if (!sameAffichage(v, { pictos, sousNom })) store(v.pictos, v.sousNom)
    if (g && !sameIds(g, groupes)) storeGroupes(g)
    if (g || !groupes.length) return
  } else if (v && sameAffichage(v, { pictos, sousNom }) && (g ? sameIds(g, groupes) : !groupes.length)) return
  dirty = true
  void flush()
}

/** Déconnexion : plus d'envoi (le choix reste sur l'appareil). */
export function forgetAccountAffichage() {
  account = null
  dirty = false
  accountGroupes = false
  clearTimeout(timer)
}
