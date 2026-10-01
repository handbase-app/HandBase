import { useEffect, useState } from 'react'

/*
 * Fenêtre de confirmation intégrée à l'app.
 * On n'utilise pas window.confirm / alert : certains navigateurs intégrés et PWA
 * les bloquent (ils répondent « Annuler » sans rien afficher).
 */

type Request = { message: string; ok: string; danger: boolean; cancel: boolean; resolve: (v: boolean) => void }

let current: Request | null = null
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

/** Demande une confirmation ; renvoie true si l'utilisateur valide. */
export function ask(message: string, opts: { ok?: string; danger?: boolean } = {}): Promise<boolean> {
  return new Promise((resolve) => {
    current?.resolve(false)
    current = { message, ok: opts.ok ?? 'Confirmer', danger: opts.danger ?? true, cancel: true, resolve }
    emit()
  })
}

/** Simple message d'information (remplace alert). */
export function inform(message: string): Promise<void> {
  return new Promise((resolve) => {
    current?.resolve(false)
    current = { message, ok: 'OK', danger: false, cancel: false, resolve: () => resolve() }
    emit()
  })
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
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close(false)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  if (!current) return null
  const req = current
  function close(v: boolean) {
    current = null
    emit()
    req.resolve(v)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 sm:items-center" onClick={() => close(false)}>
      <div role="dialog" aria-modal="true" className="card w-full max-w-sm p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <p className="text-sm leading-relaxed">{req.message}</p>
        <div className="mt-5 flex justify-end gap-2">
          {req.cancel && (
            <button className="btn-ghost" onClick={() => close(false)}>
              Annuler
            </button>
          )}
          <button autoFocus className={req.danger ? 'btn bg-red-600 text-white hover:bg-red-500' : 'btn-primary'} onClick={() => close(true)}>
            {req.ok}
          </button>
        </div>
      </div>
    </div>
  )
}
