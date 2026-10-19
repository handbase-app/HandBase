import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { decideAction } from '../playerQuery'
import {
  activeListKeys,
  calcList,
  cleanListQuery,
  emptyListQuery,
  hasListQuery,
  isListSearch,
  listChangeText,
  listChips,
  listKeysForModel,
  listKeysOfWord,
  localListCommand,
  mergeListQuery,
  removeListKeys,
  sameListQuery,
  selectItems,
  type CalcAnswer,
  type ListIncoming,
  type ListQuery,
  type ListSpec,
  type NumCond,
} from '../listQuery'
import { sendQuestionRequest, useDictation } from '../dictation/useDictation'
import { DictationError, ERROR_TEXT } from '../dictation/transcribe'
import { MicStatus, useMicRecorder } from './MicButton'
import { useSessionState } from './PlayerFilter'
import { chipCls, NumberInput, OPS, Select } from './RecipeChips'
import { Demander, recordAsk, useIncomingAsk } from './Demander'
import type { AskPage } from '../demander'
import { logQuestion } from '../questionLog'
import { correctQuestionPhrase } from '../questionRescue'
import { AnswerFeedback } from './AnswerFeedback'

/*
 * Filtres des listes Événements et Groupes = ÉDITEUR DE RECETTE, même expérience que la liste Joueurs
 * (src/components/PlayersQuery.tsx), moteur commun src/listQuery.ts :
 *  - la barre « Demander » (src/components/Demander.tsx : historique, suggestions, menu) et UN micro ✨ ; un simple nom (« Cannes », « Intercomités 83 ») reste
 *    une recherche locale instantanée, sans appel ; une phrase (Entrée, ✨, micro) part au mode « question » avec le contexte
 *    de la page (« evenements », « groupes ») et les NOMS des filtres posés seulement ; la recette rendue est revérifiée ici
 *    puis FUSIONNÉE : par défaut elle AJOUTE ; on n'efface ou ne retire que si c'est dit ; « Annuler » ; ligne « Ajouté : … » ;
 *  - les filtres en PASTILLES (toucher : régler ou « Retirer »), « Tout effacer » ; « Filtres » : le panneau de la page ;
 *  - question de calcul (« combien par mois ? ») : réponse au-dessus de la liste, qui reste filtrée ;
 *  - état gardé pendant la session : « Retour » depuis un événement ou un groupe retrouve la même liste, les mêmes pastilles.
 * Micro seulement si la fonction déployée annonce le contexte (« question_evenements », « question_groupes ») ; sinon le
 * champ reste une recherche locale (et les filtres, le panneau), sans régression.
 */

const fr = (n: number) => n.toLocaleString('fr-FR')

/** logId : ligne du journal des questions (avis sur la réponse). */
type ResultLine<F> = { phrase: string; before: ListQuery<F>; after?: ListQuery<F>; text: string; notes?: string[]; unsupported?: string[]; nothing?: boolean; logId?: string }

export type ListQueryOptions<F extends object, T, C> = {
  spec: ListSpec<F, T, C>
  items: T[] | undefined
  /** Données des filtres (null : pas encore prêtes). */
  ctx: C | null
  /** Recette rendue par le modèle, revérifiée par la page. */
  read: (raw: unknown, nonGere: string[]) => ListIncoming<F>
  /** Description de la recette (clés, valeurs permises) : aucune donnée. */
  schema: () => Record<string, string>
  /** Exemples du micro (« les tournois de cette saison », « combien par mois ? »). */
  hint: string
  /** Panneau « Filtres » de la page (filtres rapides, conditions, tri). */
  panel: (qy: ListQuery<F>, setQy: (q: ListQuery<F>) => void) => ReactNode
  /** Réglage d'une pastille propre à la page (période…) ; sinon nombre (op, n) ou « Retirer » seulement. */
  chipEditor?: (key: string, qy: ListQuery<F>, setQy: (q: ListQuery<F>) => void) => ReactNode
  /** Totaux affichés avec un calcul (« 125 joueurs · 340 avis »). */
  sums?: { unit: (n: number) => string; get: (t: T) => number }[]
  /** Nom de l'élément (« événement », « groupe ») pour les nombres. */
  noun: [string, string]
  regionOf: (d: string) => string | undefined
  /** Textes de la recherche locale (un nom tapé qui trouve un élément reste une recherche). */
  hays: string[]
}

