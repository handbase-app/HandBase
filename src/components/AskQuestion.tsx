import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { db, POSITIONS, today } from '../db'
import { sendQuestionRequest, useDictation } from '../dictation/useDictation'
import { DictationError, ERROR_TEXT, MAX_PHRASE } from '../dictation/transcribe'
import { buildQuestionSchema, QUESTION_HINT } from '../recipe'
import { MicStatus, useMicRecorder } from './MicButton'
import { Icon } from './ui'

/*
 * « Poser une question » au bilan de détection : le coach touche « micro ✨ Poser une question » et parle (« les joueuses
 * 2011 vues une seule fois cette saison, par département »), ou tape sa question (ordinateur). La phrase et la
 * DESCRIPTION de la recette (src/recipe.ts : clés, opérateurs, postes, catégories et critères) partent à la fonction
 * « transcrire » (?mode=question) ; elle rend une recette brute, que la page de réponse (/bilan/question) revérifie et
 * calcule sur l'appareil. Aucune donnée de joueur ne part ; aucun nom de club, de lieu, de groupe ou d'événement non plus.
 * Disponibilité : useDictation().questionReady (administrateurs, fonction présente, réglage de dictée activé, mode
 * « question » annoncé par la fonction déployée) ; sinon rien ne s'affiche.
 */

export type AskState = { raw: unknown; nonGere: string[]; heard: string }

export function AskQuestion({ className = '' }: { className?: string }) {
  const { questionReady } = useDictation()
  const nav = useNavigate()
  const [text, setText] = useState('')
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const abort = useRef<AbortController | null>(null)
  // Description de la recette : postes, catégories, critères d'avis et mesures (réglages), date du jour.
  const criteria = useLiveQuery(() => db.criteria.toArray(), [], [])
  useEffect(() => () => abort.current?.abort(), [])

  async function ask(phrase: string) {
    const said = phrase.replace(/\s+/g, ' ').trim()
    if (!said || abort.current) return
    setError('')
    setBusy(said)
    const ctrl = new AbortController()
    abort.current = ctrl
    try {
      const schema = buildQuestionSchema({ criteria, positions: POSITIONS, today: today(), regions: [], depts: [], clubs: [], groups: [], events: [] })
      const ans = await sendQuestionRequest(said, schema, ctrl.signal)
      if (ctrl.signal.aborted) return
      setText('')
      // La page de réponse relit la recette avec les listes de l'appli et la met dans l'adresse.
      nav('/bilan/question', { state: { raw: ans.recette, nonGere: ans.nonGere, heard: said } satisfies AskState })
    } catch (e) {
      if (!(e instanceof DictationError && e.code === 'annule')) setError(e instanceof DictationError ? e.message : ERROR_TEXT.mistral_erreur)
    } finally {
      if (abort.current === ctrl) abort.current = null
      setBusy('')
    }
  }

  const mic = useMicRecorder((t) => void ask(t))
  if (!questionReady) return null
  const rec = mic.phase === 'recording' || mic.phase === 'opening'
  const sending = mic.phase === 'sending' || !!busy

  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          data-noswipe
          aria-label={rec ? 'Poser une question : arrêter et demander' : sending ? 'Question en cours' : 'Poser une question à la voix'}
          aria-pressed={rec}
          title={rec ? 'Arrêter : la question est transcrite puis calculée' : `Touchez et dites par exemple « ${QUESTION_HINT} » ; touchez à nouveau pour finir (ou maintenez pendant que vous parlez)`}
          disabled={sending}
          className={`relative flex min-h-11 shrink-0 touch-none items-center justify-center gap-2 rounded-md border-2 px-3 text-sm font-bold transition select-none [-webkit-touch-callout:none] ${
            rec ? 'border-red-300 bg-red-600 text-white shadow-[0_0_0_4px_rgba(220,38,38,0.35)]' : 'border-accent/60 bg-accent/10 text-fg hover:border-accent active:bg-accent active:text-white'
          } disabled:opacity-70`}
          {...mic.buttonProps}
        >
          {sending ? (
            <span className="h-5 w-5 animate-spin rounded-full border-2 border-current border-t-transparent" />
          ) : rec ? (
            <span className="h-4 w-4 rounded-sm bg-white" />
          ) : (
            <span className="relative">
              <Icon name="mic" className="h-5 w-5" />
              <span className="pointer-events-none absolute -top-1.5 -right-2 text-[10px] leading-none" aria-hidden>
                ✨
              </span>
            </span>
          )}
          <span className="pl-1">{rec ? 'Arrêter' : 'Poser une question'}</span>
        </button>
        <form
          className="flex min-w-0 flex-[1_1_18rem] gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            void ask(text)
          }}
        >
          <input
            className="field min-h-11 min-w-0 flex-1 text-sm"
            placeholder="Ou tapez votre question…"
            aria-label="Poser une question"
            value={text}
            maxLength={MAX_PHRASE}
            disabled={sending || rec}
            onChange={(e) => setText(e.target.value)}
          />
          <button type="submit" className="btn-primary min-h-11 shrink-0 px-3 text-sm" disabled={!text.trim() || sending || rec} aria-label="Demander">
            <span aria-hidden>✨</span>
            <span className="hidden sm:inline">Demander</span>
          </button>
        </form>
      </div>
      {mic.phase !== 'idle' ? (
        <MicStatus mic={mic} dictated={false} />
      ) : busy ? (
        <div className="flex items-center gap-2 text-xs text-muted" role="status">
          <span className="h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent" />
          <span className="min-w-0 flex-1 truncate">« {busy} » : je prépare la réponse…</span>
          <button type="button" className="shrink-0 px-2 py-1 text-[11px] font-bold underline" onClick={() => abort.current?.abort()}>
            Annuler
          </button>
        </div>
      ) : error || mic.error ? (
        <div className="text-[11px] text-red-300" role="alert">
          {error || mic.error}
        </div>
      ) : (
        <div className="text-[10px] text-muted">Réponse calculée sur cet appareil ; seule la phrase est envoyée pour être comprise, jamais les données des joueurs.</div>
      )}
    </div>
  )
}
