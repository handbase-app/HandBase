import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useMemo, useState } from 'react'
import { codeJoueur } from '../codesJoueurs'
import { db, newId, plural, remove, save } from '../db'
import { mergePlayers } from '../merge'
import { setPropositionEtat } from '../propositions'
import {
  actionsDe,
  appliquerActions,
  defaireActions,
  etatApresAdmin,
  libelleAction,
  nonDefaisables,
  resumeAdmin,
  sorteProposition,
  type DepsAdmin,
  type Noms,
  type Resultat,
  type Retour,
} from '../propositionsAdmin'
import { SOURCE_LABEL, type PropositionRow } from '../propositionsCore'
import { useNomsParCode } from '../rapports'
import { useRole } from '../roles'
import { supabase } from '../sync'
import { ask } from './Confirm'
import { FormActions } from './FormWindow'
import { flash } from './ItemMenu'
import { Icon } from './ui'

/*
 * Boîte « À valider » : une proposition D'ADMINISTRATION préparée par Claude (outil nextar_admin_proposer ; règles :
 * src/propositionsAdmin.ts ; format : src/propositionsAdminCore.ts ; table : supabase/070_propositions_admin.sql).
 * « Claude prépare, l'admin valide d'un toucher » : chaque action est lisible (noms des comptes ; noms des joueurs remis SUR
 * L'APPAREIL, comme la page /rapport le fait pour les codes J-…), cochée d'office ; « Appliquer N actions » les fait par les
 * MÊMES chemins que les écrans (Réglages › Membres, Structure, menus Archiver, fusion de fiches), donc avec les mêmes droits ;
 * la proposition devient validée ou validée en partie. « Défaire » remet ce qui se défait (pas une fusion). « Rejeter » :
 * rien n'est fait. Fond flouté : la fenêtre de la boîte (FormWindow) et les questions (Confirm).
 */

/** Les chemins de l'appli, branchés pour src/propositionsAdmin.ts. */
const deps: DepsAdmin = {
  rpc: supabase ? (fn, args) => supabase!.rpc(fn, args) : null,
  enLigne: () => navigator.onLine,
  evenement: async (id) => (await db.events.get(id)) as unknown as Awaited<ReturnType<DepsAdmin['evenement']>>,
  groupe: async (id) => (await db.groups.get(id)) as unknown as Awaited<ReturnType<DepsAdmin['groupe']>>,
  save: (table, row) => save(table, row as never),
  remove: (table, id) => remove(table, id),
  affectations: async (userId) => (await db.assignments.where('userId').equals(userId).toArray()).filter((a) => !a.deleted),
  fiche: async (id) => db.players.get(id),
  fondre: (source, cible) => mergePlayers(source, cible),
  newId,
}

/** Noms à jour des comptes (Réglages › Membres, hb_members : administrateurs, en ligne) ; sinon ceux de la proposition. */
function useNomsComptes(): Map<string, string> | null {
  const [m, setM] = useState<Map<string, string> | null>(null)
  useEffect(() => {
    if (!supabase || !navigator.onLine) return
    let on = true
    void supabase.rpc('hb_members').then(({ data, error }) => {
      if (on && !error && Array.isArray(data))
        setM(new Map((data as { user_id: string; full_name: string | null }[]).filter((x) => x.full_name).map((x) => [x.user_id, x.full_name!])))
    })
    return () => {
      on = false
    }
  }, [])
  return m
}

/**
 * Fiches d'une fusion, remises SUR L'APPAREIL : « Prénom Nom, 2012 » (et « fiche proposée » pour une fiche en attente de
 * validation), pour distinguer deux homonymes. Libellés neutres seulement.
 */
