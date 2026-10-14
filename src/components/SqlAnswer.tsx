import { useEffect, useRef, useState } from 'react'
import { POSITIONS, today, type Player } from '../db'
import { sendSqlRequest } from '../dictation/useDictation'
import { DictationError, ERROR_TEXT } from '../dictation/transcribe'
import { saveSqlQuestion } from '../savedQuestions'
import { holdMirror, runSql, SqlRunError, type SqlResult } from '../sqlClient'
import { cleanSqlSpec, columnLabel, guardSql, type SqlSpec } from '../sqlGuard'
import { buildSqlSchema, type MirrorInput } from '../sqlMirror'
import { logAdvancedQuestion, type AdvancedTrace } from '../questionLog'
import type { QuestionStatus } from '../questionLogCore'
import { FollowStar } from './Follow'
import { PlayerRow } from './PlayerRow'
import { Empty, Icon, SectionTitle } from './ui'

/*
 * « Poser une question », MODE AVANCÉ (secours de la recette, src/recipe.ts) : la phrase et la DESCRIPTION des tables de la
 * copie locale (src/sqlMirror.ts) partent à la fonction « transcrire » (?mode=sql) ; elle rend une requête SQLite, que
 * l'appli recontrôle (src/sqlGuard.ts) et exécute UNIQUEMENT dans le navigateur, sur une copie jetable en lecture seule de
 * ses données locales (src/sqlClient.ts, Web Worker). Jamais de SQL sur Supabase ; aucune donnée ne part, même pour la
 * correction (la requête et le message d'erreur de SQLite seulement, une fois).
 *  - useAdvancedAsk : demande, contrôle, essai sur la copie, une correction au plus ; rend la requête prête à afficher ;
 *  - SqlExplain : « Ce que j'ai calculé : … », « Voir la requête », « Enregistrer cette question » ;
 *  - SqlAnswerView : nombre, joueurs (lignes standard, fiche dans le contexte de la réponse) ou tableau générique.
 */

/** Source de la copie (données déjà lues par l'écran) ; null tant qu'elles se chargent. */
export type MirrorSource = (() => MirrorInput) | null

const fr = (n: number, d = 2) => n.toLocaleString('fr-FR', { maximumFractionDigits: d })
const POS = new Map(POSITIONS.map((p) => [p.id as string, p.label]))

/** Valeur d'une cellule, en clair (postes et sexe en toutes lettres). */
export function cellText(col: string, v: unknown): string {
  if (v === null || v === undefined || v === '') return '–'
  if (typeof v === 'number') return fr(v)
  const s = String(v)
  const c = col.toLowerCase()
  if ((c === 'poste' || c.endsWith('_poste')) && POS.has(s)) return POS.get(s)!
  if (c === 'sexe' && (s === 'M' || s === 'F')) return s === 'M' ? 'Garçon' : 'Fille'
  return s
}

/** Colonnes montrées sous le nom d'un joueur (tout sauf l'identifiant et le nom). */
const HIDDEN = new Set(['joueur_id', 'id', 'nom', 'prenom'])

/** Joueurs du résultat (colonne joueur_id), dans l'ordre, avec les autres colonnes en clair. */
export function sqlPlayers(res: SqlResult | null, byId: Map<string, Player>): { players: Player[]; extra: Map<string, string> } {
  const players: Player[] = []
  const extra = new Map<string, string>()
  const i = res?.columns.findIndex((c) => c.toLowerCase() === 'joueur_id') ?? -1
  if (!res || i < 0) return { players, extra }
  for (const r of res.rows) {
    const p = byId.get(String(r[i]))
    if (!p || extra.has(p.id)) continue
    players.push(p)
    extra.set(
      p.id,
      res.columns
        .map((c, k) => (HIDDEN.has(c.toLowerCase()) ? '' : `${columnLabel(c)} : ${cellText(c, r[k])}`))
        .filter(Boolean)
        .join(' · '),
    )
  }
  return { players, extra }
}

