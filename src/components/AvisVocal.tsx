import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from './ui'
import { MicStatus, useMicRecorder } from './MicButton'
import { sendAvisRequest, useDictation } from '../dictation/useDictation'
import { DictationError, ERROR_TEXT } from '../dictation/transcribe'
import { buildAvisPayload, droppedText, interpretAvis, mergeComment, type AvisState, type AvisSuggestion } from '../dictation/avis'
import type { Criterion, Position } from '../db'

/*
 * « Avis vocal » (essai) sur l'écran de notation : le coach parle librement du joueur, l'appli PROPOSE des notes et des
 * commentaires (fonction « transcrire » : dictée, puis ?mode=avis ; relecture dans src/dictation/avis.ts).
 *  - les notes proposées sont mises en évidence sur la fiche (contour vif, ✨) avec le passage dicté en dessous ;
 *  - toucher la note proposée l'accepte, une autre note la remplace, ✕ l'écarte ; « Tout accepter » / « Tout ignorer » ;
 *  - Points forts / Axes proposés : à ajouter d'un toucher au commentaire (qui reste modifiable) ;
 *  - rien n'est enregistré : le coach relit et enregistre comme d'habitude, l'avis reste le sien.
 * Disponible comme la dictée (administrateurs, fonction présente, réglage activé) et seulement si la fonction connaît « avis ».
 */

