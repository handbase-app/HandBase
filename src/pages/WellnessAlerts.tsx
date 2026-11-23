import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { BackButton, useEntryState } from '../backNav'
import { AlertsBubble } from '../components/WellnessAlerts'
import { Empty, Icon, playerName } from '../components/ui'
import { alive, db, type Player } from '../db'
import { useFollows, type FollowedGroup } from '../follows'
import { listGender, type Gender } from '../gender'
import { concernedText, hitText, noneText, notSharedText, type WellnessAlertDef } from '../wellnessAlerts'
import { refreshWellnessAlerts, useWellnessAlerts } from '../wellnessAlertsStore'
import type { AxisAnchor } from '../components/ZoneRadar'

/*
 * Page « Alertes wellness » (/alertes-wellness), ouverte par le cœur de l'en-tête (src/App.tsx) : les suivis en alerte ce
 * matin (ce qui a sonné, lien vers l'onglet wellness de leur fiche et vers le wellness de leur groupe), le bouton « Mes
 * alertes wellness » (fenêtre de réglage, src/components/WellnessAlerts.tsx) et la ligne discrète des suivis qui ne
 * partagent pas leur wellness. Données : src/wellnessAlertsStore.ts (même résultat que le cœur, en mémoire seulement ;
 * rien sur l'appareil). Seulement pour le staff (administrateur, encadrant). « Retour » : l'écran d'avant, par l'historique.
 */

export default function WellnessAlertsPage() {
  const s = useWellnessAlerts()
  const follows = useFollows()
  const [at, setAt] = useState<AxisAnchor | null>(null)
  const [showOthers, setShowOthers] = useEntryState('autresWellness', false)
  // Page ouverte : relue si le dernier calcul a plus de 5 minutes (sinon le résultat du cœur de l'en-tête).
  useEffect(() => refreshWellnessAlerts(5 * 60_000), [])
  const hitIds = [...(s?.byPlayer.keys() ?? [])]
  const ids = [...new Set([...(follows?.followed ?? []), ...hitIds])]
  const players = useLiveQuery(
    async () => new Map(alive((await db.players.bulkGet(ids)).filter((p): p is Player => !!p)).filter((p) => !p.mergedInto).map((p) => [p.id, p])),
    [ids.join()],
  )

  const title = (n: number, g: Gender) => (
    <h1 className="flex min-w-0 items-center gap-2 text-lg font-extrabold">
      <Icon name="heartAlert" className={`h-5 w-5 shrink-0 ${n ? 'text-red-400' : 'text-muted'}`} />
      Alertes wellness
      {n > 0 && (
        <span className="rounded-full bg-red-500 px-1.5 py-px text-[11px] font-bold text-white" title={concernedText(n, g)}>
          {n}
        </span>
      )}
    </h1>
  )
  const page = (body: React.ReactNode, n = 0, g: Gender = undefined, button?: React.ReactNode) => (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-3" data-testid="page-alertes-wellness">
      <BackButton fallback="/suivis" label="MES SUIVIS" />
      <div className="flex items-center justify-between gap-2">
        {title(n, g)}
        {button}
      </div>
      {body}
    </div>
  )

  if (!s) return page(<Empty>Réservé aux encadrants.</Empty>)
  if (s.missing) return page(<Empty>Les alertes wellness ne sont pas encore en place sur ce serveur.</Empty>)
  if (s.error && !s.res) return page(<p className="text-xs text-muted">Alertes wellness : {s.error}</p>)
  if (!s.defs || !s.res || !follows || !players) return page(<div className="py-16 text-center text-sm text-muted">Chargement…</div>)
  if (!s.res.enabled) return page(<Empty>Le wellness n’est pas ouvert sur cette installation.</Empty>)

  const defs = s.defs
  const concerned = [...s.byPlayer.keys()]
    .map((id) => players.get(id))
    .filter((p): p is Player => !!p)
    .sort((a, b) => playerName(a).localeCompare(playerName(b), 'fr'))
  const others = [...follows.followed]
    .filter((id) => players.has(id) && !s.res!.readable.has(id))
    .map((id) => players.get(id)!)
    .sort((a, b) => playerName(a).localeCompare(playerName(b), 'fr'))
  const g: Gender = listGender(undefined, concerned)
  const active = defs.filter((d) => d.actif)

  const open = (ev: React.MouseEvent<HTMLButtonElement>) => {
    const r = ev.currentTarget.getBoundingClientRect()
    setAt({ x: r.left + r.width / 2, top: r.top, bottom: r.bottom })
  }
  const settingsButton = (
    <button type="button" className="min-h-9 shrink-0 rounded-full border border-line px-3 text-xs font-bold text-accent hover:border-accent" data-testid="alertes-wellness-regler" onClick={open}>
      Mes alertes wellness
    </button>
  )

  return page(
    <>
      {error(s.error)}
      {concerned.length ? (
        <section className="card flex flex-col gap-1 border-spread-lo/60 p-3" data-testid="alertes-wellness">
          <p className="text-[11px] text-muted">Ce matin, sur tes suivis dont tu lis le wellness · {concernedText(concerned.length, g)}</p>
          <ul className="flex flex-col divide-y divide-line">
            {concerned.map((p) => (
              <PlayerAlerts key={p.id} p={p} hits={s.byPlayer.get(p.id)!} groups={follows.groups} />
            ))}
          </ul>
        </section>
      ) : (
        <div data-testid="alertes-wellness-vide">
          <Empty>
            <span className="flex flex-col items-center gap-2">
              <Icon name="heartAlert" className="h-6 w-6" />
              {active.length
                ? noneText(listGender(undefined, [...follows.followed].map((id) => players.get(id))))
                : 'Aucune alerte réglée pour l’instant : « Mes alertes wellness » pour en ajouter une.'}
            </span>
          </Empty>
        </div>
      )}
      <OthersLine others={others} g={listGender(undefined, others)} open={showOthers} onToggle={() => setShowOthers(!showOthers)} />
      {at && <AlertsBubble at={at} defs={defs} groups={follows.groups} onChanged={() => refreshWellnessAlerts()} onClose={() => setAt(null)} />}
    </>,
    concerned.length,
    g,
    settingsButton,
  )
}

