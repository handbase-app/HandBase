import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { MicStatus, useMicRecorder } from './MicButton'
import { sendAvisRequest, useDictation } from '../dictation/useDictation'
import { DictationError, ERROR_TEXT } from '../dictation/transcribe'
import { avisProposals, buildAvisPayload, decideAll, droppedText, interpretAvis, mergeComment, type AvisState, type AvisSuggestion } from '../dictation/avis'
import { newId, type Criterion, type Position } from '../db'
import { canLogQuestion, logAvisVocal, logAvisVocalVerdict } from '../questionLog'
import { MAX_COMMENT, VOCAL_VERDICT_LABEL, VOCAL_VERDICTS, type VocalVerdict } from '../questionLogCore'
import { useWait, WaitLine } from './Attente'

/*
 * « Avis vocal » (essai) sur l'écran de notation : le coach parle librement du joueur, l'appli PROPOSE des notes et des
 * commentaires (fonction « transcrire » : dictée, puis ?mode=avis ; relecture dans src/dictation/avis.ts).
 *  - les notes proposées sont mises en évidence sur la fiche (capsule du critère au liseré menthe, note proposée pleine menthe,
 *    étiquette « proposé » : CriterionInput, src/components/ui.tsx) avec le passage dicté en dessous ;
 *  - toucher la note proposée la valide, une autre note la remplace, ✕ l'écarte ; « Tout valider » / « Tout ignorer » ;
 *  - Points forts / Axes proposés : à ajouter d'un toucher au commentaire (qui reste modifiable) ;
 *  - rien n'est enregistré : le coach relit et enregistre comme d'habitude, l'avis reste le sien.
 * Disponible comme la dictée (administrateurs, fonction présente, réglage activé) et seulement si la fonction connaît « avis ».
 * Phase de test : JOURNAL des évaluations vocales (src/questionLog.ts, logAvisVocal ; supabase/050_avis_vocal.sql). Quand le
 * coach a répondu à toutes les notes proposées (une à une, « Tout valider », « Tout ignorer », ✕), une ligne est écrite :
 * la dictée anonymisée, les notes proposées et ce qu'il en a fait (acceptée, modifiée, ignorée). Analyse abandonnée (autre
 * joueur, fermeture) : écrite aussi, les notes encore en attente comptées comme ignorées. Sous les propositions, une barre
 * « Cette proposition : Cohérente · En partie · Pas cohérente » + commentaire facultatif, une fois par analyse : jointe à
 * la ligne si elle n'est pas encore écrite, sinon une ligne d'avis de plus. Jamais rien du joueur. Rien en « Voir comme… ».
 */

