import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useState } from 'react'
import { db, DEMO, newId } from './db'
import { realUserId } from './roles'
import { guardWrite, spyTarget } from './spy'
import { subscribeSync, supabase } from './sync'
import {
  badgeCount,
  expiredLocal,
  fromServer,
  jsonBytes,
  LIMITS,
  pendingOf,
  planDelete,
  planEtat,
  planKeep,
  planPull,
  toServer,
  type KeepInput,
  type PropChoix,
  type PropEtat,
  type PropositionRow,
  type ServerProposition,
} from './propositionsCore'

/*
 * Boîte « À valider » (règles pures : src/propositionsCore.ts ; écran : src/components/Propositions.tsx).
 * OÙ ELLES VIVENT : sur l'appareil (table Dexie « propositions », disponibles hors ligne), et sur le COMPTE quand le serveur
 * connaît la table hb_propositions (supabase/067_propositions.sql) : chacun lit et écrit SES lignes directement (règles :
 * leur auteur seul, administrateurs compris), hors de la synchronisation générale (ni hb_upsert, ni registre, ni direct).
 *  - garder (« Garder pour plus tard ») ou changer d'état (validée, en partie, rejetée) : sur l'appareil (à envoyer), puis
 *    envoi aussitôt si possible ; sinon au prochain passage ;
 *  - relecture du serveur (propositions déposées par le serveur MCP, ou depuis un autre appareil) : à l'ouverture de l'appli,
 *    au retour au premier plan, à l'ouverture de la boîte et après chaque action ; d'abord les dates de modification seules,
 *    puis les propositions nouvelles ou changées ;
 *  - le serveur pose le compte et les dates (création, expiration à 30 jours) ; une proposition traitée ou retirée est
 *    effacée 7 jours plus tard (ici comme sur le serveur).
 * Version d'essai sans serveur, démonstration (comptes partagés), table pas encore créée : sur l'appareil seulement (la
 * boîte marche de la même façon). « Voir comme… » : aucune (elles ne sont qu'à soi).
 * Aucune IA n'est appelée ici, rien ne part ailleurs que vers notre serveur.
 */

/** Compte à qui appartiennent les propositions de l'appareil (version d'essai sans serveur : « »). */
const owner = () => realUserId() ?? ''
const synced = () => !!supabase && !DEMO && !!realUserId()
const mine = () => db.propositions.where('owner').equals(owner()).toArray()

/** Mes propositions (toutes, traitées comprises) ; undefined pendant la lecture. */
export function usePropositions(): PropositionRow[] | undefined {
  return useLiveQuery(async () => (spyTarget() ? [] : mine()), [])
}

/** Horloge qui avance chaque minute (une proposition expirée sort de la pastille sans recharger). */
function useMinute() {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 60_000)
    return () => window.clearInterval(t)
  }, [])
  return now
}

/** Propositions en attente (que cette version sait ouvrir), de la plus récente à la plus ancienne. */
export function usePendingPropositions(): PropositionRow[] {
  const rows = usePropositions()
  const now = useMinute()
  return rows ? pendingOf(rows, owner(), now) : []
}

/** Nombre de la pastille de l'en-tête. */
export function usePendingPropositionCount(): number {
  const rows = usePropositions()
  const now = useMinute()
  return rows ? badgeCount(rows, owner(), now) : 0
}

/** Garde un tableau pour plus tard (ou met à jour une proposition rouverte) ; renvoie son identifiant ou le message à montrer. */
export async function keepProposition(input: KeepInput): Promise<{ id: string } | { error: string }> {
  guardWrite()
  const me = owner()
  const plan = planKeep(await mine(), input, { owner: me, now: Date.now(), newId })
  if ('error' in plan) return plan
  await db.propositions.put(plan.row)
  void sendThenRead()
  return { id: plan.row.id }
}

/** Choix faits sur l'écran « À valider » (colonnes, joueurs, valeurs) gardés avec la proposition, sans rien d'autre. */
export async function saveChoix(id: string, choix: PropChoix) {
  guardWrite()
  const r = await db.propositions.get(id)
  if (!r || r.owner !== owner() || r.etat !== 'en_attente') return
  const contexte = { ...r.contexte, choix }
  if (jsonBytes(contexte) > LIMITS.contexte) return
  await db.propositions.put({ ...r, contexte, updatedAt: Math.max(Date.now(), r.updatedAt + 1), dirty: 1 })
  void sendThenRead()
}

export async function setPropositionEtat(id: string, etat: PropEtat) {
  guardWrite()
  const r = await db.propositions.get(id)
  if (!r || r.owner !== owner() || r.etat === etat) return
  await db.propositions.put(planEtat(r, etat, Date.now()))
  void sendThenRead()
}

export async function deleteProposition(id: string) {
  guardWrite()
  const r = await db.propositions.get(id)
  if (!r || r.owner !== owner() || r.deletedAt) return
  await db.propositions.put(planDelete(r, Date.now()))
  void sendThenRead()
}

// ---------- Avec le serveur ----------

