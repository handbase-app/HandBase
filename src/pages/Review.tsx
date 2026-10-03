import { useLiveQuery } from 'dexie-react-hooks'
import { Link } from 'react-router-dom'
import { AvisCard } from '../components/Opinions'
import { department, departmentLabel } from '../components/PlayerFilter'
import { ReviewActions, ReviewBadge, ReviewNote } from '../components/Review'
import { Empty } from '../components/ui'
import { alive, contextLabel, db, fmtDate, reviewOf, type Evaluation, type Player } from '../db'
import { can, currentUserId, myDepartments, useRole } from '../roles'
import { possibleDuplicates } from '../merge'

/**
 * Propositions des observateurs : avis spontanés et fiches joueur proposées.
 * Les encadrants et administrateurs les valident ; chacun suit ici l'état des siennes.
 */
export default function ReviewPage() {
  const role = useRole()
  const data = useLiveQuery(async () => {
    const spontaneous = alive(await db.evaluations.filter((e) => !!e.review).toArray())
    const proposed = alive(await db.players.filter((p) => !!p.review).toArray())
    const ids = [...new Set(spontaneous.map((e) => e.playerId))]
    const players = (await db.players.bulkGet(ids)).filter((p): p is Player => !!p)
    const criteria = alive(await db.criteria.toArray())
    // Doublons : seulement ceux où une fiche proposée ou hors cadre est en jeu (les autres sont à l'import).
    const duplicates = proposed.length
      ? possibleDuplicates(alive(await db.players.toArray())).filter(([a, b]) => !!a.review || !!b.review)
      : []
    return { spontaneous, proposed, players: new Map(players.map((p) => [p.id, p])), criteria, duplicates }
  }, [])
  if (!data) return <div className="py-20 text-center text-sm text-muted">Chargement…</div>

  const me = currentUserId()
  const isMine = (e: { observerId?: string; createdBy?: string }) => !!me && (e.observerId ?? e.createdBy) === me
  // Secteur : je décide pour les joueurs de mes départements (supabase/010_secteurs.sql).
  const deptOf = (e: Evaluation) => {
    const p = data.players.get(e.playerId)
    return p && department(p)
  }
  const pendingAvis = data.spontaneous.filter((e) => reviewOf(e) === 'pending' && !isMine(e)).sort((a, b) => a.date.localeCompare(b.date))
  const todo = pendingAvis.filter((e) => can.reviewDept(role, deptOf(e)))
  const avisElsewhere = pendingAvis.filter((e) => !can.reviewDept(role, deptOf(e)))
  const decided = data.spontaneous
    .filter((e) => reviewOf(e) !== 'pending' && !isMine(e) && e.reviewedAt)
    .sort((a, b) => (b.reviewedAt ?? '').localeCompare(a.reviewedAt ?? ''))
    .slice(0, 20)
  const mine = data.spontaneous.filter(isMine).sort((a, b) => b.date.localeCompare(a.date))
  const pendingPlayers = data.proposed
    .filter((p) => p.review === 'pending' && !isMine(p))
    .sort((a, b) => (a.createdAtServer ?? '').localeCompare(b.createdAtServer ?? ''))
  const playersTodo = pendingPlayers.filter((p) => can.reviewDept(role, department(p)))
  const playersElsewhere = pendingPlayers.filter((p) => !can.reviewDept(role, department(p)))
  const depts = myDepartments()
  const myPlayers = data.proposed.filter(isMine).sort((a, b) => a.lastName.localeCompare(b.lastName, 'fr'))

  const card = (e: Evaluation) => {
    const p = data.players.get(e.playerId)
    const scores = data.criteria
      .filter((c) => typeof e.scores[c.id] === 'number')
      .map((c) => `${c.label} ${e.scores[c.id]}`)
      .join(' · ')
    return (
      <div key={e.id} className="flex flex-col">
        <AvisCard e={e} where={contextLabel(e)} role={role} player={p} dept={p && department(p)} />
        {scores && <div className="-mt-1 rounded-b-lg border border-t-0 border-line bg-panel px-2.5 py-1.5 text-[10px] text-muted">{scores}</div>}
      </div>
    )
  }

  const playerCard = (p: Player, actions: boolean) => {
    const d = department(p)
    return (
      <div key={p.id} className="rounded-lg border border-line bg-panel-2 p-2.5 text-xs">
        <div className="flex items-start justify-between gap-2">
          <div>
            <Link to={`/joueurs/${p.id}`} className="text-sm font-bold">
              {p.firstName} {p.lastName}
            </Link>
            <div className="text-[10px] text-muted">
              {[p.birthDate && p.birthDate.slice(0, 4), p.sex === 'M' ? 'garçon' : p.sex === 'F' ? 'fille' : '', p.club, d && departmentLabel(d)]
                .filter(Boolean)
                .join(' · ')}
            </div>
            {!d && <div className="text-[10px] text-amber-200">Département inconnu : à valider par un administrateur.</div>}
            {p.createdByName && (
              <div className="text-[10px] text-muted">
                Proposée par <b className="text-white">{p.createdByName}</b>
                {p.createdAtServer && <> le {fmtDate(p.createdAtServer.slice(0, 10))}</>}
              </div>
            )}
            {p.notes && <div className="mt-1">{p.notes}</div>}
          </div>
          <ReviewBadge e={p} kind="players" />
        </div>
        <ReviewNote e={p} />
        {actions && <ReviewActions e={p} kind="players" />}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-lg font-extrabold">Propositions</h1>
        <div className="flex gap-2">
          <Link to="/joueurs/nouveau" className="btn-ghost px-3 py-1.5 text-xs">
            + Fiche
          </Link>
          <Link to="/evaluer?contexte=libre" className="btn-ghost px-3 py-1.5 text-xs">
            + Avis spontané
          </Link>
        </div>
      </div>
      <p className="text-[11px] text-muted">
        Joueur vu hors des événements prévus (UNSS, entraînement de club…) : avis spontané, et fiche proposée s’il n’est pas dans la base.
        Ceux des observateurs sont validés par un encadrant ; une fiche proposée sans décision au bout de 12 mois est effacée (RGPD).
        Hors cadre, ils restent consultables pour mémoire (
        <Link to="/rates" className="font-bold text-accent">
          ratés
        </Link>
        ).
      </p>

      {can.review(role) && (
        <p className="text-[11px] text-muted">
          Mon secteur :{' '}
          <b className="text-white">
            {role === 'admin' ? 'tous les départements (administrateur)' : depts.length ? depts.map(departmentLabel).join(', ') : 'tous les départements (aucun secteur attribué)'}
          </b>
        </p>
      )}

      {can.review(role) && (
        <>
          <section className="flex flex-col gap-2">
            <div className="section-title">Fiches à valider ({playersTodo.length})</div>
            {playersTodo.length ? playersTodo.map((p) => playerCard(p, true)) : <Empty>Aucune fiche en attente.</Empty>}
          </section>
          <section className="flex flex-col gap-2">
            <div className="section-title">Avis à valider ({todo.length})</div>
            {todo.length ? todo.map(card) : <Empty>Aucun avis en attente.</Empty>}
          </section>
          {playersElsewhere.length + avisElsewhere.length > 0 && (
            <details className="rounded-lg border border-line p-2.5">
              <summary className="cursor-pointer text-xs font-bold text-muted">
                En attente hors de mon secteur ({playersElsewhere.length + avisElsewhere.length}) : pour information
              </summary>
              <div className="mt-2 flex flex-col gap-2">
                {playersElsewhere.map((p) => playerCard(p, false))}
                {avisElsewhere.map(card)}
              </div>
            </details>
          )}
        </>
      )}

      {can.editPlayers(role) && data.duplicates.length > 0 && (
        <section className="flex flex-col gap-2">
          <div className="section-title">Doublons possibles ({data.duplicates.length})</div>
          <p className="text-[11px] text-muted">Même nom, naissance compatible : sans doute le même joueur (fiche proposée puis licence, deux propositions…).</p>
          {data.duplicates.map(([keep, other]) => (
            <div key={keep.id + other.id} className="flex items-center justify-between gap-2 rounded-lg border border-line bg-panel-2 p-2.5 text-xs">
              <div className="min-w-0">
                <b>
                  {keep.firstName} {keep.lastName}
                </b>
                <div className="text-[10px] text-muted">
                  {[keep, other]
                    .map((p) => (p.license ? 'licencié' : p.review === 'refused' ? 'hors cadre' : p.review === 'pending' ? 'proposée' : 'sans licence'))
                    .join(' + ')}
                </div>
              </div>
              <Link to={`/joueurs/${keep.id}?fusion=${other.id}`} className="shrink-0 font-bold text-accent">
                Comparer et fusionner →
              </Link>
            </div>
          ))}
        </section>
      )}

      {myPlayers.length > 0 && (
        <section className="flex flex-col gap-2">
          <div className="section-title">Mes fiches proposées ({myPlayers.length})</div>
          {myPlayers.map((p) => playerCard(p, false))}
        </section>
      )}

      <section className="flex flex-col gap-2">
        <div className="section-title">Mes avis spontanés ({mine.length})</div>
        {mine.length ? mine.map(card) : <Empty>Tu n’as pas encore donné d’avis spontané.</Empty>}
      </section>

      {can.review(role) && decided.length > 0 && (
        <details className="rounded-lg border border-line p-2.5">
          <summary className="cursor-pointer text-xs font-bold text-muted">Décisions récentes sur les avis ({decided.length}) : revenir sur une décision</summary>
          <div className="mt-2 flex flex-col gap-2">{decided.map(card)}</div>
        </details>
      )}
    </div>
  )
}

/** Nombre de propositions (avis spontanés et fiches) qui attendent ma validation (0 pour un observateur). */
export function usePendingCount() {
  const role = useRole()
  return useLiveQuery(
    async () => {
      if (!can.review(role)) return 0
      const me = currentUserId()
      const avis = await db.evaluations.filter((e) => e.review === 'pending' && !e.deleted && !(me && e.observerId === me)).toArray()
      const players = await db.players.bulkGet([...new Set(avis.map((e) => e.playerId))])
      const dept = new Map(players.filter((p) => !!p).map((p) => [p!.id, department(p!)]))
      const fiches = await db.players.filter((p) => p.review === 'pending' && !p.deleted && !(me && p.createdBy === me)).toArray()
      return (
        avis.filter((e) => can.reviewDept(role, dept.get(e.playerId))).length + fiches.filter((p) => can.reviewDept(role, department(p))).length
      )
    },
    [role, myDepartments().join()],
    0,
  )
}
