import { useEffect, useRef, useState, type ReactNode } from 'react'
import { MicButton, MicStatus, useMicRecorder } from './MicButton'
import { sendFilterRequest, useDictation } from '../dictation/useDictation'
import { DictationError, ERROR_TEXT } from '../dictation/transcribe'
import {
  applyAnswer,
  buildSchema,
  currentForModel,
  hasFilters,
  localCommand,
  normalize,
  notFoundText,
  outcomeText,
  sameFilters,
  unsupportedText,
  type FilterValues,
  type Outcome,
  type SearchContext,
} from '../voiceSearch'

/*
 * Recherche de joueurs en langage naturel (essai, liste Joueurs) : « tous les joueurs nés en 2010 qui mesurent plus d'1 m 80 »,
 * puis « ajoute le Var », « enlève la taille », « efface la sélection ».
 *  - micro à côté de « Rechercher… » (dictée Voxtral, comme les commentaires), ou phrase tapée dans le champ puis « ✨ » ;
 *  - commandes évidentes (« efface tout », « réinitialise »…) reconnues ici, sans appel (instantané, hors ligne) ;
 *  - sinon la phrase, le schéma des filtres et les filtres actifs (src/voiceSearch.ts) partent à la fonction « transcrire »
 *    (?mode=filtres), qui rend une action : remplacer, ajouter, retirer ou effacer ;
 *  - chaque valeur rendue est revérifiée ici, puis appliquée avec les réglages habituels : le panneau de filtres les montre,
 *    on peut les ajuster à la main ; une ligne dit ce qui s'est passé (« Ajouté : Var (83) ») et « Annuler » remet les
 *    filtres d'avant ;
 *  - recherche seulement, aucune action sur les joueurs.
 * Disponibilité : celle de la dictée (useDictation().searchReady : administrateurs pendant l'essai, fonction présente et
 * à jour) ; sinon, la ligne de recherche habituelle.
 */

/** base : filtres sur lesquels la phrase a agi (et que « Annuler » remet) ; shownFor : filtres pendant lesquels la ligne reste. */
type Result = { outcome: Outcome; phrase: string; base: FilterValues; applied: boolean; shownFor: FilterValues }

/** Filtres actuels sans la phrase tapée elle-même dans « Rechercher… » (elle ne trouverait personne). */
const withoutPhrase = (v: FilterValues, phrase: string) => ({ ...v, q: normalize(v.q) === normalize(phrase) ? '' : v.q })

