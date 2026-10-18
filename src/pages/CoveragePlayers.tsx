import { createContext, useContext, useMemo, useState } from 'react'
import { Navigate, Outlet, useParams } from 'react-router-dom'
import MasterDetail from '../components/MasterDetail'
import { ContextBar, ContextRoster, useLeaveTo } from '../components/ContextRoster'
import { FollowStar } from '../components/Follow'
import { RewatchToggle } from '../components/Scouting'
import { Empty, Icon } from '../components/ui'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, fmtDate, type Player, type Rewatch } from '../db'
import { listGender, pluralG, w, type Gender } from '../gender'
import type { ClubCoverage, Onglet, Sight } from '../coverage'
import { MQ, useMedia } from '../layout'
import { can, useRole } from '../roles'
import PlayerDetail from './PlayerDetail'
import { AddToEventDialog, sightText, tabOf, useBilanModel, useBilanQuestion, useBilanState, whoOrder, whoSummary } from './Coverage'

/*
 * Fiche d'un joueur ouverte depuis le bilan de détection : /bilan/joueurs/:pid?<état du bilan> (partageable), comme
 * depuis un événement ou un groupe (EventPlayers.tsx, GroupPlayers.tsx). La liste d'origine : les joueurs du club
 * choisi, avec l'onglet et les filtres du bilan (même ordre que « Qui ? » : à voir puis déjà vus ; à mesurer puis
 * déjà mesurés ; profils repérés puis les autres ; licenciés : tous), pas toute la base.
 * Ordinateur : ces joueurs à gauche, la fiche à droite ; « Fermer » (Échap) revient au bilan tel qu'on l'a laissé.
 * Téléphone : fiche en plein écran sous la barre « club · 3 / 16 » (‹ ›, retour au bilan à la même position).
 * Question posée au bilan (?q=…) : les joueurs du club qui y répondent, avec ce que la question dit de chacun.
 * Uniquement des marques positives ou neutres : « vu le …, par … », « à voir », « à mesurer », « profil repéré ».
 */

const clubLabel = (name: string) => name || 'Club non renseigné'
const year = (p: Player) => p.birthDate?.slice(0, 4) ?? ''

type Ctx = {
  o: Onglet
  club?: ClubCoverage<Player>
  yearText: string
  last: Map<string, Sight>
  hit: { has(id: string): boolean }
  rewatch: Map<string, Rewatch[]>
  /** Question posée : ce qu'elle dit d'un joueur. */
  q?: (id: string) => string
}
const BilanCtx = createContext<Ctx | null>(null)

