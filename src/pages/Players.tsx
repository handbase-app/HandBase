import { StickyQuery } from '../components/StickyQuery'
import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { age, alive, db, lateralityLabel, type Measurement } from '../db'
import { Empty, fmtValue } from '../components/ui'
import { PlayerRow, playerSub } from '../components/PlayerRow'
import { PlayerList } from '../components/Pictos'
import { ReviewBadge } from '../components/Review'
import { arrowNav, fold, useSessionState } from '../components/PlayerFilter'
import { usePlayersQuery } from '../components/PlayersQuery'
import { exportCsv } from '../export'
import { TabBackButton } from '../backNav'
import { AddToGroupDialog, GroupNotice } from '../components/Groups'
import { can, useRole } from '../roles'
import { useSelected } from '../components/MasterDetail'
import { usePerimeter } from '../installation'
import { hasPerimeter } from '../perimeter'
import { spyTarget } from '../spy'
import { keepPlayerTab } from '../tabQuery'
import { accord, pluralG, w } from '../gender'

/** Dernière valeur de chaque critère factuel, par joueur. */
export function latestByPlayer(ms: Measurement[]) {
  const out = new Map<string, Map<string, Measurement>>()
  for (const m of ms) {
    if (m.deleted) continue
    if (!out.has(m.playerId)) out.set(m.playerId, new Map())
    const cur = out.get(m.playerId)!.get(m.criterionId)
    if (!cur || m.date > cur.date || (m.date === cur.date && m.updatedAt > cur.updatedAt)) out.get(m.playerId)!.set(m.criterionId, m)
  }
  return out
}

