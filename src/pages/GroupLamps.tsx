import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { BackButton } from '../backNav'
import { LampDetails, staffLampView, useGroupZone } from '../components/LampStaff'
import { LampSvg } from '../components/PlayerLamp'
import { usePoleMembers, usePoleRef } from '../components/PoleGroup'
import { Avatar, Empty, playerName } from '../components/ui'
import { canReadWellness, useWellnessEnabled } from '../components/Wellness'
import { alive, db, type Player } from '../db'
import { setGender, w } from '../gender'
import { lampLots, LOT_LABEL, pctText, round1, sortLamps, type LampView, type LotStatus } from '../lamp'
import { fetchGroupLamps, type GroupLamps } from '../lampApi'
import { can, useRole } from '../roles'

/*
 * « Lampes du groupe » (/groupes/:id/lampes ; src/lamp.ts, supabase/074_lampe.sql), côté STAFF du groupe seulement (mêmes
 * droits que le wellness : créateur, participants encadrants, administrateurs ; le serveur vérifie, hb_lampe_groupe) :
 *  - une ligne par joueur qui a un espace joueur, triée par pourcentage : sa lampe, ses trimestres, ce qu'il a fait
 *    aujourd'hui, ses vœux ;
 *  - « Lot assuré » (100 % atteint, ou encore sur la route : « si ça continue ») et « Lot de consolation » (meilleur pourcentage
 *    des autres, ex aequo au dixième compris) ; les autres n'ont simplement pas de marque (jamais d'étiquette négative).
 *  - Les vœux choisis par le groupe, comptés (pour préparer les lots).
 * Le jeune, lui, ne voit jamais ce tableau ni le chiffre d'un autre. Lu à la demande, jamais gardé sur l'appareil.
 */

