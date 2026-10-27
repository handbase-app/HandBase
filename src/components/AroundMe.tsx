import { geoCentroid } from 'd3-geo'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useEntryState } from '../backNav'
import { usePerimeter, useSportConfig, useUnits } from '../installation'
import { clubDepartment } from '../perimeter'
import { basePlayers, usePlayersByName } from '../playersCache'
import {
  aroundRequest,
  citiesOf,
  DEFAULT_PREFS,
  deptCenter,
  distanceText,
  distinctYouths,
  fixtureHeading,
  fixtureWhen,
  indexPlayers,
  itineraryUrl,
  matchPlayers,
  namesLine,
  parsePrefs,
  periodRange,
  PERIODS,
  RADII,
  requestKey,
  searchCities,
  sortFixtures,
  STATUS_LABEL,
  teamsLabel,
  venuesOf,
  youthsText,
  type AroundPrefs,
  type FixtureMatch,
  type Place,
  type Rencontre,
} from '../rencontres'
import { AROUND_ERRORS, cachedAround, fetchAround, FRESH_MS, type AroundResult } from '../rencontresApi'
import { sportContent } from '../sportContent'
import type { HBEvent, Player } from '../db'
import { FilterWindow, pillClass, useFilterWindow } from './FilterWindow'
import { useDeptName, useGeo } from './FranceMap'
import { FormActions, FormWindow } from './FormWindow'
import { BarActions, MoreActions } from './PageHeader'
import { useSessionState } from './PlayerFilter'
import { PlayerRow } from './PlayerRow'
import { usePlayersQuery } from './PlayersQuery'
import { PlayerList } from './Pictos'
import { RencontreMap } from './RencontreMap'
import { askWho, rencontreToAgenda, RencontreEventButton, StaffGoing, useRencontreEvents, useRencontreState } from './RencontreEvent'
import { StickyQuery } from './StickyQuery'
import { Empty, Icon, playerName } from './ui'

/*
 * Onglet « Autour de moi » de la page Événements (?vue=autour ; règles : src/rencontres.ts, serveur : src/rencontresApi.ts).
 *  - Qui : la barre du haut est celle de la liste Joueurs (même recette, même fenêtre « Filtres » : suivis, à revoir,
 *    taille, poste, profils recherchés…), avec son propre état (« autour ») : la liste Joueurs n'en est pas changée.
 *    Les onglets de la page sont juste dessous, à la largeur de la barre (comme la page Groupes).
 *  - Où (une pastille → fenêtre : une ville où il y a des clubs, « Mon club », « Mon département », « Ma position » sur
 *    demande seulement ; rayon 10, 25, 50 ou 100 km) et Quand (Ce week-end, 7 jours, 30 jours) : gardés sur l'appareil.
 *  - La carte (contours des départements de l'appli, cercle du rayon, une épingle par salle, taille selon le nombre de
 *    jeunes), puis les rencontres (2 colonnes au plus) : date et heure, catégorie · niveau · compétition, les deux équipes,
 *    salle, ville et distance, « N jeunes » et leurs noms, « Regarder » s'il y a un lien de diffusion. Rencontres sans
 *    jeune de la liste : cachées au départ (« Voir aussi les autres »).
 *  - Toucher une rencontre ouvre sa fiche (fenêtre) : les jeunes (lignes de joueurs communes, vers leur fiche), tout sur
 *    la rencontre, « Itinéraire » (OpenStreetMap, coordonnées de la salle seulement). Retour d'une fiche de joueur : la
 *    fiche de la rencontre est rouverte, la liste au même endroit (état de l'entrée d'historique, réponse gardée en mémoire).
 *  - « Ajouter à mes événements » (fiche ; version courte sur chaque carte) : un événement par rencontre, partagé par le
 *    staff, avec les jeunes de Qui qui devraient y jouer ; puis « ✓ Dans mes événements » (l'ouvre) ou « J'y vais aussi ».
 *    Qui du staff y va (« Toi et Stef y allez »). « Ajouter à mon agenda » (fiche) : fichier .ics fait sur l'appareil, sans
 *    aucun nom de jeune (src/components/RencontreEvent.tsx, src/rencontreEvent.ts, src/agenda.ts).
 * Seuls partent vers le serveur de l'appli le lieu (arrondi), la période, le sexe et les n° de club : jamais un nom.
 */

const PREFS_KEY = 'handbase.autour.choix'

