import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { alive, db, plural, today, type Player } from '../db'
import { eventNumbers, FORMAT_LABEL, type TableFormat } from '../importMesures'
import { refreshPropositions, saveChoix, setPropositionEtat, usePendingPropositionCount, usePendingPropositions, usePropositions } from '../propositions'
import { badgeLabel, dataLineCount, etatApresValidation, porteeLabel, rowsOf, SOURCE_LABEL, type PropositionRow } from '../propositionsCore'
import { can, useRole } from '../roles'
import { ask } from './Confirm'
import { FormActions, FormWindow } from './FormWindow'
import { fromChoix, ImportReview, toChoix } from './ImportMesures'
import { flash } from './ItemMenu'
import { Icon } from './ui'

/*
 * Boîte « À valider » (projet « Serveur MCP Nextar », étape 2) : les propositions de mesures qui attendent la validation du
 * coach (tableaux gardés « pour plus tard » depuis « Coller un tableau de mesures », et demain ceux déposés par le serveur MCP
 * avec son compte). Données : src/propositions.ts ; règles : src/propositionsCore.ts ; serveur : supabase/067_propositions.sql.
 *  - PropositionsPill : petit repère dans l'en-tête (« 2 à valider »), seulement quand quelque chose attend ; il ouvre la boîte.
 *  - PropositionsHost : la fenêtre, ouverte par openPropositions() (repère, menu du profil) ou par l'adresse ?propositions=1
 *    (toucher la notification « 1 proposition à valider »).
 *  - Ouvrir une proposition : l'écran « À valider » de « Coller un tableau » (ImportReview) sur ses lignes brutes ;
 *    « Enregistrer N mesures » la marque validée (ou validée en partie), « Défaire » la remet en attente, « Rejeter » la
 *    marque rejetée ; « Garder pour plus tard » garde les choix déjà faits.
 * Tout se passe sur l'appareil : aucune IA n'est appelée, aucune donnée de joueur ne part.
 */

const OPEN = 'hb:propositions'
/** Ouvre la boîte « À valider ». */
export const openPropositions = () => window.dispatchEvent(new Event(OPEN))

/** Repère discret de l'en-tête : « 2 à valider » ; `compact` (menu de gauche, téléphone couché) : pictogramme et nombre. */
export function PropositionsPill({ compact = false }: { compact?: boolean }) {
  const n = usePendingPropositionCount()
  if (!n) return null
  const label = badgeLabel(n)
  return (
    <button
      type="button"
      onClick={openPropositions}
      aria-label={`${label} : ouvrir la boîte « À valider »`}
      title={`${label} : ouvrir la boîte « À valider »`}
      className={`flex h-11 shrink-0 items-center ${compact ? 'w-11 justify-center' : ''}`}
    >
      {compact ? (
        <span className="relative text-accent">
          <Icon name="check" className="h-6 w-6" />
          <span className="absolute -top-1.5 -right-2 min-w-4 rounded-full bg-accent px-1 text-center text-[9px] leading-4 font-bold text-white">{n > 99 ? '99+' : n}</span>
        </span>
      ) : (
        <span className="inline-flex h-7 items-center gap-1.5 rounded-full border border-accent/40 bg-accent/10 px-2.5 text-[11px] font-bold whitespace-nowrap text-accent hover:bg-accent/15">
          <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-hidden />
          {label}
        </span>
      )}
    </button>
  )
}

/** Fenêtre de la boîte, posée une fois dans l'appli (src/App.tsx). */
export function PropositionsHost() {
  const [open, setOpen] = useState(false)
  const loc = useLocation()
  const nav = useNavigate()
  useEffect(() => {
    const on = () => setOpen(true)
    window.addEventListener(OPEN, on)
    return () => window.removeEventListener(OPEN, on)
  }, [])
  // Notification touchée : /?propositions=1 ouvre la boîte (le paramètre est retiré de l'adresse).
  useEffect(() => {
    const q = new URLSearchParams(loc.search)
    if (!q.has('propositions')) return
    q.delete('propositions')
    const s = q.toString()
    nav({ pathname: loc.pathname, search: s ? `?${s}` : '' }, { replace: true, state: loc.state })
    setOpen(true)
  }, [loc.search]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (open) refreshPropositions()
  }, [open])
  return open ? <PropositionsBox onClose={() => setOpen(false)} /> : null
}

