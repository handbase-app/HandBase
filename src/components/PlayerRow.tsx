import type { ReactNode, SyntheticEvent } from 'react'
import { Link } from 'react-router-dom'
import type { Player } from '../db'
import { MENU_ROW, MenuButton, useRowMenu } from './ItemMenu'
import { selectedCls } from './MasterDetail'
import { PlayerMenu, type MenuExtra } from './PlayerMenu'
import { RowPictos } from './Pictos'
import { Avatar, poleEdge, PosBadges, QuarterBadge } from './ui'

/*
 * Ligne de joueur commune à toutes les listes (joueurs, événement, groupe, « À revoir », bilan, suivis, alertes…) :
 * même photo, même nom, mêmes pastilles, même ligne secondaire, mêmes icônes au bout, dans le même ordre.
 * - photo : 44 px (ligne pleine), 34 px (colonne de contexte, fiche ouverte à droite) ;
 * - nom : NOM Prénom en gras, jamais coupé avant les pastilles si on peut l'éviter (les pastilles passent à la ligne) ;
 * - pastilles : Pôle, poste, postes secondaires, trimestre (Q1…Q4), puis celles propres à la liste ;
 * - ligne secondaire : (numéro, équipe ·) année · club, 11 px (12 px sous 400 px, 10 px en compact), grise ;
 * - pictogrammes sur la ligne du nom (components/Pictos.tsx : ceux choisis dans la barre « Afficher » de la liste,
 *   un seul réglage pour toutes les listes), puis « ⋮ » ; la ligne secondaire prend toute la largeur dessous. Si un
 *   nom de la liste serait coupé à cause d'eux, toute la liste les passe sur leur propre ligne sous le nom ;
 *   puis les actions de la liste ;
 * - menu de la ligne (PlayerMenu) : appui long sur téléphone, clic droit sur ordinateur, touche « menu » ou Maj+F10,
 *   ou « ⋮ » (ligne pleine ; en colonne de contexte, faute de place, seulement les gestes). Un toucher ou un clic
 *   normal garde son effet (fiche, évaluation) ; après un appui long, le clic du relâchement est ignoré.
 * La photo ouvre la fiche du joueur (dans son contexte quand il y en a un : événement, groupe). Toute la carte est
 * cliquable : le lien (sur le nom) la couvre entièrement, pictogrammes, photo à part et boutons des lignes en plus au-dessus.
 * Uniquement des marques positives ou neutres sur les jeunes joueurs.
 */

/** Taille de la photo : ligne pleine, colonne de contexte. */
export const ROW_AVATAR = 44
export const COMPACT_AVATAR = 34

/** « 2011 · HBC Rhône Sud », précédé de ce que la liste ajoute (numéro, équipe…). */
export function playerSub(p: Pick<Player, 'birthDate' | 'club'>, ...before: (string | false | null | undefined)[]) {
  return [...before, p.birthDate?.slice(0, 4), p.club].filter(Boolean).join(' · ')
}

/**
 * NOM Prénom (gras) puis les pastilles, qui passent à la ligne plutôt que de couper le nom. Téléphone étroit (< 400 px) :
 * le nom n'est jamais coupé, il passe à la ligne s'il le faut.
 */
export function PlayerNameLine({
  p,
  compact = false,
  quarter = true,
  badges,
}: {
  p: Player
  compact?: boolean
  quarter?: boolean
  /** Pastilles propres à la liste, après les pastilles communes. */
  badges?: ReactNode
}) {
  return (
    <span className={`flex min-w-0 flex-wrap items-center gap-y-0.5 font-bold ${compact ? 'gap-x-1.5 text-xs' : 'gap-x-2 text-sm'}`}>
      <span data-pn className="max-w-full truncate max-[400px]:break-words max-[400px]:whitespace-normal">
        {p.lastName.toUpperCase()} {p.firstName}
      </span>
      <span className="flex max-w-full flex-wrap items-center gap-1 whitespace-nowrap empty:hidden">
        <PosBadges p={p} />
        {quarter && <QuarterBadge birthDate={p.birthDate} />}
        {badges}
      </span>
    </span>
  )
}

/** Où mène la photo (ou toute la ligne) : adresse, état d'historique, geste avant d'y aller. */
export type RowLink = { to: string; state?: unknown; onClick?: () => void; replace?: boolean }

type RowProps = {
  p: Player
  /** Toute la ligne (photo comprise) : un lien, ou un bouton ; sinon rien. */
  link?: RowLink
  onClick?: () => void
  /** Photo vers une autre page que la ligne (fiche dans l'événement quand la ligne mène à l'évaluation). */
  avatarLink?: RowLink
  /** Attributs du lien ou du bouton de la ligne (data-md, data-player, aria-current…). */
  linkProps?: Record<string, string | boolean | undefined>
  /** Avant la photo : case « comparer », numéro… */
  lead?: ReactNode
  /** Pastilles propres à la liste (après poste et trimestre). */
  badges?: ReactNode
  quarter?: boolean
  /** Ligne secondaire ; par défaut année · club. */
  sub?: ReactNode
  /** Lignes en plus sous la ligne secondaire (dans le lien). */
  lines?: ReactNode
  /** Entre le texte et les icônes : nombre d'avis, « revu ✓ »… */
  aside?: ReactNode
  /**
   * Pictogrammes propres à la liste à la place des communs (œil d'un événement, horloge d'un groupe…) ; `false` ou
   * `null` : rien à cet endroit ; absent : le pictogramme commun (components/Pictos.tsx).
   */
  seen?: ReactNode
  rewatch?: ReactNode
  follow?: ReactNode
  /** Sans aucun pictogramme (mode « retirer »…). */
  pictos?: boolean
  /** Actions propres à la liste, après les icônes (retirer, ajouter à un événement…). */
  actions?: ReactNode
  /** Sous la ligne, hors du lien (origines, liens vers d'autres pages…). */
  below?: ReactNode
  selected?: boolean
  className?: string
  /** Attributs de la carte (data-row…). */
  cardProps?: Record<string, string | undefined>
  /** Actions propres à la liste dans le menu de la ligne (« Retirer de cet événement »…). */
  menuExtras?: MenuExtra[]
}