let missing = false // table pas (encore) créée sur le serveur : réessayé au prochain lancement
let pushing: Promise<void> | null = null
let pulling: Promise<void> | null = null
let lastPull = 0

const isMissing = (e: { code?: string } | null) => !!e && (e.code === '42P01' || e.code === 'PGRST205')
const COLS = 'id, source, kind, titre, contexte, lignes, etat, created_at, updated_at, expires_at, deleted_at'

/** Envoie les propositions modifiées sur l'appareil. */
function push(): Promise<void> {
  if (!synced() || missing || spyTarget()) return Promise.resolve()
  if (!pushing)
    pushing = pushNow()
      .catch((e) => console.error(e))
      .finally(() => (pushing = null))
  return pushing
}

async function pushNow() {
  const sb = supabase!
  const me = owner()
  const dirty = (await mine()).filter((r) => r.dirty)
  for (const r of dirty) {
    const body = toServer(r)
    // Nouvelle : création (le serveur pose compte et dates) ; déjà connue : modification (jamais d'upsert : la création
    // remettrait la proposition en attente et compterait dans la limite).
    let res = r.onServer
      ? await sb.from('hb_propositions').update({ titre: body.titre, contexte: body.contexte, lignes: body.lignes, etat: body.etat, deleted_at: body.deleted_at }).eq('id', r.id).select(COLS).maybeSingle()
      : await sb.from('hb_propositions').insert(body).select(COLS).maybeSingle()
    if (isMissing(res.error)) {
      missing = true
      return
    }
    // Déjà créée (réponse perdue la fois d'avant) : on la modifie.
    if (!r.onServer && res.error?.code === '23505')
      res = await sb.from('hb_propositions').update({ titre: body.titre, contexte: body.contexte, lignes: body.lignes, etat: body.etat, deleted_at: body.deleted_at }).eq('id', r.id).select(COLS).maybeSingle()
    if (res.error) {
      // Refus du serveur (boîte du compte pleine, tableau trop long…) : gardée sur l'appareil, avec le message.
      await db.propositions.update(r.id, { sendError: res.error.message })
      continue
    }
    const s = res.data as ServerProposition | null
    await db.transaction('rw', db.propositions, async () => {
      const cur = await db.propositions.get(r.id)
      if (!cur || cur.updatedAt !== r.updatedAt) return // modifiée entre-temps : renvoyée au prochain passage
      const next = s ? fromServer(s, undefined, me) : null
      await db.propositions.put(next ?? { ...cur, dirty: 0, onServer: 1, sendError: undefined })
    })
  }
}

/** Relit mes propositions du serveur : dates d'abord, puis les nouvelles ou changées. */
function pull(): Promise<void> {
  if (!synced() || missing || spyTarget()) return Promise.resolve()
  if (!pulling)
    pulling = pullNow()
      .catch((e) => console.error(e))
      .finally(() => (pulling = null))
  return pulling
}

async function pullNow() {
  lastPull = Date.now()
  await push()
  const sb = supabase!
  const me = owner()
  const { data: meta, error } = await sb.from('hb_propositions').select('id, updated_at').limit(500)
  if (isMissing(error)) {
    missing = true
    return
  }
  if (error || !meta) return
  const plan = planPull(await mine(), meta as { id: string; updated_at: string }[], me)
  const got: ServerProposition[] = []
  for (let i = 0; i < plan.fetch.length; i += 50) {
    const { data } = await sb.from('hb_propositions').select(COLS).in('id', plan.fetch.slice(i, i + 50))
    if (data) got.push(...(data as ServerProposition[]))
  }
  await db.transaction('rw', db.propositions, async () => {
    for (const s of got) {
      const local = await db.propositions.get(s.id)
      if (local && local.owner !== me) continue
      const row = fromServer(s, local, me)
      if (row) await db.propositions.put(row)
    }
    if (plan.forget.length) await db.propositions.bulkDelete(plan.forget)
  })
}

/** Ménage de l'appareil : traitées ou retirées depuis 7 jours, expirées. */
async function tidy() {
  const old = expiredLocal(await mine(), Date.now())
  if (old.length) await db.propositions.bulkDelete(old)
}

/** Après une action : envoi, puis relecture (une proposition déposée entre-temps par le serveur MCP arrive aussi). */
async function sendThenRead() {
  await push()
  await pull()
}

/** Relecture tout de suite (ouverture de la boîte), au plus toutes les `min` millisecondes. */
export function refreshPropositions(min = 0) {
  if (Date.now() - lastPull < min) return
  void tidy().catch(() => {})
  void pull().catch((e) => console.error(e))
}

if (typeof window !== 'undefined') {
  void tidy().catch(() => {})
  if (supabase && !DEMO) {
    // Ouverture de l'appli : au premier passage de la synchronisation (session prête), puis au plus toutes les 5 minutes à
    // son rythme ; retour au premier plan : relecture (au plus toutes les 20 s) ; retour du réseau : envoi.
    subscribeSync(() => refreshPropositions(5 * 60_000))
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') refreshPropositions(20_000)
    })
    window.addEventListener('online', () => void push())
  }
}
