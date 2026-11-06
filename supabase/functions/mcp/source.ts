// Nextar, serveur MCP : accès aux données AUX DROITS DU COACH. Le client Supabase reçu est celui de SON jeton (OAuth, via
// withSupabase({ auth: 'user' }) de @supabase/server) : chaque lecture passe par les règles de la base (rôle du staff,
// périmètre de 046/047, groupes privés de 017…), chaque écriture par les règles de hb_propositions (067) et hb_rapports
// (068). JAMAIS la clé de service ici.
//
// Ce qui est lu, colonne par colonne (sélections PostgREST explicites, jamais « data » entier pour les joueurs) :
//  - nextar_lire : id, année tirée de la date de naissance (la date reste ici), sexe, poste, département (scope_dept) ;
//    mesures (joueur, test, valeur, date), avis (joueur, date, notes chiffrées ; ni points forts, ni axes, ni portrait), vus ;
//  - nextar_proposer : prénom, nom et date de naissance des joueurs du contexte, pour le rapprochement fait ici ; rien de
//    cela ne sort (outils.ts, verifierSortie) ;
//  - nextar_connexions (administrateurs) : hb_is_admin() d'abord ; puis hb_connections (compte, type d'appareil, début et
//    dernier signe de vie ; la table n'a ni adresse IP ni navigateur ; lisible par les administrateurs seulement, 030),
//    hb_profiles (user_id, full_name, role, departments : JAMAIS email ni phone, que la base ne donne d'ailleurs pas en
//    lecture directe, 029), affectations et unités (nom, départements, n° de club, niveau ; ni adresse ni ville) ;
//  - outils d'administration (admin.ts ; appelés APRÈS hb_is_admin) : hb_profiles (user_id, full_name, role, created_at) ;
//    fiches proposées (id, année tirée de la date, poste, département, auteur, date de création) ; avis en attente (joueur,
//    date, auteur ; ni notes ni commentaires) ; prénom, nom, date de naissance et état des fiches, pour les doublons et le
//    masquage des questions (jamais rendus) ; journal des questions (phrase, issue, page, verdict, commentaire, auteur : ni
//    requête SQL, ni détail d'erreur, ni nom d'auteur) ; nombres de lignes (count, head : aucune ligne transférée) ;
//    hb_admin_sante (069), hb_last_seen (030), dernière date de l'historique (hb_audit.at seulement : ni résumé ni changements) ;
//  - traçabilité (adminTraces.ts ; APRÈS hb_is_admin) : lignes créées (identifiant, heure d'écriture, supprimée, auteur,
//    signature SQL ou non, createdAtServer, data.source, data.lotId, data.demoBilan, data.imported->>at ; joueur, test,
//    valeur, date, événement, nom d'un événement, notes chiffrées d'un avis : ni nom, ni commentaire, ni « data » entier) ;
//    historique hb_audit (heure, compte, table, ligne, action : ni user_name, ni résumé, ni changements) ; hb_admin_creations,
//    hb_admin_saisies et hb_lots (071 ; absents : null, les outils passent aux lignes lues) ;
//  - nextar_admin_proposer (adminProposer.ts ; APRÈS hb_is_admin) : profils (comme ci-dessus), unités (id, nom), identifiants
//    des fiches et « fondue » (ni nom, ni date, ni club), événements et groupes (comme nextar_contexte, plus « groupe Pôle ») ;
//    une seule écriture : la proposition « admin » dans hb_propositions (070), avec le jeton du compte.
// Fichier sans import Deno (testable avec npx jiti et un faux client, tools/test-mcp.ts).

import { eventNumbers } from './partage/importMesures.ts'
import type { ConfigRow } from './partage/sportConfig.ts'
import type {
  ActiviteSrv,
  AvisSrv,
  Comptage,
  CompteSrv,
  CritereSrv,
  EvenementSrv,
  FiltreJoueurs,
  GroupeSrv,
  JoueurLire,
  JoueurNom,
  JournalSrv,
  MesureSrv,
  NomJoueurSrv,
  ProfilSrv,
  PropositionSrv,
  Provenance,
  SessionSrv,
  Source,
  TraceSrv,
  TypeTrace,
  VuSrv,
} from './outils.ts'

/** Ce dont on se sert du client supabase-js (requêtes PostgREST). */
// deno-lint-ignore no-explicit-any
export type ClientSupabase = { from(table: string): any; rpc(fn: string, args?: Record<string, unknown>): any }

const PAGE = 1000
const PAR = 150 // identifiants par requête « in » (longueur de l'adresse)

type Res<T> = { data: T[] | null; error: { message: string; code?: string } | null }

const absente = (e: { code?: string } | null) => !!e && (e.code === '42P01' || e.code === 'PGRST205')

/** Lit page après page (1 000 lignes), jusqu'à `max` lignes ; `tronque` s'il en restait. */
async function pages<T>(q: (from: number, to: number) => PromiseLike<Res<T>>, max: number): Promise<{ rows: T[]; tronque: boolean }> {
  const rows: T[] = []
  for (let from = 0; ; from += PAGE) {
    const want = Math.min(PAGE, max + 1 - from)
    if (want <= 0) return { rows: rows.slice(0, max), tronque: true }
    const { data, error } = await q(from, from + want - 1)
    if (error) throw new Error(error.message)
    rows.push(...(data ?? []))
    if (rows.length > max) return { rows: rows.slice(0, max), tronque: true }
    if ((data ?? []).length < want) return { rows, tronque: false }
  }
}

