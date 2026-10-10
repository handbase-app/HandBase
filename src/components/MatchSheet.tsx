import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useState, type ReactNode } from 'react'
import { alive, db, DEMO, fmtDate, newId, save, saveMany, today, TRIAL, type HBEvent, type Player, type Video } from '../db'
import {
  actionKeys,
  CLIP_LEAD,
  countKinds,
  guessHalfMin,
  HALVES,
  isGenerated,
  KIND_LABEL,
  LATE_MIN,
  matchPlayer,
  parseSheet,
  periodStart,
  planPlayerMoments,
  timeline,
  toStored,
  videoTitle,
  type ActionKind,
  type LinkMatch,
  type MatchSheet,
  type MatchSync,
  type ParsedSheet,
  type StoredAction,
} from '../matchSheet'
import { can, currentUserId, useRole } from '../roles'
import { fmtMoment, momentsOf, withMoments } from '../videos'
import { ask } from './Confirm'
import { Icon, InfoButton, playerName } from './ui'
import type { PlayerTools } from './VideoPlayer'

/*
 * Feuille de match FFHB (src/matchSheet.ts) : import dans un événement (ou création d'un match), vérification avant
 * d'enregistrer, calage sur la vidéo du match (outils sous le lecteur) et moments vidéo générés sur les fiches des joueurs.
 * Module chargé à la demande depuis Events.tsx ; pdf.js n'est chargé qu'à la lecture d'un fichier (matchSheetPdf.ts).
 */

const PERIOD_LABEL = (p: number) => (p === 1 ? '1re mi-temps' : p === 2 ? '2e mi-temps' : `Prolongation ${p - 2}`)
const sideName = (ms: Pick<MatchSheet, 'home' | 'away'>, side?: string) => (side === 'home' ? ms.home : side === 'away' ? ms.away : '')
const gameClock = (t: number) => `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`
const plural = (n: number, one: string, many = one + 's') => `${n} ${n > 1 ? many : one}`

/** Nom de l'événement créé depuis une feuille : « U18 MASCULINS … – Équipe A / Équipe B ». */
const eventName = (s: ParsedSheet) => [s.competition, `${s.home} / ${s.away}`].filter(Boolean).join(' – ').slice(0, 200)

/** Résumé par type : « 55 buts (dont 9 à 7 m), 28 tirs… ». */
function kindSummary(actions: { k: ActionKind }[]) {
  const counts = new Map(countKinds(actions))
  const goals = (counts.get('but') ?? 0) + (counts.get('but7') ?? 0)
  const parts: string[] = []
  if (goals) parts.push(`${plural(goals, 'but')}${counts.get('but7') ? ` (dont ${counts.get('but7')} à 7 m)` : ''}`)
  const label: Partial<Record<ActionKind, [string, string]>> = {
    tir: ['tir manqué', 'tirs manqués'],
    tir7: ['7 m manqué', '7 m manqués'],
    arret: ['arrêt', 'arrêts'],
    arret7: ['arrêt sur 7 m', 'arrêts sur 7 m'],
    '2mn': ['exclusion 2 min', 'exclusions 2 min'],
    avert: ['avertissement', 'avertissements'],
    disq: ['disqualification', 'disqualifications'],
    bleu: ['carton bleu', 'cartons bleus'],
    tm: ['temps mort', 'temps morts'],
    autre: ['autre', 'autres'],
  }
  for (const [k, n] of counts) {
    const l = label[k]
    if (l) parts.push(`${n} ${n > 1 ? l[1] : l[0]}`)
  }
  return parts.join(', ')
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = overflow
    }
  }, [onClose])
  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-center bg-black/70 sm:items-center sm:p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="flex h-full w-full flex-col bg-panel pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] sm:h-auto sm:max-h-full sm:max-w-3xl sm:rounded-lg sm:border sm:border-line sm:shadow-2xl"
      >
        <div className="flex shrink-0 items-center gap-2 border-b border-line px-4 py-2.5">
          <h2 className="min-w-0 flex-1 truncate text-sm font-extrabold">{title}</h2>
          <button className="shrink-0 rounded p-1.5 text-muted hover:bg-panel-2 hover:text-fg" title="Fermer (Échap)" aria-label="Fermer" onClick={onClose}>
            <Icon name="close" className="h-5 w-5" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">{children}</div>
      </div>
    </div>
  )
}

const livePlayers = async () => alive(await db.players.toArray()).filter((p) => !p.mergedInto)

/* ---------- Import et vérification ---------- */

/**
 * Import d'une feuille : dans l'événement `event`, ou (sans event) création d'un match tout prêt. Fermé avec l'identifiant
 * de l'événement enregistré (pour l'ouvrir), ou rien si annulé.
 */
