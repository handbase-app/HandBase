import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { BackButton } from '../backNav'
import { ask } from '../components/Confirm'
import { copyLink } from '../components/ItemMenu'
import { PanelClose, selectedCls, usePanel, useSelected } from '../components/MasterDetail'
import { HeaderMenu, PageHeader } from '../components/PageHeader'
import { stampOf, StampWindow } from '../components/ActivityLog'
import { FormActions, FormWindow } from '../components/FormWindow'
import { StaffPicker, useCanPickStaff } from '../components/StaffPicker'
import { Empty, Icon } from '../components/ui'
import { alive, db, fmtDate, newId, plural, remove, save, type HBEvent, type PlayerGroup, type Team } from '../db'
import { can, currentUserId, useRole } from '../roles'
import { STAFF } from '../staffLabels'
import { isMember, useTeams } from '../teams'

/*
 * Groupes de travail (ex-« Mes staffs », supabase/034_equipes_encadrants.sql) : équipes d'encadrants enregistrées, à
 * choisir d'un clic comme participants d'un groupe de joueurs ou d'un événement. Ils vivent dans l'onglet « Groupes de
 * travail » de la page Groupes (?onglet=travail) ; l'ancienne adresse /staffs y renvoie. Je vois ceux que j'ai créés et
 * ceux dont je fais partie ; seul le créateur d'un groupe de travail le renomme, change ses membres ou le supprime.
 * Ouvrir un groupe de travail : /groupes/:id?onglet=travail (panneau de droite sur ordinateur, écran seul sur téléphone).
 */

/** Ancienne page « Mes staffs » (/staffs) : renvoie vers l'onglet « Groupes de travail » de la page Groupes. */
export default function Teams() {
  return <Navigate to={STAFF.tabRoute} replace />
}

/** Adresse d'un groupe de travail ouvert (l'onglet suit, pour la liste de gauche et le retour). */
export const workGroupPath = (id: string) => `/groupes/${id}?onglet=${STAFF.tab}`

/** Groupes de joueurs et événements (sur l'appareil, non supprimés) qui citent chaque groupe de travail parmi leurs participants. */
function useShared() {
  return useLiveQuery(async () => {
    const [groups, events] = await Promise.all([db.groups.toArray(), db.events.toArray()])
    const m = new Map<string, { groups: PlayerGroup[]; events: HBEvent[] }>()
    const of = (id: string) => {
      let u = m.get(id)
      if (!u) m.set(id, (u = { groups: [], events: [] }))
      return u
    }
    for (const g of alive(groups)) if (can.seeGroup(g)) for (const t of g.teams ?? []) of(t).groups.push(g)
    for (const e of alive(events)) for (const t of e.teams ?? []) of(t).events.push(e)
    for (const u of m.values()) {
      u.groups.sort((a, b) => Number(!!a.archived) - Number(!!b.archived) || a.name.localeCompare(b.name, 'fr'))
      u.events.sort((a, b) => Number(!!a.archived) - Number(!!b.archived) || b.date.localeCompare(a.date))
    }
    return m
  })
}

/** « 2 groupes, 1 événement » (non archivés). */
function usesText(u?: { groups: PlayerGroup[]; events: HBEvent[] }) {
  if (!u) return ''
  const g = u.groups.filter((x) => !x.archived).length
  const e = u.events.filter((x) => !x.archived).length
  return [g && plural(g, 'groupe'), e && plural(e, 'événement')].filter(Boolean).join(', ')
}

/** Mode sélection de la page Groupes (« ⋯ » → « Sélectionner… ») : case cochée, raison si le groupe ne se coche pas, cocher. */
export type WorkPick = { has: (id: string) => boolean; why: (t: Team) => string | null; toggle: (id: string) => void }

/**
 * Onglet « Groupes de travail » de la page Groupes : la liste (déjà filtrée par la barre « Demander » de la page, `total` :
 * avant le filtre), et la fenêtre de création quand elle est demandée. `pick` : mode sélection, une case sur chaque carte.
 */