export default function GroupLampsPage() {
  const { id } = useParams()
  const role = useRole()
  const wellnessOn = useWellnessEnabled()
  const data = useLiveQuery(async () => {
    const g = await db.groups.get(id!)
    const got = (await db.players.bulkGet(g?.playerIds ?? [])).filter((p): p is Player => !!p)
    return { g, players: alive(got) }
  }, [id])
  const g = data?.g
  const pole = !!g?.poleUnitId
  const ref = usePoleRef(g?.poleUnitId)
  const pm = usePoleMembers(pole ? ref : null)
  const players = useMemo(() => (pole ? (pm?.shown ?? []) : (data?.players ?? [])), [pole, pm, data])
  const zone = useGroupZone(g)
  const [res, setRes] = useState<{ ok: true; value: GroupLamps } | { ok: false; error: string; missing?: boolean } | null>(null)
  const ids = players.map((p) => p.id).join(',')
  const readable = !!g && canReadWellness(role, g)
  useEffect(() => {
    if (!g || !readable || !g.wellness) return
    let live = true
    void fetchGroupLamps(g.id, ids ? ids.split(',') : []).then((r) => live && setRes(r))
    return () => {
      live = false
    }
  }, [g?.id, ids, readable, g?.wellness]) // eslint-disable-line react-hooks/exhaustive-deps

  const rows = useMemo(() => {
    if (!res?.ok || zone === undefined) return []
    const v = res.value
    return players
      .filter((p) => v.accounts.has(p.id) && v.rows.has(p.id))
      .map((p) => {
        const view = staffLampView(p, v.rows.get(p.id)!, v.settings, v.today, zone)
        return { p, view, pct: view.pct, trackPct: view.trackPct, id: p.id, name: playerName(p), wishes: v.rows.get(p.id)!.wishes }
      })
  }, [res, players, zone])

  if (!data || (pole && !pm)) return <div className="py-20 text-center text-sm text-muted">Chargement…</div>
  if (!g || g.deleted || !can.seeGroup(g)) return <div className="py-20 text-center text-sm text-muted">Groupe introuvable.</div>
  const gw = w(setGender(ref?.sex ?? g.sex, players))
  const value = res?.ok ? res.value : null
  const lots = lampLots(rows)
  const sorted = sortLamps(rows)
  // Vœux du groupe, comptés (1er vœu compté à part).
  const wishCount = new Map<string, { n: number; first: number }>()
  for (const r of rows)
    r.wishes.forEach((wid, i) => {
      const c = wishCount.get(wid) ?? { n: 0, first: 0 }
      wishCount.set(wid, { n: c.n + 1, first: c.first + (i === 0 ? 1 : 0) })
    })
  const catalogue = value?.settings.catalogue ?? []

  return (
    <div className="flex flex-col gap-4" data-testid="lampes-groupe">
      <BackButton fallback={`/groupes/${g.id}`} label="GROUPE" className="self-start" />
      <div>
        <h1 className="text-lg font-extrabold">Lampes du groupe</h1>
        <div className="text-xs font-bold text-accent">{g.name}</div>
      </div>
      {!wellnessOn || !g.wellness ? (
        <Empty>La lampe suit le wellness quotidien du groupe : activez-le d’abord (page Wellness du groupe).</Empty>
      ) : !readable ? (
        <Empty>Réservé au staff du groupe (créateur, participants) et aux administrateurs.</Empty>
      ) : !res || zone === undefined ? (
        <div className="py-10 text-center text-sm text-muted">Chargement…</div>
      ) : !res.ok ? (
        <Empty>{res.error}</Empty>
      ) : !value!.enabled ? (
        <Empty>La lampe n’est pas encore ouverte sur l’installation (Réglages → Lampe d’Aladin, administrateurs).</Empty>
      ) : (
        <>
          <p className="text-[11px] text-muted">
            Journée allumée : wellness, séance et cahier du hand le même jour de classe. 3 trimestres à 30 % (proportionnel aux journées allumées), + 1 % par cahier de match après une
            semaine complète (assiduité plafonnée à 90 %), + 10 % des encadrants. <b>Lot assuré</b> : 100 % atteint, ou encore sur la route (allumer toutes les journées à venir suffit). <b>Lot de consolation</b> : meilleur
            pourcentage des autres (ex aequo compris). Les {gw.joueurs} ne voient que leur propre lampe, jamais ce tableau.
          </p>
          {sorted.length === 0 ? (
            <Empty>{gw.AucunJoueur} avec un espace joueur dans ce groupe.</Empty>
          ) : (
            <div className="grid grid-cols-1 gap-2 wide:grid-cols-2">
              {sorted.map((r) => (
                <LampRow key={r.id} p={r.p} groupId={g.id} v={r.view} lot={lots.get(r.id)} wishes={r.wishes.map((x) => catalogue.find((c) => c.id === x)?.label).filter((x): x is string => !!x)} />
              ))}
            </div>
          )}
          {wishCount.size > 0 && (
            <section className="card flex flex-col gap-1.5 p-3" data-testid="voeux-groupe">
              <h2 className="text-sm font-bold">Vœux du groupe</h2>
              <ul className="flex flex-col gap-1 text-xs">
                {[...wishCount.entries()]
                  .sort((a, b) => b[1].n - a[1].n || b[1].first - a[1].first)
                  .map(([wid, c]) => (
                    <li key={wid} className="flex min-w-0 justify-between gap-2">
                      <span className="min-w-0">{catalogue.find((x) => x.id === wid)?.label ?? wid}</span>
                      <span className="shrink-0 tabular-nums text-muted">
                        {c.n} {c.first ? `(dont ${c.first} en 1er)` : ''}
                      </span>
                    </li>
                  ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  )
}

const LOT_CLS: Record<LotStatus, string> = {
  assure: 'border-amber-500/60 bg-amber-500/15',
  consolation: 'border-emerald-500/50 bg-emerald-500/10',
}

function LampRow({ p, groupId, v, lot, wishes }: { p: Player; groupId: string; v: LampView; lot?: LotStatus; wishes: string[] }) {
  return (
    <div className="card flex min-w-0 flex-col gap-2 p-2.5" data-testid="lampe-ligne-staff">
      <div className="flex min-w-0 items-center gap-2">
        <Link to={`/groupes/${groupId}/joueurs/${p.id}?onglet=wellness`} state={{ md: true }} className="flex min-w-0 flex-1 items-center gap-2">
          <Avatar p={p} size={32} />
          <span className="min-w-0">
            <span className="block truncate text-sm font-bold">{playerName(p)}</span>
            {lot && (
              <span className={`mt-0.5 inline-block rounded-full border px-2 py-0.5 text-[10px] font-bold ${LOT_CLS[lot]}`} data-testid={`lot-${lot}`}>
                {LOT_LABEL[lot]}
                {lot === 'assure' && round1(v.pct) < 100 ? ' si ça continue' : ''}
              </span>
            )}
          </span>
        </Link>
        <LampSvg pct={v.pct} size={56} />
        <span className="w-16 shrink-0 text-right text-base font-extrabold tabular-nums">{pctText(v.pct)}</span>
      </div>
      <LampDetails v={v} />
      {wishes.length > 0 && <div className="truncate text-[10px] text-muted">Vœux : {wishes.map((x, i) => `${i + 1}. ${x}`).join(' · ')}</div>}
    </div>
  )
}