export function useListQuery<F extends object, T, C>(o: ListQueryOptions<F, T, C>) {
  const { spec, items, ctx } = o
  const id = spec.id
  const { questionReady, searchModes } = useDictation()
  const micReady = questionReady && searchModes.includes(`question_${id}`)

  // ---------- État (session) ----------
  const [raw, setRaw] = useSessionState<unknown>(`handbase.${id}.recette`, emptyListQuery<F>())
  const qy = useMemo(() => cleanListQuery(spec, raw), [spec, raw])
  const [text, setText] = useSessionState(`handbase.${id}.texte`, qy.q)
  const [result, setResult] = useSessionState<ResultLine<F> | null>(`handbase.${id}.resultat`, null)
  const [open, setOpen] = useSessionState(`handbase.${id}.filtres`, false)
  const [chipOpen, setChipOpen] = useState<string | null>(null)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const abort = useRef<AbortController | null>(null)
  useEffect(() => () => abort.current?.abort(), [])

  const setQy = (next: ListQuery<F>) => {
    const clean = cleanListQuery(spec, next)
    setRaw(clean)
    if (clean.q !== qy.q && clean.q !== text && isListSearch(text, o.hays)) setText(clean.q)
  }

  // ---------- Liste ----------
  const filtered = useMemo(() => (items && ctx ? selectItems(spec, items, qy, ctx) : []), [spec, items, ctx, qy])
  const calc: CalcAnswer | null = useMemo(
    () => (qy.calc && ctx ? calcList(spec, filtered, qy.calc, ctx, (o.sums ?? []).map((s) => s.get)) : null),
    [spec, filtered, qy.calc, ctx, o.sums],
  )

  // ---------- Recherche locale (instantanée, léger délai pendant la frappe) ----------
  const nameMode = !micReady || isListSearch(text, o.hays)
  useEffect(() => {
    const q = nameMode ? text.replace(/\s+/g, ' ').trim() : ''
    if (q === qy.q.trim()) return
    const t = window.setTimeout(() => setRaw({ ...qy, q }), q ? 150 : 0)
    return () => window.clearTimeout(t)
  }, [text, nameMode]) // eslint-disable-line react-hooks/exhaustive-deps

  // ---------- Phrase ----------
  function applyPhrase(phrase: string, before: ListQuery<F>, after: ListQuery<F>, extra: Partial<ResultLine<F>> = {}) {
    const ch = ctx ? listChangeText(spec, before, after, ctx).text : ''
    const calcText = after.calc && JSON.stringify(after.calc) !== JSON.stringify(before.calc) ? 'Calcul sur la sélection : voir la réponse' : ''
    setQy(after)
    setText('')
    setResult({ phrase, before, after: cleanListQuery(spec, after), text: [ch, calcText].filter(Boolean).join(' — ') || (sameListQuery(spec, before, after) ? '' : 'Filtres changés'), ...extra })
    recordAsk(askPage, phrase)
  }
  // Historique de la barre « Demander » et demandes venues de l'en-tête (pages Événements et Groupes).
  const askPage: AskPage = id === 'groupes' ? 'groupes' : 'evenements'
  useIncomingAsk(askPage, (a) => void ask(a.phrase))

  async function ask(phrase: string) {
    // Dictée relue comme une question (« vœu » → « Var ») : src/questionRescue.ts.
    const said = correctQuestionPhrase(phrase.replace(/\s+/g, ' ').trim())
    if (!said || abort.current) return
    setError('')
    if (!micReady || isListSearch(said, o.hays)) {
      setText(said)
      recordAsk(askPage, said)
      return
    }
    const local = localListCommand(spec, said)
    if (local) {
      if (local.action === 'effacer') setChipOpen(null)
      applyPhrase(said, qy, local.action === 'effacer' ? emptyListQuery<F>() : removeListKeys(qy, local.keys))
      return
    }
    setBusy(said)
    const ctrl = new AbortController()
    abort.current = ctrl
    const before = qy
    try {
      const ans = await sendQuestionRequest(said, o.schema(), ctrl.signal, { contexte: id, actuels: listKeysForModel(spec, before) })
      if (ctrl.signal.aborted) return
      setText('')
      const it = o.read(ans.recette, ans.nonGere)
      const action = decideAction(ans.action, said)
      const remove: string[] = []
      const notes = [...it.notes]
      for (const r of ans.retirer ?? []) {
        const ks = listKeysOfWord(spec, r)
        if (ks.length) remove.push(...ks)
        else if (typeof r === 'string') notes.push(`retirer « ${r.slice(0, 30)} » (filtre inconnu)`)
      }
      const merged = mergeListQuery(spec, before, it, action, remove, o.regionOf)
      const nothing = action === 'ajouter' && !remove.length && sameListQuery(spec, merged, before)
      // Journal des questions (comme la liste Joueurs) : la phrase anonymisée et ce qu'en a fait la recette.
      const logId = logQuestion(
        { phrase: said, recipe: nothing ? 'pas_comprise' : notes.length || it.unsupported.length ? 'partielle' : 'complete', recipeMissing: [...it.unsupported, ...notes], page: id },
        null,
      )
      if (nothing) setResult({ phrase: said, before, text: '', nothing: true, unsupported: [...it.unsupported, ...notes], logId })
      else applyPhrase(said, before, merged, { notes, unsupported: it.unsupported, logId })
    } catch (e) {
      if (!(e instanceof DictationError && e.code === 'annule')) setError(e instanceof DictationError ? e.message : ERROR_TEXT.mistral_erreur)
    } finally {
      if (abort.current === ctrl) abort.current = null
      setBusy('')
    }
  }

  const mic = useMicRecorder((t) => void ask(t))
  const rec = mic.phase === 'recording' || mic.phase === 'opening'
  const sending = mic.phase === 'sending' || !!busy

  const reset = () => {
    setQy(emptyListQuery<F>())
    setText('')
    setResult(null)
    setChipOpen(null)
  }

  // ---------- Champ, micro, pastilles, ligne de résultat ----------
  const nChips = activeListKeys(spec, qy).filter((k) => k !== 'q').length
  const field = (
    <Demander
      page={askPage}
      value={text}
      onChange={setText}
      onSubmit={(t) => void ask(t)}
      canAsk={micReady}
      nameMode={nameMode}
      mic={micReady ? mic : undefined}
      micHint={o.hint}
      disabled={sending || rec}
      label={micReady ? 'Demander : filtrer ou poser une question' : 'Rechercher'}
    />
  )
  const filtersButton = (
    <button
      type="button"
      onClick={() => setOpen(!open)}
      aria-expanded={open}
      className={`min-h-11 shrink-0 rounded-md border px-3 text-xs font-bold ${open || nChips ? 'border-accent text-fg' : 'border-line text-muted'} ${open ? 'bg-accent/15' : 'bg-panel-2'}`}
    >
      Filtres{nChips > 0 && <span className="ml-1 rounded-full bg-accent px-1.5 text-[10px] text-white">{nChips}</span>} {open ? '▴' : '▾'}
    </button>
  )
  const shownResult = result && (result.nothing || !result.after || sameListQuery(spec, result.after, qy)) ? result : null
  const status =
    mic.phase !== 'idle' ? (
      <MicStatus mic={mic} dictated={false} />
    ) : busy ? (
      <div className="flex items-center gap-2 text-xs text-muted" role="status">
        <span className="h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent" />
        <span className="min-w-0 flex-1 truncate">« {busy} » : je prépare la recette…</span>
        <button type="button" className="min-h-9 shrink-0 px-2 text-[11px] font-bold underline" onClick={() => abort.current?.abort()}>
          Annuler
        </button>
      </div>
    ) : error ? (
      <div className="text-[11px] text-red-300" role="alert">
        {error}
      </div>
    ) : shownResult && !shownResult.nothing ? (
      <ResultView r={shownResult} onUndo={() => (setQy(shownResult.before), setResult(null))} onClose={() => setResult(null)} />
    ) : !nameMode && text.trim() ? (
      <div className="text-[10px] text-muted">Entrée ou ✨ : la phrase s’ajoute aux filtres (seule la phrase est envoyée, jamais les données).</div>
    ) : micReady && qy.q.trim() && items && ctx && !filtered.length ? (
      <button type="button" className="min-h-9 self-start text-[11px] font-bold text-accent underline" onClick={() => void ask(`les ${o.noun[1]} ${qy.q.trim()}`)}>
        ✨ Comprendre « {qy.q.trim()} » comme une phrase
      </button>
    ) : null
  const chips = ctx && (
    <ListChips
      spec={spec}
      qy={qy}
      ctx={ctx}
      setQy={setQy}
      open={chipOpen}
      setOpen={setChipOpen}
      editor={o.chipEditor}
      after={
        hasListQuery(spec, qy) || qy.calc ? (
          <button type="button" className="min-h-9 px-1 text-[11px] font-bold text-muted underline" onClick={reset}>
            Tout effacer
          </button>
        ) : undefined
      }
    />
  )
  const privacy = micReady && (
    <p className="text-[10px] text-muted">
      Une phrase envoie seulement ses mots (et les noms des filtres posés), jamais les données ; les noms dits sont retrouvés sur l’appareil.{' '}
      <Link to="/confidentialite#questions" className="underline">
        Confidentialité
      </Link>
    </p>
  )
  const ui = (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2">
        {field}
        {filtersButton}
      </div>
      {status}
      {chips}
      {open && (
        <div className="flex flex-col gap-2 rounded-lg border border-line bg-panel p-2.5">
          {o.panel(qy, setQy)}
        </div>
      )}
      {open && privacy}
    </div>
  )

  // ---------- Au-dessus de la liste : réponse « pas compris », calcul, avis sur la réponse ----------
  const top = (
    <>
      {shownResult?.nothing && (
        <div className="card flex flex-col gap-1 border-sky-500/40 p-3 text-xs" role="status">
          <div className="flex items-start gap-2">
            <p className="min-w-0 flex-1 font-bold">Je ne sais pas encore répondre à : « {shownResult.phrase} »</p>
            <button type="button" className="min-h-9 shrink-0 px-1 text-muted" aria-label="Fermer" onClick={() => setResult(null)}>
              ✕
            </button>
          </div>
          {!!shownResult.unsupported?.length && <p className="text-muted">Pas pris en compte : {shownResult.unsupported.join(' ; ')}</p>}
          <p className="text-muted">Les filtres n’ont pas changé. Essayez par exemple « {o.hint} ».</p>
        </div>
      )}
      {qy.calc && (
        <CalcView
          answer={calc}
          title={qy.calc.type === 'table' ? (spec.groupings.find((g) => g.value === (qy.calc as { by: string }).by)?.label ?? '') : ''}
          noun={o.noun}
          sums={o.sums ?? []}
          onClose={() => setQy({ ...qy, calc: undefined })}
        />
      )}
      <AnswerFeedback questionId={shownResult?.logId} page={id} />
    </>
  )

  /** Change dès qu'un filtre change (position et nombre affiché remis à zéro). */
  const signature = JSON.stringify([qy.f, qy.q, qy.sort ?? null])
  return { qy, setQy, filtered, active: hasListQuery(spec, qy), ui, top, signature, reset }
}