/** Par paquets d'identifiants. */
async function parPaquets<T>(ids: readonly string[], q: (paquet: string[]) => Promise<T[]>): Promise<T[]> {
  const out: T[] = []
  for (let i = 0; i < ids.length; i += PAR) out.push(...(await q(ids.slice(i, i + PAR))))
  return out
}

const str = (v: unknown) => (typeof v === 'string' ? v : undefined)
const arr = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : undefined)
const yearOf = (d?: string | null) => (d && /^\d{4}/.test(d) ? +d.slice(0, 4) : undefined)

/** `moi` : identifiant du compte du jeton (claims vérifiés par withSupabase, index.ts), pour nextar_admin_proposer. */
export function sourceSupabase(sb: ClientSupabase, moi?: string | null): Source {
  const evenementDe = (id: string, d: Record<string, unknown>): EvenementSrv => ({
    id,
    name: str(d.name) ?? 'Événement',
    type: str(d.type),
    date: str(d.date),
    archived: d.archived === true,
    playerIds: arr(d.playerIds) ?? [],
    nums: eventNumbers(d as Parameters<typeof eventNumbers>[0]),
  })
  const joueursVivants = <T extends { m?: string | null; r?: string | null }>(rows: T[]) => rows.filter((r) => !r.m && r.r !== 'refused')

  return {
    async criteres(): Promise<CritereSrv[]> {
      const { rows } = await pages<{ id: string; data: Record<string, unknown> }>((a, b) => sb.from('hb_criteria').select('id, data').eq('deleted', false).range(a, b), 5000)
      return rows.map(({ id, data: d }) => ({
        id,
        label: str(d.label) ?? id,
        category: str(d.category),
        kind: d.kind === 'subjective' ? 'subjective' : 'factual',
        scale: (str(d.scale) as CritereSrv['scale']) ?? 'number',
        unit: str(d.unit),
        options: arr(d.options),
        positions: arr(d.positions),
        active: d.active !== false,
        order: typeof d.order === 'number' ? d.order : 0,
      }))
    },

    async config(): Promise<ConfigRow[]> {
      const { data, error } = await sb.from('hb_config').select('id, data').eq('deleted', false).limit(100)
      if (error) return []
      return ((data ?? []) as { id: string; data: Record<string, unknown> }[]).map(({ id, data: d }) => ({ id, key: str(d.key) ?? id, value: d.value }) as ConfigRow)
    },

    async evenements({ archives }): Promise<EvenementSrv[]> {
      const { rows } = await pages<{ id: string; n: string | null; t: string | null; d: string | null; a: unknown; p: unknown }>(
        (a, b) => sb.from('hb_events').select('id, n:data->>name, t:data->>type, d:data->>date, a:data->archived, p:data->playerIds').eq('deleted', false).order('data->>date', { ascending: false }).range(a, b),
        600,
      )
      return rows
        .map((r) => ({ id: r.id, name: r.n ?? 'Événement', type: r.t ?? undefined, date: r.d ?? undefined, archived: r.a === true, playerIds: arr(r.p) ?? [] }))
        .filter((e) => archives || !e.archived)
    },

    async evenement(id): Promise<EvenementSrv | null> {
      const { data, error } = await sb.from('hb_events').select('id, data').eq('id', id).eq('deleted', false).maybeSingle()
      if (error || !data) return null
      return evenementDe(data.id, data.data ?? {})
    },

    async groupes({ archives }): Promise<GroupeSrv[]> {
      const { rows } = await pages<{ id: string; n: string | null; a: unknown; p: unknown; pu: string | null }>(
        (a, b) => sb.from('hb_groups').select('id, n:data->>name, a:data->archived, p:data->playerIds, pu:data->>poleUnitId').eq('deleted', false).range(a, b),
        600,
      )
      return rows
        .map((r) => ({ id: r.id, name: r.n ?? 'Groupe', archived: r.a === true, playerIds: arr(r.p) ?? [], ...(r.pu ? { pole: true } : {}) }))
        .filter((g) => archives || !g.archived)
    },

    async groupe(id): Promise<GroupeSrv | null> {
      const { data, error } = await sb.from('hb_groups').select('id, n:data->>name, a:data->archived, p:data->playerIds, pu:data->>poleUnitId').eq('id', id).eq('deleted', false).maybeSingle()
      if (error || !data) return null
      return { id: data.id, name: data.n ?? 'Groupe', archived: data.a === true, playerIds: arr(data.p) ?? [], ...(data.pu ? { pole: true } : {}) }
    },

    async joueursLire(f: FiltreJoueurs, max: number) {
      // Aucun nom demandé à la base : seulement ce qui peut sortir (l'année est tirée de la date, qui reste ici).
      type Row = { id: string; b: string | null; s: string | null; p: string | null; dept: string | null; m: string | null; r: string | null }
      const COLS = 'id, b:data->>birthDate, s:data->>sex, p:data->>position, dept:scope_dept, m:data->>mergedInto, r:data->>review'
      // deno-lint-ignore no-explicit-any
      const filtres = (q: any) => {
        q = q.eq('deleted', false)
        if (f.sexe) q = q.eq('data->>sex', f.sexe)
        if (f.postes?.length) q = q.in('data->>position', f.postes)
        if (f.depts?.length) q = q.in('scope_dept', f.depts)
        if (f.annees?.length) q = q.or(f.annees.map((y) => `data->>birthDate.like.${y}*`).join(','))
        return q
      }
      let rows: Row[]
      let tronque = false
      if (f.ids) {
        rows = await parPaquets(f.ids, async (paquet) => {
          const { data, error } = await filtres(sb.from('hb_players').select(COLS)).in('id', paquet)
          if (error) throw new Error(error.message)
          return (data ?? []) as Row[]
        })
        if (rows.length > max) {
          rows = rows.slice(0, max)
          tronque = true
        }
      } else {
        const r = await pages<Row>((a, b) => filtres(sb.from('hb_players').select(COLS)).order('id').range(a, b), max)
        rows = r.rows
        tronque = r.tronque
      }
      const joueurs: JoueurLire[] = joueursVivants(rows).map((r) => ({
        id: r.id,
        ...(yearOf(r.b) ? { annee: yearOf(r.b) } : {}),
        ...(r.s === 'M' || r.s === 'F' ? { sexe: r.s } : {}),
        ...(r.p ? { poste: r.p } : {}),
        ...(r.dept ? { dept: r.dept } : {}),
      }))
      return { joueurs, tronque }
    },

    async joueursNoms(ids, max) {
      type Row = { id: string; f: string | null; l: string | null; b: string | null; m: string | null; r: string | null }
      const COLS = 'id, f:data->>firstName, l:data->>lastName, b:data->>birthDate, m:data->>mergedInto, r:data->>review'
      let rows: Row[]
      let tronque = false
      if (ids) {
        rows = await parPaquets(ids.slice(0, max), async (paquet) => {
          const { data, error } = await sb.from('hb_players').select(COLS).eq('deleted', false).in('id', paquet)
          if (error) throw new Error(error.message)
          return (data ?? []) as Row[]
        })
        tronque = ids.length > max
      } else {
        const r = await pages<Row>((a, b) => sb.from('hb_players').select(COLS).eq('deleted', false).order('id').range(a, b), max)
        rows = r.rows
        tronque = r.tronque
      }
      const joueurs: JoueurNom[] = joueursVivants(rows).map((r) => ({ id: r.id, firstName: r.f ?? '', lastName: r.l ?? '', ...(r.b ? { birthDate: r.b } : {}) }))
      return { joueurs, tronque }
    },

    async mesures(ids): Promise<MesureSrv[]> {
      type Row = { p: string; c: string; v: number | string; d: string }
      const rows = await parPaquets(ids, async (paquet) =>
        (await pages<Row>((a, b) => sb.from('hb_measurements').select('p:data->>playerId, c:data->>criterionId, v:data->value, d:data->>date').eq('deleted', false).in('data->>playerId', paquet).range(a, b), 50_000)).rows,
      )
      return rows.filter((r) => r.p && r.c && r.d && r.v !== null && r.v !== undefined).map((r) => ({ playerId: r.p, criterionId: r.c, value: r.v, date: r.d }))
    },

    async avis(ids): Promise<AvisSrv[]> {
      // Notes chiffrées seulement : ni points forts, ni axes de progression, ni portrait, ni observateur.
      type Row = { p: string; d: string | null; s: Record<string, number | string> | null; r: string | null }
      const rows = await parPaquets(ids, async (paquet) =>
        (await pages<Row>((a, b) => sb.from('hb_evaluations').select('p:data->>playerId, d:data->>date, s:data->scores, r:data->>review').eq('deleted', false).in('data->>playerId', paquet).range(a, b), 50_000)).rows,
      )
      return rows.filter((r) => r.p && r.r !== 'refused').map((r) => ({ playerId: r.p, ...(r.d ? { date: r.d } : {}), scores: r.s && typeof r.s === 'object' ? r.s : {} }))
    },

    async vus(ids): Promise<VuSrv[]> {
      type Row = { p: string; e: string }
      const rows = await parPaquets(ids, async (paquet) =>
        (await pages<Row>((a, b) => sb.from('hb_seen').select('p:data->>playerId, e:data->>eventId').eq('deleted', false).in('data->>playerId', paquet).range(a, b), 50_000)).rows,
      )
      return rows.filter((r) => r.p && r.e).map((r) => ({ playerId: r.p, eventId: r.e }))
    },

    async deposerProposition(p) {
      const { data, error } = await sb.from('hb_propositions').insert({ source: 'mcp', kind: p.kind ?? 'mesures', titre: p.titre, contexte: p.contexte, lignes: p.lignes }).select('id').single()
      if (absente(error)) return { erreur: 'la boîte « À valider » n’est pas encore installée sur le serveur (script 067).' }
      if (error || !data) return { erreur: error?.message ?? 'refus du serveur' }
      return { id: data.id as string }
    },

    async proposition(id) {
      const { data, error } = await sb.from('hb_propositions').select('id, source, kind, titre, etat, created_at, updated_at, expires_at, deleted_at, lignes').eq('id', id).maybeSingle()
      if (error || !data) return null
      return { id: data.id, source: data.source, kind: data.kind, titre: data.titre, etat: data.etat, nbLignes: Array.isArray(data.lignes) ? data.lignes.length : 0, created_at: data.created_at, updated_at: data.updated_at, expires_at: data.expires_at, deleted_at: data.deleted_at }
    },

    async propositions(limite) {
      const { data, error } = await sb.from('hb_propositions').select('id, source, kind, titre, etat, created_at, updated_at, expires_at, deleted_at').order('created_at', { ascending: false }).limit(limite)
      if (error || !data) return []
      return (data as Omit<PropositionSrv, 'nbLignes'>[]).map((p) => ({ ...p, nbLignes: -1 }))
    },

    async deposerRapport(r) {
      const { data, error } = await sb.from('hb_rapports').insert({ titre: r.titre, contenu: r.contenu }).select('id, expires_at').single()
      if (absente(error)) return { erreur: 'les rapports ne sont pas encore installés sur le serveur (script 068).' }
      if (error || !data) return { erreur: error?.message ?? 'refus du serveur' }
      return { id: data.id as string, expires_at: data.expires_at as string }
    },

    async estAdmin() {
      const { data, error } = await sb.rpc('hb_is_admin')
      return !error && data === true
    },

    async connexions(depuis, max) {
      type Row = { u: string; d: string | null; s: string; l: string }
      const r = await pages<Row>(
        (a, b) => sb.from('hb_connections').select('u:user_id, d:device, s:started_at, l:last_seen_at').gte('last_seen_at', depuis).order('last_seen_at', { ascending: false }).range(a, b),
        max,
      )
      const sessions: SessionSrv[] = r.rows.filter((x) => x.u && x.l).map((x) => ({ userId: x.u, device: x.d, startedAt: x.s, lastSeenAt: x.l }))
      return { sessions, tronque: r.tronque }
    },

    async comptes(ids): Promise<CompteSrv[]> {
      // Profils : colonnes nommées une à une ; ni email ni phone (que la base réserve d'ailleurs à hb_members, 029).
      type Prof = { user_id: string; full_name: string | null; role: string | null; departments: string[] | null }
      const profils = await parPaquets(ids, async (paquet) => {
        const { data, error } = await sb.from('hb_profiles').select('user_id, full_name, role, departments').in('user_id', paquet)
        if (error) throw new Error(error.message)
        return (data ?? []) as Prof[]
      })
      // Structure (044) : facultative ; absente ou illisible, pas de périmètre (le secteur du profil reste).
      type Aff = { u: string | null; unite: string | null }
      type Unite = { id: string; n: string | null; l: string | null; d: unknown; c: string | null }
      let affs: Aff[] = []
      let unites: Unite[] = []
      let niveaux: { id: string; n: string | null }[] = []
      try {
        affs = await parPaquets(ids, async (paquet) => {
          const { data, error } = await sb.from('hb_assignments').select('u:data->>userId, unite:data->>unitId').eq('deleted', false).in('data->>userId', paquet)
          if (error) throw new Error(error.message)
          return (data ?? []) as Aff[]
        })
        const uids = [...new Set(affs.map((a) => a.unite).filter((x): x is string => !!x))]
        unites = await parPaquets(uids, async (paquet) => {
          const { data, error } = await sb.from('hb_units').select('id, n:data->>name, l:data->>levelId, d:data->departments, c:data->>clubNumber').eq('deleted', false).in('id', paquet)
          if (error) throw new Error(error.message)
          return (data ?? []) as Unite[]
        })
        if (unites.length) {
          const { data } = await sb.from('hb_levels').select('id, n:data->>name').eq('deleted', false).limit(200)
          niveaux = (data ?? []) as { id: string; n: string | null }[]
        }
      } catch {
        affs = []
        unites = []
      }
      const fold = (x: string) => x.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
      const federation = (levelId: string | null) => levelId === 'niveau-federation' || niveaux.some((n) => n.id === levelId && fold(n.n ?? '').startsWith('federation'))
      const parId = new Map(unites.map((u) => [u.id, u]))
      return profils.map((p) => {
        const mes = [...new Set(affs.filter((a) => a.u === p.user_id).map((a) => a.unite))].map((id) => (id ? parId.get(id) : undefined)).filter((u): u is Unite => !!u)
        return {
          userId: p.user_id,
          fullName: p.full_name,
          role: p.role,
          departments: Array.isArray(p.departments) ? p.departments : null,
          ...(mes.length
            ? { unites: mes.map((u) => ({ name: u.n ?? 'Unité', depts: arr(u.d) ?? [], ...(u.c?.trim() ? { club: u.c.trim() } : {}), ...(federation(u.l) ? { federation: true } : {}) })) }
            : {}),
        }
      })
    },

    // ---------- Administration (admin.ts) ----------

    async profils(): Promise<ProfilSrv[]> {
      // Colonnes nommées une à une : ni email ni phone (029 ne les donne d'ailleurs pas en lecture directe).
      const { rows } = await pages<{ user_id: string; full_name: string | null; role: string | null; created_at: string | null }>(
        (a, b) => sb.from('hb_profiles').select('user_id, full_name, role, created_at').order('created_at').range(a, b),
        5000,
      )
      return rows.filter((p) => p.user_id && p.role !== 'joueur').map((p) => ({ userId: p.user_id, fullName: p.full_name, role: p.role, createdAt: p.created_at }))
    },

    async fichesAValider(max) {
      type Row = { id: string; b: string | null; p: string | null; dept: string | null; m: string | null; by: string | null; at: string | null }
      const { data, error, count } = await sb
        .from('hb_players')
        .select('id, b:data->>birthDate, p:data->>position, dept:scope_dept, m:data->>mergedInto, by:created_by, at:data->>createdAtServer', { count: 'exact' })
        .eq('deleted', false)
        .eq('data->>review', 'pending')
        .is('data->>mergedInto', null)
        .order('data->>createdAtServer', { ascending: true })
        .range(0, Math.max(0, max - 1))
      if (error) throw new Error(error.message)
      const rows = ((data ?? []) as Row[]).filter((r) => !r.m)
      return {
        fiches: rows.map((r) => ({ id: r.id, ...(yearOf(r.b) ? { annee: yearOf(r.b) } : {}), ...(r.p ? { poste: r.p } : {}), ...(r.dept ? { dept: r.dept } : {}), createdBy: r.by, createdAt: r.at })),
        total: typeof count === 'number' ? count : rows.length,
      }
    },

    async avisAValider(max) {
      type Row = { p: string | null; d: string | null; by: string | null; at: string | null }
      const { data, error, count } = await sb
        .from('hb_evaluations')
        .select('p:data->>playerId, d:data->>date, by:created_by, at:data->>createdAtServer', { count: 'exact' })
        .eq('deleted', false)
        .eq('data->>review', 'pending')
        .order('data->>createdAtServer', { ascending: true })
        .range(0, Math.max(0, max - 1))
      if (error) throw new Error(error.message)
      const rows = ((data ?? []) as Row[]).filter((r): r is Row & { p: string } => !!r.p)
      return { avis: rows.map((r) => ({ playerId: r.p, date: r.d, createdBy: r.by, createdAt: r.at })), total: typeof count === 'number' ? count : rows.length }
    },

    async nomsJoueurs(max) {
      type Row = { id: string; f: string | null; l: string | null; b: string | null; r: string | null; m: string | null }
      const r = await pages<Row>(
        (a, b) => sb.from('hb_players').select('id, f:data->>firstName, l:data->>lastName, b:data->>birthDate, r:data->>review, m:data->>mergedInto').eq('deleted', false).order('id').range(a, b),
        max,
      )
      const joueurs: NomJoueurSrv[] = r.rows
        .filter((x) => !x.m)
        .map((x) => ({ id: x.id, firstName: x.f ?? '', lastName: x.l ?? '', ...(x.b ? { birthDate: x.b } : {}), ...(x.r ? { review: x.r } : {}) }))
      return { joueurs, tronque: r.tronque }
    },

    async propositionsEnAttente(max) {
      const { data, error, count } = await sb
        .from('hb_propositions')
        .select('id, source, kind, titre, etat, created_at, updated_at, expires_at, deleted_at', { count: 'exact' })
        .eq('etat', 'en_attente')
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
        .range(0, Math.max(0, max - 1))
      if (absente(error)) return { propositions: [], total: 0 }
      if (error) throw new Error(error.message)
      const rows = (data ?? []) as Omit<PropositionSrv, 'nbLignes'>[]
      return { propositions: rows.map((p) => ({ ...p, nbLignes: -1 })), total: typeof count === 'number' ? count : rows.length }
    },

    async journal(depuis, max) {
      // Ni sql, ni sqlRetry, ni detail, ni authorName : jamais demandés.
      type Row = {
        id: string; at: string | null; u: string | null; ph: string | null; r: string | null; s: string | null; rm: unknown; d: string | null
        pg: string | null; k: string | null; q: string | null; v: string | null; c: string | null; rd: unknown
      }
      const COLS = 'id, at:data->>at, u:data->>authorId, ph:data->>phrase, r:data->>recipe, s:data->>status, rm:data->recipeMissing, d:data->>display, pg:data->>page, k:data->>kind, q:data->>questionId, v:data->>verdict, c:data->>comment, rd:data->recipeDone'
      let r: { rows: Row[]; tronque: boolean }
      try {
        r = await pages<Row>((a, b) => sb.from('hb_question_log').select(COLS).eq('deleted', false).gte('data->>at', depuis).order('data->>at', { ascending: false }).range(a, b), max)
      } catch (e) {
        if (e instanceof Error && /hb_question_log|does not exist|PGRST205/.test(e.message)) return { lignes: [], tronque: false }
        throw e
      }
      const lignes: JournalSrv[] = r.rows
        .filter((x) => x.id && x.at)
        .map((x) => ({
          id: x.id,
          at: x.at!,
          ...(x.u ? { authorId: x.u } : {}),
          ...(x.ph ? { phrase: x.ph } : {}),
          ...(x.r ? { recipe: x.r } : {}),
          ...(x.s ? { status: x.s } : {}),
          ...(arr(x.rm)?.length ? { recipeMissing: arr(x.rm) } : {}),
          ...(x.d ? { display: x.d } : {}),
          ...(x.pg ? { page: x.pg } : {}),
          ...(x.k ? { kind: x.k } : {}),
          ...(x.q ? { questionId: x.q } : {}),
          ...(x.v ? { verdict: x.v } : {}),
          ...(x.c ? { comment: x.c } : {}),
          ...(x.rd === true ? { recipeDone: true } : {}),
        }))
      return { lignes, tronque: r.tronque }
    },

    async compter(quoi: Comptage) {
      const c = COMPTAGES[quoi]
      if (!c) return null
      // deno-lint-ignore no-explicit-any
      let q: any = sb.from(c.table).select(c.cle ?? 'id', { count: 'exact', head: true })
      if (c.vivantes !== false) q = q.eq('deleted', false)
      for (const [col, val] of c.egal ?? []) q = q.eq(col, val)
      for (const col of c.nonNul ?? []) q = q.not(col, 'is', null)
      for (const col of c.nul ?? []) q = q.is(col, null)
      const { count, error } = await q
      if (error || typeof count !== 'number') return null
      return count
    },

    async sante() {
      const { data, error } = await sb.rpc('hb_admin_sante')
      if (error) {
        // Fonction absente (script 069 pas appliqué) : PostgREST PGRST202, Postgres 42883.
        if (error.code === 'PGRST202' || error.code === '42883' || /hb_admin_sante/.test(error.message ?? '') && /find|exist/i.test(error.message ?? '')) return { absente: true as const }
        return { erreur: error.message ?? 'erreur' }
      }
      return data && typeof data === 'object' && !Array.isArray(data) ? { ok: data as Record<string, unknown> } : { erreur: 'réponse inattendue' }
    },

    async dernieresVues() {
      const { data, error } = await sb.rpc('hb_last_seen')
      if (error || !Array.isArray(data)) return []
      return (data as { user_id: string | null; last_seen_at: string | null }[]).filter((x) => x.user_id && x.last_seen_at).map((x) => ({ userId: x.user_id!, lastSeenAt: x.last_seen_at! }))
    },

    async derniereEcriture(userId) {
      // La date seulement (ni résumé, ni changements, ni nom).
      let q = sb.from('hb_audit').select('at')
      if (userId) q = q.eq('user_id', userId)
      const { data, error } = await q.order('at', { ascending: false }).limit(1)
      if (error || !Array.isArray(data) || !data.length) return null
      return typeof data[0].at === 'string' ? data[0].at : null
    },

    async activite(userId, depuis, o = {}): Promise<ActiviteSrv> {
      // Lignes créées par ce compte (auteur posé par le serveur, hb_stamp 004 ; colonne created_by de 058 quand elle existe)
      // depuis `depuis` : server_updated_at >= depuis (index de 058) ET createdAtServer >= depuis (création, pas modification).
      // `jusqua` : createdAtServer avant ; `sansGeneration` : sans identifiants « demo-… », data.source de démo ni data.demoBilan
      // (adminTraces.ts, provenance ; la ligne SQL sans compte n'a pas d'auteur, donc n'est jamais comptée ici).
      const n = async (table: string, auteur: string): Promise<number | null> => {
        // deno-lint-ignore no-explicit-any
        let q: any = sb
          .from(table)
          .select('id', { count: 'exact', head: true })
          .eq('deleted', false)
          .eq(auteur, userId)
          .gte('server_updated_at', depuis)
          .gte('data->>createdAtServer', depuis)
        if (o.jusqua) q = q.lt('data->>createdAtServer', o.jusqua)
        if (o.sansGeneration) q = q.not('id', 'like', 'demo-%').or('data->>source.is.null,data->>source.not.in.(demo,demo-progression,generation)').is('data->>demoBilan', null)
        const { count, error } = await q
        if (error && auteur === 'created_by' && /created_by/.test(error.message ?? '')) return n(table, 'data->>createdBy')
        return error || typeof count !== 'number' ? null : count
      }
      const [avis, mesures, evenements, vus, fiches] = await Promise.all([
        n('hb_evaluations', 'created_by'),
        n('hb_measurements', 'created_by'),
        n('hb_events', 'data->>createdBy'),
        n('hb_seen', 'created_by'),
        n('hb_players', 'created_by'),
      ])
      return { avis, mesures, evenements, vus, fiches }
    },

    // ---------- Traçabilité (adminTraces.ts) : APRÈS hb_is_admin ----------

    async traces(f, max) {
      let tronque = false
      const lignes: TraceSrv[] = []
      for (const type of f.types) {
        const d = TRACES[type]
        const r = await pages<RowTrace>((a, b) => {
          // deno-lint-ignore no-explicit-any
          let q: any = sb.from(d.table).select(d.cols).eq('deleted', false).gte('server_updated_at', f.depuis)
          if (f.auteur) q = q.eq(d.auteur, f.auteur)
          if (f.generation === 'sans') q = q.not('id', 'like', 'demo-%')
          return q.order('server_updated_at', { ascending: false }).range(a, b)
        }, max)
        tronque ||= r.tronque
        lignes.push(...r.rows.map((x) => versTrace(type, x)))
      }
      return { lignes, tronque }
    },

    async tracesParIds(type, ids) {
      const d = TRACES[type]
      const rows = await parPaquets(ids, async (paquet) => {
        const { data, error } = await sb.from(d.table).select(d.cols).in('id', paquet)
        if (error) throw new Error(error.message)
        return (data ?? []) as RowTrace[]
      })
      return rows.map((x) => versTrace(type, x))
    },

    async actions(f, max) {
      // Heure, compte, table, ligne, action : ni user_name, ni résumé (qui porte le nom du joueur), ni changements.
      const r = await pages<{ at: string; u: string | null; t: string; r: string; a: string }>((a, b) => {
        // deno-lint-ignore no-explicit-any
        let q: any = sb.from('hb_audit').select('at, u:user_id, t:table_name, r:row_id, a:action').gte('at', f.depuis).lt('at', f.jusqua)
          .in('table_name', ['measurements', 'evaluations', 'events', 'seen', 'players']).not('user_id', 'is', null)
        if (f.auteur) q = q.eq('user_id', f.auteur)
        return q.order('at', { ascending: false }).range(a, b)
      }, max)
      return { lignes: r.rows.filter((x) => x.u && x.at).map((x) => ({ at: x.at, userId: x.u!, table: x.t, rowId: x.r, action: x.a })), tronque: r.tronque }
    },

    async agregats(f) {
      const { data, error } = await sb.rpc('hb_admin_creations', {
        p_depuis: f.depuis, p_jusqua: f.jusqua, p_auteur: f.auteur ?? null, p_types: f.types ?? null, p_generation: f.generation, p_par: f.par,
      })
      if (error) {
        if (fonctionAbsente(error, 'hb_admin_creations')) return null
        throw new Error(error.message ?? 'hb_admin_creations')
      }
      return ((data ?? []) as Record<string, unknown>[]).map((x) => ({
        type: x.type as TypeTrace,
        auteur: str(x.auteur) ?? null,
        source: x.source as Provenance,
        lot: str(x.lot_id) ?? null,
        tranche: str(x.tranche) ?? null,
        nb: Number(x.nb) || 0,
        joueurs: Number(x.joueurs) || 0,
        premier: String(x.premier ?? ''),
        dernier: String(x.dernier ?? ''),
        declareMin: str(x.declare_min) ?? null,
        declareMax: str(x.declare_max) ?? null,
      }))
    },

    async saisiesResume(f) {
      const { data, error } = await sb.rpc('hb_admin_saisies', {
        p_depuis: f.depuis, p_jusqua: f.jusqua, p_auteur: f.auteur ?? null, p_test: f.test ?? null, p_evenement: f.evenement ?? null,
        p_source: f.source ?? null, p_generation: f.generation,
      })
      if (error) {
        if (fonctionAbsente(error, 'hb_admin_saisies')) return null
        throw new Error(error.message ?? 'hb_admin_saisies')
      }
      const num = (v: unknown) => (v === null || v === undefined || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null)
      return ((data ?? []) as Record<string, unknown>[]).map((x) => ({
        type: x.type === 'avis' ? ('avis' as const) : ('mesure' as const),
        cle: String(x.cle ?? ''),
        nb: Number(x.nb) || 0,
        joueurs: Number(x.joueurs) || 0,
        min: num(x.mini),
        max: num(x.maxi),
        moyenne: num(x.moyenne),
        premier: String(x.premier ?? ''),
        dernier: String(x.dernier ?? ''),
        sources: arr(x.sources) ?? [],
        evenements: arr(x.evenements) ?? [],
        valeursTexte: Number(x.valeurs_texte) || 0,
      }))
    },

    async lots() {
      const { data, error } = await sb.from('hb_lots').select('id, created_at, created_by, source, description, nb_lignes').order('created_at', { ascending: false }).limit(1000)
      if (absente(error)) return null
      if (error) throw new Error(error.message)
      return ((data ?? []) as { id: string; created_at: string; created_by: string | null; source: string; description: string | null; nb_lignes: unknown }[]).map((x) => ({
        id: x.id,
        createdAt: x.created_at,
        createdBy: x.created_by,
        source: x.source,
        description: x.description,
        nbLignes: x.nb_lignes && typeof x.nb_lignes === 'object' && !Array.isArray(x.nb_lignes) ? (x.nb_lignes as Record<string, number>) : {},
      }))
    },

    async evenementsParIds(ids) {
      const rows = await parPaquets(ids, async (paquet) => {
        const { data, error } = await sb.from('hb_events').select('id, n:data->>name, d:data->>date, a:data->archived, p:data->playerIds').in('id', paquet)
        if (error) throw new Error(error.message)
        return (data ?? []) as { id: string; n: string | null; d: string | null; a: unknown; p: unknown }[]
      })
      return rows.map((r) => ({ id: r.id, name: r.n ?? 'Événement', date: r.d ?? undefined, archived: r.a === true, playerIds: arr(r.p) ?? [] }))
    },

    // ---------- nextar_admin_proposer (adminProposer.ts) ----------

    async moi() {
      return moi ?? null
    },

    async unites() {
      // Identifiant et nom seulement ; structure (044) absente : aucune unité.
      try {
        const { rows } = await pages<{ id: string; n: string | null }>((a, b) => sb.from('hb_units').select('id, n:data->>name').eq('deleted', false).order('id').range(a, b), 5000)
        return rows.map((u) => ({ id: u.id, name: u.n ?? 'Unité' }))
      } catch {
        return []
      }
    },

    async idsFiches(max) {
      // Identifiant et « fondue » seulement : ni nom, ni date, ni club.
      const r = await pages<{ id: string; m: string | null }>((a, b) => sb.from('hb_players').select('id, m:data->>mergedInto').eq('deleted', false).order('id').range(a, b), max)
      return { fiches: r.rows.map((x) => ({ id: x.id, fondue: !!x.m })), tronque: r.tronque }
    },

    async deposerPropositionAdmin(p) {
      const { data, error } = await sb.from('hb_propositions').insert({ source: 'mcp', kind: 'admin', titre: p.titre, contexte: p.contexte, lignes: p.lignes }).select('id').single()
      // Table absente (067), ou sorte « admin » refusée par la contrainte de 067 (070 pas appliqué) : indisponible.
      if (absente(error) || (error?.code === '23514' && /kind/.test(error.message ?? ''))) return { indisponible: true as const }
      if (error?.code === '42501') return { erreur: 'réservé aux administrateurs (refus de la base)' }
      if (error || !data) return { erreur: error?.message ?? 'refus du serveur' }
      return { id: data.id as string }
    },
  }
}

