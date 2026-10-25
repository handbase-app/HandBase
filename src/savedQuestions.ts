import { liveQuery } from 'dexie'
import { useSyncExternalStore } from 'react'
import { cleanRecipe, parseSaved, type Recipe, type SavedQuestion, type VarKey } from './recipe'
import type { SqlSpec } from './sqlGuard'
import { db, DEMO, remove, save, saveMany, type SavedQuestionRow } from './db'
import { realUserId } from './roles'
import { serverHasTable, subscribeSync, supabase } from './sync'
import { accountId, cleanName, newLocalId, overflowIds, ownSaved, planMigration, QMAX, storeMode, toRow } from './savedQuestionsCore'

/*
 * « Mes questions » (bilan de détection) et « Mes filtres » (liste Joueurs) : questions enregistrées, relancées sans appel
 * au modèle (la recette suffit ; mode avancé : la requête SQL, recontrôlée et relancée sur la copie locale, sans variables).
 * OÙ ELLES VIVENT (src/savedQuestionsCore.ts, storeMode) :
 *  - sur le COMPTE, dès que le serveur connaît la table (supabase/054_questions_enregistrees.sql) : table synchronisée
 *    « saved_questions » (src/sync.ts, comme les suivis), retrouvées sur tous les appareils du compte ; personnelles (leur
 *    créateur seul les lit, administrateurs compris). À la première synchronisation qui trouve la table, celles de
 *    l'appareil y sont versées (une fois, sans doublon), puis effacées du stockage de l'appareil ;
 *  - sinon SUR CET APPAREIL (localStorage), comme avant : version d'essai sans serveur, démonstration (comptes partagés),
 *    table pas encore créée sur le serveur (repli silencieux).
 * Chaque lecture est revérifiée (parseSaved) ; stockage indisponible (navigation privée) : gardées jusqu'au rechargement.
 */

const KEY = 'handbase.questions'
/** Compte pour lequel les questions de l'appareil ont été versées : elles vivent depuis dans la table synchronisée. */
const DONE_KEY = 'handbase.questions.compte'
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

const store = {
  get: (k: string) => {
    try {
      return localStorage.getItem(k)
    } catch {
      return null
    }
  },
  set: (k: string, v: string | null) => {
    try {
      if (v === null) localStorage.removeItem(k)
      else localStorage.setItem(k, v)
    } catch {
      /* stockage indisponible */
    }
  },
}

// ---------- Sur l'appareil ----------

let cache: SavedQuestion[] | null = null

function readLocal(): SavedQuestion[] {
  if (cache) return cache
  try {
    cache = parseSaved(JSON.parse(store.get(KEY) ?? '[]'))
  } catch {
    cache = []
  }
  return cache
}

function writeLocal(next: SavedQuestion[]) {
  cache = next.slice(0, QMAX)
  store.set(KEY, JSON.stringify(cache))
  emit()
}

if (typeof window !== 'undefined')
  window.addEventListener('storage', (e) => {
    if (e.key !== KEY && e.key !== DONE_KEY) return
    cache = null
    if (e.key === DONE_KEY) check()
    emit()
  })

// ---------- Sur le compte ----------

let mode: 'local' | 'synced' = 'local'
let synced: SavedQuestion[] = []
let watching: { unsubscribe(): void } | null = null
let migrating: Promise<void> | null = null

function watch(uid: string) {
  if (watching) return
  watching = liveQuery(() => db.saved_questions.toArray()).subscribe({
    next: (rows) => {
      synced = ownSaved(rows, uid)
      emit()
    },
    error: (e) => console.error(e),
  })
}

/** Verse au compte les questions de l'appareil (sans doublon), puis passe à la table synchronisée. */
async function migrate(uid: string) {
  const local = readLocal()
  const existing = await db.saved_questions.toArray()
  const rows = planMigration(local, existing, uid)
  if (rows.length) await saveMany<SavedQuestionRow>('saved_questions', rows)
  store.set(DONE_KEY, uid)
  store.set(KEY, null)
  cache = null
}

