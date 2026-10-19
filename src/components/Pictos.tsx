import { useLiveQuery } from 'dexie-react-hooks'
import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { useHref, useNavigate } from 'react-router-dom'
import { db, poleStatus, poleSummary, type Evaluation, type Player, type PlayerGroup, type Rewatch, type Seen } from '../db'
import { regionLabel } from '../lists'
import {
  buildFacts,
  ficheOnTab,
  DEFAULT_PICTOS,
  isDefaultPictos,
  NO_FACTS,
  parsePictos,
  PICTO_KINDS,
  PICTO_LABELS,
  PICTOS_KEY,
  pictoLines,
  recentSince,
  serializePictos,
  togglePicto,
  type NameFit,
  type PictoFacts,
  type PictoKind,
} from '../pictos'
import { currentUserId, isParticipant } from '../roles'
import { scoutId, sightingNames, sightings, type Sighting } from '../scouting'
import { PLAYER_TABS, playerTabParam } from '../tabQuery'
import { accord, w } from '../gender'
import { FollowStar } from './Follow'
import { RewatchToggle } from './Scouting'
import { Icon, type IconName } from './ui'
import { SelectionBar, SelectionHeader, SelectionProvider, useListSelection, type SelContext } from './Selection'

/*
 * Pictogrammes au bout des lignes de joueurs (src/pictos.ts pour la partie pure) :
 * - PictoBar : barre « Afficher » au-dessus de chaque liste, 8 boutons (aria-pressed) ;
 * - PlayerList : la liste elle-même (barre + lignes) ; lit en lot ce que disent les pictogrammes (une requête par table
 *   pour toute la liste) et applique la règle de place : si un seul nom serait coupé à cause des pictogrammes, toute la
 *   liste les passe sur leur propre ligne sous le nom (mesure avant peinture, recalcul au redimensionnement) ;
 * - RowPictos : les pictogrammes d'une ligne (rendus par PlayerRow).
 * Un seul réglage pour toutes les listes, changé depuis n'importe laquelle et appliqué partout en direct.
 */

// ---------- Réglage (appareil) ----------

function read(): PictoKind[] {
  try {
    return parsePictos(localStorage.getItem(PICTOS_KEY))
  } catch {
    return [...DEFAULT_PICTOS]
  }
}
let current: PictoKind[] = read()
const subs = new Set<() => void>()
const emit = () => subs.forEach((f) => f())

export function setPictos(on: PictoKind[]) {
  current = on
  try {
    if (isDefaultPictos(on)) localStorage.removeItem(PICTOS_KEY)
    else localStorage.setItem(PICTOS_KEY, serializePictos(on))
  } catch {
    /* stockage indisponible : le choix vaut jusqu'à la fermeture */
  }
  emit()
}

function subscribe(f: () => void) {
  subs.add(f)
  // Autre onglet : même réglage.
  const onStorage = (e: StorageEvent) => {
    if (e.key !== PICTOS_KEY && e.key !== null) return
    current = read()
    emit()
  }
  if (subs.size === 1) window.addEventListener('storage', onStorage)
  return () => {
    subs.delete(f)
    if (!subs.size) window.removeEventListener('storage', onStorage)
  }
}

export const usePictos = () => useSyncExternalStore(subscribe, () => current)

// ---------- Barre « Afficher » ----------

export const PICTO_ICONS: Record<PictoKind, IconName> = {
  suivi: 'star',
  vu: 'eye',
  revoir: 'clock',
  videos: 'video',
  avis: 'chat',
  mesures: 'ruler',
  pole: 'building',
  groupes: 'users',
}

/**
 * `label` : ce qui précède les pictogrammes. Liste Joueurs : le nombre de joueurs (« 7 joueurs sur 39 988 »), toujours visible
 * puisque la barre reste collée en haut ; ailleurs, « Afficher ».
 */
