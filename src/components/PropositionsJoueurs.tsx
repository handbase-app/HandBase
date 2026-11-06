import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useMemo, useState } from 'react'
import { saveEvaluation } from '../avisSave'
import { alive, criterionApplies, db, fmtDate, newId, plural, remove, save, today, type Criterion, type Evaluation, type HBEvent, type Player } from '../db'
import { eventNumbers, type Candidate } from '../importMesures'
import { saveChoix, setPropositionEtat } from '../propositions'
import { SOURCE_LABEL, type PropositionRow } from '../propositionsCore'
import {
  appliquerAvis,
  appliquerMarques,
  cochee,
  contexteJoueurs,
  etatApresJoueurs,
  ficheDe,
  libelleBouton,
  lignesDe,
  messageFait,
  notesReprises,
  raisonsParFiche,
  rapprocherSurAppareil,
  resumeJoueurs,
  type Application,
  type AvisRow,
  type ChoixJoueurs,
  type CritereAvis,
  type DepsJoueurs,
  type LigneRevue,
  type ResultatLigne,
} from '../propositionsJoueurs'
import { texteEchelle, type LigneAReVoir, type LigneAvis, type SorteJoueurs } from '../propositionsJoueursCore'
import { CONTEXT_TYPES } from '../db'
import { currentUserId, useRole } from '../roles'
import { addRewatchMany, markSeenMany, myOpenRewatch, openRewatchSet, scoutId, seenSet, setSeen } from '../scouting'
import { ask } from './Confirm'
import { FormActions } from './FormWindow'
import { CONF, fullName, PlayerPick, RowCheck } from './ImportMesures'
import { flash } from './ItemMenu'
import { getMe, Icon } from './ui'

/*
 * Boîte « À valider » : une proposition sur des JOUEURS préparée par Claude (outils nextar_proposer_avis, _vus, _a_revoir ;
 * règles : src/propositionsJoueurs.ts ; format : src/propositionsJoueursCore.ts). Comme l'écran « À valider » des mesures
 * (ImportReview) : une ligne par joueur de la feuille, le joueur proposé (noms remis SUR L'APPAREIL), sa confiance, le joueur
 * modifiable (les possibles d'abord, puis la recherche ; « Ne pas importer cette ligne »), une case par ligne, puis
 * « Enregistrer N avis » / « Marquer N vus » / « Mettre N à revoir » par les chemins de l'appli (saveEvaluation,
 * markSeenMany, addRewatchMany), « Défaire » 10 s (retire seulement ce qui vient d'être créé), « Garder pour plus tard »
 * (choix gardés), « Rejeter ». Fond flouté : la fenêtre de la boîte (FormWindow) et les questions (Confirm).
 * Libellés positifs ou neutres seulement : « vu », « à revoir », « points forts », « axes de progression ».
 */

const UNDO_MS = 10_000

/** Joueurs où chercher pour une proposition : ceux gardés avec elle, sinon ceux de l'événement ou du groupe, sinon toute la base. */
export function usePropScope(p: PropositionRow) {
  return useLiveQuery(async () => {
    const ctx = p.contexte
    const ev = ctx.portee === 'evenement' && ctx.id ? await db.events.get(ctx.id) : undefined
    const g = ctx.portee === 'groupe' && ctx.id ? await db.groups.get(ctx.id) : undefined
    const ids = ctx.joueurs?.length ? ctx.joueurs : ev && !ev.deleted ? (ev.playerIds ?? []) : g && !g.deleted ? (g.playerIds ?? []) : []
    let players: Player[] = []
    if (ids.length) players = alive((await db.players.bulkGet(ids)).filter((x): x is Player => !!x)).filter((x) => !x.mergedInto)
    const nums = ev && !ev.deleted ? eventNumbers(ev) : undefined
    if (players.length) {
      const what = ctx.portee === 'groupe' ? 'du groupe' : 'de l’événement'
      return { players, nums, event: ev && !ev.deleted ? ev : undefined, where: `parmi les ${plural(players.length, 'joueur')} ${what}${ctx.nom ? ` « ${ctx.nom} »` : ''}` }
    }
    const base = alive(await db.players.toArray()).filter((x) => x.review !== 'refused' && !x.mergedInto)
    return { players: base, nums, event: ev && !ev.deleted ? ev : undefined, where: `parmi toute la base (${plural(base.length, 'fiche')})` }
  }, [p.id])
}

