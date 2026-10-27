import type { ReactNode, SyntheticEvent } from 'react'
import { Link } from 'react-router-dom'
import { poleStatus, POSITIONS, type Player } from '../db'
import { courtTag } from '../courtSpots'
import { hueBg, hueText, positionHue } from '../positionColors'
import { MENU_ROW, MenuButton, useRowMenu } from './ItemMenu'
import { PlayerMenu, type MenuExtra } from './PlayerMenu'
import { RowPictos } from './Pictos'
import { RowCheck, useRowCheckId, useRowSelection } from './Selection'
import { birthQuarter, photoSrc, quarterTitle } from './ui'

/*
 * Ligne de joueur commune à toutes les listes (joueurs, événement, groupe, « À revoir », bilan, suivis, alertes…) :
 * même photo, même nom, même ligne secondaire, mêmes icônes au bout, dans le même ordre. Style « liste épurée » (choisi
 * le 27/10/2026) : les lignes d'une liste sont posées dans UN cadre blanc arrondi (coins des fenêtres), séparées par un
 * filet fin ; plus de carte par joueur (src/index.css, [data-pitem]).
 * - photo : ronde, 38 px (ligne pleine), 30 px (colonne de contexte, fiche ouverte à droite) ; sans photo, les initiales
 *   dans la couleur du poste principal (src/positionColors.ts : fond teinté, texte plus foncé de la même teinte ; sans
 *   poste, gris neutre) ;
 * - ligne 1 : NOM Prénom en gras, puis « ● DC » (étiquette du terrain, src/courtSpots.ts, dans la couleur du poste),
 *   les postes secondaires en gris (« +ARG »), « Pôle » en menthe pour un joueur au Pôle Espoirs, puis les pastilles
 *   propres à la liste ; le nom n'est jamais coupé avant les pastilles si on peut l'éviter (elles passent à la ligne) ;
 * - ligne 2 (grise, une ligne, coupée au bout) : (ce que la liste ajoute devant : numéro, équipe ·) année · trimestre
 *   (Q1…Q4) · club · taille connue · (ce que la liste ajoute derrière) ; l'âge, quand la liste le donne, seulement si la
 *   ligne est assez large (ordinateur). Poids et latéralité restent sur la fiche ;
 * - lignes en plus de la liste (vu par, avis, à revoir, « ajouté par »…) : dessous, même style gris ;
 * - pictogrammes sur la ligne du nom (components/Pictos.tsx : ceux choisis dans « Filtres » → « Affichage », un seul
 *   réglage pour toutes les listes), puis « ⋮ » (petit, discret) ; la ligne secondaire prend toute la largeur dessous. Si
 *   un nom de la liste serait coupé à cause d'eux, toute la liste les passe sur leur propre ligne sous le nom ;
 *   puis les actions de la liste ;
 * - menu de la ligne (PlayerMenu) : appui long sur téléphone, clic droit sur ordinateur, touche « menu » ou Maj+F10,
 *   ou « ⋮ » (ligne pleine ; en colonne de contexte, faute de place, seulement les gestes). Un toucher ou un clic
 *   normal garde son effet (fiche, évaluation) ; après un appui long, le clic du relâchement est ignoré.
 * Survol, appui, ligne ouverte ou cochée : fond légèrement teinté (pas de bordure).
 * Sélection multiple (components/Selection.tsx) : une case à cocher avant la ligne ;
 * toute la ligne (photo comprise) devient son libellé : un toucher coche ou décoche, sans ouvrir la fiche.
 * La photo ouvre la fiche du joueur (dans son contexte quand il y en a un : événement, groupe). Toute la ligne est
 * cliquable : le lien (sur le nom) la couvre entièrement, pictogrammes, photo à part et boutons des lignes en plus au-dessus.
 * Uniquement des marques positives ou neutres sur les jeunes joueurs.
 */

/** Taille de la photo : ligne pleine, colonne de contexte. */
export const ROW_AVATAR = 38
export const COMPACT_AVATAR = 30

/** Morceau de la ligne secondaire ; faux ou vide : rien. */
export type SubBit = string | false | null | undefined

/** « 2011 · Q2 · HBC Rhône Sud », précédé de ce que la liste ajoute (numéro, équipe…). */
export function playerSub(p: Pick<Player, 'birthDate' | 'club'>, ...before: SubBit[]) {
  const q = birthQuarter(p.birthDate)
  return [...before, p.birthDate?.slice(0, 4), q && `Q${q}`, p.club].filter(Boolean).join(' · ')
}

