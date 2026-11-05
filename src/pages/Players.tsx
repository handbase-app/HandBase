import { StickyQuery } from '../components/StickyQuery'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { age, type Measurement, type Player } from '../db'
import { Empty, fmtValue, Segmented } from '../components/ui'
import { PlayerRow } from '../components/PlayerRow'
import { PlayerList } from '../components/Pictos'
import { Windowed } from '../components/InfiniteList'
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
import { basePlayers, useListMeasures, usePlainPreview, usePlayersByName } from '../playersCache'
import { RewatchPlace } from '../rewatchPlace'
import { ImportMesures } from '../components/ImportMesures'

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
    const players = view === 'base' ? basePlayers(all) : all.filter((p) => p.review === view)
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
  const { filtered, ui, top, group, valueOf, loading, calculating, gender, plain, sex, rewatchOrigin } = usePlayersQuery(players, { display: true, count: true }) // même disposition partout : barre « Demander » en haut, « Filtres » dedans (fenêtre), le nombre de joueurs collé devant
  // Premier passage (rien en mémoire) : les premières fiches tout de suite, lues par l'index, le temps que toute la base se lise
  // (liste sans filtre seulement ; un filtre posé ou tapé s'applique dès que tout est lu). Pas de sélection
  // pendant ce temps (« Tout » coche toute la liste filtrée).
  const preview = usePlainPreview(loading && view === 'base' && plain, sex, PAGE)
  // Premières fiches déjà montrées : la page reste en place (barre « Demander » comprise, champ en cours de frappe) même si
  // un filtre posé entre-temps les retire, en attendant la liste complète.
  const previewSeen = useRef<typeof preview>(undefined)
  if (preview) previewSeen.current = preview
  const { nPending, nRefused } = all ? counted : (previewSeen.current ?? counted)
  const [grouping, setGrouping] = useState(false)
  // « Coller un tableau de mesures » (src/components/ImportMesures.tsx) : joueurs recherchés dans toute la base.
  const [pasting, setPasting] = useState(false)
  const [groupMsg, setGroupMsg] = useState<{ text: string; groupId?: string }>({ text: '' })
  // Liste qui défile d'un trait (plus de « Afficher plus ») : toutes les fiches filtrées sont dans la liste, seule une
  // fenêtre d'une soixantaine de lignes autour de l'écran est dessinée (components/InfiniteList.tsx, Windowed). `win` :
  // lignes dessinées ; les pictogrammes sont lus pour elles et un paquet autour (BLOCK), pas pour 40 000 fiches.
  const [win, setWin] = useState<readonly [number, number]>([0, PAGE])
  const onRange = useCallback((a: number, b: number) => setWin((w) => (w[0] === a && w[1] === b ? w : [a, b])), [])
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
  const shown = useMemo(() => (loading ? (preview?.rows ?? []) : filtered), [loading, preview, filtered])
  const allIds = useMemo(() => shown.map((p) => p.id), [shown])
  const from = Math.max(0, Math.floor(win[0] / BLOCK) * BLOCK - BLOCK)
  const to = Math.ceil(win[1] / BLOCK) * BLOCK + BLOCK
  const shownIds = useMemo(() => (shown.length <= to - from ? allIds : allIds.slice(from, to)), [allIds, shown.length, from, to])
  // Pictogrammes réglés dans la fenêtre « Filtres » (section « Affichage ») ; le nombre de joueurs est dans la barre
  // « Demander », collé devant « Filtres » (« 7 · Filtres ▾ », usePlayersQuery `count`).
  const countText = loading ? 'Chargement…' : pluralG(filtered.length, gender)
  const nav = useNavigate()
  // La liste (ses lignes et sa barre) : refaite quand elle change, pas à chaque lettre tapée dans la barre « Demander »
  // (60 lignes et leur mise en page : la moitié du temps d'une frappe sur 40 000 fiches). Pendant un calcul (filtre, nom
  // tapé) : nombre estompé et aria-busy, posés autour (sans redessiner la liste) ; la fine barre est sous la pilule.
  const list = useMemo(
    () => (
      <PlayerList
        ids={shownIds}
        all={allIds}
        // Toute la liste est là (en défilant) : « Tout » ne parle pas de joueurs « pas encore affichés ».
        selShown={allIds}
        select={!loading}
        pictosInFilters
      >
      {loading && !preview?.rows.length ? null : shown.length === 0 ? (
        <Empty>{w(gender).AucunJoueur} ne correspond.</Empty>
      ) : (
        <Windowed
          items={shown}
          keyOf={idOf}
          className="cols flex flex-col gap-2"
          cacheKey="joueurs"
          onRange={onRange}
          render={(p) => {
            const l = latest.get(p.id)
            // Liste triée (taille, note, priorité…) ou résultat du mode avancé : la valeur, en clair.
            return <Row key={p.id} p={p} height={l?.get('taille')?.value} v={valueOf(p)} selected={selected === p.id} tabQuery={tabQuery} />
          }}
        />
      )}
      </PlayerList>
    ),
    // `win` : la liste se remet en page (cadre des deux colonnes, place des pictogrammes) quand d'autres lignes sont dessinées.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [shownIds, allIds, loading, preview, gender, shown, latest, valueOf, selected, tabQuery, onRange, win],
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
        // Résultats de tests notés sur papier, mis en tableau par l'IA du préparateur : collés ici, validés, enregistrés.
        can.editMeasurements(role) && { label: 'Coller un tableau de mesures', icon: 'ruler', hint: 'résultats de tests (IA, tableur, CSV)', onSelect: () => setPasting(true) },
      ]}
    />
  )

  if (!all && !previewSeen.current) return <div className="py-20 text-center text-sm text-muted">Chargement…</div>

  return (
    <div onKeyDown={(e) => arrowNav(e, 'a[data-player]')}>
      <TabBackButton className="mb-2 block" />
      {/* Titre pour les lecteurs d'écran seulement : l'onglet du menu, en surbrillance, dit déjà où l'on est (30/10). Le
          nombre de joueurs et les actions (« ⋯ » : Nouveau joueur, Ajouter à un groupe, Exporter) sont dans la barre « Demander ». */}
      <h1 className="sr-only">Joueurs</h1>

      {(nPending > 0 || nRefused > 0 || view !== 'base') && (
        // Style commun des choix (Segmented, pastille teintée : 31/10).
        <div className="mb-3">
          <Segmented
            label="Fiches"
            value={view}
            onChange={setView}
            options={[
              { value: 'base', label: 'Base' },
              { value: 'pending', label: `Proposées (${nPending})` },
              { value: 'refused', label: `Hors cadre (${nRefused})` },
            ]}
          />
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
      {pasting && <ImportMesures scope={{ kind: 'tous' }} onClose={() => setPasting(false)} />}
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
        // Sélection multiple : « Tout » coche toute la liste filtrée (all), lignes pas encore dessinées comprises. La liste reste
        // en place pendant un calcul de filtre ou quand rien ne correspond : la sélection survit au changement de filtre.
        // Nombre de joueurs dans la barre « Afficher », collée en haut : visible pendant tout le défilement.
        // « À revoir » posé d'ici (horloge, menu, sélection) : il garde le filtre de la liste (src/rewatchPlace.tsx).
        <div aria-busy={calculating || undefined} className={calculating ? 'wait-busy' : undefined}>
          <RewatchPlace get={rewatchOrigin}>{list}</RewatchPlace>
        </div>
      )}
      </div>
      </div>
    </div>
  )
}

