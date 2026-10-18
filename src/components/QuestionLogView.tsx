import { useState } from 'react'
import type { QuestionLog } from '../db'
import { clearQuestionLog, setRecipeDone, useQuestionLog } from '../questionLog'
import {
  copyForClaude,
  filterEntries,
  groupEntries,
  outcomeOf,
  OUTCOME_LABEL,
  RECIPE_LABEL,
  STATUS_LABEL,
  type GroupSort,
  type LogFilter,
  type Outcome,
  type QuestionLogRow,
} from '../questionLogCore'
import { ask } from './Confirm'
import { Icon, Segmented } from './ui'
import { appName } from '../appBrand'

/*
 * Réglages > « Journal des questions » (administrateurs) : TOUTES les questions de « Poser une question » (src/questionLog.ts),
 * avec ce qu'en a fait la recette (complète, partielle, pas comprise) et, s'il a été lancé, le mode avancé. Phrases et
 * requêtes anonymisées, aucun résultat. Filtres par issue (ratées, sauvées par le mode avancé, comprises), regroupement des
 * phrases semblables avec leur nombre, tri « ratées d'abord » ou « les plus fréquentes ». « Copier pour Claude » donne les
 * ratés à traiter et les questions les plus fréquentes ; une fois la recette écrite, on coche « Transformée en recette ».
 */

const PAGE = 30

const when = (iso: string) =>
  new Date(iso).toLocaleString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })

const OUTCOME_CLS: Record<Outcome, string> = {
  rate: 'border-amber-500/60 text-amber-300',
  sauvee: 'border-sky-500/50 text-sky-300',
  complete: 'border-emerald-500/50 text-emerald-300',
}

