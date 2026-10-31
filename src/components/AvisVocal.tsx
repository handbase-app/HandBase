import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { MicStatus, useMicRecorder } from './MicButton'
import { sendAvisRequest, useDictation } from '../dictation/useDictation'
import { DictationError, ERROR_TEXT } from '../dictation/transcribe'
import {
  avisProposals,
  buildAvisPayload,
  decide,
  decideAll,
  droppedText,
  expressionText,
  interpretAvis,
  mergeComment,
  parseAmbigu,
  sensFromValue,
  type AvisRef,
  type AvisState,
} from '../dictation/avis'
import { loadExpressions, saveExpressions } from '../expressions'
import type { ExpressionCible } from '../expressionsCore'
import { useBackCloses } from '../backNav'
import { groupBy } from './ui'
import { newId, type Criterion, type Position } from '../db'
import { canLogQuestion, logAvisVocal, logAvisVocalVerdict } from '../questionLog'
import { realRole } from '../roles'
import { MAX_COMMENT, VOCAL_VERDICT_LABEL, VOCAL_VERDICTS, type VocalVerdict } from '../questionLogCore'
import { useWait, WaitLine } from './Attente'
import { FormActions, FormWindow } from './FormWindow'

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
 * « Mes expressions » (src/expressions.ts) : le vocabulaire de l'entraîneur part avec le texte dicté (jamais rien du joueur) ;
 * une hésitation ou une remarque « pas reliée » tranchée dans la fenêtre peut être retenue comme expression.
 */

