import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { eventIcs } from '../agenda'
import { offerIcs } from '../agendaFile'
import { db, newId, save, type HBEvent } from '../db'
import { defaultOrganizer } from '../eventOrganizer'
import {
  ACTION_LABEL,
  eventFromRencontre,
  firstName,
  goingStaff,
  indexRencontreEvents,
  joinEvent,
  rencontreAction,
  staffGoingLabel,
  staffName,
  type RencontreAction,
} from '../rencontreEvent'
import type { Rencontre } from '../rencontres'
import { can, currentUserId, teamMembersOf, useRole } from '../roles'
import { ReadOnlyError } from '../spy'
import { appUrl, flash } from './ItemMenu'
import { getMe, Icon } from './ui'

/*
 * « Ajouter à mes événements » et « Ajouter à mon agenda » depuis une rencontre (« Autour de moi » : cartes et fiche de la
 * rencontre). Règles pures : src/rencontreEvent.ts (un événement par rencontre, qui y va, bouton proposé) et src/agenda.ts
 * (fichier .ics). Écriture : save() de src/db.ts (file d'envoi, synchronisation), comme « Nouvel événement » ; organisateur
 * par défaut du formulaire de création (src/eventOrganizer.ts) ; droits : can.manageEvents (créer), can.editEvent
 * (s'ajouter aux participants d'un événement existant : organisateur et administrateurs, comme le serveur).
 */

/** Événements (non supprimés) reliés à une rencontre, rangés par rencontre ; undefined pendant la lecture. */
export function useRencontreEvents(): Map<string, HBEvent> | undefined {
  return useLiveQuery(async () => indexRencontreEvents(await db.events.filter((e) => !!e.rencontreId && !e.deleted).toArray()), [])
}

/** Bouton proposé pour une rencontre, et « qui y va » (texte court) ; suit le rôle et les groupes de travail. */
export function useRencontreState() {
  const role = useRole()
  const me = currentUserId()
  const canCreate = can.manageEvents(role)
  return {
    me,
    actionOf: (ev?: HBEvent): RencontreAction | null =>
      rencontreAction(ev, { me, canCreate, canJoin: !!ev && can.editEvent(role, ev), membersOf: teamMembersOf }),
    goingOf: (ev?: HBEvent) => (ev ? staffGoingLabel(goingStaff(ev, teamMembersOf), me, (u) => staffName(ev, u)) : ''),
  }
}

/** Organisateur de l'événement : celui que le formulaire de création pose d'office (l'unité du créateur), s'il y en a un. */
async function myOrganizer(me: string | null): Promise<{ id: string; name?: string } | undefined> {
  const [units, levels, assignments] = await Promise.all([db.units.toArray(), db.levels.toArray(), db.assignments.toArray()])
  const id = defaultOrganizer({ units, levels, assignments, userId: me })
  const u = id ? units.find((x) => x.id === id) : undefined
  return u ? { id: u.id, name: u.name } : undefined
}

/** Crée l'événement de la rencontre (sauf s'il vient d'apparaître : on le rend). */
async function addRencontreEvent(f: Rencontre, playerIds: readonly string[]): Promise<HBEvent> {
  const me = currentUserId()
  const already = indexRencontreEvents(await db.events.filter((e) => e.rencontreId === f.id).toArray()).get(f.id)
  if (already) return already
  const row = eventFromRencontre(f, { id: me, name: getMe() }, playerIds, { id: newId(), organizer: await myOrganizer(me) })
  return save<HBEvent>('events', row)
}

/** « J'y vais aussi » : relit l'événement (il a pu changer) et m'ajoute à ses participants. */
async function joinRencontreEvent(ev: HBEvent): Promise<HBEvent> {
  const cur = (await db.events.get(ev.id)) ?? ev
  const next = joinEvent(cur, { id: currentUserId(), name: getMe() })
  return next === cur ? cur : save<HBEvent>('events', next)
}

/** Une écriture refusée sur cet appareil (« Voir comme… » : lecture seule) : déjà signalée ; sinon un message. */
const failed = (e: unknown) => {
  if (!(e instanceof ReadOnlyError)) flash('Enregistrement impossible sur cet appareil')
}