// ---------- Pastilles ----------

function ListChips<F extends object, T, C>({
  spec,
  qy,
  ctx,
  setQy,
  open,
  setOpen,
  editor,
  after,
}: {
  spec: ListSpec<F, T, C>
  qy: ListQuery<F>
  ctx: C
  setQy: (q: ListQuery<F>) => void
  open: string | null
  setOpen: (k: string | null) => void
  editor?: (key: string, qy: ListQuery<F>, setQy: (q: ListQuery<F>) => void) => ReactNode
  after?: ReactNode
}) {
  const chips = listChips(spec, qy, ctx)
  const chip = chips.find((c) => c.key === open)
  if (!chips.length && !after) return null
  const value = chip && chip.key !== 'sort' ? (qy.f as Record<string, unknown>)[chip.key] : undefined
  const num = value && typeof value === 'object' && 'op' in (value as object) && 'n' in (value as object) ? (value as NumCond) : undefined
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-1.5" aria-label="Filtres posés : toucher une pastille pour la régler ou la retirer">
        {chips.map((c) => (
          <button key={c.key} type="button" className={chipCls(c.key === open)} aria-expanded={c.key === open} onClick={() => setOpen(c.key === open ? null : c.key)}>
            <span className="min-w-0 truncate">{c.label}</span>
            <span className="shrink-0 text-[10px] opacity-60">▾</span>
          </button>
        ))}
        {after}
      </div>
      {chip && (
        <div className="flex flex-col gap-2 rounded-md border border-accent/50 bg-panel p-2 text-xs">
          {editor?.(chip.key, qy, setQy)}
          {num && (
            <div className="flex flex-wrap items-center gap-2">
              <Select label="Opérateur" value={num.op} options={OPS} onChange={(op) => setQy({ ...qy, f: { ...qy.f, [chip.key]: { ...num, op } } })} />
              <NumberInput key={chip.key} value={num.n} min={0} max={100000} label="Nombre" onChange={(n) => setQy({ ...qy, f: { ...qy.f, [chip.key]: { ...num, n } } })} />
            </div>
          )}
          {chip.key === 'sort' && qy.sort && (
            <div className="flex flex-wrap items-center gap-2">
              <Select label="Trier par" value={qy.sort.by} options={spec.sorts.map((s) => ({ value: s.value, label: s.label }))} onChange={(by) => setQy({ ...qy, sort: { by, dir: spec.sorts.find((s) => s.value === by)!.dir } })} />
              <Select<'asc' | 'desc'>
                label="Ordre"
                value={qy.sort.dir}
                options={[
                  { value: 'asc', label: '↑ croissant' },
                  { value: 'desc', label: '↓ décroissant' },
                ]}
                onChange={(dir) => setQy({ ...qy, sort: { ...qy.sort!, dir } })}
              />
            </div>
          )}
          <div className="flex gap-2">
            <button
              type="button"
              className="btn-ghost min-h-11 px-3 text-xs"
              onClick={() => {
                setQy(removeListKeys(qy, [chip.key]))
                setOpen(null)
              }}
            >
              Retirer
            </button>
            <button type="button" className="min-h-11 px-3 text-xs text-muted underline" onClick={() => setOpen(null)}>
              Fermer
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

/** Ligne de résultat d'une phrase : ce qui a changé, « Annuler », ce qui n'a pas été appliqué. */
function ResultView<F>({ r, onUndo, onClose }: { r: ResultLine<F>; onUndo: () => void; onClose: () => void }) {
  return (
    <div className="flex flex-col gap-1 rounded-md border border-accent/40 bg-accent/5 px-2 py-1.5 text-[11px]" role="status">
      <div className="flex items-start gap-2">
        <span className="min-w-0 flex-1">{r.text ? <b>{r.text}</b> : <span>Les filtres n’ont pas changé (« {r.phrase} »).</span>}</span>
        {r.text && (
          <button type="button" className="min-h-9 shrink-0 font-bold underline" onClick={onUndo}>
            Annuler
          </button>
        )}
        <button type="button" className="min-h-9 shrink-0 px-1 text-muted" aria-label="Fermer" onClick={onClose}>
          ✕
        </button>
      </div>
      <span className="truncate text-muted">
        <span className="text-ai" aria-hidden>
          ✦
        </span>{' '}
        « {r.phrase} »
      </span>
      {!!r.unsupported?.length && (
        <span>
          <b>Pas pris en compte :</b> {r.unsupported.join(' ; ')}
        </span>
      )}
      {!!r.notes?.length && (
        <span className="text-muted">
          <b>Non appliqué :</b> {r.notes.join(' ; ')}
        </span>
      )}
    </div>
  )
}

/** Réponse d'une question de calcul, sur la sélection : combien (et les totaux), ou un petit tableau. */
function CalcView<T>({
  answer,
  title,
  noun,
  sums,
  onClose,
}: {
  answer: CalcAnswer | null
  title: string
  noun: [string, string]
  sums: { unit: (n: number) => string; get: (t: T) => number }[]
  onClose: () => void
}) {
  const sumText = (xs: number[]) => xs.map((n, i) => `${fr(n)} ${sums[i].unit(n)}`).join(' · ')
  return (
    <div className="card flex flex-col gap-1 p-3 text-xs">
      <div className="flex items-start gap-2">
        <span className="min-w-0 flex-1 text-[11px] font-bold text-muted">Sur la sélection{title ? ` · ${title.toLowerCase()}` : ''}</span>
        <button type="button" className="min-h-9 shrink-0 px-1 text-muted" aria-label="Fermer la réponse" onClick={onClose}>
          ✕
        </button>
      </div>
      {!answer ? (
        <span className="text-muted">Calcul…</span>
      ) : !answer.rows ? (
        <>
          <span className="text-3xl font-extrabold tabular-nums">{fr(answer.count)}</span>
          <span>{answer.count > 1 ? noun[1] : noun[0]}</span>
          {sums.length > 0 && <span className="font-bold">{sumText(answer.sums)}</span>}
        </>
      ) : !answer.rows.length ? (
        <span className="text-muted">Aucune ligne pour l’instant.</span>
      ) : (
        <table className="w-full border-collapse">
          <tbody>
            {answer.rows.slice(0, 30).map((row) => (
              <tr key={row.key || '?'} className="border-t border-line first:border-t-0">
                <td className={`py-1.5 pr-2 ${row.key ? '' : 'text-muted italic'}`}>{row.label}</td>
                <td className="py-1.5 text-right tabular-nums">
                  <b>{fr(row.n)}</b>
                  {sums.length > 0 && <span className="text-muted"> · {sumText(row.sums)}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {(answer?.rows?.length ?? 0) > 30 && <span className="text-[10px] text-muted">Les 30 premières lignes.</span>}
    </div>
  )
}

// ---------- Morceaux communs des panneaux « Filtres » ----------

/** Rang de boutons (Tous + valeurs), chacun avec son nombre d'éléments (les autres filtres appliqués). */
export function SegRow<V extends string>({
  label,
  value,
  options,
  counts,
  total,
  onChange,
}: {
  label: string
  value: V | ''
  options: readonly { value: V; label: string; short?: string }[]
  counts?: Map<string, number>
  total?: number
  onChange: (v: V | '') => void
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] font-bold tracking-wider text-muted uppercase">{label}</span>
      <div className="flex overflow-hidden rounded-md border border-line text-xs font-bold" role="group" aria-label={label}>
        {[{ value: '' as const, label: 'Tous', short: 'Tous' }, ...options].map((x) => {
          const n = counts ? (x.value ? (counts.get(x.value) ?? 0) : total) : undefined
          return (
            <button
              key={x.value}
              type="button"
              aria-pressed={value === x.value}
              onClick={() => onChange(x.value)}
              disabled={n === 0 && value !== x.value}
              className={`min-h-11 min-w-0 flex-1 px-1 leading-tight disabled:opacity-40 ${value === x.value ? 'bg-accent text-white' : 'bg-panel-2 text-muted'}`}
            >
              {x.short ?? x.label}
              {n !== undefined && <span className="ml-1 text-[10px] font-normal opacity-70">{n}</span>}
            </button>
          )
        })}
      </div>
    </div>
  )
}

/** Bouton d'un filtre oui / non (« avec vidéo »), avec son nombre. */
export function ToggleChip({ on, label, n, onChange }: { on: boolean; label: string; n?: number; onChange: (on: boolean) => void }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={() => onChange(!on)}
      disabled={n === 0 && !on}
      className={`min-h-11 rounded-full border px-3 text-xs font-bold disabled:opacity-40 ${on ? 'border-accent bg-accent text-white' : 'border-line bg-panel-2 text-muted'}`}
    >
      {label}
      {n !== undefined && <span className="ml-1 text-[10px] font-normal opacity-70">{n}</span>}
    </button>
  )
}

/** « Trier par » et « Calculer sur la sélection » (mêmes réglages que « classés par… », « combien par mois ? » dits). */
export function SortCalcPicker<F extends object, T, C>({ spec, qy, setQy }: { spec: ListSpec<F, T, C>; qy: ListQuery<F>; setQy: (q: ListQuery<F>) => void }) {
  const calcValue = !qy.calc ? '' : qy.calc.type === 'count' ? 'count' : qy.calc.by
  return (
    <div className="flex flex-col gap-2 rounded-md border border-line p-2 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-bold text-muted">Trier par</span>
        <Select
          label="Trier par"
          value={qy.sort?.by ?? ''}
          options={[{ value: '', label: 'Ordre habituel' }, ...spec.sorts.map((s) => ({ value: s.value, label: s.label }))]}
          onChange={(by) => setQy({ ...qy, sort: by ? { by, dir: spec.sorts.find((s) => s.value === by)!.dir } : undefined })}
        />
        {qy.sort && (
          <Select<'asc' | 'desc'>
            label="Ordre"
            value={qy.sort.dir}
            options={[
              { value: 'asc', label: '↑' },
              { value: 'desc', label: '↓' },
            ]}
            onChange={(dir) => setQy({ ...qy, sort: { ...qy.sort!, dir } })}
          />
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-bold text-muted">Calculer</span>
        <Select
          label="Calcul sur la sélection"
          value={calcValue}
          options={[{ value: '', label: 'Rien' }, { value: 'count', label: 'Combien' }, ...spec.groupings.map((g) => ({ value: g.value, label: g.label }))]}
          onChange={(v) => setQy({ ...qy, calc: !v ? undefined : v === 'count' ? { type: 'count' } : { type: 'table', by: v } })}
        />
      </div>
    </div>
  )
}