/** Où / rayon / Quand : gardés sur l'appareil (stockage indisponible : pour cette visite). */
function usePrefs(): [AroundPrefs, (p: AroundPrefs) => void] {
  const [p, setP] = useState<AroundPrefs>(() => {
    try {
      return parsePrefs(JSON.parse(localStorage.getItem(PREFS_KEY) ?? 'null'))
    } catch {
      return DEFAULT_PREFS
    }
  })
  const set = (next: AroundPrefs) => {
    setP(next)
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(next))
    } catch {
      /* stockage indisponible : le choix vaut pour cette visite */
    }
  }
  return [p, set]
}

/** « Mon club » et « Mon département » du compte (ses affectations), quand on peut les placer. */
function useMyPlaces(): { club?: Place; dept?: Place } {
  const units = useUnits()
  const per = usePerimeter()
  const deptName = useDeptName()
  const geo = useGeo()
  return useMemo(() => {
    if (!per) return {}
    const out: { club?: Place; dept?: Place } = {}
    const mineClub = per.units.find((u) => u.club)
    if (mineClub) {
      const u = units.find((x) => x.id === mineClub.id && Number.isFinite(x.lat)) ?? units.find((x) => x.clubNumber === mineClub.club && Number.isFinite(x.lat))
      if (u) out.club = { kind: 'club', label: u.name, lat: u.lat!, lng: u.lng! }
    }
    const code = per.units.find((u) => u.depts.length)?.depts[0] ?? (mineClub?.club ? clubDepartment(mineClub.club) : undefined)
    if (code) {
      const f = geo?.features.find((x) => (x.properties.code === '2A' || x.properties.code === '2B' ? '20' : x.properties.code) === code)
      const c = deptCenter(units, code, clubDepartment) ?? (f ? (([lng, lat]) => ({ lat, lng }))(geoCentroid(f)) : undefined)
      if (c) out.dept = { kind: 'dept', label: `${code} · ${deptName(code)}`, lat: c.lat, lng: c.lng }
    }
    return out
  }, [units, per, deptName, geo])
}

const venueKeyOf = (f: Rencontre) => `${f.lat.toFixed(4)},${f.lng.toFixed(4)}`