const ICONE: Record<SorteJoueurs, 'star' | 'eye' | 'clock'> = { avis: 'star', vus: 'eye', a_revoir: 'clock' }
const dm = (d?: string) => (d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? `${d.slice(8, 10)}/${d.slice(5, 7)}` : '')

/** Une proposition sur des joueurs dans la liste de la boîte. */
export function JoueursItem({ p, when, onOpen }: { p: PropositionRow; when: string; onOpen: () => void }) {
  const sorte = p.kind as SorteJoueurs
  const n = lignesDe(sorte, p.lignes).length
  return (
    <button type="button" onClick={onOpen} className="card flex min-h-11 w-full items-start gap-3 p-3 text-left transition hover:border-accent" data-proposition={p.id}>
      <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent/15 text-accent" aria-hidden>
        <Icon name={ICONE[sorte]} className="h-5 w-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-bold break-words">{p.titre}</span>
        <span className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] text-muted">
          <span className="rounded-full bg-accent/15 px-2 py-0.5 font-bold text-accent">{SOURCE_LABEL[p.source]}</span>
          <span>{when}</span>
          <span aria-hidden>·</span>
          <span>{resumeJoueurs(sorte, n)}</span>
          {p.contexte.nom && (
            <>
              <span aria-hidden>·</span>
              <span className="break-words">« {p.contexte.nom} »</span>
            </>
          )}
          {sorte === 'avis' && p.contexte.date && (
            <>
              <span aria-hidden>·</span>
              <span>du {dm(p.contexte.date)}</span>
            </>
          )}
        </span>
        {p.sendError && <span className="mt-1 block text-[11px] text-spread-lo">Gardée sur cet appareil pour l’instant : {p.sendError}</span>}
      </span>
      <Icon name="chevron" className="mt-2 h-4 w-4 shrink-0 text-muted" />
    </button>
  )
}

/** Les chemins de l'appli, branchés pour src/propositionsJoueurs.ts. */
function depsAppli(o: { role: ReturnType<typeof useRole>; me: string; eventId?: string; originEventId?: string; groupId?: string }): DepsJoueurs {
  const uid = () => currentUserId()
  return {
    me: o.me,
    newId,
    now: () => new Date().toISOString(),
    monAvis: async (playerId, eventId) => {
      const rows = alive(await db.evaluations.where('eventId').equals(eventId).toArray()).filter(
        (e) => e.playerId === playerId && !e.contextType && (uid() ? e.observerId === uid() : e.observer === o.me),
      )
      return rows[0] as unknown as AvisRow | undefined
    },
    enregistrerAvis: async (row, spontaneous) => {
      const ev = row.eventId ? await db.events.get(row.eventId) : undefined
      const r = await saveEvaluation(row as unknown as Evaluation, { spontaneous, role: o.role, me: o.me, event: ev && !ev.deleted ? ev : undefined })
      return { addedToEvent: r.addedToEvent }
    },
    retirerAvis: (id) => remove('evaluations', id),
    remettreAvis: async (row) => {
      await save<Evaluation>('evaluations', row as unknown as Evaluation)
    },
    retirerDeEvenement: async (eventId, playerId) => {
      const ev = await db.events.get(eventId)
      if (!ev || ev.deleted || !(ev.playerIds ?? []).includes(playerId)) return
      const addedBy = { ...ev.addedBy }
      delete addedBy[playerId]
      await save<HBEvent>('events', { ...ev, playerIds: (ev.playerIds ?? []).filter((x) => x !== playerId), addedBy })
    },
    vus: o.eventId
      ? {
          already: (ids) => seenSet(o.eventId!, ids),
          mark: (ids) => markSeenMany(o.eventId!, ids),
          created: async (pid) => pid,
          unmark: (pid) => setSeen(o.eventId!, pid, false),
        }
      : undefined,
    aRevoir: (notes) => ({
      already: openRewatchSet,
      mark: (ids) =>
        addRewatchMany(ids, {
          originEventId: o.originEventId,
          origin: o.originEventId ? undefined : o.groupId ? { kind: 'group', id: o.groupId } : { kind: 'other', label: 'À valider · préparé avec Claude' },
          notes,
        }),
      created: async (pid) => (await myOpenRewatch(pid))?.id,
      unmark: (id) => remove('rewatch', id),
    }),
  }
}