/** Le bouton « Avis vocal », l'état de l'analyse et le résumé des propositions (en haut de la fiche). */
export function AvisVocal({
  playerId,
  position,
  criteria,
  current,
  state,
  setState,
  acceptAll,
}: {
  playerId: string
  position?: Position
  criteria: Criterion[]
  /** Saisie en cours : une proposition déjà identique (même note, commentaire déjà présent) n'est pas reproposée. */
  current: { scores?: Record<string, number | string>; strengths?: string; improvements?: string }
  state: AvisState | null
  setState: (s: AvisState | null) => void
  acceptAll: () => void
}) {
  const { avisReady } = useDictation()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const abort = useRef<AbortController | null>(null)
  const latest = useRef({ playerId, position, criteria, current, setState })
  useEffect(() => {
    latest.current = { playerId, position, criteria, current, setState }
  })
  useEffect(() => {
    return () => {
      abort.current?.abort()
    }
  }, [])

  async function analyse(text: string) {
    if (abort.current) return
    const { playerId: pid, position: pos, criteria: cs } = latest.current
    const payload = buildAvisPayload(cs, pos)
    setError('')
    setBusy(true)
    const ctrl = new AbortController()
    abort.current = ctrl
    try {
      const ans = await sendAvisRequest(text, payload.criteres, ctrl.signal)
      // Autre joueur affiché entre-temps : la réponse ne le concerne pas.
      if (ctrl.signal.aborted || latest.current.playerId !== pid) return
      const result = interpretAvis(ans.raw, payload, text)
      const cur = latest.current.current
      latest.current.setState({
        playerId: pid,
        transcript: text,
        result,
        pending: result.suggestions.filter((s) => cur.scores?.[s.criterionId] !== s.value).map((s) => s.criterionId),
        strengths: !!result.pointsForts && mergeComment(cur.strengths, result.pointsForts) !== (cur.strengths ?? ''),
        improvements: !!result.axes && mergeComment(cur.improvements, result.axes) !== (cur.improvements ?? ''),
      })
    } catch (e) {
      if (!(e instanceof DictationError && e.code === 'annule')) setError(e instanceof DictationError ? e.message : ERROR_TEXT.mistral_erreur)
    } finally {
      if (abort.current === ctrl) abort.current = null
      setBusy(false)
    }
  }

  const mic = useMicRecorder((text) => void analyse(text))
  // Commandes flottantes : on parle en faisant défiler les critères, le haut de la fiche (bouton, propositions) sort de
  // l'écran. « Terminer » pendant l'enregistrement, « Tout accepter / Tout ignorer » ensuite, en bas à droite.
  const root = useRef<HTMLDivElement>(null)
  const [topVisible, setTopVisible] = useState(true)
  useEffect(() => {
    const el = root.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver(([e]) => setTopVisible(e.isIntersecting))
    io.observe(el)
    return () => io.disconnect()
  })
  const usable = criteria.length > 0 && buildAvisPayload(criteria, position).criteres.length > 0
  if (!avisReady || !usable) return null

  const rec = mic.phase === 'recording' || mic.phase === 'opening'
  const working = mic.phase === 'sending' || busy
  const mine = state?.playerId === playerId ? state : null
  const left = mine ? mine.pending.length + (mine.strengths ? 1 : 0) + (mine.improvements ? 1 : 0) : 0
  const n = mine?.result.suggestions.length ?? 0

  return (
    <div ref={root} className="flex flex-col gap-2" data-noswipe>
      <div className="flex items-center gap-3">
        <button
          type="button"
          aria-pressed={rec}
          aria-label={rec ? 'Finir l’avis vocal' : 'Avis vocal : parler du joueur pour obtenir des notes proposées'}
          title="Parlez librement du joueur : je propose des notes, vous validez (toucher pour commencer et pour finir, ou maintenir)"
          disabled={working}
          className={`flex min-h-12 shrink-0 touch-none items-center gap-2 rounded-full border-2 px-4 text-sm font-extrabold transition select-none [-webkit-touch-callout:none] disabled:opacity-70 ${
            rec ? 'border-red-300 bg-red-600 text-white shadow-[0_0_0_6px_rgba(220,38,38,0.35)]' : 'border-suggest bg-suggest-soft text-fg hover:brightness-110'
          }`}
          {...mic.buttonProps}
        >
          {working ? (
            <span className="h-5 w-5 animate-spin rounded-full border-2 border-current border-t-transparent" />
          ) : rec ? (
            <span className="h-4 w-4 rounded-sm bg-white" />
          ) : (
            <Icon name="mic" className="h-5 w-5" />
          )}
          {rec ? 'Terminer' : '✨ Avis vocal'}
        </button>
        {!rec && !working && <span className="min-w-0 text-[11px] text-muted">Parlez du joueur : je propose des notes, vous validez.</span>}
      </div>
      {!topVisible &&
        (rec || working || left > 0) &&
        createPortal(
          <div data-noswipe className="fixed right-4 bottom-[calc(var(--nav-b)+4.5rem+var(--save-extra,0px))] z-40 flex items-center gap-2">
            {rec ? (
              <button
                type="button"
                onClick={() => mic.finish()}
                aria-label="Finir l’avis vocal"
                className="flex min-h-12 items-center gap-2 rounded-full border-2 border-red-300 bg-red-600 px-4 text-sm font-extrabold text-white shadow-[0_0_0_6px_rgba(220,38,38,0.35)]"
              >
                <span className="h-4 w-4 rounded-sm bg-white" />
                Terminer · {Math.floor(mic.seconds)} s
              </button>
            ) : working ? (
              <span className="flex min-h-12 items-center gap-2 rounded-full border-2 border-suggest bg-bg px-4 text-sm font-bold shadow-lg" role="status">
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                Analyse…
              </span>
            ) : (
              <>
                <button type="button" className="min-h-12 rounded-full border-2 border-suggest bg-bg px-4 text-sm font-extrabold shadow-lg" onClick={acceptAll}>
                  ✨ Tout accepter
                </button>
                <button type="button" className="min-h-12 rounded-full border border-line bg-bg px-4 text-sm font-bold shadow-lg" onClick={() => setState(null)}>
                  Tout ignorer
                </button>
              </>
            )}
          </div>,
          document.body,
        )}
      {rec || mic.phase === 'sending' ? (
        <MicStatus mic={mic} dictated={false} />
      ) : busy ? (
        <div className="flex items-center gap-2 text-xs text-muted" role="status">
          <span className="min-w-0 flex-1">Je cherche les critères dont vous parlez…</span>
          <button type="button" className="min-h-11 shrink-0 px-2 text-[11px] font-bold underline" onClick={() => abort.current?.abort()}>
            Annuler
          </button>
        </div>
      ) : error || mic.error ? (
        <div className="text-[11px] text-red-300" role="alert">
          {error || mic.error}
        </div>
      ) : null}

      {mine && !working && !rec && (
        <div className="flex flex-col gap-1.5 rounded-lg border-2 border-suggest bg-suggest-soft p-2.5 text-xs" role="status">
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              {n > 0 ? (
                <b>
                  ✨ {n} note{n > 1 ? 's' : ''} proposée{n > 1 ? 's' : ''}
                  {mine.pending.length < n && ` · ${mine.pending.length} en attente`}
                </b>
              ) : (
                <b>Aucune note proposée : je n’ai reconnu aucun critère de la fiche.</b>
              )}
              {left > 0 && (
                <div className="mt-0.5 text-[11px] text-muted">
                  {mine.pending.length > 0 && 'Touchez la note en surbrillance pour l’accepter, ou choisissez-en une autre. '}
                  {(mine.strengths || mine.improvements) && 'Commentaires proposés plus bas. '}
                  Rien n’est enregistré avant « Enregistrer ».
                </div>
              )}
              {left === 0 && n > 0 && <div className="mt-0.5 text-[11px] text-muted">Propositions traitées : relisez, puis enregistrez.</div>}
            </div>
            <button
              type="button"
              className="-m-1.5 flex h-11 w-11 shrink-0 items-center justify-center text-muted hover:text-fg"
              aria-label="Fermer les propositions"
              onClick={() => setState(null)}
            >
              ✕
            </button>
          </div>
          {left > 0 && (
            <div className="flex gap-2">
              <button type="button" className="btn-ghost min-h-11 flex-1 px-2 text-xs" onClick={acceptAll}>
                Tout accepter
              </button>
              <button type="button" className="btn-ghost min-h-11 flex-1 px-2 text-xs" onClick={() => setState(null)}>
                Tout ignorer
              </button>
            </div>
          )}
          {mine.result.ambigus.map((a) => (
            <div key={a} className="text-[11px] text-muted">
              Je n’ai pas su choisir : {a}
            </div>
          ))}
          {mine.result.dropped.length > 0 && <div className="text-[11px] text-muted">{droppedText(mine.result.dropped)}</div>}
          <details className="text-[11px] text-muted">
            <summary className="cursor-pointer py-1">Ce que j’ai entendu</summary>
            <p className="italic">« {mine.transcript} »</p>
          </details>
        </div>
      )}
    </div>
  )
}