export function WorkGroupsTab({ teams, total, creating, onCreated, pick }: { teams: Team[]; total: number; creating: boolean; onCreated: () => void; pick?: WorkPick }) {
  const role = useRole()
  const nav = useNavigate()
  const shared = useShared()
  const sel = useSelected('/groupes')
  const meta = (t: Team) =>
    [can.editTeam(t) ? STAFF.mine : t.createdByName && STAFF.createdBy(t.createdByName), isMember(t) && STAFF.member, usesText(shared?.get(t.id))].filter(Boolean).join(' · ')
  return (
    <>
      <p className="text-[11px] text-muted">{STAFF.intro}</p>
      <p className="text-[11px] text-muted">{STAFF.privacy}</p>

      {creating && (
        <FormWindow title={STAFF.create} onClose={onCreated}>
          <TeamForm
            onDone={(t) => {
              onCreated()
              if (t) nav(workGroupPath(t.id))
            }}
          />
        </FormWindow>
      )}

      {!total && <Empty>{can.manageTeams(role) ? STAFF.emptyCreate : STAFF.empty}</Empty>}
      {total > 0 && !teams.length && <Empty>{STAFF.noMatch}</Empty>}

      <div className="cols flex flex-col gap-3">
        {teams.map((t) => {
          const body = (
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-bold">{t.name}</span>
              {t.description && <span className="block truncate text-[11px] text-muted">{t.description}</span>}
              <span className="block truncate text-[10px] text-muted">{meta(t)}</span>
            </span>
          )
          const count = <span className="shrink-0 text-xs font-bold text-muted">{STAFF.count(t.members.length)}</span>
          if (pick) {
            // Mode sélection : la carte coche / décoche (plus de lien) ; un groupe qui ne se coche pas dit pourquoi.
            const why = pick.why(t)
            const on = !why && pick.has(t.id)
            return (
              <label
                key={t.id}
                title={why ?? undefined}
                className={`card flex items-center gap-3 p-3 ${why ? 'cursor-not-allowed opacity-60' : 'cursor-pointer hover:border-accent'} ${on ? 'border-accent bg-accent/10' : ''}`}
              >
                <input
                  type="checkbox"
                  checked={on}
                  disabled={!!why}
                  onChange={() => pick.toggle(t.id)}
                  aria-label={`Sélectionner « ${t.name} »`}
                  className="h-5 w-5 shrink-0 cursor-pointer accent-[var(--color-accent)] disabled:cursor-not-allowed"
                />
                <span className="flex min-w-0 flex-1 flex-col">
                  {body}
                  {why && <span className="block truncate text-[10px] text-muted italic">{why}</span>}
                </span>
                {count}
              </label>
            )
          }
          return (
            <Link
              key={t.id}
              to={workGroupPath(t.id)}
              data-md={t.id}
              aria-current={sel === t.id || undefined}
              className={`card flex items-center justify-between gap-3 p-3 outline-none hover:border-accent focus-visible:border-accent ${selectedCls(sel === t.id)}`}
            >
              {body}
              {count}
            </Link>
          )
        })}
      </div>
    </>
  )
}

/** Fiche d'un groupe de travail : membres, puis les groupes de joueurs et les événements qui le partagent (liens). */
export function WorkGroupDetail({ id }: { id: string }) {
  const teams = useTeams()
  const shared = useShared()
  const panel = usePanel()
  const nav = useNavigate()
  const [editing, setEditing] = useState(false)
  // « Infos du groupe de travail » (création, dernière modification) : fenêtre ouverte depuis le ⋮ (31/10).
  const [stampOpen, setStampOpen] = useState(false)
  useEffect(() => {
    setEditing(false)
    setStampOpen(false)
  }, [id])
  if (!teams) return <div className="py-20 text-center text-sm text-muted">Chargement…</div>
  const t = teams.find((x) => x.id === id)
  const back = panel ? <PanelClose /> : <BackButton fallback={STAFF.tabRoute} label={STAFF.title.toUpperCase()} />
  if (!t)
    return (
      <div className="flex flex-col gap-4">
        <PageHeader back={back} />
        <Empty>{STAFF.notFound}</Empty>
      </div>
    )
  const manage = can.editTeam(t)
  const stamp = stampOf(t)
  const me = currentUserId()
  const u = shared?.get(t.id)
  const linkCls = 'card flex items-center justify-between gap-3 px-3 py-2 hover:border-accent'
  return (
    <div className="flex flex-col gap-4">
      {/* Ordinateur : fermer le panneau ; sinon pas de rangée (le ⋮ est au bout du nom, comme la fiche joueur, 31/10). */}
      <PageHeader back={back} />
      {editing && (
        <FormWindow title="Modifier le groupe de travail" onClose={() => setEditing(false)}>
          <TeamForm key={t.id} team={t} onDone={() => setEditing(false)} />
        </FormWindow>
      )}
      {stampOpen && stamp && <StampWindow stamp={stamp} title="Infos du groupe de travail" onClose={() => setStampOpen(false)} />}
      <div>
        {/* Le nom, et au bout de la rangée le ⋮ (Modifier, Copier le lien, Supprimer en dernier, avec confirmation). */}
        <div className="flex items-start justify-between gap-2">
          <h1 className="flex min-w-0 items-center gap-2 text-lg font-extrabold">
            <Icon name="users" className="h-4 w-4 shrink-0 text-muted" />
            <span className="min-w-0 break-words">{t.name}</span>
          </h1>
          {!editing && (
            <div className="flex shrink-0 items-center gap-1">
              <HeaderMenu
                title={t.name}
                subtitle={STAFF.count(t.members.length)}
                items={[
                  manage && { label: 'Modifier', icon: 'pencil', onSelect: () => setEditing(true) },
                  { label: 'Copier le lien', icon: 'copy', onSelect: () => copyLink(workGroupPath(t.id)) },
                  // Création, dernière modification (avec les dates) : seulement s'il y a quelque chose à dire.
                  stamp && { label: 'Infos du groupe de travail', icon: 'clock', hint: 'création, dernière modification', onSelect: () => setStampOpen(true) },
                  manage && {
                    label: 'Supprimer',
                    icon: 'trash',
                    danger: true,
                    onSelect: async () => {
                      if (!(await ask(STAFF.confirmDelete(t.name), { ok: 'Supprimer', focusCancel: true }))) return
                      await remove('teams', t.id)
                      nav(STAFF.tabRoute, { replace: true })
                    },
                  },
                ]}
              />
            </div>
          )}
        </div>
        {t.description && <div className="text-xs text-muted">{t.description}</div>}
      </div>

      <section className="flex flex-col gap-1.5">
        <div className="section-title mb-0">
          {STAFF.membersLabel} ({t.members.length})
        </div>
        <p className="text-sm">{t.members.length ? t.members.map((m) => (m === me ? 'toi' : t.names?.[m] || '?')).join(', ') : STAFF.count(0)}</p>
      </section>

      {!u?.groups.length && !u?.events.length && <p className="text-[11px] text-muted">{STAFF.sharedNone}</p>}

      {!!u?.groups.length && (
        <section className="flex flex-col gap-2">
          <div className="section-title mb-0">
            {STAFF.sharedGroups} ({u.groups.length})
          </div>
          {u.groups.map((g) => (
            <Link key={g.id} to={`/groupes/${g.id}`} className={`${linkCls} ${g.archived ? 'opacity-60' : ''}`}>
              <span className="min-w-0 truncate text-sm font-bold">
                {g.name}
                {g.archived && <span className="ml-2 text-[10px] font-normal text-muted">archivé</span>}
              </span>
              <span className="shrink-0 text-xs font-bold text-muted">{plural(g.playerIds.length, 'joueur')}</span>
            </Link>
          ))}
        </section>
      )}

      {!!u?.events.length && (
        <section className="flex flex-col gap-2">
          <div className="section-title mb-0">
            {STAFF.sharedEvents} ({u.events.length})
          </div>
          {u.events.map((e) => (
            <Link key={e.id} to={`/evenements/${e.id}`} className={`${linkCls} ${e.archived ? 'opacity-60' : ''}`}>
              <span className="min-w-0">
                <span className="block truncate text-sm font-bold">
                  {e.name}
                  {e.archived && <span className="ml-2 text-[10px] font-normal text-muted">archivé</span>}
                </span>
                <span className="block truncate text-[11px] text-muted">{[fmtDate(e.date), e.place].filter(Boolean).join(' · ')}</span>
              </span>
              <span className="shrink-0 text-xs font-bold text-muted">{plural(e.playerIds?.length ?? 0, 'joueur')}</span>
            </Link>
          ))}
        </section>
      )}
    </div>
  )
}