/** Fonction de 071 absente : PostgREST PGRST202, Postgres 42883. */
const fonctionAbsente = (e: { code?: string; message?: string }, nom: string) =>
  e.code === 'PGRST202' || e.code === '42883' || (new RegExp(nom).test(e.message ?? '') && /find|exist/i.test(e.message ?? ''))

/** Colonnes des lignes tracées : marques de provenance, et ce qui sort en codes ; JAMAIS un nom, un commentaire ni « data » entier. */
type RowTrace = {
  id: string; sua: string; del: boolean | null; by: string | null; byn: string | null; cs: string | null; src: string | null; lot: string | null
  db: string | null; imp: string | null; p?: string | null; c?: string | null; v?: unknown; d?: string | null; e?: string | null; n?: string | null; s?: unknown
}
const MARQUES = 'id, sua:server_updated_at, del:deleted, by:data->>createdBy, byn:data->>createdByName, cs:data->>createdAtServer, src:data->>source, lot:data->>lotId, db:data->>demoBilan, imp:data->imported->>at'
const TRACES: Record<TypeTrace, { table: string; auteur: string; cols: string }> = {
  mesure: { table: 'hb_measurements', auteur: 'created_by', cols: `${MARQUES}, p:data->>playerId, c:data->>criterionId, v:data->value, d:data->>date` },
  avis: { table: 'hb_evaluations', auteur: 'created_by', cols: `${MARQUES}, p:data->>playerId, e:data->>eventId, d:data->>date, s:data->scores` },
  vu: { table: 'hb_seen', auteur: 'created_by', cols: `${MARQUES}, p:data->>playerId, e:data->>eventId` },
  fiche: { table: 'hb_players', auteur: 'created_by', cols: MARQUES },
  evenement: { table: 'hb_events', auteur: 'data->>createdBy', cols: `${MARQUES}, n:data->>name, d:data->>date` },
}
function versTrace(type: TypeTrace, x: RowTrace): TraceSrv {
  const scores: Record<string, number> = {}
  if (x.s && typeof x.s === 'object' && !Array.isArray(x.s)) for (const [k, v] of Object.entries(x.s as Record<string, unknown>)) if (typeof v === 'number' && Number.isFinite(v)) scores[k] = v
  return {
    type,
    id: x.id,
    auteur: x.by || null,
    ...(x.byn === 'Administration Supabase (SQL)' ? { sql: true } : {}),
    creeServeur: x.cs ?? null,
    ecrit: x.sua,
    ...(x.del ? { supprime: true } : {}),
    marque: x.src ?? null,
    lot: x.lot ?? null,
    ...(x.db !== null && x.db !== undefined ? { demoBilan: true } : {}),
    ...(x.imp ? { importe: true } : {}),
    ...(type === 'fiche' ? { joueur: x.id } : x.p ? { joueur: x.p } : {}),
    ...(x.c ? { test: x.c } : {}),
    ...(typeof x.v === 'number' || typeof x.v === 'string' ? { valeur: x.v } : {}),
    ...(x.d ? { date: x.d } : {}),
    ...(x.e ? { evenement: x.e } : {}),
    ...(type === 'evenement' && x.n ? { nom: x.n } : {}),
    ...(type === 'avis' ? { scores } : {}),
  }
}