const error = (e: string | null) => (e ? <p className="text-[11px] text-muted">Dernière mise à jour impossible : {e}</p> : null)

/**
 * Un suivi en alerte : son nom (onglet wellness de sa fiche), ce qui a sonné et le nom de l'alerte, puis le wellness de son
 * groupe (celui visé par l'alerte, sinon ses groupes suivis qui demandent le wellness).
 */
function PlayerAlerts({ p, hits, groups }: { p: Player; hits: readonly { def: WellnessAlertDef; jours: number }[]; groups: readonly FollowedGroup[] }) {
  const targeted = hits.map((h) => h.def.cible).filter((c): c is string => !!c)
  const wellnessGroups = groups.filter((x) => (targeted.length ? targeted.includes(x.group.id) : x.group.wellness === true && x.group.playerIds.includes(p.id)))
  return (
    <li className="flex flex-col gap-0.5 py-2">
      <Link to={`/joueurs/${p.id}?onglet=wellness`} className="flex items-center gap-1.5 text-sm font-bold hover:text-accent">
        <Icon name="heartAlert" className="h-4 w-4 shrink-0 text-red-400" />
        {playerName(p)} <span className="font-normal text-muted">›</span>
      </Link>
      {hits.map(({ def, jours }) => (
        <span key={def.id} className="flex flex-wrap items-baseline gap-x-2 pl-5.5 text-xs">
          <span>{hitText(def.regle, jours)}</span>
          {/* Nom de l'alerte, sauf s'il redit ce qui a sonné (alerte nommée d'après sa sorte : « Douleur signalée »). */}
          {!hitText(def.regle, jours).startsWith(def.nom) && <span className="text-[10px] text-muted">{def.nom}</span>}
        </span>
      ))}
      {wellnessGroups.length > 0 && (
        <span className="flex flex-wrap gap-x-3 pl-5.5 text-[11px]">
          {wellnessGroups.map(({ group }) => (
            <Link key={group.id} to={`/groupes/${group.id}/wellness`} className="font-bold text-accent">
              Wellness de {group.name} ›
            </Link>
          ))}
        </span>
      )}
    </li>
  )
}

/** Suivis dont le wellness n'est pas lu par ce compte : une ligne neutre, les noms à la demande (jamais une raison). */
function OthersLine({ others, g, open, onToggle }: { others: Player[]; g: Gender; open: boolean; onToggle: () => void }) {
  if (!others.length) return null
  return (
    <div className="text-[11px] text-muted" data-testid="alertes-wellness-non-partages">
      <button type="button" className="text-left hover:text-fg" aria-expanded={open} onClick={onToggle}>
        {notSharedText(others.length, g)} <span className="font-bold text-accent">{open ? 'Masquer' : 'Voir'}</span>
      </button>
      {open && <div className="mt-0.5">{others.map(playerName).join(' · ')}</div>}
    </div>
  )
}
