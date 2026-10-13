import { useEffect, useRef, useState, type MouseEvent, type PointerEvent, type TextareaHTMLAttributes } from 'react'
import { Icon } from './ui'
import { useDictation, sendDictation } from '../dictation/useDictation'
import { DictationError, ERROR_TEXT, MAX_SECONDS, pickMimeType } from '../dictation/transcribe'
import { insertDictation } from '../dictation/insert'

/*
 * Dictée vocale d'un commentaire (essai, Voxtral par la fonction « transcrire ») :
 *  - toucher le micro pour commencer, toucher à nouveau pour finir ; ou le maintenir pendant qu'on parle (relâcher = fin) ;
 *  - 60 secondes au plus (arrêt automatique) ; le son est envoyé, transcrit, nettoyé et corrigé (vocabulaire du hand),
 *    puis le texte est inséré dans le champ : rien n'est enregistré, le coach relit et valide ;
 *  - le son n'est jamais gardé : le Blob n'existe que le temps de l'envoi.
 * Disponibilité : useDictation() (rôle, appareil, réponse du serveur, réglage de l'appareil).
 */

type MicPhase = 'idle' | 'opening' | 'recording' | 'sending'

/** Au-delà de ce temps d'appui, relâcher le bouton arrête l'enregistrement (mode « maintenir pour parler »). */
const HOLD_MS = 450
const MIN_SECONDS = 0.6

function micError(e: unknown): string {
  const name = (e as { name?: string })?.name
  if (name === 'NotAllowedError' || name === 'SecurityError') return ERROR_TEXT.micro_refuse
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return ERROR_TEXT.micro_absent
  if (name === 'NotReadableError' || name === 'AbortError') return ERROR_TEXT.micro_occupe
  return ERROR_TEXT.micro_refuse
}

type Rec = { stream: MediaStream; recorder: MediaRecorder; chunks: Blob[]; t0: number; timer: number; discard: boolean }