export function PictoBar({ className = '', label }: { className?: string; label?: ReactNode }) {
  const on = usePictos()
  return (
    <div role="group" aria-label="Pictogrammes affichés au bout des lignes" className={`flex flex-wrap items-center gap-1 rounded-full border border-line bg-panel py-1 pr-1.5 pl-3 max-[420px]:gap-[3px] @max-[30rem]/plb:gap-[3px] ${className}`}>
      {label ? (
        <span className="mr-1 text-[11px] font-bold whitespace-nowrap text-muted" role="status">
          {label}
        </span>
      ) : (
        <span className="mr-0.5 text-[10px] font-bold tracking-wider text-muted uppercase">Afficher</span>
      )}
      {/* Pictogrammes calés à droite de la capsule (le nombre de joueurs à gauche). */}
      <span className="ml-auto flex flex-wrap justify-end gap-1 max-[420px]:gap-[3px] @max-[30rem]/plb:gap-[3px]">
      {PICTO_KINDS.map((k) => {
        const pressed = on.includes(k)
        return (
          <button
            key={k}
            type="button"
            aria-pressed={pressed}
            aria-label={PICTO_LABELS[k]}
            title={`${PICTO_LABELS[k]} : ${pressed ? 'affiché — toucher pour masquer' : 'masqué — toucher pour afficher'}`}
            onClick={() => setPictos(togglePicto(on, k))}
            className={`flex h-8 w-8 items-center justify-center rounded-full border transition max-[420px]:h-7 max-[420px]:w-7 @max-[30rem]/plb:h-7 @max-[30rem]/plb:w-7 ${
              pressed ? 'border-accent bg-accent text-white' : 'border-line bg-panel-2 text-muted hover:text-fg'
            }`}
          >
            <Icon name={PICTO_ICONS[k]} filled={pressed && (k === 'suivi')} className="h-4 w-4" />
          </button>
        )
      })}
      </span>
    </div>
  )
}

// ---------- Liste ----------

interface PictoData {
  on: readonly PictoKind[]
  /** Liens des pictogrammes : adresse complète (base de l'appli) et navigation, une seule fois pour toute la liste. */
  href: (to: string) => string
  go: (to: string, state?: unknown) => void
  /** Jour (AAAA-MM-JJ), lu une fois pour toute la liste (pôle en cours). */
  today: string
  facts: Map<string, PictoFacts>
  sight: Map<string, Sighting[]>
  rewatch: Map<string, Rewatch[]>
}
const PictoCtx = createContext<PictoData | null>(null)

/** Groupe « à moi » : créé par moi (ou sur cet appareil, sans serveur) ou dont je suis participant. */
const myGroup = (g: PlayerGroup) => (g.createdBy ? g.createdBy === currentUserId() || isParticipant(g) : !g.createdAtServer)

/** Au-delà, une table est lue en entier puis filtrée (plus rapide qu'une requête par identifiant). */
const ANY_OF_MAX = 200

