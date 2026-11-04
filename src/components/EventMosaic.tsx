import { useState } from 'react'
import { Link } from 'react-router-dom'
import { eventPlayerSummary, fmtAvg, fmtPlayingTime } from '../avisMatch'
import { courtTag } from '../courtSpots'
import type { Evaluation, HBEvent, Player } from '../db'
import { POSITIONS } from '../db'
import { w } from '../gender'
import { hueText, positionHue } from '../positionColors'
import { rememberScroll } from './ContextRoster'
import { SuperPower } from './Opinions'
import { RowAvatar } from './PlayerRow'
import { Icon, SEG_BOX, segItem } from './ui'

/*
 * Vue Mosaïque de la page d'un événement (04/11, idée reprise de « Génération Bleue », la FFR) : tous les joueurs de la
 * liste affichée sur un seul écran, en vignettes (2 colonnes sur téléphone, 3 ou 4 sur tablette et ordinateur, selon la
 * place). Chaque vignette : photo ou initiales à la couleur du poste, nom, poste, et le résumé de ses avis SUR CET
 * ÉVÉNEMENT (src/avisMatch.ts) : nombre d'avis, note (même calcul que le classement), temps de jeu, super-pouvoirs.
 * Même logique qu'une ligne de la liste : la photo ouvre la fiche dans l'événement, le reste de la vignette la notation.
 * Libellés positifs ou neutres seulement, aucun classement. Bascule Liste / Mosaïque : ViewSwitch, sur la ligne de
 * chiffres sous la barre (une seule barre par liste) ; choix retenu sur l'appareil.
 */

export type EventView = 'liste' | 'mosaique'
const VIEW_KEY = 'handbase.evenement.vue'

function readView(): EventView {
  try {
    return localStorage.getItem(VIEW_KEY) === 'mosaique' ? 'mosaique' : 'liste'
  } catch {
    return 'liste'
  }
}

/** Liste ou Mosaïque, retenu sur l'appareil (le même pour tous les événements). */
export function useEventView(): [EventView, (v: EventView) => void] {
  const [view, setView] = useState<EventView>(readView)
  return [
    view,
    (v) => {
      setView(v)
      try {
        localStorage.setItem(VIEW_KEY, v)
      } catch {
        /* stockage indisponible : choix gardé jusqu'à la fermeture */
      }
    },
  ]
}

/** Petite bascule Liste / Mosaïque (deux pictogrammes, cibles de 40 px), au bout de la ligne de chiffres. */
export function ViewSwitch({ value, onChange }: { value: EventView; onChange: (v: EventView) => void }) {
  const opts: { v: EventView; icon: 'rows' | 'grid'; label: string }[] = [
    { v: 'liste', icon: 'rows', label: 'Liste' },
    { v: 'mosaique', icon: 'grid', label: 'Mosaïque' },
  ]
  return (
    <div role="group" aria-label="Affichage des joueurs" className={`${SEG_BOX} -my-1.5 shrink-0`} data-testid="vue-evenement">
      {opts.map((o) => (
        <button
          key={o.v}
          type="button"
          aria-pressed={value === o.v}
          aria-label={o.label}
          title={o.label}
          className={`${segItem(value === o.v)} flex h-9 w-10 items-center justify-center pointer-coarse:h-10`}
          onClick={() => onChange(o.v)}
        >
          <Icon name={o.icon} className="h-4 w-4" />
        </button>
      ))}
    </div>
  )
}

/** Vignettes des joueurs affichés (même ordre que la liste : par poste, puis par nom). */
export function EventMosaic({
  ev,
  players,
  evals,
  number,
  notedByMe,
}: {
  ev: HBEvent
  players: Player[]
  /** Avis de l'événement (tous joueurs ; supprimés déjà retirés). */
  evals: Evaluation[]
  /** Numéro de maillot (événement réparti en équipes), sinon rien. */
  number?: (p: Player) => string | undefined
  notedByMe: Set<string>
}) {
  return (
    <div className="@container">
      <ul className="grid grid-cols-2 gap-2 @lg:grid-cols-3 @3xl:grid-cols-4" data-testid="mosaique-evenement">
        {players.map((p) => (
          <Tile key={p.id} ev={ev} p={p} evals={evals} num={number?.(p)} mine={notedByMe.has(p.id)} />
        ))}
      </ul>
    </div>
  )
}

