import { useEffect, useRef, useState, type ReactNode } from 'react'
import { MicButton, MicStatus, useMicRecorder } from './MicButton'
import { sendFilterRequest, useDictation } from '../dictation/useDictation'
import { DictationError, ERROR_TEXT } from '../dictation/transcribe'
import {
  buildSchema,
  EMPTY_FILTERS,
  interpretFilters,
  normalize,
  notFoundText,
  sameFilters,
  summaryText,
  unsupportedText,
  type FilterValues,
  type Interpretation,
  type SearchContext,
} from '../voiceSearch'

/*
 * Recherche de joueurs en langage naturel (essai, liste Joueurs) : « tous les joueurs nés en 2010 qui mesurent plus d'1 m 80 ».
 *  - micro à côté de « Rechercher… » (dictée Voxtral, comme les commentaires), ou phrase tapée dans le champ puis « ✨ » ;
 *  - la phrase et le schéma des filtres (src/voiceSearch.ts) partent à la fonction « transcrire » (?mode=filtres) ;
 *  - chaque valeur rendue est revérifiée ici, puis les filtres sont REMPLACÉS (les autres remis à zéro) : le panneau de
 *    filtres les montre comme d'habitude, on peut les ajuster à la main ; « Annuler » remet les filtres d'avant ;
 *  - recherche seulement, aucune action sur les joueurs.
 * Disponibilité : celle de la dictée (useDictation().searchReady : administrateurs pendant l'essai, fonction présente et
 * à jour) ; sinon, la ligne de recherche habituelle.
 */

type Result = { it: Interpretation; phrase: string; prev: FilterValues; applied: FilterValues | null; shownFor: FilterValues }

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
  const [result, setResult] = useState<Result | null>(null)
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

  async function understand(phrase: string) {
    const text = phrase.replace(/\s+/g, ' ').trim()
    if (!text || abort.current) return
    setError('')
    setResult(null)
    setBusy(text)
    const ctrl = new AbortController()
    abort.current = ctrl
    try {
      const { ctx: c, values: prev } = latest.current
      const ans = await sendFilterRequest(text, buildSchema(c), ctrl.signal)
      if (ctrl.signal.aborted) return
      const it = interpretFilters(ans.filtres, ans.nonGere, c)
      // Rien de compris : les filtres restent comme ils sont.
      const applied = it.understood.length ? it.values : null
      if (applied) latest.current.apply(applied)
      setResult({ it, phrase: text, prev, applied, shownFor: applied ?? latest.current.values })
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
  // Le résumé reste tant que les filtres sont ceux de la phrase ; un changement à la main le fait disparaître.
  const shown = result && sameFilters(values, result.shownFor) ? result : null
  // « filtres précédents remplacés » : sans compter Garçons / Filles (gardé sur l'appareil) ni la phrase tapée elle-même.
  // Filtres d'avant la phrase (la phrase tapée elle-même n'est pas remise dans « Rechercher… » : elle ne trouverait personne).
  const before = (r: Result) => ({ ...r.prev, q: normalize(r.prev.q) === normalize(r.phrase) ? '' : r.prev.q })
  const replaced =
    shown?.applied && !sameFilters({ ...before(shown), sex: 'all' }, EMPTY_FILTERS)
  const extra = shown ? [unsupportedText(shown.it), notFoundText(shown.it)].filter(Boolean) : []

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex gap-2">
        {input}
        <MicButton mic={mic} />
        <button
          type="button"
          className="flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-md border border-line bg-panel-2 px-2 text-base hover:border-accent disabled:opacity-50"
          title="Comprendre la phrase tapée (ex. « gauchers nés en 2010, plus d’1 m 80 ») et remplir les filtres"
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
          <span className="min-w-0 flex-1 truncate">
            « {busy} » : je remplis les filtres…
          </span>
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
                <b>{summaryText(shown.it.understood)}</b>
              ) : (
                <span>
                  Aucun filtre reconnu dans « {shown.phrase} » : les filtres n’ont pas changé.
                </span>
              )}
              {replaced && <span className="text-muted"> (filtres précédents remplacés)</span>}
            </span>
            {shown.applied && (
              <button type="button" className="shrink-0 font-bold underline" onClick={() => (apply(before(shown)), setResult(null))}>
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