export default function AroundMe({ tabs }: { tabs: ReactNode }) {
  const all = usePlayersByName()
  const players = useMemo(() => (all ? basePlayers(all) : undefined), [all])
  // Qui : la barre de la liste Joueurs, état à part (« autour »).
  const q = usePlayersQuery(players, { scope: 'autour', count: true })
  const cats = sportContent(useSportConfig().sport).youthCategories
  const [prefs, setPrefs] = usePrefs()
  const mine = useMyPlaces()
  const place = prefs.place ?? mine.club ?? mine.dept
  const [now] = useState(() => new Date())
  const range = useMemo(() => periodRange(prefs.period, now), [prefs.period, now])
  const [showAll, setShowAll] = useSessionState('handbase.autour.toutes', false)
  const sex = q.query.recipe.pop.sex === 'M' || q.query.recipe.pop.sex === 'F' ? q.query.recipe.pop.sex : undefined
  const ready = !!players && !q.loading
  const req = useMemo(() => (place && ready ? aroundRequest(place, prefs.km, range, q.filtered, { all: showAll, sex }) : null), [place, ready, prefs.km, range, q.filtered, showAll, sex])
  const key = req ? requestKey(req) : ''

  // Réponse du serveur : celle gardée en mémoire d'abord (retour immédiat), relue si elle est ancienne.
  const [res, setRes] = useState<{ key: string; r: AroundResult } | null>(() => {
    const hit = req ? cachedAround(req) : undefined
    return hit ? { key, r: hit } : null
  })
  // « Actualiser », « Réessayer » : relire même une réponse récente.
  const [retry, setRetry] = useState(0)
  const handled = useRef(0)
  useEffect(() => {
    if (!req) return
    // Aucun jeune dans la liste (ni club) : rien à demander.
    if (req.clubs && !req.clubs.length) return setRes({ key, r: { ok: true, fixtures: [], capped: false, at: Date.now() } })
    const force = retry !== handled.current
    handled.current = retry
    const hit = cachedAround(req)
    if (hit) setRes({ key, r: hit })
    if (hit && !force && Date.now() - hit.at < FRESH_MS) return
    let alive = true
    const t = window.setTimeout(() => void fetchAround(req).then((r) => alive && setRes({ key, r })), hit ? 0 : 250)
    return () => {
      alive = false
      window.clearTimeout(t)
    }
  }, [key, retry]) // eslint-disable-line react-hooks/exhaustive-deps
  const loading = !!req && res?.key !== key
  const fixtures = useMemo(() => (res?.r.ok ? res.r.fixtures : []), [res])

  // Jeunes de chaque rencontre.
  const index = useMemo(() => indexPlayers(q.filtered), [q.filtered])
  const matches = useMemo(() => matchPlayers(fixtures, index, cats), [fixtures, index, cats])
  const visible = useMemo(() => sortFixtures(showAll ? fixtures : fixtures.filter((f) => matches.has(f.id)), matches, 'date'), [fixtures, matches, showAll])
  const venues = useMemo(() => venuesOf(visible, matches), [visible, matches])
  const youths = useMemo(() => distinctYouths(matches, visible.map((f) => f.id)), [matches, visible])
  // Salle touchée sur la carte, fiche de rencontre ouverte : gardées avec l'entrée d'historique (retour d'une fiche de joueur).
  const [venue, setVenue] = useEntryState<string | null>('autour.salle', null)
  const [openId, setOpenId] = useEntryState<string | null>('autour.rencontre', null)
  const listed = venue && venues.some((v) => v.key === venue) ? visible.filter((f) => venueKeyOf(f) === venue) : visible
  const open = openId ? fixtures.find((f) => f.id === openId) : undefined
  // Événements déjà reliés aux rencontres (un par rencontre), bouton proposé et « qui y va ».
  const linked = useRencontreEvents()
  const rs = useRencontreState()
  const hidden = fixtures.length - fixtures.filter((f) => matches.has(f.id)).length

  const where = useFilterWindow()
  const actions = (
    <MoreActions
      title="Autour de moi"
      items={[
        !!req && { label: 'Actualiser les rencontres', icon: 'sync', onSelect: () => setRetry((n) => n + 1) },
        { label: showAll ? 'Seulement les rencontres avec des jeunes de la liste' : 'Voir aussi les rencontres sans jeune de la liste', icon: 'list', onSelect: () => setShowAll(!showAll) },
      ]}
    />
  )

  const err = res && res.key === key && !res.r.ok ? res.r.error : null
  return (
    <>
      <StickyQuery>
        <BarActions actions={actions} below={tabs}>
          {q.ui}
        </BarActions>
      </StickyQuery>
      <div className="flex flex-col gap-2 empty:hidden">{q.top}</div>

      {/* Où et Quand : sous la barre, à sa largeur. */}
      <div className="mx-auto flex w-full max-w-3xl flex-wrap items-center gap-1.5">
        <button
          ref={where.anchor}
          type="button"
          aria-haspopup="dialog"
          aria-expanded={where.open}
          onClick={() => where.setOpen(!where.open)}
          className={`flex min-h-9 max-w-full items-center gap-1.5 rounded-full border px-3 text-xs font-bold ${place ? 'border-accent bg-accent/10 text-fg' : 'border-line bg-panel-2 text-muted'}`}
        >
          <Icon name="map" className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">{place ? `${place.label} · ${prefs.km} km` : 'Où ? Choisir un lieu'}</span>
          <span aria-hidden>{where.open ? '▴' : '▾'}</span>
        </button>
        <div role="radiogroup" aria-label="Quand" className="flex flex-wrap gap-1.5">
          {PERIODS.map((p) => (
            <button key={p.value} type="button" role="radio" aria-checked={prefs.period === p.value} className={pillClass(prefs.period === p.value, true)} onClick={() => setPrefs({ ...prefs, period: p.value })}>
              {p.label}
            </button>
          ))}
        </div>
      </div>
      <WhereWindow w={where} prefs={prefs} setPrefs={setPrefs} place={place} mine={mine} count={visible.length} />

      <div className="mx-auto flex w-full max-w-3xl flex-col gap-3">
        {!place ? (
          <Empty>Choisis un lieu (Où) pour voir les rencontres autour.</Empty>
        ) : err ? (
          <Empty>
            {AROUND_ERRORS[err]}
            {err !== 'pas_ouvert' && (
              <button type="button" className="ml-1 font-bold text-accent underline" onClick={() => setRetry((n) => n + 1)}>
                Réessayer
              </button>
            )}
          </Empty>
        ) : (
          <>
            <RencontreMap center={place} km={prefs.km} venues={venues} picked={venue} onPick={setVenue} />
            <div className={`flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted ${loading ? 'opacity-60 transition-opacity' : ''}`} aria-live="polite" aria-busy={loading || undefined}>
              <span>
                {!ready
                  ? 'Chargement des joueurs…'
                  : !res && loading
                  ? 'Recherche des rencontres…'
                  : `${visible.length.toLocaleString('fr-FR')} rencontre${visible.length > 1 ? 's' : ''}${youths ? ` · ${youthsText(youths)} de la liste` : ''}`}
              </span>
              {venue && listed !== visible && (
                <button type="button" className="font-bold text-accent underline" onClick={() => setVenue(null)}>
                  Toutes les salles
                </button>
              )}
              {(showAll || hidden > 0) && (
                <button type="button" className="underline" onClick={() => setShowAll(!showAll)}>
                  {showAll ? 'Seulement avec des jeunes de la liste' : `Voir aussi les autres (${hidden})`}
                </button>
              )}
              {res?.r.ok && res.r.capped && <span>Les 500 premières : réduis le rayon ou la période pour tout voir.</span>}
            </div>
            {res && !loading && !visible.length ? (
              <Empty>
                {!q.filtered.length
                  ? 'Aucun jeune ne correspond aux filtres.'
                  : fixtures.length
                    ? 'Aucune rencontre avec des jeunes de la liste dans ce rayon, sur cette période.'
                    : 'Aucune rencontre prévue dans ce rayon, sur cette période.'}
                {!showAll && q.filtered.length > 0 && (
                  <button type="button" className="mt-2 block w-full font-bold text-accent underline" onClick={() => setShowAll(true)}>
                    Voir toutes les rencontres
                  </button>
                )}
              </Empty>
            ) : (
              <div className={`cols flex flex-col gap-2 ${loading ? 'opacity-60 transition-opacity' : ''}`}>
                {listed.map((f) => (
                  <FixtureCard key={f.id} f={f} m={matches.get(f.id)} ev={linked?.get(f.id)} rs={linked && rs} onOpen={() => setOpenId(f.id)} />
                ))}
              </div>
            )}
          </>
        )}
      </div>
      {open && <FixtureWindow f={open} m={matches.get(open.id) ?? []} ev={linked?.get(open.id)} rs={linked && rs} onClose={() => setOpenId(null)} />}
    </>
  )
}