/** Sous un critère : la note proposée, le passage dicté qui la justifie, et ✕ pour l'écarter. */
export function SuggestionNote({ s, onDismiss }: { s: AvisSuggestion; onDismiss: () => void }) {
  return (
    <div className="flex w-full items-start gap-1" data-noswipe>
      <div className="min-w-0 flex-1 pt-1 text-[11px]">
        <span className="font-bold text-suggest">✨ Proposé : {s.value}</span>
        <span className="italic text-muted"> · « {s.quote} »</span>
      </div>
      <button
        type="button"
        className="-my-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-muted hover:text-fg"
        aria-label={`Écarter la note proposée pour ${s.label}`}
        title="Écarter cette proposition"
        onClick={onDismiss}
      >
        ✕
      </button>
    </div>
  )
}

/** Au-dessus d'un commentaire : le texte proposé, à ajouter d'un toucher (il reste modifiable dans le champ) ou à écarter. */
export function CommentProposal({ text, onAdd, onDismiss }: { text: string; onAdd: () => void; onDismiss: () => void }) {
  return (
    <div className="mb-1.5 flex items-start gap-1 rounded-md border-2 border-suggest bg-suggest-soft p-1.5 pl-2" data-noswipe>
      <div className="min-w-0 flex-1 py-1 text-xs">
        <span className="font-bold text-suggest">✨ Proposé : </span>
        <span className="italic">{text}</span>
      </div>
      <button type="button" className="btn-ghost min-h-11 shrink-0 px-3 text-xs" onClick={onAdd}>
        Ajouter
      </button>
      <button
        type="button"
        className="flex h-11 w-11 shrink-0 items-center justify-center text-muted hover:text-fg"
        aria-label="Écarter ce commentaire proposé"
        onClick={onDismiss}
      >
        ✕
      </button>
    </div>
  )
}
