import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { decideAction } from '../playerQuery'
import {
  calcList,
  cleanListQuery,
  emptyListQuery,
  hasListQuery,
  isListSearch,
  listFilterCount,
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
import { FilterChip, NumberInput, OPS, Select } from './RecipeChips'
import { Demander, recordAsk, useIncomingAsk } from './Demander'
import { startAskAction } from './AskAction'
import { ACTION_DISPLAY, actionDetail, detectAction } from '../askAction'
import type { AskPage } from '../demander'
import { logQuestion } from '../questionLog'
import { correctQuestionPhrase } from '../questionRescue'
import { AnswerFeedback } from './AnswerFeedback'
import { chipCount, CountText, FilterWindow, FiltersButton, useFilterWindow } from './FilterWindow'
import { BarActionsSlot, BarBelowRow } from './PageHeader'

/*
 * Filtres des listes Événements et Groupes = ÉDITEUR DE RECETTE, même expérience que la liste Joueurs
 * (src/components/PlayersQuery.tsx), moteur commun src/listQuery.ts :
 *  - la barre « Demander » (src/components/Demander.tsx : historique, suggestions, menu) et UN micro ✨ ; un simple nom (« Cannes », « Intercomités 83 ») reste
 *    une recherche locale instantanée, sans appel ; une phrase (Entrée, ✨, micro) part au mode « question » avec le contexte
 *    de la page (« evenements », « groupes ») et les NOMS des filtres posés seulement ; la recette rendue est revérifiée ici
 *    puis FUSIONNÉE : par défaut elle AJOUTE ; on n'efface ou ne retire que si c'est dit ; « Annuler » ; ligne « Ajouté : … » ;
 *  - les filtres en PASTILLES (toucher : la fenêtre « Filtres » s'ouvre sur le réglage de ce filtre, ou un petit réglage
 *    pour ceux qui n'y sont pas ; × : retirer), « Tout effacer » ; « Filtres » : la fenêtre des filtres de la page, posée
 *    au-dessus de la liste (src/components/FilterWindow.tsx), chaque choix appliqué tout de suite ;
 *  - question de calcul (« combien par mois ? ») : réponse au-dessus de la liste, qui reste filtrée ;
 *  - état gardé pendant la session : « Retour » depuis un événement ou un groupe retrouve la même liste, les mêmes pastilles.
 * Micro seulement si la fonction déployée annonce le contexte (« question_evenements », « question_groupes ») ; sinon le
 * champ reste une recherche locale (et les filtres, la fenêtre), sans régression.
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
  /**
   * Réglages de la fenêtre « Filtres » de la page (filtres rapides, conditions, tri). Chaque réglage porte `data-filter`
   * (clé du filtre) ; `focus` : la fenêtre a été ouverte depuis la pastille de ce filtre (déplier ce qui le cache).
   */
  panel: (qy: ListQuery<F>, setQy: (q: ListQuery<F>) => void, focus?: { key: string; n: number }) => ReactNode
  /** Pastilles dont le réglage est dans la fenêtre « Filtres » (toucher : la fenêtre s'ouvre dessus) ; les autres gardent `chipEditor`. */
  inWindow?: (key: string, qy: ListQuery<F>) => boolean
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
  // Fenêtre « Filtres » (src/components/FilterWindow.tsx) : posée au-dessus de la liste, ouverte de n'importe où.
  const fw = useFilterWindow()
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

  // Nom de personne approchant à confirmer (« Tu voulais dire … ? ») avant d'appliquer la phrase (filtre par créateur).
  type Pending = { phrase: string; before: ListQuery<F>; it: ListIncoming<F>; action: ReturnType<typeof decideAction>; remove: string[]; notes: string[]; local: boolean }
  const [confirm, setConfirm] = useState<(Pending & { at: number }) | null>(null)

  async function ask(phrase: string) {
    // Dictée relue comme une question (« vœu » → « Var ») : src/questionRescue.ts.
    const said = correctQuestionPhrase(phrase.replace(/\s+/g, ' ').trim())
    if (!said || abort.current) return
    setError('')
    setConfirm(null)
    // Une action (« ajoute les gauchers au groupe X », « les gauchers dans l'événement X ») : la carte de validation
    // (src/components/AskAction.tsx). Le filtre par créateur de CETTE liste (« les groupes que Paul a créés ») se fait ici,
    // sans appel : le nom dit est retrouvé parmi les créateurs connus de l'appareil (approchant : à confirmer).
    const act = detectAction(said, askPage)
    const mine = act?.kind === 'plan' && act.plan.action === 'filtrer_createur' && act.plan.list === id ? act.plan : null
    if (act && !mine) {
      setText('')
      recordAsk(askPage, said)
      startAskAction(said, askPage, act)
      return
    }
    if (!mine && (!micReady || isListSearch(said, o.hays))) {
      setText(said)
      recordAsk(askPage, said)
      return
    }
    const local = mine ? null : localListCommand(spec, said)
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
      const ans = mine
        ? { recette: { createurs: mine.creators }, nonGere: [] as string[], action: 'ajouter', retirer: [] as unknown[] }
        : await sendQuestionRequest(said, o.schema(), ctrl.signal, { contexte: id, actuels: listKeysForModel(spec, before) })
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
      const p: Pending = { phrase: said, before, it, action, remove, notes, local: !!mine }
      if (it.confirm?.length) setConfirm({ ...p, at: 0 })
      else finish(p)
    } catch (e) {
      if (!(e instanceof DictationError && e.code === 'annule')) setError(e instanceof DictationError ? e.message : ERROR_TEXT.mistral_erreur)
    } finally {
      if (abort.current === ctrl) abort.current = null
      setBusy('')
    }
  }

  /** Recette lue (noms confirmés) : fusionnée, notée au journal, appliquée. `confirmed` : un nom approchant a été confirmé. */
  function finish(p: Pending, confirmed = false) {
    const merged = mergeListQuery(spec, p.before, p.it, p.action, p.remove, o.regionOf)
    const nothing = p.action === 'ajouter' && !p.remove.length && sameListQuery(spec, merged, p.before)
    // Journal des questions (comme la liste Joueurs) : la phrase anonymisée et ce qu'en a fait la recette ; filtre par
    // créateur (règle locale ou nom confirmé) : l'action et ce qu'en a fait l'entraîneur.
    const logId = logQuestion(
      {
        phrase: p.phrase,
        recipe: nothing ? 'pas_comprise' : p.notes.length || p.it.unsupported.length ? 'partielle' : 'complete',
        recipeMissing: [...p.it.unsupported, ...p.notes],
        page: id,
        ...(confirmed || p.local ? { display: ACTION_DISPLAY, detail: actionDetail('filtrer_createur', confirmed ? 'acceptee' : 'appliquee') } : {}),
      },
      null,
    )
    if (nothing) setResult({ phrase: p.phrase, before: p.before, text: '', nothing: true, unsupported: [...p.it.unsupported, ...p.notes], logId })
    else applyPhrase(p.phrase, p.before, merged, { notes: p.notes, unsupported: p.it.unsupported, logId })
  }

  /** « Oui » ou un autre nom : il remplace le nom dit ; tous les noms confirmés, la phrase s'applique. */
  function pickName(name: string) {
    if (!confirm) return
    const c = confirm.it.confirm![confirm.at]
    const f = { ...confirm.it.f } as Record<string, unknown>
    f[c.key] = [...new Set([...((f[c.key] as string[] | undefined) ?? []), name])]
    const it = { ...confirm.it, f: f as Partial<F> }
    if (confirm.at + 1 < (it.confirm?.length ?? 0)) return setConfirm({ ...confirm, it, at: confirm.at + 1 })
    setConfirm(null)
    finish({ ...confirm, it }, true)
  }
  function cancelName() {
    if (!confirm) return
    logQuestion({ phrase: confirm.phrase, recipe: 'partielle', recipeMissing: confirm.notes, page: id, display: ACTION_DISPLAY, detail: actionDetail('filtrer_createur', 'annulee') }, null)
    setConfirm(null)
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
  // « Filtres » logé dans la barre (étiquette arrondie, comme « Mode IA » chez Google), avec le nombre de filtres posés ;
  // devant, collé, le nombre d'éléments de la liste filtrée (« 7 sur 52 · Filtres ▾ »).
  const filtersButton = (
    <FiltersButton w={fw} n={listFilterCount(spec, qy)} count={chipCount(filtered.length, (n) => o.noun[n > 1 ? 1 : 0], { loading: !items || !ctx })} />
  )
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
      wait={busy ? { phrase: busy, cancel: () => abort.current?.abort() } : null}
      label={micReady ? 'Demander : filtrer ou poser une question' : 'Rechercher'}
      trailing={filtersButton}
    />
  )
  const shownResult = result && (result.nothing || !result.after || sameListQuery(spec, result.after, qy)) ? result : null
  const toConfirm = confirm?.it.confirm?.[confirm.at]
  const status = toConfirm ? (
    <div className="card flex flex-col gap-2 border-ai/40 p-3 text-xs" role="alert">
      <p className="text-sm font-bold">
        <span className="text-ai" aria-hidden>
          ✦{' '}
        </span>
        Tu voulais dire « {toConfirm.choices[0]} » ?
      </p>
      <p className="text-[11px] text-muted">J’ai compris « {toConfirm.said} » ({o.noun[1]} créés par…), qui n’est pas un nom exact de cet appareil.</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-primary min-h-10 px-4 text-xs" onClick={() => pickName(toConfirm.choices[0])}>
          Oui
        </button>
        {toConfirm.choices.slice(1).map((c) => (
          <button key={c} type="button" className="btn-ghost min-h-10 px-3 text-xs" onClick={() => pickName(c)}>
            {c}
          </button>
        ))}
        <button type="button" className="btn-ghost min-h-10 px-3 text-xs text-muted" onClick={cancelName}>
          Annuler
        </button>
      </div>
    </div>
  ) : rec ? (
      <MicStatus mic={mic} dictated={false} />
    ) : sending ? null : error ? (
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
      inWindow={o.inWindow ? (k) => o.inWindow!(k, qy) : undefined}
      onOpenWindow={fw.openAt}
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
  // Barre « Demander », pastilles et filtres : largeur maximale, centrés (façon Google) sur grand écran.
  const ui = (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-2">
      <div className="flex items-center gap-2">
        {field}
        <BarActionsSlot />
      </div>
      <BarBelowRow />
      {status}
      {chips}
      <FilterWindow
        w={fw}
        count={<CountText n={filtered.length} noun={(n) => o.noun[n > 1 ? 1 : 0]} />}
        onClear={hasListQuery(spec, qy) || qy.calc ? reset : undefined}
      >
        {o.panel(qy, setQy, fw.focus)}
        {privacy}
      </FilterWindow>
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
  inWindow,
  onOpenWindow,
}: {
  spec: ListSpec<F, T, C>
  qy: ListQuery<F>
  ctx: C
  setQy: (q: ListQuery<F>) => void
  open: string | null
  setOpen: (k: string | null) => void
  editor?: (key: string, qy: ListQuery<F>, setQy: (q: ListQuery<F>) => void) => ReactNode
  after?: ReactNode
  inWindow?: (key: string) => boolean
  onOpenWindow: (key: string) => void
}) {
  const chips = listChips(spec, qy, ctx)
  const chip = chips.find((c) => c.key === open)
  if (!chips.length && !after) return null
  const value = chip && chip.key !== 'sort' ? (qy.f as Record<string, unknown>)[chip.key] : undefined
  const num = value && typeof value === 'object' && 'op' in (value as object) && 'n' in (value as object) ? (value as NumCond) : undefined
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-1.5" aria-label="Filtres posés : toucher une pastille pour la régler, × pour la retirer">
        {chips.map((c) => {
          // Réglage dans la fenêtre « Filtres » : elle s'ouvre dessus ; sinon (nombre de joueurs, créateur…) petit réglage.
          const win = !!inWindow?.(c.key)
          return (
            <FilterChip
              key={c.key}
              label={c.label}
              open={c.key === open}
              edit
              opensWindow={win}
              onToggle={() => {
                if (!win) return setOpen(c.key === open ? null : c.key)
                setOpen(null)
                onOpenWindow(c.key)
              }}
              onRemove={() => {
                if (c.key === open) setOpen(null)
                setQy(removeListKeys(qy, [c.key]))
              }}
            />
          )
        })}
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
  k,
}: {
  /** Filtre réglé ici (pastille touchée : la fenêtre s'ouvre sur ce réglage). */
  k?: string
  label: string
  value: V | ''
  options: readonly { value: V; label: string; short?: string }[]
  counts?: Map<string, number>
  total?: number
  onChange: (v: V | '') => void
}) {
  return (
    <div className="flex flex-col gap-1" data-filter={k}>
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
    <div className="flex flex-col gap-2 rounded-md border border-line p-2 text-xs" data-filter="sort">
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