/** Création ou modification d'un groupe de travail : nom, description, membres (encadrants). Dans une <FormWindow>. */
function TeamForm({ team, onDone }: { team?: Team; onDone: (t?: Team) => void }) {
  const role = useRole()
  const [name, setName] = useState(team?.name ?? '')
  const [description, setDescription] = useState(team?.description ?? '')
  // Nouveau groupe de travail créé par un encadrant : il en fait partie d'office (il peut se décocher).
  const me = currentUserId()
  const [members, setMembers] = useState<string[]>(team?.members ?? (me && role === 'preparateur' ? [me] : []))
  const [names, setNames] = useState<Record<string, string>>({})
  const canPick = useCanPickStaff()
  const chip = (on: boolean) =>
    `rounded-md border px-2.5 py-1.5 text-xs font-bold ${on ? 'border-accent bg-accent text-white' : 'border-line bg-panel-2 text-muted hover:text-fg'}`
  return (
    <div className="flex flex-col gap-2">
      <span className="label">{STAFF.nameLabel}</span>
      <input className="field" autoFocus={!team} maxLength={80} placeholder={STAFF.namePlaceholder} value={name} onChange={(e) => setName(e.target.value)} />
      <span className="label">Description</span>
      <input className="field" maxLength={300} placeholder={STAFF.descriptionPlaceholder} value={description} onChange={(e) => setDescription(e.target.value)} />
      <span className="label mt-1">{STAFF.membersLabel}</span>
      <p className="-mt-1 text-[11px] text-muted">{STAFF.membersHelp}</p>
      {canPick ? (
        <StaffPicker value={members} onChange={setMembers} includeSelf onNames={setNames} chip={chip} />
      ) : (
        <p className="text-[11px] text-muted">{STAFF.offline}</p>
      )}
      <FormActions className="mt-2 flex gap-2">
        <button
          className="btn-primary flex-1"
          disabled={!name.trim()}
          onClick={async () => {
            const current = team && (await db.teams.get(team.id))
            const fields = {
              name: name.trim(),
              description: description.trim() || undefined,
              members,
              // Noms pour l'affichage hors ligne (le serveur les reprend des profils).
              names: Object.fromEntries(members.map((u) => [u, names[u] ?? current?.names?.[u] ?? ''])),
            }
            onDone(await save<Team>('teams', current ? { ...current, ...fields } : { id: newId(), ...fields }))
          }}
        >
          {team ? 'Enregistrer' : 'Créer'}
        </button>
        <button className="btn text-muted" onClick={() => onDone()}>
          Annuler
        </button>
      </FormActions>
    </div>
  )
}
