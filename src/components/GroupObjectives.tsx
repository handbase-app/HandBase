import { useLiveQuery } from 'dexie-react-hooks'
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { alive, db, fmtDate, newId, saveMany, today, type Player } from '../db'
import { accord, pluralG, w, type Gender } from '../gender'
import { templatesOf } from '../goalTemplates'
import {
  checkGift,
  chunks,
  GIFT_ERRORS,
  giftStatus,
  giftSummary,
  giftsFrom,
  giveToMany,
  reachedLabel,
  SKIP_LABEL,
  stepsLabel,
  withdrawGift,
  type GiftFrom,
  type GiftView,
  type SkipReason,
} from '../groupObjectives'
import { useConfigRows } from '../installation'
import { fetchChecksMany } from '../myGoalsApi'
import { badVideoUrl, OBJ_TEXT_MAX } from '../objectives'
import { nextEventFor, periodLabel } from '../period'
import { can, useRole } from '../roles'
import { ReadOnlyError } from '../spy'
import { ask, inform } from './Confirm'
import { FormActions, FormWindow } from './FormWindow'
import { ItemMenu, type MenuAnchor, type MenuItem } from './ItemMenu'
import { StepsEditor, VideoField, type StepDraft } from './Objectives'
import { PeriodPicker, type PeriodValue } from './PeriodPicker'
import { Icon } from './ui'

/*
 * « Donner un objectif au groupe » et « Objectifs donnés » (04/11 ; partie pure : src/groupObjectives.ts), sur la page d'un
 * groupe et sur celle d'un événement (onglet Joueurs) :
 *  - l'action est dans le ⋮ du titre (useGiveObjective → `item`) ; elle ouvre une fenêtre (fond flouté ; ✕, Échap ou Retour
 *    du téléphone la ferment) : titre, lien vidéo, étapes, « Depuis un modèle » (bulle accrochée au bouton), la période
 *    (PeriodPicker : « 2 semaines », « Jusqu'au prochain stage » commun aux joueurs cochés…), et les joueurs concernés, tous cochés (ou ceux de la sélection en cours), décochables ; ceux qu'on ne peut pas
 *    servir sont dits (« pas modifiable par toi », « déjà 3 objectifs en cours ») et passés. « Donner à N joueurs » écrit une
 *    copie dans chaque fiche (saveMany, par lots : synchronisation comme le reste), puis un résumé s'affiche sur la page.
 *  - « Objectifs donnés » : section repliée sous le titre, seulement s'il y en a ; la période, l'avancement de chaque envoi et
 *    « Retirer à tous » (confirmation).
 * Clavier seulement : rien ne part vers une IA.
 */

/** Même règle que la carte de la fiche (ObjectivesCard) : encadrant, fiche qu'il peut modifier. */
export function useCanEditPlayer() {
  const role = useRole()
  return useCallback((p: Player) => can.editPlayers(role) && can.editPlayer(role, p), [role])
}

const nameOf = (p: Player) => `${p.lastName.toUpperCase()} ${p.firstName}`

/**
 * Action « Donner un objectif au groupe » (pour le ⋮ du titre) et ce qu'elle affiche (fenêtre, résumé, « Objectifs donnés »).
 * `players` : les joueurs de la page, dans l'ordre de la liste ; `selected` : la sélection en cours de la liste, s'il y en a
 * une (ceux-là seuls cochés d'office) ; `event` : l'événement relié d'office (page d'un événement).
 */
export function useGiveObjective({
  players,
  from,
  gender,
  event,
  selected,
}: {
  players: readonly Player[]
  from: GiftFrom
  gender?: Gender
  event?: { id: string; name: string; date?: string }
  selected?: () => readonly string[]
}): { item: MenuItem | false; ui: ReactNode } {
  const canEdit = useCanEditPlayer()
  const [open, setOpen] = useState<{ checked: string[] } | null>(null)
  const [msg, setMsg] = useState('')
  useEffect(() => setMsg(''), [from.id])
  const any = players.some(canEdit)
  const item: MenuItem | false = any && {
    // Libellé court (le menu fait 256 px) ; la fenêtre dit « Donner un objectif au groupe ».
    label: 'Donner un objectif',
    icon: 'target',
    hint: `au groupe : une copie par fiche`,
    onSelect: () => {
      const sel = new Set(selected?.() ?? [])
      const inList = players.filter((p) => sel.has(p.id))
      setMsg('')
      setOpen({ checked: (inList.length ? inList : players).map((p) => p.id) })
    },
  }
  const ui = (
    <>
      {open && (
        <GiveObjectiveWindow
          players={players}
          initial={open.checked}
          from={from}
          event={event}
          gender={gender}
          canEdit={canEdit}
          onClose={() => setOpen(null)}
          onDone={(text) => (setOpen(null), setMsg(text))}
        />
      )}
      <GivenObjectives from={from} gender={gender} msg={msg} onMsg={setMsg} canEdit={canEdit} />
    </>
  )
  return { item, ui }
}

