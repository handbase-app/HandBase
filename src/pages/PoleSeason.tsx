import { useLiveQuery } from 'dexie-react-hooks'
import { Fragment, useEffect, useId, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useParams } from 'react-router-dom'
import { BackButton, useGoBack } from '../backNav'
import { ask } from '../components/Confirm'
import { PlayerList } from '../components/Pictos'
import { PlayerRow } from '../components/PlayerRow'
import { cancelArrivalOne, ExitReasonDialog, fmtDay, fmtLongDay, programmeLabel, reopenPoleOne, upcomingArrival, usePoleLeader, usePoleMembers, usePoleRef } from '../components/PoleGroup'
import { Empty, Segmented } from '../components/ui'
import { db, POLE_EXITS, POLE_PROGRAMMES, poleName, save, type Player, type PoleExit, type PoleProgramme } from '../db'
import { pluralG, setGender, w } from '../gender'
import { MQ, useMedia } from '../layout'
import { applySeason, batchSize, likelyEnd, otherPoleAt, periodIndexAt, SEASON_CONFIRM, seasonSummary, suggestProgramme, type SeasonBatch } from '../poleSeason'
import { regionLabel } from '../lists'
import { AddPlayers } from './Events'

/*
 * Changement de saison d'un groupe Pôle (/groupes/:id/saison ; src/poleSeason.ts). Deux colonnes sur ordinateur, deux
 * onglets sur téléphone :
 *  - à gauche « Effectif <saison en cours> » : chaque membre d'aujourd'hui avec une case « Reconduire » (cochée d'office) et
 *    une proposition jamais imposée (« fin de cursus probable » quand l'année de naissance sort du programme) ; décocher =
 *    sortant, avec son motif demandé tout de suite ; une sortie déjà enregistrée se « Rétablit » ;
 *  - à droite « Effectif <saison prochaine> » : reconduits, nouveaux déjà enregistrés (entrée à venir) et nouveaux choisis
 *    ici (« Ajouter des joueurs », programme déduit de l'âge, modifiable).
 * « Enregistrer » montre le récapitulatif et les deux dates (sortie 30 juin, entrée 1er juillet, modifiables une fois pour
 * tout le lot), puis écrit : sortants → sortie + motif ; nouveaux → nouvelle période ; reconduits → rien. Un nouveau
 * déjà enregistré (entrée à venir) s'annule depuis le menu de sa ligne : « Annuler l’arrivée » retire sa période.
 * Réservé aux dirigeants du pôle et aux administrateurs (can.editPoles).
 */

type Tab = 'courante' | 'prochaine'