/** Noms des jeunes d'une rencontre : ceux reliés par leur équipe d'abord, puis par nom. */
const ordered = (m: readonly FixtureMatch<Player>[]) => [...m].sort((a, b) => Number(b.byTeam) - Number(a.byTeam) || playerName(a.player).localeCompare(playerName(b.player), 'fr'))

/** Bouton proposé et « qui y va » (src/components/RencontreEvent.tsx) ; absent tant que les événements ne sont pas lus. */
type RencontreState = ReturnType<typeof useRencontreState>

function FixtureCard({ f, m = [], ev, rs, onOpen }: { f: Rencontre; m?: FixtureMatch<Player>[]; ev?: HBEvent; rs?: RencontreState; onOpen: () => void }) {
  const rows = ordered(m)
  const names = rows.map((x) => playerName(x.player))
  const place = [f.venue, f.city].filter(Boolean).join(', ')
  const action = rs ? rs.actionOf(ev) : null
  const going = rs ? rs.goingOf(ev) : ''
  return (
    <div className="card relative flex min-w-0 flex-col gap-0.5 p-3 hover:border-accent focus-within:border-accent">
      <div className="flex items-baseline justify-between gap-2">
        <button type="button" onClick={onOpen} className="min-w-0 truncate text-left text-xs font-bold outline-none after:absolute after:inset-0 after:content-['']">
          {fixtureWhen(f.startsAt)}
        </button>
        <span className="shrink-0 text-[11px] text-muted">{distanceText(f.distanceKm)}</span>
      </div>
      <div className="truncate text-[11px] text-muted">{fixtureHeading(f)}</div>
      <div className="text-sm font-extrabold break-words">{teamsLabel(f)}</div>
      {place && <div className="truncate text-[11px] text-muted">{place}</div>}
      <div className="mt-1 flex min-w-0 items-center gap-2">
        {m.length > 0 ? (
          <span className="min-w-0 flex-1 truncate text-[11px]">
            <b className="text-accent">{youthsText(m.length)}</b> · {namesLine(names)}
          </span>
        ) : (
          <span className="min-w-0 flex-1 text-[11px] text-muted">Aucun jeune de la liste</span>
        )}
        {f.liveUrl && (
          <a href={f.liveUrl} target="_blank" rel="noopener noreferrer" className="relative z-[1] flex min-h-8 shrink-0 items-center gap-1 rounded-full border border-line bg-panel-2 px-2.5 text-[11px] font-bold hover:border-accent">
            <Icon name="play" className="h-3 w-3" />
            Regarder
          </a>
        )}
      </div>
      {(going || (action && action !== 'ask')) && (
        <div className="mt-1 flex min-w-0 items-center justify-between gap-2">
          {going ? <StaffGoing text={going} /> : <span />}
          <RencontreEventButton f={f} ev={ev} action={action} playerIds={rows.map((x) => x.player.id)} compact />
        </div>
      )}
    </div>
  )
}