/** Choisit où vivent les questions (au lancement, puis à chaque synchronisation : la table peut apparaître). */
function check() {
  if (mode === 'synced' || migrating) return
  const uid = realUserId()
  const m = storeMode({ server: !!supabase, demo: DEMO, uid, migratedFor: store.get(DONE_KEY), serverHas: serverHasTable('saved_questions') })
  if (m === 'local' || !uid) return
  if (m === 'synced') {
    mode = 'synced'
    watch(uid)
    emit()
    return
  }
  migrating = migrate(uid)
    .then(() => {
      mode = 'synced'
      watch(uid)
      emit()
    })
    .catch((e) => console.error(e)) // « Voir comme… » (lecture seule) ou base indisponible : réessayé à la synchronisation suivante
    .finally(() => (migrating = null))
}

if (typeof window !== 'undefined' && supabase && !DEMO) {
  subscribeSync(check)
  check()
}

// ---------- Lecture et écriture ----------

const read = () => (mode === 'synced' ? synced : readLocal())

export function useSavedQuestions(): SavedQuestion[] {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => {
        listeners.delete(cb)
      }
    },
    read,
    read,
  )
}

/** Gardées sur le compte (tous ses appareils) plutôt que sur cet appareil seulement. */
export const savedOnAccount = () => mode === 'synced'
/** « de tous vos appareils » / « de cet appareil » (messages de suppression). */
export const savedPlace = () => (mode === 'synced' ? 'de tous vos appareils' : 'de cet appareil')

async function add(q: Omit<SavedQuestion, 'id'>): Promise<SavedQuestion> {
  const localId = newLocalId()
  if (mode === 'synced') {
    const uid = realUserId()
    if (uid) {
      const full = { ...q, id: accountId(uid, localId) }
      for (const id of overflowIds(synced)) await remove('saved_questions', id)
      await save<SavedQuestionRow>('saved_questions', toRow(full))
      return full
    }
  }
  const full = { ...q, id: localId }
  writeLocal([full, ...readLocal()])
  return full
}

export function saveQuestion(name: string, recipe: Recipe, vars: VarKey[], phrase?: string): Promise<SavedQuestion> {
  return add({ name: cleanName(name), recipe, vars, ...(phrase ? { phrase: phrase.slice(0, 300) } : {}), at: Date.now() })
}

/** Question du mode avancé : la requête (déjà contrôlée) et son explication ; relancée telle quelle, sans appel. */
export function saveSqlQuestion(name: string, sql: SqlSpec, phrase?: string): Promise<SavedQuestion> {
  return add({ name: cleanName(name), recipe: cleanRecipe({}), vars: [], ...(phrase ? { phrase: phrase.slice(0, 300) } : {}), at: Date.now(), sql })
}

export async function deleteQuestion(id: string) {
  if (mode === 'synced') return void (await remove('saved_questions', id))
  writeLocal(readLocal().filter((q) => q.id !== id))
}

export async function renameQuestion(id: string, name: string) {
  const n = cleanName(name)
  if (mode === 'synced') {
    const row = await db.saved_questions.get(id)
    if (row && !row.deleted) await save<SavedQuestionRow>('saved_questions', { ...row, name: n })
    return
  }
  writeLocal(readLocal().map((q) => (q.id === id ? { ...q, name: n } : q)))
}

// ---------- Bilan : « Mes questions » ouvertes depuis la barre de question ----------

const OPEN_EVENT = 'handbase:mes-questions'

/**
 * Menu de la barre de question du bilan : ouvre la liste « Mes questions » à l'écran (src/pages/Question.tsx,
 * SavedQuestions) et relance `id` (ou montre ses valeurs à choisir) ; `null` : la liste seule. false : aucune liste à l'écran.
 */
export function openSavedQuestion(id: string | null): boolean {
  const e = new CustomEvent<string | null>(OPEN_EVENT, { detail: id, cancelable: true })
  return !window.dispatchEvent(e)
}

/** La liste « Mes questions » répond à openSavedQuestion (une seule à l'écran à la fois). */
export function onOpenSavedQuestion(handler: (id: string | null) => void) {
  const l = (e: Event) => {
    e.preventDefault()
    handler((e as CustomEvent<string | null>).detail)
  }
  window.addEventListener(OPEN_EVENT, l)
  return () => window.removeEventListener(OPEN_EVENT, l)
}
