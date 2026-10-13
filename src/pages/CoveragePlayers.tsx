import { createContext, useContext, useMemo, useState } from 'react'
import { Navigate, Outlet, useParams } from 'react-router-dom'
import MasterDetail from '../components/MasterDetail'
import { ContextBar, ContextRoster, useLeaveTo } from '../components/ContextRoster'
import { FollowStar } from '../components/Follow'
import { RewatchToggle } from '../components/Scouting'
import { Empty, Icon } from '../components/ui'
import { fmtDate, plural, type Player, type Rewatch } from '../db'
import type { ClubCoverage, Sight } from '../coverage'
import { MQ, useMedia } from '../layout'
import { can, useRole } from '../roles'
import PlayerDetail from './PlayerDetail'
import { AddToEventDialog, useBilanModel, useBilanState, whoOrder } from './Coverage'

/*
 * Fiche d'un joueur ouverte depuis le bilan de détection : /bilan/joueurs/:pid?<état du bilan> (partageable), comme
 * depuis un événement ou un groupe (EventPlayers.tsx, GroupPlayers.tsx). La liste d'origine : les joueurs du club
 * choisi, avec les filtres du bilan (à voir, puis déjà vus, même ordre que « Qui ? »), pas toute la base.
 * Ordinateur : ces joueurs à gauche, la fiche à droite ; « Fermer » (Échap) revient au bilan tel qu'on l'a laissé.
 * Téléphone : fiche en plein écran sous la barre « club · 3 / 16 » (‹ ›, retour au bilan à la même position).
 * Uniquement des marques positives ou neutres : « vu le …, par … », ou « à voir ».
 */

const clubLabel = (name: string) => name || 'Club non renseigné'
const year = (p: Player) => p.birthDate?.slice(0, 4) ?? ''
const seenText = (s?: Sight) => (s ? `vu le ${fmtDate(s.day)}${s.by ? `, par ${s.by}` : ''}` : '')

type Ctx = { club?: ClubCoverage<Player>; yearText: string; last: Map<string, Sight>; rewatch: Map<string, Rewatch[]> }
const BilanCtx = createContext<Ctx | null>(null)

export default function CoveragePlayers() {
  const { pid } = useParams()
  const role = useRole()
  const split = useMedia(MQ.split)
  const { st, search } = useBilanState()
  const { data, club, last, yearText } = useBilanModel(st)
  const name = club ? clubLabel(club.name) : 'Bilan de détection'
  const leave = useLeaveTo(`/bilan${search}`, name)
  const order = useMemo(() => (club ? whoOrder(club) : { toSee: [], seen: [] }), [club])
  const ctx = useMemo<Ctx | null>(() => (data ? { club, yearText, last, rewatch: data.rewatch } : null), [data, club, yearText, last])
  const base = '/bilan/joueurs'

  if (!can.viewCoverage(role)) return <Empty>Le bilan de détection est réservé aux administrateurs et aux encadrants.</Empty>
  // Sans joueur choisi : le bilan lui-même.
  if (!pid) return <Navigate to={`/bilan${search}`} replace />
  if (!data || !ctx) return <div className="py-20 text-center text-sm text-muted">Chargement…</div>
  const ids = [...order.toSee, ...order.seen].map((p) => p.id)

  if (!split)
    return (
      <BilanCtx.Provider value={ctx}>
        <ContextBar title={name} ids={ids} current={pid} base={base} search={search} back={() => void leave.go()} />
        <Outlet />
      </BilanCtx.Provider>
    )
  return (
    <BilanCtx.Provider value={ctx}>
      <MasterDetail
        base={base}
        closeTo={`/bilan${search}`}
        search={search}
        listCol="minmax(0, var(--md-col))"
        list={
          <ContextRoster
            base={base}
            search={search}
            back={leave}
            count={club ? `${plural(ids.length, 'joueur')} · ${order.toSee.length ? `${order.toSee.length} à voir` : 'tous vus ✓'}` : ''}
            sections={[
              { heading: order.toSee.length ? `À voir · ${yearText}` : null, players: order.toSee },
              { heading: order.seen.length ? `Déjà vus (${order.seen.length})` : null, players: order.seen },
            ]}
            detail={(p) => [year(p), seenText(last.get(p.id))].filter(Boolean).join(' · ')}
            actions={(p) => ({
              rewatch: last.has(p.id) ? undefined : <RewatchToggle playerId={p.id} rows={data.rewatch.get(p.id)} />,
              follow: <FollowStar id={p.id} />,
            })}
          />
        }
      />
    </BilanCtx.Provider>
  )
}

/** Fiche du joueur, sous un bandeau de ce que le bilan en dit (positif ou neutre seulement) et ses actions rapides. */
export function CoveragePlayer() {
  const { pid = '' } = useParams()
  const ctx = useContext(BilanCtx)
  const role = useRole()
  const split = useMedia(MQ.split)
  const [adding, setAdding] = useState(false)
  const s = ctx?.last.get(pid)
  const club = ctx?.club
  return (
    <div key={pid} className="flex flex-col gap-3">
      {ctx && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-accent/40 bg-accent/10 px-3 py-2 text-xs">
          <span className="min-w-0 flex-1">
            {/* Téléphone : le club est déjà dans la barre du haut. */}
            {split && club && <span className="block truncate font-bold">{clubLabel(club.name)}</span>}
            <span className="block text-[11px]">
              {s ? (
                <span className="text-accent">
                  <Icon name="eye" className="mr-0.5 inline h-3 w-3 -translate-y-px" />
                  Vu le {fmtDate(s.day)}
                  {s.by ? `, par ${s.by}` : ''}
                </span>
              ) : (
                <span className="font-bold text-sky-300">À voir</span>
              )}
              <span className="text-muted"> · Bilan de détection, {ctx.yearText.toLowerCase()}</span>
            </span>
          </span>
          <span className="flex shrink-0 items-center gap-1">
            {!s && (
              <span className="flex items-center text-[11px] text-muted">
                <RewatchToggle playerId={pid} rows={ctx.rewatch.get(pid)} />à revoir
              </span>
            )}
            {!s && can.manageEvents(role) && (
              <button type="button" className="btn-ghost ml-1 min-h-8 px-2.5 py-1 text-xs" onClick={() => setAdding(true)} title="Ajouter ce joueur à un événement à venir">
                <Icon name="calendar" className="h-3.5 w-3.5" />
                Ajouter à un événement
              </button>
            )}
            <FollowStar id={pid} />
          </span>
        </div>
      )}
      {/* Téléphone : la barre du haut fait le retour au bilan. */}
      <PlayerDetail id={pid} hideBack={!split} />
      {adding && <AddToEventDialog playerIds={[pid]} onClose={() => setAdding(false)} />}
    </div>
  )
}
