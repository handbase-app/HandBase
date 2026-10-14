import { useState } from 'react'
import type { QuestionLog } from '../db'
import { clearQuestionLog, setRecipeDone, useQuestionLog } from '../questionLog'
import { copyForClaude, groupEntries, STATUS_LABEL, type QuestionLogRow } from '../questionLogCore'
import { ask } from './Confirm'
import { Icon, Segmented } from './ui'

/*
 * Réglages > « Journal des questions avancées » (administrateurs) : les questions de « Poser une question » qui ont eu
 * besoin du mode avancé (src/questionLog.ts). Phrases et requêtes anonymisées, aucun résultat. Elles servent à écrire de
 * nouvelles recettes : « Copier pour Claude » donne celles à traiter, groupées ; une fois la recette écrite, on coche
 * « Transformée en recette ».
 */

type Filter = 'todo' | 'done' | 'all'
const PAGE = 30

const when = (iso: string) =>
  new Date(iso).toLocaleString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })

function StatusTag({ e }: { e: QuestionLogRow }) {
  const ok = e.status === 'ok'
  return (
    <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${ok ? 'border-emerald-500/50 text-emerald-300' : 'border-line text-muted'}`}>
      {STATUS_LABEL[e.status] ?? e.status}
      {ok && e.rows !== undefined ? ` · ${e.rows} ligne${e.rows > 1 ? 's' : ''}` : ''}
    </span>
  )
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

/** Une entrée : date, auteur, statut, ce que la recette n'a pas su faire, requête repliable. */
function Entry({ e, withPhrase, box }: { e: QuestionLog; withPhrase?: boolean; box?: boolean }) {
  return (
    <li className="flex flex-col gap-1 py-2">
      {withPhrase && <p className="text-sm font-bold">« {e.phrase} »</p>}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted">
        <span>{when(e.at)}</span>
        {e.authorName && <span>· {e.authorName}</span>}
        <span>· {e.how === 'auto' ? 'bascule automatique' : 'bouton « mode avancé »'}</span>
        <StatusTag e={e} />
        {e.display && <span>· affichage : {e.display}</span>}
      </div>
      {!!e.recipeMissing?.length && <p className="text-[11px]">Pas pris en compte par la recette : {e.recipeMissing.join(' ; ')}</p>}
      {!!e.modelMissing?.length && <p className="text-[11px] text-muted">Pas géré en mode avancé : {e.modelMissing.join(' ; ')}</p>}
      {e.status !== 'ok' && e.detail && <p className="text-[11px] text-muted">Précision : {e.detail}</p>}
      <SqlFold e={e} />
      {box && <DoneBox rows={[e]} />}
    </li>
  )
}

export function QuestionLogView() {
  const all = useQuestionLog()
  const [filter, setFilter] = useState<Filter>('todo')
  const [grouped, setGrouped] = useState(true)
  const [limit, setLimit] = useState(PAGE)
  const [copied, setCopied] = useState('')
  if (!all) return <p className="text-xs text-muted">Chargement…</p>

  const todo = all.filter((e) => !e.recipeDone)
  const shown = filter === 'todo' ? todo : filter === 'done' ? all.filter((e) => e.recipeDone) : all
  const groups = grouped ? groupEntries(shown) : []

  async function copy() {
    const text = copyForClaude(all!)
    try {
      await navigator.clipboard.writeText(text)
      setCopied(`Copié : ${todo.length} question${todo.length > 1 ? 's' : ''} à traiter, prêtes à coller dans une conversation avec Claude.`)
    } catch {
      setCopied('Copie impossible sur cet appareil.')
    }
  }

  async function clear() {
    if (!(await ask(`Vider le journal ? Les ${all!.length} entrées sont retirées pour les deux administrateurs.`, { ok: 'Vider' }))) return
    await clearQuestionLog()
    setCopied('')
  }

  return (
    <section className="card flex flex-col gap-3 p-4">
      <p className="text-[11px] text-muted">
        Questions de « Poser une question » qui ont eu besoin du mode avancé : de quoi écrire de nouvelles recettes. Prénoms, noms et licences
        sont remplacés par [prénom], [nom], [licence] sur l’appareil, avant tout enregistrement ; aucun résultat n’est gardé.
      </p>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-primary min-h-11 px-3 text-xs" disabled={!todo.length} onClick={() => void copy()}>
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
      <Segmented<Filter>
        value={filter}
        onChange={(v) => {
          setFilter(v)
          setLimit(PAGE)
        }}
        options={[
          { value: 'todo', label: `À traiter (${todo.length})` },
          { value: 'done', label: `Transformées (${all.length - todo.length})` },
          { value: 'all', label: `Tout (${all.length})` },
        ]}
      />
      <label className="flex min-h-9 cursor-pointer items-center gap-2 text-xs">
        <input type="checkbox" className="h-4 w-4" checked={grouped} onChange={(e) => setGrouped(e.target.checked)} />
        Regrouper les phrases semblables
      </label>

      {!shown.length ? (
        <p className="text-xs text-muted">
          {!all.length
            ? 'Aucune question passée en mode avancé pour l’instant.'
            : filter === 'todo'
              ? 'Rien à traiter pour l’instant : toutes les questions passées en mode avancé ont leur recette.' : 'Aucune question ici.'}
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
                Dernière fois : {when(g.last)} <StatusTag e={g.entries[0]} />
              </p>
              <DoneBox rows={g.entries} label={g.entries.length > 1 ? `Transformées en recette (les ${g.entries.length})` : 'Transformée en recette'} />
              <details className="text-[11px]">
                <summary className="min-h-9 cursor-pointer py-1 font-bold text-muted">Détail ({g.entries.length})</summary>
                <ul className="divide-y divide-line">
                  {g.entries.map((e) => (
                    <Entry key={e.id} e={e} withPhrase={g.phrases.length > 1} box={g.entries.length > 1} />
                  ))}
                </ul>
              </details>
            </li>
          ))}
        </ul>
      ) : (
        <ul className="divide-y divide-line">
          {shown.slice(0, limit).map((e) => (
            <Entry key={e.id} e={e} withPhrase box />
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
