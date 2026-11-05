// Nextar, serveur MCP : accès aux données AUX DROITS DU COACH. Le client Supabase reçu est celui de SON jeton (OAuth, via
// withSupabase({ auth: 'user' }) de @supabase/server) : chaque lecture passe par les règles de la base (rôle du staff,
// périmètre de 046/047, groupes privés de 017…), chaque écriture par les règles de hb_propositions (067) et hb_rapports
// (068). JAMAIS la clé de service ici.
//
// Ce qui est lu, colonne par colonne (sélections PostgREST explicites, jamais « data » entier pour les joueurs) :
//  - nextar_lire : id, année tirée de la date de naissance (la date reste ici), sexe, poste, département (scope_dept) ;
//    mesures (joueur, test, valeur, date), avis (joueur, date, notes chiffrées ; ni points forts, ni axes, ni portrait), vus ;
//  - nextar_proposer : prénom, nom et date de naissance des joueurs du contexte, pour le rapprochement fait ici ; rien de
//    cela ne sort (outils.ts, verifierSortie).
// Fichier sans import Deno (testable avec npx jiti et un faux client, tools/test-mcp.ts).

import { eventNumbers } from './partage/importMesures.ts'
import type { ConfigRow } from './partage/sportConfig.ts'
import type { AvisSrv, CritereSrv, EvenementSrv, FiltreJoueurs, GroupeSrv, JoueurLire, JoueurNom, MesureSrv, PropositionSrv, Source, VuSrv } from './outils.ts'

/** Ce dont on se sert du client supabase-js (requêtes PostgREST). */
// deno-lint-ignore no-explicit-any
export type ClientSupabase = { from(table: string): any }

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

export function sourceSupabase(sb: ClientSupabase): Source {
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
      const { rows } = await pages<{ id: string; n: string | null; a: unknown; p: unknown }>(
        (a, b) => sb.from('hb_groups').select('id, n:data->>name, a:data->archived, p:data->playerIds').eq('deleted', false).range(a, b),
        600,
      )
      return rows.map((r) => ({ id: r.id, name: r.n ?? 'Groupe', archived: r.a === true, playerIds: arr(r.p) ?? [] })).filter((g) => archives || !g.archived)
    },

    async groupe(id): Promise<GroupeSrv | null> {
      const { data, error } = await sb.from('hb_groups').select('id, n:data->>name, a:data->archived, p:data->playerIds').eq('id', id).eq('deleted', false).maybeSingle()
      if (error || !data) return null
      return { id: data.id, name: data.n ?? 'Groupe', archived: data.a === true, playerIds: arr(data.p) ?? [] }
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
      const { data, error } = await sb.from('hb_propositions').insert({ source: 'mcp', kind: 'mesures', titre: p.titre, contexte: p.contexte, lignes: p.lignes }).select('id').single()
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
  }
}
