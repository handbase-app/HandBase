import { useEffect, useRef, useState } from 'react'
import { useAiFlight, waitStat } from '../aiWait'
import { etaText, expectedMs, isSlow, progressAt, waitText } from '../attente'

/*
 * Signe d'attente, le même partout (pilule « Demander », bulle ✦ de l'en-tête, carte d'action, dictée) :
 *  - demande à l'assistant : ✦ qui tourne doucement, « Je cherche… » (« Encore un instant… » au-delà de deux fois la durée
 *    habituelle), fine barre qui avance d'après la durée habituelle de cette sorte de demande sur l'appareil (src/aiWait.ts),
 *    « ≈ 2 s » seulement si ce temps est fiable (src/attente.ts) ;
 *  - calcul sur l'appareil (liste qui se recalcule) : la même fine barre, en va-et-vient, seulement si le calcul dure.
 * « Réduire les animations » : ni rotation ni va-et-vient (src/index.css).
 */

export type Wait = { on: boolean; done: boolean; progress: number; text: string; eta: string | null; slow: boolean }

const OFF: Wait = { on: false, done: false, progress: 0, text: '', eta: null, slow: false }

/**
 * État de l'attente pendant que `active` est vrai : début et sorte de la demande en cours (src/aiWait.ts), sinon le moment
 * où l'attente a commencé et `mode`. À la fin, la barre se remplit un court instant (done) puis disparaît.
 */
export function useWait(active: boolean, mode = 'question'): Wait {
  const flight = useAiFlight()
  const [, tick] = useState(0)
  const since = useRef<number | null>(null)
  const [done, setDone] = useState(false)
  if (active && since.current === null) since.current = performance.now()
  useEffect(() => {
    if (active) {
      setDone(false)
      const t = window.setInterval(() => tick((n) => n + 1), 200)
      return () => window.clearInterval(t)
    }
    if (since.current === null) return
    since.current = null
    setDone(true)
    const t = window.setTimeout(() => setDone(false), 350)
    return () => window.clearTimeout(t)
  }, [active])
  if (!active) return done ? { ...OFF, done: true, progress: 1 } : OFF
  const m = flight?.mode ?? mode
  const start = flight?.start ?? since.current ?? performance.now()
  const elapsed = performance.now() - start
  const stat = waitStat(m)
  const expected = expectedMs(stat)
  return { on: true, done: false, progress: progressAt(elapsed, expected), text: waitText(elapsed, expected), eta: etaText(stat, elapsed), slow: isSlow(elapsed, expected) }
}

/** ✦ de l'assistant ; pendant une demande, il tourne doucement (immobile si « Réduire les animations »). */
export function Spark({ busy, className = '' }: { busy?: boolean; className?: string }) {
  return (
    <span className={`shrink-0 text-ai ${busy ? 'wait-spin' : ''} ${className}`} aria-hidden>
      ✦
    </span>
  )
}

/**
 * Fine barre d'attente : `wait` (demande à l'assistant : avance selon la durée habituelle, se remplit à la réponse) ou
 * `calc` (calcul sur l'appareil : va-et-vient, visible seulement s'il dure plus de 150 ms). Rien sinon (place gardée).
 */
export function WaitBar({ wait, calc, className = '' }: { wait?: Wait; calc?: boolean; className?: string }) {
  const show = !!wait && (wait.on || wait.done)
  return (
    <div className={`pointer-events-none h-[3px] overflow-hidden rounded-full ${show || calc ? 'bg-ai/15' : ''} ${calc && !show ? 'wait-late' : ''} ${className}`} aria-hidden>
      {show ? (
        <div className="wait-bar h-full w-full rounded-full bg-ai" style={{ transform: `scaleX(${wait!.progress.toFixed(3)})`, opacity: wait!.done ? 0 : 1 }} />
      ) : calc ? (
        <div className="wait-slide h-full w-2/5 rounded-full bg-ai" />
      ) : null}
    </div>
  )
}

/**
 * Ligne d'attente d'une demande à l'assistant hors de la pilule (carte d'action, micro du bilan sur téléphone, dictée d'un
 * commentaire) : ✦ qui tourne, texte, « ≈ 2 s » si fiable, « Annuler », et la fine barre dessous.
 */
export function WaitLine({ wait, label, onCancel, className = '' }: { wait: Wait; label?: string; onCancel?: () => void; className?: string }) {
  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      <div className="flex min-h-9 items-center gap-2 text-xs text-muted" role="status">
        <Spark busy={wait.on} />
        <span className="min-w-0 flex-1 truncate">
          {wait.slow || !label ? wait.text || 'Je cherche…' : label}
          {wait.eta && <span className="ml-1.5 tabular-nums opacity-80">{wait.eta}</span>}
        </span>
        {onCancel && (
          <button type="button" className="min-h-9 shrink-0 px-2 text-[11px] font-bold underline" onClick={onCancel}>
            Annuler
          </button>
        )}
      </div>
      <WaitBar wait={wait} />
    </div>
  )
}