/** Exécute la requête sur la copie (construite à la première fois) ; relancée quand la requête ou les données changent. */
export function useSqlResult(spec: SqlSpec | null, source: MirrorSource) {
  const [state, setState] = useState<{ key: string; res?: SqlResult; error?: string; slow?: boolean }>({ key: '' })
  // La copie reste en mémoire tant qu'on est dans le bilan (src/sqlClient.ts).
  useEffect(() => holdMirror(), [])
  const key = spec && source ? spec.sql : ''
  useEffect(() => {
    if (!spec || !source) return
    let live = true
    const slow = window.setTimeout(() => live && setState((s) => (s.key === spec.sql && !s.res ? { ...s, slow: true } : s)), 400)
    runSql(spec.sql, source)
      .then((res) => live && setState({ key: spec.sql, res }))
      .catch((e) => live && setState({ key: spec.sql, error: e instanceof SqlRunError ? e.message : 'Calcul impossible sur cet appareil.' }))
      .finally(() => window.clearTimeout(slow))
    return () => {
      live = false
      window.clearTimeout(slow)
    }
  }, [key, source]) // eslint-disable-line react-hooks/exhaustive-deps
  return state.key === key ? state : { key, slow: false }
}

// ---------- Demande au modèle, contrôle, essai, correction ----------

const isNegative = (s: string) => /pas retenu|mauvais|faible/i.test(s)

/** Statut du journal pour une erreur qui interrompt le mode avancé. */
function failStatus(e: unknown): QuestionStatus {
  if (e instanceof SqlRunError) return e.kind === 'delai' ? 'delai' : e.kind === 'invalide' ? 'refuse' : 'erreur'
  if (e instanceof DictationError) return e.code === 'annule' ? 'annule' : e.code === 'reseau' ? 'reseau' : 'erreur'
  return 'erreur'
}

export function useAdvancedAsk(source: MirrorSource, criteria: Parameters<typeof buildSqlSchema>[0]['criteria'], zoneOf?: (c: string) => string | null | undefined) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const abort = useRef<AbortController | null>(null)
  useEffect(() => () => abort.current?.abort(), [])
  useEffect(() => holdMirror(), [])

  /**
   * Requête prête (essayée sur la copie), ou null (message dans `error`). how et recipeMissing (ce que la recette n'a pas su
   * faire) : pour le journal des questions avancées (src/questionLog.ts), qui garde chaque passage, anonymisé.
   */
  async function ask(phrase: string | undefined, how: 'auto' | 'button' = 'button', recipeMissing?: string[]): Promise<SqlSpec | null> {
    const said = (phrase ?? '').replace(/\s+/g, ' ').trim()
    if (!said || !source || abort.current) return null
    setBusy(true)
    setError('')
    const ctrl = new AbortController()
    abort.current = ctrl
    // Ce qui part au journal : jamais le résultat, seulement le nombre de lignes.
    const trace: AdvancedTrace = { how, phrase: said, recipeMissing, status: 'erreur' }
    try {
      const schema = buildSqlSchema({ criteria, positions: POSITIONS, zoneOf, today: today() })
      let ans = await sendSqlRequest(said, schema, undefined, ctrl.signal)
      for (let attempt = 0; ; attempt++) {
        if (attempt === 0) trace.sql = ans.sql
        else trace.sqlRetry = ans.sql
        if (ans.nonGere.length) trace.modelMissing = [...new Set([...(trace.modelMissing ?? []), ...ans.nonGere])]
        trace.display = ans.affichage
        if (!ans.sql.trim()) {
          trace.status = 'sans_requete'
          const why = ans.nonGere.filter((x) => !isNegative(x)).join(' ; ')
          setError(`Je ne sais pas encore répondre à cette question, même en mode avancé${why ? ` (${why})` : ''}.`)
          return null
        }
        const g = guardSql(ans.sql)
        let problem = g.ok ? '' : g.error
        trace.status = g.ok ? 'erreur_sql' : 'refuse'
        if (g.ok)
          try {
            const res = await runSql(g.sql, source)
            trace.status = 'ok'
            trace.rows = res.rows.length
            trace.detail = undefined
            return cleanSqlSpec({ sql: g.sql, explanation: ans.explication, display: ans.affichage })
          } catch (e) {
            if (!(e instanceof SqlRunError) || e.kind !== 'sql') throw e
            problem = e.message
          }
        trace.detail = problem
        if (attempt >= 1 || ctrl.signal.aborted) {
          setError('Le mode avancé n’a pas trouvé de requête qui marche pour cette question. Reformulez-la, ou essayez plus simple.')
          return null
        }
        // Une seule correction : la requête et le message de SQLite, jamais de données.
        ans = await sendSqlRequest(said, schema, { sql: ans.sql, erreur: problem }, ctrl.signal)
      }
    } catch (e) {
      trace.status = failStatus(e)
      trace.detail = e instanceof DictationError ? e.code : e instanceof SqlRunError ? e.message : 'erreur inattendue'
      if (e instanceof DictationError && e.code === 'annule') return null
      setError(e instanceof DictationError ? e.message : e instanceof SqlRunError ? e.message : ERROR_TEXT.mistral_erreur)
      return null
    } finally {
      if (abort.current === ctrl) abort.current = null
      setBusy(false)
      void logAdvancedQuestion(trace, source())
    }
  }
  return { ask, busy, error, cancel: () => abort.current?.abort() }
}

