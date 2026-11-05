import {
  lireAction,
  saisonDe,
  SORTE_LIBELLE,
  ADMIN_SORTES,
  type ActionAdmin,
  type ActionArchiver,
  type AdminSorte,
  type RoleProposable,
} from './propositionsAdminCore'
import { etatApresValidation, type PropEtat } from './propositionsCore'

/*
 * Boîte « À valider » : propositions D'ADMINISTRATION préparées par Claude (format : src/propositionsAdminCore.ts ; serveur
 * MCP : supabase/functions/mcp/adminProposer.ts ; table : supabase/070_propositions_admin.sql ; écran :
 * src/components/PropositionsAdmin.tsx). Règles PURES (testées par tools/test-propositions.ts avec de faux chemins) : les
 * libellés des actions, l'application des actions cochées et « Défaire ».
 *
 * L'application passe par les MÊMES chemins que les écrans de l'administrateur, reçus en `DepsAdmin` (src/components/
 * PropositionsAdmin.tsx les branche sur l'appli), donc avec les mêmes contrôles de droits côté base :
 *  - rôle    : hb_update_member(p_user, p_role) comme Réglages › Membres (la base refuse « administrateur », un compte
 *              administrateur et tout appelant qui n'est pas administrateur) ;
 *  - secteur : hb_update_member(p_user, p_departments) comme Réglages › Membres ;
 *  - unité   : une affectation enregistrée comme Structure (save « assignments », synchronisée et vérifiée par la base) ;
 *  - archiver: l'événement ou le groupe enregistré avec archived: true, comme les menus « Archiver » ;
 *  - fusion  : mergePlayers (hb_merge_players, src/merge.ts), comme l'écran « Propositions ».
 * « Défaire » : rôle (si le compte en avait un avant), secteur, unité et archivage se défont par les mêmes chemins ; une
 * fusion ne se défait pas (hb_merge_players n'a pas de retour arrière).
 */

export interface ActionNumerotee {
  /** Rang de la ligne dans la proposition. */
  i: number
  /** L'action, ou null si la ligne n'est pas lisible (jamais applicable). */
  action: ActionAdmin | null
}

/** Actions d'une proposition d'administration. */
export const actionsDe = (lignes: readonly unknown[]): ActionNumerotee[] => lignes.map((l, i) => ({ i, action: lireAction(l) }))

/** Sorte d'une proposition (contexte.sorte), connue de cette version, ou undefined. */
export const sorteProposition = (ctx: { sorte?: unknown }): AdminSorte | undefined => ADMIN_SORTES.find((s) => s === ctx.sorte)

/** Noms remis sur l'appareil : comptes (nom à jour si connu) et fiches (prénom nom). */
export interface Noms {
  compte(userId: string, nomPrepare: string): string
  fiche(id: string): string | undefined
  /** Code « J-… » d'une fiche (src/codesJoueurs.ts). */
  code(id: string): string
}

const ROLE_MOT: Record<string, string> = { admin: 'Administrateur', preparateur: 'Encadrant', observateur: 'Observateur', joueur: 'Joueur' }
export const roleMot = (r?: string | null) => (r && ROLE_MOT[r]) || 'aucun rôle'

const dateFr = (d?: string) => (d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : '')

/** « Fiche « Lucas Exemple » (J-…) » ; fiche absente de l'appareil : son code. */
function ficheMot(id: string, n: Noms) {
  const nom = n.fiche(id)
  return nom ? `« ${nom} »` : `la fiche ${n.code(id)} (absente de cet appareil)`
}