/** Comptages de Source.compter : table et filtres FIXES (aucun nom de table ne vient de l'extérieur). */
const COMPTAGES: Record<Comptage, { table: string; cle?: string; vivantes?: false; egal?: [string, string][]; nonNul?: string[]; nul?: string[] }> = {
  joueurs: { table: 'hb_players', nul: ['data->>mergedInto'] },
  joueurs_fondus: { table: 'hb_players', nonNul: ['data->>mergedInto'] },
  joueurs_revus: { table: 'hb_players', nonNul: ['data->>review'], nul: ['data->>mergedInto'] },
  mesures: { table: 'hb_measurements' },
  avis: { table: 'hb_evaluations' },
  evenements: { table: 'hb_events' },
  groupes: { table: 'hb_groups' },
  vus: { table: 'hb_seen' },
  videos: { table: 'hb_videos' },
  a_revoir: { table: 'hb_rewatch' },
  criteres: { table: 'hb_criteria' },
  listes: { table: 'hb_lists' },
  unites: { table: 'hb_units' },
  affectations: { table: 'hb_assignments' },
  rencontres: { table: 'hb_rencontres' },
  alertes: { table: 'hb_alerts' },
  journal_questions: { table: 'hb_question_log' },
  historique: { table: 'hb_audit', vivantes: false },
  connexions: { table: 'hb_connections', cle: 'session_id', vivantes: false },
}
