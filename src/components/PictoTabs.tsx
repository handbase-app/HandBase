import { useLayoutEffect, useState } from 'react'
import { Icon, type IconName } from './ui'
import { usePanel } from './MasterDetail'

/** Un onglet : identifiant (celui de l'adresse, ?onglet=…), nom écrit, pictogramme. */
export interface PictoTab<T extends string> {
  id: T
  label: string
  icon: IconName
}

/**
 * Onglets à pictogrammes, collés sous l'en-tête de l'appli quand on fait défiler (fiche d'un joueur, src/pages/PlayerDetail.tsx ;
 * « Ma page » du jeune, src/pages/Me.tsx). Un pictogramme par onglet ; le nom écrit seulement dans l'onglet ouvert (pastille
 * teintée, comme la barre du bas), nom complet en title et pour les lecteurs d'écran (choix du 30/10 : six ou sept tiennent
 * sur 360 px). `counts` : nombre (avis, vidéos : petite pastille sur le pictogramme, à côté du nom dans l'onglet ouvert).
 * `dots` : petit point de couleur sur le pictogramme d'un onglet fermé, avec sa raison (lue par les lecteurs d'écran, en
 * info-bulle) : « Ma page », wellness du jour à remplir, brouillon pas encore enregistré. `hidden` : onglets absents.
 * `data-fiche-onglets` : repère des onglets collés (défilement vers un élément visé, sous les onglets).
 */
export function PictoTabs<T extends string>({
  tabs,
  tab,
  setTab,
  counts = {},
  dots = {},
  hidden = [],
}: {
  tabs: readonly PictoTab<T>[]
  tab: T
  setTab: (t: T) => void
  counts?: Partial<Record<T, number>>
  dots?: Partial<Record<T, string | false | null>>
  hidden?: readonly T[]
}) {
  // Hauteur réelle de l'en-tête (bandeau d'essai, encoche des iPhone…) ; dans le panneau de droite
  // (ordinateur), le panneau défile seul : les onglets se collent en haut du panneau.
  const inPanel = !!usePanel()
  const [top, setTop] = useState(50)
  // Remesurée quand l'écran tourne (en-tête plus compact sur téléphone couché).
  useLayoutEffect(() => {
    const measure = () => setTop(document.querySelector('header')?.getBoundingClientRect().height ?? 50)
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [])
  return (
    // Dans le panneau de droite (marge haute pt-3), les onglets collent au bord même du cadre : sinon une bande
    // de 0,75 rem laisse voir le contenu qui défile au-dessus d'eux.
    <div data-fiche-onglets className={`sticky z-10 -mx-4 border-b border-line px-4 ${inPanel ? 'bg-bg' : 'bg-bg/95 backdrop-blur'}`} style={{ top: inPanel ? '-0.75rem' : top }}>
      <div className="flex items-center gap-1 py-1.5">
        {tabs
          .filter((t) => !hidden.includes(t.id))
          .map((t) => {
            const on = tab === t.id
            const n = counts[t.id] ?? 0
            const dot = on ? null : dots[t.id] || null
            const name = `${t.label}${n ? ` (${n})` : ''}${dot ? ` (${dot})` : ''}`
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                aria-label={name}
                aria-current={on ? 'true' : undefined}
                title={dot ? `${t.label} : ${dot}` : t.label}
                data-onglet={t.id}
                className={`flex h-9 min-w-0 items-center justify-center gap-1.5 rounded-full text-xs font-bold transition ${on ? 'flex-none bg-accent/15 px-3 text-accent' : 'flex-1 text-muted hover:text-fg'}`}
              >
                <span className="relative shrink-0">
                  <Icon name={t.icon} className="h-[18px] w-[18px]" />
                  {!on && n > 0 && (
                    <span aria-hidden className="absolute -top-1.5 -right-2.5 min-w-4 rounded-full bg-line px-1 text-center text-[9px] leading-4 font-bold text-fg">
                      {n}
                    </span>
                  )}
                  {dot && <span aria-hidden data-testid="point-onglet" className="absolute -top-0.5 -right-1 h-2 w-2 rounded-full bg-accent ring-2 ring-bg" />}
                </span>
                {on && (
                  <span aria-hidden className="whitespace-nowrap">
                    {t.label}
                    {n > 0 && <span className="ml-1 text-[10px] opacity-70">{n}</span>}
                  </span>
                )}
              </button>
            )
          })}
      </div>
    </div>
  )
}