/** Attente du mode avancé (bascule automatique ou bouton). */
export function AdvancedBusy({ heard, onCancel }: { heard?: string; onCancel: () => void }) {
  return (
    <div className="card flex items-center gap-2 border-sky-500/40 p-3 text-xs" role="status">
      <span className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent" />
      <span className="min-w-0 flex-1">
        Mode avancé{heard ? <> pour « {heard} »</> : null} : je prépare une requête, calculée ensuite sur cet appareil…
      </span>
      <button type="button" className="min-h-11 shrink-0 px-2 text-[11px] font-bold underline" onClick={onCancel}>
        Annuler
      </button>
    </div>
  )
}

// ---------- Explication, requête, enregistrement ----------

export function SqlExplain({ spec, advanced, heard, saved }: { spec: SqlSpec; advanced?: 'auto' | 'button'; heard?: string; saved?: string }) {
  const [saving, setSaving] = useState(false)
  const [name, setName] = useState('')
  return (
    <div className="flex flex-col gap-2">
      {heard && <p className="text-[11px] text-muted">Entendu : « {heard} »</p>}
      {saved && <p className="text-[11px] text-muted">Ma question : « {saved} »</p>}
      <p className="rounded-md border border-sky-500/40 bg-sky-500/10 px-2 py-1.5 text-[11px]" role="note">
        <b>Réponse en mode avancé</b>
        {advanced === 'auto' ? ' (la question demandait plus que les réponses habituelles)' : ''} : requête écrite par l’assistant, calculée
        sur une copie des données de cet appareil (rien d’autre n’est envoyé).
      </p>
      <p className="text-xs">
        <b>Ce que j’ai calculé :</b> {spec.explanation}
      </p>
      <details className="text-[11px]">
        <summary className="min-h-9 cursor-pointer py-1 font-bold text-muted">Voir la requête</summary>
        <pre className="mt-1 rounded-md border border-line bg-fg/5 p-2 font-mono text-[11px] break-words whitespace-pre-wrap">{spec.sql}</pre>
      </details>
      {saving ? (
        <form
          className="card flex flex-col gap-2 border-accent/50 p-3"
          onSubmit={(e) => {
            e.preventDefault()
            saveSqlQuestion(name, spec, heard)
            setSaving(false)
          }}
        >
          <label className="flex flex-col gap-1 text-xs font-bold">
            Nom de la question
            <input className="field min-h-11 text-sm font-normal" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} required />
          </label>
          <p className="text-[10px] text-muted">Gardée sur cet appareil. Elle se relance sans rien envoyer (même requête, données du moment).</p>
          <div className="flex gap-2">
            <button type="submit" className="btn-primary min-h-11 px-4 text-xs">
              Enregistrer
            </button>
            <button type="button" className="btn-ghost min-h-11 px-4 text-xs" onClick={() => setSaving(false)}>
              Annuler
            </button>
          </div>
        </form>
      ) : (
        <button
          type="button"
          className="btn-ghost min-h-11 self-start px-3 text-xs"
          onClick={() => {
            setName((heard ?? saved ?? spec.explanation).slice(0, 80))
            setSaving(true)
          }}
        >
          <Icon name="star" className="h-3.5 w-3.5" />
          Enregistrer cette question
        </button>
      )}
    </div>
  )
}

