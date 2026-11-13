import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { clubsFrame, knownClubs, type AnswerClub } from '../answerClubs'
import { dotRadius } from '../clubMap'
import type { Player } from '../db'
import { useUnits } from '../installation'
import { regionOfDept } from '../lists'
import { bilanPlaceSearch, fillAt, MapLegend, scaleOfNumbers, scaleOfValues } from '../pages/Coverage'
import { FranceMap, type MapDot } from './FranceMap'
import { department } from './PlayerFilter'

/*
 * Carte des clubs nommés dans une réponse de « Poser une question » (mode avancé, tableau par club de la recette) : un
 * point par club à son adresse (structure importée, src/answerClubs.ts), sur son département quand ils y sont tous, sinon
 * sur la région ou la France ; couleur et taille selon la valeur de la réponse (1re colonne chiffrée). Un toucher sur un
 * point (ou sur la ligne du club) ouvre le bilan sur ce club, dans son département ; le retour revient à la réponse.
 */

/** Clubs des joueurs de l'appareil et unités de la structure : de quoi retrouver et placer les clubs d'une réponse. */
export function useClubPlaces(players: Map<string, Player> | readonly Player[] | undefined) {
  const units = useUnits()
  const known = useMemo(
    () =>
      knownClubs(
        [...(players instanceof Map ? players.values() : (players ?? []))]
          .filter((p) => !p.deleted && !p.mergedInto && p.review !== 'refused')
          .map((p) => ({ club: p.club, clubCode: p.clubCode, dept: department(p) })),
      ),
    [players],
  )
  return { known, units, deptOf: (n: string) => department({ clubCode: n }) }
}

/** Ouvre le bilan sur un club d'une réponse (département de ses joueurs) ; sans département : rien. */
export function useOpenClub() {
  const nav = useNavigate()
  return (c: AnswerClub) => {
    if (!c.dept) return
    nav(`/bilan?${bilanPlaceSearch({ region: regionOfDept(c.dept) ?? '', dept: c.dept, club: c.key })}`, { state: { bilanChain: [] } })
  }
}

const NONE = 'var(--color-panel-2)'
const HAS = 'color-mix(in srgb, var(--color-accent) 22%, var(--color-panel-2))'

export function ClubAnswerMap({
  clubs,
  values,
  valueLabel,
  valueText,
  onOpen,
}: {
  /** Clubs retrouvés, dans l'ordre de la réponse (un par clé). */
  clubs: readonly AnswerClub[]
  /** Valeur de chaque club (clé) : couleur et taille des points. */
  values?: Map<string, number>
  /** Ce que dit la valeur (« nombre de joueurs »). */
  valueLabel?: string
  /** Valeur en clair (bulle). */
  valueText?: (key: string) => string
  onOpen: (c: AnswerClub) => void
}) {
  const [hot, setHot] = useState<string | null>(null)
  const placed = clubs.filter((c) => c.lat !== undefined && c.lng !== undefined)
  const frame = clubsFrame(placed, (d) => regionOfDept(d))
  const vals = placed.map((c) => values?.get(c.key)).filter((v): v is number => v !== undefined && Number.isFinite(v))
  const ints = vals.every((v) => Number.isInteger(v) && v >= 0)
  const sc = vals.length ? (ints ? scaleOfValues(vals, true) : scaleOfNumbers(vals, 2)) : null
  const max = Math.max(0, ...vals)
  const depts = new Set(clubs.map((c) => c.dept).filter(Boolean))
  if (!placed.length) return null
  const byId = new Map(placed.map((c) => [c.key, c]))
  const items = placed.map((c): MapDot => {
    const v = values?.get(c.key)
    return {
      id: c.key,
      lat: c.lat!,
      lng: c.lng!,
      r: v !== undefined && ints && max > 0 ? dotRadius(v, max, 6, 14) : 8,
      fill: sc && v !== undefined ? fillAt(v, sc) : 'var(--color-accent)',
      label: `${c.name}${valueText ? ` : ${valueText(c.key)}` : ''}`,
    }
  })
  const left = clubs.length - placed.length
  return (
    <section className="card flex flex-col gap-2 p-3" aria-label="Carte des clubs de la réponse">
      <FranceMap
        region={frame.region}
        selected={frame.dept}
        fill={(code) => (depts.has(code) ? HAS : NONE)}
        onRegion={() => {}}
        onDept={() => {}}
        tip={() => null}
        passive
        ariaLabel="Carte des clubs de la réponse"
        className="max-h-[60vh]"
        dots={{
          items,
          active: hot,
          onActive: setHot,
          onPick: (id) => {
            const c = byId.get(id)
            if (c) onOpen(c)
          },
          tip: (id) => {
            const c = byId.get(id)
            if (!c) return null
            const at = [c.number && `N° ${c.number}`, c.city].filter(Boolean).join(' · ')
            return (
              <>
                <div className="font-bold">{c.name}</div>
                {at && <div className="text-[10px] text-muted">{at}</div>}
                {valueText && <div className="mt-1">{valueText(c.key)}</div>}
                {c.dept && <div className="mt-1 text-[10px] text-muted">Toucher pour ouvrir le club dans le bilan</div>}
              </>
            )
          },
        }}
      />
      {sc && vals.length > 1 && <MapLegend sc={sc} title={valueLabel ? `Couleur : ${valueLabel}` : undefined} note="du plus petit au plus grand" />}
      <p className="text-[10px] text-muted">
        Un point par club, à son adresse{ints && vals.length > 1 ? ' (taille : la valeur)' : ''}. Toucher un point ou une ligne pour ouvrir le club dans le bilan.
        {left > 0 && ` ${left} club${left > 1 ? 's' : ''} sans position connue : seulement dans le tableau.`}
      </p>
    </section>
  )
}
