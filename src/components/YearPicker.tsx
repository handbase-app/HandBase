import { useRef, useState } from 'react'
import { toggleYear, yearsShort } from '../birthYears'
import { ChoiceSheet } from './MultiPicker'

/*
 * Choix d'une ou plusieurs années de naissance (page Joueurs, Événements, bilan de détection, questions enregistrées).
 * Un bouton résume le choix (« Toutes les années », « 2011 », « 2010 – 2012 », « 2010, 2012, 2014 », « 5 années ») et
 * ouvre une liste de cases à cocher (année, effectif entre parenthèses), « Toutes les années » en tête (tout décoche).
 * - téléphone (moins de 640 px de large) : feuille qui monte du bas, cases de 44 px, bouton « OK » ;
 * - ordinateur : menu déroulant sous le bouton.
 * Chaque case change le choix tout de suite ; « OK », Échap ou un toucher à côté ferme. Clavier : Tab ou flèches d'une
 * case à l'autre, Espace coche, Début / Fin ; de vraies cases à cocher avec leur libellé (lecteurs d'écran).
 * Même allure que le menu des lignes (src/components/ItemMenu.tsx) ; couleurs des styles d'installation (src/uiStyle.ts).
 * La liste de cases est commune aux autres choix multiples (src/components/MultiPicker.tsx, ChoiceSheet).
 */

export type YearOption = {
  /** Année (texte, « 2011 ») ; '' : année inconnue. */
  value: string
  /** Libellé (sinon l'année, ou « Année inconnue »). */
  label?: string
  /** Effectif montré entre parenthèses. */
  count?: number
}

export function YearPicker({
  value,
  options,
  onChange,
  label = 'Année de naissance',
  allLabel = 'Toutes les années',
  allCount,
  unknownLabel = 'Année inconnue',
  className = '',
}: {
  /** Années cochées (vide : toutes). */
  value: readonly string[]
  options: readonly YearOption[]
  onChange: (years: string[]) => void
  /** Nom du choix (lecteurs d'écran, en-tête de la feuille). */
  label?: string
  allLabel?: string
  /** Effectif de « Toutes les années ». */
  allCount?: number
  unknownLabel?: string
  /** Classes du bouton (largeur, hauteur, taille du texte). */
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const button = useRef<HTMLButtonElement>(null)
  // Une année choisie qui n'est plus proposée (autres filtres) reste visible pour pouvoir la décocher.
  const shown: YearOption[] = [...options, ...value.filter((y) => !options.some((o) => o.value === y)).map((y) => ({ value: y, count: 0 }))]
  const text = yearsShort(value, { all: allLabel, unknown: unknownLabel })
  return (
    <>
      <button
        ref={button}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`${label} : ${text}`}
        title={value.length > 1 ? value.map((y) => y || unknownLabel).join(', ') : undefined}
        onClick={() => setOpen((o) => !o)}
        className={`field flex items-center justify-between gap-1 text-left ${value.length ? 'border-accent font-bold' : ''} ${className}`}
      >
        <span className="min-w-0 truncate">{text}</span>
        <svg viewBox="0 0 12 12" className="h-3 w-3 shrink-0 opacity-70" aria-hidden>
          <path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && button.current && (
        <ChoiceSheet
          anchor={button.current}
          label={label}
          allLabel={allLabel}
          allCount={allCount}
          value={value}
          options={shown.map((o) => ({ value: o.value, label: o.label ?? (o.value || unknownLabel), count: o.count }))}
          picked={value.length > 1 ? `${value.length} années cochées` : value.length === 1 ? '1 année cochée' : 'toutes les années'}
          groupLabel="Années"
          onToggle={(y) => onChange(toggleYear(value, y))}
          onAll={() => onChange([])}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  )
}