/**
 * Ligne de la liste : redessinée seulement si sa fiche, sa taille, sa valeur ou son état changent (pas quand la
 * liste se recalcule avec les mêmes fiches : fin de la lecture de la base, suivis ou vidéos lus).
 */
const Row = memo(function Row({ p, height, v, selected, tabQuery }: { p: Player; height?: number | string; v: string; selected: boolean; tabQuery: string }) {
  return (
    <PlayerRow
      p={p}
      selected={selected}
      link={{ to: `/joueurs/${p.id}${tabQuery}` }}
      linkProps={{ 'data-player': true, 'data-md': p.id, 'aria-current': selected || undefined }}
      deletable
      badges={p.review !== 'validated' && <ReviewBadge e={p} kind="players" />}
      // Sous le nom : ce que chacun choisit (« Affichage », src/sousNom.ts) ; l'âge en plus sur une ligne large s'il n'est pas choisi.
      age={age(p.birthDate)}
      height={height !== undefined ? fmtValue(undefined, height) : undefined}
      lines={v && <span className="truncate text-[10px] font-bold text-accent">{v}</span>}
    />
  )
})

/** Premières fiches montrées pendant la lecture de la base. */
const PAGE = 60
/** Pictogrammes lus par paquets de fiches autour des lignes dessinées (un paquet de chaque côté en plus). */
const BLOCK = 100
const idOf = (p: Player) => p.id
const SCROLL_KEY = 'handbase.joueurs.scroll'
const NO_MEASURES = new Map<string, Map<string, Measurement>>()
let lastView: { all: Player[]; view: string; players: Player[] } | null = null

export { fold }