export default function PoleSeason() {
  const { id = '' } = useParams()
  const g = useLiveQuery(() => db.groups.get(id), [id])
  const ref = usePoleRef(g?.poleUnitId)
  const leader = usePoleLeader()
  const m = usePoleMembers(ref)
  const side = useMedia(MQ.side)
  const goBack = useGoBack(`/groupes/${id}`)
  const [tab, setTab] = useState<Tab>('courante')
  // Sortants choisis ici (motif), nouveaux choisis ici (programme), fenêtres ouvertes.
  const [leaving, setLeaving] = useState<Record<string, PoleExit>>({})
  const [adding, setAdding] = useState<{ id: string; programme?: PoleProgramme }[]>([])
  const [asking, setAsking] = useState<Player | null>(null)
  const [picking, setPicking] = useState(false)
  const [recap, setRecap] = useState(false)
  const [done, setDone] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    setLeaving({})
    setAdding([])
    setDone(null)
  }, [id])

  if (g === undefined || !m) return <div className="py-20 text-center text-sm text-muted">Chargement…</div>
  if (!g || g.deleted || !g.poleUnitId) return <div className="py-20 text-center text-sm text-muted">Groupe introuvable.</div>
  if (!ref) return <div className="py-20 text-center text-sm text-muted">L’unité Pôle de ce groupe n’existe plus dans la structure.</div>
  if (!leader.leads(ref.unitId))
    return (
      <div className="flex flex-col gap-3">
        <BackButton fallback={`/groupes/${g.id}`} label={g.name.toUpperCase()} className="self-start" />
        <p className="py-10 text-center text-sm text-muted">Le changement de saison est réservé aux dirigeants de ce pôle et aux administrateurs.</p>
      </div>
    )

  const { s, players, current, next } = m
  const gg = setGender(ref.sex ?? g.sex, current)
  const gw = w(gg)
  const fem = gg === 'F'
  const RECONDUIT = fem ? 'reconduite' : 'reconduit'
  const SORTANT = fem ? 'sortante' : 'sortant'
  const nextYear = Number(s.next.from.slice(0, 4))
  const byId = new Map(players.map((p) => [p.id, p]))
  const currentIds = new Set(current.map((p) => p.id))
  const nextIds = new Set(next.map((p) => p.id))
  /** Sortie déjà enregistrée (fin de la saison en cours, ou plus tôt) : plus dans la vue prochaine. */
  const alreadyOut = (p: Player) => currentIds.has(p.id) && !nextIds.has(p.id)
  const periodOf = (p: Player) => p.poles![periodIndexAt(p, ref, s.refCurrent)]
  const likely = (p: Player) => likelyEnd(p, periodOf(p), ref.levels, nextYear)

  // Colonne de droite : reconduits (cochés à gauche), nouveaux déjà enregistrés, nouveaux choisis ici.
  const kept = current.filter((p) => !alreadyOut(p) && !leaving[p.id])
  const savedNew = next.filter((p) => !currentIds.has(p.id))
  const pending = adding.map((a) => ({ ...a, p: byId.get(a.id) })).filter((a): a is typeof a & { p: Player } => !!a.p)
  const batch: SeasonBatch = {
    keep: kept.map((p) => p.id),
    leave: Object.entries(leaving).map(([pid, reason]) => ({ id: pid, reason })),
    add: pending.map((a) => ({ id: a.id, programme: a.programme })),
  }
  const transfers = pending.filter((a) => otherPoleAt(a.p, ref, s.entry)).length
  const changed = batchSize(batch) > 0

  function uncheck(p: Player) {
    setAsking(p)
  }

  async function write(dates: { exit: string; entry: string }) {
    const n = batchSize(batch)
    if (n > SEASON_CONFIRM && !(await ask(`Enregistrer le changement de saison : ${n} fiches modifiées ?`, { ok: 'Enregistrer', danger: false }))) return
    setBusy(true)
    try {
      const writes = applySeason(players, ref!, batch, { day: s.refCurrent, exit: dates.exit, entry: dates.entry })
      for (const wr of writes) {
        const p = byId.get(wr.id)
        if (p) await save<Player>('players', { ...p, poles: wr.poles })
      }
      setDone(`Enregistré : ${seasonSummary(batch, fem, transfers)}. Sorties au ${fmtDay(dates.exit)}, entrées au ${fmtDay(dates.entry)}.`)
      setLeaving({})
      setAdding([])
      setRecap(false)
    } finally {
      setBusy(false)
    }
  }

  if (picking)
    return (
      <AddPlayers
        g={gg}
        scope="ajout-pole"
        current={[...nextIds, ...adding.map((a) => a.id)]}
        onCancel={() => setPicking(false)}
        onAdd={(ids) => {
          setAdding((a) => [...a, ...ids.filter((x) => !a.some((y) => y.id === x) && !nextIds.has(x)).map((x) => ({ id: x, programme: suggestProgramme(ref!.levels, byId.get(x) ?? {}, nextYear) }))])
          setPicking(false)
          setTab('prochaine')
        }}
      />
    )

  // ---------- Cellules (partagées par la grille de l'ordinateur et les onglets du téléphone) ----------

  /** Ligne de gauche : membre d'aujourd'hui, case « Reconduire », état, Motif / Rétablir. */
  const leftRow = (p: Player) => {
    const out = alreadyOut(p)
    const x = periodOf(p)
    const why = POLE_EXITS.find((e) => e.value === x?.exitReason)?.label.toLowerCase()
    const reason = leaving[p.id]
    const checkId = `keep-${p.id}`
    return (
      <PlayerRow
        key={p.id}
        p={p}
        className={`h-full ${reason || out ? 'opacity-80' : ''}`}
        link={{ to: `/groupes/${g.id}/joueurs/${p.id}`, state: { md: true } }}
        pictos={false}
        lead={
          out ? (
            <span className="w-5 shrink-0" aria-hidden />
          ) : (
            <input
              id={checkId}
              type="checkbox"
              className="relative z-[1] h-5 w-5 shrink-0 cursor-pointer accent-[var(--color-accent)]"
              checked={!reason}
              aria-label={`Reconduire ${p.lastName.toUpperCase()} ${p.firstName}`}
              onChange={(e) => (e.target.checked ? setLeaving(({ [p.id]: _x, ...rest }) => rest) : uncheck(p))}
            />
          )
        }
        lines={
          <span className="text-[11px]">
            {out ? (
              <span className="text-muted">
                Sortie enregistrée au {fmtDay(x?.to)}
                {why ? ` · ${why}` : ''}
              </span>
            ) : reason ? (
              <span className="font-bold text-amber-300">
                {fem ? 'Sortante' : 'Sortant'} au {fmtDay(s.exit)} · {POLE_EXITS.find((e) => e.value === reason)?.label.toLowerCase()}
              </span>
            ) : likely(p) ? (
              <span className="text-amber-300">Fin de cursus probable ({programmeLabel(x?.programme) || 'programme'} : année {p.birthDate?.slice(0, 4)})</span>
            ) : (
              <span className="text-muted">{x?.programme ? programmeLabel(x.programme) : 'Au pôle'}{x?.from ? ` · depuis le ${fmtDay(x.from)}` : ''}</span>
            )}
          </span>
        }
        actions={
          out ? (
            <button className="relative z-[1] shrink-0 rounded-md border border-line px-2 py-1 text-[11px] font-bold text-muted hover:border-accent hover:text-fg" onClick={() => void reopenPoleOne(p, ref!, s)}>
              Rétablir
            </button>
          ) : reason ? (
            <button className="relative z-[1] shrink-0 px-1 text-[11px] font-bold text-muted underline hover:text-fg" onClick={() => setAsking(p)}>
              Motif
            </button>
          ) : undefined
        }
      />
    )
  }
  /** Ligne de droite : reconduit. */
  const keptRow = (p: Player) => <PlayerRow key={p.id} p={p} link={{ to: `/groupes/${g.id}/joueurs/${p.id}`, state: { md: true } }} pictos={false} className="h-full" lines={<Tag kind="reconduit" g={gg} />} />
  /** Ligne de droite : nouveau déjà enregistré (entrée à venir) ; son menu propose « Annuler l’arrivée ». */
  const savedRow = (p: Player) => {
    const x = p.poles![periodIndexAt(p, ref, s.refNext)]
    const upcoming = upcomingArrival(p, ref, s, s.refNext)
    return (
      <PlayerRow
        key={p.id}
        p={p}
        link={{ to: `/groupes/${g.id}/joueurs/${p.id}`, state: { md: true } }}
        pictos={false}
        className="h-full"
        menuExtras={
          upcoming && [
            {
              label: 'Annuler l’arrivée',
              icon: 'close',
              hint: `prévue le ${fmtLongDay(upcoming.from)}`,
              onSelect: async () => {
                if (await cancelArrivalOne(p, ref, s, g.name, s.refNext)) setDone(`${p.lastName.toUpperCase()} ${p.firstName} : arrivée du ${fmtDay(upcoming.from)} annulée (période retirée de sa fiche).`)
              },
            },
          ]
        }
        lines={
          <span className="flex flex-wrap items-center gap-x-2 text-[11px]">
            <Tag kind="nouveau" g={gg} />
            <span className="text-muted">
              entrée enregistrée au {fmtDay(x?.from)}
              {x?.programme ? ` · ${programmeLabel(x.programme)}` : ''}
            </span>
          </span>
        }
      />
    )
  }
  /** Ligne de droite : nouveau choisi ici (programme modifiable, ✕). */
  const pendingRow = (a: (typeof pending)[number]) => {
    const other = otherPoleAt(a.p, ref, s.entry)
    return (
      <PlayerRow
        key={a.id}
        p={a.p}
        link={{ to: `/joueurs/${a.id}` }}
        pictos={false}
        className="h-full border-accent/60"
        lines={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]">
            <Tag kind="nouveau" g={gg} />
            {ref.levels.length > 1 ? (
              <select
                className="field min-h-8 w-auto py-0.5 text-[11px]"
                aria-label={`Programme de ${a.p.firstName} ${a.p.lastName}`}
                value={a.programme ?? ''}
                onChange={(e) => setAdding((l) => l.map((y) => (y.id === a.id ? { ...y, programme: (e.target.value || undefined) as PoleProgramme | undefined } : y)))}
              >
                <option value="">Programme…</option>
                {ref.levels.map((l) => (
                  <option key={l} value={l}>
                    {POLE_PROGRAMMES.find((o) => o.value === l)?.label ?? 'Accession'}
                  </option>
                ))}
              </select>
            ) : (
              <span className="text-muted">{programmeLabel(a.programme) || 'programme non précisé'}</span>
            )}
            {other && <span className="font-bold text-amber-300">déjà au {poleName(other, regionLabel)} : sa période y sera fermée au {fmtDay(s.exit)} (autre)</span>}
          </span>
        }
        actions={
          <button
            className="relative z-[1] flex h-8 w-8 shrink-0 items-center justify-center text-muted hover:text-red-400"
            title="Ne pas ajouter"
            aria-label={`Ne pas ajouter ${a.p.lastName.toUpperCase()} ${a.p.firstName}`}
            onClick={() => setAdding((l) => l.filter((y) => y.id !== a.id))}
          >
            ✕
          </button>
        }
      />
    )
  }
  /** Emplacement vide en face d'un joueur (ordinateur) : garde chaque joueur en face de lui-même. */
  const slot = (text: ReactNode) => <div className="flex h-full min-h-14 items-center rounded-xl border border-dashed border-line px-3 text-[11px] text-muted">{text}</div>
  /** Ce qui s'affiche à droite en face d'un sortant. */
  const outText = (p: Player) => {
    const x = periodOf(p)
    if (alreadyOut(p)) {
      const why = POLE_EXITS.find((e) => e.value === x?.exitReason)?.label.toLowerCase()
      return `Sortie enregistrée au ${fmtDay(x?.to)}${why ? ` · ${why}` : ''}`
    }
    const why = POLE_EXITS.find((e) => e.value === leaving[p.id])?.label.toLowerCase()
    return `${fem ? 'Sortante' : 'Sortant'} au ${fmtDay(s.exit)}${why ? ` · ${why}` : ''}`
  }
  const NOUVEAU = fem ? 'Nouvelle' : 'Nouveau'
  const keptIds = new Set(kept.map((p) => p.id))

  const leftHead = (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="col-courante" className="text-sm font-extrabold">
          Effectif {s.current.label} <span className="font-normal text-muted">· {pluralG(current.length, gg)}</span>
        </h2>
        {Object.keys(leaving).length > 0 && (
          <button className="text-[11px] font-bold text-muted underline hover:text-fg" onClick={() => setLeaving({})}>
            Tout reconduire
          </button>
        )}
      </div>
      <p className="text-[11px] text-muted">Coché = {RECONDUIT} la saison prochaine (rien n’est écrit). Décocher = {SORTANT} au {fmtDay(s.exit)}, motif demandé.</p>
    </div>
  )
  const rightHead = (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="col-prochaine" className="text-sm font-extrabold">
          Effectif {s.next.label} <span className="font-normal text-muted">· {pluralG(kept.length + savedNew.length + pending.length, gg)}</span>
        </h2>
        <button className="btn-primary px-3 py-1.5 text-xs" onClick={() => setPicking(true)}>
          + Ajouter des {gw.joueurs}
        </button>
      </div>
      <p className="text-[11px] text-muted">
        Les {gw.nouveaux} entrent au {fmtDay(s.entry)} (programme déduit de l’âge, modifiable). On peut aussi les ajouter depuis n’importe quelle liste : « Sélectionner » → « Ajouter à un groupe » → ce groupe.
      </p>
    </div>
  )
  const noCurrent = <Empty>{gw.AucunJoueur} au pôle aujourd’hui.</Empty>
  const noNext = <Empty>{gw.AucunJoueur} pour la saison prochaine.</Empty>
  const nextEmpty = !kept.length && !savedNew.length && !pending.length

  // Téléphone : un onglet par saison.
  const left = (
    <section className="flex min-w-0 flex-col gap-2" aria-labelledby="col-courante">
      {leftHead}
      {!current.length && noCurrent}
      <PlayerList ids={current.map((p) => p.id)} bar={false} select={false}>
        <div className="flex flex-col gap-2">{current.map(leftRow)}</div>
      </PlayerList>
    </section>
  )
  const right = (
    <section className="flex min-w-0 flex-col gap-2" aria-labelledby="col-prochaine">
      {rightHead}
      {nextEmpty && noNext}
      <PlayerList ids={[...kept, ...savedNew, ...pending.map((a) => a.p)].map((p) => p.id)} bar={false} select={false}>
        <div className="flex flex-col gap-2">
          {kept.map(keptRow)}
          {savedNew.map(savedRow)}
          {pending.map(pendingRow)}
        </div>
      </PlayerList>
    </section>
  )

  // Ordinateur : UNE grille, une ligne par joueur, chacun en face de lui-même (même hauteur des deux côtés). Sortant : case
  // vide en pointillés à droite ; nouveau : case vide à gauche.
  const grid = (
    <PlayerList ids={[...current, ...savedNew, ...pending.map((a) => a.p)].map((p) => p.id)} bar={false} select={false}>
      <div className="grid grid-cols-2 gap-x-4 gap-y-2">
        <section aria-labelledby="col-courante" className="min-w-0">
          {leftHead}
        </section>
        <section aria-labelledby="col-prochaine" className="min-w-0">
          {rightHead}
        </section>
        {(!current.length || nextEmpty) && (
          <>
            <div>{!current.length && noCurrent}</div>
            <div>{nextEmpty && noNext}</div>
          </>
        )}
        {current.map((p) => (
          <Fragment key={p.id}>
            <div className="min-w-0">{leftRow(p)}</div>
            <div className="min-w-0">{keptIds.has(p.id) ? keptRow(p) : slot(outText(p))}</div>
          </Fragment>
        ))}
        {savedNew.map((p) => {
          const x = p.poles![periodIndexAt(p, ref, s.refNext)]
          return (
            <Fragment key={p.id}>
              <div className="min-w-0">{slot(`${NOUVEAU} · entrée au ${fmtDay(x?.from)}`)}</div>
              <div className="min-w-0">{savedRow(p)}</div>
            </Fragment>
          )
        })}
        {pending.map((a) => {
          const other = otherPoleAt(a.p, ref, s.entry)
          return (
            <Fragment key={a.id}>
              <div className="min-w-0">{slot(other ? `${NOUVEAU} · vient du ${poleName(other, regionLabel)}` : NOUVEAU)}</div>
              <div className="min-w-0">{pendingRow(a)}</div>
            </Fragment>
          )
        })}
      </div>
    </PlayerList>
  )

  return (
    <div className="flex flex-col gap-3 pb-16">
      <BackButton fallback={`/groupes/${g.id}`} label={g.name.toUpperCase()} className="self-start" />
      <div>
        <h1 className="text-lg font-extrabold">Changement de saison</h1>
        <div className="text-xs text-muted">
          {g.name} · {ref.name}
          {ref.psqsRef ? ` · PSQS ${ref.psqsRef}` : ''}
        </div>
      </div>
      {done && (
        <p role="status" className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs">
          {done}{' '}
          <button className="font-bold underline" onClick={() => goBack()}>
            Retour au groupe
          </button>
        </p>
      )}
      {/* Téléphone : deux onglets ; ordinateur : deux colonnes. */}
      {!side && (
        <Segmented<Tab>
          value={tab}
          onChange={setTab}
          options={[
            { value: 'courante', label: `${s.current.label} (${current.length})` },
            { value: 'prochaine', label: `${s.next.label} (${kept.length + savedNew.length + pending.length})` },
          ]}
        />
      )}
      {side ? (
        grid
      ) : tab === 'courante' ? (
        left
      ) : (
        right
      )}

      {/* Barre du bas : récapitulatif court et « Enregistrer ». */}
      <div className="sticky bottom-[var(--nav-b)] z-10 -mx-4 flex flex-wrap items-center gap-2 border-t border-line bg-bg px-4 py-2 text-xs">
        <span className="min-w-0 flex-1 text-[11px] text-muted">{seasonSummary(batch, fem, transfers)}</span>
        <button className="btn-primary px-4" disabled={!changed || busy} onClick={() => setRecap(true)}>
          Enregistrer
        </button>
        <button className="btn text-muted" onClick={() => goBack()}>
          {changed ? 'Annuler' : 'Retour'}
        </button>
      </div>

      {asking && (
        <ExitReasonDialog
          name={`${asking.lastName.toUpperCase()} ${asking.firstName}`}
          sex={asking.sex}
          suggested={likely(asking) ? 'fin_cursus' : undefined}
          date={s.exit}
          onClose={(reason) => {
            if (reason) setLeaving((l) => ({ ...l, [asking.id]: reason }))
            setAsking(null)
          }}
        />
      )}
      {recap && (
        <RecapDialog
          summary={seasonSummary(batch, fem, transfers)}
          transfers={pending.filter((a) => otherPoleAt(a.p, ref, s.entry)).map((a) => `${a.p.lastName.toUpperCase()} ${a.p.firstName} (${poleName(otherPoleAt(a.p, ref, s.entry)!, regionLabel)})`)}
          defaults={{ exit: s.exit, entry: s.entry }}
          busy={busy}
          onClose={() => setRecap(false)}
          onSave={(dates) => void write(dates)}
        />
      )}
    </div>
  )
}