// ---------- Fenêtre « Donner un objectif au groupe » ----------

function GiveObjectiveWindow({
  players,
  initial,
  from,
  event,
  gender,
  canEdit,
  onClose,
  onDone,
}: {
  players: readonly Player[]
  initial: string[]
  from: GiftFrom
  event?: { id: string; name: string; date?: string }
  gender?: Gender
  canEdit: (p: Player) => boolean
  onClose: () => void
  onDone: (summary: string) => void
}) {
  const gw = w(gender)
  const templates = templatesOf(useConfigRows())
  const [text, setText] = useState('')
  const [video, setVideo] = useState('')
  const [steps, setSteps] = useState<StepDraft[]>([])
  const [period, setPeriod] = useState<PeriodValue>({})
  const [checked, setChecked] = useState<Set<string>>(() => new Set(initial))
  const [menu, setMenu] = useState<MenuAnchor | null>(null)
  // Modèle choisi : l'éditeur d'étapes repart de ses étapes.
  const [stepsKey, setStepsKey] = useState(0)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  // Qui peut le recevoir (droits, place, déjà donné d'ici avec ce titre) : recalculé quand le titre change.
  const status = useMemo(() => new Map(players.map((p) => [p.id, giftStatus(p, { text }, from, canEdit)])), [players, text, from, canEdit])
  const ready = players.filter((p) => status.get(p.id) === 'ok')
  const willGet = ready.filter((p) => checked.has(p.id))
  const skipped = players.filter((p) => status.get(p.id) !== 'ok')
  const where = from.kind === 'groupe' ? `groupe ${from.name}` : from.name
  // « Jusqu'au prochain stage » : le prochain événement à venir commun à tous les joueurs cochés (aucun : pastille cachée).
  const allEvents = useLiveQuery(() => db.events.toArray(), [])
  const nextEvent = nextEventFor(allEvents ?? [], willGet.map((p) => p.id), today())

  async function give() {
    const c = checkGift({ text, video, steps, ...period })
    if (!c.ok) return setErr(GIFT_ERRORS[c.error])
    if (!willGet.length) return setErr(GIFT_ERRORS.personne)
    setBusy(true)
    try {
      // Fiches relues juste avant l'écriture (une modification arrivée entre-temps n'est pas écrasée).
      const fresh = alive((await db.players.bulkGet(willGet.map((p) => p.id))).filter((p): p is Player => !!p))
      const r = giveToMany(fresh, c.gift, from, { canEdit, newId, batch: newId(), day: today(), event })
      for (const part of chunks(r.rows)) await saveMany<Player>('players', part)
      // Résumé : ceux qu'on a décochés ne comptent pas ; ceux qu'on ne pouvait pas servir sont dits (une fois chacun).
      const passed = new Map<string, SkipReason>(skipped.map((p) => [p.id, status.get(p.id) as SkipReason]))
      for (const x of r.skipped) passed.set(x.id, x.why)
      onDone(giftSummary({ given: r.given, skipped: [...passed].map(([id, why]) => ({ id, why })) }, gender))
    } catch (e) {
      if (e instanceof ReadOnlyError) return void inform('Lecture seule (« Voir comme… ») : rien n’a été changé.')
      throw e
    } finally {
      setBusy(false)
    }
  }

  const toggle = (id: string) =>
    setChecked((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })

  return (
    <FormWindow title="Donner un objectif au groupe" onClose={onClose} width={600}>
      <p className="text-[11px] text-muted">
        Une copie dans la fiche de chaque {gw.joueur} {accord('coché', gender)}, avec la mention « {where} » : {gender === 'F' ? 'chacune' : 'chacun'} coche ses étapes sur sa page. Court et dit en positif
        (« Courir 20 minutes par jour »).
      </p>
      <div className="flex flex-col gap-1">
        <div className="flex items-end justify-between gap-2">
          <span className="label mb-0">Objectif</span>
          {templates.length > 0 && (
            <button
              type="button"
              className="min-h-10 rounded-full px-2 text-xs font-bold text-accent hover:bg-accent/10"
              aria-haspopup="menu"
              aria-expanded={!!menu}
              onClick={(e) => {
                const r = e.currentTarget.getBoundingClientRect()
                setMenu({ x: r.right, y: r.bottom, top: r.top, alignRight: true })
              }}
            >
              <Icon name="list" className="mr-1 inline h-3.5 w-3.5" />
              Depuis un modèle
            </button>
          )}
        </div>
        <input
          className="field min-h-11 w-full"
          maxLength={OBJ_TEXT_MAX}
          placeholder="Ex. : Courir 20 minutes par jour"
          aria-label="Objectif"
          autoFocus
          value={text}
          onChange={(e) => (setErr(''), setText(e.target.value))}
        />
      </div>
      <VideoField value={video} onChange={(v) => (setErr(''), setVideo(v))} label="Lien vidéo de l’objectif" />
      <div className="flex flex-col gap-1">
        <span className="label mb-0">Étapes</span>
        <StepsEditor key={stepsKey} steps={steps} onChange={(s) => (setErr(''), setSteps(s))} />
      </div>
      <PeriodPicker value={period} nextEvent={nextEvent} onChange={(v) => (setErr(''), setPeriod(v))} />
      {event && <p className="text-[11px] text-muted">Relié à « {event.name} » : c’est d’où il vient, sur chaque fiche.</p>}

      <div className="flex flex-col gap-1" data-testid="joueurs-objectif">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="label mb-0">
            {gw.Joueurs} {accord('concerné', gender, 2)} ({willGet.length} sur {players.length})
          </span>
          {ready.length > 1 && (
            <span className="flex items-center gap-1">
              <button type="button" className="min-h-10 px-2 text-[11px] font-bold text-accent" onClick={() => setChecked(new Set(ready.map((p) => p.id)))}>
                Tous
              </button>
              <button type="button" className="min-h-10 px-2 text-[11px] font-bold text-muted" onClick={() => setChecked(new Set())}>
                Aucun
              </button>
            </span>
          )}
        </div>
        <ul className="flex max-h-72 flex-col overflow-y-auto rounded-lg border border-line">
          {players.map((p) => {
            const st = status.get(p.id)
            const ok = st === 'ok'
            return (
              <li key={p.id} className="border-b border-line last:border-b-0">
                <label className={`flex min-h-11 items-center gap-2 px-2 ${ok ? 'cursor-pointer' : 'opacity-70'}`}>
                  <input type="checkbox" className="h-5 w-5 shrink-0 accent-[var(--color-accent)]" disabled={!ok} checked={ok && checked.has(p.id)} onChange={() => toggle(p.id)} />
                  <span className="min-w-0 flex-1 truncate text-sm">{nameOf(p)}</span>
                  {!ok && st && <span className="shrink-0 text-[10px] text-muted">{SKIP_LABEL[st]}</span>}
                </label>
              </li>
            )
          })}
        </ul>
        {skipped.length > 0 && (
          <p className="text-[10px] text-muted">
            {pluralG(skipped.length, gender)} {skipped.length > 1 ? 'seront' : 'sera'} {accord('passé', gender, skipped.length)} : rien n’est écrasé sur {skipped.length > 1 ? 'leur fiche' : 'sa fiche'}.
          </p>
        )}
      </div>
      {err && <p className="text-[11px] text-red-500">{err}</p>}
      <FormActions>
        <button type="button" className="btn-primary min-h-10 px-4 text-xs" disabled={busy || !text.trim() || !willGet.length || steps.some((s) => s.text.trim() && badVideoUrl(s.video))} onClick={() => void give()}>
          Donner à {pluralG(willGet.length, gender)}
        </button>
        <button type="button" className="btn-ghost min-h-10 px-4 text-xs" onClick={onClose}>
          Annuler
        </button>
      </FormActions>
      {menu && (
        <ItemMenu
          anchor={menu}
          title="Depuis un modèle"
          subtitle="L’objectif et ses étapes, à adapter ensuite"
          onClose={() => setMenu(null)}
          items={templates.map((t) => ({
            label: t.text,
            hint: t.steps.length ? `${t.steps.length} étape${t.steps.length > 1 ? 's' : ''}` : 'Sans étape',
            icon: 'target',
            onSelect: () => {
              setErr('')
              setText(t.text)
              setVideo(t.video ?? '')
              setSteps(t.steps.map((s) => ({ id: newId(), text: s.text, ...(s.video ? { video: s.video } : {}) })))
              setStepsKey((k) => k + 1)
            },
          }))}
        />
      )}
    </FormWindow>
  )
}