function useFichesFusion(ids: readonly string[]): Map<string, string> | undefined {
  return useLiveQuery(async () => {
    const ps = ids.length ? await db.players.bulkGet([...ids]) : []
    const m = new Map<string, string>()
    for (const p of ps) {
      if (!p || p.deleted) continue
      const nom = `${p.firstName ?? ''} ${p.lastName ?? ''}`.replace(/\s+/g, ' ').trim()
      const an = /^\d{4}/.test(p.birthDate ?? '') ? p.birthDate!.slice(0, 4) : ''
      m.set(p.id, [nom, an, p.review === 'pending' ? 'fiche proposée' : ''].filter(Boolean).join(', '))
    }
    return m
  }, [ids.join('|')])
}

export function AdminReview({ p, when, onBack }: { p: PropositionRow; when: string; onBack: () => void }) {
  const role = useRole()
  const fiches = useNomsParCode()
  const comptes = useNomsComptes()
  const actions = useMemo(() => actionsDe(p.lignes), [p.id]) // eslint-disable-line react-hooks/exhaustive-deps
  const sorte = sorteProposition(p.contexte)
  const idsFusion = useMemo(() => actions.flatMap((a) => (a.action?.a === 'fusion' ? [a.action.garder, a.action.fondre] : [])), [actions])
  const fichesFusion = useFichesFusion(idsFusion)
  const [cochees, setCochees] = useState<Set<number>>(() => new Set(actions.filter((a) => a.action).map((a) => a.i)))
  const [inverses, setInverses] = useState<Set<number>>(() => new Set())
  const [busy, setBusy] = useState(false)
  const [resultats, setResultats] = useState<Resultat[] | null>(null)
  const [retours, setRetours] = useState<Retour[]>([])
  const admin = role === 'admin'
  const enAttente = p.etat === 'en_attente'
  const noms: Noms = {
    compte: (id, prepare) => comptes?.get(id) || prepare || 'compte',
    fiche: (id) => fichesFusion?.get(id) ?? fiches?.nomDe(id),
    code: codeJoueur,
  }
  const parI = new Map((resultats ?? []).map((r) => [r.i, r]))
  const n = cochees.size
  const toggle = (set: (f: (s: Set<number>) => Set<number>) => void, i: number) =>
    set((s) => {
      const c = new Set(s)
      if (c.has(i)) c.delete(i)
      else c.add(i)
      return c
    })

  const appliquer = async () => {
    const fusions = actions.filter((a) => cochees.has(a.i) && a.action?.a === 'fusion').length
    if (fusions && !(await ask(`${plural(fusions, 'fusion')} de fiches : une fusion ne se défait pas. Appliquer ${plural(n, 'action')} ?`, { ok: `Appliquer ${plural(n, 'action')}` }))) return
    setBusy(true)
    const r = await appliquerActions(actions, cochees, inverses, deps)
    setBusy(false)
    setResultats(r.resultats)
    setRetours(r.retours)
    const etat = etatApresAdmin(actions, r.resultats)
    if (etat !== 'en_attente') await setPropositionEtat(p.id, etat)
    const ok = r.resultats.filter((x) => x.ok).length
    flash(ok === r.resultats.length ? `${plural(ok, 'action appliquée', 'actions appliquées')}.` : `${ok} sur ${r.resultats.length} appliquées : voir le détail.`)
  }

  const defaire = async () => {
    setBusy(true)
    const r = await defaireActions(retours, deps)
    setBusy(false)
    await setPropositionEtat(p.id, 'en_attente')
    const reste = nonDefaisables(resultats ?? [], retours).length
    setResultats(null)
    setRetours([])
    flash(
      reste
        ? `Défait, sauf ${plural(reste, 'action')} qui ne se défait pas (fusion, ou rôle donné à un compte qui n’en avait pas).`
        : r.every((x) => x.ok)
          ? 'Défait : la proposition attend de nouveau.'
          : `Défait en partie : ${r.filter((x) => !x.ok).map((x) => x.message).join(' ; ')}`,
    )
  }

  const rejeter = async () => {
    if (!(await ask(`Rejeter « ${p.titre} » ? Aucune action ne sera faite ; la proposition s’efface d’elle-même dans 7 jours.`, { ok: 'Rejeter', focusCancel: true }))) return
    await setPropositionEtat(p.id, 'rejetee')
    flash('Proposition rejetée.')
    onBack()
  }

  const fait = !!resultats
  const defaisable = retours.length > 0
  return (
    <div className="flex flex-col gap-3" data-proposition-admin={p.id}>
      <div className="min-w-0">
        <h3 className="text-sm font-extrabold break-words">{p.titre}</h3>
        <p className="text-[11px] text-muted">
          <span className="rounded-full bg-accent/15 px-2 py-0.5 font-bold text-accent">{SOURCE_LABEL[p.source]}</span> {when} · {resumeAdmin(sorte, actions)}
        </p>
      </div>
      {!admin ? (
        <p className="rounded-lg bg-panel-2 p-3 text-xs text-muted">Réservé aux administrateurs : seul un administrateur applique ces actions.</p>
      ) : (
        <p className="text-xs text-muted">
          Préparé par Claude avec ton compte. Rien n’est fait avant « Appliquer » : chaque action passe par le même chemin que l’écran habituel (Membres,
          Structure, Archiver, fusion), avec les mêmes droits. Décoche ce que tu ne veux pas.
        </p>
      )}
      <ul className="flex flex-col gap-1.5" aria-label="Actions proposées">
        {actions.map(({ i, action }) => {
          const r = parI.get(i)
          const lib = action ? libelleAction(action, noms, inverses.has(i)) : { titre: 'Action illisible par cette version de l’appli', detail: undefined }
          const coche = cochees.has(i)
          return (
            <li key={i} className={`card flex items-start gap-2.5 p-2.5 ${!coche && !fait ? 'opacity-70' : ''}`}>
              <input
                type="checkbox"
                className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--color-accent)]"
                checked={coche}
                disabled={!action || !admin || fait || !enAttente || busy}
                onChange={() => toggle(setCochees, i)}
                aria-label={lib.titre}
              />
              <div className="min-w-0 flex-1">
                <div className="text-xs font-bold break-words">{lib.titre}</div>
                {lib.detail && <div className="mt-0.5 text-[11px] break-words text-muted">{lib.detail}</div>}
                {r && (
                  <div className={`mt-1 flex items-center gap-1 text-[11px] font-bold ${r.ok ? 'text-accent' : 'text-muted'}`}>
                    <Icon name={r.ok ? 'check' : 'info'} className="h-3.5 w-3.5 shrink-0" />
                    <span className="break-words">{r.message}</span>
                  </div>
                )}
              </div>
              {action?.a === 'fusion' && admin && !fait && enAttente && (
                <button
                  type="button"
                  className="btn-ghost min-h-11 shrink-0 px-2 text-[11px]"
                  onClick={() => toggle(setInverses, i)}
                  aria-pressed={inverses.has(i)}
                  title="Garder l’autre fiche"
                >
                  Inverser
                </button>
              )}
            </li>
          )
        })}
      </ul>
      {fait && nonDefaisables(resultats!, retours).length > 0 && (
        <p className="text-[11px] text-muted">
          {plural(nonDefaisables(resultats!, retours).length, 'action')} ne se défait pas d’ici (une fusion, ou un rôle donné à un compte qui n’en avait pas) :
          Réglages › Membres pour un rôle.
        </p>
      )}
      <FormActions>
        {admin && enAttente && !fait && (
          <button type="button" className="btn-primary" disabled={!n || busy} onClick={() => void appliquer()}>
            {busy ? 'Application…' : `Appliquer ${plural(n, 'action')}`}
          </button>
        )}
        {fait && defaisable && (
          <button type="button" className="btn-ghost" disabled={busy} onClick={() => void defaire()}>
            Défaire
          </button>
        )}
        {admin && enAttente && !fait && (
          <button type="button" className="btn-ghost" disabled={busy} onClick={() => void rejeter()}>
            Rejeter
          </button>
        )}
        <button type="button" className="btn-ghost" disabled={busy} onClick={onBack}>
          ‹ Toutes les propositions
        </button>
      </FormActions>
    </div>
  )
}