/** Le micro « Avis vocal » (dans la barre « Enregistrer »), l'état de l'analyse et le résumé des propositions (en haut de la fiche). */
export function AvisVocal({
  playerId,
  position,
  criteria,
  current,
  state,
  setState,
  onApply,
  slot,
}: {
  playerId: string
  position?: Position
  criteria: Criterion[]
  /** Saisie en cours : une proposition déjà identique (même note, commentaire déjà présent) n'est pas reproposée. */
  current: { scores?: Record<string, number | string>; strengths?: string; improvements?: string; portrait?: string }
  state: AvisState | null
  setState: (s: AvisState | null) => void
  /** Propositions acceptées dans la fenêtre : notes à poser (critère → note), commentaires à ajouter, portrait à poser. */
  onApply: (scores: Record<string, number>, comments: { strengths?: string; improvements?: string; portrait?: string }) => void
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
    setError('')
    setBusy(true)
    const ctrl = new AbortController()
    abort.current = ctrl
    try {
      // Vocabulaire de l'entraîneur : ses expressions dont un critère est dans la liste de ce joueur.
      const payload = buildAvisPayload(cs, pos, await loadExpressions().catch(() => []))
      const ans = await sendAvisRequest(text, payload.criteres, ctrl.signal, payload.expressions)
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
        portrait: !!result.portrait && result.portrait !== (cur.portrait ?? '').trim(),
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
  // Fenêtre des propositions : elle s'ouvre d'elle-même à chaque nouvelle analyse qui propose quelque chose (une nouvelle
  // dictée après coup ne propose que ce qui change : src/dictation/avis.ts, pending) ; ✕ la referme, « Voir » la rouvre.
  const [open, setOpen] = useState(false)
  const opened = useRef('')
  useEffect(() => {
    const m = state?.playerId === playerId ? state : null
    if (!m) return setOpen(false)
    const k = m.id ?? m.transcript
    if (opened.current === k) return
    opened.current = k
    setOpen(m.pending.length > 0 || m.strengths || m.improvements || !!m.portrait)
  }, [state, playerId])
  /** « Accepter » : notes cochées (proposées ou changées) posées, décochées écartées, commentaires cochés ajoutés. */
  function apply(pick: AvisPick) {
    const m = state
    if (!m) return
    let next = m
    const scores: Record<string, number> = {}
    for (const id of m.pending) {
      const v = pick.scores[id]
      next = decide(next, id, v === undefined ? 'ignore' : { value: v })
      if (v !== undefined) scores[id] = v
    }
    // Hésitations et remarques « pas reliées » tranchées dans la fenêtre : critère choisi et note donnés par le coach.
    for (const [id, v] of Object.entries(pick.extra)) scores[id] = v
    const strengths = m.strengths && pick.strengths ? m.result.pointsForts : undefined
    const improvements = m.improvements && pick.improvements ? m.result.axes : undefined
    const portrait = m.portrait && pick.portrait ? m.result.portrait : undefined
    onApply(scores, { strengths, improvements, portrait })
    // « Retenir pour la prochaine fois » : expressions créées ou mises à jour (même texte).
    if (pick.retain.length) void saveExpressions(pick.retain).catch((e) => console.error(e))
    const added = Object.keys(scores).length + (strengths ? 1 : 0) + (improvements ? 1 : 0) + (portrait ? 1 : 0)
    setState({ ...next, strengths: false, improvements: false, portrait: false, added: (m.added ?? 0) + added })
  }
  const payload = criteria.length > 0 ? buildAvisPayload(criteria, position) : null
  const usable = !!payload && payload.criteres.length > 0
  // Échelle de chaque critère proposé (les références de l'analyse sont rangées par c1, c2… : ici par critère).
  const refs = Object.fromEntries(Object.values(payload?.refs ?? {}).map((r) => [r.criterionId, r]))
  // Critères de la liste par famille, pour « Relier à un critère ».
  const families = groupBy(
    criteria.filter((c) => refs[c.id]),
    (c) => c.category,
  ).map(([cat, cs]) => [cat, cs.map((c) => c.id)] as [string, string[]])
  if (!avisReady || !usable) return null

  const rec = mic.phase === 'recording' || mic.phase === 'opening'
  const working = mic.phase === 'sending' || busy
  const mine = state?.playerId === playerId ? state : null
  const left = mine ? mine.pending.length + (mine.strengths ? 1 : 0) + (mine.improvements ? 1 : 0) + (mine.portrait ? 1 : 0) : 0
  const n = mine?.result.suggestions.length ?? 0
  const applied = mine?.added ?? 0

  return (
    <div className="flex flex-col gap-2 empty:hidden" data-noswipe>
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
        <div className="flex items-center gap-2 rounded-xl sug-box py-1 pr-1 pl-3 text-xs" role="status">
          <span className="min-w-0 flex-1 py-1.5">
            {left > 0 ? (
              <b>
                ✦ {left} proposition{left > 1 ? 's' : ''} en attente
              </b>
            ) : applied > 0 ? (
              <>
                ✓ {applied} proposition{applied > 1 ? 's' : ''} ajoutée{applied > 1 ? 's' : ''} · relisez, puis enregistrez
              </>
            ) : n === 0 && !mine.result.pointsForts && !mine.result.axes && !mine.result.portrait ? (
              'Aucune note proposée : je n’ai reconnu aucun critère de la fiche.'
            ) : (
              'Propositions refusées.'
            )}
          </span>
          {left > 0 && (
            <button type="button" className="min-h-10 shrink-0 rounded-full bg-fg px-3.5 text-xs font-extrabold text-panel hover:opacity-90" onClick={() => setOpen(true)}>
              Voir
            </button>
          )}
          <button type="button" className="flex h-10 w-10 shrink-0 items-center justify-center text-muted hover:text-fg" aria-label="Fermer" onClick={() => setState(null)}>
            ✕
          </button>
        </div>
      )}
      {open && mine && left > 0 && (
        <AvisReview
          key={keyOf(mine)}
          state={mine}
          refs={refs}
          families={families}
          onApply={(sel) => {
            apply(sel)
            setOpen(false)
          }}
          onRefuse={() => {
            setState(decideAll(mine, 'ignore'))
            setOpen(false)
          }}
          onClose={() => setOpen(false)}
          admin={realRole() === 'admin'}
          written={{ strengths: current.strengths, improvements: current.improvements, portrait: current.portrait }}
          feedback={canLogQuestion() ? <VocalFeedback key={keyOf(mine)} onSend={(v, c) => sendVerdict(mine, v, c)} /> : null}
        />
      )}
    </div>
  )
}