/** Libellé d'une action, avec les noms remis sur l'appareil (fusion : `inverse` échange les deux fiches). */
export function libelleAction(x: ActionAdmin, n: Noms, inverse = false): { titre: string; detail?: string } {
  switch (x.a) {
    case 'role':
      return { titre: `Donner le rôle ${roleMot(x.role)} à ${n.compte(x.userId, x.nom)}`, detail: `rôle actuel : ${roleMot(x.avant)} · ${x.compte}` }
    case 'unite':
      return { titre: `Affecter ${n.compte(x.userId, x.nom)} à « ${x.unite} »`, detail: `rôle dans l’unité : ${roleMot(x.roleUnite)} · ${x.compte}` }
    case 'secteur':
      return {
        titre: x.depts.length ? `Secteur de ${n.compte(x.userId, x.nom)} : ${x.depts.join(', ')}` : `Secteur de ${n.compte(x.userId, x.nom)} : aucun (valide tous les départements)`,
        detail: x.compte,
      }
    case 'archiver':
      return {
        titre: `Archiver ${x.quoi === 'groupe' ? 'le groupe' : 'l’événement'} « ${x.nom} »`,
        detail: x.date ? `${dateFr(x.date)}${saisonDe(x.date) ? ` · saison ${saisonDe(x.date)}` : ''}` : undefined,
      }
    case 'fusion': {
      const [g, f] = inverse ? [x.fondre, x.garder] : [x.garder, x.fondre]
      return { titre: `Fondre ${ficheMot(f, n)} dans ${ficheMot(g, n)}`, detail: `${n.code(f)} → ${n.code(g)} · la fiche gardée reçoit les avis, mesures et événements de l’autre` }
    }
  }
}

/** Résumé d'une proposition : « Archiver 12 événements de la saison 2025-26 », « Donner 3 rôles »… */
export function resumeAdmin(sorte: AdminSorte | undefined, actions: readonly ActionNumerotee[]): string {
  const xs = actions.map((a) => a.action).filter((a): a is ActionAdmin => !!a)
  const pl = (k: number, s: string, p = `${s}s`) => `${k} ${k > 1 ? p : s}`
  if (sorte === 'archiver') {
    const evs = xs.filter((a): a is ActionArchiver => a.a === 'archiver' && a.quoi === 'evenement')
    const grs = xs.filter((a) => a.a === 'archiver' && a.quoi === 'groupe').length
    const saisons = [...new Set(evs.map((e) => saisonDe(e.date)).filter(Boolean))]
    const ev = evs.length ? `${pl(evs.length, 'événement')}${saisons.length === 1 ? ` de la saison ${saisons[0]}` : ''}` : ''
    return `Archiver ${[ev, grs ? pl(grs, 'groupe') : ''].filter(Boolean).join(' et ') || 'rien'}`
  }
  if (sorte === 'role') return `Donner ${pl(xs.length, 'rôle')}`
  if (sorte === 'perimetre') return `${pl(xs.length, 'affectation')} de périmètre`
  if (sorte === 'fusion') return `Fondre ${pl(xs.length, 'paire', 'paires')} de fiches`
  return sorte ? SORTE_LIBELLE[sorte] : 'Proposition d’administration'
}

// ---------- Application ----------

type Erreur = { message: string } | null
type Rpc = (fn: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: Erreur }>

/** Les chemins de l'appli (ceux des écrans de l'administrateur). */
export interface DepsAdmin {
  /** supabase.rpc ; null : version sans serveur (rôles, secteurs et fusions demandent le serveur). */
  rpc: Rpc | null
  enLigne(): boolean
  evenement(id: string): Promise<({ id: string; archived?: boolean; deleted?: boolean } & Record<string, unknown>) | undefined>
  groupe(id: string): Promise<({ id: string; archived?: boolean; deleted?: boolean; poleUnitId?: string } & Record<string, unknown>) | undefined>
  /** save() de src/db.ts (synchronisé, vérifié par la base). */
  save(table: 'events' | 'groups' | 'assignments', row: Record<string, unknown> & { id: string }): Promise<unknown>
  /** remove() de src/db.ts. */
  remove(table: 'assignments', id: string): Promise<unknown>
  /** Affectations vivantes d'un compte (src/db.ts, table assignments). */
  affectations(userId: string): Promise<{ id: string; unitId: string }[]>
  fiche(id: string): Promise<{ id: string; deleted?: boolean; mergedInto?: string } | undefined>
  /** mergePlayers de src/merge.ts : message d'erreur, ou null si c'est fait. */
  fondre(source: string, cible: string): Promise<string | null>
  newId(): string
}