function Tile({ ev, p, evals, num, mine }: { ev: HBEvent; p: Player; evals: Evaluation[]; num?: string; mine: boolean }) {
  const s = eventPlayerSummary(evals, p.id)
  const hue = positionHue(p.position)
  const pos = p.position ? (POSITIONS.find((x) => x.id === p.position)?.label ?? p.position) : ''
  const keep = () => rememberScroll(`evenement.${ev.id}`)
  return (
    <li data-avis-row={p.id} className="card relative flex min-w-0 flex-col items-center gap-1 px-2 pt-3 pb-2.5 text-center transition hover:border-accent/50 has-[a:focus-visible]:border-accent">
      {/* La photo ouvre la fiche dans l'événement (comme sur une ligne) ; au-dessus du lien de la vignette. */}
      <Link
        to={`/evenements/${ev.id}/joueurs/${p.id}`}
        state={{ md: true }}
        onClick={keep}
        title="Voir la fiche"
        aria-label={`Fiche de ${p.firstName} ${p.lastName}`}
        className="relative z-[1] rounded-full hover:ring-2 hover:ring-accent/60"
      >
        <RowAvatar p={p} size={56} />
      </Link>
      {/* Le nom : lien vers la notation ; son ::after couvre toute la vignette. */}
      <Link
        to={`/evaluer?evenement=${ev.id}&joueur=${p.id}`}
        onClick={keep}
        className="w-full min-w-0 text-sm leading-tight font-bold outline-none after:absolute after:inset-0 after:rounded-xl after:content-['']"
      >
        <span className="block truncate">{(p.lastName ?? '').toUpperCase()}</span>
        <span className="block truncate font-semibold">{p.firstName}</span>
      </Link>
      <span className="flex items-center gap-1.5 text-[11px] font-bold">
        {p.position && (
          <span className={`inline-flex items-center gap-1 ${hue ? '' : 'text-muted'}`} style={hueText(hue)} title={pos}>
            <span aria-hidden className="inline-block h-1.5 w-1.5 rounded-full bg-current" />
            {courtTag(p.position)}
            <span className="sr-only"> ({pos})</span>
          </span>
        )}
        {num && <span className="text-muted">n° {num}</span>}
      </span>
      {/* Résumé de ses avis ici : rien d'autre qu'un compte, une note et ce qui a été vu de bien. */}
      <div className="flex w-full min-w-0 flex-col items-center gap-0.5 text-[11px] text-muted">
        {s.n > 0 ? (
          <span>
            <b className="text-fg">{s.n}</b> avis
            {s.avg !== null && (
              <>
                {' · '}
                <span title={`Note : moyenne de ${s.observers} évaluateur${s.observers > 1 ? 's' : ''}`}>
                  note <b className="text-fg tabular-nums">{fmtAvg(s.avg)}</b>
                </span>
              </>
            )}
          </span>
        ) : (
          <span>Pas encore d’avis</span>
        )}
        {s.playingTime !== null && (
          <span>
            <Icon name="clock" className="mr-0.5 inline h-3 w-3 -translate-y-px" />
            <b className="text-fg">{fmtPlayingTime(s.playingTime)}</b> de jeu
          </span>
        )}
        {mine && <span className="text-[10px] font-bold text-emerald-300">✓ {w(p.sex).note} par moi</span>}
      </div>
      {s.superPowers.length > 0 && (
        <div className="flex w-full min-w-0 flex-col gap-0.5 text-[11px]">
          {s.superPowers.slice(0, 2).map((sp) => (
            <SuperPower key={sp} text={sp} className="line-clamp-2" />
          ))}
          {s.superPowers.length > 2 && <span className="text-[10px] text-muted">+ {s.superPowers.length - 2} autre{s.superPowers.length > 3 ? 's' : ''}</span>}
        </div>
      )}
    </li>
  )
}