function usePictoData(ids: readonly string[], on: readonly PictoKind[]): Pick<PictoData, 'facts' | 'sight' | 'rewatch'> {
  const key = ids.join(',')
  const need = (k: PictoKind) => on.includes(k)
  const want = PICTO_KINDS.filter(need).join(',')
  const data = useLiveQuery(
    async () => {
      const set = new Set(ids)
      const big = ids.length > ANY_OF_MAX
      const byPlayer = async <T extends { playerId: string }>(table: 'evaluations' | 'seen' | 'rewatch'): Promise<T[]> => {
        const t = db.table<T>(table)
        const rows = big ? await t.toArray() : await t.where('playerId').anyOf(ids as string[]).toArray()
        return big ? rows.filter((r) => set.has(r.playerId)) : rows
      }
      const since = recentSince(new Date().toLocaleDateString('sv'))
      const [evals, seen, rewatch, videos, measurements, groups] = await Promise.all([
        need('vu') || need('avis') ? byPlayer<Evaluation>('evaluations') : [],
        need('vu') ? byPlayer<Seen>('seen') : [],
        need('revoir') ? byPlayer<Rewatch>('rewatch') : [],
        need('videos') ? (big ? db.videos.toArray() : db.videos.where('targetId').anyOf(ids as string[]).toArray()) : [],
        // Mesures récentes : par date (index), quelle que soit la taille de la liste.
        need('mesures') ? db.measurements.where('date').aboveOrEqual(since).toArray() : [],
        need('groupes') ? db.groups.toArray() : [],
      ])
      const rw = new Map<string, Rewatch[]>()
      for (const r of rewatch) if (!r.deleted) rw.set(r.playerId, [...(rw.get(r.playerId) ?? []), r])
      return {
        facts: buildFacts(ids, { videos, evals, measurements, groups, since, isMine: myGroup }),
        sight: need('vu') ? sightings(seen, evals) : new Map<string, Sighting[]>(),
        rewatch: rw,
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key, want],
  )
  return data ?? EMPTY
}
const EMPTY = { facts: new Map<string, PictoFacts>(), sight: new Map<string, Sighting[]>(), rewatch: new Map<string, Rewatch[]>() }

/**
 * Liste de joueurs : barre « Afficher » (sauf `bar={false}`) et bouton « Sélectionner » (sélection multiple,
 * components/Selection.tsx ; sauf `select={false}`), puis les lignes (`children`, des PlayerRow, à n'importe quelle
 * profondeur). `ids` : joueurs affichés (données des pictogrammes lues pour eux seuls) ; `all` : toute la liste filtrée
 * quand elle est plus longue (« Afficher plus ») — c'est ce que coche « Tout » ; `context` : l'événement ou le groupe
 * de la liste (actions « vu », « à revoir » sur la sélection).
 */
export function PlayerList({
  ids,
  all = ids,
  countLabel,
  context,
  children,
  className = 'flex flex-col gap-2',
  bar = true,
  select = true,
  sticky = true,
}: {
  ids: readonly string[]
  all?: readonly string[]
  /** Nombre affiché dans la barre à la place de « Afficher » (liste Joueurs). */
  countLabel?: ReactNode
  context?: SelContext
  children: ReactNode
  className?: string
  bar?: boolean
  select?: boolean
  /** Barre collée en haut au défilement (faux : colonne de contexte, déjà collée). */
  sticky?: boolean
}) {
  const on = usePictos()
  // Sélection : la liste se remet en page quand les cases apparaissent (règle de place recalculée).
  const sel = useListSelection(all, ids, select)
  const data = usePictoData(ids, on)
  // Un lien de react-router par pictogramme coûte cher sur une longue liste : simples <a>, navigation commune.
  const navigate = useNavigate()
  const base = useHref('/').replace(/\/$/, '')
  const value = useMemo(
    () => ({ on, ...data, href: (to: string) => base + to, go: (to: string, state?: unknown) => navigate(to, { state }), today: new Date().toLocaleDateString('sv') }),
    [on, data, base, navigate],
  )
  const ref = useRef<HTMLDivElement>(null)
  const measure = useRef(() => {})
  measure.current = () => {
    const el = ref.current
    if (!el) return
    const names = [...el.querySelectorAll<HTMLElement>('[data-pn]')].filter((n) => n.closest('[data-plist]') === el)
    const two = el.dataset.pl === '2'
    // Calcul sur la mise en page en cours, sans la changer (pas de mise en page de plus, même sur une longue liste) :
    // pictogrammes de la ligne (même largeur sur une ligne ou sur la leur), place du nom et de ses pastilles (box).
    // Sur la ligne du nom : box sans eux = box + pictogrammes ; sur leur ligne : box avec eux = box - pictogrammes.
    // Téléphone étroit (≤ 400 px), où un nom long passe à la ligne : noms sur une ligne le temps de lire leur largeur.
    const narrow = matchMedia('(max-width: 400px)').matches
    if (narrow) el.dataset.pm = 'on'
    const fits: NameFit[] = names.map((n) => {
      const pics = n.closest('[data-ptop]')?.querySelector<HTMLElement>('[data-pics]')?.offsetWidth ?? 0
      const box = n.parentElement?.clientWidth ?? n.clientWidth
      const full = n.scrollWidth
      return two ? { full, on: Math.min(full, box - pics), off: box } : { full, on: Math.min(full, box), off: box + pics }
    })
    if (narrow) delete el.dataset.pm
    const lines = String(pictoLines(fits))
    if (el.dataset.pl !== lines) el.dataset.pl = lines
  }
  // À chaque rendu (lignes ajoutées, pictogrammes changés…), avant peinture : pas de saut visible.
  useLayoutEffect(() => measure.current())
  useEffect(() => {
    const el = ref.current
    if (!el) return
    let width = el.clientWidth
    const ro = new ResizeObserver(() => {
      if (el.clientWidth === width) return
      width = el.clientWidth
      measure.current()
    })
    ro.observe(el)
    void document.fonts?.ready.then(() => measure.current())
    return () => ro.disconnect()
  }, [])
  return (
    <PictoCtx.Provider value={value}>
      <SelectionProvider store={sel.store}>
        <div ref={ref} data-plist data-sel={sel.on ? '' : undefined} className={className}>
          {/* Barre « Afficher / Sélectionner » (et l'en-tête de la sélection) collée en haut pendant le défilement :
              sous l'en-tête de l'appli, ou en haut du panneau de droite (.md-panel, index.css) ; pas dans la colonne
              de contexte, qui a déjà son propre bandeau collé (sticky = false). */}
          {(bar || sel.on) && (
            <div className={sticky ? 'plist-sticky sticky top-[calc(var(--hdr)+var(--qbar,0px))] z-[15] -mx-1 flex flex-col gap-1 bg-bg/95 px-1 py-1 backdrop-blur' : 'flex flex-col gap-1'}>
              {/* Plus de bouton « Sélectionner » : la sélection s'ouvre par le menu d'une ligne (clic droit, appui long, ⋮). */}
              {bar && (
                // Conteneur (plb) : la barre se resserre selon la place de la liste (colonne de contexte comprise).
                <div className="@container/plb flex items-stretch gap-1">
                  <PictoBar className="min-w-0 flex-1" label={countLabel} />
                </div>
              )}
              {sel.on && <SelectionHeader store={sel.store} />}
            </div>
          )}
          {children}
          {sel.on && <SelectionBar store={sel.store} context={context} />}
        </div>
      </SelectionProvider>
    </PictoCtx.Provider>
  )
}

// ---------- Pictogrammes d'une ligne ----------

/** Case d'un pictogramme : même taille pour tous (icône 16 px, zone 28 × 32 px). */
export const PICTO_CELL = 'relative -my-2 inline-flex h-8 w-7 shrink-0 items-center justify-center'

const stop = (e: { preventDefault(): void; stopPropagation(): void }) => {
  e.preventDefault()
  e.stopPropagation()
}

/** Nombre posé sur le pictogramme (vidéos, avis). */
function Count({ n }: { n: number }) {
  if (!n) return null
  return (
    <span aria-hidden className="absolute -top-1 -right-1.5 flex h-3 min-w-3 items-center justify-center rounded-full bg-current px-0.5">
      <span className="text-[8px] leading-none font-extrabold text-bg">{n > 99 ? '99+' : n}</span>
    </span>
  )
}

/** Pictogramme d'information (pôle, groupes, vu hors événement) : le détail au survol, ou au toucher dans une bulle. */
function PictoInfo({ icon, label, cls, filled = false }: { icon: IconName; label: string; cls: string; filled?: boolean }) {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (!open) return
    const t = setTimeout(() => setOpen(false), 4000)
    return () => clearTimeout(t)
  }, [open])
  return (
    <button type="button" className={PICTO_CELL} title={label} aria-label={label} aria-expanded={open} onClick={(e) => (stop(e), setOpen(!open))} onBlur={() => setOpen(false)}>
      <Icon name={icon} filled={filled} className={`h-4 w-4 ${cls}`} />
      {open && (
        <span role="status" className="absolute top-full right-0 z-20 mt-1 w-max max-w-[16rem] rounded-md border border-line bg-panel px-2 py-1 text-left text-[11px] font-normal whitespace-normal text-fg shadow-lg">
          {label}
        </span>
      )}
    </button>
  )
}