/** Le micro « Avis vocal » (dans la barre « Enregistrer »), l'état de l'analyse et le résumé des propositions (en haut de la fiche). */
export function AvisVocal({
  playerId,
  position,
  criteria,
  current,
  state,
  setState,
  acceptAll,
  slot,
}: {
  playerId: string
  position?: Position
  criteria: Criterion[]
  /** Saisie en cours : une proposition déjà identique (même note, commentaire déjà présent) n'est pas reproposée. */
  current: { scores?: Record<string, number | string>; strengths?: string; improvements?: string }
  state: AvisState | null
  setState: (s: AvisState | null) => void
  acceptAll: () => void
  /** Place du micro, à droite de « Enregistrer » (barre du bas de l'écran de notation). */
  slot: HTMLElement | null
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
        id: newId(),
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
  const wait = useWait(busy, 'avis')

  // ---- Journal des évaluations vocales (une ligne par analyse) ----
  const logged = useRef(new Map<string, string>()) // analyse → ligne du journal
  const verdicts = useRef(new Map<string, { verdict: VocalVerdict; comment: string }>()) // appréciation en attente de la ligne
  const keyOf = (s: AvisState) => s.id ?? s.transcript
  const writeLog = useRef((s: AvisState) => {
    const k = keyOf(s)
    if (logged.current.has(k)) return
    const v = verdicts.current.get(k)
    const id = logAvisVocal({ phrase: s.transcript, proposals: avisProposals(s), verdict: v?.verdict, comment: v?.comment })
    logged.current.set(k, id ?? '')
    verdicts.current.delete(k)
  }).current
  // Toutes les notes proposées ont une réponse : la ligne part.
  useEffect(() => {
    if (state && !state.pending.length) writeLog(state)
  }, [state, writeLog])
  // Analyse abandonnée (autre joueur, fermée, nouvelle analyse, écran quitté) : la ligne part aussi.
  const prev = useRef<AvisState | null>(null)
  useEffect(() => {
    const p = prev.current
    if (p && (!state || keyOf(p) !== keyOf(state))) writeLog(p)
    prev.current = state
  }, [state, writeLog])
  useEffect(
    () => () => {
      if (prev.current) writeLog(prev.current)
    },
    [writeLog],
  )
  /** Appréciation du coach : jointe à la ligne pas encore écrite, sinon une ligne d'avis qui la vise. */
  async function sendVerdict(s: AvisState, verdict: VocalVerdict, comment: string): Promise<boolean> {
    const k = keyOf(s)
    const id = logged.current.get(k)
    if (id === undefined) {
      verdicts.current.set(k, { verdict, comment })
      return true
    }
    return id ? logAvisVocalVerdict({ vocalId: id, verdict, comment }) : false
  }
  const ignoreAll = () => state && setState(decideAll(state, 'ignore'))
  // Commandes flottantes : on parle en faisant défiler les critères, les propositions du haut de la fiche sortent de l'écran.
  // « Tout valider / Tout ignorer » en bas à droite (le micro, lui, reste dans la barre « Enregistrer »).
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
    <div ref={root} className="flex flex-col gap-2 empty:hidden" data-noswipe>
      {/* Micro rond dans la barre « Enregistrer », à droite (choix du 31/10 : plus de capsule néon en haut de la fiche ; sous
          le pouce même en bas de la fiche). Enregistrement : rouge qui pulse, carré blanc (arrêter) ; transcription et
          analyse : roue. Toucher pour commencer et pour finir, ou maintenir pour parler. */}
      {slot &&
        createPortal(
          <button
            type="button"
            aria-pressed={rec}
            aria-busy={working || undefined}
            aria-label={rec ? 'Finir l’avis vocal' : working ? 'Avis vocal : analyse en cours' : 'Avis vocal : parler du joueur pour obtenir des notes proposées'}
            title="Avis vocal : parlez librement du joueur, je propose des notes, vous validez (toucher pour commencer et pour finir, ou maintenir)"
            disabled={working}
            data-noswipe
            className={`flex h-11 w-11 shrink-0 touch-none items-center justify-center rounded-full border-[1.5px] transition select-none [-webkit-touch-callout:none] disabled:cursor-wait ${
              rec ? 'animate-pulse border-red-300 bg-red-600 text-white shadow-[0_0_0_4px_rgba(220,38,38,0.35)]' : 'border-line bg-panel text-fg hover:bg-panel-2 active:bg-panel-2'
            }`}
            {...mic.buttonProps}
          >
            {working ? (
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden />
            ) : rec ? (
              <span className="h-3.5 w-3.5 rounded-[2px] bg-white" aria-hidden />
            ) : (
              <MicGlyph />
            )}
          </button>,
          slot,
        )}
      {!topVisible &&
        left > 0 &&
        !rec &&
        !working &&
        createPortal(
          <div data-noswipe className="fixed right-4 bottom-[calc(var(--nav-b)+4.5rem+var(--save-extra,0px))] z-40 flex items-center gap-2">
            <button type="button" className="neon-fill min-h-12 rounded-full px-4 text-sm font-extrabold shadow-[var(--neon-glow)] hover:brightness-105" onClick={acceptAll}>
              ✦ Tout valider
            </button>
            <button type="button" className="min-h-12 rounded-full border-[1.5px] border-line bg-bg px-4 text-sm font-bold shadow-lg" onClick={ignoreAll}>
              Tout ignorer
            </button>
          </div>,
          document.body,
        )}
      {rec || mic.phase === 'sending' ? (
        <MicStatus mic={mic} dictated={false} />
      ) : busy ? (
        <WaitLine wait={wait} label="Je cherche les critères dont vous parlez…" onCancel={() => abort.current?.abort()} />
      ) : error || mic.error ? (
        <div className="text-[11px] text-red-300" role="alert">
          {error || mic.error}
        </div>
      ) : null}

      {mine && !working && !rec && (
        <div className="flex flex-col gap-1.5 rounded-xl border-[1.5px] border-suggest/50 bg-suggest-soft p-2.5 text-xs" role="status">
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              {n > 0 ? (
                <b>
                  <span className="text-suggest" aria-hidden>
                    ✦{' '}
                  </span>
                  {n} note{n > 1 ? 's' : ''} proposée{n > 1 ? 's' : ''}
                  {mine.pending.length < n && ` · ${mine.pending.length} en attente`}
                </b>
              ) : (
                <b>Aucune note proposée : je n’ai reconnu aucun critère de la fiche.</b>
              )}
              {left > 0 && (
                <div className="mt-0.5 text-[11px] text-muted">
                  {mine.pending.length > 0 && 'Touchez la note en menthe pour la valider, ou choisissez-en une autre. '}
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
              <button type="button" className="neon-fill min-h-11 flex-1 rounded-full px-3 text-xs font-extrabold hover:brightness-105" onClick={acceptAll}>
                Tout valider
              </button>
              <button type="button" className="min-h-11 flex-1 rounded-full border-[1.5px] border-line px-3 text-xs font-bold text-fg hover:border-muted" onClick={ignoreAll}>
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
          {canLogQuestion() && <VocalFeedback key={keyOf(mine)} onSend={(v, c) => sendVerdict(mine, v, c)} />}
        </div>
      )}
    </div>
  )
}

/** Sous un critère : la note proposée, le passage dicté qui la justifie, et ✕ pour l'écarter. */
export function SuggestionNote({ s, onDismiss }: { s: AvisSuggestion; onDismiss: () => void }) {
  return (
    <div className="flex w-full max-w-xl items-start gap-1" data-noswipe>
      <div className="min-w-0 flex-1 pt-1 text-[11px]">
        <span className="font-bold text-suggest">✦ Proposé : {s.value}</span>
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
    <div className="mb-1.5 flex items-start gap-1 rounded-xl border-[1.5px] border-suggest/50 bg-suggest-soft p-1.5 pl-2.5" data-noswipe>
      <div className="min-w-0 flex-1 py-1 text-xs">
        <span className="font-bold text-suggest">✦ Proposé : </span>
        <span className="italic">{text}</span>
      </div>
      <button type="button" className="neon-fill min-h-11 shrink-0 rounded-full px-3.5 text-xs font-extrabold hover:brightness-105" onClick={onAdd}>
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

const SHORT: Record<VocalVerdict, string> = VOCAL_VERDICT_LABEL

/** Micro de la pastille (le même dessin que celle de la capsule « Nextar », src/components/Demander.tsx). */
function MicGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
    </svg>
  )
}

/**
 * Appréciation de l'analyse (phase de test, comme les avis sur les réponses : AnswerFeedback.tsx) : « Cette proposition :
 * Cohérente · En partie · Pas cohérente », puis un commentaire facultatif (« ce que j'aurais mis ») et « Envoyer » ;
 * ensuite « Merci, c'est noté ». Une fois par analyse (remise à zéro par `key`).
 */
function VocalFeedback({ onSend }: { onSend: (v: VocalVerdict, comment: string) => Promise<boolean> }) {
  const [done, setDone] = useState(false)
  const [verdict, setVerdict] = useState<VocalVerdict | null>(null)
  const [comment, setComment] = useState('')
  const [sending, setSending] = useState(false)
  const [failed, setFailed] = useState(false)

  if (done)
    return (
      <p className="text-[11px] text-muted" role="status">
        Merci, c’est noté.
      </p>
    )

  async function send() {
    if (!verdict || sending) return
    setSending(true)
    const ok = await onSend(verdict, comment)
    setSending(false)
    if (ok) setDone(true)
    else setFailed(true)
  }

  return (
    <div className="flex flex-col gap-1.5 rounded-md border border-line bg-bg/40 px-2 py-1.5 text-[11px]" role="group" aria-label="Votre avis sur cette proposition">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="font-bold text-muted">Cette proposition :</span>
        {VOCAL_VERDICTS.map((v) => (
          <button
            key={v}
            type="button"
            aria-pressed={verdict === v}
            className={`min-h-8 rounded-full border px-2.5 font-bold ${verdict === v ? 'border-accent bg-accent text-white' : 'border-line text-fg hover:border-accent'}`}
            onClick={() => setVerdict(v)}
          >
            {SHORT[v]}
          </button>
        ))}
      </div>
      {verdict && (
        <form
          className="flex flex-col gap-1.5 sm:flex-row sm:items-start"
          onSubmit={(e) => {
            e.preventDefault()
            void send()
          }}
        >
          <textarea
            className="field min-h-11 min-w-0 flex-1 text-xs"
            rows={2}
            maxLength={MAX_COMMENT}
            placeholder={verdict === 'coherente' ? 'Un commentaire ? (facultatif)' : 'Ce que j’aurais mis (facultatif)'}
            aria-label="Commentaire facultatif"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
          />
          <button type="submit" className="btn-primary min-h-11 shrink-0 self-start px-3 text-xs" disabled={sending}>
            Envoyer
          </button>
        </form>
      )}
      {failed && (
        <span className="text-red-300" role="alert">
          Avis non enregistré sur cet appareil.
        </span>
      )}
      <span className="text-[10px] text-muted">Phase de test : enregistré sans nom de joueur pour améliorer l’analyse.</span>
    </div>
  )
}