export function VoiceSearch({
  values,
  apply,
  ctx,
  input,
  after,
}: {
  values: FilterValues
  apply: (v: FilterValues) => void
  ctx: SearchContext
  input: ReactNode
  after?: ReactNode
}) {
  const { searchReady } = useDictation()
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [result, setResultState] = useState<Result | null>(null)
  const resultRef = useRef<Result | null>(null)
  const setResult = (r: Result | null) => {
    resultRef.current = r
    setResultState(r)
  }
  const abort = useRef<AbortController | null>(null)
  const latest = useRef({ values, ctx, apply })
  useEffect(() => {
    latest.current = { values, ctx, apply }
  })
  useEffect(() => {
    return () => {
      abort.current?.abort()
    }
  }, [])

  function show(outcome: Outcome, phrase: string, prev: FilterValues, base: FilterValues) {
    // Rien ne change : les filtres restent comme ils sont (la phrase tapée reste dans le champ, pour la reformuler).
    if (outcome.changed) latest.current.apply(outcome.values)
    setResult({ outcome, phrase, base, applied: outcome.changed, shownFor: outcome.changed ? outcome.values : prev })
  }

  async function understand(phrase: string) {
    const text = phrase.replace(/\s+/g, ' ').trim()
    if (!text || abort.current) return
    setError('')
    const { ctx: c, values: prev } = latest.current
    // Phrase tapée : elle a pris la place du nom cherché dans « Rechercher… ». Si les autres filtres sont ceux de la phrase
    // d'avant, on repart de ceux-là (nom compris : « enlève le nom », « ajoute les gauchers » le gardent).
    const last = resultRef.current
    const current =
      last?.applied && normalize(prev.q) === normalize(text) && sameFilters({ ...prev, q: last.shownFor.q }, last.shownFor) ? last.shownFor : withoutPhrase(prev, text)
    setResult(null)
    // Commande évidente : sans appel.
    if (localCommand(text) === 'effacer') return show(applyAnswer({ action: 'effacer' }, current, c), text, prev, current)
    setBusy(text)
    const ctrl = new AbortController()
    abort.current = ctrl
    try {
      const ans = await sendFilterRequest(text, buildSchema(c), currentForModel(current, c), ctrl.signal)
      if (ctrl.signal.aborted) return
      show(applyAnswer(ans, current, c), text, prev, current)
    } catch (e) {
      if (!(e instanceof DictationError && e.code === 'annule')) setError(e instanceof DictationError ? e.message : ERROR_TEXT.mistral_erreur)
    } finally {
      if (abort.current === ctrl) abort.current = null
      setBusy('')
    }
  }

  const mic = useMicRecorder((text) => void understand(text))
  if (!searchReady) return <div className="flex gap-2">{input}{after}</div>

  const micBusy = mic.phase !== 'idle'
  // La ligne reste tant que les filtres sont ceux de la phrase (on peut taper la suivante) ; un changement à la main la fait
  // disparaître.
  const shown = result && sameFilters({ ...values, q: result.shownFor.q }, result.shownFor) ? result : null
  const extra = shown ? [unsupportedText(shown.outcome), notFoundText(shown.outcome)].filter(Boolean) : []

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex gap-2">
        {input}
        <MicButton mic={mic} />
        <button
          type="button"
          className="flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-md border border-line bg-panel-2 px-2 text-base hover:border-accent disabled:opacity-50"
          title="Comprendre la phrase tapée (ex. « gauchers nés en 2010, plus d’1 m 80 », « ajoute le Var », « efface tout ») et remplir les filtres"
          aria-label="Comprendre la phrase tapée et remplir les filtres"
          disabled={!values.q.trim() || !!busy || micBusy}
          onClick={() => void understand(values.q)}
        >
          ✨
        </button>
        {after}
      </div>
      {micBusy ? (
        <MicStatus mic={mic} dictated={false} />
      ) : busy ? (
        <div className="flex items-center gap-2 text-xs text-muted" role="status">
          <span className="h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent" />
          <span className="min-w-0 flex-1 truncate">« {busy} » : je remplis les filtres…</span>
          <button type="button" className="shrink-0 px-2 py-1 text-[11px] font-bold underline" onClick={() => abort.current?.abort()}>
            Annuler
          </button>
        </div>
      ) : error || mic.error ? (
        <div className="text-[11px] text-red-300" role="alert">
          {error || mic.error}
        </div>
      ) : shown ? (
        <div className="flex flex-col gap-1 rounded-md border border-accent/40 bg-accent/5 px-2 py-1.5 text-[11px]" role="status">
          <div className="flex items-start gap-2">
            <span className="min-w-0 flex-1">
              {shown.applied ? (
                <b>{outcomeText(shown.outcome, hasFilters(shown.base))}</b>
              ) : shown.outcome.action === 'effacer' ? (
                <span>Aucun filtre à effacer.</span>
              ) : (
                <span>Les filtres n’ont pas changé (« {shown.phrase} »).</span>
              )}
            </span>
            {shown.applied && (
              <button type="button" className="shrink-0 font-bold underline" onClick={() => (apply(shown.base), setResult(null))}>
                Annuler
              </button>
            )}
            <button type="button" className="shrink-0 px-1 text-muted" aria-label="Fermer" onClick={() => setResult(null)}>
              ✕
            </button>
          </div>
          {shown.applied && <span className="truncate text-muted">« {shown.phrase} »</span>}
          {extra.map((t) => (
            <span key={t} className="text-muted">
              {t}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  )
}
