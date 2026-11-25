import type { HBEvent } from './db'
import { SEX_LABELS } from './gender'
import { sideLabel, type FixtureSide, type FixtureSex, type Level, type Rencontre } from './rencontres'

/*
 * « Ajouter à mes événements » depuis une rencontre (« Autour de moi », src/components/AroundMe.tsx) : partie pure (ni
 * React ni Dexie), testée par tools/test-rencontre-evenement.ts.
 *  - UN événement par rencontre, partagé par le staff : l'événement garde l'identifiant de la rencontre (rencontreId) et un
 *    petit instantané (compétition, niveau, salle, ville, coordonnées, équipes) : la page de l'événement, le fichier
 *    d'agenda et « Itinéraire » marchent sans le serveur.
 *  - Qui y va : les participants de l'événement (editors, et membres des groupes de travail choisis). Celui qui l'ajoute
 *    en est le premier participant (il peut « Me retirer » ensuite) ; « J'y vais aussi » ajoute un autre encadrant.
 *  - Bouton d'une rencontre : « Ajouter à mes événements », « ✓ Dans mes événements » (j'y vais : ouvre l'événement),
 *    « J'y vais aussi » (l'événement existe, je n'y suis pas et le serveur me laisse m'y ajouter), ou seulement l'ouvrir.
 *  - Texte court : « Tu y vas », « Stef y va », « Toi et Stef y allez », « 3 du staff y vont ».
 * Écriture : par save() (src/db.ts) comme toute création d'événement ; droits : can.manageEvents (création),
 * can.editEvent (ajouter un participant : le serveur, supabase/024 et suivants, ne le permet qu'à l'organisateur et aux
 * administrateurs).
 */

/** Ce que l'événement garde de la rencontre (champ libre de data, gardé tel quel par le serveur ; ni nom ni licence). */
export interface RencontreSnapshot {
  category: string
  sex: FixtureSex
  level: Level
  competition?: string
  lat: number
  lng: number
  venue?: string
  city?: string
  home: Pick<FixtureSide, 'name' | 'team' | 'club'>
  away: Pick<FixtureSide, 'name' | 'team' | 'club'>
}

const side = (s: FixtureSide): RencontreSnapshot['home'] => ({ name: s.name, ...(s.team ? { team: s.team } : {}), ...(s.club ? { club: s.club } : {}) })

/** Instantané d'une rencontre (sans distance ni lien de diffusion : ils changent). */
export function rencontreSnapshot(r: Rencontre): RencontreSnapshot {
  return {
    category: r.category,
    sex: r.sex,
    level: r.level,
    ...(r.competition ? { competition: r.competition } : {}),
    lat: r.lat,
    lng: r.lng,
    ...(r.venue ? { venue: r.venue } : {}),
    ...(r.city ? { city: r.city } : {}),
    home: side(r.home),
    away: side(r.away),
  }
}

/** Sexe d'une rencontre → sexe d'un événement (accords, src/gender.ts). */
export const eventSex = (s: FixtureSex): HBEvent['sex'] => (s === 'X' ? 'mixte' : s)

/** « U15 masculin », « M15 féminin », « U13 mixte » : catégorie du sport et libellé du sexe (src/gender.ts). */
export const categoryLabel = (r: Pick<Rencontre, 'category' | 'sex'>) => `${r.category} ${SEX_LABELS[eventSex(r.sex)!].toLowerCase()}`

/**
 * Nom de l'événement, comme les matchs créés depuis une feuille (« Compétition – Équipe A / Équipe B ») :
 * « U15 masculin – Club A (2) / Club B (1) » (200 caractères au plus, comme eux).
 */
export const rencontreEventName = (r: Pick<Rencontre, 'category' | 'sex' | 'home' | 'away'>) =>
  `${categoryLabel(r)} – ${sideLabel(r.home)} / ${sideLabel(r.away)}`.slice(0, 200)

const pad = (n: number) => String(n).padStart(2, '0')

/** Jour (AAAA-MM-JJ) et heure (HH:MM) d'un horodatage ISO, en heure locale de l'appareil (comme les autres événements). */
export function localDateTime(iso: string): { date: string; time: string } {
  const d = new Date(Date.parse(iso))
  return { date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, time: `${pad(d.getHours())}:${pad(d.getMinutes())}` }
}