export function JoueursReview({ p, when, onBack, onSaved, onUndone }: { p: PropositionRow; when: string; onBack: () => void; onSaved: () => void; onUndone: () => void }) {
  const role = useRole()
  const sorte = p.kind as SorteJoueurs
  const ctx = useMemo(() => contexteJoueurs(p.kind, p.contexte), [p.id]) // eslint-disable-line react-hooks/exhaustive-deps
  const scope = usePropScope(p)
  const criteria = useLiveQuery(() => db.criteria.toArray().then((cs) => alive(cs).filter((c) => c.kind === 'subjective' && c.active)), [])
  const crits = useMemo(() => new Map((criteria ?? []).map((c) => [c.id, c as Criterion & CritereAvis])), [criteria])
  const lignes = useMemo(() => lignesDe(sorte, p.lignes), [p.id]) // eslint-disable-line react-hooks/exhaustive-deps
  const cands = useMemo<Candidate[]>(
    () => (scope?.players ?? []).map((x) => ({ id: x.id, firstName: x.firstName, lastName: x.lastName, birthDate: x.birthDate, num: scope?.nums?.[x.id] })),
    [scope],
  )
  const byId = useMemo(() => new Map((scope?.players ?? []).map((x) => [x.id, x])), [scope])
  const revues = useMemo(() => rapprocherSurAppareil(lignes, cands), [lignes, cands])
  const initial = p.contexte.choix
  const [players, setPlayers] = useState<Record<number, string>>(() => (initial?.players as Record<number, string>) ?? {})
  const [checks, setChecks] = useState<Record<number, boolean>>(() => initial?.checks ?? {})
  const [picking, setPicking] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [fait, setFait] = useState<{ app: Application; message: string } | null>(null)
  const [undoLeft, setUndoLeft] = useState(0)
  const [undone, setUndone] = useState('')
  const choix: ChoixJoueurs = { players, checks }
  const me = getMe() || ''
  const staff = role !== 'joueur'
  const eventId = ctx?.portee === 'evenement' ? ctx.id : undefined
  const event = scope?.event
  const enAttente = p.etat === 'en_attente'

  // Notes reprises sur l'appareil (critère connu ici, échelle, poste de la fiche retenue).
  const notesDe = (r: LigneRevue) => {
    const id = ficheDe(r, choix)
    const pos = id ? byId.get(id)?.position : undefined
    return notesReprises(r.ligne as LigneAvis, crits, (cid) => !!crits.get(cid) && criterionApplies(crits.get(cid)!, pos))
  }
  const retenues = revues.filter((r) => cochee(r, choix) && (sorte !== 'avis' || Object.keys(notesDe(r).scores).length > 0 || !!(r.ligne as LigneAvis).forts || !!(r.ligne as LigneAvis).progres))
  const n = sorte === 'avis' ? retenues.length : new Set(retenues.map((r) => ficheDe(r, choix))).size
  const counts = { sur: 0, verifier: 0, introuvable: 0 }
  for (const r of revues) counts[r.match.confidence]++

  // « Défaire » : quelques secondes après l'enregistrement.
  useEffect(() => {
    if (!fait?.app.defaire) return
    const end = Date.now() + UNDO_MS
    setUndoLeft(Math.ceil(UNDO_MS / 1000))
    const t = window.setInterval(() => {
      const left = Math.max(0, Math.ceil((end - Date.now()) / 1000))
      setUndoLeft(left)
      if (!left) window.clearInterval(t)
    }, 250)
    return () => window.clearInterval(t)
  }, [fait])

  const setPlayer = (i: number, id: string) => {
    setPlayers((c) => ({ ...c, [i]: id }))
    setChecks((c) => {
      const x = { ...c }
      delete x[i]
      return x
    })
    setPicking(null)
  }

  const blocage = !staff
    ? 'Ton rôle ne permet pas d’enregistrer ceci.'
    : (sorte === 'vus' || sorte === 'a_revoir') && !scoutId()
      ? 'Connecte-toi d’abord : « vu » et « à revoir » sont posés à ton nom.'
      : sorte === 'vus' && !event
        ? 'L’événement de cette proposition n’est pas sur cet appareil (supprimé, ou pas encore reçu).'
        : sorte === 'avis' && eventId && !event
          ? 'L’événement de ces avis n’est pas sur cet appareil (supprimé, ou pas encore reçu).'
          : sorte === 'avis' && !me
            ? 'Indique d’abord ton nom (écran d’avis, « Qui évalue ? ») : il signe tes avis.'
            : ''

  async function enregistrer() {
    if (!ctx || !retenues.length) return
    setBusy(true)
    setError('')
    try {
      const d = depsAppli({ role, me, eventId, originEventId: eventId, groupId: ctx.portee === 'groupe' ? ctx.id : undefined })
      let app: Application
      if (sorte === 'avis') app = await appliquerAvis(retenues, choix, (r) => notesDe(r).scores, { eventId, date: ctx.date ?? today(), typeContexte: ctx.typeContexte, lieu: ctx.lieu }, d)
      else if (sorte === 'vus') app = await appliquerMarques(retenues, choix, d.vus!, 'déjà vu par toi à cet événement')
      else app = await appliquerMarques(retenues, choix, d.aRevoir!(raisonsParFiche(retenues, choix)), 'déjà à revoir pour toi')
      const deja = app.resultats.filter((x) => x.ok && /^déjà/.test(x.message)).length
      const etat = etatApresJoueurs(revues, app.resultats)
      if (etat !== 'en_attente') await setPropositionEtat(p.id, etat)
      setFait({ app, message: messageFait(sorte, app.faits, deja) })
      setUndone('')
      onSaved()
    } catch (e) {
      setError(`Rien n’a pu être enregistré : ${e instanceof Error ? e.message : e}`)
    } finally {
      setBusy(false)
    }
  }

  async function defaire() {
    if (!fait?.app.defaire) return
    setBusy(true)
    try {
      const k = await fait.app.defaire()
      await setPropositionEtat(p.id, 'en_attente')
      setUndone(`C’est défait : ${k} élément${k > 1 ? 's' : ''} retiré${k > 1 ? 's' : ''} ou remis comme avant. La proposition attend de nouveau.`)
      setFait(null)
      onUndone()
    } catch (e) {
      setError(`Impossible de défaire : ${e instanceof Error ? e.message : e}`)
    } finally {
      setBusy(false)
    }
  }

  async function garder() {
    await saveChoix(p.id, { players, checks })
    flash('Choix gardés : la proposition attend toujours dans « À valider ».')
    onBack()
  }

  async function rejeter() {
    if (!(await ask(`Rejeter « ${p.titre} » ? Rien ne sera enregistré ; la proposition s’efface d’elle-même dans 7 jours.`, { ok: 'Rejeter', focusCancel: true }))) return
    await setPropositionEtat(p.id, 'rejetee')
    flash('Proposition rejetée.')
    onBack()
  }

  const entete = (
    <div className="min-w-0">
      <h3 className="text-sm font-extrabold break-words">{p.titre}</h3>
      <p className="text-[11px] text-muted">
        <span className="rounded-full bg-accent/15 px-2 py-0.5 font-bold text-accent">{SOURCE_LABEL[p.source]}</span> {when} · {resumeJoueurs(sorte, lignes.length)}
        {sorte === 'avis' && ctx?.date ? ` · avis du ${fmtDate(ctx.date)}` : ''}
        {sorte === 'avis' && ctx && ctx.portee !== 'evenement' ? ` · hors événement (${CONTEXT_TYPES.find((c) => c.value === ctx.typeContexte)?.label ?? 'Match'}${ctx.lieu ? `, ${ctx.lieu}` : ''})` : ''}
      </p>
    </div>
  )

  if (!ctx)
    return (
      <div className="flex flex-col gap-3">
        {entete}
        <p className="text-xs text-muted">Cette proposition n’est pas lisible par cette version de l’appli.</p>
        <FormActions>
          <button type="button" className="btn-ghost" onClick={onBack}>
            ‹ Toutes les propositions
          </button>
        </FormActions>
      </div>
    )

  if (fait || undone)
    return (
      <div className="flex flex-col gap-3 py-2" data-proposition-joueurs={p.id}>
        {entete}
        {fait ? (
          <p className="text-sm font-bold text-gain" role="status">
            ✓ {fait.message}.
          </p>
        ) : (
          <p className="text-sm font-bold" role="status">
            {undone}
          </p>
        )}
        {fait && <Resultats revues={revues} resultats={fait.app.resultats} byId={byId} choix={choix} />}
        {fait && sorte === 'avis' && fait.app.faits > 0 && <p className="text-xs text-muted">Ils sont sur la fiche de chaque joueur (Avis), marqués « importé, validé par {me || 'toi'} ».</p>}
        {error && <p className="text-xs text-loss">{error}</p>}
        <FormActions>
          <button type="button" data-autofocus className="btn-primary" onClick={onBack}>
            OK
          </button>
          {fait?.app.defaire && undoLeft > 0 && (
            <button type="button" className="btn-ghost" disabled={busy} onClick={() => void defaire()}>
              <Icon name="undo" /> Défaire ({undoLeft} s)
            </button>
          )}
        </FormActions>
      </div>
    )

  return (
    <div className="flex flex-col gap-3" data-proposition-joueurs={p.id}>
      {entete}
      {!scope || criteria === undefined ? (
        <p className="py-8 text-center text-sm text-muted">Chargement…</p>
      ) : (
        <>
          <div className="text-xs text-muted">
            <span className="font-bold text-fg">{plural(revues.length, 'ligne')}</span>
            {' : '}
            <span className="text-gain">
              {counts.sur} sûre{counts.sur > 1 ? 's' : ''}
            </span>
            {counts.verifier > 0 && <span className="text-spread-lo"> · {counts.verifier} à vérifier</span>}
            {counts.introuvable > 0 && (
              <span>
                {' '}
                · {counts.introuvable} introuvable{counts.introuvable > 1 ? 's' : ''}
              </span>
            )}
            <span className="block text-[11px]">
              Préparé avec Claude : rien n’est enregistré avant ta validation. Joueurs {scope.where}. Touche un nom pour choisir un autre joueur.
            </span>
          </div>
          {blocage && <p className="rounded-lg bg-panel-2 p-3 text-xs text-muted">{blocage}</p>}
          <ul className="flex flex-col gap-2" aria-label="Lignes à valider">
            {revues.map((r) => {
              const id = ficheDe(r, choix)
              const pl = id ? byId.get(id) : undefined
              const on = cochee(r, choix)
              const conf = CONF[choix.players && r.i in choix.players ? (id ? 'sur' : 'introuvable') : r.match.confidence]
              const l = r.ligne
              return (
                <li key={r.i} className={`card overflow-hidden ${on ? 'border-accent/50' : ''}`} data-ligne={r.i}>
                  <div className="flex items-start gap-1 p-1.5 pr-3">
                    <RowCheck on={on} disabled={!pl || !enAttente || !!blocage} onToggle={() => setChecks((c) => ({ ...c, [r.i]: !on }))} />
                    <button
                      type="button"
                      className="min-h-11 min-w-0 flex-1 rounded-lg px-1.5 py-1 text-left hover:bg-fg/5"
                      aria-expanded={picking === r.i}
                      onClick={() => setPicking(picking === r.i ? null : r.i)}
                      title="Choisir un autre joueur"
                    >
                      <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                        <span className="text-sm font-bold">{pl ? fullName(pl) : choix.players && r.i in choix.players && !id ? 'Ne pas importer' : 'Choisir le joueur'}</span>
                        <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${conf.cls}`}>{choix.players && r.i in choix.players ? (id ? 'Choisi' : 'Laissée de côté') : conf.label}</span>
                      </span>
                      <span className="block text-[11px] break-words text-muted">
                        {l.code ? `code ${l.code}` : l.nom ? `« ${l.nom} »` : 'sans nom'}
                        {l.numero ? ` · n° ${l.numero}` : ''}
                        {l.annee ? ` · ${l.annee}` : ''} · {r.match.why}
                      </span>
                    </button>
                  </div>
                  {picking === r.i && (
                    <PlayerPick
                      cands={scope.players}
                      first={[r.match.playerId, ...r.match.others].filter((x): x is string => !!x)}
                      nums={scope.nums}
                      hint={l.nom ?? l.code ?? ''}
                      onPick={(pid) => setPlayer(r.i, pid)}
                      onClose={() => setPicking(null)}
                    />
                  )}
                  {sorte === 'avis' && <DetailAvis l={l as LigneAvis} ctxDate={ctx.date} reprises={notesDe(r)} crits={crits} />}
                  {sorte === 'a_revoir' && (l as LigneAReVoir).raison && (
                    <p className="border-t border-line px-3 py-2 text-[11px] break-words whitespace-pre-line">
                      <span className="font-bold text-muted">Raison : </span>
                      {(l as LigneAReVoir).raison}
                    </p>
                  )}
                </li>
              )
            })}
          </ul>
        </>
      )}
      {error && <p className="text-xs text-loss">{error}</p>}
      <FormActions>
        {enAttente && (
          <button type="button" className="btn-primary" disabled={!n || busy || !!blocage || !scope} onClick={() => void enregistrer()}>
            {busy ? 'Enregistrement…' : n ? libelleBouton(sorte, n) : 'Aucune ligne retenue'}
          </button>
        )}
        {enAttente && (
          <button type="button" className="btn-ghost" disabled={busy} onClick={() => void garder()}>
            Garder pour plus tard
          </button>
        )}
        <button type="button" className="btn-ghost" disabled={busy} onClick={onBack}>
          ‹ Toutes les propositions
        </button>
        {enAttente && (
          <button type="button" className="btn-ghost" disabled={busy} onClick={() => void rejeter()}>
            Rejeter
          </button>
        )}
      </FormActions>
    </div>
  )
}

/** Détail d'une ligne d'avis : notes (critère et échelle), date, points forts, axes de progression, notes non reprises. */
function DetailAvis({ l, ctxDate, reprises, crits }: { l: LigneAvis; ctxDate?: string; reprises: ReturnType<typeof notesReprises>; crits: Map<string, CritereAvis> }) {
  const notes = Object.entries(reprises.scores)
  return (
    <div className="flex flex-col gap-1.5 border-t border-line px-3 py-2 text-[11px]">
      {notes.length > 0 && (
        <div className="flex flex-wrap gap-1.5" aria-label="Notes">
          {notes.map(([cid, v]) => {
            const c = crits.get(cid)
            const b = c?.scale === 'score5' || c?.scale === 'score3' || c?.scale === 'score2' ? texteEchelle(c.scale).split(' à ')[1] : ''
            return (
              <span key={cid} className="inline-flex items-center gap-1 rounded-full border border-line bg-panel-2/60 px-2 py-0.5">
                <span className="text-muted">{c?.label ?? cid}</span>
                <b className="tabular-nums">
                  {String(v)}
                  {b ? `/${b}` : ''}
                </b>
              </span>
            )
          })}
        </div>
      )}
      {l.date && l.date !== ctxDate && <span className="text-muted">avis du {fmtDate(l.date)}</span>}
      {l.forts && (
        <p className="break-words whitespace-pre-line">
          <span className="font-bold text-muted">Points forts : </span>
          {l.forts}
        </p>
      )}
      {l.progres && (
        <p className="break-words whitespace-pre-line">
          <span className="font-bold text-muted">Axes de progression : </span>
          {l.progres}
        </p>
      )}
      {reprises.ecartees.length > 0 && (
        <span className="text-muted">
          <Icon name="info" className="mr-1 inline h-3.5 w-3.5 align-[-2px]" />
          Non repris : {reprises.ecartees.map((e) => `${e.critere} (${e.raison})`).join(' ; ')}
        </span>
      )}
      {!notes.length && !l.forts && !l.progres && <span className="text-muted">Aucune note reprise sur cet appareil.</span>}
    </div>
  )
}

/** Après l'enregistrement : ce qui a été fait, ligne par ligne (texte neutre). */
function Resultats({ revues, resultats, byId, choix }: { revues: readonly LigneRevue[]; resultats: readonly ResultatLigne[]; byId: Map<string, Player>; choix: ChoixJoueurs }) {
  const parI = new Map(revues.map((r) => [r.i, r]))
  if (!resultats.length) return null
  return (
    <ul className="flex max-h-[40vh] flex-col gap-1 overflow-auto text-[11px]" aria-label="Résultat ligne par ligne">
      {resultats.map((x) => {
        const r = parI.get(x.i)
        const pl = r ? byId.get(ficheDe(r, choix) ?? '') : undefined
        return (
          <li key={x.i} className="flex items-center gap-1.5">
            <Icon name={x.ok ? 'check' : 'info'} className={`h-3.5 w-3.5 shrink-0 ${x.ok ? 'text-accent' : 'text-muted'}`} />
            <span className="font-bold">{pl ? fullName(pl) : 'Ligne'}</span>
            <span className="text-muted">{x.message}</span>
          </li>
        )
      })}
    </ul>
  )
}
