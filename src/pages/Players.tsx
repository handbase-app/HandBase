import { StickyQuery } from '../components/StickyQuery'
import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { age, lateralityLabel, type Measurement, type Player } from '../db'
import { Empty, fmtValue } from '../components/ui'
import { PlayerRow, playerSub } from '../components/PlayerRow'
import { PlayerList } from '../components/Pictos'
import { BarActions, MoreActions } from '../components/PageHeader'
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
import { useListMeasures, usePlainPreview, usePlayersByName } from '../playersCache'

// Dernière valeur de chaque critère factuel, par joueur (src/playersOrder.ts ; importée d'ici par d'autres écrans).
export { latestByPlayer } from '../playersOrder'

export default function Players() {
  const role = useRole()
  // « Voir comme… » un membre sans affectation : liste vide, expliquée.
  const per = usePerimeter()
  // Fiches et mesures gardées en mémoire (src/playersCache.ts) : au retour sur la liste, tout est là.
  const all = usePlayersByName()
  const measures = useListMeasures()
  // Fiches : la base (fiches proposées comprises) ; les proposées seules ; les fiches hors cadre, gardées pour mémoire.
  const [view, setView] = useSessionState<'base' | 'pending' | 'refused'>('handbase.joueurs.view', 'base')
  // Comptés une fois par lecture de la base (pas à chaque lettre tapée : 40 000 fiches).
  const counted = useMemo(() => {
    let nPending = 0
    let nRefused = 0
    for (const p of all ?? []) {
      if (p.review === 'pending') nPending++
      else if (p.review === 'refused') nRefused++
    }
    return { nPending, nRefused }
  }, [all])
  const players = useMemo(() => {
    if (!all) return undefined
    // Même tableau qu'au dernier passage (mêmes fiches, même vue) : l'index des filtres n'est pas refait au retour.
    if (lastView?.all === all && lastView.view === view) return lastView.players
    const players = all.filter((p) => (view === 'base' ? p.review !== 'refused' : p.review === view))
    lastView = { all, view, players }
    return players
  }, [all, view])
  // Ordinateur : joueur ouvert dans le panneau de droite (surligné). La colonne de filtres se replie alors
  // (bouton « Filtres » au-dessus de la liste) pour laisser la place à la liste et à la fiche.
  // Filtres = recette (même moteur que « Poser une question ») : champ « Filtrer ou poser une question… », micro ✨,
  // pastilles, filtres rapides, conditions et tri (src/components/PlayersQuery.tsx).
  const selected = useSelected('/joueurs')
  // Ordinateur, une fiche ouverte à droite : on passe à un autre joueur en gardant son onglet (Croissance…).
  const tabQuery = keepPlayerTab('', '/joueurs', useLocation().search)
  const { filtered, ui, top, signature: filterSig, group, valueOf, loading, calculating, gender, plain, sex } = usePlayersQuery(players, { display: true, count: true }) // même disposition partout : barre « Demander » en haut, « Filtres » dedans (fenêtre), le nombre de joueurs collé devant
  // Premier passage (rien en mémoire) : les premières fiches tout de suite, lues par l'index, le temps que toute la base se lise
  // (liste sans filtre seulement ; un filtre posé ou tapé s'applique dès que tout est lu). Ni « Afficher plus » ni sélection
  // pendant ce temps (« Tout » coche toute la liste filtrée).
  const preview = usePlainPreview(loading && view === 'base' && plain, sex, PAGE)
  // Premières fiches déjà montrées : la page reste en place (barre « Demander » comprise, champ en cours de frappe) même si
  // un filtre posé entre-temps les retire, en attendant la liste complète.
  const previewSeen = useRef<typeof preview>(undefined)
  if (preview) previewSeen.current = preview
  const { nPending, nRefused } = all ? counted : (previewSeen.current ?? counted)
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
  // Position retrouvée une fois la liste complète affichée (pas sur les premières fiches).
  const restored = useRef(false)
  useEffect(() => {
    if (loading || restored.current) return
    restored.current = true
    const y = Number(sessionStorage.getItem(SCROLL_KEY) ?? 0)
    if (y) requestAnimationFrame(() => window.scrollTo(0, y))
  }, [loading])
  useEffect(() => {
    const keep = () => sessionStorage.setItem(SCROLL_KEY, String(window.scrollY))
    window.addEventListener('scroll', keep, { passive: true })
    return () => window.removeEventListener('scroll', keep)
  }, [])

  const latest = (loading ? preview?.latest : measures?.latest) ?? NO_MEASURES
  const shown = useMemo(() => (loading ? (preview?.rows ?? []) : filtered.slice(0, limit)), [loading, preview, filtered, limit])
  const allIds = useMemo(() => (loading ? shown : filtered).map((p) => p.id), [loading, shown, filtered])
  const shownIds = useMemo(() => shown.map((p) => p.id), [shown])
  const total = players?.length ?? 0
  // Pictogrammes réglés dans la fenêtre « Filtres » (section « Affichage ») ; le nombre de joueurs est dans la barre
  // « Demander », collé devant « Filtres » (« 7 sur 40 001 · Filtres ▾ », usePlayersQuery `count`).
  const countText = loading ? 'Chargement…' : filtered.length < total ? `${pluralG(filtered.length, gender)} sur ${total.toLocaleString('fr-FR')}` : pluralG(filtered.length, gender)
  const nav = useNavigate()
  // La liste (ses lignes et sa barre) : refaite quand elle change, pas à chaque lettre tapée dans la barre « Demander »
  // (60 lignes et leur mise en page : la moitié du temps d'une frappe sur 40 000 fiches). Pendant un calcul (filtre, nom
  // tapé) : nombre estompé et aria-busy, posés autour (sans redessiner la liste) ; la fine barre est sous la pilule.
  const list = useMemo(
    () => (
      <PlayerList
        ids={shownIds}
        all={allIds}
        select={!loading}
        pictosInFilters
      >
      {loading && !preview?.rows.length ? null : shown.length === 0 ? (
        <Empty>{w(gender).AucunJoueur} ne correspond.</Empty>
      ) : (
        <div className="cols flex flex-col gap-2">
          {shown.map((p) => {
            const l = latest.get(p.id)
            // Liste triée (taille, note, priorité…) ou résultat du mode avancé : la valeur, en clair.
            return <Row key={p.id} p={p} height={l?.get('taille')?.value} weight={l?.get('poids')?.value} v={valueOf(p)} selected={selected === p.id} tabQuery={tabQuery} />
          })}
          {!loading && filtered.length > shown.length && (
            <button className="btn-ghost col-span-full text-xs" onClick={() => setLimit((l) => l + PAGE)}>
              Afficher plus ({(filtered.length - shown.length).toLocaleString('fr-FR')} {accord('restant', gender, 2)})
            </button>
          )}
        </div>
      )}
      </PlayerList>
    ),
    [shownIds, allIds, loading, preview, filtered.length, gender, shown, latest, valueOf, selected, tabQuery, setLimit],
  )

  // Toutes les actions de la liste dans « ⋯ », au bout de la barre « Demander » : la création d'abord.
  const actions = (
    <MoreActions
      title="Joueurs"
      subtitle={loading ? undefined : countText}
      items={[
        can.editPlayers(role)
          ? { label: w(gender).NouveauJoueur, icon: 'userPlus', onSelect: () => nav('/joueurs/nouveau') }
          : { label: `Proposer ${w(gender).un} ${w(gender).joueur}`, icon: 'userPlus', hint: 'Fiche à valider ensuite', onSelect: () => nav('/joueurs/nouveau') },
        can.manageGroups(role) &&
          filtered.length > 0 && {
            label: 'Ajouter à un groupe',
            icon: 'users',
            hint: `Les ${w(gender).joueurs} ${accord('affiché', gender, 2)}, groupe existant ou nouveau`,
            onSelect: () => (setGrouping(true), setGroupMsg({ text: '' })),
          },
        filtered.length > 0 && { label: 'Exporter (tableur)', icon: 'download', hint: `Les ${w(gender).joueurs} ${accord('affiché', gender, 2)}, fichier CSV`, onSelect: () => void exportCsv(filtered) },
      ]}
    />
  )

  if (!all && !previewSeen.current) return <div className="py-20 text-center text-sm text-muted">Chargement…</div>

  return (
    <div onKeyDown={(e) => arrowNav(e, 'a[data-player]')}>
      <TabBackButton className="mb-2 block" />
      {/* Le titre seul ; le nombre de joueurs et les actions (« ⋯ » : Nouveau joueur, Ajouter à un groupe, Exporter) sont
          dans la barre « Demander » en dessous. */}
      <h1 className="mb-2 text-lg font-extrabold">Joueurs</h1>

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

      <div>
      <div className="md-box">
      <StickyQuery>
        <BarActions actions={actions}>{ui}</BarActions>
      </StickyQuery>
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

      {players && !players.length ? (
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
        <div aria-busy={calculating || undefined} className={calculating ? 'wait-busy' : undefined}>
          {list}
        </div>
      )}
      </div>
      </div>
    </div>
  )
}