type AvisPick = {
  scores: Record<string, number | undefined>
  extra: Record<string, number>
  strengths: boolean
  improvements: boolean
  portrait: boolean
  /** « Retenir pour la prochaine fois » : expressions à créer ou à mettre à jour (même texte). */
  retain: { texte: string; cibles: ExpressionCible[] }[]
}

/** Remarque à trancher : une hésitation de l'analyse (« J'hésite ») ou une remarque reliée à aucun critère (« Pas relié »). */
type Pending = { key: string; kind: 'doute' | 'libre'; quote: string; ids: string[] }

const MAX_CHOSEN = 3

const foldText = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()

/**
 * Fenêtre des propositions de l'avis vocal (31/10) : tout ce qui est proposé, au même endroit, quelle que soit la ligne de
 * la fiche. Portrait en premier (une phrase), puis chaque note proposée, cochée ; on décoche ce qu'on ne veut pas, on touche
 * une autre note de l'échelle (1 à 5…) pour la changer. Note déduite (critère pas nommé) : « déduit » discret après le libellé.
 * Hésitations (« J'hésite ») : on touche un ou plusieurs critères (3 au plus), chacun reçoit sa note. Remarques reliées à aucun
 * critère (« Pas relié ») : « Relier à un critère ▾ » ouvre une bulle (critères par famille, 3 au plus). Tranchée, une remarque
 * peut être retenue (« Retenir pour la prochaine fois », décoché) : elle devient une de « Mes expressions ». Points forts /
 * Axes proposés : cochés aussi. « Accepter (n) » pose ce qui est coché sur la fiche (rien n'est enregistré avant
 * « Enregistrer »), « Tout refuser » écarte tout ; ✕ ou Retour : plus tard. Pas d'explication. Mêmes tailles que la fiche
 * derrière (libellé, échelle). Aspect d'une proposition (liseré pointillé, note teintée : .sug-ring / .sug-fill,
 * src/index.css). Administrateurs seulement (phase de test) : propositions écartées, « Ce que j'ai entendu » et
 * l'appréciation « Cohérente · En partie · Pas cohérente ».
 */