export interface Resultat {
  i: number
  ok: boolean
  /** « fait », « déjà fait », ou la raison (texte neutre). */
  message: string
}

/** Ce qu'il faut pour défaire une action appliquée. */
export type Retour =
  | { i: number; k: 'role'; userId: string; role: RoleProposable }
  | { i: number; k: 'secteur'; userId: string; depts: string[] }
  | { i: number; k: 'unite'; id: string }
  | { i: number; k: 'archiver'; quoi: 'evenement' | 'groupe'; id: string }

const SERVEUR = 'se fait en ligne, avec le serveur (version connectée)'

/**
 * Applique les actions cochées, une à une, par les chemins de l'appli. `inverses` : fusions dont l'administrateur a échangé
 * les deux fiches. Rend un résultat par action cochée et ce qu'il faut pour « Défaire ».
 */
export async function appliquerActions(
  actions: readonly ActionNumerotee[],
  cochees: ReadonlySet<number>,
  inverses: ReadonlySet<number>,
  d: DepsAdmin,
): Promise<{ resultats: Resultat[]; retours: Retour[] }> {
  const resultats: Resultat[] = []
  const retours: Retour[] = []
  const choisies = actions.filter((a) => cochees.has(a.i))
  // Rôles et secteurs actuels (pour « Défaire »), lus comme Réglages › Membres (hb_members, administrateurs).
  let membres: Map<string, { role: string | null; departments: string[] }> | null = null
  if (d.rpc && choisies.some((a) => a.action?.a === 'role' || a.action?.a === 'secteur')) {
    const { data, error } = await d.rpc('hb_members')
    if (!error && Array.isArray(data))
      membres = new Map((data as { user_id: string; role: string | null; departments: string[] | null }[]).map((m) => [m.user_id, { role: m.role, departments: m.departments ?? [] }]))
  }
  for (const { i, action: x } of choisies) {
    const fin = (ok: boolean, message: string) => resultats.push({ i, ok, message })
    if (!x) {
      fin(false, 'ligne illisible par cette version de l’appli')
      continue
    }
    try {
      if (x.a === 'role' || x.a === 'secteur' || x.a === 'fusion') {
        if (!d.rpc) {
          fin(false, SERVEUR)
          continue
        }
        if (!d.enLigne()) {
          fin(false, 'demande d’être en ligne')
          continue
        }
      }
      if (x.a === 'role') {
        const avant = membres?.get(x.userId)
        if (avant && avant.role === x.role) {
          fin(true, 'déjà fait')
          continue
        }
        const { error } = await d.rpc!('hb_update_member', { p_user: x.userId, p_role: x.role })
        if (error) {
          fin(false, error.message)
          continue
        }
        if (avant?.role === 'observateur' || avant?.role === 'preparateur' || avant?.role === 'joueur') retours.push({ i, k: 'role', userId: x.userId, role: avant.role })
        fin(true, 'fait')
      } else if (x.a === 'secteur') {
        const avant = membres?.get(x.userId)
        const { error } = await d.rpc!('hb_update_member', { p_user: x.userId, p_departments: x.depts })
        if (error) {
          fin(false, error.message)
          continue
        }
        if (avant) retours.push({ i, k: 'secteur', userId: x.userId, depts: avant.departments })
        fin(true, 'fait')
      } else if (x.a === 'unite') {
        if ((await d.affectations(x.userId)).some((a) => a.unitId === x.uniteId)) {
          fin(true, 'déjà fait')
          continue
        }
        const id = d.newId()
        await d.save('assignments', { id, userId: x.userId, unitId: x.uniteId, role: x.roleUnite, userName: x.nom })
        retours.push({ i, k: 'unite', id })
        fin(true, 'fait')
      } else if (x.a === 'archiver') {
        const row = x.quoi === 'groupe' ? await d.groupe(x.id) : await d.evenement(x.id)
        if (!row || row.deleted) {
          fin(false, `${x.quoi === 'groupe' ? 'groupe' : 'événement'} introuvable sur cet appareil (supprimé, ou pas encore reçu)`)
          continue
        }
        if (row.archived) {
          fin(true, 'déjà fait')
          continue
        }
        if (x.quoi === 'groupe' && (row as { poleUnitId?: string }).poleUnitId) {
          fin(false, 'groupe Pôle : passe d’une saison à l’autre par « Changement de saison »')
          continue
        }
        await d.save(x.quoi === 'groupe' ? 'groups' : 'events', { ...row, archived: true })
        retours.push({ i, k: 'archiver', quoi: x.quoi, id: x.id })
        fin(true, 'fait')
      } else {
        const [garder, fondre] = inverses.has(i) ? [x.fondre, x.garder] : [x.garder, x.fondre]
        const [g, f] = await Promise.all([d.fiche(garder), d.fiche(fondre)])
        if (!g || g.deleted || g.mergedInto || !f || f.deleted || f.mergedInto) {
          fin(false, 'une des fiches a déjà été fondue ou n’est plus sur cet appareil')
          continue
        }
        const err = await d.fondre(fondre, garder)
        if (err) fin(false, err)
        else fin(true, 'fait')
      }
    } catch (e) {
      fin(false, e instanceof Error ? e.message : String(e))
    }
  }
  return { resultats, retours }
}