/** Ligne pleine (photo 44 px). */
export function PlayerRow(props: RowProps) {
  return <Row {...props} compact={false} />
}

/** Ligne de la colonne de contexte (photo 34 px, texte plus petit), fiche ouverte à droite. */
export function CompactPlayerRow(props: RowProps) {
  return <Row {...props} compact />
}

function Row({
  p,
  link,
  onClick,
  avatarLink,
  linkProps,
  lead,
  badges,
  quarter,
  sub,
  lines,
  aside,
  seen,
  rewatch,
  follow,
  pictos = true,
  actions,
  below,
  selected = false,
  className = '',
  cardProps,
  menuExtras,
  compact,
}: RowProps & { compact: boolean }) {
  const menu = useRowMenu()
  // « Voir la fiche » du menu : là où mène la photo (fiche dans son contexte), sinon la ligne si elle mène à la fiche.
  const fiche: RowLink = avatarLink ?? (link && !link.to.startsWith('/evaluer') ? link : { to: `/joueurs/${p.id}` })
  const size = compact ? COMPACT_AVATAR : ROW_AVATAR
  const avatar = <Avatar p={p} size={size} />
  // Le lien (ou bouton) porte le nom ; son ::after couvre toute la zone de la ligne (un clic n'importe où l'ouvre).
  // Ce qui doit rester touchable par-dessus (pictogrammes, « ⋮ », photo à part, boutons des lignes) passe au-dessus (z-[1]).
  const hit = "min-w-0 flex-1 text-left outline-none after:absolute after:inset-0 after:content-['']"
  const name = <PlayerNameLine p={p} compact={compact} quarter={quarter} badges={badges} />
  const main = link ? (
    <Link to={link.to} state={link.state} replace={link.replace} onClick={link.onClick} className={hit} {...linkProps}>
      {name}
    </Link>
  ) : onClick ? (
    <button type="button" onClick={onClick} className={hit} {...linkProps}>
      {name}
    </button>
  ) : (
    <span className="min-w-0 flex-1">{name}</span>
  )
  const zone = (
    <div className={`relative flex min-w-0 flex-1 items-center self-stretch ${compact ? 'min-h-10 gap-2' : 'gap-3'}`}>
      {avatarLink ? (
        <Link
          to={avatarLink.to}
          state={avatarLink.state}
          replace={avatarLink.replace}
          onClick={avatarLink.onClick}
          title="Voir la fiche"
          aria-label={`Fiche de ${p.firstName} ${p.lastName}`}
          className="relative z-[1] shrink-0 rounded-lg hover:ring-2 hover:ring-accent/60"
        >
          {avatar}
        </Link>
      ) : (
        avatar
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <div data-ptop className="flex min-w-0 items-center">
          {main}
          <span data-pics className="relative z-[1] flex shrink-0 items-center empty:hidden">
            {pictos && <RowPictos p={p} fiche={fiche} seen={seen} rewatch={rewatch} follow={follow} />}
          </span>
          {!compact && (
            <span data-pmenu className="relative z-[1] flex shrink-0">
              <MenuButton onOpen={menu.open} open={!!menu.anchor} label={`Actions pour ${p.lastName.toUpperCase()} ${p.firstName}`} />
            </span>
          )}
        </div>
        {sub !== '' && (
          <span className={`truncate text-muted ${compact ? 'text-[10px]' : 'text-[11px] max-[400px]:text-xs'}`}>{sub === undefined ? playerSub(p) : sub}</span>
        )}
        {lines && (
          // Le texte laisse passer le clic vers le lien ; les boutons qu'il contient restent touchables.
          <div className="pointer-events-none relative z-[1] flex min-w-0 flex-col [&_:is(a,button,input,label,select,[role=button])]:pointer-events-auto">{lines}</div>
        )}
      </div>
    </div>
  )
  const row = (
    <>
      {lead}
      {zone}
      {aside}
      {actions}
    </>
  )
  const card = `card ${MENU_ROW} ${poleEdge(p)} ${selectedCls(selected)} ${link || onClick ? 'hover:border-accent focus-within:border-accent' : ''} ${className}`
  const line = compact ? 'flex items-center gap-1 py-0.5 pr-0.5 pl-1.5' : 'flex items-center gap-3 p-2.5'
  const opened = menu.anchor && (
    // Hors de la carte ; les événements du menu et de ses fenêtres ne remontent pas jusqu'à la liste.
    <div className="contents" onClick={stop} onKeyDown={stop} onPointerDown={stop} onContextMenu={stop}>
      <PlayerMenu p={p} anchor={menu.anchor} fiche={fiche} extras={menuExtras} onClose={menu.close} />
    </div>
  )
  if (!below)
    return (
      <>
        <div className={`${card} ${line}`} {...cardProps} {...menu.bind}>
          {row}
        </div>
        {opened}
      </>
    )
  return (
    <>
      <div className={`${card} flex flex-col gap-1.5 ${compact ? 'py-0.5 pr-0.5 pl-1.5' : 'p-2.5'}`} {...cardProps} {...menu.bind}>
        <div className={`flex items-center ${compact ? 'gap-1' : 'gap-3'}`}>{row}</div>
        {below}
      </div>
      {opened}
    </>
  )
}

const stop = (e: SyntheticEvent) => e.stopPropagation()