function AvisReview({
  state,
  refs,
  families,
  onApply,
  onRefuse,
  onClose,
  admin,
  written,
  feedback,
}: {
  state: AvisState
  refs: Record<string, AvisRef>
  /** Critères de la liste par famille (identifiants), pour « Relier à un critère ». */
  families: [string, string[]][]
  onApply: (pick: AvisPick) => void
  onRefuse: () => void
  onClose: () => void
  admin: boolean
  /** Points forts / Axes / portrait déjà écrits sur la fiche : la proposition s'ajoute à la suite (le portrait remplace). */
  written: { strengths?: string; improvements?: string; portrait?: string }
  feedback: ReactNode
}) {
  const sugs = state.result.suggestions.filter((x) => state.pending.includes(x.criterionId))
  const [vals, setVals] = useState<Record<string, number>>(() => Object.fromEntries(sugs.map((x) => [x.criterionId, x.value])))
  const [on, setOn] = useState<Record<string, boolean>>(() => Object.fromEntries(sugs.map((x) => [x.criterionId, true])))
  const [strengths, setStrengths] = useState(state.strengths)
  const [improvements, setImprovements] = useState(state.improvements)
  const [portrait, setPortrait] = useState(!!state.portrait)
  // Hésitations (« joue très personnel » : Jeu collectif ou Prise de décision) et remarques « pas reliées » : le coach choisit
  // le ou les critères, puis la note de chacun.
  const proposedIds = new Set(sugs.map((x) => x.criterionId))
  const doubts = state.result.ambigus.map((text) => {
    const p = parseAmbigu(text, Object.values(refs))
    return { text, quote: p?.quote ?? '', ids: (p?.ids ?? []).filter((id) => !proposedIds.has(id)) }
  })
  const pendings: Pending[] = [
    ...doubts.flatMap((d, i) => (d.ids.length >= 2 ? [{ key: `d${i}`, kind: 'doute' as const, quote: d.quote, ids: d.ids }] : [])),
    ...state.result.nonRelies
      .filter((q) => !doubts.some((d) => d.quote && foldText(d.quote) === foldText(q)))
      .map((q, i) => ({ key: `n${i}`, kind: 'libre' as const, quote: q, ids: [] })),
  ]
  const [picked, setPicked] = useState<Record<string, string[]>>({})
  const [extra, setExtra] = useState<Record<string, number>>({})
  const [retain, setRetain] = useState<Record<string, boolean>>({})
  const extraIds = [...new Set(Object.values(picked).flat())].filter((id) => extra[id] !== undefined)
  const total = sugs.length + (state.strengths ? 1 : 0) + (state.improvements ? 1 : 0) + (state.portrait ? 1 : 0)
  const count =
    sugs.filter((x) => on[x.criterionId]).length +
    extraIds.length +
    (state.strengths && strengths ? 1 : 0) +
    (state.improvements && improvements ? 1 : 0) +
    (state.portrait && portrait ? 1 : 0)
  const check = 'h-4 w-4 shrink-0 accent-[var(--color-fg)]'
  const stepsOf = (id: string, fallback?: number) => {
    const r = refs[id]
    return r && r.max - r.min <= 10 ? Array.from({ length: r.max - r.min + 1 }, (_, i) => r.min + i) : fallback !== undefined ? [fallback] : []
  }
  const labelOf = (id: string) => refs[id]?.label ?? id
  const toggle = (key: string, id: string) =>
    setPicked((p) => {
      const cur = p[key] ?? []
      return { ...p, [key]: cur.includes(id) ? cur.filter((x) => x !== id) : cur.length < MAX_CHOSEN ? [...cur, id] : cur }
    })
  /** Critères choisis pour une remarque, et leur note : rangée « critère + échelle », puis « Retenir pour la prochaine fois ». */
  const chosenRows = (row: Pending) => {
    const ids = picked[row.key] ?? []
    return (
      <>
        {ids.map((id) => (
          <div key={id} className="col-span-2 grid grid-cols-subgrid items-center">
            <div className="min-w-0 text-xs leading-tight font-bold">{labelOf(id)}</div>
            <PickScale label={labelOf(id)} steps={stepsOf(id)} value={extra[id]} active onPick={(v) => setExtra((o) => ({ ...o, [id]: v }))} />
          </div>
        ))}
        {ids.some((id) => extra[id] !== undefined) && (
          <label className="col-span-2 inline-flex min-h-9 cursor-pointer items-center gap-2 justify-self-start rounded-full border-[1.5px] border-line px-3 text-xs font-bold has-[:checked]:border-fg">
            <input type="checkbox" className={check} checked={!!retain[row.key]} onChange={(e) => setRetain((o) => ({ ...o, [row.key]: e.target.checked }))} />
            Retenir pour la prochaine fois
          </label>
        )}
      </>
    )
  }
  return (
    <FormWindow title={`${total} proposition${total > 1 ? 's' : ''}`} onClose={onClose} phoneFull={false} guard={false} width={520}>
      {/* Une ligne par note (case et libellé à gauche, échelle à droite, alignées comme la fiche) ; pas de phrase pour
          justifier : le coach sait ce qu'il a dit (31/10). */}
      <div className="grid grid-cols-[fit-content(42%)_minmax(0,1fr)] gap-x-2" data-noswipe>
        {state.portrait && (
          <CommentPick label="Portrait" before={written.portrait} replace text={state.result.portrait} checked={portrait} onChange={setPortrait} className={check} first />
        )}
        {sugs.map((x, i) => {
          const id = x.criterionId
          return (
            <div key={id} className={`col-span-2 grid grid-cols-subgrid items-center py-1.5 transition-opacity ${i || state.portrait ? 'border-t border-line' : ''} ${on[id] ? '' : 'opacity-50'}`}>
              <label className="flex min-w-0 items-center gap-2 text-xs leading-tight font-bold">
                <input type="checkbox" className={check} checked={on[id]} onChange={(e) => setOn((o) => ({ ...o, [id]: e.target.checked }))} />
                <span className="min-w-0">
                  {x.label}
                  {x.confidence === 'deduit' && <span className="ml-1.5 text-[11px] font-normal text-muted">déduit</span>}
                </span>
              </label>
              <PickScale
                label={x.label}
                steps={stepsOf(id, x.value)}
                value={vals[id]}
                active={on[id]}
                onPick={(v) => {
                  setVals((o) => ({ ...o, [id]: v }))
                  setOn((o) => ({ ...o, [id]: true }))
                }}
              />
            </div>
          )
        })}
        {pendings.map((row) =>
          row.kind === 'doute' ? (
            <div key={row.key} className="col-span-2 grid grid-cols-subgrid items-center gap-y-1.5 border-t border-line py-2">
              <div className="col-span-2 text-xs">
                <b>J’hésite</b> <span className="text-muted">· « {row.quote} »</span>
              </div>
              <div className="col-span-2 flex flex-wrap gap-1.5">
                {row.ids.map((id) => {
                  const sel = (picked[row.key] ?? []).includes(id)
                  return (
                    <button
                      key={id}
                      type="button"
                      aria-pressed={sel}
                      disabled={!sel && (picked[row.key] ?? []).length >= MAX_CHOSEN}
                      onClick={() => toggle(row.key, id)}
                      className={`min-h-9 rounded-full px-3 text-xs font-bold transition disabled:opacity-40 ${sel ? 'bg-fg text-panel' : 'sug-ring text-fg'}`}
                    >
                      {labelOf(id)}
                    </button>
                  )
                })}
              </div>
              {chosenRows(row)}
            </div>
          ) : (
            <div key={row.key} className="col-span-2 grid grid-cols-subgrid items-center gap-y-1.5 border-t border-line py-2">
              <div className="col-span-2 flex flex-wrap items-center justify-between gap-x-2 gap-y-1.5">
                <span className="min-w-0 text-xs">
                  <b>Pas relié</b> <span className="text-muted">· « {row.quote} »</span>
                </span>
                <LinkPicker families={families} exclude={proposedIds} labelOf={labelOf} chosen={picked[row.key] ?? []} onToggle={(id) => toggle(row.key, id)} />
              </div>
              {chosenRows(row)}
            </div>
          ),
        )}
        {admin &&
          doubts
            .filter((d) => d.ids.length < 2)
            .map((d) => (
              <div key={d.text} className="col-span-2 border-t border-line py-2 text-[11px] text-muted">
                Je n’ai pas su choisir : {d.text}
              </div>
            ))}
        {state.strengths && (
          <CommentPick label="Points forts" before={written.strengths} text={state.result.pointsForts} checked={strengths} onChange={setStrengths} className={check} />
        )}
        {state.improvements && (
          <CommentPick label="Axes de progression" before={written.improvements} text={state.result.axes} checked={improvements} onChange={setImprovements} className={check} />
        )}
      </div>
      {admin && (
        <>
          {state.result.dropped.length > 0 && <div className="text-[11px] text-muted">{droppedText(state.result.dropped)}</div>}
          <details className="text-[11px] text-muted">
            <summary className="cursor-pointer py-1">Ce que j’ai entendu</summary>
            <p className="italic">« {state.transcript} »</p>
          </details>
          {feedback}
        </>
      )}
      <FormActions>
        <button
          type="button"
          className="btn-save"
          disabled={count === 0}
          onClick={() =>
            onApply({
              scores: Object.fromEntries(sugs.map((x) => [x.criterionId, on[x.criterionId] ? vals[x.criterionId] : undefined])),
              extra: Object.fromEntries(extraIds.map((id) => [id, extra[id]])),
              strengths,
              improvements,
              portrait,
              retain: pendings.flatMap((row) => {
                const ids = (picked[row.key] ?? []).filter((id) => extra[id] !== undefined && refs[id])
                const texte = expressionText(row.quote)
                if (!retain[row.key] || !ids.length || !texte) return []
                return [{ texte, cibles: ids.map((id) => ({ criterionId: id, sens: sensFromValue(extra[id], refs[id].min, refs[id].max) })) }]
              }),
            })
          }
        >
          ✓ Accepter ({count})
        </button>
        <button type="button" className="btn-save-ghost" onClick={onRefuse}>
          Tout refuser
        </button>
      </FormActions>
    </FormWindow>
  )
}