// ---------- « Objectifs donnés » ----------

/** Les fiches qui portent un objectif donné d'ici (toutes celles de l'appareil : un joueur sorti du groupe garde le sien). */
function useGiftHolders(from: Pick<GiftFrom, 'kind' | 'id'>) {
  return useLiveQuery(
    () => db.players.filter((p) => !p.deleted && Array.isArray(p.objectives) && p.objectives.some((o) => o?.source?.kind === from.kind && o.source.id === from.id)).toArray(),
    [from.kind, from.id],
  )
}

function GivenObjectives({ from, gender, msg, onMsg, canEdit }: { from: GiftFrom; gender?: Gender; msg: string; onMsg: (m: string) => void; canEdit: (p: Player) => boolean }) {
  const holders = useGiftHolders(from)
  const [open, setOpen] = useState(false)
  // Coches du jeune (065), lues quand la section est ouverte : l'avancement les compte (sinon celles du staff seulement).
  const [checks, setChecks] = useState<Record<string, Record<string, string>>>({})
  const ids = (holders ?? []).map((p) => p.id).join(',')
  useEffect(() => {
    if (!open || !ids) return
    let live = true
    void fetchChecksMany(ids.split(',')).then((c) => live && setChecks(c))
    return () => {
      live = false
    }
  }, [open, ids])
  // Un objectif vient d'être donné : la section s'ouvre sur lui.
  useEffect(() => {
    if (msg) setOpen(true)
  }, [msg])
  const gifts = giftsFrom(holders ?? [], from, checks)
  if (!gifts.length && !msg) return null

  async function withdraw(v: GiftView) {
    if (!(await ask(`Retirer « ${v.text} » à ${pluralG(v.total, gender)} ? Il disparaît de ${v.total > 1 ? 'leur fiche et de leur page' : 'sa fiche et de sa page'}, avec ses étapes cochées.`, { ok: 'Retirer à tous', focusCancel: true }))) return
    try {
      const fresh = alive((await db.players.bulkGet(v.players.map((x) => x.id))).filter((p): p is Player => !!p))
      const r = withdrawGift(fresh, v.batch, canEdit)
      for (const part of chunks(r.rows)) await saveMany<Player>('players', part)
      onMsg(
        `« ${v.text} » retiré à ${pluralG(r.removed.length, gender)}${r.kept.length ? ` ; ${pluralG(r.kept.length, gender)} ${r.kept.length > 1 ? 'le gardent' : 'le garde'} (fiche pas modifiable par toi)` : ''}.`,
      )
    } catch (e) {
      if (e instanceof ReadOnlyError) return void inform('Lecture seule (« Voir comme… ») : rien n’a été changé.')
      throw e
    }
  }

  return (
    <section className="flex flex-col gap-1.5" data-testid="objectifs-donnes">
      {msg && (
        <p role="status" className="flex items-start gap-1.5 text-[11px] text-emerald-500">
          <Icon name="check" className="mt-px h-3.5 w-3.5 shrink-0" />
          {msg}
        </p>
      )}
      {gifts.length > 0 && (
        <div className="rounded-lg border border-line">
          <button type="button" className="flex min-h-10 w-full items-center gap-2 px-3 text-left text-xs font-bold" aria-expanded={open} onClick={() => setOpen(!open)}>
            <Icon name="target" className="h-3.5 w-3.5 text-accent" />
            <span className="min-w-0 flex-1">Objectifs donnés ({gifts.length})</span>
            <Icon name="chevron" className={`h-4 w-4 shrink-0 text-muted transition-transform ${open ? 'rotate-90' : ''}`} />
          </button>
          {open && (
            <ul className="flex flex-col gap-2 border-t border-line p-2">
              {gifts.map((v) => {
                const editable = v.players.some((x) => {
                  const p = holders?.find((h) => h.id === x.id)
                  return !!p && canEdit(p)
                })
                const pct = v.total ? Math.round((v.reached / v.total) * 100) : 0
                return (
                  <li key={v.batch} className="flex flex-col gap-1 rounded-lg bg-panel-2 p-2.5" data-testid="objectif-donne">
                    <div className="flex items-start gap-2">
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-bold break-words">{v.text}</span>
                        <span className="block text-[11px] text-muted">
                          {[v.at && `donné le ${fmtDate(v.at)}`, periodLabel({ from: v.from, due: v.due, date: v.at }, today()), v.steps && `${v.steps} étape${v.steps > 1 ? 's' : ''}`].filter(Boolean).join(' · ')}
                        </span>
                      </span>
                      {editable && (
                        <button type="button" className="min-h-10 shrink-0 rounded-full px-2 text-[11px] font-bold text-muted hover:bg-panel hover:text-fg" onClick={() => void withdraw(v)}>
                          Retirer à tous
                        </button>
                      )}
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-line" aria-hidden>
                      <div className="h-full rounded-full bg-emerald-500" style={{ width: `${pct}%` }} />
                    </div>
                    <span className="text-[11px]">
                      <b>{reachedLabel(v, gender)}</b>
                      {stepsLabel(v) && <span className="text-muted"> · {stepsLabel(v)}</span>}
                    </span>
                  </li>
                )
              })}
              <li className="px-1 text-[10px] text-muted">Pour changer le texte pour tous : retire-le, puis donne-le de nouveau.</li>
            </ul>
          )}
        </div>
      )}
    </section>
  )
}