/** Fiche d'une rencontre : tout sur elle, ses jeunes (vers leur fiche), « Itinéraire ». */
function FixtureWindow({ f, m, ev, rs, onClose }: { f: Rencontre; m: FixtureMatch<Player>[]; ev?: HBEvent; rs?: RencontreState; onClose: () => void }) {
  const rows = ordered(m)
  const ids = rows.map((x) => x.player.id)
  const action = rs ? rs.actionOf(ev) : null
  const going = rs ? rs.goingOf(ev) : ''
  const pill = 'flex min-h-9 items-center gap-1.5 rounded-full border border-line bg-panel-2 px-3 text-xs font-bold hover:border-accent'
  return (
    <FormWindow title="Rencontre" onClose={onClose} guard={false}>
      <div className="flex flex-col gap-1">
        <div className="text-xs font-bold">{fixtureWhen(f.startsAt)}</div>
        <div className="text-[11px] text-muted">{fixtureHeading(f)}</div>
        <div className="text-base font-extrabold break-words">{teamsLabel(f)}</div>
        <div className="text-xs text-muted">
          {[f.venue, f.city].filter(Boolean).join(', ') || 'Salle non précisée'}
          {f.distanceKm !== undefined && ` · ${distanceText(f.distanceKm)}`}
        </div>
        {going && <StaffGoing text={going} className="mt-0.5 text-xs" />}
        {action === 'ask' && ev && (
          <p className="text-[11px] text-muted">Pour y aller aussi, demande à {askWho(ev)} de t’ajouter aux participants.</p>
        )}
      </div>
      {/* Itinéraire, agenda, diffusion : des liens ; le bouton principal (événement) est en bas. */}
      <div className="flex flex-wrap gap-1.5">
        <a href={itineraryUrl(f.lat, f.lng)} target="_blank" rel="noopener noreferrer" className={pill}>
          <Icon name="map" className="h-3.5 w-3.5" />
          Itinéraire
        </a>
        <button type="button" className={pill} onClick={() => rencontreToAgenda(f, ev, ids)}>
          <Icon name="calendar" className="h-3.5 w-3.5" />
          Ajouter à mon agenda
        </button>
        {f.liveUrl && (
          <a href={f.liveUrl} target="_blank" rel="noopener noreferrer" className={pill}>
            <Icon name="play" className="h-3.5 w-3.5" />
            Regarder
          </a>
        )}
      </div>
      <div className="section-title mb-0">
        {m.length ? `${youthsText(m.length)} de la liste ${m.length > 1 ? 'devraient' : 'devrait'} jouer` : 'Jeunes de la liste'}
      </div>
      {m.length ? (
        <>
          <p className="-mt-1 text-[10px] text-muted">D’après leur club, leur catégorie et leur équipe quand elle est connue.</p>
          <PlayerList ids={ids} select={false}>
            {rows.map((x) => (
              <PlayerRow
                key={x.player.id}
                p={x.player}
                link={{ to: `/joueurs/${x.player.id}` }}
                // Confirmé (étape 2) : marqué ; « devrait jouer » est dit une fois, au-dessus.
                badges={x.status === 'joue' && <span className="rounded bg-emerald-500/15 px-1 text-[10px] font-bold text-emerald-300">{STATUS_LABEL.joue}</span>}
                pre={[!!f[x.side].team && `Équipe ${f[x.side].team}`]}
              />
            ))}
          </PlayerList>
        </>
      ) : (
        <p className="text-xs text-muted">Aucun jeune de la liste dans cette rencontre.</p>
      )}
      <FormActions>
        <RencontreEventButton f={f} ev={ev} action={action} playerIds={ids} />
        <button type="button" className="btn-ghost px-4 text-xs" onClick={onClose}>
          Fermer
        </button>
      </FormActions>
    </FormWindow>
  )
}

