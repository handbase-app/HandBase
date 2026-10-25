import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { db, POSITIONS, today } from '../db'
import { sendQuestionRequest, useDictation } from '../dictation/useDictation'
import { DictationError, ERROR_TEXT } from '../dictation/transcribe'
import { buildQuestionSchema, questionHint } from '../recipe'
import { MicStatus, useMicRecorder } from './MicButton'
import { useWait, WaitLine } from './Attente'
import { Icon } from './ui'
import { Demander, recordAsk, useIncomingAsk } from './Demander'
import { appName } from '../appBrand'
import { logQuestion } from '../questionLog'
import { correctQuestionPhrase, incompletePhrase } from '../questionRescue'

/*
 * « Poser une question » au bilan de détection : le coach touche « micro ✨ Poser une question » et parle (« les joueuses
 * 2011 vues une seule fois cette saison, par département »), ou tape sa question (ordinateur) dans la barre « Demander »
 * (src/components/Demander.tsx : historique du bilan, suggestions ; une question venue de l'en-tête arrive ici). La phrase et la
 * DESCRIPTION de la recette (src/recipe.ts : clés, opérateurs, postes, catégories et critères) partent à la fonction
 * « transcrire » (?mode=question) ; elle rend une recette brute, que la page de réponse (/bilan/question) revérifie et
 * calcule sur l'appareil. Aucune donnée de joueur ne part ; aucun nom de club, de lieu, de groupe ou d'événement non plus.
 * Disponibilité : useDictation().questionReady (administrateurs, fonction présente, réglage de dictée activé, mode
 * « question » annoncé par la fonction déployée) ; sinon rien ne s'affiche.
 * Transparence (phase de développement) : les questions peuvent être notées au journal des questions (src/questionLog.ts),
 * sans nom de joueur ; le message le dit, avec un lien vers la page Confidentialité (paragraphe « Questions posées au bilan »).
 */

export type AskState = { raw: unknown; nonGere: string[]; heard: string }

/**
 * variant : 'full' (micro + champ, ordinateur), 'mic' (le micro seul, en un toucher : barre du bas du bilan sur téléphone),
 * 'text' (le champ seul : panneau « Taper / Mes questions » du téléphone).
 */
export function AskQuestion({
  className = '',
  variant = 'full',
  trailing,
  calculating,
}: {
  className?: string
  variant?: 'full' | 'mic' | 'text'
  trailing?: ReactNode
  /** La page se recalcule (bilan : filtre, lieu) : fine barre en va-et-vient sous la pilule. */
  calculating?: boolean
}) {
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
    // Dictée relue comme une question (« vœu » → « Var ») : src/questionRescue.ts.
    const said = correctQuestionPhrase(phrase.replace(/\s+/g, ' ').trim())
    if (!said || abort.current) return
    setError('')
    // Phrase coupée (« La carte sur. ») : on le dit tout de suite, sans appel (noté au journal comme une question pas comprise).
    const cut = incompletePhrase(said)
    if (cut) {
      setError(cut)
      logQuestion({ phrase: said, recipe: 'pas_comprise', recipeMissing: ['phrase incomplète'], page: 'question' }, null)
      return
    }
    setBusy(said)
    const ctrl = new AbortController()
    abort.current = ctrl
    try {
      const schema = buildQuestionSchema({ criteria, positions: POSITIONS, today: today(), regions: [], depts: [], clubs: [], groups: [], events: [] })
      const ans = await sendQuestionRequest(said, schema, ctrl.signal)
      if (ctrl.signal.aborted) return
      setText('')
      recordAsk('bilan', said)
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
  const wait = useWait(!!busy && variant === 'mic')
  // Question venue de l'en-tête (« combien de gauchers vus ? ») : posée ici dès que la page est prête. Toutes les variantes
  // la reçoivent (la première prête la prend, une seule fois) : sur téléphone, le bilan n'a souvent que le micro (« mic »),
  // le champ « text » n'existant que panneau ouvert — avant, la question arrivait sur la carte sans être posée.
  useIncomingAsk(questionReady ? 'bilan' : null, (a) => void ask(a.phrase))
  if (!questionReady) return null
  const rec = mic.phase === 'recording' || mic.phase === 'opening'
  const sending = mic.phase === 'sending' || !!busy

  const micButton = (
        <button
          type="button"
          data-noswipe
          aria-label={rec ? 'Poser une question : arrêter et demander' : sending ? 'Question en cours' : 'Poser une question à la voix'}
          aria-pressed={rec}
          title={rec ? 'Arrêter : la question est transcrite puis calculée' : `Touchez et dites par exemple « ${questionHint()} » ; touchez à nouveau pour finir (ou maintenez pendant que vous parlez)`}
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
  )
  // Une seule barre, façon Google : le micro (ordinateur) et la flèche d'envoi sont DANS la barre « Demander ».
  const form = (
    <Demander
      page="bilan"
      value={text}
      onChange={setText}
      onSubmit={(t) => void ask(t)}
      canAsk
      mic={variant === 'full' ? mic : undefined}
      micHint={questionHint()}
      disabled={sending || rec}
      wait={busy ? { phrase: busy, cancel: () => abort.current?.abort() } : null}
      calculating={calculating}
      placeholder="Une question sur le bilan, ou dites-la…"
      label="Poser une question"
      className="flex-[1_1_18rem]"
      trailing={trailing}
    />
  )
  // Barre « Demander » : l'attente est dans la pilule et juste dessous. Micro seul (barre du bas du téléphone) : une ligne
  // d'attente (✦ qui tourne, texte, fine barre, « Annuler »).
  const status =
      rec || (variant === 'mic' && mic.phase === 'sending') ? (
        <MicStatus mic={mic} dictated={false} />
      ) : busy ? (
        variant === 'mic' ? <WaitLine wait={wait} label={`« ${busy} » : je prépare la réponse…`} onCancel={() => abort.current?.abort()} /> : null
      ) : error || mic.error ? (
        <div className="text-[11px] text-red-300" role="alert">
          {error || mic.error}
        </div>
      ) : null
  const notice = (
      <p className="px-4 text-[10px] text-muted">
        Réponse calculée sur cet appareil : seule la phrase est envoyée, jamais les données des joueurs. Phase de développement : vos
        questions peuvent être enregistrées, sans nom de joueur, pour améliorer {appName()}.{' '}
        <Link to="/confidentialite#questions" className="underline">
          Confidentialité
        </Link>
      </p>
  )

  // Téléphone, barre du bas : le micro seul, en un toucher (le statut n'apparaît que pendant la question ou en cas d'erreur).
  if (variant === 'mic')
    return (
      <div className={`flex min-w-0 flex-col gap-1 ${className}`}>
        {(mic.phase !== 'idle' || busy || error || mic.error) && status}
        <div className="flex [&>button]:flex-1 [&>button]:min-w-0 [&>button]:text-xs [&>button]:leading-tight">{micButton}</div>
      </div>
    )
  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <div className="flex flex-wrap gap-2">{form}</div>
      {status}
      {!status && notice}
    </div>
  )
}