// ---------- Réponse ----------

export function SqlAnswerView({ spec, source, byId, search }: { spec: SqlSpec; source: MirrorSource; byId: Map<string, Player>; search: string }) {
  const st = useSqlResult(spec, source)
  if (st.error) return <Empty>Le calcul n’a pas abouti. {st.error}</Empty>
  if (!st.res)
    return (
      <div className="flex items-center gap-2 py-10 text-sm text-muted" role="status">
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
        {st.slow ? 'Préparation d’une copie des données de cet appareil…' : 'Calcul…'}
      </div>
    )
  const res = st.res
  const n = res.rows.length
  const meta = (
    <p className="text-[11px] text-muted">
      <b className="text-fg">
        {fr(n)} {n > 1 ? 'lignes' : 'ligne'}
      </b>
      {n >= 500 && ' (les 500 premières)'} · calculé sur l’appareil en {fr(res.ms, 0)} ms
    </p>
  )
  if (!n) return <Empty>Aucune ligne ne répond à cette question pour l’instant.</Empty>

  // Une seule valeur : en grand.
  if (n === 1 && res.columns.length === 1 && (spec.display === 'nombre' || typeof res.rows[0][0] === 'number'))
    return (
      <div className="card flex flex-col items-start gap-1 p-4">
        <span className="text-4xl font-extrabold tabular-nums">{cellText(res.columns[0], res.rows[0][0])}</span>
        <span className="text-sm">{columnLabel(res.columns[0])}</span>
        <span className="text-[11px] text-muted">calculé sur l’appareil en {fr(res.ms, 0)} ms</span>
      </div>
    )

  // Joueurs : lignes standard, fiche dans le contexte de la réponse (le retour revient ici).
  const { players, extra } = sqlPlayers(res, byId)
  if (players.length)
    return (
      <div className="flex flex-col gap-2">
        {meta}
        {players.map((p) => (
          <PlayerRow
            key={p.id}
            p={p}
            link={{ to: `/bilan/question/joueurs/${p.id}${search}` }}
            sub={[p.birthDate?.slice(0, 4), p.club, extra.get(p.id)].filter(Boolean).join(' · ')}
            follow={<FollowStar id={p.id} />}
          />
        ))}
      </div>
    )

  // Tableau générique, colonnes renommées lisiblement.
  const numeric = res.columns.map((_, k) => res.rows.every((r) => r[k] === null || typeof r[k] === 'number'))
  return (
    <div className="flex flex-col gap-2">
      {meta}
      {spec.display === 'carte' && <p className="text-[11px] text-muted">Carte pas encore disponible en mode avancé : le résultat est en tableau.</p>}
      <SectionTitle>Résultat</SectionTitle>
      <div className="card overflow-x-auto">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr>
              {res.columns.map((c, k) => (
                <th key={k} scope="col" className={`px-3 py-2 font-bold text-muted ${numeric[k] ? 'text-right' : 'text-left'}`}>
                  {columnLabel(c)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {res.rows.map((r, i) => (
              <tr key={i} className="border-t border-line">
                {r.map((v, k) => (
                  <td key={k} className={`px-3 py-2 ${numeric[k] ? 'text-right tabular-nums' : ''}`}>
                    {cellText(res.columns[k], v)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