export default function Players() {
  const role = useRole()
  // « Voir comme… » un membre sans affectation : liste vide, expliquée.
  const per = usePerimeter()
  const all = useLiveQuery(() => db.players.orderBy('lastName').toArray().then(alive))
  const measurements = useLiveQuery(() => db.measurements.where('criterionId').anyOf('taille', 'poids').toArray(), [], [])
  // Fiches : la base (fiches proposées comprises) ; les proposées seules ; les fiches hors cadre, gardées pour mémoire.
  const [view, setView] = useSessionState<'base' | 'pending' | 'refused'>('handbase.joueurs.view', 'base')
  const nPending = all?.filter((p) => p.review === 'pending').length ?? 0
  const nRefused = all?.filter((p) => p.review === 'refused').length ?? 0
  const players = useMemo(
    () => all?.filter((p) => (view === 'base' ? p.review !== 'refused' : p.review === view)),
    [all, view],
  )
  // Ordinateur : joueur ouvert dans le panneau de droite (surligné). La colonne de filtres se replie alors
  // (bouton « Filtres » au-dessus de la liste) pour laisser la place à la liste et à la fiche.
  // Filtres = recette (même moteur que « Poser une question ») : champ « Filtrer ou poser une question… », micro ✨,
  // pastilles, filtres rapides, conditions et tri (src/components/PlayersQuery.tsx).
  const selected = useSelected('/joueurs')
  // Ordinateur, une fiche ouverte à droite : on passe à un autre joueur en gardant son onglet (Croissance…).
  const tabQuery = keepPlayerTab('', '/joueurs', useLocation().search)
  const { filtered, ui, side, top, signature: filterSig, group, valueOf, loading, gender, filtersOpen } = usePlayersQuery(players, { dock: false }) // même disposition partout : barre « Demander » en haut, « Filtres » dedans
  const [grouping, setGrouping] = useState(false)
  const [groupMsg, setGroupMsg] = useState<{ text: string; groupId?: string }>({ text: '' })
  const signature = `${view}|${filterSig}`
  // Nombre de joueurs affichés et position dans la liste : retrouvés au retour d'une fiche.
  const [limit, setLimit] = useSessionState('handbase.joueurs.limit', PAGE)
  const [limitFor, setLimitFor] = useSessionState('handbase.joueurs.limitFor', signature)
  useEffect(() => {
    if (signature !== limitFor) {
      setLimit(PAGE)
      setLimitFor(signature)
    }
  }, [signature, limitFor, setLimit, setLimitFor])
  const restored = useRef(false)
  useEffect(() => {
    if (!players || restored.current) return
    restored.current = true
    const y = Number(sessionStorage.getItem(SCROLL_KEY) ?? 0)
    if (y) requestAnimationFrame(() => window.scrollTo(0, y))
  }, [players])
  useEffect(() => {
    const keep = () => sessionStorage.setItem(SCROLL_KEY, String(window.scrollY))
    window.addEventListener('scroll', keep, { passive: true })
    return () => window.removeEventListener('scroll', keep)
  }, [])

  const latest = useMemo(() => latestByPlayer(measurements), [measurements])

  if (!players || !all) return <div className="py-20 text-center text-sm text-muted">Chargement…</div>
  const shown = filtered.slice(0, limit)
  const allIds = filtered.map((p) => p.id)

  return (
    <div onKeyDown={(e) => arrowNav(e, 'a[data-player]')}>
      <TabBackButton className="mb-2 block" />
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-extrabold">Joueurs</h1>
        <div className="flex gap-2 whitespace-nowrap">
          {can.manageGroups(role) && (
            <button
              className="btn-ghost px-3 py-1.5 text-xs"
              title={`Ajouter les ${w(gender).joueurs} ${accord('affiché', gender, 2)} à un groupe (existant ou nouveau)`}
              disabled={!filtered.length}
              onClick={() => (setGrouping(true), setGroupMsg({ text: '' }))}
            >
              → Groupe{filtered.length < all.length ? ` (${filtered.length.toLocaleString('fr-FR')})` : ''}
            </button>
          )}
          <button className="btn-ghost px-3 py-1.5 text-xs" onClick={() => void exportCsv(filtered)} disabled={!filtered.length}>
            Exporter{filtered.length < all.length ? ` (${filtered.length.toLocaleString('fr-FR')})` : ''}
          </button>
          <Link to="/joueurs/nouveau" className="btn-primary px-3 py-1.5 text-xs">
            {can.editPlayers(role) ? '+ Joueur' : '+ Proposer'}
          </Link>
        </div>
      </div>

      {(nPending > 0 || nRefused > 0 || view !== 'base') && (
        <div className="mb-3 flex gap-2">
          {(
            [
              ['base', 'Base'],
              ['pending', `Proposées (${nPending})`],
              ['refused', `Hors cadre (${nRefused})`],
            ] as const
          ).map(([v, label]) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`flex-1 rounded-md border px-2 py-1.5 text-[11px] font-bold ${view === v ? 'border-accent bg-accent text-white' : 'border-line bg-panel-2 text-muted'}`}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      {view === 'refused' && (
        <p className="mb-2 text-[11px] text-muted">
          Fiches proposées puis mises hors cadre : gardées pour mémoire.{' '}
          <Link to="/rates" className="font-bold text-accent">
            Ce qu’ils sont devenus (ratés) →
          </Link>
        </p>
      )}

      <div className={side ? 'grid grid-cols-[21rem_minmax(0,1fr)] items-start gap-5' : ''}>
      {side && <aside className="sticky top-[4.75rem] max-h-[calc(100dvh-6rem)] overflow-y-auto">{side}</aside>}
      <div className="md-box">
      {ui && <StickyQuery stick={!filtersOpen}>{ui}</StickyQuery>}
      <div className="mb-2 flex flex-col gap-2 empty:hidden">{top}</div>
      {group && (
        <div className="mb-2 text-[11px] text-muted">
          <Link to={`/groupes/${group.id}`} className="font-bold text-accent">
            Ouvrir le groupe
          </Link>
        </div>
      )}
      {grouping && (
        <AddToGroupDialog playerIds={filtered.map((p) => p.id)} onClose={(text, groupId) => (setGrouping(false), setGroupMsg({ text: text ?? '', groupId }))} />
      )}
      <div className="mb-2">
        <GroupNotice msg={groupMsg.text} groupId={groupMsg.groupId} />
      </div>

      {!players.length ? (
        <Empty>
          {spyTarget() && per && !hasPerimeter(per)
              ? 'Aucune affectation : ce membre ne reçoit aucun joueur (à affecter dans Structure).'
              : view === 'base'
                ? 'Aucun joueur pour l’instant. Inscris le premier !'
                : 'Aucune fiche.'}
        </Empty>
      ) : (
        // Pictogrammes au bout des lignes (barre « Afficher », components/Pictos.tsx) : lus pour les joueurs affichés.
        // Sélection multiple : « Tout » coche toute la liste filtrée (all), au-delà de « Afficher plus ». La liste reste
        // en place pendant un calcul de filtre ou quand rien ne correspond : la sélection survit au changement de filtre.
        // Nombre de joueurs dans la barre « Afficher », collée en haut : visible pendant tout le défilement.
        <PlayerList
          ids={shown.map((p) => p.id)}
          all={allIds}
          countLabel={loading ? 'Chargement…' : filtered.length < all.length ? `${pluralG(filtered.length, gender)} sur ${all.length.toLocaleString('fr-FR')}` : pluralG(filtered.length, gender)}
        >
        {loading ? null : shown.length === 0 ? (
          <Empty>{w(gender).AucunJoueur} ne correspond.</Empty>
        ) : (
          <div className={`cols flex flex-col gap-2 ${side ? 'cols-2' : ''}`}>
            {shown.map((p) => {
              const l = latest.get(p.id)
              const a = age(p.birthDate)
              // Liste triée (taille, note, priorité…) ou résultat du mode avancé : la valeur, en clair.
              const v = valueOf(p)
              return (
                <PlayerRow
                  key={p.id}
                  p={p}
                  selected={selected === p.id}
                  link={{ to: `/joueurs/${p.id}${tabQuery}` }}
                  linkProps={{ 'data-player': true, 'data-md': p.id, 'aria-current': selected === p.id || undefined }}
                  badges={p.review !== 'validated' && <ReviewBadge e={p} kind="players" />}
                  sub={playerSub(p, a !== null && `${a} ans`)}
                  lines={
                    (l?.get('taille') || l?.get('poids') || p.laterality || v) && (
                      <>
                        {(l?.get('taille') || l?.get('poids') || p.laterality) && (
                          <span className="truncate text-[10px] text-muted">
                            {[
                              l?.get('taille') && `${fmtValue(undefined, l.get('taille')!.value)} cm`,
                              l?.get('poids') && `${fmtValue(undefined, l.get('poids')!.value)} kg`,
                              lateralityLabel(p.laterality, p.sex),
                            ]
                              .filter(Boolean)
                              .join(' · ')}
                          </span>
                        )}
                        {v && <span className="truncate text-[10px] font-bold text-accent">{v}</span>}
                      </>
                    )
                  }
                />
              )
            })}
            {filtered.length > shown.length && (
              <button className="btn-ghost col-span-full text-xs" onClick={() => setLimit((l) => l + PAGE)}>
                Afficher plus ({(filtered.length - shown.length).toLocaleString('fr-FR')} {accord('restant', gender, 2)})
              </button>
            )}
          </div>
        )}
        </PlayerList>
      )}
      </div>
      </div>
    </div>
  )
}

/** Nombre de joueurs affichés d'un coup (la base peut en contenir des milliers). */
const PAGE = 60
const SCROLL_KEY = 'handbase.joueurs.scroll'

export { fold }