/** Défait ce qui a été appliqué (du dernier au premier), par les mêmes chemins. */
export async function defaireActions(retours: readonly Retour[], d: DepsAdmin): Promise<Resultat[]> {
  const out: Resultat[] = []
  for (const r of [...retours].reverse()) {
    try {
      if (r.k === 'role' || r.k === 'secteur') {
        if (!d.rpc) {
          out.push({ i: r.i, ok: false, message: SERVEUR })
          continue
        }
        const { error } = await d.rpc('hb_update_member', r.k === 'role' ? { p_user: r.userId, p_role: r.role } : { p_user: r.userId, p_departments: r.depts })
        out.push({ i: r.i, ok: !error, message: error ? error.message : 'défait' })
      } else if (r.k === 'unite') {
        await d.remove('assignments', r.id)
        out.push({ i: r.i, ok: true, message: 'défait' })
      } else {
        const row = r.quoi === 'groupe' ? await d.groupe(r.id) : await d.evenement(r.id)
        if (row && !row.deleted) await d.save(r.quoi === 'groupe' ? 'groups' : 'events', { ...row, archived: false })
        out.push({ i: r.i, ok: !!row, message: row ? 'défait' : 'introuvable' })
      }
    } catch (e) {
      out.push({ i: r.i, ok: false, message: e instanceof Error ? e.message : String(e) })
    }
  }
  return out.reverse()
}

/** Actions qui ne se défont pas (fusions faites, rôle donné à un compte qui n'en avait pas). */
export function nonDefaisables(resultats: readonly Resultat[], retours: readonly Retour[]): number[] {
  const avec = new Set(retours.map((r) => r.i))
  return resultats.filter((r) => r.ok && r.message === 'fait' && !avec.has(r.i)).map((r) => r.i)
}

/**
 * État de la proposition après « Appliquer » : toutes ses actions lisibles faites (ou déjà faites) → validée ; une partie →
 * validée en partie ; aucune → toujours en attente.
 */
export function etatApresAdmin(actions: readonly ActionNumerotee[], resultats: readonly Resultat[]): PropEtat {
  return etatApresValidation({ lignes: actions.filter((a) => a.action).length, enregistrees: resultats.filter((r) => r.ok).length })
}