/** Rond de la ligne : la photo, sinon les initiales dans la couleur du poste principal. */
export function RowAvatar({ p, size }: { p: Pick<Player, 'firstName' | 'lastName' | 'photo' | 'position'>; size: number }) {
  const src = photoSrc(p.photo)
  if (src) return <img src={src} alt="" className="shrink-0 rounded-full object-cover" style={{ width: size, height: size }} />
  const hue = positionHue(p.position)
  const initials = ((p.lastName?.[0] ?? '') + (p.firstName?.[0] ?? '')).toUpperCase()
  return (
    <div
      aria-hidden
      className={`flex shrink-0 items-center justify-center rounded-full font-bold tracking-tight ${hue ? '' : 'bg-panel-2 text-muted'}`}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.34), ...hueBg(hue) }}
    >
      {initials || '?'}
    </div>
  )
}

const posName = (code: string) => POSITIONS.find((x) => x.id === code)?.label ?? code

/** « ● DC » (couleur du poste), « +ARG » (postes secondaires, gris), « Pôle » (menthe). */
function PosMarks({ p, compact }: { p: Player; compact: boolean }) {
  const sec = (p.secondaryPositions ?? []).filter((x) => x && x !== p.position)
  const hue = positionHue(p.position)
  const size = compact ? 'text-[10px]' : 'text-[11px]'
  return (
    <>
      {p.position && (
        <span className={`inline-flex items-center gap-1 font-bold ${size} ${hue ? '' : 'text-muted'}`} style={hueText(hue)} title={posName(p.position)}>
          <span aria-hidden className="inline-block h-1.5 w-1.5 rounded-full bg-current" />
          {courtTag(p.position)}
        </span>
      )}
      {sec.length > 0 && (
        <span className={`font-semibold text-muted ${size}`} title={`Postes secondaires : ${sec.map(posName).join(', ')}`}>
          {sec.map((x) => `+${courtTag(x)}`).join(' ')}
        </span>
      )}
      {poleStatus(p) === 'current' && (
        <span className="rounded-full bg-teal-500/15 px-1.5 text-[10px] leading-4 font-bold text-teal-300" title="Au Pôle Espoirs">
          Pôle
        </span>
      )}
    </>
  )
}

/**
 * NOM Prénom (gras) puis « ● DC », postes secondaires, « Pôle » et les pastilles de la liste, qui passent à la ligne
 * plutôt que de couper le nom. Téléphone étroit (< 400 px) : le nom n'est jamais coupé, il passe à la ligne s'il le faut.
 */
export function PlayerNameLine({
  p,
  compact = false,
  badges,
}: {
  p: Player
  compact?: boolean
  /** Pastilles propres à la liste, après les marques communes. */
  badges?: ReactNode
}) {
  return (
    <span className={`flex min-w-0 flex-wrap items-center gap-y-0.5 font-bold ${compact ? 'gap-x-1.5 text-xs' : 'gap-x-2 text-sm'}`}>
      <span data-pn className="max-w-full truncate max-[400px]:break-words max-[400px]:whitespace-normal">
        {p.lastName.toUpperCase()} {p.firstName}
      </span>
      <span className="flex max-w-full flex-wrap items-center gap-x-1.5 gap-y-0.5 whitespace-nowrap empty:hidden">
        <PosMarks p={p} compact={compact} />
        {badges}
      </span>
    </span>
  )
}

/**
 * Ligne secondaire par défaut : (pre ·) année (· âge, ligne large) · trimestre · club · taille (· post). Chaque morceau
 * porte son « · » : l'âge masqué n'en laisse pas de trop.
 */
