import { Fragment, type ReactNode } from 'react'
import type { Player, Position } from '../db'
import { BarChip } from './Pictos'
import { courtTag } from './CourtPicker'
import { ROSTER_SORTS, type RosterSection, type RosterSort, rosterPositions } from '../positionOrder'

/*
 * Rangement par poste d'une liste de joueurs (page d'un événement, page d'un groupe, « Mes suivis ») : un encadré de réglages
 * (« Dans chaque poste, trier par »…), les pastilles des postes avec leur nombre, qui filtrent (dans la capsule des
 * pictogrammes, collée en haut : rosterBarLead), et la liste découpée par poste (titres GARDIEN, AILIER GAUCHE…, en colonnes sur grand écran). La logique (tri, découpage) est
 * dans src/positionOrder.ts ; la ligne de chaque joueur est fournie par la page (ses actions propres).
 */

/** Pastille de filtre (même style que les filtres rapides de l'événement). */
export function RosterChip({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full border px-2.5 py-1 text-[11px] font-bold ${on ? 'border-accent bg-accent text-white' : 'border-line bg-panel text-muted'}`}
    >
      {children}
    </button>
  )
}

/**
 * Pastilles des postes (ronds du terrain : « G », « ALG »… et leur nombre), qui filtrent : posées à gauche dans la capsule des pictogrammes (PlayerList
 * `barLead`). Rien quand la liste n'a qu'un poste (ou aucun) : la capsule reste comme ailleurs.
 */
export function rosterBarLead({ roster, pos, setPos }: { roster: Player[]; pos: Position | ''; setPos: (p: Position | '') => void }): ReactNode {
  const positions = rosterPositions(roster)
  if (positions.length <= 1) return undefined
  return positions.map((x) => (
    // Rond du terrain de la fiche (G, ALG, ARG…) pour tenir dans la capsule ; nom complet au survol et pour les lecteurs d'écran.
    <BarChip key={x.id} dot on={pos === x.id} n={x.n} label={`${x.label}, ${x.n}`} title={`${x.label} : ${pos === x.id ? 'toucher pour tout afficher' : 'afficher ce poste seulement'}`} onClick={() => setPos(pos === x.id ? '' : x.id)}>
      {courtTag(x.id)}
    </BarChip>
  ))
}

/**
 * Encadré de réglages, sur une ligne quand la place le permet. `top` : au-dessus (ex. regroupement par équipe d'un
 * tournoi) ; `showSort` : le sélecteur (masqué quand la liste est rangée par équipe) ; `chips` : pastilles à côté
 * (« Masquer ceux que j'ai notés ») ; `note` : aide en petit, à la suite. Les postes sont dans la capsule (rosterBarLead).
 */
export function RosterControls({
  sort,
  setSort,
  showSort = true,
  top,
  chips,
  note,
}: {
  sort: RosterSort
  setSort: (s: RosterSort) => void
  showSort?: boolean
  top?: ReactNode
  chips?: ReactNode
  note?: ReactNode
}) {
  if (!top && !showSort && !chips && !note) return null
  return (
    <div className="flex flex-col gap-1.5 rounded-lg border border-line bg-panel-2 px-2.5 py-1.5">
      {top}
      {(showSort || chips || note) && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {showSort && (
            <label className="flex min-w-0 items-center gap-2 text-xs">
              <span className="shrink-0 font-bold text-muted">Dans chaque poste, trier par</span>
              <select className="field min-w-0 py-0.5 text-xs" value={sort} onChange={(e) => setSort(e.target.value as RosterSort)}>
                {ROSTER_SORTS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          {chips}
          {note && <p className="text-[10px] text-muted">{note}</p>}
        </div>
      )}
    </div>
  )
}

/**
 * Liste découpée : un titre à chaque nouveau poste (ou équipe, avec `info` et « mon équipe »), un sous-titre de poste
 * dans une équipe ; sous chaque titre, les joueurs (en colonnes sur grand écran). `row(p, i)` : la ligne du joueur,
 * `i` son rang dans toute la liste (numérotation continue d'un poste à l'autre).
 */
export function RosterSectionList({
  sections,
  row,
  listClass = 'cols flex flex-col gap-2',
}: {
  sections: RosterSection[]
  row: (p: Player, i: number) => ReactNode
  /** Conteneur des joueurs d'un poste : en colonnes par défaut ; une seule (colonne étroite de « Mes suivis »). */
  listClass?: string
}) {
  return (
    <>
      {sections.map((sec) => (
        <Fragment key={sec.start}>
          {sec.heading && sec.team && (
            // Équipe d'un tournoi : bandeau plus gros, filet de couleur à gauche, pour bien séparer les équipes.
            <div className={`mt-4 flex flex-wrap items-baseline gap-x-2 rounded-md border-l-4 bg-panel-2 px-3 py-2 first:mt-1 ${sec.mine ? 'border-accent' : 'border-fg/40'}`}>
              <span className={`text-sm font-extrabold tracking-wide uppercase ${sec.mine ? 'text-accent' : ''}`}>
                {sec.heading}
                {sec.mine && <span className="ml-1.5 rounded bg-accent px-1 align-middle text-[9px] text-white normal-case">mon équipe</span>}
              </span>
              {sec.info && <span className="text-[11px] text-muted">{sec.info}</span>}
            </div>
          )}
          {sec.heading && !sec.team && (
            <div className={`section-title mt-2 mb-0 flex flex-wrap items-baseline gap-x-2 ${sec.mine ? 'text-accent' : ''}`}>
              <span>
                {sec.heading}
                {sec.mine && <span className="ml-1.5 rounded bg-accent px-1 align-middle text-[9px] text-white normal-case">mon équipe</span>}
              </span>
              {sec.info && <span className="text-[10px] font-normal text-muted normal-case">{sec.info}</span>}
            </div>
          )}
          {sec.sub && <div className="mt-1 text-[10px] font-bold tracking-wide text-muted uppercase">{sec.sub}</div>}
          <div className={listClass}>{sec.players.map((p, j) => row(p, sec.start + j))}</div>
        </Fragment>
      ))}
    </>
  )
}