/**
 * Bouton d'une rencontre : « Ajouter à mes événements », « ✓ Dans mes événements » (ouvre l'événement), « J'y vais aussi »,
 * « Voir l'événement ». `compact` : sur la carte (au-dessus du lien qui couvre la carte), « Voir l'événement » n'y est pas.
 * `playerIds` : jeunes de la liste Qui qui devraient y jouer (la liste de l'événement créé).
 */
export function RencontreEventButton({
  f,
  ev,
  action,
  playerIds,
  compact = false,
}: {
  f: Rencontre
  ev?: HBEvent
  action: RencontreAction | null
  playerIds: readonly string[]
  compact?: boolean
}) {
  const [busy, setBusy] = useState(false)
  if (!action || (compact && action === 'ask')) return null
  const label = ACTION_LABEL[action]
  const text = compact ? label.compact : label.full
  const cls = compact
    ? `relative z-[1] flex min-h-8 shrink-0 items-center gap-1 rounded-full border px-2.5 text-[11px] font-bold disabled:opacity-60 ${
        action === 'in' ? 'border-accent/60 bg-accent/10 text-accent' : 'border-line bg-panel-2 hover:border-accent'
      }`
    : `${action === 'add' || action === 'join' ? 'btn-primary' : 'btn-ghost'} flex items-center justify-center gap-1.5 px-4 text-xs`
  if ((action === 'in' || action === 'ask') && ev)
    return (
      <Link to={`/evenements/${ev.id}`} className={cls} aria-label={compact ? `${label.full} : ouvrir l’événement` : undefined}>
        {action === 'ask' && <Icon name="calendar" className="h-3.5 w-3.5" />}
        {text}
      </Link>
    )
  const run = async () => {
    if (busy) return
    setBusy(true)
    try {
      if (action === 'add') {
        await addRencontreEvent(f, playerIds)
        flash('Ajouté à tes événements')
      } else if (action === 'join' && ev) {
        await joinRencontreEvent(ev)
        flash('Tu es dans les participants')
      }
    } catch (e) {
      failed(e)
    } finally {
      setBusy(false)
    }
  }
  return (
    <button type="button" className={cls} disabled={busy} onClick={() => void run()} aria-label={compact && action === 'add' ? label.full : undefined}>
      <Icon name={action === 'add' ? 'plus' : 'userPlus'} className={compact ? 'h-3 w-3' : 'h-3.5 w-3.5'} />
      {text}
    </button>
  )
}

/** « Toi et Stef y allez » : qui du staff va à la rencontre (participants de son événement). */
export function StaffGoing({ text, className = '' }: { text: string; className?: string }) {
  if (!text) return null
  return (
    <span className={`flex min-w-0 items-center gap-1 text-[11px] text-muted ${className}`}>
      <Icon name="users" className="h-3 w-3 shrink-0" />
      <span className="truncate">{text}</span>
    </span>
  )
}

/** Pour « Voir l'événement » : à qui demander d'être ajouté (son organisateur). */
export const askWho = (ev: HBEvent) => firstName(staffName(ev, ev.createdBy ?? '')) || 'son organisateur'

/**
 * « Ajouter à mon agenda » depuis une rencontre : l'événement s'il existe (son nom, son jour, son lieu, sa page), sinon la
 * rencontre telle qu'elle serait ajoutée (adresse : « Autour de moi »). Jamais un nom de jeune : leur nombre seulement.
 * Fabriqué tout de suite, dans le geste (le partage du téléphone l'exige).
 */
export function rencontreToAgenda(f: Rencontre, ev: HBEvent | undefined, playerIds: readonly string[]) {
  const target = ev ?? eventFromRencontre(f, {}, playerIds, { id: f.id })
  const out = eventIcs(target, { url: appUrl(ev ? `/evenements/${ev.id}` : '/evenements?vue=autour') })
  if (out) void offerIcs(out.ics, out.fileName, target.name)
}