/** Enregistrement et envoi ; `onText` reçoit le texte nettoyé. */
function useMicRecorder(onText: (text: string) => void) {
  const [phase, setPhase] = useState<MicPhase>('idle')
  const [seconds, setSeconds] = useState(0)
  const [error, setError] = useState('')
  const [held, setHeld] = useState(false)
  const rec = useRef<Rec | null>(null)
  const phaseRef = useRef<MicPhase>('idle')
  const stopWanted = useRef(false)
  const alive = useRef(true)
  const abort = useRef<AbortController | null>(null)
  const textCb = useRef(onText)
  useEffect(() => {
    textCb.current = onText
  })
  const go = (p: MicPhase) => {
    phaseRef.current = p
    if (alive.current) setPhase(p)
  }

  async function finish(r: Rec) {
    r.stream.getTracks().forEach((t) => t.stop())
    window.clearInterval(r.timer)
    rec.current = null
    const secs = (performance.now() - r.t0) / 1000
    let blob: Blob | null = new Blob(r.chunks, { type: r.recorder.mimeType || r.chunks[0]?.type || 'audio/webm' })
    r.chunks.length = 0
    if (r.discard || !alive.current) return go('idle')
    if (secs < MIN_SECONDS || !blob.size) {
      setError(ERROR_TEXT.trop_court)
      return go('idle')
    }
    go('sending')
    const ctrl = new AbortController()
    abort.current = ctrl
    try {
      const out = await sendDictation(blob, Math.min(secs, MAX_SECONDS), ctrl.signal)
      blob = null // le son n'est plus référencé
      if (alive.current) textCb.current(out.text)
    } catch (e) {
      if (alive.current && !(e instanceof DictationError && e.code === 'annule'))
        setError(e instanceof DictationError ? e.message : ERROR_TEXT.mistral_erreur)
    } finally {
      blob = null
      abort.current = null
      go('idle')
    }
  }

  async function start() {
    if (phaseRef.current !== 'idle') return
    setError('')
    setSeconds(0)
    stopWanted.current = false
    go('opening')
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
    } catch (e) {
      if (alive.current) setError(micError(e))
      return go('idle')
    }
    if (!alive.current) {
      stream.getTracks().forEach((t) => t.stop())
      return go('idle')
    }
    const mime = pickMimeType(typeof MediaRecorder.isTypeSupported === 'function' ? (t) => MediaRecorder.isTypeSupported(t) : undefined)
    let recorder: MediaRecorder
    try {
      recorder = new MediaRecorder(stream, { ...(mime ? { mimeType: mime } : {}), audioBitsPerSecond: 48_000 })
    } catch {
      try {
        recorder = new MediaRecorder(stream)
      } catch (e) {
        stream.getTracks().forEach((t) => t.stop())
        setError(micError(e))
        return go('idle')
      }
    }
    const r: Rec = { stream, recorder, chunks: [], t0: performance.now(), timer: 0, discard: false }
    recorder.ondataavailable = (ev) => {
      if (ev.data.size) r.chunks.push(ev.data)
    }
    recorder.onstop = () => void finish(r)
    rec.current = r
    recorder.start()
    r.timer = window.setInterval(() => {
      const s = (performance.now() - r.t0) / 1000
      if (alive.current) setSeconds(Math.min(s, MAX_SECONDS))
      if (s >= MAX_SECONDS) stop() // limite de la fonction : 60 s
    }, 250)
    go('recording')
    if (stopWanted.current) stop()
  }

  function stop(discard = false) {
    const r = rec.current
    if (!r) {
      if (phaseRef.current === 'opening') stopWanted.current = true
      return
    }
    if (discard) r.discard = true
    if (r.recorder.state !== 'inactive') r.recorder.stop()
  }

  useEffect(() => {
    alive.current = true
    return () => {
      // Écran quitté : on jette tout (son et envoi en cours).
      alive.current = false
      const r = rec.current
      if (r) {
        r.discard = true
        window.clearInterval(r.timer)
        if (r.recorder.state !== 'inactive') r.recorder.stop()
        r.stream.getTracks().forEach((t) => t.stop())
      }
      abort.current?.abort()
    }
  }, [])

  // Appui : toucher = début / fin ; maintenir = parler tant qu'on appuie.
  const pressAt = useRef(0)
  const pressing = useRef(false)
  const swallowClick = useRef(false)
  const release = () => {
    if (!pressing.current) return
    pressing.current = false
    setHeld(false)
    if (phaseRef.current === 'recording' && performance.now() - pressAt.current > HOLD_MS) stop()
  }
  const buttonProps = {
    onPointerDown: (e: PointerEvent<HTMLButtonElement>) => {
      if (e.button !== 0) return
      e.preventDefault() // garde le curseur du champ (ordinateur)
      swallowClick.current = true
      if (phaseRef.current === 'recording' || phaseRef.current === 'opening') return stop()
      if (phaseRef.current !== 'idle') return
      try {
        e.currentTarget.setPointerCapture(e.pointerId)
      } catch {
        /* sans capture : le relâcher hors du bouton est rattrapé par pointercancel */
      }
      pressAt.current = performance.now()
      pressing.current = true
      void start()
    },
    // Relâché après un appui long, micro déjà ouvert : fin (si le navigateur demandait encore l'autorisation, on passe
    // en mode « toucher pour finir »).
    onPointerUp: () => release(),
    onPointerCancel: () => release(),
    onClick: (e: MouseEvent<HTMLButtonElement>) => {
      // Clavier (Entrée, Espace) : début / fin. Les clics de la souris ou du doigt passent par pointerdown.
      if (swallowClick.current && e.detail !== 0) {
        swallowClick.current = false
        return
      }
      swallowClick.current = false
      if (phaseRef.current === 'idle') void start()
      else stop()
    },
    onContextMenu: (e: MouseEvent) => e.preventDefault(),
  }
  // « Relâchez pour finir » une fois l'appui assez long.
  useEffect(() => {
    if (phase !== 'recording' || !pressing.current) return
    const left = HOLD_MS - (performance.now() - pressAt.current)
    const t = window.setTimeout(() => setHeld(pressing.current), Math.max(left, 0))
    return () => {
      window.clearTimeout(t)
    }
  }, [phase])

  return { phase, seconds, error, held, buttonProps, cancel: () => stop(true), clearError: () => setError('') }
}