/** Pictogramme qui ouvre la fiche sur un onglet (vidéos, avis, mesures). */
function PictoLink({ to, state, onClick, icon, label, cls, n = 0 }: { to: string; state?: unknown; onClick?: () => void; icon: IconName; label: string; cls: string; n?: number }) {
  const ctx = useContext(PictoCtx)!
  return (
    <a
      href={ctx.href(to)}
      onClick={(e) => {
        // Nouvel onglet (Ctrl, Maj, clic du milieu…) : comportement du navigateur.
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
        e.preventDefault()
        onClick?.()
        ctx.go(to, state)
      }}
      className={PICTO_CELL}
      title={label}
      aria-label={label}
    >
      <span className={`relative ${cls}`}>
        <Icon name={icon} className="h-4 w-4" />
        <Count n={n} />
      </span>
    </a>
  )
}

const OFF = 'text-muted/60 hover:text-fg'
/** 2026-09-15 → 15/09/2026 (sans Intl : appelé pour chaque ligne). */
const dmy = (d?: string) => (d ? d.split('-').reverse().join('/') : '')

/** Œil hors d'un événement : vu (ou noté) par moi, par d'autres, ou pas encore ; information seule. */
function SeenInfo({ list, sex }: { list: Sighting[]; sex?: string }) {
  const mine = list.some((s) => s.mine)
  const label = list.length ? `${accord('Vu', sex)} par ${sightingNames(list)}` : `Pas encore ${w(sex).vu}`
  return <PictoInfo icon="eye" filled={mine} label={label} cls={mine ? 'text-accent' : list.length ? 'text-accent/70' : OFF} />
}