/** Fenêtre « Où » : une ville, mon club, mon département, ma position (sur demande) ; le rayon. */
function WhereWindow({
  w,
  prefs,
  setPrefs,
  place,
  mine,
  count,
}: {
  w: ReturnType<typeof useFilterWindow>
  prefs: AroundPrefs
  setPrefs: (p: AroundPrefs) => void
  place?: Place
  mine: { club?: Place; dept?: Place }
  count: number
}) {
  const units = useUnits()
  const cities = useMemo(() => citiesOf(units, clubDepartment), [units])
  const [text, setText] = useState('')
  const [geoMsg, setGeoMsg] = useState('')
  const found = searchCities(cities, text)
  const choose = (p: Place) => {
    setPrefs({ ...prefs, place: p })
    setText('')
    setGeoMsg('')
  }
  const same = (p?: Place) => !!p && !!place && p.kind === place.kind && p.label === place.label
  const locate = () => {
    if (!('geolocation' in navigator)) return setGeoMsg('Position indisponible sur cet appareil : choisis une ville.')
    setGeoMsg('Recherche de ta position…')
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const r3 = (x: number) => Math.round(x * 1000) / 1000
        choose({ kind: 'pos', label: 'Ma position', lat: r3(pos.coords.latitude), lng: r3(pos.coords.longitude) })
      },
      (e) => setGeoMsg(e.code === e.PERMISSION_DENIED ? 'Position refusée : choisis une ville ou ton club.' : 'Position introuvable pour l’instant : choisis une ville.'),
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 10 * 60 * 1000 },
    )
  }
  return (
    <FilterWindow w={w} title="Où ?" count={`${count.toLocaleString('fr-FR')} rencontre${count > 1 ? 's' : ''}`}>
      <div>
        <label htmlFor={`${w.id}-ville`} className="label">
          Une ville
        </label>
        <input
          id={`${w.id}-ville`}
          className="field min-h-11 w-full"
          placeholder="Nom d’une ville où il y a des clubs"
          value={text}
          autoComplete="off"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && found[0]) choose({ kind: 'city', label: found[0].name, lat: found[0].lat, lng: found[0].lng })
          }}
        />
        {text.trim() && (
          <ul className="mt-1.5 flex flex-col gap-1">
            {found.map((c) => (
              <li key={c.key}>
                <button
                  type="button"
                  className="flex min-h-10 w-full items-center justify-between gap-2 rounded-md border border-line bg-panel-2 px-3 text-left text-xs hover:border-accent"
                  onClick={() => choose({ kind: 'city', label: c.name, lat: c.lat, lng: c.lng })}
                >
                  <span className="truncate font-bold">{c.name}</span>
                  <span className="shrink-0 text-[10px] text-muted">
                    {c.dept ? `${c.dept} · ` : ''}
                    {c.clubs} club{c.clubs > 1 ? 's' : ''}
                  </span>
                </button>
              </li>
            ))}
            {!found.length && <li className="text-[11px] text-muted">{cities.length ? 'Aucune ville de club ne correspond.' : 'Pas encore de clubs placés (structure à importer).'}</li>}
          </ul>
        )}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {mine.club && (
          <button type="button" className={pillClass(same(mine.club))} aria-pressed={same(mine.club)} onClick={() => choose(mine.club!)}>
            Mon club
          </button>
        )}
        {mine.dept && (
          <button type="button" className={pillClass(same(mine.dept))} aria-pressed={same(mine.dept)} onClick={() => choose(mine.dept!)}>
            Mon département
          </button>
        )}
        <button type="button" className={pillClass(place?.kind === 'pos')} aria-pressed={place?.kind === 'pos'} onClick={locate}>
          Ma position
        </button>
      </div>
      {geoMsg && <p className="text-[11px] text-muted" role="status">{geoMsg}</p>}
      {place && (
        <p className="text-[11px] text-muted">
          Autour de : <b className="text-fg">{place.label}</b>
        </p>
      )}
      <div>
        <span className="label">Rayon</span>
        <div role="radiogroup" aria-label="Rayon" className="flex flex-wrap gap-1.5">
          {RADII.map((km) => (
            <button key={km} type="button" role="radio" aria-checked={prefs.km === km} className={pillClass(prefs.km === km)} onClick={() => setPrefs({ ...prefs, km })}>
              {km} km
            </button>
          ))}
        </div>
      </div>
      <p className="text-[10px] text-muted">
        Ta position n’est demandée que si tu touches « Ma position » : arrondie (environ 100 m), elle est gardée sur cet appareil et sert seulement à chercher les rencontres.
      </p>
    </FilterWindow>
  )
}
