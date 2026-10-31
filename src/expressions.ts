import { useLiveQuery } from 'dexie-react-hooks'
import { db, DEMO, newId } from './db'
import { realUserId } from './roles'
import { guardWrite, spyTarget } from './spy'
import { subscribeSync, supabase } from './sync'
import { fromServer, ownExpressions, planDelete, planSave, toServer, type ExpressionCible, type ExpressionRow, type ServerExpression } from './expressionsCore'

/*
 * « Mes expressions » (vocabulaire de l'entraîneur pour l'avis vocal ; règles pures : src/expressionsCore.ts).
 * OÙ ELLES VIVENT : sur l'appareil (table Dexie « expressions », disponibles hors ligne), et sur le COMPTE quand le serveur
 * connaît la table hb_expressions (supabase/062_mes_expressions.sql) : chacun lit et écrit SES lignes directement (règles
 * de lecture et d'écriture : leur auteur seul, administrateurs compris), hors de la synchronisation générale (ni hb_upsert,
 * ni registre, ni direct : quelques lignes par compte).
 *  - écriture : sur l'appareil (à envoyer), puis envoi aussitôt si possible ; sinon à la synchronisation suivante ;
 *  - lecture du serveur : au lancement, puis au plus toutes les 10 minutes (au rythme de la synchronisation) ;
 *  - la plus récente l'emporte (le serveur refuse une version plus ancienne que la sienne) ; même texte créé sur deux
 *    appareils hors ligne : l'appareil reprend la ligne du serveur et y pose sa version.
 * Version d'essai sans serveur, démonstration (comptes partagés), table pas encore créée : sur l'appareil seulement.
 * « Voir comme… » : aucune (elles ne sont qu'à soi), et lecture seule.
 */

const PULL_EVERY = 10 * 60_000
/** Compte auquel appartiennent les expressions de l'appareil (version d'essai sans serveur : « »). */
const owner = () => realUserId() ?? ''
const synced = () => !!supabase && !DEMO && !!realUserId()

/** Mes expressions (vivantes, par ordre alphabétique) ; undefined pendant la lecture. */
export function useExpressions(): ExpressionRow[] | undefined {
  return useLiveQuery(async () => (spyTarget() ? [] : ownExpressions(await db.expressions.where('owner').equals(owner()).toArray(), owner())), [])
}

/** Mes expressions, hors React (avis vocal : vocabulaire envoyé avec le texte dicté). */
export async function loadExpressions(): Promise<ExpressionRow[]> {
  if (spyTarget()) return []
  return ownExpressions(await db.expressions.where('owner').equals(owner()).toArray(), owner())
}

/** Crée ou met à jour (même texte, ou `id`) une expression ; renvoie false si rien n'a été enregistré. */
export async function saveExpression(input: { id?: string; texte: string; cibles: ExpressionCible[] }): Promise<boolean> {
  guardWrite()
  const me = owner()
  const rows = planSave(await db.expressions.where('owner').equals(me).toArray(), input, { owner: me, now: Date.now(), newId })
  if (!rows.length) return false
  await db.expressions.bulkPut(rows)
  void push()
  return true
}

/** Plusieurs expressions d'un coup (« Retenir pour la prochaine fois » dans la fenêtre des propositions). */
export async function saveExpressions(list: { texte: string; cibles: ExpressionCible[] }[]) {
  for (const x of list) await saveExpression(x)
}

export async function deleteExpression(id: string) {
  guardWrite()
  const r = await db.expressions.get(id)
  if (!r || r.deleted) return
  await db.expressions.put(planDelete(r, Date.now()))
  void push()
}

// ---------- Avec le serveur ----------

let missing = false // table pas (encore) créée sur le serveur : réessayé au prochain lancement
let pushing: Promise<void> | null = null
let lastPull = 0

const isMissing = (e: { code?: string } | null) => !!e && (e.code === '42P01' || e.code === 'PGRST205')

/** Envoie les expressions modifiées sur l'appareil. */
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
  const dirty = (await db.expressions.where('owner').equals(me).toArray()).filter((r) => r.dirty)
  for (const r of dirty) {
    const { error } = await sb.from('hb_expressions').upsert(toServer(r), { onConflict: 'id' })
    if (isMissing(error)) {
      missing = true
      return
    }
    if (error?.code === '23505') {
      // Même texte déjà enregistré par un autre appareil : on reprend sa ligne et on y pose cette version.
      const { data } = await sb.from('hb_expressions').select('id').ilike('texte', r.texte.replace(/[\\%_]/g, '\\$&')).is('deleted_at', null).limit(1)
      const other = (data?.[0] as { id?: string } | undefined)?.id
      if (other && other !== r.id) {
        const moved: ExpressionRow = { ...r, id: other }
        await db.transaction('rw', db.expressions, async () => {
          await db.expressions.delete(r.id)
          await db.expressions.put(moved)
        })
        const again = await sb.from('hb_expressions').upsert(toServer(moved), { onConflict: 'id' })
        if (!again.error) await markSent(moved)
      }
      continue
    }
    if (error) throw error
    await markSent(r)
  }
}

/** Envoyée : plus à envoyer, sauf si elle a encore changé entre-temps. */
async function markSent(r: ExpressionRow) {
  await db.transaction('rw', db.expressions, async () => {
    const cur = await db.expressions.get(r.id)
    if (cur && cur.updatedAt === r.updatedAt) await db.expressions.put({ ...cur, dirty: 0 })
  })
}

/** Relit toutes mes expressions du serveur (supprimées comprises : les autres appareils les oublient aussi). */
async function pull() {
  if (!synced() || missing || spyTarget()) return
  lastPull = Date.now()
  await push()
  const me = owner()
  const { data, error } = await supabase!.from('hb_expressions').select('id, texte, cibles, created_at, updated_at, deleted_at').limit(500)
  if (isMissing(error)) {
    missing = true
    return
  }
  if (error || !data) return
  await db.transaction('rw', db.expressions, async () => {
    for (const s of data as ServerExpression[]) {
      const local = await db.expressions.get(s.id)
      if (local && local.owner !== me) continue
      const row = fromServer(s, local, me)
      if (row) await db.expressions.put(row)
    }
  })
}

if (typeof window !== 'undefined' && supabase && !DEMO) {
  // Au rythme de la synchronisation générale : envoi de ce qui attend, relecture au plus toutes les 10 minutes.
  subscribeSync(() => {
    if (Date.now() - lastPull >= PULL_EVERY) void pull().catch((e) => console.error(e))
    else void push()
  })
  window.addEventListener('online', () => void push())
}

/** Relecture tout de suite (ouverture de « Mes expressions »). */
export const refreshExpressions = () => void pull().catch((e) => console.error(e))
