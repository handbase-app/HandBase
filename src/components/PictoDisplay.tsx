import type { PictoKind } from '../pictos'
import { PICTO_KINDS, PICTO_LABELS, togglePicto } from '../pictos'
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
 * Section « Affichage » de la fenêtre « Filtres » (toutes les listes de joueurs), séparée des filtres par un trait, en deux
 * parties : « Au bout des lignes » (les 8 pictogrammes) et « Sous le nom » (ce que montre la ligne secondaire,
 * src/sousNom.ts), en pastilles à bascule. Un seul réglage pour toutes les listes, gardé sur l'appareil et sur le compte
 * (src/affichage.ts). Envergure : seulement si l'installation a ce test (ou s'il est déjà choisi).
 */
export function PictoDisplaySection() {
  const on = usePictos()
  const sub = useSousNom()
  const span = useLiveQuery(() => db.criteria.get('envergure').then((c) => !!c && !c.deleted), [])
  const kinds = SOUS_NOM_KINDS.filter((k) => k !== 'envergure' || span || sub.includes(k))
  const part = 'text-[10px] font-bold tracking-wide text-muted uppercase'
  return (
    <section className="flex flex-col gap-1.5 border-t border-line pt-3" aria-labelledby="affichage-titre" data-filter="affichage">
      <h3 id="affichage-titre" className="text-[11px] font-extrabold tracking-wider text-accent uppercase">
        Affichage
      </h3>
      <p className="text-[10px] text-muted">Toutes les listes de joueurs : ne change pas qui est affiché.</p>
      <h4 id="affichage-bout" className={part}>Au bout des lignes</h4>
      <div role="group" aria-labelledby="affichage-bout" className="grid grid-cols-2 gap-1.5">
        {PICTO_KINDS.map((k) => {
          const pressed = on.includes(k)
          return (
            <button
              key={k}
              type="button"
              aria-pressed={pressed}
              aria-label={PICTO_LABELS[k]}
              title={`${PICTO_LABELS[k]} : ${pressed ? 'affiché — toucher pour masquer' : 'masqué — toucher pour afficher'}`}
              onClick={() => setPictos((cur) => togglePicto(cur, k))}
              className={`${pillClass(pressed, true)} flex min-w-0 items-center gap-1.5 text-left`}
            >
              <Icon name={PICTO_ICONS[k]} filled={pressed && k === 'suivi'} className="h-4 w-4 shrink-0" />
              <span className="truncate">{SHORT[k]}</span>
            </button>
          )
        })}
      </div>
      <h4 id="affichage-sous" className={`${part} mt-1.5`}>Sous le nom</h4>
      <p className="text-[10px] text-muted">Ce que chaque ligne montre sous le nom, dans toutes les listes. 3 ou 4 suffisent : la ligne est coupée au bout.</p>
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
    </section>
  )
}
