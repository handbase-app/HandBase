import { Fragment, type ReactNode } from 'react'
import type { Player } from '../db'
import type { RosterSection } from '../positionOrder'

/*
 * Rangement par poste d'une liste de joueurs (page d'un événement, page d'un groupe, « Mes suivis ») : la liste découpée
 * par poste (titres GARDIEN, AILIER GAUCHE…, en colonnes sur grand écran). Postes (filtre) et ordre dans chaque poste :
 * dans la fenêtre « Filtres » de la barre de la page (événement 31/10, groupe 02/11). La logique (tri, découpage) est
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