/** « Gymnase des Tilleuls, Valence » ; undefined si ni salle ni ville. */
export const rencontrePlace = (r: Pick<Rencontre, 'venue' | 'city'>) => [r.venue, r.city].filter(Boolean).join(', ') || undefined

/** Moi (compte) : identifiant et nom affiché ; pas d'identifiant en mode local (un seul utilisateur, tous les droits). */
export interface Me {
  id?: string | null
  name?: string
}

/**
 * Événement d'une rencontre (à enregistrer par save()) : un match, son nom, son jour et son heure, la salle et la ville,
 * moi comme participant, les jeunes de la liste Qui qui devraient y jouer (modifiable ensuite comme tout événement),
 * l'organisateur par défaut (celui du formulaire de création) et le lien vers la rencontre.
 */
export function eventFromRencontre(
  r: Rencontre,
  me: Me,
  playerIds: readonly string[],
  opts: { id: string; organizer?: { id: string; name?: string } },
): Omit<HBEvent, 'updatedAt'> {
  const { date, time } = localDateTime(r.startsAt)
  const ids = [...new Set(playerIds.filter((x) => typeof x === 'string' && x))]
  const uid = me.id || undefined
  const place = rencontrePlace(r)
  return {
    id: opts.id,
    name: rencontreEventName(r),
    type: 'match',
    date,
    time,
    ...(place ? { place } : {}),
    sex: eventSex(r.sex),
    ...(ids.length ? { playerIds: ids } : {}),
    // « Ajouté par » : posé ici pour l'affichage ; le serveur le refait (supabase/024).
    ...(uid && ids.length ? { addedBy: Object.fromEntries(ids.map((id) => [id, uid])) } : {}),
    editors: uid ? [uid] : [],
    ...(uid && me.name?.trim() ? { names: { [uid]: me.name.trim() } } : {}),
    ...(opts.organizer?.id ? { organizerUnitId: opts.organizer.id, ...(opts.organizer.name ? { organizerName: opts.organizer.name } : {}) } : {}),
    rencontreId: r.id,
    rencontre: rencontreSnapshot(r),
  }
}

// ---------- Un événement par rencontre ----------

type Linked = { id: string; rencontreId?: string; deleted?: boolean; createdAtServer?: string }

/** Le plus ancien d'abord (déjà sur le serveur, puis par identifiant) : le même partout si deux ont été créés en même temps. */
const older = (a: Linked, b: Linked) => {
  const ta = a.createdAtServer ?? '￿'
  const tb = b.createdAtServer ?? '￿'
  return ta < tb ? -1 : ta > tb ? 1 : a.id.localeCompare(b.id)
}

/** Événements non supprimés reliés à une rencontre, rangés par rencontre (le plus ancien s'il y en a deux). */
export function indexRencontreEvents<E extends Linked>(events: readonly E[]): Map<string, E> {
  const out = new Map<string, E>()
  for (const e of events) {
    if (e.deleted || !e.rencontreId) continue
    const prev = out.get(e.rencontreId)
    if (!prev || older(e, prev) < 0) out.set(e.rencontreId, e)
  }
  return out
}

/** L'événement (non supprimé) d'une rencontre ; undefined s'il n'y en a pas encore. */
export const findRencontreEvent = <E extends Linked>(events: readonly E[], rencontreId: string): E | undefined =>
  indexRencontreEvents(events.filter((e) => e.rencontreId === rencontreId)).get(rencontreId)

// ---------- Qui y va ----------

type WithStaff = { editors?: string[]; teams?: string[] }

/** Comptes qui y vont : participants choisis un par un, puis membres des groupes de travail choisis (sans doublon). */
export function goingStaff(ev: WithStaff, membersOf: (teamId: string) => readonly string[] | undefined = () => undefined): string[] {
  const out = new Set(ev.editors ?? [])
  for (const t of ev.teams ?? []) for (const u of membersOf(t) ?? []) out.add(u)
  return [...out]
}