/** « aujourd'hui, 14 h 05 », « hier », « le 05/11 ». */
function whenLabel(t: number) {
  const d = new Date(t)
  const day = (x: Date) => `${x.getFullYear()}-${x.getMonth()}-${x.getDate()}`
  const now = new Date()
  const yest = new Date(now.getTime() - 86_400_000)
  if (day(d) === day(now)) return `aujourd’hui, ${d.getHours()} h ${String(d.getMinutes()).padStart(2, '0')}`
  if (day(d) === day(yest)) return 'hier'
  return `le ${d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })}`
}

const dm = (d?: string) => (d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? `${d.slice(8, 10)}/${d.slice(5, 7)}` : '')

function PropositionsBox({ onClose }: { onClose: () => void }) {
  const role = useRole()
  const pending = usePendingPropositions()
  const all = usePropositions()
  const [openId, setOpenId] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const current = openId ? all?.find((p) => p.id === openId) : undefined
  const back = () => {
    setOpenId(null)
    setDone(false)
  }

  return (
    <FormWindow title="À valider" onClose={onClose} width={current ? 820 : 640} guard={!!current && !done}>
      {current ? (
        <PropositionReview key={current.id} p={current} canSave={can.editMeasurements(role)} onBack={back} onSaved={() => setDone(true)} onUndone={() => setDone(false)} />
      ) : (
        <>
          <p className="text-xs text-muted">
            Les tableaux de mesures qui attendent ta validation : ceux gardés pour plus tard depuis « Coller un tableau de mesures » et, bientôt, ceux préparés avec
            Claude. Rien n’est enregistré avant que tu valides.
          </p>
          {all === undefined ? (
            <p className="py-8 text-center text-sm text-muted">Chargement…</p>
          ) : pending.length ? (
            <ul className="flex flex-col gap-2" aria-label="Propositions en attente">
              {pending.map((p) => (
                <li key={p.id}>
                  <PropositionItem p={p} onOpen={() => setOpenId(p.id)} />
                </li>
              ))}
            </ul>
          ) : (
            <div className="flex flex-col items-center gap-2 py-8 text-center">
              <span className="flex h-11 w-11 items-center justify-center rounded-full bg-panel-2 text-muted">
                <Icon name="check" className="h-6 w-6" />
              </span>
              <p className="text-sm font-bold">Rien à valider pour l’instant.</p>
              <p className="max-w-sm text-xs text-muted">Pour garder un tableau ici : menu ⋮ d’un événement, d’un groupe ou de la liste Joueurs, « Coller un tableau de mesures », puis « Garder pour plus tard ».</p>
            </div>
          )}
          <FormActions>
            <button type="button" className="btn-ghost" onClick={onClose}>
              Fermer
            </button>
          </FormActions>
        </>
      )}
    </FormWindow>
  )
}

