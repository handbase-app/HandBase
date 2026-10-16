import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { alive, db } from '../db'
import { defaultOrganizer, organizerChoices } from '../eventOrganizer'
import { currentUserId, useRole } from '../roles'
import { fold } from './PlayerFilter'

/*
 * Champ « Organisé par » d'un événement (src/eventOrganizer.ts, supabase/048_evenements_organisateur.sql).
 *  - Création (`auto`) : l'unité du créateur est posée d'office dès que la structure est lue (une seule : celle-ci ; plusieurs :
 *    la plus proche du terrain), tant qu'on n'a pas touché au champ. Sans affectation : vide, facultatif.
 *  - Compte non administrateur : liste courte de ses unités (plus l'unité déjà choisie, en modification).
 *  - Administrateur : toutes les unités, champ de recherche (comme le choix des comptes dans Structure), défilement infini.
 */

export interface OrganizerValue {
  id: string
  name?: string
}

const STEP = 50

export function OrganizerField({ value, onChange, auto = false }: { value: OrganizerValue; onChange: (v: OrganizerValue) => void; auto?: boolean }) {
  const role = useRole()
  const admin = role === 'admin'
  const uid = currentUserId()
  // undefined tant que la structure n'est pas lue (pour ne poser le défaut qu'une fois les données là).
  const data = useLiveQuery(async () => ({ units: await db.units.toArray(), levels: await db.levels.toArray(), assignments: await db.assignments.toArray() }), [])
  const choices = useMemo(
    () => (data ? organizerChoices({ ...data, userId: uid, admin, current: value.id || undefined }) : []),
    // value.id seulement : une unité choisie ailleurs reste proposée.
    [data, uid, admin, value.id],
  )
  const touched = useRef(false)
  useEffect(() => {
    if (!auto || !data || touched.current || value.id) return
    touched.current = true
    const id = defaultOrganizer({ ...data, userId: uid })
    const u = id && data.units.find((x) => x.id === id)
    if (u) onChange({ id: u.id, name: u.name })
  }, [auto, data, uid, value.id, onChange])
  const set = (id: string) => {
    touched.current = true
    const u = choices.find((x) => x.id === id)
    onChange(u ? { id: u.id, name: u.name } : id && id === value.id ? value : { id: '' })
  }

  // Précision sous le nom : niveau et unité parente (« Comité · Ligue Région Sud ») ; calculée une fois (milliers d'unités).
  const details = useMemo(() => {
    const units = alive(data?.units ?? [])
    const byId = new Map(units.map((u) => [u.id, u]))
    const levels = new Map((data?.levels ?? []).filter((l) => !l.deleted).map((l) => [l.id, l.name]))
    return new Map(units.map((u) => [u.id, [levels.get(u.levelId), u.parentId ? byId.get(u.parentId)?.name : undefined].filter(Boolean).join(' · ')]))
  }, [data])
  const detail = (id: string) => details.get(id) ?? ''

  const hint = <p className="-mt-1 text-[11px] text-muted">Le voient : les personnes de ce territoire et des unités au-dessus, plus les participants.</p>
  if (!data) return null
  if (!admin && !choices.length)
    return (
      <>
        <span className="label mt-1">Organisé par</span>
        <p className="-mt-1 text-[11px] text-muted">Tu n’es affecté à aucune unité : organisateur non précisé (facultatif).</p>
      </>
    )
  return (
    <>
      <span className="label mt-1">Organisé par</span>
      {admin ? (
        <UnitSearch choices={choices} value={value} onPick={set} detail={detail} />
      ) : (
        <select className={`field ${value.id ? 'font-bold' : ''}`} aria-label="Organisé par" value={value.id} onChange={(e) => set(e.target.value)}>
          <option value="">Organisateur non précisé</option>
          {/* Unité déjà choisie mais absente de l'appareil (supprimée depuis) : gardée telle quelle. */}
          {value.id && !choices.some((u) => u.id === value.id) && <option value={value.id}>{value.name ?? 'Unité retirée de la structure'}</option>}
          {choices.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </select>
      )}
      {hint}
    </>
  )
}

/** Administrateur : recherche dans toutes les unités (nom, sans accents, tous les mots), 50 de plus en arrivant en bas. */
function UnitSearch({
  choices,
  value,
  onPick,
  detail,
}: {
  choices: { id: string; name: string }[]
  value: OrganizerValue
  onPick: (id: string) => void
  detail: (id: string) => string
}) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const [limit, setLimit] = useState(STEP)
  const listId = useId()
  const words = fold(q).split(/\s+/).filter(Boolean)
  const found = words.length ? choices.filter((u) => words.every((w) => fold(`${u.name} ${detail(u.id)}`).includes(w))) : choices
  const shown = found.slice(0, limit)
  const pick = (id: string) => {
    onPick(id)
    setQ('')
    setActive(0)
    setLimit(STEP)
    setOpen(false)
  }
  const chosen = value.id ? (choices.find((u) => u.id === value.id)?.name ?? value.name ?? 'Unité') : ''
  return (
    <div className="flex flex-col gap-1.5">
      {value.id && (
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            className="inline-flex min-h-9 max-w-full items-center gap-1 rounded-full border border-accent bg-accent/15 px-2.5 text-xs font-bold"
            aria-label={`Retirer ${chosen} (organisateur non précisé)`}
            onClick={() => onPick('')}
          >
            <span className="truncate">{chosen}</span> <span className="opacity-70">✕</span>
          </button>
        </div>
      )}
      <div className="relative">
        <input
          className="field min-h-11 w-full py-1 text-xs"
          type="search"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && shown[active] ? `${listId}-${active}` : undefined}
          aria-label="Chercher l’unité organisatrice"
          placeholder={value.id ? `Changer (${choices.length} unités) : nom…` : `Choisir une unité (${choices.length}) : nom, niveau…`}
          value={q}
          onFocus={() => setOpen(true)}
          onClick={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onChange={(e) => {
            setQ(e.target.value)
            setActive(0)
            setLimit(STEP)
            setOpen(true)
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              setOpen(true)
              setActive((i) => {
                const n = Math.min(i + 1, Math.max(0, found.length - 1))
                if (n >= limit) setLimit((l) => l + STEP)
                document.getElementById(`${listId}-${n}`)?.scrollIntoView({ block: 'nearest' })
                return n
              })
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              setActive((i) => {
                const n = Math.max(0, i - 1)
                document.getElementById(`${listId}-${n}`)?.scrollIntoView({ block: 'nearest' })
                return n
              })
            } else if (e.key === 'Enter' && open && shown[active]) {
              e.preventDefault()
              pick(shown[active].id)
            } else if (e.key === 'Escape' && open) {
              e.stopPropagation()
              setOpen(false)
            }
          }}
        />
        {open && (
          <div
            id={listId}
            role="listbox"
            className="absolute inset-x-0 top-full z-30 mt-1 flex max-h-80 flex-col overflow-y-auto rounded-md border border-line bg-panel shadow-lg"
            onScroll={(e) => {
              const el = e.currentTarget
              if (limit < found.length && el.scrollTop + el.clientHeight >= el.scrollHeight - 120) setLimit((n) => n + STEP)
            }}
          >
            {shown.map((u, i) => (
              <div
                key={u.id}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={u.id === value.id}
                className={`flex min-h-11 cursor-pointer flex-col justify-center px-3 py-1 text-xs ${i === active ? 'bg-panel-2' : ''}`}
                // mousedown : choisi avant que le champ perde la main (sinon la liste se ferme avant le clic).
                onMouseDown={(e) => {
                  e.preventDefault()
                  pick(u.id)
                }}
                onMouseEnter={() => setActive(i)}
              >
                <span className={`truncate ${u.id === value.id ? 'font-extrabold text-accent' : 'font-bold'}`}>{u.name}</span>
                {detail(u.id) && <span className="truncate text-[10px] text-muted">{detail(u.id)}</span>}
              </div>
            ))}
            {!found.length && <p className="p-2 text-[11px] text-muted">{choices.length ? 'Aucune unité ne correspond.' : 'Aucune unité dans la structure (Réglages > Structure et sport).'}</p>}
            {limit < found.length && <p className="p-2 text-center text-[11px] text-muted">Chargement de la suite…</p>}
          </div>
        )}
      </div>
    </div>
  )
}
