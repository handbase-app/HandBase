import { useState } from 'react'
import { ACTION_DISPLAY } from '../askAction'
import type { QuestionLog } from '../db'
import { clearQuestionLog, setRecipeDone, useQuestionLog } from '../questionLog'
import {
  copyForClaude,
  exportCsv,
  filterByAvis,
  filterEntries,
  isBadVerdict,
  splitLog,
  VERDICT_LABEL,
  VERDICTS,
  type AvisFilter,
  groupEntries,
  outcomeOf,
  OUTCOME_LABEL,
  RECIPE_LABEL,
  STATUS_LABEL,
  type GroupSort,
  type LogFilter,
  type Outcome,
  type QuestionLogRow,
  splitVocal,
  vocalCsv,
  vocalForClaude,
  vocalKeptSummary,
  vocalToReview,
  VOCAL_KEPT_LABEL,
  VOCAL_VERDICT_LABEL,
  type VocalEntry,
  type VocalVerdict,
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
 * AVIS des entraîneurs (phase de test, src/components/AnswerFeedback.tsx) : lignes à part du journal (kind = 'avis'),
 * montrés avec la question qu'ils jugent (verdict, commentaire) ; filtre « Avec avis » / par verdict ; une question jugée
 * « Mauvaise réponse » ou « Pas de réponse » est « à traiter » même si la recette l'a comprise. « Exporter (CSV) » : le
 * journal avec les avis, pour l'analyser dans un tableur.
 * ÉVALUATIONS VOCALES (« Avis vocal » de l'écran de notation, src/components/AvisVocal.tsx) : lignes kind = 'avis_vocal',
 * filtre « Évaluations vocales » : dictée anonymisée, tableau critère → proposé / gardé / final, appréciation et
 * commentaire. Reprises dans « Copier pour Claude » (section à part) et dans l'export CSV (second tableau).
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

const VERDICT_CLS = { super: 'border-emerald-500/50 text-emerald-300', mauvaise: 'border-amber-500/60 text-amber-300', sans_reponse: 'border-sky-500/50 text-sky-300' }

/** Avis donnés sur une question : verdict, commentaire, auteur et date. */
function AvisList({ avis }: { avis?: QuestionLog[] }) {
  if (!avis?.length) return null
  return (
    <ul className="flex flex-col gap-1">
      {avis.map((a) => (
        <li key={a.id} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-[11px]">
          <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${a.verdict ? VERDICT_CLS[a.verdict] : ''}`}>
            Avis : {a.verdict ? VERDICT_LABEL[a.verdict] : '?'}
          </span>
          {a.comment && <span>« {a.comment} »</span>}
          <span className="text-muted">
            {a.authorName ? `${a.authorName}, ` : ''}
            {when(a.at)}
          </span>
        </li>
      ))}
    </ul>
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
function Entry({ e, withPhrase, box, avis }: { e: QuestionLog; withPhrase?: boolean; box?: boolean; avis?: QuestionLog[] }) {
  return (
    <li className="flex flex-col gap-1 py-2">
      {withPhrase && <p className="text-sm font-bold">« {e.phrase} »</p>}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted">
        <span>{when(e.at)}</span>
        {e.authorName && <span>· {e.authorName}</span>}
        {e.page && <span>· {e.page}</span>}
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
      {e.display === ACTION_DISPLAY && e.detail && <p className="text-[11px]">✦ {e.detail}</p>}
      <AvisList avis={avis} />
      <SqlFold e={e} />
      {box && <DoneBox rows={[e]} />}
    </li>
  )
}

const VOCAL_CLS: Record<VocalVerdict, string> = {
  coherente: 'border-emerald-500/50 text-emerald-300',
  en_partie: 'border-sky-500/50 text-sky-300',
  pas_coherente: 'border-amber-500/60 text-amber-300',
}

/** Une évaluation vocale : dictée, notes proposées et ce qu'en a fait l'entraîneur, appréciations. */
function VocalItem({ v }: { v: VocalEntry }) {
  const ps = v.row.proposals ?? []
  return (
    <li className="flex flex-col gap-1.5 rounded-md border border-line p-3">
      <p className="text-sm font-bold">« {v.row.phrase} »</p>
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted">
        <span>{when(v.row.at)}</span>
        {v.row.authorName && <span>· {v.row.authorName}</span>}
        <span>· {vocalKeptSummary(ps)}</span>
      </p>
      {ps.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[11px]">
            <thead className="text-muted">
              <tr>
                <th className="py-1 pr-2 font-bold">Critère</th>
                <th className="py-1 pr-2 font-bold">Proposé</th>
                <th className="py-1 pr-2 font-bold">Gardé</th>
                <th className="py-1 font-bold">Final</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {ps.map((p, i) => (
                <tr key={`${p.criterionId}-${i}`}>
                  <td className="py-1 pr-2">{p.label ?? p.criterionId}</td>
                  <td className="py-1 pr-2 font-bold">{p.score ?? '?'}</td>
                  <td className={`py-1 pr-2 ${p.kept === 'accepte' ? 'text-emerald-300' : p.kept === 'modifie' ? 'text-sky-300' : 'text-muted'}`}>{VOCAL_KEPT_LABEL[p.kept] ?? p.kept}</td>
                  <td className="py-1 font-bold">{p.kept === 'accepte' ? p.score : p.kept === 'modifie' ? (p.final ?? '?') : '–'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {v.verdicts.length > 0 && (
        <ul className="flex flex-col gap-1">
          {v.verdicts.map((x, i) => (
            <li key={`${x.at}-${i}`} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-[11px]">
              <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${VOCAL_CLS[x.verdict] ?? ''}`}>Proposition : {VOCAL_VERDICT_LABEL[x.verdict] ?? x.verdict}</span>
              {x.comment && <span>« {x.comment} »</span>}
              <span className="text-muted">
                {x.authorName ? `${x.authorName}, ` : ''}
                {when(x.at)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </li>
  )
}

export function QuestionLogView() {
  const rows = useQuestionLog()
  const [filter, setFilter] = useState<LogFilter | 'vocal'>('a_traiter')
  const [avisFilter, setAvisFilter] = useState<AvisFilter>('tous')
  const [sort, setSort] = useState<GroupSort>('rates')
  const [grouped, setGrouped] = useState(true)
  const [limit, setLimit] = useState(PAGE)
  const [copied, setCopied] = useState('')
  if (!rows) return <p className="text-xs text-muted">Chargement…</p>

  // Évaluations vocales à part ; puis questions d'un côté, avis (lignes à part) de l'autre.
  const { others, vocal } = splitVocal(rows)
  const vocalView = filter === 'vocal'
  const { questions: all, avis, orphans } = splitLog(others)
  const nAvis = [...avis.values()].reduce((n, l) => n + l.length, 0)
  const count = (f: LogFilter) => filterByAvis(filterEntries(all, f, avis), avis, avisFilter).length
  const byFilter = filterEntries(all, vocalView ? 'toutes' : filter, avis)
  const countAvis = (f: AvisFilter) => filterByAvis(byFilter, avis, f).length
  const shown = filterByAvis(byFilter, avis, avisFilter)
  const groups = groupEntries(shown, sort)
  // Sans regroupement : ratées d'abord (ou plus récentes).
  const rank: Record<Outcome, number> = { rate: 0, sauvee: 1, complete: 2 }
  const flat = sort === 'rates' ? [...shown].sort((a, b) => rank[outcomeOf(a)] - rank[outcomeOf(b)] || b.at.localeCompare(a.at)) : shown
  const todo = count('a_traiter')

  async function copy() {
    const text = copyForClaude(others, undefined, appName()) + (vocal.length ? '\n\n' + vocalForClaude(vocal) : '')
    try {
      await navigator.clipboard.writeText(text)
      const nv = vocal.filter(vocalToReview).length
      setCopied(
        `Copié : ${todo} question${todo > 1 ? 's' : ''} à traiter et les plus fréquentes${vocal.length ? `, ${nv} évaluation${nv > 1 ? 's' : ''} vocale${nv > 1 ? 's' : ''} à regarder` : ''}, prêtes à coller dans une conversation avec Claude.`,
      )
    } catch {
      setCopied('Copie impossible sur cet appareil.')
    }
  }

  function download() {
    // Avec BOM : le tableur reconnaît les accents.
    // Évaluations vocales : second tableau sous celui des questions (seul, dans le filtre « Évaluations vocales »).
    const csv = vocalView ? vocalCsv(vocal) : exportCsv(others) + (vocal.length ? '\r\n\r\n' + vocalCsv(vocal) : '')
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${vocalView ? 'evaluations-vocales' : 'journal-questions'}-${new Date().toISOString().slice(0, 10)}.csv`
    document.body.appendChild(a)
    a.click()
    a.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    const nv = `${vocal.length} évaluation${vocal.length > 1 ? 's' : ''} vocale${vocal.length > 1 ? 's' : ''}`
    setCopied(vocalView ? `Exporté : ${nv} (CSV, séparateur « ; »).` : `Exporté : ${all.length} question${all.length > 1 ? 's' : ''}, ${nAvis} avis et ${nv} (CSV, séparateur « ; »).`)
  }

  async function clear() {
    if (!(await ask(`Vider le journal ? Les ${rows!.filter((r) => !r.deleted).length} entrées (questions et avis) sont retirées pour tous les administrateurs.`, { ok: 'Vider' }))) return
    await clearQuestionLog()
    setCopied('')
  }

  const filters: { value: LogFilter; label: string }[] = [
    { value: 'a_traiter', label: `À traiter (${todo})` },
    { value: 'rate', label: `Ratées (${count('rate')})` },
    { value: 'sauvee', label: `Sauvées (${count('sauvee')})` },
    { value: 'complete', label: `Comprises (${count('complete')})` },
    { value: 'toutes', label: `Toutes (${count('toutes')})` },
  ]
  const nVocal = vocal.length
  const avisFilters: { value: AvisFilter; label: string }[] = [
    { value: 'tous', label: 'Tous' },
    { value: 'avec_avis', label: `Avec avis (${countAvis('avec_avis')})` },
    ...VERDICTS.map((v) => ({ value: v as AvisFilter, label: `${VERDICT_LABEL[v]} (${countAvis(v)})` })),
  ]
  const chip = (on: boolean) => `min-h-9 rounded-full border px-3 text-[11px] font-bold ${on ? 'border-accent bg-accent text-white' : 'border-line text-fg hover:border-accent'}`
  const avisOf = (entries: QuestionLog[]) => entries.flatMap((e) => avis.get(e.id) ?? [])

  return (
    <section className="card flex flex-col gap-3 p-4">
      <p className="text-[11px] text-muted">
        Toutes les questions posées (« Poser une question », champs « Filtrer ou poser une question… », « Filtrer » à la voix) : ce
        qu’en a fait la recette et, au besoin, le mode avancé. De quoi écrire de nouvelles
        recettes. Avec les avis des entraîneurs sur les réponses (Super, Mauvaise réponse, Pas de réponse) et leur commentaire. Prénoms, noms
        et licences sont remplacés par [prénom], [nom], [licence] sur l’appareil, avant tout enregistrement ; aucun résultat n’est gardé.
        Et les évaluations vocales (« Avis vocal » de l’écran de notation) : dictée anonymisée, notes proposées et ce que
        l’entraîneur en a gardé, son appréciation ; jamais le joueur évalué. Effacées automatiquement au bout de 12 mois.
      </p>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-primary min-h-11 px-3 text-xs" disabled={!all.length && !nVocal} onClick={() => void copy()}>
          <Icon name="copy" className="h-3.5 w-3.5" />
          Copier pour Claude
        </button>
        <button type="button" className="btn-ghost min-h-11 px-3 text-xs" disabled={!all.length && !nAvis && !nVocal} onClick={download}>
          <Icon name="list" className="h-3.5 w-3.5" />
          Exporter (CSV)
        </button>
        <button type="button" className="btn-ghost min-h-11 px-3 text-xs" disabled={!all.length && !nAvis && !nVocal} onClick={() => void clear()}>
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
            className={chip(filter === f.value)}
            onClick={() => {
              setFilter(f.value)
              setLimit(PAGE)
            }}
          >
            {f.label}
          </button>
        ))}
        <button
          type="button"
          aria-pressed={vocalView}
          className={chip(vocalView)}
          onClick={() => {
            setFilter('vocal')
            setLimit(PAGE)
          }}
        >
          Évaluations vocales ({nVocal})
        </button>
      </div>
      {vocalView ? (
        <>
          {!vocal.length ? (
            <p className="text-xs text-muted">Aucune évaluation vocale enregistrée pour l’instant.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {vocal.slice(0, limit).map((v) => (
                <VocalItem key={v.row.id} v={v} />
              ))}
            </ul>
          )}
          {vocal.length > limit && (
            <button type="button" className="btn-ghost min-h-11 self-start px-3 text-xs" onClick={() => setLimit(limit + PAGE)}>
              Voir plus
            </button>
          )}
        </>
      ) : (
      <>
      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filtrer par avis des entraîneurs">
        <span className="text-[11px] font-bold text-muted">Avis ({nAvis}) :</span>
        {avisFilters.map((f) => (
          <button
            key={f.value}
            type="button"
            aria-pressed={avisFilter === f.value}
            className={chip(avisFilter === f.value)}
            onClick={() => {
              setAvisFilter(f.value)
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
              <div className="mt-1">
                <AvisList avis={avisOf(g.entries)} />
              </div>
              {(g.outcome !== 'complete' || avisOf(g.entries).some((a) => isBadVerdict(a.verdict))) && (
                <DoneBox rows={g.entries} label={g.entries.length > 1 ? `Transformées en recette (les ${g.entries.length})` : 'Transformée en recette'} />
              )}
              <details className="text-[11px]">
                <summary className="min-h-9 cursor-pointer py-1 font-bold text-muted">Détail ({g.entries.length})</summary>
                <ul className="divide-y divide-line">
                  {g.entries.map((e) => (
                    <Entry key={e.id} e={e} withPhrase={g.phrases.length > 1} box={g.entries.length > 1 && outcomeOf(e) !== 'complete'} avis={avis.get(e.id)} />
                  ))}
                </ul>
              </details>
            </li>
          ))}
        </ul>
      ) : (
        <ul className="divide-y divide-line">
          {flat.slice(0, limit).map((e) => (
            <Entry key={e.id} e={e} withPhrase box={outcomeOf(e) !== 'complete' || !!avis.get(e.id)?.some((a) => isBadVerdict(a.verdict))} avis={avis.get(e.id)} />
          ))}
        </ul>
      )}
      {!!orphans.length && avisFilter !== 'tous' && (
        <details className="text-[11px]">
          <summary className="min-h-9 cursor-pointer py-1 font-bold text-muted">Avis dont la question n’est plus au journal ({orphans.length})</summary>
          <AvisList avis={orphans} />
        </details>
      )}
      {(grouped ? groups.length : shown.length) > limit && (
        <button type="button" className="btn-ghost min-h-11 self-start px-3 text-xs" onClick={() => setLimit(limit + PAGE)}>
          Voir plus
        </button>
      )}
      </>
      )}
    </section>
  )
}
