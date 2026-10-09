import { useEffect, useState } from 'react'

/*
 * Fenêtre de confirmation intégrée à l'app.
 * On n'utilise pas window.confirm / alert : certains navigateurs intégrés et PWA
 * les bloquent (ils répondent « Annuler » sans rien afficher).
 */

type Style = 'primary' | 'danger' | 'ghost'
export interface Choice<T extends string> {
  value: T
  label: string
  style?: Style
}

type Request = { message: string; choices: Choice<string>[]; resolve: (v: string | null) => void }

let current: Request | null = null
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

/** Propose plusieurs choix ; renvoie la valeur choisie, ou null si la fenêtre est fermée. */
export function choose<T extends string>(message: string, choices: Choice<T>[]): Promise<T | null> {
  return new Promise((resolve) => {
    current?.resolve(null)
    current = { message, choices, resolve: (v) => resolve(v as T | null) }
    emit()
  })
}

/** Demande une confirmation ; renvoie true si l'utilisateur valide. */
export async function ask(message: string, opts: { ok?: string; danger?: boolean } = {}): Promise<boolean> {
  const r = await choose(message, [
    { value: 'cancel', label: 'Annuler', style: 'ghost' },
    { value: 'ok', label: opts.ok ?? 'Confirmer', style: opts.danger ?? true ? 'danger' : 'primary' },
  ])
  return r === 'ok'
}

/** Simple message d'information (remplace alert). */
export async function inform(message: string): Promise<void> {
  await choose(message, [{ value: 'ok', label: 'OK', style: 'primary' }])
}

const STYLE: Record<Style, string> = {
  primary: 'btn-primary',
  danger: 'btn bg-red-600 text-white hover:bg-red-500',
  ghost: 'btn-ghost',
}

export function ConfirmHost() {
  const [, force] = useState(0)
  useEffect(() => {
    const l = () => force((n) => n + 1)
    listeners.add(l)
    return () => {
      listeners.delete(l)
    }
  }, [])
  useEffect(() => {
    if (!current) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close(null)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  if (!current) return null
  const req = current
  function close(v: string | null) {
    current = null
    emit()
    req.resolve(v)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 sm:items-center" onClick={() => close(null)}>
      <div role="dialog" aria-modal="true" className="card w-full max-w-sm p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <p className="text-sm leading-relaxed">{req.message}</p>
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          {req.choices.map((c, i) => (
            <button key={c.value} autoFocus={i === req.choices.length - 1} className={STYLE[c.style ?? 'primary']} onClick={() => close(c.value)}>
              {c.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

// ---------- Garde « modifications non enregistrées » ----------

type Guard = () => Promise<boolean>
let guard: Guard | null = null

/** Un écran avec une saisie en cours s'enregistre ici ; les liens de navigation le consultent avant de partir. */
export function setLeaveGuard(g: Guard | null) {
  guard = g
}

/** Retire `g` s'il est toujours la garde en place (un autre écran a pu poser la sienne entre-temps). */
export function releaseLeaveGuard(g: Guard) {
  if (guard === g) guard = null
}

/** true si on peut quitter l'écran courant (rien en cours, ou l'utilisateur a choisi). */
export async function canLeave(): Promise<boolean> {
  return guard ? guard() : true
}

// Écrans avec une saisie non enregistrée en ce moment (une mise à jour de l'appli attend qu'il n'y en ait plus).
let unsaved = 0

/** Saisie non enregistrée : le navigateur prévient avant de fermer l'onglet, et l'appli ne se recharge pas. */
export function useUnsaved(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return
    unsaved++
    const warn = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => {
      unsaved--
      window.removeEventListener('beforeunload', warn)
    }
  }, [dirty])
}

/** Une saisie est-elle en cours (non enregistrée, ou champ en cours de frappe) ? */
export function hasUnsaved() {
  const el = document.activeElement
  const typing = !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || (el as HTMLElement).isContentEditable)
  return unsaved > 0 || typing || current !== null
}