const fmtSec = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`

/** Bouton micro (44 px au moins) : rouge vif pendant l'enregistrement, roue pendant la transcription. */
export function MicButton({ mic }: { mic: ReturnType<typeof useMicRecorder> }) {
  const rec = mic.phase === 'recording' || mic.phase === 'opening'
  return (
    <button
      type="button"
      data-noswipe
      aria-label={rec ? 'Finir la dictée' : mic.phase === 'sending' ? 'Transcription en cours' : 'Dicter (toucher pour commencer, ou maintenir)'}
      aria-pressed={rec}
      title={rec ? 'Finir la dictée' : 'Dicter : toucher pour commencer, toucher pour finir (ou maintenir pendant qu’on parle)'}
      disabled={mic.phase === 'sending'}
      className={`flex h-12 w-12 shrink-0 touch-none items-center justify-center rounded-full border-2 transition select-none [-webkit-touch-callout:none] ${
        rec ? 'border-red-300 bg-red-600 text-white shadow-[0_0_0_6px_rgba(220,38,38,0.35)]' : 'border-line bg-panel-2 text-fg hover:border-accent active:bg-accent active:text-white'
      } disabled:opacity-70`}
      {...mic.buttonProps}
    >
      {mic.phase === 'sending' ? (
        <span className="h-5 w-5 animate-spin rounded-full border-2 border-current border-t-transparent" />
      ) : rec ? (
        <span className="h-4 w-4 rounded-sm bg-white" />
      ) : (
        <Icon name="mic" className="h-6 w-6" />
      )}
    </button>
  )
}

/** Ligne d'état sous le champ : enregistrement (gros point rouge, temps), transcription, erreur, rappel de relecture. */
export function MicStatus({ mic, dictated }: { mic: ReturnType<typeof useMicRecorder>; dictated: boolean }) {
  if (mic.phase === 'recording' || mic.phase === 'opening')
    return (
      <div className="flex items-center gap-2 text-xs font-bold" role="status">
        <span className="h-4 w-4 shrink-0 animate-pulse rounded-full bg-red-600 shadow-[0_0_0_3px_rgba(220,38,38,0.3)]" />
        <span className="tabular-nums">
          {mic.phase === 'opening' ? 'Ouverture du micro…' : `${fmtSec(mic.seconds)} / ${fmtSec(MAX_SECONDS)}`}
        </span>
        <span className="min-w-0 flex-1 truncate font-normal text-muted">{mic.held ? 'relâchez pour finir' : 'touchez le micro pour finir'}</span>
        <button type="button" className="shrink-0 px-2 py-1 text-[11px] font-bold text-muted underline" onClick={mic.cancel}>
          Annuler
        </button>
      </div>
    )
  if (mic.phase === 'sending')
    return (
      <div className="text-xs text-muted" role="status">
        transcription…
      </div>
    )
  if (mic.error)
    return (
      <div className="text-[11px] text-red-300" role="alert">
        {mic.error}
      </div>
    )
  if (dictated) return <div className="text-[11px] text-muted">Texte dicté : relisez avant d’enregistrer.</div>
  return null
}

type AreaProps = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'onChange'> & {
  value: string
  onChange: (value: string) => void
}

/**
 * Champ de commentaire avec dictée vocale : un <textarea> ordinaire quand la dictée n'est pas disponible
 * (autre rôle, appareil sans micro, serveur sans la fonction, réglage désactivé, mode local) ; sinon le micro à droite.
 */
export function DictationTextarea({ value, onChange, maxLength, className = '', ...rest }: AreaProps) {
  const { ready } = useDictation()
  const area = useRef<HTMLTextAreaElement>(null)
  const sel = useRef<{ start: number; end: number } | null>(null)
  const caret = useRef<number | null>(null)
  const [dictated, setDictated] = useState<string | null>(null)
  const latest = useRef({ value, onChange })
  useEffect(() => {
    latest.current = { value, onChange }
  })
  const mic = useMicRecorder((text) => {
    const r = insertDictation(latest.current.value, text, sel.current, maxLength)
    if (r.value === latest.current.value) return
    caret.current = sel.current ? r.caret : null
    sel.current = null
    setDictated(r.value)
    latest.current.onChange(r.value)
  })
  // Curseur remis après le texte dicté (seulement si le champ avait le curseur : pas de clavier qui surgit sinon).
  useEffect(() => {
    const el = area.current
    if (caret.current == null || !el) return
    const c = caret.current
    caret.current = null
    if (document.activeElement === el) el.setSelectionRange(c, c)
  })
  const field = <textarea ref={area} className={className} value={value} maxLength={maxLength} onChange={(e) => onChange(e.target.value)} {...rest} />
  if (!ready) return field
  const { onPointerDown, ...others } = mic.buttonProps
  const withSel = {
    ...mic,
    buttonProps: {
      ...others,
      onPointerDown: (e: PointerEvent<HTMLButtonElement>) => {
        // Position du curseur notée avant la dictée, si le champ l'avait ; sinon le texte va à la fin.
        const el = area.current
        if (mic.phase === 'idle') sel.current = el && document.activeElement === el ? { start: el.selectionStart, end: el.selectionEnd } : null
        onPointerDown(e)
      },
    },
  }
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1 [&>textarea]:w-full">{field}</div>
        <MicButton mic={withSel} />
      </div>
      <MicStatus mic={mic} dictated={dictated !== null && dictated === value} />
    </div>
  )
}