/**
 * « Relier à un critère ▾ » : pastille pointillée qui ouvre, là où on l'a touchée (dessous, ou dessus faute de place), une
 * bulle des critères de la fiche par famille ; on en coche 3 au plus. Fond légèrement voilé et flouté ; toucher à côté,
 * Échap ou Retour la ferme (comme le ⓘ, src/components/ui.tsx InfoButton).
 */
function LinkPicker({
  families,
  exclude,
  labelOf,
  chosen,
  onToggle,
}: {
  families: [string, string[]][]
  exclude: Set<string>
  labelOf: (id: string) => string
  chosen: string[]
  onToggle: (id: string) => void
}) {
  const btn = useRef<HTMLButtonElement>(null)
  const bubble = useRef<HTMLDivElement>(null)
  const [at, setAt] = useState<DOMRect | null>(null)
  const close = () => setAt(null)
  useBackCloses(close, !!at)
  useEffect(() => {
    if (!at) return
    // Échap ferme la bulle seulement (pas la fenêtre des propositions derrière).
    const esc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      setAt(null)
    }
    const scroll = (e: Event) => !(e.target instanceof Node && bubble.current?.contains(e.target)) && setAt(null)
    const resize = () => setAt(null)
    window.addEventListener('keydown', esc, true)
    window.addEventListener('scroll', scroll, { passive: true, capture: true })
    window.addEventListener('resize', resize)
    return () => {
      window.removeEventListener('keydown', esc, true)
      window.removeEventListener('scroll', scroll, { capture: true })
      window.removeEventListener('resize', resize)
    }
  }, [at])
  useLayoutEffect(() => {
    if (at) bubble.current?.querySelector<HTMLElement>('button')?.focus({ preventScroll: true })
  }, [at])
  const vw = typeof window === 'undefined' ? 360 : window.innerWidth
  const vh = typeof window === 'undefined' ? 640 : window.innerHeight
  const width = Math.min(320, vw - 24)
  const below = !!at && at.bottom < vh * 0.6
  const left = at ? Math.max(12, Math.min(at.left + at.width / 2 - width / 2, vw - width - 12)) : 0
  const groups = families.map(([cat, ids]) => [cat, ids.filter((id) => !exclude.has(id))] as const).filter(([, ids]) => ids.length)
  return (
    <>
      <button
        ref={btn}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={!!at}
        onClick={() => setAt(btn.current?.getBoundingClientRect() ?? null)}
        className="sug-ring inline-flex min-h-9 shrink-0 items-center gap-1 rounded-full px-3 text-xs font-bold text-fg"
      >
        {chosen.length ? 'Changer de critère' : 'Relier à un critère'} <span aria-hidden>▾</span>
      </button>
      {at &&
        createPortal(
          <div className="fixed inset-0 z-[60]" onClick={close}>
            <div className="absolute inset-0 scrim-light" aria-hidden />
            <div
              ref={bubble}
              role="dialog"
              aria-label="Relier à un critère"
              data-popup
              className="win absolute flex flex-col gap-2 overflow-y-auto overscroll-contain p-3 shadow-2xl"
              onClick={(e) => e.stopPropagation()}
              style={{ width, left, ...(below ? { top: at.bottom + 8, maxHeight: vh - at.bottom - 20 } : { bottom: vh - at.top + 8, maxHeight: at.top - 20 }) }}
            >
              <div className="text-xs font-extrabold">
                Relier à un critère <span className="font-normal text-muted">· 3 au plus</span>
              </div>
              {groups.map(([cat, ids]) => (
                <div key={cat} className="flex flex-col">
                  <div className="section-title mb-0.5">{cat}</div>
                  {ids.map((id) => {
                    const sel = chosen.includes(id)
                    return (
                      <button
                        key={id}
                        type="button"
                        role="menuitemcheckbox"
                        aria-checked={sel}
                        disabled={!sel && chosen.length >= MAX_CHOSEN}
                        onClick={() => onToggle(id)}
                        className="flex min-h-10 items-center gap-2 rounded-lg px-1.5 text-left text-xs font-bold hover:bg-panel-2 disabled:opacity-40"
                      >
                        <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border-[1.5px] text-[10px] ${sel ? 'border-fg bg-fg text-panel' : 'border-muted'}`} aria-hidden>
                          {sel ? '✓' : ''}
                        </span>
                        {labelOf(id)}
                      </button>
                    )
                  })}
                </div>
              ))}
              <button type="button" className="btn-save mt-1 min-h-10 self-end px-5 text-xs" onClick={close}>
                OK
              </button>
            </div>
          </div>,
          document.body,
        )}
    </>
  )
}

/** Échelle d'une proposition : liseré pointillé, note proposée teintée (aspect d'une proposition), mêmes tailles que la fiche. */
function PickScale({ label, steps, value, active, onPick }: { label: string; steps: number[]; value?: number; active: boolean; onPick: (v: number) => void }) {
  return (
    <div role="group" aria-label={`${label} : note`} className="sug-ring flex gap-[3px] rounded-full p-[3px]">
      {steps.map((v) => (
        <button
          key={v}
          type="button"
          aria-pressed={active && value === v}
          onClick={() => onPick(v)}
          className={`flex h-10 min-w-0 flex-1 items-center justify-center rounded-full text-sm font-bold tabular-nums transition ${
            value === v ? 'sug-fill' : 'text-muted hover:bg-fg/5 hover:text-fg'
          }`}
        >
          {v}
        </button>
      ))}
    </div>
  )
}

/**
 * Points forts / Axes proposés : le texte déjà écrit sur la fiche (s'il y en a), puis la proposition qui s'ajoutera à la ligne
 * en dessous, dans l'aspect d'une proposition (teinte et liseré pointillé) : on voit le résultat avant d'accepter.
 * Portrait (`replace`) : la phrase déjà écrite, discrète, que la proposition remplace.
 */
function CommentPick({
  label,
  before,
  text,
  checked,
  onChange,
  className,
  replace = false,
  first = false,
}: {
  label: string
  before?: string
  text: string
  checked: boolean
  onChange: (v: boolean) => void
  className: string
  replace?: boolean
  first?: boolean
}) {
  const kept = before?.trim()
  return (
    <div className={`col-span-2 flex flex-col gap-1.5 py-2 transition-opacity ${first ? '' : 'border-t border-line'} ${checked ? '' : 'opacity-50'}`}>
      <label className="flex min-h-7 items-center gap-2 text-xs font-bold">
        <input type="checkbox" className={className} checked={checked} onChange={(e) => onChange(e.target.checked)} />
        {label}
        {kept && <span className="font-normal text-muted">{replace ? '· remplace l’actuel' : '· ajouté à la suite'}</span>}
      </label>
      <div className="flex flex-col gap-1 rounded-lg bg-panel-2 px-2.5 py-2 text-xs">
        {kept && <p className="whitespace-pre-line text-muted">{kept}</p>}
        <p className="sug-fill rounded-md px-2 py-1">{text}</p>
      </div>
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