function OutcomeTag({ outcome }: { outcome: Outcome }) {
  return <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${OUTCOME_CLS[outcome]}`}>{OUTCOME_LABEL[outcome]}</span>
}

function DoneBox({ rows, label = 'Transformée en recette' }: { rows: QuestionLog[]; label?: string }) {
  const done = rows.every((r) => r.recipeDone)
  return (
    <label className="flex min-h-9 cursor-pointer items-center gap-2 text-[11px] font-bold">
      <input type="checkbox" className="h-4 w-4" checked={done} onChange={(ev) => void setRecipeDone(rows, ev.target.checked)} />
      {label}
    </label>
  )
}

function SqlFold({ e }: { e: QuestionLogRow }) {
  if (!e.sql && !e.sqlRetry) return null
  return (
    <details className="text-[11px]">
      <summary className="min-h-9 cursor-pointer py-1 font-bold text-muted">Requête{e.sqlRetry ? 's (1er essai et correction)' : ''}</summary>
      {e.sql && <pre className="mt-1 rounded-md border border-line bg-fg/5 p-2 font-mono text-[11px] break-words whitespace-pre-wrap">{e.sql}</pre>}
      {e.sqlRetry && <pre className="mt-1 rounded-md border border-line bg-fg/5 p-2 font-mono text-[11px] break-words whitespace-pre-wrap">{e.sqlRetry}</pre>}
    </details>
  )
}

/** Une entrée : date, auteur, recette, mode avancé, ce qui n'a pas été appliqué, requête repliable. */
function Entry({ e, withPhrase, box }: { e: QuestionLog; withPhrase?: boolean; box?: boolean }) {
  return (
    <li className="flex flex-col gap-1 py-2">
      {withPhrase && <p className="text-sm font-bold">« {e.phrase} »</p>}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted">
        <span>{when(e.at)}</span>
        {e.authorName && <span>· {e.authorName}</span>}
        <OutcomeTag outcome={outcomeOf(e)} />
        <span>· {RECIPE_LABEL[e.recipe] ?? e.recipe}</span>
        {e.status && (
          <span>
            · {STATUS_LABEL[e.status] ?? e.status}
            {e.how === 'button' ? ' (bouton)' : ''}
            {e.status === 'ok' && e.rows !== undefined ? `, ${e.rows} ligne${e.rows > 1 ? 's' : ''}` : ''}
            {e.display ? `, ${e.display}` : ''}
          </span>
        )}
      </div>
      {!!e.recipeMissing?.length && <p className="text-[11px]">Pas appliqué par la recette : {e.recipeMissing.join(' ; ')}</p>}
      {!!e.modelMissing?.length && <p className="text-[11px] text-muted">Pas géré en mode avancé : {e.modelMissing.join(' ; ')}</p>}
      {e.status && e.status !== 'ok' && e.detail && <p className="text-[11px] text-muted">Précision : {e.detail}</p>}
      <SqlFold e={e} />
      {box && <DoneBox rows={[e]} />}
    </li>
  )
}

export function QuestionLogView() {
  const all = useQuestionLog()
  const [filter, setFilter] = useState<LogFilter>('a_traiter')
  const [sort, setSort] = useState<GroupSort>('rates')
  const [grouped, setGrouped] = useState(true)
  const [limit, setLimit] = useState(PAGE)
  const [copied, setCopied] = useState('')
  if (!all) return <p className="text-xs text-muted">Chargement…</p>

  const count = (f: LogFilter) => filterEntries(all, f).length
  const shown = filterEntries(all, filter)
  const groups = groupEntries(shown, sort)
  // Sans regroupement : ratées d'abord (ou plus récentes).
  const rank: Record<Outcome, number> = { rate: 0, sauvee: 1, complete: 2 }
  const flat = sort === 'rates' ? [...shown].sort((a, b) => rank[outcomeOf(a)] - rank[outcomeOf(b)] || b.at.localeCompare(a.at)) : shown
  const todo = count('a_traiter')

  async function copy() {
    const text = copyForClaude(all!, undefined, appName())
    try {
      await navigator.clipboard.writeText(text)
      setCopied(`Copié : ${todo} question${todo > 1 ? 's' : ''} à traiter et les plus fréquentes, prêtes à coller dans une conversation avec Claude.`)
    } catch {
      setCopied('Copie impossible sur cet appareil.')
    }
  }

  async function clear() {
    if (!(await ask(`Vider le journal ? Les ${all!.length} entrées sont retirées pour tous les administrateurs.`, { ok: 'Vider' }))) return
    await clearQuestionLog()
    setCopied('')
  }

  const filters: { value: LogFilter; label: string }[] = [
    { value: 'a_traiter', label: `À traiter (${todo})` },
    { value: 'rate', label: `Ratées (${count('rate')})` },
    { value: 'sauvee', label: `Sauvées (${count('sauvee')})` },
    { value: 'complete', label: `Comprises (${count('complete')})` },
    { value: 'toutes', label: `Toutes (${all.length})` },
  ]

  return (
    <section className="card flex flex-col gap-3 p-4">
      <p className="text-[11px] text-muted">
        Toutes les questions de « Poser une question » : ce qu’en a fait la recette et, au besoin, le mode avancé. De quoi écrire de nouvelles
        recettes. Prénoms, noms et licences sont remplacés par [prénom], [nom], [licence] sur l’appareil, avant tout enregistrement ; aucun
        résultat n’est gardé. Effacées automatiquement au bout de 12 mois.
      </p>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-primary min-h-11 px-3 text-xs" disabled={!all.length} onClick={() => void copy()}>
          <Icon name="copy" className="h-3.5 w-3.5" />
          Copier pour Claude
        </button>
        <button type="button" className="btn-ghost min-h-11 px-3 text-xs" disabled={!all.length} onClick={() => void clear()}>
          <Icon name="trash" className="h-3.5 w-3.5" />
          Vider le journal
        </button>
      </div>
      {copied && (
        <p className="text-[11px] text-emerald-300" role="status">
          {copied}
        </p>
      )}
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filtrer par issue">
        {filters.map((f) => (
          <button
            key={f.value}
            type="button"
            aria-pressed={filter === f.value}
            className={`min-h-9 rounded-full border px-3 text-[11px] font-bold ${filter === f.value ? 'border-accent bg-accent text-white' : 'border-line text-fg hover:border-accent'}`}
            onClick={() => {
              setFilter(f.value)
              setLimit(PAGE)
            }}
          >
            {f.label}
          </button>
        ))}
      </div>
      <Segmented<GroupSort>
        value={sort}
        onChange={setSort}
        options={[
          { value: 'rates', label: 'Ratées d’abord' },
          { value: 'frequentes', label: 'Les plus fréquentes' },
          { value: 'recentes', label: 'Les plus récentes' },
        ]}
      />
      <label className="flex min-h-9 cursor-pointer items-center gap-2 text-xs">
        <input type="checkbox" className="h-4 w-4" checked={grouped} onChange={(e) => setGrouped(e.target.checked)} />
        Regrouper les phrases semblables (avec leur nombre)
      </label>

      {!shown.length ? (
        <p className="text-xs text-muted">
          {!all.length
            ? 'Aucune question enregistrée pour l’instant.'
            : filter === 'a_traiter'
              ? 'Rien à traiter pour l’instant : les questions ratées ou sauvées par le mode avancé ont toutes leur recette.'
              : 'Aucune question ici.'}
        </p>
      ) : grouped ? (
        <ul className="flex flex-col gap-2">
          {groups.slice(0, limit).map((g) => (
            <li key={g.key} className="rounded-md border border-line p-3">
              <div className="flex items-start gap-2">
                <p className="min-w-0 flex-1 text-sm font-bold">« {g.phrases[0].phrase} »</p>
                <span className="shrink-0 rounded-full bg-accent/15 px-2 py-0.5 text-[11px] font-extrabold" title="Nombre de fois">
                  ×{g.entries.length}
                </span>
              </div>
              {g.phrases.length > 1 && (
                <p className="mt-1 text-[11px] text-muted">Aussi : {g.phrases.slice(1).map((p) => `« ${p.phrase} »${p.count > 1 ? ` ×${p.count}` : ''}`).join(' ; ')}</p>
              )}
              <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted">
                <OutcomeTag outcome={g.outcome} /> Dernière fois : {when(g.last)}
              </p>
              {g.outcome !== 'complete' && (
                <DoneBox rows={g.entries} label={g.entries.length > 1 ? `Transformées en recette (les ${g.entries.length})` : 'Transformée en recette'} />
              )}
              <details className="text-[11px]">
                <summary className="min-h-9 cursor-pointer py-1 font-bold text-muted">Détail ({g.entries.length})</summary>
                <ul className="divide-y divide-line">
                  {g.entries.map((e) => (
                    <Entry key={e.id} e={e} withPhrase={g.phrases.length > 1} box={g.entries.length > 1 && outcomeOf(e) !== 'complete'} />
                  ))}
                </ul>
              </details>
            </li>
          ))}
        </ul>
      ) : (
        <ul className="divide-y divide-line">
          {flat.slice(0, limit).map((e) => (
            <Entry key={e.id} e={e} withPhrase box={outcomeOf(e) !== 'complete'} />
          ))}
        </ul>
      )}
      {(grouped ? groups.length : shown.length) > limit && (
        <button type="button" className="btn-ghost min-h-11 self-start px-3 text-xs" onClick={() => setLimit(limit + PAGE)}>
          Voir plus
        </button>
      )}
    </section>
  )
}