export default function CoveragePlayers() {
  const { pid } = useParams()
  const role = useRole()
  const split = useMedia(MQ.split)
  const { st, search } = useBilanState()
  const o = st.onglet
  const bilan = useBilanModel(st)
  const { data, last, hit, yearText } = bilan
  // Question posée : ses joueurs du club (ceux qui répondent), dans l'ordre de la question.
  const bq = useBilanQuestion(st, bilan.qm)
  const Q = st.q ? bq : null
  const club = Q ? Q.club : bilan.club
  const name = club ? clubLabel(club.name) : 'Bilan de détection'
  const leave = useLeaveTo(`/bilan${search}`, name)
  const order = useMemo(() => (Q ? { main: club ? Q.order(club) : [], rest: [] } : club ? whoOrder(club, o) : { main: [], rest: [] }), [club, o, Q?.agg]) // eslint-disable-line react-hooks/exhaustive-deps
  const ctx = useMemo<Ctx | null>(
    () => (data ? { o, club, yearText, last, hit, rewatch: data.rewatch, ...(Q ? { q: (id: string) => Q.playerText({ id }) } : {}) } : null),
    [o, data, club, yearText, last, hit, Q?.agg], // eslint-disable-line react-hooks/exhaustive-deps
  )
  const base = '/bilan/joueurs'

  if (!can.viewCoverage(role)) return <Empty>Le bilan de détection est réservé aux administrateurs et aux encadrants.</Empty>
  // Sans joueur choisi : le bilan lui-même.
  if (!pid) return <Navigate to={`/bilan${search}`} replace />
  if (!data || !ctx || (Q && !Q.ready)) return <div className="py-20 text-center text-sm text-muted">Chargement…</div>
  const ids = [...order.main, ...order.rest].map((p) => p.id)
  // Accord (src/gender.ts) : filtre « Féminin » (bilan ou question), ou club dont les joueurs listés sont toutes des filles.
  const g: Gender = listGender(st.q ? st.q.pop.sex : st.sex, [...order.main, ...order.rest])
  const tab = tabOf(o, g)

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
            count={Q ? `${pluralG(ids.length, g)} · question au bilan` : club ? (o === 'licencies' ? whoSummary(o, ids.length, g) : `${pluralG(ids.length, g)} · ${whoSummary(o, order.main.length, g)}`) : ''}
            sections={[
              { heading: Q ? (Q.texts ? `${Q.texts.what} · répondent à la question` : null) : order.main.length ? `${tab.main} · ${yearText}` : null, players: order.main },
              { heading: order.rest.length ? `${tab.rest} (${order.rest.length})` : null, players: order.rest },
            ]}
            detail={(p) => [year(p), Q ? Q.playerText(p) : o === 'vus' && sightText(last.get(p.id), p.sex)].filter(Boolean).join(' · ')}
            actions={(p) => ({
              rewatch: Q || o !== 'vus' || last.has(p.id) ? undefined : <RewatchToggle playerId={p.id} rows={data.rewatch.get(p.id)} />,
              follow: <FollowStar id={p.id} sex={p.sex} />,
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
  const o = ctx?.o ?? 'vus'
  const s = ctx?.last.get(pid)
  const counted = !!ctx?.hit.has(pid)
  const club = ctx?.club
  // Joueur encore « à voir » / « à mesurer » (onglets en part) : actions rapides pour aller le voir.
  const q = ctx?.q
  const qText = q ? q(pid) : ''
  const todo = !q && ((o === 'vus' && !s) || (o === 'mesures' && !counted))
  // Bandeau accordé au sexe de la fiche (« Vue le… », « Mesurée par le staff »).
  const sex = useLiveQuery(() => db.players.get(pid).then((p) => p?.sex), [pid])
  const pw = w(sex)
  return (
    <div key={pid} className="flex flex-col gap-3">
      {ctx && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-accent/40 bg-accent/10 px-3 py-2 text-xs">
          <span className="min-w-0 flex-1">
            {/* Téléphone : le club est déjà dans la barre du haut. */}
            {split && club && <span className="block truncate font-bold">{clubLabel(club.name)}</span>}
            <span className="block text-[11px]">
              {q ? (
                <span className="text-accent">
                  <span aria-hidden>✨ </span>
                  Répond à la question{qText ? ` · ${qText}` : ''}
                </span>
              ) : o === 'vus' && s ? (
                <span className="text-accent">
                  <Icon name="eye" className="mr-0.5 inline h-3 w-3 -translate-y-px" />
                  {pw.vu.replace(/^./, (c) => c.toUpperCase())} le {fmtDate(s.day)}
                  {s.by ? `, par ${s.by}` : ''}
                </span>
              ) : o === 'mesures' && counted ? (
                <span className="text-accent">{pw.mesure.replace(/^./, (c) => c.toUpperCase())} par le staff</span>
              ) : o === 'reperes' && counted ? (
                <span className="text-accent">
                  <Icon name="target" className="mr-0.5 inline h-3 w-3 -translate-y-px" />
                  Profil repéré
                </span>
              ) : todo ? (
                <span className="font-bold text-sky-300">{o === 'vus' ? 'À voir' : 'À mesurer'}</span>
              ) : (
                <span className="font-bold">{tabOf(o, sex === 'F' ? 'F' : undefined).label}</span>
              )}
              <span className="text-muted"> · Bilan de détection{q ? '' : `, ${ctx.yearText.toLowerCase()}`}</span>
            </span>
          </span>
          <span className="flex shrink-0 items-center gap-1">
            {!q && o === 'vus' && !s && (
              <span className="flex items-center text-[11px] text-muted">
                <RewatchToggle playerId={pid} rows={ctx.rewatch.get(pid)} />à revoir
              </span>
            )}
            {todo && can.manageEvents(role) && (
              <button type="button" className="btn-ghost ml-1 min-h-8 px-2.5 py-1 text-xs" onClick={() => setAdding(true)} title={`Ajouter ${pw.ceJoueur} à un événement à venir`}>
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
