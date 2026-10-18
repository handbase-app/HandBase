import { Fragment, type ReactNode } from 'react'
import type { Player, Position } from '../db'
import { ROSTER_SORTS, type RosterSection, type RosterSort, rosterPositions } from '../positionOrder'

/*
 * Rangement par poste d'une liste de joueurs (page d'un événement, page d'un groupe, « Mes suivis ») : un encadré de réglages
 * (« Dans chaque poste, trier par », pastilles des postes avec leur nombre, qui filtrent) et la liste découpée
 * par poste (titres GARDIEN, AILIER GAUCHE…, en colonnes sur grand écran). La logique (tri, découpage) est
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
 * Encadré de réglages. `top` : au-dessus (ex. regroupement par équipe d'un tournoi) ; `showSort` : le sélecteur
 * (masqué quand la liste est rangée par équipe) ; `chips` : pastilles avant celles des postes ; `note` : ligne d'aide.
 */
export function RosterControls({
  roster,
  sort,
  setSort,
  pos,
  setPos,
  showSort = true,
  top,
  chips,
  note,
}: {
  roster: Player[]
  sort: RosterSort
  setSort: (s: RosterSort) => void
  pos: Position | ''
  setPos: (p: Position | '') => void
  showSort?: boolean
  top?: ReactNode
  chips?: ReactNode
  note?: ReactNode
}) {
  const positions = rosterPositions(roster)
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-line bg-panel-2 p-2.5">
      {top}
      {showSort && (
        <label className="flex items-center gap-2 text-xs">
          <span className="shrink-0 font-bold text-muted">Dans chaque poste, trier par</span>
          <select className="field flex-1 py-1 text-xs" value={sort} onChange={(e) => setSort(e.target.value as RosterSort)}>
            {ROSTER_SORTS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="flex flex-wrap gap-1">
        {chips}
        {positions.length > 1 &&
          positions.map((x) => (
            <RosterChip key={x.id} on={pos === x.id} onClick={() => setPos(pos === x.id ? '' : x.id)}>
              {x.short} ({x.n})
            </RosterChip>
          ))}
      </div>
      {note && <p className="text-[10px] text-muted">{note}</p>}
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
          {sec.heading && (
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