/** Une proposition de la liste : titre, d'où elle vient, quand, combien de lignes, où sont cherchés les joueurs. */
function PropositionItem({ p, onOpen }: { p: PropositionRow; onOpen: () => void }) {
  const n = dataLineCount(p.lignes)
  const d = dm(p.contexte.date)
  return (
    <button type="button" onClick={onOpen} className="card flex min-h-11 w-full items-start gap-3 p-3 text-left transition hover:border-accent" data-proposition={p.id}>
      <span className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${p.source === 'collage' ? 'bg-panel-2 text-muted' : 'bg-accent/15 text-accent'}`} aria-hidden>
        <Icon name={p.source === 'collage' ? 'copy' : 'message'} className="h-5 w-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-bold break-words">{p.titre}</span>
        <span className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] text-muted">
          <span className={`rounded-full px-2 py-0.5 font-bold ${p.source === 'collage' ? 'bg-panel-2' : 'bg-accent/15 text-accent'}`}>{SOURCE_LABEL[p.source]}</span>
          <span>{whenLabel(p.createdAt)}</span>
          <span aria-hidden>·</span>
          <span>{plural(n, 'ligne')}</span>
          <span aria-hidden>·</span>
          <span className="break-words">{porteeLabel(p.contexte)}</span>
          {d && (
            <>
              <span aria-hidden>·</span>
              <span>tests du {d}</span>
            </>
          )}
        </span>
        {p.sendError && <span className="mt-1 block text-[11px] text-spread-lo">Gardée sur cet appareil pour l’instant : {p.sendError}</span>}
      </span>
      <Icon name="chevron" className="mt-2 h-4 w-4 shrink-0 text-muted" />
    </button>
  )
}

/** Joueurs où chercher pour une proposition : ceux gardés avec elle, sinon ceux de l'événement ou du groupe, sinon toute la base. */
function usePropScope(p: PropositionRow) {
  return useLiveQuery(async () => {
    const ctx = p.contexte
    const ev = ctx.portee === 'evenement' && ctx.id ? await db.events.get(ctx.id) : undefined
    const g = ctx.portee === 'groupe' && ctx.id ? await db.groups.get(ctx.id) : undefined
    const ids = ctx.joueurs?.length ? ctx.joueurs : ev && !ev.deleted ? (ev.playerIds ?? []) : g && !g.deleted ? (g.playerIds ?? []) : []
    let players: Player[] = []
    if (ids.length) players = alive((await db.players.bulkGet(ids)).filter((x): x is Player => !!x)).filter((x) => !x.mergedInto)
    const nums = ev && !ev.deleted ? eventNumbers(ev) : undefined
    if (players.length) {
      const what = ctx.portee === 'groupe' ? 'du groupe' : 'de l’événement'
      return { players, nums, where: `parmi les ${plural(players.length, 'joueur')} ${what}${ctx.nom ? ` « ${ctx.nom} »` : ''}` }
    }
    const base = alive(await db.players.toArray()).filter((x) => x.review !== 'refused' && !x.mergedInto)
    return { players: base, nums, where: `parmi toute la base (${plural(base.length, 'fiche')})` }
  }, [p.id])
}

function PropositionReview({
  p,
  canSave,
  onBack,
  onSaved,
  onUndone,
}: {
  p: PropositionRow
  canSave: boolean
  onBack: () => void
  onSaved: () => void
  onUndone: () => void
}) {
  const scope = usePropScope(p)
  const rows = useMemo(() => rowsOf(p.lignes), [p.id]) // eslint-disable-line react-hooks/exhaustive-deps
  const initial = useMemo(() => fromChoix(p.contexte.choix), [p.id]) // eslint-disable-line react-hooks/exhaustive-deps
  const format = p.contexte.format as TableFormat | undefined
  const reject = async () => {
    if (!(await ask(`Rejeter « ${p.titre} » ? Aucune mesure ne sera enregistrée ; la proposition s’efface d’elle-même dans 7 jours.`, { ok: 'Rejeter', focusCancel: true })))
      return
    await setPropositionEtat(p.id, 'rejetee')
    flash('Proposition rejetée.')
    onBack()
  }
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-extrabold break-words">{p.titre}</h3>
          <p className="text-[11px] text-muted">
            {SOURCE_LABEL[p.source]} {whenLabel(p.createdAt)}
            {p.contexte.date ? ` · tests du ${dm(p.contexte.date)}` : ''}
          </p>
        </div>
      </div>
      {!canSave ? (
        <>
          <p className="text-xs text-muted">Ton rôle ne permet pas d’enregistrer des mesures : cette proposition peut être validée par un préparateur ou un administrateur.</p>
          <FormActions>
            <button type="button" className="btn-ghost" onClick={onBack}>
              ‹ Toutes les propositions
            </button>
          </FormActions>
        </>
      ) : !scope ? (
        <p className="py-8 text-center text-sm text-muted">Chargement…</p>
      ) : (
        <ImportReview
          rows={rows}
          free={!!p.contexte.libre}
          formatLabel={format ? FORMAT_LABEL[format] : undefined}
          players={scope.players}
          nums={scope.nums}
          date={p.contexte.date ?? today()}
          where={scope.where}
          initial={initial}
          onBack={onBack}
          backLabel="‹ Toutes les propositions"
          onSaved={(_ids, info) => {
            void setPropositionEtat(p.id, etatApresValidation(info))
            onSaved()
          }}
          onUndone={() => {
            void setPropositionEtat(p.id, 'en_attente')
            onUndone()
          }}
          onKeep={async (s) => {
            await saveChoix(p.id, toChoix(s))
            flash('Choix gardés : la proposition attend toujours dans « À valider ».')
            onBack()
            return null
          }}
          extraActions={
            p.etat === 'en_attente' ? (
              <button type="button" className="btn-ghost" onClick={() => void reject()}>
                Rejeter
              </button>
            ) : null
          }
          onClose={onBack}
        />
      )}
    </div>
  )
}