/** Prénom (premier mot du nom affiché) ; '' si inconnu. */
export const firstName = (name?: string) => name?.trim().split(/\s+/)[0] ?? ''

/**
 * Texte court et neutre : « Tu y vas », « Stef y va », « Stef et Paul y vont », « Toi et Stef y allez »,
 * « Toi, Stef et Paul y allez », « 3 du staff y vont », « Toi et 3 du staff y allez » ; '' si personne.
 * Les noms seulement pour deux autres au plus, tous connus ; sinon un nombre.
 */
export function staffGoingLabel(goers: readonly string[], me: string | null | undefined, nameOf: (uid: string) => string | undefined): string {
  const meIn = !!me && goers.includes(me)
  const others = goers.filter((u) => u !== me)
  if (!meIn && !others.length) return ''
  if (!others.length) return 'Tu y vas'
  const names = others.map((u) => firstName(nameOf(u)))
  if (others.length <= 2 && names.every(Boolean)) {
    const list = names.length === 1 ? names[0] : `${names[0]} et ${names[1]}`
    if (meIn) return names.length === 1 ? `Toi et ${names[0]} y allez` : `Toi, ${names[0]} et ${names[1]} y allez`
    return `${list} ${others.length > 1 ? 'y vont' : 'y va'}`
  }
  const n = others.length
  if (meIn) return `Toi et ${n} du staff y allez`
  return `${n} du staff ${n > 1 ? 'y vont' : 'y va'}`
}

/** Nom d'un compte cité par l'événement (participants, créateur). */
export const staffName = (ev: { names?: Record<string, string>; createdBy?: string; createdByName?: string }, uid: string) =>
  ev.names?.[uid] || (uid === ev.createdBy ? ev.createdByName : undefined) || undefined

// ---------- Bouton d'une rencontre ----------

/**
 * Ce que propose une rencontre :
 *  - 'add' : pas encore d'événement → « Ajouter à mes événements » ;
 *  - 'in' : j'y vais déjà → « ✓ Dans mes événements » (ouvre l'événement) ;
 *  - 'join' : l'événement existe, je n'y suis pas → « J'y vais aussi » (m'ajoute aux participants) ;
 *  - 'ask' : l'événement existe, mais seul son organisateur (ou un administrateur) peut ajouter un participant :
 *    on peut l'ouvrir, et lui demander ;
 *  - null : rien (le rôle ne crée pas d'événement, comme « Nouvel événement »).
 * Mode local (sans compte) : un seul utilisateur, l'événement existant est le sien.
 */
export type RencontreAction = 'add' | 'in' | 'join' | 'ask'
export function rencontreAction(
  ev: WithStaff | undefined,
  ctx: { me?: string | null; canCreate: boolean; canJoin: boolean; membersOf?: (teamId: string) => readonly string[] | undefined },
): RencontreAction | null {
  if (!ctx.canCreate) return null
  if (!ev) return 'add'
  if (!ctx.me || goingStaff(ev, ctx.membersOf).includes(ctx.me)) return 'in'
  return ctx.canJoin ? 'join' : 'ask'
}

/** « J'y vais aussi » : moi en plus des participants (et mon nom, pour l'affichage) ; le reste de l'événement ne bouge pas. */
export function joinEvent<E extends HBEvent | Omit<HBEvent, 'updatedAt'>>(ev: E, me: Me): E {
  const uid = me.id
  if (!uid || (ev.editors ?? []).includes(uid)) return ev
  const name = me.name?.trim()
  return { ...ev, editors: [...(ev.editors ?? []), uid], ...(name ? { names: { ...ev.names, [uid]: name } } : {}) }
}

/** Libellés des boutons (fiche de la rencontre ; `compact` : sur la carte). */
export const ACTION_LABEL: Record<RencontreAction, { full: string; compact: string }> = {
  add: { full: 'Ajouter à mes événements', compact: 'Mes événements' },
  in: { full: '✓ Dans mes événements', compact: '✓ Dans mes événements' },
  join: { full: 'J’y vais aussi', compact: 'J’y vais aussi' },
  ask: { full: 'Voir l’événement', compact: 'Voir l’événement' },
}