/**
 * Ligne de la liste : redessinée seulement si sa fiche, sa taille, son poids, sa valeur ou son état changent (pas quand la
 * liste se recalcule avec les mêmes fiches : fin de la lecture de la base, suivis ou vidéos lus).
 */
const Row = memo(function Row({ p, height, weight, v, selected, tabQuery }: { p: Player; height?: number | string; weight?: number | string; v: string; selected: boolean; tabQuery: string }) {
  const a = age(p.birthDate)
  const has = height !== undefined || weight !== undefined
  return (
    <PlayerRow
      p={p}
      selected={selected}
      link={{ to: `/joueurs/${p.id}${tabQuery}` }}
      linkProps={{ 'data-player': true, 'data-md': p.id, 'aria-current': selected || undefined }}
      deletable
      badges={p.review !== 'validated' && <ReviewBadge e={p} kind="players" />}
      sub={playerSub(p, a !== null && `${a} ans`)}
      lines={
        (has || p.laterality || v) && (
          <>
            {(has || p.laterality) && (
              <span className="truncate text-[10px] text-muted">
                {[height !== undefined && `${fmtValue(undefined, height)} cm`, weight !== undefined && `${fmtValue(undefined, weight)} kg`, lateralityLabel(p.laterality, p.sex)]
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
})

/** Nombre de joueurs affichés d'un coup (la base peut en contenir des milliers). */
const PAGE = 60
const SCROLL_KEY = 'handbase.joueurs.scroll'
const NO_MEASURES = new Map<string, Map<string, Measurement>>()
let lastView: { all: Player[]; view: string; players: Player[] } | null = null

export { fold }
