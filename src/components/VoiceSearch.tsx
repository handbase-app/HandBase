import { useEffect, useRef, useState, type ReactNode } from 'react'
import { MicStatus, useMicRecorder } from './MicButton'
import { Icon } from './ui'
import { sendFilterRequest, useDictation } from '../dictation/useDictation'
import { DictationError, ERROR_TEXT } from '../dictation/transcribe'
import {
  applyAnswer,
  buildSchema,
  currentForModel,
  hasFilters,
  localCommand,
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
 *  - un seul bouton « micro ✨ » à côté de « Rechercher… » : un appui, on dicte (Voxtral, comme les commentaires), un nouvel
 *    appui (ou relâcher après l'avoir maintenu) arrête ; la phrase transcrite est appliquée aux filtres directement. Pas de
 *    phrase tapée : pour taper, il y a les filtres (le champ « Rechercher… » reste la recherche par nom) ;
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

  function show(outcome: Outcome, phrase: string, prev: FilterValues, base: FilterValues) {
    // Rien ne change : les filtres restent comme ils sont.
    if (outcome.changed) latest.current.apply(outcome.values)
    setResult({ outcome, phrase, base, applied: outcome.changed, shownFor: outcome.changed ? outcome.values : prev })
  }

  async function understand(phrase: string) {
    const text = phrase.replace(/\s+/g, ' ').trim()
    if (!text || abort.current) return
    setError('')
    const { ctx: c, values: current } = latest.current
    setResult(null)
    // Commande évidente : sans appel.
    if (localCommand(text) === 'effacer') return show(applyAnswer({ action: 'effacer' }, current, c), text, current, current)
    setBusy(text)
    const ctrl = new AbortController()
    abort.current = ctrl
    try {
      const ans = await sendFilterRequest(text, buildSchema(c), currentForModel(current, c), ctrl.signal)
      if (ctrl.signal.aborted) return
      show(applyAnswer(ans, current, c), text, current, current)
    } catch (e) {
      if (!(e instanceof DictationError && e.code === 'annule')) setError(e instanceof DictationError ? e.message : ERROR_TEXT.mistral_erreur)
    } finally {
      if (abort.current === ctrl) abort.current = null
      setBusy('')
    }
  }

  const mic = useMicRecorder((text) => void understand(text))
  if (!searchReady) return <div className="flex gap-2">{input}{after}</div>

  const rec = mic.phase === 'recording' || mic.phase === 'opening'
  const sending = mic.phase === 'sending' || !!busy
  // La ligne reste tant que les filtres sont ceux de la phrase ; un changement à la main (nom compris) la fait disparaître.
  const shown = result && sameFilters(values, result.shownFor) ? result : null
  const extra = shown ? [unsupportedText(shown.outcome), notFoundText(shown.outcome)].filter(Boolean) : []

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex gap-2">
        {input}
        {/* Un seul bouton : micro + ✨ (toucher pour dicter, toucher à nouveau pour finir ; ou maintenir pendant qu'on parle). */}
        <button
          type="button"
          data-noswipe
          aria-label={rec ? 'Recherche vocale : arrêter et chercher' : sending ? 'Recherche vocale en cours' : 'Recherche vocale'}
          aria-pressed={rec}
          title={
            rec
              ? 'Arrêter : la phrase est transcrite puis appliquée aux filtres'
              : 'Recherche vocale : touchez et dites par exemple « les gauchers nés en 2010 qui mesurent plus d’1 m 80 », « ajoute le Var », « efface tout » ; touchez à nouveau pour finir (ou maintenez pendant que vous parlez)'
          }
          disabled={sending}
          className={`relative flex min-h-11 min-w-11 shrink-0 touch-none items-center justify-center rounded-md border-2 px-2 transition select-none [-webkit-touch-callout:none] ${
            rec ? 'border-red-300 bg-red-600 text-white shadow-[0_0_0_4px_rgba(220,38,38,0.35)]' : 'border-line bg-panel-2 text-fg hover:border-accent active:bg-accent active:text-white'
          } disabled:opacity-70`}
          {...mic.buttonProps}
        >
          {sending ? (
            <span className="h-5 w-5 animate-spin rounded-full border-2 border-current border-t-transparent" />
          ) : rec ? (
            <span className="h-4 w-4 rounded-sm bg-white" />
          ) : (
            <>
              <Icon name="mic" className="h-6 w-6" />
              <span className="pointer-events-none absolute top-0.5 right-0.5 text-[11px] leading-none" aria-hidden>
                ✨
              </span>
            </>
          )}
        </button>
        {after}
      </div>
      {mic.phase !== 'idle' ? (
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
          {shown.applied && <span className="truncate text-muted">Entendu : « {shown.phrase} »</span>}
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
