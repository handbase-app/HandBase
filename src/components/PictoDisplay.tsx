import type { PictoKind } from '../pictos'
import { PICTO_KINDS, PICTO_LABELS, togglePicto } from '../pictos'
import { PICTO_ICONS, setPictos, usePictos } from './Pictos'
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
 * Section « Affichage » de la fenêtre « Filtres » : les 8 pictogrammes au bout des lignes, en pastilles à bascule (même
 * réglage que la barre : un seul pour toutes les listes, src/components/Pictos.tsx). Séparée des filtres par un trait.
 */
export function PictoDisplaySection() {
  const on = usePictos()
  return (
    <section className="flex flex-col gap-1.5 border-t border-line pt-3" aria-labelledby="affichage-titre" data-filter="affichage">
      <h3 id="affichage-titre" className="text-[11px] font-extrabold tracking-wider text-accent uppercase">
        Affichage
      </h3>
      <p className="text-[10px] text-muted">Pictogrammes au bout des lignes (toutes les listes de joueurs) : ne change pas qui est affiché.</p>
      <div role="group" aria-label="Pictogrammes affichés au bout des lignes" className="grid grid-cols-2 gap-1.5">
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
              className={`${pillClass(pressed, true)} flex min-w-0 items-center gap-1.5 text-left`}
            >
              <Icon name={PICTO_ICONS[k]} filled={pressed && k === 'suivi'} className="h-4 w-4 shrink-0" />
              <span className="truncate">{SHORT[k]}</span>
            </button>
          )
        })}
      </div>
    </section>
  )
}