/** Étiquette « reconduit » / « nouveau » (accordée au genre du pôle). */
function Tag({ kind, g }: { kind: 'reconduit' | 'nouveau'; g: ReturnType<typeof setGender> }) {
  const f = g === 'F'
  const label = kind === 'reconduit' ? (f ? 'reconduite' : 'reconduit') : f ? 'nouvelle' : 'nouveau'
  return <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${kind === 'nouveau' ? 'bg-accent/15 text-accent' : 'bg-panel-2 text-muted'}`}>{label}</span>
}

/** Récapitulatif avant d'écrire : effectifs, transferts, les deux dates du lot (modifiables une fois pour tous). */
function RecapDialog({
  summary,
  transfers,
  defaults,
  busy,
  onClose,
  onSave,
}: {
  summary: string
  transfers: string[]
  defaults: { exit: string; entry: string }
  busy: boolean
  onClose: () => void
  onSave: (dates: { exit: string; entry: string }) => void
}) {
  const [exit, setExit] = useState(defaults.exit)
  const [entry, setEntry] = useState(defaults.entry)
  const id = useId()
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [onClose])
  const ok = /^\d{4}-\d{2}-\d{2}$/.test(exit) && /^\d{4}-\d{2}-\d{2}$/.test(entry)
  return createPortal(
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/60 p-4 sm:items-center" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby={id} className="card flex max-h-[88dvh] w-full max-w-md flex-col gap-3 overflow-y-auto p-4" onClick={(e) => e.stopPropagation()}>
        <div id={id} className="text-sm font-extrabold">
          Enregistrer le changement de saison
        </div>
        <p className="text-xs font-bold">{summary}</p>
        {transfers.length > 0 && (
          <p className="text-[11px] text-amber-300">
            Transfert{transfers.length > 1 ? 's' : ''} : {transfers.join(' ; ')} — la période de l’autre pôle sera fermée à la date de sortie avec le motif « autre ».
          </p>
        )}
        <p className="text-[11px] text-muted">Ce qui est écrit sur les fiches : sortants → date de sortie et motif ; nouveaux → nouvelle période ; reconduits → rien.</p>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Date de sortie">
            <input type="date" className="field" value={exit} onChange={(e) => setExit(e.target.value)} />
          </Field>
          <Field label="Date d’entrée">
            <input type="date" className="field" value={entry} onChange={(e) => setEntry(e.target.value)} />
          </Field>
        </div>
        <p className="text-[11px] text-muted">Par défaut : 30 juin et 1er juillet (à confirmer avec le CTF). Les mêmes dates pour tout le lot ; une fiche se corrige ensuite une par une.</p>
        <div className="flex justify-end gap-2">
          <button className="btn px-4 text-xs text-muted" onClick={onClose}>
            Annuler
          </button>
          <button className="btn-primary px-4 text-xs" disabled={!ok || busy} onClick={() => onSave({ exit, entry })}>
            {busy ? 'Enregistrement…' : 'Enregistrer'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-[11px] font-bold text-muted">
      {label}
      {children}
    </label>
  )
}