export function MatchImport({ event, onClose }: { event?: HBEvent; onClose: (eventId?: string) => void }) {
  const role = useRole()
  const [step, setStep] = useState<'pick' | 'reading' | 'review'>('pick')
  const [error, setError] = useState('')
  const [sheet, setSheet] = useState<ParsedSheet>()
  const [matches, setMatches] = useState<LinkMatch[]>([])
  const [links, setLinks] = useState<(string | undefined)[]>([])
  const [inList, setInList] = useState<boolean[]>([])
  const [halfMin, setHalfMin] = useState(30)
  // Création : événement existant du même code rencontre à compléter ('' = nouvel événement).
  const [target, setTarget] = useState('')
  const [dup, setDup] = useState<HBEvent[]>([])
  const [busy, setBusy] = useState(false)
  const base = useLiveQuery(async () => {
    const id = event?.id ?? target
    return id ? db.events.get(id) : undefined
  }, [event?.id, target])
  const byId = useLiveQuery(async () => new Map((await livePlayers()).map((p) => [p.id, p])), [], new Map<string, Player>())

  async function read(file: File) {
    setStep('reading')
    setError('')
    try {
      const { readPdfItems } = await import('../matchSheetPdf')
      const s = parseSheet(await readPdfItems(file))
      if (!s.actions.length && !s.roster.length) throw new Error('Ce PDF ne ressemble pas à une feuille de match FFHB (ni joueurs ni déroulé trouvés).')
      const ps = await livePlayers()
      const ms = s.roster.map((r) => matchPlayer(r, ps, r.side === 'home' ? s.homeClub : s.awayClub))
      setMatches(ms)
      setLinks(ms.map((m) => (m.kind === 'license' ? m.player.id : undefined)))
      setInList(ms.map((m) => m.kind === 'license'))
      const same = event?.matchSheet && event.matchSheet.code === s.code ? event.matchSheet : undefined
      setHalfMin(same?.halfMin ?? guessHalfMin(s.actions))
      if (!event && s.code) {
        const found = alive(await db.events.toArray()).filter((e) => e.matchSheet?.code === s.code)
        setDup(found)
        setTarget(found.find((e) => can.editEvent(role, e))?.id ?? '')
      }
      setSheet(s)
      setStep('review')
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : 'Lecture du PDF impossible.')
      setStep('pick')
    }
  }

  async function submit() {
    if (!sheet) return
    setBusy(true)
    try {
      const cur = base && (await db.events.get(base.id))
      const prev = cur?.matchSheet && cur.matchSheet.code === sheet.code ? cur.matchSheet : undefined
      const stored: MatchSheet = { ...toStored(sheet, links, prev), halfMin }
      const add = [...new Set(sheet.roster.flatMap((_, i) => (links[i] && inList[i] ? [links[i]!] : [])))]
      if (cur) {
        const ids = [...new Set([...(cur.playerIds ?? []), ...add])]
        const added = ids.filter((id) => !(cur.playerIds ?? []).includes(id))
        const me = currentUserId()
        await save<HBEvent>('events', {
          ...cur,
          matchSheet: stored,
          time: cur.time ?? sheet.time,
          place: cur.place || sheet.place,
          playerIds: ids,
          ...(me && added.length && { addedBy: { ...cur.addedBy, ...Object.fromEntries(added.map((id) => [id, me])) } }),
        })
        onClose(cur.id)
      } else {
        const ev = await save<HBEvent>('events', {
          id: newId(),
          name: eventName(sheet),
          type: 'match',
          date: sheet.date ?? today(),
          time: sheet.time,
          place: sheet.place,
          playerIds: add,
          editors: [],
          matchSheet: stored,
        })
        onClose(ev.id)
      }
    } finally {
      setBusy(false)
    }
  }

  const title = event ? 'Importer une feuille de match' : 'Nouveau match depuis une feuille de match'
  if (step !== 'review' || !sheet)
    return (
      <Modal title={title} onClose={() => onClose()}>
        <div className="flex flex-col gap-3 text-sm">
          <p className="text-xs text-muted">
            Feuille de match électronique FFHB en PDF (celle que l’on télécharge après le match). Elle est lue sur l’appareil : le fichier n’est ni envoyé ni
            gardé.
          </p>
          <label className={`btn-primary cursor-pointer justify-center ${step === 'reading' ? 'pointer-events-none opacity-60' : ''}`}>
            <input
              type="file"
              accept="application/pdf,.pdf"
              className="sr-only"
              onChange={(e) => {
                const f = e.target.files?.[0]
                e.target.value = ''
                if (f) void read(f)
              }}
            />
            {step === 'reading' ? 'Lecture de la feuille…' : 'Choisir le PDF de la feuille de match'}
          </label>
          {error && (
            <p className="text-xs text-red-400" role="alert">
              {error}
            </p>
          )}
          {(DEMO || TRIAL) && (
            <p className="text-[11px] text-muted">
              Pour essayer :{' '}
              <a className="font-bold text-accent underline" href={`${import.meta.env.BASE_URL}demo/feuille-match-demo.pdf`} download>
                feuille de match d’exemple
              </a>{' '}
              (joueurs fictifs de la démonstration).
            </p>
          )}
        </div>
      </Modal>
    )

  const late = new Set<number>()
  {
    const count = new Map<string, number>()
    for (const a of sheet.actions) count.set(`${a.p}:${a.t}`, (count.get(`${a.p}:${a.t}`) ?? 0) + 1)
    sheet.actions.forEach((a, i) => (count.get(`${a.p}:${a.t}`) ?? 0) >= LATE_MIN && late.add(i))
  }
  const periods = [...new Set(sheet.actions.map((a) => a.p))]
  const nLicense = matches.filter((m) => m.kind === 'license').length
  const nName = matches.filter((m, i) => m.kind === 'name' && links[i]).length
  const nToConfirm = matches.filter((m, i) => m.kind === 'name' && !links[i]).length
  const nNone = matches.filter((m) => m.kind === 'none').length
  const inEvent = new Set(base?.playerIds ?? [])
  const toAdd = new Set(sheet.roster.flatMap((_, i) => (links[i] && inList[i] && !inEvent.has(links[i]!) ? [links[i]!] : [])))
  const replacing = base?.matchSheet && base.matchSheet.code !== sheet.code

  const setLink = (i: number, id?: string) => {
    setLinks((l) => l.map((x, j) => (j === i ? id : x)))
    setInList((l) => l.map((x, j) => (j === i ? !!id : x)))
  }

  return (
    <Modal title={title} onClose={() => onClose()}>
      <div className="flex flex-col gap-4 text-sm">
        {/* En-tête du match */}
        <div className="rounded-md border border-line bg-panel-2 p-3">
          <div className="text-[11px] text-muted">
            {[sheet.competition, sheet.pool].filter(Boolean).join(' · ')}
            {sheet.code ? ` · code ${sheet.code}` : ''}
          </div>
          <div className="mt-1 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 font-bold">
            <span className="text-right">{sheet.home}</span>
            <span className="rounded bg-panel px-2 py-0.5 text-base tabular-nums">{sheet.score ? `${sheet.score[0]} – ${sheet.score[1]}` : '–'}</span>
            <span>{sheet.away}</span>
          </div>
          <div className="mt-1 text-[11px] text-muted">
            {sheet.date ? fmtDate(sheet.date) : 'Date non lue'}
            {sheet.time ? ` · ${sheet.time}` : ''}
            {sheet.place ? ` · ${sheet.place}` : ''}
          </div>
        </div>
        {sheet.warnings.map((w) => (
          <p key={w} className="text-xs text-amber-200">
            {w}
          </p>
        ))}

        {/* Événement : compléter celui du même code plutôt qu'en créer un second. */}
        {!event && dup.length > 0 && (
          <div className="flex flex-col gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs">
            <span className="font-bold text-amber-200">Ce match est déjà dans HandBase (même code rencontre).</span>
            {dup.map((e) => (
              <label key={e.id} className={`flex items-center gap-2 ${can.editEvent(role, e) ? '' : 'opacity-60'}`}>
                <input type="radio" name="target" checked={target === e.id} disabled={!can.editEvent(role, e)} onChange={() => setTarget(e.id)} />
                <span className="min-w-0 truncate">
                  Compléter « {e.name} » ({fmtDate(e.date)}){!can.editEvent(role, e) && ` — modifiable par ${e.createdByName ?? 'son créateur'} seulement`}
                </span>
              </label>
            ))}
            <label className="flex items-center gap-2">
              <input type="radio" name="target" checked={!target} onChange={() => setTarget('')} />
              Créer quand même un nouvel événement
            </label>
          </div>
        )}
        {replacing && (
          <p className="text-xs text-amber-200">
            L’événement a déjà une feuille d’un autre match (code {base?.matchSheet?.code ?? '?'}) : elle sera remplacée, son calage vidéo aussi.
          </p>
        )}

        {/* Déroulé */}
        <div>
          <div className="section-title mb-1">Déroulé du match</div>
          <p className="text-xs">
            <b>{plural(sheet.actions.length, 'action')}</b> sur {plural(periods.length, 'période')} : {kindSummary(sheet.actions) || '—'}.
          </p>
          {late.size > 0 && (
            <p className="mt-1 text-xs text-amber-200">
              {plural(late.size, 'action saisie', 'actions saisies')} en retard ({LATE_MIN} et plus au même temps de jeu) : leur temps est faux, elles seront à caler à
              la main sur la vidéo.
            </p>
          )}
          <label className="mt-2 flex items-center gap-2 text-xs">
            <span className="text-muted">Durée d’une mi-temps</span>
            <select className="field w-auto py-1 text-xs" value={halfMin} onChange={(e) => setHalfMin(Number(e.target.value))}>
              {[...new Set([...HALVES, halfMin])].sort((a, b) => a - b).map((h) => (
                <option key={h} value={h}>
                  {h} min
                </option>
              ))}
            </select>
            <span className="text-[10px] text-muted">{halfMin === guessHalfMin(sheet.actions) ? '(déduite du déroulé)' : ''}</span>
          </label>
        </div>

        {/* Joueurs */}
        <div>
          <div className="section-title mb-1">Joueurs ({sheet.roster.length})</div>
          <p className="text-xs">
            {nLicense} reconnu{nLicense > 1 ? 's' : ''} par la licence{nName ? `, ${nName} par le nom (confirmé${nName > 1 ? 's' : ''})` : ''}
            {nToConfirm ? `, ${nToConfirm} à confirmer` : ''}, {nNone} sans fiche.
          </p>
          <div className="mt-2 grid gap-3 sm:grid-cols-2">
            {(['home', 'away'] as const).map((side) => (
              <div key={side} className="rounded-md border border-line">
                <div className="truncate border-b border-line px-2.5 py-1.5 text-xs font-bold">{sideName(sheet, side)}</div>
                <ul className="divide-y divide-line">
                  {sheet.roster.map((r, i) => {
                    if (r.side !== side) return null
                    const m = matches[i]
                    const linked = links[i] ? byId.get(links[i]!) : undefined
                    return (
                      <li key={i} className="flex items-start gap-2 px-2.5 py-1.5 text-xs">
                        <span className="w-6 shrink-0 text-right font-bold text-muted tabular-nums">{r.num ?? '–'}</span>
                        <div className="min-w-0 flex-1">
                          <div className="truncate font-bold">
                            {r.name}
                            {r.stats.arrets ? <span className="ml-1 text-[10px] font-normal text-muted">gardien</span> : null}
                          </div>
                          {m.kind === 'license' ? (
                            <div className="truncate text-[11px] text-emerald-300">
                              Licence reconnue{linked && playerName(linked) !== `${r.lastName.toUpperCase()} ${r.firstName}` ? ` : ${playerName(linked)}` : ''}
                            </div>
                          ) : m.kind === 'name' ? (
                            <select
                              className={`field mt-1 w-full py-1 text-[11px] ${links[i] ? 'border-emerald-500/60' : 'border-amber-500/60'}`}
                              value={links[i] ?? ''}
                              onChange={(e) => setLink(i, e.target.value || undefined)}
                              aria-label={`Fiche correspondant à ${r.name}`}
                            >
                              <option value="">Même nom : à confirmer (pas relié)</option>
                              {m.candidates.map((p) => (
                                <option key={p.id} value={p.id}>
                                  C’est {playerName(p)} · {[p.birthDate?.slice(0, 4), p.club, p.license ? `licence ${p.license}` : 'sans licence'].filter(Boolean).join(' · ')}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <div className="text-[11px] text-muted">Fiche absente</div>
                          )}
                        </div>
                        {links[i] &&
                          (inEvent.has(links[i]!) ? (
                            <span className="shrink-0 text-[10px] text-muted">dans la liste</span>
                          ) : (
                            <label className="flex shrink-0 items-center gap-1 text-[10px]" title="Ajouter ce joueur à la liste de l’événement">
                              <input type="checkbox" checked={inList[i]} onChange={(e) => setInList((l) => l.map((x, j) => (j === i ? e.target.checked : x)))} />
                              liste
                            </label>
                          ))}
                      </li>
                    )
                  })}
                </ul>
              </div>
            ))}
          </div>
          <p className="mt-2 text-[10px] text-muted">
            Aucune fiche n’est créée. Enregistrés avec l’événement : numéros, équipe et fiche reliée de chaque joueur, et le déroulé. Ni les noms ni les licences
            des joueurs sans fiche, ni le PDF.
          </p>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line pt-3">
          <span className="mr-auto text-[11px] text-muted">{toAdd.size ? `${plural(toAdd.size, 'joueur ajouté', 'joueurs ajoutés')} à la liste` : ''}</span>
          <button className="btn-ghost px-3 py-1.5 text-xs" onClick={() => onClose()}>
            Annuler
          </button>
          <button className="btn-ghost px-3 py-1.5 text-xs" onClick={() => (setSheet(undefined), setStep('pick'))}>
            Autre fichier
          </button>
          <button className="btn-primary px-4 py-1.5 text-xs" disabled={busy} onClick={() => void submit()}>
            {base ? 'Enregistrer la feuille' : 'Créer le match'}
          </button>
        </div>
      </div>
    </Modal>
  )
}

/* ---------- Écritures du calage ---------- */

/** Modifie le calage de la feuille (relue au moment d'écrire). */
async function updateSync(eventId: string, fn: (s: MatchSync, ms: MatchSheet) => MatchSync) {
  const ev = await db.events.get(eventId)
  if (!ev?.matchSheet) return
  const ms = ev.matchSheet
  await save<HBEvent>('events', { ...ev, matchSheet: { ...ms, sync: fn({ marks: {}, ...ms.sync }, ms) } })
}

const sameMoments = (a: { at: number; dur?: number; note?: string }[], b: { at: number; dur?: number; note?: string }[]) =>
  a.length === b.length && a.every((m, i) => m.at === b[i].at && (m.dur ?? 0) === (b[i].dur ?? 0) && (m.note ?? '') === (b[i].note ?? ''))

export interface GenerateResult {
  created: number
  updated: number
  moments: number
  unplaced: number
  dropped: number
  foreign: number
}

/**
 * Moments sur les fiches : pour chaque joueur relié, un lien vidéo (même adresse que la vidéo du match) avec un moment
 * par but (et, en option, par arrêt et par tir). Relancer met à jour les moments générés (note « … · feuille ») et garde
 * ceux ajoutés à la main. Un lien du même match ajouté par un autre compte n'est pas modifié (seul son auteur le peut).
 */
export async function generateMoments(eventId: string): Promise<GenerateResult> {
  const ev = await db.events.get(eventId)
  const ms = ev?.matchSheet
  const url = ms?.sync?.url
  const res: GenerateResult = { created: 0, updated: 0, moments: 0, unplaced: 0, dropped: 0, foreign: 0 }
  if (!ev || !ms || !url) return res
  const tl = timeline(ms)
  const title = videoTitle(ms, ev.date)
  const rows: Video[] = []
  const done = new Set<string>()
  for (const [pl, sp] of ms.players.entries()) {
    if (!sp.playerId) continue
    // Fiche fondue dans une autre depuis l'import : on suit la fusion.
    let p = await db.players.get(sp.playerId)
    for (let n = 0; p?.mergedInto && n < 5; n++) p = await db.players.get(p.mergedInto)
    if (!p || p.deleted || done.has(p.id)) continue
    done.add(p.id)
    const vids = (await db.videos.where('targetId').equals(p.id).toArray()).filter((v) => !v.deleted && v.targetKind === 'player' && v.url === url)
    const mine = vids.find((v) => can.editVideo(v) && (v.title === title || momentsOf(v).some(isGenerated))) ?? vids.find((v) => can.editVideo(v))
    const plan = planPlayerMoments(ms, pl, mine ? momentsOf(mine) : [], tl)
    res.unplaced += plan.unplaced
    res.dropped += plan.dropped
    if (!mine) {
      if (!plan.generated) continue
      if (vids.some((v) => momentsOf(v).some(isGenerated))) {
        res.foreign++
        continue
      }
      rows.push({ id: newId(), targetKind: 'player', targetId: p.id, url, title, ...withMoments(plan.moments), updatedAt: 0 })
      res.created++
    } else {
      const next = withMoments(plan.moments)
      if (sameMoments(momentsOf(mine), next.moments ?? [])) {
        res.moments += plan.generated
        continue
      }
      rows.push({ ...mine, ...next })
      res.updated++
    }
    res.moments += plan.generated
  }
  await saveMany<Video>('videos', rows)
  return res
}

function resultText(r: GenerateResult) {
  const parts = [
    r.created || r.updated
      ? `${r.created ? plural(r.created, 'lien créé', 'liens créés') : ''}${r.created && r.updated ? ', ' : ''}${r.updated ? plural(r.updated, 'lien mis à jour', 'liens mis à jour') : ''} sur les fiches`
      : 'Rien à changer sur les fiches',
    `${plural(r.moments, 'moment')} au total`,
  ]
  if (r.unplaced) parts.push(`${plural(r.unplaced, 'action', 'actions')} à caler à la main`)
  if (r.dropped) parts.push(`${r.dropped} non ajoutée${r.dropped > 1 ? 's' : ''} (20 moments au plus par lien)`)
  if (r.foreign) parts.push(`${plural(r.foreign, 'fiche', 'fiches')} déjà pourvue${r.foreign > 1 ? 's' : ''} par un autre compte (non modifiée${r.foreign > 1 ? 's' : ''})`)
  return parts.join(' · ') + '.'
}

/** Nom affiché pour le joueur d'une action : fiche reliée, sinon « n° 7 (Équipe) ». */
function useActionWho(ms: MatchSheet | undefined) {
  const ids = (ms?.players ?? []).flatMap((p) => (p.playerId ? [p.playerId] : []))
  const byId = useLiveQuery(async () => new Map((await db.players.bulkGet(ids)).filter((p): p is Player => !!p).map((p) => [p.id, p])), [ids.join(',')], new Map<string, Player>())
  return (a: StoredAction) => {
    if (!ms) return ''
    if (a.k === 'tm') return sideName(ms, a.side)
    if (a.pl === undefined) return a.side ? sideName(ms, a.side) : ''
    const sp = ms.players[a.pl]
    const p = sp?.playerId ? byId.get(sp.playerId) : undefined
    return p ? playerName(p) : `n° ${sp?.num ?? '?'} (${sideName(ms, sp?.side)})`
  }
}

const actionLabel = (a: StoredAction) => (a.k === 'autre' ? (a.l ?? 'Action') : a.k === 'tm' ? 'Temps mort' : KIND_LABEL[a.k])

/* ---------- Carte « Feuille de match » de l'événement ---------- */

export function MatchSheetCard({ ev, manage }: { ev: HBEvent; manage: boolean }) {
  const role = useRole()
  const ms = ev.matchSheet!
  const who = useActionWho(ms)
  const [importing, setImporting] = useState(false)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState('')
  const [showFlow, setShowFlow] = useState(false)
  const video = useLiveQuery(() => (ms.sync?.videoId ? db.videos.get(ms.sync.videoId) : undefined), [ms.sync?.videoId])
  const tl = timeline(ms)
  const placed = ms.actions.filter((_, i) => tl.at(i) !== undefined).length
  const linked = ms.players.filter((p) => p.playerId).length
  const marks = ms.sync?.marks ?? {}
  const periods = [...new Set(ms.actions.map((a) => a.p))]
  const synced = !!ms.sync?.url && Object.keys(marks).length + Object.keys(ms.sync?.fix ?? {}).length > 0
  const opts = ms.sync?.opts ?? {}

  return (
    <div className="card p-4">
      <div className="section-title flex items-center gap-2">
        <Icon name="list" className="h-3.5 w-3.5" />
        Feuille de match
        <InfoButton title="Feuille de match">
          <p>Feuille de match électronique FFHB importée (PDF lu sur l’appareil, jamais gardé) : équipes, score, joueurs reliés aux fiches et déroulé.</p>
          <p>
            Calage : ouvre la vidéo du match dans « Vidéos » ; sous le lecteur, pose les repères (début et fin de chaque mi-temps) au bon moment de la vidéo.
            Entre deux repères, les actions sont placées en proportion (les arrêts de jeu se répartissent). « Cette action est ici » sur une action ajoute un
            repère et recale ses voisines.
          </p>
          <p>
            Saisie en retard : quand la table de marque enregistre plusieurs actions d’un coup ({LATE_MIN} et plus au même temps), leur temps est faux ; elles ne
            sont pas placées tant qu’on ne les a pas posées à la main.
          </p>
          <p>
            « Moments sur les fiches » : chaque joueur relié reçoit un lien vers la vidéo du match avec un moment par but (et, en option, arrêts et tirs), de{' '}
            {CLIP_LEAD} s avant l’action à quelques secondes après. Relancer met à jour ces moments (marqués « feuille ») et garde ceux ajoutés à la main.
          </p>
        </InfoButton>
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 text-sm font-bold">
        <span className="text-right">{ms.home}</span>
        <span className="rounded bg-panel-2 px-2 py-0.5 tabular-nums">{ms.score ? `${ms.score[0]} – ${ms.score[1]}` : '–'}</span>
        <span>{ms.away}</span>
      </div>
      <div className="mt-1 text-center text-[11px] text-muted">
        {[ms.competition, ms.code && `code ${ms.code}`].filter(Boolean).join(' · ')}
      </div>
      <p className="mt-2 text-xs">
        {plural(ms.actions.length, 'action')} : {kindSummary(ms.actions)}. {linked}/{ms.players.length} joueurs reliés à une fiche. Mi-temps de {ms.halfMin} min.
      </p>
      {tl.late.size > 0 && <p className="mt-1 text-xs text-amber-200">{plural(tl.late.size, 'action saisie', 'actions saisies')} en retard : à caler à la main.</p>}

      <div className="mt-3 rounded-md border border-line bg-panel-2 p-2.5 text-xs">
        {synced ? (
          <>
            <div>
              Calée sur <b>{video?.title || 'la vidéo du match'}</b> : {placed}/{ms.actions.length} actions placées.
            </div>
            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted">
              {periods.map((p) => {
                const st = tl.stoppage(p)
                return (
                  <span key={p}>
                    {PERIOD_LABEL(p)} : {marks[`s${p}`] !== undefined ? fmtMoment(marks[`s${p}`]) : '—'} → {marks[`e${p}`] !== undefined ? fmtMoment(marks[`e${p}`]) : '—'}
                    {st !== undefined && ` (arrêts cumulés ${fmtDur(st)})`}
                  </span>
                )
              })}
            </div>
          </>
        ) : (
          <span className="text-muted">
            Pas encore calée. Ajoute la vidéo du match dans « Vidéos » (YouTube, Vimeo ou fichier vidéo) et ouvre-la : les repères se posent sous le lecteur.
          </span>
        )}
      </div>

      {can.manageEvents(role) && (
        <div className="mt-3 flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
            <span className="text-muted">Moments sur les fiches : buts</span>
            {(
              [
                ['saves', 'arrêts (gardiens)'],
                ['shots', 'tirs manqués'],
              ] as const
            ).map(([k, label]) => (
              <label key={k} className={`flex items-center gap-1 ${manage ? '' : 'opacity-60'}`}>
                <input type="checkbox" disabled={!manage} checked={!!opts[k]} onChange={(e) => void updateSync(ev.id, (s) => ({ ...s, opts: { ...s.opts, [k]: e.target.checked } }))} />+ {label}
              </label>
            ))}
          </div>
          <button
            className="btn-primary px-3 py-1.5 text-xs"
            disabled={busy || !synced || !linked}
            onClick={async () => {
              setBusy(true)
              setResult('')
              try {
                setResult(resultText(await generateMoments(ev.id)))
              } finally {
                setBusy(false)
              }
            }}
          >
            {busy ? 'Création des moments…' : `Créer ou mettre à jour les moments sur les fiches (${linked} joueurs)`}
          </button>
          {result && (
            <p className="text-[11px] text-emerald-300" role="status">
              {result}
            </p>
          )}
        </div>
      )}

      <button className="mt-3 text-[11px] font-bold text-accent hover:underline" onClick={() => setShowFlow(!showFlow)}>
        {showFlow ? 'Masquer le déroulé' : `Voir le déroulé (${ms.actions.length})`}
      </button>
      {showFlow && (
        <div className="mt-2 max-h-96 overflow-y-auto rounded-md border border-line">
          <FlowList ms={ms} who={who} />
        </div>
      )}

      {manage && (
        <div className="mt-3 flex flex-wrap gap-4 border-t border-line pt-2">
          <button className="text-[11px] text-muted hover:text-fg" onClick={() => setImporting(true)}>
            Réimporter la feuille
          </button>
          <button
            className="text-[11px] text-muted hover:text-red-400"
            onClick={async () => {
              if (!(await ask('Retirer la feuille de match de l’événement (déroulé et calage) ? Les moments déjà créés sur les fiches restent.', { ok: 'Retirer' }))) return
              const cur = await db.events.get(ev.id)
              if (cur) await save<HBEvent>('events', { ...cur, matchSheet: undefined })
            }}
          >
            Retirer la feuille
          </button>
        </div>
      )}
      {importing && <MatchImport event={ev} onClose={() => setImporting(false)} />}
    </div>
  )
}

/** « 4 min 05 s », « 35 s », « -12 s ». */
function fmtDur(s: number) {
  const neg = s < 0
  const a = Math.round(Math.abs(s))
  const txt = a >= 60 ? `${Math.floor(a / 60)} min ${String(a % 60).padStart(2, '0')} s` : `${a} s`
  return neg ? `-${txt}` : txt
}

/** Liste du déroulé, par période ; `row` ajoute des commandes à droite de chaque ligne (outils du lecteur). */
function FlowList({ ms, who, filter, row }: { ms: MatchSheet; who: (a: StoredAction) => string; filter?: (i: number) => boolean; row?: (i: number) => ReactNode }) {
  const tl = timeline(ms)
  let last = 0
  const out: ReactNode[] = []
  ms.actions.forEach((a, i) => {
    if (filter && !filter(i)) return
    if (a.p !== last) {
      last = a.p
      out.push(
        <li key={`p${a.p}`} className="sticky top-0 bg-panel px-2 py-1 text-[10px] font-extrabold tracking-wider text-accent uppercase">
          {PERIOD_LABEL(a.p)}
        </li>,
      )
    }
    const goal = a.k === 'but' || a.k === 'but7'
    out.push(
      <li key={i} className={`flex items-center gap-2 px-2 py-1 text-[11px] ${tl.late.has(i) ? 'bg-amber-500/10' : ''}`}>
        <span className="w-9 shrink-0 text-muted tabular-nums">{gameClock(a.t)}</span>
        <span className="w-10 shrink-0 text-muted tabular-nums">
          {a.s[0]}-{a.s[1]}
        </span>
        <span className="min-w-0 flex-1 truncate">
          <span className={goal ? 'font-bold' : ''}>{actionLabel(a)}</span> <span className="text-muted">{who(a)}</span>
        </span>
        {row?.(i)}
      </li>,
    )
  })
  return out.length ? <ul className="divide-y divide-line/50">{out}</ul> : <p className="p-2 text-[11px] text-muted">Aucune action.</p>
}

/* ---------- Outils de calage sous le lecteur ---------- */

const MARKS: { key: string; p: number; label: string }[] = [
  { key: 's1', p: 1, label: 'Début 1re mi-temps' },
  { key: 'e1', p: 1, label: 'Fin 1re mi-temps' },
  { key: 's2', p: 2, label: 'Début 2e mi-temps' },
  { key: 'e2', p: 2, label: 'Fin du match' },
]

/** Calage de la feuille de l'événement sur la vidéo ouverte : repères, décalage d'une période, actions posées à la main. */
export function MatchSyncTools({ eventId, video, api }: { eventId: string; video: Video; api: PlayerTools }) {
  const role = useRole()
  const ev = useLiveQuery(() => db.events.get(eventId), [eventId])
  const ms = ev?.matchSheet
  const who = useActionWho(ms)
  const [filter, setFilter] = useState<'all' | 'goals' | 'late'>('all')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  if (!ev || !ms) return null
  const edit = can.editEvent(role, ev)
  const sync = ms.sync
  const other = !!sync?.videoId && sync.videoId !== video.id && Object.keys(sync.marks ?? {}).length + Object.keys(sync.fix ?? {}).length > 0
  const tl = timeline(ms)
  const keys = actionKeys(ms.actions)
  const now = () => {
    const t = api.time()
    if (t === undefined) {
      setMsg('Lance la vidéo d’abord (le lecteur n’est pas encore prêt).')
      return undefined
    }
    setMsg('')
    return Math.round(t * 10) / 10
  }
  // Première écriture : la feuille est calée sur cette vidéo.
  const write = (fn: (s: MatchSync) => MatchSync) => void updateSync(eventId, (s) => fn({ ...s, videoId: video.id, url: video.url }))
  const setMark = (key: string, v?: number) =>
    write((s) => {
      const marks = { ...s.marks }
      if (v === undefined) delete marks[key]
      else marks[key] = v
      return { ...s, marks }
    })
  const setFix = (i: number, v?: number) =>
    write((s) => {
      const fix = { ...s.fix }
      if (v === undefined) delete fix[keys[i]]
      else fix[keys[i]] = v
      return { ...s, fix }
    })
  // Décaler toute une période : ses repères et ses actions posées à la main.
  const shift = (p: number, d: number) =>
    write((s) => {
      const marks = { ...s.marks }
      for (const k of [`s${p}`, `e${p}`]) if (marks[k] !== undefined) marks[k] = Math.max(0, marks[k] + d)
      const fix = { ...s.fix }
      ms.actions.forEach((a, i) => {
        if (a.p === p && fix[keys[i]] !== undefined) fix[keys[i]] = Math.max(0, fix[keys[i]] + d)
      })
      return { ...s, marks, fix }
    })
  const periods = [...new Set(ms.actions.map((a) => a.p))]
  const marks = sync?.marks ?? {}
  const fix = sync?.fix ?? {}
  const nLate = [...tl.late].filter((i) => fix[keys[i]] === undefined).length
  const small = 'rounded border border-line bg-panel px-1.5 py-0.5 text-[10px] font-bold hover:border-accent disabled:opacity-40'

  return (
    <div className="flex flex-col gap-2 border-t border-line pt-2">
      <div className="text-[11px] font-bold text-muted">Calage de la feuille de match</div>
      {other ? (
        <div className="flex flex-col gap-1.5 text-[11px]">
          <p className="text-amber-200">La feuille est calée sur une autre vidéo de l’événement.</p>
          {edit && (
            <button
              className="btn-ghost self-start px-2 py-1 text-[11px]"
              onClick={async () =>
                (await ask('Caler la feuille sur cette vidéo ? Les repères posés sur l’autre vidéo sont effacés.', { ok: 'Caler ici' })) &&
                void updateSync(eventId, (s) => ({ marks: {}, opts: s.opts, videoId: video.id, url: video.url }))
              }
            >
              Caler sur cette vidéo
            </button>
          )}
        </div>
      ) : (
        <>
          {!edit && <p className="text-[10px] text-muted">Calage réservé à l’organisateur de l’événement (et aux administrateurs) ; tu peux parcourir les actions.</p>}
          <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-1.5 gap-y-1 text-[11px]">
            {MARKS.filter((m) => periods.includes(m.p)).map((m) => (
              <div key={m.key} className="contents">
                <span className="truncate">{m.label}</span>
                {marks[m.key] !== undefined ? (
                  <button className="font-bold text-accent tabular-nums hover:underline" title="Aller à ce repère" onClick={() => api.seek(marks[m.key])}>
                    {fmtMoment(marks[m.key])}
                  </button>
                ) : (
                  <span className="text-muted">—</span>
                )}
                {edit ? (
                  <span className="flex gap-1">
                    <button
                      className={small}
                      disabled={!api.ready}
                      title={`${m.label} : temps actuel de la vidéo`}
                      onClick={() => {
                        const t = now()
                        if (t !== undefined) setMark(m.key, t)
                      }}
                    >
                      Ici
                    </button>
                    {marks[m.key] !== undefined && (
                      <button className="text-muted hover:text-red-400" title="Effacer ce repère" aria-label={`Effacer le repère ${m.label}`} onClick={() => setMark(m.key)}>
                        <Icon name="close" className="h-3 w-3" />
                      </button>
                    )}
                  </span>
                ) : (
                  <span />
                )}
              </div>
            ))}
          </div>
          {periods.map((p) => {
            const st = tl.stoppage(p)
            const anchored = tl.anchors(p).length > 0
            return (
              <div key={p} className="flex flex-wrap items-center gap-1 text-[10px] text-muted">
                <span className="mr-auto">
                  {PERIOD_LABEL(p)}
                  {st !== undefined ? ` · arrêts cumulés ${fmtDur(st)}` : ''}
                </span>
                {edit && anchored && (
                  <>
                    <span>décaler</span>
                    {[-5, -1, 1, 5].map((d) => (
                      <button key={d} className={small} title={`Décaler toute la période de ${d > 0 ? '+' : ''}${d} s`} onClick={() => shift(p, d)}>
                        {d > 0 ? '+' : '−'}
                        {Math.abs(d)} s
                      </button>
                    ))}
                  </>
                )}
              </div>
            )
          })}
          {msg && <p className="text-[10px] text-amber-200">{msg}</p>}

          <div className="flex flex-wrap gap-1 text-[10px]">
            {(
              [
                ['all', `Toutes (${ms.actions.length})`],
                ['goals', 'Buts'],
                ['late', `À caler (${nLate})`],
              ] as const
            ).map(([k, label]) => (
              <button key={k} className={`rounded-full border px-2 py-0.5 font-bold ${filter === k ? 'border-accent bg-accent/15 text-accent' : 'border-line text-muted'}`} onClick={() => setFilter(k)}>
                {label}
              </button>
            ))}
          </div>
          <div className="max-h-72 overflow-y-auto rounded-md border border-line landscape:max-h-none">
            <FlowList
              ms={ms}
              who={who}
              filter={(i) =>
                filter === 'all' ? true : filter === 'goals' ? ms.actions[i].k === 'but' || ms.actions[i].k === 'but7' : tl.late.has(i) && fix[keys[i]] === undefined
              }
              row={(i) => {
                const vt = tl.at(i)
                const fixed = fix[keys[i]] !== undefined
                return (
                  <span className="flex shrink-0 items-center gap-1">
                    {vt !== undefined ? (
                      <button
                        className={`tabular-nums hover:underline ${fixed ? 'font-bold text-emerald-300' : 'text-accent'}`}
                        title={fixed ? 'Posée à la main — aller à l’action' : 'Aller à l’action (quelques secondes avant)'}
                        onClick={() => api.seek(vt - CLIP_LEAD)}
                      >
                        {fmtMoment(vt)}
                      </button>
                    ) : (
                      <span className="text-[10px] text-amber-200">{tl.late.has(i) ? 'à caler' : '—'}</span>
                    )}
                    {edit && (
                      <button
                        className={small}
                        disabled={!api.ready}
                        title="Cette action est ici : temps actuel de la vidéo"
                        onClick={() => {
                          const t = now()
                          if (t !== undefined) setFix(i, t)
                        }}
                      >
                        Ici
                      </button>
                    )}
                    {edit && fixed && (
                      <button className="text-muted hover:text-red-400" title="Retirer ce repère" aria-label="Retirer ce repère" onClick={() => setFix(i)}>
                        <Icon name="close" className="h-3 w-3" />
                      </button>
                    )}
                  </span>
                )
              }}
            />
          </div>
          <p className="text-[10px] text-muted">
            Temps vidéo = repères de la période ({periodStart(2, ms.halfMin) / 60} min par mi-temps) ; entre deux repères, en proportion. « Ici » sur une action
            l’ajoute comme repère.
          </p>
          {can.manageEvents(role) && (
            <button
              className="btn-primary px-3 py-1.5 text-xs"
              disabled={busy || !sync?.url}
              onClick={async () => {
                setBusy(true)
                try {
                  setMsg(resultText(await generateMoments(eventId)))
                } finally {
                  setBusy(false)
                }
              }}
            >
              {busy ? 'Création des moments…' : 'Créer ou mettre à jour les moments sur les fiches'}
            </button>
          )}
        </>
      )}
    </div>
  )
}