export type RowFiche = { to: string; state?: unknown; onClick?: () => void }

/**
 * Pictogrammes d'une ligne, dans l'ordre de la barre. `seen`, `rewatch`, `follow` : ceux de la liste (œil d'un
 * événement, horloge d'un groupe…) à la place des communs ; `false` / `null` : rien à cet endroit. Hors d'une
 * PlayerList (ancienne liste), seulement ceux que la liste donne.
 */
export function RowPictos({ p, fiche, seen, rewatch, follow }: { p: Player; fiche: RowFiche; seen?: ReactNode; rewatch?: ReactNode; follow?: ReactNode }) {
  const ctx = useContext(PictoCtx)
  if (!ctx) return <>{[follow, seen, rewatch]}</>
  const f = ctx.facts.get(p.id) ?? NO_FACTS
  const key = playerTabParam(fiche.to.split('?')[0])
  const tab = (t: (typeof PLAYER_TABS)[number], hash = '') => ficheOnTab(fiche.to, t, key, 'profil', hash)
  const pole = poleStatus(p, ctx.today)
  const out: ReactNode[] = []
  for (const k of ctx.on) {
    switch (k) {
      case 'suivi':
        out.push(follow === undefined ? <FollowStar key={k} id={p.id} sex={p.sex} /> : follow ? <span key={k} className="contents">{follow}</span> : null)
        break
      case 'vu':
        out.push(seen === undefined ? scoutId() ? <SeenInfo key={k} list={ctx.sight.get(p.id) ?? []} sex={p.sex} /> : null : seen ? <span key={k} className="contents">{seen}</span> : null)
        break
      case 'revoir':
        out.push(rewatch === undefined ? <RewatchToggle key={k} playerId={p.id} rows={ctx.rewatch.get(p.id)} /> : rewatch ? <span key={k} className="contents">{rewatch}</span> : null)
        break
      case 'videos':
        out.push(
          <PictoLink key={k} to={tab('profil', '#videos')} state={fiche.state} onClick={fiche.onClick} icon="video" n={f.videos} cls={f.videos ? 'text-violet-300' : OFF}
            label={f.videos ? `${f.videos} vidéo${f.videos > 1 ? 's' : ''} — ouvrir la fiche` : 'Aucune vidéo — ouvrir la fiche pour en ajouter'} />,
        )
        break
      case 'avis':
        out.push(
          <PictoLink key={k} to={tab('avis')} state={fiche.state} onClick={fiche.onClick} icon="chat" n={f.avis} cls={f.avis ? 'text-emerald-300' : OFF}
            label={f.avis ? `${f.avis} avis — ouvrir les avis` : 'Aucun avis pour l’instant — ouvrir les avis'} />,
        )
        break
      case 'mesures':
        out.push(
          <PictoLink key={k} to={tab('tests')} state={fiche.state} onClick={fiche.onClick} icon="ruler" cls={f.recent ? 'text-amber-300' : OFF}
            label={f.recent ? `${f.recent} mesure${f.recent > 1 ? 's' : ''} ces 90 derniers jours (dernière le ${dmy(f.lastMeasure)}) — ouvrir les tests` : 'Pas de mesure ces 90 derniers jours — ouvrir les tests'} />,
        )
        break
      case 'pole':
        out.push(
          <PictoInfo key={k} icon="building" cls={pole === 'current' ? 'text-teal-300' : pole ? 'text-teal-300/60' : OFF}
            label={pole ? `${pole === 'current' ? 'Au Pôle Espoirs' : 'Passé par le Pôle Espoirs'} : ${poleSummary(p, regionLabel)}` : `Pas de pôle ni de structure renseigné`} />,
        )
        break
      case 'groupes':
        out.push(
          <PictoInfo key={k} icon="users" cls={f.groups.length ? 'text-sky-300' : OFF}
            label={f.groups.length ? `Dans ${f.groups.length > 1 ? 'tes groupes' : 'ton groupe'} : ${f.groups.slice(0, 5).join(', ')}${f.groups.length > 5 ? ` et ${f.groups.length - 5} autres` : ''}` : `Dans aucun de tes groupes`} />,
        )
        break
    }
  }
  return <>{out}</>
}
