import type { PictoKind } from '../pictos'
import { PICTO_KINDS, PICTO_LABELS, togglePicto } from '../pictos'
import { useState, type ReactNode } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { setPictos, setSousNom, usePictos, useSousNom } from '../affichage'
import { db } from '../db'
import { SOUS_NOM_KINDS, SOUS_NOM_LABELS, toggleSousNom } from '../sousNom'
import { PICTO_ICONS } from './Pictos'
import { pillClass } from './FilterWindow'
import { Icon } from './ui'

/*
 * Téléphone (tenu droit, moins de 640 px de large, ou couché) : la barre des pictogrammes au-dessus des listes de joueurs
 * (PictoBar, src/components/Pictos.tsx) prend trop de hauteur. Sur la liste Joueurs (fenêtre « Filtres » de
 * src/components/PlayersQuery.tsx, option `display`), elle passe DANS cette fenêtre, en section « Affichage » à part : ce qu'on voit au bout des lignes, pas
 * qui est affiché (les filtres). Le nombre de joueurs de la barre va à côté du titre de la page. Ordinateur : la barre reste.
 * Ailleurs (listes sans fenêtre « Filtres » : événement, groupe, suivis, à revoir…) : la barre reste aussi.
 */

/** Libellés courts des pastilles de la section (le libellé complet est lu par les lecteurs d'écran et en bulle d'aide). */
const SHORT: Record<PictoKind, string> = {
  suivi: 'Suivi',
  vu: 'Vu',
  revoir: 'À revoir',
  videos: 'Vidéos',
  avis: 'Avis',
  mesures: 'Mesures récentes',
  pole: 'Pôle',
  groupes: 'Mes groupes',
}

/**
 * Partie repliable du bas de la fenêtre « Filtres » (« Affichage ») : repliée au départ, le titre
 * et un court résumé ; ouverte ou fermée, retenue sur l'appareil (03/11 : pas d'explication, la place va aux réglages).
 */
export function FilterFold({ id, title, summary, children }: { id: string; title: string; summary?: string; children: ReactNode }) {
  const key = `handbase.filtres.ouvert.${id}`
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem(key) === '1'
    } catch {
      return false
    }
  })
  const toggle = () => {
    setOpen(!open)
    try {
      localStorage.setItem(key, open ? '0' : '1')
    } catch {
      /* stockage indisponible : pour cette visite */
    }
  }
  return (
    <section className="flex flex-col gap-1.5 border-t border-line pt-1" data-filter={id}>
      <button type="button" onClick={toggle} aria-expanded={open} aria-controls={`${key}-corps`} className="-mx-1 flex min-h-11 items-center gap-2 rounded-lg px-1 text-left hover:bg-panel-2">
        <h3 className="text-[11px] font-extrabold tracking-wider text-accent uppercase">{title}</h3>
        {summary && <span className="min-w-0 flex-1 truncate text-[11px] text-muted">{summary}</span>}
        <span aria-hidden className={`ml-auto shrink-0 text-muted transition ${open ? 'rotate-90' : ''}`}>
          ›
        </span>
      </button>
      {open && (
        <div id={`${key}-corps`} className="flex flex-col gap-1.5 pb-1">
          {children}
        </div>
      )}
    </section>
  )
}

/**
 * Section « Affichage » de la fenêtre « Filtres » (toutes les listes de joueurs), repliable (FilterFold), en deux parties :
 * « Au bout des lignes » (les 8 pictogrammes, en ronds à bascule sans texte : le nom en bulle d'aide et pour les lecteurs
 * d'écran) et « Sous le nom » (ce que montre la ligne secondaire, src/sousNom.ts). Un seul réglage pour toutes les listes,
 * gardé sur l'appareil et sur le compte (src/affichage.ts). Envergure : seulement si l'installation a ce test (ou s'il est
 * déjà choisi).
 */
export function PictoDisplaySection() {
  const on = usePictos()
  const sub = useSousNom()
  const span = useLiveQuery(() => db.criteria.get('envergure').then((c) => !!c && !c.deleted), [])
  const kinds = SOUS_NOM_KINDS.filter((k) => k !== 'envergure' || span || sub.includes(k))
  const part = 'text-[10px] font-bold tracking-wide text-muted uppercase'
  const summary = [on.length && `${on.length} picto${on.length > 1 ? 's' : ''}`, sub.map((k) => SOUS_NOM_LABELS[k]).join(' · ')].filter(Boolean).join(' · ')
  return (
    <FilterFold id="affichage" title="Affichage" summary={summary}>
      <h4 id="affichage-bout" className={part}>Au bout des lignes</h4>
      <div role="group" aria-labelledby="affichage-bout" className="grid grid-cols-8 gap-1">
        {PICTO_KINDS.map((k) => {
          const pressed = on.includes(k)
          return (
            <button
              key={k}
              type="button"
              aria-pressed={pressed}
              aria-label={PICTO_LABELS[k]}
              title={`${SHORT[k]} : ${pressed ? 'affiché — toucher pour masquer' : 'masqué — toucher pour afficher'}`}
              onClick={() => setPictos((cur) => togglePicto(cur, k))}
              className={`${pillClass(pressed, true)} flex aspect-square w-full max-w-11 items-center justify-center justify-self-center !px-0`}
            >
              <Icon name={PICTO_ICONS[k]} filled={pressed && k === 'suivi'} className="h-5 w-5 shrink-0" />
            </button>
          )
        })}
      </div>
      <h4 id="affichage-sous" className={`${part} mt-1.5`}>Sous le nom</h4>
      <div role="group" aria-labelledby="affichage-sous" className="flex flex-wrap gap-1.5">
        {kinds.map((k) => {
          const pressed = sub.includes(k)
          return (
            <button
              key={k}
              type="button"
              aria-pressed={pressed}
              title={`${SOUS_NOM_LABELS[k]} : ${pressed ? 'affiché — toucher pour masquer' : 'masqué — toucher pour afficher'}`}
              onClick={() => setSousNom((cur) => toggleSousNom(cur, k))}
              className={pillClass(pressed, true)}
            >
              {SOUS_NOM_LABELS[k]}
            </button>
          )
        })}
      </div>
    </FilterFold>
  )
}