function SubLine({ p, pre, post, age, quarter, club, height }: { p: Player; pre?: SubBit[]; post?: SubBit[]; age?: number | null; quarter: boolean; club: boolean; height?: string }) {
  const q = quarter ? birthQuarter(p.birthDate) : null
  const parts: ReactNode[] = []
  const add = (node: ReactNode, key: string) => parts.push(<span key={key}>{parts.length ? ' · ' : ''}{node}</span>)
  pre?.forEach((b, i) => b && add(b, `pre${i}`))
  const year = p.birthDate?.slice(0, 4)
  if (year) add(year, 'y')
  if (age != null && age >= 0) {
    // Âge : seulement quand la ligne est large (ordinateur) ; sur téléphone, année et trimestre suffisent.
    parts.push(
      <span key="age" className="hidden @md/prow:inline">
        {parts.length ? ' · ' : ''}
        {age} ans
      </span>,
    )
  }
  if (q) add(<span title={quarterTitle(q)}>Q{q}</span>, 'q')
  if (club && p.club) add(p.club, 'c')
  if (height) add(`${height} cm`, 'h')
  post?.forEach((b, i) => b && add(b, `post${i}`))
  return <>{parts}</>
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
  /** Pastilles propres à la liste (après poste, postes secondaires et « Pôle »). */
  badges?: ReactNode
  /** Trimestre de naissance sur la ligne secondaire (par défaut). */
  quarter?: boolean
  /** Ligne secondaire entièrement donnée par la liste ('' : aucune) ; par défaut année · trimestre · club · taille. */
  sub?: ReactNode
  /** Ligne secondaire par défaut : morceaux ajoutés devant l'année (numéro, équipe…). */
  pre?: SubBit[]
  /** Ligne secondaire par défaut : morceaux ajoutés après le club (valeur d'une question, « vu le »…). */
  post?: SubBit[]
  /** Club sur la ligne secondaire (par défaut) ; faux dans la liste d'un club. */
  club?: boolean
  /** Âge (liste Joueurs) : sur la ligne secondaire, seulement si elle est assez large (ordinateur). */
  age?: number | null
  /** Taille connue (en cm, déjà mise en forme) : au bout de la ligne secondaire. */
  height?: string
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
  /** Ligne ouverte (fiche affichée à droite) : fond teinté. */
  selected?: boolean
  /** Ligne mise en avant (choisie pour comparer…) : même fond teinté. */
  marked?: boolean
  className?: string
  /** Attributs de la ligne (data-row…). */
  cardProps?: Record<string, string | undefined>
  /**
   * La ligne est un élément du cadre de la liste (par défaut). Faux : elle est dans un élément plus grand de la liste
   * (ligne et avis ouverts dessous, page d'un événement), qui porte lui-même data-pitem.
   */
  item?: boolean
  /** Actions propres à la liste dans le menu de la ligne (« Retirer de cet événement »…). */
  menuExtras?: MenuExtra[]
  /**
   * « Supprimer la fiche » dans le menu de la ligne (administrateurs). Absent par défaut : seulement la liste générale
   * Joueurs (src/pages/Players.tsx) ; jamais une liste de groupe, d'événement ou de saison, où la ligne propose de
   * retirer le joueur de la liste, pas d'effacer sa fiche. La page de la fiche a son propre « Supprimer la fiche ».
   */
  deletable?: boolean
}

/** Ligne pleine (photo 38 px). */
export function PlayerRow(props: RowProps) {
  return <Row {...props} compact={false} />
}

/** Ligne de la colonne de contexte (photo 30 px, texte plus petit), fiche ouverte à droite. */
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
  quarter = true,
  sub,
  pre,
  post,
  club = true,
  age,
  height,
  lines,
  aside,
  seen,
  rewatch,
  follow,
  pictos = true,
  actions,
  below,
  selected = false,
  marked = false,
  className = '',
  cardProps,
  item = true,
  menuExtras,
  deletable = false,
  compact,
}: RowProps & { compact: boolean }) {
  const menu = useRowMenu()
  // Sélection multiple (components/Selection.tsx) : une case avant la ligne ; toucher la ligne coche / décoche.
  const sel = useRowSelection(p.id)
  const checkId = useRowCheckId()
  // « Voir la fiche » du menu : là où mène la photo (fiche dans son contexte), sinon la ligne si elle mène à la fiche.
  const fiche: RowLink = avatarLink ?? (link && !link.to.startsWith('/evaluer') ? link : { to: `/joueurs/${p.id}` })
  const size = compact ? COMPACT_AVATAR : ROW_AVATAR
  const avatar = <RowAvatar p={p} size={size} />
  // Le lien (ou bouton) porte le nom ; son ::after couvre toute la zone de la ligne (un clic n'importe où l'ouvre).
  // Ce qui doit rester touchable par-dessus (pictogrammes, « ⋮ », photo à part, boutons des lignes) passe au-dessus (z-[1]).
  const hit = "col-start-1 row-start-1 min-w-0 flex-1 text-left outline-none after:absolute after:inset-0 after:content-['']"
  const name = <PlayerNameLine p={p} compact={compact} badges={badges} />
  const main = sel ? (
    <label htmlFor={checkId} className={`${hit} cursor-pointer`}>
      {name}
    </label>
  ) : link ? (
    <Link to={link.to} state={link.state} replace={link.replace} onClick={link.onClick} className={hit} {...linkProps}>
      {name}
    </Link>
  ) : onClick ? (
    <button type="button" onClick={onClick} className={hit} {...linkProps}>
      {name}
    </button>
  ) : (
    <span className="col-start-1 row-start-1 min-w-0 flex-1">{name}</span>
  )
  const zone = (
    <div className={`relative flex min-w-0 flex-1 items-center self-stretch ${compact ? 'min-h-10 gap-2' : 'gap-3'}`}>
      {avatarLink && !sel ? (
        <Link
          to={avatarLink.to}
          state={avatarLink.state}
          replace={avatarLink.replace}
          onClick={avatarLink.onClick}
          title="Voir la fiche"
          aria-label={`Fiche de ${p.firstName} ${p.lastName}`}
          className="relative z-[1] shrink-0 rounded-full hover:ring-2 hover:ring-accent/60"
        >
          {avatar}
        </Link>
      ) : (
        avatar
      )}
      {/* Grille : nom et texte à gauche ; pictogrammes (jusqu'à 4 par ligne, remplis dans l'ordre) puis « ⋮ » à droite,
          sur toute la hauteur du texte. data-ptop reste un repère (mesure des noms) sans boîte à lui. */}
      <div data-pcol className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_auto_auto] items-center">
        <div data-ptop className="contents">
          {main}
          {/* En sélection : pictogrammes inertes (affichés, mais ni lien ni bouton) ; les toucher coche / décoche la
              ligne comme le reste, et rien n'ouvre la fiche (la sélection serait perdue au retour). */}
          <span data-pics inert={!!sel} className={`col-start-2 row-span-2 row-start-1 grid shrink-0 [grid-template-columns:repeat(4,auto)] items-center justify-items-center gap-y-1.5 self-center empty:hidden ${sel ? 'pointer-events-none' : 'relative z-[1]'}`}>
            {pictos && <RowPictos p={p} fiche={fiche} seen={seen} rewatch={rewatch} follow={follow} />}
          </span>
          {!compact && (
            <span data-pmenu className="relative z-[1] col-start-3 row-span-2 row-start-1 flex shrink-0 self-center">
              <MenuButton small onOpen={menu.open} open={!!menu.anchor} label={`Actions pour ${p.lastName.toUpperCase()} ${p.firstName}`} />
            </span>
          )}
        </div>
        {sub !== '' && (
          <span className={`col-start-1 row-start-2 mt-px truncate text-muted ${compact ? 'text-[10px]' : 'text-xs'}`}>
            {sub === undefined ? <SubLine p={p} pre={pre} post={post} age={age} quarter={quarter} club={club} height={height} /> : sub}
          </span>
        )}
        {lines && (
          // Le texte laisse passer le clic vers le lien ; les boutons qu'il contient restent touchables.
          <div data-plines className="pointer-events-none relative z-[1] col-span-3 row-start-3 flex min-w-0 flex-col [&_:is(a,button,input,label,select,[role=button])]:pointer-events-auto">{lines}</div>
        )}
      </div>
    </div>
  )
  const row = (
    <>
      {sel && <RowCheck id={checkId} p={p} checked={sel.checked} toggle={sel.toggle} compact={compact} />}
      {lead}
      {zone}
      {aside}
      {actions}
    </>
  )
  // Pas de carte : la ligne est un élément du cadre de la liste (src/index.css, [data-pitem]) ; survol, appui, ligne
  // ouverte ou cochée : fond légèrement teinté (prow-hit, prow-on).
  const card = `prow @container/prow ${MENU_ROW} ${link || onClick || sel ? 'prow-hit' : ''} ${selected || marked || sel?.checked ? 'prow-on' : ''} ${className}`
  const pad = compact ? 'py-1 pr-1 pl-2' : 'px-3 py-2.5'
  const line = compact ? 'flex items-center gap-1.5' : 'flex items-center gap-3'
  const opened = menu.anchor && (
    // Hors de la ligne ; les événements du menu et de ses fenêtres ne remontent pas jusqu'à la liste.
    <div className="contents" onClick={stop} onKeyDown={stop} onPointerDown={stop} onContextMenu={stop}>
      <PlayerMenu p={p} anchor={menu.anchor} fiche={fiche} extras={menuExtras} deletable={deletable} onClose={menu.close} />
    </div>
  )
  const attrs = { 'data-pitem': item ? '' : undefined, 'data-prow': '', ...cardProps, ...menu.bind }
  if (!below)
    return (
      <>
        <div className={`${card} ${line} ${pad}`} {...attrs}>
          {row}
        </div>
        {opened}
      </>
    )
  return (
    <>
      <div className={`${card} flex flex-col gap-1.5 ${pad}`} {...attrs}>
        <div className={line}>{row}</div>
        {below}
      </div>
      {opened}
    </>
  )
}

const stop = (e: SyntheticEvent) => e.stopPropagation()
